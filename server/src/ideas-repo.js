import { assertUsableAsCapsule, assertUsableAsTrailer } from './attachments-repo.js';
import { notFound } from './errors.js';
import { assertFamilyExists } from './families-repo.js';
import { fileUrl } from './files.js';
import { isDerivedFrom, uniqueSlug } from './slug.js';

export const DEFAULT_TITLE = 'Sans titre';

/** Champs de l'idée qu'un POST/PATCH peut écrire, hors `slug` (traité à part). */
const WRITABLE = ['title', 'tagline', 'pitch', 'gif', 'price_cents', 'family', 'status', 'competition'];

const now = () => new Date().toISOString();

/**
 * Le verdict courant est le plus récent. `id DESC` départage deux verdicts
 * enregistrés dans la même milliseconde.
 */
const CURRENT_VERDICT_JOIN = `
  LEFT JOIN verdicts v ON v.id = (
    SELECT v2.id FROM verdicts v2
    WHERE v2.idea_id = i.id
    ORDER BY v2.created_at DESC, v2.id DESC
    LIMIT 1
  )
`;

/**
 * La capsule est jointe ici plutôt que résolue par une seconde requête : le
 * catalogue affiche cinquante capsules d'un coup et ne doit pas faire cinquante
 * allers-retours.
 */
const CAPSULE_JOIN = 'LEFT JOIN attachments c ON c.id = i.capsule_file_id';

/**
 * Même raison pour la bande-annonce : le catalogue la joue au survol des
 * cartes, donc il lui faut son adresse dans la même requête que la capsule.
 *
 * Une idée peut porter plusieurs bandes-annonces — la visionneuse du store les
 * enchaîne toutes, comme un magasin. Celle **en tête** est celle que Nathan a
 * désignée ; à défaut, la première dans l'ordre des pièces jointes. Sans ce
 * repli, déposer une vidéo ne suffirait pas : il faudrait aussi penser à
 * cliquer « mettre en tête » pour que le catalogue la joue au survol.
 *
 * La règle est écrite ici, une fois : le front lit `leading_trailer_id`, il ne
 * la recalcule pas.
 */
const TRAILER_JOIN = `
  LEFT JOIN attachments t ON t.id = COALESCE(
    i.trailer_file_id,
    (SELECT a.id FROM attachments a
      WHERE a.idea_id = i.id AND a.kind = 'trailer'
      ORDER BY a.position, a.id
      LIMIT 1)
  )
`;

const SELECT_IDEA = `
  SELECT i.*,
         v.id         AS verdict_id,
         v.score      AS verdict_score,
         v.note       AS verdict_note,
         v.created_at AS verdict_created_at,
         c.path       AS capsule_path,
         t.id         AS leading_trailer_id,
         t.path       AS trailer_path,
         (SELECT COUNT(*) FROM attachments a WHERE a.idea_id = i.id) AS attachment_count,
         (SELECT COUNT(*) FROM reviews r WHERE r.idea_id = i.id)        AS friend_review_count,
         (SELECT AVG(r.score) FROM reviews r WHERE r.idea_id = i.id)    AS friend_score_avg,
         (SELECT COUNT(*) FROM share_wishlists w WHERE w.idea_id = i.id) AS friend_wishlist_count
  FROM ideas i
  ${CURRENT_VERDICT_JOIN}
  ${CAPSULE_JOIN}
  ${TRAILER_JOIN}
`;

