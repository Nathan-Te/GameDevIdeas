# CLAUDE.md — Vitrine

## Le projet en trois lignes

Vitrine est une application web personnelle, auto-hébergée et mono-utilisateur, qui centralise les idées de jeux de Nathan : une idée, une page, un verdict daté.
Chaque idée porte des champs de fiche (titre, accroche, pitch, GIF, prix, famille, statut, concurrence), des pièces jointes et un historique de verdicts qu'on n'écrase jamais.
L'objectif final est de juger une idée comme un joueur qui scrolle Steam, grâce à une vue « page store » générée à partir de ces champs.

**La source de vérité du projet est [`Docs/seed-vitrine.md`](Docs/seed-vitrine.md).** Il est modifié uniquement par Nathan : en cas de désaccord entre ce fichier et le seed, le seed gagne. Toute question de périmètre, de modèle de données ou de découpage en lots se tranche là-bas.

## Règles durables du projet

Reprises telles quelles de la section 8 du seed :

- Un lot livré est un lot commité, sur `main`, avec un README de lot dans `Docs/lots/`.
- La base n'est jamais modifiée sans migration numérotée ; aucune migration livrée n'est réécrite après coup.
- Les fichiers utilisateur ne vont jamais en base.
- Un fichier supprimé en base est supprimé sur disque dans la même opération ; jamais l'inverse.
- Une purge supprime la base puis le dossier de l'idée ; jamais de purge partielle.
- Le lookup de titre ne contacte jamais une adresse privée ou locale.
- Toute lecture de la base pour sauvegarde passe par `db.backup()` ; jamais de copie du fichier vivant.
- Une restauration produit toujours une sauvegarde de sécurité avant de basculer.
- Tout HTML issu d'un contenu utilisateur (markdown, labels) passe par DOMPurify avant insertion.
- L'API renvoie toujours du JSON, erreurs comprises (`{ error, message }`).
- Pas de dépendance ajoutée sans la justifier dans le README du lot.

### Règles ajoutées au lot 7 (ouverture sur Internet)

- **Le seul critère qui sépare Nathan d'un visiteur est le port d'écoute par
  lequel la requête est entrée.** Jamais l'adresse source, jamais un en-tête :
  les deux ont été essayés au lot 7 et retirés au lot 7b. L'adresse ment dès
  qu'il y a un intermédiaire — Funnel présente tout depuis la machine, Docker
  présente tout depuis la passerelle du bridge, y compris les requêtes de
  Nathan — et un en-tête est une promesse d'un composant qu'on ne contrôle pas.
  Voir [`Docs/exposition-publique.md`](Docs/exposition-publique.md) §2.
- **Les routes accessibles sans authentification sont une liste blanche
  explicite ; toute route non listée répond 404 à un visiteur public.** La liste
  vit dans `server/src/access.js` — 404 et non 403, pour qu'une route fermée soit
  indiscernable d'une route inexistante.
- **Un avis d'ami n'est jamais un verdict : les deux tables ne se mélangent ni en
  base, ni à l'affichage, ni dans un calcul.** `verdicts` est le jugement de
  Nathan, `reviews` celui de ses amis. Deux tables, deux types côté front, deux
  sections, deux colonnes au catalogue — et aucune moyenne des deux.

### Règle ajoutée en cours de route (hors seed)

**Une livraison qui touche au système de fichiers doit être exercée dans le conteneur, pas seulement en test unitaire.**

Le poste de développement ment sur trois points au moins : `data/` y est un
dossier ordinaire alors qu'en production ce sont des points de montage, le front
y est servi par Vite et non par Fastify, et tout le dépôt y est présent alors que
l'image ne contient que ce que le `Dockerfile` copie. Un test qui tourne dans un
dossier temporaire ne voit rien de tout ça.

C'est le quatrième défaut de cette famille, tous invisibles en local et tous
cassants en production :

