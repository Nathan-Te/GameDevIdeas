import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { classify, GUEST, isGuestAllowed, OWNER } from '../src/access.js';

import { asVisitor, del, get, guest, makeApp, patch, post, seedIdea } from './helpers.js';

/**
 * Le lot 7 ouvre l'application sur Internet. Ce fichier est donc moins une
 * suite de tests de fonctionnalité qu'une suite de tests de **porte** : ce qui
 * y compte le plus, c'est la première section, qui vérifie route par route que
 * ce qui n'est pas ouvert est fermé — et fermé en 404, pas en 403.
 */

const VISITOR = 'visiteur-aaaaaaaa';
const AUTRE = 'visiteur-bbbbbbbb';

/** Une sélection de deux idées, plus une troisième laissée dehors. */
async function seedShare(app, options = {}) {
  const dedans = await seedIdea(app, { title: 'Dedans' });
  const encore = await seedIdea(app, { title: 'Encore dedans' });
  const dehors = await seedIdea(app, { title: 'Dehors' });

  const res = await post(app, '/api/shares', {
    label: 'Les copains',
    idea_slugs: [dedans.slug, encore.slug],
    ...options,
  });
  assert.equal(res.status, 201);

  return { share: res.body, dedans, encore, dehors };
}

describe('la porte : ce qui est fermé au visiteur', () => {
  /**
   * La liste blanche est la seule chose qui protège l'instance. Ce tableau est
   * son miroir : chaque route de l'application qui n'y est pas doit répondre
   * 404 — et non 403, qui confirmerait son existence.
   */
  const FERMEES = [
    ['GET', '/api/ideas'],
    ['GET', '/api/ideas/dedans'],
    ['POST', '/api/ideas'],
    ['PATCH', '/api/ideas/dedans'],
    ['DELETE', '/api/ideas/dedans'],
    ['DELETE', '/api/ideas/dedans/purge'],
    ['GET', '/api/ideas/dedans/verdicts'],
    ['POST', '/api/ideas/dedans/verdicts'],
    ['GET', '/api/ideas/dedans/reviews'],
    ['GET', '/api/ideas/dedans/attachments'],
    ['POST', '/api/ideas/dedans/attachments'],
    ['PUT', '/api/ideas/dedans/attachments/order'],
    ['PATCH', '/api/attachments/1'],
    ['DELETE', '/api/attachments/1'],
    ['GET', '/api/families'],
    ['POST', '/api/families'],
    ['PATCH', '/api/families/autre'],
    ['DELETE', '/api/families/autre'],
    ['GET', '/api/config'],
    ['GET', '/api/backup/preview'],
    ['POST', '/api/backup'],
    ['POST', '/api/restore'],
    ['GET', '/api/backups'],
    ['DELETE', '/api/backups/vitrine.tgz'],
    ['GET', '/api/shares'],
    ['POST', '/api/shares'],
    ['GET', '/api/shares/1'],
    ['PATCH', '/api/shares/1'],
    ['POST', '/api/shares/1/revoke'],
    ['DELETE', '/api/reviews/1'],
  ];

  for (const [method, url] of FERMEES) {
    test(`${method} ${url} répond 404 à un visiteur`, async (t) => {
      const { app } = await makeApp(t);
      await seedShare(app);

      const res = await guest(app, method, url, {});

      assert.equal(res.status, 404, `${method} ${url} n'est pas fermée`);
      assert.equal(res.body.error, 'not_found');
      // Exactement le 404 d'une route inexistante : rien ne distingue les deux.
      assert.match(res.body.message, /^Route inconnue : /);
    });
  }

  test('les mêmes routes répondent normalement à Nathan', async (t) => {
    const { app } = await makeApp(t);
    await seedShare(app);

    for (const url of ['/api/ideas', '/api/families', '/api/shares', '/api/backups']) {
      assert.equal((await get(app, url)).status, 200, url);
    }
  });

  test('une route inventée est fermée sans que personne ait eu à l’inscrire', async (t) => {
    const { app } = await makeApp(t);
    const res = await guest(app, 'GET', '/api/statistiques-secretes');
    assert.equal(res.status, 404);
  });

  test('le repli SPA ne s’ouvre au visiteur que sous /p/', async (t) => {
    const { app } = await makeApp(t);

    // Sans front construit, la réponse est un 404 JSON dans les deux cas ; ce
    // qui compte est que la porte réponde avant même de savoir s'il y en a un.
    for (const url of ['/', '/idees/dedans', '/sauvegarde', '/partages']) {
      const res = await guest(app, 'GET', url);
      assert.equal(res.status, 404, url);
    }
  });

  test('toute réponse porte X-Robots-Tag', async (t) => {
    const { app } = await makeApp(t);
    const { share } = await seedShare(app);

    const res = await guest(app, 'GET', `/api/share/${share.token}`);
    assert.match(res.headers['x-robots-tag'], /noindex/);
  });
});

