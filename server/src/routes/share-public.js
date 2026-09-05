import { config } from '../config.js';
import { HttpError, notFound } from '../errors.js';
import { findFamily } from '../families-repo.js';
import { guestReviewBody, guestWishlistBody } from '../schemas.js';
import {
  findLiveShareByToken,
  findShareIdea,
  isShareWishlisted,
  listReviewsForVisitor,
  publicAttachments,
  publicIdea,
  setShareWishlist,
  shareIdeas,
  upsertReview,
  visitorSummary,
} from '../shares-repo.js';

/**
 * Les quatre routes ouvertes au visiteur, et rien d'autre. La liste blanche de
 * `access.js` les nomme une à une ; ce fichier est le seul endroit du serveur
 * où du code s'exécute pour quelqu'un qui n'est pas Nathan.
 *
 * Trois principes s'appliquent à chaque ligne :
 *
 * - **Rien qui ne soit dans la sélection.** Un slug qui existe mais n'y est pas
 *   répond 404, comme un slug qui n'existe pas.
 * - **Rien de Nathan.** Ni verdict, ni sa liste de souhaits, ni le nombre
 *   d'idées qu'il a par ailleurs : `publicIdea` énumère ce qui sort.
 * - **Aucun détail d'erreur.** Un lien inconnu, révoqué ou expiré donnent le
 *   même 404, avec le même message.
 */

/** Le message unique. Trois causes, une phrase : elles doivent être indistinguables. */
const DEAD_LINK = 'Ce lien n’est plus valable.';

/**
 * L'identifiant du visiteur voyage par en-tête et non par la query : une URL se
 * copie, se colle et se retrouve dans un journal, un en-tête non.
 */
const VISITOR_HEADER = 'x-vitrine-visitor';

/** Même motif que le corps des formulaires : ailleurs, on ignore. */
const VISITOR_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function visitorOf(request) {
  const raw = request.headers[VISITOR_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && VISITOR_PATTERN.test(value) ? value : null;
}

/** La sélection derrière le jeton, ou 404. Aucune autre issue. */
function shareOrDead(db, token) {
  const raw = String(token ?? '');
  const share = raw.length <= 64 ? findLiveShareByToken(db, raw) : null;
  if (!share) throw notFound(DEAD_LINK);
  return share;
}

export default async function sharePublicRoutes(app) {
  const { db } = app;

  /**
   * La sélection et ses idées. C'est aussi cette route qui porte le
   * récapitulatif de fin : le visiteur y lit ce qu'il a noté et souhaité, tel
   * que la base le connaît — et non tel que son navigateur croit l'avoir
   * envoyé. Ouvrir une cinquième route pour ça aurait élargi la liste blanche
   * pour une lecture qu'on a déjà sous la main.
   */
  app.get('/api/share/:token', async (request, reply) => {
    const share = shareOrDead(db, request.params.token);
    const visitor = visitorOf(request);

    noStore(reply);

    return {
      share: {
        label: share.label,
        reviews_visible: share.reviews_visible,
      },
      developer_name: config.developerName,
      ideas: shareIdeas(db, share.id).map(publicIdea),
      /** Vide tant que le visiteur ne s'est pas nommé : il n'a encore rien fait. */
      summary: visitorSummary(db, share.id, visitor),
    };
  });

  /** Une idée de la sélection : tout ce que la page store a besoin d'afficher. */
  app.get('/api/share/:token/ideas/:slug', async (request, reply) => {
    const share = shareOrDead(db, request.params.token);
    const idea = findShareIdea(db, share.id, request.params.slug);
    // Hors sélection = introuvable. Le message est celui d'une idée absente :
    // il ne dit pas « elle existe, mais pas pour toi ».
    if (!idea) throw notFound('Cette page n’existe pas.');

    const visitor = visitorOf(request);
    const reviews = listReviewsForVisitor(db, idea.id, visitor);

    noStore(reply);

    return {
      share: { label: share.label, reviews_visible: share.reviews_visible },
      developer_name: config.developerName,
      idea: publicIdea(idea),
      /** La famille est jointe ici : `/api/families` n'est pas ouvert aux invités. */
      family: findFamily(db, idea.family),
      attachments: publicAttachments(db, idea.id),
      /**
       * Les avis des autres ne sortent que si la sélection le permet. Celui du
       * visiteur sort toujours : c'est le sien, il doit pouvoir le corriger même
       * quand les avis sont masqués.
       */
      reviews: share.reviews_visible ? reviews : reviews.filter((review) => review.own),
      my_review: reviews.find((review) => review.own) ?? null,
      wishlisted: isShareWishlisted(db, share.id, idea.id, visitor),
    };
  });

  /**
   * Déposer — ou corriger — un avis. La correction n'est pas une route à part :
   * un visiteur a un avis par idée, le déposer deux fois le remplace, et
   * l'index unique `(idea_id, visitor_id)` fait que personne ne remplace celui
   * d'un autre.
   */
  app.post(
    '/api/share/:token/reviews',
    { schema: { body: guestReviewBody } },
    async (request, reply) => {
      const share = shareOrDead(db, request.params.token);
      const idea = findShareIdea(db, share.id, request.body.slug);
      if (!idea) throw notFound('Cette page n’existe pas.');

      const ipHash = throttle(app, request);

      const review = upsertReview(db, {
        ideaId: idea.id,
        shareId: share.id,
        visitorId: request.body.visitor_id,
        authorName: cleanName(request.body.author_name),
        score: request.body.score,
        note: String(request.body.note ?? '').trim(),
        ipHash,
      });

      noStore(reply);
      reply.code(201);

      const reviews = listReviewsForVisitor(db, idea.id, request.body.visitor_id);
      return {
        my_review: review,
        reviews: share.reviews_visible ? reviews : reviews.filter((item) => item.own),
      };
    },
  );

  /** La liste de souhaits **du visiteur**. Celle de Nathan n'est pas touchée. */
  app.post(
    '/api/share/:token/wishlist',
    { schema: { body: guestWishlistBody } },
    async (request, reply) => {
      const share = shareOrDead(db, request.params.token);
      const idea = findShareIdea(db, share.id, request.body.slug);
      if (!idea) throw notFound('Cette page n’existe pas.');

      throttle(app, request);

      noStore(reply);

      return setShareWishlist(db, {
        shareId: share.id,
        ideaId: idea.id,
        visitorId: request.body.visitor_id,
        wishlisted: request.body.wishlisted,
      });
    },
  );
}

/**
 * La limite de débit, comptée sur le hachage de l'adresse source. Renvoie ce
 * hachage : c'est celui qu'on enregistre avec l'avis, et il n'est calculé
 * qu'une fois.
 */
function throttle(app, request) {
  const ipHash = app.ipHash(request.socket?.remoteAddress);
  const verdict = app.guestLimit.take(ipHash);

  if (!verdict.allowed) {
    throw new HttpError(
      429,
      'too_many_requests',
      `Trop d’envois d’affilée. Réessaie dans ${Math.ceil(verdict.retryAfter / 60)} minute(s).`,
    );
  }

  return ipHash;
}

/** Un prénom, pas un paragraphe. Vide, il devient « Anonyme » à l'affichage. */
function cleanName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/**
 * Ces réponses dépendent de l'en-tête du visiteur et changent à chaque envoi :
 * un cache intermédiaire qui les garderait servirait l'avis d'un ami à un autre.
 */
function noStore(reply) {
  reply.header('Cache-Control', 'no-store');
}
