# Lot 3 — Vitrine

Livré le 4 septembre 2026. **Ce lot clôt la v1.**

Objectif du lot : la vue « page store » qui est la raison d'être de l'application, une corbeille complète, et une passe de direction artistique et de responsive sur l'ensemble.

---

## 1. Ce qui est livré

### Arbitrages des points ouverts du lot 2

- **Points 1 et 2 (corbeille et purge)** — livrés, voir plus bas.
- **Point 3 (titre des liens)** — le lookup reste actif par défaut, mais **il ne contacte jamais une adresse privée ou locale**. La règle est dans `CLAUDE.md`.
- **Point 4 (vignettes)** — pas de `sharp`. Reporté, on jugera à l'usage.
- **Point 5 (`link_type` non modifiable)** — un sélecteur est apparu sur la carte lien.
- **Point 6 (prix sur deux lignes)** — corrigé.
- **Point 8 (libellé = nom de fichier)** — inchangé, comme demandé.

### Vue Steam — `/idees/:slug/steam`

Elle emprunte la **structure** d'une fiche de magasin et jamais ses couleurs ni ses logos.

- Capsule en tête au ratio 460 × 215, avec un **placeholder au même ratio** quand aucune capsule n'est choisie : une fiche sans image occupe exactement la même place qu'une fiche avec, sinon on ne compare plus deux pages mais deux mises en page.
- Le champ `gif` s'affiche **à côté de la capsule** dans un encart « Bande-annonce », libellé « Décrite, pas tournée : ce sont les dix secondes qu'on montrerait ».
- « À propos de ce jeu » : l'accroche en tête d'article, puis le pitch.
- Les images attachées **hors capsule** forment la galerie « Captures » sous la description. Un clic ouvre la visionneuse du lot 2, réutilisée telle quelle.
- Colonne droite : prix formaté (« Gratuit » à zéro ou sans prix), « Avis » (score sur 5, note et date du verdict courant, sans formulaire), puis « Détails » (statut, famille en étiquette, date de mise à jour).
- `competition` en bas, en « Titres similaires ».
- Une bannière discrète en tête rappelle que c'est une maquette et porte le bouton « Modifier l'idée ».
- **Rien n'est éditable.** Aucun champ, aucun bouton d'action, aucun appel d'écriture.
- Un champ vide se voit, en italique et en gris : c'est le but de la vue.
- **Navigation « précédente / suivante »** qui respecte les filtres et le tri du catalogue, transmis par la query de l'URL. Le compteur affiche « 3 / 12 · Catalogue » et renvoie au catalogue tel qu'il était filtré.

Accès : bouton « Voir la page » sur la page idée, et sur chaque carte du catalogue — au survol sur un écran qui survole, **toujours visible** sous `@media (hover: none)`.

### Corbeille — `/corbeille`

- Liste des idées supprimées : capsule éteinte, titre, date de suppression, nombre de pièces jointes.
- « Restaurer » (route du lot 2) et « Supprimer définitivement » par idée.
- « Vider la corbeille », avec une confirmation qui annonce le nombre d'idées **et** de pièces jointes qui vont partir.
- État vide soigné, et lien vers la corbeille depuis le catalogue **avec compteur**.

### `DELETE /api/ideas/:slug/purge`

- N'accepte qu'une idée déjà en corbeille. 404 sur une idée vivante, inconnue, ou déjà purgée.
- Dans une transaction : verdicts, `capsule_file_id` relâchée, lignes de pièces jointes, puis l'idée.
- **Ensuite** `data/files/{idea_id}/` en entier — la ligne part toujours avant le fichier.
- Réponse : `{ purged, files_removed, orphan_directory }`. `orphan_directory` vaut `true` quand la base est propre mais que le dossier n'a pas pu être effacé ; c'est aussi écrit dans le journal, et l'interface le répète à Nathan.

### Filtre d'adresses privées sur le lookup de titre

`fetchLinkTitle` refuse désormais toute cible privée ou locale, **et la requête ne part pas** :

