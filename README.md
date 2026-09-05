# Vitrine

Catalogue personnel d'idées de jeux. Une idée, une page, un verdict daté.

Application web auto-hébergée et mono-utilisateur : chaque idée a sa fiche (accroche, pitch, « moment clipable », prix envisagé, famille, statut, concurrence) et un historique de verdicts qu'on n'écrase jamais — l'intérêt étant de relire dans six mois ce qu'on pensait aujourd'hui.

La source de vérité du projet est [`Docs/seed-vitrine.md`](Docs/seed-vitrine.md). Les conventions de travail sont dans [`CLAUDE.md`](CLAUDE.md).

## Démarrer

### Avec Docker

```bash
docker compose up --build
```

L'application est sur <http://localhost:3000>. La base et les fichiers sont dans `data/db/` et `data/files/`, montés comme volumes : ils survivent aux reconstructions. Les migrations en attente sont appliquées au démarrage.

### En développement

Node 20 ou plus est requis. Le projet est développé et conteneurisé sur Node 24 LTS.

Si tu changes de version majeure de Node, relance `npm install` : `better-sqlite3` est un module natif, lié à une version précise de l'ABI Node.

```bash
npm install
npm run dev
```

Le front est sur <http://localhost:5173> (Vite), l'API sur le port 3000 ; Vite proxifie `/api` et `/files` vers Fastify, donc les mêmes URL qu'en production.

```bash
npm test      # tests de l'API (node:test)
npm run build # build du front dans web/dist
npm run migrate
```

## Sauvegarder et restaurer

Une archive contient tout : la base et les fichiers utilisateur. C'est un
`.tgz` ordinaire, lisible à la main (`tar tzf`), qui porte trois entrées —
`manifest.json` (compteurs, version de schéma, un hachage SHA-256 par fichier),
`vitrine.db` et `files/`.

La base n'est **jamais** copiée fichier à fichier : elle est en WAL, et une
copie à chaud donnerait une base tronquée. La lecture passe par `db.backup()`,
l'API de sauvegarde en ligne de SQLite, qui produit une image cohérente pendant
que les écritures continuent.

Depuis le navigateur, tout est sur `/sauvegarde` : ce que contient l'archive,
son téléchargement, le dépôt d'une archive à restaurer et la liste des archives
du serveur. En ligne de commande :

```bash
npm run backup -- --out data/backups --keep 30
npm run restore -- --file data/backups/vitrine-2026-09-05-0300.tgz
npm run restore -- --file archive.tgz --merge --yes
```

`--merge` ajoute le contenu de l'archive au lieu de remplacer : les idées
s'ajoutent (slug suffixé en cas de collision), les familles absentes sont
créées, rien n'est jamais supprimé. C'est ce qui sert à réunir deux instances.

Une restauration pose toujours une sauvegarde de sécurité dans `data/backups/`
avant de basculer, et la remet en place toute seule si la bascule échoue. Une
archive plus ancienne que le code est migrée avant d'être restaurée ; une
archive plus récente est refusée en 409.

`npm run restore` se lance **serveur arrêté** : un serveur en cours garde
l'ancien fichier de base ouvert. `npm run backup` et `backup.sh` fonctionnent
dans les deux cas.

### Le cron

`backup.sh` produit l'archive dans `data/backups/`, ne garde que les 30 plus
récentes et écrit une ligne de log :

```
0 3 * * * /srv/vitrine/backup.sh >> /srv/vitrine/data/backups/backup.log 2>&1
```

En Docker, poser `VITRINE_CONTAINER=vitrine` dans l'environnement du cron : le
script passe alors par `docker exec`.

## Mise en production

Sur le serveur Debian, l'application n'est exposée que sur le réseau Tailscale —
il n'y a pas d'authentification, c'est le réseau qui fait la porte.

```bash
git clone <dépôt> /srv/vitrine && cd /srv/vitrine
cp .env.example .env          # rien n'est obligatoire ; DEVELOPER_NAME au moins
docker compose up -d --build
```

Publier le port sur la seule IP Tailscale plutôt que sur toutes les interfaces,
en remplaçant la ligne `ports` du `docker-compose.yml` :

```yaml
ports:
  - "100.x.y.z:3000:3000"     # l'IP Tailscale de la machine, `tailscale ip -4`
```

Mise à jour :

```bash
cd /srv/vitrine && git pull && docker compose up -d --build
```

