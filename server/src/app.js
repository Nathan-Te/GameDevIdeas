import { existsSync } from 'node:fs';
import { join } from 'node:path';

import Fastify from 'fastify';

import { config } from './config.js';
import { openDatabase } from './db.js';
import { registerErrorHandling } from './errors.js';
import attachmentRoutes from './routes/attachments.js';
import configRoutes from './routes/config.js';
import fileRoutes from './routes/files.js';
import ideaRoutes from './routes/ideas.js';
import { validatorCompiler } from './validation.js';

/**
 * Construit une instance Fastify prête à servir. Utilisée telle quelle par
 * `index.js` en production et par les tests, qui lui passent une base à eux.
 */
export async function buildApp({ db, dbPath, logger = false } = {}) {
  const app = Fastify({ logger });

  // Validation des entrées : voir validation.js pour le pourquoi des deux AJV.
  app.setValidatorCompiler(validatorCompiler);

  const database = db ?? openDatabase({ path: dbPath, logger: app.log });
  const ownsDatabase = !db;

  app.decorate('db', database);
  registerErrorHandling(app);

  await app.register(configRoutes);
  await app.register(ideaRoutes);
  await app.register(attachmentRoutes);
  // `/files/*` sert les fichiers utilisateur ; il est déclaré avant le repli
  // SPA pour qu'un fichier absent renvoie un 404 JSON et non `index.html`.
  await app.register(fileRoutes);

  await registerStatic(app);

  app.addHook('onClose', async () => {
    if (ownsDatabase) database.close();
  });

  return app;
}

/**
 * Sert le build front avec repli SPA : toute route inconnue qui n'est pas sous
 * `/api` renvoie `index.html`, pour que `/idees/mon-slug` fonctionne au
 * rechargement. Les 404 d'API restent du JSON.
 */
async function registerStatic(app) {
  const indexPath = join(config.webDist, 'index.html');
  const enabled = config.serveStatic ?? existsSync(indexPath);

  if (enabled && existsSync(indexPath)) {
    const fastifyStatic = (await import('@fastify/static')).default;
    // `wildcard` par défaut : @fastify/static résout chaque requête sur le disque.
    // Le désactiver ferait une photo du dossier au démarrage, et tout fichier
    // produit par un build ultérieur renverrait 404.
    await app.register(fastifyStatic, { root: config.webDist });
  } else if (enabled) {
    app.log.warn?.(`front introuvable dans ${config.webDist} — lancer \`npm run build\``);
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url.split('?')[0].startsWith('/api');
    const canServeSpa =
      enabled &&
      existsSync(indexPath) &&
      !isApi &&
      (request.method === 'GET' || request.method === 'HEAD');

    if (canServeSpa) return reply.type('text/html').sendFile('index.html');

    return reply.code(404).send({
      error: 'not_found',
      message: `Route inconnue : ${request.method} ${request.url}`,
    });
  });
}
