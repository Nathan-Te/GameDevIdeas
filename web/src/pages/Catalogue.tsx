import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api';
import { formatPrice, ScoreBadge, StatusBadge } from '../components/badges';
import { PlayBadge, TrailerMedia } from '../components/Trailer';
import {
  filtersFromSearch,
  hasActiveFilters,
  searchFromFilters,
  SORTS,
  steamHref,
} from '../filters';
import { useFamilies } from '../families';
import { takeFlash } from '../flash';
import { Link, navigate } from '../router';
import { SORT_LABELS, STATUS_LABELS, STATUSES } from '../types';
import type { Idea, IdeaFilters, Sort, Status } from '../types';

/** Les filtres remis à zéro. Le tri survit : ce n'est pas un filtre. */
function clearedFilters(sort: Sort | undefined): IdeaFilters {
  return { family: '', status: '', minScore: '', wishlisted: undefined, sort };
}

export function Catalogue() {
  const [filters, setFilters] = useState<IdeaFilters>(() =>
    filtersFromSearch(window.location.search),
  );
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [trashed, setTrashed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Le message laissé par une restauration réussie : elle finit ici, mais
  // l'écran qui l'a produite n'existe plus (voir `flash.ts`).
  const [flash] = useState(() => takeFlash());
  const [friendColumns, setFriendColumns] = useState(() => rememberedFriendColumns());
  const { families } = useFamilies();

  const load = useCallback(async (active: IdeaFilters) => {
    try {
      setError(null);
      setIdeas(await api.listIdeas(active));
    } catch (err) {
      setIdeas([]);
      setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
    }
  }, []);

  useEffect(() => {
    void load(filters);
    window.history.replaceState({}, '', `/${searchFromFilters(filters)}`);
  }, [filters, load]);

  /**
   * Le compteur de la corbeille, chargé à part : il ne dépend pas des filtres
   * et son échec ne doit pas priver Nathan de son catalogue.
   */
  useEffect(() => {
    let cancelled = false;
    api
      .listIdeas({ deleted: true })
      .then((list) => {
        if (!cancelled) setTrashed(list.length);
      })
      .catch(() => {
        if (!cancelled) setTrashed(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function update(patch: Partial<IdeaFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  async function createIdea() {
    setCreating(true);
    try {
      const idea = await api.createIdea({});
      navigate(`/idees/${idea.slug}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création impossible.');
      setCreating(false);
    }
  }

  const active = hasActiveFilters(filters);
  const search = searchFromFilters(filters);

  /**
   * Les deux colonnes du lot 7 sont **optionnelles** : elles ne disent rien
   * tant qu'aucun ami n'a répondu, et une carte de catalogue qui affiche « — »
   * partout est une carte plus bruyante qu'informative. Elles s'allument d'un
   * clic, et le choix se retient d'une visite à l'autre.
   */
  const showFriends = friendColumns || Boolean(filters.sort?.startsWith('friends-'));

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Vitrine</h1>
          <p className="page__subtitle">
            {ideas === null
              ? 'Chargement…'
              : `${ideas.length} idée${ideas.length > 1 ? 's' : ''}${active ? ' (filtrées)' : ''}`}
          </p>
        </div>

        <div className="page__actions">
          <Link to="/familles" className="button button--ghost">
            Familles
          </Link>
          <Link to="/corbeille" className="button button--ghost">
            Corbeille
            {trashed > 0 && <span className="button__count">{trashed}</span>}
          </Link>
          <Link to="/partages" className="button button--ghost">
            Partages
          </Link>
          <Link to="/sauvegarde" className="button button--ghost">
            Sauvegarde
          </Link>
          <button
            type="button"
            className="button button--accent"
            onClick={createIdea}
            disabled={creating}
          >
            {creating ? 'Création…' : 'Nouvelle idée'}
          </button>
        </div>
      </header>

      {flash && <p className="notice">{flash}</p>}

      <section className="filters" aria-label="Filtres du catalogue">
        <label className="filters__field">
          <span>Famille</span>
          <select
            value={filters.family ?? ''}
            onChange={(event) => update({ family: event.target.value })}
          >
            <option value="">Toutes</option>
            {families.map((family) => (
              <option key={family.slug} value={family.slug}>
                {family.label}
              </option>
            ))}
          </select>
        </label>

        <label className="filters__field">
          <span>Statut</span>
          <select
            value={filters.status ?? ''}
            onChange={(event) => update({ status: event.target.value as Status | '' })}
          >
            <option value="">Tous</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="filters__field">
          <span>Score min.</span>
          <select
            value={
              filters.minScore === '' || filters.minScore === undefined
                ? ''
                : String(filters.minScore)
            }
            onChange={(event) =>
              update({ minScore: event.target.value === '' ? '' : Number(event.target.value) })
            }
          >
            <option value="">Indifférent</option>
            {[0, 1, 2, 3, 4, 5].map((score) => (
              <option key={score} value={score}>
                {score} et plus
              </option>
            ))}
          </select>
        </label>

        <label className="filters__field">
          <span>Tri</span>
          <select
            value={filters.sort ?? 'updated'}
            onChange={(event) => update({ sort: event.target.value as Sort })}
          >
            {SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </label>

        {/* La liste de souhaits est un filtre à part : c'est le seul qui vienne
            d'un geste posé dans la vue store, pas d'un champ de la fiche. */}
        <label className="filters__toggle">
          <input
            type="checkbox"
            checked={Boolean(filters.wishlisted)}
            onChange={(event) => update({ wishlisted: event.target.checked || undefined })}
          />
          <span>Liste de souhaits</span>
        </label>

        {/* Ce que les amis en ont dit : deux colonnes de plus sur chaque carte. */}
        <label className="filters__toggle">
          <input
            type="checkbox"
            checked={friendColumns}
            onChange={(event) => {
              setFriendColumns(event.target.checked);
              rememberFriendColumns(event.target.checked);
            }}
          />
          <span>Avis des amis</span>
        </label>

        {active && (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setFilters(clearedFilters(filters.sort))}
          >
            Effacer les filtres
          </button>
        )}
      </section>

      {error && <p className="notice notice--error">{error}</p>}

      {ideas !== null && ideas.length === 0 && !error && (
        <div className="empty">
          {active ? (
            <>
              <p className="empty__title">Aucune idée ne correspond à ces filtres.</p>
              <p className="empty__text">
                Il y en a peut-être derrière un autre statut, ou sous un score plus bas.
              </p>
              <button
                type="button"
                className="button button--ghost"
                onClick={() =>
                  setFilters(clearedFilters(filters.sort))
                }
              >
                Effacer les filtres
              </button>
            </>
          ) : (
            <>
              <p className="empty__title">Le catalogue est vide.</p>
              <p className="empty__text">
                Une idée, une page, un verdict daté. Commence par la première.
              </p>
              <button
                type="button"
                className="button button--accent"
                onClick={createIdea}
                disabled={creating}
              >
                Nouvelle idée
              </button>
            </>
          )}
        </div>
      )}

      <div className="grid">
        {(ideas ?? []).map((idea) => (
          <IdeaCard key={idea.id} idea={idea} search={search} friends={showFriends} />
        ))}
      </div>
    </div>
  );
}

/**
 * Une carte du catalogue. Toute la carte mène à la page d'édition — c'est la
 * cible naturelle — et « Voir la page » ouvre la vue Steam par-dessus.
 *
 * La carte n'est donc pas un `<a>` englobant : un lien dans un lien n'est pas
 * du HTML valide, et le navigateur en fait ce qu'il veut. Le titre porte le
 * lien, étendu à toute la carte par un `::after` ; « Voir la page » repasse
 * au-dessus par son empilement.
 */
function IdeaCard({
  idea,
  search,
  friends,
}: {
  idea: Idea;
  search: string;
  friends: boolean;
}) {
  const price = formatPrice(idea.price_cents);
  const title = idea.title || 'Sans titre';
  /**
   * Au survol, la bande-annonce remplace la capsule et se joue — comme sur la
   * grille d'un magasin. Elle n'est montée qu'au survol : cinquante vidéos en
   * arrière-plan feraient ramer la page pour un effet qu'on ne voit jamais.
   *
   * L'encart central peut être une image depuis qu'une idée sans vidéo peut en
   * désigner une : il n'y a alors rien à jouer, et la carte garde sa capsule.
   */
  const trailerUrl = idea.leading_media_kind === 'trailer' ? idea.leading_media_url : null;
  const [playing, setPlaying] = useState(false);
  const play = () => setPlaying(Boolean(trailerUrl));

  return (
    <article
      className="card"
      onPointerEnter={play}
      onPointerLeave={() => setPlaying(false)}
      // Au clavier aussi : la carte se parcourt au Tab, et l'aperçu doit suivre
      // le focus comme il suit la souris.
      onFocus={play}
      onBlur={() => setPlaying(false)}
    >
      <div className="card__capsule">
        {playing && trailerUrl && (
          <TrailerMedia className="card__trailer" url={trailerUrl} title={title} />
        )}

        {!playing && trailerUrl && (
          <PlayBadge className="card__play" />
        )}

        {idea.wishlisted_at && (
          <span className="card__wish" title="Sur la liste de souhaits">
            <span aria-hidden="true">✔</span> Souhaitée
          </span>
        )}

        {idea.capsule_url ? (
          <img className="card__capsule-image" src={idea.capsule_url} alt="" loading="lazy" />
        ) : (
          <span className="card__capsule-initial" aria-hidden="true">
            {title.trim().charAt(0).toUpperCase()}
          </span>
        )}

        <Link
          to={steamHref(idea.slug, search)}
          className="card__steam"
          title={`Voir « ${title} » en page de magasin`}
        >
          Voir la page
        </Link>
      </div>

      <div className="card__body">
        <h2 className="card__title">
          <Link to={`/idees/${encodeURIComponent(idea.slug)}`} className="card__link">
            {title}
          </Link>
        </h2>
        <p className={`card__tagline ${idea.tagline ? '' : 'is-empty'}`}>
          {idea.tagline || 'Pas encore d’accroche'}
        </p>

        <div className="card__footer">
          <StatusBadge status={idea.status} />
          {price && <span className="card__price">{price}</span>}
          <ScoreBadge score={idea.current_verdict?.score ?? null} />
        </div>

        {/* Les amis, à part du verdict et jamais confondus avec lui : le badge
            de score est celui de Nathan, cette ligne est celle des autres. */}
        {friends && (
          <div className="card__friends">
            <span title="Moyenne des avis d’amis">
              ★ {idea.friend_score_avg === null ? '—' : idea.friend_score_avg}
              <span className="card__friends-unit">
                {idea.friend_review_count > 0 ? ` (${idea.friend_review_count})` : ''}
              </span>
            </span>
            <span title="Mises en liste de souhaits par des amis">
              ♡ {idea.friend_wishlist_count}
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * L'affichage des colonnes d'amis se retient dans le navigateur : c'est une
 * préférence d'écran, pas un filtre — elle n'a donc rien à faire dans l'URL,
 * qui sert à partager une liste, pas une mise en page.
 */
const FRIENDS_KEY = 'vitrine.catalogue.friends';

function rememberedFriendColumns(): boolean {
  try {
    return window.localStorage.getItem(FRIENDS_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberFriendColumns(value: boolean): void {
  try {
    window.localStorage.setItem(FRIENDS_KEY, value ? '1' : '0');
  } catch {
    /* stockage indisponible : la case retombera décochée au prochain passage */
  }
}
