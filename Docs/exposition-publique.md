# Exposer Vitrine sur Internet

Jusqu'au lot 6b, seul Nathan pouvait atteindre le serveur : l'accès passait par
Tailscale, et c'est le réseau qui faisait la porte. Le lot 7 ouvre l'instance sur
Internet pour que des amis puissent lire une sélection d'idées et y répondre.

**Ce n'est pas une fonctionnalité de plus, c'est un changement de modèle de
menace.** À partir du moment où l'URL circule, n'importe qui peut frapper. Ce
document dit comment ouvrir, comment vérifier que ce qui est fermé l'est
vraiment, et comment refermer.

---

## 1. Le principe : la séparation se fait par route, côté serveur

Il n'y a pas d'authentification, et il n'y en aura pas. Chaque requête est
classée `owner` ou `guest` par `server/src/access.js` — **sur le seul port
d'écoute par lequel elle est entrée**, voir la section 2 — et un `guest`
n'atteint que six choses :

| Route | Méthode |
|---|---|
| `/api/share/:token` | `GET` |
| `/api/share/:token/ideas/:slug` | `GET` |
| `/api/share/:token/reviews` | `POST` |
| `/api/share/:token/wishlist` | `POST` |
| `/files/*` | `GET` — et seulement les pièces jointes des idées d'une sélection vivante |
| `/p/*` et les fichiers du front (`/assets/…`) | `GET` |

**Tout le reste répond 404**, pas 403 : un 403 confirmerait que la route existe.
Le message est celui, mot pour mot, d'une route inexistante. C'est une liste
blanche : une route ajoutée demain est fermée sans que personne ait à y penser.

---

## 2. Le point technique central : le port, et rien d'autre

**Le seul critère de classification est le port d'écoute par lequel la requête
est entrée.** Une requête entrée par `PORT` est `owner`, une requête entrée par
`PUBLIC_PORT` est `guest`. Sans exception, sans repli sur l'adresse source, sans
en-tête.

Ce n'est pas une simplification élégante : c'est ce qui reste après avoir essayé
les deux autres critères et vu les deux échouer.

### Pourquoi pas l'adresse source

Elle ment dès qu'il y a un intermédiaire — et il y en a toujours un.

- **Derrière Tailscale Funnel**, `tailscaled` termine TLS lui-même sur le nœud
  puis **proxifie** la requête vers la cible locale (`tailscale funnel 3003`
  proxifie vers `127.0.0.1:3003`). Tout le trafic public se présente donc depuis
  la machine elle-même : du point de vue de la socket, une requête venue de
  Tokyo et une requête de Nathan sur le tailnet sont identiques. Une
  classification par IP y aurait servi `/api/backup` au premier venu.
- **En conteneur Docker**, c'est l'inverse, et c'est ce qui est arrivé. Les
  ports publiés font passer **toutes** les requêtes par la passerelle du réseau
  bridge (`172.x.0.1`) — celles de Nathan comprises. L'adresse n'est alors ni la
  boucle locale ni le tailnet : la première version de la porte classait donc
  Nathan lui-même en visiteur, et **l'application répondait 404 sur son propre
  port**. En production.

Un critère qui se trompe dans les deux sens selon l'infrastructure n'est pas un
critère. Il a été retiré.

### Pourquoi pas un en-tête

`Tailscale-Funnel-Request`, posé par Tailscale sur les requêtes venues de
Funnel, était honoré en signal secondaire. Il ne l'est plus non plus.

Un en-tête est une promesse d'un composant qu'on ne contrôle pas. Rien dans une
requête ne distingue un en-tête posé par un proxy d'un en-tête écrit par
l'appelant ; il peut changer de nom, disparaître d'une version à l'autre, ou ne
pas être posé dans une configuration particulière — et l'instance s'ouvre alors
en silence. Deux critères faux ne font pas un critère juste : ils font deux
façons de se tromper.

`X-Forwarded-For` n'est lu nulle part, pour la même raison. Fastify tourne sans
`trustProxy`, exprès.

### Le mécanisme retenu

Vitrine écoute sur **deux ports** :

- `PORT` (3000 par défaut) — le port de Nathan, à publier sur la seule IP
  Tailscale, comme depuis le lot 5 ;
- `PUBLIC_PORT` (3003 par exemple) — le **point d'entrée public**, à publier sur
  `127.0.0.1` uniquement, et c'est lui que Funnel vise.

Les deux servent la même application. Le second (`server/src/public-entry.js`)
pose un `Symbol` sur l'objet requête de Node avant de la router. Ce n'est ni un
en-tête ni une adresse : c'est une propriété d'un objet du processus, et il
n'existe aucun octet à envoyer sur le réseau qui la produise. La requête est
entrée par une socket ou par l'autre ; il n'y a pas de troisième cas.

