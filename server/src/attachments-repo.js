import { badRequest, notFound } from './errors.js';
import { fileUrl } from './files.js';

/**
 * SQL des pièces jointes. Comme pour les idées, les routes ne contiennent
 * aucune requête et la sérialisation est explicite : un champ ajouté à la table
 * n'apparaît dans l'API que si on l'écrit ici.
 */

const now = () => new Date().toISOString();

const COLUMNS = `id, idea_id, kind, label, path, url, link_type, position, size_bytes, created_at`;

export function serializeAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    idea_id: row.idea_id,
    kind: row.kind,
    label: row.label,
    /** Chemin relatif dans `data/files/`. Nul pour un lien. */
    path: row.path,
    /** Adresse cible d'un lien. Nulle pour un fichier. */
    url: row.url,
    link_type: row.link_type,
    position: row.position,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    /** Adresse publique du fichier, servie par `/files/*`. Nulle pour un lien. */
    file_url: fileUrl(row.path),
  };
}

export function listAttachments(db, ideaId) {
  return db
    .prepare(`SELECT ${COLUMNS} FROM attachments WHERE idea_id = ? ORDER BY position, id`)
    .all(ideaId)
    .map(serializeAttachment);
}

export function findAttachment(db, id) {
  return serializeAttachment(
    db.prepare(`SELECT ${COLUMNS} FROM attachments WHERE id = ?`).get(id),
  );
}

export function getAttachmentOrFail(db, id) {
  const attachment = findAttachment(db, id);
  if (!attachment) throw notFound(`Aucune pièce jointe n° ${id}.`);
  return attachment;
}

/** `position` = max + 1 : une nouvelle pièce se pose toujours en fin de liste. */
function nextPosition(db, ideaId) {
  const row = db
    .prepare('SELECT MAX(position) AS max FROM attachments WHERE idea_id = ?')
    .get(ideaId);
  return row.max === null ? 0 : row.max + 1;
}

export function createAttachment(db, ideaId, fields) {
  const values = {
    idea_id: ideaId,
    kind: fields.kind,
    label: fields.label ?? '',
    path: fields.path ?? null,
    url: fields.url ?? null,
    link_type: fields.link_type ?? null,
    size_bytes: fields.size_bytes ?? null,
    position: nextPosition(db, ideaId),
    created_at: now(),
  };

  const info = db
    .prepare(
      `INSERT INTO attachments (idea_id, kind, label, path, url, link_type, position,
                                size_bytes, created_at)
       VALUES (@idea_id, @kind, @label, @path, @url, @link_type, @position,
               @size_bytes, @created_at)`,
    )
    .run(values);

  return findAttachment(db, info.lastInsertRowid);
}

/**
 * `label` et `link_type` s'écrivent directement. `position`, elle, est une
 * place dans une liste et non une valeur libre : la poser à 3 sans toucher aux
 * voisines créerait deux pièces en position 3. La pièce est donc retirée de
 * l'ordre courant puis réinsérée au rang demandé, et toute la liste est
 * renumérotée de 0 à n-1.
 */
export function updateAttachment(db, id, patch) {
  const existing = getAttachmentOrFail(db, id);

  return db.transaction(() => {
    const sets = [];
    const params = { id };

    if (Object.hasOwn(patch, 'label')) {
      sets.push('label = @label');
      params.label = patch.label;
    }

    if (Object.hasOwn(patch, 'link_type')) {
      if (existing.kind !== 'link') {
        throw badRequest('Seul un lien porte un `link_type`.');
      }
      sets.push('link_type = @link_type');
      params.link_type = patch.link_type;
    }

    if (sets.length) {
      db.prepare(`UPDATE attachments SET ${sets.join(', ')} WHERE id = @id`).run(params);
    }

    if (Object.hasOwn(patch, 'position')) {
      const order = db
        .prepare('SELECT id FROM attachments WHERE idea_id = ? ORDER BY position, id')
        .all(existing.idea_id)
        .map((row) => row.id)
        .filter((other) => other !== id);

      const target = Math.min(Math.max(patch.position, 0), order.length);
      order.splice(target, 0, id);
      renumber(db, order);
    }

    return findAttachment(db, id);
  })();
}

