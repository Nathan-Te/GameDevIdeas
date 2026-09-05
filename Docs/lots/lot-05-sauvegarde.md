# Lot 5 — Sauvegarde et restauration

Dernier lot avant la mise en production. Nathan doit pouvoir sauvegarder et restaurer ses données sans réfléchir et sans SSH : une archive contient tout, se télécharge depuis le navigateur, se produit aussi en ligne de commande pour le cron, et se réimporte sur une instance vide comme sur une instance déjà peuplée.

La contrainte de fond du lot tient en une phrase : **la base est en WAL, donc une copie du fichier vivant peut être corrompue**. Toute lecture de la base pour sauvegarde passe par `db.backup()`, l'API de sauvegarde en ligne de SQLite.

---

## 1. Ce qui est livré

### Le format d'archive

Un `.tgz` nommé `vitrine-YYYY-MM-DD-HHmm.tgz` (heure locale, celle que Nathan lit), avec trois entrées et pas une de plus :

- **`manifest.json`** — `format` (1), `created_at`, `schema_version` (la dernière migration appliquée), les compteurs (idées, verdicts, pièces jointes, familles), la taille totale des fichiers, et un **hachage SHA-256 par fichier**, base comprise.
- **`vitrine.db`** — la copie produite par `db.backup()` dans un dossier temporaire. Jamais le fichier vivant.
- **`files/`** — l'arborescence de `data/files/` telle quelle.

Lisible à la main : `tar tzf archive.tgz`, `tar xzOf archive.tgz manifest.json`. Pas de format maison, pas de chiffrement. Le tar est écrit en mode `portable` (ni uid/gid ni dates de création), donc deux sauvegardes du même état donnent le même contenu.

### Sauvegarde

- **`GET /api/backup/preview`** — compteurs et taille estimée (avant compression : l'annoncer compressée demanderait de compresser, donc de faire l'archive). Ne produit rien.
- **`POST /api/backup`** — produit l'archive dans un dossier temporaire, la renvoie en flux avec `Content-Disposition: attachment` et un `Content-Length` (sans lui, pas de barre de progression au téléchargement), et efface le temporaire à la fermeture du flux — fin normale, erreur, ou onglet refermé en cours de route.
- **Verrou en mémoire** : une sauvegarde et une restauration ne se croisent pas. La seconde est refusée en 409, avec un message qui nomme celle qui est en cours.

### Restauration

`POST /api/restore`, en multipart (`mode` est un champ du même formulaire). Le déroulé est strict et ne dévie pas :

1. extraction dans un dossier temporaire, en refusant tout chemin absolu, tout segment `..` et toute entrée qui n'est pas l'une des trois attendues ;
2. lecture et vérification du manifeste — format connu, base déclarée, chaque fichier annoncé présent, chaque hachage conforme. **Tout écart interrompt ici, avant que quoi que ce soit n'ait été touché** ;
3. ouverture de la base extraite et exécution des migrations manquantes **dessus** : une archive plus ancienne est acceptée, une archive plus récente que le code est refusée en 409 avec le numéro des migrations inconnues ;
4. **sauvegarde de sécurité** de l'état actuel dans `data/backups/pre-restore-<date>.tgz` ;
5. bascule : base et `data/files/` remplacés (mode `replace`), ou contenu ajouté (mode `merge`) ;
6. vérification : `PRAGMA integrity_check` et `foreign_key_check`.

Si une étape échoue **après** la bascule, la sauvegarde de sécurité est ré-appliquée automatiquement et le message d'erreur le dit, en nommant l'archive utilisée.

Le mode `merge` sert à réunir deux instances : les idées de l'archive s'ajoutent (slug suffixé en cas de collision, `partagee` → `partagee-2`), les familles absentes sont créées, les familles existantes ne sont pas modifiées, les fichiers sont recopiés sous le nouvel identifiant d'idée. **Il ne supprime jamais rien.**

### Ligne de commande

- `npm run backup -- --out <dossier> [--keep N]` — la même archive, sans passer par HTTP. Serveur arrêté comme serveur démarré.
- `npm run restore -- --file <archive> [--merge] [--yes]` — la même restauration, avec confirmation interactive sauf `--yes`. À lancer serveur arrêté.
- `backup.sh` à la racine, exécutable : archive dans `data/backups/`, rotation à 30, une ligne de log horodatée. La ligne de crontab (`0 3 * * *`) est dans le README.

Les deux scripts **appellent** `server/src/backup.js`, ils ne le réimplémentent pas : une archive du cron et une archive téléchargée depuis le navigateur sont interchangeables par construction.

### Rotation et archives locales

