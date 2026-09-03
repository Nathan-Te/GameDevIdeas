# Lot 2 — Pièces jointes

Livré le 3 septembre 2026.

Objectif du lot : une idée reçoit des images, des markdown, des fichiers quelconques et des liens typés ; une image attachée devient la capsule ; un markdown attaché se lit rendu dans la page. Pas de vue Steam, pas d'interface de corbeille (lot 3).

---

## 1. Ce qui est livré

### Arbitrages du lot 1

- **Point 1 (corbeille)** — `POST /api/ideas/:slug/restore` remet `deleted_at` à `null` et renvoie 404 si l'idée n'est pas dans la corbeille. Pas d'interface : le lot 3 la construira. **Une suppression est redevenue annulable sans ouvrir la base.**
- **Point 2 (`updated_at`)** — inchangé : ajouter un verdict ne touche pas `updated_at`.
- **Point 4 (`family`)** — l'énumération reste fermée côté API.

### Base

- `002-attachment-size.sql` ajoute `attachments.size_bytes`. Le reste de la table venait de `001-init.sql`, qui n'a pas été touchée.

### Stockage

- Upload multipart via `@fastify/multipart`, limite lue dans `MAX_UPLOAD_MB` (défaut 50). Le flux est écrit au fil de l'eau : un fichier de 50 Mo ne passe jamais en entier par la mémoire.
- Chemin `data/files/{idea_id}/{uuid}-{nom-nettoyé}`. L'UUID garantit qu'un second envoi du même nom n'écrase pas le premier. Le nom nettoyé ne garde que `[a-zA-Z0-9._-]`, les diacritiques étant dépliés avant d'être retirés : `Capsule pêche (finale).png` devient `Capsule-peche-finale.png` plutôt que `Capsule-p-che-finale-.png`.
- `kind` déduit de l'extension **et** du type MIME : `image` (png, jpg, webp, gif), `markdown` (`.md`, `.markdown`), sinon `file`. Un PNG annoncé `application/octet-stream` par le navigateur reste une image.
- Un envoi refusé ou interrompu ne laisse rien : tout ce que la requête avait déjà écrit est effacé, et les lignes déjà créées avec.

### API

- `GET /api/ideas/:slug/attachments` — triées par `position`.
- `POST /api/ideas/:slug/attachments` — multipart (un ou plusieurs fichiers) ou JSON `{ url, label? }` pour un lien. Répond `201` et `{ attachments: [...] }` dans les deux cas.
- `PATCH /api/attachments/:id` — `label`, `position`, `link_type`.
- `DELETE /api/attachments/:id` — supprime la ligne puis le fichier ; si c'était la capsule, `capsule_file_id` repasse à `null`.
- `PUT /api/ideas/:slug/attachments/order` — `{ ids: [...] }`, une transaction.
- `PATCH /api/ideas/:slug` accepte `capsule_file_id` : la pièce doit être une image de cette idée, sinon 400.
- `GET /files/*` — sert `data/files/` avec garde stricte contre la traversée de chemin, `Cache-Control` d'un an et `immutable`.
- `GET /api/ideas/:slug` et chaque carte de `GET /api/ideas` portent `capsule_url`, nul tant qu'aucune capsule n'est choisie.
- `serializeAttachment` est explicite, comme `serializeIdea`.

Détection du `link_type`, par domaine, sous-domaines compris :

| Domaine | Type |
|---|---|
| `trello.com` | `trello` |
| `assetstore.unity.com` | `asset-store` |
| `github.com`, `gitlab.com`, `bitbucket.org` | `git` |
| `store.steampowered.com` | `steam` |
| `youtube.com`, `youtu.be` | `video` |
| tout le reste | `autre` |

Le libellé par défaut d'un lien est le titre de la page si elle répond en moins de trois secondes, sinon le nom de domaine sans `www.`.

### Front

