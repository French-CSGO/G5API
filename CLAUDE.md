# G5API — Claude Instructions

> **Projet principal du workspace.** Les repos associés sont G5V (frontend) et matchzy (plugin CS2).
> Leurs CLAUDE.md se trouvent dans leurs dossiers respectifs.

## Vue d'ensemble

Backend Node.js/TypeScript REST API pour la gestion de matchs CS2 compétitifs via le plugin MatchZy.
Fork actif de French-CSGO (v2.2.0+).

## Stack technique

- **Runtime** : Node.js (v16.17.0+)
- **Langage** : TypeScript (strict mode, target ES2017)
- **Framework** : Express.js ~4.22.1 + Helmet
- **Auth** : Passport.js (Steam OAuth + local login)
- **Base de données** : MySQL2 v3 avec db-migrate (102 migrations)
- **Cache / Sessions** : Redis (connect-redis v7) — optionnel mais recommandé
- **Process manager** : PM2 (prodrun.json)
- **Tests** : Jest v29 + ts-jest

## Commandes essentielles

```bash
# Développement (watch mode)
yarn start

# Build TypeScript → dist/
yarn build

# Production via PM2
yarn startprod

# Migrations
yarn migrate-dev-upgrade       # Appliquer les migrations (dev)
yarn migrate-prod-upgrade      # Appliquer les migrations (prod)
yarn migrate-create-dev        # Créer la base de données dev
yarn migrate-create-prod       # Créer la base de données prod

# Tests
yarn test                      # Suite complète
yarn test:matches              # Test d'une feature spécifique

# Docs Swagger
yarn doc                       # Génère la doc, dispo sur /api-docs
```

## Structure du projet

```
bin/www.ts                     # Point d'entrée — init serveur, Discord, Twitch
app.ts                         # Setup Express (middlewares, routes, auth)
src/
  routes/                      # Handlers HTTP
    matches/matches.ts          # Cycle de vie des matchs (CRUD, start/pause/cancel)
    matches/matchserver.ts      # Relations match ↔ serveur
    playerstats/                # Stats joueurs (kills, deaths, KAST…)
    v2/api.ts                   # Endpoints V2 (événements MatchZy)
    v2/backupapi.ts             # Restauration de backups round
    v2/demoapi.ts               # Gestion des démos
    queue.ts                    # Queue 5v5 (Redis-backed)
    seasons.ts                  # Saisons / tournois
    vetoes.ts                   # Système de veto de maps
  services/                    # Logique métier et intégrations externes
    db.ts                       # Pool de connexion MySQL
    discord.ts                  # Bot Discord (annonces, scoreboard, events)
    pterodactyl.ts              # Démarrage serveurs Pterodactyl
    toornament.ts               # Sync API Toornament
    challonge.ts                # Intégration Challonge
    mapflowservices.ts          # Traitement des événements de map/round
    seriesflowservices.ts       # Traitement des événements de série
    queue.ts                    # Service de queue (SSE + Redis)
  utility/
    auth.ts                     # Stratégies Passport (Steam, local, mock)
    serverrcon.ts               # Commandes RCON
    utils.ts                    # Utilitaires communs, chiffrement, middleware auth
  types/                       # ~50 interfaces TypeScript
    Get5_*.ts                   # Types d'événements MatchZy
    map_flow/, series_flow/     # Types d'événements par phase
migrations/
  development/                  # Scripts db-migrate (dev)
  production/                   # Scripts db-migrate (prod)
  test/                         # Scripts db-migrate (test)
config/
  development.json              # Config dev (créé depuis le template)
  production.json.template      # Template prod (substitution variables d'env)
```

## Architecture

- **Routes** → HTTP endpoints purs, délèguent la logique aux services
- **Services** → Logique métier + intégrations externes (Discord, Pterodactyl, Toornament)
- **Utility** → Helpers transverses (auth, RCON, chiffrement)
- **Types** → Contrats TypeScript pour tous les objets (événements Get5/MatchZy, stats, matchs…)
- Les événements MatchZy arrivent sur `/api/v2/` et sont traités par `mapflowservices.ts` / `seriesflowservices.ts`

## Branches actives

| Branche | Rôle |
|---------|------|
| `master` | Production — branche principale |
| `feature/new-ui` | Fonctionnalités supplémentaires (ex: delete all cancelled) |
| `feat/pterodactyl` | Intégration Pterodactyl |
| `feature/toornament` | Intégration Toornament |
| `feature/discord-integration` | Bot Discord |

## Intégrations

| Service | Fichier | Description |
|---------|---------|-------------|
| Discord | `src/services/discord.ts` | Bot : annonces matchs, scoreboard live, events serveur, slash commands |
| Pterodactyl | `src/services/pterodactyl.ts` | Démarrage auto des serveurs CS2 via le panel |
| Toornament | `src/services/toornament.ts` | Sync matchs / résultats avec l'API Toornament |
| TeamSpeak 3 | `src/services/` | Pause/unpause du talk power TS3 en cours de match |
| Redis | `src/services/queue.ts` | Queue 5v5 + sessions |
| MatchZy | `src/routes/v2/` | Réception des webhooks du plugin CS2 |

## Config

Le fichier de config est sélectionné via `NODE_ENV` (development / production / test).
Copier `production.json.template` → `production.json` et remplir les valeurs.

Clés principales :
- `db` — connexion MySQL
- `server` — port, sessionSecret
- `steam` — apiKey, returnURL
- `redis` — host, port
- `discord` — token, guildId, channelIds
- `pterodactyl` — apiUrl, apiKey
- `toornament` — clientId, clientSecret

## Règles de développement

- Toujours typer explicitement les retours de fonctions (TypeScript strict)
- Les nouvelles routes doivent être montées dans `app.ts`
- Les nouvelles migrations vont dans les 3 dossiers (development, production, test)
- Ne jamais modifier les fichiers de migration existants — créer une nouvelle migration
- Les événements MatchZy sont définis dans `src/types/` avant d'être traités dans les services
