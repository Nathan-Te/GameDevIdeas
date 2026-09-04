import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * `/files/*` sert les fichiers utilisateur. Ce fichier vérifie surtout ce qu'il
 * ne sert pas : tout ce qui, une fois résolu, sort de `data/files/`.
 *
 * `config` lit l'environnement à l'import, d'où les imports dynamiques. Le
 * dossier des fichiers est un dossier temporaire à part, avec un fichier témoin
 * planté juste au-dessus : si la garde cède, on le verra.
 *
 * Le front statique est activé, avec un `index.html` à nous : c'est la
 * configuration de production, et elle change les réponses (repli SPA). Sans
 * ça, ce fichier se comporterait différemment selon que `npm run build` a été
 * lancé ou non sur le poste.
 */
const root = mkdtempSync(join(tmpdir(), 'vitrine-serve-'));
const filesDir = join(root, 'files');
const dist = join(root, 'dist');
mkdirSync(join(filesDir, '7'), { recursive: true });
mkdirSync(dist, { recursive: true });

process.env.DATA_FILES_DIR = filesDir;
process.env.WEB_DIST = dist;
process.env.SERVE_STATIC = 'true';

const SPA = '<!doctype html><title>Vitrine</title><div id="root"></div>';
writeFileSync(join(dist, 'index.html'), SPA);

writeFileSync(join(filesDir, '7', 'uuid-capsule.png'), 'faux-png');
writeFileSync(join(filesDir, '7', 'uuid-notes.md'), '# Notes\n');
writeFileSync(join(filesDir, '7', 'uuid-build.zip'), 'PK');
// Une « bande-annonce » : c'est elle qui a besoin des requêtes `Range`.
const TRAILER = '0123456789abcdef';
writeFileSync(join(filesDir, '7', 'uuid-teaser.mp4'), TRAILER);
// Hors du dossier servi : aucune requête ne doit pouvoir l'atteindre.
writeFileSync(join(root, 'secret.txt'), 'mot de passe');

const { makeApp } = await import('./helpers.js');

test.after(() => rmSync(root, { recursive: true, force: true }));

