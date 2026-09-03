import type { Idea, IdeaFilters, IdeaPatch, Verdict } from './types';

/**
 * Petit client typé au-dessus de `fetch`. Pas de bibliothèque d'état global :
 * chaque vue charge ce dont elle a besoin et garde son propre état React.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface ErrorBody {
  error?: string;
  message?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json', ...init?.headers } : init?.headers,
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
    const { error, message } = (body ?? {}) as ErrorBody;
    throw new ApiError(response.status, error ?? 'error', message ?? `Erreur ${response.status}.`);
  }

  return body as T;
}

function query(filters: IdeaFilters): string {
  const params = new URLSearchParams();
  if (filters.family) params.set('family', filters.family);
  if (filters.status) params.set('status', filters.status);
  if (filters.minScore !== '' && filters.minScore !== undefined) {
    params.set('minScore', String(filters.minScore));
  }
  if (filters.sort) params.set('sort', filters.sort);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const api = {
  async listIdeas(filters: IdeaFilters = {}): Promise<Idea[]> {
    const { ideas } = await request<{ ideas: Idea[] }>(`/api/ideas${query(filters)}`);
    return ideas;
  },

  createIdea(fields: IdeaPatch = {}): Promise<Idea> {
    return request<Idea>('/api/ideas', { method: 'POST', body: JSON.stringify(fields) });
  },

  getIdea(slug: string): Promise<Idea> {
    return request<Idea>(`/api/ideas/${encodeURIComponent(slug)}`);
  },

  updateIdea(slug: string, patch: IdeaPatch): Promise<Idea> {
    return request<Idea>(`/api/ideas/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  deleteIdea(slug: string): Promise<Idea> {
    return request<Idea>(`/api/ideas/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  },

  async listVerdicts(slug: string): Promise<Verdict[]> {
    const { verdicts } = await request<{ verdicts: Verdict[] }>(
      `/api/ideas/${encodeURIComponent(slug)}/verdicts`,
    );
    return verdicts;
  },

  createVerdict(slug: string, verdict: { score: number; note?: string }): Promise<Verdict> {
    return request<Verdict>(`/api/ideas/${encodeURIComponent(slug)}/verdicts`, {
      method: 'POST',
      body: JSON.stringify(verdict),
    });
  },
};
