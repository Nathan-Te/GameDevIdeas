import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

import * as tar from 'tar';

import { config } from './config.js';
import { openDatabase } from './db.js';
import { badRequest, conflict, HttpError, notFound } from './errors.js';
import { seedFamilies } from './families-repo.js';
import { listMigrations, runMigrations } from './migrate.js';
import { slugify } from './slug.js';

/**
 * Sauvegarde et restauration — le cœur, partagé mot pour mot par les routes
 * HTTP (`routes/backup.js`) et les scripts en ligne de commande. Rien ici ne
 * connaît Fastify : les deux appelants passent une poignée de base, des chemins
 * et un mode, et reçoivent des objets.
 *
 * Deux règles tiennent tout le fichier :
 *
 * 1. **La base ne se copie jamais en tant que fichier.** Elle est en WAL : le
 *    fichier `.db` sur le disque n'est pas à jour tant que le journal n'est pas
 *    replié, et le copier à chaud donne une base tronquée ou corrompue. Toute
 *    lecture passe par `db.backup()`, l'API de sauvegarde en ligne de SQLite,
 *    qui produit une image cohérente pendant que les écritures continuent.
 * 2. **Une restauration produit toujours une sauvegarde de sécurité** avant de
 *    toucher quoi que ce soit. Elle est posée dans `data/backups/` et sert de
 *    marche arrière automatique si la bascule échoue en cours de route.
 */

/** Version du format d'archive. Une archive d'un autre numéro est refusée. */
export const ARCHIVE_FORMAT = 1;

const MANIFEST = 'manifest.json';
const DB_ENTRY = 'vitrine.db';
const FILES_ENTRY = 'files';

// --- Verrou ------------------------------------------------------------------

/**
 * Un verrou en mémoire, et un seul : une sauvegarde et une restauration ne
 * peuvent pas se croiser. La sauvegarde lirait une base à moitié remplacée, la
 * restauration écraserait une base en cours de copie.
 *
 * En mémoire du processus, donc valable pour le serveur seul. Les scripts CLI
 * ont leur propre processus : lancer une restauration en ligne de commande
 * pendant que le serveur en fait une n'est pas empêché par ce verrou — c'est
 * assumé pour une application mono-utilisateur, et documenté dans le README.
 */
function createLock() {
  let held = null;

  return {
    get current() {
      return held;
    },

    /** Prend le verrou ou lève un 409 nommant l'opération en cours. */
    acquire(kind) {
      if (held) {
        throw conflict(
          held === kind
            ? `Une ${label(kind)} est déjà en cours.`
            : `Une ${label(held)} est en cours : impossible de lancer une ${label(kind)}.`,
        );
      }
      held = kind;
      return () => {
        if (held === kind) held = null;
      };
    },
  };
}

const label = (kind) => (kind === 'restore' ? 'restauration' : 'sauvegarde');

export const backupLock = createLock();

// --- Outils de disque --------------------------------------------------------

/** Un dossier de travail jetable, toujours effacé par son appelant. */
export const makeWorkDir = (prefix) => mkdtemp(join(tmpdir(), `vitrine-${prefix}-`));

export const removeQuietly = (path) => rm(path, { recursive: true, force: true }).catch(() => {});

/**
 * Liste récursive des fichiers d'un dossier, en chemins relatifs à barres
 * obliques — c'est la forme utilisée en base, dans le manifeste et dans le tar,
 * y compris quand Vitrine tourne sous Windows.
 */
export async function walkFiles(root, { skip = [] } = {}) {
  const skipped = skip.filter(Boolean).map((p) => resolve(p));
  const out = [];

  async function visit(absolute, relative) {
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      return; // dossier absent : une instance neuve n'a pas encore de fichiers
    }

    for (const entry of entries) {
      const child = join(absolute, entry.name);
      if (skipped.some((s) => child === s || child.startsWith(s + sep))) continue;

      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(child, childRelative);
      else if (entry.isFile()) out.push(childRelative);
    }
  }

  await visit(resolve(root), '');
  return out.sort();
}

export function sha256(path) {
  return new Promise((ok, ko) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', ko)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => ok(hash.digest('hex')));
  });
}

/** Copie un fichier en créant son dossier. Utilisée fichier par fichier. */
async function copyFile(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await pipeline(createReadStream(from), createWriteStream(to));
}

