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
 * Famille Vitrine → étiquettes telles qu'un magasin les afficherait. Deux
 * minimum par famille : une seule étiquette ne ressemble pas à une vraie fiche,
 * et un test le vérifie.
 *
 * Ce sont des libellés de magasin, pas ceux de Vitrine : « friendslop »
 * n'existe sur aucun store, « Coop » et « Comédie » si.
 */
export const STORE_TAGS = {
  friendslop: ['Coop', 'Physique', 'Comédie', 'Multijoueur'],
  'dopamine-solo': ['Roguelite', 'Arcade', 'Solo', 'Difficile'],
  'sim-fantasme': ['Simulation', 'Bac à sable', 'Immersif', 'Solo'],
  inspection: ['Simulation', 'Gestion', 'Réflexion', 'Point & click'],
  tactique: ['Tactique', 'Tour par tour', 'Stratégie', 'Réflexion'],
  party: ['Fête', 'Multijoueur local', 'Comédie', 'Mini-jeux'],
  'coop-2': ['Coop en ligne', 'Deux joueurs', 'Aventure', 'Réflexion'],
  fps: ['FPS', 'Action', 'Tir', 'Multijoueur'],
  educatif: ['Éducatif', 'Casual', 'Simulation', 'Famille'],
  autre: ['Indépendant', 'Aventure', 'Casual'],
};

/** Repli pour une famille inconnue — la base laisse le champ libre. */
const FALLBACK_TAGS = STORE_TAGS.autre;

/** Les étiquettes de magasin d'une famille. */
export function storeTags(family) {
  return STORE_TAGS[family] ?? FALLBACK_TAGS;
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
 * Les fonctionnalités listées dans la colonne de droite, déduites de la
 * famille. Le support manette est sur toutes les fiches : c'est la ligne qu'on
 * lit sans la lire, et son absence se remarquerait.
 */
export function storeFeatures(family) {
  const social = ['friendslop', 'party', 'coop-2', 'fps'].includes(family);
  return social ? ['coop', 'multi', 'manette'] : ['solo', 'manette'];
}

export const FEATURE_LABELS = {
  coop: 'Coop en ligne',
  multi: 'Multijoueur',
  solo: 'Solo',
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
