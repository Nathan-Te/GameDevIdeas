# Lot 6 — Peuplement : les quatorze fiches et l'archive à transporter

Ce lot n'ajoute aucune fonctionnalité. Il remplit l'instance locale avec les
quatorze idées de `Docs/fiches-vitrine-14.md` et produit l'archive que Nathan
restaurera sur son serveur. Aucun fichier de `server/` ni de `web/` n'a été
touché.

## 1. Ce qui est livré

### `scripts/seed-ideas.mjs`

Lit `Docs/fiches-vitrine-14.md` et crée les idées **par l'API HTTP**, jamais par
écriture directe en base : les validations, la dérivation du slug et les
compteurs empruntent le même chemin que l'usage normal. Une insertion SQL aurait
pu produire des lignes qu'aucune route n'aurait acceptées, et le bug ne se
serait vu qu'à la lecture.

```bash
node scripts/seed-ideas.mjs [--url http://localhost:3000] [--file <md>] [--dry-run]
```

- **Idempotent** : les idées sont repérées par leur **titre**, corbeille
  comprise — une idée mise à la corbeille porte toujours son titre, en recréer
  une du même nom serait un doublon déguisé. Relancé, le script met à jour les
  champs qui diffèrent et n'écrit rien si tout concorde.
- `--dry-run` affiche les créations et les champs qui changeraient, sans écrire.
- Si rien n'écoute sur `--url`, il s'arrête avant toute écriture avec le message
  qui dit quoi faire (démarrer l'instance, ou corriger l'URL).

### Les familles

Le script **ne crée aucune famille**. Il lit `GET /api/families`, compare aux
familles citées par les fiches et s'arrête en listant les manquantes. Les cinq
familles utilisées — `friendslop`, `dopamine-solo`, `inspection`, `tactique`,
`sim-fantasme` — étaient déjà là, peuplées au démarrage par le lot 4.

### Les quatorze idées

Créées sans verdict et sans pièce jointe : les notes et les capsules sont le
travail de Nathan. La page store affiche donc « Pas encore d'évaluation », qui
est l'état voulu pour juger.

| # | Titre | Slug | Famille | Prix |
|---|---|---|---|---|
| 1 | La Battue | `la-battue` | friendslop | 8,00 € |
| 2 | Contre-Visite | `contre-visite` | inspection | 12,00 € |
| 3 | Lignes de Vue | `lignes-de-vue` | tactique | 15,00 € |
| 4 | Maison Piégée | `maison-piegee` | dopamine-solo | 8,00 € |
| 5 | Tournée | `tournee` | dopamine-solo | 8,00 € |
| 6 | Alambic | `alambic` | sim-fantasme | 15,00 € |
| 7 | Treuil | `treuil` | friendslop | 10,00 € |
| 8 | Capsule | `capsule` | friendslop | 10,00 € |
| 9 | Galion | `galion` | friendslop | 10,00 € |
| 10 | Compagnie | `compagnie` | friendslop | 10,00 € |
| 11 | Dresseurs | `dresseurs` | friendslop | 10,00 € |
| 12 | Grammaire | `grammaire` | friendslop | 10,00 € |
| 13 | Ricochets | `ricochets` | dopamine-solo | 5,00 € |
| 14 | Comptoir | `comptoir` | friendslop | 12,00 € |

Les quatorze sont au statut `idee`. Les slugs sont ceux que l'API a dérivés des
titres ; le script ne les force pas.

## 2. Les choix faits

- **Le repérage se fait par titre, pas par slug.** Un slug se renomme depuis la
  fiche ; un titre modifié par Nathan ferait, lui, recréer l'idée par le script.
  C'est le compromis assumé : le script sert à poser un état initial, pas à
  synchroniser en continu un fichier et une base.
- **La parenthèse de fin de titre part en fin de pitch**, telle quelle, entre
  parenthèses. La règle est écrite pour tous les titres, pas seulement pour la
  fiche 13 : un cas particulier codé en dur sur un numéro de fiche aurait été
  invisible à la relecture suivante.
- **Un champ absent reste vide.** Le script ne complète rien. En pratique, les
  quatorze fiches donnent les huit champs, donc rien n'est resté vide.
- **La mise à jour est un diff, pas un écrasement.** Le `PATCH` ne porte que les
  champs qui diffèrent, ce qui rend la relance lisible : elle dit quel champ a
  bougé, ou ne dit rien.
- **Aucune dépendance ajoutée.** Le script n'utilise que `node:fs/promises`,
  `node:path`, `node:url` et le `fetch` natif.

## 3. Les dépendances ajoutées et pourquoi

Aucune.

## 4. L'archive

