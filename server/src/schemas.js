/**
 * Schémas JSON Fastify pour la validation des entrées.
 *
 * Volontairement : pas de schéma de réponse. Fastify s'en sert pour sérialiser
 * en filtrant les propriétés non déclarées — un champ ajouté au modèle et oublié
 * ici disparaîtrait silencieusement de l'API. La validation porte donc sur ce
 * qui entre ; ce qui sort est construit explicitement par `serializeIdea`.
 */

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
  properties: ideaFields,
};

export const listIdeasQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    family: { type: 'string', enum: FAMILIES },
    status: { type: 'string', enum: STATUSES },
    minScore: { type: 'integer', minimum: 0, maximum: 5 },
    sort: { type: 'string', enum: SORTS, default: 'updated' },
    /** La corbeille arrive au lot 3 ; le filtre existe déjà côté API. */
    deleted: { type: 'boolean', default: false },
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
