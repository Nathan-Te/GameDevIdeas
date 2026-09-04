import { useEffect, useRef, useState } from 'react';

/**
 * La bande-annonce, sous ses deux formes.
 *
 * Un GIF et un `.mp4` racontent la même chose et ne se lisent pas de la même
 * façon : le premier est une image qui s'anime toute seule, le second demande
 * un lecteur, une lecture en boucle et une coupure du son. Le reste de
 * l'application ne devrait pas avoir à savoir lequel des deux Nathan a déposé —
 * d'où ce fichier, seul endroit du front où la distinction existe.
 */

/** Un GIF est une image animée : `<video>` ne sait pas le lire. */
export function isAnimatedImage(url: string): boolean {
  return /\.gif(\?|#|$)/i.test(url);
}

interface TrailerMediaProps {
  url: string;
  className?: string;
  /** Le lecteur vidéo joue tout seul dès qu'il est monté. */
  autoPlay?: boolean;
  /** Affiché en `title` : un GIF n'a pas d'autre légende. */
  title?: string;
}

export function TrailerMedia({ url, className = '', autoPlay = true, title }: TrailerMediaProps) {
  if (isAnimatedImage(url)) {
    return <img className={className} src={url} alt={title ?? ''} title={title} />;
  }

  return (
    <video
      className={className}
      src={url}
      title={title}
      autoPlay={autoPlay}
      loop
      // Sans son par défaut, comme sur un magasin — et parce qu'un navigateur
      // refuse la lecture automatique d'une vidéo qui ne l'est pas.
      muted
      playsInline
      preload="metadata"
    />
  );
}

/** Le triangle de lecture posé sur une vignette de bande-annonce. */
export function PlayBadge({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden focusable={false}>
      <circle cx="12" cy="12" r="10" fill="rgba(0, 0, 0, 0.55)" />
      <path d="M10 8.2 16 12l-6 3.8V8.2Z" fill="currentColor" />
    </svg>
  );
}

/**
 * La bande-annonce en tête de la visionneuse de la vue store : elle joue en
 * boucle et sans son, et un bouton de lecture est posé par-dessus.
 *
 * Le bouton est décoratif sur un GIF — on ne met pas en pause une image animée —
 * et il ne s'affiche donc que là où il agit vraiment. Un bouton mort sur une
 * page qui prétend être un magasin se remarque plus que son absence.
 */
export function TrailerStage({ url, title }: { url: string; title?: string }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(false);
  const animated = isAnimatedImage(url);

  // La visionneuse remonte une autre bande-annonce en changeant d'idée : l'état
  // du lecteur doit repartir de zéro, sinon il reste « en pause » sans l'être.
  useEffect(() => setPaused(false), [url]);

  if (animated) {
    return (
      <div className="sp-trailer sp-trailer--media">
        <img className="sp-trailer__media" src={url} alt={title ?? 'Bande-annonce'} />
        <span className="sp-trailer__tag">Bande-annonce</span>
      </div>
    );
  }

  function toggle() {
    const node = video.current;
    if (!node) return;
    if (node.paused) {
      void node.play();
      setPaused(false);
    } else {
      node.pause();
      setPaused(true);
    }
  }

  return (
    <div className="sp-trailer sp-trailer--media">
      <video
        ref={video}
        className="sp-trailer__media"
        src={url}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
      />
      <button
        type="button"
        className={`sp-trailer__playbtn ${paused ? 'is-paused' : ''}`}
        onClick={toggle}
        aria-label={paused ? 'Lire la bande-annonce' : 'Mettre la bande-annonce en pause'}
      >
        <span aria-hidden="true">{paused ? '▶' : '❚❚'}</span>
      </button>
      <span className="sp-trailer__tag">Bande-annonce</span>
    </div>
  );
}