async function copyTree(from, to, { skip = [] } = {}) {
  const files = await walkFiles(from, { skip });
  for (const relative of files) {
    await copyFile(join(from, ...relative.split('/')), join(to, ...relative.split('/')));
  }
  return files;
}

// --- Inventaire --------------------------------------------------------------

const countOf = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

/** La dernière migration appliquée : la version de schéma de la base. */
export function schemaVersion(db) {
  const row = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
    .get();
  return row?.version ?? null;
}

/**
 * Ce que contiendrait l'archive, sans rien produire. La taille annoncée est
 * celle des données avant compression : annoncer une taille compressée
 * demanderait de compresser, donc de faire l'archive.
 */
export async function backupPreview({ db, filesDir = config.filesDir, backupsDir = config.backupsDir } = {}) {
  const files = await walkFiles(filesDir, { skip: [backupsDir] });

  let totalBytes = 0;
  for (const relative of files) {
    const info = await stat(join(filesDir, ...relative.split('/'))).catch(() => null);
    if (info) totalBytes += info.size;
  }

  const databaseBytes = db.prepare('SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()').get().bytes;

  return {
    format: ARCHIVE_FORMAT,
    schema_version: schemaVersion(db),
    counts: {
      ideas: countOf(db, 'ideas'),
      verdicts: countOf(db, 'verdicts'),
      attachments: countOf(db, 'attachments'),
      families: countOf(db, 'families'),
    },
    files: { count: files.length, total_bytes: totalBytes },
    database_bytes: databaseBytes,
    /** Avant compression : le vrai poids du `.tgz` sera plus bas. */
    estimated_bytes: totalBytes + databaseBytes,
  };
}

// --- Sauvegarde --------------------------------------------------------------

