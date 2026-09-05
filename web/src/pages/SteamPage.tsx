import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api';
import { StoreMock } from '../components/StoreMock';
import { findFamily, useFamilies } from '../families';
import { filtersFromSearch, steamHref } from '../filters';
import { Link } from '../router';
import '../steam.css';
import type { Attachment, Idea, StoreReview } from '../types';

/**
 * La vue « page store » — la raison d'être de l'application.
 *
 * Depuis le lot 7, la maquette elle-même vit dans `components/StoreMock` :
 * cette page charge les données de Nathan et la lui montre, la page invité
 * (`SharePage`) charge celles d'une sélection et montre la même. Il n'y a
 * qu'une maquette, donc l'ami voit exactement la page que Nathan a regardée.
 *
 * Ce qui reste ici est ce qui appartient à Vitrine et pas au magasin :
 * enchaîner les idées en respectant les filtres du catalogue, et revenir à
 * l'édition. Cette barre de service est hors du photomontage, au-dessus.
 *
 * Le bloc des évaluations est désormais alimenté par les **avis d'amis**. Le
 * verdict de Nathan n'y figure plus : il n'a jamais été un avis de joueur, et
 * l'y faire passer était le point ouvert du lot 3b.
 */
export function SteamPage({ slug, search }: { slug: string; search: string }) {
  const [idea, setIdea] = useState<Idea | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [reviews, setReviews] = useState<StoreReview[]>([]);
  const [developer, setDeveloper] = useState('Nathan');
  const [neighbours, setNeighbours] = useState<Idea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const { families } = useFamilies();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError(null);
        setMissing(false);
        const [loaded, pieces, friends] = await Promise.all([
          api.getIdea(slug),
          api.listAttachments(slug),
          api.listReviews(slug),
        ]);
        if (cancelled) return;
        setIdea(loaded);
        setAttachments(pieces);
        setReviews(friends);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  /** Le nom du développeur vient de la configuration du serveur, pas de l'idée. */
  useEffect(() => {
    let cancelled = false;
    api
      .getConfig()
      .then(({ developer_name }) => {
        if (!cancelled && developer_name) setDeveloper(developer_name);
      })
      .catch(() => {
        /* Le défaut fait l'affaire : une page sans éditeur serait plus fausse. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * La liste voisine, chargée à part : elle ne sert qu'à « précédente » et
   * « suivante », et son échec ne doit pas empêcher de lire la fiche. Elle
   * reprend exactement les filtres et le tri du catalogue, lus dans l'URL.
   */
  useEffect(() => {
    let cancelled = false;

    api
      .listIdeas(filtersFromSearch(search))
      .then((list) => {
        if (!cancelled) setNeighbours(list);
      })
      .catch(() => {
        if (!cancelled) setNeighbours([]);
      });

    return () => {
      cancelled = true;
    };
  }, [search]);

  /**
   * Le seul appel écrivant de la page. L'état bascule tout de suite et se
   * corrige si le serveur refuse : le geste doit être instantané, c'est tout ce
   * qu'on lui demande.
   */
  const toggleWishlist = useCallback(async () => {
    if (!idea || saving) return;
    const next = !idea.wishlisted_at;
    setSaving(true);
    try {
      const updated = await api.setWishlisted(idea.slug, next);
      setIdea(updated);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Liste de souhaits indisponible.');
    } finally {
      setSaving(false);
    }
  }, [idea, saving]);

  if (missing) {
    return (
      <div className="page">
        <p className="notice notice--error">Aucune idée à cette adresse.</p>
        <Link to="/" className="button button--ghost">
          Retour au catalogue
        </Link>
      </div>
    );
  }

  if (!idea) {
    return (
      <div className="page">
        <p className="notice">{error ?? 'Chargement…'}</p>
      </div>
    );
  }

  const index = neighbours.findIndex((item) => item.slug === idea.slug);
  const previous = index > 0 ? neighbours[index - 1] : null;
  const next = index >= 0 && index < neighbours.length - 1 ? neighbours[index + 1] : null;

  return (
    <div className="steam-page">
      {/* Hors maquette : tout ce qui appartient à Vitrine et pas au magasin. */}
      <nav className="sp-toolbar" aria-label="Navigation entre les idées">
        <Link to={`/${search}`} className="sp-toolbar__link">
          ‹ Catalogue
        </Link>
        {index >= 0 && (
          <span className="sp-toolbar__count">
            {index + 1} / {neighbours.length}
          </span>
        )}
        <span className="sp-toolbar__spacer" />
        {error && <span className="sp-toolbar__notice">{error}</span>}
        <NavLink idea={previous} search={search} direction="previous" />
        <NavLink idea={next} search={search} direction="next" />
        <Link to={`/idees/${encodeURIComponent(idea.slug)}`} className="button button--accent">
          Modifier l’idée
        </Link>
      </nav>

      <StoreMock
        idea={idea}
        attachments={attachments}
        family={findFamily(families, idea.family)}
        developer={developer}
        reviews={reviews}
        wishlisted={Boolean(idea.wishlisted_at)}
        onToggleWishlist={() => void toggleWishlist()}
        wishlistBusy={saving}
      />
    </div>
  );
}

/**
 * « Idée précédente » / « Idée suivante », dans la barre de service. Le bout de
 * liste est un bloc mort plutôt qu'un lien absent : la barre garde la même
 * forme d'une fiche à l'autre.
 */
function NavLink({
  idea,
  search,
  direction,
}: {
  idea: Idea | null;
  search: string;
  direction: 'previous' | 'next';
}) {
  const arrow = direction === 'previous' ? '‹' : '›';
  const label = direction === 'previous' ? 'Précédente' : 'Suivante';

  if (!idea) {
    return <span className="sp-toolbar__link is-disabled">{`${arrow} ${label}`}</span>;
  }

  return (
    <Link
      to={steamHref(idea.slug, search)}
      className="sp-toolbar__link"
      title={idea.title || 'Sans titre'}
    >
      {direction === 'previous' ? `${arrow} ` : ''}
      {idea.title || 'Sans titre'}
      {direction === 'next' ? ` ${arrow}` : ''}
    </Link>
  );
}