- **Section Pièces jointes** sur la page idée : zone de dépôt (glisser-déposer et clic), champ « Ajouter un lien », liste réordonnable.
- **Envoi** : une barre de progression par fichier, un fichier par requête, les fichiers d'un même dépôt envoyés l'un après l'autre. Un envoi qui échoue garde sa ligne avec son message, et les suivants partent quand même.
- **Réordonnancement** par glisser-déposer HTML5, sans bibliothèque : la liste se réarrange en direct pendant le survol, l'ordre est enregistré au relâchement. Les flèches haut et bas sur la poignée font le même déplacement au clavier.
- **Carte image** : vignette au format capsule, « Définir comme capsule », la capsule courante porte un marqueur.
- **Carte markdown** : « Lire » déplie le rendu, produit par `marked` puis assaini par `DOMPurify`. Les liens s'ouvrent dans un nouvel onglet, en `noopener noreferrer`.
- **Carte fichier** : nom, poids, téléchargement.
- **Carte lien** : icône par `link_type`, libellé éditable en place, URL en survol et au clic.
- **Suppression** avec confirmation.
- **Capsule** : remplace le placeholder sur la carte du catalogue et en tête de la page idée, au ratio 460 × 215, recadrée par `object-fit: cover`.
- **Galerie** : un clic sur une vignette ouvre l'image en grand. Flèches pour naviguer, Échap ferme, clic sur le fond aussi.

### Tests

29 tests ajoutés, 59 au total, tous verts.

| Fichier | Ce qu'il couvre |
|---|---|
| `attachments.test.js` | envoi d'une image, d'un markdown et d'un fichier (`kind`, présence sur le disque, nom nettoyé, poids) ; PNG annoncé en octet-stream ; envoi multiple ; refus au-delà de `MAX_UPLOAD_MB` sans rien laisser sur le disque ; multipart sans fichier ; idée inconnue ou supprimée ; `link_type` pour chaque domaine de la liste et le cas `autre` ; sous-domaines et voisins de nom ; libellé de repli ; URL non http(s) ; lecture réelle d'un `<title>` contre un serveur local ; réordonnancement et `position` de nouvelle pièce ; listes d'ordre invalides ; `PATCH position` ; `label` et `link_type` ; suppression (ligne, fichier, capsule libérée) ; capsule refusée si non-image ou d'une autre idée ; `capsule_url` jusqu'aux cartes du catalogue |
| `files.test.js` | fichier servi avec cache long et `nosniff` ; markdown en texte, type inconnu en téléchargement ; fichier absent en 404 JSON malgré le repli SPA ; traversée de chemin sous onze écritures (`..`, `%2e%2e`, double encodage, `%2f`, `%5c`, chemin absolu, octet nul) ; dossier non listé |
| `ideas.test.js` | `restore` : succès, et 404 sur idée vivante, inconnue, ou déjà restaurée |
| `migrations.test.js` | mis à jour : `size_bytes` dans le schéma, comptage des migrations désormais dérivé de la liste |

### Vérifié à la main

L'application a été pilotée dans un navigateur, front construit servi par Fastify : envoi de quatre fichiers d'un coup, dépôt par glisser-déposer, ajout des cinq types de liens (Trello et Steam ont bien rendu leur titre de page, GitHub est retombé sur le domaine), rendu markdown avec `<script>` et `onerror` neutralisés, choix et retrait de la capsule, visionneuse au clavier, réordonnancement par glisser-déposer et par flèches, renommage en place, suppression de la capsule (fichier disparu du disque, `capsule_file_id` libéré, en-tête et carte revenus au placeholder), refus d'un fichier de 60 Mo affiché dans l'interface, et onze tentatives de traversée de chemin sur `/files/` — aucune n'a servi un fichier hors du dossier.

---

## 2. Les choix faits

**Une migration pour `size_bytes`.** La carte « fichier » affiche le poids. On pouvait le lire sur le disque à chaque sérialisation, mais c'était un `stat` par pièce jointe et par affichage. La métadonnée a sa place en base, à côté du chemin — c'est le chemin qui compte comme « fichier utilisateur », pas sa taille. Conséquence visible : `size_bytes` arrive en fin de table, après `created_at`, parce qu'un `ALTER TABLE` ajoute à la fin ; `migrations.test.js` le dit explicitement pour que ça ne surprenne personne.

