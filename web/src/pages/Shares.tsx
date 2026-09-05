import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';

import { api, ApiError } from '../api';
import { formatDate } from '../components/badges';
import { Link } from '../router';
import type { Idea, Share } from '../types';

/**
 * `/partages` — l'écran des sélections.
 *
 * C'est d'ici que Nathan ouvre une porte sur Internet, et c'est le seul endroit
 * de l'application où ce geste existe. L'écran est donc écrit pour que l'état
 * de chaque lien soit lisible d'un coup d'œil : combien d'idées, combien de
 * visiteurs, ouvert ou fermé — et un bouton pour refermer, toujours visible.
 */
export function Shares() {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [list, catalogue] = await Promise.all([api.listShares(), api.listIdeas({ sort: 'title' })]);
      setShares(list);
      setIdeas(catalogue);
    } catch (err) {
      setShares([]);
      setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Partages</h1>
          <p className="page__subtitle">
            Un lien, une sélection d’idées, des avis d’amis. Les avis n’ont rien à voir avec tes
            verdicts : ils vivent à part, et ils y restent.
          </p>
        </div>
        <Link to="/" className="button button--ghost">
          Catalogue
        </Link>
      </header>

      {error && <p className="notice notice--error">{error}</p>}

      <NewShare ideas={ideas} onCreated={load} />

      {shares !== null && shares.length === 0 && (
        <div className="empty">
          <p className="empty__title">Aucune sélection pour l’instant.</p>
          <p className="empty__text">
            Coche quelques idées au-dessus, donne un nom au lien, et envoie-le.
          </p>
        </div>
      )}

      <div className="shares">
        {(shares ?? []).map((share) => (
          <ShareCard key={share.id} share={share} onChanged={load} />
        ))}
      </div>
    </div>
  );
}

