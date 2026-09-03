import { mkdirSync } from 'node:fs';

import { buildApp } from './app.js';
import { config } from './config.js';

// Le volume des fichiers utilisateur est créé dès maintenant : le lot 2 y écrira.
mkdirSync(config.filesDir, { recursive: true });

const app = await buildApp({ logger: { level: config.logLevel } });

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