**`POST .../attachments` répond toujours `{ attachments: [...] }`.** Un envoi multipart peut porter plusieurs fichiers ; un lien n'en produit qu'un. Répondre un objet dans un cas et un tableau dans l'autre ferait une route dont la forme de réponse dépend de son entrée — un piège pour l'appelant. Le front prend `[0]` pour un lien, c'est le prix.

**Le corps JSON du lien est validé dans le handler, pas par un schéma déclaré à Fastify.** Un schéma de corps s'appliquerait aussi aux requêtes multipart, dont le corps n'est pas du JSON : `request.body` y est `undefined` et la validation échouerait. `compileBody` (`validation.js`) donne un validateur AJV utilisable hors du cycle Fastify, avec le même AJV strict et les mêmes règles. La validation reste par schéma, elle change juste de point d'application.

**`position` est une place, pas une valeur.** Poser `position: 3` sans toucher aux voisines créerait deux pièces en position 3. Un `PATCH position` retire donc la pièce de l'ordre courant, la réinsère au rang demandé et renumérote la liste de 0 à n-1. Le rang est borné à la taille de la liste.

**`PUT .../order` exige la liste complète.** Accepter une liste partielle laisserait le sort des absentes à l'interprétation : devant ? derrière ? à leur place ? Le front envoie toujours tout, et un refus ne change rien à l'ordre enregistré.

**La ligne part avant le fichier.** C'est la règle ajoutée à `CLAUDE.md`. Une ligne qui pointe sur un fichier absent casse un affichage et se voit ; un fichier orphelin ne se voit pas. Si l'effacement disque échoue, on préfère l'orphelin.

**`capsule_file_id` revient à `null` par la clé étrangère.** `001-init.sql` déclarait déjà `ON DELETE SET NULL`, et `db.js` active `foreign_keys` sur chaque connexion. Rien n'est réécrit côté application : la base tient l'invariant elle-même, ce qui vaut aussi pour une suppression faite en SQL direct. Le test le vérifie de bout en bout.

**`/files/*` est écrit à la main plutôt que délégué à `@fastify/static`.** La garde contre la traversée de chemin est le cœur de cette route : on la veut lisible, à un seul endroit, et testable là où elle est écrite. `resolveInsideFiles` neutralise `..`, les chemins absolus, l'octet nul, et suit les liens symboliques avant de comparer — puis renvoie `null` si le résultat sort de `data/files/`. La réponse est 404, jamais 403 : un 403 confirmerait à l'appelant que la cible existe.

**Deux issues acceptables pour une traversée, pas une seule.** Le routeur de Fastify normalise certaines écritures (`/files/../x`) avant que la route ne les voie : la requête retombe alors sur le repli SPA et renvoie `index.html`. Les autres (`%252e%252e`, `..%2f`) arrivent jusqu'à la garde et prennent un 404. Le test vérifie ce qui compte — aucun fichier hors du dossier n'est jamais servi — et non un code de retour uniforme qui aurait demandé de contrarier le routeur.

**Tout ce qui n'est pas explicitement sûr est téléchargé.** Les fichiers sont servis depuis l'origine de l'application. Un `.html` ou un `.svg` rendu en ligne y exécuterait son propre script, avec accès à tout ce que la page peut faire. Seule une liste courte (images du seed, markdown, texte, PDF, mp4/webm/mp3/ogg) part en `inline` ; le reste sort en `application/octet-stream` avec `Content-Disposition: attachment`, plus `X-Content-Type-Options: nosniff` partout. Conséquence assumée : **un SVG attaché est un `file`, pas une `image`** — il ne peut pas devenir capsule et ne s'affiche pas en vignette. Le seed fixe la liste des images à png, jpg, webp, gif ; le SVG n'y est pas, et c'est aussi bien.

