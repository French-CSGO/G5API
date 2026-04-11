/**
 * @swagger
 * resourcePath: /seasons
 * description: Express API router for seasons in get5.
 */

import { Router } from "express";

import fetch from "node-fetch";

const router = Router();

import {db} from "../services/db.js";

import Utils from "../utility/utils.js";
import { RowDataPacket } from "mysql2";
import { SeasonObject } from "../types/seasons/SeasonObject.js";
import { SeasonCvarObject } from "../types/seasons/SeasonCvarObject.js";


import { ToornamentTournament } from "../types/toornament/ToornamentTournament.js";
import { ToornamentParticipant } from "../types/toornament/ToornamentParticipant.js";
import { ToornamentTokenResponse } from "../types/toornament/ToornamentTokenResponse.js";
import { ToornamentMatch } from "../types/toornament/ToornamentMatch.js";

import { getSetting } from "../services/settings.js";
import {
  CHALLONGE_V2_BASE,
  challongeHeaders,
  parseV2Match,
  parseV2Participant,
  buildMatchPutBody,
  buildTournamentStateBody
} from "../utility/challongeV2.js";

/**
 * @swagger
 *
 * components:
 *   schemas:
 *    SeasonData:
 *      type: object
 *      required:
 *        - server_id
 *        - name
 *        - start_date
 *      properties:
 *        server_id:
 *          type: integer
 *          description: Unique server ID.
 *        name:
 *          type: string
 *          description: The name of the Season to be created.
 *        start_date:
 *          type: string
 *          format: date-time
 *          description: Season start date.
 *        end_date:
 *          type: string
 *          format: date-time
 *          description: Optional season end date.
 *        season_cvar:
 *          type: object
 *          description: Objects for default CVARs when selecting a season.
 *    cvars:
 *      type: object
 *      description: Key value pairs representing convars for the match server. Key is command and value is what to set it to.
 *
 *   responses:
 *     NoSeasonData:
 *       description: No season data was provided.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SimpleResponse'
 */

