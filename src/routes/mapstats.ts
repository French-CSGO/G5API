/**
 * @swagger
 * resourcePath: /mapstats
 * description: Express API router for mapstats in get5.
 */
import { Router } from "express";
const router = Router();

import {db} from "../services/db.js";

import Utils from "../utility/utils.js";

import GlobalEmitter from "../utility/emitter.js";
import { RowDataPacket } from "mysql2";
import { MapStats } from "../types/mapstats/MapStats.js";
import { AccessMessage } from "../types/mapstats/AccessMessage.js";

/**
 * @swagger
 *
 * components:
 *   schemas:
 *     MapStatsData:
 *       type: object
 *       required:
 *          - map_stats_id
 *          - match_id
 *          - map_number
 *          - start_time
 *       properties:
 *         map_stats_id:
 *           type: integer
 *           description: The unique identifier of map stats for a match.
 *         match_id:
 *           type: integer
 *           description: Foreign key ID that links back to the match.
 *         winner:
 *           type: integer
 *           description: Foreign key ID to the team that won.
 *         map_number:
 *           type: integer
 *           description: The current map number in a best-of series.
 *         team1_score:
 *           type: integer
 *           description: The score from team 1.
 *         team2_score:
 *           type: integer
 *           description: The score from team 2.
 *         start_time:
 *           type: string
 *           format: date-time
 *           description: Start time of a match in date time format.
 *         end_time:
 *           type: string
 *           format: date-time
 *           description: End time of a match in date time format.
 *         demoFile:
 *           type: string
 *           description: The URL pointing to the demo uploaded.
 *
 *   responses:
 *     MatchAlreadyFinished:
 *       description: Match already finished.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SimpleResponse'
 *     NoMapStatData:
 *       description: Map Stat Data was not provided.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SimpleResponse'
 */