**Le markdown passe par DOMPurify, même venant du disque de Nathan.** Un `.md` attaché vient rarement de nulle part : un README récupéré sur un dépôt, une note exportée d'un autre outil. `marked` laisse passer le HTML brut qu'il trouve dans le markdown, donc `<script>` et `onerror` compris. La règle est maintenant dans `CLAUDE.md` : tout HTML issu d'un contenu utilisateur est assaini avant insertion. C'est la seule insertion de HTML de l'application.

**Les liens du markdown s'ouvrent dans un nouvel onglet.** Un `afterSanitizeAttributes` pose `target="_blank"` et `rel="noopener noreferrer"` sur chaque `<a>`. Sans `noopener`, la page cible garderait une poignée sur celle-ci.

**Le libellé d'un lien va chercher le titre de la page — et ça se coupe.** Le serveur appelle alors le domaine collé par Nathan, avec trois secondes et 64 Ko au maximum, en s'arrêtant dès que `</title>` est vu. `LINK_TITLE_LOOKUP=false` coupe l'appel sortant et le libellé retombe sur le nom de domaine. La variable existe pour deux raisons : une instance sans accès Internet, et des tests qui ne doivent dépendre d'aucun réseau. Le comportement réel de la lecture de titre est vérifié à part, contre un petit serveur `node:http` monté dans le test.

**Un fichier par requête, envoyés l'un après l'autre.** Une requête par fichier, parce que la progression d'un envoi groupé est indistincte et que le lot demande une barre par fichier. Séquentiel, parce que `position` vaut max + 1 : en parallèle, cinq captures déposées dans l'ordre arriveraient dans l'ordre où elles finissent de monter. Constaté en pilotant l'application : quatre fichiers déposés ensemble sortaient dans le désordre. Les barres apparaissent maintenant toutes d'un coup et se remplissent à tour de rôle.

**XHR et non `fetch` pour l'envoi.** `fetch` n'expose aucun événement de progression d'upload : il faudrait un `ReadableStream` en corps de requête, qui n'est pas disponible partout et n'aide pas de toute façon. `XMLHttpRequest.upload` donne `progress` directement. Mesuré sur boucle locale : trois événements pour 60 Mo (42 %, 97 %, 100 %) — peu, parce que le socket local avale tout ; sur Tailscale il y en aura beaucoup plus.

**`draggable` n'est posé que pendant qu'on tient la poignée.** Une carte en permanence `draggable` empêcherait de sélectionner le texte d'un libellé éditable. Un `mousedown` sur la poignée arme le glisser, un `mouseup` le désarme. Les flèches haut et bas sur la poignée font le même déplacement — ce qui donne au passage un chemin sans souris, là où le glisser-déposer HTML5 n'existe pas (tactile).

**Le compte des `dragenter` plutôt qu'un booléen.** `dragenter` et `dragleave` se déclenchent aussi en passant d'un enfant à l'autre : la zone de dépôt clignotait dès qu'on survolait son texte. On compte les entrées et les sorties.

**Ratio 460 × 215 partout.** C'est le format d'une capsule Steam. La carte du catalogue passe de 16/9 à 460/215, la vignette d'une image attachée le reprend : on voit immédiatement ce que l'image donnerait en capsule. L'image est recadrée par `object-fit: cover`, jamais déformée.

**Icônes tracées à la main.** Huit tracés SVG dans `web/src/components/icons.tsx`, suivant `currentColor`. Une police d'icônes ou une bibliothèque pour huit tracés ne se justifiait pas.

**Le corps multipart des tests est construit à la main.** Une trentaine de lignes de concaténation dans `attachments.test.js`, plutôt qu'une dépendance de test (`form-data`) pour trois en-têtes et une frontière.

---

## 3. Dépendances ajoutées

### Serveur

| Dépendance | Pourquoi |
|---|---|
| `@fastify/multipart` | Attendue par le lot. Analyse le corps multipart en flux, avec une limite de taille par fichier — c'est ce qui permet d'écrire au fil de l'eau au lieu de charger le fichier en mémoire. Version 10.x : la ligne compatible Fastify 5. |

### Front

