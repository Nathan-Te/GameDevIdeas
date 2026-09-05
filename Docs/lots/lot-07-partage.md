# Lot 7 — Partage public et avis d'amis

Vitrine sort du tailnet. Nathan compose une sélection d'idées, envoie un lien à
ses amis, et reçoit leurs notes et leurs avis dans une section qui ne se mêle
jamais à ses verdicts.

Ce lot n'ajoute pas une fonctionnalité de plus : il change le modèle de menace.
Jusqu'ici, seul Nathan pouvait atteindre le serveur. À partir de maintenant,
n'importe qui ayant l'URL peut frapper à la porte — et tout ce que le lot ajoute
est écrit en partant de là.

---

## 1. Ce qui est livré

### La porte (`server/src/access.js`)

- Chaque requête est classée `owner` ou `guest` par un hook `onRequest`
  enregistré **avant toute route**.
- **Liste blanche.** Un `guest` atteint quatre routes d'API, `/files/*` (filtré
  fichier par fichier) et les pages `/p/…` avec les fichiers du front. Tout le
  reste répond **404** — pas 403, et avec le message exact d'une route
  inexistante : les deux doivent être indiscernables.
- Une route ajoutée demain est donc fermée sans que personne ait à y penser.
- Toutes les réponses portent `X-Robots-Tag: noindex, nofollow` ; la page porte
  la balise `robots` correspondante.

### Le point d'entrée public (`server/src/index.js`)

Un second serveur HTTP, sur `PUBLIC_PORT`, qui sert la même application en
marquant chaque requête comme publique. C'est **le** point technique du lot, et
il a sa propre note : [`Docs/exposition-publique.md`](../exposition-publique.md).

Résumé : derrière Tailscale Funnel, `tailscaled` termine TLS et proxifie vers la
cible locale, donc **toutes** les requêtes publiques se présentent avec l'adresse
de la machine elle-même. Classer par adresse source seule est inopérant — une
instance qui le ferait servirait `/api/backup` au premier venu. Le port, lui, est
un fait de transport que personne ne peut contrefaire.

Sans `PUBLIC_PORT`, aucun point d'entrée public n'est ouvert : l'instance reste
exactement ce qu'elle était après le lot 6b.

### Le modèle (migration `006-sharing.sql`)

`shares`, `share_ideas`, `reviews`, `share_wishlists`. Le jeton fait 32 octets
d'aléa cryptographique en base64url — le lien *est* le secret.

`reviews` ne touche jamais `verdicts`. Deux tables, deux types côté front
(`StoreReview` et `Verdict`), deux sections dans l'interface, deux colonnes au
catalogue. Aucun calcul ne les additionne.

### Côté invité

- `/p/:token/:slug` — une page store par idée, la **même** que celle de Nathan
  (`components/StoreMock`, extrait de `SteamPage` pour ce lot), avec
  précédent/suivant limités à la sélection et un compteur « 3 / 14 ».
- Au premier chargement, une question : le prénom. Stocké localement avec un
  `visitor_id` tiré au hasard. Pas de compte, pas d'e-mail, modifiable depuis la
  barre du haut.
- Sur chaque page : la liste de souhaits **du visiteur** et un formulaire note
  sur 5 + commentaire. Un avis déjà déposé est pré-rempli et se corrige.
- Les avis des autres visiteurs apparaissent dans le bloc évaluations, sauf si
  la sélection porte `reviews_visible = false` — le visiteur voit alors toujours
  le sien.
- `/p/:token/_bilan` — le récapitulatif : ce qu'il a noté, ce qu'il a souhaité,
  et un merci. Les chiffres viennent de la base, pas du navigateur.

### Côté Nathan

- `/partages` — créer une sélection (cocher, ordonner), lien complet avec bouton
  de copie et QR code, libellé, dates, nombre de visiteurs distincts et d'avis,
  bascule `reviews_visible`, révocation. Chaque idée y affiche ce qu'elle a
  récolté.
- Page idée — section « Avis des amis », distincte de la section verdicts : nom,
  note, commentaire, date, sélection d'origine, suppression pour modération.
- Catalogue — deux colonnes optionnelles (moyenne des avis d'amis, souhaits
  reçus) et deux tris, `friends-score` et `friends-wishlist`.
- Page store — le bloc évaluations est désormais alimenté par les avis d'amis.
- Sauvegarde — les quatre tables entrent dans l'archive et en ressortent, dans
  les deux modes.

---

## 2. Les choix faits

### Le bloc « Évaluations » n'affiche plus les verdicts

C'était le point ouvert du lot 3b : faute d'avis, la page store fabriquait des
cartes d'avis à partir des verdicts de Nathan. Ce lot les en retire. Un verdict
n'est pas un avis de joueur, et l'y faire passer, maintenant qu'il y a de vrais
avis à côté, aurait mélangé les deux au seul endroit où la confusion coûte
quelque chose.

