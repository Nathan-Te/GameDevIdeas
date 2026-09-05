import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';

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

/**
 * Le point d'entrée public — le mécanisme sur lequel repose tout le lot 7.
 *
 * Un second serveur HTTP, sur un autre port, qui sert **la même application**
 * mais marque chaque requête comme publique avant de la lui passer. Le marquage
 * n'est donc pas une promesse d'un proxy amont, c'est un fait de transport :
 * une requête entrée par ce port est un visiteur, quoi qu'elle raconte d'elle.
 *
 * C'est ce qui rend la séparation fiable derrière Tailscale Funnel, qui présente
 * le trafic public depuis l'adresse locale de la machine — donc indiscernable
 * de Nathan si l'on ne classait que par adresse. Voir
 * `Docs/exposition-publique.md`.
 *
 * Sans `PUBLIC_PORT`, rien n'est ouvert : l'application reste exactement ce
 * qu'elle était avant ce lot.
 */
const publicServer = config.publicPort
  ? createServer((req, res) => {
      // Écrasé, jamais lu : un appelant ne choisit pas son camp.
      req.headers['x-vitrine-public'] = '1';
      app.routing(req, res);
    })
  : null;

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
    await new Promise((resolve, reject) => {
      publicServer.once('error', reject);
      publicServer.listen(config.publicPort, config.publicHost, resolve);
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
