import {
  countIdeasByFamily,
  createFamily,
  deleteFamily,
  listFamilies,
  updateFamily,
} from '../families-repo.js';
import { createFamilyBody, familySlugParams, patchFamilyBody } from '../schemas.js';

/**
 * Les familles. Depuis le lot 4 elles sont des données, pas une énumération du
 * code : c'est cette route que l'écran `/familles` sert, et c'est elle qui
 * fournit au catalogue et à la page idée la liste de leur sélecteur.
 *
 * La liste est servie avec le nombre d'idées de chaque famille : l'écran
 * d'édition annonce ainsi ce qu'une suppression va refuser, avant l'essai.
 */
export default async function familyRoutes(app) {
  const { db } = app;

  app.get('/api/families', async () => {
    const counts = countIdeasByFamily(db);
    return {
      families: listFamilies(db).map((family) => ({
        ...family,
        idea_count: counts[family.slug] ?? 0,
      })),
    };
  });

  app.post('/api/families', { schema: { body: createFamilyBody } }, async (request, reply) => {
    const family = createFamily(db, request.body ?? {});
    reply.code(201);
    return { ...family, idea_count: 0 };
  });

  app.patch(
    '/api/families/:slug',
    { schema: { params: familySlugParams, body: patchFamilyBody } },
    async (request) => {
      const family = updateFamily(db, request.params.slug, request.body);
      const counts = countIdeasByFamily(db);
      return { ...family, idea_count: counts[family.slug] ?? 0 };
    },
  );

  /**
   * Suppression refusée en 409 tant qu'une idée porte la famille — le message
   * dit combien. Une suppression en cascade laisserait des idées sans
   * étiquettes ni fonctionnalités, sans que rien ne le signale.
   */
  app.delete('/api/families/:slug', { schema: { params: familySlugParams } }, async (request) =>
    deleteFamily(db, request.params.slug),
  );
}
