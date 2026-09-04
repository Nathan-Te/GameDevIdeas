import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

/**
 * La bande-annonce : un `kind` de pièce jointe à part, sa propre limite de
 * taille, et une référence sur l'idée.
 *
 * `config` lit l'environnement à l'import, d'où les imports dynamiques et le
 * dossier temporaire posé avant. `MAX_TRAILER_MB` est mis à une valeur minuscule
 * pour que le refus se teste sans écrire cent mégaoctets sur le disque —
 * `node --test` donne un processus par fichier, l'environnement ne fuit pas.
 */
const filesDir = mkdtempSync(join(tmpdir(), 'vitrine-trailer-'));

process.env.DATA_FILES_DIR = filesDir;
process.env.MAX_TRAILER_MB = '0.01'; // ~10 ko
process.env.MAX_UPLOAD_MB = '0.02'; // ~20 ko

const { get, makeApp, patch, post, seedIdea } = await import('./helpers.js');

test.after(() => rmSync(filesDir, { recursive: true, force: true }));

/** Un envoi multipart minimal, écrit à la main : pas de dépendance pour ça. */
function multipart(files) {
  const boundary = '----vitrine-test-boundary';
  const parts = files.map(({ filename, type, body }) =>
    Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `Content-Type: ${type}\r\n\r\n`,
      ),
      Buffer.isBuffer(body) ? body : Buffer.from(body),
      Buffer.from('\r\n'),
    ]),
  );

  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]),
  };
}

async function upload(app, slug, files) {
  const { headers, payload } = multipart(files);
  const res = await app.inject({
    method: 'POST',
    url: `/api/ideas/${slug}/attachments`,
    headers,
    payload,
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

test('un .gif, un .mp4 et un .webm arrivent en pièces « trailer »', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Bande-annonce' });

  const res = await upload(app, idea.slug, [
    { filename: 'moment.gif', type: 'image/gif', body: 'GIF89a' },
    { filename: 'teaser.mp4', type: 'video/mp4', body: 'mp4' },
    { filename: 'teaser.webm', type: 'video/webm', body: 'webm' },
    // Le type MIME seul suffit : un navigateur peut envoyer octet-stream.
    { filename: 'sans-type.webm', type: 'application/octet-stream', body: 'webm' },
  ]);

  assert.equal(res.status, 201);
  assert.deepEqual(
    res.body.attachments.map((item) => item.kind),
    ['trailer', 'trailer', 'trailer', 'trailer'],
  );
});

test('un GIF n’est plus une image : il quitte la galerie de captures', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Captures' });

  const res = await upload(app, idea.slug, [
    { filename: 'capture.png', type: 'image/png', body: 'png' },
    { filename: 'moment.gif', type: 'image/gif', body: 'GIF89a' },
  ]);

  assert.deepEqual(
    res.body.attachments.map((item) => item.kind),
    ['image', 'trailer'],
  );
});

test('la bande-annonce a sa propre limite de taille, plus haute que les autres', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Trop lourd' });

  // 15 ko : au-dessus de MAX_TRAILER_MB (10 ko), en dessous de MAX_UPLOAD_MB (20 ko).
  const heavy = Buffer.alloc(15 * 1024, 0x61);

  const refused = await upload(app, idea.slug, [
    { filename: 'longue.mp4', type: 'video/mp4', body: heavy },
  ]);
  assert.equal(refused.status, 413);
  assert.equal(refused.body.error, 'payload_too_large');
  assert.match(refused.body.message, /0\.01 Mo/, 'le message cite la limite de la bande-annonce');

  // Le même poids passe pour une capture : les deux limites sont bien distinctes.
  const accepted = await upload(app, idea.slug, [
    { filename: 'capture.png', type: 'image/png', body: heavy },
  ]);
  assert.equal(accepted.status, 201);

  // Et rien du fichier refusé n'est resté : ni ligne, ni pièce fantôme.
  const list = await get(app, `/api/ideas/${idea.slug}/attachments`);
  assert.deepEqual(
    list.body.attachments.map((item) => item.label),
    ['capture.png'],
  );
});

