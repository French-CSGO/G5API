/**
 * Service Twitch pour G5API.
 * Fournit un bot Twitch qui affiche les scores en direct et annonce la fin des séries.
 * S'intègre via GlobalEmitter (même mécanisme que discord.ts).
 *
 * Commandes viewer :
 *   !score / !match / !live  → score de tous les matchs en cours
 *   !stats [pseudo]          → stats du joueur sur la map en cours
 *   !maps                    → résultats des maps de la série en cours
 *
 * Événements automatiques :
 *   - Fin de série : annonce complète avec scores par map
 *   - Fin de map   : annonce du résultat de la map
 */

import tmi from "tmi.js";
import { db } from "./db.js";
import { getSetting, getSettingBool, onSettingsReload } from "./settings.js";
import GlobalEmitter from "../utility/emitter.js";
import { RowDataPacket } from "mysql2";

// ─── Types internes ──────────────────────────────────────────────────────────

interface MapState {
  map_number: number;
  map_name: string | null;
  team1_score: number;
  team2_score: number;
  started: boolean;   // map_start_time est définie
  ended: boolean;     // map_end_time est définie
}

interface MatchState {
  id: number;
  team1_name: string;
  team2_name: string;
  team1_series: number;
  team2_series: number;
  max_maps: number;
  ended: boolean;
  maps: MapState[];
}

// ─── État interne ────────────────────────────────────────────────────────────

let client: tmi.Client | null = null;
let channels: string[] = [];
let enabled = false;
let botEnabled = true; // Peut être désactivé via !twitchbot off (admin)

/** Cache des matchs actifs : matchId → MatchState */
const matchCache = new Map<number, MatchState>();

/** Anti-spam commandes viewers : channel → timestamp */
const commandCooldowns = new Map<string, number>();

/** Cooldown en secondes entre deux commandes du même channel */
const COMMAND_COOLDOWN_SEC = 5;

// ─── Initialisation ──────────────────────────────────────────────────────────

export async function initTwitch(): Promise<void> {
  try {
    // Lecture de la config depuis la DB
    enabled = getSettingBool("twitch.enabled");

    if (!enabled) {
      console.log("[Twitch] Bot désactivé (twitch.enabled = false).");
      return;
    }

    const token: string = getSetting("twitch.token");
    const username: string = getSetting("twitch.username");
    // channels stocké en JSON : '["channel1","channel2"]' ou "channel1"
    let rawChannels: string = getSetting("twitch.channels");

    if (!token || !username) {
      console.warn("[Twitch] token ou username manquant — bot non démarré.");
      return;
    }

    try {
      const parsed = JSON.parse(rawChannels);
      channels = Array.isArray(parsed) ? parsed : [String(parsed)];
    } catch {
      channels = rawChannels ? [rawChannels] : [];
    }

    if (!channels.length) {
      console.warn("[Twitch] Aucun channel configuré (twitch.channels) — bot non démarré.");
      return;
    }

    // Connexion TMI
    client = new tmi.Client({
      options: { debug: false },
      identity: {
        username,
        password: token.startsWith("oauth:") ? token : `oauth:${token}`
      },
      channels
    });

    client.on("message", onMessage);
    client.on("connected", () => {
      console.log(`[Twitch] Connecté en tant que ${username} sur ${channels.join(", ")}`);
    });
    client.on("disconnected", (reason) => {
      console.warn(`[Twitch] Déconnecté : ${reason}`);
    });

    await client.connect();

    // Chargement initial du cache des matchs
    await refreshMatchCache();

    // Abonnement aux événements G5API
    GlobalEmitter.on("matchUpdate", onMatchUpdate);
    GlobalEmitter.on("mapStatUpdate", onMapStatUpdate);
    GlobalEmitter.on("playerStatsUpdate", onPlayerStatsUpdate);

    // Enregistre le rechargement automatique si les settings changent
    onSettingsReload(async () => {
      if (client) {
        try { await client.disconnect(); } catch {}
        client = null;
      }
      GlobalEmitter.removeListener("matchUpdate", onMatchUpdate);
      GlobalEmitter.removeListener("mapStatUpdate", onMapStatUpdate);
      GlobalEmitter.removeListener("playerStatsUpdate", onPlayerStatsUpdate);
      await initTwitch();
    });

    console.log("[Twitch] Bot prêt.");
  } catch (err) {
    console.error("[Twitch] Erreur d'initialisation :", err);
  }
}

// ─── Gestion des commandes viewer ────────────────────────────────────────────

