import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';

import { createArchive, restoreArchive, STAGING_DIR, TRASH_DIR, cleanupRestoreStaging } from '../src/backup.js';
import { config } from '../src/config.js';
import { createDbHandle } from '../src/db-handle.js';
import { openDatabase } from '../src/db.js';

import { fingerprint, makeInstance, seedContent } from './backup-helpers.js';

/**
 * La restauration quand la destination est un point de montage.
 *
 * C'est le cas de la production : `docker-compose.yml` monte `data/db`,
 * `data/files` et `data/backups`. Un point de montage ne se renomme pas et ne
 * se supprime pas — `EBUSY` — et `rename()` refuse de traverser sa frontière —
 * `EXDEV`. La bascule du lot 5, qui remplaçait le dossier `data/files` par un
 * `data/files.incoming` voisin, ne pouvait donc **jamais** aboutir en
 * conteneur, marche arrière comprise. Aucun test ne le voyait : ils travaillent
 * tous dans un dossier temporaire ordinaire.
 *
 * Ce fichier est ce test manquant. Il ne s'exécute que là où la destination est
 * réellement montée :
 *
 *   npm run test:container      (à la racine — construit l'image et l'exécute)
 *
 * qui lance ce fichier dans l'image de production, avec des volumes Docker
 * nommés montés sur `/app/data/db`, `/app/data/files` et `/app/data/backups`.
 * Un volume nommé et un montage lié (`bind`) sont le même mécanisme du point de
 * vue du noyau — une entrée de `mountinfo`, une frontière que `rename` refuse —
 * et le poste de développement est sous Windows, où `mount --bind` n'existe pas.
 *
 * Ailleurs, la suite est **sautée**, sauf si `VITRINE_REQUIRE_MOUNT_TEST=1`,
 * que le lanceur positionne : sans ce garde-fou, une erreur de montage ferait
 * passer le test au vert en ne testant rien.
 */

/** Les cibles de montage vues par le noyau. Vide hors Linux. */
function mountTargets() {
  try {
    return new Set(
      readFileSync('/proc/self/mountinfo', 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(' ')[4]),
    );
  } catch {
    return new Set();
  }
}

const targets = mountTargets();
const isMountPoint = (path) => targets.has(resolve(path).replace(/\\/g, '/'));

const required = process.env.VITRINE_REQUIRE_MOUNT_TEST === '1';
const mounted = isMountPoint(config.filesDir) && isMountPoint(config.dbDir);

if (required && !mounted) {
  throw new Error(
    `VITRINE_REQUIRE_MOUNT_TEST=1 mais la destination n'est pas montée :\n` +
      `  ${config.filesDir} monté : ${isMountPoint(config.filesDir)}\n` +
      `  ${config.dbDir} monté : ${isMountPoint(config.dbDir)}\n` +
      'Le test ne prouverait rien. Vérifier les volumes du conteneur.',
  );
}

const skip = mounted
  ? false
  : 'destination non montée — lancer `npm run test:container` (voir l’en-tête du fichier)';

/** Vide un dossier sans le supprimer : c'est justement ce qu'on ne peut pas faire. */
function emptyDirectory(dir) {
  for (const name of readdirSync(dir)) rmSync(join(dir, name), { recursive: true, force: true });
}

/** Le contenu de l'instance montée, remis à neuf avant chaque test. */
function mountedInstance(t) {
  const paths = { dbPath: config.dbPath, filesDir: config.filesDir, backupsDir: config.backupsDir };

  for (const suffix of ['', '-wal', '-shm']) rmSync(`${paths.dbPath}${suffix}`, { force: true });
  emptyDirectory(paths.filesDir);
  emptyDirectory(paths.backupsDir);
  rmSync(`${resolve(paths.filesDir)}.incoming`, { recursive: true, force: true });

  const db = createDbHandle(openDatabase({ path: paths.dbPath }));
  t.after(() => {
    try {
      db.close();
    } catch {
      /* déjà fermée par une restauration */
    }
  });

  return { ...paths, db };
}

/** Une archive produite ailleurs, dans un dossier temporaire ordinaire. */
async function sourceArchive(t, { slug = 'venue-d-ailleurs', files = 2 } = {}) {
  // `makeInstance` détourne `config` : on le remet avant de restaurer, sinon la
  // restauration viserait le dossier temporaire au lieu du point de montage.
  const saved = { dbPath: config.dbPath, filesDir: config.filesDir, backupsDir: config.backupsDir };
  const source = makeInstance(t);
  seedContent(source.db, source.filesDir, { slug, files });
  const archive = await createArchive({ ...source, outDir: source.backupsDir });
  const state = await fingerprint(source);
  Object.assign(config, saved);
  return { archive, state };
}

