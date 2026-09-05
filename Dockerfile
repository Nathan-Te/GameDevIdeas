# Vitrine — image unique : le front est construit puis servi en statique par Fastify.
#
# Trois étages : les dépendances de production d'un côté, le build du front de
# l'autre, et une image finale qui ne contient ni chaîne de compilation ni
# devDependencies.

# --- Étage 1 : dépendances de production ------------------------------------
# `better-sqlite3` récupère une binaire précompilée quand il en existe une pour
# la plateforme ; la chaîne C++ n'est là que comme filet de sécurité.
FROM node:24-slim AS deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN npm ci --omit=dev

# --- Étage 2 : build du front ------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN npm ci --ignore-scripts

COPY server/ ./server/
COPY shared/ ./shared/
COPY web/ ./web/
RUN npm run build --workspace web

# --- Étage 3 : image finale --------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DB_DIR=/app/data/db \
    DATA_FILES_DIR=/app/data/files \
    DATA_BACKUPS_DIR=/app/data/backups \
    SERVE_STATIC=true

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server/ ./server/
COPY --from=build /app/web/dist ./web/dist

# Les volumes sont montés sur ces chemins ; ils doivent appartenir à `node`.
RUN mkdir -p /app/data/db /app/data/files /app/data/backups && chown -R node:node /app/data
USER node

EXPOSE 3000

# Les migrations en attente sont appliquées au démarrage par le serveur lui-même.
CMD ["node", "server/src/index.js"]
