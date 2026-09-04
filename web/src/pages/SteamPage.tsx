import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import {
  FEATURE_LABELS,
  isRecommended,
  releaseDate,
  reviewSummary,
  shortDescription,
  similarTitles,
  storeFeatures,
  storeGenre,
  storePrice,
  storeTags,
} from '../../../shared/store-model.js';
import { api, ApiError } from '../api';
import { Lightbox } from '../components/Lightbox';
import { filtersFromSearch, steamHref } from '../filters';
import { Link } from '../router';
import '../steam.css';
import type { Attachment, Idea, Verdict } from '../types';

/**
 * La vue « page store » — la raison d'être de l'application.
 *
 * Ce n'est plus une page qui emprunte une structure : c'est un photomontage. La
 * mise en page, les proportions, les couleurs et la hiérarchie typographique
 * sont celles d'une fiche de magasin de bureau, en français ; seules les
 * données changent. Le test de Vitrine est qu'en scrollant cette page on ait le
 * réflexe « wishlist ou pas », et ce réflexe ne se déclenche que devant une
 * page qui ressemble à une vraie.
 *
 * Sans logo ni marque : la barre du haut porte « Vitrine », les libellés de
 * menu sont ceux d'un magasin et tout y est inerte. Un seul bouton agit, celui
 * de la liste de souhaits — c'est le geste que l'application veut capturer.
 *
 * Ce qui n'est pas du magasin — enchaîner les idées, revenir à l'édition — vit
 * dans une fine barre de service au-dessus, hors du photomontage.
 */

/** Nombre d'avis fabriqués à partir des verdicts, comme un magasin en montre. */
const REVIEW_CARDS = 3;

/** Vignettes visibles d'un coup dans le bandeau, sous la visionneuse. */
const VISIBLE_THUMBS = 5;
const THUMB_STEP = 120;

