import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as tar from 'tar';

import { buildApp } from '../src/app.js';
import { extractArchive, sha256, walkFiles } from '../src/backup.js';
import { config } from '../src/config.js';
import { createDbHandle } from '../src/db-handle.js';
import { openDatabase } from '../src/db.js';

/**
 * Les tests de sauvegarde ne peuvent pas se contenter d'une base en mémoire :
 * une restauration remplace un fichier de base et un dossier de fichiers. Ils
 * travaillent donc sur une instance complète, posée dans un dossier temporaire.
 *
 * `config` est un objet ordinaire, lu à chaque appel par le code : on le
 * détourne le temps du test et on le remet ensuite. C'est ce qui permet aux
 * routes de viser l'instance du test sans qu'aucune d'elles ait à recevoir un
 * chemin en paramètre.
 */
export function makeInstance(t) {
  const root = mkdtempSync(join(tmpdir(), 'vitrine-test-'));
  const paths = {
    root,
    dbPath: join(root, 'db', 'vitrine.db'),
    filesDir: join(root, 'files'),
    backupsDir: join(root, 'backups'),
  };

  mkdirSync(join(root, 'db'), { recursive: true });
  mkdirSync(paths.filesDir, { recursive: true });
  mkdirSync(paths.backupsDir, { recursive: true });

  const saved = {
    dbPath: config.dbPath,
    filesDir: config.filesDir,
    backupsDir: config.backupsDir,
  };
  Object.assign(config, paths);

  const db = createDbHandle(openDatabase({ path: paths.dbPath }));

  t.after(() => {
    try {
      db.close();
    } catch {
      /* déjà fermée par une restauration */
    }
    Object.assign(config, saved);
    rmSync(root, { recursive: true, force: true });
  });

  return { ...paths, db };
}

/** L'instance ci-dessus, servie par une application Fastify. */
export async function makeBackupApp(t) {
  const instance = makeInstance(t);
  const app = await buildApp({ db: instance.db });
  await app.ready();
  t.after(() => app.close());
  return { ...instance, app };
}

/** Une idée, ses fichiers et un verdict — de quoi peser dans une archive. */
export function seedContent(db, filesDir, { slug = 'roguelike-de-peche', files = 2 } = {}) {
  const ideaId = Number(
    db
      .prepare("INSERT INTO ideas (slug, title, family) VALUES (?, ?, 'autre')")
      .run(slug, slug).lastInsertRowid,
  );

  db.prepare('INSERT INTO verdicts (idea_id, score, note) VALUES (?, 4, ?)').run(ideaId, 'bien');

  mkdirSync(join(filesDir, String(ideaId)), { recursive: true });
  for (let i = 0; i < files; i += 1) {
    const relative = `${ideaId}/capture-${i}.png`;
    writeFileSync(join(filesDir, ...relative.split('/')), `contenu ${slug} ${i}`);
    db.prepare(
      "INSERT INTO attachments (idea_id, kind, label, path, size_bytes) VALUES (?, 'image', ?, ?, 10)",
    ).run(ideaId, `capture ${i}`, relative);
  }

  return ideaId;
}

/** Empreinte d'une instance : ce qu'un aller-retour doit laisser identique. */
export async function fingerprint({ db, filesDir }) {
  const files = await walkFiles(filesDir);
  const hashes = {};
  for (const relative of files) hashes[relative] = await sha256(join(filesDir, ...relative.split('/')));

  return {
    ideas: db.prepare('SELECT slug, title, family FROM ideas ORDER BY slug').all(),
    verdicts: db.prepare('SELECT score, note FROM verdicts ORDER BY id').all(),
    attachments: db.prepare('SELECT kind, label, path FROM attachments ORDER BY path').all(),
    families: db.prepare('SELECT slug, label FROM families ORDER BY slug').all(),
    hashes,
  };
}

/** Extrait une archive dans un dossier neuf, pour l'inspecter ou l'abîmer. */
export async function unpack(t, archivePath) {
  const dir = mkdtempSync(join(tmpdir(), 'vitrine-unpack-'));
  // Best effort : sous Windows, un fichier encore ouvert par un test refuse de
  // partir, et ce n'est pas ce que le test cherche à prouver.
  t.after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* dossier temporaire : le système s'en occupera */
    }
  });
  await extractArchive(archivePath, dir);
  return dir;
}

/**
 * Reconstruit une archive à partir d'un dossier extrait. `rehash` recalcule les
 * hachages du manifeste : sans lui, l'archive garde ceux d'avant, ce qui est
 * exactement ce qu'on veut pour éprouver la détection d'altération.
 */
export async function repack(dir, out, { rehash = false } = {}) {
  if (rehash) {
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const hashes = { 'vitrine.db': await sha256(join(dir, 'vitrine.db')) };
    for (const relative of await walkFiles(join(dir, 'files'))) {
      hashes[`files/${relative}`] = await sha256(join(dir, 'files', ...relative.split('/')));
    }
    manifest.hashes = hashes;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }

  // Seules les entrées encore présentes : un test qui supprime le manifeste
  // veut une archive sans manifeste, pas une erreur de `tar`.
  const entries = ['manifest.json', 'vitrine.db', 'files'].filter((entry) =>
    existsSync(join(dir, entry)),
  );

  await tar.create({ gzip: true, file: out, cwd: dir, portable: true }, entries);
  return out;
}

/** Le contenu d'une archive, tel que `tar tzf` le montrerait. */
export async function listEntries(archivePath) {
  const entries = [];
  await tar.list({ file: archivePath, onReadEntry: (entry) => entries.push(entry.path) });
  return entries;
}

/**
 * Un corps multipart minimal. `app.inject` ne sait pas fabriquer de multipart,
 * et une dépendance de plus pour trois lignes de frontière serait mal placée.
 */
export function multipartBody({ file, filename = 'archive.tgz', fields = {} }) {
  const boundary = '----vitrinetest0123456789';
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="${filename}"\r\n` +
        'Content-Type: application/gzip\r\n\r\n',
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );

  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