/** Écrit les positions 0..n-1 dans l'ordre donné. Toujours sous transaction. */
function renumber(db, ids) {
  const set = db.prepare('UPDATE attachments SET position = ? WHERE id = ?');
  ids.forEach((id, index) => set.run(index, id));
}

/**
 * Réordonne en une transaction. La liste doit contenir exactement les pièces de
 * l'idée, chacune une fois : accepter une liste partielle laisserait le sort
 * des absentes à l'interprétation, et le front envoie de toute façon la liste
 * complète.
 */
export function reorderAttachments(db, ideaId, ids) {
  const current = db
    .prepare('SELECT id FROM attachments WHERE idea_id = ? ORDER BY position, id')
    .all(ideaId)
    .map((row) => row.id);

  const unique = new Set(ids);
  const complete =
    unique.size === ids.length &&
    unique.size === current.length &&
    current.every((id) => unique.has(id));

  if (!complete) {
    throw badRequest(
      `« ids » doit contenir exactement les ${current.length} pièce(s) jointe(s) de cette idée, chacune une fois.`,
    );
  }

  db.transaction(() => renumber(db, ids))();

  return listAttachments(db, ideaId);
}

/**
 * Supprime la ligne. Le fichier sur disque est effacé par l'appelant, juste
 * après — jamais avant : une ligne qui pointe sur un fichier absent est un bug
 * visible, un fichier orphelin ne l'est pas.
 *
 * `ideas.capsule_file_id` et `ideas.trailer_file_id` sont remis à `null` par
 * leur clé étrangère (`ON DELETE SET NULL`, `001-init.sql` et `005-trailer.sql`) ;
 * les clés étrangères sont actives sur toutes les connexions ouvertes par `db.js`.
 */
export function deleteAttachment(db, id) {
  const existing = getAttachmentOrFail(db, id);
  db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
  return existing;
}

/**
 * La capsule doit être une image de cette idée. Une image d'une autre idée
 * afficherait la capsule du voisin, un markdown n'a rien à afficher.
 */
export function assertUsableAsCapsule(db, ideaId, attachmentId) {
  return assertUsableAs(db, ideaId, attachmentId, 'image', 'La capsule doit être une image.');
}

/**
 * La pièce **en tête** de la visionneuse doit appartenir à cette idée, et être
 * quelque chose qu'un magasin met dans son encart central : une bande-annonce
 * (GIF ou vidéo) ou une image.
 *
 * L'image y est admise parce qu'une idée sans bande-annonce n'a rien à montrer :
 * la carte de texte du lot 3b vaut mieux que rien, mais une capture vaut mieux
 * qu'elle. La capsule est une image de l'idée comme une autre : elle peut donc
 * tenir les deux places à la fois, l'encart central et la colonne de droite.
 *
 * Rien n'interdit de désigner une image alors qu'une bande-annonce existe : le
 * champ ne dit pas « la bande-annonce » mais « celle qui ouvre la marche ».
 */
export function assertUsableAsLeadingMedia(db, ideaId, attachmentId) {
  return assertUsableAs(
    db,
    ideaId,
    attachmentId,
    ['trailer', 'image'],
    "L'encart central doit être une image, un GIF ou une vidéo (.gif, .mp4, .webm).",
  );
}

function assertUsableAs(db, ideaId, attachmentId, kinds, message) {
  const allowed = Array.isArray(kinds) ? kinds : [kinds];
  const attachment = findAttachment(db, attachmentId);

  if (!attachment || attachment.idea_id !== ideaId) {
    throw badRequest(`La pièce jointe n° ${attachmentId} n'appartient pas à cette idée.`);
  }
  if (!allowed.includes(attachment.kind)) {
    throw badRequest(message);
  }

  return attachment;
}
