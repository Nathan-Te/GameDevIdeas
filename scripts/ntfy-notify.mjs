#!/usr/bin/env node
/**
 * Notification ntfy pour les hooks Claude Code.
 *
 *   node scripts/ntfy-notify.mjs stop          -> fin de tour, priorité normale
 *   node scripts/ntfy-notify.mjs notification  -> Claude attend, priorité basse
 *
 * Le sujet vient de `NTFY_TOPIC` (défaut `pg-nathan-7k2x`), le serveur de
 * `NTFY_SERVER` (défaut `https://ntfy.sh`). Le titre est déduit du nom du
 * dossier racine du projet, pour distinguer plusieurs dépôts sur le même sujet.
 *
 * Le script est volontairement sans dépendance et écrit en syntaxe ancienne :
 * il tourne avec le Node du poste de Nathan, pas celui du conteneur. Il ne fait
 * jamais échouer un hook — toute erreur sort en code 0.
 */
import { basename, resolve } from 'path';
import { request } from 'https';
import { request as httpRequest } from 'http';

const DEFAULT_TOPIC = 'pg-nathan-7k2x';
const DEFAULT_SERVER = 'https://ntfy.sh';
const TIMEOUT_MS = 4000;

const kind = (process.argv[2] || 'stop').toLowerCase();
const topic = process.env.NTFY_TOPIC || DEFAULT_TOPIC;
const server = (process.env.NTFY_SERVER || DEFAULT_SERVER).replace(/\/+$/, '');
const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const projectName = basename(resolve(projectDir));

/** Le corps du hook arrive sur stdin ; on s'en sert s'il est là, sans l'exiger. */
function readStdin() {
  return new Promise((resolvePromise) => {
    if (process.stdin.isTTY) return resolvePromise('');
    let data = '';
    const done = () => resolvePromise(data);
    const timer = setTimeout(done, 500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      done();
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      done();
    });
  });
}

function publish({ title, message, priority, tags }) {
  return new Promise((resolvePromise) => {
    let url;
    try {
      url = new URL(`${server}/${encodeURIComponent(topic)}`);
    } catch {
      return resolvePromise();
    }

    const body = Buffer.from(message, 'utf8');
    const send = url.protocol === 'http:' ? httpRequest : request;

    const req = send(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': body.length,
          // En-têtes ntfy : encodés en RFC 2047 pour rester ASCII sur le fil.
          Title: encodeHeader(title),
          Priority: priority,
          Tags: tags,
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        res.on('end', resolvePromise);
      },
    );

    req.on('error', () => resolvePromise());
    req.on('timeout', () => {
      req.destroy();
      resolvePromise();
    });
    req.end(body);
  });
}

/** Les en-têtes HTTP sont ASCII : « Idée » passe en =?UTF-8?B?…?=. */
function encodeHeader(value) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = {};
  }

  const attente = kind === 'notification';

  await publish({
    title: projectName,
    message: attente
      ? payload.message || 'Claude attend une réponse.'
      : 'Claude a terminé son tour.',
    // Basse pour les attentes, normale (défaut ntfy) pour la fin de tour.
    priority: attente ? 'low' : 'default',
    tags: attente ? 'hourglass' : 'white_check_mark',
  });
}

main().then(
  () => process.exit(0),
  () => process.exit(0),
);