/**
 * @swagger
 *
 * /mapstats/:
 *   get:
 *     description: Stats for all maps in all matches.
 *     produces:
 *       - application/json
 *     tags:
 *       - mapstats
 *     responses:
 *       200:
 *         description: Stats for all maps in all matches.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mapstats:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MapStatsData'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/", async (req, res, next) => {
  try {
    let sql: string = "SELECT * FROM map_stats";
    let mapstats: RowDataPacket[] = await db.query(sql);
    if (!mapstats.length) {
      res.status(404).json({ message: "No stats found." });
      return;
    }
    res.json({ mapstats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /mapstats/:match_id:
 *   get:
 *     description: Set of map stats from a match
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: match_id
 *         required: true
 *         schema:
 *          type: integer
 *     tags:
 *       - mapstats
 *     responses:
 *       200:
 *         description: Stats for all maps in all matches.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mapstats:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MapStatsData'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/:match_id", async (req, res, next) => {
  try {
    let matchID: string = req.params.match_id;
    let sql: string = "SELECT * FROM map_stats where match_id = ?";
    let mapstats: RowDataPacket[] = await db.query(sql, [matchID]);
    if (!mapstats.length) {
      res.status(404).json({ message: "No stats found." });
      return;
    }
    res.json({ mapstats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /mapstats/:match_id/stream:
 *   get:
 *     description: Set of map stats from a match provided as an event-stream for real time updates.
 *     produces:
 *       - text/event-stream
 *     parameters:
 *       - name: match_id
 *         required: true
 *         schema:
 *          type: integer
 *     tags:
 *       - mapstats
 *     responses:
 *       200:
 *         description: Stats for all maps in all matches.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 mapstat:
 *                   $ref: '#/components/schemas/MapStatsData'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
 router.get("/:match_id/stream", async (req, res, next) => {
  try {
    let matchID: string = req.params.match_id;
    let sql: string = "SELECT * FROM map_stats where match_id = ?";
    let mapstats: RowDataPacket[] = await db.query(sql, [matchID]);
    
    res.set({
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no"
    });
    res.flushHeaders();
    mapstats = mapstats.map(v => Object.assign({}, v));
    let mapStatString: string = `event: mapstats\ndata: ${JSON.stringify(mapstats)}\n\n`
    
    // Need to name the function in order to remove it!
    const mapStatStreamStats: (() => Promise<void>) = async () => {
      mapstats = await db.query(sql, [matchID]);
      mapstats = mapstats.map(v => Object.assign({}, v));
      mapStatString = `event: mapstats\ndata: ${JSON.stringify(mapstats)}\n\n`
      res.write(mapStatString);
    };

    GlobalEmitter.on("mapStatUpdate", mapStatStreamStats);

    res.write(mapStatString);
    req.on("close", () => {
      GlobalEmitter.removeListener("mapStatUpdate", mapStatStreamStats);
      res.end();
    });
    req.on("disconnect", () => {
      GlobalEmitter.removeListener("mapStatUpdate", mapStatStreamStats);
      res.end();
    });

  } catch (err) {
    console.error((err as Error).toString());
    res.status(500).write(`event: error\ndata: ${(err as Error).toString()}\n\n`)
    res.end();
  }
});

/**
 * @swagger
 *
 * /mapstats/:match_id/:map_number/stream:
 *   get:
 *     description: Map statistics for a given match and map number provided as a text/event-stream for real time data info.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: match_id
 *         required: true
 *         schema:
 *          type: integer
 *       - name: map_number
 *         required: true
 *         schema:
 *          type: integer
 *     tags:
 *       - mapstats
 *     responses:
 *       200:
 *         description: Stats for a single given map in a match.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/MapStatsData'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/:match_id/:map_number/stream", async (req, res, next) => {
  try {
    let matchID: string = req.params.match_id;
    let mapID: number = parseInt(req.params.map_number);
    let sql: string = "SELECT * FROM map_stats where match_id = ? AND map_number = ?";
    let mapstats: RowDataPacket[] = await db.query(sql, [matchID, mapID]);
    
    res.set({
      "Cache-Control": "no-cache",
      "Content-Type": "text/event-stream"
    });
    res.flushHeaders();
    mapstats = mapstats.map(v => Object.assign({}, v));
    let mapStatString: string = `event: mapstats\ndata: ${JSON.stringify(mapstats[0])}\n\n`
    
    // Need to name the function in order to remove it!
    const mapStatStreamStats: (() => Promise<void>) = async () => {
      mapstats = await db.query(sql, [matchID]);
      mapstats = mapstats.map(v => Object.assign({}, v));
      mapStatString = `event: mapstats\ndata: ${JSON.stringify(mapstats)}\n\n`
      res.write(mapStatString);
    };

    GlobalEmitter.on("mapStatUpdate", mapStatStreamStats);

    res.write(mapStatString);
    req.on("close", () => {
      GlobalEmitter.removeListener("mapStatUpdate", mapStatStreamStats);
      res.end();
    });
    req.on("disconnect", () => {
      GlobalEmitter.removeListener("mapStatUpdate", mapStatStreamStats);
      res.end();
    });
  } catch (err) {
    console.error((err as Error).toString());
    res.status(500).write(`event: error\ndata: ${(err as Error).toString()}\n\n`)
    res.end();
  }
});

/**
 * @swagger
 *
 * /mapstats/:match_id/:map_number:
 *   get:
 *     description: Map statistics for a given match and map number.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: match_id
 *         required: true
 *         schema:
 *          type: integer
 *       - name: map_number
 *         required: true
 *         schema:
 *          type: integer
 *     tags:
 *       - mapstats
 *     responses:
 *       200:
 *         description: Stats for a single given map in a match.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/MapStatsData'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
 router.get("/:match_id/:map_number", async (req, res, next) => {
  try {
    let matchID: string = req.params.match_id;
    let mapID: number = parseInt(req.params.map_number);
    let sql: string = "SELECT * FROM map_stats where match_id = ? AND map_number = ?";
    const mapstats = await db.query(sql, [matchID, mapID]);
    if (!mapstats.length) {
      res.status(404).json({ message: "No stats found." });
      return;
    }
    const mapstat = JSON.parse(JSON.stringify(mapstats[0]));
    res.json({ mapstat });
  } catch (err) {
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /mapstats:
 *   post:
 *     description: Add map stats for a match
 *     produces:
 *       - application/json
 *     requestBody:
 *      required: true
 *      content:
 *        application/json:
 *          schema:
 *            type: array
 *            items:
 *              $ref: '#/components/schemas/MapStatsData'
 *     tags:
 *       - mapstats
 *     responses:
 *       200:
 *         description: Map stats inserted successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimpleResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       403:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       422:
 *         $ref: '#/components/responses/MatchAlreadyFinished'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.post("/", Utils.ensureAuthenticated, async (req, res, next) => {
  try {
    let errMessage: AccessMessage | null = await Utils.getUserMatchAccess(
      req.body[0].match_id,
      req.user!,
      false
    );
    if (errMessage != null) {
      res.status(errMessage.status).json({ message: errMessage.message });
      return;
    } else {
      let mapStatSet: MapStats = {
        match_id: req.body[0].match_id,
        map_number: req.body[0].map_number,
        map_name: req.body[0].map_name,
        start_time: req.body[0].start_time,
      };
      let sql: string = "INSERT INTO map_stats SET ?";
      let insertedStats: RowDataPacket[] = await db.query(sql, [mapStatSet]);
      GlobalEmitter.emit("mapStatUpdate");
      res.json({
        message: "Map stats inserted successfully!",
        //@ts-ignore
        id: insertedStats.insertId,
      });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /mapstats:
 *   put:
 *     description: Update a map stats object when it is completed
 *     produces:
 *       - application/json
 *     requestBody:
 *      required: true
 *      content:
 *        application/json:
 *          schema:
 *            type: array
 *            items:
 *              $ref: '#/components/schemas/MapStatsData'
 *     tags:
 *       - mapstats
 *     responses:
 *       200:
 *         description: Map stats updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimpleResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       403:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       412:
 *         $ref: '#/components/responses/NoMapStatData'
 *       422:
 *         $ref: '#/components/responses/MatchAlreadyFinished'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.put("/", Utils.ensureAuthenticated, async (req, res, next) => {
  try {
    if (req.body[0].map_stats_id == null) {
      res.status(412).json({ message: "Map stat ID Not Provided" });
      return;
    }
    let currentMatchInfo: string = "SELECT match_id FROM map_stats WHERE id = ?";
    const matchRow: RowDataPacket[] = await db.query(currentMatchInfo, req.body[0].map_stats_id);
    let errMessage: AccessMessage | null = await Utils.getUserMatchAccess(
      matchRow[0].match_id,
      req.user!,
      false
    );
    if (errMessage != null) {
      res.status(errMessage.status).json({ message: errMessage.message });
      return;
    } else {
      let mapStatId = req.body[0].map_stats_id;
      let updatedValues: MapStats = {
        end_time: req.body[0].end_time,
        team1_score: req.body[0].team1_score,
        team2_score: req.body[0].team2_score,
        winner: req.body[0].winner,
        demoFile: req.body[0].demo_file,
        map_name: req.body[0].map_name,
      };
      updatedValues = await db.buildUpdateStatement(updatedValues) as MapStats;
      if (!Object.keys(updatedValues)) {
        res
          .status(412)
          .json({ message: "No update data has been provided." });
        return;
      }
      let sql: string = "UPDATE map_stats SET ? WHERE id = ?";
      const updateMapStats: RowDataPacket[] = await db.query(sql, [updatedValues, mapStatId]);
      //@ts-ignore
      if (updateMapStats.affectedRows > 0) {
        GlobalEmitter.emit("mapStatUpdate");
        res.json({ message: "Map Stats updated successfully!" });
      }
      else
        res
          .status(401)
          .json({ message: "ERROR - Maps Stats not updated or found." });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /mapstats:
 *   delete:
 *     description: Delete a map stats object
 *     produces:
 *       - application/json
 *     requestBody:
 *      required: true
 *      content:
 *        application/json:
 *          schema:
 *            type: array
 *            items:
 *              type: object
 *              properties:
 *                map_stats_id:
 *                  type: integer
 *     tags:
 *       - mapstats
 *     responses:
 *       200:
 *         description: Mapstat deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimpleResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       403:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       412:
 *         $ref: '#/components/responses/NoMapStatData'
 *       422:
 *         $ref: '#/components/responses/MatchAlreadyFinished'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.delete("/", Utils.ensureAuthenticated, async (req, res, next) => {
  try {
    if (req.body[0].map_stats_id == null) {
      res.status(412).json({ message: "Map Stats ID Not Provided" });
      return;
    }
    let currentMatchInfo: string = "SELECT match_id FROM map_stats WHERE id = ?";
    const matchRow: RowDataPacket[] = await db.query(currentMatchInfo, [req.body[0].map_stats_id]);
    let errMessage: AccessMessage | null = await Utils.getUserMatchAccess(
      matchRow[0].match_id,
      req.user!,
      false
    );
    if (errMessage != null) {
      res.status(errMessage.status).json({ message: errMessage.message });
      return;
    } else {
      let mapStatsId: number = parseInt(req.body[0].map_stats_id);
      let deleteSql: string = "DELETE FROM map_stats WHERE id = ?";
      const delRows: RowDataPacket[] = await db.query(deleteSql, [mapStatsId]);
      //@ts-ignore
      if (delRows.affectedRows > 0) {
        GlobalEmitter.emit("mapStatUpdate");
        res.json({ message: "Map Stats deleted successfully!" });
      }
        
      else
        res
          .status(400)
          .json({ message: "ERR - Unauthorized to delete OR not found." });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err });
  }
});

/**
 * @swagger
 *
 * /mapstats/:match_id/:map_number/overtime:
 *   get:
 *     description: OT breakdown for a specific map in a match.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: match_id
 *         required: true
 *         schema:
 *           type: integer
 *       - name: map_number
 *         required: true
 *         schema:
 *           type: integer
 *     tags:
 *       - mapstats
 *     responses:
 *       200:
 *         description: List of OT rows ordered by ot_number.
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/:match_id/:map_number/overtime", async (req, res) => {
  try {
    const { match_id, map_number } = req.params;
    const mapStatRows: RowDataPacket[] = await db.query(
      "SELECT id FROM map_stats WHERE match_id = ? AND map_number = ?",
      [match_id, map_number]
    );
    if (!mapStatRows.length) {
      res.status(404).json({ message: "No map stats found." });
      return;
    }
    const overtime: RowDataPacket[] = await db.query(
      "SELECT * FROM map_stats_ot WHERE map_stats_id = ? ORDER BY ot_number ASC",
      [mapStatRows[0].id]
    );
    res.json({ overtime });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/** GET /mapstats/:match_id/mvp — Best player (by HLTV rating) for the entire match */
