import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

import { config } from './config.js';
import { runMigrations } from './migrate.js';

/**
 * Ouvre la base, applique les migrations en attente et renvoie la connexion.
 * Une seule connexion suffit : better-sqlite3 est synchrone et l'application
 * est mono-utilisateur.
 */
export function openDatabase({ path = config.dbPath, migrate = true, logger } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  if (migrate) runMigrations(db, { logger });

  return db;
}
