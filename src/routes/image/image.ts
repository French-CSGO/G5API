/**
 * @swagger
 * resourcePath: /image
 * description: Express API for generating real-time match stat images.
 */
import { Router, Request, Response } from "express";

type MReq = Request & { file?: { originalname: string; buffer: Buffer; mimetype: string; size: number } };
import path from "path";
import fs from "fs";

import { db } from "../../services/db.js";
import { upload, writeFileSafe } from "./helpers.js";
import { loadSettings, saveSettings } from "./settings.js";
import Utils from "../../utility/utils.js";
import { generateMatchImage } from "./generators/match.js";
import { generatePlayerImage } from "./generators/player.js";
import { generateTeamSeasonImage } from "./generators/teamSeason.js";
import { generateMapMvpImage } from "./generators/mvp.js";
import type { ImageSettings } from "./types.js";
import type {
  MatchRow, MapStatRow, PlayerStatRow,
  PlayerStatExtended, TeamSeasonRow, RoundsRow, WinsRow,
  TeamNameRow, BestMapRow,
} from "./types.js";

const router = Router();

// ─── Shared DB helpers ────────────────────────────────────────────────────────

async function fetchMatchRow(matchId: number): Promise<MatchRow | null> {
  const rows = await db.query(
    `SELECT m.team1_id, m.team2_id, m.team1_string, m.team2_string,
            t1.name AS team1_name, t2.name AS team2_name,
            t1.logo AS team1_logo, t2.logo AS team2_logo,
            t1.flag AS team1_flag, t2.flag AS team2_flag
     FROM \`match\` m
     LEFT JOIN team t1 ON t1.id = m.team1_id
     LEFT JOIN team t2 ON t2.id = m.team2_id
     WHERE m.id = ?`,
    [matchId]
  ) as MatchRow[];
  return rows?.[0] ?? null;
}

async function fetchAllMaps(matchId: number): Promise<MapStatRow[]> {
  return (await db.query(
    `SELECT id, map_name, team1_score, team2_score FROM map_stats WHERE match_id = ? ORDER BY map_number ASC`,
    [matchId]
  )) as MapStatRow[];
}

async function fetchVetoPicks(matchId: number): Promise<string[]> {
  const rows = await db.query(
    `SELECT map FROM veto WHERE match_id = ? AND pick_or_veto = 'pick' ORDER BY id ASC`,
    [matchId]
  ) as Array<{ map: string }>;
  return rows.map(r => r.map);
}

function playerRating(p: PlayerStatExtended): number {
  return Utils.getRating(
    Number(p.kills), Number(p.roundsplayed), Number(p.deaths),
    Number(p.k1), Number(p.k2), Number(p.k3), Number(p.k4), Number(p.k5)
  );
}

function computeMvpPlayer(players: PlayerStatExtended[]): PlayerStatExtended {
  return players.reduce((best, p) => playerRating(p) > playerRating(best) ? p : best);
}

// ─── Settings routes ──────────────────────────────────────────────────────────

/** GET /image/fonts — liste les fichiers de police dans public/fonts/ */
router.get("/fonts", (_req: Request, res: Response) => {
  const fontsDir = path.join(process.cwd(), "public", "fonts");
  try {
    const files = fs.existsSync(fontsDir)
      ? fs.readdirSync(fontsDir).filter(f => /\.(ttf|otf|woff|woff2)$/i.test(f))
      : [];
    res.json(files.map(f => f.replace(/\.[^.]+$/, "")));
  } catch {
    res.json([]);
  }
});

/** GET /image/settings */
router.get("/settings", (_req: Request, res: Response) => {
  res.json(loadSettings());
});

/** PUT /image/settings */
router.put("/settings", (req: Request, res: Response) => {
  try {
    saveSettings(req.body as ImageSettings);
    res.json({ message: "Settings saved." });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** POST /image/settings/background — met à jour match.background */
router.post(
  "/settings/background",
  upload.single("background") as any,
  (req: MReq, res: Response) => {
    if (!req.file) { res.status(400).json({ error: "No file received." }); return; }
    const imgDir = path.join(process.cwd(), "public", "img");
    if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
    const safeFilename = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._\-]/g, "_");
    const dest = path.join(imgDir, safeFilename);
    writeFileSafe(dest, req.file.buffer);
    const s = loadSettings();
    s.match.background = safeFilename;
    saveSettings(s);
    res.json({ message: "Background saved.", filename: req.file.originalname });
  }
);

/** POST /image/upload/img — sauvegarde un fichier dans public/img/ */
router.post(
  "/upload/img",
  upload.single("file") as any,
  (req: MReq, res: Response) => {
    if (!req.file) { res.status(400).json({ error: "No file received." }); return; }
    const imgDir = path.join(process.cwd(), "public", "img");
    if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
    const safeFilename = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._\-]/g, "_");
    const dest = path.join(imgDir, safeFilename);
    writeFileSafe(dest, req.file.buffer);
    res.json({ filename: safeFilename });
  }
);

