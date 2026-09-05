# Lot 4 — Familles éditables et bande-annonce

Deux manques constatés à l'usage juste avant la mise en production : la liste des familles était figée dans le code, et la « bande-annonce » de la page store n'était qu'un paragraphe de texte. Après ce lot, Nathan gère ses familles lui-même avec leurs étiquettes store, et une idée peut porter un GIF ou une courte vidéo qui se joue en tête de la visionneuse.

---

## 1. Ce qui est livré

### Familles éditables

- **Migration `004-families.sql`** : table `families` (`id`, `slug` unique, `label`, `store_tags` JSON, `features` JSON, `position`).
- **Seed au démarrage** (`server/src/families-repo.js`), depuis `SEED_FAMILIES` de `shared/store-model.js`, **et seulement si la table est vide**. Les dix familles et leurs étiquettes actuelles sont reprises telles quelles : aucune idée existante ne change de sens.
- **`ideas.family` est un slug de `families`**, validé par l'application (`assertFamilyExists`) à la création comme au `PATCH`. Renommer le slug d'une famille met à jour les idées qui la portent, dans la même transaction.
- **Routes** : `GET /api/families` (avec `idea_count`), `POST`, `PATCH /api/families/:slug` (`label`, `slug`, `store_tags`, `features`, `position`), `DELETE /api/families/:slug` refusé en 409 tant qu'une idée l'utilise — le message dit combien.
- **`shared/store-model.js`** lit désormais étiquettes et fonctionnalités **sur l'objet famille** qu'on lui passe. La table codée en dur a disparu ; il n'en reste que `SEED_FAMILIES`, explicitement nommée comme peuplement initial.
- **Écran `/familles`** : liste réordonnable à la même poignée que les pièces jointes (souris et flèches haut/bas), édition en place du libellé, étiquettes en pilules (Entrée ajoute, croix retire, Retour arrière sur champ vide retire la dernière), fonctionnalités en cases. Lien depuis l'en-tête du catalogue. Le sélecteur de la page idée et le filtre du catalogue lisent cette liste.

### Bande-annonce

- **Nouveau `kind` `trailer`** pour `.gif`, `.mp4`, `.webm`. Le GIF quitte donc les images : un GIF attaché est une bande-annonce, pas une capture. Limite propre `MAX_TRAILER_MB` (défaut 100).
- **Migration `005-trailer.sql`** : `ideas.trailer_file_id` nullable en `ON DELETE SET NULL`, comme la capsule ; reconstruction de `attachments` pour élargir sa contrainte `CHECK` ; les GIF déjà attachés deviennent des bandes-annonces, et une capsule qui en était un est libérée.
- **`PATCH /api/ideas/:slug`** accepte `trailer_file_id` — refusé si la pièce n'est pas un `trailer` de cette idée.
- **`/files/*`** sert les médias jouables `inline` avec `Accept-Ranges: bytes`, honore les requêtes `Range` (206 + `Content-Range`, 416 hors bornes) et ignore un `Range` illisible.
- **Page idée** : carte `trailer` avec son aperçu (lecteur en pause), bouton « Définir comme bande-annonce », marqueur sur la courante, ligne « Bande-annonce » dans la fiche.
- **Page store** : la première position de la visionneuse joue la bande-annonce, en boucle et sans son, avec sa barre de lecture — lecture/pause, position dans la vidéo, son — et un gros bouton central à l'arrêt. Le champ `gif` devient le sous-titre sous le lecteur. Sans bande-annonce, on retombe sur la carte texte du lot 3b. La vignette du bandeau porte le pictogramme de lecture.
- **Catalogue** : au survol (et au focus clavier) d'une carte qui a une bande-annonce, elle remplace la capsule et se joue ; au repos, la capsule, avec un petit pictogramme de lecture qui annonce qu'il y a quelque chose à voir.

### Tests (`node:test`) — 96 → 121, tous verts

- `families.test.js` : CRUD, seed idempotent (y compris « table vidée » vs « table entamée »), renommage de slug propagé aux idées et aux filtres, refus 409 avec compte d'idées (corbeille comprise), réordonnancement sans trou ni doublon, refus d'une famille inexistante sur une idée.
- `trailer.test.js` : `.gif` / `.mp4` / `.webm` en `trailer`, GIF sorti des images, refus au-delà de `MAX_TRAILER_MB` avec la bonne limite citée et rien laissé sur le disque, `trailer_file_id` refusé sur une pièce non-`trailer` ou d'une autre idée, libéré à la suppression, servi au catalogue, purge d'une idée qui en porte une.
- `files.test.js` : `Accept-Ranges`, 206 avec `Content-Range` sur trois formes de plage, 416 hors bornes, `Range` illisible ignoré, et aucune promesse de plage sur un fichier téléchargé.
- `store-model.test.js` : étiquettes, genre et fonctionnalités lus sur un objet famille ; repli quand la famille manque ; fonctionnalité inconnue ignorée.

