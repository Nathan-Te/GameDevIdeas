import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// `config` lit l'environnement à l'import : il faut le poser avant. Chaque
// fichier de test tourne dans son propre processus, donc rien ne fuit ailleurs.
const dist = mkdtempSync(join(tmpdir(), 'vitrine-dist-'));
process.env.WEB_DIST = dist;
process.env.SERVE_STATIC = 'true';

writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Vitrine</title><div id="root"></div>');

const { buildApp } = await import('../src/app.js');
const { openDatabase } = await import('../src/db.js');

async function makeServingApp(t) {
  const db = openDatabase({ path: ':memory:', migrate: true });
  const app = await buildApp({ db });
  await app.ready();
  t.after(async () => {
    await app.close();
    db.close();
  });
  return app;
}

test.after(() => rmSync(dist, { recursive: true, force: true }));

test('une route front inconnue retombe sur index.html (rechargement de /idees/:slug)', async (t) => {
  const app = await makeServingApp(t);

  const res = await app.inject({ method: 'GET', url: '/idees/roguelike-de-peche' });

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /<div id="root">/);
});

test('le repli SPA ne s’applique jamais sous /api', async (t) => {
  const app = await makeServingApp(t);

  const res = await app.inject({ method: 'GET', url: '/api/inconnue' });

  assert.equal(res.statusCode, 404);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.equal(JSON.parse(res.body).error, 'not_found');
});

test('le repli SPA ne répond pas aux méthodes d’écriture', async (t) => {
  const app = await makeServingApp(t);

  const res = await app.inject({ method: 'POST', url: '/pas-une-route' });

  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error, 'not_found');
});

test('un asset produit après le démarrage est servi depuis le disque', async (t) => {
  const app = await makeServingApp(t);

  // Régression : avec `wildcard: false`, @fastify/static photographie le dossier
  // au démarrage et tout fichier issu d'un build ultérieur renvoyait 404 — donc
  // une page blanche après un `npm run build` serveur déjà lancé.
  writeFileSync(join(dist, 'apres-demarrage.js'), 'export const ok = true;\n');

  const res = await app.inject({ method: 'GET', url: '/apres-demarrage.js' });

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /export const ok/);
});

test('l’API reste servie quand le front statique est actif', async (t) => {
  const app = await makeServingApp(t);

  const res = await app.inject({ method: 'GET', url: '/api/ideas' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ideas: [] });
});