/** GET /image/maps — liste les images de map dans public/img/maps/ */
router.get("/maps", (_req: Request, res: Response) => {
  const mapsDir = path.join(process.cwd(), "public", "img", "maps");
  try {
    const files = fs.existsSync(mapsDir)
      ? fs.readdirSync(mapsDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      : [];
    res.json(files);
  } catch {
    res.json([]);
  }
});

/** POST /image/upload/map — sauvegarde une image de map dans public/img/maps/ */
router.post(
  "/upload/map",
  upload.single("file") as any,
  (req: MReq, res: Response) => {
    if (!req.file) { res.status(400).json({ error: "No file received." }); return; }
    const mapsDir = path.join(process.cwd(), "public", "img", "maps");
    if (!fs.existsSync(mapsDir)) fs.mkdirSync(mapsDir, { recursive: true });
    const safeMapFilename = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._\-]/g, "_");
    const dest = path.join(mapsDir, safeMapFilename);
    writeFileSafe(dest, req.file.buffer);
    res.json({ filename: safeMapFilename });
  }
);

/** GET /image/players — liste les images de joueurs dans public/img/players/ */
router.get("/players", (_req: Request, res: Response) => {
  const playersDir = path.join(process.cwd(), "public", "img", "players");
  try {
    const files = fs.existsSync(playersDir)
      ? fs.readdirSync(playersDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
      : [];
    res.json(files);
  } catch {
    res.json([]);
  }
});

/** POST /image/upload/player — upload d'une image joueur dans public/img/players/{steamid}.png */
router.post(
  "/upload/player",
  upload.single("file") as any,
  (req: MReq, res: Response) => {
    if (!req.file) { res.status(400).json({ error: "No file received." }); return; }
    const steamId = (req as any).body?.steam_id as string | undefined;
    if (!steamId || !/^\d{17}$/.test(steamId)) {
      res.status(400).json({ error: "Invalid or missing steam_id (must be 17 digits)." });
      return;
    }
    const playersDir = path.join(process.cwd(), "public", "img", "players");
    if (!fs.existsSync(playersDir)) fs.mkdirSync(playersDir, { recursive: true });
    const dest = path.join(playersDir, `${steamId}.png`);
    writeFileSafe(dest, req.file.buffer);
    res.json({ filename: `${steamId}.png` });
  }
);

/** POST /image/upload/font — sauvegarde un fichier dans public/fonts/ */
router.post(
  "/upload/font",
  upload.single("file") as any,
  (req: MReq, res: Response) => {
    if (!req.file) { res.status(400).json({ error: "No file received." }); return; }
    const fontsDir = path.join(process.cwd(), "public", "fonts");
    if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });
    const safeFontFilename = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._\-]/g, "_");
    const dest = path.join(fontsDir, safeFontFilename);
    writeFileSafe(dest, req.file.buffer);
    res.json({ filename: safeFontFilename });
  }
);

/** POST /image/settings/font — met à jour match.fontFile (ancienne route) */
router.post(
  "/settings/font",
  upload.single("font") as any,
  (req: MReq, res: Response) => {
    if (!req.file) { res.status(400).json({ error: "No file received." }); return; }
    const fontsDir = path.join(process.cwd(), "public", "fonts");
    if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });
    const safeFontFilename = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._\-]/g, "_");
    const dest = path.join(fontsDir, safeFontFilename);
    writeFileSafe(dest, req.file.buffer);
    const s = loadSettings();
    s.match.fontFile = safeFontFilename;
    saveSettings(s);
    res.json({ message: "Font saved.", filename: safeFontFilename });
  }
);

// ─── Match image routes ───────────────────────────────────────────────────────