test('un fichier attaché est servi, avec un cache long et sans reniflage de type', async (t) => {
  const { app } = await makeApp(t);

  const res = await app.inject({ method: 'GET', url: '/files/7/uuid-capsule.png' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'faux-png');
  assert.match(res.headers['content-type'], /image\/png/);
  // Les noms portent un UUID : un chemin ne désigne jamais deux contenus.
  assert.match(res.headers['cache-control'], /immutable/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.match(res.headers['content-disposition'], /^inline/);
});

test('un markdown est servi en texte, un type inconnu part en téléchargement', async (t) => {
  const { app } = await makeApp(t);

  const markdown = await app.inject({ method: 'GET', url: '/files/7/uuid-notes.md' });
  assert.equal(markdown.statusCode, 200);
  assert.match(markdown.headers['content-type'], /text\/markdown/);

  // Servis depuis l'origine de l'application : tout ce qui n'est pas
  // explicitement sûr est téléchargé plutôt qu'interprété par le navigateur.
  const zip = await app.inject({ method: 'GET', url: '/files/7/uuid-build.zip' });
  assert.equal(zip.statusCode, 200);
  assert.match(zip.headers['content-type'], /application\/octet-stream/);
  assert.match(zip.headers['content-disposition'], /^attachment/);
});

test('un fichier absent renvoie un 404 JSON, jamais le repli SPA', async (t) => {
  const { app } = await makeApp(t);

  // Le repli SPA est actif sur ce serveur : sans la route `/files/*`, une
  // capsule supprimée renverrait `index.html` et le `<img>` afficherait du HTML.
  const res = await app.inject({ method: 'GET', url: '/files/7/pas-la.png' });

  assert.equal(res.statusCode, 404);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(JSON.parse(res.body).error, 'not_found');
});

test('la traversée de chemin est refusée sous toutes ses écritures', async (t) => {
  const { app } = await makeApp(t);

  const attempts = [
    // `..` en clair, que le routeur normalise souvent avant nous.
    '/files/../secret.txt',
    '/files/7/../../secret.txt',
    // Encodages simples et doubles de `..`
    '/files/%2e%2e/secret.txt',
    '/files/%2E%2E/%2E%2E/secret.txt',
    '/files/%252e%252e/secret.txt',
    '/files/..%2fsecret.txt',
    '/files/7%2f..%2f..%2fsecret.txt',
    // Séparateur Windows
    '/files/..%5csecret.txt',
    // Chemin absolu
    '/files//etc/passwd',
    '/files/C:%5CWindows%5Cwin.ini',
    // Octet nul
    '/files/7/uuid-capsule.png%00.txt',
  ];

  for (const url of attempts) {
    const res = await app.inject({ method: 'GET', url });

    assert.ok(!res.body.includes('mot de passe'), `${url} a laissé fuir le fichier voisin`);

    // Deux issues acceptables, et une seule inacceptable : servir le fichier.
    // Soit `/files/*` prononce son 404, soit le routeur a normalisé l'adresse
    // avant d'arriver jusqu'à elle et c'est le repli SPA qui répond.
    assert.ok(
      res.statusCode === 404 || res.body === SPA,
      `${url} a répondu ${res.statusCode} avec un corps inattendu`,
    );
  }
});

test('le serveur de développement proxifie `/files` autant que `/api`', async () => {
  // Régression : le proxy Vite ne couvrait que `/api`. En développement, une
  // image attachée et un markdown recevaient donc l'`index.html` de Vite —
  // image cassée, et la page d'accueil affichée dans la carte markdown. Le bug
  // n'existait qu'à partir de `localhost:5173`, invisible en production où
  // Fastify sert les deux ; d'où ce test, qui lit la configuration elle-même.
  const config = readFileSync(
    fileURLToPath(new URL('../../web/vite.config.ts', import.meta.url)),
    'utf8',
  );

  const proxied = [...config.matchAll(/'(\/[a-z]+)':\s*\{\s*target/g)].map((m) => m[1]);

  assert.deepEqual(
    proxied.sort(),
    ['/api', '/files'],
    'toute route servie par Fastify doit être proxifiée par Vite',
  );
});

test('un dossier ne se liste pas', async (t) => {
  const { app } = await makeApp(t);

  for (const url of ['/files/7', '/files/7/']) {
    const res = await app.inject({ method: 'GET', url });
    assert.ok(res.statusCode === 404 || res.body === SPA, `${url} -> ${res.statusCode}`);
    assert.ok(!res.body.includes('uuid-capsule'), 'aucun listing de dossier');
  }
});

test('une vidéo est servie en `inline`, avec les plages annoncées', async (t) => {
  const { app } = await makeApp(t);

  const res = await app.inject({ method: 'GET', url: '/files/7/uuid-teaser.mp4' });

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /video\/mp4/);
  assert.match(res.headers['content-disposition'], /^inline/);
  // Sans cet en-tête, beaucoup de lecteurs refusent de se déplacer dans le flux
  // — et certains refusent même de démarrer.
  assert.equal(res.headers['accept-ranges'], 'bytes');
  assert.equal(res.body, TRAILER);
});

test('une requête `Range` renvoie 206 et le morceau demandé', async (t) => {
  const { app } = await makeApp(t);

  const middle = await app.inject({
    method: 'GET',
    url: '/files/7/uuid-teaser.mp4',
    headers: { range: 'bytes=4-7' },
  });

  assert.equal(middle.statusCode, 206);
  assert.equal(middle.headers['content-range'], `bytes 4-7/${TRAILER.length}`);
  assert.equal(middle.headers['content-length'], '4');
  assert.equal(middle.body, '4567');

  // `bytes=8-` : jusqu'au bout. C'est ce que demande un lecteur qui reprend.
  const tail = await app.inject({
    method: 'GET',
    url: '/files/7/uuid-teaser.mp4',
    headers: { range: 'bytes=8-' },
  });
  assert.equal(tail.statusCode, 206);
  assert.equal(tail.headers['content-range'], `bytes 8-15/${TRAILER.length}`);
  assert.equal(tail.body, '89abcdef');

  // `bytes=-4` : les quatre derniers octets.
  const last = await app.inject({
    method: 'GET',
    url: '/files/7/uuid-teaser.mp4',
    headers: { range: 'bytes=-4' },
  });
  assert.equal(last.statusCode, 206);
  assert.equal(last.body, 'cdef');
});

test('une plage hors du fichier renvoie 416 et annonce la vraie taille', async (t) => {
  const { app } = await makeApp(t);

  const res = await app.inject({
    method: 'GET',
    url: '/files/7/uuid-teaser.mp4',
    headers: { range: 'bytes=999-1200' },
  });

  assert.equal(res.statusCode, 416);
  assert.equal(res.headers['content-range'], `bytes */${TRAILER.length}`);
  assert.equal(res.body, '');
});

test('un `Range` illisible est ignoré : le fichier part en entier', async (t) => {
  const { app } = await makeApp(t);

  for (const range of ['octets=0-3', 'bytes=abc', 'bytes=', '']) {
    const res = await app.inject({
      method: 'GET',
      url: '/files/7/uuid-teaser.mp4',
      headers: { range },
    });
    assert.equal(res.statusCode, 200, `« ${range} » aurait dû être ignoré`);
    assert.equal(res.body, TRAILER);
  }
});

test('un fichier téléchargé ne promet pas de plages qu’il ne sert pas', async (t) => {
  const { app } = await makeApp(t);

  const zip = await app.inject({
    method: 'GET',
    url: '/files/7/uuid-build.zip',
    headers: { range: 'bytes=0-0' },
  });

  assert.equal(zip.headers['accept-ranges'], 'none');
  assert.equal(zip.statusCode, 200, 'le `Range` est ignoré, pas honoré à moitié');
});
