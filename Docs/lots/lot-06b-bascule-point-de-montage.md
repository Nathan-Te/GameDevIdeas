# Lot 6b — La bascule de restauration sur un point de montage

Correction du défaut qui rendait `POST /api/restore` impossible en production :

```
EBUSY: resource busy or locked, rename '/app/data/files.incoming' -> '/app/data/files'
```

## 1. Ce qui n'allait pas

La bascule du lot 5 préparait `data/files.incoming` **à côté** de sa destination,
puis supprimait `data/files` et renommait le voisin à sa place. En conteneur,
`data/files` est un point de montage (`docker-compose.yml`) :

- un point de montage ne se supprime pas et ne se renomme pas — `EBUSY` ;
- `rename()` refuse aussi de **traverser** une frontière de montage — `EXDEV` —
  même quand les deux côtés sont sur le même disque.

La restauration ne pouvait donc **jamais** aboutir en production. Pire, la
marche arrière repassait par la même fonction et échouait pour la même raison :
son erreur remplaçait l'erreur d'origine, et l'instance restait avec un
`data/files.incoming` orphelin que rien n'effaçait jamais.

Trois choses en découlaient, et sont corrigées ensemble.

## 2. Ce qui est livré

### La bascule remplace le contenu, jamais le contenant

`applyReplace` (`server/src/backup.js`) prépare désormais tout **du bon côté de
la frontière** :

- le nouveau fichier de base dans le dossier de la base (`vitrine.db.incoming`),
- les nouveaux fichiers dans `data/files/.incoming/`, à l'intérieur du montage.

Puis elle échange :

- **la base bascule par `rename`**, donc atomiquement — c'est le fichier qui est
  renommé, pas le dossier qui le contient ;
- **le dossier des fichiers voit son contenu déplacé entrée par entrée** :
  l'ancien contenu part d'abord dans `data/files/.outgoing/`, le nouveau prend
  sa place ensuite. Le dossier lui-même n'est jamais touché, donc le montage
  survit.

C'est le plus atomique possible : l'identité de `data/files` doit survivre à
l'opération, donc rien ne peut remplacer son contenu d'un seul geste. Chaque
`rename` est atomique, et l'ordre choisi — vider avant de remplir — fait qu'une
interruption laisse un dossier incomplet, jamais un mélange des deux états.

`.incoming` et `.outgoing` sont des noms réservés : `walkFiles` les ignore, ils
n'entrent donc ni dans une archive ni dans un compteur de fichiers.

### Le fichier de base peut rester sur `rename` — vérifié

`docker-compose.yml` monte les **dossiers** `data/db`, `data/files` et
`data/backups`, pas le fichier `vitrine.db`. Vérifié dans le conteneur, par
`/proc/self/mountinfo` :

```
files monte   : true
db dir monte  : true
db file monte : false
```

C'est une assertion du test, pas une note de bas de page : si quelqu'un montait
un jour le fichier lui-même, le test tomberait. Et si le cas se produisait
malgré tout à l'exécution, l'`EBUSY` nu est remplacé par un message qui le
nomme et dit quoi faire (monter le dossier, pas le fichier).

### La marche arrière ne masque plus l'erreur d'origine

Quand la remise en état échoue à son tour, les deux erreurs sont nommées et le
message dit quoi faire, au lieu de laisser sortir l'`EBUSY` de la marche arrière
à la place de la panne initiale :

```
Restauration interrompue (…), et la remise en état a échoué à son tour (…).
L'instance est dans un état incertain : restaurer pre-restore-….tgz à la main,
serveur arrêté, avec « npm run restore -- --file ».
```

### Les orphelins sont nettoyés au démarrage

`cleanupRestoreStaging()` est appelée par `server/src/index.js` avant le
démarrage. Elle efface `vitrine.db.incoming`, `data/files/.incoming`,
`data/files/.outgoing` **et `data/files.incoming`** — la forme laissée par la
version du lot 5, dont une instance en production a un exemplaire par
restauration échouée. Chaque effacement est journalisé en `warn`.

C'est sans risque : ces dossiers ne contiennent que du contenu *préparé*, jamais
appliqué. Le contenu vivant n'a pas bougé — la bascule s'était arrêtée avant.

### Le mode `merge` et `npm run restore`

- **`merge` n'avait pas le défaut en propre** : il copie fichier par fichier
  dans `data/files` et ne renomme jamais le dossier. Il l'avait par sa **marche
  arrière**, qui passe par `applyReplace`. Vérifié dans le conteneur, avant et
  après : le test `merge` était le seul des trois à passer avec l'ancienne
  bascule.
- **`npm run restore` partage le même code** et n'a pas de bascule à lui. Les
  deux modes ont quand même été exercés en ligne de commande dans le conteneur,
  parce que « c'est le même code » est exactement le raisonnement qui a laissé
  passer le défaut d'origine.