```
data/backups/vitrine-2026-09-05-1606.tgz     10 751 octets (10,5 Kio)
```

Elle n'est pas commitée : `data/` est dans `.gitignore`. Son `manifest.json`,
première entrée de l'archive :

```json
{
  "format": 1,
  "created_at": "2026-09-05T14:06:18.651Z",
  "schema_version": "005-trailer",
  "counts": { "ideas": 14, "verdicts": 0, "attachments": 0, "families": 10 },
  "files": { "count": 0, "total_bytes": 0 },
  "hashes": { "vitrine.db": "5e7d5b1745e8e72c28c8097b19561a930bc9e7256f66a1cef56cb8a82c07fdc6" }
}
```

Zéro fichier utilisateur : aucune capsule ni bande-annonce n'a été déposée. Les
dix familles sont les dix familles seedées par le lot 4, cinq utilisées et cinq
en réserve.

## 5. Les écarts constatés

Listés, non corrigés en silence.

1. **`npm run backup -- --out data/backups` n'écrit pas dans `data/backups`.**
   La commande documentée dans `CLAUDE.md` passe par
   `npm run backup --workspace server`, dont le répertoire courant est
   `server/` : le chemin relatif `data/backups` y est résolu, et l'archive
   atterrit dans `server/data/backups/`. Les chemins de `config.js` (base,
   fichiers, dossier d'archives par défaut) sont eux résolus depuis la racine du
   dépôt, donc **la bonne base a bien été lue** — seule la destination glissait.
   L'archive livrée a donc été produite par `npm run backup` **sans `--out`**,
   qui utilise `config.backupsDir`, c'est-à-dire `<racine>/data/backups`. Le
   `server/data/` créé par le premier essai a été supprimé.
   *Correctif possible, hors périmètre de ce lot : résoudre `--out` depuis
   `repoRoot` dans `backup-cli.js`, ou corriger la commande documentée.*
2. **Le brief annonce « quatre familles » puis en liste cinq.** Cinq familles
   sont bien utilisées par les fiches ; les cinq existaient, rien n'a manqué.
3. **Le préambule du fichier de fiches n'est pas une fiche.** La ligne « Far
   West et 3 h du matin sont sortis de la pile » précède le premier `##` : elle
   n'est pas lue, et aucune idée n'a été créée pour ces deux titres.
4. **Aucune valeur n'a été retouchée par l'API.** Les huit champs relus par
   `GET /api/ideas/:slug` sont identiques à ceux du fichier — la relance du
   script rapporte « 14 inchangées », ce qui est exactement cette égalité,
   vérifiée mécaniquement plutôt que de visu.

## 6. Les points laissés ouverts

- Les verdicts et les pièces jointes restent à faire par Nathan, idée par idée.
- La famille de Ricochets est provisoire : la fiche dit que « le verbe reste à
  confirmer », le pitch le porte, et l'idée est rangée en `dopamine-solo` en
  attendant.
- Le script ne supprime jamais. Une idée retirée du fichier de fiches reste dans
  l'application ; c'est volontaire, mais ça veut dire que le fichier n'est pas
  un miroir de la base.

## 7. Vérification manuelle

Ce que Nathan clique lui-même :

1. **En local**, `npm start`, puis ouvrir <http://localhost:5173> ou
   <http://localhost:3000> : le catalogue montre **quatorze** idées, chacune
   avec sa famille et son prix.
2. Ouvrir deux ou trois pages store (`/idees/alambic/steam`,
   `/idees/ricochets/steam`) : accroche et pitch sont ceux du fichier, le prix
   est le bon, l'encart d'évaluation dit « Pas encore d'évaluation ».
3. Filtrer le catalogue par famille : `friendslop` en donne huit,
   `dopamine-solo` trois, les trois autres une chacune.
4. Relancer `node scripts/seed-ideas.mjs` : il affiche « 14 inchangées » et le
   catalogue en compte toujours quatorze.
5. `npm test` : 148 tests verts (aucun code applicatif n'a bougé).

### Transporter l'archive sur le serveur

1. Récupérer `data/backups/vitrine-2026-09-05-1606.tgz` sur la machine locale.
2. Sur le serveur, ouvrir `/sauvegarde`, bloc **Restaurer**.
3. Déposer l'archive, choisir le mode **Remplacer**.
4. La confirmation compte les idées et les fichiers de part et d'autre :
   vérifier qu'elle annonce bien **14 idées** et **0 fichier** dans l'archive.
   *En mode Remplacer, tout ce que contient l'instance serveur est écrasé.* Une
   sauvegarde de sécurité est posée automatiquement avant la bascule.
5. Confirmer, puis recharger le catalogue : quatorze idées, aucun verdict.
