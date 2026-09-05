import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { createArchive, restoreArchive } from '../src/backup.js';

import { makeInstance, seedContent } from './backup-helpers.js';

/**
 * Une sauvegarde qui perdrait les avis d'amis serait une sauvegarde qui ment.
 * Ce fichier fait l'aller-retour complet — sélections, avis, listes de souhaits
 * d'invités — dans les deux modes, `replace` et `merge`.
 */

/** Une sélection, deux avis et une mise en liste de souhaits, sur une instance. */
function seedSharing(db, filesDir) {
  const ideaId = seedContent(db, filesDir, { slug: 'idee-partagee', files: 1 });

  const shareId = Number(
    db
      .prepare(
        `INSERT INTO shares (token, label, reviews_visible, created_at)
         VALUES ('jeton-de-test-aaaaaaaaaaaaaaaaaaaaaaaa', 'Les copains', 1, '2026-09-01T10:00:00.000Z')`,
      )
      .run().lastInsertRowid,
  );

  db.prepare('INSERT INTO share_ideas (share_id, idea_id, position) VALUES (?, ?, 0)')
    .run(shareId, ideaId);

  db.prepare(
    `INSERT INTO reviews (idea_id, share_id, author_name, score, note, created_at, visitor_id, ip_hash)
     VALUES (?, ?, 'Léo', 4, 'Très bonne idée.', '2026-09-02T10:00:00.000Z', 'visiteur-aaaaaaaa', 'abc')`,
  ).run(ideaId, shareId);

  db.prepare(
    `INSERT INTO reviews (idea_id, share_id, author_name, score, note, created_at, visitor_id, ip_hash)
     VALUES (?, ?, 'Manon', 2, 'Bof.', '2026-09-03T10:00:00.000Z', 'visiteur-bbbbbbbb', 'def')`,
  ).run(ideaId, shareId);

  db.prepare(
    `INSERT INTO share_wishlists (share_id, idea_id, visitor_id, created_at)
     VALUES (?, ?, 'visiteur-aaaaaaaa', '2026-09-02T10:05:00.000Z')`,
  ).run(shareId, ideaId);

  return { ideaId, shareId };
}

/** Ce qu'un aller-retour doit laisser identique, avis compris. */
const sharingFingerprint = (db) => ({
  shares: db.prepare('SELECT token, label, reviews_visible FROM shares ORDER BY id').all(),
  selection: db
    .prepare(
      `SELECT i.slug, si.position FROM share_ideas si
       JOIN ideas i ON i.id = si.idea_id ORDER BY si.position`,
    )
    .all(),
  reviews: db
    .prepare('SELECT author_name, score, note, visitor_id FROM reviews ORDER BY id')
    .all(),
  wishlists: db
    .prepare(
      `SELECT i.slug, w.visitor_id FROM share_wishlists w
       JOIN ideas i ON i.id = w.idea_id ORDER BY w.rowid`,
    )
    .all(),
});

describe('aller-retour d’une archive avec partages et avis', () => {
  test('le manifeste compte les sélections et les avis', async (t) => {
    const instance = makeInstance(t);
    seedSharing(instance.db, instance.filesDir);

    const archive = await createArchive({ ...instance, outDir: instance.backupsDir });

    assert.equal(archive.manifest.counts.shares, 1);
    assert.equal(archive.manifest.counts.reviews, 2);
  });

  test('restaurer en remplacement rend tout, à l’identique', async (t) => {
    const source = makeInstance(t);
    seedSharing(source.db, source.filesDir);
    const avant = sharingFingerprint(source.db);

    const archive = await createArchive({ ...source, outDir: source.backupsDir });

    const cible = makeInstance(t);
    await restoreArchive({ archivePath: archive.path, mode: 'replace', ...cible });

    assert.deepEqual(sharingFingerprint(cible.db), avant);
    // Et les verdicts n'ont pas été confondus avec les avis en chemin.
    assert.equal(cible.db.prepare('SELECT COUNT(*) AS n FROM verdicts').get().n, 1);
  });

  test('fusionner ajoute les sélections et les avis sans écraser les existants', async (t) => {
    const source = makeInstance(t);
    seedSharing(source.db, source.filesDir);
    const archive = await createArchive({ ...source, outDir: source.backupsDir });

    // La cible a déjà sa vie : une idée, une sélection, un avis.
    const cible = makeInstance(t);
    const { shareId } = seedSharing(cible.db, cible.filesDir);

    const result = await restoreArchive({ archivePath: archive.path, mode: 'merge', ...cible });

    assert.equal(result.merged.shares, 1);
    assert.equal(result.merged.reviews, 2);

    assert.equal(cible.db.prepare('SELECT COUNT(*) AS n FROM shares').get().n, 2);
    assert.equal(cible.db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n, 4);
    assert.equal(cible.db.prepare('SELECT COUNT(*) AS n FROM share_wishlists').get().n, 2);

    // Le jeton était pris : la sélection fusionnée en a reçu un neuf, et celui
    // déjà distribué par la cible n'a pas changé de propriétaire.
    const tokens = cible.db.prepare('SELECT token FROM shares ORDER BY id').all();
    assert.equal(tokens[0].token, 'jeton-de-test-aaaaaaaaaaaaaaaaaaaaaaaa');
    assert.notEqual(tokens[1].token, tokens[0].token);
    assert.match(tokens[1].token, /^[A-Za-z0-9_-]{43}$/);

    // Chaque sélection ne pointe que ses propres idées.
    const paires = cible.db
      .prepare('SELECT share_id, idea_id FROM share_ideas ORDER BY share_id')
      .all();
    assert.equal(paires.length, 2);
    assert.notEqual(paires[0].idea_id, paires[1].idea_id);
    assert.equal(paires[0].share_id, shareId);
  });

  test('un avis fusionné suit son idée, pas un numéro', async (t) => {
    const source = makeInstance(t);
    seedSharing(source.db, source.filesDir);
    const archive = await createArchive({ ...source, outDir: source.backupsDir });

    // La cible a d'autres idées avant : les numéros ne coïncideront pas.
    const cible = makeInstance(t);
    seedContent(cible.db, cible.filesDir, { slug: 'autre-idee', files: 0 });
    seedContent(cible.db, cible.filesDir, { slug: 'encore-une', files: 0 });

    await restoreArchive({ archivePath: archive.path, mode: 'merge', ...cible });

    const attaches = cible.db
      .prepare(
        `SELECT i.slug, r.author_name FROM reviews r
         JOIN ideas i ON i.id = r.idea_id ORDER BY r.id`,
      )
      .all();

    assert.deepEqual(attaches, [
      { slug: 'idee-partagee', author_name: 'Léo' },
      { slug: 'idee-partagee', author_name: 'Manon' },
    ]);
  });
});
