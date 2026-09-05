import { randomBytes } from 'node:crypto';

import { listAttachments } from './attachments-repo.js';
import { badRequest, notFound } from './errors.js';
import { findIdeaBySlug, serializeIdea } from './ideas-repo.js';

/**
 * Les sélections partagées, les avis d'amis et leurs listes de souhaits.
 *
 * La règle qui tient tout le fichier : **un avis d'ami n'est jamais un
 * verdict**. Rien ici ne lit `verdicts`, rien ici ne l'écrit, et aucune moyenne
 * ne mélange les deux. Elles répondent à deux questions différentes — « qu'en
 * pense Nathan » et « qu'en pensent ses amis » — et une moyenne des deux ne
 * répondrait plus à aucune.
 */

const now = () => new Date().toISOString();

/**
 * 32 octets d'aléa cryptographique en base64url : 43 caractères, 256 bits. Le
 * lien *est* le secret, il n'y a pas d'authentification derrière — un jeton
 * devinable serait la seule faille qui compte.
 */
export function newToken() {
  return randomBytes(32).toString('base64url');
}

// --- Sélections --------------------------------------------------------------

/** Les compteurs qu'affiche l'écran `/partages`, en une passe. */
const SHARE_COUNTS = `
  (SELECT COUNT(*) FROM share_ideas si WHERE si.share_id = s.id)                 AS idea_count,
  (SELECT COUNT(*) FROM reviews r WHERE r.share_id = s.id)                       AS review_count,
  (SELECT COUNT(*) FROM share_wishlists w WHERE w.share_id = s.id)               AS wishlist_count,
  (SELECT COUNT(DISTINCT v) FROM (
      SELECT r.visitor_id AS v FROM reviews r WHERE r.share_id = s.id
      UNION SELECT w.visitor_id FROM share_wishlists w WHERE w.share_id = s.id)) AS visitor_count
`;

const SELECT_SHARE = `SELECT s.*, ${SHARE_COUNTS} FROM shares s`;

export function serializeShare(row, { ideas = null } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    token: row.token,
    label: row.label,
    reviews_visible: row.reviews_visible === 1,
    created_at: row.created_at,
    expires_at: row.expires_at ?? null,
    revoked_at: row.revoked_at ?? null,
    /** Vivant = ni révoqué, ni expiré. C'est le seul état qui ouvre le lien. */
    active: isLive(row),
    idea_count: row.idea_count ?? 0,
    /** Un visiteur distinct : il a laissé un avis ou coché une liste de souhaits. */
    visitor_count: row.visitor_count ?? 0,
    review_count: row.review_count ?? 0,
    wishlist_count: row.wishlist_count ?? 0,
    ...(ideas ? { ideas } : {}),
  };
}

function isLive(row) {
  if (!row) return false;
  if (row.revoked_at) return false;
  return !(row.expires_at && row.expires_at <= now());
}

export function listShares(db) {
  const rows = db.prepare(`${SELECT_SHARE} ORDER BY s.created_at DESC, s.id DESC`).all();
  return rows.map((row) => serializeShare(row, { ideas: shareIdeas(db, row.id) }));
}

export function getShareOrFail(db, id) {
  const row = db.prepare(`${SELECT_SHARE} WHERE s.id = ?`).get(id);
  if (!row) throw notFound(`Aucune sélection n° ${id}.`);
  return serializeShare(row, { ideas: shareIdeas(db, row.id) });
}

/**
 * La sélection derrière un jeton, ou `null`. Un lien révoqué, un lien expiré et
 * un lien inconnu donnent le même `null` : l'appelant en fait un 404, et les
 * trois cas sont indiscernables de l'extérieur. C'est voulu — dire « ce lien a
 * été révoqué » confirmerait qu'il a existé.
 */
export function findLiveShareByToken(db, token) {
  const row = db.prepare(`${SELECT_SHARE} WHERE s.token = ?`).get(String(token ?? ''));
  return isLive(row) ? serializeShare(row) : null;
}