/** `vitrine-2026-09-05-1430.tgz`, en heure locale : c'est celle que Nathan lit. */
export function archiveName(date = new Date(), prefix = 'vitrine') {
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix}-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.tgz`;
}

/** Deux sauvegardes dans la même minute ne doivent pas s'écraser. */
async function freeName(dir, name) {
  const base = name.replace(/\.tgz$/, '');
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? name : `${base}-${n}.tgz`;
    const taken = await stat(join(dir, candidate)).then(() => true, () => false);
    if (!taken) return candidate;
  }
  throw new Error(`impossible de nommer une archive dans ${dir}`);
}

/**
 * Produit l'archive et renvoie où elle est. Le dossier de travail est effacé
 * dans tous les cas ; l'archive, elle, appartient à l'appelant.
 */
export async function createArchive({
  db,
  filesDir = config.filesDir,
  backupsDir = config.backupsDir,
  outDir,
  name,
  date = new Date(),
  prefix = 'vitrine',
} = {}) {
  const work = await makeWorkDir('backup');

  try {
    // 1. La base, par l'API de sauvegarde en ligne — jamais une copie du fichier.
    const dbCopy = join(work, DB_ENTRY);
    await db.backup(dbCopy);

    // 2. Les fichiers utilisateur, en excluant le dossier des sauvegardes.
    // Le dossier est créé même vide : une archive a toujours ses trois entrées,
    // ce qui évite à la restauration d'avoir à traiter le cas « pas de files/ ».
    await mkdir(join(work, FILES_ENTRY), { recursive: true });
    const files = await copyTree(filesDir, join(work, FILES_ENTRY), { skip: [backupsDir] });

    // 3. Le manifeste, hachages compris.
    const hashes = { [DB_ENTRY]: await sha256(dbCopy) };
    let totalBytes = 0;
    for (const relative of files) {
      const absolute = join(work, FILES_ENTRY, ...relative.split('/'));
      hashes[`${FILES_ENTRY}/${relative}`] = await sha256(absolute);
      totalBytes += (await stat(absolute)).size;
    }

    const manifest = {
      format: ARCHIVE_FORMAT,
      created_at: date.toISOString(),
      schema_version: schemaVersion(db),
      counts: {
        ideas: countOf(db, 'ideas'),
        verdicts: countOf(db, 'verdicts'),
        attachments: countOf(db, 'attachments'),
        families: countOf(db, 'families'),
      },
      files: { count: files.length, total_bytes: totalBytes },
      hashes,
    };
    await writeFile(join(work, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    // 4. Le tar. `portable` retire l'uid/gid et les dates de création : deux
    //    sauvegardes du même état donnent alors le même contenu.
    await mkdir(outDir, { recursive: true });
    const finalName = await freeName(outDir, name ?? archiveName(date, prefix));
    const path = join(outDir, finalName);

    await tar.create(
      { gzip: true, file: path, cwd: work, portable: true },
      [MANIFEST, DB_ENTRY, FILES_ENTRY],
    );

    const { size } = await stat(path);
    return { path, name: finalName, manifest, bytes: size };
  } finally {
    await removeQuietly(work);
  }
}

// --- Archives locales --------------------------------------------------------

/** Nom d'archive acceptable : pas de séparateur, pas de `..`, extension connue. */
export function safeBackupName(name) {
  const raw = String(name ?? '');
  if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('\0')) return null;
  if (raw === '.' || raw === '..' || raw.startsWith('.')) return null;
  if (!raw.endsWith('.tgz')) return null;
  return raw;
}

export async function listLocalBackups(dir = config.backupsDir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const backups = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.tgz')) continue;
    const info = await stat(join(dir, entry.name)).catch(() => null);
    if (!info) continue;
    backups.push({ name: entry.name, bytes: info.size, created_at: info.mtime.toISOString() });
  }

  // Du plus récent au plus ancien : c'est l'ordre dans lequel on les regarde.
  return backups.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function deleteLocalBackup(name, dir = config.backupsDir) {
  const safe = safeBackupName(name);
  if (!safe) throw notFound('Sauvegarde introuvable.');

  const path = join(resolve(dir), safe);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw notFound('Sauvegarde introuvable.');

  await rm(path, { force: true });
  return { name: safe, bytes: info.size };
}

/** Garde les `keep` archives les plus récentes ; renvoie les noms supprimés. */
export async function rotateBackups(dir = config.backupsDir, keep = config.backupKeep) {
  if (!Number.isFinite(keep) || keep <= 0) return [];

  const backups = await listLocalBackups(dir);
  const doomed = backups.slice(keep);
  for (const backup of doomed) await rm(join(dir, backup.name), { force: true });
  return doomed.map((b) => b.name);
}

// --- Lecture d'une archive ---------------------------------------------------

/**
 * Extrait une archive dans un dossier neuf. Le filtre est la garde contre la
 * traversée de chemin : `tar` refuse déjà les chemins absolus, on refuse en
 * plus tout segment `..` et tout ce qui n'est pas une entrée attendue.
 */
export async function extractArchive(archivePath, into) {
  await mkdir(into, { recursive: true });

  try {
    await tar.extract({
      file: archivePath,
      cwd: into,
      filter: (entryPath) => {
        const parts = entryPath.split(/[\\/]/);
        if (parts.some((part) => part === '..')) return false;
        return parts[0] === MANIFEST || parts[0] === DB_ENTRY || parts[0] === FILES_ENTRY;
      },
    });
  } catch (err) {
    throw badRequest(`Archive illisible : ${err.message}`);
  }
}

/**
 * Lit et vérifie le manifeste. Tout écart interrompt ici, avant que quoi que ce
 * soit n'ait été touché : format inconnu, base absente, fichier annoncé
 * manquant, hachage qui ne correspond pas.
 */
export async function readAndVerifyManifest(dir) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(dir, MANIFEST), 'utf8'));
  } catch {
    throw badRequest("Archive invalide : `manifest.json` absent ou illisible.");
  }

  if (manifest?.format !== ARCHIVE_FORMAT) {
    throw badRequest(
      `Archive invalide : format « ${manifest?.format ?? '?'} », attendu ${ARCHIVE_FORMAT}.`,
    );
  }

  const hashes = manifest.hashes;
  if (!hashes || typeof hashes !== 'object' || !hashes[DB_ENTRY]) {
    throw badRequest('Archive invalide : le manifeste ne déclare pas la base.');
  }

  for (const [relative, expected] of Object.entries(hashes)) {
    if (relative.split(/[\\/]/).includes('..')) {
      throw badRequest(`Archive invalide : chemin refusé « ${relative} ».`);
    }

    const absolute = join(dir, ...relative.split('/'));
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile()) throw badRequest(`Archive incomplète : « ${relative} » manque.`);

    const actual = await sha256(absolute);
    if (actual !== expected) {
      throw badRequest(`Archive altérée : le hachage de « ${relative} » ne correspond pas.`);
    }
  }

  return manifest;
}

/**
 * Prépare la base extraite : refuse une archive plus récente que le code, joue
 * les migrations manquantes sur une archive plus ancienne.
 */
export function prepareExtractedDatabase(path) {
  const known = new Set(listMigrations().map((m) => m.version));
  const db = openDatabase({ path, migrate: false });

  try {
    const applied = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get()
      ? db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version)
      : [];

    const unknown = applied.filter((version) => !known.has(version));
    if (unknown.length) {
      throw conflict(
        `Archive plus récente que cette version de Vitrine : migration(s) inconnue(s) ${unknown.join(', ')}. Mets l'application à jour avant de restaurer.`,
      );
    }

    const played = runMigrations(db);
    // Une archive d'avant le lot 4 n'a pas de familles : la migration crée la
    // table vide, et une base sans famille n'affiche plus rien. Le seed
    // n'écrase jamais une table peuplée (voir `families-repo.js`).
    seedFamilies(db);

    return { applied: played, schema_version: schemaVersion(db) };
  } finally {
    db.close();
  }
}

