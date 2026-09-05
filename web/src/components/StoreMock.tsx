import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  FEATURE_LABELS,
  friendReviewSummary,
  isRecommended,
  releaseDate,
  shortDescription,
  similarTitles,
  storeFeatures,
  storeGenre,
  storePrice,
  storeTags,
} from '../../../shared/store-model.js';
import { Lightbox } from './Lightbox';
import { PlayBadge, TrailerStage } from './Trailer';
import type { Attachment, Family, StoreIdea, StoreReview } from '../types';
import type { StoreFeature } from '../../../shared/store-model';

/**
 * Le photomontage, et rien d'autre.
 *
 * Il était jusqu'ici dans `SteamPage`. Le lot 7 l'en sort parce que deux pages
 * doivent maintenant l'afficher : celle de Nathan et celle de ses amis. Les
 * partager n'est pas un confort d'écriture — c'est la seule façon d'être sûr
 * que l'ami voit la page que Nathan a regardée. Deux copies auraient divergé au
 * premier ajustement.
 *
 * Ce composant ne parle à personne : il reçoit ce qu'il affiche et deux
 * rappels, la bascule de liste de souhaits et un emplacement libre dans le bloc
 * des évaluations — où la page invité vient poser son formulaire.
 *
 * Depuis le lot 7, le bloc « Évaluations des utilisateurs » est alimenté par
 * les **avis d'amis** et par eux seuls. Le verdict de Nathan n'y figure plus :
 * ce n'est pas un avis de joueur, c'est son jugement à lui, et le faire passer
 * pour l'autre était le point ouvert du lot 3b.
 */

/** Vignettes visibles d'un coup dans le bandeau, sous la visionneuse. */
const VISIBLE_THUMBS = 5;
const THUMB_STEP = 120;

/**
 * Une place dans la visionneuse. Un magasin y met ses vidéos d'abord, ses
 * captures ensuite ; une idée sans aucune vidéo garde la carte de texte du lot
 * 3b à la place de la première.
 *
 * Les captures portent leur rang **dans les captures** et non dans la
 * visionneuse : c'est ce rang que la loupe passe au `Lightbox`, qui ne connaît
 * que des images.
 */
type Slide =
  | { type: 'trailer'; item: Attachment; leading: boolean }
  | { type: 'shot'; item: Attachment; shotIndex: number }
  | { type: 'pitch' };

export interface StoreMockProps {
  idea: StoreIdea;
  attachments: Attachment[];
  family: Family | null;
  developer: string;
  /** Les avis d'amis. Jamais des verdicts : les deux ne se mélangent pas. */
  reviews: StoreReview[];
  wishlisted: boolean;
  onToggleWishlist: () => void;
  wishlistBusy?: boolean;
  /** Posé en tête du bloc des évaluations. La page invité y met son formulaire. */
  reviewForm?: ReactNode;
}

