import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  archiveName,
  backupPreview,
  createArchive,
  restoreArchive,
  safeBackupName,
} from '../src/backup.js';
import { openDatabase } from '../src/db.js';
import { listMigrations, runMigrations } from '../src/migrate.js';

import {
  fingerprint,
  listEntries,
  makeInstance,
  repack,
  seedContent,
  unpack,
} from './backup-helpers.js';

/**
 * Le cœur de la sauvegarde, appelé directement — les routes ont leur propre
 * fichier. Toutes ces instances vivent dans des dossiers temporaires : une
 * restauration remplace un fichier de base, elle ne peut pas se tester en mémoire.
 */

describe('archive produite', () => {
  test('manifeste conforme, hachages justes, base ouvrable', async (t) => {
    const instance = makeInstance(t);
    seedContent(instance.db, instance.filesDir, { slug: 'idee-une', files: 2 });
    seedContent(instance.db, instance.filesDir, { slug: 'idee-deux', files: 1 });

    const archive = await createArchive({ ...instance, outDir: instance.backupsDir });

    assert.match(archive.name, /^vitrine-\d{4}-\d{2}-\d{2}-\d{4}\.tgz$/);
    assert.equal(archive.manifest.format, 1);
    assert.equal(archive.manifest.counts.ideas, 2);
    assert.equal(archive.manifest.counts.verdicts, 2);
    assert.equal(archive.manifest.counts.attachments, 3);
    assert.ok(archive.manifest.counts.families > 0);
    assert.equal(archive.manifest.files.count, 3);
    assert.equal(archive.manifest.schema_version, listMigrations().at(-1).version);

    // Le manifeste annonce un hachage par fichier, base comprise.
    assert.equal(Object.keys(archive.manifest.hashes).length, 4);

    const dir = await unpack(t, archive.path);
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest, archive.manifest);

    // La base extraite s'ouvre et contient tout.
    const copy = openDatabase({ path: join(dir, 'vitrine.db'), migrate: false });
    t.after(() => copy.close());
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM ideas').get().n, 2);
    assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM attachments').get().n, 3);
    assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
  });

  test("l'archive est lisible à la main et ne contient pas les sauvegardes", async (t) => {
    const instance = makeInstance(t);
    seedContent(instance.db, instance.filesDir);

    // Une archive déjà là : elle ne doit pas se retrouver dans la suivante.
    const first = await createArchive({ ...instance, outDir: instance.backupsDir });
    const second = await createArchive({ ...instance, outDir: instance.backupsDir });

    const entries = await listEntries(second.path);
    assert.ok(entries.includes('manifest.json'));
    assert.ok(entries.includes('vitrine.db'));
    assert.ok(entries.some((e) => e.startsWith('files/')));
    assert.ok(!entries.some((e) => e.includes('backups')));
    assert.ok(!entries.some((e) => e.includes(first.name)));

    // Deux archives dans la même minute ne s'écrasent pas.
    assert.notEqual(first.name, second.name);
  });

  test('la sauvegarde reste cohérente pendant des écritures (WAL)', async (t) => {
    const instance = makeInstance(t);
    seedContent(instance.db, instance.filesDir);

    const insert = instance.db.prepare(
      "INSERT INTO ideas (slug, title, family) VALUES (?, ?, 'autre')",
    );

    // `db.backup()` rend la main entre deux paquets de pages : les insertions
    // ci-dessous tombent donc bien pendant la sauvegarde. Une copie du fichier
    // `.db` à ce moment-là donnerait une base tronquée — c'est tout l'objet de
    // la règle « jamais de copie du fichier vivant ».
    const running = createArchive({ ...instance, outDir: instance.backupsDir });

    for (let i = 0; i < 300; i += 1) {
      insert.run(`pendant-${i}`, `pendant ${i}`);
      await new Promise((resolve) => setImmediate(resolve));
    }

    const archive = await running;
    const dir = await unpack(t, archive.path);
    const copy = openDatabase({ path: join(dir, 'vitrine.db'), migrate: false });
    t.after(() => copy.close());

    assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(copy.pragma('foreign_key_check').length, 0);
  });

  test('la prévision annonce ce que contiendrait l’archive', async (t) => {
    const instance = makeInstance(t);
    seedContent(instance.db, instance.filesDir, { files: 3 });

    const preview = await backupPreview(instance);
    const archive = await createArchive({ ...instance, outDir: instance.backupsDir });

    assert.deepEqual(preview.counts, archive.manifest.counts);
    assert.equal(preview.files.count, archive.manifest.files.count);
    assert.equal(preview.files.total_bytes, archive.manifest.files.total_bytes);
    assert.ok(preview.estimated_bytes > 0);
  });
});