async function onMessage(
  channel: string,
  tags: tmi.ChatUserstate,
  message: string,
  self: boolean
): Promise<void> {
  if (self || !botEnabled) return;

  const msg = message.trim().toLowerCase();
  const args = msg.split(/\s+/);
  const cmd = args[0];

  // Commandes admin (broadcaster ou modérateurs)
  const isMod = tags.mod || tags.badges?.broadcaster === "1";
  if (isMod) {
    if (cmd === "!twitchbot") {
      const sub = args[1];
      if (sub === "off") {
        botEnabled = false;
        say(channel, "Bot G5 désactivé.");
        return;
      }
      if (sub === "on") {
        botEnabled = true;
        say(channel, "Bot G5 réactivé.");
        return;
      }
    }
  }

  // Ignorer les messages qui ne sont pas des commandes (évite de polluer le cooldown)
  const knownCmds = ["!score", "!match", "!live", "!maps", "!stats", "!help", "!commandes"];
  if (!knownCmds.includes(cmd)) return;

  // Vérification cooldown (par channel, uniquement sur les vraies commandes)
  if (!checkCooldown(channel)) return;

  // Commandes publiques
  if (["!score", "!match", "!live"].includes(cmd)) {
    await cmdScore(channel);
  } else if (cmd === "!maps") {
    await cmdMaps(channel);
  } else if (cmd === "!stats") {
    const playerArg = args.slice(1).join(" ");
    await cmdStats(channel, playerArg || tags["display-name"] || "");
  } else if (cmd === "!help" || cmd === "!commandes") {
    cmdHelp(channel);
  }
}

// ─── Commande !help ───────────────────────────────────────────────────────────

function cmdHelp(channel: string): void {
  say(
    channel,
    "Commandes disponibles : " +
    "!score (!match / !live) → scores en direct | " +
    "!maps → résultats des maps | " +
    "!stats [pseudo] → stats d'un joueur (K/D, ADR, HS%, multikills)"
  );
}

// ─── Commande !score ─────────────────────────────────────────────────────────

async function cmdScore(channel: string): Promise<void> {
  try {
    const matches = await getActiveMatchesFromDB();

    if (!matches.length) {
      say(channel, "Aucun match en cours.");
      return;
    }

    for (const m of matches) {
      const line = formatMatchScore(m);
      say(channel, line);
    }
  } catch (err) {
    console.error("[Twitch] cmdScore error:", err);
    say(channel, "Erreur lors de la récupération des scores.");
  }
}

// ─── Commande !maps ───────────────────────────────────────────────────────────

async function cmdMaps(channel: string): Promise<void> {
  try {
    const matches = await getActiveMatchesFromDB();

    if (!matches.length) {
      say(channel, "Aucun match en cours.");
      return;
    }

    for (const m of matches) {
      const playedMaps = m.maps.filter(mp => mp.started);
      if (!playedMaps.length) {
        say(channel, `${m.team1_name} vs ${m.team2_name} — Aucune map jouée encore.`);
        continue;
      }
      const mapsStr = playedMaps
        .map(mp => `${mp.map_name || "?"} ${mp.team1_score}-${mp.team2_score}`)
        .join(" / ");
      say(channel, `${m.team1_name} ${m.team1_series}-${m.team2_series} ${m.team2_name} | ${mapsStr}`);
    }
  } catch (err) {
    console.error("[Twitch] cmdMaps error:", err);
  }
}

// ─── Commande !stats ─────────────────────────────────────────────────────────

async function cmdStats(channel: string, playerName: string): Promise<void> {
  try {
    if (!playerName) {
      say(channel, "Usage: !stats [nom du joueur]");
      return;
    }

    // Cherche les stats du joueur dans les maps en cours
    const sql = `
      SELECT ps.name, ps.kills, ps.deaths, ps.assists,
             ps.headshot_kills, ps.damage, ps.roundsplayed,
             ps.flashbang_assists, ps.teamkills,
             ps.k2, ps.k3, ps.k4, ps.k5,
             ms.map_name, ms.team1_score, ms.team2_score,
             t.name AS team_name
      FROM player_stats ps
      JOIN map_stats ms ON ms.id = ps.map_id
      JOIN \`match\` m ON m.id = ms.match_id
      JOIN team t ON t.id = ps.team_id
      WHERE m.end_time IS NULL
        AND (m.cancelled IS NULL OR m.cancelled = 0)
        AND ms.end_time IS NULL
        AND ps.name LIKE ?
      ORDER BY ms.map_number DESC
      LIMIT 1
    `;
    const rows: RowDataPacket[] = await db.query(sql, [`%${playerName}%`]);

    if (!rows.length) {
      say(channel, `Aucun joueur "${playerName}" trouvé dans les matchs en cours.`);
      return;
    }

    const p = rows[0];
    const kd = p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
    const hs = p.kills > 0 ? Math.round((p.headshot_kills / p.kills) * 100) : 0;
    const adr = p.roundsplayed > 0 ? Math.round(p.damage / p.roundsplayed) : 0;
    const multikills = [p.k2, p.k3, p.k4, p.k5].filter(Boolean);
    const mkStr = multikills.length
      ? ` | 2K:${p.k2} 3K:${p.k3} 4K:${p.k4} 5K:${p.k5}`
      : "";

    say(
      channel,
      `${p.name} (${p.team_name}) sur ${p.map_name}: ` +
      `K/D ${p.kills}/${p.deaths} (${kd}) | ASS ${p.assists} | ADR ${adr} | HS ${hs}%${mkStr} | ` +
      `Score map: ${p.team1_score}-${p.team2_score}`
    );
  } catch (err) {
    console.error("[Twitch] cmdStats error:", err);
  }
}

