import { createServer } from 'node:http';

import { markPublicRequest } from './access.js';

/**
 * Le point d'entrée public — le mécanisme sur lequel repose tout le lot 7.
 *
 * Un second serveur HTTP, sur un autre port, qui sert **la même application**
 * mais marque chaque requête comme publique avant de la router. Le marquage est
 * un `Symbol` posé sur l'objet requête de Node : rien qu'un client puisse
 * écrire, rien qu'un proxy amont puisse oublier.
 *
 * C'est le seul critère de classification. La requête est entrée par cette
 * socket-ci ou par celle de Nathan ; il n'y a pas de troisième cas, et personne
 * ne peut mentir dessus. Ni l'adresse source ni un en-tête n'entrent en ligne
 * de compte — voir la note de `classify` dans `access.js` pour ce que ces deux
 * critères ont coûté.
 *
 * Ce module vit à part de `index.js` pour une raison précise : les tests
 * lancent le vrai serveur sur ses deux ports et l'interrogent par le réseau.
 * Un point d'entrée écrit à l'intérieur du script de démarrage n'aurait été
 * éprouvé qu'en production.
 */
export function createPublicEntry(app) {
  return createServer((req, res) => {
    markPublicRequest(req);
    app.routing(req, res);
  });
}

/** `listen` en promesse, pour que l'appelant puisse simplement `await`. */
export function listenPublicEntry(server, { port, host }) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve(server.address());
    });
  });
}
