import type { BackupManifest } from './types';

/**
 * Lire le manifeste d'une archive **dans le navigateur**, avant de l'envoyer.
 *
 * C'est ce qui permet à la confirmation de dire « 14 idées et 32 fichiers
 * seront remplacés par 12 idées et 28 fichiers » plutôt qu'une phrase vague :
 * les chiffres de gauche viennent du serveur, ceux de droite du fichier posé.
 *
 * Rien à décompresser à la main : `DecompressionStream('gzip')` est dans le
 * navigateur, et le tar est un format à en-têtes de 512 octets qu'on lit en
 * vingt lignes. `manifest.json` est la première entrée de l'archive, écrite
 * exprès en tête — on n'a donc jamais à lire au-delà des premiers kilo-octets,
 * même pour une archive d'un gigaoctet.
 *
 * En cas d'échec (navigateur sans `DecompressionStream`, archive d'un autre
 * outil), on renvoie `null` : l'écran retombe sur une confirmation sans
 * chiffres, et c'est le serveur qui tranchera la validité.
 */
const BLOCK = 512;

export async function readArchiveManifest(file: File): Promise<BackupManifest | null> {
  try {
    const head = await readGunzipped(file, 64 * 1024);
    if (head.length < BLOCK) return null;

    const name = text(head.subarray(0, 100));
    if (name !== 'manifest.json') return null;

    // Taille : champ octal de 12 octets à l'offset 124.
    const size = parseInt(text(head.subarray(124, 136)).trim(), 8);
    if (!Number.isFinite(size) || size <= 0 || BLOCK + size > head.length) return null;

    const manifest = JSON.parse(text(head.subarray(BLOCK, BLOCK + size))) as BackupManifest;
    return typeof manifest?.format === 'number' ? manifest : null;
  } catch {
    return null;
  }
}

/** Décompresse juste assez d'octets, puis coupe le flux. */
async function readGunzipped(file: File, maxBytes: number): Promise<Uint8Array> {
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    // Le reste de l'archive ne nous intéresse pas : on ne le décompresse pas.
    await reader.cancel().catch(() => {});
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Un champ de tar est du texte terminé par des zéros. */
function text(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end));
}
