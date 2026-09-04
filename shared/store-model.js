/**
 * store-model.js — la traduction « idée Vitrine » → « fiche de magasin ».
 *
 * Tout ce que la vue store affiche et qui ne se lit pas directement dans un
 * champ passe par ici : les étiquettes déduites de la famille, la date de
 * parution déduite du statut, le libellé d'évaluation déduit du score.
 *
 * Ce module est du JavaScript pur, sans dépendance, sans Node et sans DOM :
 * c'est ce qui permet au front de l'importer et aux tests `node:test` du
 * serveur de le vérifier sans monter une page. Les types vivent à côté, dans
 * `store-model.d.ts` — le front est en TypeScript strict et ne compilerait pas
 * sans eux.
 */

/**
 * Le peuplement initial de la table `families` (migration `004`).
 *
 * Ce n'est **pas** la source de vérité des familles : depuis le lot 4, elle est
 * la table `families`, que Nathan édite depuis `/familles`. Cette constante ne
 * sert qu'au premier démarrage, quand la table est vide, pour qu'aucune idée
 * existante ne change de sens en passant d'une liste figée à une liste éditable.
 *
 * Les étiquettes sont des libellés de magasin, pas ceux de Vitrine :
 * « friendslop » n'existe sur aucun store, « Coop » et « Comédie » si.
 */
export const SEED_FAMILIES = [
  {
    slug: 'friendslop',
    label: 'Friendslop',
    store_tags: ['Coop', 'Physique', 'Comédie', 'Multijoueur'],
    features: ['coop-online', 'multiplayer'],
  },
  {
    slug: 'dopamine-solo',
    label: 'Dopamine solo',
    store_tags: ['Roguelite', 'Arcade', 'Solo', 'Difficile'],
    features: ['solo'],
  },
  {
    slug: 'sim-fantasme',
    label: 'Sim fantasme',
    store_tags: ['Simulation', 'Bac à sable', 'Immersif', 'Solo'],
    features: ['solo'],
  },
  {
    slug: 'inspection',
    label: 'Inspection',
    store_tags: ['Simulation', 'Gestion', 'Réflexion', 'Point & click'],
    features: ['solo'],
  },
  {
    slug: 'tactique',
    label: 'Tactique',
    store_tags: ['Tactique', 'Tour par tour', 'Stratégie', 'Réflexion'],
    features: ['solo'],
  },
  {
    slug: 'party',
    label: 'Party',
    store_tags: ['Fête', 'Multijoueur local', 'Comédie', 'Mini-jeux'],
    features: ['coop-online', 'multiplayer'],
  },
  {
    slug: 'coop-2',
    label: 'Coop à 2',
    store_tags: ['Coop en ligne', 'Deux joueurs', 'Aventure', 'Réflexion'],
    features: ['coop-online', 'multiplayer'],
  },
  {
    slug: 'fps',
    label: 'FPS',
    store_tags: ['FPS', 'Action', 'Tir', 'Multijoueur'],
    features: ['coop-online', 'multiplayer'],
  },
  {
    slug: 'educatif',
    label: 'Éducatif',
    store_tags: ['Éducatif', 'Casual', 'Simulation', 'Famille'],
    features: ['solo'],
  },
  {
    slug: 'autre',
    label: 'Autre',
    store_tags: ['Indépendant', 'Aventure', 'Casual'],
    features: ['solo'],
  },
];

/**
 * Les fonctionnalités qu'une famille peut porter. La liste est fermée : ce sont
 * des lignes de fiche de magasin avec leur pictogramme, pas du texte libre.
 */
export const FAMILY_FEATURES = ['solo', 'coop-online', 'multiplayer', 'local-coop'];

/**
 * Repli quand une idée porte une famille introuvable — la base garde le texte,
 * et une famille peut être renommée pendant qu'un onglet est ouvert.
 */
const FALLBACK_TAGS = ['Indépendant', 'Aventure', 'Casual'];

/**
 * Les étiquettes de magasin d'une famille. `family` est la ligne de la table
 * `families`, telle que l'API la sert, ou `null` si l'idée en pointe une qui
 * n'existe plus.
 */
export function storeTags(family) {
  const tags = family?.store_tags;
  return Array.isArray(tags) && tags.length > 0 ? tags : FALLBACK_TAGS;
}

