# Lot 1 — Socle

Livré le 3 septembre 2026.

Objectif du lot : une idée peut être créée, listée, éditée et jugée depuis un navigateur, l'application tournant dans Docker. Pas de pièces jointes (lot 2), pas de vue Steam (lot 3).

---

## 1. Ce qui est livré

### Dépôt et outillage

- Dépôt Git initialisé sur `main`, `.gitignore` (`node_modules`, `dist`, `data/`, `.env`), `.env.example` avec une ligne de commentaire par variable.
- Structure `server/` (Fastify), `web/` (React + Vite + TypeScript), `Docs/`, `scripts/`, plus `Dockerfile` multi-étage et `docker-compose.yml`.
- Workspaces npm : un seul `npm install` à la racine installe les deux paquets.
- Scripts racine : `npm run dev` (API + Vite en parallèle avec proxy `/api`), `npm test`, `npm run build`, `npm run migrate`.
- Hooks `Stop` et `Notification` versionnés dans `.claude/settings.json`, branchés sur `scripts/ntfy-notify.mjs`.

### Base et API

- SQLite via `better-sqlite3`, mode WAL, clés étrangères actives.
- Migration `server/migrations/001-init.sql` appliquée au démarrage du serveur et enregistrée dans `schema_migrations`.
- Tables `ideas` et `verdicts` conformes au seed. `attachments` et `ideas.capsule_file_id` sont créées dès maintenant : le lot 2 n'aura pas à remigrer, et aucune route ne les sert.
- Routes JSON :
  - `GET /api/ideas` — filtres `family`, `status`, `minScore`, tri `sort`, chaque idée portant son verdict courant.
  - `POST /api/ideas`, `GET /api/ideas/:slug`, `PATCH /api/ideas/:slug` (partiel, champ par champ), `DELETE /api/ideas/:slug` (soft delete `deleted_at`).
  - `GET /api/ideas/:slug/verdicts`, `POST /api/ideas/:slug/verdicts`.
- Slug dérivé du titre, unique par suffixe numérique, modifiable par `PATCH`.
- Toute erreur ressort en `{ error, message }` avec le bon code HTTP, y compris les 404 de route inconnue sous `/api`.
- Le build front est servi en statique par Fastify avec repli SPA sur `index.html`.

### Front

- Catalogue `/` : grille de cartes (capsule placeholder, titre, accroche, badge de statut, prix, score courant), filtres famille / statut / score minimum, tri, bouton « Nouvelle idée » qui crée une idée « Sans titre » et ouvre sa page. Les filtres sont écrits dans l'URL : un catalogue filtré se met en favori et survit au rechargement.
- Page idée `/idees/:slug` : titre, accroche, pitch, GIF et concurrence en édition en place ; statut, famille, prix, slug et dates dans le panneau latéral ; indicateur discret « Enregistré » ; bouton « Corbeille ».
- Section verdicts : formulaire score 0-5 + note, historique du plus récent au plus ancien, le premier marqué « courant ».
- État serveur via `fetch` et un client typé (`web/src/api.ts`). Aucune bibliothèque d'état global.
- Direction artistique sombre et sobre, un seul accent chaud, pas d'animation gratuite, une colonne sur mobile.

### Tests

30 tests `node:test`, tous verts, une base SQLite en mémoire par test :

| Fichier | Ce qu'il couvre |
|---|---|
| `ideas.test.js` | création et valeurs par défaut, slug unique, validation des énumérations, lecture, patch partiel, `price_cents` remis à `null`, resynchronisation et figement du slug, soft delete, filtres, tris, verdict courant joint, 404 JSON |
| `verdicts.test.js` | ajout, bornes 0-5, refus des scores non entiers, historique antéchronologique, cloisonnement entre idées, 404 sur idée absente ou supprimée |
| `migrations.test.js` | schéma créé, idempotence, colonnes anticipant le lot 2, contrainte `CHECK` du score en SQL direct, `npm run migrate` de bout en bout |
| `static.test.js` | repli SPA, JSON préservé sous `/api`, asset produit après le démarrage |