/** Sépare la ligne SQL plate en idée + verdict courant imbriqué. */
export function serializeIdea(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    pitch: row.pitch,
    gif: row.gif,
    price_cents: row.price_cents,
    family: row.family,
    status: row.status,
    competition: row.competition,
    capsule_file_id: row.capsule_file_id,
    /** La bande-annonce **désignée**, ou `null` si Nathan n'en a désigné aucune. */
    trailer_file_id: row.trailer_file_id ?? null,
    /**
     * Celle qui est réellement en tête : la désignée, ou à défaut la première
     * pièce `trailer` de l'idée. C'est elle que joue le catalogue au survol et
     * qui ouvre la visionneuse du store.
     */
    leading_trailer_id: row.leading_trailer_id ?? null,
    /**
     * Date de mise en liste de souhaits, `null` sinon. Servie partout où une
     * idée est servie : le catalogue marque ses cartes, la vue store dessine
     * son bouton, et aucun des deux n'a besoin d'un second appel.
     */
    wishlisted_at: row.wishlisted_at ?? null,
    /** Adresse de l'image de capsule, nulle tant qu'aucune n'est choisie. */
    capsule_url: fileUrl(row.capsule_path),
    /**
     * Adresse de la bande-annonce en tête. Servie partout où une idée l'est :
     * le catalogue la joue au survol, la vue store ouvre dessus.
     */
    trailer_url: fileUrl(row.trailer_path),
    /** Nombre de pièces jointes : la corbeille annonce ce qu'une purge emporte. */
    attachment_count: row.attachment_count ?? 0,
    /**
     * Les avis d'amis, agrégés — **et jamais mêlés au verdict**. Ce sont deux
     * colonnes du catalogue et deux tris, pas une note unique : additionner le
     * jugement de Nathan et celui de ses amis ne donnerait le jugement de
     * personne.
     */
    friend_review_count: row.friend_review_count ?? 0,
    /** Moyenne sur 5, arrondie au dixième. `null` tant qu'aucun ami n'a noté. */
    friend_score_avg:
      row.friend_score_avg === null || row.friend_score_avg === undefined
        ? null
        : Math.round(row.friend_score_avg * 10) / 10,
    /** Combien d'amis l'ont mise dans **leur** liste de souhaits. */
    friend_wishlist_count: row.friend_wishlist_count ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    current_verdict: row.verdict_id
      ? {
          id: row.verdict_id,
          score: row.verdict_score,
          note: row.verdict_note,
          created_at: row.verdict_created_at,
        }
      : null,
  };
}

export function listIdeas(
  db,
  { family, status, minScore, wishlisted, sort = 'updated', deleted = false } = {},
) {
  const where = [deleted ? 'i.deleted_at IS NOT NULL' : 'i.deleted_at IS NULL'];
  const params = {};

  if (family) {
    where.push('i.family = @family');
    params.family = family;
  }
  if (status) {
    where.push('i.status = @status');
    params.status = status;
  }
  if (minScore !== undefined && minScore !== null) {
    // Filtrer sur le score courant écarte de fait les idées jamais jugées :
    // « au moins 3 » ne peut pas être vrai d'une idée sans verdict.
    where.push('v.score >= @minScore');
    params.minScore = minScore;
  }
  if (wishlisted !== undefined) {
    // Filtre à trois états : absent = tout, `true` = la liste de souhaits,
    // `false` = ce qui n'y est pas. Le catalogue n'utilise que les deux
    // premiers, mais un filtre booléen qui ne sait pas dire « non » est un
    // piège qu'on se tend à soi-même.
    where.push(wishlisted ? 'i.wishlisted_at IS NOT NULL' : 'i.wishlisted_at IS NULL');
  }

  const order = {
    updated: 'i.updated_at DESC, i.id DESC',
    created: 'i.created_at DESC, i.id DESC',
    // Une idée sans verdict n'a pas de score : elle passe en fin de liste.
    score: 'v.score IS NULL, v.score DESC, i.updated_at DESC',
    title: 'i.title COLLATE NOCASE ASC, i.id ASC',
    // Les deux tris du lot 7 : c'est le classement que Nathan cherche. Une idée
    // que personne n'a notée n'a pas de moyenne — elle passe en fin de liste,
    // comme une idée sans verdict pour le tri par score.
    'friends-score': 'friend_score_avg IS NULL, friend_score_avg DESC, friend_review_count DESC, i.updated_at DESC',
    'friends-wishlist': 'friend_wishlist_count DESC, i.updated_at DESC, i.id DESC',
  }[sort] || 'i.updated_at DESC, i.id DESC';

  const rows = db
    .prepare(`${SELECT_IDEA} WHERE ${where.join(' AND ')} ORDER BY ${order}`)
    .all(params);

  return rows.map(serializeIdea);
}

export function findIdeaBySlug(db, slug, { includeDeleted = false } = {}) {
  const row = db
    .prepare(
      `${SELECT_IDEA} WHERE i.slug = @slug ${includeDeleted ? '' : 'AND i.deleted_at IS NULL'}`,
    )
    .get({ slug });
  return serializeIdea(row);
}

