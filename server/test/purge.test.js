import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

/**
 * `DELETE /api/ideas/:slug/purge` — la suppression définitive de la corbeille.
 *
 * Règle du projet posée par ce lot : une purge supprime la base puis le dossier
 * de l'idée ; jamais de purge partielle. C'est ce que ce fichier vérifie, y
 * compris dans le cas laid où l'effacement disque échoue après coup.
 *
 * `config` lit l'environnement à l'import : le dossier des fichiers est posé
 * avant, et les imports sont dynamiques.
 */
const root = mkdtempSync(join(tmpdir(), 'vitrine-purge-'));
process.env.DATA_FILES_DIR = root;
process.env.MAX_UPLOAD_MB = '1';
process.env.LINK_TITLE_LOOKUP = 'false';

const { call, del, get, makeApp, post, seedIdea } = await import('./helpers.js');

test.after(() => rmSync(root, { recursive: true, force: true }));

const CRLF = '\r\n';
const PNG = Buffer.from('89504e470d0a1a0a', 'hex').toString('binary');

/** Corps multipart construit à la main, comme dans `attachments.test.js`. */
async function uploadOne(app, slug, { filename, type = 'application/octet-stream', content }) {
  const boundary = '----vitrine-purge';
  const body = Buffer.from(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
      `Content-Type: ${type}${CRLF}${CRLF}${content}${CRLF}--${boundary}--${CRLF}`,
    'binary',
  );

  const response = await app.inject({
    method: 'POST',
    url: `/api/ideas/${slug}/attachments`,
    payload: body,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });

  assert.equal(response.statusCode, 201, response.body);
  return JSON.parse(response.body).attachments[0];
}

/** Une idée en corbeille, avec un verdict, une image capsule et un lien. */
async function trashedIdea(app, title) {
  const idea = await seedIdea(app, { title });

  await post(app, `/api/ideas/${idea.slug}/verdicts`, { score: 4, note: 'à garder' });
  await post(app, `/api/ideas/${idea.slug}/verdicts`, { score: 2, note: 'finalement non' });

  const image = await uploadOne(app, idea.slug, {
    filename: 'capsule.png',
    type: 'image/png',
    content: PNG,
  });
  await uploadOne(app, idea.slug, { filename: 'notes.md', content: '# Notes\n' });
  await post(app, `/api/ideas/${idea.slug}/attachments`, { url: 'https://trello.com/b/x' });
  await call(app, 'PATCH', `/api/ideas/${idea.slug}`, { capsule_file_id: image.id });

  await del(app, `/api/ideas/${idea.slug}`);

  return idea;
}

test('purger une idée de la corbeille efface la base et le dossier de fichiers', async (t) => {
  const { app, db } = await makeApp(t);
  const idea = await trashedIdea(app, 'À jeter');

  const directory = join(root, String(idea.id));
  assert.ok(existsSync(directory), 'le dossier existe avant la purge');
  assert.equal(readdirSync(directory).length, 2, 'deux fichiers, le lien n’en est pas un');

  const res = await del(app, `/api/ideas/${idea.slug}/purge`);

  assert.equal(res.status, 200);
  assert.equal(res.body.purged.slug, idea.slug);
  assert.equal(res.body.files_removed, 2, 'les deux fichiers sont comptés, pas le lien');
  assert.equal(res.body.orphan_directory, false);

  // La base : plus rien, nulle part.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ideas WHERE id = ?').get(idea.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM verdicts WHERE idea_id = ?').get(idea.id).n, 0);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE idea_id = ?').get(idea.id).n,
    0,
  );

  // Le disque : le dossier entier, pas seulement les fichiers connus.
  assert.equal(existsSync(directory), false, 'le dossier de l’idée a disparu');

  // Et l'idée n'est plus servie, ni vivante ni en corbeille.
  assert.equal((await get(app, `/api/ideas/${idea.slug}`)).status, 404);
  const corbeille = await get(app, '/api/ideas?deleted=true');
  assert.deepEqual(corbeille.body.ideas, []);
});

test('purger une idée vivante ou inconnue est un 404', async (t) => {
  const { app, db } = await makeApp(t);
  const vivante = await seedIdea(app, { title: 'Bien vivante' });

  const surVivante = await del(app, `/api/ideas/${vivante.slug}/purge`);
  assert.equal(surVivante.status, 404);
  assert.equal(surVivante.body.error, 'not_found');

  const inconnue = await del(app, '/api/ideas/jamais-existe/purge');
  assert.equal(inconnue.status, 404);

  // Le refus n'a rien touché.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ideas').get().n, 1);
  assert.equal((await get(app, `/api/ideas/${vivante.slug}`)).status, 200);
});

test('purger deux fois : la seconde ne trouve plus rien', async (t) => {
  const { app } = await makeApp(t);
  const idea = await trashedIdea(app, 'Deux fois');

  assert.equal((await del(app, `/api/ideas/${idea.slug}/purge`)).status, 200);
  assert.equal((await del(app, `/api/ideas/${idea.slug}/purge`)).status, 404);
});

test('purger n’emporte que l’idée visée', async (t) => {
  const { app, db } = await makeApp(t);
  const cible = await trashedIdea(app, 'La cible');
  const voisine = await trashedIdea(app, 'La voisine');

  await del(app, `/api/ideas/${cible.slug}/purge`);

  assert.equal(existsSync(join(root, String(voisine.id))), true, 'le dossier voisin est intact');
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE idea_id = ?').get(voisine.id).n,
    3,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM verdicts WHERE idea_id = ?').get(voisine.id).n,
    2,
  );
});

test('si l’effacement disque échoue, la base reste cohérente et l’orphelin est signalé', async (t) => {
  const { app, db } = await makeApp(t);
  const idea = await trashedIdea(app, 'Disque récalcitrant');
  const directory = join(root, String(idea.id));

  // Un dossier parent sans droit d'écriture : `rm` ne peut plus retirer
  // l'entrée. Selon la plate-forme et l'utilisateur (Windows, root), les droits
  // peuvent être ignorés — l'assertion sur l'orphelin suit donc ce qui s'est
  // réellement passé, tandis que la cohérence de la base est exigée dans tous
  // les cas. C'est elle qui compte : un dossier orphelin se rattrape à la main.
  chmodSync(root, 0o500);
  t.after(() => chmodSync(root, 0o700));

  const res = await del(app, `/api/ideas/${idea.slug}/purge`);

  assert.equal(res.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ideas WHERE id = ?').get(idea.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM verdicts WHERE idea_id = ?').get(idea.id).n, 0);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE idea_id = ?').get(idea.id).n,
    0,
    'aucune ligne à moitié supprimée',
  );

  chmodSync(root, 0o700);

  // Le dossier a survécu ? Alors la réponse doit le dire. Il a disparu ? Alors
  // l'environnement ignore les droits, et il n'y avait pas d'orphelin à signaler.
  assert.equal(
    res.body.orphan_directory,
    existsSync(directory),
    'le dossier orphelin est signalé exactement quand il existe encore',
  );
});

test('le compteur de pièces jointes est servi avec l’idée', async (t) => {
  const { app } = await makeApp(t);
  const idea = await trashedIdea(app, 'Comptée');

  const corbeille = await get(app, '/api/ideas?deleted=true');
  const [listed] = corbeille.body.ideas;

  // Deux fichiers et un lien : c'est ce que la confirmation de purge annonce.
  assert.equal(listed.attachment_count, 3);
  assert.ok(listed.deleted_at, 'la date de suppression est servie');
  assert.equal(listed.slug, idea.slug);
});
