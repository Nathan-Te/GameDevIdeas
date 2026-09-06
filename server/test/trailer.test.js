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

const { del, get, makeApp, patch, post, seedIdea } = await import('./helpers.js');

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

test('trailer_file_id n’accepte qu’une image ou une bande-annonce de cette idée', async (t) => {
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

  // Une capture est admise depuis qu'une idée sans vidéo peut ouvrir dessus.
  const image = await patch(app, `/api/ideas/${idea.slug}`, { trailer_file_id: shot.id });
  assert.equal(image.status, 200);
  assert.equal(image.body.leading_media_id, shot.id);
  assert.equal(image.body.leading_media_kind, 'image');

  // Un markdown, lui, ne se montre pas : l'encart central n'en veut pas.
  const markdown = await upload(app, idea.slug, [
    { filename: 'notes.md', type: 'text/markdown', body: '# notes' },
  ]);
  const wrongKind = await patch(app, `/api/ideas/${idea.slug}`, {
    trailer_file_id: markdown.body.attachments[0].id,
  });
  assert.equal(wrongKind.status, 400);
  assert.match(wrongKind.body.message, /image|GIF|vidéo/i);

  const wrongIdea = await patch(app, `/api/ideas/${idea.slug}`, {
    trailer_file_id: neighbour.body.attachments[0].id,
  });
  assert.equal(wrongIdea.status, 400);

  const ok = await patch(app, `/api/ideas/${idea.slug}`, { trailer_file_id: trailer.id });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.trailer_file_id, trailer.id);
  assert.equal(ok.body.leading_media_id, trailer.id);
  assert.equal(ok.body.leading_media_kind, 'trailer');
  assert.match(ok.body.leading_media_url, /^\/files\//);
});

/**
 * L'encart central quand il n'y a aucune vidéo : la capsule tient les deux
 * places à la fois, et la supprimer libère les deux références d'un coup.
 */
test('une image, la capsule comprise, peut tenir l’encart central', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Sans vidéo' });

  const sent = await upload(app, idea.slug, [
    { filename: 'capsule.png', type: 'image/png', body: 'png' },
  ]);
  const capsule = sent.body.attachments[0];

  const both = await patch(app, `/api/ideas/${idea.slug}`, {
    capsule_file_id: capsule.id,
    trailer_file_id: capsule.id,
  });
  assert.equal(both.status, 200);
  assert.equal(both.body.capsule_file_id, capsule.id);
  assert.equal(both.body.leading_media_id, capsule.id);
  assert.equal(both.body.leading_media_kind, 'image');
  assert.equal(both.body.capsule_url, both.body.leading_media_url);

  // Aucune bande-annonce n'existe : rien ne doit reprendre la tête toute seule.
  const removed = await del(app, `/api/attachments/${capsule.id}`);
  assert.equal(removed.status, 200);

  const after = await get(app, `/api/ideas/${idea.slug}`);
  assert.equal(after.body.capsule_file_id, null);
  assert.equal(after.body.trailer_file_id, null);
  assert.equal(after.body.leading_media_id, null);
  assert.equal(after.body.leading_media_kind, null);
});

test('une idée porte plusieurs bandes-annonces ; la première mène, sans rien désigner', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Trois vidéos' });

  const uploaded = await upload(app, idea.slug, [
    { filename: 'un.mp4', type: 'video/mp4', body: 'mp4' },
    { filename: 'deux.webm', type: 'video/webm', body: 'webm' },
    { filename: 'trois.gif', type: 'image/gif', body: 'GIF89a' },
  ]);
  const [first, , third] = uploaded.body.attachments;

  // Rien n'a été désigné : c'est la première pièce `trailer` qui mène. Sans ce
  // repli, déposer une vidéo ne suffirait pas — il faudrait aussi y penser.
  const auto = await get(app, `/api/ideas/${idea.slug}`);
  assert.equal(auto.body.trailer_file_id, null, 'rien n’a été désigné');
  assert.equal(auto.body.leading_media_id, first.id);
  assert.match(auto.body.leading_media_url, /un\.mp4$/);

  // Une désignation explicite l'emporte sur l'ordre.
  const chosen = await patch(app, `/api/ideas/${idea.slug}`, { trailer_file_id: third.id });
  assert.equal(chosen.body.trailer_file_id, third.id);
  assert.equal(chosen.body.leading_media_id, third.id);
  assert.match(chosen.body.leading_media_url, /trois\.gif$/);

  // Et les trois restent des pièces de l'idée : la visionneuse les enchaîne.
  const list = await get(app, `/api/ideas/${idea.slug}/attachments`);
  assert.equal(list.body.attachments.filter((item) => item.kind === 'trailer').length, 3);
});

test('retirer la désignation rend la tête à la première, pas au vide', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Va et vient' });

  const uploaded = await upload(app, idea.slug, [
    { filename: 'un.mp4', type: 'video/mp4', body: 'mp4' },
    { filename: 'deux.mp4', type: 'video/mp4', body: 'mp4' },
  ]);
  const [first, second] = uploaded.body.attachments;

  await patch(app, `/api/ideas/${idea.slug}`, { trailer_file_id: second.id });

  const cleared = await patch(app, `/api/ideas/${idea.slug}`, { trailer_file_id: null });
  assert.equal(cleared.body.trailer_file_id, null, 'plus rien n’est désigné');
  assert.equal(cleared.body.leading_media_id, first.id, 'la première reprend la tête');
  assert.match(cleared.body.leading_media_url, /un\.mp4$/);
});

test('la bande-annonce se libère quand la pièce est supprimée', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Suppression' });

  const uploaded = await upload(app, idea.slug, [
    { filename: 'un.mp4', type: 'video/mp4', body: 'mp4' },
    { filename: 'deux.mp4', type: 'video/mp4', body: 'mp4' },
  ]);
  const [first, second] = uploaded.body.attachments;

  await patch(app, `/api/ideas/${idea.slug}`, { trailer_file_id: first.id });
  assert.equal(
    (await app.inject({ method: 'DELETE', url: `/api/attachments/${first.id}` })).statusCode,
    200,
  );

  const afterFirst = await get(app, `/api/ideas/${idea.slug}`);
  assert.equal(afterFirst.body.trailer_file_id, null, 'la référence est libérée avec la pièce');
  assert.equal(afterFirst.body.leading_media_id, second.id, 'la suivante prend la tête');

  // La dernière partie : l'idée n'a plus de bande-annonce du tout.
  await app.inject({ method: 'DELETE', url: `/api/attachments/${second.id}` });
  const empty = await get(app, `/api/ideas/${idea.slug}`);
  assert.equal(empty.body.leading_media_id, null);
  assert.equal(empty.body.leading_media_url, null);
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
  assert.match(listed.leading_media_url, /moment\.gif$/);
  assert.equal(listed.leading_media_id, uploaded.body.attachments[0].id);
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