/** Ce qu'aucune restauration ne doit laisser derrière elle. */
function assertNoLeftovers(instance) {
  const files = resolve(instance.filesDir);
  assert.equal(existsSync(join(files, STAGING_DIR)), false, `${STAGING_DIR} orphelin`);
  assert.equal(existsSync(join(files, TRASH_DIR)), false, `${TRASH_DIR} orphelin`);
  assert.equal(existsSync(`${files}.incoming`), false, 'files.incoming orphelin');
  assert.equal(existsSync(`${instance.dbPath}.incoming`), false, 'vitrine.db.incoming orphelin');
  // Le dossier doit toujours être le point de montage : s'il a été remplacé par
  // un dossier ordinaire, la restauration a écrit à côté du volume et tout
  // disparaîtra au prochain redémarrage.
  assert.ok(isMountPoint(instance.filesDir), 'le dossier des fichiers n’est plus un point de montage');
}

describe('restauration sur un point de montage', { skip }, () => {
  test('le décor est bien celui de la production', () => {
    assert.ok(isMountPoint(config.filesDir), `${config.filesDir} devrait être monté`);
    assert.ok(isMountPoint(config.dbDir), `${config.dbDir} devrait être monté`);
    // L'hypothèse sur laquelle repose la bascule de la base par `rename` : le
    // montage porte sur le dossier, pas sur le fichier.
    assert.equal(isMountPoint(config.dbPath), false, 'le fichier de base ne doit pas être monté');
  });

  test('replace remplace le contenu et laisse le montage intact', async (t) => {
    const instance = mountedInstance(t);
    seedContent(instance.db, instance.filesDir, { slug: 'a-remplacer', files: 3 });

    const { archive, state } = await sourceArchive(t, { slug: 'venue-d-ailleurs', files: 2 });

    const result = await restoreArchive({
      archivePath: archive.path,
      mode: 'replace',
      db: instance.db,
      ...instance,
    });

    assert.equal(result.mode, 'replace');
    assert.deepEqual(await fingerprint(instance), state);
    assert.equal(
      instance.db.prepare("SELECT COUNT(*) AS n FROM ideas WHERE slug = 'a-remplacer'").get().n,
      0,
      'l’ancien contenu devrait avoir disparu',
    );
    assertNoLeftovers(instance);
  });

  test('la marche arrière fonctionne aussi sur un point de montage', async (t) => {
    const instance = mountedInstance(t);
    seedContent(instance.db, instance.filesDir, { slug: 'a-garder', files: 2 });
    const before = await fingerprint(instance);

    const { archive } = await sourceArchive(t);

    await assert.rejects(
      restoreArchive({
        archivePath: archive.path,
        mode: 'replace',
        db: instance.db,
        ...instance,
        // La bascule a réussi ; c'est la vérification qui échoue. C'est le
        // moment exact où la marche arrière doit repasser par le même chemin.
        afterSwitch: () => {
          throw new Error('panne simulée après la bascule');
        },
      }),
      /remis en place/,
    );

    assert.deepEqual(await fingerprint(instance), before, 'l’état d’avant n’a pas été remis');
    assertNoLeftovers(instance);
  });

  test('merge ajoute sans toucher au dossier monté', async (t) => {
    const instance = mountedInstance(t);
    seedContent(instance.db, instance.filesDir, { slug: 'deja-la', files: 1 });

    const { archive } = await sourceArchive(t, { slug: 'venue-d-ailleurs', files: 2 });

    const result = await restoreArchive({
      archivePath: archive.path,
      mode: 'merge',
      db: instance.db,
      ...instance,
    });

    assert.equal(result.merged.ideas, 1);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM ideas').get().n, 2);
    assert.equal(result.after.files, 3);
    assertNoLeftovers(instance);
  });

  test('une restauration interrompue est nettoyée au démarrage suivant', async (t) => {
    const instance = mountedInstance(t);
    const files = resolve(instance.filesDir);

    // Les trois formes possibles : les deux dossiers internes d'aujourd'hui, et
    // le voisin que la version du lot 5 laissait en production.
    mkdirSync(join(files, STAGING_DIR, '7'), { recursive: true });
    mkdirSync(join(files, TRASH_DIR), { recursive: true });
    mkdirSync(`${files}.incoming`, { recursive: true });

    const removed = await cleanupRestoreStaging(instance);

    assert.equal(removed.length, 3);
    assertNoLeftovers(instance);
    assert.ok(isMountPoint(instance.filesDir));
  });

  test('les dossiers de bascule n’entrent jamais dans une archive', async (t) => {
    const instance = mountedInstance(t);
    seedContent(instance.db, instance.filesDir, { slug: 'compte-moi', files: 2 });
    mkdirSync(join(resolve(instance.filesDir), STAGING_DIR, '99'), { recursive: true });

    const archive = await createArchive({ ...instance, outDir: instance.backupsDir });
    assert.equal(archive.manifest.files.count, 2);
    assert.ok(
      Object.keys(archive.manifest.hashes).every((entry) => !entry.includes(STAGING_DIR)),
      'un dossier de bascule est entré dans le manifeste',
    );
  });
});
