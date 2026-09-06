import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';

import { api, ApiError } from '../api';
import { formatSize } from './badges';
import { EditableText } from './EditableText';
import { GripIcon, KindIcon, LinkIcon } from './icons';
import { Lightbox } from './Lightbox';
import { MarkdownFile } from './Markdown';
import { TrailerMedia } from './Trailer';
import { LINK_TYPE_LABELS, LINK_TYPES } from '../types';
import type { Attachment, LinkType } from '../types';

/** Un envoi en cours : une barre par fichier, comme demandé au lot. */
interface Upload {
  key: number;
  name: string;
  ratio: number;
  error: string | null;
}

interface AttachmentsProps {
  slug: string;
  capsuleFileId: number | null;
  /**
   * La pièce **en tête** : la désignée — bande-annonce ou image —, ou la
   * première bande-annonce à défaut. C'est elle qui ouvre la visionneuse du
   * store, et que le catalogue joue au survol quand c'est une vidéo.
   */
  leadingMediaId: number | null;
  /** Enregistre la capsule côté idée ; la page idée en garde la maîtrise. */
  onCapsuleChange: (id: number | null) => void | Promise<void>;
  /** Met une pièce en tête. On en désigne une, on n'en retire pas : jamais `null`. */
  onLeadingChange: (id: number) => void | Promise<void>;
  /**
   * Appelé quand la capsule vient de disparaître avec sa pièce jointe : le
   * serveur a déjà remis `capsule_file_id` à `null`, la page doit le refléter.
   */
  onCapsuleLost: () => void;
  /**
   * Appelé quand une bande-annonce, ou la pièce en tête, vient d'être
   * supprimée : la tête a pu passer à la suivante côté serveur, la page doit
   * relire l'idée plutôt que deviner.
   */
  onLeadingLost: () => void;
  /**
   * Le nombre de bandes-annonces, remonté à chaque changement de la liste : la
   * fiche de la page idée l'annonce, et c'est le seul bloc de la page qui n'a
   * pas les pièces jointes sous la main.
   */
  onCountChange: (trailers: number) => void;
}

