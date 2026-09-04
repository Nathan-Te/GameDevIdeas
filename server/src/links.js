import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Liens typés. Le `link_type` pilote l'icône du front ; il est déduit du
 * domaine à la création et reste modifiable par `PATCH` — un lien Notion vers
 * un dépôt Git reste un lien Git aux yeux de Nathan.
 */

export const LINK_TYPES = ['trello', 'asset-store', 'git', 'steam', 'video', 'autre'];

/**
 * Liste du lot, dans l'ordre. `assetstore.unity.com` est un hôte complet et non
 * `unity.com` : la documentation Unity n'est pas l'Asset Store.
 */
const DOMAINS = [
  ['trello.com', 'trello'],
  ['assetstore.unity.com', 'asset-store'],
  ['github.com', 'git'],
  ['gitlab.com', 'git'],
  ['bitbucket.org', 'git'],
  ['store.steampowered.com', 'steam'],
  ['youtube.com', 'video'],
  ['youtu.be', 'video'],
];

/** `null` si l'URL est illisible ou n'est pas en http(s). */
export function parseHttpUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url;
}

/** Nom de domaine sans `www.`, en minuscules. C'est le libellé de repli d'un lien. */
export function hostnameOf(url) {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

/**
 * `m.youtube.com` et `www.youtube.com` sont YouTube : la comparaison accepte
 * l'hôte exact ou n'importe quel sous-domaine.
 */
export function linkTypeFromUrl(value) {
  const url = typeof value === 'string' ? parseHttpUrl(value) : value;
  if (!url) return 'autre';

  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  for (const [domain, type] of DOMAINS) {
    if (host === domain || host.endsWith(`.${domain}`)) return type;
  }

  return 'autre';
}

/** Les quelques entités qu'on croise vraiment dans un `<title>`. */
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'",
};

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name) => {
    const key = name.toLowerCase();
    if (Object.hasOwn(ENTITIES, key)) return ENTITIES[key];
    if (key.startsWith('#x')) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)));
    return match;
  });
}

/**
 * Titre de la page visée, ou `null`. Trois secondes maximum et 64 Ko lus au
 * plus : le libellé par défaut d'un lien ne vaut pas de bloquer une requête.
 *
 * Toute erreur — DNS, TLS, 404, HTML sans titre — donne `null`, et l'appelant
 * retombe sur le nom de domaine. Une cible privée ou locale aussi, et sans
 * qu'aucune requête ne parte (voir `isPrivateTarget`).
 */
export async function fetchLinkTitle(
  value,
  { timeoutMs = 3000, maxBytes = 65536, allowPrivateHosts = false } = {},
) {
  const url = parseHttpUrl(value);
  if (!url) return null;

  // Règle du projet : le lookup ne contacte jamais une adresse privée ou
  // locale. `allowPrivateHosts` n'existe que pour les tests, qui montent un
  // serveur HTTP sur `127.0.0.1` pour vérifier la lecture du `<title>`.
  if (!allowPrivateHosts && (await isPrivateTarget(url))) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Vitrine/1.0' },
    });

    if (!response.ok || !response.body) return null;
    if (!/text\/html|application\/xhtml/i.test(response.headers.get('content-type') ?? '')) {
      return null;
    }

    const decoder = new TextDecoder('utf-8');
    let html = '';
    for await (const chunk of response.body) {
      html += decoder.decode(chunk, { stream: true });
      // Le `<title>` est dans le `<head>` : inutile de lire la page entière.
      if (html.length >= maxBytes || /<\/title>/i.test(html)) break;
    }

    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (!match) return null;

    const title = decodeEntities(match[1]).replace(/\s+/g, ' ').trim();
    return title ? title.slice(0, 300) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    // La lecture s'arrête souvent avant la fin du corps : on coupe la connexion.
    controller.abort();
  }
}

// --- Adresses privées et locales ---------------------------------------------

/**
 * Le lookup de titre fait partir une requête vers un domaine que Nathan colle.
 * Sans garde, coller `http://192.168.1.1/reboot` ferait appeler ça au serveur,
 * depuis l'intérieur du réseau — c'est le point 3 laissé ouvert au lot 2.
 *
 * La règle du projet : le lookup ne contacte jamais une adresse privée ou
 * locale. Le nom est examiné, puis résolu ; à la moindre adresse privée, la
 * requête ne part pas et le libellé retombe sur le domaine.
 */

