/**
 * La porte. Ce fichier est le point sur lequel repose tout le lot 7 : à partir
 * de lui, l'application n'est plus seulement joignable par le réseau Tailscale
 * de Nathan, mais aussi par n'importe qui ayant l'URL publique.
 *
 * Deux idées, et rien d'autre :
 *
 * 1. **La séparation se fait par route, côté serveur.** Jamais par l'interface.
 *    Une vue cachée n'est pas une protection : la route l'est.
 * 2. **Liste blanche, jamais liste noire.** Un visiteur `guest` n'atteint que
 *    les routes énumérées ici. Toute route ajoutée demain lui est fermée sans
 *    que personne ait à y penser — et fermée veut dire **404**, pas 403 : un
 *    403 confirmerait que la route existe.
 */

import { createHash, randomBytes } from 'node:crypto';

export const OWNER = 'owner';
export const GUEST = 'guest';

/**
 * Le marqueur du point d'entrée public.
 *
 * Un `Symbol` posé sur l'objet requête de Node par le serveur qui écoute sur
 * `PUBLIC_PORT` (`public-entry.js`), avant même que Fastify ne voie la requête.
 * Ce n'est ni un en-tête, ni une adresse : c'est une propriété d'un objet du
 * processus, qu'aucun client ne peut écrire — il n'existe aucun octet à envoyer
 * sur le réseau qui la produise.
 *
 * **C'est le seul critère de classification, et il n'y en aura pas d'autre.**
 * Le lot 7 en a d'abord eu trois — le port, l'adresse source, un en-tête de
 * Tailscale — et les deux derniers ont été retirés au premier contact avec la
 * production. Voir la note de `classify`.
 */
export const PUBLIC_ENTRY = Symbol.for('vitrine.public-entry');

/** Appelé par le point d'entrée public, une fois par requête, avant le routage. */
export function markPublicRequest(req) {
  req[PUBLIC_ENTRY] = true;
}

/**
 * Classe une requête : `guest` si elle est entrée par le point d'entrée public,
 * `owner` sinon. Rien d'autre n'est regardé.
 *
 * **Pourquoi ni l'adresse, ni un en-tête.** Les deux ont été essayés et les deux
 * sont faux :
 *
 * - **L'adresse source ment dès qu'il y a un intermédiaire, et il y en a
 *   toujours un.** Derrière Tailscale Funnel, `tailscaled` termine TLS puis
 *   proxifie vers la cible locale : tout le trafic public se présente depuis la
 *   machine elle-même. En conteneur Docker, c'est l'inverse et c'est pire —
 *   toutes les requêtes, y compris celles de Nathan sur son propre port,
 *   arrivent par la passerelle du réseau bridge (`172.x.0.1`), donc d'une
 *   adresse qui n'est ni la boucle locale ni le tailnet. Une classification par
 *   IP y répondait 404 à Nathan sur son propre port. C'est arrivé en
 *   production.
 * - **Un en-tête est une promesse d'un composant qu'on ne contrôle pas.** Qu'il
 *   soit posé par un proxy amont ou par l'appelant, rien dans la requête ne
 *   permet de faire la différence. Un en-tête peut disparaître d'une version à
 *   l'autre du proxy, et l'instance s'ouvre alors en silence.
 *
 * Le port d'écoute, lui, est un fait de transport : la requête est entrée par
 * une socket ou par l'autre, il n'y a pas de troisième possibilité et personne
 * ne peut mentir dessus.
 */
export function classify(request) {
  const raw = request?.raw ?? request;
  return raw?.[PUBLIC_ENTRY] === true ? GUEST : OWNER;
}

/**
 * Les routes ouvertes au visiteur, et rien d'autre. L'ordre n'a pas
 * d'importance : c'est une union, pas une cascade.
 */
