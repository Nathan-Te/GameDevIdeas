import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api';
import { formatDateTime } from '../components/badges';
import { Link } from '../router';
import type { Idea } from '../types';

/**
 * La corbeille. Le lot 2 laissait `restore` sans interface et aucune purge :
 * une idée supprimée n'était plus visible nulle part, et ses fichiers restaient
 * sur le disque pour toujours. C'est le premier morceau du lot 3.
 *
 * Restaurer est sans conséquence, purger est définitif : les deux boutons ne se
 * ressemblent pas, et la purge annonce toujours ce qu'elle emporte.
 */
export function Trash() {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [emptying, setEmptying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setIdeas(await api.listIdeas({ deleted: true }));
    } catch (err) {
      setIdeas([]);
      setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(idea: Idea) {
    setBusy(idea.slug);
    try {
      setError(null);
      await api.restoreIdea(idea.slug);
      setIdeas((current) => (current ?? []).filter((item) => item.slug !== idea.slug));
      setNotice(`« ${title(idea)} » est de retour au catalogue.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Restauration impossible.');
    } finally {
      setBusy(null);
    }
  }

  async function purge(idea: Idea) {
    const confirmed = window.confirm(
      `Supprimer définitivement « ${title(idea)} » ?\n\n` +
        `${attachmentSentence(idea.attachment_count)} C'est irréversible.`,
    );
    if (!confirmed) return;

    setBusy(idea.slug);
    try {
      setError(null);
      const result = await api.purgeIdea(idea.slug);
      setIdeas((current) => (current ?? []).filter((item) => item.slug !== idea.slug));
      setNotice(orphanWarning(result.orphan_directory) ?? `« ${title(idea)} » a été supprimée.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Suppression impossible.');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Vider la corbeille purge idée par idée : une purge est déjà une opération
   * complète côté serveur, et une boucle ici laisse voir ce qui s'est passé si
   * l'une d'elles échoue — plutôt qu'un « tout ou rien » sur cinquante idées.
   */
  async function emptyAll() {
    const list = ideas ?? [];
    if (!list.length) return;

    const files = list.reduce((total, idea) => total + idea.attachment_count, 0);
    const confirmed = window.confirm(
      `Vider la corbeille ?\n\n` +
        `${countLabel(list.length, 'idée', 'idées', 'aucune idée')} et ` +
        `${countLabel(files, 'pièce jointe', 'pièces jointes', 'aucune pièce jointe')} ` +
        `disparaissent définitivement, fichiers compris. C'est irréversible.`,
    );
    if (!confirmed) return;

    setEmptying(true);
    setError(null);

    let removed = 0;
    let orphans = false;

    for (const idea of list) {
      try {
        const result = await api.purgeIdea(idea.slug);
        removed += 1;
        orphans = orphans || result.orphan_directory;
        setIdeas((current) => (current ?? []).filter((item) => item.slug !== idea.slug));
      } catch (err) {
        setError(
          `Arrêté sur « ${title(idea)} » : ${
            err instanceof ApiError ? err.message : 'suppression impossible.'
          }`,
        );
        break;
      }
    }

    setEmptying(false);
    setNotice(
      orphanWarning(orphans) ??
        `${removed} idée${removed > 1 ? 's' : ''} supprimée${removed > 1 ? 's' : ''}.`,
    );
  }

  const count = ideas?.length ?? 0;

  return (
    <div className="page page--trash">
      <header className="page__header">
        <div>
          <Link to="/" className="page__crumb">
            ← Catalogue
          </Link>
          <h1 className="page__title">Corbeille</h1>
          <p className="page__subtitle">
            {ideas === null
              ? 'Chargement…'
              : count === 0
                ? 'Rien à jeter.'
                : `${count} idée${count > 1 ? 's' : ''} supprimée${count > 1 ? 's' : ''}`}
          </p>
        </div>

        {count > 0 && (
          <button
            type="button"
            className="button button--danger"
            onClick={emptyAll}
            disabled={emptying}
          >
            {emptying ? 'Suppression…' : 'Vider la corbeille'}
          </button>
        )}
      </header>

      {error && <p className="notice notice--error">{error}</p>}
      {notice && !error && <p className="notice">{notice}</p>}

      {ideas !== null && count === 0 && !error && (
        <div className="empty">
          <p className="empty__title">La corbeille est vide.</p>
          <p className="empty__text">
            Une idée supprimée depuis sa page atterrit ici. Elle y reste tant qu’elle n’est pas
            purgée, ses pièces jointes comprises.
          </p>
          <Link to="/" className="button button--ghost">
            Retour au catalogue
          </Link>
        </div>
      )}

      {count > 0 && (
        <ul className="trash-list">
          {(ideas ?? []).map((idea) => (
            <li key={idea.id} className="trash-item">
              <div className="trash-item__capsule" aria-hidden="true">
                {idea.capsule_url ? (
                  <img src={idea.capsule_url} alt="" loading="lazy" />
                ) : (
                  <span>{title(idea).trim().charAt(0).toUpperCase()}</span>
                )}
              </div>

              <div className="trash-item__body">
                <h2 className="trash-item__title">{title(idea)}</h2>
                <p className="trash-item__meta">
                  Supprimée le {formatDateTime(idea.deleted_at ?? idea.updated_at)}
                  {idea.attachment_count > 0 &&
                    ` · ${countLabel(idea.attachment_count, 'pièce jointe', 'pièces jointes', '')}`}
                </p>
              </div>

              <div className="trash-item__actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => void restore(idea)}
                  disabled={busy === idea.slug || emptying}
                >
                  Restaurer
                </button>
                <button
                  type="button"
                  className="button button--danger-ghost"
                  onClick={() => void purge(idea)}
                  disabled={busy === idea.slug || emptying}
                >
                  Supprimer définitivement
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const title = (idea: Idea) => idea.title || 'Sans titre';

/**
 * « 3 pièces jointes », « 1 idée », « aucune pièce jointe ». Les trois formes
 * sont passées en clair plutôt que fabriquées : c'est plus court qu'une règle
 * d'accord, et une confirmation de suppression définitive n'a pas le droit
 * d'être bancale.
 */
function countLabel(count: number, one: string, many: string, none: string): string {
  if (count === 0) return none;
  return `${count} ${count > 1 ? many : one}`;
}

/**
 * Ce qu'une purge emporte en plus de l'idée. Au présent : sinon il faudrait
 * accorder un participe avec un nombre qu'on ne connaît qu'à l'exécution.
 */
function attachmentSentence(count: number): string {
  if (count === 0) return 'Elle n’a aucune pièce jointe.';
  if (count === 1) return 'Sa pièce jointe part avec elle, son fichier aussi.';
  return `Ses ${count} pièces jointes partent avec elle, leurs fichiers aussi.`;
}

/**
 * Le serveur signale un dossier qu'il n'a pas pu effacer. La base est propre,
 * mais des fichiers restent : c'est le genre de chose qui doit se dire.
 */
function orphanWarning(orphan: boolean): string | null {
  return orphan
    ? 'Supprimée en base, mais le dossier de fichiers n’a pas pu être effacé — voir le journal du serveur.'
    : null;
}