describe('aller-retour', () => {
  test('une instance peuplée se restaure sur une instance vide', async (t) => {
    const source = makeInstance(t);
    seedContent(source.db, source.filesDir, { slug: 'idee-une', files: 2 });
    seedContent(source.db, source.filesDir, { slug: 'idee-deux', files: 1 });
    const before = await fingerprint(source);

    const archive = await createArchive({ ...source, outDir: source.backupsDir });
    const copy = join(source.root, 'transport.tgz');
    copyFileSync(archive.path, copy);

    // L'instance de destination est neuve : rien d'autre que le seed des familles.
    const target = makeInstance(t);
    const result = await restoreArchive({ archivePath: copy, ...target });

    assert.equal(result.mode, 'replace');
    assert.equal(result.after.ideas, 2);
    assert.equal(result.after.files, 3);
    assert.ok(result.safety_backup.startsWith('pre-restore-'));

    assert.deepEqual(await fingerprint(target), before);
  });
});

describe('versions de schéma', () => {
  /** Une base au schéma du lot 4 : les migrations sauf la dernière. */
  function oldSchemaInstance(t) {
    const instance = makeInstance(t);
    const migrations = listMigrations();
    const previous = migrations.at(-2).version;

    const path = join(instance.root, 'ancienne.db');
    const db = openDatabase({ path, migrate: false });
    // Un dossier de migrations tronqué : on rejoue tout sauf la dernière.
    const dir = join(instance.root, 'migrations');
    mkdirSync(dir, { recursive: true });
    for (const migration of migrations.slice(0, -1)) {
      copyFileSync(migration.file, join(dir, `${migration.version}.sql`));
    }
    runMigrations(db, { dir });

    db.prepare("INSERT INTO ideas (slug, title, family) VALUES ('ancienne', 'Ancienne', 'autre')").run();

    return { instance, db, path, previous };
  }

  test('une archive plus ancienne est migrée puis restaurée', async (t) => {
    const { instance, db, previous } = oldSchemaInstance(t);

    const archive = await createArchive({
      db,
      filesDir: instance.filesDir,
      backupsDir: instance.backupsDir,
      outDir: join(instance.root, 'out'),
    });
    db.close();

    assert.equal(archive.manifest.schema_version, previous);

    const target = makeInstance(t);
    const result = await restoreArchive({ archivePath: archive.path, ...target });

    assert.deepEqual(result.migrations_applied, [listMigrations().at(-1).version]);
    assert.equal(result.schema_version, listMigrations().at(-1).version);
    assert.equal(target.db.prepare("SELECT slug FROM ideas").get().slug, 'ancienne');
    // La colonne de la dernière migration existe bien sur la base restaurée.
    assert.doesNotThrow(() => target.db.prepare('SELECT trailer_file_id FROM ideas').get());
  });

  test('une archive plus récente que le code est refusée en 409', async (t) => {
    const instance = makeInstance(t);
    seedContent(instance.db, instance.filesDir);

    const archive = await createArchive({ ...instance, outDir: instance.backupsDir });
    const dir = await unpack(t, archive.path);

    const future = openDatabase({ path: join(dir, 'vitrine.db'), migrate: false });
    future.prepare("INSERT INTO schema_migrations (version) VALUES ('999-futur')").run();
    future.close();

    const forged = join(instance.root, 'futur.tgz');
    await repack(dir, forged, { rehash: true });

    const target = makeInstance(t);
    await assert.rejects(
      restoreArchive({ archivePath: forged, ...target }),
      (err) => err.statusCode === 409 && /plus récente/.test(err.message),
    );
    assert.equal(target.db.prepare('SELECT COUNT(*) AS n FROM ideas').get().n, 0);
  });
});

describe('archives invalides', () => {
  /** Chaque cas abîme une archive valide d'une façon différente. */
  const cases = [
    {
      name: 'manifeste absent',
      damage: (dir) => rmSync(join(dir, 'manifest.json')),
      rehash: false,
      expected: /manifest\.json/,
    },
    {
      name: 'manifeste illisible',
      damage: (dir) => writeFileSync(join(dir, 'manifest.json'), '{ pas du json'),
      rehash: false,
      expected: /manifest\.json/,
    },
    {
      name: 'format inconnu',
      damage: (dir) => {
        const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
        manifest.format = 42;
        writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
      },
      rehash: false,
      expected: /format/,
    },
    {
      name: 'hachage faux',
      damage: (dir) => writeFileSync(join(dir, 'files', '1', 'capture-0.png'), 'autre chose'),
      rehash: false,
      expected: /hachage/,
    },
    {
      name: 'fichier annoncé manquant',
      damage: (dir) => rmSync(join(dir, 'files', '1', 'capture-0.png')),
      rehash: false,
      expected: /manque/,
    },
  ];

  for (const scenario of cases) {
    test(`${scenario.name} : refus, instance intacte`, async (t) => {
      const source = makeInstance(t);
      seedContent(source.db, source.filesDir, { files: 2 });
      const archive = await createArchive({ ...source, outDir: source.backupsDir });

      const dir = await unpack(t, archive.path);
      scenario.damage(dir);
      const broken = join(source.root, 'abimee.tgz');
      await repack(dir, broken, { rehash: scenario.rehash });

      // L'instance visée est peuplée autrement : on vérifie qu'elle ne bouge pas.
      const target = makeInstance(t);
      seedContent(target.db, target.filesDir, { slug: 'intacte', files: 1 });
      const before = await fingerprint(target);

      await assert.rejects(
        restoreArchive({ archivePath: broken, ...target }),
        (err) => err.statusCode === 400 && scenario.expected.test(err.message),
      );

      assert.deepEqual(await fingerprint(target), before);
    });
  }
});