// --- Bascule -----------------------------------------------------------------

/** Efface la base et ses journaux : un `-wal` orphelin ressusciterait l'ancienne. */
async function removeDatabaseFiles(dbPath) {
  await Promise.all([
    rm(dbPath, { force: true }),
    rm(`${dbPath}-wal`, { force: true }),
    rm(`${dbPath}-shm`, { force: true }),
  ]);
}

/**
 * Remplace l'état courant par celui d'un dossier extrait. La base et les
 * fichiers sont d'abord posés à côté de leur destination — même volume, donc
 * `rename` est atomique — puis échangés.
 */
async function applyReplace({ dir, dbPath, filesDir }) {
  const stagedDb = `${dbPath}.incoming`;
  const stagedFiles = `${resolve(filesDir)}.incoming`;

  await removeQuietly(stagedDb);
  await removeQuietly(stagedFiles);

  await copyFile(join(dir, DB_ENTRY), stagedDb);
  await copyTree(join(dir, FILES_ENTRY), stagedFiles);
  await mkdir(stagedFiles, { recursive: true }); // archive sans aucun fichier

  await removeDatabaseFiles(dbPath);
  await mkdir(dirname(dbPath), { recursive: true });
  await rename(stagedDb, dbPath);

  await removeQuietly(filesDir);
  await rename(stagedFiles, filesDir);
}

/** `PRAGMA integrity_check` et `foreign_key_check`, les deux ou rien. */
export function verifyDatabase(db) {
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`base restaurée illisible : ${integrity}`);

  const broken = db.pragma('foreign_key_check');
  if (broken.length) throw new Error(`base restaurée : ${broken.length} référence(s) cassée(s)`);
}

// --- Fusion ------------------------------------------------------------------

const IDEA_COLUMNS = [
  'slug', 'title', 'tagline', 'pitch', 'gif', 'price_cents', 'family', 'status',
  'competition', 'created_at', 'updated_at', 'deleted_at', 'wishlisted_at',
];

/** Un slug libre dans la base cible, en suffixant un numéro comme ailleurs. */
function freeSlug(db, desired) {
  const base = slugify(desired);
  const taken = db.prepare('SELECT 1 FROM ideas WHERE slug = ? LIMIT 1');
  if (!taken.get(base)) return base;
  for (let n = 2; n < 10000; n += 1) {
    if (!taken.get(`${base}-${n}`)) return `${base}-${n}`;
  }
  throw new Error(`impossible de fusionner l'idée « ${desired} » : slug indisponible`);
}

/**
 * Ajoute le contenu de l'archive à l'instance courante. Ne supprime jamais
 * rien : les idées de l'archive s'ajoutent (slug suffixé en cas de collision),
 * les familles absentes sont créées, les familles existantes ne bougent pas —
 * même quand l'archive en donne une autre version, parce que fusionner sert à
 * réunir deux instances, pas à faire gagner l'une sur l'autre.
 *
 * Les fichiers sont copiés sous le nouvel identifiant d'idée : le chemin
 * stocké commence par `{idea_id}/`, il est réécrit en même temps que la ligne.
 */