test('trailer_file_id n’accepte qu’une bande-annonce de cette idée', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'La mienne' });
  const other = await seedIdea(app, { title: 'La voisine' });

  const mine = await upload(app, idea.slug, [
    { filename: 'moment.gif', type: 'image/gif', body: 'GIF89a' },
    { filename: 'capture.png', type: 'image/png', body: 'png' },
  ]);
  const [trailer, shot] = mine.body.attachments;

  const neighbour = await upload(app, other.slug, [
    { filename: 'ailleurs.mp4', type: 'video/mp4', body: 'mp4' },
  ]);

  const wrongKind = await patch(app, `/api/ideas/${idea.slug}`, { trailer_file_id: shot.id });
  assert.equal(wrongKind.status, 400);
  assert.match(wrongKind.body.message, /GIF|vidéo/i);

  const wrongIdea = await patch(app, `/api/ideas/${idea.slug}`, {
    trailer_file_id: neighbour.body.attachments[0].id,
  });
  assert.equal(wrongIdea.status, 400);

  const ok = await patch(app, `/api/ideas/${idea.slug}`, { trailer_file_id: trailer.id });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.trailer_file_id, trailer.id);
  assert.match(ok.body.trailer_url, /^\/files\//);
});

test('la bande-annonce se retire, et se libère quand la pièce est supprimée', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Va et vient' });

  const uploaded = await upload(app, idea.slug, [
    { filename: 'moment.gif', type: 'image/gif', body: 'GIF89a' },
  ]);
  const trailer = uploaded.body.attachments[0];

  await patch(app, `/api/ideas/${idea.slug}`, { trailer_file_id: trailer.id });

  const cleared = await patch(app, `/api/ideas/${idea.slug}`, { trailer_file_id: null });
  assert.equal(cleared.body.trailer_file_id, null);
  assert.equal(cleared.body.trailer_url, null);

  await patch(app, `/api/ideas/${idea.slug}`, { trailer_file_id: trailer.id });
  const removed = await app.inject({ method: 'DELETE', url: `/api/attachments/${trailer.id}` });
  assert.equal(removed.statusCode, 200);

  const reloaded = await get(app, `/api/ideas/${idea.slug}`);
  assert.equal(reloaded.body.trailer_file_id, null, 'la référence est libérée avec la pièce');
  assert.equal(reloaded.body.trailer_url, null);
});

test('la bande-annonce est servie sur le catalogue comme la capsule', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Au survol' });

  const uploaded = await upload(app, idea.slug, [
    { filename: 'moment.gif', type: 'image/gif', body: 'GIF89a' },
  ]);
  await patch(app, `/api/ideas/${idea.slug}`, {
    trailer_file_id: uploaded.body.attachments[0].id,
  });

  // Le catalogue joue la bande-annonce au survol : elle doit arriver dans la
  // même requête que le reste, pas par un appel par carte.
  const list = await get(app, '/api/ideas');
  const listed = list.body.ideas.find((item) => item.slug === idea.slug);
  assert.match(listed.trailer_url, /moment\.gif$/);
});

test('purger une idée qui a une bande-annonce n’échoue pas sur la référence', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'À purger' });

  const uploaded = await upload(app, idea.slug, [
    { filename: 'moment.gif', type: 'image/gif', body: 'GIF89a' },
  ]);
  await patch(app, `/api/ideas/${idea.slug}`, {
    trailer_file_id: uploaded.body.attachments[0].id,
  });

  await app.inject({ method: 'DELETE', url: `/api/ideas/${idea.slug}` });
  const purged = await app.inject({ method: 'DELETE', url: `/api/ideas/${idea.slug}/purge` });

  assert.equal(purged.statusCode, 200);
  assert.equal(JSON.parse(purged.body).files_removed, 1);
});

test('POST /api/ideas ne peut pas poser de bande-annonce : l’idée n’a pas de pièce', async (t) => {
  const { app } = await makeApp(t);

  const res = await post(app, '/api/ideas', { title: 'Neuve', trailer_file_id: 1 });
  assert.equal(res.status, 400, 'trailer_file_id est absent du corps de création');
});
