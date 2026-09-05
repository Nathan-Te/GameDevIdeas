import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { createPublicEntry, listenPublicEntry } from '../src/public-entry.js';

/**
 * Une base SQLite en mémoire par test : aucun fichier à nettoyer, aucune
 * interférence entre tests, migrations rejouées à chaque fois — ce qui vérifie
 * au passage que les migrations s'appliquent sur une base vierge.
 *
 * `t` est le contexte du test en cours ; le nettoyage y est accroché.
 */
export async function makeApp(t) {
  const db = openDatabase({ path: ':memory:', migrate: true });
  const app = await buildApp({ db });
  await app.ready();

  t.after(async () => {
    await app.close();
    db.close();
  });

  return { app, db };
}

/** `app.inject` renvoie le corps en texte ; on veut du JSON partout. */
export async function call(app, method, url, payload) {
  const response = await app.inject({ method, url, payload });
  let body = null;
  if (response.body) {
    try {
      body = JSON.parse(response.body);
    } catch {
      body = response.body;
    }
  }
  return { status: response.statusCode, body, headers: response.headers };
}

export const get = (app, url) => call(app, 'GET', url);
export const post = (app, url, payload) => call(app, 'POST', url, payload);
export const patch = (app, url, payload) => call(app, 'PATCH', url, payload);
export const del = (app, url) => call(app, 'DELETE', url);

/** Crée une idée et renvoie son corps, en échouant fort si la création rate. */
export async function seedIdea(app, fields = {}) {
  const res = await post(app, '/api/ideas', fields);
  if (res.status !== 201) {
    throw new Error(`création d'idée échouée (${res.status}) : ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/**
 * L'application **réellement servie**, sur ses deux ports.
 *
 * Les requêtes de visiteur ne peuvent plus être simulées par un en-tête : depuis
 * la correction du lot 7, le seul critère de classification est le port
 * d'écoute par lequel la requête est entrée. Les éprouver demande donc de vrais
 * sockets — ce qui est une bonne nouvelle, parce que c'est exactement le chemin
 * que prendra un ami.
 *
 * L'écoute est sur `0.0.0.0` : un test peut ainsi frapper le serveur depuis une
 * adresse qui n'est ni la boucle locale ni le tailnet (voir
 * `public-entry.test.js`), ce qui est le cas de figure — Docker — qui a cassé
 * la première version de la porte.
 */
export async function makeServed(t) {
  const { app, db } = await makeApp(t);

  await app.listen({ port: 0, host: '0.0.0.0' });
  const publicServer = createPublicEntry(app);
  await listenPublicEntry(publicServer, { port: 0, host: '0.0.0.0' });

  t.after(() => new Promise((resolve) => publicServer.close(resolve)));

  const ownerPort = app.server.address().port;
  const publicPort = publicServer.address().port;

  return {
    app,
    db,
    ownerPort,
    publicPort,
    ownerUrl: `http://127.0.0.1:${ownerPort}`,
    publicUrl: `http://127.0.0.1:${publicPort}`,
  };
}

/** Un appel HTTP réel, rendu dans la même forme que `call`. */
export async function http(base, method, url, payload, headers = {}) {
  // `fetch` refuse un corps sur GET/HEAD, là où `inject` l'ignorait : les tests
  // de routes fermées passent un corps à tout, y compris aux lectures.
  const withBody = payload !== undefined && method !== 'GET' && method !== 'HEAD';

  const response = await fetch(`${base}${url}`, {
    method,
    headers: withBody ? { 'content-type': 'application/json', ...headers } : headers,
    body: withBody ? JSON.stringify(payload) : undefined,
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {
    status: response.status,
    body,
    headers: Object.fromEntries(response.headers.entries()),
  };
}

/**
 * La même application, vue par un **visiteur** : par le port public, par le
 * réseau, comme un ami au bout d'un lien. `served` vient de `makeServed`.
 */
export function guest(served, method, url, payload, headers = {}) {
  return http(served.publicUrl, method, url, payload, headers);
}

/** Et par le port de Nathan, quand un test veut comparer les deux. */
export function ownerHttp(served, method, url, payload, headers = {}) {
  return http(served.ownerUrl, method, url, payload, headers);
}

/** Le visiteur, avec son identifiant de navigateur. */
export const asVisitor = (visitorId) => ({ 'x-vitrine-visitor': visitorId });
