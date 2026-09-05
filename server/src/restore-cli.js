import { createInterface } from 'node:readline/promises';

import { createDbHandle } from './db-handle.js';
import { restoreArchive } from './backup.js';
import { config } from './config.js';
import { openDatabase } from './db.js';

/**
 * `npm run restore -- --file <archive> [--merge] [--yes]`
 *
 * Même code que `POST /api/restore` : extraction, vérification du manifeste,
 * migrations sur la base de l'archive, sauvegarde de sécurité, bascule,
 * vérification — et marche arrière automatique si la bascule échoue.
 *
 * À lancer serveur arrêté. Un serveur qui tourne garde un descripteur ouvert
 * sur l'ancien fichier de base : il ne verrait pas la nouvelle. Le script le
 * dit avant de demander confirmation.
 */
function parseArgs(argv) {
  const args = { file: null, mode: 'replace', yes: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') args.file = argv[++i];
    else if (arg === '--merge') args.mode = 'merge';
    else if (arg === '--yes' || arg === '-y') args.yes = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`argument inconnu : ${arg}`);
  }

  return args;
}

const USAGE = `
Restauration Vitrine — réinjecte une archive .tgz produite par Vitrine.

  npm run restore -- --file <archive.tgz> [--merge] [--yes]

  --file   l'archive à restaurer (obligatoire)
  --merge  ajouter le contenu de l'archive au lieu de remplacer l'état courant
  --yes    ne pas demander confirmation

À lancer serveur arrêté : un serveur en cours garde l'ancienne base ouverte.
`.trim();

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [o/N] `);
    return /^(o|oui|y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    console.log(USAGE);
    process.exitCode = args.file ? 0 : 1;
    return;
  }

  const db = createDbHandle(openDatabase({ path: config.dbPath }));

  try {
    if (!args.yes) {
      const what =
        args.mode === 'merge'
          ? "Le contenu de l'archive sera AJOUTÉ à l'état actuel."
          : "L'état actuel sera REMPLACÉ par celui de l'archive.";
      console.log(`${what}\nUne sauvegarde de sécurité sera posée dans ${config.backupsDir}.`);
      if (!(await confirm('Continuer ?'))) {
        console.log('Annulé.');
        return;
      }
    }

    const result = await restoreArchive({
      archivePath: args.file,
      mode: args.mode,
      db,
      dbPath: config.dbPath,
      filesDir: config.filesDir,
      backupsDir: config.backupsDir,
      logger: console,
    });

    console.log(
      `restauration ${result.mode} : ${result.before.ideas} idée(s) -> ${result.after.ideas}, ` +
        `${result.before.files} fichier(s) -> ${result.after.files}`,
    );
    console.log(`sauvegarde de sécurité : ${result.safety_backup}`);
    if (result.migrations_applied.length) {
      console.log(`migrations jouées sur l'archive : ${result.migrations_applied.join(', ')}`);
    }
    if (result.merged?.renamed.length) {
      for (const { from, to } of result.merged.renamed) {
        console.log(`slug déjà pris : « ${from} » importée sous « ${to} »`);
      }
    }
  } finally {
    db.close();
  }
}

try {
  await main();
} catch (err) {
  console.error(`restauration impossible : ${err.message}`);
  process.exit(1);
}