describe('le lien de partage', () => {
  test('le jeton fait 43 caractères de base64url', async (t) => {
    const { app } = await makeApp(t);
    const { share } = await seedShare(app);

    assert.match(share.token, /^[A-Za-z0-9_-]{43}$/);
  });

  test('un visiteur lit la sélection et ses idées, dans l’ordre', async (t) => {
    const { app } = await makeApp(t);
    const { share, dedans, encore } = await seedShare(app);

    const res = await guest(app, 'GET', `/api/share/${share.token}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.share.label, 'Les copains');
    assert.deepEqual(
      res.body.ideas.map((idea) => idea.slug),
      [dedans.slug, encore.slug],
    );
  });

  test('la sélection ne laisse filtrer ni verdict ni liste de souhaits de Nathan', async (t) => {
    const { app } = await makeApp(t);
    const { share, dedans } = await seedShare(app);

    await post(app, `/api/ideas/${dedans.slug}/verdicts`, { score: 5, note: 'la mienne' });
    await patch(app, `/api/ideas/${dedans.slug}`, { wishlisted: true });

    const liste = await guest(app, 'GET', `/api/share/${share.token}`);
    const page = await guest(app, 'GET', `/api/share/${share.token}/ideas/${dedans.slug}`);

    const serialise = JSON.stringify([liste.body, page.body]);
    assert.doesNotMatch(serialise, /la mienne/);
    assert.equal(liste.body.ideas[0].current_verdict, undefined);
    assert.equal(liste.body.ideas[0].wishlisted_at, undefined);
    assert.equal(page.body.idea.current_verdict, undefined);
    assert.equal(page.body.idea.wishlisted_at, undefined);
  });

  test('une idée hors sélection répond 404 même si elle existe', async (t) => {
    const { app } = await makeApp(t);
    const { share, dehors } = await seedShare(app);

    // Elle existe bel et bien pour Nathan.
    assert.equal((await get(app, `/api/ideas/${dehors.slug}`)).status, 200);

    const res = await guest(app, 'GET', `/api/share/${share.token}/ideas/${dehors.slug}`);
    assert.equal(res.status, 404);
  });

  test('un lien inconnu, révoqué ou expiré donnent le même 404, mot pour mot', async (t) => {
    const { app } = await makeApp(t);

    const { share: revoque } = await seedShare(app);
    await post(app, `/api/shares/${revoque.id}/revoke`, {});

    const { share: expire } = await seedShare(app, { expires_at: '2020-01-01' });

    const inconnu = await guest(app, 'GET', '/api/share/aaaaaaaaaaaaaaaaaaaaaaaa');
    const revoked = await guest(app, 'GET', `/api/share/${revoque.token}`);
    const expired = await guest(app, 'GET', `/api/share/${expire.token}`);

    for (const res of [inconnu, revoked, expired]) {
      assert.equal(res.status, 404);
      assert.equal(res.body.message, inconnu.body.message);
    }
  });

  test('révoquer ne supprime pas la sélection : Nathan la voit encore', async (t) => {
    const { app } = await makeApp(t);
    const { share } = await seedShare(app);

    await post(app, `/api/shares/${share.id}/revoke`, {});
    const res = await get(app, '/api/shares');

    assert.equal(res.body.shares.length, 1);
    assert.equal(res.body.shares[0].active, false);
    assert.ok(res.body.shares[0].revoked_at);
  });
});

describe('les avis d’amis', () => {
  const avis = (slug, extra = {}) => ({
    slug,
    visitor_id: VISITOR,
    author_name: 'Léo',
    score: 4,
    note: 'Très bonne idée.',
    ...extra,
  });

  test('un visiteur dépose un avis, et le relit sur sa page', async (t) => {
    const { app } = await makeApp(t);
    const { share, dedans } = await seedShare(app);

    const res = await guest(app, 'POST', `/api/share/${share.token}/reviews`, avis(dedans.slug));
    assert.equal(res.status, 201);
    assert.equal(res.body.my_review.author_name, 'Léo');
    assert.equal(res.body.my_review.score, 4);

    const page = await guest(
      app,
      'GET',
      `/api/share/${share.token}/ideas/${dedans.slug}`,
      undefined,
      asVisitor(VISITOR),
    );
    assert.equal(page.body.my_review.note, 'Très bonne idée.');
    assert.equal(page.body.reviews.length, 1);
  });

  test('le même visitor_id corrige son avis au lieu d’en ajouter un', async (t) => {
    const { app } = await makeApp(t);
    const { share, dedans } = await seedShare(app);

    await guest(app, 'POST', `/api/share/${share.token}/reviews`, avis(dedans.slug));
    const corrige = await guest(
      app,
      'POST',
      `/api/share/${share.token}/reviews`,
      avis(dedans.slug, { score: 1, note: 'En fait non.' }),
    );

    assert.equal(corrige.body.reviews.length, 1);
    assert.equal(corrige.body.my_review.score, 1);
    assert.ok(corrige.body.my_review.updated_at, 'un avis corrigé dit qu’il l’a été');

    const recus = await get(app, `/api/ideas/${dedans.slug}/reviews`);
    assert.equal(recus.body.reviews.length, 1);
    assert.equal(recus.body.reviews[0].note, 'En fait non.');
  });

  test('un autre visiteur ne touche pas à l’avis du premier', async (t) => {
    const { app } = await makeApp(t);
    const { share, dedans } = await seedShare(app);

    await guest(app, 'POST', `/api/share/${share.token}/reviews`, avis(dedans.slug));
    await guest(
      app,
      'POST',
      `/api/share/${share.token}/reviews`,
      avis(dedans.slug, { visitor_id: AUTRE, author_name: 'Manon', score: 2 }),
    );

    const recus = await get(app, `/api/ideas/${dedans.slug}/reviews`);
    assert.equal(recus.body.reviews.length, 2);

    const leo = recus.body.reviews.find((review) => review.author_name === 'Léo');
    assert.equal(leo.score, 4, 'l’avis de Léo est resté celui de Léo');
  });

  test('un avis n’écrit ni dans verdicts, ni sur updated_at de l’idée', async (t) => {
    const { app } = await makeApp(t);
    const { share, dedans } = await seedShare(app);

    const avant = (await get(app, `/api/ideas/${dedans.slug}`)).body;

    await guest(app, 'POST', `/api/share/${share.token}/reviews`, avis(dedans.slug));
    await guest(app, 'POST', `/api/share/${share.token}/wishlist`, {
      slug: dedans.slug,
      visitor_id: VISITOR,
      wishlisted: true,
    });

    const apres = (await get(app, `/api/ideas/${dedans.slug}`)).body;

    assert.equal(apres.updated_at, avant.updated_at, 'updated_at n’a pas bougé');
    assert.equal(apres.current_verdict, null, 'aucun verdict n’est né d’un avis');
    assert.equal((await get(app, `/api/ideas/${dedans.slug}/verdicts`)).body.verdicts.length, 0);
    // Et la liste de souhaits de Nathan n'est pas celle de son ami.
    assert.equal(apres.wishlisted_at, null);
    assert.equal(apres.friend_wishlist_count, 1);
  });

  test('reviews_visible masque les avis des autres, jamais le sien', async (t) => {
    const { app } = await makeApp(t);
    const { share, dedans } = await seedShare(app, { reviews_visible: false });

    await guest(app, 'POST', `/api/share/${share.token}/reviews`, avis(dedans.slug));
    await guest(
      app,
      'POST',
      `/api/share/${share.token}/reviews`,
      avis(dedans.slug, { visitor_id: AUTRE, author_name: 'Manon' }),
    );

    const page = await guest(
      app,
      'GET',
      `/api/share/${share.token}/ideas/${dedans.slug}`,
      undefined,
      asVisitor(VISITOR),
    );

    assert.equal(page.body.reviews.length, 1);
    assert.equal(page.body.reviews[0].author_name, 'Léo');
    assert.equal(page.body.my_review.author_name, 'Léo');
  });

  test('le prénom est borné à 40 caractères et le commentaire à 2000', async (t) => {
    const { app } = await makeApp(t);
    const { share, dedans } = await seedShare(app);

    const trop = await guest(
      app,
      'POST',
      `/api/share/${share.token}/reviews`,
      avis(dedans.slug, { author_name: 'x'.repeat(41) }),
    );
    assert.equal(trop.status, 400);

    const long = await guest(
      app,
      'POST',
      `/api/share/${share.token}/reviews`,
      avis(dedans.slug, { note: 'x'.repeat(2001) }),
    );
    assert.equal(long.status, 400);
  });

  test('Nathan supprime un avis, et rien d’autre ne bouge', async (t) => {
    const { app } = await makeApp(t);
    const { share, dedans } = await seedShare(app);

    await guest(app, 'POST', `/api/share/${share.token}/reviews`, avis(dedans.slug));
    const [recu] = (await get(app, `/api/ideas/${dedans.slug}/reviews`)).body.reviews;

    assert.equal((await del(app, `/api/reviews/${recu.id}`)).status, 200);
    assert.equal((await get(app, `/api/ideas/${dedans.slug}/reviews`)).body.reviews.length, 0);
    assert.equal((await get(app, `/api/ideas/${dedans.slug}`)).body.friend_review_count, 0);
  });

  test('le catalogue porte la moyenne des amis et le nombre de souhaits, et sait trier dessus', async (t) => {
    const { app } = await makeApp(t);
    const { share, dedans, encore } = await seedShare(app);

    await guest(app, 'POST', `/api/share/${share.token}/reviews`, avis(dedans.slug, { score: 2 }));
    await guest(
      app,
      'POST',
      `/api/share/${share.token}/reviews`,
      avis(dedans.slug, { visitor_id: AUTRE, score: 4 }),
    );
    await guest(app, 'POST', `/api/share/${share.token}/reviews`, avis(encore.slug, { score: 5 }));
    await guest(app, 'POST', `/api/share/${share.token}/wishlist`, {
      slug: encore.slug,
      visitor_id: VISITOR,
      wishlisted: true,
    });

    const parScore = (await get(app, '/api/ideas?sort=friends-score')).body.ideas;
    assert.equal(parScore[0].slug, encore.slug);
    assert.equal(parScore[0].friend_score_avg, 5);
    assert.equal(parScore[1].friend_score_avg, 3, 'moyenne de 2 et 4');
    assert.equal(parScore[1].friend_review_count, 2);

    const parSouhaits = (await get(app, '/api/ideas?sort=friends-wishlist')).body.ideas;
    assert.equal(parSouhaits[0].slug, encore.slug);
    assert.equal(parSouhaits[0].friend_wishlist_count, 1);
  });
});

describe('la liste de souhaits du visiteur', () => {
  test('elle se bascule dans les deux sens et n’est pas celle de Nathan', async (t) => {
    const { app } = await makeApp(t);
    const { share, dedans } = await seedShare(app);

    const body = { slug: dedans.slug, visitor_id: VISITOR, wishlisted: true };
    assert.equal((await guest(app, 'POST', `/api/share/${share.token}/wishlist`, body)).status, 200);

    const page = await guest(
      app,
      'GET',
      `/api/share/${share.token}/ideas/${dedans.slug}`,
      undefined,
      asVisitor(VISITOR),
    );
    assert.equal(page.body.wishlisted, true);

    // Un autre visiteur n'hérite pas de la case cochée par le premier.
    const autre = await guest(
      app,
      'GET',
      `/api/share/${share.token}/ideas/${dedans.slug}`,
      undefined,
      asVisitor(AUTRE),
    );
    assert.equal(autre.body.wishlisted, false);

    await guest(app, 'POST', `/api/share/${share.token}/wishlist`, { ...body, wishlisted: false });
    const apres = await guest(
      app,
      'GET',
      `/api/share/${share.token}/ideas/${dedans.slug}`,
      undefined,
      asVisitor(VISITOR),
    );
    assert.equal(apres.body.wishlisted, false);
  });

  test('le récapitulatif dit ce que la base sait, pas ce que le navigateur croit', async (t) => {
    const { app } = await makeApp(t);
    const { share, dedans, encore } = await seedShare(app);

    await guest(app, 'POST', `/api/share/${share.token}/reviews`, {
      slug: dedans.slug,
      visitor_id: VISITOR,
      author_name: 'Léo',
      score: 3,
    });
    await guest(app, 'POST', `/api/share/${share.token}/wishlist`, {
      slug: encore.slug,
      visitor_id: VISITOR,
      wishlisted: true,
    });

    const res = await guest(
      app,
      'GET',
      `/api/share/${share.token}`,
      undefined,
      asVisitor(VISITOR),
    );

    assert.equal(res.body.summary.reviews.length, 1);
    assert.equal(res.body.summary.reviews[0].idea_slug, dedans.slug);
    assert.equal(res.body.summary.wishlisted.length, 1);
    assert.equal(res.body.summary.wishlisted[0].idea_slug, encore.slug);
  });
});

describe('la limite de débit', () => {
  test('la 31ᵉ soumission d’une même adresse répond 429 avec un message clair', async (t) => {
    const { app } = await makeApp(t);
    const { share, dedans } = await seedShare(app);

    const body = { slug: dedans.slug, visitor_id: VISITOR, wishlisted: true };

    for (let n = 0; n < 30; n += 1) {
      const res = await guest(app, 'POST', `/api/share/${share.token}/wishlist`, {
        ...body,
        wishlisted: n % 2 === 0,
      });
      assert.equal(res.status, 200, `soumission ${n + 1}`);
    }

    const refuse = await guest(app, 'POST', `/api/share/${share.token}/wishlist`, body);
    assert.equal(refuse.status, 429);
    assert.match(refuse.body.message, /Réessaie/);
    // Aucune pile, aucun nom de fichier, aucune version.
    assert.doesNotMatch(JSON.stringify(refuse.body), /at .+\.js|node_modules/);
  });

  test('un avis refusé pour débit n’est pas enregistré', async (t) => {
    const { app } = await makeApp(t);
    const { share, dedans } = await seedShare(app);

    for (let n = 0; n < 30; n += 1) {
      await guest(app, 'POST', `/api/share/${share.token}/wishlist`, {
        slug: dedans.slug,
        visitor_id: VISITOR,
        wishlisted: n % 2 === 0,
      });
    }

    const refuse = await guest(app, 'POST', `/api/share/${share.token}/reviews`, {
      slug: dedans.slug,
      visitor_id: VISITOR,
      author_name: 'Léo',
      score: 5,
    });

    assert.equal(refuse.status, 429);
    assert.equal((await get(app, `/api/ideas/${dedans.slug}/reviews`)).body.reviews.length, 0);
  });
});

describe('la classification d’une requête', () => {
  const from = (address, headers = {}) => classify({ headers, socket: { remoteAddress: address } });

  test('le tailnet et la machine elle-même sont Nathan', () => {
    assert.equal(from('100.101.102.103'), OWNER);
    assert.equal(from('fd7a:115c:a1e0::1234'), OWNER);
    assert.equal(from('127.0.0.1'), OWNER);
    assert.equal(from('::1'), OWNER);
    assert.equal(from('::ffff:127.0.0.1'), OWNER);
  });

  test('tout le reste est un visiteur', () => {
    assert.equal(from('93.184.216.34'), GUEST);
    assert.equal(from('192.168.1.10'), GUEST, 'le réseau local n’est pas le tailnet');
    // 100.128.x n'est pas dans 100.64.0.0/10 : c'est de l'espace public.
    assert.equal(from('100.128.0.1'), GUEST);
    assert.equal(from(undefined), GUEST);
  });

  test('un en-tête peut fermer une porte, jamais en ouvrir une', () => {
    // Le point d'entrée public abaisse une requête pourtant locale.
    assert.equal(from('127.0.0.1', { 'x-vitrine-public': '1' }), GUEST);
    assert.equal(from('127.0.0.1', { 'tailscale-funnel-request': '?1' }), GUEST);

    // Et rien de ce qu'un visiteur peut écrire ne le fait passer pour Nathan.
    for (const headers of [
      { 'x-forwarded-for': '100.64.0.1' },
      { 'x-real-ip': '127.0.0.1' },
      { 'x-vitrine-public': '0' },
      { 'x-vitrine-owner': '1' },
    ]) {
      assert.equal(from('93.184.216.34', headers), GUEST, JSON.stringify(headers));
    }
  });

  test('la liste blanche ne s’ouvre pas à un chemin qui lui ressemble', () => {
    assert.equal(isGuestAllowed('GET', '/api/share/abc/ideas/x'), true);
    assert.equal(isGuestAllowed('GET', '/api/shares'), false);
    assert.equal(isGuestAllowed('GET', '/api/share/abc/ideas/x/verdicts'), false);
    assert.equal(isGuestAllowed('DELETE', '/api/share/abc/reviews'), false);
    assert.equal(isGuestAllowed('GET', '/files/'), false);
  });
});