const GUEST_API = [
  // La sélection et ses idées, en lecture.
  { method: 'GET', pattern: /^\/api\/share\/[^/]+$/ },
  // Une idée de cette sélection.
  { method: 'GET', pattern: /^\/api\/share\/[^/]+\/ideas\/[^/]+$/ },
  // Déposer — ou corriger — un avis.
  { method: 'POST', pattern: /^\/api\/share\/[^/]+\/reviews$/ },
  // Basculer sa propre mise en liste de souhaits.
  { method: 'POST', pattern: /^\/api\/share\/[^/]+\/wishlist$/ },
];

/**
 * Les fichiers utilisateur. La route est ouverte ici, mais elle **re-filtre**
 * chez elle : un visiteur ne reçoit que les pièces jointes des idées d'une
 * sélection vivante (voir `guestCanReadFile`).
 */
const GUEST_FILES = /^\/files\/.+$/;

/** Le préfixe des pages invité. Le repli SPA ne s'ouvre à lui, et à personne d'autre. */
const GUEST_PAGES = /^\/p\/[^/]+(\/.*)?$/;

/**
 * Les fichiers du front : `/assets/index-a1b2.js`, `/favicon.ico`… Reconnus à
 * leur extension. Sans eux la page invité n'a ni script ni feuille de style ;
 * avec cette règle et rien de plus, l'application de Nathan — `/`, `/idees/…`,
 * `/sauvegarde` — n'existe pas pour un visiteur, pas même sa coquille HTML.
 */
const STATIC_ASSET = /\.[a-z0-9]{1,8}$/i;

export function isGuestAllowed(method, pathname) {
  const readable = method === 'GET' || method === 'HEAD';

  if (pathname.startsWith('/api/')) {
    return GUEST_API.some(
      (route) =>
        methodMatches(route, method, readable) && route.pattern.test(pathname),
    );
  }

  if (pathname.startsWith('/files/')) return readable && GUEST_FILES.test(pathname);

  return readable && (GUEST_PAGES.test(pathname) || STATIC_ASSET.test(pathname));
}

/** `HEAD` suit `GET` — Fastify les déclare ensemble, la liste blanche aussi. */
function methodMatches(route, method, readable) {
  return route.method === 'GET' ? readable : route.method === method;
}

/**
 * Le hachage d'adresse : SHA-256 de l'adresse source et d'un sel du serveur.
 *
 * Le sel évite qu'un hachage soit une adresse déguisée — l'espace des adresses
 * IPv4 se parcourt en quelques secondes sans lui. Il se pose par
 * `IP_HASH_SALT` ; sans variable, il est tiré au démarrage, et les hachages ne
 * se comparent alors plus d'un redémarrage à l'autre. C'est sans conséquence
 * pour le débit, qui compte en mémoire, et sans conséquence tout court pour le
 * reste : ce hachage n'est jamais affiché ni servi.
 */
export function makeIpHasher(salt = process.env.IP_HASH_SALT || randomBytes(32).toString('hex')) {
  return (address) =>
    createHash('sha256').update(`${salt}:${String(address ?? '')}`).digest('hex');
}

/**
 * Branche la porte sur l'application. Ce hook est enregistré **avant toute
 * route** : les hooks `onRequest` s'exécutent dans l'ordre d'enregistrement, et
 * celui-ci doit passer le premier.
 */
export function registerAccessControl(app) {
  app.decorateRequest('access', null);
  app.decorate('ipHash', makeIpHasher());

  app.addHook('onRequest', async (request, reply) => {
    request.access = classify(request);

    // Aucune page de Vitrine n'a sa place dans un moteur de recherche, et une
    // page de sélection encore moins que les autres.
    reply.header('X-Robots-Tag', 'noindex, nofollow');

    if (request.access === OWNER) return;

    const pathname = request.url.split('?')[0];
    if (isGuestAllowed(request.method, pathname)) return;

    /**
     * Exactement le 404 de `app.js`, mot pour mot : une route fermée doit être
     * indiscernable d'une route inexistante.
     */
    reply.code(404).send({
      error: 'not_found',
      message: `Route inconnue : ${request.method} ${request.url}`,
    });
  });
}
