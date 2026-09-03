import assert from 'node:assert/strict';
import test from 'node:test';

import { del, get, makeApp, patch, post, seedIdea } from './helpers.js';

test('POST /api/ideas crée une idée avec les valeurs par défaut du seed', async (t) => {
  const { app } = await makeApp(t);

  const res = await post(app, '/api/ideas', {});

  assert.equal(res.status, 201);
  assert.equal(res.body.title, 'Sans titre');
  assert.equal(res.body.slug, 'sans-titre');
  assert.equal(res.body.family, 'autre');
  assert.equal(res.body.status, 'idee');
  assert.equal(res.body.price_cents, null);
  assert.equal(res.body.capsule_file_id, null);
  assert.equal(res.body.deleted_at, null);
  assert.equal(res.body.current_verdict, null);
  assert.ok(res.body.created_at, 'created_at renseigné');
});

test('POST /api/ideas dérive le slug du titre et le rend unique', async (t) => {
  const { app } = await makeApp(t);

  const first = await seedIdea(app, { title: 'Roguelike de pêche' });
  const second = await seedIdea(app, { title: 'Roguelike de pêche' });
  const third = await seedIdea(app, { title: 'Roguelike de pêche !' });

  assert.equal(first.slug, 'roguelike-de-peche');
  assert.equal(second.slug, 'roguelike-de-peche-2');
  assert.equal(third.slug, 'roguelike-de-peche-3');
});

test('POST /api/ideas rejette une famille ou un statut hors énumération', async (t) => {
  const { app } = await makeApp(t);

  const badFamily = await post(app, '/api/ideas', { family: 'roguelite' });
  assert.equal(badFamily.status, 400);
  assert.equal(badFamily.body.error, 'validation_error');
  assert.ok(badFamily.body.message, 'un message lisible accompagne l’erreur');

  const badStatus = await post(app, '/api/ideas', { status: 'terminé' });
  assert.equal(badStatus.status, 400);

  const unknownField = await post(app, '/api/ideas', { titre: 'faute de frappe' });
  assert.equal(unknownField.status, 400);
});

test('GET /api/ideas/:slug renvoie l’idée, 404 JSON sinon', async (t) => {
  const { app } = await makeApp(t);
  const created = await seedIdea(app, { title: 'Inspecteur des douanes', family: 'inspection' });

  const found = await get(app, `/api/ideas/${created.slug}`);
  assert.equal(found.status, 200);
  assert.equal(found.body.id, created.id);
  assert.equal(found.body.family, 'inspection');

  const missing = await get(app, '/api/ideas/nexiste-pas');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'not_found');
  assert.match(missing.headers['content-type'], /application\/json/);
});

test('PATCH /api/ideas/:slug met à jour champ par champ sans toucher au reste', async (t) => {
  const { app } = await makeApp(t);
  const created = await seedIdea(app, {
    title: 'Simulateur de brocante',
    tagline: 'Chiner, revendre, recommencer',
    pitch: 'Un pitch initial.',
    family: 'sim-fantasme',
  });

  const res = await patch(app, `/api/ideas/${created.slug}`, { pitch: 'Un pitch retravaillé.' });

  assert.equal(res.status, 200);
  assert.equal(res.body.pitch, 'Un pitch retravaillé.');
  assert.equal(res.body.tagline, 'Chiner, revendre, recommencer', 'tagline intacte');
  assert.equal(res.body.title, 'Simulateur de brocante', 'titre intact');
  assert.equal(res.body.family, 'sim-fantasme', 'famille intacte');
  assert.notEqual(res.body.updated_at, null);
});

test('PATCH accepte price_cents à null et un patch vide est refusé', async (t) => {
  const { app } = await makeApp(t);
  const created = await seedIdea(app, { title: 'Jeu payant', price_cents: 1999 });
  assert.equal(created.price_cents, 1999);

  const cleared = await patch(app, `/api/ideas/${created.slug}`, { price_cents: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.price_cents, null);

  const empty = await patch(app, `/api/ideas/${created.slug}`, {});
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, 'validation_error');
});

