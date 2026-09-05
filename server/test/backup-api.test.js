import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { backupLock, createArchive } from '../src/backup.js';

import { makeBackupApp, multipartBody, seedContent } from './backup-helpers.js';

/** Les routes de sauvegarde. Le cœur est testé à part (`backup.test.js`). */

const call = async (app, method, url, options = {}) => {
  const response = await app.inject({ method, url, ...options });
  let body = null;
  if (response.body) {
    try {
      body = JSON.parse(response.body);
    } catch {
      body = response.body;
    }
  }
  return { status: response.statusCode, body, headers: response.headers, raw: response.rawPayload };
};

describe('GET /api/backup/preview', () => {
  test('annonce le contenu sans rien produire', async (t) => {
    const { app, db, filesDir, backupsDir } = await makeBackupApp(t);
    seedContent(db, filesDir, { files: 2 });

    const res = await call(app, 'GET', '/api/backup/preview');

    assert.equal(res.status, 200);
    assert.equal(res.body.counts.ideas, 1);
    assert.equal(res.body.files.count, 2);
    assert.ok(res.body.estimated_bytes > 0);
    assert.deepEqual(await readdir(backupsDir), []);
  });
});

describe('POST /api/backup', () => {
  test('renvoie une archive téléchargeable et efface son temporaire', async (t) => {
    const { app, db, filesDir } = await makeBackupApp(t);
    seedContent(db, filesDir);

    const before = (await readdir(tmpdir())).filter((n) => n.startsWith('vitrine-download-'));
    const res = await call(app, 'POST', '/api/backup');

    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/gzip');
    assert.match(res.headers['content-disposition'], /attachment; filename="vitrine-.*\.tgz"/);
    assert.equal(Number(res.headers['content-length']), res.raw.length);
    // Signature gzip : l'archive est bien un .tgz, pas un message d'erreur.
    assert.equal(res.raw[0], 0x1f);
    assert.equal(res.raw[1], 0x8b);

    // Le temporaire part quand le flux se ferme, donc juste après la réponse :
    // on lui laisse le temps d'un tour de boucle plutôt que de parier dessus.
    const leftovers = async () =>
      (await readdir(tmpdir())).filter((n) => n.startsWith('vitrine-download-') && !before.includes(n));

    for (let i = 0; i < 100 && (await leftovers()).length; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.deepEqual(await leftovers(), []);

    // Le verrou est rendu : une seconde sauvegarde passe.
    assert.equal((await call(app, 'POST', '/api/backup')).status, 200);
  });
});

describe('POST /api/restore', () => {
  /** Une archive prête à être envoyée, produite depuis une autre instance. */
  async function archiveFrom(t, { slug, files = 1 } = {}) {
    const source = await makeBackupApp(t);
    seedContent(source.db, source.filesDir, { slug, files });
    const archive = await createArchive({
      db: source.db,
      filesDir: source.filesDir,
      backupsDir: source.backupsDir,
      outDir: join(source.root, 'out'),
    });
    return readFileSync(archive.path);
  }

  test('remplace l’état courant et pose une sauvegarde de sécurité', async (t) => {
    const file = await archiveFrom(t, { slug: 'venue-d-ailleurs', files: 2 });

    const target = await makeBackupApp(t);
    seedContent(target.db, target.filesDir, { slug: 'locale', files: 1 });

    const res = await call(target.app, 'POST', '/api/restore', multipartBody({ file }));

    assert.equal(res.status, 200);
    assert.equal(res.body.mode, 'replace');
    assert.equal(res.body.before.ideas, 1);
    assert.equal(res.body.after.ideas, 1);
    assert.equal(res.body.after.files, 2);

    const slugs = (await call(target.app, 'GET', '/api/ideas')).body.ideas.map((i) => i.slug);
    assert.deepEqual(slugs, ['venue-d-ailleurs']);

    // La sauvegarde de sécurité est listée par l'API.
    const backups = (await call(target.app, 'GET', '/api/backups')).body.backups;
    assert.equal(backups.length, 1);
    assert.equal(backups[0].name, res.body.safety_backup);
    assert.ok(backups[0].bytes > 0);
  });

  test('le mode merge ajoute sans rien supprimer', async (t) => {
    const file = await archiveFrom(t, { slug: 'venue-d-ailleurs' });

    const target = await makeBackupApp(t);
    seedContent(target.db, target.filesDir, { slug: 'locale' });

    const res = await call(
      target.app,
      'POST',
      '/api/restore',
      multipartBody({ file, fields: { mode: 'merge' } }),
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.mode, 'merge');
    assert.equal(res.body.merged.ideas, 1);

    const slugs = (await call(target.app, 'GET', '/api/ideas')).body.ideas
      .map((i) => i.slug)
      .sort();
    assert.deepEqual(slugs, ['locale', 'venue-d-ailleurs']);
  });

  test('un mode inconnu est refusé', async (t) => {
    const file = await archiveFrom(t);
    const target = await makeBackupApp(t);

    const res = await call(
      target.app,
      'POST',
      '/api/restore',
      multipartBody({ file, fields: { mode: 'ecraser-tout' } }),
    );

    assert.equal(res.status, 400);
    assert.match(res.body.message, /Mode de restauration inconnu/);
  });

  test('sans multipart, la route dit ce qu’elle attend', async (t) => {
    const { app } = await makeBackupApp(t);
    const res = await call(app, 'POST', '/api/restore', { payload: { mode: 'replace' } });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /multipart/);
  });
});

