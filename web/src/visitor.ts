/**
 * L'identité d'un visiteur : un prénom et un identifiant tiré au hasard, dans
 * le stockage local de son navigateur.
 *
 * Ce n'est pas un compte : pas d'e-mail, pas de mot de passe, rien qui parte au
 * serveur d'autre que le prénom qu'il écrit et l'identifiant qu'il tire. Cet
 * identifiant ne sert qu'à une chose — laisser quelqu'un corriger **son** avis
 * plutôt que d'en empiler un second. Effacer les données du navigateur le perd,
 * et la conséquence est celle qu'on attend : l'avis précédent reste, il n'est
 * simplement plus modifiable. C'est le bon compromis pour un lien qu'on envoie
 * à cinq amis.
 */

const ID_KEY = 'vitrine.visitor.id';
const NAME_KEY = 'vitrine.visitor.name';

/** Même motif que le serveur : `[A-Za-z0-9_-]{8,64}`. */
function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Le stockage local peut être coupé — navigation privée, réglage strict. Dans
 * ce cas le visiteur garde une identité pour la durée de la page : il peut
 * noter, il ne pourra pas revenir corriger. Mieux que de refuser l'entrée.
 */
let memoryId: string | null = null;
let memoryName = '';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : on retombe sur la mémoire de la page */
  }
}

export function visitorId(): string {
  const stored = read(ID_KEY);
  if (stored && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;

  if (!memoryId) memoryId = newId();
  write(ID_KEY, memoryId);
  return memoryId;
}

export function visitorName(): string {
  return read(NAME_KEY) ?? memoryName;
}

export function setVisitorName(name: string): void {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40);
  memoryName = clean;
  write(NAME_KEY, clean);
}
