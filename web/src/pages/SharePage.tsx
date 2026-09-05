import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { ApiError } from '../api';
import { StoreMock } from '../components/StoreMock';
import { guestApi } from '../guestApi';
import { Link, navigate } from '../router';
import '../steam.css';
import type { GuestIdeaPage, GuestShare, StoreReview } from '../types';
import { setVisitorName, visitorName } from '../visitor';

/**
 * La page invité — `/p/:token/:slug`.
 *
 * Un ami de Nathan arrive ici par un lien, sans compte et sans mot de passe. Il
 * voit la **même** maquette que Nathan (`StoreMock`), enchaîne les idées de la
 * sélection, note, commente, met en liste de souhaits, et termine sur un
 * récapitulatif de ce qu'il a dit.
 *
 * Tout ce qu'il ne doit pas voir est absent du serveur, pas caché ici : il n'y
 * a rien dans cette page qu'une inspection du réseau révélerait. C'est la seule
 * façon de faire qui tienne quand l'interface est publique.
 */

/**
 * L'adresse du récapitulatif. Un tiret bas ne peut pas apparaître dans un slug
 * d'idée (`slugify` ne produit que `[a-z0-9-]`) : cette adresse ne peut donc
 * jamais entrer en collision avec une idée de la sélection.
 */
export const RECAP = '_bilan';

const shareHref = (token: string, slug: string) =>
  `/p/${encodeURIComponent(token)}/${encodeURIComponent(slug)}`;

