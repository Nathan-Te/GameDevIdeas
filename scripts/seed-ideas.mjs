#!/usr/bin/env node
/**
 * seed-ideas.mjs — peuple une instance Vitrine à partir de `Docs/fiches-vitrine-14.md`.
 *
 * Le fichier de fiches est la seule source : le script recopie, il n'invente
 * rien et ne complète aucun champ vide.
 *
 * Tout passe par l'API HTTP, jamais par la base : les validations, la dérivation
 * du slug et les compteurs empruntent le même chemin que l'usage normal. Une
 * écriture directe en SQL produirait des lignes qu'aucune route n'aurait
 * acceptées, et le bug ne se verrait qu'à la lecture.
 *
 *   node scripts/seed-ideas.mjs [--url http://localhost:3000] [--dry-run] [--file <md>]
 *
 * Idempotent : les idées sont repérées par leur titre. Relancé, il met à jour
 * l'existante au lieu d'en créer une seconde.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = resolve(ROOT, 'Docs/fiches-vitrine-14.md');

const USAGE = `
Peuplement Vitrine — crée ou met à jour les idées décrites par un fichier de fiches.

  node scripts/seed-ideas.mjs [options]

  --url       URL de base de l'API (défaut : http://localhost:3000)
  --file      fichier de fiches (défaut : Docs/fiches-vitrine-14.md)
  --dry-run   affiche ce qui serait écrit, sans rien écrire
`.trim();

function parseArgs(argv) {
  const args = { url: 'http://localhost:3000', file: DEFAULT_FILE, dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url' || arg === '-u') args.url = argv[++i];
    else if (arg === '--file' || arg === '-f') args.file = argv[++i];
    else if (arg === '--dry-run' || arg === '-n') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`argument inconnu : ${arg}`);
  }

  if (!args.url) throw new Error('--url attend une URL');
  return args;
}

/* ------------------------------------------------------------------ lecture */