`data/backups/` est créé au démarrage, monté comme volume par `docker-compose`, et **exclu du contenu des archives** — une sauvegarde ne contient jamais les sauvegardes, sinon chacune pèse la somme des précédentes. `GET /api/backups` les liste, `DELETE /api/backups/:name` en supprime une, le nom étant validé deux fois : par le schéma de la route, puis par `safeBackupName` avant de toucher au disque.

### Front — `/sauvegarde`

Trois blocs, et un lien depuis l'en-tête du catalogue à côté de la corbeille.

- **Sauvegarder** : ce que contient l'archive (compteurs de `preview`, taille estimée) et le bouton de téléchargement avec sa barre de progression.
- **Restaurer** : zone de dépôt du `.tgz`, choix `Remplacer` / `Fusionner` avec une phrase qui dit ce que chacun fait, et une confirmation qui répète en clair ce qui va se passer — « 14 idée(s) et 32 fichier(s) seront remplacés par 12 idée(s) et 28 fichier(s) ». Après restauration réussie : retour au catalogue avec un message.
- **Sauvegardes sur le serveur** : la liste avec date, taille et suppression.

### Tests (`node:test`) — 123 → 148, tous verts

`backup.test.js` (le cœur) : manifeste conforme et hachages justes, base extraite ouvrable et complète, `data/backups/` absent du contenu, deux archives dans la même minute qui ne s'écrasent pas ; aller-retour complet avec égalité des compteurs **et des hachages de fichiers** ; archive d'un schéma antérieur migrée puis restaurée ; archive postérieure refusée en 409 ; cinq façons d'abîmer une archive (manifeste absent, illisible, format inconnu, hachage faux, fichier annoncé manquant) qui laissent toutes l'instance courante intacte, vérifiée par empreinte ; `merge` (aucune suppression, collision suffixée, famille absente créée, famille existante intacte, fichiers présents sous le nouvel identifiant) ; échec simulé après la bascule qui remet la sauvegarde de sécurité ; cohérence WAL — une sauvegarde produite pendant 300 insertions donne une base qui passe `integrity_check`.

`backup-api.test.js` (les routes) : `preview` qui ne produit rien, archive téléchargeable (signature gzip, `Content-Length` juste, temporaire effacé), restauration `replace` et `merge` par multipart, mode inconnu refusé, requête non-multipart refusée, verrou dans les deux sens, liste et suppression, et trois formes de traversée de chemin sur `DELETE /api/backups/:name` qui laissent intact un fichier posé hors du dossier.

---

## 2. Les choix faits

**Le paquet `tar` de npm plutôt que le binaire système.** C'est la seule dépendance ajoutée, et elle se justifie sur trois points. Elle est en JavaScript pur au-dessus de `zlib` : rien à compiler, rien à installer sur l'hôte, et le même comportement sous Windows (où le développement se fait) et dans le conteneur Debian. Elle lit et écrit en flux, donc une archive d'un gigaoctet ne passe jamais par la mémoire. Et elle expose un `filter` à l'extraction, ce qui met la garde contre la traversée de chemin dans notre code plutôt que dans les options d'un `tar(1)` dont la version varie d'une machine à l'autre. Passer par le binaire système aurait demandé de composer une ligne de commande à partir de chemins utilisateur — exactement ce qu'on évite ailleurs dans ce projet.

**Une poignée de base, pas une connexion** (`server/src/db-handle.js`). Une restauration remplace le fichier de base sous les pieds de l'application, et `better-sqlite3` ne sait pas rouvrir une connexion fermée. Sans indirection, il aurait fallu redémarrer le serveur après chaque restauration. `app.db` est donc un `Proxy` qui transmet tout à la connexion courante et sait la remplacer : aucune route n'a changé, et le serveur sert la base restaurée dans la seconde qui suit. C'est le seul endroit du projet où une indirection de ce genre se paye, et elle se paye pour une raison précise.

**La bascule par `rename`, pas par écriture en place.** La base extraite et les fichiers sont d'abord posés à côté de leur destination (`vitrine.db.incoming`, `files.incoming`), sur le même volume, puis échangés. Les journaux `-wal` et `-shm` de l'ancienne base sont supprimés en même temps qu'elle : un `-wal` orphelin ressusciterait des pages de l'ancienne base par-dessus la nouvelle.

**La sauvegarde de sécurité est systématique, pas optionnelle.** Elle coûte le temps d'une archive et elle est la seule chose qui rende une restauration réversible. Elle est devenue une règle du projet dans `CLAUDE.md`.

