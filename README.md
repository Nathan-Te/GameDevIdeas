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

Node 20 ou plus est requis.

```bash
npm install
npm run dev
```

Le front est sur <http://localhost:5173> (Vite), l'API sur le port 3000 ; Vite proxifie `/api` vers Fastify, donc les mêmes URL qu'en production.

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
| `GET` | `/api/ideas/:slug/verdicts` | Historique, du plus récent au plus ancien. |
| `POST` | `/api/ideas/:slug/verdicts` | Ajoute un verdict (`score` 0-5, `note` facultative). |

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
- **Lot 2 — Pièces jointes** : upload de fichiers et d'images, liens typés, rendu markdown, choix de la capsule, galerie.
- **Lot 3 — Vitrine** : vue Steam, corbeille, passe de direction artistique et responsive.

Pas d'authentification : l'accès passe par le réseau Tailscale.