export function getIdeaBySlugOrFail(db, slug, options) {
  const idea = findIdeaBySlug(db, slug, options);
  if (!idea) throw notFound(`Aucune idée avec le slug « ${slug} ».`);
  return idea;
}

export function createIdea(db, input = {}) {
  if (input.family !== undefined) assertFamilyExists(db, input.family);

  const title = input.title ?? DEFAULT_TITLE;
  /**
   * Sans famille demandée : « autre », tant qu'elle existe. Elle peut avoir été
   * renommée ou supprimée depuis `/familles` — on retombe alors sur la première
   * de la liste, parce qu'une idée créée avec une famille inexistante n'aurait
   * ni étiquettes ni fonctionnalités.
   */
  const defaultFamily = db
    .prepare("SELECT slug FROM families ORDER BY slug <> 'autre', position, id LIMIT 1")
    .get();
  const slug = uniqueSlug(db, input.slug || title);
  const timestamp = now();

  const values = {
    slug,
    title,
    tagline: input.tagline ?? '',
    pitch: input.pitch ?? '',
    gif: input.gif ?? '',
    price_cents: input.price_cents ?? null,
    family: input.family ?? defaultFamily?.slug ?? 'autre',
    status: input.status ?? 'idee',
    competition: input.competition ?? '',
    created_at: timestamp,
    updated_at: timestamp,
  };

  const info = db
    .prepare(
      `INSERT INTO ideas (slug, title, tagline, pitch, gif, price_cents, family, status,
                          competition, created_at, updated_at)
       VALUES (@slug, @title, @tagline, @pitch, @gif, @price_cents, @family, @status,
               @competition, @created_at, @updated_at)`,
    )
    .run(values);

  return serializeIdea(
    db.prepare(`${SELECT_IDEA} WHERE i.id = ?`).get(info.lastInsertRowid),
  );
}

/**
 * Mise à jour partielle, champ par champ : seules les clés présentes dans
 * `patch` sont écrites.
 *
 * Le slug suit le titre tant que Nathan ne l'a pas personnalisé. Sans cela, une
 * idée créée « Sans titre » puis renommée garderait l'URL `/idees/sans-titre-7`
 * pour toujours. Dès qu'un slug est posé explicitement par un PATCH, il devient
 * figé et le titre ne le touche plus.
 */