/** Les idées de la sélection, dans leur ordre. Corbeille exclue. */
export function shareIdeas(db, shareId) {
  const rows = db
    .prepare(
      `SELECT i.*, si.position AS share_position,
              c.path AS capsule_path,
              t.id   AS leading_trailer_id,
              t.path AS trailer_path,
              (SELECT COUNT(*) FROM attachments a WHERE a.idea_id = i.id) AS attachment_count,
              -- Les mêmes agrégats que le catalogue : l'écran des partages
              -- affiche, sélection par sélection, ce que chaque idée a récolté.
              -- Ils ne sortent pas côté invité : publicIdea ne les liste pas.
              (SELECT COUNT(*) FROM reviews r WHERE r.idea_id = i.id)         AS friend_review_count,
              (SELECT AVG(r.score) FROM reviews r WHERE r.idea_id = i.id)     AS friend_score_avg,
              (SELECT COUNT(*) FROM share_wishlists w WHERE w.idea_id = i.id) AS friend_wishlist_count
       FROM share_ideas si
       JOIN ideas i ON i.id = si.idea_id
       LEFT JOIN attachments c ON c.id = i.capsule_file_id
       LEFT JOIN attachments t ON t.id = COALESCE(
         i.trailer_file_id,
         (SELECT a.id FROM attachments a
           WHERE a.idea_id = i.id AND a.kind = 'trailer'
           ORDER BY a.position, a.id LIMIT 1))
       WHERE si.share_id = ? AND i.deleted_at IS NULL
       ORDER BY si.position, si.idea_id`,
    )
    .all(shareId);

  return rows.map((row) => ({ ...serializeIdea(row), share_position: row.share_position }));
}

/**
 * Ce qu'un invité a le droit de voir d'une idée.
 *
 * Liste blanche, comme les routes : on énumère ce qui sort, on ne retire pas ce
 * qui ne doit pas sortir. Un champ ajouté demain à `serializeIdea` reste donc
 * invisible pour un invité tant que personne ne l'a inscrit ici.
 *
 * Deux absences sont volontaires et importantes : `current_verdict`, le
 * jugement de Nathan, et `wishlisted_at`, **sa** liste de souhaits. Un ami ne
 * voit ni l'un ni l'autre — sinon la note qu'il donne n'est plus la sienne.
 */
export function publicIdea(idea) {
  if (!idea) return null;
  return {
    slug: idea.slug,
    title: idea.title,
    tagline: idea.tagline,
    pitch: idea.pitch,
    gif: idea.gif,
    price_cents: idea.price_cents,
    family: idea.family,
    status: idea.status,
    competition: idea.competition,
    capsule_file_id: idea.capsule_file_id,
    capsule_url: idea.capsule_url,
    trailer_file_id: idea.trailer_file_id,
    leading_trailer_id: idea.leading_trailer_id,
    trailer_url: idea.trailer_url,
    updated_at: idea.updated_at,
  };
}

/**
 * Les pièces jointes qu'un invité peut voir : les images et les
 * bandes-annonces, c'est-à-dire ce que la page store montre. Un markdown de
 * travail, un fichier joint ou un lien vers un Trello ne le regardent pas.
 */
export function publicAttachments(db, ideaId) {
  return listAttachments(db, ideaId).filter(
    (item) => item.kind === 'image' || item.kind === 'trailer',
  );
}

export function createShare(
  db,
  { label = '', idea_slugs = [], expires_at = null, reviews_visible = true } = {},
) {
  const ideas = idea_slugs.map((slug) => {
    const idea = findIdeaBySlug(db, slug);
    if (!idea) throw badRequest(`Aucune idée avec le slug « ${slug} ».`);
    return idea;
  });

  const info = db
    .prepare(
      `INSERT INTO shares (token, label, reviews_visible, created_at, expires_at)
       VALUES (@token, @label, @reviews_visible, @created_at, @expires_at)`,
    )
    .run({
      token: newToken(),
      label,
      reviews_visible: reviews_visible ? 1 : 0,
      created_at: now(),
      expires_at,
    });

  const id = Number(info.lastInsertRowid);
  setShareIdeas(db, id, ideas.map((idea) => idea.id));

  return getShareOrFail(db, id);
}

/** Remplace la sélection par la liste donnée, dans l'ordre donné. */
function setShareIdeas(db, shareId, ideaIds) {
  db.transaction(() => {
    db.prepare('DELETE FROM share_ideas WHERE share_id = ?').run(shareId);
    const insert = db.prepare(
      'INSERT INTO share_ideas (share_id, idea_id, position) VALUES (?, ?, ?)',
    );
    ideaIds.forEach((ideaId, position) => insert.run(shareId, ideaId, position));
  })();
}

export function updateShare(db, id, patch = {}) {
  const existing = db.prepare('SELECT * FROM shares WHERE id = ?').get(id);
  if (!existing) throw notFound(`Aucune sélection n° ${id}.`);

  const sets = [];
  const params = { id };

  if (Object.hasOwn(patch, 'label')) {
    sets.push('label = @label');
    params.label = patch.label;
  }
  if (Object.hasOwn(patch, 'reviews_visible')) {
    sets.push('reviews_visible = @reviews_visible');
    params.reviews_visible = patch.reviews_visible ? 1 : 0;
  }
  if (Object.hasOwn(patch, 'expires_at')) {
    sets.push('expires_at = @expires_at');
    params.expires_at = patch.expires_at || null;
  }
  if (Object.hasOwn(patch, 'revoked')) {
    sets.push('revoked_at = @revoked_at');
    // Révoquer et rouvrir passent par le même champ : une date, ou rien.
    params.revoked_at = patch.revoked ? now() : null;
  }

  if (sets.length) db.prepare(`UPDATE shares SET ${sets.join(', ')} WHERE id = @id`).run(params);

  if (Object.hasOwn(patch, 'idea_slugs')) {
    const ideaIds = patch.idea_slugs.map((slug) => {
      const idea = findIdeaBySlug(db, slug);
      if (!idea) throw badRequest(`Aucune idée avec le slug « ${slug} ».`);
      return idea.id;
    });
    setShareIdeas(db, id, ideaIds);
  }

  return getShareOrFail(db, id);
}

