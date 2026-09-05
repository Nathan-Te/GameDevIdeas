# Lot 7b — La porte se décide sur le port, et sur rien d'autre

Correction du défaut qui rendait l'application inaccessible à Nathan dès qu'elle
tournait en conteneur, c'est-à-dire en production.

## 1. Ce qui n'allait pas

La porte du lot 7 classait chaque requête `owner` ou `guest` sur **trois**
critères : le port d'entrée, l'adresse source, et l'en-tête
`Tailscale-Funnel-Request`. Le port était présenté comme le mécanisme principal
et les deux autres comme des filets de sécurité.

C'étaient des filets à l'envers.

En Docker, les ports publiés font passer toutes les requêtes par la passerelle
du réseau bridge — `172.20.0.1` sur l'instance de Nathan. Cette adresse n'est ni
la boucle locale ni `100.64.0.0/10`, donc `access.js` classait **toutes** les
requêtes en visiteur, y compris celles qui arrivaient sur le port de Nathan. La
liste blanche faisait ensuite exactement son travail : 404 sur `/api/ideas`,
404 sur `/`, 404 sur tout. L'application répondait « Route inconnue » à son
propre propriétaire.

Le symptôme est spectaculaire, mais ce n'est pas le pire du défaut. Le pire est
que le critère se trompe **dans les deux sens selon l'infrastructure** :

- derrière Docker, il ferme ce qui devrait être ouvert ;
- derrière Tailscale Funnel, où tout le trafic public arrive de la machine
  elle-même, il ouvrirait ce qui devrait être fermé — c'était déjà écrit dans
  `Docs/exposition-publique.md`, sans qu'on en tire la conclusion qui
  s'imposait : **si un critère est faux dans un cas, il n'est pas un critère.**

L'en-tête, lui, ne s'est pas trompé : il n'a simplement aucune raison d'être cru.
Rien dans une requête ne distingue un en-tête posé par un proxy d'un en-tête
écrit par l'appelant.

### Pourquoi aucun test ne l'a vu

Les 52 tests de la porte passaient tous par `app.inject`, qui présente les
requêtes depuis `127.0.0.1`, et simulaient le visiteur avec un en-tête. Ils
vérifiaient donc scrupuleusement le comportement d'un mécanisme qui n'était pas
celui de la production. C'est le cinquième défaut de la famille recensée dans
`CLAUDE.md` — invisible en local, cassant en production — et le premier à toucher
la sécurité.

## 2. Ce qui est livré

### Un seul critère

`server/src/access.js` ne regarde plus que ceci :

```js
export function classify(request) {
  const raw = request?.raw ?? request;
  return raw?.[PUBLIC_ENTRY] === true ? GUEST : OWNER;
}
```

`PUBLIC_ENTRY` est un `Symbol` posé sur l'objet requête de Node par le serveur
qui écoute sur `PUBLIC_PORT`. Ce n'est ni une adresse ni un en-tête : c'est une
propriété d'un objet du processus, et il n'existe aucun octet à envoyer sur le
réseau qui la produise. La requête est entrée par une socket ou par l'autre ; il
n'y a pas de troisième cas, et personne ne peut mentir dessus.

La classification par adresse et l'honneur de `Tailscale-Funnel-Request` sont
supprimés. `X-Vitrine-Public` n'est plus lu non plus — il servait de canal
interne entre le point d'entrée et l'application, le `Symbol` le remplace.

### Le point d'entrée sort de `index.js`

`server/src/public-entry.js` : `createPublicEntry(app)` et `listenPublicEntry`.
Écrit à l'intérieur du script de démarrage, il n'était éprouvé qu'en production —
c'est précisément ce qui vient de se passer. À part, les tests le lancent.

`index.js` refuse en plus de démarrer si `PORT` et `PUBLIC_PORT` sont égaux :
mieux vaut ne pas démarrer que servir une frontière qui n'en est pas une.

### Les tests passent par de vrais sockets

