import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

/**
 * `config` lit l'environnement à l'import : il faut le poser avant, donc
 * importer les modules dynamiquement. Chaque fichier de test tourne dans son
 * propre processus, rien ne fuit ailleurs.
 *
 * - un dossier de fichiers à part : ces tests écrivent vraiment sur le disque,
 *   pas dans `data/files/` ;
 * - une limite d'envoi minuscule, pour ne pas fabriquer 50 Mo en mémoire ;
 * - la recherche du titre d'un lien coupée : aucun test ne doit dépendre du
 *   réseau. Elle est vérifiée à part, contre un serveur local.
 */
const filesDir = mkdtempSync(join(tmpdir(), 'vitrine-files-'));
process.env.DATA_FILES_DIR = filesDir;
process.env.MAX_UPLOAD_MB = '1';
process.env.LINK_TITLE_LOOKUP = 'false';

const { call, get, makeApp, patch, post, seedIdea } = await import('./helpers.js');
const { fetchLinkTitle, linkTypeFromUrl } = await import('../src/links.js');

test.after(() => rmSync(filesDir, { recursive: true, force: true }));

/** Le plus petit PNG valide : un pixel transparent. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const CRLF = '\r\n';

/**
 * Construit un corps multipart à la main. Une dépendance de plus (`form-data`)
 * pour trois concaténations ne se justifierait pas.
 */
function multipart(files) {
  const boundary = `----vitrine${randomUUID()}`;
  const chunks = [];

  for (const { field = 'file', filename, type = 'application/octet-stream', content } of files) {
    const head =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"${CRLF}` +
      `Content-Type: ${type}${CRLF}${CRLF}`;
    chunks.push(
      Buffer.from(head),
      Buffer.isBuffer(content) ? content : Buffer.from(content),
      Buffer.from(CRLF),
    );
  }

  chunks.push(Buffer.from(`--${boundary}--${CRLF}`));

  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function upload(app, slug, files) {
  const { payload, headers } = multipart(files);
  const response = await app.inject({
    method: 'POST',
    url: `/api/ideas/${slug}/attachments`,
    payload,
    headers,
  });
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

async function uploadOne(app, slug, file) {
  const res = await upload(app, slug, [file]);
  assert.equal(res.status, 201, `envoi refusé : ${JSON.stringify(res.body)}`);
  return res.body.attachments[0];
}

const addLink = (app, slug, body) => post(app, `/api/ideas/${slug}/attachments`, body);

// --- Envoi de fichiers -------------------------------------------------------

test('une image envoyée est reconnue, écrite sur le disque et nommée proprement', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Roguelike de pêche' });

  const attachment = await uploadOne(app, idea.slug, {
    filename: 'Capsule pêche (finale).png',
    type: 'image/png',
    content: PNG,
  });

  assert.equal(attachment.kind, 'image');
  assert.equal(attachment.label, 'Capsule pêche (finale).png');
  assert.equal(attachment.position, 0);
  assert.equal(attachment.size_bytes, PNG.length);
  assert.equal(attachment.url, null);

  // `{idea_id}/{uuid}-{nom nettoyé}` : rien hors [a-zA-Z0-9._-] dans le nom.
  assert.match(attachment.path, /^\d+\/[0-9a-f-]{36}-Capsule-peche-finale\.png$/);
  assert.equal(attachment.file_url, `/files/${attachment.path}`);
  assert.ok(existsSync(join(filesDir, attachment.path)), 'le fichier existe sur le disque');
});

test('un markdown et un fichier quelconque prennent le bon kind', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app);

  const markdown = await uploadOne(app, idea.slug, {
    filename: 'notes.md',
    type: 'text/markdown',
    content: '# Titre\n\nDu texte.\n',
  });
  const other = await uploadOne(app, idea.slug, {
    filename: 'build.zip',
    type: 'application/zip',
    content: 'PK pas vraiment un zip',
  });

  assert.equal(markdown.kind, 'markdown');
  assert.equal(other.kind, 'file');
  assert.equal(other.position, 1, 'la seconde pièce se pose après la première');
});

test('un PNG annoncé en octet-stream reste une image : l’extension compte aussi', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app);

  const attachment = await uploadOne(app, idea.slug, {
    filename: 'capsule.PNG',
    type: 'application/octet-stream',
    content: PNG,
  });

  assert.equal(attachment.kind, 'image');
});

test('un envoi multipart peut porter plusieurs fichiers d’un coup', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app);

  const res = await upload(app, idea.slug, [
    { filename: 'a.png', type: 'image/png', content: PNG },
    { filename: 'b.md', type: 'text/markdown', content: '# b' },
  ]);

  assert.equal(res.status, 201);
  assert.deepEqual(
    res.body.attachments.map((a) => [a.kind, a.position]),
    [
      ['image', 0],
      ['markdown', 1],
    ],
  );
});

