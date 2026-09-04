import { FAMILY_FEATURES, SEED_FAMILIES } from '../../shared/store-model.js';

import { badRequest, conflict, notFound } from './errors.js';
import { slugify } from './slug.js';

/**
 * SQL des familles. Depuis le lot 4, la liste des familles n'est plus une
 * énumération du code mais une table que Nathan édite : c'est ici qu'elle vit.
 *
 * `store_tags` et `features` sont stockées en JSON dans une colonne TEXT et
 * traduites en tableaux à la frontière — la base ne rend jamais de chaîne JSON
 * à l'appelant, et n'en reçoit jamais.
 */

const COLUMNS = 'id, slug, label, store_tags, features, position';

/** Une liste JSON illisible ne doit pas faire tomber le catalogue entier. */
function parseList(raw) {
  try {
    const parsed = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function serializeFamily(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    /** Les étiquettes affichées sur la page store. */
    store_tags: parseList(row.store_tags),
    /** Les fonctionnalités déduites : `solo`, `coop-online`, … */
    features: parseList(row.features),
    position: row.position,
  };
}

export function listFamilies(db) {
  return db
    .prepare(`SELECT ${COLUMNS} FROM families ORDER BY position, id`)
    .all()
    .map(serializeFamily);
}

export function findFamily(db, slug) {
  return serializeFamily(db.prepare(`SELECT ${COLUMNS} FROM families WHERE slug = ?`).get(slug));
}

export function getFamilyOrFail(db, slug) {
  const family = findFamily(db, slug);
  if (!family) throw notFound(`Aucune famille avec le slug « ${slug} ».`);
  return family;
}

/**
 * Peuple la table au premier démarrage, et seulement si elle est vide.
 *
 * Idempotent par construction : une table non vide n'est jamais touchée. C'est
 * ce qui permet à Nathan de supprimer une famille sans la voir revenir au
 * redémarrage suivant — et à une base existante de ne rien voir changer de sens
 * en passant d'une liste figée à une liste éditable.
 */
export function seedFamilies(db) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM families').get();
  if (count > 0) return 0;

  const insert = db.prepare(
    `INSERT INTO families (slug, label, store_tags, features, position)
     VALUES (@slug, @label, @store_tags, @features, @position)`,
  );

  db.transaction(() => {
    SEED_FAMILIES.forEach((family, index) => {
      insert.run({
        slug: family.slug,
        label: family.label,
        store_tags: JSON.stringify(family.store_tags),
        features: JSON.stringify(family.features),
        position: index,
      });
    });
  })();

  return SEED_FAMILIES.length;
}

/** Une famille inconnue est une erreur de l'appelant, pas une valeur libre. */
export function assertFamilyExists(db, slug) {
  const row = db.prepare('SELECT 1 FROM families WHERE slug = ?').get(slug);
  if (!row) {
    throw badRequest(`Aucune famille « ${slug} ». Les familles s’éditent sur /familles.`);
  }
}

function normalizeFeatures(features) {
  const unknown = features.filter((feature) => !FAMILY_FEATURES.includes(feature));
  if (unknown.length) {
    throw badRequest(`Fonctionnalité inconnue : ${unknown.join(', ')}.`);
  }
  return [...new Set(features)];
}

/** Étiquettes : nettoyées, dédoublonnées, jamais vides — ce sont des pilules. */
function normalizeTags(tags) {
  return [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))];
}

/** Slug unique dans `families`, suffixé au besoin comme celui d'une idée. */
function uniqueFamilySlug(db, desired, { exceptId = null } = {}) {
  const base = slugify(desired);
  const taken = db.prepare(
    'SELECT 1 FROM families WHERE slug = ? AND (? IS NULL OR id <> ?) LIMIT 1',
  );

  if (!taken.get(base, exceptId, exceptId)) return base;

  for (let n = 2; n < 10000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.get(candidate, exceptId, exceptId)) return candidate;
  }

  throw new Error(`impossible de générer un slug de famille à partir de « ${desired} »`);
}