> **Corollaire à ne pas perdre de vue : c'est le port public qui fabrique les
> visiteurs.** Sans `PUBLIC_PORT`, tout est `owner` — ce qui est le bon
> comportement pour une instance qui n'est pas exposée, mais qui veut dire que
> **pointer Funnel sur `PORT` au lieu de `PUBLIC_PORT` ouvrirait toute
> l'application**. Le serveur refuse de démarrer si les deux ports sont égaux,
> et la vérification de la section 5 est là pour le reste.

### Ce qui a été vérifié, et où

- **`server/test/public-entry.test.js`** lance le vrai serveur sur ses deux
  ports, écoute sur toutes les interfaces, et l'interroge **depuis une adresse
  qui n'est ni la boucle locale ni le tailnet** — le cas Docker. Il vérifie que
  le port de Nathan répond 200, que le port public répond 404 sur la même route
  depuis la même adresse, et — en écoutant les serveurs HTTP eux-mêmes — que
  l'adresse vue était bien étrangère. S'il n'en trouve aucune sur la machine, il
  **échoue** au lieu de se sauter.
- **`npm run test:container`** refait la même vérification à travers le réseau
  Docker : image de production, ports publiés, `curl` depuis l'hôte. C'est le
  décor exact du défaut.
- **`server/test/sharing.test.js`** vérifie les trente routes fermées, une à
  une, par le vrai port public — plus le fait qu'aucun en-tête ne déplace la
  frontière, dans un sens comme dans l'autre.
- **À vérifier une fois en ligne, par vous, depuis l'extérieur du tailnet** :
  la section 5 en donne la liste.

### Éprouver la porte sans quitter son poste

`npm run dev` ne suffit pas : il n'ouvre pas de point d'entrée public, donc tout
y est classé `owner`. Pour voir l'application comme un visiteur, il faut le vrai
serveur et ses deux ports :

```bash
npm run build
PORT=3010 PUBLIC_PORT=3013 npm start
```

Puis comparer :

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3010/api/ideas   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3013/api/ideas   # 404
```

`http://127.0.0.1:3013/p/<jeton>` donne exactement ce que verra un ami.

---

## 3. Mise en place

### 3.1. Configurer l'application

Dans `.env` :

```bash
PUBLIC_PORT=3003
PUBLIC_HOST=127.0.0.1     # en conteneur : 0.0.0.0, voir ci-dessous
```

En Docker, décommenter dans `docker-compose.yml` la publication et les deux
variables :

```yaml
ports:
  - "100.x.y.z:3000:3000"      # l'IP Tailscale : le port de Nathan
  - "127.0.0.1:3003:3003"      # le point d'entrée public, boucle locale seule
environment:
  PUBLIC_PORT: "3003"
  PUBLIC_HOST: 0.0.0.0         # toutes les interfaces **du conteneur**
```

`PUBLIC_HOST: 0.0.0.0` peut surprendre : c'est l'interface *dans le conteneur*.
C'est la publication `127.0.0.1:3003:3003` qui restreint l'accès à la boucle
locale de l'hôte. Publier ce port sans le préfixe `127.0.0.1:` l'exposerait au
réseau local sans passer par Funnel, et rien ne le signalerait.

Puis :

```bash
cd /srv/vitrine && docker compose up -d --build
```

