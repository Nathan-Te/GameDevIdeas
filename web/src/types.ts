/** Miroir des énumérations de `server/src/schemas.js`. */
export const FAMILIES = [
  'friendslop',
  'dopamine-solo',
  'sim-fantasme',
  'inspection',
  'tactique',
  'party',
  'coop-2',
  'fps',
  'educatif',
  'autre',
] as const;

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

export type Family = (typeof FAMILIES)[number];
export type Status = (typeof STATUSES)[number];
export type Sort = 'updated' | 'created' | 'score' | 'title';
export type LinkType = (typeof LINK_TYPES)[number];
export type AttachmentKind = 'image' | 'markdown' | 'file' | 'link';

/** Libellés lisibles : les valeurs stockées restent celles du seed. */
export const FAMILY_LABELS: Record<Family, string> = {
  friendslop: 'Friendslop',
  'dopamine-solo': 'Dopamine solo',
  'sim-fantasme': 'Sim fantasme',
  inspection: 'Inspection',
  tactique: 'Tactique',
  party: 'Party',
  'coop-2': 'Coop à 2',
  fps: 'FPS',
  educatif: 'Éducatif',
  autre: 'Autre',
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
  family: Family;
  status: Status;
  competition: string;
  /** Image de capsule choisie parmi les pièces jointes de l'idée. */
  capsule_file_id: number | null;
  /** Adresse de cette image, ou `null` tant qu'aucune capsule n'est choisie. */
  capsule_url: string | null;
  /** Nombre de pièces jointes : la corbeille annonce ce qu'une purge emporte. */
  attachment_count: number;
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
  >
>;

/** Champs d'une pièce jointe qu'un PATCH peut écrire. */
export interface AttachmentPatch {
  label?: string;
  position?: number;
  link_type?: LinkType;
}

export interface IdeaFilters {
  family?: Family | '';
  status?: Status | '';
  minScore?: number | '';
  sort?: Sort;
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
