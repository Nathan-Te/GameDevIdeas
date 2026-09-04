import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRecommended,
  RELEASE_KIND,
  releaseDate,
  reviewSummary,
  shortDescription,
  similarTitles,
  storeFeatures,
  storeGenre,
  STORE_TAGS,
  storePrice,
  storeTags,
} from '../../shared/store-model.js';
import { FAMILIES, STATUSES } from '../src/schemas.js';

/**
 * Le modèle store est du JavaScript pur partagé avec le front : il se teste
 * ici, sans monter de page. Ces tests couvrent la table de traduction des
 * familles, la dérivation de la date de parution et celle du libellé
 * d'évaluation — les trois endroits où la vue invente à partir des champs.
 */

test('chaque famille du seed a au moins deux étiquettes de magasin', () => {
  for (const family of FAMILIES) {
    const tags = storeTags(family);
    assert.ok(
      Array.isArray(tags) && tags.length >= 2,
      `la famille « ${family} » doit avoir au moins deux étiquettes`,
    );
    assert.ok(
      tags.every((tag) => typeof tag === 'string' && tag.trim().length > 0),
      `la famille « ${family} » a une étiquette vide`,
    );
    assert.equal(new Set(tags).size, tags.length, `« ${family} » répète une étiquette`);
  }
});

test('la table des étiquettes ne couvre que les familles du seed', () => {
  assert.deepEqual(Object.keys(STORE_TAGS).sort(), [...FAMILIES].sort());
});

test('une famille inconnue retombe sur des étiquettes plutôt que sur du vide', () => {
  assert.ok(storeTags('famille-jamais-vue').length >= 2);
});

test('le genre est la paire de tête des étiquettes', () => {
  assert.equal(storeGenre('fps'), 'FPS, Action');
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

test('les fonctionnalités mentionnent toujours la manette', () => {
  for (const family of FAMILIES) {
    assert.ok(storeFeatures(family).includes('manette'), `« ${family} » perd le support manette`);
  }
});

test('les familles sociales listent la coop, les autres le solo', () => {
  assert.deepEqual(storeFeatures('friendslop'), ['coop', 'multi', 'manette']);
  assert.deepEqual(storeFeatures('party'), ['coop', 'multi', 'manette']);
  assert.deepEqual(storeFeatures('dopamine-solo'), ['solo', 'manette']);
  assert.deepEqual(storeFeatures('inspection'), ['solo', 'manette']);
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