async function applyMerge({ dir, db, filesDir }) {
  const source = openDatabase({ path: join(dir, DB_ENTRY), migrate: false });
  /** Copies à faire une fois la transaction passée, `[from, to]`. */
  const copies = [];
  const summary = { ideas: 0, verdicts: 0, attachments: 0, families: 0, renamed: [] };

  try {
    const sourceIdeas = source.prepare('SELECT * FROM ideas').all();
    const sourceFamilies = source.prepare('SELECT * FROM families').all();
    const attachmentsOf = source.prepare('SELECT * FROM attachments WHERE idea_id = ? ORDER BY id');
    const verdictsOf = source.prepare('SELECT * FROM verdicts WHERE idea_id = ? ORDER BY id');

    db.transaction(() => {
      // Les familles d'abord : une idée fusionnée porte un slug de famille.
      const existingFamily = db.prepare('SELECT 1 FROM families WHERE slug = ?');
      const nextPosition = () =>
        (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM families').get().n);
      const insertFamily = db.prepare(
        `INSERT INTO families (slug, label, store_tags, features, position)
         VALUES (@slug, @label, @store_tags, @features, @position)`,
      );

      for (const family of sourceFamilies) {
        if (existingFamily.get(family.slug)) continue;
        insertFamily.run({ ...family, position: nextPosition() });
        summary.families += 1;
      }

      const insertIdea = db.prepare(
        `INSERT INTO ideas (${IDEA_COLUMNS.join(', ')})
         VALUES (${IDEA_COLUMNS.map((c) => `@${c}`).join(', ')})`,
      );
      const insertAttachment = db.prepare(
        `INSERT INTO attachments (idea_id, kind, label, path, url, link_type, position, created_at, size_bytes)
         VALUES (@idea_id, @kind, @label, @path, @url, @link_type, @position, @created_at, @size_bytes)`,
      );
      const insertVerdict = db.prepare(
        `INSERT INTO verdicts (idea_id, score, note, created_at)
         VALUES (@idea_id, @score, @note, @created_at)`,
      );
      const setMedia = db.prepare(
        'UPDATE ideas SET capsule_file_id = ?, trailer_file_id = ? WHERE id = ?',
      );

      for (const idea of sourceIdeas) {
        const slug = freeSlug(db, idea.slug);
        if (slug !== idea.slug) summary.renamed.push({ from: idea.slug, to: slug });

        const values = Object.fromEntries(IDEA_COLUMNS.map((c) => [c, idea[c] ?? null]));
        values.slug = slug;
        // Une famille absente de l'archive comme de la cible ne doit pas faire
        // tomber la fusion : l'idée garde son slug de famille, l'écran des
        // familles le montrera comme inconnu.
        const ideaId = Number(insertIdea.run(values).lastInsertRowid);
        summary.ideas += 1;

        /** Ancien identifiant de pièce -> nouveau, pour la capsule et la bande-annonce. */
        const remap = new Map();

        for (const attachment of attachmentsOf.all(idea.id)) {
          const path = attachment.path
            ? attachment.path.replace(new RegExp(`^${idea.id}/`), `${ideaId}/`)
            : null;

          const id = Number(
            insertAttachment.run({
              idea_id: ideaId,
              kind: attachment.kind,
              label: attachment.label,
              path,
              url: attachment.url,
              link_type: attachment.link_type,
              position: attachment.position,
              created_at: attachment.created_at,
              size_bytes: attachment.size_bytes ?? null,
            }).lastInsertRowid,
          );

          remap.set(attachment.id, id);
          summary.attachments += 1;

          if (attachment.path && path) {
            copies.push([
              join(dir, FILES_ENTRY, ...attachment.path.split('/')),
              join(filesDir, ...path.split('/')),
            ]);
          }
        }

        for (const verdict of verdictsOf.all(idea.id)) {
          insertVerdict.run({
            idea_id: ideaId,
            score: verdict.score,
            note: verdict.note,
            created_at: verdict.created_at,
          });
          summary.verdicts += 1;
        }

        const capsule = remap.get(idea.capsule_file_id) ?? null;
        const trailer = remap.get(idea.trailer_file_id) ?? null;
        if (capsule || trailer) setMedia.run(capsule, trailer, ideaId);
      }
    })();
  } finally {
    source.close();
  }

  // Les fichiers après la transaction : un fichier copié pour une ligne annulée
  // serait un orphelin invisible, l'inverse serait une image cassée.
  for (const [from, to] of copies) {
    await copyFile(from, to).catch(() => {});
  }

  return summary;
}

// --- Restauration ------------------------------------------------------------

/**
 * Restaure une archive. `db` est la **poignée** de l'application (voir
 * `db-handle.js`) : en mode `replace`, la connexion est fermée, le fichier
 * remplacé, puis la poignée rebranchée sur la base neuve.
 *
 * `afterSwitch` est une couture de test : elle est appelée juste après la
 * bascule, avant la vérification, pour éprouver la marche arrière automatique.
 */
export async function restoreArchive({
  archivePath,
  mode = 'replace',
  db,
  dbPath = config.dbPath,
  filesDir = config.filesDir,
  backupsDir = config.backupsDir,
  logger,
  afterSwitch,
} = {}) {
  if (mode !== 'replace' && mode !== 'merge') {
    throw badRequest(`Mode de restauration inconnu : « ${mode} ». Attendu « replace » ou « merge ».`);
  }

  const work = await makeWorkDir('restore');
  const extracted = join(work, 'archive');

  try {
    // 1 et 2. Extraction, puis validation complète avant de toucher à quoi que ce soit.
    await extractArchive(archivePath, extracted);
    const manifest = await readAndVerifyManifest(extracted);

    // 3. Migrations sur la base de l'archive — une archive plus ancienne est
    //    acceptée, une archive plus récente refusée.
    const migration = prepareExtractedDatabase(join(extracted, DB_ENTRY));

    // 4. Sauvegarde de sécurité : la marche arrière, toujours, même quand tout
    //    se passe bien. C'est la règle du projet.
    const safety = await createArchive({
      db,
      filesDir,
      backupsDir,
      outDir: backupsDir,
      name: archiveName(new Date(), 'pre-restore'),
    });
    logger?.info?.(`sauvegarde de sécurité : ${safety.name}`);

    const before = {
      ideas: countOf(db, 'ideas'),
      files: (await walkFiles(filesDir, { skip: [backupsDir] })).length,
    };

    // 5. Bascule.
    let merge = null;
    try {
      if (mode === 'replace') {
        db.connection.close();
        await applyReplace({ dir: extracted, dbPath, filesDir });
        db.swap(openDatabase({ path: dbPath, logger }));
      } else {
        merge = await applyMerge({ dir: extracted, db, filesDir });
      }

      await afterSwitch?.();

      // 6. Vérification.
      verifyDatabase(db);
    } catch (err) {
      await rollback({ safety: safety.path, db, dbPath, filesDir, logger });
      throw new HttpError(
        err instanceof HttpError ? err.statusCode : 500,
        err instanceof HttpError ? err.error : 'restore_failed',
        `Restauration interrompue (${err.message}). L'état précédent a été remis en place depuis ${safety.name}.`,
      );
    }

    return {
      mode,
      manifest,
      migrations_applied: migration.applied,
      schema_version: migration.schema_version,
      safety_backup: safety.name,
      before,
      after: {
        ideas: countOf(db, 'ideas'),
        files: (await walkFiles(filesDir, { skip: [backupsDir] })).length,
      },
      merged: merge,
    };
  } finally {
    await removeQuietly(work);
  }
}

/**
 * Remet la sauvegarde de sécurité en place. Toujours en `replace` : on veut
 * l'état d'avant, pas une fusion de l'état d'avant avec ce qui a échoué.
 */
async function rollback({ safety, db, dbPath, filesDir, logger }) {
  const work = await makeWorkDir('rollback');
  const extracted = join(work, 'archive');

  try {
    await extractArchive(safety, extracted);
    try {
      db.connection.close();
    } catch {
      /* déjà fermée : la bascule s'était arrêtée après la fermeture */
    }
    await applyReplace({ dir: extracted, dbPath, filesDir });
    db.swap(openDatabase({ path: dbPath, logger }));
    logger?.warn?.('restauration échouée : état précédent remis en place');
  } finally {
    await removeQuietly(work);
  }
}