test('un fichier au-delà de MAX_UPLOAD_MB est refusé, sans rien laisser sur le disque', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Trop gros' });

  // La limite est posée à 1 Mo en tête de fichier.
  const res = await upload(app, idea.slug, [
    { filename: 'enorme.bin', content: Buffer.alloc(2 * 1024 * 1024, 7) },
  ]);

  assert.equal(res.status, 413);
  assert.equal(res.body.error, 'payload_too_large');
  assert.match(res.body.message, /1 Mo/);

  const listed = await get(app, `/api/ideas/${idea.slug}/attachments`);
  assert.deepEqual(listed.body.attachments, [], 'aucune ligne créée');

  // Chaque test a sa base en mémoire, donc ses idées repartent à l'id 1 et tous
  // les tests écrivent dans le même dossier : on cherche ce fichier-là.
  const dir = join(filesDir, String(idea.id));
  const left = (existsSync(dir) ? readdirSync(dir) : []).filter((name) =>
    name.endsWith('-enorme.bin'),
  );
  assert.deepEqual(left, [], 'aucun fichier partiel laissé');
});

test('une requête multipart sans fichier est refusée', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app);

  const boundary = '----vitrine-vide';
  const body =
    `--${boundary}${CRLF}Content-Disposition: form-data; name="rien"${CRLF}${CRLF}` +
    `x${CRLF}--${boundary}--${CRLF}`;

  const response = await app.inject({
    method: 'POST',
    url: `/api/ideas/${idea.slug}/attachments`,
    payload: Buffer.from(body),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).error, 'bad_request');
});

test('envoyer sur une idée inconnue ou supprimée renvoie 404 JSON', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app);
  await call(app, 'DELETE', `/api/ideas/${idea.slug}`);

  const missing = await upload(app, 'nexiste-pas', [{ filename: 'a.png', content: PNG }]);
  assert.equal(missing.status, 404);

  const deleted = await upload(app, idea.slug, [{ filename: 'a.png', content: PNG }]);
  assert.equal(deleted.status, 404);
});

// --- Liens -------------------------------------------------------------------

test('le link_type est déduit du domaine, `autre` par défaut', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app);

  const cases = [
    ['https://trello.com/b/abc/idees', 'trello'],
    ['https://assetstore.unity.com/packages/tools/42', 'asset-store'],
    ['https://github.com/nathan/vitrine', 'git'],
    ['https://gitlab.com/nathan/vitrine', 'git'],
    ['https://bitbucket.org/nathan/vitrine', 'git'],
    ['https://store.steampowered.com/app/440/', 'steam'],
    ['https://www.youtube.com/watch?v=abc', 'video'],
    ['https://youtu.be/abc', 'video'],
    ['https://exemple.fr/une-page', 'autre'],
  ];

  for (const [url, expected] of cases) {
    const res = await addLink(app, idea.slug, { url });
    assert.equal(res.status, 201, url);
    assert.equal(res.body.attachments[0].link_type, expected, url);
    assert.equal(res.body.attachments[0].kind, 'link');
    assert.equal(res.body.attachments[0].path, null);
    assert.equal(res.body.attachments[0].file_url, null);
  }
});

test('un lien sans label retombe sur le nom de domaine, `www.` retiré', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app);

  // La recherche du titre est coupée dans ce fichier : c'est le repli qu'on voit.
  const res = await addLink(app, idea.slug, { url: 'https://www.exemple.fr/une/page?x=1' });

  assert.equal(res.body.attachments[0].label, 'exemple.fr');
  assert.equal(res.body.attachments[0].url, 'https://www.exemple.fr/une/page?x=1');
});

test('le label fourni l’emporte sur toute déduction', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app);

  const res = await addLink(app, idea.slug, { url: 'https://trello.com/b/x', label: 'Le board' });

  assert.equal(res.body.attachments[0].label, 'Le board');
});

test('une URL illisible ou non http(s) est refusée', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app);

  for (const url of ['pas une url', 'ftp://exemple.fr/x', 'javascript:alert(1)']) {
    const res = await addLink(app, idea.slug, { url });
    assert.equal(res.status, 400, url);
  }

  const empty = await addLink(app, idea.slug, {});
  assert.equal(empty.status, 400);
});

