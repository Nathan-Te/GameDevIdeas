import assert from 'node:assert/strict';
import test from 'node:test';

import { del, get, makeApp, post, seedIdea } from './helpers.js';

test('POST /api/ideas/:slug/verdicts ajoute un verdict daté', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Idée à juger' });

  const res = await post(app, `/api/ideas/${idea.slug}/verdicts`, { score: 3, note: 'Correct.' });

  assert.equal(res.status, 201);
  assert.equal(res.body.idea_id, idea.id);
  assert.equal(res.body.score, 3);
  assert.equal(res.body.note, 'Correct.');
  assert.ok(res.body.created_at);
});

test('un verdict sans note est accepté ; un score hors 0-5 est refusé', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Bornes du score' });

  assert.equal((await post(app, `/api/ideas/${idea.slug}/verdicts`, { score: 0 })).status, 201);
  assert.equal((await post(app, `/api/ideas/${idea.slug}/verdicts`, { score: 5 })).status, 201);

  for (const score of [-1, 6, 2.5, '3']) {
    const res = await post(app, `/api/ideas/${idea.slug}/verdicts`, { score });
    assert.equal(res.status, 400, `score ${score} devrait être refusé`);
    assert.equal(res.body.error, 'validation_error');
  }

  const missing = await post(app, `/api/ideas/${idea.slug}/verdicts`, { note: 'sans score' });
  assert.equal(missing.status, 400);
});

test('l’historique va du plus récent au plus ancien et n’écrase rien', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Idée relue' });

  await post(app, `/api/ideas/${idea.slug}/verdicts`, { score: 1, note: 'premier' });
  await post(app, `/api/ideas/${idea.slug}/verdicts`, { score: 3, note: 'deuxième' });
  await post(app, `/api/ideas/${idea.slug}/verdicts`, { score: 2, note: 'troisième' });

  const res = await get(app, `/api/ideas/${idea.slug}/verdicts`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.verdicts.map((v) => v.note), ['troisième', 'deuxième', 'premier']);

  // Le verdict courant est le dernier posé, même s'il n'est pas le meilleur score.
  const current = await get(app, `/api/ideas/${idea.slug}`);
  assert.equal(current.body.current_verdict.note, 'troisième');
  assert.equal(current.body.current_verdict.score, 2);
});

test('les verdicts d’une idée inconnue ou supprimée renvoient 404 JSON', async (t) => {
  const { app } = await makeApp(t);

  const unknown = await get(app, '/api/ideas/fantome/verdicts');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'not_found');

  const posted = await post(app, '/api/ideas/fantome/verdicts', { score: 3 });
  assert.equal(posted.status, 404);

  const idea = await seedIdea(app, { title: 'Bientôt supprimée' });
  await del(app, `/api/ideas/${idea.slug}`);
  assert.equal((await get(app, `/api/ideas/${idea.slug}/verdicts`)).status, 404);
});

test('les verdicts sont propres à chaque idée', async (t) => {
  const { app } = await makeApp(t);
  const a = await seedIdea(app, { title: 'Idée A' });
  const b = await seedIdea(app, { title: 'Idée B' });

  await post(app, `/api/ideas/${a.slug}/verdicts`, { score: 5, note: 'pour A' });

  assert.equal((await get(app, `/api/ideas/${b.slug}/verdicts`)).body.verdicts.length, 0);
  assert.equal((await get(app, `/api/ideas/${b.slug}`)).body.current_verdict, null);
  assert.equal((await get(app, `/api/ideas/${a.slug}/verdicts`)).body.verdicts.length, 1);
});
