import { useCallback, useEffect, useState } from 'react';

import { api } from './api';
import type { Family } from './types';

/**
 * La liste des familles, chargée une fois et partagée par les vues.
 *
 * Quatre écrans en ont besoin — catalogue, page idée, vue store, écran des
 * familles — et la recharger à chaque montage ferait clignoter les sélecteurs à
 * chaque navigation. Un cache module et un abonnement suffisent : pas de
 * bibliothèque d'état global, comme le reste du front.
 *
 * L'écran d'édition appelle `publishFamilies` après chaque changement : le
 * catalogue et la page idée voient la nouvelle liste sans être rechargés.
 */

let cache: Family[] | null = null;
let pending: Promise<Family[]> | null = null;
const listeners = new Set<(families: Family[]) => void>();

export function publishFamilies(families: Family[]): void {
  cache = families;
  for (const listener of listeners) listener(families);
}

/** Charge la liste, ou rend celle en cache. Un seul appel réseau à la fois. */
export function loadFamilies({ force = false } = {}): Promise<Family[]> {
  if (!force && cache) return Promise.resolve(cache);
  if (!force && pending) return pending;

  pending = api
    .listFamilies()
    .then((families) => {
      publishFamilies(families);
      return families;
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export interface FamiliesState {
  families: Family[];
  /** `null` tant que rien n'est arrivé : les vues distinguent vide et chargement. */
  loaded: boolean;
  reload: () => Promise<Family[]>;
}

export function useFamilies(): FamiliesState {
  const [families, setFamilies] = useState<Family[]>(() => cache ?? []);
  const [loaded, setLoaded] = useState(() => cache !== null);

  useEffect(() => {
    let cancelled = false;

    const listener = (next: Family[]) => {
      if (!cancelled) {
        setFamilies(next);
        setLoaded(true);
      }
    };
    listeners.add(listener);

    loadFamilies().catch(() => {
      // Une liste de familles injoignable ne doit pas priver Nathan de sa page :
      // les sélecteurs restent vides, le reste fonctionne.
      if (!cancelled) setLoaded(true);
    });

    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  const reload = useCallback(() => loadFamilies({ force: true }), []);

  return { families, loaded, reload };
}

/** Le libellé d'une famille, ou son slug si elle a disparu sous les pieds. */
export function familyLabel(families: Family[], slug: string): string {
  return families.find((family) => family.slug === slug)?.label ?? slug;
}

/** La famille d'une idée, ou `null` : c'est ce qu'attend `shared/store-model`. */
export function findFamily(families: Family[], slug: string): Family | null {
  return families.find((family) => family.slug === slug) ?? null;
}
