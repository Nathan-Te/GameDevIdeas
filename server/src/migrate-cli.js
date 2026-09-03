/**
 * `npm run migrate` — applique les migrations en attente sans démarrer le serveur.
 *
 * Entrée séparée plutôt qu'un bloc auto-exécuté dans `migrate.js` : ce dernier
 * est importé par `db.js`, et un `import('./db.js')` depuis le module en cours
 * d'évaluation bloquerait sur l'import circulaire.
 */
import { config } from './config.js';
import { openDatabase } from './db.js';
import { runMigrations } from './migrate.js';

const db = openDatabase({ migrate: false });

try {
  const applied = runMigrations(db, { logger: console });
  console.log(
    applied.length
      ? `${applied.length} migration(s) appliquée(s) sur ${config.dbPath}`
      : `base déjà à jour : ${config.dbPath}`,
  );
} finally {
  db.close();
}
