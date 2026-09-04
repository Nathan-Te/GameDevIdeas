import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  createAttachment,
  deleteAttachment,
  listAttachments,
  reorderAttachments,
  updateAttachment,
} from '../attachments-repo.js';
import { config } from '../config.js';
import { badRequest, payloadTooLarge } from '../errors.js';
import { kindFromFile, resolveInsideFiles, storedPathFor } from '../files.js';
import { getIdeaBySlugOrFail } from '../ideas-repo.js';
import { fetchLinkTitle, hostnameOf, linkTypeFromUrl, parseHttpUrl } from '../links.js';
import {
  attachmentIdParams,
  createLinkBody,
  ideaSlugParams,
  patchAttachmentBody,
  reorderAttachmentsBody,
} from '../schemas.js';
import { compileBody } from '../validation.js';

const validateLink = compileBody(createLinkBody);

/** Codes par lesquels `@fastify/multipart` signale un dépassement de taille. */
const TOO_LARGE_CODES = new Set(['FST_REQ_FILE_TOO_LARGE', 'FST_PARTS_LIMIT']);

/**
 * Deux limites, pas une : une bande-annonce de vingt secondes pèse plus qu'une
 * capture, et refuser un `.mp4` parce qu'il dépasse la limite d'une image
 * n'aurait aucun sens. `MAX_TRAILER_MB` vaut pour les `trailer`,
 * `MAX_UPLOAD_MB` pour tout le reste.
 */
const limitMbFor = (kind) => (kind === 'trailer' ? config.maxTrailerMb : config.maxUploadMb);

/**
 * La limite déclarée à `@fastify/multipart` est la plus haute des deux : elle
 * ne sait pas quel `kind` arrive avant d'avoir lu le nom du fichier. La limite
 * fine est appliquée après écriture, à la taille réelle — le fichier refusé est
 * effacé comme tous ceux de la requête.
 */
const hardLimitMb = () => Math.max(config.maxUploadMb, config.maxTrailerMb);

const tooLarge = (limitMb = hardLimitMb()) =>
  payloadTooLarge(`Fichier trop volumineux : la limite est de ${limitMb} Mo.`);

export default async function attachmentRoutes(app) {
  const { db } = app;

  const multipart = (await import('@fastify/multipart')).default;
  await app.register(multipart, {
    limits: { fileSize: Math.round(hardLimitMb() * 1024 * 1024) },
  });

  app.get('/api/ideas/:slug/attachments', { schema: { params: ideaSlugParams } }, async (request) => {
    const idea = getIdeaBySlugOrFail(db, request.params.slug);
    return { attachments: listAttachments(db, idea.id) };
  });

  /**
   * Une seule route pour deux formats, comme le veut le lot : multipart pour un
   * ou plusieurs fichiers, JSON `{ url, label? }` pour un lien.
   *
   * Le corps JSON est validé dans le handler et non par un schéma déclaré à
   * Fastify : ce schéma s'appliquerait aussi aux requêtes multipart, dont le
   * corps n'est pas du JSON (voir `compileBody` dans `validation.js`).
   *
   * La réponse a la même forme dans les deux cas, `{ attachments: [...] }` :
   * un envoi multipart peut porter plusieurs fichiers, et une route qui change
   * la forme de sa réponse selon son entrée est un piège pour l'appelant.
   */
  app.post(
    '/api/ideas/:slug/attachments',
    { schema: { params: ideaSlugParams } },
    async (request, reply) => {
      const idea = getIdeaBySlugOrFail(db, request.params.slug);

      const attachments = request.isMultipart()
        ? await storeUploadedFiles(db, idea.id, request)
        : [await createLink(db, idea.id, request.body)];

      reply.code(201);
      return { attachments };
    },
  );

  app.patch(
    '/api/attachments/:id',
    { schema: { params: attachmentIdParams, body: patchAttachmentBody } },
    async (request) => updateAttachment(db, request.params.id, request.body),
  );

  /**
   * La ligne part d'abord, le fichier ensuite. Une ligne qui pointe sur un
   * fichier absent casse un affichage ; un fichier orphelin ne se voit pas.
   * `ideas.capsule_file_id` et `ideas.trailer_file_id` reviennent à `null` par
   * leur clé étrangère (`ON DELETE SET NULL`, `001-init.sql` et `005`).
   */
  app.delete('/api/attachments/:id', { schema: { params: attachmentIdParams } }, async (request) => {
    const removed = deleteAttachment(db, request.params.id);

    if (removed.path) {
      const absolute = resolveInsideFiles(removed.path);
      if (absolute) await rm(absolute, { force: true });
    }

    return removed;
  });

  app.put(
    '/api/ideas/:slug/attachments/order',
    { schema: { params: ideaSlugParams, body: reorderAttachmentsBody } },
    async (request) => {
      const idea = getIdeaBySlugOrFail(db, request.params.slug);
      return { attachments: reorderAttachments(db, idea.id, request.body.ids) };
    },
  );
}

