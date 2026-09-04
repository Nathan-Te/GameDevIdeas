import { useEffect, useState } from 'react';

import { api, ApiError } from '../api';
import { FamilyTag, formatDate, formatDateTime, StatusBadge } from '../components/badges';
import { Lightbox } from '../components/Lightbox';
import { filtersFromSearch, steamHref } from '../filters';
import { Link } from '../router';
import type { Attachment, Idea } from '../types';

/**
 * La vue « page store ». C'est la raison d'être de l'application : voir une
 * idée comme un joueur qui scrolle, pour avoir le réflexe « clic ou pas clic ».
 *
 * Elle emprunte la **structure** d'une fiche de magasin — capsule en tête,
 * courte description, colonne de droite, captures, titres similaires — et
 * jamais ses couleurs ni ses logos. Rien n'y est éditable : c'est une lecture,
 * et c'est ce qui la rend utile. Tout ce qu'elle affiche vient des champs de
 * l'idée ; ce qui manque se voit, et c'est le but.
 */
export function SteamPage({ slug, search }: { slug: string; search: string }) {
  const [idea, setIdea] = useState<Idea | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [neighbours, setNeighbours] = useState<Idea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError(null);
        setMissing(false);
        const [loaded, pieces] = await Promise.all([
          api.getIdea(slug),
          api.listAttachments(slug),
        ]);
        if (cancelled) return;
        setIdea(loaded);
        setAttachments(pieces);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
      }
    }

    void load();
    setViewing(null);
    return () => {
      cancelled = true;
    };
  }, [slug]);

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

  const title = idea.title || 'Sans titre';
  const capsule = attachments.find((item) => item.id === idea.capsule_file_id) ?? null;
  // Les captures sont les images attachées, la capsule mise à part : elle est
  // déjà en tête, la revoir en vignette juste dessous ne dit rien de plus.
  const shots = attachments.filter(
    (item) => item.kind === 'image' && item.file_url && item.id !== idea.capsule_file_id,
  );

  const index = neighbours.findIndex((item) => item.slug === idea.slug);
  const previous = index > 0 ? neighbours[index - 1] : null;
  const next = index >= 0 && index < neighbours.length - 1 ? neighbours[index + 1] : null;

  return (
    <div className="page page--steam">
      <div className="steam__banner">
        <span className="steam__banner-tag">Maquette</span>
        <p className="steam__banner-text">
          La structure d’une fiche de magasin, remplie avec les champs de l’idée. Rien ne s’édite
          ici.
        </p>
        <Link to={`/idees/${encodeURIComponent(idea.slug)}`} className="button button--accent">
          Modifier l’idée
        </Link>
      </div>

      <nav className="steam__nav" aria-label="Navigation entre les idées">
        <NavLink idea={previous} search={search} direction="previous" />
        <Link to={`/${search}`} className="steam__nav-back">
          {index >= 0 ? `${index + 1} / ${neighbours.length} · Catalogue` : 'Catalogue'}
        </Link>
        <NavLink idea={next} search={search} direction="next" />
      </nav>

      {error && <p className="notice notice--error">{error}</p>}

      <h1 className="steam__title">{title}</h1>

      <div className="steam__layout">
        <div className="steam__main">
          <div className="steam__media">
            <div className="steam__capsule">
              {capsule?.file_url ? (
                <img src={capsule.file_url} alt={`Capsule de ${title}`} />
              ) : (
                // Le placeholder garde le ratio : une fiche sans capsule doit
                // occuper la même place qu'une fiche avec, sinon on ne compare
                // plus les mêmes pages.
                <span className="steam__capsule-empty" aria-hidden="true">
                  {title.trim().charAt(0).toUpperCase() || '?'}
                </span>
              )}
            </div>

            <aside className="steam__trailer">
              <h2 className="steam__trailer-title">Bande-annonce</h2>
              <p className={`steam__trailer-text ${idea.gif ? '' : 'is-empty'}`}>
                {idea.gif || 'Aucun moment clipable décrit.'}
              </p>
              <p className="steam__trailer-note">
                Décrite, pas tournée : ce sont les dix secondes qu’on montrerait.
              </p>
            </aside>
          </div>

          <section className="steam__about">
            <h2 className="steam__section-title">À propos de ce jeu</h2>
            <p className={`steam__lede ${idea.tagline ? '' : 'is-empty'}`}>
              {idea.tagline || 'Pas encore d’accroche.'}
            </p>
            <p className={`steam__pitch ${idea.pitch ? '' : 'is-empty'}`}>
              {idea.pitch || 'Pas encore de pitch.'}
            </p>
          </section>

          {shots.length > 0 && (
            <section className="steam__shots">
              <h2 className="steam__section-title">Captures</h2>
              <ul className="steam__shot-list">
                {shots.map((shot, position) => (
                  <li key={shot.id}>
                    <button
                      type="button"
                      className="steam__shot"
                      onClick={() => setViewing(position)}
                      aria-label={`Voir ${shot.label} en grand`}
                    >
                      <img src={shot.file_url ?? ''} alt={shot.label} loading="lazy" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="steam__aside">
          <div className="steam__buy">
            <span className="steam__buy-label">Prix envisagé</span>
            <span className="steam__price">{steamPrice(idea.price_cents)}</span>
          </div>

          <section className="steam__panel">
            <h2 className="steam__panel-title">Avis</h2>
            {idea.current_verdict ? (
              <>
                <p className="steam__review-score">
                  {idea.current_verdict.score}
                  <span className="steam__review-max"> / 5</span>
                </p>
                {idea.current_verdict.note && (
                  <p className="steam__review-note">{idea.current_verdict.note}</p>
                )}
                <p className="steam__review-date">
                  Verdict du {formatDate(idea.current_verdict.created_at)}
                </p>
              </>
            ) : (
              <p className="steam__panel-empty">Jamais jugée.</p>
            )}
          </section>

          <section className="steam__panel">
            <h2 className="steam__panel-title">Détails</h2>

            <div className="steam__fact">
              <span className="steam__fact-label">Statut</span>
              <StatusBadge status={idea.status} />
            </div>

            <div className="steam__fact">
              <span className="steam__fact-label">Étiquettes</span>
              <span className="steam__tags">
                <FamilyTag family={idea.family} />
              </span>
            </div>

            <div className="steam__fact">
              <span className="steam__fact-label">Mise à jour</span>
              <span className="steam__fact-value">{formatDateTime(idea.updated_at)}</span>
            </div>
          </section>
        </aside>
      </div>

      <section className="steam__similar">
        <h2 className="steam__section-title">Titres similaires</h2>
        <p className={`steam__similar-text ${idea.competition ? '' : 'is-empty'}`}>
          {idea.competition || 'Aucune concurrence relevée pour l’instant.'}
        </p>
      </section>

      {viewing !== null && shots[viewing] && (
        <Lightbox
          images={shots}
          index={viewing}
          onClose={() => setViewing(null)}
          onNavigate={setViewing}
        />
      )}
    </div>
  );
}

/**
 * « Idée précédente » / « Idée suivante ». Le bout de liste est un bloc mort
 * plutôt qu'un lien absent : la barre garde la même forme d'une fiche à
 * l'autre, sinon les deux autres éléments sautent en fin de liste.
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
  const label = direction === 'previous' ? 'Précédente' : 'Suivante';
  const arrow = direction === 'previous' ? '‹' : '›';

  if (!idea) {
    return (
      <span className={`steam__nav-link steam__nav-link--${direction} is-disabled`}>
        {direction === 'previous' ? `${arrow} ${label}` : `${label} ${arrow}`}
      </span>
    );
  }

  return (
    <Link
      to={steamHref(idea.slug, search)}
      className={`steam__nav-link steam__nav-link--${direction}`}
      title={idea.title || 'Sans titre'}
    >
      {direction === 'previous' ? (
        <>
          {arrow} <span className="steam__nav-name">{idea.title || 'Sans titre'}</span>
        </>
      ) : (
        <>
          <span className="steam__nav-name">{idea.title || 'Sans titre'}</span> {arrow}
        </>
      )}
    </Link>
  );
}

/**
 * Le prix tel qu'un magasin l'afficherait. Sans prix — ou à zéro — c'est
 * « Gratuit » : sur une fiche de magasin, l'absence de prix est une
 * information, pas un champ vide.
 */
function steamPrice(cents: number | null): string {
  if (cents === null || cents === 0) return 'Gratuit';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}
