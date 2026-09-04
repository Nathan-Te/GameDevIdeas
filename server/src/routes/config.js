import { config } from '../config.js';

/**
 * La configuration que le front a besoin de connaître. Une seule valeur pour
 * l'instant : le nom du développeur affiché par la vue store.
 *
 * Elle passe par l'API plutôt que par une variable de build : le conteneur est
 * construit une fois et se configure par son environnement, comme le reste.
 */
export default async function configRoutes(app) {
  app.get('/api/config', async () => ({ developer_name: config.developerName }));
}
