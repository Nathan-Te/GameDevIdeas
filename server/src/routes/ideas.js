import {
  createIdea,
  createVerdict,
  getIdeaBySlugOrFail,
  listIdeas,
  listVerdicts,
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
 * Routes JSON du lot 1. Aucune route ne sert `attachments` ni `capsule_file_id` :
 * les pièces jointes sont le lot 2, seul le schéma de base les anticipe.
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