### Docker

`docker compose up --build` suffit : build du front, migrations au démarrage, volumes `./data/db` et `./data/files`, port `3000:3000`, healthcheck. Vérifié sur ce poste : création d'idée et de verdict dans le conteneur, deep link servi, données conservées après `docker compose restart` sans rejouer les migrations, image finale de 266 Mo. Le conteneur tourne sur Node 24, la même LTS que le poste.

---

## 2. Les choix faits

**Serveur en JavaScript, front en TypeScript.** Le seed impose TypeScript pour le front seulement. Garder le serveur en ESM sans étape de compilation rend le `Dockerfile` plus court, `node --watch` immédiat et les traces d'erreur directement lisibles. La validation d'entrée est faite par schéma JSON, là où elle compte vraiment.

**Deux instances AJV plutôt qu'une** (`server/src/validation.js`). La query string arrive toujours en texte : `?minScore=3` doit être converti. Le corps JSON, lui, est typé à la source : `{"score": "3"}` est une erreur d'appelant, pas une chaîne à convertir en douce. `removeAdditional` est désactivé des deux côtés — le réglage par défaut de Fastify aurait supprimé silencieusement un champ mal orthographié, et un `PATCH` sur `titre` aurait renvoyé 200 sans rien changer.

**Pas de schéma de réponse Fastify.** Fastify s'en sert pour sérialiser en filtrant les propriétés non déclarées : un champ ajouté au modèle et oublié dans le schéma disparaîtrait de l'API sans erreur. La sérialisation est explicite dans `serializeIdea`.

**Le slug suit le titre tant qu'il n'a pas été personnalisé.** « Nouvelle idée » crée « Sans titre » : sans cette règle, l'idée garderait l'URL `/idees/sans-titre-7` pour toujours. Le slug est donc resynchronisé quand le titre change *et* que le slug actuel est encore celui dérivé de l'ancien titre. Dès qu'un slug est posé explicitement par un `PATCH`, il est figé et le titre ne le touche plus. Le front corrige l'URL par `replaceState`, sans empiler d'entrée d'historique ni recharger la page.

**`minScore` écarte les idées jamais jugées.** Le filtre porte sur le score du verdict courant. « Au moins 3 » ne peut pas être vrai d'une idée sans verdict, y compris pour `minScore=0`. Le tri par score, lui, les garde et les place en fin de liste.

**Ajouter un verdict ne touche pas `updated_at` de l'idée.** `updated_at` reste la date de dernière modification de la fiche. Conséquence assumée : un verdict tout neuf ne fait pas remonter l'idée dans le tri par défaut. À arbitrer si ça gêne à l'usage.

**Les listes sont enveloppées** : `{ ideas: [...] }` et `{ verdicts: [...] }` plutôt que des tableaux nus, pour pouvoir ajouter un total ou une pagination sans casser les appelants.

**Édition en place : la fermeture est un changement d'état, pas un effet du focus.** Première version : Entrée appelait `blur()` et c'est `onBlur` qui enregistrait. Si le champ n'a pas réellement le focus — fenêtre en arrière-plan au moment de l'ouverture, focus volé par un autre élément — `blur()` ne fait rien et la saisie est perdue en silence. Constaté en pilotant l'application dans un navigateur dont la fenêtre n'avait pas le focus. Entrée et Échap concluent maintenant l'édition directement, `onBlur` reste le cas du clic à côté, et un verrou empêche la double sauvegarde.

**Entrée dans un champ long insère un saut de ligne.** On ne pourrait pas écrire un pitch en deux paragraphes autrement. La sauvegarde s'y fait à la sortie du champ ou par Ctrl/Cmd + Entrée ; le rappel est écrit sous le panneau latéral.