/**
 * Une idée de cette sélection, ou `null`. C'est cette fonction qui fait qu'un
 * slug existant mais hors sélection répond 404 : l'appartenance est vérifiée
 * dans la requête, elle n'est pas filtrée après coup.
 */
export function findShareIdea(db, shareId, slug) {
  const row = db
    .prepare(
      `SELECT i.id FROM share_ideas si
       JOIN ideas i ON i.id = si.idea_id
       WHERE si.share_id = ? AND i.slug = ? AND i.deleted_at IS NULL`,
    )
    .get(shareId, String(slug ?? ''));

  return row ? findIdeaBySlug(db, slug) : null;
}

// --- Avis --------------------------------------------------------------------

const SELECT_REVIEW = `
  SELECT r.id, r.idea_id, r.share_id, r.author_name, r.score, r.note,
         r.created_at, r.updated_at, s.label AS share_label, i.slug AS idea_slug
  FROM reviews r
  LEFT JOIN shares s ON s.id = r.share_id
  JOIN ideas i ON i.id = r.idea_id
`;

/**
 * Un avis tel qu'il sort de l'API. `visitor_id` et `ip_hash` n'en font jamais
 * partie : le premier permettrait d'usurper la correction d'un avis, le second
 * n'a de sens que pour le débit.
 */
function serializeReview(row, { own = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    idea_slug: row.idea_slug,
    author_name: row.author_name,
    score: row.score,
    note: row.note ?? '',
    created_at: row.created_at,
    updated_at: row.updated_at ?? null,
    /** De quelle sélection vient l'avis. `null` si elle a été supprimée depuis. */
    share_label: row.share_label ?? null,
    share_id: row.share_id ?? null,
    /** Vrai quand c'est l'avis du visiteur qui demande — lui seul peut le corriger. */
    own,
  };
}

/** Les avis d'une idée, du plus récent au plus ancien. */
export function listReviews(db, ideaId) {
  return db
    .prepare(`${SELECT_REVIEW} WHERE r.idea_id = ? ORDER BY r.created_at DESC, r.id DESC`)
    .all(ideaId)
    .map((row) => serializeReview(row));
}

/** Idem, en marquant l'avis du visiteur : la page invité doit le pré-remplir. */
export function listReviewsForVisitor(db, ideaId, visitorId) {
  const rows = db
    .prepare(`${SELECT_REVIEW} WHERE r.idea_id = ? ORDER BY r.created_at DESC, r.id DESC`)
    .all(ideaId);

  const ownRow = db
    .prepare('SELECT id FROM reviews WHERE idea_id = ? AND visitor_id = ?')
    .get(ideaId, String(visitorId ?? ''));

  return rows.map((row) => serializeReview(row, { own: row.id === ownRow?.id }));
}

/**
 * Dépose ou corrige un avis. Un visiteur a **un** avis par idée : déposer deux
 * fois, c'est corriger — l'index unique `(idea_id, visitor_id)` le garantit, et
 * la mise à jour ne s'applique qu'à la ligne de ce `visitor_id`. Un autre
 * visiteur ne peut donc pas toucher l'avis de son voisin : il n'écrit jamais
 * sur la même ligne, il en crée une à lui.
 *
 * **Rien d'autre n'est écrit.** Ni `verdicts`, ni `ideas` : `updated_at` d'une
 * idée ne bouge pas parce qu'un ami l'a notée.
 */
export function upsertReview(db, { ideaId, shareId, visitorId, authorName, score, note, ipHash }) {
  const existing = db
    .prepare('SELECT id FROM reviews WHERE idea_id = ? AND visitor_id = ?')
    .get(ideaId, visitorId);

  if (existing) {
    db.prepare(
      `UPDATE reviews SET author_name = @author_name, score = @score, note = @note,
                          share_id = @share_id, updated_at = @updated_at, ip_hash = @ip_hash
       WHERE id = @id`,
    ).run({
      id: existing.id,
      author_name: authorName,
      score,
      note,
      share_id: shareId,
      updated_at: now(),
      ip_hash: ipHash,
    });
  } else {
    db.prepare(
      `INSERT INTO reviews (idea_id, share_id, author_name, score, note, created_at, visitor_id, ip_hash)
       VALUES (@idea_id, @share_id, @author_name, @score, @note, @created_at, @visitor_id, @ip_hash)`,
    ).run({
      idea_id: ideaId,
      share_id: shareId,
      author_name: authorName,
      score,
      note,
      created_at: now(),
      visitor_id: visitorId,
      ip_hash: ipHash,
    });
  }

  const row = db
    .prepare(`${SELECT_REVIEW} WHERE r.idea_id = ? AND r.visitor_id = ?`)
    .get(ideaId, visitorId);
  return serializeReview(row, { own: true });
}

