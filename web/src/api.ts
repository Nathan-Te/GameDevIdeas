import type {
  Attachment,
  AttachmentPatch,
  BackupPreview,
  Family,
  FamilyPatch,
  Idea,
  IdeaFilters,
  IdeaPatch,
  PurgeResult,
  RestoreMode,
  RestoreResult,
  ServerBackup,
  Verdict,
} from './types';

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

/** Le nom que le serveur donne à l'archive, repris tel quel pour l'enregistrer. */
function filenameFromDisposition(xhr: XMLHttpRequest): string {
  const header = xhr.getResponseHeader('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? xhr.getResponseHeader('x-vitrine-backup-name') ?? 'vitrine.tgz';
}

function query(filters: IdeaFilters): string {
  const params = new URLSearchParams();
  if (filters.family) params.set('family', filters.family);
  if (filters.status) params.set('status', filters.status);
  if (filters.minScore !== '' && filters.minScore !== undefined) {
    params.set('minScore', String(filters.minScore));
  }
  if (filters.wishlisted) params.set('wishlisted', 'true');
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.deleted) params.set('deleted', 'true');
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

  /**
   * Le seul geste actif de la vue store. Un `PATCH` comme un autre côté API :
   * il a sa méthode ici parce que c'est le seul appel qu'une page en lecture
   * seule s'autorise, et que ça mérite d'être lisible à l'appel.
   */
  setWishlisted(slug: string, wishlisted: boolean): Promise<Idea> {
    return request<Idea>(`/api/ideas/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: JSON.stringify({ wishlisted }),
    });
  },

  // --- Familles -------------------------------------------------------------

  async listFamilies(): Promise<Family[]> {
    const { families } = await request<{ families: Family[] }>('/api/families');
    return families;
  },

  createFamily(fields: FamilyPatch = {}): Promise<Family> {
    return request<Family>('/api/families', { method: 'POST', body: JSON.stringify(fields) });
  },

  updateFamily(slug: string, patch: FamilyPatch): Promise<Family> {
    return request<Family>(`/api/families/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  /** Refusée en 409 tant qu'une idée porte la famille ; le message dit combien. */
  deleteFamily(slug: string): Promise<Family> {
    return request<Family>(`/api/families/${encodeURIComponent(slug)}`, { method: 'DELETE' });
  },

  /** Configuration du serveur : le nom affiché comme développeur et éditeur. */
  getConfig(): Promise<{ developer_name: string }> {
    return request<{ developer_name: string }>('/api/config');
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

  /**
   * Suppression définitive. N'accepte qu'une idée déjà en corbeille ; le
   * serveur efface la base puis le dossier de fichiers de l'idée.
   */
  purgeIdea(slug: string): Promise<PurgeResult> {
    return request<PurgeResult>(`/api/ideas/${encodeURIComponent(slug)}/purge`, {
      method: 'DELETE',
    });
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

  // --- Sauvegarde -----------------------------------------------------------

  /** Ce que contiendrait l'archive, sans rien produire. */
  backupPreview(): Promise<BackupPreview> {
    return request<BackupPreview>('/api/backup/preview');
  },

  /**
   * Télécharge l'archive. XHR et non `fetch`, pour la même raison que l'envoi
   * de fichiers : la progression n'est pas observable autrement. Le serveur
   * annonce `Content-Length`, donc la barre est juste et non estimée.
   */
  downloadBackup(
    onProgress?: (ratio: number) => void,
    signal?: AbortSignal,
  ): Promise<{ blob: Blob; filename: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/backup');
      xhr.responseType = 'blob';

      xhr.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      });

      xhr.addEventListener('load', () => {
        const blob = xhr.response as Blob;

        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(1);
          resolve({ blob, filename: filenameFromDisposition(xhr) });
          return;
        }

        // Une erreur arrive en JSON, mais dans un Blob : il faut le lire.
        void blob
          .text()
          .then((text) => {
            const { error, message } = JSON.parse(text) as { error?: string; message?: string };
            reject(new ApiError(xhr.status, error ?? 'error', message ?? `Erreur ${xhr.status}.`));
          })
          .catch(() => reject(new ApiError(xhr.status, 'error', `Erreur ${xhr.status}.`)));
      });

      xhr.addEventListener('error', () =>
        reject(new ApiError(0, 'network_error', 'Serveur injoignable.')),
      );
      xhr.addEventListener('abort', () =>
        reject(new ApiError(0, 'aborted', 'Téléchargement interrompu.')),
      );

      signal?.addEventListener('abort', () => xhr.abort());
      xhr.send();
    });
  },

  /** Envoie une archive et la restaure. `mode` est un champ du formulaire. */
  restoreBackup(
    file: File,
    mode: RestoreMode,
    onProgress?: (ratio: number) => void,
  ): Promise<RestoreResult> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('mode', mode);
      form.append('archive', file, file.name);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/restore');

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
          resolve(body as RestoreResult);
          return;
        }

        const { error, message } = (body ?? {}) as { error?: string; message?: string };
        reject(new ApiError(xhr.status, error ?? 'error', message ?? `Erreur ${xhr.status}.`));
      });

      xhr.addEventListener('error', () =>
        reject(new ApiError(0, 'network_error', 'Serveur injoignable.')),
      );

      xhr.send(form);
    });
  },

  async listBackups(): Promise<ServerBackup[]> {
    const { backups } = await request<{ backups: ServerBackup[] }>('/api/backups');
    return backups;
  },

  deleteBackup(name: string): Promise<ServerBackup> {
    return request<ServerBackup>(`/api/backups/${encodeURIComponent(name)}`, { method: 'DELETE' });
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