Conséquence assumée : une idée sans avis d'ami affiche « Pas encore
d'évaluation », là où elle affichait le verdict avant. C'est plus juste, et c'est
la même chose que verrait un ami.

### La maquette store est extraite plutôt que dupliquée

`SteamPage` faisait 900 lignes dont 700 de photomontage. La page invité devait
montrer la même chose. Les partager n'est pas un confort d'écriture : c'est la
seule façon d'être sûr qu'un ami voit la page que Nathan a regardée. Deux copies
auraient divergé au premier ajustement.

`StoreMock` ne parle à personne : il reçoit ce qu'il affiche, deux rappels, et un
emplacement libre dans le bloc des évaluations — où la page invité pose son
formulaire.

### Ce qu'un invité reçoit est énuméré, pas filtré

`publicIdea` liste les champs qui sortent, au lieu de retirer ceux qui ne doivent
pas sortir. Un champ ajouté demain à `serializeIdea` reste donc invisible pour un
invité tant que personne ne l'a inscrit. Même raisonnement que la liste blanche
des routes, un étage plus bas.

`current_verdict` et `wishlisted_at` en sont absents : un ami ne voit ni le
jugement de Nathan, ni sa liste de souhaits. Sinon la note qu'il donne n'est plus
la sienne.

### `/files/*` : « une sélection vivante », et non « ta sélection »

Une requête d'image ne porte pas de jeton — c'est le navigateur qui la fait,
depuis un `<img>`, et rien ne l'accompagne. Le droit ne peut donc pas être
« ce fichier appartient à ta sélection ». Il est : « ce fichier est une pièce
jointe d'une idée d'une sélection vivante ». C'est exactement l'ensemble des
fichiers qu'un invité peut atteindre par ailleurs — la permission ne s'élargit
pas, elle se formule autrement.

Le chemin est comparé à la colonne `path` en base, jamais déduit du dossier : un
orphelin resté sur le disque n'est servi à personne.

### Un lien inconnu, révoqué ou expiré : le même 404, mot pour mot

Un test le vérifie en comparant les trois messages. Dire « ce lien a été
révoqué » confirmerait qu'il a existé.

Révoquer ne supprime pas la sélection : les avis déjà reçus doivent garder d'où
ils viennent.

### La limite de débit est en mémoire

30 soumissions par heure et par hachage d'adresse, portées par l'application
(`app.guestLimit`) et non par un module — deux tests ne doivent pas se compter
l'un l'autre. En mémoire pour deux raisons : une soumission refusée ne doit rien
écrire, et un compteur qui vit une heure n'a pas à survivre à un redémarrage. Une
soumission refusée n'est pas comptée non plus, sinon insister repousserait sans
fin sa propre réouverture — ce serait un bannissement, pas une limite.

### Le sel du hachage d'adresse

`IP_HASH_SALT` s'il est posé, sinon 32 octets tirés au démarrage. Sans variable,
les hachages ne se comparent plus d'un redémarrage à l'autre : sans conséquence,
puisqu'ils ne servent qu'au débit, qui compte en mémoire, et qu'ils ne sont
jamais affichés ni servis par aucune route.

### Une colonne au-delà du modèle demandé : `reviews.updated_at`

Le lot demandait un avis modifiable. Un avis modifiable qui ne dit pas qu'il l'a
été affiche une date fausse. La colonne est ajoutée et la page invité comme la
page idée montrent « corrigé le … ».

### Les avis sont insérés comme texte, jamais comme HTML

React échappe ; aucun `dangerouslySetInnerHTML` n'approche une carte d'avis. La
règle du projet (tout HTML utilisateur passe par DOMPurify) porte sur du HTML —
ici il n'y en a pas, et c'est ce qui rend la protection solide plutôt que
dépendante d'un appel qu'on pourrait oublier.

La seule exception à `dangerouslySetInnerHTML` du lot est le QR code de
`/partages`, SVG produit sur place à partir d'une URL composée par la page : il
n'y a pas d'utilisateur dans cette chaîne.

### L'adresse publique est un réglage de navigateur

L'écran `/partages` compose le lien complet, mais le serveur ne connaît pas son
nom vu de l'extérieur, et Nathan regarde cet écran depuis le tailnet. L'URL de
Funnel se colle une fois par navigateur et se retient. Elle n'a pas sa place en
base : ce n'est pas une donnée de l'application, c'est une donnée du poste.

---

## 3. Les dépendances ajoutées

| Dépendance | Où | Pourquoi |
|---|---|---|
| `qrcode` | `web`, production | Le lot demande un QR code. Rendu en SVG dans la page, sans canvas ni image à télécharger, donc net sur l'écran qu'on approche d'un téléphone. Écrire un encodeur QR à la main serait quelques centaines de lignes de correction d'erreurs Reed-Solomon pour un bouton. |
| `@types/qrcode` | `web`, développement | Le front est en TypeScript strict et `qrcode` ne fournit pas ses types. |

