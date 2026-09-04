import assert from 'node:assert/strict';
import test from 'node:test';

import { get, makeApp, patch, seedIdea } from './helpers.js';

/**
 * La liste de souhaits est le seul geste actif de la vue store : c'est le
 * réflexe que l'application veut capturer, donc il doit survivre au
 * rechargement et se retrouver dans le catalogue sans second appel.
 */

test('une idée neuve n’est pas en liste de souhaits', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Jeu de plomberie' });

  assert.equal(idea.wishlisted_at, null);
});

test('PATCH wishlisted bascule dans un sens puis dans l’autre', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Jeu de plomberie' });

  const added = await patch(app, `/api/ideas/${idea.slug}`, { wishlisted: true });
  assert.equal(added.status, 200);
  assert.ok(added.body.wishlisted_at, 'wishlisted_at doit porter une date');

  const removed = await patch(app, `/api/ideas/${idea.slug}`, { wishlisted: false });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.wishlisted_at, null);
});

test('l’état persiste et se relit sur GET', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Jeu de plomberie' });

  await patch(app, `/api/ideas/${idea.slug}`, { wishlisted: true });
  const reloaded = await get(app, `/api/ideas/${idea.slug}`);

  assert.equal(reloaded.status, 200);
  assert.ok(reloaded.body.wishlisted_at);
});

test('le catalogue sert wishlisted_at sur chaque idée', async (t) => {
  const { app } = await makeApp(t);
  const wanted = await seedIdea(app, { title: 'Voulue' });
  await seedIdea(app, { title: 'Pas voulue' });
  await patch(app, `/api/ideas/${wanted.slug}`, { wishlisted: true });

  const { body } = await get(app, '/api/ideas');
  const bySlug = Object.fromEntries(body.ideas.map((idea) => [idea.slug, idea]));

  assert.ok(bySlug.voulue.wishlisted_at);
  assert.equal(bySlug['pas-voulue'].wishlisted_at, null);
});

test('le filtre wishlisted découpe le catalogue dans les deux sens', async (t) => {
  const { app } = await makeApp(t);
  const wanted = await seedIdea(app, { title: 'Voulue' });
  await seedIdea(app, { title: 'Pas voulue' });
  await patch(app, `/api/ideas/${wanted.slug}`, { wishlisted: true });

  const only = await get(app, '/api/ideas?wishlisted=true');
  assert.deepEqual(
    only.body.ideas.map((idea) => idea.slug),
    ['voulue'],
  );

  const rest = await get(app, '/api/ideas?wishlisted=false');
  assert.deepEqual(
    rest.body.ideas.map((idea) => idea.slug),
    ['pas-voulue'],
  );

  const all = await get(app, '/api/ideas');
  assert.equal(all.body.ideas.length, 2);
});

/**
 * Mettre en liste de souhaits n'est pas modifier la fiche : sans ce garde-fou,
 * le catalogue trié par mise à jour se réordonnerait à chaque clic sur le
 * bouton de la vue store.
 */
test('un patch qui ne porte que wishlisted ne touche pas updated_at', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Voulue' });

  const { body } = await patch(app, `/api/ideas/${idea.slug}`, { wishlisted: true });
  assert.equal(body.updated_at, idea.updated_at);

  const edited = await patch(app, `/api/ideas/${idea.slug}`, { tagline: 'Une accroche' });
  assert.notEqual(edited.body.updated_at, idea.updated_at);
});

test('wishlisted refuse autre chose qu’un booléen', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Voulue' });

  const { status } = await patch(app, `/api/ideas/${idea.slug}`, { wishlisted: 'oui merci' });
  assert.equal(status, 400);
});

test('GET /api/config sert le nom du développeur', async (t) => {
  const { app } = await makeApp(t);
  const { status, body } = await get(app, '/api/config');

  assert.equal(status, 200);
  assert.equal(typeof body.developer_name, 'string');
  assert.ok(body.developer_name.length > 0);
});