test('fetchLinkTitle lit le titre d’une page et abandonne proprement', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/ok') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<html><head><title>  Le  board  &amp; co </title></head><body>x</body></html>');
      return;
    }
    if (request.url === '/sans-titre') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><body>rien</body></html>');
      return;
    }
    response.writeHead(500).end('boum');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // `allowPrivateHosts` : depuis le lot 3, le lookup refuse les adresses
  // privées et locales — dont ce `127.0.0.1`. Ce test-ci porte sur la lecture
  // du `<title>`, pas sur la politique réseau ; celle-ci est testée à part.
  const options = { allowPrivateHosts: true };

  try {
    assert.equal(await fetchLinkTitle(`${base}/ok`, options), 'Le board & co');
    assert.equal(await fetchLinkTitle(`${base}/sans-titre`, options), null);
    assert.equal(await fetchLinkTitle(`${base}/erreur`, options), null);
    assert.equal(await fetchLinkTitle('pas une url', options), null);
  } finally {
    server.close();
  }
});

test('linkTypeFromUrl accepte les sous-domaines mais pas les voisins de nom', () => {
  assert.equal(linkTypeFromUrl('https://m.youtube.com/watch?v=1'), 'video');
  assert.equal(linkTypeFromUrl('https://gist.github.com/x'), 'git');
  // `unity.com` n'est pas l'Asset Store, et `pas-github.com` n'est pas GitHub.
  assert.equal(linkTypeFromUrl('https://unity.com/fr'), 'autre');
  assert.equal(linkTypeFromUrl('https://pas-github.com/x'), 'autre');
});

// --- Ordre -------------------------------------------------------------------

test('PUT .../attachments/order réordonne, et une nouvelle pièce se pose en fin', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app);

  const a = await uploadOne(app, idea.slug, { filename: 'a.png', content: PNG });
  const b = await uploadOne(app, idea.slug, { filename: 'b.png', content: PNG });
  const c = await uploadOne(app, idea.slug, { filename: 'c.png', content: PNG });

  assert.deepEqual([a.position, b.position, c.position], [0, 1, 2]);

  const reordered = await call(app, 'PUT', `/api/ideas/${idea.slug}/attachments/order`, {
    ids: [c.id, a.id, b.id],
  });

  assert.equal(reordered.status, 200);
  assert.deepEqual(
    reordered.body.attachments.map((x) => x.id),
    [c.id, a.id, b.id],
  );
  assert.deepEqual(
    reordered.body.attachments.map((x) => x.position),
    [0, 1, 2],
  );

  const d = await uploadOne(app, idea.slug, { filename: 'd.png', content: PNG });
  assert.equal(d.position, 3, 'position = max + 1');
});

test('une liste d’ordre incomplète, doublonnée ou étrangère est refusée', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Une' });
  const autre = await seedIdea(app, { title: 'Deux' });

  const a = await uploadOne(app, idea.slug, { filename: 'a.png', content: PNG });
  const b = await uploadOne(app, idea.slug, { filename: 'b.png', content: PNG });
  const ailleurs = await uploadOne(app, autre.slug, { filename: 'c.png', content: PNG });

  const order = (ids) => call(app, 'PUT', `/api/ideas/${idea.slug}/attachments/order`, { ids });

  assert.equal((await order([a.id])).status, 400, 'liste incomplète');
  assert.equal((await order([a.id, a.id])).status, 400, 'doublon');
  assert.equal((await order([a.id, ailleurs.id])).status, 400, 'pièce d’une autre idée');

  const unchanged = await get(app, `/api/ideas/${idea.slug}/attachments`);
  assert.deepEqual(
    unchanged.body.attachments.map((x) => x.id),
    [a.id, b.id],
    'un refus ne change rien',
  );
});

test('PATCH position déplace la pièce et renumérote la liste', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app);

  const a = await uploadOne(app, idea.slug, { filename: 'a.png', content: PNG });
  const b = await uploadOne(app, idea.slug, { filename: 'b.png', content: PNG });
  const c = await uploadOne(app, idea.slug, { filename: 'c.png', content: PNG });

  const moved = await patch(app, `/api/attachments/${c.id}`, { position: 0 });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.position, 0);

  const listed = await get(app, `/api/ideas/${idea.slug}/attachments`);
  assert.deepEqual(
    listed.body.attachments.map((x) => [x.id, x.position]),
    [
      [c.id, 0],
      [a.id, 1],
      [b.id, 2],
    ],
  );
});

// --- Modification et suppression ---------------------------------------------