/**
 * @swagger
 *
 * /seasons/:
 *   get:
 *     description: Get all seasons from the application.
 *     produces:
 *       - application/json
 *     tags:
 *       - seasons
 *     responses:
 *       200:
 *         description: All seasons within the system.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 seasons:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SeasonData'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/", async (req, res, next) => {
  try {
    let sql: string =
      "SELECT s.id, s.user_id, s.name, s.start_date, s.end_date, s.challonge_url, s.is_challonge, " +
      "CONCAT('{', GROUP_CONCAT(DISTINCT CONCAT('\"',sc.cvar_name,'\": \"',sc.cvar_value,'\"')),'}') as cvars " +
      "FROM season s LEFT OUTER JOIN season_cvar sc " +
      "ON s.id = sc.season_id " +
      "GROUP BY s.id, s.user_id, s.name, s.start_date, s.end_date, s.challonge_url, s.is_challonge";
    let seasons: RowDataPacket[] = await db.query(sql);
    if (!seasons.length) {
      res.status(404).json({ message: "No seasons found." });
      return;
    }
    for (let row in seasons) {
      if (seasons[row].cvars == null) delete seasons[row].cvars;
      else seasons[row].cvars = JSON.parse(seasons[row].cvars);
    }
    res.json({ seasons });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /seasons/myseasons:
 *   get:
 *     description: Set of seasons from the logged in user.
 *     produces:
 *       - application/json
 *     tags:
 *       - seasons
 *     responses:
 *       200:
 *         description: All matches within the system.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 seasons:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SeasonData'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/myseasons", Utils.ensureAuthenticated, async (req, res, next) => {
  try {
    let sql: string =
      "SELECT s.id, s.user_id, s.name, s.start_date, s.end_date, " +
      "CONCAT('{', GROUP_CONCAT(DISTINCT CONCAT('\"',sc.cvar_name,'\"',': \"',sc.cvar_value,'\"')),'}') as cvars " +
      "FROM season s LEFT OUTER JOIN season_cvar sc " +
      "ON s.id = sc.season_id " +
      "WHERE s.user_id = ? " +
      "GROUP BY s.id, s.user_id, s.name, s.start_date, s.end_date";
    let seasons: RowDataPacket[] = await db.query(sql, [req.user?.id]);
    if (!seasons.length) {
      res.status(404).json({ message: "No seasons found." });
      return;
    }
    for (let row in seasons) {
      if (seasons[row].cvars == null) delete seasons[row].cvars;
      else seasons[row].cvars = JSON.parse(seasons[row].cvars);
    }
    res.json({ seasons });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /seasons/myseasons/availble:
 *   get:
 *     description: Set of seasons from the logged in user that can currently be used.
 *     produces:
 *       - application/json
 *     tags:
 *       - seasons
 *     responses:
 *       200:
 *         description: All seasons of a user that are still running.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 seasons:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SeasonData'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get(
  "/myavailable",
  Utils.ensureAuthenticated,
  async (req, res, next) => {
    let sql: string;
    let seasons: RowDataPacket[];
    try {
      // Check if admin (super or regular), if they are use this query.
      if (req.user && Utils.adminCheck(req.user)) {
        sql =
          "SELECT s.id, s.user_id, s.name, s.start_date, s.end_date, " +
          "CONCAT('{', GROUP_CONCAT(DISTINCT CONCAT('\"',sc.cvar_name,'\"',': \"',sc.cvar_value,'\"')),'}') as cvars " +
          "FROM season s LEFT OUTER JOIN season_cvar sc " +
          "ON s.id = sc.season_id " +
          "WHERE s.end_date >= CURDATE() " +
          "OR s.end_date IS NULL " +
          "GROUP BY s.id, s.user_id, s.name, s.start_date, s.end_date";
        seasons = await db.query(sql, [req.user.id]);
      } else {
        sql =
          "SELECT s.id, s.user_id, s.name, s.start_date, s.end_date, " +
          "CONCAT('{', GROUP_CONCAT(DISTINCT CONCAT('\"',sc.cvar_name,'\"',': \"',sc.cvar_value,'\"')),'}') as cvars " +
          "FROM season s LEFT OUTER JOIN season_cvar sc " +
          "ON s.id = sc.season_id " +
          "WHERE s.user_id = ? " +
          "AND (s.end_date >= CURDATE() " +
          "OR s.end_date IS NULL) " +
          "GROUP BY s.id, s.user_id, s.name, s.start_date, s.end_date";
        seasons = await db.query(sql, [req.user?.id]);
      }
      if (!seasons.length) {
        res.status(404).json({ message: "No seasons found." });
        return;
      }
      for (let row in seasons) {
        if (seasons[row].cvars == null) delete seasons[row].cvars;
        else seasons[row].cvars = JSON.parse(seasons[row].cvars);
      }
      res.json({ seasons });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: (err as Error).toString() });
    }
  }
);

/**
 * @swagger
 *
 * /seasons/:season_id/cvar:
 *   get:
 *     description: Get the default CVARs of a given season ID.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: season_id
 *         required: true
 *         schema:
 *          type: integer
 *     tags:
 *       - seasons
 *     responses:
 *       200:
 *         description: All matches within the system.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/cvars'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get(
  "/:season_id/cvar",
  Utils.ensureAuthenticated,
  async (req, res, next) => {
    try {
      let sql: string =
        "SELECT CONCAT('{', GROUP_CONCAT(DISTINCT CONCAT('\"',sc.cvar_name,'\"',': \"',sc.cvar_value,'\"')),'}') as cvars " +
        "FROM season_cvar sc " +
        "WHERE sc.season_id = ? ";
      let cvar: RowDataPacket[] = await db.query(sql, [req.params.season_id]);
      if (cvar[0].cvars == null) {
        res.status(404).json({
          message: "No cvars found for season id " + req.params.season_id + ".",
        });
        return;
      }
      for (let row in cvar) {
        if (cvar[row].cvars == null) delete cvar[row].cvars;
        else cvar[row].cvars = JSON.parse(cvar[row].cvars);
      }
      res.json(cvar[0]);
    } catch (err) {
      res.status(500).json({ message: (err as Error).toString() });
    }
  }
);

/**
 * @swagger
 *
 * /seasons/:season_id:
 *   get:
 *     description: Set of matches from a season.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: season_id
 *         required: true
 *         schema:
 *          type: integer
 *     tags:
 *       - seasons
 *     responses:
 *       200:
 *         description: Season stats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 matches:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MatchData'
 *                 season:
 *                   $ref: '#/components/schemas/SeasonData'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.get("/:season_id", async (req, res, next) => {
  try {
    let seasonID: number = parseInt(req.params.season_id);
    let seasonSql: string = "SELECT * FROM season WHERE id = ?";
    let seasons: RowDataPacket[] = await db.query(seasonSql, [seasonID]);
    if (!seasons.length) {
      res.status(404).json({ message: "Season not found." });
      return;
    }
    const season: string = JSON.parse(JSON.stringify(seasons[0]));

    // Fetch matches with owner name and bo1 map scores in one query
    let sql: string =
      "SELECT m.id, m.user_id, u.name AS owner, " +
      "m.team1_id, m.team2_id, m.winner, m.team1_score, m.team2_score, " +
      "m.team1_series_score, m.team2_series_score, m.team1_string, m.team2_string, " +
      "m.cancelled, m.forfeit, m.start_time, m.end_time, m.max_maps, " +
      "m.title, m.skip_veto, m.private_match, m.enforce_teams, " +
      "m.min_player_ready, m.season_id, m.is_pug, " +
      "ms.team1_score AS map1_t1_score, ms.team2_score AS map1_t2_score " +
      "FROM `match` m " +
      "LEFT JOIN user u ON u.id = m.user_id " +
      "LEFT JOIN map_stats ms ON ms.match_id = m.id AND m.max_maps = 1 " +
      "WHERE m.season_id = ? " +
      "GROUP BY m.id";
    let rawMatches: RowDataPacket[] = await db.query(sql, [seasonID]);

    // Compute match_status from team1's perspective (or team2 if team1 is null)
    const matches = rawMatches.map(m => {
      const isTeam1 = m.team1_id !== null;
      let myScore: number    = isTeam1 ? m.team1_score : m.team2_score;
      let otherScore: number = isTeam1 ? m.team2_score : m.team1_score;
      const otherName: string = isTeam1
        ? (m.team2_string ?? "Team Removed From Match")
        : (m.team1_string ?? "Team Removed From Match");

      // For bo1, use map_stats score if available
      if (m.max_maps === 1 && m.map1_t1_score != null) {
        myScore    = isTeam1 ? m.map1_t1_score : m.map1_t2_score;
        otherScore = isTeam1 ? m.map1_t2_score : m.map1_t1_score;
      }

      let match_status: string;
      if (m.end_time == null && !m.cancelled && m.start_time != null)
        match_status = `Live, ${myScore}:${otherScore} vs ${otherName}`;
      else if (m.cancelled)
        match_status = "Cancelled";
      else if (myScore > otherScore)
        match_status = `Won, ${myScore}:${otherScore} vs ${otherName}`;
      else if (myScore < otherScore)
        match_status = `Lost, ${myScore}:${otherScore} vs ${otherName}`;
      else if (m.winner != null)
        match_status = `Forfeit win vs ${otherName}`;
      else
        match_status = `Tied, ${myScore}:${otherScore} vs ${otherName}`;

      return { ...m, match_status };
    });

    res.json({ matches, season });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /seasons:
 *   post:
 *     description: Create a new season.
 *     produces:
 *       - application/json
 *     requestBody:
 *      required: true
 *      content:
 *        application/json:
 *          schema:
 *            type: array
 *            items:
 *              $ref: '#/components/schemas/SeasonData'
 *     tags:
 *       - seasons
 *     responses:
 *       200:
 *         description: New season inserted successsfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimpleResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.post("/", Utils.ensureAuthenticated, async (req, res, next) => {
  try {
    let defaultCvar: any = req.body[0].season_cvar;
    let insertSet: SeasonObject | SeasonCvarObject = {
      user_id: req.user?.id,
      name: req.body[0].name,
      start_date: req.body[0].start_date,
      end_date: req.body[0].end_date,
    };
    let sql: string = "INSERT INTO season SET ?";
    let insertSeason: RowDataPacket[] = await db.query(sql, [insertSet]);
    if (defaultCvar != null) {
      sql = "INSERT INTO season_cvar SET ?";
      for (let key in defaultCvar) {
        insertSet = {
          //@ts-ignore
          season_id: insertSeason.insertId,
          cvar_name: key.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
          cvar_value: typeof defaultCvar[key] === 'string' ? defaultCvar[key].replace(/\\/g, '\\\\').replace(/"/g, '\\"') : defaultCvar[key]
        };
        await db.query(sql, [insertSet]);
      }
    }
    res.json({
      message: "Season inserted successfully!",
      //@ts-ignore
      id: insertSeason.insertId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/**
 * @swagger
 *
 * /seasons:
 *   put:
 *     description: Update a season.
 *     produces:
 *       - application/json
 *     requestBody:
 *      required: true
 *      content:
 *        application/json:
 *          schema:
 *            type: array
 *            items:
 *              $ref: '#/components/schemas/SeasonData'
 *
 *     tags:
 *       - seasons
 *     responses:
 *       200:
 *         description: New season inserted successsfully.
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
 *         $ref: '#/components/responses/NoSeasonData'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.put("/", Utils.ensureAuthenticated, async (req, res, next) => {
  let seasonUserId: string = "SELECT user_id FROM season WHERE id = ?";
  if (req.body[0].season_id == null) {
    res.status(400).json({ message: "No season ID provided." });
    return;
  }
  const seasonRow: RowDataPacket[] = await db.query(seasonUserId, [req.body[0].season_id]);
  if (!seasonRow.length) {
    res.status(404).json({ message: "No season found." });
    return;
  } else if (
    req.user &&
    seasonRow[0].user_id != req.user.id &&
    !Utils.superAdminCheck(req.user)
  ) {
    res
      .status(403)
      .json({ message: "User is not authorized to perform action." });
    return;
  } else {
    try {
      let defaultCvar: any = req.body[0].season_cvar;
      let updateStmt: SeasonObject = {
        user_id: req.body[0].user_id,
        name: req.body[0].name,
        start_date: req.body[0].start_date,
        end_date: req.body[0].end_date,
      };
      // Remove any values that may not be updated.
      // Change this as we are allowed null values within this update.
      updateStmt = await db.buildUpdateStatement(updateStmt);
      // Force getting the end date.
      updateStmt.end_date = req.body[0].end_date;
      if (!Object.keys(updateStmt)) {
        res
          .status(412)
          .json({ message: "No update data has been provided." });
        return;
      }
      let sql: string = "UPDATE season SET ? WHERE id = ?";
      await db.query(sql, [updateStmt, req.body[0].season_id]);
      if (defaultCvar != null) {
        sql = "DELETE FROM season_cvar WHERE season_id = ?";
        await db.query(sql, [req.body[0].season_id]);
        sql = "INSERT INTO season_cvar SET ?";
        for (let key in defaultCvar) {
          let insertSet: SeasonCvarObject = {
            season_id: req.body[0].season_id,
            cvar_name: key.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
            cvar_value: typeof defaultCvar[key] === 'string' ? defaultCvar[key].replace(/\\/g, '\\\\').replace(/"/g, '\\"') : defaultCvar[key],
          };
          await db.query(sql, [insertSet]);
        }
      }
      res.json({ message: "Season updated successfully!" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: (err as Error).toString() });
    }
  }
});

/**
 * @swagger
 *
 * /seasons:
 *   delete:
 *     description: Delete a season object. NULLs any linked matches to the season as well.
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
 *                season_id:
 *                  type: integer
 *                  required: true
 *     tags:
 *       - seasons
 *     responses:
 *       200:
 *         description: Season deleted
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
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.delete("/", async (req, res, next) => {
  let seasonUserId: string = "SELECT user_id FROM season WHERE id = ?";
  const seasonRow: RowDataPacket[] = await db.query(seasonUserId, req.body[0].season_id);
  if (seasonRow[0] == null) {
    res.status(404).json({ message: "No season found." });
    return;
  } else if (
    req.user &&
    seasonRow[0].user_id != req.user.id &&
    !Utils.superAdminCheck(req.user)
  ) {
    res
      .status(403)
      .json({ message: "User is not authorized to perform action." });
    return;
  } else {
    try {
      let deleteSql: string = "DELETE FROM season WHERE id = ?";
      let seasonId: number = parseInt(req.body[0].season_id);
      await db.query(deleteSql, [seasonId]);
      res.json({ message: "Season deleted successfully!" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: (err as Error).toString() });
    }
  }
});

/**
 * @swagger
 *
 * /seasons/challonge:
 *   post:
 *     description: Create a new season from a Challonge Tournament.
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
 *                tournament_id:
 *                  type: string
 *                  description: The tournament ID or URL of the Challonge tournament, as explained in their [API](https://api.challonge.com/v1/documents/tournaments/show).
 *                import_teams:
 *                  type: boolean
 *                  description: Whether or not to import the teams that are already in the bracket.
 *     tags:
 *       - seasons
 *     responses:
 *       200:
 *         description: New season inserted successsfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SimpleResponse'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/Error'
 */
