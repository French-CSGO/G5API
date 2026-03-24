FROM node:25-alpine AS builder

RUN apk add --no-cache gettext python3 build-base \
    pkgconfig cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev pixman-dev

# clone and move into Get5API folder
WORKDIR /Get5API
COPY . .
RUN yarn
RUN yarn build

FROM node:25-alpine

RUN apk add --no-cache gettext python3 cairo pango jpeg giflib librsvg pixman

EXPOSE 3301
# copy built application from builder stage
WORKDIR /Get5API
COPY --from=builder /Get5API /Get5API

# entrypoint script to configure and start the application with proper signal handling
RUN printf '%s\n' \
  '#!/bin/sh' \
  'set -e' \
  '' \
  '# set config with env variables' \
  'envsubst < /Get5API/config/production.json.template > /Get5API/config/production.json' \
  '' \
  '# create database if not exists' \
  'yarn migrate-create-prod || true' \
  '' \
  '# sync migration tracking state in case tables exist without migration history' \
  'yarn migrate-prod-fake || true' \
  '' \
  '# run migrations - applies only new/missing ones' \
  'yarn migrate-prod-upgrade' \
  '' \
  '# start application as PID 1' \
  'exec yarn startprod' \
  > /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

# run application via entrypoint script (exec form)
CMD ["/usr/local/bin/entrypoint.sh"]