/** GET /image/match/:match_id — full match stats (aggregated across all maps) */
router.get("/match/:match_id", async (req: Request, res: Response) => {
  await renderMatchImage(req, res, null, "full");
});

/** GET /image/match/:match_id/map — current (latest) map stats */
router.get("/match/:match_id/map", async (req: Request, res: Response) => {
  await renderMatchImage(req, res, null, "latest");
});

/** GET /image/match/:match_id/map/:map_number — stats by map number (1, 2, 3...) */
router.get("/match/:match_id/map/:map_number", async (req: Request, res: Response) => {
  const mapNumber = parseInt(req.params.map_number);
  if (isNaN(mapNumber) || mapNumber < 1) { res.status(400).json({ error: "Invalid map number" }); return; }
  await renderMatchImage(req, res, mapNumber, "byNumber");
});

async function renderMatchImage(req: Request, res: Response, mapParam: number | null, mode: "full" | "latest" | "byNumber") {
  try {
    const matchId = parseInt(req.params.match_id);
    if (isNaN(matchId)) { res.status(400).json({ error: "Invalid match ID" }); return; }

    const match = await fetchMatchRow(matchId);
    if (!match) { res.status(404).json({ error: "Match not found" }); return; }

    let mapRow: MapStatRow | null = null;
    let mapStatsId: number | null = null;

    if (mode === "byNumber" && mapParam !== null) {
      // map_number is 0-indexed in DB, user passes 1-indexed
      const rows = await db.query(
        `SELECT id, map_name, team1_score, team2_score FROM map_stats WHERE match_id = ? AND map_number = ? LIMIT 1`,
        [matchId, mapParam - 1]
      ) as MapStatRow[];
      if (!rows?.length) { res.status(404).json({ error: `Map ${mapParam} not found for this match` }); return; }
      mapRow = rows[0];
      mapStatsId = mapRow.id;
    } else if (mode === "latest") {
      const rows = await db.query(
        `SELECT id, map_name, team1_score, team2_score FROM map_stats WHERE match_id = ? ORDER BY id DESC LIMIT 1`,
        [matchId]
      ) as MapStatRow[];
      mapRow = rows?.[0] ?? null;
      mapStatsId = mapRow?.id ?? null;
    } else {
      // "full" mode — get latest map for display but aggregate all player stats
      const rows = await db.query(
        `SELECT id, map_name, team1_score, team2_score FROM map_stats WHERE match_id = ? ORDER BY id DESC LIMIT 1`,
        [matchId]
      ) as MapStatRow[];
      mapRow = rows?.[0] ?? null;
    }

    // For "full" mode, fetch all maps for the series score display
    let allMaps: MapStatRow[] = [];
    if (mode === "full") {
      allMaps = await db.query(
        `SELECT id, map_name, team1_score, team2_score FROM map_stats WHERE match_id = ? ORDER BY map_number ASC`,
        [matchId]
      ) as MapStatRow[];
    } else {
      allMaps = []; // per-map mode: map name only, no scores
    }

    // For "latest" and "byNumber", filter player stats to that specific map
    // For "full", aggregate across all maps
    const filterByMap = mode !== "full" && mapStatsId !== null;
    const playerFilter = filterByMap ? "AND map_id = ?" : "";
    const playerArgs   = filterByMap ? [matchId, mapStatsId] : [matchId];
    const players = await db.query(
      `SELECT steam_id, name, team_id,
         SUM(kills) AS kills, SUM(deaths) AS deaths, SUM(assists) AS assists,
         SUM(roundsplayed) AS roundsplayed,
         SUM(k1) AS k1, SUM(k2) AS k2, SUM(k3) AS k3, SUM(k4) AS k4, SUM(k5) AS k5
       FROM player_stats
       WHERE match_id = ? ${playerFilter}
       GROUP BY steam_id, team_id
       ORDER BY team_id, kills DESC`,
      playerArgs
    ) as PlayerStatRow[];

    const png = await generateMatchImage(match, mapRow, allMaps, players, loadSettings());
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.send(png);
  } catch (err) {
    console.error("[image] Error:", err);
    res.status(500).json({ error: "Failed to generate image" });
  }
}

// ─── MVP image routes ─────────────────────────────────────────────────────────

/** GET /image/match/:match_id/mvp — image MVP du match complet (stats agrégées toutes maps) */
router.get("/match/:match_id/mvp", async (req: Request, res: Response) => {
  await renderFullMatchMvpImage(req, res);
});

