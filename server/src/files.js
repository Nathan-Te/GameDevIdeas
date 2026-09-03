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

/** Le seed fixe la liste : png, jpg, webp, gif. Le SVG n'en fait pas partie. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

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
 * `image` (png, jpg, webp, gif), `markdown` (.md), sinon `file`. L'extension et
 * le type MIME sont examinés tous les deux : un navigateur peut envoyer
 * `application/octet-stream` pour un PNG parfaitement valide.
 */
export function kindFromFile({ filename = '', mimetype = '' } = {}) {
  const ext = extname(String(filename)).toLowerCase();
  const mime = String(mimetype).split(';')[0].trim().toLowerCase();

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
