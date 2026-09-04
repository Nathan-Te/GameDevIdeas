import { rm } from 'node:fs/promises';

import { resolveInsideFiles } from '../files.js';
import {
  createIdea,
  createVerdict,
  getIdeaBySlugOrFail,
  listIdeas,
  listVerdicts,
  purgeIdea,
  restoreIdea,
  softDeleteIdea,
  updateIdea,
} from '../ideas-repo.js';
import {
  createIdeaBody,
  createVerdictBody,
  ideaSlugParams,
  listIdeasQuery,
  patchIdeaBody,
} from '../schemas.js';

/**
 * Routes JSON de l'idée et de ses verdicts. Les pièces jointes ont les leurs
 * (`routes/attachments.js`) ; `PATCH /api/ideas/:slug` accepte `capsule_file_id`
 * depuis le lot 2.
 */
export default async function ideaRoutes(app) {
  const { db } = app;

  app.get('/api/ideas', { schema: { querystring: listIdeasQuery } }, async (request) => ({
    ideas: listIdeas(db, request.query),
  }));

  app.post('/api/ideas', { schema: { body: createIdeaBody } }, async (request, reply) => {
    const idea = createIdea(db, request.body ?? {});
    reply.code(201);
    return idea;
  });

  app.get('/api/ideas/:slug', { schema: { params: ideaSlugParams } }, async (request) =>
    getIdeaBySlugOrFail(db, request.params.slug),
  );

  app.patch(
    '/api/ideas/:slug',
    { schema: { params: ideaSlugParams, body: patchIdeaBody } },
    async (request) => updateIdea(db, request.params.slug, request.body),
  );

  app.delete('/api/ideas/:slug', { schema: { params: ideaSlugParams } }, async (request) =>
    softDeleteIdea(db, request.params.slug),
  );

  /**
   * Sort une idée de la corbeille. Sans interface au lot 2 — elle arrive au
   * lot 3 — mais la route existe : une suppression redevient annulable sans
   * ouvrir la base à la main.
   */
  app.post('/api/ideas/:slug/restore', { schema: { params: ideaSlugParams } }, async (request) =>
    restoreIdea(db, request.params.slug),
  );

  /**
   * Suppression définitive. La base part en premier, dans une transaction, et
   * le dossier `data/files/{idea_id}/` en entier ensuite — jamais l'inverse, et
   * jamais l'un sans l'autre. Si l'effacement disque échoue, la base reste
   * cohérente et le dossier orphelin est signalé, dans le journal et dans la
   * réponse : un fichier orphelin ne se voit pas, autant le dire.
   */
  app.delete('/api/ideas/:slug/purge', { schema: { params: ideaSlugParams } }, async (request) => {
    const { idea, files } = purgeIdea(db, request.params.slug);

    const directory = resolveInsideFiles(String(idea.id));
    let orphanDirectory = false;

    if (directory) {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (err) {
        orphanDirectory = true;
        request.log.warn(
          { err, directory },
          'purge : la base est à jour mais le dossier de fichiers n’a pas pu être effacé',
        );
      }
    }

    return {
      purged: idea,
      /** Nombre de fichiers que la purge emporte, pour l'affichage du front. */
      files_removed: files.length,
      /** `true` = la base est propre mais le dossier est resté sur le disque. */
      orphan_directory: orphanDirectory,
    };
  });

  app.get('/api/ideas/:slug/verdicts', { schema: { params: ideaSlugParams } }, async (request) => {
    const idea = getIdeaBySlugOrFail(db, request.params.slug);
    return { verdicts: listVerdicts(db, idea.id) };
  });

  app.post(
    '/api/ideas/:slug/verdicts',
    { schema: { params: ideaSlugParams, body: createVerdictBody } },
    async (request, reply) => {
      const idea = getIdeaBySlugOrFail(db, request.params.slug);
      const verdict = createVerdict(db, idea.id, request.body);
      reply.code(201);
      return verdict;
    },
  );
}