- IPv4 : loopback `127/8`, `10/8`, `172.16/12`, `192.168/16`, link-local `169.254/16`, `0/8`, CGNAT `100.64/10`, `192.0.0/24`, bancs de test `198.18/15`, multicast et réservé `224/3`.
- IPv6 : `::`, `::1`, `fc00::/7`, `fe80::/10`, et les IPv4 déguisées `::ffff:a.b.c.d`. Les crochets d'URL et le `%zone` sont retirés avant l'examen.
- Noms : `localhost`, `.local`, `.internal`, `.home.arpa`, et tout sous-domaine de ceux-là — décidés **sans DNS**.
- Un nom public est résolu, et refusé si l'une de ses adresses est privée. Une résolution qui échoue est refusée aussi.

Dans tous les cas le libellé retombe sur le nom de domaine, exactement comme avec `LINK_TITLE_LOOKUP=false`.

### Passe de DA et responsive

- **`web/src/tokens.css`** : une seule feuille pour les couleurs, espacements, rayons, typographie, formats (`--capsule-ratio`, `--shot-ratio`) et durées. `styles.css` l'importe et **ne contient plus une seule couleur littérale**.
- Catalogue tenable à cinquante idées : titre tronqué à une ligne, accroche à deux lignes **réservées même vides** (les rangées de badges restent alignées d'une carte à l'autre), capsule toujours au ratio.
- États vides soignés : catalogue vide, filtres sans résultat, corbeille vide — chacun dit quoi faire.
- Mobile : catalogue en deux colonnes, page idée en une, vue Steam avec la colonne droite repliée sous la description, corbeille en liste.
- Aucune bibliothèque CSS.

### API

`GET /api/ideas` et `GET /api/ideas/:slug` servent désormais `attachment_count`. C'est ce qui permet à la corbeille d'annoncer ce qu'une purge emporte sans une requête par idée.

### Tests

13 tests ajoutés, **72 au total, tous verts**.

| Fichier | Ce qu'il couvre |
|---|---|
| `purge.test.js` | purge complète (base et dossier disparus, `files_removed` compte les fichiers et pas les liens) ; 404 sur idée vivante, inconnue, ou déjà purgée ; l'idée voisine reste intacte ; **échec d'effacement disque** : la base est cohérente et l'orphelin est signalé ; `attachment_count` servi avec l'idée |
| `links-privacy.test.js` | IPv4 privées et publiques ; IPv6 privées, crochets, `%zone` et IPv4 déguisée ; noms locaux sans DNS ; `isPrivateTarget` sur des URL complètes ; **compteur de requêtes à zéro** sur un vrai serveur local qui répond pourtant un `<title>` ; un lien privé collé est créé mais libellé du domaine |
| `attachments.test.js` | le test de lecture de `<title>` passe `allowPrivateHosts: true` — il porte sur l'analyse du HTML, pas sur la politique réseau |

Le test du proxy Vite du lot 2 est resté vert : aucune route Fastify n'a été ajoutée hors de `/api`.

### Vérifié à la main

Application pilotée dans un navigateur **en configuration de développement** (Vite et Fastify séparés, comme `npm run dev`) — la leçon du correctif du lot 2 : catalogue à sept idées, vue Steam avec et sans capsule, bande-annonce, captures et visionneuse, précédente/suivante avec et sans filtres (`?status=idee&sort=title` se propage bien dans les liens des cartes), restauration puis purge réelles depuis l'interface avec vérification de la disparition en base, états vides, sélecteur de `link_type` enregistré et relu, prix sur une seule ligne, et rendu mobile à 375 px pour les quatre vues.

Un défaut trouvé et corrigé pendant cette passe : la confirmation de purge disait « 1 pièce jointe **disparaîtront** du disque ».

---

## 2. Les choix faits

**La carte du catalogue n'est plus un lien englobant.** Elle en contient maintenant deux — la fiche et la vue Steam — et un `<a>` dans un `<a>` n'est pas du HTML valide : le navigateur en fait ce qu'il veut. Le titre porte le lien principal, étendu à toute la carte par un `::after` en position absolue ; « Voir la page » repasse au-dessus par son empilement. Le clic milieu et le Ctrl+clic continuent de marcher sur les deux.

**Les filtres d'URL sont sortis de `Catalogue.tsx` vers `filters.ts`.** La vue Steam en a besoin : « idée suivante » doit suivre la liste que Nathan avait sous les yeux, pas le catalogue entier. Deux lectures divergentes de la même query auraient fini par ne plus dire la même chose.

