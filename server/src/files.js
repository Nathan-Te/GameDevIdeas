import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { extname, isAbsolute, resolve, sep } from 'node:path';

import { config } from './config.js';

/**
 * Tout ce qui touche au disque : nettoyage des noms, déduction du `kind`,
 * fabrication du chemin de stockage et garde contre la traversée de chemin.
 *
 * Rappel du seed : les fichiers utilisateur ne vont jamais en base. La table
 * `attachments` ne garde que le chemin relatif à `data/files/`.
 */

/**
 * png, jpg, webp. Le SVG n'en fait pas partie.
 *
 * Le GIF a quitté cette liste au lot 4 : un GIF attaché est une bande-annonce,
 * pas une capture. C'était le constat qui a ouvert le lot — on ne met pas un
 * GIF dans une galerie de captures, on le joue.
 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Ce qui peut servir de bande-annonce : un GIF ou une courte vidéo. */
const TRAILER_EXTENSIONS = new Set(['.gif', '.mp4', '.webm']);
const TRAILER_MIMES = new Set(['image/gif', 'video/mp4', 'video/webm']);

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const MARKDOWN_MIMES = new Set(['text/markdown', 'text/x-markdown']);

/**
 * Types renvoyés tels quels par `/files/*`. Tout le reste part en
 * `application/octet-stream` avec `Content-Disposition: attachment` : les
 * fichiers sont servis depuis la même origine que l'application, un `.html` ou
 * un `.svg` interprété par le navigateur y exécuterait son propre script.
 */
const INLINE_MIMES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

/**
 * Ne garde que `[a-zA-Z0-9._-]`, comme demandé par le lot. Les diacritiques
 * sont dépliés avant d'être retirés — sans ça « pêche.png » deviendrait
 * « p-che.png » alors que « peche.png » se lit encore.
 */
export function sanitizeFilename(name) {
  const cleaned = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    // « Peche-du-dimanche-v2-.PNG » -> « Peche-du-dimanche-v2.PNG ».
    .replace(/-+\./g, '.')
    .replace(/\.-+/g, '.')
    // Un nom commençant par un point serait caché sous Unix ; « .. » serait pire.
    .replace(/^[.\-]+/, '')
    .replace(/[.\-]+$/, '');

  if (!cleaned) return 'fichier';
  return cleaned.length > 120 ? cleaned.slice(-120).replace(/^[.\-]+/, '') || 'fichier' : cleaned;
}

/**
 * `trailer` (gif, mp4, webm), `image` (png, jpg, webp), `markdown` (.md),
 * sinon `file`. L'extension et le type MIME sont examinés tous les deux : un
 * navigateur peut envoyer `application/octet-stream` pour un PNG parfaitement
 * valide.
 *
 * La bande-annonce est testée en premier : `image/gif` est une image pour le
 * navigateur, une bande-annonce pour Vitrine.
 */
export function kindFromFile({ filename = '', mimetype = '' } = {}) {
  const ext = extname(String(filename)).toLowerCase();
  const mime = String(mimetype).split(';')[0].trim().toLowerCase();

  if (TRAILER_EXTENSIONS.has(ext) || TRAILER_MIMES.has(mime)) return 'trailer';
  if (IMAGE_EXTENSIONS.has(ext) || IMAGE_MIMES.has(mime)) return 'image';
  if (MARKDOWN_EXTENSIONS.has(ext) || MARKDOWN_MIMES.has(mime)) return 'markdown';
  return 'file';
}

/**
 * `{idea_id}/{uuid}-{nom-nettoyé}` : l'UUID garantit qu'un second envoi du même
 * nom n'écrase jamais le premier, et rend le chemin unique donc cachable
 * indéfiniment par le navigateur.
 */
export function storedPathFor(ideaId, originalName) {
  return `${ideaId}/${randomUUID()}-${sanitizeFilename(originalName)}`;
}

/** Racine des fichiers utilisateur, résolue une bonne fois. */
export const filesRoot = () => resolve(config.filesDir);

/**
 * Chemin absolu d'un chemin relatif stocké en base, ou `null` s'il sort du
 * dossier des fichiers. C'est la seule porte d'entrée : `/files/*` et la
 * suppression passent par elle.
 *
 * `resolve` neutralise `..` et les chemins absolus — `resolve(root, '/etc/passwd')`
 * ne donne jamais quelque chose sous `root` — et la comparaison finale le
 * vérifie au lieu de le supposer.
 */
export function resolveInsideFiles(relative) {
  const raw = String(relative ?? '');
  if (!raw || raw.includes('\0')) return null;

  const root = filesRoot();
  const target = isAbsolute(raw) ? resolve(raw) : resolve(root, raw);

  if (target !== root && !target.startsWith(root + sep)) return null;

  // Dernier verrou : un lien symbolique déposé dans le volume pourrait pointer
  // ailleurs. Si le chemin n'existe pas encore, il n'y a rien à suivre.
  try {
    const real = realpathSync(target);
    if (real !== root && !real.startsWith(root + sep)) return null;
  } catch {
    /* fichier absent : le 404 sera prononcé par l'appelant */
  }

  return target;
}

/** Adresse publique d'un fichier stocké. Le nom est déjà nettoyé, donc sûr en URL. */
export function fileUrl(relative) {
  if (!relative) return null;
  return `/files/${String(relative).split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Type de contenu à servir, et faut-il forcer le téléchargement. Voir
 * `INLINE_MIMES` : tout ce qui n'est pas explicitement sûr est téléchargé.
 */
export function contentTypeFor(pathname) {
  const ext = extname(pathname).toLowerCase();
  const inline = INLINE_MIMES[ext];
  return inline
    ? { type: inline, inline: true }
    : { type: 'application/octet-stream', inline: false };
}

/**
 * Les types que le navigateur doit pouvoir lire par morceaux : une vidéo ne se
 * lit pas sans requêtes `Range`, et un lecteur qui ne peut pas se déplacer dans
 * le flux affiche un rectangle noir. Le GIF y est aussi — il ne s'en sert pas,
 * mais annoncer `Accept-Ranges` sur tout ce qui est joué évite d'avoir à
 * distinguer les deux ailleurs.
 */
const SEEKABLE = new Set(['.gif', '.mp4', '.webm', '.mp3', '.ogg']);

export function isSeekable(pathname) {
  return SEEKABLE.has(extname(pathname).toLowerCase());
}

/**
 * Analyse un en-tête `Range`. Une seule plage est gérée — c'est tout ce qu'un
 * lecteur vidéo demande — et le reste est traité comme une absence de `Range`,
 * ce que la RFC autorise explicitement.
 *
 * Renvoie `null` quand il n'y a rien à interpréter, `{ unsatisfiable: true }`
 * quand la plage est hors du fichier (416), sinon `{ start, end }` inclusifs.
 */
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? '').trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;

  if (rawStart === '') {
    // `bytes=-500` : les 500 derniers octets.
    const length = Number(rawEnd);
    if (length <= 0) return { unsatisfiable: true };
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start >= size || start > end) return { unsatisfiable: true };

  return { start, end };
}
