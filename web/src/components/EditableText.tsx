import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

interface EditableTextProps {
  value: string;
  onSave: (next: string) => void | Promise<void>;
  placeholder?: string;
  /** Textarea au lieu d'un input : Entrée insère un saut de ligne. */
  multiline?: boolean;
  /** Classe appliquée à l'affichage comme à la saisie, pour garder la même taille. */
  className?: string;
  label: string;
}

/**
 * Édition en place : un clic ouvre le champ, la perte de focus ou Entrée
 * sauvegarde, Échap annule.
 *
 * Sur un champ multiligne, Entrée insère un saut de ligne — sans quoi on ne
 * pourrait pas écrire un pitch en deux paragraphes. La sauvegarde s'y fait donc
 * à la perte de focus ou par Ctrl/Cmd + Entrée.
 */
export function EditableText({
  value,
  onSave,
  placeholder = '—',
  multiline = false,
  className = '',
  label,
}: EditableTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  /**
   * Une session d'édition ne se conclut qu'une fois. Sans ce garde-fou, un
   * `blur` déclenché par la fermeture du champ rejouerait la sauvegarde.
   */
  const settled = useRef(false);

  // Si la valeur change côté serveur pendant qu'on n'édite pas, on la suit.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const node = inputRef.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, [editing]);

  function open() {
    settled.current = false;
    setDraft(value);
    setEditing(true);
  }

  /**
   * Conclut l'édition. `save: false` remet la valeur d'origine.
   *
   * On ne passe pas par `blur()` pour déclencher l'enregistrement : si le champ
   * n'a pas le focus (fenêtre en arrière-plan au moment de l'ouverture, focus
   * volé par un autre élément), `blur()` ne fait rien et la saisie serait perdue
   * en silence. La fermeture est donc un changement d'état, pas un effet de bord
   * du focus.
   */
  function finish(save: boolean) {
    if (settled.current) return;
    settled.current = true;
    setEditing(false);

    if (!save) {
      setDraft(value);
      return;
    }

    const next = multiline ? draft : draft.trim();
    if (next !== value) void onSave(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
      return;
    }
    if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      finish(true);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={`editable editable--display ${className} ${value ? '' : 'is-empty'}`}
        onClick={open}
        aria-label={`Modifier ${label}`}
      >
        {value || placeholder}
      </button>
    );
  }

  const shared = {
    ref: inputRef as never,
    className: `editable editable--input ${className}`,
    value: draft,
    'aria-label': label,
    onBlur: () => finish(true),
    onKeyDown,
    onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
  };

  return multiline ? (
    <textarea {...shared} rows={Math.max(3, draft.split('\n').length + 1)} />
  ) : (
    <input {...shared} />
  );
}