export function StoreMock({
  idea,
  attachments,
  family,
  developer,
  reviews,
  wishlisted,
  onToggleWishlist,
  wishlistBusy = false,
  reviewForm,
}: StoreMockProps) {
  const [slide, setSlide] = useState(0);
  const [stripOffset, setStripOffset] = useState(0);
  const [viewing, setViewing] = useState<number | null>(null);

  // Les captures sont les images attachées, la capsule mise à part : elle est
  // déjà en tête de la colonne de droite, la revoir en vignette ne dit rien.
  const shots = useMemo(
    () =>
      attachments.filter(
        (item) => item.kind === 'image' && item.file_url && item.id !== idea.capsule_file_id,
      ),
    [attachments, idea.capsule_file_id],
  );

  /**
   * Les bandes-annonces, celle en tête d'abord. Le serveur dit laquelle mène
   * (`leading_trailer_id` : la désignée, ou la première à défaut) — on ne
   * recalcule pas la règle ici, elle vivrait alors à deux endroits.
   */
  const trailers = useMemo(() => {
    const all = attachments.filter((item) => item.kind === 'trailer' && item.file_url);
    const leading = all.find((item) => item.id === idea.leading_trailer_id);
    return leading ? [leading, ...all.filter((item) => item !== leading)] : all;
  }, [attachments, idea.leading_trailer_id]);

  /** Vidéos puis captures, comme sur un magasin. */
  const slides = useMemo<Slide[]>(() => {
    const videos: Slide[] =
      trailers.length > 0
        ? trailers.map((item, position) => ({ type: 'trailer', item, leading: position === 0 }))
        : [{ type: 'pitch' }];

    return [
      ...videos,
      ...shots.map((item, shotIndex) => ({ type: 'shot' as const, item, shotIndex })),
    ];
  }, [trailers, shots]);

  const title = idea.title || 'Sans titre';
  const capsule = attachments.find((item) => item.id === idea.capsule_file_id) ?? null;
  const link = attachments.find((item) => item.kind === 'link' && item.url) ?? null;

  // Étiquettes et fonctionnalités ne viennent pas d'une table codée en dur :
  // elles sont les colonnes de la famille, éditées sur `/familles`.
  const tags = storeTags(family);
  const summary = friendReviewSummary(reviews);
  const parution = releaseDate(idea.status, idea.updated_at);
  const description = shortDescription(idea.tagline, idea.pitch);
  const similar = similarTitles(idea.competition);

  const maxOffset = Math.max(0, slides.length - VISIBLE_THUMBS);
  // Une pièce supprimée dans un autre onglet peut raccourcir la liste sous la
  // sélection : on retombe sur la première place plutôt que sur du vide.
  const current = slides[slide] ?? slides[0];

  // La vignette choisie doit rester visible : le bandeau suit la sélection,
  // sans bouger tant qu'elle est déjà dans la fenêtre.
  function showSlide(position: number) {
    setSlide(position);
    setStripOffset((offset) => {
      if (position < offset) return position;
      if (position > offset + VISIBLE_THUMBS - 1) {
        return Math.min(maxOffset, position - VISIBLE_THUMBS + 1);
      }
      return offset;
    });
  }

  return (
    <>
      <div className="sp-frame">
        <div className="sp-mock">
          <header className="sp-globalnav">
            <div className="sp-globalnav__inner sp-width">
              <span className="sp-wordmark">Vitrine</span>
              <nav className="sp-menu sp-inert" aria-hidden="true">
                <span>Magasin</span>
                <span>Bibliothèque</span>
                <span>Communauté</span>
                <span>Assistance</span>
              </nav>
              <div className="sp-globalnav__right sp-inert" aria-hidden="true">
                <span className="sp-pillbtn">Installer l’application</span>
                <span>Français</span>
                <span>Se connecter</span>
              </div>
            </div>
          </header>

          <div className="sp-storenav">
            <div className="sp-storenav__inner sp-width sp-inert" aria-hidden="true">
              <span>Votre magasin</span>
              <span>Nouveautés et tendances</span>
              <span>Catégories</span>
              <span>Actualités</span>
              <span>Liste de souhaits</span>
              <span className="sp-search">Rechercher</span>
            </div>
          </div>

          <div className="sp-width">
            <div className="sp-breadcrumbs">
              <span className="sp-crumb--link">Tous les jeux</span>
              <span className="sp-crumb--link">{tags[0]}</span>
              <span>{title}</span>
            </div>
          </div>

          <div className="sp-apphub">
            <div className="sp-apphub__inner sp-width">
              <h1 className="sp-apphub__name">{title}</h1>
              <nav className="sp-apphub__tabs sp-inert" aria-hidden="true">
                <span>Hub de la communauté</span>
                <span>Discussions</span>
              </nav>
            </div>
          </div>

          <div className="sp-glancewrap">
            <div className="sp-glance sp-width">
              <div className="sp-glance__left">
                <div className="sp-stage">
                  {current.type === 'trailer' && (
                    // La bande-annonce joue, comme sur un magasin. `key` sur
                    // l'identifiant : passer d'une vidéo à l'autre doit remonter
                    // le lecteur, pas réutiliser celui qui joue déjà.
                    <TrailerStage
                      key={current.item.id}
                      url={current.item.file_url ?? ''}
                      title={current.item.label || title}
                    />
                  )}

                  {current.type === 'pitch' && (
                    <div className="sp-trailer">
                      <span className="sp-trailer__play" aria-hidden="true" />
                      <p className={`sp-trailer__text ${idea.gif ? '' : 'is-empty'}`}>
                        {idea.gif || 'Aucun moment clipable décrit.'}
                      </p>
                      <span className="sp-trailer__tag">Bande-annonce</span>
                    </div>
                  )}

                  {current.type === 'shot' && (
                    <button
                      type="button"
                      className="sp-stage__shot"
                      onClick={() => setViewing(current.shotIndex)}
                      aria-label={`Voir ${current.item.label} en grand`}
                    >
                      <img src={current.item.file_url ?? ''} alt={current.item.label} />
                    </button>
                  )}
                </div>

                {/* Le champ « GIF » décrit le moment clipable de l'idée : il n'a
                    de sens que sous la vidéo de tête. Les suivantes portent leur
                    propre libellé, et rien d'autre à dire. */}
                {current.type === 'trailer' && current.leading && idea.gif && (
                  <p className="sp-stage__caption">{idea.gif}</p>
                )}

                <div className="sp-strip">
                  {/* Sans quoi défiler, pas de flèches : deux boutons morts sur
                      les bords se voient plus que leur absence. */}
                  {maxOffset > 0 && (
                    <button
                      type="button"
                      className="sp-strip__arrow sp-strip__arrow--prev"
                      onClick={() => setStripOffset((offset) => Math.max(0, offset - 1))}
                      disabled={stripOffset === 0}
                      aria-label="Vignettes précédentes"
                    >
                      ‹
                    </button>
                  )}

                  <div className="sp-strip__window">
                    <div
                      className="sp-strip__rail"
                      style={{ transform: `translateX(-${stripOffset * THUMB_STEP}px)` }}
                    >
                      {slides.map((item, position) => (
                        <button
                          key={item.type === 'pitch' ? 'pitch' : item.item.id}
                          type="button"
                          className={`sp-thumb ${item.type !== 'shot' ? 'sp-thumb--trailer' : ''} ${
                            slide === position ? 'is-active' : ''
                          }`}
                          onClick={() => showSlide(position)}
                          aria-label={thumbLabel(item, position)}
                        >
                          {item.type === 'pitch' && <span className="sp-thumb__trailer" />}
                          {item.type === 'trailer' && (
                            <TrailerThumb url={item.item.file_url ?? ''} />
                          )}
                          {item.type === 'shot' && (
                            <img src={item.item.file_url ?? ''} alt="" loading="lazy" />
                          )}

                          {/* Le pictogramme de lecture est ce qui distingue une
                              vidéo d'une capture dans un bandeau qui n'a que des
                              rectangles. */}
                          {item.type !== 'shot' && <PlayBadge className="sp-thumb__play" />}
                        </button>
                      ))}
                    </div>
                  </div>

                  {maxOffset > 0 && (
                    <button
                      type="button"
                      className="sp-strip__arrow sp-strip__arrow--next"
                      onClick={() => setStripOffset((offset) => Math.min(maxOffset, offset + 1))}
                      disabled={stripOffset >= maxOffset}
                      aria-label="Vignettes suivantes"
                    >
                      ›
                    </button>
                  )}
                </div>
              </div>

              <div className="sp-glance__right">
                <div className="sp-capsule">
                  {capsule?.file_url ? (
                    <img src={capsule.file_url} alt={`Capsule de ${title}`} />
                  ) : (
                    <span className="sp-capsule__empty" aria-hidden="true">
                      {title.trim().charAt(0).toUpperCase() || '?'}
                    </span>
                  )}
                </div>

                <p className={`sp-shortdesc ${description ? '' : 'is-empty'}`}>
                  {description || 'Pas encore de description.'}
                </p>

                <GlanceRow label="Évaluations récentes">
                  <span className={`sp-review-summary tone-${summary.tone}`}>{summary.label}</span>
                </GlanceRow>
                <GlanceRow label="Toutes les évaluations">
                  <span className={`sp-review-summary tone-${summary.tone}`}>
                    {summary.label}
                    {reviews.length > 0 && (
                      <span className="sp-glance__value"> ({reviews.length})</span>
                    )}
                  </span>
                </GlanceRow>
                <GlanceRow label="Date de parution">{parution}</GlanceRow>
                <GlanceRow label="Développeur" link>
                  {developer}
                </GlanceRow>
                <GlanceRow label="Éditeur" link>
                  {developer}
                </GlanceRow>

                <div className="sp-glance__tags">
                  <p className="sp-glance__tags-title">
                    Étiquettes populaires définies par les utilisateurs :
                  </p>
                  <div className="sp-tags">
                    {tags.map((tag) => (
                      <span className="sp-tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                    <span className="sp-tag sp-inert">+</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="sp-width">
            <section className="sp-purchase">
              <h2 className="sp-purchase__title">Acheter {title}</h2>
              <div className="sp-purchase__row">
                <span className="sp-price">{storePrice(idea.price_cents)}</span>
                <span className="sp-btn-green sp-inert" aria-hidden="true">
                  <span>Ajouter au panier</span>
                </span>
              </div>
            </section>

            <div className="sp-queue">
              <button
                type="button"
                className={`sp-queue__btn sp-queue__btn--live ${wishlisted ? 'is-on' : ''}`}
                onClick={onToggleWishlist}
                disabled={wishlistBusy}
                aria-pressed={wishlisted}
              >
                {wishlisted ? (
                  <>
                    <span className="sp-queue__check" aria-hidden="true">
                      ✔
                    </span>
                    Sur votre liste de souhaits
                  </>
                ) : (
                  'Ajouter à votre liste de souhaits'
                )}
              </button>
              <span className="sp-queue__btn sp-inert" aria-hidden="true">
                Suivre
              </span>
              <span className="sp-queue__btn sp-inert" aria-hidden="true">
                Ignorer
              </span>
            </div>

            <div className="sp-body">
              <div className="sp-maincol">
                <section className="sp-about">
                  <h2 className="sp-section-title">À propos de ce jeu</h2>
                  <p className={`sp-about__text ${idea.pitch ? '' : 'is-empty'}`}>
                    {idea.pitch || 'Pas encore de pitch.'}
                  </p>
                </section>

                <SystemRequirements />

                <section className="sp-reviews">
                  <h2 className="sp-section-title">Évaluations des utilisateurs</h2>
                  <div className="sp-reviews__header">
                    <span className={`sp-review-summary tone-${summary.tone}`}>
                      {summary.label}
                    </span>
                    <span className="sp-reviews__count">
                      {reviews.length === 0
                        ? 'Aucun avis pour l’instant'
                        : `${reviews.length} avis`}
                    </span>
                  </div>

                  {reviewForm}

                  {reviews.length === 0 ? (
                    <div className="sp-review">
                      <span className="sp-review__author">—</span>
                      <p className="sp-review__note is-empty">
                        Ce jeu n’a pas encore reçu d’évaluation.
                      </p>
                    </div>
                  ) : (
                    reviews.map((review) => <ReviewCard key={review.id} review={review} />)
                  )}
                </section>
              </div>

              <aside className="sp-sidecol">
                <section className="sp-block">
                  <h2 className="sp-block__header">Ce jeu est-il pertinent pour vous ?</h2>
                  <div className="sp-block__body">
                    <p className="sp-relevant__text">
                      Connectez-vous pour voir les raisons pour lesquelles ce jeu pourrait vous
                      intéresser, en fonction de vos jeux, de vos amis et des curateurs que vous
                      suivez.
                    </p>
                    <span className="sp-btn-blue sp-inert" aria-hidden="true">
                      Se connecter
                    </span>
                  </div>
                </section>

                <section className="sp-block">
                  <h2 className="sp-block__header">Fonctionnalités</h2>
                  <div className="sp-block__body">
                    <ul className="sp-features">
                      {storeFeatures(family).map((feature) => (
                        <li key={feature}>
                          <FeatureIcon feature={feature} />
                          {FEATURE_LABELS[feature]}
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>

                <section className="sp-block">
                  <h2 className="sp-block__header">Langues</h2>
                  <div className="sp-block__body">
                    <table className="sp-langs">
                      <thead>
                        <tr>
                          <th>&nbsp;</th>
                          <th>Interface</th>
                          <th>Doublage</th>
                          <th>Sous-titres</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Français</td>
                          <td className="sp-check">✔</td>
                          <td className="sp-check">✔</td>
                          <td className="sp-check">✔</td>
                        </tr>
                        <tr>
                          <td>Anglais</td>
                          <td className="sp-check">✔</td>
                          <td />
                          <td className="sp-check">✔</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="sp-block">
                  <h2 className="sp-block__header">Informations</h2>
                  <div className="sp-block__body">
                    <DetailRow label="Titre" value={title} />
                    <DetailRow label="Genre" value={storeGenre(family)} link />
                    <DetailRow label="Développeur" value={developer} link />
                    <DetailRow label="Éditeur" value={developer} link />
                    <DetailRow label="Date de parution" value={parution} />
                    <DetailRow
                      label="Site web"
                      value={link ? hostOf(link.url) : 'Aucun'}
                      link={Boolean(link)}
                    />
                  </div>
                </section>
              </aside>
            </div>

            <section className="sp-similar">
              <h2 className="sp-section-title">Plus de jeux similaires</h2>
              {similar.length === 0 ? (
                <p className="sp-similar__empty">Aucune concurrence relevée pour l’instant.</p>
              ) : (
                <div className="sp-similar__grid">
                  {similar.map((name, position) => (
                    <span className="sp-similar__card sp-inert" key={`${name}-${position}`}>
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {viewing !== null && shots[viewing] && (
        <Lightbox
          images={shots}
          index={viewing}
          onClose={() => setViewing(null)}
          onNavigate={setViewing}
        />
      )}
    </>
  );
}

/** Une ligne de la colonne « d'un coup d'œil » : libellé à gauche, valeur à droite. */
function GlanceRow({
  label,
  link = false,
  children,
}: {
  label: string;
  link?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="sp-glance__row">
      <span className="sp-glance__label">{label} :</span>
      <span className={`sp-glance__value ${link ? 'sp-glance__value--link' : ''}`}>{children}</span>
    </div>
  );
}

function DetailRow({ label, value, link = false }: { label: string; value: string; link?: boolean }) {
  return (
    <div className="sp-details__row">
      <span className="sp-details__label">{label} :</span>
      <span className={`sp-details__value ${link ? 'sp-details__value--link' : ''}`}>{value}</span>
    </div>
  );
}

/**
 * L'avis d'un ami, dans la forme d'un avis de magasin. Le score devient un
 * pouce — levé à partir de 3 sur 5 — et le commentaire devient le texte.
 *
 * Le contenu est inséré comme **texte**, jamais comme HTML : React échappe, et
 * aucun `dangerouslySetInnerHTML` ne s'approche de cette carte. C'est ce qui
 * fait qu'un ami ne peut pas écrire de balise dans la page de Nathan — le
 * markdown du lot 2, lui, est du HTML et passe donc par DOMPurify.
 */
function ReviewCard({ review }: { review: StoreReview }) {
  const recommended = isRecommended(review.score);

  return (
    <article className={`sp-review ${review.own ? 'is-own' : ''}`}>
      <div className="sp-review__author">
        <span className="sp-review__name">{review.author_name || 'Anonyme'}</span>
        {review.own && <span className="sp-review__mine">votre avis</span>}
      </div>

      <div>
        <div className="sp-review__verdict">
          <span className={`sp-review__thumb ${recommended ? 'is-up' : 'is-down'}`}>
            {recommended ? '👍' : '👎'}
          </span>
          <span>{recommended ? 'Recommandé' : 'Non recommandé'}</span>
          <span className="sp-review__score">{review.score} / 5</span>
        </div>

        <p className={`sp-review__note ${review.note ? '' : 'is-empty'}`}>
          {review.note || 'Aucun commentaire.'}
        </p>
        <p className="sp-review__date">
          Publié le {longDate(review.created_at)}
          {review.updated_at ? ` — modifié le ${longDate(review.updated_at)}` : ''}
        </p>
      </div>
    </article>
  );
}

/**
 * La configuration requise est générique et figée : Vitrine ne connaît pas
 * celle d'une idée, et une fiche de magasin sans ce tableau se remarque plus
 * qu'une fiche avec un tableau approximatif.
 */
function SystemRequirements() {
  return (
    <section className="sp-sysreq">
      <h2 className="sp-section-title">Configuration requise</h2>
      <div className="sp-sysreq__cols">
        <div>
          <h3 className="sp-sysreq__title">Minimale :</h3>
          <ul className="sp-sysreq__list">
            <li>
              <strong>Système d’exploitation :</strong> Windows 10 64 bits
            </li>
            <li>
              <strong>Processeur :</strong> Intel Core i5-4460 / AMD FX-6300
            </li>
            <li>
              <strong>Mémoire vive :</strong> 8 GB de mémoire
            </li>
            <li>
              <strong>Graphiques :</strong> NVIDIA GeForce GTX 960
            </li>
            <li>
              <strong>Stockage :</strong> 12 GB d’espace disque disponible
            </li>
          </ul>
        </div>
        <div>
          <h3 className="sp-sysreq__title">Recommandée :</h3>
          <ul className="sp-sysreq__list">
            <li>
              <strong>Système d’exploitation :</strong> Windows 11 64 bits
            </li>
            <li>
              <strong>Processeur :</strong> Intel Core i7-8700 / AMD Ryzen 5 3600
            </li>
            <li>
              <strong>Mémoire vive :</strong> 16 GB de mémoire
            </li>
            <li>
              <strong>Graphiques :</strong> NVIDIA GeForce RTX 2060
            </li>
            <li>
              <strong>Stockage :</strong> 12 GB d’espace disque disponible
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/** Pictogrammes des fonctionnalités. Dessinés ici : aucun fichier à charger. */
function FeatureIcon({ feature }: { feature: StoreFeature }) {
  const common = { width: 20, height: 14, viewBox: '0 0 20 14', 'aria-hidden': true } as const;

  if (feature === 'manette') {
    return (
      <svg {...common}>
        <path d="M5 3h10a4 4 0 0 1 4 4v3a2 2 0 0 1-3.6 1.2L13.5 9h-7l-1.9 2.2A2 2 0 0 1 1 10V7a4 4 0 0 1 4-4Zm0 2.5v1.2H3.8v1.1H5v1.2h1.1V7.8h1.2V6.7H6.1V5.5H5Zm8.6 0a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Zm2 2a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z" />
      </svg>
    );
  }

  if (feature === 'solo') {
    return (
      <svg {...common}>
        <path d="M10 1.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 7c3.3 0 6 1.8 6 4v1H4v-1c0-2.2 2.7-4 6-4Z" />
      </svg>
    );
  }

  // Multijoueur, coop en ligne et coop en local partagent la silhouette à deux
  // têtes ; les deux coops y ajoutent le lien entre les joueurs.
  return (
    <svg {...common}>
      <path d="M6.5 1.8a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Zm7 0a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Zm-7 6.2c2.6 0 4.7 1.5 4.7 3.4v.9H1.8v-.9c0-1.9 2.1-3.4 4.7-3.4Zm7 0c2.6 0 4.7 1.5 4.7 3.4v.9h-4.3v-.9c0-1-.5-2-1.4-2.7.3 0 .7-.1 1-.1Z" />
      {(feature === 'coop-online' || feature === 'local-coop') && (
        <circle cx="10" cy="4.4" r="1.1" />
      )}
    </svg>
  );
}

/**
 * La vignette de la bande-annonce dans le bandeau. Une vidéo y est figée sur sa
 * première image : `preload="metadata"` sans lecture automatique donne
 * exactement ça, et une vignette qui joue volerait l'attention du lecteur juste
 * au-dessus.
 */
function TrailerThumb({ url }: { url: string }) {
  if (/\.gif(\?|#|$)/i.test(url)) {
    return <img src={url} alt="" loading="lazy" />;
  }
  return <video src={url} muted playsInline preload="metadata" />;
}

/** Ce qu'annonce une vignette à qui ne voit pas l'image. */
function thumbLabel(slide: Slide, position: number): string {
  if (slide.type === 'pitch') return 'Bande-annonce';
  if (slide.type === 'trailer') {
    return slide.leading ? 'Bande-annonce' : slide.item.label || `Vidéo ${position + 1}`;
  }
  return slide.item.label || `Capture ${slide.shotIndex + 1}`;
}

/** Le domaine d'un lien attaché, pour la ligne « Site web » de la fiche. */
function hostOf(url: string | null): string {
  if (!url) return 'Aucun';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function longDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}
