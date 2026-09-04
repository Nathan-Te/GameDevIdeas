import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  fetchLinkTitle,
  isLocalHostname,
  isPrivateAddress,
  isPrivateTarget,
} from '../src/links.js';

/**
 * Point 3 laissé ouvert au lot 2 : le serveur va chercher le titre de la page
 * pour libeller un lien, donc il émet une requête vers un domaine que Nathan
 * colle — y compris une adresse de son propre réseau. Le lot 3 tranche : le
 * lookup reste actif, mais il ne contacte jamais une adresse privée ou locale.
 *
 * Aucun test de ce fichier ne doit émettre de requête sortante : tout ce qui
 * est testé ici se décide sur le nom, sans DNS.
 */

test('les adresses IPv4 privées, locales et réservées sont reconnues', () => {
  for (const address of [
    '127.0.0.1',
    '127.53.1.9',
    '10.0.0.1',
    '10.255.255.255',
    '192.168.1.1',
    '172.16.0.1',
    '172.31.255.254',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.1',
    '255.255.255.255',
  ]) {
    assert.equal(isPrivateAddress(address), true, `${address} est privée`);
  }

  for (const address of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34']) {
    assert.equal(isPrivateAddress(address), false, `${address} est publique`);
  }
});

test('les adresses IPv6 privées sont reconnues, crochets et IPv4 déguisée compris', () => {
  for (const address of [
    '::1',
    '[::1]',
    '::',
    'fc00::1',
    'fd12:3456:789a::1',
    'fe80::1',
    'fe80::1%eth0',
    '::ffff:127.0.0.1',
    '::ffff:192.168.0.1',
  ]) {
    assert.equal(isPrivateAddress(address), true, `${address} est privée`);
  }

  for (const address of ['2001:4860:4860::8888', '[2606:4700::1111]', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(address), false, `${address} est publique`);
  }
});

test('les noms locaux sont refusés sans passer par le DNS', () => {
  for (const host of [
    'localhost',
    'LOCALHOST',
    'machine.localhost',
    'nas.local',
    'imprimante.LOCAL',
    'service.internal',
    'box.home.arpa',
  ]) {
    assert.equal(isLocalHostname(host), true, `${host} est local`);
  }

  for (const host of ['trello.com', 'store.steampowered.com', 'local.example.com']) {
    assert.equal(isLocalHostname(host), false, `${host} est public`);
  }
});

test('isPrivateTarget tranche sur l’URL entière', async () => {
  const privees = [
    'http://localhost:3000/x',
    'http://127.0.0.1/x',
    'https://10.1.2.3/x',
    'https://192.168.1.1/reboot',
    'https://172.20.0.5/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]:8080/x',
    'http://[fc00::1]/x',
    'http://nas.local/partage',
  ];

  for (const url of privees) {
    assert.equal(await isPrivateTarget(new URL(url)), true, `${url} est privée`);
  }
});

test('aucune requête ne part vers une adresse privée : le libellé retombe sur le domaine', async () => {
  let hits = 0;
  const server = createServer((request, response) => {
    hits += 1;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<title>Interface du routeur</title>');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    // Le serveur existe, il répond, et il a un titre : seule la garde peut
    // expliquer un `null` ici. Le compteur le confirme.
    assert.equal(await fetchLinkTitle(`http://127.0.0.1:${port}/`), null);
    assert.equal(await fetchLinkTitle(`http://localhost:${port}/`), null);
    assert.equal(await fetchLinkTitle(`http://[::1]:${port}/`), null);
    assert.equal(hits, 0, 'aucune requête sortante n’a atteint le serveur');
  } finally {
    server.close();
  }
});

test('un lien collé vers une adresse privée est créé, mais libellé du domaine', async (t) => {
  const { makeApp, post } = await import('./helpers.js');
  const { app } = await makeApp(t);

  const idea = await post(app, '/api/ideas', { title: 'Réseau' });
  const res = await post(app, `/api/ideas/${idea.body.slug}/attachments`, {
    url: 'http://192.168.1.1/admin',
  });

  assert.equal(res.status, 201);
  const [link] = res.body.attachments;
  assert.equal(link.kind, 'link');
  assert.equal(link.link_type, 'autre');
  assert.equal(link.label, '192.168.1.1', 'repli sur le domaine, pas de titre lu');
});