describe('fusion', () => {
  test('les idées s’ajoutent, les collisions sont suffixées, rien n’est supprimé', async (t) => {
    const source = makeInstance(t);
    seedContent(source.db, source.filesDir, { slug: 'partagee', files: 1 });
    seedContent(source.db, source.filesDir, { slug: 'venue-d-ailleurs', files: 2 });
    source.db
      .prepare("INSERT INTO families (slug, label, store_tags, features, position) VALUES ('exotique', 'Exotique', '[]', '[]', 99)")
      .run();
    source.db.prepare("UPDATE families SET label = 'Renommée ailleurs' WHERE slug = 'autre'").run();

    const archive = await createArchive({ ...source, outDir: source.backupsDir });

    const target = makeInstance(t);
    seedContent(target.db, target.filesDir, { slug: 'partagee', files: 1 });
    seedContent(target.db, target.filesDir, { slug: 'locale', files: 1 });
    const labelBefore = target.db.prepare("SELECT label FROM families WHERE slug = 'autre'").get().label;

    const result = await restoreArchive({ archivePath: archive.path, mode: 'merge', ...target });

    const slugs = target.db.prepare('SELECT slug FROM ideas ORDER BY slug').all().map((r) => r.slug);
    // Rien n'est supprimé : les deux idées locales sont toujours là.
    assert.ok(slugs.includes('locale'));
    assert.ok(slugs.includes('partagee'));
    // La collision est suffixée, pas écrasée.
    assert.ok(slugs.includes('partagee-2'));
    assert.ok(slugs.includes('venue-d-ailleurs'));
    assert.equal(slugs.length, 4);
    assert.deepEqual(result.merged.renamed, [{ from: 'partagee', to: 'partagee-2' }]);

    // Familles : l'absente est créée, l'existante n'est pas modifiée.
    assert.ok(target.db.prepare("SELECT 1 FROM families WHERE slug = 'exotique'").get());
    assert.equal(
      target.db.prepare("SELECT label FROM families WHERE slug = 'autre'").get().label,
      labelBefore,
    );

    // Les fichiers fusionnés sont sur le disque, sous le nouvel identifiant.
    const rows = target.db.prepare("SELECT path FROM attachments WHERE path IS NOT NULL").all();
    assert.equal(rows.length, 5);
    for (const row of rows) {
      assert.doesNotThrow(() => readFileSync(join(target.filesDir, ...row.path.split('/'))));
    }
  });
});

describe('marche arrière', () => {
  test('un échec après la bascule remet la sauvegarde de sécurité', async (t) => {
    const source = makeInstance(t);
    seedContent(source.db, source.filesDir, { slug: 'venue-d-ailleurs', files: 1 });
    const archive = await createArchive({ ...source, outDir: source.backupsDir });

    const target = makeInstance(t);
    seedContent(target.db, target.filesDir, { slug: 'locale', files: 2 });
    const before = await fingerprint(target);

    await assert.rejects(
      restoreArchive({
        archivePath: archive.path,
        ...target,
        // Couture de test : l'échec tombe après la bascule, quand la base a
        // déjà été remplacée. C'est le seul moment où la marche arrière sert.
        afterSwitch: () => {
          throw new Error('panne simulée');
        },
      }),
      (err) => /panne simulée/.test(err.message) && /remis en place/.test(err.message),
    );

    assert.deepEqual(await fingerprint(target), before);
  });
});

describe('noms d’archive', () => {
  test('un nom de sauvegarde ne peut pas sortir du dossier', () => {
    assert.equal(safeBackupName('vitrine-2026-01-01-1200.tgz'), 'vitrine-2026-01-01-1200.tgz');
    for (const bad of ['../secret.tgz', 'a/b.tgz', 'a\\b.tgz', '.tgz', 'note.txt', '', null]) {
      assert.equal(safeBackupName(bad), null, `refusé : ${bad}`);
    }
  });

  test('le nom porte la date à la minute', () => {
    assert.equal(archiveName(new Date(2026, 8, 5, 3, 7)), 'vitrine-2026-09-05-0307.tgz');
    assert.equal(archiveName(new Date(2026, 8, 5, 3, 7), 'pre-restore'), 'pre-restore-2026-09-05-0307.tgz');
  });
});