/** GET /image/match/:match_id/map/:map_number/mvp — image MVP de la map */
router.get("/match/:match_id/map/:map_number/mvp", async (req: Request, res: Response) => {
  await renderMvpImage(req, res);
});

async function renderFullMatchMvpImage(req: Request, res: Response) {
  try {
    const matchId = parseInt(req.params.match_id);
    if (isNaN(matchId)) { res.status(400).json({ error: "Invalid match ID" }); return; }

    const [match, allMaps, plannedMaps] = await Promise.all([
      fetchMatchRow(matchId),
      fetchAllMaps(matchId),
      fetchVetoPicks(matchId),
    ]);
    if (!match) { res.status(404).json({ error: "Match not found" }); return; }
    if (!allMaps?.length) { res.status(404).json({ error: "No maps found for this match" }); return; }

    const t1Score = allMaps.filter(r => r.team1_score > r.team2_score).length;
    const t2Score = allMaps.filter(r => r.team2_score > r.team1_score).length;
    const syntheticMap: MapStatRow = { id: 0, map_name: "match", team1_score: t1Score, team2_score: t2Score } as MapStatRow;

    const players = await db.query(
      `SELECT steam_id, name, team_id,
         SUM(kills) AS kills, SUM(deaths) AS deaths, SUM(assists) AS assists,
         SUM(roundsplayed) AS roundsplayed, SUM(headshot_kills) AS headshot_kills,
         SUM(k1) AS k1, SUM(k2) AS k2, SUM(k3) AS k3, SUM(k4) AS k4, SUM(k5) AS k5,
         SUM(v1) AS v1, SUM(v2) AS v2, SUM(v3) AS v3, SUM(v4) AS v4, SUM(v5) AS v5
       FROM player_stats WHERE match_id = ? GROUP BY steam_id, team_id`,
      [matchId]
    ) as PlayerStatExtended[];
    if (!players?.length) { res.status(404).json({ error: "No player stats found for this match" }); return; }

    const mvpPlayer = computeMvpPlayer(players);
    const base = loadSettings();
    // Don't mutate the loaded settings object — build a derived copy
    const settings = { ...base, mvp: { ...base.mvp, map_image: { enabled: false } } };

    // Full match MVP: no single "current" map to highlight
    const png = await generateMapMvpImage(match, syntheticMap, mvpPlayer, settings, allMaps, plannedMaps, -1);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.send(png);
  } catch (err) {
    console.error("[image/mvp-match] Error:", err);
    res.status(500).json({ error: "Failed to generate full match MVP image" });
  }
}

async function renderMvpImage(req: Request, res: Response) {
  try {
    const matchId   = parseInt(req.params.match_id);
    const mapNumber = parseInt(req.params.map_number);
    if (isNaN(matchId))                  { res.status(400).json({ error: "Invalid match ID" }); return; }
    if (isNaN(mapNumber) || mapNumber < 1) { res.status(400).json({ error: "Invalid map number" }); return; }

    const [match, allMaps, plannedMaps] = await Promise.all([
      fetchMatchRow(matchId),
      fetchAllMaps(matchId),
      fetchVetoPicks(matchId),
    ]);
    if (!match) { res.status(404).json({ error: "Match not found" }); return; }

    // map_number is 1-indexed from the user; DB stores 0-indexed
    const mapRow = allMaps[mapNumber - 1] ?? null;
    if (!mapRow) { res.status(404).json({ error: `Map ${mapNumber} not found for this match` }); return; }

    const players = await db.query(
      `SELECT steam_id, name, team_id,
         SUM(kills) AS kills, SUM(deaths) AS deaths, SUM(assists) AS assists,
         SUM(roundsplayed) AS roundsplayed, SUM(headshot_kills) AS headshot_kills,
         SUM(k1) AS k1, SUM(k2) AS k2, SUM(k3) AS k3, SUM(k4) AS k4, SUM(k5) AS k5,
         SUM(v1) AS v1, SUM(v2) AS v2, SUM(v3) AS v3, SUM(v4) AS v4, SUM(v5) AS v5
       FROM player_stats WHERE match_id = ? AND map_id = ? GROUP BY steam_id, team_id`,
      [matchId, mapRow.id]
    ) as PlayerStatExtended[];
    if (!players?.length) { res.status(404).json({ error: "No player stats found for this map" }); return; }

    // BO1: single map goes in center slot (index 1); BO3+: slot = mapNumber - 1
    const totalMaps = plannedMaps.length || allMaps.length;
    const currentSlotIndex = totalMaps === 1 ? 1 : mapNumber - 1;

    const mvpPlayer = computeMvpPlayer(players);
    const png = await generateMapMvpImage(match, mapRow, mvpPlayer, loadSettings(), allMaps, plannedMaps, currentSlotIndex);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.send(png);
  } catch (err) {
    console.error("[image/mvp] Error:", err);
    res.status(500).json({ error: "Failed to generate MVP image" });
  }
}

