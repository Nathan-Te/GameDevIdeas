import assert from 'node:assert/strict';
import { networkInterfaces } from 'node:os';
import { describe, test } from 'node:test';

import { classify } from '../src/access.js';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { createPublicEntry, listenPublicEntry } from '../src/public-entry.js';

import { http } from './helpers.js';

/**
 * Le test qui manquait au lot 7, et qui aurait évité la panne.
 *
 * La première version de la porte classait aussi par adresse source : boucle
 * locale et `100.64.0.0/10` étaient Nathan, le reste un visiteur. En conteneur,
 * **toutes** les requêtes arrivent par la passerelle du réseau bridge
 * (`172.x.0.1`) — donc l'application répondait 404 à Nathan sur son propre
 * port. Aucun test ne l'a vu, parce qu'ils passaient tous par `inject`, qui
 * présente les requêtes depuis `127.0.0.1`.
 *
 * Ce fichier lance donc le **vrai** serveur sur ses deux ports et l'interroge
 * par le réseau, depuis une adresse qui n'est ni la boucle locale ni le
 * tailnet. Il vérifie en plus, en écoutant les serveurs HTTP eux-mêmes, que le
 * serveur a bel et bien vu cette adresse-là : sans cette assertion, le test
 * pourrait passer en parlant à `127.0.0.1` sans que personne s'en aperçoive.
 */

/** `100.64.0.0/10` — la plage du tailnet, celle qu'il faut justement éviter ici. */
const TAILNET = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

/**
 * Une adresse IPv4 de cette machine qui n'est ni la boucle locale ni le
 * tailnet : une interface Ethernet, un Wi-Fi, une passerelle Docker…
 *
 * S'il n'y en a aucune, le test **échoue** au lieu de se sauter. Un test qui
 * se saute en silence sur le poste de développement puis en intégration ne
 * prouve rien — c'est la règle du projet, et c'est exactement le genre de
 * silence qui a laissé passer le défaut que ce fichier couvre.
 */
function foreignAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('127.') || TAILNET.test(entry.address)) continue;
      return entry.address;
    }
  }

  assert.fail(
    'aucune adresse IPv4 non-locale sur cette machine : impossible d’éprouver la porte ' +
      'depuis une adresse qui n’est ni la boucle locale ni le tailnet. Ce test refuse de ' +
      'se sauter — brancher une interface réseau, ou lancer la suite dans le conteneur.',
  );
}

/**
 * L'application servie pour de bon, sur ses deux ports, écoutant sur toutes les
 * interfaces — comme en conteneur.
 */
async function serveBothPorts(t) {
  const db = openDatabase({ path: ':memory:', migrate: true });
  const app = await buildApp({ db });

  await app.ready();
  await app.listen({ port: 0, host: '0.0.0.0' });

  const publicServer = createPublicEntry(app);
  await listenPublicEntry(publicServer, { port: 0, host: '0.0.0.0' });

  /**
   * Ce que les serveurs ont réellement vu arriver, pour prouver que le test dit
   * vrai. Relevé sur l'événement `request` des serveurs HTTP eux-mêmes, et non
   * par un crochet Fastify : le crochet de la porte répond 404 et court-circuite
   * ceux qui le suivent, donc une requête de visiteur n'en atteindrait aucun.
   *
   * L'émission est synchrone : le gestionnaire principal — celui qui pose le
   * marqueur — a déjà tourné quand cet écouteur-ci s'exécute.
   */
  const seen = [];
  const watch = (server) =>
    server.on('request', (req) => {
      seen.push({ url: req.url, remote: req.socket.remoteAddress, access: classify(req) });
    });
  watch(app.server);
  watch(publicServer);

  t.after(async () => {
    await new Promise((resolve) => publicServer.close(resolve));
    await app.close();
    db.close();
  });

  return {
    app,
    db,
    seen,
    ownerPort: app.server.address().port,
    publicPort: publicServer.address().port,
  };
}

