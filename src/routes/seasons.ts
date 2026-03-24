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

import { getSetting, getSettingBool } from "../services/settings.js";

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
  "/myseasons/available",
  Utils.ensureAuthenticated,
  async (req, res, next) => {
    let sql: string;
    let seasons: RowDataPacket[];
    try {
      // Check if super admin, if they are use this query.
      if (req.user && Utils.superAdminCheck(req.user)) {
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
          cvar_name: key.replace(/"/g, '\\"'),
          cvar_value: typeof defaultCvar[key] === 'string' ? defaultCvar[key].replace(/"/g, '\\"').replace(/\\/g, '\\\\') : defaultCvar[key]
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
            cvar_name: key.replace(/"/g, '\\"'),
            cvar_value: typeof defaultCvar[key] === 'string' ? defaultCvar[key].replace(/"/g, '\\"').replace(/\\/g, '\\\\') : defaultCvar[key],
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
      console.log("Toornament id : ",rawTournamentId)
      const result = await handleToornamentImport(rawTournamentId, req.user!.id, req.body[0]);
      return res.json(result);
    }


    const userInfo: RowDataPacket[] = await db.query("SELECT challonge_api_key FROM user WHERE id = ?", [req.user!.id]);
    let challongeAPIKey: string | undefined | null = Utils.decrypt(userInfo[0].challonge_api_key);
    if (!challongeAPIKey) {
      throw "No challonge API key provided for user.";
    }

    let tournamentId: string = req.body[0].tournament_id;
    let challongeResponse: any = await fetch(
      "https://api.challonge.com/v1/tournaments/" +
      tournamentId +
      ".json?api_key=" +
      challongeAPIKey +
      "&include_participants=1");

    let challongeData = await challongeResponse.json()
    if (challongeData) {
      // Insert the season.
      let sqlString: string = "INSERT INTO season SET ?";
      let seasonData: SeasonObject = {
        user_id: req.user?.id,
        name: challongeData.tournament.name,
        start_date: new Date(challongeData.tournament.created_at),
        is_challonge: true,
        challonge_svg: challongeData.tournament.live_image_url,
        challonge_url: tournamentId
      };
      const insertSeason: RowDataPacket[] = await db.query(sqlString, seasonData);
      // Check if teams were already in the call and add them to the database.
      if (req.body[0]?.import_teams && challongeData.tournament.participants) {
        sqlString = "INSERT INTO team (user_id, name, tag, challonge_team_id) VALUES ?";
        let teamArray: Array<Array<Object>> = [];
        challongeData.tournament.participants.forEach(async (team: { participant: { display_name: string; id: Object; }; }) => {
          teamArray.push([
            req.user!.id,
            team.participant.display_name.substring(0, 40),
            team.participant.display_name.substring(0, 40),
            team.participant.id
          ]);
        });
        await db.query(sqlString, [teamArray]);
      }



      
      res.json({
        message: "Challonge season imported successfully!",
        chal_res: challongeData.tournament.created_at,
        //@ts-ignore
        id: insertSeason.insertId,
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
      const [range, total] = contentRange.split("/");
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

    const enriched = allMatches.map(match => ({
      ...match,
      opponents: match.opponents.map(opp => ({
        ...opp,
        local_team: opp.participant ? (teamByChallongeId.get(String(opp.participant.id)) ?? null) : null
      }))
    }));

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

    // Validate Toornament match ID to prevent misuse in outbound requests
    // Adjust the regex as needed to match the exact format used by Toornament IDs.
    const toornamentMatchIdPattern = /^[A-Za-z0-9_-]+$/;
    if (!toornamentMatchId || !toornamentMatchIdPattern.test(toornamentMatchId)) {
      return res.status(400).json({ message: "Invalid Toornament match ID." });
    }

    const tournamentId = await getSeasonToornamentId(seasonId);
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
    const matchResponse = await fetch(
      `https://api.toornament.com/organizer/v2/matches/${toornamentMatchId}?tournament_ids=${tournamentId}`,
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
    // Validate matchId to avoid using arbitrary user-controlled data in the request URL path
    if (!/^[A-Za-z0-9_-]+$/.test(matchId)) {
      return res.status(400).json({ message: "Invalid match_id" });
    }
    const { scheduled_datetime } = req.body;
    if (!scheduled_datetime) return res.status(400).json({ message: "scheduled_datetime is required" });

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

export default router;