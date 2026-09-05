import { existsSync, mkdirSync } from 'node:fs';

import { archiveName, createArchive, rotateBackups } from './backup.js';
import { config } from './config.js';
import { openDatabase } from './db.js';

/**
 * `npm run backup -- --out <dossier> [--keep N]`
 *
 * Produit exactement la même archive que `POST /api/backup` : le code est celui
 * de `backup.js`, pas une seconde implémentation. C'est ce qui fait qu'une
 * archive du cron et une archive téléchargée depuis le navigateur sont
 * interchangeables.
 *
 * Fonctionne serveur arrêté comme serveur démarré : la lecture passe par
 * `db.backup()`, l'API de sauvegarde en ligne de SQLite, qui sait produire une
 * image cohérente pendant que d'autres connexions écrivent.
 */
function parseArgs(argv) {
  const args = { out: config.backupsDir, keep: null };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out' || arg === '-o') args.out = argv[++i];
    else if (arg === '--keep' || arg === '-k') args.keep = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`argument inconnu : ${arg}`);
  }

  if (!args.out) throw new Error('--out attend un dossier');
  return args;
}

const USAGE = `
Sauvegarde Vitrine — une archive .tgz contenant la base et les fichiers.

  npm run backup -- [--out <dossier>] [--keep <n>]

  --out   dossier de destination (défaut : ${config.backupsDir})
  --keep  ne garder que les N archives les plus récentes du dossier
`.trim();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  // Sans base, il n'y a rien à sauvegarder — et surtout, `openDatabase` en
  // créerait une vide, ce qui donnerait une archive de rien du tout. Le cas
  // arrive pour de vrai : un chemin de données mal réglé dans le cron.
  if (!existsSync(config.dbPath)) {
    throw new Error(`aucune base à ${config.dbPath} (vérifier DATA_DB_DIR ou DB_PATH)`);
  }

  mkdirSync(args.out, { recursive: true });

  // `migrate: false` : sauvegarder n'est pas le moment de faire évoluer un
  // schéma. Une base en retard se sauvegarde telle quelle, et la restauration
  // jouera ses migrations manquantes.
  const db = openDatabase({ path: config.dbPath, migrate: false });

  try {
    const archive = await createArchive({
      db,
      filesDir: config.filesDir,
      backupsDir: config.backupsDir,
      outDir: args.out,
      name: archiveName(),
    });

    const { counts, files } = archive.manifest;
    console.log(
      `${archive.path} — ${mb(archive.bytes)} Mo, ${counts.ideas} idée(s), ${files.count} fichier(s)`,
    );

    if (args.keep) {
      const removed = await rotateBackups(args.out, args.keep);
      if (removed.length) console.log(`rotation : ${removed.length} archive(s) supprimée(s)`);
    }
  } finally {
    db.close();
  }
}

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1);

try {
  await main();
} catch (err) {
  console.error(`sauvegarde impossible : ${err.message}`);
  process.exit(1);
}