1. le proxy Vite — une route servie par Fastify et absente du proxy renvoie du HTML en 200 ;
2. `shared/` absent du `Dockerfile`, aux deux étages ;
3. la réouverture de connexion à la base ;
4. la bascule de restauration sur un point de montage (`EBUSY`, lot 6b) ;
5. la classification `owner`/`guest` par adresse source (lot 7b) — en conteneur,
   toutes les requêtes arrivent par la passerelle du réseau bridge, y compris
   celles de Nathan, et l'application répondait 404 sur son propre port. Les
   52 tests de la porte passaient tous par `inject`, qui présente les requêtes
   depuis `127.0.0.1` : ils vérifiaient scrupuleusement un mécanisme qui n'était
   pas celui de la production. C'est le premier de la famille à toucher la
   sécurité.

En pratique : `npm run test:container`, et un fichier de test qui **refuse de
passer** quand la destination n'est pas réellement montée
(`VITRINE_REQUIRE_MOUNT_TEST=1`) — un test qui se saute en silence sur le poste
de développement puis en intégration ne prouve rien.

## Commandes

```bash
npm install                  # une seule fois, à la racine (workspaces npm)
npm run dev                  # API Fastify (3000) + Vite (5173) en parallèle, proxy /api et /files
npm test                     # tests node:test de l'API
npm run test:container       # les tests qui exigent de vrais points de montage (Docker requis)
npm run build                # build du front dans web/dist
npm run migrate              # applique les migrations en attente sans démarrer le serveur
npm run backup -- --out data/backups --keep 30   # archive .tgz (base + fichiers), sans passer par HTTP
npm run restore -- --file <archive.tgz> [--merge] [--yes]   # restauration, serveur arrêté
./backup.sh                  # la même archive, prête pour le cron (0 3 * * *)
docker compose up --build    # l'application complète sur http://localhost:3000
```

En développement, on travaille sur `http://localhost:5173` : Vite sert le front et proxifie `/api` **et `/files`** vers Fastify. En production, Fastify sert `web/dist` en statique avec repli SPA.

**Toute route servie par Fastify doit être ajoutée au proxy de `web/vite.config.ts`.** Sinon Vite répond son propre `index.html` — la route a l'air de marcher, elle renvoie 200, et c'est du HTML. Un test le vérifie (`server/test/files.test.js`).

Node 20 ou plus est requis (`node:test`, Fastify 5, Vite 6) ; le développement se fait sur Node 24 LTS, la même version que le conteneur.

## Variables d'environnement

