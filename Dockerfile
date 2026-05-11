# ── Stage 1 : build ──────────────────────────────────────────────────────────
FROM node:18-alpine AS builder

# Outils de compilation (python3, gcc, make) + headers natifs pour bcrypt/canvas
RUN apk add --no-cache \
    python3 build-base pkgconfig \
    cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev pixman-dev

WORKDIR /Get5API

# Copier uniquement les manifestes en premier → cache Docker sur yarn install
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copier le reste et compiler TypeScript
COPY . .
RUN yarn build

# ── Stage 2 : runtime ────────────────────────────────────────────────────────
FROM node:18-alpine

# Seulement les bibliothèques partagées (.so) nécessaires à l'exécution
# gettext    → envsubst dans le CMD
# les autres → shared libs pour les modules natifs (bcrypt, canvas…)
RUN apk add --no-cache \
    gettext \
    cairo pango jpeg giflib librsvg pixman

WORKDIR /Get5API

# Artefacts du builder uniquement
COPY --from=builder /Get5API/dist        ./dist
COPY --from=builder /Get5API/node_modules ./node_modules
COPY --from=builder /Get5API/migrations  ./migrations
COPY --from=builder /Get5API/config      ./config
COPY --from=builder /Get5API/package.json ./package.json

EXPOSE 3301

CMD envsubst < /Get5API/config/production.json.template > /Get5API/config/production.json && \
    sed -i "s/db:create get5$/db:create $DATABASE/" /Get5API/package.json && \
    yarn migrate-create-prod && \
    yarn migrate-prod-upgrade && \
    yarn startprod && \
    yarn pm2 logs