/** Modération : Nathan supprime un avis. C'est le seul geste destructif du lot. */
export function deleteReview(db, id) {
  const row = db.prepare(`${SELECT_REVIEW} WHERE r.id = ?`).get(id);
  if (!row) throw notFound(`Aucun avis n° ${id}.`);
  db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
  return serializeReview(row);
}

// --- Liste de souhaits des invités -------------------------------------------

/** La liste de souhaits **du visiteur**, pas celle de Nathan. */
export function setShareWishlist(db, { shareId, ideaId, visitorId, wishlisted }) {
  if (wishlisted) {
    db.prepare(
      `INSERT OR IGNORE INTO share_wishlists (share_id, idea_id, visitor_id, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(shareId, ideaId, visitorId, now());
  } else {
    db.prepare(
      'DELETE FROM share_wishlists WHERE share_id = ? AND idea_id = ? AND visitor_id = ?',
    ).run(shareId, ideaId, visitorId);
  }

  return { wishlisted: Boolean(wishlisted) };
}

export function isShareWishlisted(db, shareId, ideaId, visitorId) {
  if (!visitorId) return false;
  const row = db
    .prepare('SELECT 1 FROM share_wishlists WHERE share_id = ? AND idea_id = ? AND visitor_id = ?')
    .get(shareId, ideaId, String(visitorId));
  return Boolean(row);
}

/**
 * Le récapitulatif de fin de sélection : ce que ce visiteur a noté, ce qu'il a
 * souhaité. Lu depuis la base et non depuis le navigateur — un récapitulatif
 * qui compte ce que le navigateur croit avoir envoyé ne prouve rien.
 */
export function visitorSummary(db, shareId, visitorId) {
  if (!visitorId) return { reviews: [], wishlisted: [] };

  const reviews = db
    .prepare(
      `SELECT r.score, r.note, r.author_name, r.created_at, r.updated_at,
              i.slug AS idea_slug, i.title
       FROM reviews r
       JOIN ideas i ON i.id = r.idea_id
       JOIN share_ideas si ON si.idea_id = r.idea_id AND si.share_id = @share
       WHERE r.visitor_id = @visitor
       ORDER BY si.position, si.idea_id`,
    )
    .all({ share: shareId, visitor: visitorId });

  const wishlisted = db
    .prepare(
      `SELECT i.slug AS idea_slug, i.title
       FROM share_wishlists w
       JOIN ideas i ON i.id = w.idea_id
       JOIN share_ideas si ON si.idea_id = w.idea_id AND si.share_id = w.share_id
       WHERE w.share_id = @share AND w.visitor_id = @visitor
       ORDER BY si.position, si.idea_id`,
    )
    .all({ share: shareId, visitor: visitorId });

  return { reviews, wishlisted };
}

// --- Fichiers ----------------------------------------------------------------

/**
 * Un invité a-t-il le droit de lire ce fichier ?
 *
 * Une requête `/files/*` ne porte pas de jeton — c'est le navigateur qui la
 * fait, depuis un `<img>` ou un `<video>`, et rien ne l'accompagne. Le droit ne
 * peut donc pas être « ce fichier appartient à *ta* sélection » mais « ce
 * fichier appartient à une idée d'une sélection **vivante** ». C'est exactement
 * l'ensemble des fichiers qu'un invité peut atteindre par ailleurs : la
 * permission ne s'élargit pas, elle se formule autrement.
 *
 * Le chemin est comparé à la colonne `path` telle qu'elle est en base, jamais
 * déduit du dossier : un fichier orphelin resté sur le disque n'est donc servi
 * à personne.
 */
export function guestCanReadFile(db, relativePath) {
  const path = String(relativePath ?? '').replace(/\\/g, '/');
  if (!path) return false;

  const row = db
    .prepare(
      `SELECT 1
       FROM attachments a
       JOIN ideas i        ON i.id = a.idea_id AND i.deleted_at IS NULL
       JOIN share_ideas si ON si.idea_id = i.id
       JOIN shares s       ON s.id = si.share_id
       WHERE a.path = ?
         AND s.revoked_at IS NULL
         AND (s.expires_at IS NULL OR s.expires_at > ?)
       LIMIT 1`,
    )
    .get(path, now());

  return Boolean(row);
}
