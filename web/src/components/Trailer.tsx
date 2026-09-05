import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

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
 * Les pictogrammes de la barre, tracés ici comme ceux de `icons.tsx` : quatre
 * formes, aucun fichier à charger. Les émojis feraient l'affaire de loin, mais
 * ils sont rendus par la police du système — donc différents d'une machine à
 * l'autre, et souvent flous à cette taille.
 */
const glyph = {
  viewBox: '0 0 16 16',
  fill: 'currentColor',
  'aria-hidden': true,
  focusable: false,
} as const;

const PlayGlyph = () => (
  <svg {...glyph}>
    <path d="M4.5 2.5 13 8l-8.5 5.5v-11Z" />
  </svg>
);

const PauseGlyph = () => (
  <svg {...glyph}>
    <path d="M4 2.5h3v11H4v-11Zm5 0h3v11H9v-11Z" />
  </svg>
);

/** Le haut-parleur, avec ou sans ses ondes selon que le son passe ou non. */
const SoundGlyph = ({ on }: { on: boolean }) => (
  <svg {...glyph}>
    <path d="M8.5 2 4.8 5H2v6h2.8l3.7 3V2Z" />
    {on ? (
      <path
        d="M10.6 5.2a4 4 0 0 1 0 5.6M12.6 3.2a6.8 6.8 0 0 1 0 9.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    ) : (
      <path
        d="m10.8 6 4 4m0-4-4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    )}
  </svg>
);

/**
 * Le niveau auquel une bande-annonce démarre quand on lui rend le son. À fond
 * serait agressif : la vidéo joue déjà, on ne fait que la rendre audible.
 */
const DEFAULT_VOLUME = 0.5;

/** `72` -> « 1:12 ». Les bandes-annonces sont courtes : pas d'heures. */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * La bande-annonce en tête de la visionneuse de la vue store, avec sa barre de
 * lecture : lecture/pause, position dans la vidéo, son.
 *
 * La barre est écrite à la main plutôt que déléguée à `controls` : les contrôles
 * natifs sont ceux du navigateur, reconnaissables au premier coup d'œil, et
 * cette page est un photomontage — un lecteur Chrome au milieu la trahirait
 * autant qu'un logo. Les couleurs vivent donc dans `steam.css` avec le reste du
 * décor, jamais dans les tokens de Vitrine.
 *
 * La lecture démarre **sans son** : c'est ce que fait un magasin, et c'est aussi
 * la seule façon dont un navigateur accepte de démarrer tout seul. Le bouton de
 * son rend la main tout de suite.
 *
 * Se déplacer dans la vidéo repose sur les requêtes `Range` de `/files/*` : sans
 * elles la barre s'afficherait mais ne servirait à rien.
 *
 * Un GIF n'a ni son, ni durée, ni position : il n'a donc pas de barre. Des
 * contrôles morts sur une page qui prétend être un magasin se remarquent plus
 * que leur absence.
 */
export function TrailerStage({ url, title }: { url: string; title?: string }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const animated = isAnimatedImage(url);

  // La visionneuse remonte une autre bande-annonce en changeant d'idée : l'état
  // du lecteur doit repartir de zéro, sinon il reste « en pause » sans l'être,
  // ou affiche la durée de la précédente.
  useEffect(() => {
    setPaused(false);
    setMuted(true);
    setPosition(0);
    setDuration(0);
    setVolume(DEFAULT_VOLUME);

    /**
     * Le volume est posé ici, sur l'élément, et non à l'arrivée des
     * métadonnées : un fichier déjà en cache peut les avoir chargées avant que
     * React n'ait branché son écouteur, et le lecteur repartait alors à 100 %.
     * Rendre le son ferait sursauter — exactement ce qu'on évite en démarrant
     * muet.
     *
     * L'état est la source, l'élément suit : c'est pourquoi on n'écoute pas
     * `volumechange`. Un aller-retour entre les deux se stabilise mal, et la
     * seule chose qui touche au volume ici, c'est la barre.
     */
    const node = video.current;
    if (node) {
      node.muted = true;
      node.volume = DEFAULT_VOLUME;
    }
  }, [url]);

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
    if (node.paused) void node.play();
    else node.pause();
  }

  /**
   * Couper le son ne remet pas le volume à zéro, et le rétablir ne le remonte
   * pas à fond : on retrouve exactement le niveau qu'on avait laissé. Un volume
   * à zéro qu'on rallume repart à la moitié, sinon le bouton n'aurait l'air de
   * rien faire.
   */
  function toggleSound() {
    const node = video.current;
    if (!node) return;
    const next = !node.muted;
    node.muted = next;
    if (!next && node.volume === 0) {
      node.volume = 0.5;
      setVolume(0.5);
    }
    setMuted(next);
  }

  function seek(seconds: number) {
    const node = video.current;
    if (!node) return;
    node.currentTime = seconds;
    setPosition(seconds);
  }

  function changeVolume(next: number) {
    const node = video.current;
    if (!node) return;
    node.volume = next;
    // Bouger le volume est une demande de son : on ne laisse pas un curseur
    // monté sur une vidéo restée muette.
    node.muted = next === 0;
    setVolume(next);
    setMuted(next === 0);
  }

  // Une vidéo dont les métadonnées ne sont pas encore là n'a pas de durée : la
  // barre reste inerte plutôt que d'afficher une position fausse.
  const seekable = duration > 0;

  return (
    <div className={`sp-trailer sp-trailer--media ${paused ? 'is-paused' : ''}`}>
      <video
        ref={video}
        className="sp-trailer__media"
        src={url}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        onClick={toggle}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => {
          const { duration: length } = event.currentTarget;
          setDuration(Number.isFinite(length) ? length : 0);
        }}
      />

      {/* Le grand bouton central n'existe qu'à l'arrêt : pendant la lecture, la
          barre du bas suffit et un rond au milieu de l'image gênerait. */}
      {paused && (
        <button
          type="button"
          className="sp-trailer__bigplay"
          onClick={toggle}
          aria-label="Lire la bande-annonce"
        >
          <PlayGlyph />
        </button>
      )}

      <div className="sp-trailer__bar">
        <button
          type="button"
          className="sp-trailer__ctrl"
          onClick={toggle}
          aria-label={paused ? 'Lire' : 'Mettre en pause'}
        >
          {paused ? <PlayGlyph /> : <PauseGlyph />}
        </button>

        <span className="sp-trailer__time">{clock(position)}</span>

        <input
          className="sp-trailer__seek"
          type="range"
          min={0}
          max={seekable ? duration : 1}
          step={0.05}
          value={seekable ? Math.min(position, duration) : 0}
          disabled={!seekable}
          aria-label="Position dans la bande-annonce"
          onChange={(event) => seek(Number(event.target.value))}
          // La progression est peinte dans le rail par un dégradé : une barre
          // qui ne se remplit pas ne se lit pas d'un coup d'œil.
          style={{
            '--filled': `${seekable ? (Math.min(position, duration) / duration) * 100 : 0}%`,
          } as CSSProperties}
        />

        <span className="sp-trailer__time">{clock(duration)}</span>

        <button
          type="button"
          className="sp-trailer__ctrl"
          onClick={toggleSound}
          aria-label={muted ? 'Activer le son' : 'Couper le son'}
        >
          <SoundGlyph on={!muted && volume > 0} />
        </button>

        <input
          className="sp-trailer__volume"
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={muted ? 0 : volume}
          aria-label="Volume"
          onChange={(event) => changeVolume(Number(event.target.value))}
          style={{ '--filled': `${(muted ? 0 : volume) * 100}%` } as CSSProperties}
        />
      </div>

      <span className="sp-trailer__tag">Bande-annonce</span>
    </div>
  );
}
