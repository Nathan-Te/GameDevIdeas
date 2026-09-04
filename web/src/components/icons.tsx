import type { AttachmentKind, LinkType } from '../types';

/**
 * Icônes tracées à la main plutôt qu'une police d'icônes : il en faut neuf, et
 * une dépendance de plus pour neuf tracés ne se justifierait pas. Elles suivent
 * la couleur du texte (`currentColor`) et la taille est fixée par le CSS.
 */

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

const PATHS: Record<LinkType | AttachmentKind, React.ReactNode> = {
  // Trois colonnes : un tableau Trello.
  trello: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 7v8M16 7v5" />
    </>
  ),
  // Un cube : un paquet de l'Asset Store.
  'asset-store': (
    <>
      <path d="M12 3 21 7.5v9L12 21 3 16.5v-9L12 3Z" />
      <path d="m3 7.5 9 4.5 9-4.5M12 12v9" />
    </>
  ),
  // Deux branches qui se rejoignent : un dépôt Git.
  git: (
    <>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="10" r="2.2" />
      <path d="M7 8.2v7.6M17 12.2c0 3-3 3.8-6 3.8" />
    </>
  ),
  // Une manette : Steam.
  steam: (
    <>
      <path d="M7 16.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M17 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="m9.4 12.3 5.2-3.1" />
    </>
  ),
  // Un triangle de lecture : une vidéo.
  video: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="3" />
      <path d="m10 9.5 5 2.5-5 2.5v-5Z" />
    </>
  ),
  // Un maillon : un lien quelconque.
  autre: (
    <>
      <path d="M10 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7l-1.3 1.3" />
      <path d="M14 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.3-1.3" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m4 18 5-4.5 4 3.5 3-2.5 4 3.5" />
    </>
  ),
  markdown: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5M8.5 17v-4l2 2.2L12.5 13v4M15 13v3M13.8 15 15 16.5 16.2 15" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </>
  ),
  // Un clap : une bande-annonce. Elle a normalement son aperçu, mais une carte
  // dont le fichier ne se charge pas doit quand même dire ce qu'elle est.
  trailer: (
    <>
      <path d="M3 8h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />
      <path d="m3 8 2.5-4h13L21 8M8.5 4 6 8m7-4-2.5 4m7-4L15 8" />
    </>
  ),
  link: (
    <>
      <path d="M10 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 1 0-5.7-5.7l-1.3 1.3" />
      <path d="M14 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 1 0 5.7 5.7l1.3-1.3" />
    </>
  ),
};

export function LinkIcon({ type }: { type: LinkType | null }) {
  return (
    <svg {...base} className="icon">
      {PATHS[type ?? 'autre']}
    </svg>
  );
}

export function KindIcon({ kind }: { kind: AttachmentKind }) {
  return (
    <svg {...base} className="icon">
      {PATHS[kind]}
    </svg>
  );
}

/** Poignée de glisser-déposer : six points, la convention habituelle. */
export function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden focusable={false} fill="currentColor">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}