describe('verrou', () => {
  test('une sauvegarde pendant une restauration est refusée, et l’inverse', async (t) => {
    const { app } = await makeBackupApp(t);

    const release = backupLock.acquire('restore');
    t.after(() => release());

    const backup = await call(app, 'POST', '/api/backup');
    assert.equal(backup.status, 409);
    assert.match(backup.body.message, /restauration est en cours/);

    const restore = await call(
      app,
      'POST',
      '/api/restore',
      multipartBody({ file: Buffer.from('peu importe') }),
    );
    assert.equal(restore.status, 409);

    release();
    assert.equal((await call(app, 'POST', '/api/backup')).status, 200);
  });
});

describe('archives locales', () => {
  test('liste et suppression', async (t) => {
    const { app, db, filesDir, backupsDir } = await makeBackupApp(t);
    seedContent(db, filesDir);
    const archive = await createArchive({ db, filesDir, backupsDir, outDir: backupsDir });

    const list = await call(app, 'GET', '/api/backups');
    assert.equal(list.body.backups.length, 1);
    assert.equal(list.body.backups[0].name, archive.name);

    const removed = await call(app, 'DELETE', `/api/backups/${archive.name}`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.name, archive.name);
    assert.deepEqual((await call(app, 'GET', '/api/backups')).body.backups, []);

    // Une archive déjà partie : 404, pas 500.
    assert.equal((await call(app, 'DELETE', `/api/backups/${archive.name}`)).status, 404);
  });

  test('un nom ne peut pas sortir du dossier des sauvegardes', async (t) => {
    const { app, root, backupsDir } = await makeBackupApp(t);

    // Un fichier hors du dossier, cible d'une traversée réussie.
    const outside = join(root, 'secret.tgz');
    writeFileSync(outside, 'à ne pas supprimer');

    for (const name of ['..%2Fsecret.tgz', '%2e%2e%2fsecret.tgz', 'sous%2Fsecret.tgz']) {
      const res = await call(app, 'DELETE', `/api/backups/${name}`);
      assert.ok(res.status === 400 || res.status === 404, `${name} -> ${res.status}`);
    }

    assert.equal(readFileSync(outside, 'utf8'), 'à ne pas supprimer');
    assert.deepEqual(await readdir(backupsDir), []);
  });
});