// ─── Player image routes ──────────────────────────────────────────────────────

/** GET /image/match/:match_id/player/:steam_id — stats joueur sur tout le match */
router.get("/match/:match_id/player/:steam_id", async (req: Request, res: Response) => {
  await renderPlayerImage(req, res, null);
});

/** GET /image/match/:match_id/map/:map_number/player/:steam_id — stats joueur sur une map (par numéro 1, 2, 3...) */
router.get("/match/:match_id/map/:map_number/player/:steam_id", async (req: Request, res: Response) => {
  const mapNumber = parseInt(req.params.map_number);
  if (isNaN(mapNumber) || mapNumber < 1) { res.status(400).json({ error: "Invalid map number" }); return; }
  await renderPlayerImage(req, res, mapNumber);
});

async function renderPlayerImage(req: Request, res: Response, mapNumber: number | null) {
  try {
    const matchId = parseInt(req.params.match_id);
    const steamId = req.params.steam_id;
    if (isNaN(matchId)) { res.status(400).json({ error: "Invalid match ID" }); return; }

    const match = await fetchMatchRow(matchId);
    if (!match) { res.status(404).json({ error: "Match not found" }); return; }

    // Resolve map_number (1-indexed) to map_stats.id
    let mapId: number | null = null;
    if (mapNumber !== null) {
      const allMaps = await fetchAllMaps(matchId);
      const mapRow = allMaps[mapNumber - 1] ?? null;
      if (!mapRow) { res.status(404).json({ error: `Map ${mapNumber} not found for this match` }); return; }
      mapId = mapRow.id;
    }

    const mapFilter = mapId !== null ? "AND map_id = ?" : "";
    const queryArgs = mapId !== null ? [matchId, steamId, mapId] : [matchId, steamId];
    const players = await db.query(
      `SELECT steam_id, name, team_id,
         SUM(kills) AS kills, SUM(deaths) AS deaths, SUM(assists) AS assists,
         SUM(roundsplayed) AS roundsplayed, SUM(headshot_kills) AS headshot_kills,
         SUM(k1) AS k1, SUM(k2) AS k2, SUM(k3) AS k3, SUM(k4) AS k4, SUM(k5) AS k5,
         SUM(v1) AS v1, SUM(v2) AS v2, SUM(v3) AS v3, SUM(v4) AS v4, SUM(v5) AS v5
       FROM player_stats
       WHERE match_id = ? AND steam_id = ? ${mapFilter}
       GROUP BY steam_id, team_id`,
      queryArgs
    ) as PlayerStatExtended[];
    if (!players?.length) { res.status(404).json({ error: "Player not found in this match" }); return; }

    const player    = players[0];
    const isTeam1   = player.team_id === match.team1_id;
    const team1Name = match.team1_string || match.team1_name || "Team 1";
    const team2Name = match.team2_string || match.team2_name || "Team 2";
    const myTeam    = isTeam1 ? team1Name : team2Name;
    const opp       = isTeam1 ? team2Name : team1Name;

    const png = await generatePlayerImage(myTeam, opp, player, loadSettings());
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.send(png);
  } catch (err) {
    console.error("[image/player] Error:", err);
    res.status(500).json({ error: "Failed to generate player image" });
  }
}

// ─── Team season image route ──────────────────────────────────────────────────

