import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api';
import { formatPrice, ScoreBadge, StatusBadge } from '../components/badges';
import { Link, navigate } from '../router';
import { FAMILIES, FAMILY_LABELS, SORT_LABELS, STATUS_LABELS, STATUSES } from '../types';
import type { Family, Idea, IdeaFilters, Sort, Status } from '../types';

const SORTS: Sort[] = ['updated', 'created', 'score', 'title'];

/** Les filtres vivent dans l'URL : un catalogue filtré se met en favori et se recharge. */
function filtersFromSearch(search: string): IdeaFilters {
  const params = new URLSearchParams(search);
  const family = params.get('family') ?? '';
  const status = params.get('status') ?? '';
  const minScore = params.get('minScore') ?? '';
  const sort = params.get('sort') ?? 'updated';

  return {
    family: (FAMILIES as readonly string[]).includes(family) ? (family as Family) : '',
    status: (STATUSES as readonly string[]).includes(status) ? (status as Status) : '',
    minScore: /^[0-5]$/.test(minScore) ? Number(minScore) : '',
    sort: (SORTS as string[]).includes(sort) ? (sort as Sort) : 'updated',
  };
}

function searchFromFilters(filters: IdeaFilters): string {
  const params = new URLSearchParams();
  if (filters.family) params.set('family', filters.family);
  if (filters.status) params.set('status', filters.status);
  if (filters.minScore !== '' && filters.minScore !== undefined) {
    params.set('minScore', String(filters.minScore));
  }
  if (filters.sort && filters.sort !== 'updated') params.set('sort', filters.sort);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function Catalogue() {
  const [filters, setFilters] = useState<IdeaFilters>(() => filtersFromSearch(window.location.search));
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  const active = Boolean(filters.family || filters.status || filters.minScore !== '');

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
        <button type="button" className="button button--accent" onClick={createIdea} disabled={creating}>
          {creating ? 'Création…' : 'Nouvelle idée'}
        </button>
      </header>

      <section className="filters" aria-label="Filtres du catalogue">
        <label className="filters__field">
          <span>Famille</span>
          <select
            value={filters.family ?? ''}
            onChange={(event) => update({ family: event.target.value as Family | '' })}
          >
            <option value="">Toutes</option>
            {FAMILIES.map((family) => (
              <option key={family} value={family}>
                {FAMILY_LABELS[family]}
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
            value={filters.minScore === '' || filters.minScore === undefined ? '' : String(filters.minScore)}
            onChange={(event) => update({ minScore: event.target.value === '' ? '' : Number(event.target.value) })}
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
          <select value={filters.sort ?? 'updated'} onChange={(event) => update({ sort: event.target.value as Sort })}>
            {SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </label>

        {active && (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setFilters({ family: '', status: '', minScore: '', sort: filters.sort })}
          >
            Effacer les filtres
          </button>
        )}
      </section>

      {error && <p className="notice notice--error">{error}</p>}

      {ideas !== null && ideas.length === 0 && !error && (
        <p className="notice">
          {active
            ? 'Aucune idée ne correspond à ces filtres.'
            : 'Le catalogue est vide. Commence par une nouvelle idée.'}
        </p>
      )}

      <div className="grid">
        {(ideas ?? []).map((idea) => (
          <IdeaCard key={idea.id} idea={idea} />
        ))}
      </div>
    </div>
  );
}

function IdeaCard({ idea }: { idea: Idea }) {
  const price = formatPrice(idea.price_cents);

  return (
    <Link to={`/idees/${idea.slug}`} className="card">
      {/* La capsule choisie parmi les images attachées, sinon l'initiale du titre. */}
      <div className="card__capsule" aria-hidden="true">
        {idea.capsule_url ? (
          <img className="card__capsule-image" src={idea.capsule_url} alt="" loading="lazy" />
        ) : (
          <span className="card__capsule-initial">
            {(idea.title || '?').trim().charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      <div className="card__body">
        <h2 className="card__title">{idea.title || 'Sans titre'}</h2>
        <p className={`card__tagline ${idea.tagline ? '' : 'is-empty'}`}>
          {idea.tagline || 'Pas encore d’accroche'}
        </p>

        <div className="card__footer">
          <StatusBadge status={idea.status} />
          {price && <span className="card__price">{price}</span>}
          <ScoreBadge score={idea.current_verdict?.score ?? null} />
        </div>
      </div>
    </Link>
  );
}