router.get("/:match_id/mvp", async (req, res) => {
  try {
    const matchId = parseInt(req.params.match_id);
    if (isNaN(matchId)) {
      res.status(400).json({ message: "Invalid match_id" });
      return;
    }

    const matchRows: RowDataPacket[] = await db.query(
      `SELECT m.team1_id, m.team2_id, m.team1_string, m.team2_string,
              t1.name AS team1_name, t1.logo AS team1_logo,
              t2.name AS team2_name, t2.logo AS team2_logo
       FROM \`match\` m
       LEFT JOIN team t1 ON t1.id = m.team1_id
       LEFT JOIN team t2 ON t2.id = m.team2_id
       WHERE m.id = ?`,
      [matchId]
    );

    if (!matchRows.length) {
      res.status(404).json({ message: "Match not found" });
      return;
    }

    const players: RowDataPacket[] = await db.query(
      `SELECT ps.steam_id, ps.name, ps.team_id,
         SUM(ps.kills) AS kills, SUM(ps.deaths) AS deaths, SUM(ps.assists) AS assists,
         SUM(ps.roundsplayed) AS roundsplayed, SUM(ps.headshot_kills) AS headshot_kills,
         SUM(ps.damage) AS damage,
         SUM(ps.k1) AS k1, SUM(ps.k2) AS k2, SUM(ps.k3) AS k3, SUM(ps.k4) AS k4, SUM(ps.k5) AS k5,
         SUM(ps.v1) AS v1, SUM(ps.v2) AS v2, SUM(ps.v3) AS v3, SUM(ps.v4) AS v4, SUM(ps.v5) AS v5,
         SUM(ps.kast) AS kast, SUM(ps.contribution_score) AS contribution_score, SUM(ps.mvp) AS mvp
       FROM player_stats ps
       WHERE ps.match_id = ?
       GROUP BY ps.steam_id, ps.team_id`,
      [matchId]
    );

    if (!players.length) {
      res.status(404).json({ message: "No player stats found" });
      return;
    }

    const mvp = findMvpPlayer(players);
    if (!mvp) {
      res.status(404).json({ message: "No MVP found" });
      return;
    }

    res.json(buildMvpResponse(mvp, matchRows[0], null, null));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/** GET /mapstats/:match_id/:map_number/mvp — Best player for a specific map (map_number is 0-indexed in DB) */
router.get("/:match_id/:map_number/mvp", async (req, res) => {
  try {
    const matchId = parseInt(req.params.match_id);
    const mapNumber = parseInt(req.params.map_number);

    if (isNaN(matchId) || isNaN(mapNumber)) {
      res.status(400).json({ message: "Invalid match_id or map_number" });
      return;
    }

    const mapStatRows: RowDataPacket[] = await db.query(
      "SELECT id, map_name, team1_score, team2_score FROM map_stats WHERE match_id = ? AND map_number = ? LIMIT 1",
      [matchId, mapNumber]
    );

    if (!mapStatRows.length) {
      res.status(404).json({ message: "Map stats not found" });
      return;
    }

    const mapStat = mapStatRows[0];

    const players: RowDataPacket[] = await db.query(
      `SELECT ps.steam_id, ps.name, ps.team_id,
         SUM(ps.kills) AS kills, SUM(ps.deaths) AS deaths, SUM(ps.assists) AS assists,
         SUM(ps.roundsplayed) AS roundsplayed, SUM(ps.headshot_kills) AS headshot_kills,
         SUM(ps.damage) AS damage,
         SUM(ps.k1) AS k1, SUM(ps.k2) AS k2, SUM(ps.k3) AS k3, SUM(ps.k4) AS k4, SUM(ps.k5) AS k5,
         SUM(ps.v1) AS v1, SUM(ps.v2) AS v2, SUM(ps.v3) AS v3, SUM(ps.v4) AS v4, SUM(ps.v5) AS v5,
         SUM(ps.kast) AS kast, SUM(ps.contribution_score) AS contribution_score, SUM(ps.mvp) AS mvp
       FROM player_stats ps
       WHERE ps.match_id = ? AND ps.map_id = ?
       GROUP BY ps.steam_id, ps.team_id`,
      [matchId, mapStat.id]
    );

    if (!players.length) {
      res.status(404).json({ message: "No player stats found for this map" });
      return;
    }

    const mvp = findMvpPlayer(players);
    if (!mvp) {
      res.status(404).json({ message: "No MVP found" });
      return;
    }

    const matchRows: RowDataPacket[] = await db.query(
      `SELECT m.team1_id, m.team2_id, m.team1_string, m.team2_string,
              t1.name AS team1_name, t1.logo AS team1_logo,
              t2.name AS team2_name, t2.logo AS team2_logo
       FROM \`match\` m
       LEFT JOIN team t1 ON t1.id = m.team1_id
       LEFT JOIN team t2 ON t2.id = m.team2_id
       WHERE m.id = ?`,
      [matchId]
    );

    if (!matchRows.length) {
      res.status(404).json({ message: "Match not found" });
      return;
    }

    res.json(buildMvpResponse(mvp, matchRows[0], mapStat.map_name, {
      team1_score: mapStat.team1_score,
      team2_score: mapStat.team2_score
    }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

function findMvpPlayer(players: RowDataPacket[]): (RowDataPacket & { rating: number }) | null {
  let mvpPlayer: (RowDataPacket & { rating: number }) | null = null;
  let maxRating = -1;

  for (const player of players) {
    const rp = parseFloat(player.roundsplayed as string) || 0;
    if (rp > 0) {
      const rating = Utils.getRating(
        parseFloat(player.kills as string) || 0,
        rp,
        parseFloat(player.deaths as string) || 0,
        parseFloat(player.k1 as string) || 0,
        parseFloat(player.k2 as string) || 0,
        parseFloat(player.k3 as string) || 0,
        parseFloat(player.k4 as string) || 0,
        parseFloat(player.k5 as string) || 0
      );
      if (rating > maxRating) {
        maxRating = rating;
        mvpPlayer = { ...player, rating };
      }
    }
  }

  return mvpPlayer;
}

function buildMvpResponse(
  mvp: RowDataPacket & { rating: number },
  match: RowDataPacket,
  mapName: string | null,
  scores: { team1_score: number; team2_score: number } | null
) {
  const kills = parseFloat(mvp.kills as string) || 0;
  const deaths = parseFloat(mvp.deaths as string) || 0;
  const assists = parseFloat(mvp.assists as string) || 0;
  const roundsPlayed = parseFloat(mvp.roundsplayed as string) || 0;
  const headshots = parseFloat(mvp.headshot_kills as string) || 0;
  const damage = parseFloat(mvp.damage as string) || 0;

  const isTeam1 = mvp.team_id === match.team1_id;
  const teamName = isTeam1
    ? (match.team1_string || match.team1_name || "Team 1")
    : (match.team2_string || match.team2_name || "Team 2");
  const teamLogo = isTeam1 ? match.team1_logo : match.team2_logo;

  return {
    mvp: {
      steam_id: mvp.steam_id,
      name: mvp.name,
      team_id: mvp.team_id,
      team_name: teamName,
      team_logo: teamLogo,
      map_name: mapName,
      team1_score: scores?.team1_score ?? null,
      team2_score: scores?.team2_score ?? null,
      rating: mvp.rating,
      kills,
      deaths,
      assists,
      roundsplayed: roundsPlayed,
      headshot_kills: headshots,
      hsp: kills > 0 ? parseFloat(((headshots / kills) * 100).toFixed(1)) : 0,
      adr: roundsPlayed > 0 ? parseFloat((damage / roundsPlayed).toFixed(1)) : 0,
      kdr: deaths > 0 ? parseFloat((kills / deaths).toFixed(2)) : kills,
      k2: parseFloat(mvp.k2 as string) || 0,
      k3: parseFloat(mvp.k3 as string) || 0,
      k4: parseFloat(mvp.k4 as string) || 0,
      k5: parseFloat(mvp.k5 as string) || 0,
      v1: parseFloat(mvp.v1 as string) || 0,
      v2: parseFloat(mvp.v2 as string) || 0,
      v3: parseFloat(mvp.v3 as string) || 0,
      v4: parseFloat(mvp.v4 as string) || 0,
      v5: parseFloat(mvp.v5 as string) || 0,
      kast: parseFloat(mvp.kast as string) || 0,
      mvp_count: parseFloat(mvp.mvp as string) || 0,
      contribution_score: parseFloat(mvp.contribution_score as string) || 0
    },
    match: {
      team1_id: match.team1_id,
      team2_id: match.team2_id,
      team1_name: match.team1_string || match.team1_name || "Team 1",
      team2_name: match.team2_string || match.team2_name || "Team 2",
      team1_logo: match.team1_logo,
      team2_logo: match.team2_logo
    }
  };
}

export default router;
