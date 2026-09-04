import { useCallback, useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { FAMILY_FEATURES } from '../../../shared/store-model.js';
import { api, ApiError } from '../api';
import { EditableText } from '../components/EditableText';
import { GripIcon } from '../components/icons';
import { publishFamilies, useFamilies } from '../families';
import { Link } from '../router';
import { FAMILY_FEATURE_LABELS } from '../types';
import type { Family, FamilyPatch } from '../types';
import type { FamilyFeature } from '../../../shared/store-model';

/**
 * L'écran des familles.
 *
 * Avant le lot 4, la liste des familles était figée dans le code : ajouter
 * « Récit à embranchements » demandait de toucher le serveur, le modèle store
 * et le front. Elle s'édite ici.
 *
 * Une famille porte trois choses, et il faut les distinguer :
 * - son **libellé**, ce que Vitrine affiche dans ses sélecteurs ;
 * - ses **étiquettes**, ce qu'un magasin afficherait — ce ne sont pas les mêmes
 *   mots, et c'est voulu ;
 * - ses **fonctionnalités**, les lignes de la colonne de droite de la fiche.
 *
 * Le slug, lui, ne s'édite pas ici : il suit le libellé à la création et se
 * renomme depuis l'API. Le renommer en un clic depuis cette liste changerait la
 * famille de toutes les idées concernées sans le dire — la route le fait, mais
 * c'est un geste qui mérite mieux qu'une case à cocher.
 */
export function Families() {
  const { families, loaded, reload } = useFamilies();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const [preview, setPreview] = useState<Family[] | null>(null);

  useEffect(() => {
    void reload();
  }, [reload]);

  const list = preview ?? families;

  const save = useCallback(async (slug: string, patch: FamilyPatch) => {
    try {
      setError(null);
      await api.updateFamily(slug, patch);
      publishFamilies(await api.listFamilies());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Enregistrement impossible.');
      publishFamilies(await api.listFamilies().catch(() => []));
    }
  }, []);

  async function create() {
    setCreating(true);
    try {
      setError(null);
      await api.createFamily({ label: 'Nouvelle famille', store_tags: [], features: ['solo'] });
      publishFamilies(await api.listFamilies());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création impossible.');
    } finally {
      setCreating(false);
    }
  }

  async function remove(family: Family) {
    if (family.idea_count > 0) {
      setError(
        `« ${family.label} » est encore la famille de ${family.idea_count} idée${
          family.idea_count > 1 ? 's' : ''
        } : change-les de famille avant de la supprimer.`,
      );
      return;
    }
    if (!window.confirm(`Supprimer la famille « ${family.label} » ? C'est définitif.`)) return;

    try {
      setError(null);
      await api.deleteFamily(family.slug);
      publishFamilies(await api.listFamilies());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Suppression impossible.');
    }
  }

  /**
   * Même patron que les pièces jointes : la liste se réarrange en direct sous
   * la souris, et l'ordre n'est envoyé qu'au relâchement — une position par
   * famille déplacée, le serveur renumérote le reste.
   */
  function moveTo(id: number, index: number) {
    const from = list.findIndex((family) => family.id === id);
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
    if (!ordered) return;

    const moved = ordered.findIndex((family, index) => family.id !== families[index]?.id);
    if (moved === -1) return;
    void save(ordered[moved].slug, { position: moved });
  }

  function nudge(event: KeyboardEvent, family: Family, index: number) {
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    event.preventDefault();

    const to = index + delta;
    if (to < 0 || to >= families.length) return;
    void save(family.slug, { position: to });
  }

  return (
    <div className="page page--families">
      <header className="page__header">
        <div>
          <h1 className="page__title">Familles</h1>
          <p className="page__subtitle">
            Le libellé sert à Vitrine, les étiquettes à la page store. Glisse pour réordonner.
          </p>
        </div>

        <div className="page__actions">
          <Link to="/" className="button button--ghost">
            ‹ Catalogue
          </Link>
          <button
            type="button"
            className="button button--accent"
            onClick={create}
            disabled={creating}
          >
            {creating ? 'Création…' : 'Nouvelle famille'}
          </button>
        </div>
      </header>

      {error && <p className="notice notice--error">{error}</p>}

      {!loaded && <p className="hint">Chargement…</p>}

      {loaded && list.length === 0 && (
        <div className="empty">
          <p className="empty__title">Aucune famille.</p>
          <p className="empty__text">
            Sans famille, une idée n’a ni étiquettes ni fonctionnalités sur sa page store.
          </p>
        </div>
      )}

      <ul className="family-list">
        {list.map((family, index) => (
          <li
            key={family.id}
            className={`family ${dragging === family.id ? 'is-dragging' : ''}`}
            draggable={armed === family.id}
            onDragStart={(event) => {
              setDragging(family.id);
              event.dataTransfer.effectAllowed = 'move';
              // Firefox n'amorce pas le glisser sans données transportées.
              event.dataTransfer.setData('text/plain', String(family.id));
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
              aria-label={`Déplacer ${family.label} — flèches haut et bas`}
              title="Glisser pour réordonner (ou flèches haut/bas)"
              onMouseDown={() => setArmed(family.id)}
              onMouseUp={() => setArmed(null)}
              onKeyDown={(event) => nudge(event, family, index)}
            >
              <GripIcon />
            </span>

            <div className="family__body">
              <div className="family__head">
                <EditableText
                  label="le libellé de la famille"
                  className="family__label"
                  value={family.label}
                  placeholder="Sans libellé"
                  onSave={(label) => save(family.slug, { label })}
                />
                <code className="family__slug" title="Identifiant en base et dans les URL">
                  {family.slug}
                </code>
                <span className="family__count">
                  {family.idea_count} idée{family.idea_count > 1 ? 's' : ''}
                </span>
                <button
                  type="button"
                  className="attachment__action attachment__action--danger"
                  onClick={() => remove(family)}
                  title={
                    family.idea_count > 0
                      ? 'Des idées portent encore cette famille'
                      : 'Supprimer la famille'
                  }
                >
                  Supprimer
                </button>
              </div>

              <div className="family__field">
                <span className="family__field-label">Étiquettes store</span>
                <TagPills
                  tags={family.store_tags}
                  onChange={(store_tags) => save(family.slug, { store_tags })}
                />
              </div>

              <div className="family__field">
                <span className="family__field-label">Fonctionnalités</span>
                <div className="family__features">
                  {(FAMILY_FEATURES as FamilyFeature[]).map((feature) => (
                    <label className="family__feature" key={feature}>
                      <input
                        type="checkbox"
                        checked={family.features.includes(feature)}
                        onChange={(event) =>
                          save(family.slug, {
                            features: event.target.checked
                              ? [...family.features, feature]
                              : family.features.filter((item) => item !== feature),
                          })
                        }
                      />
                      <span>{FAMILY_FEATURE_LABELS[feature]}</span>
                    </label>
                  ))}
                  <span className="family__feature-note">
                    Le support manette est sur toutes les fiches.
                  </span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Saisie en pilules : Entrée ajoute, la croix retire. Retour arrière sur un
 * champ vide retire la dernière — le réflexe de tous les champs de ce genre, et
 * son absence se remarque tout de suite.
 */
function TagPills({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');

  function add() {
    const value = draft.trim();
    setDraft('');
    if (!value || tags.includes(value)) return;
    onChange([...tags, value]);
  }

  return (
    <div className="pills">
      {tags.map((tag) => (
        <span className="pill" key={tag}>
          {tag}
          <button
            type="button"
            className="pill__remove"
            aria-label={`Retirer l’étiquette ${tag}`}
            onClick={() => onChange(tags.filter((item) => item !== tag))}
          >
            ×
          </button>
        </span>
      ))}

      <input
        className="pills__input"
        value={draft}
        placeholder="Ajouter une étiquette, puis Entrée"
        aria-label="Ajouter une étiquette"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={add}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            add();
            return;
          }
          if (event.key === 'Backspace' && draft === '' && tags.length) {
            event.preventDefault();
            onChange(tags.slice(0, -1));
          }
        }}
      />
    </div>
  );
}
