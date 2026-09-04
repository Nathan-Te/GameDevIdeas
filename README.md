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

Copier `.env.example` en `.env` pour ajuster le port, les chemins de données ou le sujet ntfy. Aucune variable n'est obligatoire.

## API

Toutes les réponses sont en JSON, erreurs comprises (`{ error, message }`).

| Méthode | Route | Ce qu'elle fait |
|---|---|---|
| `GET` | `/api/ideas` | Catalogue. Query : `family`, `status`, `minScore` (0-5), `sort` (`updated`, `created`, `score`, `title`). Chaque idée porte son verdict courant. |
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

`PATCH /api/ideas/:slug` accepte aussi `capsule_file_id` : la pièce désignée doit être une image de cette idée. Chaque idée porte `capsule_url`, l'adresse de cette image.

Un fichier envoyé est écrit dans `data/files/{idea_id}/{uuid}-{nom-nettoyé}` ; l'original n'est jamais écrasé, et le nom nettoyé ne garde que `[a-zA-Z0-9._-]`. Son `kind` (`image`, `markdown`, `file`) est déduit de l'extension et du type MIME. Un lien reçoit son `link_type` (`trello`, `asset-store`, `git`, `steam`, `video`, `autre`) d'après son domaine, et pour libellé le titre de la page visée — ou son nom de domaine.

Le slug est dérivé du titre et rendu unique par un suffixe numérique. Il suit le titre tant qu'il n'a pas été modifié à la main ; une fois posé par un `PATCH`, il est figé.

## Structure

```
server/   API Fastify + SQLite — migrations SQL numérotées, aucune étape de compilation
web/      Front React + Vite + TypeScript
Docs/     seed-vitrine.md (source de vérité) et READMEs de lot
scripts/  ntfy-notify.mjs — hooks Claude Code
data/     base et fichiers utilisateur, jamais commités
```

## Avancement

- **Lot 1 — Socle** : dépôt, Docker, migrations, API CRUD idées et verdicts, catalogue et page idée, tests API, hooks ntfy. Livré — [`Docs/lots/lot-01-socle.md`](Docs/lots/lot-01-socle.md).
- **Lot 2 — Pièces jointes** : upload de fichiers et d'images, liens typés, rendu markdown, choix de la capsule, galerie, route de restauration. Livré — [`Docs/lots/lot-02-pieces-jointes.md`](Docs/lots/lot-02-pieces-jointes.md).
- **Lot 3 — Vitrine** : la corbeille d'abord (l'interface manque encore à `restore`), puis la vue Steam, la passe de direction artistique et le responsive.

Pas d'authentification : l'accès passe par le réseau Tailscale.
