/**
 * Schémas JSON Fastify pour la validation des entrées.
 *
 * Volontairement : pas de schéma de réponse. Fastify s'en sert pour sérialiser
 * en filtrant les propriétés non déclarées — un champ ajouté au modèle et oublié
 * ici disparaîtrait silencieusement de l'API. La validation porte donc sur ce
 * qui entre ; ce qui sort est construit explicitement par `serializeIdea`.
 */

import { LINK_TYPES } from './links.js';

export { LINK_TYPES };

/** Énumération suggérée par le seed. `family` reste libre côté base. */
export const FAMILIES = [
  'friendslop',
  'dopamine-solo',
  'sim-fantasme',
  'inspection',
  'tactique',
  'party',
  'coop-2',
  'fps',
  'educatif',
  'autre',
];

export const STATUSES = [
  'idee',
  'reserve',
  'prototype',
  'en-cours',
  'pause',
  'abandonne',
  'publie',
];

export const SORTS = ['updated', 'created', 'score', 'title'];

const text = (maxLength) => ({ type: 'string', maxLength });

/** Champs de l'idée modifiables par l'API, avec leurs contraintes. */
const ideaFields = {
  slug: { type: 'string', minLength: 1, maxLength: 100 },
  title: text(200),
  tagline: text(300),
  pitch: text(4000),
  gif: text(2000),
  price_cents: { type: ['integer', 'null'], minimum: 0, maximum: 100000000 },
  family: { type: 'string', enum: FAMILIES },
  status: { type: 'string', enum: STATUSES },
  competition: text(4000),
};

export const ideaSlugParams = {
  type: 'object',
  required: ['slug'],
  properties: { slug: { type: 'string', minLength: 1, maxLength: 100 } },
};

export const createIdeaBody = {
  type: 'object',
  additionalProperties: false,
  properties: ideaFields,
};

export const patchIdeaBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    ...ideaFields,
    /**
     * Absent de `createIdeaBody` : une idée qui n'existe pas encore ne peut pas
     * avoir de pièce jointe, donc pas de capsule. `null` retire la capsule ;
     * sinon la pièce doit être une image de cette idée (vérifié dans le dépôt).
     */
    capsule_file_id: { type: ['integer', 'null'], minimum: 1 },
    /**
     * Absent de `createIdeaBody` aussi : on ne met pas en liste de souhaits une
     * idée qu'on vient d'écrire, on l'y met après l'avoir regardée. Booléen à
     * l'entrée, date en base (`wishlisted_at`).
     */
    wishlisted: { type: 'boolean' },
  },
};

export const listIdeasQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    family: { type: 'string', enum: FAMILIES },
    status: { type: 'string', enum: STATUSES },
    minScore: { type: 'integer', minimum: 0, maximum: 5 },
    /** Absent = tout ; `true` = la liste de souhaits ; `false` = le reste. */
    wishlisted: { type: 'boolean' },
    sort: { type: 'string', enum: SORTS, default: 'updated' },
    /** La corbeille arrive au lot 3 ; le filtre existe déjà côté API. */
    deleted: { type: 'boolean', default: false },
  },
};

/** Corps JSON d'un lien. Un fichier arrive en multipart, sans schéma JSON. */
export const createLinkBody = {
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: { type: 'string', minLength: 1, maxLength: 2000 },
    label: text(300),
  },
};

export const attachmentIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
};

export const patchAttachmentBody = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    label: text(300),
    /** Rang dans la liste, borné à la taille de la liste par le dépôt. */
    position: { type: 'integer', minimum: 0, maximum: 10000 },
    link_type: { type: 'string', enum: LINK_TYPES },
  },
};

export const reorderAttachmentsBody = {
  type: 'object',
  additionalProperties: false,
  required: ['ids'],
  properties: {
    ids: {
      type: 'array',
      items: { type: 'integer', minimum: 1 },
      maxItems: 1000,
    },
  },
};

export const createVerdictBody = {
  type: 'object',
  additionalProperties: false,
  required: ['score'],
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 5 },
    note: text(4000),
  },
};