export function Attachments({
  slug,
  capsuleFileId,
  leadingMediaId,
  onCapsuleChange,
  onLeadingChange,
  onCapsuleLost,
  onLeadingLost,
  onCountChange,
}: AttachmentsProps) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadKey = useRef(0);

  useEffect(() => {
    let cancelled = false;

    api
      .listAttachments(slug)
      .then((loaded) => {
        if (!cancelled) setAttachments(loaded);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Pièces jointes illisibles.');
        setAttachments([]);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  /**
   * Un fichier par requête, envoyés l'un après l'autre.
   *
   * Une requête par fichier, parce que la progression d'un envoi groupé est
   * indistincte et que le lot demande une barre par fichier. Séquentiel, parce
   * que `position` vaut max + 1 : en parallèle, cinq captures déposées dans
   * l'ordre arriveraient dans l'ordre où elles finissent de monter. Les barres
   * apparaissent toutes d'un coup et se remplissent à tour de rôle.
   */
  const send = useCallback(
    async (files: File[]) => {
      setError(null);

      const queued = files.map((file) => ({
        key: (uploadKey.current += 1),
        name: file.name,
        ratio: 0,
        error: null as string | null,
      }));
      setUploads((current) => [...current, ...queued]);

      for (const [index, file] of files.entries()) {
        const { key } = queued[index];

        const setRatio = (ratio: number) =>
          setUploads((current) =>
            current.map((upload) => (upload.key === key ? { ...upload, ratio } : upload)),
          );

        try {
          const created = await api.uploadFile(slug, file, setRatio);
          setAttachments((current) => [...(current ?? []), created]);
          setUploads((current) => current.filter((upload) => upload.key !== key));
        } catch (err) {
          const message = err instanceof ApiError ? err.message : 'Envoi impossible.';
          // L'échec reste affiché : sinon la barre disparaît sans explication.
          // Les fichiers suivants partent quand même.
          setUploads((current) =>
            current.map((upload) => (upload.key === key ? { ...upload, error: message } : upload)),
          );
        }
      }
    },
    [slug],
  );

  async function addLink(url: string) {
    try {
      setError(null);
      const created = await api.addLink(slug, { url });
      setAttachments((current) => [...(current ?? []), created]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lien non ajouté.');
      throw err;
    }
  }

  async function rename(attachment: Attachment, label: string) {
    const updated = await api.updateAttachment(attachment.id, { label });
    setAttachments((current) =>
      (current ?? []).map((item) => (item.id === updated.id ? updated : item)),
    );
  }

  /**
   * Le type d'un lien est deviné sur le domaine à la création. Un lien Notion
   * vers un dépôt reste marqué « Lien » : c'est le point 5 laissé ouvert au lot
   * 2, et la route `PATCH` l'acceptait déjà.
   */
  async function retype(attachment: Attachment, link_type: LinkType) {
    try {
      setError(null);
      const updated = await api.updateAttachment(attachment.id, { link_type });
      setAttachments((current) =>
        (current ?? []).map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Type de lien non enregistré.');
    }
  }

  async function remove(attachment: Attachment) {
    const what = attachment.kind === 'link' ? 'ce lien' : `« ${attachment.label} »`;
    if (!window.confirm(`Supprimer ${what} ? C'est définitif.`)) return;

    try {
      setError(null);
      await api.deleteAttachment(attachment.id);
      setAttachments((current) => (current ?? []).filter((item) => item.id !== attachment.id));
      // Le serveur a déjà libéré capsule et bande-annonce : la page doit le savoir.
      if (attachment.id === capsuleFileId) onCapsuleLost();
      // La tête peut être une image depuis qu'un encart central se désigne :
      // supprimer celle-là la libère aussi, il faut relire.
      if (attachment.kind === 'trailer' || attachment.id === leadingMediaId) onLeadingLost();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Suppression impossible.');
    }
  }

  /** Réordonne localement puis enregistre. En cas d'échec, on recharge l'ordre serveur. */
  const commitOrder = useCallback(
    async (ordered: Attachment[]) => {
      setAttachments(ordered);
      try {
        setError(null);
        setAttachments(await api.reorderAttachments(slug, ordered.map((item) => item.id)));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Ordre non enregistré.');
        setAttachments(await api.listAttachments(slug).catch(() => ordered));
      }
    },
    [slug],
  );

  const images = (attachments ?? []).filter((item) => item.kind === 'image' && item.file_url);
  const trailerCount = (attachments ?? []).filter((item) => item.kind === 'trailer').length;

  useEffect(() => onCountChange(trailerCount), [trailerCount, onCountChange]);

  return (
    <section className="field attachments">
      <h2 className="field__label">
        Pièces jointes
        <span className="field__hint">
          Images et bandes-annonces alimentent la visionneuse de la page store ;
          markdown, fichiers et liens restent ici. Glisse pour réordonner.
        </span>
      </h2>

      <DropZone
        active={dropping}
        onActiveChange={setDropping}
        onFiles={send}
        onPick={() => inputRef.current?.click()}
      />

      <input
        ref={inputRef}
        type="file"
        multiple
        className="visually-hidden"
        aria-label="Choisir des fichiers à joindre"
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          if (picked.length) void send(picked);
          // Remis à zéro pour pouvoir renvoyer deux fois le même fichier.
          event.target.value = '';
        }}
      />

      <LinkField onSubmit={addLink} />

      {error && <p className="notice notice--error">{error}</p>}

      {uploads.length > 0 && (
        <ul className="uploads">
          {uploads.map((upload) => (
            <li key={upload.key} className={`upload ${upload.error ? 'is-failed' : ''}`}>
              <span className="upload__name">{upload.name}</span>
              {upload.error ? (
                <>
                  <span className="upload__error">{upload.error}</span>
                  <button
                    type="button"
                    className="attachment__action"
                    onClick={() =>
                      setUploads((current) => current.filter((item) => item.key !== upload.key))
                    }
                  >
                    Masquer
                  </button>
                </>
              ) : (
                <span
                  className="upload__bar"
                  role="progressbar"
                  aria-label={`Envoi de ${upload.name}`}
                  aria-valuenow={Math.round(upload.ratio * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <span className="upload__fill" style={{ width: `${upload.ratio * 100}%` }} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {attachments === null && <p className="hint">Chargement…</p>}

      {attachments !== null && attachments.length === 0 && uploads.length === 0 && (
        <p className="hint">Aucune pièce jointe pour l’instant.</p>
      )}

      {attachments !== null && attachments.length > 0 && (
        <AttachmentList
          attachments={attachments}
          capsuleFileId={capsuleFileId}
          leadingMediaId={leadingMediaId}
          images={images}
          onReorder={commitOrder}
          onRename={rename}
          onRetype={retype}
          onRemove={remove}
          onCapsuleChange={onCapsuleChange}
          onLeadingChange={onLeadingChange}
          onView={setViewing}
        />
      )}

      {viewing !== null && images[viewing] && (
        <Lightbox
          images={images}
          index={viewing}
          onClose={() => setViewing(null)}
          onNavigate={setViewing}
        />
      )}
    </section>
  );
}

/** Glisser-déposer de fichiers, ou clic pour ouvrir le sélecteur. */
function DropZone({
  active,
  onActiveChange,
  onFiles,
  onPick,
}: {
  active: boolean;
  onActiveChange: (active: boolean) => void;
  onFiles: (files: File[]) => void;
  onPick: () => void;
}) {
  /**
   * `dragenter` et `dragleave` se déclenchent aussi en passant d'un enfant à
   * l'autre : on compte les entrées et les sorties plutôt que de basculer un
   * booléen, sans quoi la zone clignote dès qu'on survole son texte.
   */
  const depth = useRef(0);

  function containsFiles(event: DragEvent) {
    return Array.from(event.dataTransfer.types).includes('Files');
  }

  return (
    <button
      type="button"
      className={`dropzone ${active ? 'is-active' : ''}`}
      onClick={onPick}
      onDragEnter={(event) => {
        if (!containsFiles(event)) return;
        depth.current += 1;
        onActiveChange(true);
      }}
      onDragOver={(event) => {
        if (!containsFiles(event)) return;
        // Sans ça, le navigateur ouvre le fichier au lieu de nous le donner.
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) onActiveChange(false);
      }}
      onDrop={(event) => {
        if (!containsFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        onActiveChange(false);
        const dropped = Array.from(event.dataTransfer.files);
        if (dropped.length) onFiles(dropped);
      }}
    >
      <span className="dropzone__title">Dépose des fichiers ici</span>
      <span className="dropzone__hint">ou clique pour les choisir</span>
    </button>
  );
}

/** Coller une URL, Entrée : la carte apparaît avec l'icône de son type. */
function LinkField({ onSubmit }: { onSubmit: (url: string) => Promise<void> }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    try {
      await onSubmit(trimmed);
      setUrl('');
    } catch {
      // Le message est déjà affiché par le parent ; l'URL reste pour correction.
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="link-field" onSubmit={submit}>
      <input
        className="link-field__input"
        type="url"
        value={url}
        placeholder="Ajouter un lien : colle une URL, puis Entrée"
        aria-label="Ajouter un lien"
        onChange={(event) => setUrl(event.target.value)}
      />
      <button type="submit" className="button" disabled={busy || !url.trim()}>
        {busy ? 'Ajout…' : 'Ajouter'}
      </button>
    </form>
  );
}

function AttachmentList({
  attachments,
  capsuleFileId,
  leadingMediaId,
  images,
  onReorder,
  onRename,
  onRetype,
  onRemove,
  onCapsuleChange,
  onLeadingChange,
  onView,
}: {
  attachments: Attachment[];
  capsuleFileId: number | null;
  leadingMediaId: number | null;
  images: Attachment[];
  onReorder: (ordered: Attachment[]) => void | Promise<void>;
  onRename: (attachment: Attachment, label: string) => Promise<void>;
  onRetype: (attachment: Attachment, type: LinkType) => void | Promise<void>;
  onRemove: (attachment: Attachment) => void;
  onCapsuleChange: (id: number | null) => void | Promise<void>;
  onLeadingChange: (id: number) => void | Promise<void>;
  onView: (index: number) => void;
}) {
  /**
   * Glisser-déposer HTML5, sans bibliothèque. La liste est réarrangée en direct
   * pendant le survol — on voit où la carte va tomber — et l'ordre n'est
   * enregistré qu'au relâchement.
   *
   * `draggable` n'est posé que pendant qu'on tient la poignée : sinon le
   * navigateur intercepterait la sélection de texte dans les libellés éditables.
   */
  const [dragging, setDragging] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const [preview, setPreview] = useState<Attachment[] | null>(null);

  const list = preview ?? attachments;

  function moveTo(id: number, index: number) {
    const from = list.findIndex((item) => item.id === id);
    if (from === -1 || from === index) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);
    setPreview(next);
  }

  function drop() {
    const ordered = preview;
    setDragging(null);
    setArmed(null);
    setPreview(null);
    if (ordered && ordered.some((item, index) => item.id !== attachments[index]?.id)) {
      void onReorder(ordered);
    }
  }

  /** Même déplacement au clavier, pour qui n'a ni souris ni glisser-déposer. */
  function nudge(event: KeyboardEvent, id: number) {
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    event.preventDefault();

    const from = attachments.findIndex((item) => item.id === id);
    const to = from + delta;
    if (to < 0 || to >= attachments.length) return;

    const next = [...attachments];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void onReorder(next);
  }

  return (
    <ul className="attachment-list">
      {list.map((attachment, index) => (
        <li
          key={attachment.id}
          className={`attachment attachment--${attachment.kind} ${
            dragging === attachment.id ? 'is-dragging' : ''
          }`}
          draggable={armed === attachment.id}
          onDragStart={(event) => {
            setDragging(attachment.id);
            event.dataTransfer.effectAllowed = 'move';
            // Firefox n'amorce pas le glisser sans données transportées.
            event.dataTransfer.setData('text/plain', String(attachment.id));
          }}
          onDragOver={(event) => {
            if (dragging === null) return;
            event.preventDefault();
            moveTo(dragging, index);
          }}
          onDrop={(event) => {
            if (dragging === null) return;
            event.preventDefault();
            drop();
          }}
          onDragEnd={drop}
        >
          <span
            className="attachment__grip"
            role="button"
            tabIndex={0}
            aria-label={`Déplacer ${attachment.label} — flèches haut et bas`}
            title="Glisser pour réordonner (ou flèches haut/bas)"
            onMouseDown={() => setArmed(attachment.id)}
            onMouseUp={() => setArmed(null)}
            onKeyDown={(event) => nudge(event, attachment.id)}
          >
            <GripIcon />
          </span>

          <AttachmentCard
            attachment={attachment}
            isCapsule={attachment.id === capsuleFileId}
            isLeading={attachment.id === leadingMediaId}
            galleryIndex={images.findIndex((image) => image.id === attachment.id)}
            onRename={onRename}
            onRetype={onRetype}
            onRemove={onRemove}
            onCapsuleChange={onCapsuleChange}
            onLeadingChange={onLeadingChange}
            onView={onView}
          />
        </li>
      ))}
    </ul>
  );
}

function AttachmentCard({
  attachment,
  isCapsule,
  isLeading,
  galleryIndex,
  onRename,
  onRetype,
  onRemove,
  onCapsuleChange,
  onLeadingChange,
  onView,
}: {
  attachment: Attachment;
  isCapsule: boolean;
  isLeading: boolean;
  galleryIndex: number;
  onRename: (attachment: Attachment, label: string) => Promise<void>;
  onRetype: (attachment: Attachment, type: LinkType) => void | Promise<void>;
  onRemove: (attachment: Attachment) => void;
  onCapsuleChange: (id: number | null) => void | Promise<void>;
  onLeadingChange: (id: number) => void | Promise<void>;
  onView: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="attachment__body">
      {attachment.kind === 'image' && attachment.file_url && (
        <button
          type="button"
          className="attachment__thumb"
          onClick={() => onView(galleryIndex)}
          aria-label={`Voir ${attachment.label} en grand`}
        >
          <img src={attachment.file_url} alt="" loading="lazy" />
        </button>
      )}

      {/* La bande-annonce s'affiche à côté de son libellé, comme une image : une
          carte qui n'en montre que le nom ne dit pas laquelle c'est. Le lecteur
          reste en pause — la jouer, c'est le rôle de la vue store. */}
      {attachment.kind === 'trailer' && attachment.file_url && (
        <span className="attachment__thumb attachment__thumb--trailer">
          <TrailerMedia url={attachment.file_url} autoPlay={false} />
        </span>
      )}

      {attachment.kind !== 'image' && attachment.kind !== 'trailer' && (
        <span className="attachment__icon" title={describe(attachment)}>
          {attachment.kind === 'link' ? (
            <LinkIcon type={attachment.link_type} />
          ) : (
            <KindIcon kind={attachment.kind} />
          )}
        </span>
      )}

      <div className="attachment__main">
        <div className="attachment__title">
          <EditableText
            label="le libellé"
            className="attachment__label"
            value={attachment.label}
            placeholder="Sans libellé"
            onSave={(label) => onRename(attachment, label)}
          />
          {isCapsule && <span className="attachment__flag">capsule</span>}
          {isLeading && <span className="attachment__flag">en tête</span>}
        </div>

        <p className="attachment__meta">
          {attachment.kind === 'link' && attachment.url ? (
            <a
              className="attachment__url"
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              title={attachment.url}
            >
              {describe(attachment)}
            </a>
          ) : (
            describe(attachment)
          )}
        </p>

        {open && attachment.kind === 'markdown' && attachment.file_url && (
          <MarkdownFile url={attachment.file_url} />
        )}
      </div>

      <div className="attachment__actions">
        {attachment.kind === 'link' && (
          <select
            className="select select--compact"
            value={attachment.link_type ?? 'autre'}
            aria-label={`Type du lien ${attachment.label}`}
            title="Type du lien — pilote l’icône"
            onChange={(event) => void onRetype(attachment, event.target.value as LinkType)}
          >
            {LINK_TYPES.map((type) => (
              <option key={type} value={type}>
                {LINK_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        )}

        {attachment.kind === 'markdown' && (
          <button
            type="button"
            className="attachment__action"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? 'Replier' : 'Lire'}
          </button>
        )}

        {attachment.kind === 'image' && (
          <button
            type="button"
            className={`attachment__action ${isCapsule ? 'is-active' : ''}`}
            onClick={() => void onCapsuleChange(isCapsule ? null : attachment.id)}
          >
            {isCapsule ? 'Retirer la capsule' : 'Définir comme capsule'}
          </button>
        )}

        {/* Pas de « retirer » : la visionneuse a toujours une première place,
            et la rendre vide n'a pas de sens. On met une autre en tête.

            Une image y a droit comme une bande-annonce : une idée sans vidéo
            ouvre alors sur une capture plutôt que sur la carte de texte, et la
            capsule peut tenir les deux places à la fois. */}
        {(attachment.kind === 'trailer' || attachment.kind === 'image') && !isLeading && (
          <button
            type="button"
            className="attachment__action"
            onClick={() => void onLeadingChange(attachment.id)}
            title="Ouvrir la visionneuse de la page store sur cette pièce"
          >
            Mettre en tête
          </button>
        )}

        {attachment.file_url && attachment.kind !== 'markdown' && (
          <a className="attachment__action" href={attachment.file_url} download>
            Télécharger
          </a>
        )}

        <button
          type="button"
          className="attachment__action attachment__action--danger"
          onClick={() => onRemove(attachment)}
        >
          Supprimer
        </button>
      </div>
    </div>
  );
}

/** Ligne d'information sous le libellé : domaine pour un lien, poids sinon. */
function describe(attachment: Attachment): string {
  if (attachment.kind === 'link') {
    const type = LINK_TYPE_LABELS[attachment.link_type ?? 'autre'];
    try {
      return `${type} · ${new URL(attachment.url ?? '').hostname.replace(/^www\./, '')}`;
    } catch {
      return type;
    }
  }

  const size = formatSize(attachment.size_bytes);
  const kind = {
    image: 'Image',
    trailer: 'Bande-annonce',
    markdown: 'Markdown',
    file: 'Fichier',
    link: 'Lien',
  }[attachment.kind];
  return size ? `${kind} · ${size}` : kind;
}
