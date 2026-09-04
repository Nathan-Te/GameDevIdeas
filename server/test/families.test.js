import assert from 'node:assert/strict';
import test from 'node:test';

import { SEED_FAMILIES } from '../../shared/store-model.js';
import { seedFamilies } from '../src/families-repo.js';

import { del, get, makeApp, patch, post, seedIdea } from './helpers.js';

/**
 * Les familles sont des données depuis le lot 4. Ce fichier vérifie les deux
 * choses qui feraient perdre du sens à une idée : une famille supprimée sous
 * les pieds d'une idée qui la porte, et un renommage de slug qui laisserait les
 * idées pointer dans le vide.
 */

test('le seed peuple la table au premier démarrage, et une seule fois', async (t) => {
  const { app, db } = await makeApp(t);

  const res = await get(app, '/api/families');
  assert.equal(res.status, 200);
  assert.equal(res.body.families.length, SEED_FAMILIES.length);
  assert.deepEqual(
    res.body.families.map((family) => family.slug),
    SEED_FAMILIES.map((family) => family.slug),
    'les familles sortent dans l’ordre du seed',
  );

  const first = res.body.families[0];
  assert.deepEqual(first.store_tags, SEED_FAMILIES[0].store_tags);
  assert.deepEqual(first.features, SEED_FAMILIES[0].features);
  assert.equal(first.idea_count, 0);

  // Idempotent : rejouer le seed sur une table peuplée ne doit rien ajouter.
  assert.equal(seedFamilies(db), 0);
  assert.equal(seedFamilies(db), 0);

  const again = await get(app, '/api/families');
  assert.equal(again.body.families.length, SEED_FAMILIES.length);
});

test('une table vidée à la main se repeuple, une table entamée non', async (t) => {
  const { app, db } = await makeApp(t);

  db.prepare('DELETE FROM families').run();
  assert.equal(seedFamilies(db), SEED_FAMILIES.length);

  // Une seule famille suffit à considérer la table comme celle de Nathan : le
  // seed ne doit jamais ressusciter ce qu'il a supprimé.
  db.prepare('DELETE FROM families WHERE slug <> ?').run('autre');
  assert.equal(seedFamilies(db), 0);

  const res = await get(app, '/api/families');
  assert.deepEqual(
    res.body.families.map((family) => family.slug),
    ['autre'],
  );
});

