#!/usr/bin/env bash
#
# Les tests qui n'ont de sens que dans le conteneur.
#
# En production, `data/db`, `data/files` et `data/backups` sont des points de
# montage. Un point de montage ne se renomme pas, ne se supprime pas, et
# `rename()` refuse d'en traverser la frontière. Tout code qui touche au système
# de fichiers doit donc être exercé là, pas seulement dans un dossier
# temporaire — c'est ce qui a laissé passer la bascule du lot 5.
#
# Les volumes sont **nommés** et propres à ce script : `./data` n'est jamais
# monté, la base de travail de Nathan ne risque rien.
#
#   ./scripts/test-container.sh          (ou `npm run test:container`)
#
set -euo pipefail

IMAGE=vitrine-test:latest
VOLUMES=(vitrine-test-db vitrine-test-files vitrine-test-backups)
# Par défaut, les tests du conteneur ; un argument les remplace.
TARGET=${1:-server/test/restore-mountpoint.test.js}

cleanup() {
  docker volume rm -f "${VOLUMES[@]}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "$(dirname "$0")/.."

echo "--- construction de l'image de production"
docker build -t "$IMAGE" .

# Des volumes neufs : un test qui hérite de l'état du précédent ne prouve rien.
cleanup

echo "--- $TARGET, destination montée"
docker run --rm \
  -v "${VOLUMES[0]}:/app/data/db" \
  -v "${VOLUMES[1]}:/app/data/files" \
  -v "${VOLUMES[2]}:/app/data/backups" \
  -e VITRINE_REQUIRE_MOUNT_TEST=1 \
  "$IMAGE" node --test "$TARGET"

# --- La porte, à travers le réseau Docker ------------------------------------
#
# C'est le décor exact du défaut corrigé après le lot 7 : publiés par Docker,
# les ports présentent toutes les requêtes — celles de Nathan comprises —
# depuis la passerelle du réseau bridge (172.x.0.1). Une classification par
# adresse source y répondait 404 à Nathan sur son propre port.
#
# Ce que le test prouve : à travers cette passerelle, le port de Nathan répond
# 200 et le port public répond 404, sur la même route et depuis la même
# adresse. Seul le port compte.

OWNER_PORT=13000
PUBLIC_PORT=13003
PEER_PORT=13999
NAME=vitrine-test-porte

docker rm -f "$NAME" >/dev/null 2>&1 || true

echo "--- la porte, à travers le réseau Docker"
docker run -d --rm --name "$NAME" \
  -p "127.0.0.1:${OWNER_PORT}:3000" \
  -p "127.0.0.1:${PUBLIC_PORT}:3003" \
  -p "127.0.0.1:${PEER_PORT}:3999" \
  -e PUBLIC_PORT=3003 \
  -e PUBLIC_HOST=0.0.0.0 \
  -e LOG_LEVEL=warn \
  "$IMAGE" >/dev/null

trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true; cleanup' EXIT

# Le serveur applique ses migrations au démarrage : on attend qu'il réponde.
for attempt in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${OWNER_PORT}/api/ideas" 2>/dev/null; then break; fi
  if [ "$attempt" = 30 ]; then
    echo "le conteneur n'a jamais répondu sur ${OWNER_PORT}" >&2
    docker logs "$NAME" >&2 || true
    exit 1
  fi
  sleep 1
done

code_of() { curl -s -o /dev/null -w '%{http_code}' "$1"; }

fail=0
check() { # url attendu libellé
  got=$(code_of "$1")
  if [ "$got" = "$2" ]; then
    echo "    ok   $3 -> $got"
  else
    echo "    ÉCHEC $3 -> $got (attendu $2)" >&2
    fail=1
  fi
}

check "http://127.0.0.1:${OWNER_PORT}/api/ideas"    200 "port de Nathan, /api/ideas"
check "http://127.0.0.1:${OWNER_PORT}/api/shares"   200 "port de Nathan, /api/shares"
check "http://127.0.0.1:${OWNER_PORT}/"             200 "port de Nathan, l'application"
check "http://127.0.0.1:${PUBLIC_PORT}/api/ideas"   404 "port public, /api/ideas"
check "http://127.0.0.1:${PUBLIC_PORT}/api/shares"  404 "port public, /api/shares"
check "http://127.0.0.1:${PUBLIC_PORT}/"            404 "port public, l'application"

# Et de quoi voir, en clair, l'adresse que le conteneur voit arriver : c'est
# elle que la premiere version du lot 7 classait « visiteur », et c'est ce qui
# rendait l'application inaccessible a Nathan sur son propre port.
docker exec -d "$NAME" node -e "
  require('node:http')
    .createServer((q, s) => {
      require('node:fs').writeFileSync('/tmp/peer', String(q.socket.remoteAddress));
      s.end('ok');
    })
    .listen(3999, '0.0.0.0');
" >/dev/null 2>&1 || true
sleep 1
curl -s -o /dev/null "http://127.0.0.1:${PEER_PORT}/" 2>/dev/null || true
vu=$(docker exec "$NAME" sh -c 'cat /tmp/peer 2>/dev/null' 2>/dev/null || true)
echo "    (adresse source vue par le conteneur : ${vu:-inconnue} — ni la boucle locale, ni le tailnet)"

if [ "$fail" != 0 ]; then
  echo "la porte ne se comporte pas comme attendu à travers Docker" >&2
  docker logs "$NAME" >&2 || true
  exit 1
fi

echo "--- la porte tient : seul le port distingue Nathan d'un visiteur"