export function SteamPage({ slug, search }: { slug: string; search: string }) {
  const [idea, setIdea] = useState<Idea | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [developer, setDeveloper] = useState('Nathan');
  const [neighbours, setNeighbours] = useState<Idea[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  const [slide, setSlide] = useState(0);
  const [stripOffset, setStripOffset] = useState(0);
  const [viewing, setViewing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setError(null);
        setMissing(false);
        const [loaded, pieces, judged] = await Promise.all([
          api.getIdea(slug),
          api.listAttachments(slug),
          api.listVerdicts(slug),
        ]);
        if (cancelled) return;
        setIdea(loaded);
        setAttachments(pieces);
        setVerdicts(judged);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
      }
    }

    void load();
    setSlide(0);
    setStripOffset(0);
    setViewing(null);
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

  // Les captures sont les images attachées, la capsule mise à part : elle est
  // déjà en tête de la colonne de droite, la revoir en vignette ne dit rien.
  const shots = useMemo(
    () =>
      attachments.filter(
        (item) => item.kind === 'image' && item.file_url && item.id !== idea?.capsule_file_id,
      ),
    [attachments, idea?.capsule_file_id],
  );

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
  const link = attachments.find((item) => item.kind === 'link' && item.url) ?? null;

  const tags = storeTags(idea.family);
  const summary = reviewSummary(idea.current_verdict?.score ?? null);
  const parution = releaseDate(idea.status, idea.updated_at);
  const description = shortDescription(idea.tagline, idea.pitch);
  const similar = similarTitles(idea.competition);

  // La bande-annonce occupe toujours la première place de la visionneuse, comme
  // sur un magasin : c'est le premier élément qu'on regarde, décrit ou non.
  const slides = shots.length + 1;
  const maxOffset = Math.max(0, slides - VISIBLE_THUMBS);

  const index = neighbours.findIndex((item) => item.slug === idea.slug);
  const previous = index > 0 ? neighbours[index - 1] : null;
  const next = index >= 0 && index < neighbours.length - 1 ? neighbours[index + 1] : null;

  // La vignette choisie doit rester visible : le bandeau suit la sélection,
  // sans bouger tant qu'elle est déjà dans la fenêtre.
  function showSlide(position: number) {
    setSlide(position);
    setStripOffset((current) => {
      if (position < current) return position;
      if (position > current + VISIBLE_THUMBS - 1) {
        return Math.min(maxOffset, position - VISIBLE_THUMBS + 1);
      }
      return current;
    });
  }

  const wishlisted = Boolean(idea.wishlisted_at);

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
                  {slide === 0 || !shots[slide - 1] ? (
                    <div className="sp-trailer">
                      <span className="sp-trailer__play" aria-hidden="true" />
                      <p className={`sp-trailer__text ${idea.gif ? '' : 'is-empty'}`}>
                        {idea.gif || 'Aucun moment clipable décrit.'}
                      </p>
                      <span className="sp-trailer__tag">Bande-annonce</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="sp-stage__shot"
                      onClick={() => setViewing(slide - 1)}
                      aria-label={`Voir ${shots[slide - 1].label} en grand`}
                    >
                      <img src={shots[slide - 1].file_url ?? ''} alt={shots[slide - 1].label} />
                    </button>
                  )}
                </div>

                <div className="sp-strip">
                  {/* Sans quoi défiler, pas de flèches : deux boutons morts sur
                      les bords se voient plus que leur absence. */}
                  {maxOffset > 0 && (
                    <button
                      type="button"
                      className="sp-strip__arrow sp-strip__arrow--prev"
                      onClick={() => setStripOffset((current) => Math.max(0, current - 1))}
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
                      <button
                        type="button"
                        className={`sp-thumb ${slide === 0 ? 'is-active' : ''}`}
                        onClick={() => showSlide(0)}
                        aria-label="Bande-annonce"
                      >
                        <span className="sp-thumb__trailer" />
                      </button>

                      {shots.map((shot, position) => (
                        <button
                          key={shot.id}
                          type="button"
                          className={`sp-thumb ${slide === position + 1 ? 'is-active' : ''}`}
                          onClick={() => showSlide(position + 1)}
                          aria-label={shot.label || `Capture ${position + 1}`}
                        >
                          <img src={shot.file_url ?? ''} alt="" loading="lazy" />
                        </button>
                      ))}
                    </div>
                  </div>

                  {maxOffset > 0 && (
                    <button
                      type="button"
                      className="sp-strip__arrow sp-strip__arrow--next"
                      onClick={() => setStripOffset((current) => Math.min(maxOffset, current + 1))}
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
                    {verdicts.length > 0 && (
                      <span className="sp-glance__value"> ({verdicts.length})</span>
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
                onClick={toggleWishlist}
                disabled={saving}
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
                      {verdicts.length === 0
                        ? 'Aucun avis pour l’instant'
                        : `${verdicts.length} avis`}
                    </span>
                  </div>

                  {verdicts.length === 0 ? (
                    <div className="sp-review">
                      <span className="sp-review__author">—</span>
                      <p className="sp-review__note is-empty">
                        Ce jeu n’a pas encore reçu d’évaluation.
                      </p>
                    </div>
                  ) : (
                    verdicts
                      .slice(0, REVIEW_CARDS)
                      .map((verdict) => (
                        <ReviewCard key={verdict.id} verdict={verdict} author={developer} />
                      ))
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
                      {storeFeatures(idea.family).map((feature) => (
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
                    <DetailRow label="Genre" value={storeGenre(idea.family)} link />
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
    </div>
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
 * Un avis fabriqué à partir d'un verdict. Le score devient un pouce — levé à
 * partir de 3 sur 5 — et la note devient le texte de l'avis. Rien n'est
 * inventé : ce que Nathan a écrit, tel quel, dans la forme d'un avis.
 */
function ReviewCard({ verdict, author }: { verdict: Verdict; author: string }) {
  const recommended = isRecommended(verdict.score);

  return (
    <article className="sp-review">
      <div className="sp-review__author">
        <span className="sp-review__name">{author}</span>
      </div>

      <div>
        <div className="sp-review__verdict">
          <span className={`sp-review__thumb ${recommended ? 'is-up' : 'is-down'}`}>
            {recommended ? '👍' : '👎'}
          </span>
          <span>{recommended ? 'Recommandé' : 'Non recommandé'}</span>
          <span className="sp-review__score">{verdict.score} / 5</span>
        </div>

        <p className={`sp-review__note ${verdict.note ? '' : 'is-empty'}`}>
          {verdict.note || 'Aucun commentaire.'}
        </p>
        <p className="sp-review__date">Publié le {longDate(verdict.created_at)}</p>
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
function FeatureIcon({ feature }: { feature: 'coop' | 'multi' | 'solo' | 'manette' }) {
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

  // Coop et multijoueur partagent la silhouette à deux têtes ; la coop y ajoute
  // le lien entre les deux.
  return (
    <svg {...common}>
      <path d="M6.5 1.8a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Zm7 0a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Zm-7 6.2c2.6 0 4.7 1.5 4.7 3.4v.9H1.8v-.9c0-1.9 2.1-3.4 4.7-3.4Zm7 0c2.6 0 4.7 1.5 4.7 3.4v.9h-4.3v-.9c0-1-.5-2-1.4-2.7.3 0 .7-.1 1-.1Z" />
      {feature === 'coop' && <circle cx="10" cy="4.4" r="1.1" />}
    </svg>
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

/** Le domaine d'un lien attaché, pour la ligne « Site web » de la fiche. */
function hostOf(url: string | null): string {
  if (!url) return 'Aucun';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function longDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}
