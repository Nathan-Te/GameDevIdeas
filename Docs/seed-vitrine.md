# Seed — « Vitrine », catalogue d'idées de jeux

Nom de code : **Vitrine**. Application web personnelle, auto-hébergée, mono-utilisateur.
Ce document est la source de vérité du projet. Il vit dans `Docs/seed-vitrine.md` et n'est modifié que par Nathan.

## 1. Pourquoi

Nathan explore des idées de jeux depuis des années, dans des chats, des Trello, des fichiers épars. Vitrine centralise chaque idée sur une page, y attache fichiers, images et liens, et surtout permet de **juger une idée comme un joueur qui scrolle Steam** : une vue « page store » générée à partir des champs de l'idée.

Ce n'est pas un outil de gestion de projet : pas de tâches, pas de kanban, pas de collaboration. Une idée, une page, un verdict daté.

## 2. Stack et hébergement

- **API** : Node.js LTS, Fastify, SQLite (fichier), `better-sqlite3`. Pas d'ORM lourd : SQL en clair + migrations numérotées dans `server/migrations/`.
- **Front** : React + Vite, TypeScript, sans framework CSS externe (CSS modules ou vanilla). Build statique servi par Fastify (`@fastify/static`).
- **Fichiers** : stockés sur disque dans un volume `data/files/`, jamais en base. La base ne garde que le chemin et les métadonnées.
- **Déploiement** : un seul conteneur, `Dockerfile` multi-stage (build front → image Node prod). `docker-compose.yml` avec deux volumes : `data/db/` et `data/files/`. Port interne 3000.
- **Accès** : réseau Tailscale de Nathan ; aucune authentification en v1. Un `.env.example` documente les variables (port, chemins de données, sujet ntfy).
- **Tests** : `node:test` sur l'API (chaque route CRUD), aucun test front en v1.
- **Dépôt** : Git dès le lot 1. Règle : un lot livré est un lot commité.

## 3. Modèle de données

### Idea
| champ | type | notes |
|---|---|---|
| id | int PK | |
| slug | text unique | dérivé du titre, modifiable |
| title | text | titre de travail |
| tagline | text | une ligne, l'accroche Steam |
| pitch | text | 2-4 phrases |
| gif | text | description du GIF de 10 s, le « moment clipable » |
| price_cents | int nullable | prix envisagé |
| family | text | énumération libre mais suggérée : `friendslop`, `dopamine-solo`, `sim-fantasme`, `inspection`, `tactique`, `party`, `coop-2`, `fps`, `educatif`, `autre` |
| status | text | `idee`, `reserve`, `prototype`, `en-cours`, `pause`, `abandonne`, `publie` |
| competition | text | concurrence connue, texte libre |
| capsule_file_id | int nullable | FK Attachment (image) utilisée comme capsule |
| created_at / updated_at | datetime | |

### Verdict
Un jugement daté. On n'écrase jamais, on ajoute : l'historique montre ce que Nathan pensait de l'idée il y a six mois.
| champ | type |
|---|---|
| id | int PK |
| idea_id | FK |
| score | int 0-5 |
| note | text |
| created_at | datetime |

Le **verdict courant** d'une idée est le plus récent.

### Attachment
| champ | type | notes |
|---|---|---|
| id | int PK | |
| idea_id | FK | |
| kind | text | `image`, `markdown`, `file`, `link` |
| label | text | |
| path | text nullable | chemin relatif dans `data/files/` pour image/markdown/file |
| url | text nullable | pour `link` |
| link_type | text nullable | `trello`, `asset-store`, `git`, `steam`, `video`, `autre` — pilote l'icône |
| position | int | ordre d'affichage |
| created_at | datetime | |

Les fichiers uploadés sont renommés `{idea_id}/{uuid}-{nom-original}` ; l'original n'est jamais écrasé.

## 4. Vues

1. **Catalogue** (`/`) — grille de capsules façon page d'accueil Steam : capsule, titre, accroche, badge de statut, score courant. Filtres : famille, statut, score minimum ; tri : score, date de mise à jour, titre. Bouton « Nouvelle idée ».
2. **Page idée** (`/idees/:slug`) — édition en place de tous les champs (un clic sur le champ l'ouvre, sortie de champ = sauvegarde, sans bouton). Sections : fiche, pièces jointes (glisser-déposer, liens ajoutés par URL avec détection du type sur le domaine), verdicts (formulaire score + note, historique en liste). Un fichier markdown attaché s'affiche rendu, dépliable.
3. **Vue Steam** (`/idees/:slug/steam`) — mime la structure d'une fiche store : capsule en tête, titre, courte description = tagline + pitch, colonne droite avec prix, famille en tags, statut, date. Les images attachées deviennent la galerie de « captures ». Une bannière discrète rappelle que c'est une maquette. Objectif : que Nathan ait le réflexe « clic ou pas clic ».
4. **Corbeille** — une idée supprimée passe en `deleted_at`, restaurable ; purge manuelle.

## 5. Direction artistique

Sobre, sombre, une seule couleur d'accent chaude. La vue Steam emprunte la mise en page du store, pas ses couleurs ni ses logos. Typographie lisible, pas d'animation gratuite. Le catalogue doit rester agréable avec 50 idées.

## 6. Hors périmètre v1
Import markdown, multi-utilisateur, authentification, recherche plein texte, export, notifications, mobile natif (le responsive suffit).

## 7. Plan en lots

- **Lot 1 — Socle** : dépôt, Docker, schéma + migrations, API CRUD Idea et Verdict, front avec Catalogue et Page idée (champs uniquement, sans pièces jointes), tests API, hooks ntfy, CLAUDE.md, README.
- **Lot 2 — Pièces jointes** : upload fichiers/images, liens typés, rendu markdown, choix de la capsule, galerie.
- **Lot 3 — Vitrine** : vue Steam, filtres et tris du catalogue, corbeille, passe de DA et responsive.

## 8. Règles durables du projet (à reporter dans CLAUDE.md)
- Un lot livré est un lot commité, sur `main`, avec un README de lot dans `Docs/lots/`.
- La base n'est jamais modifiée sans migration numérotée ; aucune migration livrée n'est réécrite après coup.
- Les fichiers utilisateur ne vont jamais en base.
- L'API renvoie toujours du JSON, erreurs comprises (`{ error, message }`).
- Pas de dépendance ajoutée sans la justifier dans le README du lot.
