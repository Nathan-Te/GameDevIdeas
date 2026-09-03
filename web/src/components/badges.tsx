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
