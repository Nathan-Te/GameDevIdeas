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
- L'API renvoie toujours du JSON, erreurs comprises (`{ error, message }`).
- Pas de dépendance ajoutée sans la justifier dans le README du lot.

## Commandes

```bash
npm install                  # une seule fois, à la racine (workspaces npm)
npm run dev                  # API Fastify (3000) + Vite (5173) en parallèle, proxy /api
npm test                     # tests node:test de l'API
npm run build                # build du front dans web/dist
npm run migrate              # applique les migrations en attente sans démarrer le serveur
docker compose up --build    # l'application complète sur http://localhost:3000
```

En développement, on travaille sur `http://localhost:5173` : Vite sert le front et proxifie `/api` vers Fastify. En production, Fastify sert `web/dist` en statique avec repli SPA.

Node 20 ou plus est requis (`node:test`, Fastify 5, Vite 6).

## Convention des migrations

- Un fichier par migration dans `server/migrations/`, nommé `NNN-description.sql` (`001-init.sql`, `002-…`), numéro sur trois chiffres.
- Elles sont appliquées dans l'ordre numérique, chacune dans une transaction, et enregistrées dans la table `schema_migrations`. Une migration déjà appliquée n'est jamais rejouée.
- Le serveur applique les migrations en attente à chaque démarrage ; `npm run migrate` fait la même chose sans écouter de port.
- **Une migration livrée ne se modifie pas.** Une correction, un renommage ou un ajout de colonne passe par une nouvelle migration numérotée.
- Le SQL est écrit en clair : pas d'ORM, pas de générateur de schéma.

## Convention des READMEs de lot

Chaque lot livré a son fichier dans `Docs/lots/`, nommé `lot-NN-nom.md` (`lot-01-socle.md`). Il contient au minimum :

1. **Ce qui est livré** — le périmètre réellement couvert, vérifiable.
2. **Les choix faits** — les décisions structurantes et leurs raisons, y compris celles qu'on pourrait regretter.
3. **Les dépendances ajoutées et pourquoi** — une ligne par dépendance ; c'est là que se justifie la règle du seed.
4. **Les points laissés ouverts** — ce qui est reporté, ce qui est incertain, ce qui attend un arbitrage de Nathan.
5. **La checklist de vérification manuelle** — ce que Nathan clique lui-même pour valider le lot.

## Structure

```
server/           API Fastify + SQLite (JavaScript ESM, pas de build)
  migrations/     Migrations SQL numérotées
  src/            config, db, migrate, routes, validation, dépôt SQL
  test/           node:test, une base en mémoire par test
web/              Front React + Vite + TypeScript
  src/            api (client typé), router, pages, composants, styles.css
Docs/             seed-vitrine.md (source de vérité) et lots/
scripts/          ntfy-notify.mjs (hooks Claude Code)
data/             base SQLite et fichiers utilisateur — jamais commité
```

## Conventions de code

- Serveur en JavaScript ESM, front en TypeScript strict. Le serveur n'a pas d'étape de compilation.
- SQL en clair dans `server/src/ideas-repo.js` ; les routes ne contiennent pas de requête.
- Les erreurs passent par `HttpError` (`server/src/errors.js`) et ressortent en `{ error, message }`.
- Les entrées sont validées par schéma JSON Fastify (`server/src/schemas.js`). Pas de schéma de réponse : la sérialisation est explicite.
- Front sans bibliothèque d'état global ni de routage : `fetch` + un client typé (`web/src/api.ts`), un routeur maison (`web/src/router.tsx`).
- Direction artistique : sombre, sobre, un seul accent chaud (`--accent`), pas d'animation gratuite, lisible sur mobile.
- Commentaires et interface en français.

## Hooks

`.claude/settings.json` branche les hooks `Stop` et `Notification` sur `scripts/ntfy-notify.mjs`, qui publie sur le sujet ntfy lu dans `NTFY_TOPIC` (défaut `pg-nathan-7k2x`). Le titre de la notification est le nom du dossier racine du projet. Priorité basse quand Claude attend, normale à la fin d'un tour.