test('PATCH modifie le label ; le link_type n’a de sens que sur un lien', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app);

  const lien = (await addLink(app, idea.slug, { url: 'https://exemple.fr/x' })).body.attachments[0];
  const image = await uploadOne(app, idea.slug, { filename: 'a.png', content: PNG });

  const renamed = await patch(app, `/api/attachments/${lien.id}`, { label: 'Mon lien' });
  assert.equal(renamed.body.label, 'Mon lien');

  const retyped = await patch(app, `/api/attachments/${lien.id}`, { link_type: 'steam' });
  assert.equal(retyped.body.link_type, 'steam');

  const bad = await patch(app, `/api/attachments/${image.id}`, { link_type: 'steam' });
  assert.equal(bad.status, 400);

  const unknownType = await patch(app, `/api/attachments/${lien.id}`, { link_type: 'notion' });
  assert.equal(unknownType.status, 400);

  const missing = await patch(app, '/api/attachments/99999', { label: 'x' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'not_found');
});

test('DELETE efface la ligne et le fichier, et libère la capsule', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'À supprimer' });

  const image = await uploadOne(app, idea.slug, { filename: 'capsule.png', content: PNG });
  const absolute = join(filesDir, image.path);
  assert.ok(existsSync(absolute));

  const withCapsule = await patch(app, `/api/ideas/${idea.slug}`, { capsule_file_id: image.id });
  assert.equal(withCapsule.body.capsule_file_id, image.id);
  assert.equal(withCapsule.body.capsule_url, `/files/${image.path}`);

  const removed = await call(app, 'DELETE', `/api/attachments/${image.id}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.id, image.id);

  assert.equal(existsSync(absolute), false, 'le fichier a disparu du disque');

  const listed = await get(app, `/api/ideas/${idea.slug}/attachments`);
  assert.deepEqual(listed.body.attachments, []);

  const after = await get(app, `/api/ideas/${idea.slug}`);
  assert.equal(after.body.capsule_file_id, null, 'la capsule est libérée');
  assert.equal(after.body.capsule_url, null);

  const twice = await call(app, 'DELETE', `/api/attachments/${image.id}`);
  assert.equal(twice.status, 404);
});

test('supprimer un lien ne touche à aucun fichier', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app);

  const lien = (await addLink(app, idea.slug, { url: 'https://exemple.fr/x' })).body.attachments[0];
  const removed = await call(app, 'DELETE', `/api/attachments/${lien.id}`);

  assert.equal(removed.status, 200);
  assert.equal(removed.body.path, null);
});

// --- Capsule -----------------------------------------------------------------

test('la capsule doit être une image de cette idée', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'La mienne' });
  const autre = await seedIdea(app, { title: 'La sienne' });

  const image = await uploadOne(app, idea.slug, { filename: 'a.png', content: PNG });
  const markdown = await uploadOne(app, idea.slug, { filename: 'n.md', content: '# n' });
  const ailleurs = await uploadOne(app, autre.slug, { filename: 'b.png', content: PNG });

  const ok = await patch(app, `/api/ideas/${idea.slug}`, { capsule_file_id: image.id });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.capsule_url, `/files/${image.path}`);

  const notAnImage = await patch(app, `/api/ideas/${idea.slug}`, { capsule_file_id: markdown.id });
  assert.equal(notAnImage.status, 400);
  assert.match(notAnImage.body.message, /image/i);

  const foreign = await patch(app, `/api/ideas/${idea.slug}`, { capsule_file_id: ailleurs.id });
  assert.equal(foreign.status, 400);

  const unknown = await patch(app, `/api/ideas/${idea.slug}`, { capsule_file_id: 99999 });
  assert.equal(unknown.status, 400);

  // La capsule tient encore : un refus n'écrase rien.
  const still = await get(app, `/api/ideas/${idea.slug}`);
  assert.equal(still.body.capsule_file_id, image.id);

  const cleared = await patch(app, `/api/ideas/${idea.slug}`, { capsule_file_id: null });
  assert.equal(cleared.body.capsule_file_id, null);
  assert.equal(cleared.body.capsule_url, null);
});

test('la capsule voyage jusqu’aux cartes du catalogue', async (t) => {
  const { app } = await makeApp(t);
  const idea = await seedIdea(app, { title: 'Avec capsule' });

  const image = await uploadOne(app, idea.slug, { filename: 'a.png', content: PNG });
  await patch(app, `/api/ideas/${idea.slug}`, { capsule_file_id: image.id });

  const listed = await get(app, '/api/ideas');
  const card = listed.body.ideas.find((x) => x.id === idea.id);

  assert.equal(card.capsule_url, `/files/${image.path}`);
});

test('POST /api/ideas refuse capsule_file_id : une idée neuve n’a pas de pièce jointe', async (t) => {
  const { app } = await makeApp(t);

  const res = await post(app, '/api/ideas', { title: 'X', capsule_file_id: 1 });

  assert.equal(res.status, 400);
});
