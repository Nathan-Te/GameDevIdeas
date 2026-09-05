import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

/**
 * `/files/*` est la seule route ouverte aux invités qui serve autre chose
 * qu'une sélection. Elle doit donc trancher fichier par fichier, et non route
 * par route : une capture d'une idée partagée s'affiche, la même capture d'une
 * idée gardée pour soi n'existe pas.
 *
 * `config` lit l'environnement à l'import, d'où le dossier posé avant les
 * imports dynamiques — même procédé que `files.test.js`.
 */
const root = mkdtempSync(join(tmpdir(), 'vitrine-partage-files-'));
const filesDir = join(root, 'files');
mkdirSync(filesDir, { recursive: true });
process.env.DATA_FILES_DIR = filesDir;

const { makeServed, guest, post, seedIdea, get } = await import('./helpers.js');

test.after(() => rmSync(root, { recursive: true, force: true }));

/** Pose un fichier sur le disque et sa ligne en base, comme le ferait un envoi. */
function attach(db, ideaId, name) {
  const relative = `${ideaId}/uuid-${name}`;
  mkdirSync(join(filesDir, String(ideaId)), { recursive: true });
  writeFileSync(join(filesDir, ...relative.split('/')), `contenu de ${name}`);
  db.prepare(
    "INSERT INTO attachments (idea_id, kind, label, path, size_bytes) VALUES (?, 'image', ?, ?, 10)",
  ).run(ideaId, name, relative);
  return relative;
}

test('un invité voit les fichiers de la sélection, pas les autres', async (t) => {
  const served = await makeServed(t);
  const { app, db } = served;

  const dedans = await seedIdea(app, { title: 'Dedans' });
  const dehors = await seedIdea(app, { title: 'Dehors' });
  const visible = attach(db, dedans.id, 'capture.png');
  const cachee = attach(db, dehors.id, 'capture.png');

  await post(app, '/api/shares', { label: 'Les copains', idea_slugs: [dedans.slug] });

  // Nathan voit les deux.
  assert.equal((await get(app, `/files/${visible}`)).status, 200);
  assert.equal((await get(app, `/files/${cachee}`)).status, 200);

  // L'invité ne voit que celui de la sélection, et l'autre n'existe pas pour lui.
  assert.equal((await guest(served, 'GET', `/files/${visible}`)).status, 200);

  const refuse = await guest(served, 'GET', `/files/${cachee}`);
  assert.equal(refuse.status, 404);
  assert.equal(refuse.body.message, 'Fichier introuvable.');
});

test('révoquer la sélection referme ses fichiers', async (t) => {
  const served = await makeServed(t);
  const { app, db } = served;

  const idea = await seedIdea(app, { title: 'Dedans' });
  const relative = attach(db, idea.id, 'capture.png');
  const share = (await post(app, '/api/shares', { idea_slugs: [idea.slug] })).body;

  assert.equal((await guest(served, 'GET', `/files/${relative}`)).status, 200);

  await post(app, `/api/shares/${share.id}/revoke`, {});

  assert.equal((await guest(served, 'GET', `/files/${relative}`)).status, 404);
  // Nathan, lui, n'a rien perdu.
  assert.equal((await get(app, `/files/${relative}`)).status, 200);
});

test('un fichier sans ligne en base n’est servi à aucun invité', async (t) => {
  const served = await makeServed(t);
  const { app, db } = served;

  const idea = await seedIdea(app, { title: 'Dedans' });
  attach(db, idea.id, 'capture.png');
  await post(app, '/api/shares', { idea_slugs: [idea.slug] });

  // Un orphelin déposé dans le dossier d'une idée pourtant partagée : le droit
  // se lit sur la ligne `attachments`, jamais sur l'emplacement du fichier.
  const orphelin = `${idea.id}/uuid-orphelin.png`;
  writeFileSync(join(filesDir, ...orphelin.split('/')), 'oublié là');

  assert.equal((await get(app, `/files/${orphelin}`)).status, 200);
  assert.equal((await guest(served, 'GET', `/files/${orphelin}`)).status, 404);
});
