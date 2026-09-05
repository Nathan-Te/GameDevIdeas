import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FAMILY_FEATURES,
  friendReviewSummary,
  friendScoreAverage,
  isRecommended,
  RELEASE_KIND,
  releaseDate,
  reviewSummary,
  SEED_FAMILIES,
  shortDescription,
  similarTitles,
  storeFeatures,
  storeGenre,
  storePrice,
  storeTags,
} from '../../shared/store-model.js';
import { STATUSES } from '../src/schemas.js';

/**
 * Le modèle store est du JavaScript pur partagé avec le front : il se teste
 * ici, sans monter de page. Ces tests couvrent la lecture de la famille, la
 * dérivation de la date de parution et celle du libellé d'évaluation — les
 * trois endroits où la vue invente à partir des champs.
 *
 * Depuis le lot 4, les étiquettes et les fonctionnalités ne sont plus une table
 * codée en dur mais des colonnes de la famille : le modèle reçoit la ligne de
 * `families` telle que l'API la sert, et `SEED_FAMILIES` n'est plus qu'un
 * peuplement initial.
 */

test('les étiquettes et le genre sont lus sur la famille fournie', () => {
  const family = { store_tags: ['Tir', 'Action', 'Coop'], features: [] };

  assert.deepEqual(storeTags(family), ['Tir', 'Action', 'Coop']);
  assert.equal(storeGenre(family), 'Tir, Action');
});

test('une famille absente ou sans étiquette retombe sur un repli plutôt que sur du vide', () => {
  for (const family of [null, undefined, {}, { store_tags: [] }, { store_tags: 'Action' }]) {
    const tags = storeTags(family);
    assert.ok(Array.isArray(tags) && tags.length >= 2, `repli manquant pour ${JSON.stringify(family)}`);
  }
});

test('chaque famille du seed a au moins deux étiquettes de magasin', () => {
  for (const family of SEED_FAMILIES) {
    const tags = storeTags(family);
    assert.ok(tags.length >= 2, `la famille « ${family.slug} » doit avoir au moins deux étiquettes`);
    assert.ok(
      tags.every((tag) => typeof tag === 'string' && tag.trim().length > 0),
      `la famille « ${family.slug} » a une étiquette vide`,
    );
    assert.equal(new Set(tags).size, tags.length, `« ${family.slug} » répète une étiquette`);
  }
});

test('le seed n’emploie que des fonctionnalités connues, et un slug unique par famille', () => {
  const slugs = SEED_FAMILIES.map((family) => family.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'un slug de famille est répété dans le seed');

  for (const family of SEED_FAMILIES) {
    assert.ok(family.label.trim(), `la famille « ${family.slug} » n’a pas de libellé`);
    for (const feature of family.features) {
      assert.ok(FAMILY_FEATURES.includes(feature), `fonctionnalité inconnue : ${feature}`);
    }
  }
});

test('chaque statut du seed a une date de parution', () => {
  for (const status of STATUSES) {
    assert.ok(RELEASE_KIND[status], `le statut « ${status} » n’a pas de nature de parution`);
    const label = releaseDate(status, '2026-03-14T10:00:00.000Z');
    assert.ok(typeof label === 'string' && label.length > 0, `« ${status} » n’a pas de libellé`);
  }
});

test('la date de parution suit le statut', () => {
  const updated = '2026-03-14T10:00:00.000Z';

  assert.equal(releaseDate('idee', updated), 'À venir');
  assert.equal(releaseDate('reserve', updated), 'À venir');
  assert.equal(releaseDate('pause', updated), 'À venir');
  assert.equal(releaseDate('abandonne', updated), 'À venir');
  assert.equal(releaseDate('prototype', updated), 'Accès anticipé');
  assert.equal(releaseDate('en-cours', updated), 'Accès anticipé');
  assert.match(releaseDate('publie', updated), /2026/);
});

test('un statut publié sans date lisible retombe sur « À venir »', () => {
  assert.equal(releaseDate('publie', undefined), 'À venir');
  assert.equal(releaseDate('publie', 'pas une date'), 'À venir');
});

test('chaque score a son libellé d’évaluation, et l’absence de verdict aussi', () => {
  const attendu = {
    5: 'Extrêmement positives',
    4: 'Très positives',
    3: 'Plutôt positives',
    2: 'Moyennes',
    1: 'Plutôt négatives',
    0: 'Négatives',
  };

  for (const [score, label] of Object.entries(attendu)) {
    assert.equal(reviewSummary(Number(score)).label, label);
  }

  assert.equal(reviewSummary(null).label, 'Pas encore d’évaluation');
  assert.equal(reviewSummary(null).tone, 'none');
  assert.equal(reviewSummary(undefined).tone, 'none');
});

