import { assertUsableAsCapsule } from './attachments-repo.js';
import { notFound } from './errors.js';
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

const SELECT_IDEA = `
  SELECT i.*,
         v.id         AS verdict_id,
         v.score      AS verdict_score,
         v.note       AS verdict_note,
         v.created_at AS verdict_created_at,
         c.path       AS capsule_path
  FROM ideas i
  ${CURRENT_VERDICT_JOIN}
  ${CAPSULE_JOIN}
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
    /** Adresse de l'image de capsule, nulle tant qu'aucune n'est choisie. */
    capsule_url: fileUrl(row.capsule_path),
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

export function listIdeas(db, { family, status, minScore, sort = 'updated', deleted = false } = {}) {
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

  const order = {
    updated: 'i.updated_at DESC, i.id DESC',
    created: 'i.created_at DESC, i.id DESC',
    // Une idée sans verdict n'a pas de score : elle passe en fin de liste.
    score: 'v.score IS NULL, v.score DESC, i.updated_at DESC',
    title: 'i.title COLLATE NOCASE ASC, i.id ASC',
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
  const title = input.title ?? DEFAULT_TITLE;
  const slug = uniqueSlug(db, input.slug || title);
  const timestamp = now();

  const values = {
    slug,
    title,
    tagline: input.tagline ?? '',
    pitch: input.pitch ?? '',
    gif: input.gif ?? '',
    price_cents: input.price_cents ?? null,
    family: input.family ?? 'autre',
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

  for (const field of WRITABLE) {
    if (Object.hasOwn(patch, field)) {
      sets.push(`${field} = @${field}`);
      params[field] = patch[field];
    }
  }

  if (Object.hasOwn(patch, 'capsule_file_id')) {
    if (patch.capsule_file_id !== null) {
      assertUsableAsCapsule(db, existing.id, patch.capsule_file_id);
    }
    sets.push('capsule_file_id = @capsule_file_id');
    params.capsule_file_id = patch.capsule_file_id;
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
    params.updated_at = now();
    sets.push('updated_at = @updated_at');
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
