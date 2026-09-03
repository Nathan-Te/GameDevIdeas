import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useEffect, useMemo, useState } from 'react';

import { api, ApiError } from '../api';

/**
 * Rendu d'un markdown attaché.
 *
 * Règle du projet : tout HTML issu d'un contenu utilisateur passe par DOMPurify
 * avant insertion. Le fichier vient du disque de Nathan, mais il vient aussi
 * d'ailleurs — un README récupéré sur un dépôt, une note exportée d'un autre
 * outil — et `marked` laisse passer le HTML brut qu'il trouve dans le markdown.
 */

marked.setOptions({ gfm: true, breaks: false });

/**
 * Les liens d'un markdown attaché pointent vers l'extérieur : ils s'ouvrent
 * dans un nouvel onglet, et `noopener` empêche la page cible de reprendre la
 * main sur celle-ci.
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false });
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

/** Charge le fichier puis l'affiche rendu. Le texte brut n'est jamais inséré tel quel. */
export function MarkdownFile({ url }: { url: string }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .fetchText(url)
      .then((text) => {
        if (!cancelled) setSource(text);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Lecture impossible.');
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  const html = useMemo(() => (source === null ? '' : renderMarkdown(source)), [source]);

  if (error) return <p className="notice notice--error">{error}</p>;
  if (source === null) return <p className="hint">Lecture du fichier…</p>;

  return (
    <div
      className="markdown"
      // Assaini juste au-dessus : c'est la seule insertion de HTML de l'application.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