**La vue Steam recharge la liste voisine à part.** Un échec sur cette liste ne doit pas empêcher de lire la fiche : sans elle, les flèches sont mortes, c'est tout. C'est le même raisonnement que pour le compteur de la corbeille sur le catalogue.

**Le bout de liste est un bloc mort, pas un lien absent.** Si « précédente » disparaissait sur la première fiche, le compteur et « suivante » sauteraient à gauche. La barre garde sa forme d'une fiche à l'autre, ce qui compte quand on en enchaîne dix.

**« Gratuit » à zéro et sans prix.** C'est ce que demandait le lot. Conséquence assumée : une idée dont le prix n'est pas encore décidé s'affiche « Gratuit » sur sa fiche, ce qui n'est pas neutre pour le jugement. Si ça gêne à l'usage, la correction est d'une ligne (`price_cents === null` → « Prix non fixé »).

**La purge écrit son SQL au lieu de laisser faire les cascades.** `ON DELETE CASCADE` suffirait : les verdicts et les pièces jointes partiraient tout seuls. Mais c'est *l'opération irréversible* de l'application, et elle doit rester lisible dans six mois sans aller relire `001-init.sql`. Les trois `DELETE` sont écrits dans l'ordre, sous transaction.

**Les chemins des fichiers sont relevés avant la transaction.** Après, les lignes n'existent plus et on ne sait plus quoi effacer. C'est aussi ce qui permet de compter `files_removed` sans compter les liens, qui n'ont pas de fichier.

**Le dossier entier part, pas les fichiers un par un.** Un `rm -r` sur `data/files/{idea_id}/` emporte aussi ce qu'une ligne perdue aurait laissé derrière. La garde `resolveInsideFiles` est traversée d'abord : la purge ne peut pas effacer hors du volume, même si l'identifiant était absurde.

**Un échec d'effacement disque ne casse pas la purge.** La base est déjà à jour et cohérente ; annuler serait pire, puisque les lignes reviendraient pointer sur des fichiers dont certains seraient partis. On garde l'orphelin, on le journalise, et on le dit dans la réponse et dans l'interface. Le test le vérifie en retirant le droit d'écriture au dossier parent — et, si la plate-forme ignore les droits (Windows, root), il exige quand même la cohérence de la base et vérifie que l'orphelin est signalé **exactement quand il existe encore**. C'est cette dernière formulation qui fait qu'il teste quelque chose partout.

**Vider la corbeille purge idée par idée.** Une purge est déjà complète côté serveur. Une boucle côté client laisse voir où ça s'est arrêté si l'une échoue, et retire les idées de la liste au fur et à mesure — plutôt qu'un « tout ou rien » sur cinquante idées et un message unique.

**Le filtre d'adresses privées est dans `fetchLinkTitle`, avec une porte de sortie pour les tests.** Le lot 2 vérifiait la lecture d'un `<title>` contre un serveur `node:http` sur `127.0.0.1` — c'est-à-dire exactement ce que le filtre refuse. Plutôt que d'affaiblir le filtre ou de supprimer un bon test, `allowPrivateHosts` sépare les deux sujets : ce test porte sur l'analyse du HTML, la politique réseau est testée à part, avec un compteur de requêtes qui doit rester à zéro.

**Le nom est examiné avant d'être résolu.** `localhost` et `.local` sont refusés sans DNS — ce qui garantit que la suite de tests n'émet aucune requête sortante, et que le refus est instantané. La résolution DNS ne sert qu'aux noms publics, contre un domaine qui pointerait sur `127.0.0.1`.

**Une résolution DNS qui échoue est un refus.** La requête échouerait de toute façon, et le libellé retomberait sur le domaine : autant ne pas la lancer. Sur une instance sans accès Internet, le comportement est donc celui de `LINK_TITLE_LOOKUP=false`, sans avoir à poser la variable.

**Le filtre regarde ce qu'on résout, pas ce que la requête finira par atteindre.** Entre la résolution et le `fetch`, une réponse DNS pourrait changer — c'est le classique du rebinding. Sur une application mono-utilisateur derrière Tailscale, où la seule cible est soi-même et où l'attaquant serait Nathan collant sa propre URL, la fermer complètement demanderait de résoudre soi-même puis de forcer l'adresse dans la connexion. Ce n'est pas le prix de ce lot ; le trou est nommé ici plutôt que passé sous silence.

