import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '../api';
import { Attachments } from '../components/Attachments';
import { formatDate, formatDateTime, formatPrice } from '../components/badges';
import { EditableText } from '../components/EditableText';
import { useFamilies } from '../families';
import { Link, navigate } from '../router';
import { STATUS_LABELS, STATUSES } from '../types';
import type { Idea, IdeaPatch, Status, StoreReview, Verdict } from '../types';

export function IdeaPage({ slug }: { slug: string }) {
  const [idea, setIdea] = useState<Idea | null>(null);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  /**
   * Les avis d'amis. Un état à part des verdicts, comme ils sont une table à
   * part : les mêler ici serait la première marche vers les mêler ailleurs.
   */
  const [reviews, setReviews] = useState<StoreReview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [saved, setSaved] = useState(false);
  const { families } = useFamilies();
  /**
   * Le nombre de bandes-annonces, remonté par la liste des pièces jointes : la
   * fiche l'annonce, et c'est le seul endroit de la page qui n'a pas la liste
   * sous la main.
   */
  const [trailerCount, setTrailerCount] = useState(0);
  const savedTimer = useRef<number | undefined>(undefined);
  /**
   * Le slug de l'idée en mémoire. Renommer une idée change l'URL — donc la prop
   * `slug` — sans qu'il y ait quoi que ce soit à recharger : ce miroir permet
   * de distinguer « on vient de renommer » de « on a navigué vers une autre idée ».
   */
  const loadedSlug = useRef<string | null>(null);

  useEffect(() => {
    if (loadedSlug.current === slug) return undefined;
    let cancelled = false;

    async function load() {
      try {
        setError(null);
        setMissing(false);
        const [loaded, history, friends] = await Promise.all([
          api.getIdea(slug),
          api.listVerdicts(slug),
          api.listReviews(slug),
        ]);
        if (cancelled) return;
        loadedSlug.current = loaded.slug;
        setIdea(loaded);
        setVerdicts(history);
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

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  /** Indicateur discret : « Enregistré » s'affiche puis s'efface tout seul. */
  const flashSaved = useCallback(() => {
    setSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1800);
  }, []);

  const save = useCallback(
    async (patch: IdeaPatch) => {
      if (!idea) return;
      try {
        setError(null);
        const updated = await api.updateIdea(idea.slug, patch);
        loadedSlug.current = updated.slug;
        setIdea(updated);
        flashSaved();
        // Le serveur peut avoir resynchronisé le slug sur le nouveau titre : on
        // corrige l'URL sans empiler d'entrée d'historique ni recharger la page.
        if (updated.slug !== idea.slug) navigate(`/idees/${updated.slug}`, { replace: true });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
      }
    },
    [idea, flashSaved],
  );

  /**
   * Relit l'idée sans passer par le chargement initial. Sert quand le serveur a
   * pu changer un champ tout seul — la bande-annonce en tête après une
   * suppression, par exemple.
   */
  const reload = useCallback(() => {
    if (!idea) return;
    api
      .getIdea(idea.slug)
      .then(setIdea)
      .catch(() => {
        /* L'affichage courant reste valable : ce n'est qu'une resynchronisation. */
      });
  }, [idea]);

  async function addVerdict(score: number, note: string) {
    if (!idea) return;
    const verdict = await api.createVerdict(idea.slug, { score, note });
    setVerdicts((current) => [verdict, ...current]);
    setIdea((current) => (current ? { ...current, current_verdict: verdict } : current));
    flashSaved();
  }

  async function remove() {
    if (!idea) return;
    const confirmed = window.confirm(
      `Envoyer « ${idea.title || 'Sans titre'} » à la corbeille ? Elle sera restaurable.`,
    );
    if (!confirmed) return;
    try {
      await api.deleteIdea(idea.slug);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Suppression impossible.');
    }
  }

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

  return (
    <div className="page page--idea">
      <div className="idea__bar">
        <Link to="/" className="idea__back">
          ← Catalogue
        </Link>
        <span className={`idea__saved ${saved ? 'is-visible' : ''}`} role="status" aria-live="polite">
          {saved ? 'Enregistré' : ''}
        </span>
        {/* La vue Steam est la raison d'être de l'application : elle se rejoint
            d'un clic depuis la fiche, et sans quitter l'idée en cours. */}
        <Link to={`/idees/${encodeURIComponent(idea.slug)}/steam`} className="button">
          Voir la page
        </Link>
        <button type="button" className="button button--danger-ghost" onClick={remove}>
          Corbeille
        </button>
      </div>

      {error && <p className="notice notice--error">{error}</p>}

      <header className="idea__header">
        {idea.capsule_url && (
          // Ratio 460 x 215, celui d'une capsule Steam : l'image est recadrée
          // par `object-fit: cover` plutôt que déformée.
          <div className="idea__capsule">
            <img src={idea.capsule_url} alt={`Capsule de ${idea.title || 'l’idée'}`} />
          </div>
        )}

        <EditableText
          label="le titre"
          className="idea__title"
          value={idea.title}
          placeholder="Sans titre"
          onSave={(title) => save({ title })}
        />
        <EditableText
          label="l’accroche"
          className="idea__tagline"
          value={idea.tagline}
          placeholder="Une ligne : l’accroche qu’on lirait sur Steam"
          onSave={(tagline) => save({ tagline })}
        />
      </header>

      <div className="idea__layout">
        <main className="idea__main">
          <Field label="Pitch" hint="2 à 4 phrases.">
            <EditableText
              label="le pitch"
              className="idea__prose"
              multiline
              value={idea.pitch}
              placeholder="De quoi parle le jeu, en deux à quatre phrases."
              onSave={(pitch) => save({ pitch })}
            />
          </Field>

          {/* Le champ « GIF » décrit le moment ; la bande-annonce le montre. Le
              texte devient le sous-titre du lecteur sur la vue store, et reste
              la carte de tête quand aucune bande-annonce n'est déposée. */}
          <Field label="Le GIF" hint="Le moment clipable de 10 secondes.">
            <EditableText
              label="la description du GIF"
              className="idea__prose"
              multiline
              value={idea.gif}
              placeholder="Décris les 10 secondes qu’on montrerait en GIF."
              onSave={(gif) => save({ gif })}
            />
          </Field>

          <Field label="Concurrence" hint="Ce qui existe déjà, et ce que ça change.">
            <EditableText
              label="la concurrence"
              className="idea__prose"
              multiline
              value={idea.competition}
              placeholder="Jeux comparables, ce qu’ils font bien, ce qu’ils laissent de côté."
              onSave={(competition) => save({ competition })}
            />
          </Field>

          <Attachments
            slug={idea.slug}
            capsuleFileId={idea.capsule_file_id}
            leadingMediaId={idea.leading_media_id}
            onCapsuleChange={(capsule_file_id) => save({ capsule_file_id })}
            onLeadingChange={(trailer_file_id) => save({ trailer_file_id })}
            onCapsuleLost={() =>
              setIdea((current) =>
                current ? { ...current, capsule_file_id: null, capsule_url: null } : current,
              )
            }
            // La tête a pu passer à la bande-annonce suivante : c'est une règle
            // du serveur, on relit plutôt que de la rejouer ici.
            onLeadingLost={reload}
            onCountChange={setTrailerCount}
          />

          <VerdictSection verdicts={verdicts} onSubmit={addVerdict} />

          <ReviewSection
            reviews={reviews}
            onDelete={async (id) => {
              await api.deleteReview(id);
              setReviews((current) => current.filter((review) => review.id !== id));
            }}
          />
        </main>

        <aside className="idea__aside">
          <div className="panel">
            <h2 className="panel__title">Fiche</h2>

            <Row label="Statut">
              <select
                className="select"
                value={idea.status}
                aria-label="Statut"
                onChange={(event) => void save({ status: event.target.value as Status })}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </Row>

            <Row label="Bandes-annonces">
              <span className="idea__meta">
                {trailerCount === 0
                  ? 'Aucune — une image mise en tête tiendra l’encart central'
                  : `${trailerCount} — la première ouvre la page store`}
              </span>
            </Row>

            <Row label="Famille">
              <select
                className="select"
                value={idea.family}
                aria-label="Famille"
                onChange={(event) => void save({ family: event.target.value })}
              >
                {/* Une famille supprimée ou renommée pendant que l'onglet était
                    ouvert : on garde l'option pour ne pas afficher une autre
                    famille que celle réellement enregistrée. */}
                {!families.some((family) => family.slug === idea.family) && (
                  <option value={idea.family}>{idea.family}</option>
                )}
                {families.map((family) => (
                  <option key={family.slug} value={family.slug}>
                    {family.label}
                  </option>
                ))}
              </select>
            </Row>

            <Row label="Prix">
              <PriceField cents={idea.price_cents} onSave={(price_cents) => save({ price_cents })} />
            </Row>

            <Row label="Score courant">
              <span className="idea__score">
                {idea.current_verdict ? `${idea.current_verdict.score} / 5` : 'jamais jugée'}
              </span>
            </Row>

            <Row label="Adresse">
              <EditableText
                label="le slug"
                className="idea__slug"
                value={idea.slug}
                onSave={(next) => save({ slug: next })}
              />
            </Row>

            <Row label="Créée">
              <span className="idea__meta">{formatDate(idea.created_at)}</span>
            </Row>
            <Row label="Modifiée">
              <span className="idea__meta">{formatDateTime(idea.updated_at)}</span>
            </Row>
          </div>

          <p className="hint">
            Clic sur un champ pour l’ouvrir. Entrée ou sortie du champ enregistre, Échap annule. Dans
            un champ long, Entrée saute une ligne — Ctrl+Entrée enregistre.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="field">
      <h2 className="field__label">
        {label}
        {hint && <span className="field__hint">{hint}</span>}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <span className="row__label">{label}</span>
      <div className="row__value">{children}</div>
    </div>
  );
}

/** Le prix se saisit en euros et se stocke en centimes. */
function PriceField({ cents, onSave }: { cents: number | null; onSave: (cents: number | null) => void }) {
  const display = cents === null ? '' : String(cents / 100);

  return (
    <EditableText
      label="le prix en euros"
      className="idea__price idea__price--nowrap"
      value={display ? formatPrice(cents) : ''}
      placeholder="—"
      onSave={(next) => {
        const cleaned = next.replace(/[^0-9,.]/g, '').replace(',', '.');
        if (cleaned === '') return onSave(null);
        const euros = Number(cleaned);
        if (!Number.isFinite(euros) || euros < 0) return;
        onSave(Math.round(euros * 100));
      }}
    />
  );
}

function VerdictSection({
  verdicts,
  onSubmit,
}: {
  verdicts: Verdict[];
  onSubmit: (score: number, note: string) => Promise<void>;
}) {
  const [score, setScore] = useState(3);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      setError(null);
      await onSubmit(score, note.trim());
      setNote('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verdict non enregistré.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="field verdicts">
      <h2 className="field__label">
        Verdicts
        <span className="field__hint">On n’écrase jamais : chaque verdict est daté.</span>
      </h2>

      <form className="verdict-form" onSubmit={submit}>
        <div className="verdict-form__scores" role="group" aria-label="Score de 0 à 5">
          {[0, 1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              className={`chip ${value === score ? 'is-active' : ''}`}
              aria-pressed={value === score}
              onClick={() => setScore(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <textarea
          className="verdict-form__note"
          value={note}
          rows={2}
          placeholder="Ce que tu en penses aujourd’hui (facultatif)."
          aria-label="Note du verdict"
          onChange={(event) => setNote(event.target.value)}
        />
        <button type="submit" className="button button--accent" disabled={busy}>
          {busy ? 'Enregistrement…' : 'Ajouter le verdict'}
        </button>
      </form>

      {error && <p className="notice notice--error">{error}</p>}

      {verdicts.length === 0 ? (
        <p className="hint">Aucun verdict pour l’instant.</p>
      ) : (
        <ol className="verdict-list">
          {verdicts.map((verdict, index) => (
            <li key={verdict.id} className={`verdict ${index === 0 ? 'is-current' : ''}`}>
              <span className="verdict__score">{verdict.score}</span>
              <div className="verdict__body">
                <time className="verdict__date" dateTime={verdict.created_at}>
                  {formatDateTime(verdict.created_at)}
                  {index === 0 && <span className="verdict__current">courant</span>}
                </time>
                {verdict.note && <p className="verdict__note">{verdict.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Les avis d'amis reçus par cette idée.
 *
 * Une section à part, sous les verdicts et jamais mêlée à eux : **un avis d'ami
 * n'est pas un verdict**. Le verdict est le jugement de Nathan, daté, qu'on
 * n'écrase jamais ; l'avis est celui de quelqu'un d'autre, qui peut le
 * corriger. Les additionner donnerait une note qui n'est celle de personne.
 *
 * Le seul geste possible ici est la suppression : c'est de la modération, pas
 * de l'édition — on ne réécrit pas ce qu'un ami a dit.
 */
function ReviewSection({
  reviews,
  onDelete,
}: {
  reviews: StoreReview[];
  onDelete: (id: number) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);

  const average =
    reviews.length === 0
      ? null
      : Math.round((reviews.reduce((total, review) => total + review.score, 0) / reviews.length) * 10) /
        10;

  async function remove(review: StoreReview) {
    const who = review.author_name || 'Anonyme';
    if (!window.confirm(`Supprimer l’avis de ${who} ? Il ne sera pas prévenu.`)) return;
    try {
      setError(null);
      await onDelete(review.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Suppression impossible.');
    }
  }

  return (
    <section className="field reviews">
      <h2 className="field__label">
        Avis des amis
        <span className="field__hint">
          {average === null
            ? 'Rien reçu pour l’instant.'
            : `${reviews.length} avis, moyenne ${average} / 5. Séparés des verdicts, toujours.`}
        </span>
      </h2>

      {error && <p className="notice notice--error">{error}</p>}

      {reviews.length === 0 ? (
        <p className="hint">
          Personne n’a encore répondu. Les liens se créent depuis <Link to="/partages">Partages</Link>.
        </p>
      ) : (
        <ol className="review-list">
          {reviews.map((review) => (
            <li key={review.id} className="review">
              <span className="review__score">{review.score}</span>
              <div className="review__body">
                <p className="review__who">
                  <strong>{review.author_name || 'Anonyme'}</strong>
                  {review.share_label && (
                    <span className="review__share">via « {review.share_label} »</span>
                  )}
                </p>
                <time className="review__date" dateTime={review.created_at}>
                  {formatDateTime(review.created_at)}
                  {review.updated_at && ` — corrigé le ${formatDateTime(review.updated_at)}`}
                </time>
                {review.note && <p className="review__note">{review.note}</p>}
              </div>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void remove(review)}
                aria-label={`Supprimer l’avis de ${review.author_name || 'Anonyme'}`}
              >
                Supprimer
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