**`@fastify/static` en mode `wildcard` par défaut.** Avec `wildcard: false`, le module photographie le dossier au démarrage : tout fichier produit par un build ultérieur renvoyait 404, donc page blanche après un `npm run build` serveur déjà lancé. Rencontré pendant le développement ; `static.test.js` couvre désormais le cas.

**Le front statique est servi si le build existe.** `SERVE_STATIC` non défini signifie « sers `web/dist` s'il est là ». `npm run dev` fonctionne donc sans variable d'environnement, ce qui évite les incompatibilités de syntaxe entre shells.

**Routeur maison** (`web/src/router.tsx`, une cinquantaine de lignes). Deux routes au lot 1, quatre au lot 3. Les liens restent de vrais `<a>` : Ctrl+clic et clic milieu fonctionnent. À remplacer par `react-router` si le routage se complique — pas avant.

---

## 3. Dépendances ajoutées

### Serveur

| Dépendance | Pourquoi |
|---|---|
| `fastify` | Imposée par le seed. Serveur HTTP et validation par schéma JSON. |
| `better-sqlite3` | Imposée par le seed. API synchrone, ce qui convient à une application mono-utilisateur et rend les migrations triviales. Version 12.x : elle embarque une binaire précompilée pour Node 24, donc aucune chaîne C++ n'est nécessaire à l'installation. |
| `@fastify/static` | Imposée par le seed pour servir le build front. |
| `ajv` | Le compilateur de schémas de Fastify. Déclaré explicitement parce que `server/src/validation.js` instancie ses deux AJV lui-même (voir « Les choix faits ») ; s'appuyer sur une dépendance transitive serait fragile. Déjà présent dans l'arbre, coût d'installation nul. |

### Front

| Dépendance | Pourquoi |
|---|---|
| `react`, `react-dom` | Imposées par le seed. |
| `vite`, `@vitejs/plugin-react` | Imposées par le seed. Build et serveur de développement. |
| `typescript`, `@types/react`, `@types/react-dom` | Imposés par le seed. |
| `@types/node` (dev) | Uniquement pour typer `process.env` dans `vite.config.ts`, où le port de l'API se surcharge. Types seuls, rien à l'exécution. |

### Racine

| Dépendance | Pourquoi |
|---|---|
| `concurrently` (dev) | Lance l'API et Vite en parallèle avec des préfixes lisibles et une propagation correcte des signaux sur Windows comme sur Linux. Les alternatives (`&` du shell, `npm-run-all`) ne sont pas fiables sur les deux à la fois. |

Aucune dépendance de routage, d'état global, de framework CSS ni d'ORM. Le seed les exclut ou elles ne se justifient pas encore.

---

## 4. Points laissés ouverts

1. **La corbeille n'a pas d'interface.** `DELETE` pose `deleted_at` et l'API sait lister les idées supprimées (`GET /api/ideas?deleted=true`), mais il n'y a ni restauration ni purge : c'est le lot 3. En attendant, une idée supprimée par erreur se récupère par `PATCH`… qui ne sait pas remettre `deleted_at` à `null`. **À aujourd'hui, une suppression n'est annulable qu'en SQL.** Si ça t'inquiète, c'est le premier truc à corriger au lot 3.
2. **`updated_at` et les verdicts.** Voir « Les choix faits ». Dis-moi si un verdict doit faire remonter l'idée dans le tri par défaut.
3. **La capsule est un placeholder** : un dégradé avec l'initiale du titre. Elle devient une vraie image au lot 2, quand `capsule_file_id` sera renseigné.
4. **`family` est fermée côté API** à l'énumération du seed, alors que le seed la décrit comme « libre mais suggérée ». Une valeur hors liste est refusée en 400. Ouvrir demande une décision : champ libre avec suggestions, ou liste éditable.
5. **Aucun test front.** Conforme au seed (« aucun test front en v1 »). Les parcours de la page idée ont été vérifiés à la main dans un navigateur piloté ; le détail est dans la checklist ci-dessous.
6. **Pas d'authentification**, conforme au seed : l'accès passe par Tailscale. Le port 3000 est publié sur toutes les interfaces par `docker-compose.yml` — à restreindre à l'interface Tailscale si la machine est exposée.
7. **Module natif et version de Node.** `better-sqlite3` est compilé pour une version précise de l'ABI Node. Changer de version majeure de Node sans relancer `npm install` produit une erreur `ERR_DLOPEN_FAILED` (« compiled against a different Node.js version »). C'est arrivé au passage de Node 14 à Node 24 sur le poste de Nathan : `npm install` a suffi à corriger. Le `Dockerfile` utilise la même LTS, Node 24, pour que le conteneur et le poste ne divergent pas.