Toutes facultatives ; `.env.example` les documente une par une avec leur valeur par défaut.

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT`, `HOST` | `3000`, `0.0.0.0` | Écoute HTTP. |
| `DATA_DB_DIR` | `./data/db` | Dossier du fichier SQLite. |
| `DB_PATH` | — | Chemin complet de la base, prioritaire sur `DATA_DB_DIR`. `:memory:` pour les tests. |
| `DATA_FILES_DIR` | `./data/files` | Dossier des fichiers utilisateur, servi par `/files/*`. |
| `DATA_BACKUPS_DIR` | `./data/backups` | Dossier des archives locales. Créé au démarrage, exclu du contenu des archives. |
| `BACKUP_KEEP` | `30` | Nombre d'archives gardées par `backup.sh`. |
| `MAX_RESTORE_MB` | `4096` | Taille maximale d'une archive envoyée à `POST /api/restore`. |
| `MAX_UPLOAD_MB` | `50` | Taille maximale d'un fichier envoyé. Au-delà : 413, et rien n'est écrit. |
| `MAX_TRAILER_MB` | `100` | Limite propre aux bandes-annonces (`.gif`, `.mp4`, `.webm`). Une vidéo pèse plus qu'une capture. |
| `LINK_TITLE_LOOKUP` | activé | Aller chercher le titre de la page pour libeller un lien collé sans label. Coupé, le libellé retombe sur le nom de domaine. |
| `DEVELOPER_NAME` | `Nathan` | Nom affiché comme développeur et éditeur sur la vue store, servi par `GET /api/config`. |
| `SERVE_STATIC`, `WEB_DIST` | `web/dist` s'il existe | Front statique avec repli SPA. |
| `LOG_LEVEL` | `info` | Journalisation Fastify. |
| `PUBLIC_PORT` | — | Le **point d'entrée public** (lot 7). Non défini : aucune ouverture, l'instance reste sur le seul tailnet. Défini : un second serveur écoute là, et toute requête qui y entre est un visiteur. Voir [`Docs/exposition-publique.md`](Docs/exposition-publique.md). |
| `PUBLIC_HOST` | `127.0.0.1` | Interface d'écoute du point d'entrée public. En conteneur : `0.0.0.0`, restreint par la publication du port côté hôte. |
| `GUEST_SUBMIT_LIMIT` | `30` | Soumissions d'un visiteur par heure et par adresse. Au-delà : 429. |
| `IP_HASH_SALT` | tiré au démarrage | Sel du hachage d'adresse des visiteurs. Jamais affiché, jamais servi. |
| `NTFY_TOPIC`, `NTFY_SERVER` | `pg-nathan-7k2x`, `ntfy.sh` | Hooks Claude Code, pas l'application. |

## Carte des routes

| Route | Rôle |
|---|---|
| `GET /api/config` | Configuration lisible par le front. Une seule valeur : `developer_name`. |
| `GET /api/families` | Les familles, dans leur ordre, avec leur nombre d'idées (`idea_count`). |
| `POST /api/families` | Création. Le slug est déduit du libellé s'il n'est pas donné. |
| `PATCH /api/families/:slug` | `label`, `slug`, `store_tags`, `features`, `position`. Renommer le slug met à jour les idées dans la même transaction. |
| `DELETE /api/families/:slug` | Refusé en 409 tant qu'une idée l'utilise, corbeille comprise ; le message dit combien. |
| `GET /api/ideas` | Catalogue, filtres `family` / `status` / `minScore` / `wishlisted` / `deleted`, tri `sort`. |
| `POST /api/ideas` | Création. |
| `GET`, `PATCH`, `DELETE /api/ideas/:slug` | Lecture, mise à jour partielle (dont `capsule_file_id`, `trailer_file_id` et `wishlisted`), corbeille. |
| `POST /api/ideas/:slug/restore` | Sort l'idée de la corbeille. 404 si elle n'y est pas. |
| `DELETE /api/ideas/:slug/purge` | Suppression définitive. N'accepte qu'une idée en corbeille (404 sinon) : verdicts, pièces jointes et idée dans une transaction, puis `data/files/{idea_id}/` en entier. |
| `GET`, `POST /api/ideas/:slug/verdicts` | Historique et ajout d'un verdict. |
| `GET`, `POST /api/ideas/:slug/attachments` | Liste ; ajout par multipart (fichiers) ou JSON `{ url, label? }` (lien). |
| `PUT /api/ideas/:slug/attachments/order` | Réordonne, `{ ids: [...] }` complet, en une transaction. |
| `PATCH`, `DELETE /api/attachments/:id` | `label` / `position` / `link_type` ; suppression ligne + fichier. |
| `GET /api/backup/preview` | Ce que contiendrait l'archive — compteurs, taille estimée — sans rien produire. |
| `POST /api/backup` | Produit l'archive dans un temporaire et la renvoie en flux (`Content-Disposition: attachment`), temporaire effacé à la fermeture du flux. 409 si une opération est déjà en cours. |
| `POST /api/restore` | Multipart : l'archive, plus un champ `mode` (`replace` par défaut, ou `merge`). Vérifie, migre l'archive, sauvegarde de sécurité, bascule, vérifie — et remet l'état précédent si la bascule échoue. |
| `GET /api/backups` | Les archives de `data/backups/` : nom, date, taille. |
| `DELETE /api/backups/:name` | En supprime une. Nom validé contre la traversée de chemin, comme `/files/`. |
| `GET`, `POST /api/shares` | Les sélections partagées : liste avec compteurs, création (libellé, `idea_slugs` **ordonnés**, `expires_at`, `reviews_visible`). |
| `GET`, `PATCH /api/shares/:id` | Lecture, modification (libellé, sélection, échéance, visibilité des avis, `revoked`). |
| `POST /api/shares/:id/revoke` | Révoque le lien. La sélection n'est pas supprimée : les avis gardent d'où ils viennent. |
| `GET /api/ideas/:slug/reviews` | Les avis d'amis reçus par une idée. **Jamais servis avec les verdicts.** |
| `DELETE /api/reviews/:id` | Modération : un avis part, et rien d'autre ne bouge. |
| `GET /api/share/:token` | **Ouverte aux visiteurs.** La sélection, ses idées, et le récapitulatif du visiteur. Lien inconnu, révoqué ou expiré : le même 404. |
| `GET /api/share/:token/ideas/:slug` | **Ouverte aux visiteurs.** Une idée de la sélection ; un slug hors sélection répond 404 même s'il existe. |
| `POST /api/share/:token/reviews` | **Ouverte aux visiteurs.** Dépose ou corrige un avis (un par `visitor_id` et par idée). |
| `POST /api/share/:token/wishlist` | **Ouverte aux visiteurs.** La liste de souhaits **du visiteur**, jamais celle de Nathan. |
| `GET /files/*` | Fichiers utilisateur, garde stricte contre la traversée de chemin, cache long. Les médias jouables (`.gif`, `.mp4`, `.webm`, `.mp3`, `.ogg`) sont servis `inline` avec `Accept-Ranges: bytes` et honorent les requêtes `Range` (206, 416 hors bornes) — sans quoi une vidéo ne se lit pas dans le navigateur. |
| Tout le reste | `index.html` si le front est construit, sinon 404 JSON. Jamais sous `/api` ni `/files`. Pour un **visiteur**, le repli SPA ne s'ouvre que sous `/p/`. |

Côté front, huit vues : `/` (catalogue), `/idees/:slug` (fiche éditable),
`/idees/:slug/steam`, `/corbeille`, `/familles`, `/sauvegarde`, `/partages` — et
`/p/:token/:slug`, **la seule que quelqu'un d'autre que Nathan puisse atteindre**.

La maquette store vit dans `web/src/components/StoreMock.tsx` depuis le lot 7 :
`/idees/:slug/steam` et `/p/:token/:slug` l'affichent toutes les deux. Il n'y a
qu'une maquette, donc un ami voit exactement la page que Nathan a regardée.

`/partages` crée et gère les sélections : cocher des idées, les ordonner, le lien
complet avec sa copie et son QR code, les compteurs de visiteurs et d'avis, la
visibilité des avis entre visiteurs, la révocation. L'adresse publique (celle de
Tailscale Funnel) se colle une fois par navigateur et s'y retient : le serveur ne
connaît pas son nom vu de l'extérieur.

**L'ouverture sur Internet a sa propre note :
[`Docs/exposition-publique.md`](Docs/exposition-publique.md)** — comment Funnel se
branche, pourquoi la séparation repose sur un port d'écoute distinct et non sur
l'adresse source, et ce qu'il faut vérifier depuis l'extérieur du tailnet.

`/sauvegarde` tient en trois blocs : ce que contient l'archive et son téléchargement, le dépôt d'une archive à restaurer (`Remplacer` / `Fusionner`, avec une confirmation qui compte les idées et les fichiers de part et d'autre), et la liste des archives du serveur. Les chiffres de l'archive déposée sont lus **dans le navigateur** : `manifest.json` est la première entrée du `.tgz`, `DecompressionStream` fait le reste (`web/src/archive.ts`).

`/familles` édite la liste des familles : libellé, étiquettes store en pilules, fonctionnalités en cases, ordre à la poignée. Le sélecteur de famille de la page idée et le filtre du catalogue lisent cette liste, jamais une énumération du code.

`/idees/:slug/steam` est une réplique fidèle du store de bureau, sans logo ni marque ; seuls le bouton de liste de souhaits et le lecteur de bande-annonce sont actifs. Ce lecteur a sa propre barre — lecture, position, son — écrite à la main plutôt que déléguée à `controls` : les contrôles natifs sont ceux du navigateur, reconnaissables au premier coup d'œil, et trahiraient le photomontage autant qu'un logo. Se déplacer dans la vidéo repose sur les requêtes `Range` de `/files/*`. Le reste — enchaîner les idées en respectant les filtres, revenir à l'édition — vit dans une fine barre de service au-dessus de la maquette, hors du photomontage. Elle n'a pas de version mobile : elle s'éloigne (`zoom`) et se fait défiler.

## Plan en lots

- **Lot 1 — Socle** : livré. Dépôt, Docker, schéma, API idées et verdicts, catalogue et page idée.
- **Lot 2 — Pièces jointes** : livré. Upload, liens typés, markdown rendu, capsule, galerie, `restore`.
- **Lot 3 — Vitrine** : livré. Corbeille et purge, vue Steam, feuille de tokens, passe de DA et responsive.
- **Lot 3b — La vraie vitrine** : livré. Vue store refaite en réplique fidèle, liste de souhaits (migration `003`, `ideas.wishlisted_at`), filtre et marqueur au catalogue, `DEVELOPER_NAME`. **La v1 est close.**
- **Lot 4 — Familles éditables et bande-annonce** : livré. Table `families` et écran `/familles` (migration `004`), `kind` `trailer` et `ideas.trailer_file_id` (migration `005`), `Range` sur `/files/*`, lecteur en tête de visionneuse et aperçu au survol du catalogue.
- **Lot 5 — Sauvegarde et restauration** : livré. Archive `.tgz` (manifeste haché, base par `db.backup()`, fichiers), routes `/api/backup`, `/api/restore`, `/api/backups`, écran `/sauvegarde`, `npm run backup` / `npm run restore` et `backup.sh` pour le cron. **La v1 est close et prête à héberger** — la mise en production est dans le README.
- **Lot 6 — Peuplement** : livré. Les quatorze idées de `Docs/fiches-vitrine-14.md`, créées par l'API avec `scripts/seed-ideas.mjs` (idempotent, repérage par titre), et l'archive à transporter sur le serveur.
- **Lot 6b — Bascule sur point de montage** : livré. La restauration remplace le *contenu* de `data/files`, jamais le dossier — un point de montage ne se renomme pas (`EBUSY`) et `rename` n'en traverse pas la frontière (`EXDEV`). Nettoyage des `.incoming` orphelins au démarrage, et `npm run test:container` pour l'exercer là où c'est vrai.

- **Lot 7b — La porte se décide sur le port** : livré. La classification par adresse source et l'en-tête `Tailscale-Funnel-Request` sont supprimés ; un `Symbol` posé par le point d'entrée public (`server/src/public-entry.js`) est le seul critère. Tests sur de vrais sockets, depuis une adresse ni locale ni tailnet, et à travers le NAT Docker — [`Docs/lots/lot-07b-porte-par-port.md`](Docs/lots/lot-07b-porte-par-port.md).
- **Lot 8 — L'encart central** : livré. La pièce en tête de la visionneuse peut être une image, la capsule comprise ; champs `leading_media_*` en remplacement de `leading_trailer_*`. Sans migration : seule la validation s'élargit — [`Docs/lots/lot-08-encart-central.md`](Docs/lots/lot-08-encart-central.md).
- **Lot 7 — Partage public et avis d'amis** : livré. Sélections partagées par lien, page invité `/p/:token/:slug`, avis et listes de souhaits d'amis (migration `006`), liste blanche de routes et point d'entrée public, écran `/partages`. **L'application est exposable sur Internet** — la marche à suivre est dans [`Docs/exposition-publique.md`](Docs/exposition-publique.md).

## Modèle de données

- `ideas` — la fiche. `family` est **un slug de la table `families`**, validé par l'application et non par une clé étrangère : renommer un slug de famille met à jour les idées portant l'ancien, dans la même transaction. `capsule_file_id` et `trailer_file_id` pointent une pièce jointe de l'idée, en `ON DELETE SET NULL`.
- `verdicts` — l'historique, jamais écrasé.
- `attachments` — `kind` vaut `image`, `trailer`, `markdown`, `file` ou `link`. Un `.gif`, un `.mp4` ou un `.webm` arrive en `trailer` : **un GIF attaché est une bande-annonce, pas une capture**.
- **Une idée porte autant de bandes-annonces et de captures qu'elle veut.** La visionneuse de la page store les enchaîne, vidéos d'abord, captures ensuite — comme un magasin. `ideas.trailer_file_id` ne désigne pas « la » bande-annonce mais **la pièce qui ouvre la marche**, l'encart central ; à défaut de désignation, c'est la première pièce `trailer` dans l'ordre des pièces jointes. La règle vit dans `SELECT_IDEA` (`ideas-repo.js`) et sort en `leading_media_id` / `leading_media_kind` / `leading_media_url` : le front la lit, il ne la rejoue pas.
- **L'encart central accepte une image autant qu'une vidéo (lot 8).** Une idée sans bande-annonce ouvrait sur une carte de texte ; elle peut désormais ouvrir sur une capture. Deux conséquences : `trailer_file_id` peut pointer une pièce `image`, et **la capsule tient les deux places à la fois** — c'est la seule image que la visionneuse laisse entrer alors qu'elle est déjà dans la colonne de droite. Le repli automatique, lui, ne cherche que des vidéos : une capture ne se hisse jamais en tête toute seule. Le catalogue ne joue au survol que si `leading_media_kind === 'trailer'`.
- `families` (migration `004`) — `slug`, `label`, `store_tags` (JSON, les étiquettes de la page store), `features` (JSON parmi `solo`, `coop-online`, `multiplayer`, `local-coop`), `position`. Peuplée au démarrage depuis `SEED_FAMILIES` de `shared/store-model.js`, **et seulement si elle est vide** : le seed ne ressuscite jamais une famille supprimée.
- Migration `005` — `ideas.trailer_file_id`, et la reconstruction de `attachments` pour élargir sa contrainte `CHECK` au `kind` `trailer`.
- Migration `006` — le partage. `shares` (jeton de 32 octets en base64url, libellé, `reviews_visible`, `expires_at`, `revoked_at`), `share_ideas` (la sélection, **ordonnée**), `reviews` (l'avis d'un ami : `author_name`, `score`, `note`, `visitor_id`, `ip_hash`, `updated_at`) et `share_wishlists` (la liste de souhaits **du visiteur**, distincte de `ideas.wishlisted_at` qui est celle de Nathan).
- **`reviews` et `verdicts` ne se croisent nulle part.** `reviews.share_id` est en `ON DELETE SET NULL` : un avis donné ne se retire pas si sa sélection disparaît. Un index unique `(idea_id, visitor_id)` fait que déposer deux fois, c'est corriger — et que personne ne corrige l'avis d'un autre.
- Le bloc « Évaluations » de la page store est alimenté par les **avis d'amis** depuis le lot 7, et plus par les verdicts : c'est ce qui solde le point ouvert du lot 3b.

Le support manette n'est pas une fonctionnalité de famille : il est ajouté à toutes les fiches par `storeFeatures`.

## Convention des migrations

- Un fichier par migration dans `server/migrations/`, nommé `NNN-description.sql` (`001-init.sql`, `002-…`), numéro sur trois chiffres.
- Elles sont appliquées dans l'ordre numérique, chacune dans une transaction, et enregistrées dans la table `schema_migrations`. Une migration déjà appliquée n'est jamais rejouée.
- Le serveur applique les migrations en attente à chaque démarrage ; `npm run migrate` fait la même chose sans écouter de port.
- **Une migration livrée ne se modifie pas.** Une correction, un renommage ou un ajout de colonne passe par une nouvelle migration numérotée.
- Le SQL est écrit en clair : pas d'ORM, pas de générateur de schéma.
- Les clés étrangères sont **coupées le temps des migrations**, puis revérifiées par `foreign_key_check` dans la transaction de chaque migration. C'est la procédure documentée par SQLite pour reconstruire une table — seul moyen d'y modifier une contrainte `CHECK` — et sans elle le `DROP TABLE` de l'ancienne table déclencherait les `ON DELETE` de celles qui la référencent.

## Convention des READMEs de lot

Chaque lot livré a son fichier dans `Docs/lots/`, nommé `lot-NN-nom.md` (`lot-01-socle.md`). Il contient au minimum :

1. **Ce qui est livré** — le périmètre réellement couvert, vérifiable.
2. **Les choix faits** — les décisions structurantes et leurs raisons, y compris celles qu'on pourrait regretter.
3. **Les dépendances ajoutées et pourquoi** — une ligne par dépendance ; c'est là que se justifie la règle du seed.
4. **Les points laissés ouverts** — ce qui est reporté, ce qui est incertain, ce qui attend un arbitrage de Nathan.
5. **La checklist de vérification manuelle** — ce que Nathan clique lui-même pour valider le lot.

## Structure

```
shared/           store-model.js — la traduction « idée » → « fiche de magasin »
                  (JS pur, importé par le front et testé par node:test).
                  Les étiquettes et fonctionnalités y sont *lues sur la famille* ;
                  SEED_FAMILIES n'y sert qu'au peuplement initial de la table.
server/           API Fastify + SQLite (JavaScript ESM, pas de build)
  migrations/     Migrations SQL numérotées
  src/            config, db, migrate, routes, validation, dépôts SQL,
                  access.js (la porte : owner/guest, liste blanche, 404),
                  public-entry.js (le point d'entrée public — le seul critère),
                  shares-repo.js (sélections, avis d'amis, souhaits d'invités),
                  rate-limit.js (le débit des soumissions, en mémoire),
                  files.js (disque, garde de chemin, `Range`), links.js (liens typés),
                  families-repo.js (les familles, seed compris),
                  backup.js (archive, restauration, fusion, verrou),
                  db-handle.js (la poignée qui permet de rebrancher la base),
                  backup-cli.js / restore-cli.js (les mêmes, en ligne de commande)
  test/           node:test, une base en mémoire par test
web/              Front React + Vite + TypeScript
  src/            api (client typé), router, filters (filtres d'URL partagés),
                  families.ts (la liste chargée une fois, partagée par les vues),
                  pages, composants, tokens.css puis styles.css,
                  steam.css (la palette du photomontage, hors tokens)
Docs/             seed-vitrine.md (source de vérité), exposition-publique.md
                  (l'ouverture sur Internet : Funnel, ports, vérifications) et lots/
scripts/          ntfy-notify.mjs (hooks Claude Code)
data/             base SQLite, fichiers utilisateur et archives — jamais commité
  db/             vitrine.db (+ -wal, -shm)
  files/          les fichiers utilisateur, servis par /files/*
  backups/        les archives .tgz : cron, sauvegardes de sécurité.
                  Créé au démarrage, et toujours exclu du contenu d'une archive
                  — une sauvegarde ne contient jamais les sauvegardes.
```

## Conventions de code

- Serveur en JavaScript ESM, front en TypeScript strict. Le serveur n'a pas d'étape de compilation.
- SQL en clair dans `server/src/ideas-repo.js` ; les routes ne contiennent pas de requête.
- Les erreurs passent par `HttpError` (`server/src/errors.js`) et ressortent en `{ error, message }`.
- Les entrées sont validées par schéma JSON Fastify (`server/src/schemas.js`). Pas de schéma de réponse : la sérialisation est explicite.
- Front sans bibliothèque d'état global ni de routage : `fetch` + un client typé (`web/src/api.ts`), un routeur maison (`web/src/router.tsx`). L'envoi de fichiers passe par XHR, seul moyen d'obtenir une progression d'upload.
- Les fichiers utilisateur ne sont jamais atteints par un chemin construit à la main : tout passe par `resolveInsideFiles` (`server/src/files.js`), qui renvoie `null` dès que la résolution sort de `data/files/`.
- Direction artistique : sombre, sobre, un seul accent chaud (`--accent`), pas d'animation gratuite, lisible sur mobile.
- **Toute la direction artistique tient dans `web/src/tokens.css`** : couleurs, espacements, rayons, typographie, formats et durées. `styles.css` l'importe en première ligne et ne contient plus une seule couleur littérale — une valeur en dur y est soit une géométrie, soit un oubli.
- **`web/src/steam.css` est la seule exception, et elle est assumée** : le photomontage du store n'est pas de la DA Vitrine mais l'imitation d'une autre, et ses couleurs vivent sous `.sp-mock` sans jamais en sortir. Aucun token n'y entre, aucune de ses valeurs n'en sort.
- Commentaires et interface en français.

## Hooks

`.claude/settings.json` branche les hooks `Stop` et `Notification` sur `scripts/ntfy-notify.mjs`, qui publie sur le sujet ntfy lu dans `NTFY_TOPIC` (défaut `pg-nathan-7k2x`). Le titre de la notification est le nom du dossier racine du projet. Priorité basse quand Claude attend, normale à la fin d'un tour.
