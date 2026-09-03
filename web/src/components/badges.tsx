import { FAMILY_LABELS, STATUS_LABELS } from '../types';
import type { Family, Status } from '../types';

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge badge--status status-${status}`}>{STATUS_LABELS[status] ?? status}</span>
  );
}

export function FamilyTag({ family }: { family: Family }) {
  return <span className="badge badge--family">{FAMILY_LABELS[family] ?? family}</span>;
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