| Dépendance | Pourquoi |
|---|---|
| `marked` | Attendue par le lot. Markdown vers HTML, GFM compris (tableaux, listes de tâches). Rendu synchrone, donc pas d'état d'attente à gérer. |
| `dompurify` | Attendue par le lot. Assainit le HTML produit par `marked` avant insertion. Embarque ses propres types TypeScript depuis la version 3 : `@types/dompurify` n'est plus qu'un paquet vide et n'a pas été ajouté. |

Aucune autre dépendance. Le glisser-déposer, le réordonnancement et la visionneuse sont écrits à la main : ce sont des API du navigateur, et les bibliothèques du domaine pèsent plus que le code qu'elles remplacent ici.

Les deux paquets front ajoutent environ 60 Ko au bundle (300 Ko au total, 96 Ko gzip). Ils ne sont pas chargés paresseusement : sur une application mono-utilisateur servie en local ou par Tailscale, la complexité d'un découpage ne se paie pas.

---

## 4. Points laissés ouverts

1. **La corbeille n'a toujours pas d'interface.** `POST /api/ideas/:slug/restore` existe et est testée, `GET /api/ideas?deleted=true` liste les supprimées, mais aucun écran ne les montre — et il n'y a pas de purge. C'est **le premier morceau du lot 3**.
2. **Rien ne nettoie les fichiers d'une idée supprimée.** Une idée en corbeille garde ses pièces jointes en base et ses fichiers sur le disque, ce qui est voulu tant qu'elle est restaurable. Mais aucune purge n'existe encore : le jour où le lot 3 supprimera définitivement une idée, il faudra effacer `data/files/{idea_id}/` dans la même opération. À faire au lot 3, avec la corbeille.
3. **Le serveur va chercher le titre des liens collés.** Il émet donc une requête sortante vers un domaine choisi par ce qu'on colle — y compris une adresse du réseau local si on colle une adresse du réseau local. Sur une instance mono-utilisateur derrière Tailscale, le risque est celui de se viser soi-même. `LINK_TITLE_LOOKUP=false` coupe l'appel. Si tu veux le garder tout en excluant les adresses privées, dis-le et j'ajoute le filtre.
4. **Pas de vignettes réduites.** Une capture de 4 Mo est envoyée telle quelle au navigateur pour un affichage de 92 pixels de large, sur la carte comme dans le catalogue. Redimensionner à l'envoi demanderait une bibliothèque d'images côté serveur (`sharp`, une binaire native de plusieurs dizaines de mégaoctets). À arbitrer si le catalogue devient lent avec cinquante idées illustrées.
5. **`link_type` se corrige mais rien ne le propose dans l'interface.** La route `PATCH /api/attachments/:id` l'accepte et c'est testé ; l'interface n'offre pas de sélecteur. Un lien Notion vers un dépôt reste marqué `autre`. À ajouter si ça gêne.
6. **Le poids du prix se coupe en deux lignes dans le panneau latéral** (`12,90 €` s'affiche sur deux lignes). C'est un reste du lot 1 — `.editable` porte `overflow-wrap: anywhere` — et le lot 1 est validé tel qu'il est livré, donc je n'y ai pas touché. Un `white-space: nowrap` sur `.idea__price` suffirait ; dis-moi si tu veux que ça parte au lot 3 avec la passe de DA.
7. **Aucun test front**, conforme au seed. Les parcours ont été vérifiés à la main dans un navigateur piloté ; le détail est plus haut et la checklist ci-dessous.
8. **Le nom d'origine est aussi le libellé.** Un fichier `IMG_20240912_183045.jpg` s'attache avec ce libellé-là. Il est éditable en place, mais rien ne propose mieux.

---

## 5. Checklist de vérification manuelle

Prérequis : `npm install` à la racine (deux nouvelles dépendances front, une serveur), puis `npm run dev` ou `docker compose up --build`.

### Envoi de fichiers

- [ ] Glisser deux images sur la zone de dépôt : la zone s'allume au survol, deux barres apparaissent, les images arrivent **dans l'ordre où elles ont été déposées**.
- [ ] Cliquer sur la zone ouvre le sélecteur de fichiers ; choisir plusieurs fichiers marche aussi.
- [ ] Attacher un `.md` : la carte annonce « Markdown » et son poids.
- [ ] Attacher un `.zip` ou un `.pdf` : la carte annonce « Fichier », et « Télécharger » enregistre le fichier sous son nom d'origine nettoyé.
- [ ] Attacher un fichier de plus de 50 Mo : la barre passe en rouge avec « la limite est de 50 Mo », et rien n'apparaît dans la liste.
- [ ] Attacher deux fois le même fichier : les deux existent, aucun n'a écrasé l'autre.
- [ ] Regarder `data/files/{id}/` : un dossier par idée, des noms `{uuid}-{nom}` sans accent ni espace.

### Liens

- [ ] Coller `https://trello.com/b/...` puis Entrée : la carte apparaît avec l'icône Trello, libellée du titre du board.
- [ ] Coller une adresse Steam, un dépôt Git, une vidéo YouTube et une adresse quelconque : chacune prend son icône, la dernière étant un maillon.
- [ ] Coller `pas une url` : message d'erreur, rien n'est créé.
- [ ] Cliquer sur le libellé d'un lien, le renommer, Entrée : le nouveau nom tient après un F5.
- [ ] Survoler la ligne sous le libellé : l'URL complète s'affiche en infobulle ; un clic ouvre un nouvel onglet.

### Markdown

- [ ] « Lire » déplie le rendu : titres, gras, listes, citation, tableau, code.
- [ ] Un lien dans le markdown s'ouvre dans un nouvel onglet.
- [ ] « Replier » referme.

### Capsule

- [ ] « Définir comme capsule » sur une image : elle apparaît en tête de la page idée et la carte porte le marqueur « capsule ».
- [ ] Retour au catalogue : la carte de l'idée montre la capsule au lieu de l'initiale, au bon ratio et sans déformation.
- [ ] « Retirer la capsule » : l'en-tête et la carte reviennent au placeholder.
- [ ] Supprimer l'image qui sert de capsule : elle disparaît de la liste, de l'en-tête, de la carte du catalogue, et le fichier n'est plus dans `data/files/`.

### Galerie

- [ ] Cliquer sur une vignette ouvre l'image en grand, avec son nom et un compteur.
- [ ] Les flèches gauche et droite du clavier passent d'une image à l'autre ; la liste boucle.
- [ ] Échap ferme, un clic sur le fond aussi, et la page ne défile pas pendant que la visionneuse est ouverte.

### Ordre

- [ ] Attraper une carte par sa poignée (les six points, à gauche) et la déplacer : la liste se réarrange pendant le glisser.
- [ ] Relâcher, puis F5 : l'ordre est conservé.
- [ ] Donner le focus à une poignée au clavier (Tab) puis flèche haut ou bas : la carte monte ou descend, et ça tient après F5.

### Suppression

- [ ] « Supprimer » demande confirmation ; annuler ne fait rien.
- [ ] Après confirmation, la carte disparaît et le fichier n'est plus sur le disque.

### `/files/`

- [ ] Ouvrir directement l'adresse d'une image attachée : elle s'affiche.
- [ ] Ouvrir `http://localhost:3000/files/../package.json` et `.../files/%252e%252e/package.json` : aucun des deux ne montre le fichier.
- [ ] Ouvrir l'adresse d'un fichier supprimé : `{"error":"not_found"}`, et pas la page d'accueil.

### Corbeille (API seulement, sans interface)

- [ ] `curl -X DELETE http://localhost:3000/api/ideas/mon-slug` puis `curl -X POST http://localhost:3000/api/ideas/mon-slug/restore` : l'idée revient au catalogue avec ses pièces jointes.
- [ ] Rejouer le `restore` : `404`, `{"error":"not_found"}`.

### Mobile

- [ ] À la largeur d'un téléphone, les cartes de pièces jointes passent en colonne et les actions sous le libellé, sans défilement horizontal.
- [ ] La visionneuse reste utilisable, boutons compris.