export function SharePage({ token, slug }: { token: string; slug: string | null }) {
  const [share, setShare] = useState<GuestShare | null>(null);
  const [page, setPage] = useState<GuestIdeaPage | null>(null);
  const [dead, setDead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(() => visitorName());
  const [askingName, setAskingName] = useState(() => !visitorName());

  /** La sélection : chargée une fois, elle porte la liste et le récapitulatif. */
  const reloadShare = useCallback(async () => {
    try {
      setShare(await guestApi.share(token));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setDead(true);
      else setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
    }
  }, [token]);

  useEffect(() => {
    void reloadShare();
  }, [reloadShare]);

  /**
   * Sans idée dans l'adresse, on ouvre sur la première de la sélection. En
   * remplacement : le retour arrière du navigateur doit sortir du lien, pas
   * revenir sur une redirection.
   */
  useEffect(() => {
    if (slug || !share) return;
    const first = share.ideas[0];
    if (first) navigate(shareHref(token, first.slug), { replace: true });
  }, [slug, share, token]);

  useEffect(() => {
    if (!slug || slug === RECAP) {
      setPage(null);
      return undefined;
    }

    let cancelled = false;
    guestApi
      .ideaPage(token, slug)
      .then((loaded) => {
        if (!cancelled) {
          setPage(loaded);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setDead(true);
        else setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
      });

    return () => {
      cancelled = true;
    };
  }, [token, slug]);

  if (dead) {
    return (
      <div className="page guest-dead">
        <h1 className="guest-dead__title">Ce lien n’est plus valable.</h1>
        <p className="guest-dead__text">
          Il a peut-être expiré, ou été fermé par son auteur. Redemande-lui-en un.
        </p>
      </div>
    );
  }

  if (!share) {
    return (
      <div className="page">
        <p className="notice">{error ?? 'Chargement…'}</p>
      </div>
    );
  }

  const atRecap = slug === RECAP;
  const index = share.ideas.findIndex((idea) => idea.slug === slug);
  /** Depuis le bilan, « précédente » revient à la dernière idée : on n'y est pas enfermé. */
  const previous = atRecap
    ? (share.ideas.at(-1) ?? null)
    : index > 0
      ? share.ideas[index - 1]
      : null;
  /** Après la dernière idée, « suivante » mène au récapitulatif. */
  const next = index >= 0 && index < share.ideas.length - 1 ? share.ideas[index + 1] : null;

  return (
    <div className="steam-page">
      <nav className="sp-toolbar" aria-label="Navigation dans la sélection">
        <span className="sp-toolbar__link is-disabled">{share.share.label || 'Sélection'}</span>
        {index >= 0 && (
          <span className="sp-toolbar__count">
            {index + 1} / {share.ideas.length}
          </span>
        )}
        <span className="sp-toolbar__spacer" />
        {error && <span className="sp-toolbar__notice">{error}</span>}

        <button
          type="button"
          className="sp-toolbar__link"
          onClick={() => setAskingName(true)}
          title="Changer le prénom affiché sur vos avis"
        >
          {name || 'Votre prénom'}
        </button>

        {previous ? (
          <Link to={shareHref(token, previous.slug)} className="sp-toolbar__link">
            ‹ {previous.title || 'Sans titre'}
          </Link>
        ) : (
          <span className="sp-toolbar__link is-disabled">‹ Précédente</span>
        )}

        {next ? (
          <Link to={shareHref(token, next.slug)} className="sp-toolbar__link">
            {next.title || 'Sans titre'} ›
          </Link>
        ) : (
          <Link to={shareHref(token, RECAP)} className="button button--accent">
            {atRecap ? 'Bilan' : 'Terminer ›'}
          </Link>
        )}
      </nav>

      {askingName && (
        <NameGate
          initial={name}
          onDone={(chosen) => {
            setVisitorName(chosen);
            setName(chosen);
            setAskingName(false);
          }}
        />
      )}

      {atRecap && <Recap share={share} name={name} token={token} />}

      {!atRecap && page && (
        <StoreMock
          idea={page.idea}
          attachments={page.attachments}
          family={page.family}
          developer={page.developer_name}
          reviews={page.reviews}
          wishlisted={page.wishlisted}
          onToggleWishlist={() => {
            void toggleWishlist();
          }}
          reviewForm={
            <ReviewForm
              key={page.idea.slug}
              name={name}
              mine={page.my_review}
              onNameNeeded={() => setAskingName(true)}
              onSubmit={submitReview}
            />
          }
        />
      )}

      {!atRecap && !page && <p className="notice">{error ?? 'Chargement…'}</p>}
    </div>
  );

  /**
   * Bascule la liste de souhaits **du visiteur**, et rafraîchit le bilan.
   *
   * Les deux écritures de cette page se mettent à jour **par fonction** et non
   * en recomposant l'objet capturé au rendu. Sans ça, cliquer « liste de
   * souhaits » juste après avoir envoyé un avis réécrit la page avec l'état
   * d'avant l'avis, et l'avis disparaît de l'écran alors qu'il est bien
   * enregistré. C'est arrivé au premier essai en navigateur, pas en test.
   */
  async function toggleWishlist() {
    if (!page) return;
    const wanted = !page.wishlisted;
    try {
      const { wishlisted } = await guestApi.setWishlisted(token, page.idea.slug, wanted);
      setPage((current) => (current ? { ...current, wishlisted } : current));
      setError(null);
      void reloadShare();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible d’enregistrer.');
    }
  }

  async function submitReview(score: number, note: string) {
    if (!page) return;
    const author = name || visitorName();
    const { my_review, reviews } = await guestApi.submitReview(token, {
      slug: page.idea.slug,
      author_name: author,
      score,
      note,
    });
    setPage((current) => (current ? { ...current, my_review, reviews } : current));
    void reloadShare();
  }
}

/**
 * La question du prénom, posée une fois. Ce n'est pas une inscription : le
 * prénom sert à signer les avis, il se change à tout moment depuis la barre du
 * haut, et rien d'autre n'est demandé.
 */
function NameGate({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (name: string) => void;
}) {
  const [value, setValue] = useState(initial);

  return (
    <div className="guest-gate" role="dialog" aria-modal="true" aria-label="Votre prénom">
      <form
        className="guest-gate__box"
        onSubmit={(event) => {
          event.preventDefault();
          onDone(value.trim().slice(0, 40));
        }}
      >
        <h2 className="guest-gate__title">Comment tu t’appelles ?</h2>
        <p className="guest-gate__text">
          Juste un prénom, pour signer tes avis. Pas de compte, pas d’adresse mail.
        </p>
        <input
          className="input"
          value={value}
          maxLength={40}
          autoFocus
          placeholder="Léo"
          onChange={(event) => setValue(event.target.value)}
          aria-label="Prénom"
        />
        <div className="guest-gate__actions">
          <button type="submit" className="button button--accent" disabled={!value.trim()}>
            C’est parti
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Le formulaire d'avis, posé en tête du bloc des évaluations de la maquette.
 * Un avis déjà déposé le pré-remplit : déposer et corriger sont le même geste,
 * côté serveur comme ici.
 */
function ReviewForm({
  name,
  mine,
  onNameNeeded,
  onSubmit,
}: {
  name: string;
  mine: StoreReview | null;
  onNameNeeded: () => void;
  onSubmit: (score: number, note: string) => Promise<void>;
}) {
  const [score, setScore] = useState<number | null>(mine ? mine.score : null);
  const [note, setNote] = useState(mine?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (score === null) return;
    if (!name) {
      onNameNeeded();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSubmit(score, note);
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Envoi impossible.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="guest-review" onSubmit={submit}>
      <p className="guest-review__title">
        {mine ? 'Votre avis — vous pouvez le corriger' : 'Votre avis'}
      </p>

      <div className="guest-review__scores" role="group" aria-label="Note de 0 à 5">
        {[0, 1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            className={`guest-review__score ${score === value ? 'is-on' : ''}`}
            onClick={() => setScore(value)}
            aria-pressed={score === value}
          >
            {value}
          </button>
        ))}
      </div>

      <textarea
        className="guest-review__note"
        value={note}
        maxLength={2000}
        rows={3}
        placeholder="Ce qui t’attire, ce qui te laisse froid. Sois franc, c’est l’intérêt."
        onChange={(event) => setNote(event.target.value)}
        aria-label="Commentaire"
      />

      <div className="guest-review__actions">
        <button type="submit" className="button button--accent" disabled={busy || score === null}>
          {busy ? 'Envoi…' : mine ? 'Corriger mon avis' : 'Envoyer mon avis'}
        </button>
        {done && <span className="guest-review__done">Enregistré.</span>}
        {error && <span className="guest-review__error">{error}</span>}
      </div>
    </form>
  );
}

/** Le récapitulatif de fin : ce que le visiteur a dit, et un merci. */
function Recap({ share, name, token }: { share: GuestShare; name: string; token: string }) {
  const { reviews, wishlisted } = share.summary;

  return (
    <div className="guest-recap">
      <h1 className="guest-recap__title">Merci{name ? `, ${name}` : ''}.</h1>
      <p className="guest-recap__text">
        {reviews.length === 0 && wishlisted.length === 0
          ? 'Tu n’as encore rien noté — tu peux revenir en arrière et donner ton avis, ça ne prend pas longtemps.'
          : 'Voilà ce que tu as dit. Tout est déjà enregistré ; tu peux revenir corriger quand tu veux.'}
      </p>

      <section className="guest-recap__block">
        <h2 className="guest-recap__heading">Ce que tu as noté ({reviews.length})</h2>
        {reviews.length === 0 ? (
          <p className="guest-recap__empty">Aucun avis.</p>
        ) : (
          <ul className="guest-recap__list">
            {reviews.map((review) => (
              <li key={review.idea_slug}>
                <Link to={`/p/${encodeURIComponent(token)}/${encodeURIComponent(review.idea_slug)}`}>
                  {review.title || 'Sans titre'}
                </Link>
                <span className="guest-recap__score">{review.score} / 5</span>
                {review.note && <p className="guest-recap__note">{review.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="guest-recap__block">
        <h2 className="guest-recap__heading">
          Ta liste de souhaits ({wishlisted.length})
        </h2>
        {wishlisted.length === 0 ? (
          <p className="guest-recap__empty">Aucune idée retenue.</p>
        ) : (
          <ul className="guest-recap__list">
            {wishlisted.map((item) => (
              <li key={item.idea_slug}>
                <Link to={`/p/${encodeURIComponent(token)}/${encodeURIComponent(item.idea_slug)}`}>
                  {item.title || 'Sans titre'}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {share.ideas[0] && (
        <Link to={`/p/${encodeURIComponent(token)}/${encodeURIComponent(share.ideas[0].slug)}`} className="button button--ghost">
          Revoir la sélection depuis le début
        </Link>
      )}
    </div>
  );
}