describe('la porte, sur de vrais sockets et depuis une adresse étrangère', () => {
  test('le port de Nathan répond 200, même vu d’une adresse qui n’est ni locale ni tailnet', async (t) => {
    const served = await serveBothPorts(t);
    const address = foreignAddress();

    const res = await http(`http://${address}:${served.ownerPort}`, 'GET', '/api/ideas');

    assert.equal(res.status, 200, `le port de Nathan doit rester ouvert depuis ${address}`);
    assert.deepEqual(res.body, { ideas: [] });

    // La preuve que le test a bien fait ce qu'il prétend : le serveur a vu
    // arriver la requête d'ailleurs que de la boucle locale, et l'a quand même
    // classée `owner`.
    const vu = served.seen.at(-1);
    assert.equal(vu.access, 'owner');
    assert.doesNotMatch(vu.remote, /^(::1|::ffff:)?127\./, 'la requête doit venir d’ailleurs');
    assert.doesNotMatch(vu.remote, TAILNET, 'et pas non plus du tailnet');
  });

  test('le port public répond 404 sur la même route, depuis la même adresse', async (t) => {
    const served = await serveBothPorts(t);
    const address = foreignAddress();

    const res = await http(`http://${address}:${served.publicPort}`, 'GET', '/api/ideas');

    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'not_found');
    assert.equal(served.seen.at(-1).access, 'guest');
  });

  test('la même adresse, deux ports, deux réponses opposées', async (t) => {
    const served = await serveBothPorts(t);
    const address = foreignAddress();

    // C'est tout le lot en une assertion : seul le port distingue les deux.
    const chezNathan = await http(`http://${address}:${served.ownerPort}`, 'GET', '/api/families');
    const chezLesAmis = await http(`http://${address}:${served.publicPort}`, 'GET', '/api/families');

    assert.equal(chezNathan.status, 200);
    assert.equal(chezLesAmis.status, 404);

    const [nathan, ami] = served.seen.slice(-2);
    assert.equal(nathan.remote, ami.remote, 'la même adresse source des deux côtés');
    assert.equal(nathan.access, 'owner');
    assert.equal(ami.access, 'guest');
  });

  test('aucun en-tête envoyé par le client ne change son camp', async (t) => {
    const served = await serveBothPorts(t);
    const address = foreignAddress();

    const menteurs = {
      'x-vitrine-public': '1',
      'tailscale-funnel-request': '?1',
      'x-forwarded-for': '100.64.0.1',
      'x-real-ip': '127.0.0.1',
    };

    // Chez Nathan, aucun en-tête ne ferme la porte…
    const chezNathan = await http(
      `http://${address}:${served.ownerPort}`,
      'GET',
      '/api/ideas',
      undefined,
      menteurs,
    );
    assert.equal(chezNathan.status, 200);

    // …et côté public, aucun ne l'ouvre.
    const chezLesAmis = await http(
      `http://${address}:${served.publicPort}`,
      'GET',
      '/api/ideas',
      undefined,
      menteurs,
    );
    assert.equal(chezLesAmis.status, 404);
  });

  test('la boucle locale n’est pas un cas particulier : elle suit son port', async (t) => {
    const served = await serveBothPorts(t);

    const chezNathan = await http(`http://127.0.0.1:${served.ownerPort}`, 'GET', '/api/ideas');
    const chezLesAmis = await http(`http://127.0.0.1:${served.publicPort}`, 'GET', '/api/ideas');

    // C'est le cas de Tailscale Funnel, qui proxifie depuis la machine
    // elle-même : l'adresse est locale, et pourtant c'est bien un visiteur.
    assert.equal(chezNathan.status, 200);
    assert.equal(chezLesAmis.status, 404);
  });

  test('un visiteur atteint quand même ce qui lui est ouvert', async (t) => {
    const served = await serveBothPorts(t);
    const address = foreignAddress();

    // Un lien inconnu : 404, mais celui d'un lien mort — pas celui d'une route
    // fermée. La porte a laissé passer la requête jusqu'à la route.
    const res = await http(
      `http://${address}:${served.publicPort}`,
      'GET',
      '/api/share/aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );

    assert.equal(res.status, 404);
    assert.equal(res.body.message, 'Ce lien n’est plus valable.');
  });
});
