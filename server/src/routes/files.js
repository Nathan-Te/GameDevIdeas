import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

import { notFound } from '../errors.js';
import { contentTypeFor, resolveInsideFiles } from '../files.js';

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

    reply
      .header('Cache-Control', CACHE)
      // Les fichiers sont servis depuis l'origine de l'application : on
      // interdit au navigateur de deviner un type plus exécutable que celui-ci.
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename="${basename(absolute).replace(/"/g, '')}"`,
      )
      .header('Content-Length', info.size)
      .type(type);

    return reply.send(createReadStream(absolute));
  });
}
