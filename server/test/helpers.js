import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';

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
 * La même application, vue par un **visiteur**.
 *
 * L'en-tête `x-vitrine-public` est celui que pose le point d'entrée public en
 * production (voir `index.js`) : le tester revient donc à tester ce qui se
 * passera derrière Tailscale Funnel, sans avoir à ouvrir un second port ici.
 * `app.inject` présente les requêtes depuis `127.0.0.1`, c'est-à-dire comme
 * Nathan — c'est précisément pourquoi la classification ne peut pas reposer sur
 * la seule adresse.
 */
export async function guest(app, method, url, payload, headers = {}) {
  const response = await app.inject({
    method,
    url,
    payload,
    headers: { 'x-vitrine-public': '1', ...headers },
  });

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

/** Le visiteur, avec son identifiant de navigateur. */
export const asVisitor = (visitorId) => ({ 'x-vitrine-visitor': visitorId });