Les migrations en attente sont appliquées au démarrage. `data/db`, `data/files`
et `data/backups` sont des volumes : ils survivent aux reconstructions. La
crontab de sauvegarde est celle donnée plus haut.

### Ouvrir l'instance sur Internet

Depuis le lot 7, une sélection d'idées peut être partagée par lien avec des amis.
C'est un changement de modèle de menace, pas une case à cocher : la marche à
suivre — Tailscale Funnel, le point d'entrée public, ce qu'il faut vérifier
depuis l'extérieur du tailnet et comment refermer — est dans
**[`Docs/exposition-publique.md`](Docs/exposition-publique.md)**.

Copier `.env.example` en `.env` pour ajuster le port, les chemins de données ou le sujet ntfy. Aucune variable n'est obligatoire.

## API

Toutes les réponses sont en JSON, erreurs comprises (`{ error, message }`).

| Méthode | Route | Ce qu'elle fait |
|---|---|---|
| `GET` | `/api/ideas` | Catalogue. Query : `family`, `status`, `minScore` (0-5), `wishlisted`, `sort` (`updated`, `created`, `score`, `title`, `friends-score`, `friends-wishlist`). Chaque idée porte son verdict courant et ses compteurs d'avis d'amis. |
| `POST` | `/api/ideas` | Crée une idée. Tous les champs sont facultatifs ; sans titre, elle s'appelle « Sans titre ». |
| `GET` | `/api/ideas/:slug` | Une idée avec son verdict courant. |
| `PATCH` | `/api/ideas/:slug` | Mise à jour partielle, champ par champ. |
| `DELETE` | `/api/ideas/:slug` | Corbeille (`deleted_at`), la ligne est conservée. |
| `POST` | `/api/ideas/:slug/restore` | Sort l'idée de la corbeille. 404 si elle n'y est pas. |
| `GET` | `/api/ideas/:slug/verdicts` | Historique, du plus récent au plus ancien. |
| `POST` | `/api/ideas/:slug/verdicts` | Ajoute un verdict (`score` 0-5, `note` facultative). |
| `GET` | `/api/ideas/:slug/attachments` | Pièces jointes, triées par `position`. |
| `POST` | `/api/ideas/:slug/attachments` | Multipart pour un ou plusieurs fichiers, JSON `{ url, label? }` pour un lien. Répond `{ attachments: [...] }`. |
| `PUT` | `/api/ideas/:slug/attachments/order` | `{ ids: [...] }` — la liste complète, réordonnée en une transaction. |
| `PATCH` | `/api/attachments/:id` | `label`, `position` (un rang, la liste est renumérotée), `link_type`. |
| `DELETE` | `/api/attachments/:id` | Supprime la ligne puis le fichier. Libère la capsule si c'en était une. |
| `GET` | `/files/*` | Fichiers utilisateur. Toute résolution hors de `data/files/` renvoie 404. |
| `GET` | `/api/backup/preview` | Ce que contiendrait l'archive : compteurs, taille estimée. Ne produit rien. |
| `POST` | `/api/backup` | Produit l'archive et la renvoie en flux. 409 si une sauvegarde ou une restauration est déjà en cours. |
| `POST` | `/api/restore` | Multipart : l'archive, et un champ `mode` (`replace` par défaut, ou `merge`). |
| `GET` | `/api/backups` | Les archives de `data/backups/`. |
| `DELETE` | `/api/backups/:name` | En supprime une. |
| `GET`, `POST` | `/api/shares` | Les sélections partagées : liste avec compteurs, création (`label`, `idea_slugs` ordonnés, `expires_at`, `reviews_visible`). |
| `GET`, `PATCH` | `/api/shares/:id` | Lecture et modification d'une sélection. |
| `POST` | `/api/shares/:id/revoke` | Révoque le lien. La sélection reste, les avis aussi. |
| `GET` | `/api/ideas/:slug/reviews` | Les avis d'amis d'une idée. Jamais servis avec les verdicts. |
| `DELETE` | `/api/reviews/:id` | Modération : retire un avis. |
| `GET` | `/api/share/:token` | **Ouverte aux visiteurs.** La sélection, ses idées, le récapitulatif du visiteur. |
| `GET` | `/api/share/:token/ideas/:slug` | **Ouverte aux visiteurs.** Une idée de la sélection ; hors sélection, 404. |
| `POST` | `/api/share/:token/reviews` | **Ouverte aux visiteurs.** Dépose ou corrige un avis. |
| `POST` | `/api/share/:token/wishlist` | **Ouverte aux visiteurs.** La liste de souhaits du visiteur. |

