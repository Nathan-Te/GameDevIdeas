#!/usr/bin/env sh
# Sauvegarde Vitrine, prête pour le cron.
#
#   0 3 * * * /srv/vitrine/backup.sh >> /srv/vitrine/data/backups/backup.log 2>&1
#
# Produit une archive dans data/backups/, ne garde que les 30 plus récentes et
# écrit une ligne de log. Rien d'autre : la sauvegarde elle-même est faite par
# `server/src/backup-cli.js`, le même code que la route HTTP.
#
# Fonctionne serveur arrêté comme serveur démarré — la base est lue par l'API de
# sauvegarde en ligne de SQLite, jamais copiée fichier à fichier.
set -eu

ROOT=$(cd "$(dirname "$0")" && pwd)
OUT="${DATA_BACKUPS_DIR:-$ROOT/data/backups}"
KEEP="${BACKUP_KEEP:-30}"

mkdir -p "$OUT"

log() {
  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') $*"
}

# En Docker, la sauvegarde se fait dans le conteneur : il a la base montée et le
# bon Node. Hors Docker, on appelle simplement le script local.
if [ -n "${VITRINE_CONTAINER:-}" ]; then
  RUN="docker exec $VITRINE_CONTAINER node server/src/backup-cli.js"
else
  RUN="node $ROOT/server/src/backup-cli.js"
fi

if OUTPUT=$($RUN --out "$OUT" --keep "$KEEP" 2>&1); then
  log "sauvegarde ok — $OUTPUT"
else
  log "SAUVEGARDE ÉCHOUÉE — $OUTPUT"
  exit 1
fi
