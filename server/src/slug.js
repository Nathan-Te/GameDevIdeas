export const FALLBACK_SLUG = 'idee';

/**
 * « Roguelike de pêche » -> « roguelike-de-peche ».
 * Les diacritiques sont dépliés (NFD) puis retirés, tout le reste devient des tirets.
 */
export function slugify(input) {
  const base = String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');

  return base || FALLBACK_SLUG;
}

/**
 * Rend un slug unique dans la table `ideas` en suffixant un numéro :
 * `sans-titre`, `sans-titre-2`, `sans-titre-3`…
 * `exceptId` permet à une idée de conserver son propre slug lors d'un PATCH.
 */
export function uniqueSlug(db, desired, { exceptId = null } = {}) {
  const base = slugify(desired);
  const taken = db.prepare(
    'SELECT 1 FROM ideas WHERE slug = ? AND (? IS NULL OR id <> ?) LIMIT 1',
  );

  if (!taken.get(base, exceptId, exceptId)) return base;

  for (let n = 2; n < 10000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.get(candidate, exceptId, exceptId)) return candidate;
  }

  throw new Error(`impossible de générer un slug unique à partir de « ${desired} »`);
}

/**
 * Le slug est-il encore celui qui serait dérivé de ce titre — soit `base`, soit
 * `base-2` posé par la déduplication ? Sert à décider si un PATCH du titre doit
 * resynchroniser le slug (voir routes/ideas.js).
 */
export function isDerivedFrom(slug, title) {
  const base = slugify(title);
  if (slug === base) return true;
  if (!slug.startsWith(`${base}-`)) return false;
  return /^[0-9]+$/.test(slug.slice(base.length + 1));
}