/** GET /image/season/:season_id/team/:team_id */
router.get("/season/:season_id/team/:team_id", async (req: Request, res: Response) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const teamId   = parseInt(req.params.team_id);
    if (isNaN(seasonId) || isNaN(teamId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const teamRows = await db.query(`SELECT name FROM team WHERE id = ?`, [teamId]) as TeamNameRow[];
    if (!teamRows?.length) { res.status(404).json({ error: "Team not found" }); return; }

    const players = await db.query(
      `SELECT ps.steam_id, ps.name, ps.team_id,
         SUM(ps.kills) AS kills, SUM(ps.deaths) AS deaths, SUM(ps.assists) AS assists,
         SUM(ps.roundsplayed) AS roundsplayed, SUM(ps.headshot_kills) AS headshot_kills,
         SUM(ps.k1) AS k1, SUM(ps.k2) AS k2, SUM(ps.k3) AS k3, SUM(ps.k4) AS k4, SUM(ps.k5) AS k5,
         SUM(ps.v1) AS v1, SUM(ps.v2) AS v2, SUM(ps.v3) AS v3, SUM(ps.v4) AS v4, SUM(ps.v5) AS v5
       FROM player_stats ps
       JOIN \`match\` m ON m.id = ps.match_id
       WHERE m.season_id = ? AND ps.team_id = ?
       GROUP BY ps.steam_id
       ORDER BY SUM(ps.kills) DESC
       LIMIT 5`,
      [seasonId, teamId]
    ) as PlayerStatExtended[];

    const teamStatsRows = await db.query(
      `SELECT
         SUM(ps.kills)        AS kills,
         SUM(ps.deaths)       AS deaths,
         SUM(ps.bomb_plants)  AS plants,
         SUM(ps.bomb_defuses) AS defuses,
         SUM(ps.roundsplayed) AS roundsplayed,
         SUM(ps.k1) AS k1, SUM(ps.k2) AS k2, SUM(ps.k3) AS k3, SUM(ps.k4) AS k4, SUM(ps.k5) AS k5
       FROM player_stats ps
       JOIN \`match\` m ON m.id = ps.match_id
       WHERE m.season_id = ? AND ps.team_id = ?`,
      [seasonId, teamId]
    ) as TeamSeasonRow[];

    const roundsRows = await db.query(
      `SELECT
         SUM(CASE WHEN m.team1_id = ? THEN ms.team1_score ELSE ms.team2_score END) AS rounds_won,
         SUM(CASE WHEN m.team1_id = ? THEN ms.team2_score ELSE ms.team1_score END) AS rounds_lost
       FROM map_stats ms
       JOIN \`match\` m ON m.id = ms.match_id
       WHERE m.season_id = ? AND (m.team1_id = ? OR m.team2_id = ?)`,
      [teamId, teamId, seasonId, teamId, teamId]
    ) as RoundsRow[];

    const winsRows = await db.query(
      `SELECT
         SUM(CASE WHEN ms.winner = ? THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN ms.winner != ? AND ms.winner IS NOT NULL THEN 1 ELSE 0 END) AS losses
       FROM map_stats ms
       JOIN \`match\` m ON m.id = ms.match_id
       WHERE m.season_id = ? AND (m.team1_id = ? OR m.team2_id = ?)
         AND m.cancelled = 0 AND ms.winner IS NOT NULL`,
      [teamId, teamId, seasonId, teamId, teamId]
    ) as WinsRow[];

    const bestMapRows = await db.query(
      `SELECT ms.map_name, COUNT(*) AS wins
       FROM map_stats ms
       JOIN \`match\` m ON m.id = ms.match_id
       WHERE m.season_id = ? AND (m.team1_id = ? OR m.team2_id = ?)
         AND m.cancelled = 0 AND ms.winner = ?
       GROUP BY ms.map_name
       ORDER BY wins DESC
       LIMIT 1`,
      [seasonId, teamId, teamId, teamId]
    ) as BestMapRow[];
    const bestMap = bestMapRows?.[0]?.map_name ?? null;

    const png = await generateTeamSeasonImage(
      teamRows[0].name,
      players,
      teamStatsRows[0] ?? { kills: 0, deaths: 0, plants: 0, defuses: 0, roundsplayed: 0, k1:0, k2:0, k3:0, k4:0, k5:0 } as TeamSeasonRow,
      roundsRows[0]    ?? { rounds_won: 0, rounds_lost: 0 } as RoundsRow,
      winsRows[0]      ?? { wins: 0, losses: 0 } as WinsRow,
      bestMap,
      loadSettings()
    );
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.send(png);
  } catch (err) {
    console.error("[image/team-season] Error:", err);
    res.status(500).json({ error: "Failed to generate team season image" });
  }
});

export default router;