/**
 * Le genre affiché dans la colonne de droite : les deux premières étiquettes,
 * comme un magasin qui résume un genre en une ligne.
 */
export function storeGenre(family) {
  return storeTags(family).slice(0, 2).join(', ');
}

/**
 * Statut Vitrine → nature de la date de parution du magasin.
 *
 * `pause` et `abandonne` retombent sur « À venir » : ce sont des états de
 * l'atelier, pas du magasin, et un magasin ne dit jamais qu'un jeu est
 * abandonné — il dit qu'il n'est pas encore sorti.
 */
export const RELEASE_KIND = {
  idee: 'a-venir',
  reserve: 'a-venir',
  prototype: 'acces-anticipe',
  'en-cours': 'acces-anticipe',
  pause: 'a-venir',
  abandonne: 'a-venir',
  publie: 'date',
};

const RELEASE_LABEL = {
  'a-venir': 'À venir',
  'acces-anticipe': 'Accès anticipé',
};

/**
 * La ligne « Date de parution ». Un statut publié affiche la date de dernière
 * mise à jour : c'est la seule date de l'idée qui prétende dire « c'est sorti ».
 */
export function releaseDate(status, updatedAt) {
  const kind = RELEASE_KIND[status] ?? 'a-venir';
  if (kind !== 'date') return RELEASE_LABEL[kind];

  const date = updatedAt ? new Date(updatedAt) : null;
  if (!date || Number.isNaN(date.getTime())) return 'À venir';

  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/**
 * Score du verdict courant → libellé d'évaluation du magasin, avec sa teinte.
 * Sans verdict, un magasin dirait « Pas encore d'évaluation ».
 */
export function reviewSummary(score) {
  switch (score) {
    case 5:
      return { label: 'Extrêmement positives', tone: 'positive' };
    case 4:
      return { label: 'Très positives', tone: 'positive' };
    case 3:
      return { label: 'Plutôt positives', tone: 'positive' };
    case 2:
      return { label: 'Moyennes', tone: 'mixed' };
    case 1:
      return { label: 'Plutôt négatives', tone: 'negative' };
    case 0:
      return { label: 'Négatives', tone: 'negative' };
    default:
      return { label: 'Pas encore d’évaluation', tone: 'none' };
  }
}

/** Un avis est « Recommandé » à partir de 3 sur 5, comme un pouce levé. */
export function isRecommended(score) {
  return typeof score === 'number' && score >= 3;
}

/**
 * Les fonctionnalités listées dans la colonne de droite, lues sur la famille.
 * Le support manette est ajouté à toutes les fiches : c'est la ligne qu'on lit
 * sans la lire, et son absence se remarquerait. Elle n'est donc pas une
 * fonctionnalité de famille et ne s'édite pas.
 */
export function storeFeatures(family) {
  const declared = Array.isArray(family?.features)
    ? family.features.filter((feature) => FAMILY_FEATURES.includes(feature))
    : [];
  return [...declared, 'manette'];
}

export const FEATURE_LABELS = {
  solo: 'Solo',
  'coop-online': 'Coop en ligne',
  multiplayer: 'Multijoueur',
  'local-coop': 'Coop en local',
  manette: 'Support complet des manettes',
};

/**
 * Le prix tel qu'un magasin l'affiche. Pas de prix — ou zéro — c'est
 * « Gratuit » : sur une fiche de magasin, l'absence de prix est une
 * information, pas un champ vide.
 */
export function storePrice(cents) {
  if (cents === null || cents === undefined || cents === 0) return 'Gratuit';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

/**
 * Le champ `competition` découpé en titres. Virgules, points-virgules et
 * retours à la ligne séparent : c'est du texte libre écrit à la volée, on ne
 * lui impose pas une syntaxe après coup.
 */
export function similarTitles(competition) {
  return String(competition ?? '')
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * La courte description de l'en-tête : l'accroche, puis le pitch derrière.
 * Tronquée comme sur un magasin, où ce bloc a une hauteur fixe et coupe le
 * reste — la troncature fait partie de la ressemblance.
 */
export function shortDescription(tagline, pitch, limit = 300) {
  const text = [tagline, pitch]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ');

  if (text.length <= limit) return text;
  return `${text.slice(0, limit).replace(/\s+\S*$/, '')}…`;
}