---

## 2. Les choix faits

**`store_tags` et `features` en JSON dans une colonne TEXT.** Ce sont deux listes courtes, jamais filtrées ni jointes ; deux tables de liaison coûteraient deux tables pour un écran d'édition. Le dépôt sérialise et désérialise à la frontière, comme il le fait déjà pour les chemins de fichier, et une liste JSON illisible retombe sur `[]` plutôt que de faire tomber le catalogue. C'est un choix qu'on regretterait le jour où on voudrait « toutes les familles étiquetées Coop » — ce jour-là, une migration.

**`ideas.family` reste du texte, validé par l'application.** Une vraie clé étrangère aurait été plus sûre, mais elle impose de choisir une action sur suppression : `CASCADE` effacerait des idées, `SET NULL` demanderait une colonne nullable et un cas « idée sans famille » partout. Le refus en 409 est plus honnête — il dit ce qui bloque et combien — et le renommage propagé dans la même transaction couvre l'autre moitié du risque.

**Le vocabulaire des fonctionnalités a changé.** Le lot 3b avait `coop` / `multi` / `solo` / `manette` ; le lot demande `solo` / `coop-online` / `multiplayer` / `local-coop`. Le seed traduit à l'identique (`coop` → `coop-online`, `multi` → `multiplayer`), donc aucune fiche n'a changé. **Le support manette n'est pas une fonctionnalité de famille** : il est sur toutes les fiches et s'ajoute dans `storeFeatures`, il n'apparaît donc pas dans les cases de `/familles`.

**Le slug d'une famille ne s'édite pas depuis l'écran.** La route sait le faire, et le fait bien — les idées suivent. Mais c'est un geste qui change la famille de toutes les idées concernées, et le poser à côté d'une case à cocher le banaliserait. Il se lit sur la ligne, en monospace, comme l'identifiant qu'il est. Point laissé ouvert ci-dessous.

**Les migrations tournent avec les clés étrangères coupées.** Élargir la contrainte `CHECK` de `attachments` impose de reconstruire la table, et SQLite ne sait pas faire autrement. Sans coupure, le `DROP TABLE` de l'ancienne table déclencherait le `ON DELETE SET NULL` de `ideas.capsule_file_id` : la reconstruction effacerait les capsules qu'elle est censée recopier. C'est la procédure documentée par SQLite ; `foreign_key_check` est rejoué dans la transaction de chaque migration, donc une migration qui casse une référence est annulée. Le runner a changé, aucune migration livrée n'a été réécrite.

**Deux limites de taille, appliquées après écriture.** `@fastify/multipart` ne connaît qu'une limite globale et ne sait pas quel `kind` arrive avant d'avoir lu le nom du fichier. La limite déclarée est donc la plus haute des deux, et la limite fine est vérifiée sur la taille réelle. Un fichier refusé est effacé comme tous ceux de la requête — le nettoyage du lot 2 couvrait déjà ce cas.

**Un composant, un seul, sait qu'un GIF n'est pas une vidéo.** `web/src/components/Trailer.tsx`. Partout ailleurs on passe une URL. La barre de lecture n'existe que sur une vidéo : un GIF n'a ni son, ni durée, ni position, et des contrôles morts sur une page qui prétend être un magasin se remarquent plus que leur absence.

**La barre de lecture est écrite à la main, pas déléguée à `controls`.** Les contrôles natifs sont ceux du navigateur, reconnaissables au premier coup d'œil : au milieu d'un photomontage, ils le trahiraient autant qu'un logo. Ses couleurs vivent donc dans `steam.css` avec le reste du décor, jamais dans les tokens. L'état React est la source et l'élément vidéo suit — on n'écoute pas `volumechange`, dont l'aller-retour se stabilise mal : le lecteur repartait à 100 % dès que les métadonnées arrivaient du cache avant que React n'ait branché son écouteur. Chaque bande-annonce démarre muette à 50 %.

**La liste des familles est chargée une fois et partagée** (`web/src/families.ts` : cache module + abonnement). Quatre vues en ont besoin ; la recharger à chaque montage ferait clignoter les sélecteurs à chaque navigation. Pas de bibliothèque d'état global, comme le reste du front.