/**
 * Suffixes qui ne sortent jamais d'une machine ou d'un réseau local. `.local`
 * est le mDNS, `.internal` et `.home.arpa` sont les noms de réseau privé
 * réservés par l'IANA.
 */
const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'home.arpa'];

/** Un nom d'hôte IPv6 sort d'une URL entre crochets, avec parfois un `%zone`. */
function bareHostname(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  return host.split('%')[0];
}

/** `10.0.0.1` -> 0x0A000001. Suppose une adresse IPv4 déjà validée. */
function ipv4Number(address) {
  return address.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

function isPrivateIpv4Number(value) {
  const inRange = (prefix, bits) => value >>> (32 - bits) === ipv4Number(prefix) >>> (32 - bits);

  return (
    inRange('0.0.0.0', 8) ||        // « cet hôte »
    inRange('10.0.0.0', 8) ||       // RFC 1918
    inRange('127.0.0.0', 8) ||      // loopback
    inRange('169.254.0.0', 16) ||   // link-local
    inRange('172.16.0.0', 12) ||    // RFC 1918
    inRange('192.168.0.0', 16) ||   // RFC 1918
    inRange('100.64.0.0', 10) ||    // CGNAT
    inRange('192.0.0.0', 24) ||     // protocoles IETF
    inRange('198.18.0.0', 15) ||    // bancs de test
    value >>> 28 >= 0xe               // multicast et réservé (224.0.0.0/3)
  );
}

/**
 * Les huit groupes d'une IPv6, `::` déplié et queue IPv4 comprise, ou `null`.
 * L'adresse est supposée déjà validée par `isIP`.
 */
function ipv6Groups(address) {
  let text = address;

  // `::ffff:1.2.3.4` : la queue IPv4 devient deux groupes hexadécimaux.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (isIP(tail) !== 4) return null;
    const value = ipv4Number(tail);
    const hex = (n) => n.toString(16);
    text = `${text.slice(0, lastColon + 1)}${hex(value >>> 16)}:${hex(value & 0xffff)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];

  if (halves.length === 1) {
    return head.length === 8 ? head.map((group) => Number.parseInt(group, 16)) : null;
  }

  const fill = 8 - head.length - rest.length;
  if (fill < 0) return null;

  return [...head, ...Array(fill).fill('0'), ...rest].map((group) => Number.parseInt(group, 16));
}

function isPrivateIpv6(address) {
  const g = ipv6Groups(address);
  if (!g) return true; // illisible : on refuse plutôt que de deviner.

  // `::` (non spécifiée) et `::1` (loopback).
  if (g.slice(0, 7).every((group) => group === 0)) return true;
  // fc00::/7 (unique local) et fe80::/10 (link-local).
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  // ::ffff:a.b.c.d — une IPv4 déguisée reste une IPv4.
  if (g.slice(0, 5).every((group) => group === 0) && g[5] === 0xffff) {
    return isPrivateIpv4Number((g[6] << 16) | g[7]);
  }

  return false;
}

/** `true` si l'adresse littérale est privée, locale ou réservée. */
export function isPrivateAddress(address) {
  const host = bareHostname(address);
  const version = isIP(host);
  if (version === 4) return isPrivateIpv4Number(ipv4Number(host));
  if (version === 6) return isPrivateIpv6(host);
  return false;
}

/** `true` si le nom lui-même désigne la machine ou un réseau local, sans DNS. */
export function isLocalHostname(hostname) {
  const host = bareHostname(hostname);
  if (!host) return true;
  if (isIP(host)) return isPrivateAddress(host);
  return LOCAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * `true` si la cible est privée ou locale — nom réservé, adresse littérale
 * privée, ou nom qui *résout* vers une adresse privée. Un nom public pointant
 * sur `127.0.0.1` est un classique ; il est refusé comme les autres.
 *
 * Une résolution qui échoue est refusée aussi : la requête échouerait de toute
 * façon, autant ne pas la lancer.
 */
export async function isPrivateTarget(url) {
  const host = bareHostname(typeof url === 'string' ? url : url.hostname);

  if (isIP(host)) return isPrivateAddress(host);
  if (isLocalHostname(host)) return true;

  try {
    const addresses = await lookup(host, { all: true });
    if (!addresses.length) return true;
    return addresses.some((entry) => isPrivateAddress(entry.address));
  } catch {
    return true;
  }
}
