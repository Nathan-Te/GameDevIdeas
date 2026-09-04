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

  /**
   * Taille maximale d'un fichier envoyé, en mégaoctets. Au-delà, la requête est
   * refusée en 413 et le fichier partiellement écrit est effacé.
   */
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 50),

  /**
   * Limite propre à la bande-annonce, en mégaoctets. Une vidéo de vingt
   * secondes pèse plus qu'une capture, et refuser une bande-annonce parce
   * qu'elle dépasse la limite d'une image n'aurait aucun sens.
   */
  maxTrailerMb: Number(env.MAX_TRAILER_MB || 100),

  /**
   * Aller chercher le titre de la page pour libeller un lien collé sans label.
   * Le serveur appelle alors le domaine collé par Nathan : on peut couper cet
   * appel sortant (instance sans accès Internet, ou par principe). Le libellé
   * retombe sur le nom de domaine.
   */
  linkTitleLookup: bool(env.LINK_TITLE_LOOKUP, true),

  /**
   * Le nom affiché comme développeur et éditeur sur la vue store. C'est la
   * seule donnée de la page qui ne vient pas de l'idée : elle est la même pour
   * toutes, donc elle est de la configuration, pas un champ de fiche.
   */
  developerName: env.DEVELOPER_NAME || 'Nathan',

  migrationsDir: resolve(repoRoot, 'server', 'migrations'),
  webDist: fromRoot(env.WEB_DIST || './web/dist'),

  /**
   * Non défini : on sert le front statique s'il a été construit. C'est ce qui
   * permet à `npm run dev` de ne rien exiger — Vite sert le front sur son port.
   */
  serveStatic: bool(env.SERVE_STATIC, undefined),
};
