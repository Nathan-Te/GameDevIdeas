import { createReadStream, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import {
  backupLock,
  backupPreview,
  createArchive,
  deleteLocalBackup,
  listLocalBackups,
  makeWorkDir,
  removeQuietly,
  restoreArchive,
} from '../backup.js';
import { config } from '../config.js';
import { badRequest, payloadTooLarge } from '../errors.js';
import { sanitizeFilename } from '../files.js';
import { backupNameParams } from '../schemas.js';

/**
 * Sauvegarde et restauration par HTTP. Tout le travail est dans `backup.js` :
 * ces routes ne font que traduire une requête en appel et un résultat en JSON —
 * c'est ce qui permet aux scripts en ligne de commande d'obtenir exactement le
 * même comportement sans repasser par le réseau.
 */
export default async function backupRoutes(app) {
  const multipart = (await import('@fastify/multipart')).default;
  await app.register(multipart, {
    limits: { fileSize: Math.round(config.maxRestoreMb * 1024 * 1024), files: 1 },
  });

  /** Ce que contiendrait l'archive, sans rien produire. */
  app.get('/api/backup/preview', async () =>
    backupPreview({ db: app.db, filesDir: config.filesDir, backupsDir: config.backupsDir }),
  );

  /**
   * Produit l'archive dans un dossier temporaire et la renvoie en flux. Le
   * temporaire est effacé quand le flux se ferme — fin normale, erreur, ou
   * navigateur qui referme l'onglet en cours de téléchargement.
   */
  app.post('/api/backup', async (request, reply) => {
    const release = backupLock.acquire('backup');
    const outDir = await makeWorkDir('download');

    let archive;
    try {
      archive = await createArchive({
        db: app.db,
        filesDir: config.filesDir,
        backupsDir: config.backupsDir,
        outDir,
      });
    } catch (err) {
      release();
      await removeQuietly(outDir);
      throw err;
    }

    const stream = createReadStream(archive.path);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      release();
      void removeQuietly(outDir);
    };
    stream.on('close', cleanup);
    stream.on('error', cleanup);

    return reply
      .code(200)
      .type('application/gzip')
      .header('Content-Disposition', `attachment; filename="${archive.name}"`)
      // Annoncée parce qu'on la connaît : sans elle, le navigateur ne peut pas
      // afficher de progression de téléchargement.
      .header('Content-Length', archive.bytes)
      .header('X-Vitrine-Backup-Name', archive.name)
      .send(stream);
  });

  /**
   * Restauration. L'archive arrive en multipart ; le mode est un champ du même
   * formulaire, lu après coup parce qu'un client peut l'envoyer avant ou après
   * le fichier.
   */
  app.post('/api/restore', async (request) => {
    if (!request.isMultipart()) {
      throw badRequest('La restauration attend un envoi multipart contenant une archive .tgz.');
    }

    const release = backupLock.acquire('restore');
    const work = await makeWorkDir('upload');

    try {
      const { archivePath, mode } = await receiveArchive(request, work);

      return await restoreArchive({
        archivePath,
        mode,
        db: app.db,
        dbPath: config.dbPath,
        filesDir: config.filesDir,
        backupsDir: config.backupsDir,
        logger: app.log,
      });
    } finally {
      release();
      await removeQuietly(work);
    }
  });

  /** Les archives posées sur le serveur : cron, sauvegardes de sécurité. */
  app.get('/api/backups', async () => ({ backups: await listLocalBackups(config.backupsDir) }));

  app.delete('/api/backups/:name', { schema: { params: backupNameParams } }, async (request) =>
    deleteLocalBackup(request.params.name, config.backupsDir),
  );
}

/**
 * Écrit la partie « fichier » sur le disque au fil de l'eau — une archive de
 * plusieurs gigaoctets ne passe jamais par la mémoire — et retient les champs
 * texte au passage.
 */
async function receiveArchive(request, work) {
  let archivePath = null;
  let mode = 'replace';

  for await (const part of request.parts()) {
    if (part.type === 'field') {
      if (part.fieldname === 'mode') mode = String(part.value);
      continue;
    }

    if (archivePath) throw badRequest('Une seule archive à la fois.');

    archivePath = join(work, sanitizeFilename(part.filename) || 'archive.tgz');
    await pipeline(part.file, createWriteStream(archivePath));

    if (part.file.truncated) {
      throw payloadTooLarge(`Archive trop volumineuse : la limite est de ${config.maxRestoreMb} Mo.`);
    }
  }

  if (!archivePath) throw badRequest('Aucune archive dans la requête.');
  return { archivePath, mode };
}