export function createFamily(db, input = {}) {
  const label = (input.label ?? '').trim() || 'Nouvelle famille';
  const slug = uniqueFamilySlug(db, input.slug || label);

  const { max } = db.prepare('SELECT MAX(position) AS max FROM families').get();

  db.prepare(
    `INSERT INTO families (slug, label, store_tags, features, position)
     VALUES (@slug, @label, @store_tags, @features, @position)`,
  ).run({
    slug,
    label,
    store_tags: JSON.stringify(normalizeTags(input.store_tags ?? [])),
    features: JSON.stringify(normalizeFeatures(input.features ?? [])),
    position: max === null ? 0 : max + 1,
  });

  return findFamily(db, slug);
}

/**
 * Mise à jour partielle. Deux cas méritent d'être lus :
 *
 * - **Renommer le slug** met à jour les idées qui portent l'ancien, dans la
 *   même transaction. `ideas.family` est un texte validé par l'application et
 *   non par une clé étrangère : rien ne le mettrait à jour tout seul, et une
 *   idée qui pointe une famille disparue perdrait ses étiquettes en silence.
 * - **`position`** est une place dans une liste, pas une valeur libre : la
 *   famille est retirée de l'ordre courant puis réinsérée au rang demandé, et
 *   toute la liste est renumérotée — même patron que les pièces jointes.
 */
export function updateFamily(db, slug, patch = {}) {
  const existing = getFamilyOrFail(db, slug);

  return db.transaction(() => {
    const sets = [];
    const params = { id: existing.id };

    if (Object.hasOwn(patch, 'label')) {
      sets.push('label = @label');
      params.label = (patch.label ?? '').trim() || existing.label;
    }

    if (Object.hasOwn(patch, 'store_tags')) {
      sets.push('store_tags = @store_tags');
      params.store_tags = JSON.stringify(normalizeTags(patch.store_tags));
    }

    if (Object.hasOwn(patch, 'features')) {
      sets.push('features = @features');
      params.features = JSON.stringify(normalizeFeatures(patch.features));
    }

    let renamedTo = null;
    if (Object.hasOwn(patch, 'slug')) {
      const candidate = uniqueFamilySlug(db, patch.slug, { exceptId: existing.id });
      if (candidate !== existing.slug) {
        renamedTo = candidate;
        sets.push('slug = @slug');
        params.slug = candidate;
      }
    }

    if (sets.length) {
      db.prepare(`UPDATE families SET ${sets.join(', ')} WHERE id = @id`).run(params);
    }

    if (renamedTo) {
      db.prepare('UPDATE ideas SET family = ? WHERE family = ?').run(renamedTo, existing.slug);
    }

    if (Object.hasOwn(patch, 'position')) {
      const order = db
        .prepare('SELECT id FROM families ORDER BY position, id')
        .all()
        .map((row) => row.id)
        .filter((other) => other !== existing.id);

      const target = Math.min(Math.max(patch.position, 0), order.length);
      order.splice(target, 0, existing.id);

      const set = db.prepare('UPDATE families SET position = ? WHERE id = ?');
      order.forEach((id, index) => set.run(index, id));
    }

    return serializeFamily(
      db.prepare(`SELECT ${COLUMNS} FROM families WHERE id = ?`).get(existing.id),
    );
  })();
}

/**
 * Supprime une famille inutilisée. Refusée en 409 tant qu'une idée s'en sert,
 * corbeille comprise : une idée restaurée ne doit pas ressortir avec une
 * famille fantôme. Le message dit combien d'idées bloquent, sinon Nathan n'a
 * aucun moyen de savoir quoi déplacer.
 */
export function deleteFamily(db, slug) {
  const existing = getFamilyOrFail(db, slug);

  const { count } = db.prepare('SELECT COUNT(*) AS count FROM ideas WHERE family = ?').get(slug);

  if (count > 0) {
    throw conflict(
      `« ${existing.label} » est encore la famille de ${count} idée${count > 1 ? 's' : ''} : ` +
        'change-les de famille avant de la supprimer.',
    );
  }

  db.prepare('DELETE FROM families WHERE id = ?').run(existing.id);
  return existing;
}

/**
 * Le nombre d'idées par famille, corbeille comprise : l'écran des familles
 * annonce ce qu'une suppression va refuser avant qu'on l'essaie.
 */
export function countIdeasByFamily(db) {
  const counts = {};
  for (const row of db.prepare('SELECT family, COUNT(*) AS count FROM ideas GROUP BY family').all()) {
    counts[row.family] = row.count;
  }
  return counts;
}
