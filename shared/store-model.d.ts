/**
 * Types de `store-model.js`. Écrits à la main plutôt que générés : le module
 * reste du JavaScript pur pour que les tests `node:test` du serveur l'exécutent
 * sans étape de compilation, et le front est en TypeScript strict.
 */

export type StoreFamily =
  | 'friendslop'
  | 'dopamine-solo'
  | 'sim-fantasme'
  | 'inspection'
  | 'tactique'
  | 'party'
  | 'coop-2'
  | 'fps'
  | 'educatif'
  | 'autre';

export type StoreStatus =
  | 'idee'
  | 'reserve'
  | 'prototype'
  | 'en-cours'
  | 'pause'
  | 'abandonne'
  | 'publie';

export type ReviewTone = 'positive' | 'mixed' | 'negative' | 'none';
export type StoreFeature = 'coop' | 'multi' | 'solo' | 'manette';
export type ReleaseKind = 'a-venir' | 'acces-anticipe' | 'date';

export declare const STORE_TAGS: Record<StoreFamily, string[]>;
export declare const RELEASE_KIND: Record<StoreStatus, ReleaseKind>;
export declare const FEATURE_LABELS: Record<StoreFeature, string>;

export declare function storeTags(family: string): string[];
export declare function storeGenre(family: string): string;
export declare function releaseDate(status: string, updatedAt?: string): string;
export declare function reviewSummary(score: number | null | undefined): {
  label: string;
  tone: ReviewTone;
};
export declare function isRecommended(score: number | null | undefined): boolean;
export declare function storeFeatures(family: string): StoreFeature[];
export declare function storePrice(cents: number | null | undefined): string;
export declare function similarTitles(competition: string | null | undefined): string[];
export declare function shortDescription(
  tagline: string | null | undefined,
  pitch: string | null | undefined,
  limit?: number,
): string;
