import { ApiError } from './api';
import type { GuestIdeaPage, GuestShare, StoreReview } from './types';
import { visitorId } from './visitor';

/**
 * Le client des quatre routes ouvertes aux invités, séparé de `api.ts`.
 *
 * Séparé volontairement : c'est le seul code du front qui tourne chez quelqu'un
 * d'autre que Nathan, et il ne doit connaître aucune autre adresse. Un client
 * unique aurait mis à portée de main, dans la même page, un `listIdeas()` qui
 * échouerait en 404 — et à force, quelqu'un finirait par « corriger » le
 * serveur pour que ça marche.
 */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        // L'identifiant du visiteur voyage en en-tête : une URL se copie, se
        // colle et se retrouve dans un journal, un en-tête non.
        'x-vitrine-visitor': visitorId(),
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Serveur injoignable.');
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const { error, message } = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(response.status, error ?? 'error', message ?? `Erreur ${response.status}.`);
  }

  return body as T;
}

const base = (token: string) => `/api/share/${encodeURIComponent(token)}`;

export const guestApi = {
  /** La sélection, ses idées et le récapitulatif de ce que ce visiteur a fait. */
  share(token: string): Promise<GuestShare> {
    return request<GuestShare>(base(token));
  },

  ideaPage(token: string, slug: string): Promise<GuestIdeaPage> {
    return request<GuestIdeaPage>(`${base(token)}/ideas/${encodeURIComponent(slug)}`);
  },

  /** Dépose ou corrige l'avis du visiteur. Le serveur ne fait pas la différence. */
  submitReview(
    token: string,
    review: { slug: string; author_name: string; score: number; note: string },
  ): Promise<{ my_review: StoreReview; reviews: StoreReview[] }> {
    return request(`${base(token)}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ ...review, visitor_id: visitorId() }),
    });
  },

  /** La liste de souhaits du visiteur, pas celle de Nathan. */
  setWishlisted(token: string, slug: string, wishlisted: boolean): Promise<{ wishlisted: boolean }> {
    return request(`${base(token)}/wishlist`, {
      method: 'POST',
      body: JSON.stringify({ slug, wishlisted, visitor_id: visitorId() }),
    });
  },
};
