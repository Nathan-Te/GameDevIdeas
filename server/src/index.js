import { mkdirSync } from 'node:fs';

import { buildApp } from './app.js';
import { cleanupRestoreStaging } from './backup.js';
import { config } from './config.js';

// Le volume des fichiers utilisateur est créé dès maintenant : le lot 2 y écrira.
mkdirSync(config.filesDir, { recursive: true });
// Le dossier des sauvegardes existe dès le démarrage : `backup.sh` et la route
// de restauration y écrivent, et l'écran /sauvegarde le liste même vide.
mkdirSync(config.backupsDir, { recursive: true });

// Une restauration interrompue laisse des dossiers de préparation. Ils ne
// contiennent rien de vivant, mais personne ne viendrait les effacer.
const leftovers = await cleanupRestoreStaging();

const app = await buildApp({ logger: { level: config.logLevel } });

for (const path of leftovers) {
  app.log.warn(`restauration interrompue : dossier de préparation effacé (${path})`);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    app.log.info(`${signal} reçu, arrêt`);
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`base : ${config.dbPath}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
