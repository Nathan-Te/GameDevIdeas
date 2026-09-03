import Ajv from 'ajv';

/**
 * Deux compilateurs AJV plutôt qu'un seul, parce que les deux moitiés d'une
 * requête n'ont pas les mêmes règles :
 *
 * - la query string et les paramètres d'URL arrivent toujours en texte, donc
 *   `?minScore=3` doit être converti en entier avant validation ;
 * - le corps JSON, lui, est typé à la source : `{"score": "3"}` est une erreur
 *   de l'appelant, pas une chaîne à convertir en douce.
 *
 * `removeAdditional` est désactivé des deux côtés : avec `additionalProperties:
 * false`, la valeur par défaut de Fastify supprimerait silencieusement un champ
 * mal orthographié au lieu de le signaler — un PATCH sur `titre` renverrait 200
 * sans rien changer.
 */
const shared = {
  allErrors: true,
  removeAdditional: false,
  useDefaults: true,
  // Les schémas décrivent des unions comme `['integer', 'null']`, légitimes ici.
  strictTypes: false,
};

const strict = new Ajv({ ...shared, coerceTypes: false });
const coercing = new Ajv({ ...shared, coerceTypes: true });

export function validatorCompiler({ schema, httpPart }) {
  return (httpPart === 'body' ? strict : coercing).compile(schema);
}