test('PATCH du titre resynchronise le slug tant qu’il n’a pas été personnalisé', async (t) => {
  const { app } = await makeApp(t);
  const created = await seedIdea(app, {});
  assert.equal(created.slug, 'sans-titre');

  const renamed = await patch(app, `/api/ideas/${created.slug}`, { title: 'Tactique au tour par tour' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.slug, 'tactique-au-tour-par-tour');

  // L'ancienne URL ne répond plus, la nouvelle oui.
  assert.equal((await get(app, '/api/ideas/sans-titre')).status, 404);
  assert.equal((await get(app, '/api/ideas/tactique-au-tour-par-tour')).status, 200);
});

test('PATCH du slug le fige : le titre ne le change plus', async (t) => {
  const { app } = await makeApp(t);
  const created = await seedIdea(app, { title: 'Premier titre' });

  const pinned = await patch(app, `/api/ideas/${created.slug}`, { slug: 'mon-url-a-moi' });
  assert.equal(pinned.body.slug, 'mon-url-a-moi');

  const renamed = await patch(app, '/api/ideas/mon-url-a-moi', { title: 'Titre tout neuf' });
  assert.equal(renamed.body.slug, 'mon-url-a-moi', 'slug personnalisé conservé');
  assert.equal(renamed.body.title, 'Titre tout neuf');
});

test('PATCH d’un slug déjà pris suffixe un numéro au lieu d’échouer', async (t) => {
  const { app } = await makeApp(t);
  await seedIdea(app, { title: 'Occupé' });
  const other = await seedIdea(app, { title: 'Libre' });

  const res = await patch(app, `/api/ideas/${other.slug}`, { slug: 'occupe' });
  assert.equal(res.status, 200);
  assert.equal(res.body.slug, 'occupe-2');
});

test('DELETE /api/ideas/:slug fait un soft delete et retire l’idée du catalogue', async (t) => {
  const { app, db } = await makeApp(t);
  const created = await seedIdea(app, { title: 'Idée abandonnée' });

  const deleted = await del(app, `/api/ideas/${created.slug}`);
  assert.equal(deleted.status, 200);
  assert.ok(deleted.body.deleted_at, 'deleted_at renseigné');

  assert.equal((await get(app, `/api/ideas/${created.slug}`)).status, 404);
  assert.equal((await get(app, '/api/ideas')).body.ideas.length, 0);

  // La ligne est toujours là : `POST .../restore` la ramène.
  const row = db.prepare('SELECT id, deleted_at FROM ideas WHERE id = ?').get(created.id);
  assert.ok(row, 'la ligne survit en base');
  assert.ok(row.deleted_at);

  assert.equal((await del(app, `/api/ideas/${created.slug}`)).status, 404);
});

test('POST /api/ideas/:slug/restore ramène une idée de la corbeille', async (t) => {
  const { app } = await makeApp(t);
  const created = await seedIdea(app, { title: 'Idée regrettée', family: 'tactique' });

  await del(app, `/api/ideas/${created.slug}`);
  assert.equal((await get(app, `/api/ideas/${created.slug}`)).status, 404);

  const restored = await post(app, `/api/ideas/${created.slug}/restore`, undefined);

  assert.equal(restored.status, 200);
  assert.equal(restored.body.id, created.id);
  assert.equal(restored.body.deleted_at, null);
  // Rien d'autre n'a bougé : la corbeille n'est pas une remise à zéro.
  assert.equal(restored.body.title, 'Idée regrettée');
  assert.equal(restored.body.family, 'tactique');

  assert.equal((await get(app, `/api/ideas/${created.slug}`)).status, 200);
  assert.equal((await get(app, '/api/ideas')).body.ideas.length, 1);
});

test('restaurer une idée vivante ou inconnue renvoie 404 JSON', async (t) => {
  const { app } = await makeApp(t);
  const created = await seedIdea(app, { title: 'Bien vivante' });

  const alive = await post(app, `/api/ideas/${created.slug}/restore`, undefined);
  assert.equal(alive.status, 404);
  assert.equal(alive.body.error, 'not_found');

  const unknown = await post(app, '/api/ideas/nexiste-pas/restore', undefined);
  assert.equal(unknown.status, 404);

  // Restaurer deux fois de suite : la seconde n'a plus rien à restaurer.
  await del(app, `/api/ideas/${created.slug}`);
  assert.equal((await post(app, `/api/ideas/${created.slug}/restore`, undefined)).status, 200);
  assert.equal((await post(app, `/api/ideas/${created.slug}/restore`, undefined)).status, 404);
});

test('GET /api/ideas filtre par famille, statut et score minimum', async (t) => {
  const { app } = await makeApp(t);

  const a = await seedIdea(app, { title: 'Party sympa', family: 'party', status: 'prototype' });
  const b = await seedIdea(app, { title: 'FPS nerveux', family: 'fps', status: 'prototype' });
  const c = await seedIdea(app, { title: 'Party en pause', family: 'party', status: 'pause' });

  await post(app, `/api/ideas/${a.slug}/verdicts`, { score: 4 });
  await post(app, `/api/ideas/${b.slug}/verdicts`, { score: 5 });
  await post(app, `/api/ideas/${c.slug}/verdicts`, { score: 1 });

  const byFamily = await get(app, '/api/ideas?family=party');
  assert.deepEqual(byFamily.body.ideas.map((i) => i.slug).sort(), [a.slug, c.slug].sort());

  const byStatus = await get(app, '/api/ideas?status=prototype');
  assert.deepEqual(byStatus.body.ideas.map((i) => i.slug).sort(), [a.slug, b.slug].sort());

  const byScore = await get(app, '/api/ideas?minScore=4');
  assert.deepEqual(byScore.body.ideas.map((i) => i.slug).sort(), [a.slug, b.slug].sort());

  const combined = await get(app, '/api/ideas?family=party&minScore=4');
  assert.deepEqual(combined.body.ideas.map((i) => i.slug), [a.slug]);

  const bogus = await get(app, '/api/ideas?minScore=9');
  assert.equal(bogus.status, 400);
  assert.equal(bogus.body.error, 'validation_error');
});

test('GET /api/ideas : minScore écarte les idées jamais jugées', async (t) => {
  const { app } = await makeApp(t);
  const judged = await seedIdea(app, { title: 'Jugée' });
  await seedIdea(app, { title: 'Jamais jugée' });
  await post(app, `/api/ideas/${judged.slug}/verdicts`, { score: 0 });

  const res = await get(app, '/api/ideas?minScore=0');
  assert.deepEqual(res.body.ideas.map((i) => i.slug), [judged.slug]);
});

test('GET /api/ideas trie par titre, par score puis par mise à jour', async (t) => {
  const { app } = await makeApp(t);

  const bas = await seedIdea(app, { title: 'Charlie' });
  const haut = await seedIdea(app, { title: 'alpha' });
  const sans = await seedIdea(app, { title: 'Bravo' });

  await post(app, `/api/ideas/${bas.slug}/verdicts`, { score: 2 });
  await post(app, `/api/ideas/${haut.slug}/verdicts`, { score: 5 });

  const byTitle = await get(app, '/api/ideas?sort=title');
  assert.deepEqual(byTitle.body.ideas.map((i) => i.title), ['alpha', 'Bravo', 'Charlie']);

  const byScore = await get(app, '/api/ideas?sort=score');
  assert.deepEqual(byScore.body.ideas.map((i) => i.slug), [haut.slug, bas.slug, sans.slug]);

  // Une mise à jour remonte l'idée en tête du tri par défaut.
  await patch(app, `/api/ideas/${sans.slug}`, { tagline: 'touchée en dernier' });
  const byUpdated = await get(app, '/api/ideas');
  assert.equal(byUpdated.body.ideas[0].slug, sans.slug);

  const badSort = await get(app, '/api/ideas?sort=aleatoire');
  assert.equal(badSort.status, 400);
});

test('GET /api/ideas joint le verdict courant à chaque idée', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Idée jugée deux fois' });

  await post(app, `/api/ideas/${idea.slug}/verdicts`, { score: 1, note: 'ancien avis' });
  await post(app, `/api/ideas/${idea.slug}/verdicts`, { score: 4, note: 'avis récent' });

  const list = await get(app, '/api/ideas');
  assert.equal(list.body.ideas.length, 1);
  assert.equal(list.body.ideas[0].current_verdict.score, 4);
  assert.equal(list.body.ideas[0].current_verdict.note, 'avis récent');

  const single = await get(app, `/api/ideas/${idea.slug}`);
  assert.equal(single.body.current_verdict.score, 4);
});

test('une route inconnue sous /api renvoie du JSON, pas du HTML', async (t) => {
  const { app } = await makeApp(t);

  const res = await get(app, '/api/inconnue');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not_found');
  assert.match(res.headers['content-type'], /application\/json/);
});