- **`server/test/public-entry.test.js`** — le test demandé. Il lance le vrai
  serveur sur ses deux ports, écoute sur `0.0.0.0`, et l'interroge **depuis une
  adresse de la machine qui n'est ni la boucle locale ni le tailnet**. Il vérifie
  que le port de Nathan répond 200, que le port public répond 404 sur la même
  route depuis la même adresse — et, en écoutant les serveurs HTTP eux-mêmes,
  que l'adresse vue par le serveur était bien étrangère. Sans cette dernière
  assertion, le test pourrait passer en parlant à `127.0.0.1` sans que personne
  s'en aperçoive.

  S'il ne trouve aucune adresse de ce type sur la machine, il **échoue** au lieu
  de se sauter. Un test qui se saute en silence ne prouve rien : c'est la règle
  du projet, et c'est exactement le silence qui a laissé passer ce défaut.

- **`server/test/helpers.js`** — `makeServed(t)` sert l'application sur ses deux
  ports pour de bon ; `guest()` passe désormais par le réseau, sur le port
  public. Les 30 tests de routes fermées empruntent donc le chemin d'un ami.

- **`scripts/test-container.sh`** — après les tests de point de montage, le
  script lance l'image de production avec ses deux ports publiés et interroge la
  porte **à travers le NAT Docker**, depuis l'hôte. C'est le décor exact du
  défaut ; il affiche au passage l'adresse source que le conteneur voit arriver.

- **`server/test/sharing.test.js`** — la section de classification est réécrite :
  elle vérifie qu'une requête venue de `172.20.0.1`, `192.168.1.10` ou
  `93.184.216.34` est `owner`, et qu'aucun en-tête ne déplace la frontière dans
  un sens ni dans l'autre.

## 3. Les dépendances ajoutées

Aucune.

## 4. Les points laissés ouverts

1. **C'est le port public qui fabrique les visiteurs.** Sans `PUBLIC_PORT`, tout
   est `owner` — bon comportement pour une instance fermée, mais cela veut dire
   que pointer Funnel sur `PORT` publierait l'application entière. Le serveur
   refuse de démarrer si les deux ports sont égaux ; il ne peut rien contre un
   `tailscale funnel 3000`. La vérification depuis l'extérieur reste la seule
   preuve, et elle est dans la checklist.

2. **La limite de débit est commune à tous les visiteurs.** Elle compte sur un
   hachage de l'adresse source, et derrière Funnel comme derrière Docker cette
   adresse est la même pour tout le monde. Le quota est donc global : un ami
   bavard peut épuiser celui des autres pour l'heure. Acceptable pour une
   poignée d'amis — `GUEST_SUBMIT_LIMIT` se relève — mais c'est une limite qui
   ne fait pas ce que son nom laisse croire, et il faut le savoir.

3. **`X-Vitrine-Public` a disparu des variables et du vocabulaire.** Si un jour
   un reverse proxy autre que Funnel devait marquer les requêtes publiques, la
   réponse ne sera pas de réintroduire un en-tête : ce sera un port de plus.

## 5. La checklist de vérification manuelle

- [ ] `npm test` — 219 tests, dont 6 pour la porte sur de vrais sockets.
- [ ] `npm run test:container` — les tests de point de montage **et** la porte à
      travers le réseau Docker.
- [ ] En local, avec le vrai serveur : `PORT=3010 PUBLIC_PORT=3013 npm start`,
      puis `/api/ideas` → 200 sur 3010, 404 sur 3013.
- [ ] **Sur le serveur, en conteneur** : `docker compose up -d --build`, puis
      depuis le tailnet `curl http://100.x.y.z:3000/api/ideas` → 200. C'est
      exactement ce qui échouait.
- [ ] L'application s'ouvre normalement dans le navigateur depuis le tailnet :
      catalogue, page idée, `/partages`.
- [ ] Depuis un téléphone en 4G, sur l'URL de Funnel : `/api/ideas` → 404,
      `/p/<jeton>` → la page de sélection.

Le détail est dans [`Docs/exposition-publique.md`](../exposition-publique.md),
dont la section 2 a été réécrite.
