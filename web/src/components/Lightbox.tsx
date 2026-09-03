import { useCallback, useEffect } from 'react';

import type { Attachment } from '../types';

/**
 * Visionneuse d'images : clic sur une vignette, l'image s'ouvre en grand.
 * Flèches pour naviguer, Échap pour fermer, clic sur le fond aussi.
 *
 * Volontairement minimale — pas de zoom, pas de diaporama, pas de dépendance.
 * L'objectif est de regarder une capture en grand, pas de gérer une photothèque.
 */
export function Lightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: Attachment[];
  index: number;
  onClose: () => void;
  onNavigate: (next: number) => void;
}) {
  const current = images[index];

  const step = useCallback(
    (delta: number) => {
      if (images.length < 2) return;
      onNavigate((index + delta + images.length) % images.length);
    },
    [index, images.length, onNavigate],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') step(1);
      else if (event.key === 'ArrowLeft') step(-1);
      else return;
      event.preventDefault();
    }

    window.addEventListener('keydown', onKeyDown);
    // Le fond de page ne défile pas pendant que la visionneuse est ouverte.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose, step]);

  if (!current?.file_url) return null;

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={current.label || 'Image attachée'}
      // Un clic sur le fond ferme ; un clic sur l'image ne doit pas remonter.
      onClick={onClose}
    >
      <button type="button" className="lightbox__close" onClick={onClose} aria-label="Fermer">
        ✕
      </button>

      {images.length > 1 && (
        <button
          type="button"
          className="lightbox__nav lightbox__nav--prev"
          aria-label="Image précédente"
          onClick={(event) => {
            event.stopPropagation();
            step(-1);
          }}
        >
          ‹
        </button>
      )}

      <figure className="lightbox__figure" onClick={(event) => event.stopPropagation()}>
        <img className="lightbox__image" src={current.file_url} alt={current.label} />
        <figcaption className="lightbox__caption">
          {current.label}
          {images.length > 1 && (
            <span className="lightbox__counter">
              {index + 1} / {images.length}
            </span>
          )}
        </figcaption>
      </figure>

      {images.length > 1 && (
        <button
          type="button"
          className="lightbox__nav lightbox__nav--next"
          aria-label="Image suivante"
          onClick={(event) => {
            event.stopPropagation();
            step(1);
          }}
        >
          ›
        </button>
      )}
    </div>
  );
}
