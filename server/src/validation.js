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

/**
 * Un validateur de corps utilisable hors du cycle Fastify.
 *
 * `POST /api/ideas/:slug/attachments` accepte deux formats — multipart pour un
 * fichier, JSON pour un lien — sur la même route. Un schéma de corps déclaré à
 * Fastify s'appliquerait aussi aux requêtes multipart, dont le corps n'est pas
 * du JSON : la validation du lien est donc faite dans le handler, mais toujours
 * par schéma, avec le même AJV et les mêmes règles.
 */
export function compileBody(schema) {
  const validate = strict.compile(schema);

  return (data) => {
    if (validate(data)) return null;
    return (validate.errors || [])
      .map((issue) => `body${issue.instancePath || ''} ${issue.message}`)
      .join(' ; ');
  };
}
