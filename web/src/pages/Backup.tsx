import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';

import { api, ApiError } from '../api';
import { readArchiveManifest } from '../archive';
import { formatDateTime } from '../components/badges';
import { setFlash } from '../flash';
import { Link, navigate } from '../router';
import type { BackupManifest, BackupPreview, RestoreMode, ServerBackup } from '../types';

/**
 * L'écran de sauvegarde.
 *
 * Il tient en trois blocs qui répondent à trois questions : qu'est-ce que je
 * sauvegarde, comment je remets une archive, et qu'est-ce qui traîne sur le
 * serveur. Rien n'y est irréversible sans une phrase qui dit en clair ce qui va
 * se passer — c'est le seul écran de Vitrine qui peut effacer tout le reste.
 */
export function Backup() {
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [backups, setBackups] = useState<ServerBackup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [next, list] = await Promise.all([api.backupPreview(), api.listBackups()]);
      setPreview(next);
      setBackups(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Chargement impossible.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1 className="page__title">Sauvegarde</h1>
          <p className="page__subtitle">
            Une archive contient tout : la base et les fichiers.
          </p>
        </div>
        <div className="page__actions">
          <Link to="/" className="button button--ghost">
            Catalogue
          </Link>
        </div>
      </header>

      {error && <p className="notice notice--error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <SaveBlock preview={preview} onError={setError} onDone={load} />
      <RestoreBlock preview={preview} onError={setError} />
      <ServerBackups
        backups={backups}
        onError={setError}
        onNotice={setNotice}
        onChanged={load}
      />
    </div>
  );
}

// --- Sauvegarder -------------------------------------------------------------

function SaveBlock({
  preview,
  onError,
  onDone,
}: {
  preview: BackupPreview | null;
  onError: (message: string) => void;
  onDone: () => void;
}) {
  const [ratio, setRatio] = useState<number | null>(null);

  async function download() {
    setRatio(0);
    try {
      const { blob, filename } = await api.downloadBackup(setRatio);

      // Un lien cliqué : c'est le seul moyen de donner un nom au fichier.
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);

      onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Sauvegarde impossible.');
    } finally {
      setRatio(null);
    }
  }

  return (
    <section className="panel backup">
      <h2 className="panel__title">Sauvegarder</h2>

      {preview ? (
        <>
          <p className="backup__summary">{describe(preview)}</p>
          <p className="hint">
            Base <code>vitrine.db</code>, dossier <code>files/</code> et un manifeste avec un
            hachage par fichier. Environ {formatBytes(preview.estimated_bytes)} avant compression.
          </p>
        </>
      ) : (
        <p className="hint">Chargement…</p>
      )}

      <div className="backup__actions">
        <button
          type="button"
          className="button button--accent"
          onClick={download}
          disabled={ratio !== null}
        >
          {ratio === null ? 'Télécharger la sauvegarde' : 'Préparation…'}
        </button>
      </div>

      {ratio !== null && (
        <div className="upload__bar" aria-label="Progression de la sauvegarde">
          <div className="upload__fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      )}
    </section>
  );
}

// --- Restaurer ---------------------------------------------------------------

const MODE_TEXT: Record<RestoreMode, string> = {
  replace: "L'état actuel est écrasé par celui de l'archive.",
  merge: "Les idées de l'archive s'ajoutent aux tiennes ; rien n'est supprimé.",
};

function RestoreBlock({
  preview,
  onError,
}: {
  preview: BackupPreview | null;
  onError: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [mode, setMode] = useState<RestoreMode>('replace');
  const [ratio, setRatio] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function choose(next: File | null) {
    setFile(next);
    setManifest(next ? await readArchiveManifest(next) : null);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) void choose(dropped);
  }

  async function restore() {
    if (!file) return;
    if (!window.confirm(confirmation(preview, manifest, mode))) return;

    setRatio(0);
    try {
      const result = await api.restoreBackup(file, mode, setRatio);
      const renamed = result.merged?.renamed.length
        ? ` ${result.merged.renamed.length} slug(s) déjà pris ont été suffixés.`
        : '';

      setFlash(
        `Restauration terminée : ${result.after.ideas} idée(s) et ${result.after.files} fichier(s).` +
          ` Sauvegarde de sécurité : ${result.safety_backup}.${renamed}`,
      );
      navigate('/');
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Restauration impossible.');
      setRatio(null);
    }
  }

  return (
    <section className="panel backup">
      <h2 className="panel__title">Restaurer</h2>

      <div
        className={`dropzone${dragging ? ' is-active' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') input.current?.click();
        }}
      >
        <p className="dropzone__title">
          {file ? file.name : 'Dépose une archive .tgz, ou clique pour la choisir'}
        </p>
        <p className="dropzone__hint">
          {file
            ? manifest
              ? `${describeManifest(manifest)} — archive du ${formatDateTime(manifest.created_at)}`
              : "Manifeste illisible ici ; le serveur vérifiera l'archive."
            : 'Une archive produite par Vitrine, téléchargée ou prise dans data/backups/.'}
        </p>
        <input
          ref={input}
          type="file"
          accept=".tgz,application/gzip"
          hidden
          onChange={(event) => void choose(event.target.files?.[0] ?? null)}
        />
      </div>

      <fieldset className="backup__modes">
        <legend className="field__label">Mode</legend>
        {(['replace', 'merge'] as const).map((value) => (
          <label key={value} className="backup__mode">
            <input
              type="radio"
              name="restore-mode"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
            />
            <span>
              <strong>{value === 'replace' ? 'Remplacer' : 'Fusionner'}</strong>
              <span className="hint">{MODE_TEXT[value]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="backup__actions">
        <button
          type="button"
          className="button button--danger-ghost"
          onClick={restore}
          disabled={!file || ratio !== null}
        >
          {ratio === null ? 'Restaurer cette archive' : 'Restauration…'}
        </button>
        {file && ratio === null && (
          <button type="button" className="button button--ghost" onClick={() => void choose(null)}>
            Retirer le fichier
          </button>
        )}
      </div>

      {ratio !== null && (
        <div className="upload__bar" aria-label="Progression de la restauration">
          <div className="upload__fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      )}

      <p className="hint">
        Une sauvegarde de sécurité de l'état actuel est posée dans <code>data/backups/</code> avant
        toute bascule, et remise en place automatiquement si la restauration échoue.
      </p>
    </section>
  );
}

/** La phrase de confirmation : ce qu'il y a, et ce qu'il y aura. */
function confirmation(
  preview: BackupPreview | null,
  manifest: BackupManifest | null,
  mode: RestoreMode,
): string {
  const now = preview
    ? `${preview.counts.ideas} idée(s) et ${preview.files.count} fichier(s)`
    : "l'état actuel";
  const incoming = manifest
    ? `${manifest.counts.ideas} idée(s) et ${manifest.files.count} fichier(s)`
    : "le contenu de l'archive";

  return mode === 'replace'
    ? `${now} seront remplacés par ${incoming}.\n\nUne sauvegarde de sécurité sera posée avant la bascule. Continuer ?`
    : `${incoming} seront ajoutés à ${now}. Rien ne sera supprimé ; un slug déjà pris sera suffixé.\n\nContinuer ?`;
}

// --- Archives du serveur -----------------------------------------------------

function ServerBackups({
  backups,
  onError,
  onNotice,
  onChanged,
}: {
  backups: ServerBackup[];
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(backup: ServerBackup) {
    if (!window.confirm(`Supprimer définitivement ${backup.name} ?`)) return;

    setBusy(backup.name);
    try {
      await api.deleteBackup(backup.name);
      onNotice(`${backup.name} supprimée.`);
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Suppression impossible.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel backup">
      <h2 className="panel__title">Sauvegardes sur le serveur</h2>

      {backups.length === 0 ? (
        <p className="hint">
          Aucune archive dans <code>data/backups/</code>. C'est là qu'écrivent <code>backup.sh</code>{' '}
          et les sauvegardes de sécurité.
        </p>
      ) : (
        <ul className="backup__list">
          {backups.map((backup) => (
            <li key={backup.name} className="backup__item">
              <div>
                <p className="backup__name">{backup.name}</p>
                <p className="backup__meta">
                  {formatDateTime(backup.created_at)} — {formatBytes(backup.bytes)}
                </p>
              </div>
              <button
                type="button"
                className="button button--danger-ghost"
                onClick={() => remove(backup)}
                disabled={busy === backup.name}
              >
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Formatage ---------------------------------------------------------------

const describe = (preview: BackupPreview) =>
  `${preview.counts.ideas} idée(s), ${preview.counts.verdicts} verdict(s), ` +
  `${preview.counts.attachments} pièce(s) jointe(s), ${preview.counts.families} famille(s), ` +
  `${preview.files.count} fichier(s) (${formatBytes(preview.files.total_bytes)}).`;

const describeManifest = (manifest: BackupManifest) =>
  `${manifest.counts.ideas} idée(s), ${manifest.counts.attachments} pièce(s), ` +
  `${manifest.files.count} fichier(s)`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}
