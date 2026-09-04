/**
 * Types de `store-model.js`. Écrits à la main plutôt que générés : le module
 * reste du JavaScript pur pour que les tests `node:test` du serveur l'exécutent
 * sans étape de compilation, et le front est en TypeScript strict.
 */

export type StoreStatus =
  | 'idee'
  | 'reserve'
  | 'prototype'
  | 'en-cours'
  | 'pause'
  | 'abandonne'
  | 'publie';

export type ReviewTone = 'positive' | 'mixed' | 'negative' | 'none';

/** Une fonctionnalité éditable sur une famille. `manette` n'en est pas une. */
export type FamilyFeature = 'solo' | 'coop-online' | 'multiplayer' | 'local-coop';
export type StoreFeature = FamilyFeature | 'manette';

export type ReleaseKind = 'a-venir' | 'acces-anticipe' | 'date';

/**
 * Ce que le modèle store attend d'une famille : sa ligne de la table
 * `families`, telle que `GET /api/families` la sert. `null` quand une idée
 * pointe une famille qui n'existe plus.
 */
export interface StoreFamilyInput {
  store_tags?: string[];
  features?: string[];
}

export interface SeedFamily {
  slug: string;
  label: string;
  store_tags: string[];
  features: FamilyFeature[];
}

export declare const SEED_FAMILIES: SeedFamily[];
export declare const FAMILY_FEATURES: FamilyFeature[];
export declare const RELEASE_KIND: Record<StoreStatus, ReleaseKind>;
export declare const FEATURE_LABELS: Record<StoreFeature, string>;

export declare function storeTags(family: StoreFamilyInput | null | undefined): string[];
export declare function storeGenre(family: StoreFamilyInput | null | undefined): string;
export declare function storeFeatures(family: StoreFamilyInput | null | undefined): StoreFeature[];
export declare function releaseDate(status: string, updatedAt?: string): string;
export declare function reviewSummary(score: number | null | undefined): {
  label: string;
  tone: ReviewTone;
};
export declare function isRecommended(score: number | null | undefined): boolean;
export declare function storePrice(cents: number | null | undefined): string;
export declare function similarTitles(competition: string | null | undefined): string[];
export declare function shortDescription(
  tagline: string | null | undefined,
  pitch: string | null | undefined,
  limit?: number,
): string;