**`attachment_count` est joint par sous-requête, pas calculé par le front.** La corbeille doit annoncer ce qu'une purge emporte avant de la lancer. Une requête par idée pour le savoir serait une requête par idée de trop, et `idx_attachments_idea` rend le compte gratuit.

**Deux lignes d'accroche réservées, même vides.** Sans ça, une idée sans accroche fait une carte plus courte que sa voisine et la rangée de badges se décale. À cinquante cartes, c'est ce qui sépare une grille d'une mosaïque.

**Le titre de carte est tronqué à une ligne, pas à deux.** Deux lignes de titre plus deux d'accroche donnent des cartes hautes et une grille qui défile beaucoup. Un titre long est coupé par une ellipse et reste lisible en entier sur sa fiche.

**Les trois formes de pluriel sont écrites en clair.** `countLabel(n, 'idée', 'idées', 'aucune idée')` est plus long qu'un `${n > 1 ? 's' : ''}`, mais une confirmation de suppression définitive n'a pas le droit d'être bancale — et c'est exactement l'accord qui était faux avant correction. La phrase des pièces jointes est au présent, pour ne pas avoir à accorder un participe avec un nombre inconnu à l'écriture.

**Les tokens ont été relevés sur l'existant, pas inventés.** L'échelle typographique reprend les neuf tailles que les lots 1 et 2 utilisaient déjà : la passe de DA unifie ce qui existait au lieu de redessiner. Le seul ajout de sens est `--capsule-ratio`, qui n'était qu'un `460 / 215` recopié à trois endroits.

**`prefers-reduced-motion` redéfinit les durées, pas les règles.** Les transitions passent toutes par `--ease` et `--ease-slow` ; les mettre à zéro dans une seule requête média suffit, sans toucher à une seule déclaration de `transition`.

---

## 3. Dépendances ajoutées

**Aucune.** Ni côté serveur, ni côté front.

Le filtre d'adresses privées est écrit à la main : `node:net` valide les adresses, `node:dns/promises` les résout, et le dépliage d'une IPv6 tient en une trentaine de lignes. Les paquets du domaine (`ip`, `ipaddr.js`, `is-ip`) apportent une surface bien plus large que le seul « cette adresse est-elle privée », pour une application qui pose la question une fois par lien collé.

---

## 4. Points laissés ouverts

1. **Le rebinding DNS n'est pas fermé.** Le nom est résolu puis `fetch` résout de nouveau ; entre les deux, la réponse peut changer. Voir le choix correspondant plus haut. À traiter le jour où l'instance ne serait plus mono-utilisateur.
2. **« Gratuit » quand aucun prix n'est saisi.** Conforme au lot, mais ça donne un signal sur une fiche dont le prix n'est pas décidé. Un mot de toi et ça devient « Prix non fixé ».
3. **Toujours pas de vignettes réduites.** Le point 4 du lot 2 est reconduit tel quel : la vue Steam affiche les captures en 190 px de large à partir des fichiers d'origine. C'est le premier endroit où ça se sentira, avant même le catalogue.
4. **La vue Steam recharge la liste voisine à chaque fiche.** Enchaîner dix idées fait dix appels à `GET /api/ideas`. Sur une instance locale c'est invisible ; ça ne le resterait pas sur un lien lointain. Un cache partagé entre catalogue et vue Steam demanderait un état global, que le seed écarte.
5. **La famille ne donne qu'une seule étiquette.** Le lot demandait « famille rendue en tags » : le modèle n'a qu'un champ `family`, donc une étiquette. De vraies étiquettes multiples seraient un changement de modèle, hors périmètre v1.
6. **Aucun test front**, conforme au seed. Les parcours ont été vérifiés à la main, en configuration de développement ; le détail est plus haut.
7. **Le compteur de la corbeille ne se rafraîchit pas tout seul.** Il est chargé au montage du catalogue. Supprimer une idée renvoie au catalogue, donc au remontage — mais si tu gardes le catalogue ouvert dans un autre onglet, il ment jusqu'au rechargement.

---

## 5. Checklist de vérification manuelle

Prérequis : `npm install`, puis `npm run dev` (on travaille sur `http://localhost:5173`) ou `docker compose up --build`.

