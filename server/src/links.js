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
 * retombe sur le nom de domaine.
 */
export async function fetchLinkTitle(value, { timeoutMs = 3000, maxBytes = 65536 } = {}) {
  const url = parseHttpUrl(value);
  if (!url) return null;

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
