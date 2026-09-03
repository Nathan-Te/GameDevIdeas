import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { config } from './config.js';

/**
 * Convention : `server/migrations/NNN-nom.sql`, appliquées par ordre de numéro.
 * Chaque migration jouée est enregistrée dans `schema_migrations` et n'est
 * jamais rejouée. Une migration livrée n'est jamais réécrite : on en ajoute une.
 */
export function listMigrations(dir = config.migrationsDir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => ({ version: name.replace(/\.sql$/, ''), file: join(dir, name) }));
}

export function runMigrations(db, { dir = config.migrationsDir, logger } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version),
  );

  const pending = listMigrations(dir).filter((m) => !applied.has(m.version));

  for (const migration of pending) {
    const sql = readFileSync(migration.file, 'utf8');
    // Chaque migration est atomique : soit tout passe, soit rien n'est appliqué.
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version);
    })();
    logger?.info?.(`migration appliquée : ${migration.version}`);
  }

  return pending.map((m) => m.version);
}
