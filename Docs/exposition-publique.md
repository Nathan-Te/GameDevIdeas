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
classée `owner` ou `guest` par `server/src/access.js`, et un `guest` n'atteint
que six choses :

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

## 2. Le point technique central : pourquoi un port et pas une adresse

La classification pourrait, en théorie, se faire sur l'adresse source :
`100.64.0.0/10` et la boucle locale sont Nathan, tout le reste est un visiteur.
`access.js` sait le faire, et le fait — mais **ce n'est pas sur quoi la
séparation repose**, et il faut comprendre pourquoi.

Tailscale Funnel ne renvoie pas le trafic public tel quel vers l'application.
`tailscaled` termine TLS lui-même sur le nœud, puis **proxifie** la requête vers
la cible locale que vous lui avez donnée (`tailscale funnel 3003` proxifie vers
`127.0.0.1:3003`). La connexion que l'application voit arriver part donc de la
machine elle-même. Du point de vue de la socket, une requête venue de Tokyo et
une requête de Nathan depuis son portable sur le tailnet sont **identiques**.

> Conclusion, et c'est le point qu'il ne faut pas survoler : **derrière Funnel,
> la classification par adresse source est inopérante.** Une instance qui ne
> classerait que par IP servirait `/api/backup` au premier venu.

Tailscale pose bien un en-tête `Tailscale-Funnel-Request` sur les requêtes
venues de Funnel, et Vitrine l'honore — mais **en signal secondaire seulement**.
Un en-tête est une promesse d'un composant tiers ; s'il change de nom, disparaît
d'une version à l'autre ou n'est pas posé dans une configuration particulière,
une instance qui n'aurait que lui s'ouvrirait en silence. On ne construit pas une
frontière sur une promesse dont on ne contrôle pas la tenue.

### Le mécanisme retenu : un port d'écoute distinct

Vitrine écoute sur **deux ports** :

- `PORT` (3000 par défaut) — le port de Nathan, à publier sur la seule IP
  Tailscale, comme depuis le lot 5 ;
- `PUBLIC_PORT` (3003 par exemple) — le **point d'entrée public**, à publier sur
  `127.0.0.1` uniquement, et c'est lui que Funnel vise.

Les deux servent la même application. Le second est un `http.Server` qui
réécrit `X-Vitrine-Public: 1` sur chaque requête avant de la passer au routeur de
Fastify (`server/src/index.js`). L'en-tête entrant est **écrasé**, jamais lu :
un appelant ne choisit pas son camp.

C'est un fait de transport et non une déclaration : une requête entrée par le
port public est un visiteur, quoi qu'elle raconte d'elle-même, quelle que soit
son adresse, et quels que soient les en-têtes qu'elle porte. Aucun `X-Forwarded-For`
n'est lu nulle part — Fastify tourne sans `trustProxy`, précisément pour ça.

Sans `PUBLIC_PORT`, aucun point d'entrée public n'est ouvert et l'instance est
exactement ce qu'elle était avant le lot 7.

### Ce qui a été vérifié, et où

- **Vérifié en local, sur les deux ports d'un vrai serveur** (pas seulement par
  `inject`) : `GET /api/ideas` répond `200` sur le port de Nathan et
  `{"error":"not_found"}` en `404` sur le port public ; `GET /` sert
  l'application sur l'un et `404` sur l'autre ; `GET /p/<jeton>` sert la page
  invité sur les deux.
- **Vérifié par les tests** (`server/test/sharing.test.js`) : trente routes
  fermées, une à une, plus la classification par adresse et par en-tête.
- **À vérifier une fois en ligne, par vous, depuis l'extérieur du tailnet** :
  la section 5 en donne la liste. Le comportement exact de Funnel sur *votre*
  version de Tailscale ne se vérifie que chez vous — mais le mécanisme choisi ne
  dépend pas de ce comportement, et c'est tout l'intérêt.

### Éprouver la porte sans quitter son poste

`npm run dev` ne suffit pas : Vite sert le front et proxifie vers Fastify depuis
la boucle locale, donc tout y est classé `owner`. Pour voir l'application comme
un visiteur, il faut le vrai serveur et ses deux ports :

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