/** `Accroche` → `accroche` : on compare les libellés sans accent ni casse. */
function normalizeLabel(label) {
  return label
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

/**
 * Les champs d'une fiche s'écrivent `- **Label :** valeur`, parfois plusieurs
 * sur la même ligne séparés par ` · ` (le trio prix / famille / statut). La
 * borne d'une valeur est donc le prochain `· **`, la prochaine puce, ou la fin
 * du bloc.
 */
const FIELD_RE = /\*\*\s*([^*:]+?)\s*:\*\*\s*([\s\S]*?)(?=\s*·\s*\*\*|\n\s*-\s*\*\*|$)/g;

/** Les statuts de Vitrine sont sans accent ; la fiche écrit le mot français. */
const STATUSES = { idee: 'idee' };

/** `8 €` → `800`. Vide → `null` : la fiche ne donne pas de prix, on n'en met pas. */
function parsePrice(raw) {
  if (!raw) return null;
  const match = raw.replace(/\s/g, '').match(/^(\d+(?:[.,]\d+)?)/);
  if (!match) throw new Error(`prix illisible : « ${raw} »`);
  return Math.round(Number(match[1].replace(',', '.')) * 100);
}

/**
 * Découpe le fichier en fiches. Une fiche est un `## n. Titre` suivi de ses
 * puces. Une parenthèse en fin de titre (« Ricochets (placeholder … ) ») n'est
 * pas un titre : elle part en fin de pitch, telle quelle.
 */
export function parseFiches(markdown) {
  const sections = markdown.split(/^## /m).slice(1);
  const fiches = [];

  for (const section of sections) {
    const [heading, ...rest] = section.split('\n');
    const body = rest.join('\n');

    const headingMatch = heading.match(/^(\d+)\.\s*(.+?)\s*$/);
    if (!headingMatch) throw new Error(`titre de fiche illisible : « ${heading} »`);
    const [, number, fullTitle] = headingMatch;

    const parenthetical = fullTitle.match(/^(.+?)\s+(\([^)]*\))$/);
    const title = parenthetical ? parenthetical[1] : fullTitle;
    const titleNote = parenthetical ? parenthetical[2] : '';

    const fields = new Map();
    for (const [, label, value] of body.matchAll(FIELD_RE)) {
      fields.set(normalizeLabel(label), value.trim());
    }

    const statusRaw = normalizeLabel(fields.get('statut') ?? '');
    const status = STATUSES[statusRaw];
    if (!status) throw new Error(`fiche ${number} : statut inconnu « ${fields.get('statut')} »`);

    const pitch = [fields.get('pitch') ?? '', titleNote].filter(Boolean).join(' ');

    fiches.push({
      number: Number(number),
      title,
      tagline: fields.get('accroche') ?? '',
      pitch,
      gif: fields.get('gif') ?? '',
      price_cents: parsePrice(fields.get('prix') ?? ''),
      family: fields.get('famille') ?? '',
      status,
      competition: fields.get('concurrence') ?? '',
    });
  }

  return fiches;
}

/* ---------------------------------------------------------------------- API */

const FIELDS = [
  'title',
  'tagline',
  'pitch',
  'gif',
  'price_cents',
  'family',
  'status',
  'competition',
];

class Api {
  constructor(baseUrl) {
    this.base = baseUrl.replace(/\/+$/, '');
  }

  async request(method, path, body) {
    let response;
    try {
      response = await fetch(`${this.base}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new Error(
        `l'API ne répond pas sur ${this.base} (${method} ${path}) : ${cause.message}\n` +
          "Démarrer l'instance (npm run dev, ou npm start) ou corriger --url.",
        { cause },
      );
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.message ?? payload?.error ?? response.statusText;
      throw new Error(`${method} ${path} → ${response.status} : ${message}`);
    }
    return payload;
  }
}

/** Les champs à écrire qui diffèrent de ce que l'API renvoie déjà. */
function diffFields(fiche, existing) {
  const changes = {};
  for (const field of FIELDS) {
    const wanted = fiche[field];
    const current = existing[field] ?? (field === 'price_cents' ? null : '');
    if (wanted !== current) changes[field] = wanted;
  }
  return changes;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const fiches = parseFiches(await readFile(args.file, 'utf8'));
  console.log(`${fiches.length} fiches lues dans ${args.file}`);

  const api = new Api(args.url);

  // Premier appel : il sert autant à lire les familles qu'à échouer tout de
  // suite, avec un message qui dit quoi faire, si rien n'écoute.
  const { families } = await api.request('GET', '/api/families');
  const known = new Set(families.map((family) => family.slug));

  const missing = [...new Set(fiches.map((fiche) => fiche.family))].filter(
    (slug) => !known.has(slug),
  );
  if (missing.length > 0) {
    throw new Error(
      `familles absentes de l'instance : ${missing.join(', ')}\n` +
        'Les familles sont peuplées au démarrage (lot 4) ; ce script ne les recrée pas. ' +
        'Les rétablir depuis /familles avant de relancer.',
    );
  }

  // Corbeille comprise : une idée mise à la corbeille porte toujours son titre,
  // et en recréer une seconde du même nom serait un doublon déguisé.
  const [live, trashed] = await Promise.all([
    api.request('GET', '/api/ideas'),
    api.request('GET', '/api/ideas?deleted=true'),
  ]);
  const byTitle = new Map([...live.ideas, ...trashed.ideas].map((idea) => [idea.title, idea]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const fiche of fiches) {
    const existing = byTitle.get(fiche.title);

    if (!existing) {
      if (args.dryRun) {
        console.log(`  + créerait   « ${fiche.title} » (${fiche.family})`);
      } else {
        const body = Object.fromEntries(FIELDS.map((field) => [field, fiche[field]]));
        const idea = await api.request('POST', '/api/ideas', body);
        console.log(`  + créée      « ${idea.title} » → /idees/${idea.slug}`);
      }
      created += 1;
      continue;
    }

    const changes = diffFields(fiche, existing);
    if (Object.keys(changes).length === 0) {
      console.log(`  = inchangée  « ${fiche.title} » (${existing.slug})`);
      unchanged += 1;
      continue;
    }

    const summary = `« ${fiche.title} » (${existing.slug}) : ${Object.keys(changes).join(', ')}`;
    if (args.dryRun) {
      console.log(`  ~ modifierait ${summary}`);
    } else {
      await api.request('PATCH', `/api/ideas/${existing.slug}`, changes);
      console.log(`  ~ modifiée   ${summary}`);
    }
    updated += 1;
  }

  console.log(`\n${created} créations, ${updated} mises à jour, ${unchanged} inchangées.`);
  if (args.dryRun) console.log('--dry-run : rien n’a été écrit.');
}

main().catch((err) => {
  console.error(`\nÉchec : ${err.message}`);
  process.exitCode = 1;
});