test('POST /api/families crée une famille, slug déduit du libellé', async (t) => {
  const { app } = await makeApp(t);

  const res = await post(app, '/api/families', {
    label: 'Récit à embranchements',
    store_tags: ['Narration', 'Choix multiples'],
    features: ['solo'],
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.slug, 'recit-a-embranchements');
  assert.deepEqual(res.body.store_tags, ['Narration', 'Choix multiples']);
  assert.deepEqual(res.body.features, ['solo']);
  assert.equal(res.body.position, SEED_FAMILIES.length, 'une famille neuve se pose en fin de liste');
});

test('les étiquettes sont nettoyées et dédoublonnées, les fonctionnalités validées', async (t) => {
  const { app } = await makeApp(t);

  const created = await post(app, '/api/families', {
    label: 'Bac à sable',
    store_tags: ['  Bac à sable ', 'Bac à sable', 'Simulation'],
  });
  assert.deepEqual(created.body.store_tags, ['Bac à sable', 'Simulation']);

  // La liste des fonctionnalités est fermée : le schéma la refuse à l'entrée,
  // et le dépôt refait le tri pour les appels qui ne passent pas par la route.
  const bad = await post(app, '/api/families', { label: 'VR', features: ['realite-virtuelle'] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'validation_error');
});

test('PATCH /api/families/:slug modifie libellé, étiquettes et fonctionnalités', async (t) => {
  const { app } = await makeApp(t);

  const res = await patch(app, '/api/families/fps', {
    label: 'Tir à la première personne',
    store_tags: ['FPS', 'Action'],
    features: ['multiplayer', 'local-coop'],
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.label, 'Tir à la première personne');
  assert.deepEqual(res.body.store_tags, ['FPS', 'Action']);
  assert.deepEqual(res.body.features, ['multiplayer', 'local-coop']);
  assert.equal(res.body.slug, 'fps', 'le slug ne bouge pas tout seul');
});

test('renommer le slug d’une famille suit les idées qui la portent', async (t) => {
  const { app } = await makeApp(t);

  const idea = await seedIdea(app, { title: 'Doom du dimanche', family: 'fps' });
  const other = await seedIdea(app, { title: 'Inspection', family: 'inspection' });

  const renamed = await patch(app, '/api/families/fps', { slug: 'tir-subjectif' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.slug, 'tir-subjectif');

  const reloaded = await get(app, `/api/ideas/${idea.slug}`);
  assert.equal(reloaded.body.family, 'tir-subjectif', 'l’idée a suivi le renommage');

  const untouched = await get(app, `/api/ideas/${other.slug}`);
  assert.equal(untouched.body.family, 'inspection', 'les autres familles n’ont pas bougé');

  // Et le filtre du catalogue répond sur le nouveau slug, plus sur l'ancien.
  const filtered = await get(app, '/api/ideas?family=tir-subjectif');
  assert.deepEqual(
    filtered.body.ideas.map((item) => item.slug),
    [idea.slug],
  );
  assert.equal((await get(app, '/api/ideas?family=fps')).body.ideas.length, 0);
});

test('un slug de famille déjà pris est suffixé plutôt que refusé', async (t) => {
  const { app } = await makeApp(t);

  const created = await post(app, '/api/families', { label: 'FPS' });
  assert.equal(created.body.slug, 'fps-2');

  const renamed = await patch(app, `/api/families/${created.body.slug}`, { slug: 'inspection' });
  assert.equal(renamed.body.slug, 'inspection-2');
});

test('PATCH position réordonne la liste entière, sans trou ni doublon', async (t) => {
  const { app } = await makeApp(t);

  const before = (await get(app, '/api/families')).body.families.map((family) => family.slug);

  const moved = await patch(app, '/api/families/autre', { position: 0 });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.position, 0);

  const after = (await get(app, '/api/families')).body.families;
  assert.deepEqual(
    after.map((family) => family.position),
    after.map((_, index) => index),
    'les positions restent 0..n-1',
  );
  assert.deepEqual(
    after.map((family) => family.slug),
    ['autre', ...before.filter((slug) => slug !== 'autre')],
  );

  // Une position au-delà de la liste se borne à la fin, elle ne troue rien.
  await patch(app, '/api/families/autre', { position: 999 });
  const last = (await get(app, '/api/families')).body.families;
  assert.equal(last[last.length - 1].slug, 'autre');
});

test('DELETE refuse une famille utilisée, et dit par combien d’idées', async (t) => {
  const { app } = await makeApp(t);

  await seedIdea(app, { title: 'Un', family: 'tactique' });
  await seedIdea(app, { title: 'Deux', family: 'tactique' });

  const refused = await del(app, '/api/families/tactique');
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'conflict');
  assert.match(refused.body.message, /2 idées/, 'le message annonce le nombre d’idées');

  const list = await get(app, '/api/families');
  const tactique = list.body.families.find((family) => family.slug === 'tactique');
  assert.equal(tactique.idea_count, 2, 'la liste annonce le compte avant même la tentative');
});

test('une idée en corbeille bloque encore la suppression de sa famille', async (t) => {
  const { app } = await makeApp(t);

  const idea = await seedIdea(app, { title: 'Bientôt jetée', family: 'party' });
  await del(app, `/api/ideas/${idea.slug}`);

  const refused = await del(app, '/api/families/party');
  assert.equal(refused.status, 409, 'une idée restaurée ne doit pas ressortir sans famille');
});

test('DELETE supprime une famille inutilisée, et 404 sur une famille inconnue', async (t) => {
  const { app } = await makeApp(t);

  const removed = await del(app, '/api/families/party');
  assert.equal(removed.status, 200);
  assert.equal(removed.body.slug, 'party');

  const gone = await get(app, '/api/families');
  assert.ok(!gone.body.families.some((family) => family.slug === 'party'));

  assert.equal((await del(app, '/api/families/party')).status, 404);
  assert.equal((await patch(app, '/api/families/party', { label: 'X' })).status, 404);
});

test('une idée ne peut pas porter une famille qui n’existe pas', async (t) => {
  const { app } = await makeApp(t);

  const created = await post(app, '/api/ideas', { family: 'jamais-vue' });
  assert.equal(created.status, 400);
  assert.equal(created.body.error, 'bad_request');

  const idea = await seedIdea(app, { title: 'Valide' });
  const patched = await patch(app, `/api/ideas/${idea.slug}`, { family: 'jamais-vue' });
  assert.equal(patched.status, 400);

  // Une famille créée après coup devient utilisable sans redémarrer.
  await post(app, '/api/families', { slug: 'jamais-vue', label: 'Jamais vue' });
  assert.equal((await patch(app, `/api/ideas/${idea.slug}`, { family: 'jamais-vue' })).status, 200);
});
