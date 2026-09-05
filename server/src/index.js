import { mkdirSync } from 'node:fs';

import { buildApp } from './app.js';
import { cleanupRestoreStaging } from './backup.js';
import { config } from './config.js';
import { createPublicEntry, listenPublicEntry } from './public-entry.js';

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

/**
 * Le point d'entrée public. Tout est dans `public-entry.js` ; il ne reste ici
 * que la décision de l'ouvrir ou non.
 *
 * Sans `PUBLIC_PORT`, rien n'est ouvert : l'application reste exactement ce
 * qu'elle était avant le lot 7, et **tout est classé `owner`**. Un point qui
 * mérite d'être dit franchement : c'est le port public qui fabrique les
 * visiteurs, donc pointer Tailscale Funnel sur `PORT` au lieu de `PUBLIC_PORT`
 * exposerait toute l'application. Voir `Docs/exposition-publique.md`.
 */
if (config.publicPort && config.publicPort === config.port) {
  // Un seul port ne peut pas être à la fois celui de Nathan et celui du public.
  // Mieux vaut refuser de démarrer que servir une frontière qui n'en est pas une.
  app.log.error(
    `PUBLIC_PORT et PORT valent tous les deux ${config.port} : le point d’entrée public ne serait pas distinct.`,
  );
  process.exit(1);
}

const publicServer = config.publicPort ? createPublicEntry(app) : null;

// Le crochet est posé **avant** l'écoute : Fastify refuse d'en accepter après.
if (publicServer) {
  app.addHook('onClose', async () => {
    await new Promise((resolve) => publicServer.close(resolve));
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`base : ${config.dbPath}`);

  if (publicServer) {
    await listenPublicEntry(publicServer, {
      port: config.publicPort,
      host: config.publicHost,
    });
    app.log.info(
      `point d’entrée public sur ${config.publicHost}:${config.publicPort} — toute requête y est un visiteur`,
    );
  } else {
    app.log.info('aucun point d’entrée public (PUBLIC_PORT non défini)');
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