// ─── Événements GlobalEmitter ────────────────────────────────────────────────

/**
 * Appelé à chaque matchUpdate.
 * Détecte les fins de série en comparant le cache avec la DB.
 */
async function onMatchUpdate(): Promise<void> {
  if (!botEnabled || !client) return;
  try {
    // Récupère les matchs terminés récemment (end_time dans les 60 dernières secondes)
    const sqlEnded = `
      SELECT m.id, m.team1_string, m.team2_string, m.team1_score, m.team2_score,
             m.max_maps, m.cancelled
      FROM \`match\` m
      WHERE m.end_time IS NOT NULL
        AND m.end_time >= DATE_SUB(NOW(), INTERVAL 60 SECOND)
        AND (m.cancelled IS NULL OR m.cancelled = 0)
    `;
    const endedMatches: RowDataPacket[] = await db.query(sqlEnded, []);

    for (const m of endedMatches) {
      // N'annonce qu'une seule fois par match
      if (matchCache.has(m.id) && matchCache.get(m.id)!.ended) continue;

      // Récupère les détails des maps pour l'annonce
      const sqlMaps = `
        SELECT map_name, team1_score, team2_score, map_number, start_time, end_time
        FROM map_stats
        WHERE match_id = ?
        ORDER BY map_number
      `;
      const maps: RowDataPacket[] = await db.query(sqlMaps, [m.id]);

      // Marque comme annoncé dans le cache
      if (!matchCache.has(m.id)) {
        matchCache.set(m.id, {
          id: m.id,
          team1_name: m.team1_string,
          team2_name: m.team2_string,
          team1_series: m.team1_score,
          team2_series: m.team2_score,
          max_maps: m.max_maps,
          ended: true,
          maps: []
        });
      } else {
        matchCache.get(m.id)!.ended = true;
      }

      // Construit l'annonce de fin de série
      const mapsStr = maps
        .filter(mp => mp.map_name)
        .map(mp => `${mp.map_name} ${mp.team1_score}-${mp.team2_score}`)
        .join(" / ");

      const msg =
        `Match terminé ! ${m.team1_string} ${m.team1_score}-${m.team2_score} ${m.team2_string}` +
        (mapsStr ? ` | ${mapsStr}` : "");

      sayAll(msg);
    }

    // Met à jour le cache des matchs actifs
    await refreshMatchCache();
  } catch (err) {
    console.error("[Twitch] onMatchUpdate error:", err);
  }
}

/**
 * Appelé à chaque mapStatUpdate.
 * Détecte les fins de map pour annoncer le résultat.
 */
async function onMapStatUpdate(): Promise<void> {
  if (!botEnabled || !client) return;
  try {
    // Cherche les maps qui viennent de se terminer (end_time dans les 60 dernières secondes)
    // ET dont le match est encore en cours (pas de fin de série encore)
    const sql = `
      SELECT ms.match_id, ms.map_name, ms.team1_score, ms.team2_score, ms.map_number,
             m.team1_string, m.team2_string, m.team1_score AS t1_series, m.team2_score AS t2_series
      FROM map_stats ms
      JOIN \`match\` m ON m.id = ms.match_id
      WHERE ms.end_time IS NOT NULL
        AND ms.end_time >= DATE_SUB(NOW(), INTERVAL 60 SECOND)
        AND m.end_time IS NULL
        AND (m.cancelled IS NULL OR m.cancelled = 0)
    `;
    const rows: RowDataPacket[] = await db.query(sql, []);

    for (const r of rows) {
      // Clé unique pour éviter les doublons
      const cacheKey = `map_${r.match_id}_${r.map_number}`;
      if ((onMapStatUpdate as any)[cacheKey]) continue;
      (onMapStatUpdate as any)[cacheKey] = true;

      const msg =
        `Map terminée ! ${r.map_name} : ${r.team1_string} ${r.team1_score}-${r.team2_score} ${r.team2_string} ` +
        `| Série : ${r.t1_series}-${r.t2_series}`;

      sayAll(msg);
    }
  } catch (err) {
    console.error("[Twitch] onMapStatUpdate error:", err);
  }
}