**Le manifeste est lu dans le navigateur** (`web/src/archive.ts`). La confirmation devait annoncer les chiffres des deux côtés ; ceux de l'archive n'existent que dans le fichier posé. Plutôt qu'ajouter une route de « restauration à blanc », le front lit lui-même le manifeste : `manifest.json` est écrit en **première** entrée du tar, `DecompressionStream('gzip')` est dans le navigateur, et un en-tête tar tient en deux champs (nom à l'offset 0, taille en octal à l'offset 124). On ne décompresse jamais plus des premiers kilo-octets, même pour une archive d'un gigaoctet. Si la lecture échoue — navigateur trop ancien, archive d'un autre outil — la confirmation retombe sur une phrase sans chiffres et c'est le serveur qui tranche.

**Le verrou est en mémoire du processus**, donc il ne couvre que le serveur. Lancer `npm run restore` pendant qu'une restauration tourne dans le navigateur n'est pas empêché. Un verrou de fichier aurait été possible ; pour une application mono-utilisateur qu'une seule personne pilote, il aurait surtout ajouté un fichier de verrou à nettoyer après un `kill -9`. Le README dit de lancer la restauration serveur arrêté, ce qui règle le cas pour de bon.

**La rotation ne regarde pas les préfixes.** `--keep 30` garde les 30 archives les plus récentes du dossier, sauvegardes de sécurité comprises. Les distinguer aurait voulu dire deux quotas, donc deux réglages, pour un dossier que Nathan voit en entier sur `/sauvegarde`.

**`merge` ne met jamais à jour l'existant.** Une famille présente des deux côtés garde la version locale, même si celle de l'archive est plus récente. Fusionner sert à réunir deux instances, pas à faire gagner l'une sur l'autre — et une fusion qui écrase silencieusement ne serait plus une fusion.

---

## 3. Les dépendances ajoutées et pourquoi

- **`tar` (^7)** — lecture et écriture de `.tar.gz` en JavaScript pur, en flux, avec un filtre d'extraction. Justifiée en détail plus haut. C'est la seule ajoutée par ce lot.

---

## 4. Les points laissés ouverts

- **Pas de sauvegarde hors machine.** `backup.sh` écrit dans `data/backups/`, sur le même disque que la base. Un `rsync` ou un dépôt distant est le prochain geste, et il est volontairement hors du lot : il dépend d'un endroit où pousser que Nathan n'a pas encore choisi.
- **Le verrou ne franchit pas le processus** (voir plus haut). À revoir seulement si une instance devient multi-processus, ce qui n'est pas au programme.
- **`merge` ne déduplique pas.** Fusionner deux fois la même archive crée `partagee-2` puis `partagee-3`. Détecter qu'une idée est « la même » demanderait un identifiant stable entre instances — un vrai sujet, à ouvrir le jour où la fusion servira souvent.
- **La restauration n'est pas transactionnelle sur les fichiers.** La base bascule par `rename`, le dossier des fichiers aussi, mais entre les deux il existe une fenêtre de quelques millisecondes. La sauvegarde de sécurité couvre le cas ; une vraie atomicité demanderait un lien symbolique de racine, et donc un choix d'exploitation qu'on ne veut pas imposer.
- **`afterSwitch` est une couture de test** dans `restoreArchive`. Elle n'est appelée par aucun code de production. C'est le prix de la seule façon honnête d'éprouver la marche arrière.

---

## 5. Checklist de vérification manuelle

1. `npm test` — 148 tests verts.
2. Ouvrir `/sauvegarde` depuis le lien de l'en-tête du catalogue : les compteurs du bloc « Sauvegarder » correspondent à ce que tu as.
3. Cliquer **Télécharger la sauvegarde** : le fichier arrive sous le nom `vitrine-<date>.tgz`. L'ouvrir avec `tar tzf` : `manifest.json`, `vitrine.db`, `files/…`.
4. Déposer cette archive dans le bloc « Restaurer », mode **Remplacer** : la zone affiche les chiffres lus dans l'archive, la confirmation annonce « X seront remplacés par Y ». Valider — retour au catalogue avec un message, et tout est là.
5. Ouvrir de nouveau `/sauvegarde` : la sauvegarde de sécurité `pre-restore-<date>.tgz` est dans la liste du serveur. La supprimer.
6. Mode **Fusionner** avec la même archive : les idées apparaissent en double, la seconde avec un slug suffixé, et rien n'a disparu. (Puis restaurer en **Remplacer** pour revenir en arrière.)
7. Renommer une archive en `.tgz` bidon (`echo pas une archive > faux.tgz`) et la déposer : refus propre, et le catalogue est intact.
8. En ligne de commande : `npm run backup -- --out data/backups`, puis `./backup.sh` — la ligne de log est écrite, le dossier ne dépasse jamais 30 archives.
9. Serveur arrêté : `npm run restore -- --file data/backups/<archive>.tgz`, répondre `o`. Redémarrer, tout est en place.
