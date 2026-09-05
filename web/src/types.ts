import type { FamilyFeature } from '../../shared/store-model';

/** Miroir des énumérations de `server/src/schemas.js`. */
export const STATUSES = [
  'idee',
  'reserve',
  'prototype',
  'en-cours',
  'pause',
  'abandonne',
  'publie',
] as const;

/** Miroir de `LINK_TYPES` dans `server/src/links.js`. Pilote l'icône du lien. */
export const LINK_TYPES = ['trello', 'asset-store', 'git', 'steam', 'video', 'autre'] as const;

export type Status = (typeof STATUSES)[number];
export type Sort = 'updated' | 'created' | 'score' | 'title';
export type LinkType = (typeof LINK_TYPES)[number];
export type AttachmentKind = 'image' | 'markdown' | 'file' | 'link' | 'trailer';

/**
 * Une famille, telle que `GET /api/families` la sert. Ce n'est plus une
 * énumération figée depuis le lot 4 : la liste vit en base et s'édite sur
 * `/familles`, donc `Idea.family` est un slug libre côté types.
 */
export interface Family {
  id: number;
  slug: string;
  label: string;
  /** Les étiquettes affichées sur la page store. */
  store_tags: string[];
  /** Les fonctionnalités déduites, hors support manette. */
  features: FamilyFeature[];
  position: number;
  /** Nombre d'idées qui la portent, corbeille comprise. Sert au refus de suppression. */
  idea_count: number;
}

/** Champs d'une famille qu'un POST/PATCH peut écrire. */
export interface FamilyPatch {
  slug?: string;
  label?: string;
  store_tags?: string[];
  features?: FamilyFeature[];
  position?: number;
}

export const FAMILY_FEATURE_LABELS: Record<FamilyFeature, string> = {
  solo: 'Solo',
  'coop-online': 'Coop en ligne',
  multiplayer: 'Multijoueur',
  'local-coop': 'Coop en local',
};

export const STATUS_LABELS: Record<Status, string> = {
  idee: 'Idée',
  reserve: 'Réserve',
  prototype: 'Prototype',
  'en-cours': 'En cours',
  pause: 'Pause',
  abandonne: 'Abandonné',
  publie: 'Publié',
};

export const SORT_LABELS: Record<Sort, string> = {
  updated: 'Mise à jour',
  created: 'Création',
  score: 'Score',
  title: 'Titre',
};

export const LINK_TYPE_LABELS: Record<LinkType, string> = {
  trello: 'Trello',
  'asset-store': 'Asset Store',
  git: 'Dépôt Git',
  steam: 'Steam',
  video: 'Vidéo',
  autre: 'Lien',
};

export interface Attachment {
  id: number;
  idea_id: number;
  kind: AttachmentKind;
  label: string;
  /** Chemin relatif dans `data/files/`. Nul pour un lien. */
  path: string | null;
  /** Adresse cible d'un lien. Nulle pour un fichier. */
  url: string | null;
  link_type: LinkType | null;
  position: number;
  size_bytes: number | null;
  created_at: string;
  /** Adresse publique du fichier, servie par `/files/*`. Nulle pour un lien. */
  file_url: string | null;
}

export interface Verdict {
  id: number;
  idea_id?: number;
  score: number;
  note: string;
  created_at: string;
}

export interface Idea {
  id: number;
  slug: string;
  title: string;
  tagline: string;
  pitch: string;
  gif: string;
  price_cents: number | null;
  /** Slug d'une famille de la table `families`. */
  family: string;
  status: Status;
  competition: string;
  /** Image de capsule choisie parmi les pièces jointes de l'idée. */
  capsule_file_id: number | null;
  /** Adresse de cette image, ou `null` tant qu'aucune capsule n'est choisie. */
  capsule_url: string | null;
  /**
   * La bande-annonce **désignée** parmi les pièces `trailer` de l'idée, ou
   * `null` si Nathan n'en a désigné aucune.
   */
  trailer_file_id: number | null;
  /**
   * Celle qui est réellement en tête : la désignée, ou à défaut la première
   * pièce `trailer`. La règle vit côté serveur, le front la lit — la visionneuse
   * du store enchaîne toutes les bandes-annonces, celle-ci d'abord.
   */
  leading_trailer_id: number | null;
  /** Adresse de la bande-annonce en tête, ou `null` s'il n'y en a aucune. */
  trailer_url: string | null;
  /** Nombre de pièces jointes : la corbeille annonce ce qu'une purge emporte. */
  attachment_count: number;
  /**
   * Date de mise en liste de souhaits, `null` si l'idée n'y est pas. C'est le
   * seul état qu'un clic dans la vue store peut changer.
   */
  wishlisted_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  current_verdict: Verdict | null;
}

/** Champs de l'idée qu'un PATCH peut écrire. */
export type IdeaPatch = Partial<
  Pick<
    Idea,
    | 'slug'
    | 'title'
    | 'tagline'
    | 'pitch'
    | 'gif'
    | 'price_cents'
    | 'family'
    | 'status'
    | 'competition'
    | 'capsule_file_id'
    | 'trailer_file_id'
  >
> & {
  /** Booléen à l'entrée, `wishlisted_at` en sortie. */
  wishlisted?: boolean;
};

/** Champs d'une pièce jointe qu'un PATCH peut écrire. */
export interface AttachmentPatch {
  label?: string;
  position?: number;
  link_type?: LinkType;
}

export interface IdeaFilters {
  /** Slug d'une famille, ou la chaîne vide pour « toutes ». */
  family?: string;
  status?: Status | '';
  minScore?: number | '';
  sort?: Sort;
  /** `true` : seulement la liste de souhaits. Absent : tout le catalogue. */
  wishlisted?: boolean;
  /** `true` : la corbeille au lieu du catalogue. */
  deleted?: boolean;
}

/** Ce que renvoie une purge : de quoi dire ce qui vient de partir. */
export interface PurgeResult {
  purged: Idea;
  files_removed: number;
  /** La base est propre mais le dossier de fichiers est resté sur le disque. */
  orphan_directory: boolean;
}
