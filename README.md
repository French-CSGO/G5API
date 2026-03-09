# G5API — Tournament Management API for MatchZy

> **Fork of [G5API](https://github.com/phlexplexico/G5API) by [PhlexPlexico](https://github.com/phlexplexico)**
> Maintained and extended by **[Iwhite](https://x.com/Iwhitecs)** (French-CSGO)

_**Status: Actively maintained.**_

---

G5API is a Node.js/TypeScript REST API for managing CS2 competitive matches using the [MatchZy](https://github.com/French-CSGO/MatchZy) plugin. It handles match creation, team management, statistics tracking, server RCON control, and backup management.

For the front-end, see [MatchZy Panel (G5V)](https://github.com/French-CSGO/G5V).

---

## What does it do?

G5API allows you to create, manage, and control CS2 matches. Features include:

- Team and player management
- Match creation and lifecycle control
- Per-player statistics tracking (kills, deaths, assists, KAST, flash assists, bomb plants/defuses, knife kills, and more)
- Round backup storage and restore (via MatchZy's backup system)
- Server RCON control (pause, unpause, restore backup, change server)
- Steam OAuth and local login support
- Season/Tournament tracking with optional Challonge integration

### Additional features (French-CSGO fork)

- **5v5 Queue** — Redis-backed queue with automatic match creation and real-time SSE events (`playerJoined`, `playerLeft`, `queueFull`, `queueStarting`)
- **Pterodactyl** — full Pterodactyl panel integration: auto server start (`startAndWait`) before queue match creation, `GET /servers/pterodactyl-list` endpoint with live status per server
- **Toornament** — match, round, and stage sync; per-match and batch scheduling endpoint (`PATCH`); `max_maps` format fallback from stage settings
- **Discord** — match announcement, live scoreboard, schedule channel, `/refresh-schedule` slash command with instant guild registration
- **Backup management** — list and restore backups from the web panel; change server with backup restore
- **MatchZy stats** — KAST, knife kills, bomb plants/defuses, flash assists, teammates flashed

## Requirements

- Node.js >= 16.17.0
- MariaDB / MySQL
- Redis (optional but recommended)
- [MatchZy](https://github.com/French-CSGO/MatchZy) on your CS2 server

## Setup

Copy and fill the config template:
```bash
cp config/production.json.template config/production.json
```

See [Configuration](https://github.com/PhlexPlexico/G5API/wiki/Configuration) for all available options.

### Migrate and start

```bash
yarn migrate-create-prod && yarn migrate-prod-upgrade
yarn tsstart
```

Or with PM2:
```bash
yarn startprod
```

### Development

```bash
yarn migrate-create-dev && yarn migrate-dev-upgrade
yarn start
```

### Tests

```bash
yarn test
```

Creates a temporary `get5test` database, runs all route tests, and tears it down.

### Docker

```bash
docker build -t yourname/g5api:latest .
docker container run --name g5api \
  -p 3301:3301 \
  -e PORT="3301" \
  -e HOSTNAME="" \
  -e DBKEY="" \
  -e STEAMAPIKEY="" \
  -e SHAREDSECRET="" \
  -e CLIENTHOME="" \
  -e APIURL="" \
  -e SQLUSER="" \
  -e SQLPASSWORD="" \
  -e DATABASE="" \
  -e SQLHOST="" \
  -e SQLPORT="" \
  -e ADMINS="" \
  -e SUPERADMINS="" \
  -e REDISURL="" \
  -e REDISTTL="" \
  -e USEREDIS="true" \
  yourname/g5api:latest
```

### Docker Compose

A `docker-compose.yml` is included for running G5API + MatchZy Panel + Caddy together:

```bash
docker network create -d bridge matchzy
docker-compose up -d
```

### API Docs

```bash
yarn doc         # generates JSDoc
```

Swagger UI is available at `/api-docs` when the server is running.

## Contributing

Pull requests are welcome. Please include Swagger/JSDoc documentation for any new API endpoints.

## Credits

- **[PhlexPlexico](https://github.com/phlexplexico)** — original author of G5API
- **[Iwhite](https://x.com/Iwhitecs)** — maintainer of this fork (French-CSGO)
- [MatchZy](https://github.com/shobhit-pathak/MatchZy) — CS2 match plugin by shobhit-pathak
- [PugSharp](https://github.com/Lan2Play/PugSharp) — alternative CS2 match plugin

## License

[MIT License](http://opensource.org/licenses/MIT). A copy of this license **must be included with the software**.