**La bande-annonce du catalogue n'est montée qu'au survol.** Cinquante lecteurs en arrière-plan feraient ramer la page pour un effet qu'on ne voit jamais. La capsule reste montée dessous : revenir dessus ne recharge rien.

---

## 3. Dépendances ajoutées

**Aucune.** Le glisser-déposer, les pilules, le lecteur et le service des plages `Range` sont écrits à la main, comme le reste.

---

## 4. Points laissés ouverts

1. **Renommer le slug d'une famille** n'a pas d'interface. La route existe et propage aux idées ; il manque le geste — probablement une petite confirmation qui annonce combien d'idées vont bouger.
2. **Déplacer les idées d'une famille avant de la supprimer** se fait à la main, idée par idée. Un « déplacer les N idées vers… » dans le refus 409 serait l'étape suivante naturelle.
3. **Pas de vignette de bande-annonce.** Une vidéo est figée sur sa première image par le navigateur ; c'est suffisant, mais une vraie affiche (posée à la main, ou une image choisie parmi les pièces jointes) serait plus fidèle à un magasin.
4. **Aucune conversion, aucune limite de durée.** Un `.mp4` de 100 Mo est accepté tel quel et servi tel quel. C'est cohérent avec la règle « les fichiers utilisateur ne vont jamais en base », mais une bande-annonce de trois minutes n'est plus une bande-annonce.
5. **Les étiquettes n'ont pas d'autocomplétion.** Rien ne suggère « Coop » quand une autre famille la porte déjà, et deux familles peuvent diverger sur une même intention (« Réflexion » / « Puzzle »).
6. **`local-coop` n'a pas son propre pictogramme** : il partage la silhouette à deux têtes de `coop-online`. À distinguer si la différence devient lisible sur la fiche.

---

## 5. Vérification manuelle

### Familles

- [ ] `/familles` liste les dix familles dans l'ordre, avec leurs étiquettes et fonctionnalités d'avant le lot — rien n'a changé de sens.
- [ ] Modifier un libellé : la valeur tient au rechargement, et le sélecteur de la page idée l'affiche.
- [ ] Ajouter une étiquette (Entrée), en retirer une (croix), retirer la dernière (Retour arrière sur champ vide).
- [ ] Cocher et décocher une fonctionnalité : la colonne « Fonctionnalités » de la page store suit. Le support manette y reste toujours.
- [ ] Réordonner à la poignée, puis aux flèches haut/bas : l'ordre tient au rechargement et se retrouve dans le filtre du catalogue.
- [ ] « Nouvelle famille » : elle apparaît en fin de liste, se renomme, et devient choisissable sur une idée sans redémarrage.
- [ ] Supprimer une famille utilisée : refusée, avec le nombre d'idées dans le message. Le compteur de la ligne dit déjà ce nombre.
- [ ] Supprimer une famille à zéro idée : elle part, et ne revient pas au redémarrage du serveur.

### Bande-annonce

- [ ] Déposer un `.gif` sur une idée : la carte est « Bande-annonce », pas « Image », et montre son aperçu.
- [ ] Déposer un `.mp4` et un `.webm` : même chose, avec un lecteur en pause dans la carte.
- [ ] « Définir comme bande-annonce » : le marqueur apparaît, la ligne « Bande-annonce » de la fiche passe à « Définie ».
- [ ] Page store : la bande-annonce joue en boucle et sans son en première position, et le texte du champ « GIF » est sous le lecteur.
- [ ] La barre apparaît au survol, reste affichée à l'arrêt : pause et relance, position qui avance, durée juste.
- [ ] Cliquer dans la timeline se déplace dans la vidéo, y compris en arrière — c'est ce que `Range` rend possible.
- [ ] Le bouton de son rend l'audio à mi-volume ; le curseur le règle, et à zéro il coupe.
- [ ] La vignette de gauche du bandeau porte le pictogramme de lecture ; les captures, non.
- [ ] Retirer la bande-annonce : la vue store retombe sur la carte texte du lot 3b.
- [ ] Supprimer la pièce jointe qui servait de bande-annonce : la fiche repasse à « Aucune » sans rien casser.
- [ ] Catalogue : survoler une carte qui a une bande-annonce la joue ; en sortir revient à la capsule. Une carte sans bande-annonce ne bouge pas.
- [ ] Une bande-annonce `.mp4` de plusieurs mégaoctets se lit et se déplace dans le flux (c'est ce que vérifie `Range`).
- [ ] Un `.mp4` au-delà de `MAX_TRAILER_MB` est refusé avec la bonne limite dans le message, et rien ne reste dans `data/files/`.