## 3. Le test qui manquait

`server/test/restore-mountpoint.test.js`, six tests, lancés par :

```bash
npm run test:container
```

Le script (`scripts/test-container.sh`) construit **l'image de production** et y
lance ce fichier avec trois volumes Docker **nommés** montés sur
`/app/data/db`, `/app/data/files` et `/app/data/backups`. Les volumes sont
propres au script et détruits après : `./data` n'est jamais monté, la base de
travail de Nathan n'est pas touchée.

**Pourquoi un volume Docker et pas `mount --bind`** : le poste de développement
est sous Windows, où `mount --bind` n'existe pas. Du point de vue du noyau, un
volume nommé et un montage lié sont le même objet — une entrée de `mountinfo`,
une frontière que `rename` refuse — et c'est cette frontière que le test veut.

**Le garde-fou** : hors montage, la suite se saute avec un message qui dit quoi
lancer. Mais le lanceur pose `VITRINE_REQUIRE_MOUNT_TEST=1`, et sous cette
variable le fichier **échoue** au lieu de se sauter. Sans ça, une erreur de
volume rendrait la suite verte en ne testant rien — c'est précisément la forme
du défaut qu'on corrige.

Ce que couvrent les six tests : le décor (les dossiers sont montés, le fichier
de base ne l'est pas), `replace`, la marche arrière, `merge`, le nettoyage des
orphelins sous ses trois formes, et l'absence des dossiers de bascule dans une
archive. Chacun vérifie en plus qu'aucun orphelin ne reste et que le dossier est
**toujours un point de montage** — s'il avait été remplacé par un dossier
ordinaire, la restauration aurait écrit à côté du volume et tout aurait disparu
au redémarrage suivant, sans erreur.

## 4. Ce qui a été vérifié, et comment

| Vérification | Résultat |
|---|---|
| Reproduction du défaut, ancien code, dans le conteneur | `ECHEC -> EBUSY … rename '/app/data/files.incoming' -> '/app/data/files'`, orphelin présent |
| Le même scénario, code corrigé | restauration réussie, aucun orphelin |
| `npm run test:container` | 6 / 6 |
| La suite face à une **régression** de la bascule (ancienne version réinjectée, exports gardés) | 2 échecs sur 6 — `replace` et la marche arrière |
| `npm run backup` puis `npm run restore` (`replace` et `merge`) dans le conteneur | les deux passent, aucun orphelin |
| `POST /api/restore` de bout en bout sur le conteneur qui tourne | 200 ; 3 idées → 2, l'idée hors archive disparaît, aucun `.incoming` dans `/app/data` |
| `npm test` (local) | 148 / 148 |

Le quatrième point est le plus important : il montre que le test attrape le
défaut, et pas seulement l'absence d'un export.

## 5. Les dépendances ajoutées et pourquoi

Aucune.

## 6. Les points laissés ouverts

- **Le nettoyage des orphelins n'a lieu qu'au démarrage du serveur.** Une
  restauration en ligne de commande qui échoue laisse ses dossiers jusqu'au
  redémarrage suivant. Acceptable — `npm run restore` se lance serveur arrêté,
  donc le redémarrage suit de près.
- **La fenêtre entre les deux boucles de déplacement n'est pas couverte par une
  transaction.** Une coupure de courant pile là laisse `data/files` incomplet et
  son contenu d'avant dans `.outgoing`, à côté. Rien ne le remet automatiquement
  en place aujourd'hui : le nettoyage au démarrage l'efface. Un relèvement
  automatique demanderait un journal d'intention sur le disque ; à arbitrer si
  le cas se présente, la sauvegarde de sécurité couvrant déjà la perte.
- **Seule cette suite tourne dans le conteneur.** Les autres tests n'ont pas
  besoin d'un point de montage, mais la règle ajoutée au `CLAUDE.md` vaut pour
  toute livraison qui touche au disque : c'est à cette suite qu'il faudra
  ajouter les cas suivants.

## 7. Vérification manuelle

1. `npm test` — 148 verts.
2. `npm run test:container` — 6 verts, Docker démarré (le script construit
   l'image et détruit ses volumes en sortant).
3. **Sur le serveur**, une fois l'image reconstruite : `/sauvegarde`, déposer une
   archive, mode **Remplacer**. La restauration doit aboutir et le catalogue
   afficher le contenu de l'archive.
4. Toujours sur le serveur, vérifier qu'il ne reste rien :
   `ls -a /app/data` et `ls -a /app/data/files` — aucun `.incoming`,
   aucun `.outgoing`. Les orphelins laissés par les tentatives précédentes
   auront été effacés au premier démarrage, avec une ligne `warn` dans le
   journal du conteneur.
