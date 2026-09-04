import { FAMILIES, STATUSES } from './types';
import type { Family, IdeaFilters, Sort, Status } from './types';

/**
 * Les filtres du catalogue vivent dans l'URL : un catalogue filtré se met en
 * favori et se recharge tel quel.
 *
 * Ils sont lus et écrits ici plutôt que dans la page, parce que la vue Steam
 * s'en sert aussi : « idée suivante » doit suivre la liste que Nathan avait
 * sous les yeux, filtres et tri compris, et non le catalogue entier.
 */

export const SORTS: Sort[] = ['updated', 'created', 'score', 'title'];

export function filtersFromSearch(search: string): IdeaFilters {
  const params = new URLSearchParams(search);
  const family = params.get('family') ?? '';
  const status = params.get('status') ?? '';
  const minScore = params.get('minScore') ?? '';
  const sort = params.get('sort') ?? 'updated';

  return {
    wishlisted: params.get('wishlisted') === 'true' ? true : undefined,
    family: (FAMILIES as readonly string[]).includes(family) ? (family as Family) : '',
    status: (STATUSES as readonly string[]).includes(status) ? (status as Status) : '',
    minScore: /^[0-5]$/.test(minScore) ? Number(minScore) : '',
    sort: (SORTS as string[]).includes(sort) ? (sort as Sort) : 'updated',
  };
}

/** `?family=fps&sort=score`, ou la chaîne vide. Le tri par défaut n'est pas écrit. */
export function searchFromFilters(filters: IdeaFilters): string {
  const params = new URLSearchParams();
  if (filters.family) params.set('family', filters.family);
  if (filters.status) params.set('status', filters.status);
  if (filters.minScore !== '' && filters.minScore !== undefined) {
    params.set('minScore', String(filters.minScore));
  }
  if (filters.wishlisted) params.set('wishlisted', 'true');
  if (filters.sort && filters.sort !== 'updated') params.set('sort', filters.sort);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** `true` si au moins un filtre restreint la liste. Le tri n'est pas un filtre. */
export function hasActiveFilters(filters: IdeaFilters): boolean {
  return Boolean(filters.family || filters.status || filters.minScore !== '' || filters.wishlisted);
}

/** Adresse de la vue Steam d'une idée, filtres du catalogue conservés. */
export function steamHref(slug: string, search: string): string {
  return `/idees/${encodeURIComponent(slug)}/steam${search}`;
}