export function updateIdea(db, slug, patch = {}) {
  const existing = getIdeaBySlugOrFail(db, slug);

  const sets = [];
  const params = { id: existing.id };

  if (Object.hasOwn(patch, 'family')) assertFamilyExists(db, patch.family);

  for (const field of WRITABLE) {
    if (Object.hasOwn(patch, field)) {
      sets.push(`${field} = @${field}`);
      params[field] = patch[field];
    }
  }

  /**
   * `wishlisted` est un booléen à l'entrée, une date en base. Rebasculer une
   * idée déjà en liste réécrit la date : c'est un geste, pas un état à
   * préserver, et sa date la plus récente est la seule qui raconte quelque
   * chose.
   */
  if (Object.hasOwn(patch, 'wishlisted')) {
    sets.push('wishlisted_at = @wishlisted_at');
    params.wishlisted_at = patch.wishlisted ? now() : null;
  }

  if (Object.hasOwn(patch, 'capsule_file_id')) {
    if (patch.capsule_file_id !== null) {
      assertUsableAsCapsule(db, existing.id, patch.capsule_file_id);
    }
    sets.push('capsule_file_id = @capsule_file_id');
    params.capsule_file_id = patch.capsule_file_id;
  }

  if (Object.hasOwn(patch, 'trailer_file_id')) {
    if (patch.trailer_file_id !== null) {
      assertUsableAsTrailer(db, existing.id, patch.trailer_file_id);
    }
    sets.push('trailer_file_id = @trailer_file_id');
    params.trailer_file_id = patch.trailer_file_id;
  }

  const renamingTitle = Object.hasOwn(patch, 'title') && patch.title !== existing.title;
  const explicitSlug = Object.hasOwn(patch, 'slug');

  if (explicitSlug) {
    params.slug = uniqueSlug(db, patch.slug, { exceptId: existing.id });
    sets.push('slug = @slug');
  } else if (renamingTitle && isDerivedFrom(existing.slug, existing.title)) {
    params.slug = uniqueSlug(db, patch.title, { exceptId: existing.id });
    sets.push('slug = @slug');
  }

  if (sets.length) {
    /**
     * Mettre une idée en liste de souhaits n'est pas modifier sa fiche : le
     * catalogue trié par mise à jour ne doit pas se réordonner sous la souris
     * parce qu'on a cliqué un bouton dans la vue store. Un patch qui ne porte
     * que `wishlisted` laisse donc `updated_at` tranquille.
     */
    if (sets.some((set) => !set.startsWith('wishlisted_at'))) {
      params.updated_at = now();
      sets.push('updated_at = @updated_at');
    }
    db.prepare(`UPDATE ideas SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }

  return serializeIdea(db.prepare(`${SELECT_IDEA} WHERE i.id = ?`).get(existing.id));
}

/** Soft delete : l'idée part en corbeille. `restoreIdea` fait le chemin inverse. */
export function softDeleteIdea(db, slug) {
  const existing = getIdeaBySlugOrFail(db, slug);
  const timestamp = now();
  db.prepare('UPDATE ideas SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .run(timestamp, timestamp, existing.id);
  return serializeIdea(db.prepare(`${SELECT_IDEA} WHERE i.id = ?`).get(existing.id));
}

/**
 * Sort l'idée de la corbeille. 404 si elle n'y est pas : « restaurer une idée
 * vivante » n'a pas de sens et signale presque toujours un mauvais slug.
 *
 * `updated_at` bouge, comme à la suppression : entrer en corbeille et en
 * sortir sont deux modifications de la fiche, pas des verdicts.
 */
export function restoreIdea(db, slug) {
  const existing = findIdeaBySlug(db, slug, { includeDeleted: true });

  if (!existing || !existing.deleted_at) {
    throw notFound(`Aucune idée supprimée avec le slug « ${slug} ».`);
  }

  db.prepare('UPDATE ideas SET deleted_at = NULL, updated_at = ? WHERE id = ?')
    .run(now(), existing.id);

  return serializeIdea(db.prepare(`${SELECT_IDEA} WHERE i.id = ?`).get(existing.id));
}

/**
 * Suppression définitive. N'accepte qu'une idée déjà en corbeille : purger une
 * idée vivante en un appel serait une perte de données à un clic de distance.
 *
 * Tout part dans une transaction — verdicts, lignes de pièces jointes, puis
 * l'idée. Les clés étrangères en cascade suffiraient, mais l'ordre est écrit :
 * c'est cette opération-là qui doit rester lisible dans six mois.
 *
 * Les fichiers du disque sont effacés **ensuite**, par l'appelant, jamais
 * avant : la règle du projet veut que la ligne parte avant le fichier. Les
 * chemins sont donc relevés avant la transaction et renvoyés avec l'idée.
 */
export function purgeIdea(db, slug) {
  const existing = findIdeaBySlug(db, slug, { includeDeleted: true });

  if (!existing || !existing.deleted_at) {
    throw notFound(`Aucune idée supprimée avec le slug « ${slug} ».`);
  }

  const files = db
    .prepare('SELECT path FROM attachments WHERE idea_id = ? AND path IS NOT NULL')
    .all(existing.id)
    .map((row) => row.path);

  db.transaction(() => {
    db.prepare('DELETE FROM verdicts WHERE idea_id = ?').run(existing.id);
    // Capsule et bande-annonce pointent sur une pièce jointe : on lâche les
    // références d'abord.
    db.prepare('UPDATE ideas SET capsule_file_id = NULL, trailer_file_id = NULL WHERE id = ?')
      .run(existing.id);
    db.prepare('DELETE FROM attachments WHERE idea_id = ?').run(existing.id);
    db.prepare('DELETE FROM ideas WHERE id = ?').run(existing.id);
  })();

  return { idea: existing, files };
}

export function listVerdicts(db, ideaId) {
  return db
    .prepare(
      `SELECT id, idea_id, score, note, created_at FROM verdicts
       WHERE idea_id = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(ideaId);
}

export function createVerdict(db, ideaId, { score, note = '' }) {
  const info = db
    .prepare('INSERT INTO verdicts (idea_id, score, note, created_at) VALUES (?, ?, ?, ?)')
    .run(ideaId, score, note, now());

  return db
    .prepare('SELECT id, idea_id, score, note, created_at FROM verdicts WHERE id = ?')
    .get(info.lastInsertRowid);
}