test('la teinte du libellé suit le score', () => {
  assert.equal(reviewSummary(5).tone, 'positive');
  assert.equal(reviewSummary(3).tone, 'positive');
  assert.equal(reviewSummary(2).tone, 'mixed');
  assert.equal(reviewSummary(1).tone, 'negative');
  assert.equal(reviewSummary(0).tone, 'negative');
});

test('un avis est recommandé à partir de 3 sur 5', () => {
  assert.equal(isRecommended(3), true);
  assert.equal(isRecommended(5), true);
  assert.equal(isRecommended(2), false);
  assert.equal(isRecommended(0), false);
  assert.equal(isRecommended(null), false);
});

test('les fonctionnalités mentionnent toujours la manette, même sans famille', () => {
  for (const family of [...SEED_FAMILIES, null, {}, { features: [] }]) {
    assert.ok(storeFeatures(family).includes('manette'), 'le support manette a disparu');
  }
});

test('les fonctionnalités sont celles de la famille, dans son ordre', () => {
  assert.deepEqual(storeFeatures({ features: ['coop-online', 'multiplayer'] }), [
    'coop-online',
    'multiplayer',
    'manette',
  ]);
  assert.deepEqual(storeFeatures({ features: ['solo'] }), ['solo', 'manette']);
  assert.deepEqual(storeFeatures({ features: ['local-coop'] }), ['local-coop', 'manette']);
});

test('une fonctionnalité inconnue posée en base est ignorée, pas affichée', () => {
  // La colonne est du JSON : une valeur d'un ancien schéma ne doit pas se
  // retrouver dans la colonne de droite de la vue store sous forme de « undefined ».
  assert.deepEqual(storeFeatures({ features: ['solo', 'vr', 'coop'] }), ['solo', 'manette']);
});

test('le prix absent ou nul s’affiche « Gratuit »', () => {
  assert.equal(storePrice(null), 'Gratuit');
  assert.equal(storePrice(undefined), 'Gratuit');
  assert.equal(storePrice(0), 'Gratuit');
  assert.match(storePrice(1999), /19/);
});

test('la concurrence se découpe sur les virgules, points-virgules et retours', () => {
  assert.deepEqual(similarTitles('Overcooked, Moving Out ; Unrailed\nPico Park'), [
    'Overcooked',
    'Moving Out',
    'Unrailed',
    'Pico Park',
  ]);
  assert.deepEqual(similarTitles(''), []);
  assert.deepEqual(similarTitles(null), []);
  assert.deepEqual(similarTitles(' , ; '), []);
});

test('la courte description colle l’accroche au pitch et tronque sur un mot entier', () => {
  assert.equal(shortDescription('Une accroche.', 'Un pitch.'), 'Une accroche. Un pitch.');
  assert.equal(shortDescription('', 'Un pitch.'), 'Un pitch.');
  assert.equal(shortDescription(null, null), '');

  const long = shortDescription('a'.repeat(40), 'mot '.repeat(40), 60);
  assert.ok(long.endsWith('…'));
  assert.ok(long.length <= 61);
  assert.ok(!long.includes('  '), 'la troncature ne doit pas couper au milieu d’un mot');
});

test('la moyenne des avis d’amis ignore le vide et arrondit au libellé le plus proche', () => {
  assert.equal(friendScoreAverage([]), null);
  assert.equal(friendScoreAverage(null), null);
  assert.equal(friendScoreAverage([{ score: 2 }, { score: 4 }]), 3);

  assert.equal(friendReviewSummary([]).tone, 'none');
  assert.equal(friendReviewSummary([{ score: 5 }, { score: 5 }]).label, 'Extrêmement positives');
  // 3,5 arrondit à 4 : « Très positives », comme un magasin qui n'affiche pas de décimale.
  assert.equal(friendReviewSummary([{ score: 3 }, { score: 4 }]).label, 'Très positives');
});

test('un verdict n’entre jamais dans la moyenne des amis', () => {
  // La fonction ne connaît que des scores : elle ne peut pas lire un verdict.
  // Ce test fige l'interface — si un jour on lui passait une idée entière, il
  // faudrait le réécrire, et c'est précisément le moment où il faut réfléchir.
  const avis = [{ score: 1 }, { score: 1 }];
  assert.equal(friendScoreAverage(avis), 1);
  assert.equal(friendReviewSummary(avis).tone, 'negative');
});
