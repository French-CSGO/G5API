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
import { generateMatchImage } from "./generators/match.js";
import { generatePlayerImage } from "./generators/player.js";
import { generateTeamSeasonImage } from "./generators/teamSeason.js";
import type { ImageSettings } from "./types.js";
import type {
  MatchRow, MapStatRow, PlayerStatRow,
  PlayerStatExtended, TeamSeasonRow, RoundsRow, WinsRow,
  TeamNameRow, BestMapRow,
} from "./types.js";

const router = Router();

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

/** GET /image/match/:match_id */
router.get("/match/:match_id", async (req: Request, res: Response) => {
  await renderMatchImage(req, res, null);
});

/** GET /image/match/:match_id/map/:map_id */
router.get("/match/:match_id/map/:map_id", async (req: Request, res: Response) => {
  await renderMatchImage(req, res, parseInt(req.params.map_id));
});

async function renderMatchImage(req: Request, res: Response, mapId: number | null) {
  try {
    const matchId = parseInt(req.params.match_id);
    if (isNaN(matchId)) { res.status(400).json({ error: "Invalid match ID" }); return; }

    const matchRows = await db.query(
      `SELECT m.team1_id, m.team2_id, m.team1_string, m.team2_string,
              t1.name AS team1_name, t2.name AS team2_name
       FROM \`match\` m
       LEFT JOIN team t1 ON t1.id = m.team1_id
       LEFT JOIN team t2 ON t2.id = m.team2_id
       WHERE m.id = ?`,
      [matchId]
    ) as MatchRow[];
    if (!matchRows?.length) { res.status(404).json({ error: "Match not found" }); return; }

    let mapRow: MapStatRow | null = null;
    if (mapId !== null) {
      const rows = await db.query(
        `SELECT id, map_name, team1_score, team2_score FROM map_stats WHERE id = ? AND match_id = ? LIMIT 1`,
        [mapId, matchId]
      ) as MapStatRow[];
      mapRow = rows?.[0] ?? null;
    } else {
      const rows = await db.query(
        `SELECT id, map_name, team1_score, team2_score FROM map_stats WHERE match_id = ? ORDER BY id DESC LIMIT 1`,
        [matchId]
      ) as MapStatRow[];
      mapRow = rows?.[0] ?? null;
    }

    const playerFilter = mapId !== null ? "AND map_id = ?" : "";
    const playerArgs   = mapId !== null ? [matchId, mapId] : [matchId];
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

    const png = await generateMatchImage(matchRows[0], mapRow, players, loadSettings());
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.send(png);
  } catch (err) {
    console.error("[image] Error:", err);
    res.status(500).json({ error: "Failed to generate image" });
  }
}

// ─── Player image routes ──────────────────────────────────────────────────────

/** GET /image/match/:match_id/player/:steam_id — stats joueur sur tout le match */
router.get("/match/:match_id/player/:steam_id", async (req: Request, res: Response) => {
  await renderPlayerImage(req, res, null);
});

/** GET /image/match/:match_id/map/:map_id/player/:steam_id — stats joueur sur une map */
router.get("/match/:match_id/map/:map_id/player/:steam_id", async (req: Request, res: Response) => {
  await renderPlayerImage(req, res, parseInt(req.params.map_id));
});

async function renderPlayerImage(req: Request, res: Response, mapId: number | null) {
  try {
    const matchId = parseInt(req.params.match_id);
    const steamId = req.params.steam_id;
    if (isNaN(matchId)) { res.status(400).json({ error: "Invalid match ID" }); return; }

    const matchRows = await db.query(
      `SELECT m.team1_id, m.team2_id, m.team1_string, m.team2_string,
              t1.name AS team1_name, t2.name AS team2_name
       FROM \`match\` m
       LEFT JOIN team t1 ON t1.id = m.team1_id
       LEFT JOIN team t2 ON t2.id = m.team2_id
       WHERE m.id = ?`,
      [matchId]
    ) as MatchRow[];
    if (!matchRows?.length) { res.status(404).json({ error: "Match not found" }); return; }

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

    const match     = matchRows[0];
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
