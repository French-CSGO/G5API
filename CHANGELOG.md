# Changelog

## [2.2.0] - 2026-03-07

### Features
- **Queue 5v5** : système de file d'attente Redis avec création automatique de match à la complétion
- **Pterodactyl** : intégration complète — démarrage automatique du serveur (`startAndWait`) avant la création de match depuis la queue ; endpoint `GET /servers/pterodactyl-list` avec statut live
- **Queue SSE** : événement `queue:starting` émis avant le démarrage Pterodactyl pour informer le frontend
- **Toornament** : endpoint `PATCH` de planification par match et par batch (rounds)
- **Toornament** : endpoint `GET` des rounds ; fallback `max_maps` sur `stage.match_settings` quand absent au niveau match
- **Discord** : intégration complète — annonce de match, scoreboard live, canal de calendrier, commande slash `/refresh-schedule`
- **Discord** : enregistrement instantané des commandes slash via `guildId` ; affichage de la date planifiée dans les messages de calendrier
- **Saisons** : exposition de `challonge_url` et `is_challonge` dans `GET /seasons`
- **Équipes** : support de `challonge_team_id` dans les endpoints POST et PUT

### Fixes
- Queue : double-comptage de `currentPlayers` à la création ; déclenchement correct à la complétion ; `team1_string`/`team2_string` renseignés ; erreurs d'annulation de match
- Toornament : utilisation des IDs DB au lieu des IDs Get5 pour la mise à jour des participants ; participant null géré ; pagination rounds avec range `0-49` (fix erreur 416) ; fetch de tous les stages puis `find()` par ID (filtre `stage_ids` non supporté)
- Pterodactyl : statut live récupéré via `/resources` par serveur
- Veto Toornament : correction de l'affichage
- Score série : correction
- Ajout équipes saisons : correction

### Performance
- Build Docker limité à `amd64`, cache GHA par couches, optimisation de l'ordre des layers Dockerfile

---

## [2.1.0.3] - précédente version
