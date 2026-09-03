import {
  createIdea,
  createVerdict,
  getIdeaBySlugOrFail,
  listIdeas,
  listVerdicts,
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