Depuis le lot 7, **les routes ouvertes sans authentification sont une liste
blanche** (`server/src/access.js`). Tout ce qui n'y figure pas répond **404** à un
visiteur public — pas 403, qui révélerait l'existence de la route. Voir
[`Docs/exposition-publique.md`](Docs/exposition-publique.md).

`PATCH /api/ideas/:slug` accepte aussi `capsule_file_id` : la pièce désignée doit être une image de cette idée. Chaque idée porte `capsule_url`, l'adresse de cette image.

Un fichier envoyé est écrit dans `data/files/{idea_id}/{uuid}-{nom-nettoyé}` ; l'original n'est jamais écrasé, et le nom nettoyé ne garde que `[a-zA-Z0-9._-]`. Son `kind` (`image`, `markdown`, `file`) est déduit de l'extension et du type MIME. Un lien reçoit son `link_type` (`trello`, `asset-store`, `git`, `steam`, `video`, `autre`) d'après son domaine, et pour libellé le titre de la page visée — ou son nom de domaine.

Le slug est dérivé du titre et rendu unique par un suffixe numérique. Il suit le titre tant qu'il n'a pas été modifié à la main ; une fois posé par un `PATCH`, il est figé.

## Structure

```
server/   API Fastify + SQLite — migrations SQL numérotées, aucune étape de compilation
web/      Front React + Vite + TypeScript
Docs/     seed-vitrine.md (source de vérité), exposition-publique.md et READMEs de lot
scripts/  ntfy-notify.mjs — hooks Claude Code
backup.sh Sauvegarde prête pour le cron
data/     base, fichiers utilisateur et archives, jamais commités
```

## Avancement

- **Lot 1 — Socle** : dépôt, Docker, migrations, API CRUD idées et verdicts, catalogue et page idée, tests API, hooks ntfy. Livré — [`Docs/lots/lot-01-socle.md`](Docs/lots/lot-01-socle.md).
- **Lot 2 — Pièces jointes** : upload de fichiers et d'images, liens typés, rendu markdown, choix de la capsule, galerie, route de restauration. Livré — [`Docs/lots/lot-02-pieces-jointes.md`](Docs/lots/lot-02-pieces-jointes.md).
- **Lot 3 — Vitrine** : corbeille et purge, vue Steam, passe de direction artistique et responsive. Livré — [`Docs/lots/lot-03-vitrine.md`](Docs/lots/lot-03-vitrine.md).
- **Lot 3b — La vraie vitrine** : vue store refaite en réplique fidèle, liste de souhaits. Livré — [`Docs/lots/lot-03b-vitrine-fidele.md`](Docs/lots/lot-03b-vitrine-fidele.md).
- **Lot 4 — Familles éditables et bande-annonce** : familles en base et écran `/familles`, bande-annonce jouable, `Range` sur `/files/*`. Livré — [`Docs/lots/lot-04-familles-bande-annonce.md`](Docs/lots/lot-04-familles-bande-annonce.md).
- **Lot 5 — Sauvegarde et restauration** : archive `.tgz`, écran `/sauvegarde`, scripts et cron. Livré — [`Docs/lots/lot-05-sauvegarde.md`](Docs/lots/lot-05-sauvegarde.md).
- **Lot 6 — Peuplement** : les quatorze idées créées par l'API. Livré — [`Docs/lots/lot-06-peuplement.md`](Docs/lots/lot-06-peuplement.md).
- **Lot 6b — Bascule sur point de montage** : la restauration remplace le contenu de `data/files`, jamais le dossier. Livré — [`Docs/lots/lot-06b-bascule-point-de-montage.md`](Docs/lots/lot-06b-bascule-point-de-montage.md).
- **Lot 7 — Partage public et avis d'amis** : sélections partagées par lien, page invité `/p/:token/:slug`, avis et souhaits d'amis, liste blanche de routes, écran `/partages`. Livré — [`Docs/lots/lot-07-partage.md`](Docs/lots/lot-07-partage.md).

Pas d'authentification, et il n'y en aura pas : l'accès de Nathan passe par le
réseau Tailscale, et l'accès public — s'il est ouvert — par une liste blanche de
routes et un point d'entrée dédié. La marche à suivre pour exposer l'instance,
la vérifier et la refermer est dans
[`Docs/exposition-publique.md`](Docs/exposition-publique.md).