---

## 5. Checklist de vérification manuelle

Prérequis : Node 20 ou plus installé (point 7 ci-dessus), puis `npm install` à la racine.

### Docker

- [ ] `docker compose up --build` démarre sans erreur et affiche `migration appliquée : 001-init` au premier lancement.
- [ ] `http://localhost:3000` affiche le catalogue.
- [ ] `docker compose restart` conserve les idées et ne rejoue pas la migration.
- [ ] `data/db/vitrine.db` et `data/files/` existent sur le disque après le premier démarrage.

### Catalogue

- [ ] « Nouvelle idée » crée une idée « Sans titre » et ouvre directement sa page.
- [ ] Une idée créée apparaît dans la grille avec son badge de statut et un tiret à la place du score.
- [ ] Les filtres famille, statut et score minimum réduisent la grille ; le bouton « Effacer les filtres » les remet à zéro.
- [ ] Les quatre tris changent l'ordre ; le tri par score place les idées jamais jugées en dernier.
- [ ] Un catalogue filtré garde ses filtres après un rechargement de page (F5) : ils sont dans l'URL.

### Page idée

- [ ] Un clic sur le titre ouvre le champ ; Entrée enregistre et « Enregistré » apparaît une seconde.
- [ ] Renommer une idée fraîchement créée change l'adresse : `/idees/sans-titre` devient `/idees/le-nouveau-titre`.
- [ ] Modifier ensuite le slug à la main dans le panneau, puis rechanger le titre : le slug ne bouge plus.
- [ ] Échap dans un champ ouvert annule la saisie et laisse la valeur d'origine.
- [ ] Dans le pitch, Entrée saute une ligne ; cliquer ailleurs enregistre, Ctrl+Entrée aussi.
- [ ] Changer le statut ou la famille dans le panneau enregistre immédiatement.
- [ ] Saisir `12,50` dans le prix affiche `12,50 €` ; vider le champ le remet à vide.
- [ ] Recharger la page (F5) sur `/idees/mon-slug` fonctionne — c'est le repli SPA.

### Verdicts

- [ ] Ajouter un verdict avec un score et une note le fait apparaître en haut de l'historique, marqué « courant ».
- [ ] Ajouter un second verdict : le premier reste dans l'historique, le nouveau devient courant, y compris avec un score plus bas.
- [ ] Le score du panneau et la carte du catalogue affichent le score du verdict le plus récent.

### Suppression

- [ ] « Corbeille » demande confirmation, puis renvoie au catalogue.
- [ ] L'idée supprimée ne figure plus dans la grille, et son adresse renvoie « Aucune idée à cette adresse ».

### Mobile

- [ ] À la largeur d'un téléphone, le catalogue passe sur deux colonnes et la page idée sur une seule, sans défilement horizontal.

### Notifications

- [ ] Une fin de tour de Claude Code fait arriver une notification ntfy titrée `GameDevWebApp` sur le sujet `pg-nathan-7k2x`, en priorité normale ; une demande d'autorisation arrive en priorité basse.
