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
