import type { Attachment, AttachmentPatch, Idea, IdeaFilters, IdeaPatch, Verdict } from './types';

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

  async restoreIdea(slug: string): Promise<Idea> {
    return request<Idea>(`/api/ideas/${encodeURIComponent(slug)}/restore`, { method: 'POST' });
  },

  // --- Pièces jointes -------------------------------------------------------

  async listAttachments(slug: string): Promise<Attachment[]> {
    const { attachments } = await request<{ attachments: Attachment[] }>(
      `/api/ideas/${encodeURIComponent(slug)}/attachments`,
    );
    return attachments;
  },

  /** Ajoute un lien. Le serveur en déduit le type et, sans label, le titre. */
  async addLink(slug: string, link: { url: string; label?: string }): Promise<Attachment> {
    const { attachments } = await request<{ attachments: Attachment[] }>(
      `/api/ideas/${encodeURIComponent(slug)}/attachments`,
      { method: 'POST', body: JSON.stringify(link) },
    );
    return attachments[0];
  },

  /**
   * Envoie un fichier. XHR et non `fetch` : la progression d'un envoi n'est pas
   * observable avec `fetch` (`ReadableStream` en corps de requête n'est pas
   * supporté partout, et sans lui il n'y a pas d'événement de progression).
   * Un fichier par requête, pour que chaque barre avance pour son fichier.
   */
  uploadFile(
    slug: string,
    file: File,
    onProgress?: (ratio: number) => void,
    signal?: AbortSignal,
  ): Promise<Attachment> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file, file.name);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/ideas/${encodeURIComponent(slug)}/attachments`);

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      });

      xhr.addEventListener('load', () => {
        let body: unknown = null;
        try {
          body = JSON.parse(xhr.responseText) as unknown;
        } catch {
          body = null;
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(1);
          resolve((body as { attachments: Attachment[] }).attachments[0]);
          return;
        }

        const { error, message } = (body ?? {}) as { error?: string; message?: string };
        reject(new ApiError(xhr.status, error ?? 'error', message ?? `Erreur ${xhr.status}.`));
      });

      xhr.addEventListener('error', () =>
        reject(new ApiError(0, 'network_error', 'Serveur injoignable.')),
      );
      xhr.addEventListener('abort', () =>
        reject(new ApiError(0, 'aborted', 'Envoi interrompu.')),
      );

      signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(form);
    });
  },

  updateAttachment(id: number, patch: AttachmentPatch): Promise<Attachment> {
    return request<Attachment>(`/api/attachments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  deleteAttachment(id: number): Promise<Attachment> {
    return request<Attachment>(`/api/attachments/${id}`, { method: 'DELETE' });
  },

  async reorderAttachments(slug: string, ids: number[]): Promise<Attachment[]> {
    const { attachments } = await request<{ attachments: Attachment[] }>(
      `/api/ideas/${encodeURIComponent(slug)}/attachments/order`,
      { method: 'PUT', body: JSON.stringify({ ids }) },
    );
    return attachments;
  },

  /** Contenu texte d'un markdown attaché, lu depuis `/files/`. */
  async fetchText(url: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new ApiError(0, 'network_error', 'Fichier injoignable.');
    }
    if (!response.ok) {
      throw new ApiError(response.status, 'not_found', 'Fichier introuvable.');
    }

    // Fastify sert un `.md` en `text/markdown`. Recevoir du HTML ici signifie
    // qu'on a parlé à autre chose que `/files/*` — typiquement un serveur de
    // développement qui ne proxifie pas `/files` et répond son `index.html`.
    // Sans ce garde-fou, la page d'accueil s'afficherait dans la carte.
    if (/html/i.test(response.headers.get('content-type') ?? '')) {
      throw new ApiError(
        response.status,
        'unexpected_html',
        '`/files/` a répondu une page HTML au lieu du fichier — le proxy de développement ne couvre pas `/files`.',
      );
    }

    return response.text();
  },
};