/**
 * Écrit chaque partie « fichier » sur le disque, puis enregistre sa ligne.
 *
 * Le flux est écrit au fil de l'eau : un fichier de 50 Mo ne passe jamais en
 * entier par la mémoire. Si une partie dépasse la limite ou si l'écriture
 * échoue, tout ce que la requête a déjà écrit est effacé — on ne laisse pas la
 * moitié d'un envoi multiple sur le disque.
 */
async function storeUploadedFiles(db, ideaId, request) {
  /** Chemins absolus écrits par cette requête, pour pouvoir tout défaire. */
  const written = [];
  const created = [];

  try {
    for await (const part of request.parts()) {
      if (part.type !== 'file') continue;

      const relative = storedPathFor(ideaId, part.filename);
      const absolute = resolveInsideFiles(relative);
      if (!absolute) throw badRequest('Nom de fichier inutilisable.');

      await mkdir(dirname(absolute), { recursive: true });

      // Enregistré avant l'écriture : si le flux casse en cours de route, le
      // fichier partiel doit quand même être nettoyé.
      written.push(absolute);
      await pipeline(part.file, createWriteStream(absolute));

      // Filet : selon les versions, la troncature est signalée par ce drapeau
      // au lieu d'une erreur du flux.
      if (part.file.truncated) throw tooLarge();

      const { size } = await stat(absolute);

      const kind = kindFromFile(part);
      const limitMb = limitMbFor(kind);
      if (size > limitMb * 1024 * 1024) throw tooLarge(limitMb);

      created.push(
        createAttachment(db, ideaId, {
          kind,
          label: part.filename ?? '',
          path: relative,
          size_bytes: size,
        }),
      );
    }
  } catch (err) {
    await Promise.all(written.map((file) => rm(file, { force: true })));
    for (const attachment of created) deleteAttachment(db, attachment.id);
    if (TOO_LARGE_CODES.has(err?.code)) throw tooLarge();
    throw err;
  }

  if (!created.length) throw badRequest('Aucun fichier dans la requête multipart.');

  return created;
}

/**
 * Crée un lien. Le `link_type` vient du domaine ; le libellé par défaut est le
 * titre de la page si elle répond en moins de trois secondes, sinon le nom de
 * domaine.
 */
async function createLink(db, ideaId, body) {
  const message = validateLink(body);
  if (message) throw badRequest(message);

  const url = parseHttpUrl(body.url);
  if (!url) throw badRequest('Un lien doit être une URL http(s) valide.');

  const label = body.label || (await defaultLinkLabel(url));

  return createAttachment(db, ideaId, {
    kind: 'link',
    label,
    url: url.toString(),
    link_type: linkTypeFromUrl(url),
  });
}

async function defaultLinkLabel(url) {
  const title = config.linkTitleLookup ? await fetchLinkTitle(url) : null;
  return title ?? hostnameOf(url);
}