Vérifier sur le serveur, avant d'ouvrir quoi que ce soit :

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/ideas   # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3003/api/ideas   # 404
```

Si la seconde ligne n'affiche pas `404`, **arrêtez-vous ici** : le point d'entrée
public n'est pas celui que vous croyez.

### 3.2. Ouvrir Funnel

Funnel demande, une fois par tailnet, que HTTPS et Funnel soient activés dans
les réglages d'administration Tailscale (`Enable HTTPS`, puis les
`nodeAttrs` `funnel` dans les ACL). La commande le rappelle si ce n'est pas fait.

```bash
sudo tailscale funnel --bg 3003
```

Elle répond une URL de la forme :

```
https://<nom-de-la-machine>.<nom-du-tailnet>.ts.net
```

C'est cette adresse que vos amis utiliseront. Elle n'a ni port ni chemin :
Funnel écoute en 443 et proxifie vers `127.0.0.1:3003`.

**Le numéro passé à `tailscale funnel` doit être `PUBLIC_PORT`, jamais `PORT`.**
C'est le port qui fait la frontière : le viser sur celui de Nathan publierait
l'application entière, sauvegardes comprises. La section 5 le vérifie depuis
l'extérieur, et c'est la seule vérification qui prouve quoi que ce soit.

`tailscale funnel status` liste ce qui est publié.

### 3.3. Dire l'adresse à l'écran des partages

L'écran `/partages` compose le lien complet d'une sélection. Il ne peut pas
deviner l'adresse publique — le serveur ne connaît pas son propre nom vu de
l'extérieur, et Nathan regarde cet écran depuis le tailnet. Ouvrir
« Adresse publique » sur une carte de partage et y coller l'URL de Funnel :
elle est retenue dans le navigateur, et tous les liens et QR codes s'y adaptent.

---

## 4. Ce qui n'est jamais exposé

- L'application de Nathan : `/`, `/idees/…`, `/familles`, `/sauvegarde`,
  `/partages` répondent `404` à un visiteur. Pas même la coquille HTML — le
  repli SPA ne s'ouvre à lui que sous `/p/`.
- Ses verdicts et sa liste de souhaits : ils ne sont pas cachés par l'interface,
  ils sont **absents de la réponse** (`publicIdea`, dans `shares-repo.js`,
  énumère ce qui sort).
- Les pièces jointes des idées hors sélection : `/files/*` vérifie, pour un
  visiteur, que le chemin correspond à une pièce d'une idée d'une sélection
  vivante. Un fichier orphelin sur le disque n'est servi à personne.
- Le détail des erreurs : pas de pile, pas de nom de fichier, pas de version.

Toutes les réponses portent `X-Robots-Tag: noindex, nofollow`, et les pages
portent la balise `robots` correspondante.

### Une conséquence à connaître : la limite de débit est commune

La limite de 30 soumissions par heure est comptée sur un hachage de l'adresse
source. Derrière Funnel comme derrière Docker, cette adresse est la même pour
tout le monde : **le compteur est donc global**, et non par visiteur.

Pour une poignée d'amis c'est une protection acceptable — elle plafonne le
volume d'écriture total. Mais un ami bavard peut, en théorie, épuiser le quota
des autres pour l'heure. Si ça arrive, c'est le signe qu'il faut compter
autrement ; en attendant, `GUEST_SUBMIT_LIMIT` se relève.

---

## 5. La vérification, une fois en ligne

**À faire depuis l'extérieur du tailnet** — un téléphone en 4G, Wi-Fi coupé et
Tailscale déconnecté, ou un partage de connexion. Une vérification faite depuis
une machine du tailnet ne prouve rien : elle passe par le port de Nathan.

Remplacer `https://exemple.ts.net` par l'URL de Funnel.

1. **Les routes fermées répondent 404.** Aucune ne doit renvoyer autre chose :

   ```bash
   for r in /api/ideas /api/families /api/backups /api/shares /api/config; do
     printf '%s ' "$r"
     curl -s -o /dev/null -w '%{http_code}\n' "https://exemple.ts.net$r"
   done
   ```

   Attendu : `404` partout.

2. **L'application de Nathan n'existe pas.** `https://exemple.ts.net/` et
   `https://exemple.ts.net/sauvegarde` : `404`, et surtout pas une page.

3. **La page de sélection s'affiche.** Ouvrir le lien d'une sélection : la
   maquette store apparaît, capsule et captures comprises — ce dernier point
   vérifie que `/files/*` sert bien les fichiers de la sélection.

4. **Un avis se dépose.** Donner un prénom, mettre une note, envoyer, recharger
   la page : l'avis est là, marqué « votre avis ». Le corriger, vérifier qu'il
   n'y en a pas deux.

5. **Une idée hors sélection est introuvable.** Prendre le slug d'une idée non
   partagée et l'essayer :
   `https://exemple.ts.net/api/share/<jeton>/ideas/<slug-hors-selection>` → `404`.

6. **Un lien révoqué se ferme.** Révoquer depuis `/partages`, recharger la page
   invité : « Ce lien n'est plus valable. » Les fichiers de la sélection cessent
   d'être servis en même temps.

7. **La limite de débit mord.** Facultatif, mais rassurant : basculer la liste
   de souhaits une trentaine de fois d'affilée finit par un message clair et un
   `429`.

8. **Et le contrôle symétrique, depuis le tailnet** : votre propre application
   répond toujours. C'est l'autre moitié de la porte, et c'est celle qui a
   lâché la première fois — en conteneur, toutes les requêtes arrivent par la
   passerelle Docker, et une classification par adresse répondait 404 à Nathan
   sur son propre port.

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' http://100.x.y.z:3000/api/ideas   # 200
   ```

Côté serveur, `docker compose logs -f vitrine` montre les requêtes des visiteurs.
Un `404` sur `/api/ideas` dans ce journal n'est pas une erreur : c'est la porte
qui fonctionne.

---

## 6. Refermer

```bash
sudo tailscale funnel off
```

L'instance redevient joignable par le seul tailnet. Les sélections, les avis et
les listes de souhaits restent en base — rien n'est perdu, et rouvrir plus tard
rouvre sur le même état.

Pour fermer **un lien** sans fermer l'exposition : le bouton « Révoquer le lien »
de `/partages`. La sélection n'est pas supprimée ; les avis déjà reçus gardent
d'où ils viennent, et le lien répond comme s'il n'avait jamais existé.

Pour fermer l'exposition **du côté de l'application**, sans toucher à Tailscale :
retirer `PUBLIC_PORT` et redémarrer. Le point d'entrée public n'existe plus, et
Funnel se retrouve à proxifier vers un port fermé.
