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
 * L'en-tête que pose le point d'entrée public. Il n'existe que dans un sens :
 * il peut **abaisser** une requête en `guest`, jamais l'élever en `owner`. Un
 * visiteur qui le poserait lui-même ne gagnerait donc rien — il se fermerait
 * les portes qu'il a déjà fermées.
 */
const PUBLIC_HEADER = 'x-vitrine-public';

/**
 * Tailscale marque les requêtes venues de Funnel avec cet en-tête. On l'honore
 * — c'est un signal de plus dans le bon sens — mais **on ne s'y fie jamais
 * seul** : le mécanisme sur lequel repose la séparation est le port d'écoute
 * distinct (voir `Docs/exposition-publique.md`), parce qu'un en-tête est une
 * promesse et un port est un fait.
 */
const FUNNEL_HEADER = 'tailscale-funnel-request';

/** `100.64.0.0/10` : la plage du tailnet, celle des adresses `tailscale ip`. */
const TAILNET_V4 = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;
/** `fd7a:115c:a1e0::/48` : la même chose en IPv6. */
const TAILNET_V6 = /^fd7a:115c:a1e0:/i;

function isPrivateAddress(address) {
  if (!address) return false;
  // `::ffff:127.0.0.1` : une adresse v4 vue par une pile v6.
  const ip = address.replace(/^::ffff:/i, '').toLowerCase();

  if (ip === '::1' || ip === '127.0.0.1' || /^127\./.test(ip)) return true;
  return TAILNET_V4.test(ip) || TAILNET_V6.test(ip);
}

/**
 * Classe une requête. `guest` est le défaut : tout ce qui n'est pas
 * démontrablement Nathan est un visiteur.
 *
 * L'adresse lue est celle de la **socket**, jamais `X-Forwarded-For` : un
 * en-tête d'adresse est écrit par l'appelant, donc un visiteur pourrait s'y
 * déclarer sur le tailnet. C'est aussi la raison pour laquelle Fastify tourne
 * sans `trustProxy`.
 */
export function classify(request) {
  if (request.headers[PUBLIC_HEADER] !== undefined) return GUEST;
  if (request.headers[FUNNEL_HEADER] !== undefined) return GUEST;
  return isPrivateAddress(request.socket?.remoteAddress) ? OWNER : GUEST;
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
