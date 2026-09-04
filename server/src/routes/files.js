import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

import { notFound } from '../errors.js';
import { contentTypeFor, isSeekable, parseRange, resolveInsideFiles } from '../files.js';

/**
 * Sert `data/files/`.
 *
 * Écrit à la main plutôt que délégué à `@fastify/static` : la garde contre la
 * traversée de chemin est le cœur de cette route, et on la veut lisible et
 * testable ici même. Toute résolution qui sort du dossier des fichiers renvoie
 * 404 — pas 403 : un 403 confirmerait à l'appelant que la cible existe.
 *
 * Les noms stockés contiennent un UUID, donc un chemin ne désigne jamais deux
 * contenus différents : le cache navigateur peut être long et immuable.
 *
 * Depuis le lot 4, la route sait répondre par morceaux (`Range`). Sans ça une
 * bande-annonce `.mp4` ne se lit pas : le navigateur demande les premiers
 * octets pour lire l'entête du conteneur, reçoit le fichier entier en 200, et
 * beaucoup de lecteurs abandonnent — ou refusent de se déplacer dans le flux.
 */
const CACHE = 'public, max-age=31536000, immutable';

export default async function fileRoutes(app) {
  app.get('/files/*', async (request, reply) => {
    const raw = request.params['*'];

    // `%2e%2e` est déjà décodé par le routeur ; une séquence encodée deux fois
    // ne l'est pas, d'où ce second décodage avant la résolution.
    let relative;
    try {
      relative = decodeURIComponent(String(raw ?? ''));
    } catch {
      throw notFound('Fichier introuvable.');
    }

    const absolute = resolveInsideFiles(relative);
    if (!absolute) throw notFound('Fichier introuvable.');

    let info;
    try {
      info = await stat(absolute);
    } catch {
      throw notFound('Fichier introuvable.');
    }

    // Un dossier n'est pas un fichier : pas d'index, pas de listing.
    if (!info.isFile()) throw notFound('Fichier introuvable.');

    const { type, inline } = contentTypeFor(absolute);
    const seekable = inline && isSeekable(absolute);

    reply
      .header('Cache-Control', CACHE)
      // Les fichiers sont servis depuis l'origine de l'application : on
      // interdit au navigateur de deviner un type plus exécutable que celui-ci.
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${basename(absolute).replace(/"/g, '')}"`,
      )
      // Annoncé seulement là où c'est vrai : promettre les plages sur un `.zip`
      // qu'on sert d'un bloc ferait mentir l'en-tête.
      .header('Accept-Ranges', seekable ? 'bytes' : 'none')
      .type(type);

    const range = seekable ? parseRange(request.headers.range, info.size) : null;

    if (range?.unsatisfiable) {
      // 416 : la plage demandée est hors du fichier. `Content-Range: bytes */n`
      // dit au lecteur quelle est la vraie taille, pour qu'il retente juste.
      return reply
        .code(416)
        .header('Content-Range', `bytes */${info.size}`)
        .header('Content-Length', 0)
        .send();
    }

    if (range) {
      const length = range.end - range.start + 1;
      return reply
        .code(206)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`)
        .header('Content-Length', length)
        .send(createReadStream(absolute, { start: range.start, end: range.end }));
    }

    reply.header('Content-Length', info.size);
    return reply.send(createReadStream(absolute));
  });
}
