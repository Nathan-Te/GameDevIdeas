# Lot 8 — L'encart central

Une idée sans bande-annonce ouvrait sa page store sur une carte de texte. Elle
peut maintenant ouvrir sur une image — et cette image a le droit d'être la
capsule.

## 1. Ce qui est livré

- **`trailer_file_id` accepte une pièce `image`**, en plus des pièces `trailer`.
  Le champ ne désigne pas « la bande-annonce » mais **la pièce qui ouvre la
  marche** : le lot 4 le disait déjà, le lot 8 en tire les conséquences.
- **La capsule peut tenir les deux places à la fois** : en tête de la colonne de
  droite, et dans l'encart central. C'est la seule image que la visionneuse
  laisse entrer alors qu'elle est déjà affichée ailleurs.
- **Le bouton « Mettre en tête » apparaît sur les images** de la page idée, pas
  seulement sur les bandes-annonces.
- **Le repli automatique reste inchangé** : sans désignation, c'est la première
  pièce `trailer` qui mène. Une capture ne se hisse jamais en tête toute seule —
  sans quoi toute idée illustrée verrait son encart central changer au premier
  envoi d'image.
- **Le catalogue ne joue au survol que ce qui se joue** : une image en tête
  laisse la carte sur sa capsule, sans badge de lecture.
- Renommage des champs dérivés, qui ne parlent plus de bande-annonce :
  `leading_trailer_id` → `leading_media_id`, `trailer_url` →
  `leading_media_url`, et un `leading_media_kind` (`trailer` ou `image`) de plus.
  `trailer_file_id`, lui, garde son nom : c'est la colonne, et une colonne
  livrée ne se renomme pas sans migration.

## 2. Les choix faits

**Aucune migration.** La colonne existe, sa clé étrangère pointe déjà
`attachments` et sa politique `ON DELETE SET NULL` vaut pour une image comme
pour une vidéo. Seule la validation s'élargit — le schéma n'a rien à dire de
plus.

**Désigner une image reste permis même quand une vidéo existe.** La demande
parlait du cas « pas de bande-annonce », mais interdire l'autre cas rendrait la
règle fragile : la désignation deviendrait invalide au premier `.mp4` déposé, et
il faudrait décider quoi en faire. « Celle qui ouvre la marche » se dit sans
condition, et c'est ce qui se code.

**Une seule liste d'images côté visionneuse.** L'image en tête est mise en
première place de `shots` plutôt que traitée à part : la loupe passe un rang
dans les captures au `Lightbox`, et deux listes désynchronisées auraient ouvert
la mauvaise image.

**Le kind sort du serveur.** Le catalogue aurait pu deviner en regardant
l'extension de `leading_media_url` ; il lit `leading_media_kind`. La règle du
lot 4 — le front lit, il ne rejoue pas — vaut aussi pour celle-là.

## 3. Dépendances ajoutées

Aucune.

## 4. Points laissés ouverts

- La bannière de texte du lot 3b (« la carte de pitch ») ne sert plus que si
  l'idée n'a **ni** vidéo **ni** image désignée. Elle reste, mais son usage se
  réduit à mesure que les fiches s'illustrent.
- Quand une image mène et qu'une vidéo suit, c'est toujours la vidéo qui porte
  l'incrustation du texte `gif`. Personne n'a encore vu si c'est gênant.

## 5. Vérification manuelle

1. Sur une idée **sans bande-annonce**, joindre une image, cliquer
   « Mettre en tête », ouvrir `/idees/:slug/steam` : l'encart central montre
   l'image, plus la carte de texte.
2. Définir cette même image comme capsule : elle apparaît **en haut à droite et
   dans l'encart central**, une seule fois dans le bandeau de vignettes.
3. Retour au catalogue : la carte montre la capsule, **sans** badge de lecture
   et sans rien jouer au survol.
4. Joindre un `.mp4` à la même idée : il vient **après** l'image dans la
   visionneuse. Le mettre en tête à son tour : il repasse devant, et le survol
   au catalogue le joue de nouveau.
5. Supprimer la pièce en tête : la fiche se relit, l'encart central retombe sur
   la première bande-annonce s'il en reste une, sur la carte de texte sinon.
6. Ouvrir un lien de partage `/p/:token/:slug` : un ami voit exactement le même
   encart central.