router.post("/challonge", Utils.ensureAuthenticated, async (req, res, next) => {
  try {

    const rawTournamentId: string = req.body[0].tournament_id;

    if (rawTournamentId.startsWith("t:")) {
      console.log("Toornament import requested.");
      const result = await handleToornamentImport(rawTournamentId, req.user!.id, req.body[0]);
      return res.json(result);
    }


    const challongeAPIKey = getChallongeAPIKey();

    let tournamentId: string = req.body[0].tournament_id;
    if (!/^[\w\-]+$/.test(tournamentId)) {
      throw new Error("Invalid tournament ID.");
    }
    // v2.1 — GET tournament info
    const cHeaders = challongeHeaders(challongeAPIKey);
    const tournResp: any = await fetch(
      `${CHALLONGE_V2_BASE}/tournaments/${tournamentId}.json`,
      { headers: cHeaders }
    );
    if (!tournResp.ok) throw new Error(`Challonge API error: ${tournResp.status}`);
    const tournBody: any = await tournResp.json();
    const tournAttrs = tournBody?.data?.attributes;
    if (tournAttrs) {
      // Insert the season.
      let sqlString: string = "INSERT INTO season SET ?";
      let seasonData: SeasonObject = {
        user_id: req.user?.id,
        name: tournAttrs.name,
        start_date: tournAttrs.starts_at ? new Date(tournAttrs.starts_at) : new Date(),
        is_challonge: true,
        challonge_svg: null, // not exposed in v2.1
        challonge_url: tournamentId
      };
      const insertSeason: RowDataPacket[] = await db.query(sqlString, seasonData);
      //@ts-ignore
      const newSeasonId: number = insertSeason.insertId;

      // Enregistrer le tournoi dans season_challonge_tournament
      const label: string = req.body[0]?.label || "Main";
      await db.query(
        "INSERT INTO season_challonge_tournament (season_id, challonge_slug, label, display_order) VALUES (?, ?, ?, 0)",
        [newSeasonId, tournamentId, label]
      );

      // v2.1 — import teams via separate participants call
      if (req.body[0]?.import_teams) {
        const partResp: any = await fetch(
          `${CHALLONGE_V2_BASE}/tournaments/${tournamentId}/participants.json?per_page=500`,
          { headers: cHeaders }
        );
        if (partResp.ok) {
          const partBody: any = await partResp.json();
          const participants: any[] = Array.isArray(partBody?.data) ? partBody.data : [];
          if (participants.length > 0) {
            sqlString = "INSERT INTO team (user_id, name, tag, challonge_team_id, public_team) VALUES ?";
            const teamArray: Array<Array<any>> = participants.map((item: any) => {
              const p = parseV2Participant(item);
              return [req.user!.id, p.name.substring(0, 40), p.name.substring(0, 40), p.id, 1];
            });
            await db.query(sqlString, [teamArray]);
          }
        }
      }

      res.json({
        message: "Challonge season imported successfully!",
        chal_res: tournAttrs.starts_at ?? null,
        id: newSeasonId,
      });
    }

    
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});


async function handleToornamentImport(tournamentId: string, userId: number, reqBody: any) {

  const clientId: string = getSetting("toornament.clientId");
  const clientSecret: string = getSetting("toornament.clientSecret");
  const apiKey: string = getSetting("toornament.apiKey");

  if (!clientId || !clientSecret || !apiKey) {
    throw new Error("Missing Toornament credentials in environment variables");
  }


  const tokenResponse = await fetch("https://api.toornament.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'organizer:admin organizer:view organizer:result organizer:participant'
    }),
  });

  const tokenData = await tokenResponse.json() as ToornamentTokenResponse;
  if (!tokenData.access_token) throw new Error("Toornament Auth Failed");

  const cleanId = tournamentId.replace(/^t:/, '');
  if (!/^\d+$/.test(cleanId)) throw new Error("Invalid Toornament tournament ID.");

  const toornamentResponse = await fetch(
    `https://api.toornament.com/organizer/v2/tournaments/${cleanId}`,
    {
      headers: {
        "Authorization": `Bearer ${tokenData.access_token}`,
        "x-api-key": apiKey 
      }
    }
  );

  const tournamentData = await toornamentResponse.json() as ToornamentTournament;

  const logoUrl = tournamentData.logo ? tournamentData.logo.logo_medium : null;
  
  let sqlString = "INSERT INTO season SET ?";
  let seasonData = {
    user_id: userId,
    name: tournamentData.name,
    start_date: new Date(tournamentData.scheduled_date_start), 
    is_challonge: true, 
    challonge_url: tournamentId ,
    challonge_svg : logoUrl
  };
  
  const insertSeason: any = await db.query(sqlString, seasonData);

  if (reqBody?.import_teams) {
  let allParticipants: ToornamentParticipant[] = [];
  let rangeStart = 0;
  let hasMore = true;

  while (hasMore) {
    const participantsResponse = await fetch(
      `https://api.toornament.com/organizer/v2/participants?tournament_ids=${cleanId}`,
      {
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`,
          "x-api-key": apiKey,
          "Range": `participants=${rangeStart}-${rangeStart + 49}`
        }
      }
    );

    const data = await participantsResponse.json() as ToornamentParticipant[];
    allParticipants = allParticipants.concat(data);

    const contentRange = participantsResponse.headers.get("Content-Range");
    if (contentRange) {
      const [, total] = contentRange.split("/");
      if (allParticipants.length >= parseInt(total)) {
        hasMore = false;
      } else {
        rangeStart += 50;
      }
    } else {
      hasMore = false;
    }
  }

  if (allParticipants.length > 0) {
    const sqlTeams = "INSERT INTO team (user_id, name, tag, challonge_team_id) VALUES ?";
    const teamArray = allParticipants.map(p => [
      userId,
      p.name.substring(0, 40),
      p.name.substring(0, 40),
      p.id 
    ]);

    await db.query(sqlTeams, [teamArray]);
    console.log(`${allParticipants.length} participants importés.`);
  }
}
  
  return {
    message: "Toornament season imported successfully!",
    id: insertSeason.insertId,
  };
}

async function getToornamentToken(): Promise<string> {
  const clientId: string = getSetting("toornament.clientId");
  const clientSecret: string = getSetting("toornament.clientSecret");
  const apiKey: string = getSetting("toornament.apiKey");
  if (!clientId || !clientSecret || !apiKey) {
    throw new Error("Missing Toornament credentials in config");
  }
  const tokenResponse = await fetch("https://api.toornament.com/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "organizer:admin organizer:view organizer:result organizer:participant"
    })
  });
  const tokenData = await tokenResponse.json() as ToornamentTokenResponse;
  if (!tokenData.access_token) throw new Error("Toornament Auth Failed");
  return tokenData.access_token;
}

async function getSeasonToornamentId(seasonId: number): Promise<string> {
  const seasons: RowDataPacket[] = await db.query(
    "SELECT challonge_url FROM season WHERE id = ? AND is_challonge = 1 AND challonge_url LIKE 't:%'",
    [seasonId]
  );
  if (!seasons.length) throw new Error("Season not found or not a Toornament season");
  return (seasons[0].challonge_url as string).replace(/^t:/, "");
}

router.get("/:season_id/toornament/matches", Utils.ensureAuthenticated, async (req, res, next) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const tournamentId = await getSeasonToornamentId(seasonId);
    const token = await getToornamentToken();
    const apiKey: string = getSetting("toornament.apiKey");

    const { team_id, status, stage_id, group_id, round_id } = req.query;

    // Resolve local team_id -> toornament participant_id
    let participantId: string | undefined;
    if (team_id) {
      const teamRows: RowDataPacket[] = await db.query(
        "SELECT challonge_team_id FROM team WHERE id = ?",
        [team_id]
      );
      if (teamRows.length && teamRows[0].challonge_team_id) {
        participantId = teamRows[0].challonge_team_id;
      }
    }

    let url = `https://api.toornament.com/organizer/v2/matches?tournament_ids=${tournamentId}`;
    if (participantId) url += `&participant_ids=${participantId}`;
    if (status) url += `&statuses=${status}`;
    if (stage_id) url += `&stage_ids=${stage_id}`;
    if (group_id) url += `&group_ids=${group_id}`;
    if (round_id) url += `&round_ids=${round_id}`;
    url += "&sort=structure";

    // Paginate through all matches
    let allMatches: ToornamentMatch[] = [];
    let rangeStart = 0;
    let hasMore = true;
    while (hasMore) {
      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${token}`,
          "x-api-key": apiKey,
          "Range": `matches=${rangeStart}-${rangeStart + 99}`
        }
      });
      const data = await response.json() as ToornamentMatch[];
      allMatches = allMatches.concat(data);
      const contentRange = response.headers.get("Content-Range");
      if (contentRange) {
        const total = parseInt(contentRange.split("/")[1]);
        hasMore = allMatches.length < total;
        rangeStart += 100;
      } else {
        hasMore = false;
      }
    }

    // Enrich opponents with local team IDs
    const challongeIds = allMatches.flatMap(m =>
      m.opponents.map(o => o.participant?.id).filter(Boolean)
    );
    let localTeams: RowDataPacket[] = [];
    if (challongeIds.length > 0) {
      localTeams = await db.query(
        `SELECT id, name, challonge_team_id FROM team WHERE challonge_team_id IN (${challongeIds.map(() => "?").join(",")})`,
        challongeIds
      );
    }
    const teamByChallongeId = new Map(localTeams.map(t => [String(t.challonge_team_id), t]));

    // Find existing G5 matches for this season by toornament_id (precise) or team pair (fallback)
    const g5Matches: RowDataPacket[] = await db.query(
      "SELECT id, team1_id, team2_id, toornament_id FROM `match` WHERE season_id = ?",
      [seasonId]
    );
    const g5ByToornamentId = new Map<string, number>();
    const g5MatchMap = new Map<string, number>();
    for (const m of g5Matches) {
      if (m.toornament_id) {
        g5ByToornamentId.set(String(m.toornament_id), m.id);
      }
      const key1 = `${m.team1_id}:${m.team2_id}`;
      const key2 = `${m.team2_id}:${m.team1_id}`;
      if (!g5MatchMap.has(key1) || g5MatchMap.get(key1)! < m.id) g5MatchMap.set(key1, m.id);
      if (!g5MatchMap.has(key2) || g5MatchMap.get(key2)! < m.id) g5MatchMap.set(key2, m.id);
    }

    const enriched = allMatches.map(match => {
      const enrichedOpponents = match.opponents.map(opp => ({
        ...opp,
        local_team: opp.participant ? (teamByChallongeId.get(String(opp.participant.id)) ?? null) : null
      }));
      const t1 = (enrichedOpponents[0]?.local_team as any)?.id;
      const t2 = (enrichedOpponents[1]?.local_team as any)?.id;
      // Prefer match by toornament_id (unique), fallback to team pair for old records
      const g5_match_id =
        g5ByToornamentId.get(String(match.id)) ??
        ((t1 && t2) ? (g5MatchMap.get(`${t1}:${t2}`) ?? null) : null);
      return { ...match, opponents: enrichedOpponents, g5_match_id };
    });

    res.json({ matches: enriched });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

router.get("/:season_id/toornament/stages", Utils.ensureAuthenticated, async (req, res, next) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const tournamentId = await getSeasonToornamentId(seasonId);
    const token = await getToornamentToken();
    const apiKey: string = getSetting("toornament.apiKey");

    const response = await fetch(
      `https://api.toornament.com/organizer/v2/stages?tournament_ids=${tournamentId}`,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "x-api-key": apiKey,
          "Range": "stages=0-49"
        }
      }
    );
    const stages = await response.json();
    res.json({ stages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

router.get("/:season_id/toornament/matches/:toornament_match_id/prefill", Utils.ensureAuthenticated, async (req, res, next) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const toornamentMatchId = req.params.toornament_match_id;
    const tournamentId = await getSeasonToornamentId(seasonId);
    if (!/^\d+$/.test(String(tournamentId))) throw new Error("Invalid Toornament tournament ID.");
    if (!/^\d+$/.test(String(toornamentMatchId))) throw new Error("Invalid Toornament match ID.");
    const token = await getToornamentToken();
    const apiKey: string = getSetting("toornament.apiKey");

    // Get season info + CVARs
    const seasonRows: RowDataPacket[] = await db.query(
      "SELECT s.id, s.name, CONCAT('{', GROUP_CONCAT(DISTINCT CONCAT('\"',sc.cvar_name,'\": \"',sc.cvar_value,'\"')),'}') as cvars " +
      "FROM season s LEFT OUTER JOIN season_cvar sc ON s.id = sc.season_id WHERE s.id = ? GROUP BY s.id",
      [seasonId]
    );
    const season = seasonRows[0];
    if (season?.cvars) season.cvars = JSON.parse(season.cvars);

    // Get the Toornament match
    const matchUrl = new URL(`https://api.toornament.com/organizer/v2/matches/${encodeURIComponent(toornamentMatchId)}`);
    matchUrl.searchParams.set("tournament_ids", String(tournamentId));
    const matchResponse = await fetch(
      matchUrl.toString(),
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "x-api-key": apiKey
        }
      }
    );
    const tMatch = await matchResponse.json() as ToornamentMatch;

    // Resolve local team IDs from opponents
    const opponents = await Promise.all(
      tMatch.opponents.map(async opp => {
        if (!opp.participant?.id) return { ...opp, local_team: null };
        const rows: RowDataPacket[] = await db.query(
          "SELECT id, name FROM team WHERE challonge_team_id = ?",
          [opp.participant.id]
        );
        return { ...opp, local_team: rows[0] ?? null };
      })
    );

    // Determine max_maps from Toornament format (match → stage fallback)
    let max_maps = 1;
    let fmt: any = tMatch.settings?.format;

    if (!fmt && tMatch.stage_id) {
      const stageResp = await fetch(
        `https://api.toornament.com/organizer/v2/stages?tournament_ids=${tournamentId}`,
        {
          headers: {
            "Authorization": `Bearer ${token}`,
            "x-api-key": apiKey,
            "Range": "stages=0-49"
          }
        }
      );
      if (stageResp.ok) {
        const stages = await stageResp.json() as any[];
        const stage = stages.find((s: any) => s.id === tMatch.stage_id);
        fmt = stage?.match_settings?.format
           ?? stage?.settings?.match_settings?.format;
      }
    }

    if (fmt?.type === "best_of" && fmt.options?.nb_match_sets) {
      max_maps = fmt.options.nb_match_sets;
    } else if (fmt?.type === "single_set") {
      max_maps = 1;
    }

    // Get available servers (not in use, accessible by user)
    const serverSql =
      "SELECT gs.id, gs.display_name, gs.ip_string, gs.port, gs.public_server, gs.flag " +
      "FROM game_server gs WHERE gs.in_use = 0 AND (gs.public_server = 1 OR gs.user_id = ?) " +
      "ORDER BY gs.display_name";
    const availableServers: RowDataPacket[] = await db.query(serverSql, [req.user!.id]);

    res.json({
      season_id: seasonId,
      season_name: season?.name ?? null,
      season_cvars: season?.cvars ?? null,
      team1: opponents[0]?.local_team ?? null,
      team2: opponents[1]?.local_team ?? null,
      max_maps,
      toornament_match_id: toornamentMatchId,
      toornament_match: {
        id: tMatch.id,
        status: tMatch.status,
        scheduled_datetime: tMatch.scheduled_datetime,
        stage_id: tMatch.stage_id,
        group_id: tMatch.group_id,
        round_id: tMatch.round_id,
        number: tMatch.number,
        opponents
      },
      available_servers: availableServers
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

router.get("/:season_id/toornament/rounds", Utils.ensureAuthenticated, async (req, res, next) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const tournamentId = await getSeasonToornamentId(seasonId);
    const token = await getToornamentToken();
    const apiKey: string = getSetting("toornament.apiKey");

    const stagesResp = await fetch(`https://api.toornament.com/organizer/v2/stages?tournament_ids=${tournamentId}`, {
      headers: { "Authorization": `Bearer ${token}`, "x-api-key": apiKey, "Range": "stages=0-49" }
    });
    if (!stagesResp.ok) {
      const body = await stagesResp.text();
      throw new Error(`Toornament stages error ${stagesResp.status}: ${body}`);
    }
    const stages = await stagesResp.json() as any[];

    let rounds: any[] = [];
    let roundsStart = 0;
    let roundsMore = true;
    while (roundsMore) {
      const resp = await fetch(`https://api.toornament.com/organizer/v2/rounds?tournament_ids=${tournamentId}`, {
        headers: { "Authorization": `Bearer ${token}`, "x-api-key": apiKey, "Range": `rounds=${roundsStart}-${roundsStart + 49}` }
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Toornament rounds error ${resp.status}: ${body}`);
      }
      const page = await resp.json() as any[];
      if (!Array.isArray(page) || !page.length) break;
      rounds = rounds.concat(page);
      const cr = resp.headers.get("Content-Range");
      if (cr) {
        const total = parseInt(cr.split("/")[1]);
        roundsMore = rounds.length < total;
        roundsStart += 50;
      } else {
        roundsMore = false;
      }
    }

    const stageMap = new Map(stages.map((s: any) => [s.id, s.name]));
    const enriched = rounds.map((r: any) => ({
      ...r,
      stage_name: stageMap.get(r.stage_id) ?? r.stage_id
    }));

    res.json({ rounds: enriched });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

router.get("/:season_id/toornament/groups", Utils.ensureAuthenticated, async (req, res, _next) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const tournamentId = await getSeasonToornamentId(seasonId);
    const token = await getToornamentToken();
    const apiKey: string = getSetting("toornament.apiKey");

    const stagesResp = await fetch(`https://api.toornament.com/organizer/v2/stages?tournament_ids=${tournamentId}`, {
      headers: { "Authorization": `Bearer ${token}`, "x-api-key": apiKey, "Range": "stages=0-49" }
    });
    if (!stagesResp.ok) throw new Error(`Toornament stages error ${stagesResp.status}`);
    const stages = await stagesResp.json() as any[];
    const stageMap = new Map(stages.map((s: any) => [s.id, s.name]));

    let groups: any[] = [];
    let start = 0;
    let hasMore = true;
    while (hasMore) {
      const resp = await fetch(`https://api.toornament.com/organizer/v2/groups?tournament_ids=${tournamentId}`, {
        headers: { "Authorization": `Bearer ${token}`, "x-api-key": apiKey, "Range": `groups=${start}-${start + 49}` }
      });
      if (!resp.ok) break;
      const page = await resp.json() as any[];
      if (!Array.isArray(page) || !page.length) break;
      groups = groups.concat(page);
      const cr = resp.headers.get("Content-Range");
      if (cr) {
        const total = parseInt(cr.split("/")[1]);
        hasMore = groups.length < total;
        start += 50;
      } else {
        hasMore = false;
      }
    }

    const enriched = groups.map((g: any) => ({
      ...g,
      stage_name: stageMap.get(g.stage_id) ?? g.stage_id
    }));

    res.json({ groups: enriched });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

router.patch("/:season_id/toornament/rounds/:round_id/schedule", Utils.ensureAuthenticated, async (req, res, next) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const roundId = req.params.round_id;
    const { scheduled_datetime } = req.body;

    if (!scheduled_datetime) {
      return res.status(400).json({ message: "scheduled_datetime is required" });
    }

    const tournamentId = await getSeasonToornamentId(seasonId);
    const token = await getToornamentToken();
    const apiKey: string = getSetting("toornament.apiKey");

    // Fetch all matches for this round
    let allMatches: ToornamentMatch[] = [];
    let rangeStart = 0;
    let hasMore = true;
    while (hasMore) {
      const response = await fetch(
        `https://api.toornament.com/organizer/v2/matches?tournament_ids=${tournamentId}&round_ids=${roundId}`,
        {
          headers: {
            "Authorization": `Bearer ${token}`,
            "x-api-key": apiKey,
            "Range": `matches=${rangeStart}-${rangeStart + 99}`
          }
        }
      );
      const data = await response.json() as ToornamentMatch[];
      if (!Array.isArray(data) || !data.length) break;
      allMatches = allMatches.concat(data);
      const contentRange = response.headers.get("Content-Range");
      if (contentRange) {
        const total = parseInt(contentRange.split("/")[1]);
        hasMore = allMatches.length < total;
        rangeStart += 100;
      } else {
        hasMore = false;
      }
    }

    // PATCH each match
    await Promise.all(allMatches.map(match =>
      fetch(`https://api.toornament.com/organizer/v2/matches/${match.id}`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${token}`,
          "x-api-key": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ scheduled_datetime })
      })
    ));

    res.json({ message: `${allMatches.length} match(s) mis à jour.` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

router.patch("/:season_id/toornament/matches/:match_id/schedule", Utils.ensureAuthenticated, async (req, res) => {
  try {
    const matchId = req.params.match_id;
    const { scheduled_datetime } = req.body;
    if (!scheduled_datetime) return res.status(400).json({ message: "scheduled_datetime is required" });
    if (!/^\d+$/.test(matchId)) return res.status(400).json({ message: "Invalid match ID." });

    const token = await getToornamentToken();
    const apiKey: string = getSetting("toornament.apiKey");

    await fetch(`https://api.toornament.com/organizer/v2/matches/${matchId}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "x-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ scheduled_datetime })
    });
    res.json({ message: "Match mis à jour." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

router.get("/:season_id/teams", Utils.ensureAuthenticated, async (req, res, next) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const sql =
      "SELECT t.id, t.name, t.tag, t.logo, t.public_team FROM team t " +
      "INNER JOIN teams_seasons ts ON ts.teams_id = t.id WHERE ts.season_id = ?";
    const teams: RowDataPacket[] = await db.query(sql, [seasonId]);
    res.json({ teams });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

router.post("/:season_id/teams", Utils.ensureAuthenticated, async (req, res, next) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const teamIds: number[] = req.body.team_ids;
    if (!teamIds || !teamIds.length) {
      res.status(400).json({ message: "No team IDs provided." });
      return;
    }
    const values = teamIds.map((id) => [seasonId, id]);
    await db.query("INSERT IGNORE INTO teams_seasons (season_id, teams_id) VALUES ?", [values]);
    res.json({ message: "Teams added to season successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

router.delete("/:season_id/teams/:team_id", Utils.ensureAuthenticated, async (req, res, next) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const teamId = parseInt(req.params.team_id);
    await db.query("DELETE FROM teams_seasons WHERE season_id = ? AND teams_id = ?", [seasonId, teamId]);
    res.json({ message: "Team removed from season successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

// ─── Challonge match import ──────────────────────────────────────────────────

function getChallongeAPIKey(): string {
  const key = getSetting("challonge.apiKey");
  if (!key) throw new Error("Clé API Challonge non configurée dans les paramètres administrateur.");
  return key;
}

/** Retourne tous les brackets Challonge d'une saison (depuis season_challonge_tournament) */
async function getSeasonChallongeTournaments(seasonId: number): Promise<RowDataPacket[]> {
  const rows: RowDataPacket[] = await db.query(
    "SELECT id, challonge_slug, label, display_order FROM season_challonge_tournament WHERE season_id = ? ORDER BY display_order ASC, id ASC",
    [seasonId]
  );
  if (!rows.length) throw new Error("Aucun tournoi Challonge trouvé pour cette saison.");
  return rows;
}

/** Trouve le slug Challonge qui contient le match donné (via challonge_id sur la table match) */
async function getSlugForMatch(seasonId: number, challongeMatchId: number, apiKey: string): Promise<string> {
  // Cherche d'abord via le match G5 existant (challonge_id stocké)
  const existing: RowDataPacket[] = await db.query(
    "SELECT sct.challonge_slug FROM `match` m " +
    "JOIN season_challonge_tournament sct ON sct.season_id = m.season_id " +
    "WHERE m.challonge_id = ? AND m.season_id = ? LIMIT 1",
    [challongeMatchId, seasonId]
  );
  if (existing.length) return existing[0].challonge_slug as string;

  // Sinon cherche en interrogeant chaque tournoi Challonge (v2.1)
  const tournaments = await getSeasonChallongeTournaments(seasonId);
  const cHeaders = challongeHeaders(apiKey);
  for (const t of tournaments) {
    const resp = await fetch(
      `${CHALLONGE_V2_BASE}/tournaments/${t.challonge_slug}/matches/${challongeMatchId}.json`,
      { headers: cHeaders }
    );
    if (resp.ok) return t.challonge_slug as string;
  }
  throw new Error(`Match Challonge ${challongeMatchId} introuvable dans les tournois de la saison.`);
}

/** Helper partagé : enrichit les matchs d'un slug avec local_team + g5_match_id (v2.1) */
async function enrichChallongeMatches(
  slug: string,
  label: string,
  apiKey: string,
  state: string | undefined,
  g5ByChallongeId: Map<number, number>,
  g5ByTeamPair: Map<string, number>
): Promise<any[]> {
  const cHeaders = challongeHeaders(apiKey);

  // v2.1 — liste des matchs
  let url = `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches.json?per_page=500`;
  if (state) url += `&state=${state}`;
  const resp = await fetch(url, { headers: cHeaders });
  if (!resp.ok) return [];
  const rawBody: any = await resp.json();
  // v2.1: { data: [ { id, attributes: { state, round, ..., relationships: { player1, player2 } } } ] }
  const rawMatches: any[] = Array.isArray(rawBody?.data) ? rawBody.data : [];

  // v2.1 — liste des participants
  const partResp = await fetch(
    `${CHALLONGE_V2_BASE}/tournaments/${slug}/participants.json?per_page=500`,
    { headers: cHeaders }
  );
  const partBody: any = partResp.ok ? await partResp.json() : {};
  const rawParts: any[] = Array.isArray(partBody?.data) ? partBody.data : [];
  // Map: challongeId (number) → participant { id, display_name, name }
  const partMap = new Map<number, any>(
    rawParts.map((item: any) => {
      const p = parseV2Participant(item);
      return [p.id, p];
    })
  );

  const challongeIds = rawParts.map((item: any) => parseInt(item.id, 10));

  // Inclure aussi les IDs de participants qui apparaissent directement dans les matchs
  // (les endpoints participants et matches peuvent retourner des ensembles d'IDs différents)
  const matchPlayerIds = rawMatches.flatMap((item: any) => {
    const m = parseV2Match(item);
    return [m.player1_id, m.player2_id].filter((id): id is number => id !== null);
  });
  const allLookupIds = [...new Set([...challongeIds, ...matchPlayerIds])];

  let localTeams: RowDataPacket[] = [];
  if (allLookupIds.length > 0) {
    localTeams = await db.query(
      `SELECT id, name, challonge_team_id FROM team WHERE challonge_team_id IN (${allLookupIds.map(() => "?").join(",")})`,
      allLookupIds.map(String)
    );
  }
  const teamByChallongeId = new Map(localTeams.map(t => [String(t.challonge_team_id), t]));

  return rawMatches.map((item: any) => {
    const m = parseV2Match(item);

    // Résolution participant : cherche d'abord dans la map principale.
    // Pour les matchs de phase de groupes, l'ID Challonge peut être différent de
    // l'ID participant principal → fallback avec un objet minimal pour que le match reste visible.
    const resolveParticipant = (pid: number | null) => {
      if (pid === null) return null;
      const found = partMap.get(pid);
      if (found) return found;
      // Participant non trouvé (phase de groupes avec IDs internes) : retourne un placeholder
      return { id: pid, display_name: `#${pid}`, name: `#${pid}` };
    };

    const p1 = resolveParticipant(m.player1_id);
    const p2 = resolveParticipant(m.player2_id);
    const local1 = p1 ? (teamByChallongeId.get(String(p1.id)) ?? null) : null;
    const local2 = p2 ? (teamByChallongeId.get(String(p2.id)) ?? null) : null;
    const t1id = (local1 as any)?.id;
    const t2id = (local2 as any)?.id;
    const g5_match_id =
      g5ByChallongeId.get(m.id) ??
      ((t1id && t2id) ? (g5ByTeamPair.get(`${t1id}:${t2id}`) ?? null) : null);
    return {
      id: m.id,
      slug,
      tournament_label: label,
      state: m.state,
      round: m.round,
      suggested_play_order: m.suggested_play_order,
      scheduled_time: m.scheduled_time,
      scores_csv: m.scores_csv,
      player1: p1 ? { id: p1.id, name: p1.display_name, local_team: local1 } : null,
      player2: p2 ? { id: p2.id, name: p2.display_name, local_team: local2 } : null,
      g5_match_id
    };
  });
}

/** GET /:season_id/challonge/tournaments — liste les brackets de la saison */
router.get("/:season_id/challonge/tournaments", Utils.ensureAuthenticated, async (req, res) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const tournaments = await getSeasonChallongeTournaments(seasonId);
    res.json({ tournaments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/** POST /:season_id/challonge/tournaments — ajouter un bracket supplémentaire */
router.post("/:season_id/challonge/tournaments", Utils.ensureAuthenticated, async (req, res) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const { challonge_slug, label } = req.body;
    if (!challonge_slug || !/^[\w\-]+$/.test(challonge_slug)) {
      res.status(400).json({ message: "Slug Challonge invalide." });
      return;
    }
    // Vérifier que la saison appartient à l'utilisateur ou est admin
    const seasonRows: RowDataPacket[] = await db.query(
      "SELECT user_id FROM season WHERE id = ? AND is_challonge = 1",
      [seasonId]
    );
    if (!seasonRows.length) {
      res.status(404).json({ message: "Saison introuvable ou pas une saison Challonge." });
      return;
    }
    if (seasonRows[0].user_id !== req.user!.id && !Utils.superAdminCheck(req.user!)) {
      res.status(403).json({ message: "Non autorisé." });
      return;
    }
    // Vérifier que le tournoi Challonge est accessible (v2.1)
    const apiKey = getChallongeAPIKey();
    const checkResp = await fetch(
      `${CHALLONGE_V2_BASE}/tournaments/${challonge_slug}.json`,
      { headers: challongeHeaders(apiKey) }
    );
    if (!checkResp.ok) {
      res.status(400).json({ message: "Tournoi Challonge introuvable ou inaccessible." });
      return;
    }
    const checkBody: any = await checkResp.json();
    const tData = checkBody?.data?.attributes ?? {};
    const existingTournaments: RowDataPacket[] = await db.query(
      "SELECT COUNT(*) as cnt FROM season_challonge_tournament WHERE season_id = ?",
      [seasonId]
    );
    const displayOrder: number = existingTournaments[0]?.cnt ?? 0;
    await db.query(
      "INSERT INTO season_challonge_tournament (season_id, challonge_slug, label, display_order) VALUES (?, ?, ?, ?)",
      [seasonId, challonge_slug, label || tData.name || challonge_slug, displayOrder]
      // tData.name comes from v2.1 attributes object
    );
    res.json({ message: "Bracket ajouté avec succès.", name: tData.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/** DELETE /:season_id/challonge/tournaments/:tournament_id — supprimer un bracket */
router.delete("/:season_id/challonge/tournaments/:tournament_id", Utils.ensureAuthenticated, async (req, res) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const tournamentId = parseInt(req.params.tournament_id);
    const seasonRows: RowDataPacket[] = await db.query(
      "SELECT user_id FROM season WHERE id = ?",
      [seasonId]
    );
    if (!seasonRows.length) { res.status(404).json({ message: "Saison introuvable." }); return; }
    if (seasonRows[0].user_id !== req.user!.id && !Utils.superAdminCheck(req.user!)) {
      res.status(403).json({ message: "Non autorisé." }); return;
    }
    await db.query(
      "DELETE FROM season_challonge_tournament WHERE id = ? AND season_id = ?",
      [tournamentId, seasonId]
    );
    res.json({ message: "Bracket supprimé." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/** GET /:season_id/challonge/matches — tous les matchs de tous les brackets, enrichis */
router.get("/:season_id/challonge/matches", Utils.ensureAuthenticated, async (req, res) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const apiKey = getChallongeAPIKey();
    const tournaments = await getSeasonChallongeTournaments(seasonId);
    const { state, tournament_id } = req.query;

    // G5 match index (partagé entre tous les tournois)
    const g5Matches: RowDataPacket[] = await db.query(
      "SELECT id, team1_id, team2_id, challonge_id FROM `match` WHERE season_id = ?",
      [seasonId]
    );
    const g5ByChallongeId = new Map<number, number>();
    const g5ByTeamPair = new Map<string, number>();
    for (const m of g5Matches) {
      if (m.challonge_id) g5ByChallongeId.set(Number(m.challonge_id), m.id);
      const k1 = `${m.team1_id}:${m.team2_id}`;
      const k2 = `${m.team2_id}:${m.team1_id}`;
      if (!g5ByTeamPair.has(k1) || g5ByTeamPair.get(k1)! < m.id) g5ByTeamPair.set(k1, m.id);
      if (!g5ByTeamPair.has(k2) || g5ByTeamPair.get(k2)! < m.id) g5ByTeamPair.set(k2, m.id);
    }

    // Filtrer par tournament_id si précisé
    const filtered = tournament_id
      ? tournaments.filter(t => t.id === parseInt(tournament_id as string))
      : tournaments;

    const results = await Promise.all(
      filtered.map(t =>
        enrichChallongeMatches(
          t.challonge_slug as string,
          t.label as string,
          apiKey,
          state as string | undefined,
          g5ByChallongeId,
          g5ByTeamPair
        )
      )
    );

    res.json({ tournaments, matches: results.flat() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

/** GET /:season_id/challonge/matches/:challonge_match_id/prefill */
router.get("/:season_id/challonge/matches/:challonge_match_id/prefill", Utils.ensureAuthenticated, async (req, res) => {
  try {
    const seasonId = parseInt(req.params.season_id);
    const challongeMatchId = parseInt(req.params.challonge_match_id);
    if (isNaN(challongeMatchId)) throw new Error("ID de match Challonge invalide.");

    const apiKey = getChallongeAPIKey();
    const slug = await getSlugForMatch(seasonId, challongeMatchId, apiKey);

    // v2.1 — récupérer le match
    const cHeaders = challongeHeaders(apiKey);
    const mResp = await fetch(
      `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches/${challongeMatchId}.json`,
      { headers: cHeaders }
    );
    if (!mResp.ok) throw new Error(`Challonge API error: ${mResp.status}`);
    const mBody: any = await mResp.json();
    // v2.1: { data: { id, attributes: { state, round, ..., relationships: { player1, player2 } } } }
    const m = parseV2Match(mBody.data);

    const resolveParticipant = async (playerId: number | null) => {
      if (!playerId) return null;
      // v2.1 — récupérer le participant
      const pResp = await fetch(
        `${CHALLONGE_V2_BASE}/tournaments/${slug}/participants/${playerId}.json`,
        { headers: cHeaders }
      );
      if (!pResp.ok) return null;
      const pBody: any = await pResp.json();
      // v2.1: { data: { id, attributes: { name } } }
      const p = parseV2Participant(pBody.data);
      const rows: RowDataPacket[] = await db.query(
        "SELECT id, name FROM team WHERE challonge_team_id = ?",
        [String(p.id)]
      );
      return { id: p.id, name: p.display_name, local_team: rows[0] ?? null };
    };

    const [player1, player2] = await Promise.all([
      resolveParticipant(m.player1_id),
      resolveParticipant(m.player2_id)
    ]);

    const seasonRows: RowDataPacket[] = await db.query(
      "SELECT s.id, s.name, CONCAT('{', GROUP_CONCAT(DISTINCT CONCAT('\"',sc.cvar_name,'\": \"',sc.cvar_value,'\"')),'}') as cvars " +
      "FROM season s LEFT OUTER JOIN season_cvar sc ON s.id = sc.season_id WHERE s.id = ? GROUP BY s.id",
      [seasonId]
    );
    const season = seasonRows[0];
    if (season?.cvars) season.cvars = JSON.parse(season.cvars);

    const availableServers: RowDataPacket[] = await db.query(
      "SELECT gs.id, gs.display_name, gs.ip_string, gs.port, gs.public_server, gs.flag " +
      "FROM game_server gs WHERE gs.in_use = 0 AND (gs.public_server = 1 OR gs.user_id = ?) ORDER BY gs.display_name",
      [req.user!.id]
    );

    res.json({
      season_id: seasonId,
      season_name: season?.name ?? null,
      season_cvars: season?.cvars ?? null,
      team1: player1?.local_team ?? null,
      team2: player2?.local_team ?? null,
      max_maps: 1,
      challonge_match_id: challongeMatchId,
      challonge_match: {
        id: m.id,
        slug,
        state: m.state,
        round: m.round,
        suggested_play_order: m.suggested_play_order,
        scheduled_time: m.scheduled_time, // mapped from v2.1 attributes
        player1,
        player2
      },
      available_servers: availableServers
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: (err as Error).toString() });
  }
});

export default router;