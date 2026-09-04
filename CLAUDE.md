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
- Tout HTML issu d'un contenu utilisateur (markdown, labels) passe par DOMPurify avant insertion.
- L'API renvoie toujours du JSON, erreurs comprises (`{ error, message }`).
- Pas de dépendance ajoutée sans la justifier dans le README du lot.

## Commandes

```bash
npm install                  # une seule fois, à la racine (workspaces npm)
npm run dev                  # API Fastify (3000) + Vite (5173) en parallèle, proxy /api et /files
npm test                     # tests node:test de l'API
npm run build                # build du front dans web/dist
npm run migrate              # applique les migrations en attente sans démarrer le serveur
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
| `MAX_UPLOAD_MB` | `50` | Taille maximale d'un fichier envoyé. Au-delà : 413, et rien n'est écrit. |
| `LINK_TITLE_LOOKUP` | activé | Aller chercher le titre de la page pour libeller un lien collé sans label. Coupé, le libellé retombe sur le nom de domaine. |
| `DEVELOPER_NAME` | `Nathan` | Nom affiché comme développeur et éditeur sur la vue store, servi par `GET /api/config`. |
| `SERVE_STATIC`, `WEB_DIST` | `web/dist` s'il existe | Front statique avec repli SPA. |
| `LOG_LEVEL` | `info` | Journalisation Fastify. |
| `NTFY_TOPIC`, `NTFY_SERVER` | `pg-nathan-7k2x`, `ntfy.sh` | Hooks Claude Code, pas l'application. |

## Carte des routes

| Route | Rôle |
|---|---|
| `GET /api/config` | Configuration lisible par le front. Une seule valeur : `developer_name`. |
| `GET /api/ideas` | Catalogue, filtres `family` / `status` / `minScore` / `wishlisted` / `deleted`, tri `sort`. |
| `POST /api/ideas` | Création. |
| `GET`, `PATCH`, `DELETE /api/ideas/:slug` | Lecture, mise à jour partielle (dont `capsule_file_id` et `wishlisted`), corbeille. |
| `POST /api/ideas/:slug/restore` | Sort l'idée de la corbeille. 404 si elle n'y est pas. |
| `DELETE /api/ideas/:slug/purge` | Suppression définitive. N'accepte qu'une idée en corbeille (404 sinon) : verdicts, pièces jointes et idée dans une transaction, puis `data/files/{idea_id}/` en entier. |
| `GET`, `POST /api/ideas/:slug/verdicts` | Historique et ajout d'un verdict. |
| `GET`, `POST /api/ideas/:slug/attachments` | Liste ; ajout par multipart (fichiers) ou JSON `{ url, label? }` (lien). |
| `PUT /api/ideas/:slug/attachments/order` | Réordonne, `{ ids: [...] }` complet, en une transaction. |
| `PATCH`, `DELETE /api/attachments/:id` | `label` / `position` / `link_type` ; suppression ligne + fichier. |
| `GET /files/*` | Fichiers utilisateur, garde stricte contre la traversée de chemin, cache long. |
| Tout le reste | `index.html` si le front est construit, sinon 404 JSON. Jamais sous `/api` ni `/files`. |

Côté front, quatre vues : `/` (catalogue), `/idees/:slug` (fiche éditable), `/idees/:slug/steam` et `/corbeille`.

`/idees/:slug/steam` est une réplique fidèle du store de bureau, sans logo ni marque ; seul le bouton de liste de souhaits est actif. Le reste — enchaîner les idées en respectant les filtres, revenir à l'édition — vit dans une fine barre de service au-dessus de la maquette, hors du photomontage. Elle n'a pas de version mobile : elle s'éloigne (`zoom`) et se fait défiler.

## Plan en lots

- **Lot 1 — Socle** : livré. Dépôt, Docker, schéma, API idées et verdicts, catalogue et page idée.
- **Lot 2 — Pièces jointes** : livré. Upload, liens typés, markdown rendu, capsule, galerie, `restore`.
- **Lot 3 — Vitrine** : livré. Corbeille et purge, vue Steam, feuille de tokens, passe de DA et responsive.
- **Lot 3b — La vraie vitrine** : livré. Vue store refaite en réplique fidèle, liste de souhaits (migration `003`, `ideas.wishlisted_at`), filtre et marqueur au catalogue, `DEVELOPER_NAME`. **La v1 est close.**

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
shared/           store-model.js — la traduction « idée » → « fiche de magasin »
                  (JS pur, importé par le front et testé par node:test)
server/           API Fastify + SQLite (JavaScript ESM, pas de build)
  migrations/     Migrations SQL numérotées
  src/            config, db, migrate, routes, validation, dépôts SQL,
                  files.js (disque et garde de chemin), links.js (liens typés)
  test/           node:test, une base en mémoire par test
web/              Front React + Vite + TypeScript
  src/            api (client typé), router, filters (filtres d'URL partagés),
                  pages, composants, tokens.css puis styles.css,
                  steam.css (la palette du photomontage, hors tokens)
Docs/             seed-vitrine.md (source de vérité) et lots/
scripts/          ntfy-notify.mjs (hooks Claude Code)
data/             base SQLite et fichiers utilisateur — jamais commité
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