### Vue Steam

- [ ] Depuis le catalogue, survoler une carte : « Voir la page » apparaît sur la capsule ; cliquer ouvre la vue Steam.
- [ ] Sur téléphone, « Voir la page » est visible sans survol.
- [ ] Depuis une fiche, le bouton « Voir la page » de la barre du haut mène au même endroit.
- [ ] Sur une idée **avec** capsule : elle est en tête au bon ratio, non déformée.
- [ ] Sur une idée **sans** capsule : le placeholder occupe exactement la même place.
- [ ] L'encart « Bande-annonce » est à côté de la capsule et porte le texte du champ GIF.
- [ ] Une idée sans GIF, sans accroche ou sans pitch le montre en italique gris, sans casser la page.
- [ ] Les images attachées apparaissent en « Captures » — **la capsule n'y est pas**.
- [ ] Cliquer une capture ouvre la visionneuse ; flèches, Échap et clic sur le fond fonctionnent comme au lot 2.
- [ ] Colonne droite : prix, avis (score, note, date), statut, étiquette de famille, mise à jour.
- [ ] Une idée à `price_cents` nul affiche « Gratuit ».
- [ ] Une idée jamais jugée affiche « Jamais jugée » à la place de l'avis.
- [ ] `competition` apparaît en bas en « Titres similaires ».
- [ ] **Rien** ne s'édite : aucun champ ne s'ouvre au clic.
- [ ] « Modifier l'idée » revient à la fiche.

### Enchaîner les idées

- [ ] Sans filtre : « suivante » parcourt tout le catalogue, le compteur dit « 3 / 12 ».
- [ ] Filtrer le catalogue (par exemple statut « Idée », tri « Titre »), puis ouvrir une fiche Steam : la query est dans l'URL, et « suivante » suit **cette** liste et **ce** tri.
- [ ] Sur la première idée, « Précédente » est éteint et ne bouge pas la mise en page ; idem pour « Suivante » sur la dernière.
- [ ] Le lien du compteur revient au catalogue **avec ses filtres**.
- [ ] Ouvrir la vue Steam d'une idée exclue par les filtres : la barre n'affiche aucun voisin, la fiche s'affiche quand même.

### Corbeille

- [ ] Le catalogue affiche « Corbeille » avec le bon compteur.
- [ ] Envoyer une idée à la corbeille depuis sa fiche : elle apparaît dans `/corbeille` avec sa date et son nombre de pièces jointes.
- [ ] « Restaurer » la remet au catalogue, avec ses pièces jointes.
- [ ] « Supprimer définitivement » demande confirmation et **annonce le nombre de pièces jointes** ; annuler ne fait rien.
- [ ] Après confirmation : l'idée a disparu, et `data/files/{id}/` n'existe plus sur le disque.
- [ ] `curl http://localhost:3000/api/ideas/le-slug` répond 404.
- [ ] « Vider la corbeille » annonce le nombre d'idées **et** de pièces jointes, puis vide tout.
- [ ] La corbeille vide affiche son état vide et un retour au catalogue.
- [ ] `curl -X DELETE http://localhost:3000/api/ideas/une-idee-vivante/purge` répond 404 et ne touche à rien.

### Liens

- [ ] Coller `http://192.168.1.1/` ou `http://localhost:8080/` : le lien est créé, libellé du domaine, **et rien n'est parti sur le réseau**.
- [ ] Coller une adresse publique avec un titre : le titre est toujours lu.
- [ ] Sur une carte lien, changer le type dans le sélecteur : l'icône change, et ça tient après F5.

### Direction artistique et responsive

- [ ] Le prix, dans le panneau latéral d'une fiche, tient sur **une seule ligne**.
- [ ] Catalogue avec beaucoup d'idées : toutes les cartes ont la même hauteur, les titres longs sont coupés par une ellipse, les badges sont alignés.
- [ ] Filtrer jusqu'à zéro résultat : l'écran propose d'effacer les filtres.
- [ ] Vider le catalogue : l'écran propose de créer la première idée.
- [ ] À 375 px : catalogue en deux colonnes, page idée en une, vue Steam avec la colonne droite sous la description, corbeille en liste avec les boutons dessous.
- [ ] Aucun défilement horizontal, nulle part.