/** Le formulaire de création : un libellé, une échéance, et la sélection ordonnée. */
function NewShare({ ideas, onCreated }: { ideas: Idea[]; onCreated: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [expires, setExpires] = useState('');
  const [visible, setVisible] = useState(true);
  /** Les slugs retenus, **dans l'ordre** : c'est l'ordre où les amis scrollent. */
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(slug: string) {
    setChosen((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );
  }

  function move(slug: string, delta: number) {
    setChosen((current) => {
      const from = current.indexOf(slug);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api.createShare({
        label,
        idea_slugs: chosen,
        reviews_visible: visible,
        expires_at: expires || null,
      });
      setLabel('');
      setExpires('');
      setChosen([]);
      setOpen(false);
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création impossible.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="button button--accent" onClick={() => setOpen(true)}>
        Nouvelle sélection
      </button>
    );
  }

  const title = (slug: string) =>
    ideas.find((idea) => idea.slug === slug)?.title || 'Sans titre';

  return (
    <section className="panel share-new">
      <h2 className="panel__title">Nouvelle sélection</h2>

      <div className="share-new__fields">
        <label className="filters__field">
          <span>Libellé</span>
          <input
            className="input"
            value={label}
            maxLength={120}
            placeholder="Les copains"
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>

        <label className="filters__field">
          <span>Expire le</span>
          <input
            className="input"
            type="date"
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
          />
        </label>

        <label className="filters__toggle">
          <input
            type="checkbox"
            checked={visible}
            onChange={(event) => setVisible(event.target.checked)}
          />
          <span>Les visiteurs voient les avis des autres</span>
        </label>
      </div>

      <div className="share-new__columns">
        <div>
          <h3 className="share-new__heading">Les idées ({ideas.length})</h3>
          <ul className="share-pick">
            {ideas.map((idea) => (
              <li key={idea.slug}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.includes(idea.slug)}
                    onChange={() => toggle(idea.slug)}
                  />
                  <span>{idea.title || 'Sans titre'}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="share-new__heading">L’ordre de lecture ({chosen.length})</h3>
          {chosen.length === 0 ? (
            <p className="hint">Coche des idées à gauche.</p>
          ) : (
            <ol className="share-order">
              {chosen.map((slug, position) => (
                <li key={slug}>
                  <span className="share-order__title">{title(slug)}</span>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => move(slug, -1)}
                    disabled={position === 0}
                    aria-label={`Monter ${title(slug)}`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => move(slug, 1)}
                    disabled={position === chosen.length - 1}
                    aria-label={`Descendre ${title(slug)}`}
                  >
                    ↓
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {error && <p className="notice notice--error">{error}</p>}

      <div className="share-new__actions">
        <button
          type="button"
          className="button button--accent"
          disabled={busy || chosen.length === 0}
          onClick={() => void create()}
        >
          {busy ? 'Création…' : 'Créer le lien'}
        </button>
        <button type="button" className="button button--ghost" onClick={() => setOpen(false)}>
          Annuler
        </button>
      </div>
    </section>
  );
}

/** Une sélection : son lien, son QR code, ses compteurs, sa révocation. */
function ShareCard({ share, onChanged }: { share: Share; onChanged: () => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * L'adresse publique n'est pas celle du navigateur : Nathan regarde cet écran
   * depuis le tailnet, ses amis arriveront par l'URL de Funnel. Elle se règle
   * ici et se retient — c'est un réglage de poste, pas une donnée du serveur,
   * qui n'a aucun moyen de connaître son nom public.
   */
  const [origin, setOrigin] = useState(() => publicOrigin());
  const url = `${origin || window.location.origin}/p/${share.token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copie refusée par le navigateur — sélectionne le lien à la main.');
    }
  }

  async function act(action: () => Promise<unknown>) {
    try {
      setError(null);
      await action();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible d’enregistrer.');
    }
  }

  return (
    <article className={`share ${share.active ? '' : 'is-closed'}`}>
      <header className="share__head">
        <h2 className="share__label">{share.label || 'Sans nom'}</h2>
        <span className={`share__state ${share.active ? 'is-open' : ''}`}>
          {share.active ? 'Ouvert' : share.revoked_at ? 'Révoqué' : 'Expiré'}
        </span>
        <span className="share__date">créé le {formatDate(share.created_at)}</span>
        {share.expires_at && (
          <span className="share__date">expire le {formatDate(share.expires_at)}</span>
        )}
      </header>

      <div className="share__link">
        <input className="input" value={url} readOnly aria-label="Lien de la sélection" />
        <button type="button" className="button button--ghost" onClick={() => void copy()}>
          {copied ? 'Copié' : 'Copier'}
        </button>
      </div>

      <details className="share__origin">
        <summary>Adresse publique</summary>
        <p className="hint">
          L’adresse par laquelle tes amis arrivent — celle de Tailscale Funnel. Elle est retenue
          dans ce navigateur ; le serveur ne la connaît pas.
        </p>
        <input
          className="input"
          value={origin}
          placeholder="https://ma-machine.mon-tailnet.ts.net"
          aria-label="Adresse publique"
          onChange={(event) => {
            setOrigin(event.target.value.replace(/\/+$/, ''));
            rememberOrigin(event.target.value.replace(/\/+$/, ''));
          }}
        />
      </details>

      <div className="share__body">
        <Qr value={url} />

        <dl className="share__counts">
          <div>
            <dt>Idées</dt>
            <dd>{share.idea_count}</dd>
          </div>
          <div>
            <dt>Visiteurs</dt>
            <dd>{share.visitor_count}</dd>
          </div>
          <div>
            <dt>Avis</dt>
            <dd>{share.review_count}</dd>
          </div>
          <div>
            <dt>Souhaits</dt>
            <dd>{share.wishlist_count}</dd>
          </div>
        </dl>
      </div>

      <ul className="share__ideas">
        {share.ideas.map((idea) => (
          <li key={idea.slug}>
            <Link to={`/idees/${encodeURIComponent(idea.slug)}`}>{idea.title || 'Sans titre'}</Link>
            {idea.friend_score_avg !== null && (
              <span className="share__score">
                {idea.friend_score_avg} / 5 · {idea.friend_review_count} avis
              </span>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="notice notice--error">{error}</p>}

      <footer className="share__actions">
        <label className="filters__toggle">
          <input
            type="checkbox"
            checked={share.reviews_visible}
            onChange={(event) =>
              void act(() => api.updateShare(share.id, { reviews_visible: event.target.checked }))
            }
          />
          <span>Les visiteurs voient les avis des autres</span>
        </label>

        {share.active ? (
          <button
            type="button"
            className="button button--danger"
            onClick={() => {
              if (window.confirm(`Fermer « ${share.label || 'Sans nom'} » ? Le lien répondra comme s’il n’avait jamais existé. Les avis déjà reçus restent.`)) {
                void act(() => api.revokeShare(share.id));
              }
            }}
          >
            Révoquer le lien
          </button>
        ) : (
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void act(() => api.updateShare(share.id, { revoked: false, expires_at: null }))}
          >
            Rouvrir
          </button>
        )}
      </footer>
    </article>
  );
}

/**
 * Le QR code du lien. Rendu en SVG dans la page : rien à télécharger, et il
 * reste net sur l'écran d'un téléphone qu'on approche.
 */
function Qr({ value }: { value: string }) {
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { type: 'svg', margin: 1, width: 160 })
      .then((markup) => {
        if (!cancelled) setSvg(markup);
      })
      .catch(() => {
        if (!cancelled) setSvg('');
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!svg) return <div className="share__qr is-empty" aria-hidden="true" />;

  /**
   * `dangerouslySetInnerHTML` sur du SVG **produit ici** à partir d'une URL que
   * cette page vient de composer : ce n'est pas du contenu utilisateur, il ne
   * passe par aucune saisie et la bibliothèque ne rend que des rectangles. La
   * règle du projet (tout HTML utilisateur passe par DOMPurify) ne s'applique
   * pas — il n'y a pas d'utilisateur dans cette chaîne.
   */
  return (
    <div
      className="share__qr"
      role="img"
      aria-label="QR code du lien de partage"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

const ORIGIN_KEY = 'vitrine.public.origin';

function publicOrigin(): string {
  try {
    return window.localStorage.getItem(ORIGIN_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberOrigin(value: string): void {
  try {
    window.localStorage.setItem(ORIGIN_KEY, value);
  } catch {
    /* stockage indisponible : le lien reste bon, il faudra le retaper */
  }
}
