import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Racine du dépôt, déduite de l'emplacement de ce fichier (server/src/config.js). */
export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const fromRoot = (p) => (isAbsolute(p) ? p : resolve(repoRoot, p));

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

const env = process.env;

const dbDir = fromRoot(env.DATA_DB_DIR || './data/db');

export const config = {
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  logLevel: env.LOG_LEVEL || 'info',

  /** `:memory:` est laissé tel quel : better-sqlite3 le comprend. */
  dbPath: env.DB_PATH === ':memory:' ? ':memory:' : fromRoot(env.DB_PATH || join(dbDir, 'vitrine.db')),
  dbDir,
  filesDir: fromRoot(env.DATA_FILES_DIR || './data/files'),

  migrationsDir: resolve(repoRoot, 'server', 'migrations'),
  webDist: fromRoot(env.WEB_DIST || './web/dist'),

  /**
   * Non défini : on sert le front statique s'il a été construit. C'est ce qui
   * permet à `npm run dev` de ne rien exiger — Vite sert le front sur son port.
   */
  serveStatic: bool(env.SERVE_STATIC, undefined),
};
