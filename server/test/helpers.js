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
