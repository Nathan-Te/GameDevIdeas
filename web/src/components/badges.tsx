import { STATUS_LABELS } from '../types';
import type { Status } from '../types';

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge badge--status status-${status}`}>{STATUS_LABELS[status] ?? status}</span>
  );
}

/**
 * Le libellé est passé par l'appelant : les familles vivent en base depuis le
 * lot 4, un composant d'affichage n'a pas à aller les chercher.
 */
export function FamilyTag({ label }: { label: string }) {
  return <span className="badge badge--family">{label}</span>;
}

/** Score courant, ou un tiret discret si l'idée n'a jamais été jugée. */
export function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score === null || score === undefined) {
    return (
      <span className="score score--none" title="Jamais jugée">
        –
      </span>
    );
  }
  return (
    <span className="score" title={`Verdict courant : ${score} sur 5`}>
      {score}
      <span className="score__max">/5</span>
    </span>
  );
}

export function formatPrice(cents: number | null): string {
  if (cents === null) return '';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

/** Poids d'un fichier, en unités binaires. `null` pour un lien : rien à afficher. */
export function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} o`;

  const units = ['ko', 'Mo', 'Go'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
