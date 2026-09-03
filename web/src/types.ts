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

export type Family = (typeof FAMILIES)[number];
export type Status = (typeof STATUSES)[number];
export type Sort = 'updated' | 'created' | 'score' | 'title';

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
  /** Renseigné au lot 2 (choix de la capsule parmi les images attachées). */
  capsule_file_id: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  current_verdict: Verdict | null;
}

/** Champs de l'idée qu'un PATCH peut écrire. */
export type IdeaPatch = Partial<
  Pick<
    Idea,
    'slug' | 'title' | 'tagline' | 'pitch' | 'gif' | 'price_cents' | 'family' | 'status' | 'competition'
  >
>;

export interface IdeaFilters {
  family?: Family | '';
  status?: Status | '';
  minScore?: number | '';
  sort?: Sort;
}