Aucune dépendance côté serveur. La classification, la limite de débit, le hachage
et les jetons sont écrits à la main : ce sont trente lignes chacun, et ce sont
précisément les lignes qu'on veut pouvoir relire.

---

## 4. Les points laissés ouverts

1. **La bascule de liste de souhaits d'un invité compte dans sa limite de
   débit.** Trente allers-retours sur le bouton bloquent une heure, y compris le
   dépôt d'avis. C'est voulu — une limite qui ne couvrirait qu'une route se
   contourne par l'autre — mais un ami joueur peut s'y cogner. À revoir si ça
   arrive : deux compteurs, ou un poids différent par route.

2. **Un visiteur qui vide son navigateur perd la main sur ses avis.** Ils
   restent, ils ne sont plus modifiables. C'est le prix de « pas de compte » et
   il paraît juste pour cinq amis ; il ne le serait plus pour cinquante.

3. **La sélection ne se réordonne qu'à la création.** `PATCH /api/shares/:id`
   accepte `idea_slugs`, l'API sait donc le faire, mais l'écran ne propose pas
   encore de modifier une sélection existante. Créer un second lien fait le
   travail en attendant.

4. **L'expiration est vérifiée à la lecture, jamais nettoyée.** Une sélection
   expirée reste en base et dans la liste, marquée « Expiré ». C'est voulu — on
   veut voir ce qu'elle a récolté — mais rien ne purge jamais.

5. **Le comportement exact de Funnel n'a pas pu être vérifié depuis ce poste.**
   Le mécanisme choisi ne dépend pas de ce comportement, c'est tout son intérêt,
   mais la vérification depuis l'extérieur du tailnet reste à faire par Nathan :
   c'est la checklist ci-dessous.

6. **`share_position` sort de `shareIdeas` sans être utilisé par le front.**
   L'ordre est déjà celui du tableau. Le champ est conservé parce qu'il rendra
   service à l'écran de réordonnancement du point 3.

---

## 5. La checklist de vérification manuelle

### En local, avant de déployer

- [ ] `npm test` — 213 tests, dont 63 dans les trois fichiers du lot
      (`sharing`, `share-files`, `share-backup`) et deux dans `store-model`.
- [ ] `npm run test:container` — reste vert.
- [ ] `npm run build` — le front compile en TypeScript strict.
- [ ] `/partages` : créer une sélection de deux idées, ordonner, créer le lien.
- [ ] Le QR code s'affiche ; « Copier » copie le lien.
- [ ] Ouvrir le lien : le prénom est demandé, la maquette store s'affiche,
      « 1 / 2 » en haut.
- [ ] Noter, commenter, envoyer. Recharger : l'avis est là, marqué « votre avis ».
- [ ] Le corriger : il n'y en a toujours qu'un, et il dit « modifié le ».
- [ ] Mettre en liste de souhaits, aller au bilan : l'idée y est.
- [ ] Sur la page idée de Nathan : la section « Avis des amis » montre l'avis, sa
      sélection d'origine, et rien n'est apparu dans les verdicts.
- [ ] Catalogue : cocher « Avis des amis », trier par « Note des amis ».
- [ ] Révoquer le lien, recharger la page invité : « Ce lien n'est plus valable. »
- [ ] `/sauvegarde` : télécharger une archive, la restaurer en « Remplacer », et
      vérifier que les sélections et les avis sont revenus.

### Une fois en ligne — **depuis l'extérieur du tailnet**

Un téléphone en 4G, Wi-Fi coupé et Tailscale déconnecté. Une vérification faite
depuis une machine du tailnet ne prouve rien : elle passe par le port de Nathan.

- [ ] `https://<funnel>/api/ideas` → **404**. Idem `/api/families`,
      `/api/backups`, `/api/shares`, `/api/config`.
- [ ] `https://<funnel>/` → **404**, et surtout pas une page.
- [ ] `https://<funnel>/sauvegarde` → **404**.
- [ ] `https://<funnel>/p/<jeton>` → la page de sélection, capsules et captures
      comprises (ce dernier point vérifie `/files/*`).
- [ ] Un avis se dépose depuis le téléphone, et Nathan le voit arriver sur la
      page idée.
- [ ] `https://<funnel>/api/share/<jeton>/ideas/<slug-hors-sélection>` → **404**.
- [ ] Après `Révoquer le lien` : la page invité se ferme, et une image de la
      sélection cesse d'être servie.
- [ ] `sudo tailscale funnel off` puis recharger : plus rien ne répond de
      l'extérieur.

Le détail des commandes est dans [`Docs/exposition-publique.md`](../exposition-publique.md).