/**
 * Appelé à chaque playerStatsUpdate — mise à jour silencieuse du cache.
 */
async function onPlayerStatsUpdate(): Promise<void> {
  // Pas d'annonce automatique sur les stats joueurs
  // Le cache est mis à jour implicitement via les requêtes DB à la demande
}

// ─── Helpers DB ──────────────────────────────────────────────────────────────

/**
 * Récupère tous les matchs actifs depuis la DB avec leurs maps.
 */
async function getActiveMatchesFromDB(): Promise<MatchState[]> {
  const sqlMatches = `
    SELECT m.id, m.team1_string, m.team2_string, m.team1_score, m.team2_score, m.max_maps
    FROM \`match\` m
    WHERE m.end_time IS NULL
      AND (m.cancelled IS NULL OR m.cancelled = 0)
    ORDER BY m.id
  `;
  const matches: RowDataPacket[] = await db.query(sqlMatches, []);

  if (!matches.length) return [];

  const matchIds = matches.map(m => m.id);
  const placeholders = matchIds.map(() => "?").join(",");

  const sqlMaps = `
    SELECT match_id, map_number, map_name, team1_score, team2_score,
           start_time, end_time
    FROM map_stats
    WHERE match_id IN (${placeholders})
    ORDER BY match_id, map_number
  `;
  const mapRows: RowDataPacket[] = await db.query(sqlMaps, matchIds);

  return matches.map(m => {
    const maps: MapState[] = mapRows
      .filter(mp => mp.match_id === m.id)
      .map(mp => ({
        map_number: mp.map_number,
        map_name: mp.map_name,
        team1_score: mp.team1_score ?? 0,
        team2_score: mp.team2_score ?? 0,
        started: !!mp.start_time,
        ended: !!mp.end_time
      }));

    return {
      id: m.id,
      team1_name: m.team1_string,
      team2_name: m.team2_string,
      team1_series: m.team1_score ?? 0,
      team2_series: m.team2_score ?? 0,
      max_maps: m.max_maps,
      ended: false,
      maps
    } as MatchState;
  });
}

/**
 * Rafraîchit le cache interne des matchs actifs.
 */
async function refreshMatchCache(): Promise<void> {
  try {
    const active = await getActiveMatchesFromDB();

    // Supprime les matchs terminés du cache (sauf ceux marqués ended pour les annonces)
    for (const [id, state] of matchCache.entries()) {
      if (!state.ended && !active.find(m => m.id === id)) {
        matchCache.delete(id);
      }
    }

    // Met à jour / ajoute les matchs actifs
    for (const m of active) {
      matchCache.set(m.id, m);
    }
  } catch (err) {
    console.error("[Twitch] refreshMatchCache error:", err);
  }
}

// ─── Formatage des scores ────────────────────────────────────────────────────

/**
 * Formate le score d'un match en une ligne lisible.
 * Exemple : "Vitality 1-1 NaVi | Mirage 10-8 (live)"
 */
function formatMatchScore(m: MatchState): string {
  const currentMap = getCurrentMap(m);

  let mapInfo = "";
  if (currentMap) {
    if (!currentMap.started) {
      mapInfo = ` | entre les maps`;
    } else {
      mapInfo = ` | ${currentMap.map_name || "?"} ${currentMap.team1_score}-${currentMap.team2_score}`;
    }
  }

  return `${m.team1_name} ${m.team1_series}-${m.team2_series} ${m.team2_name}${mapInfo} (BO${m.max_maps})`;
}

/**
 * Retourne la map actuellement en cours (non terminée).
 */
function getCurrentMap(m: MatchState): MapState | null {
  const liveMaps = m.maps.filter(mp => !mp.ended);
  if (!liveMaps.length) return null;
  return liveMaps[liveMaps.length - 1];
}

// ─── Helpers Twitch ──────────────────────────────────────────────────────────

/**
 * Envoie un message dans un channel.
 */
function say(channel: string, message: string): void {
  if (!client || !botEnabled) return;
  // tmi.js accepte le channel avec ou sans #
  const ch = channel.startsWith("#") ? channel : `#${channel}`;
  client.say(ch, message).catch(err => {
    console.error(`[Twitch] Erreur say(${ch}):`, err);
  });
}

/**
 * Envoie un message dans tous les channels configurés.
 */
function sayAll(message: string): void {
  if (!client || !botEnabled) return;
  for (const ch of channels) {
    say(ch, message);
  }
}

/**
 * Vérifie et met à jour le cooldown pour un channel.
 * Retourne true si la commande peut être exécutée.
 */
function checkCooldown(channel: string): boolean {
  const now = Date.now();
  const last = commandCooldowns.get(channel) ?? 0;
  if (now - last < COMMAND_COOLDOWN_SEC * 1000) return false;
  commandCooldowns.set(channel, now);
  return true;
}
