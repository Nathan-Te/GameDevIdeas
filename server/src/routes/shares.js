import { getIdeaBySlugOrFail } from '../ideas-repo.js';
import {
  createShareBody,
  ideaSlugParams,
  patchShareBody,
  reviewIdParams,
  shareIdParams,
} from '../schemas.js';
import {
  createShare,
  deleteReview,
  getShareOrFail,
  listReviews,
  listShares,
  updateShare,
} from '../shares-repo.js';

/**
 * Le côté Nathan du partage : créer une sélection, la modifier, la révoquer,
 * lire les avis reçus et en supprimer un.
 *
 * Aucune de ces routes n'est ouverte au visiteur — elles ne sont pas dans la
 * liste blanche de `access.js`, donc elles répondent 404 à qui n'est pas sur le
 * tailnet, sans que ce fichier ait à s'en occuper. C'est tout l'intérêt d'une
 * liste blanche : la fermeture n'est pas une ligne à ne pas oublier ici.
 */
export default async function shareRoutes(app) {
  const { db } = app;

  app.get('/api/shares', async () => ({ shares: listShares(db) }));

  app.post('/api/shares', { schema: { body: createShareBody } }, async (request, reply) => {
    const share = createShare(db, normalizeExpiry(request.body ?? {}));
    reply.code(201);
    return share;
  });

  app.get('/api/shares/:id', { schema: { params: shareIdParams } }, async (request) =>
    getShareOrFail(db, request.params.id),
  );

  app.patch(
    '/api/shares/:id',
    { schema: { params: shareIdParams, body: patchShareBody } },
    async (request) => updateShare(db, request.params.id, normalizeExpiry(request.body)),
  );

  /**
   * Révoquer. Une route à elle plutôt qu'un champ de PATCH : c'est le geste
   * qu'on cherche en urgence, et il ne doit pas dépendre d'un corps bien formé.
   *
   * La sélection n'est pas supprimée. Les avis déjà reçus gardent d'où ils
   * viennent, et le lien répond 404 comme s'il n'avait jamais existé.
   */
  app.post('/api/shares/:id/revoke', { schema: { params: shareIdParams } }, async (request) =>
    updateShare(db, request.params.id, { revoked: true }),
  );

  /** Les avis d'amis reçus sur une idée. Jamais mélangés aux verdicts. */
  app.get('/api/ideas/:slug/reviews', { schema: { params: ideaSlugParams } }, async (request) => {
    const idea = getIdeaBySlugOrFail(db, request.params.slug);
    return { reviews: listReviews(db, idea.id) };
  });

  /** Modération : un avis part, et rien d'autre ne bouge. */
  app.delete('/api/reviews/:id', { schema: { params: reviewIdParams } }, async (request) =>
    deleteReview(db, request.params.id),
  );
}

/**
 * « 2026-12-31 » saisi dans un champ date devient la fin de cette journée-là.
 * Sans ça, un lien donné pour valable jusqu'au 31 se fermerait le 31 à minuit,
 * c'est-à-dire la veille au soir pour qui l'a lu.
 */
function normalizeExpiry(body) {
  if (!Object.hasOwn(body, 'expires_at') || !body.expires_at) return body;

  const value = String(body.expires_at);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { ...body, expires_at: new Date(`${value}T23:59:59.999Z`).toISOString() };
  }

  const parsed = new Date(value);
  return { ...body, expires_at: Number.isNaN(parsed.getTime()) ? null : parsed.toISOString() };
}
