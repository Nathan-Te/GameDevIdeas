import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { listMigrations, runMigrations } from '../src/migrate.js';

const tables = (db) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);

test('les migrations créent le schéma et s’enregistrent', async (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());

  const applied = runMigrations(db);

  assert.deepEqual(applied, listMigrations().map((m) => m.version));
  for (const table of ['ideas', 'verdicts', 'attachments', 'schema_migrations']) {
    assert.ok(tables(db).includes(table), `table ${table} créée`);
  }
});

test('les migrations sont idempotentes : un second passage ne rejoue rien', async (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());

  runMigrations(db);
  const second = runMigrations(db);

  assert.deepEqual(second, [], 'aucune migration rejouée');
  assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, listMigrations().length);
});

test('le schéma des pièces jointes est complet après 002', async (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  runMigrations(db);

  const ideaColumns = db.prepare('PRAGMA table_info(ideas)').all().map((c) => c.name);
  assert.ok(ideaColumns.includes('capsule_file_id'), 'capsule_file_id présente dès le lot 1');
  assert.ok(ideaColumns.includes('deleted_at'), 'deleted_at présente pour le soft delete');

  const attachmentColumns = db.prepare('PRAGMA table_info(attachments)').all().map((c) => c.name);
  // `size_bytes` est ajoutée par `002-attachment-size.sql` : elle arrive donc
  // en fin de table, après `created_at`, et non à sa place « logique ».
  assert.deepEqual(attachmentColumns, [
    'id',
    'idea_id',
    'kind',
    'label',
    'path',
    'url',
    'link_type',
    'position',
    'created_at',
    'size_bytes',
  ]);
});

test('la base refuse un score hors bornes même en SQL direct', async (t) => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  runMigrations(db);

  db.prepare("INSERT INTO ideas (slug, title) VALUES ('x', 'X')").run();
  const insert = db.prepare('INSERT INTO verdicts (idea_id, score) VALUES (1, ?)');

  assert.throws(() => insert.run(6), /CHECK constraint/i);
  assert.throws(() => insert.run(-1), /CHECK constraint/i);
});

test('`npm run migrate` applique puis n’a plus rien à faire', async (t) => {
  // Régression : le CLI vivait dans `migrate.js`, importé par `db.js`. Le
  // `import('./db.js')` depuis le module en cours d'évaluation bloquait sur
  // l'import circulaire et la commande ne rendait jamais la main.
  const dir = mkdtempSync(join(tmpdir(), 'vitrine-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const cli = fileURLToPath(new URL('../src/migrate-cli.js', import.meta.url));
  const run = () =>
    execFileSync(process.execPath, [cli], {
      env: { ...process.env, DB_PATH: join(dir, 'test.db') },
      encoding: 'utf8',
      timeout: 20000,
    });

  // Le nombre suit la liste des migrations : ajouter un lot ne casse pas ce test.
  assert.ok(run().includes(`${listMigrations().length} migration(s) appliquée(s)`));
  assert.match(run(), /base déjà à jour/);
});
