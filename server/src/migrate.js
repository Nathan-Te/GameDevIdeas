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
  if (!pending.length) return [];

  /**
   * Les clés étrangères sont coupées le temps des migrations, et revérifiées
   * juste après par `foreign_key_check`.
   *
   * C'est la procédure que documente SQLite pour reconstruire une table, seul
   * moyen d'y modifier une contrainte `CHECK` (voir `005-trailer.sql`). Sans
   * cette coupure, le `DROP TABLE` de l'ancienne table déclencherait les
   * actions `ON DELETE` des tables qui la référencent : la reconstruction
   * effacerait les données qu'elle est censée recopier.
   *
   * Le pragma est posé hors transaction — à l'intérieur, SQLite l'ignore
   * silencieusement. La vérification, elle, est faite dans la transaction de
   * chaque migration : une migration qui casse une référence est annulée.
   */
  const enforced = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');

  try {
    for (const migration of pending) {
      const sql = readFileSync(migration.file, 'utf8');
      // Chaque migration est atomique : soit tout passe, soit rien n'est appliqué.
      db.transaction(() => {
        db.exec(sql);

        const broken = db.pragma('foreign_key_check');
        if (broken.length) {
          throw new Error(
            `migration ${migration.version} : ${broken.length} référence(s) cassée(s) — annulée`,
          );
        }

        db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migration.version);
      })();
      logger?.info?.(`migration appliquée : ${migration.version}`);
    }
  } finally {
    if (enforced) db.pragma('foreign_keys = ON');
  }

  return pending.map((m) => m.version);
}
