/** Service class for all map flow related logic during a live game.
 * @module routes/v2
 * @requires express
 * @requires db
 */
import { db } from "./db.js";
import { TeamSpeak } from "ts3-nodejs-library";

/**
 * @const
 * Global Server Sent Emitter class for real time data.
 */
import GlobalEmitter from "../utility/emitter.js";

/**
 * @const
 * Utility library to check API key validity.
 */
import Utils from "../utility/utils.js";
import { Get5_OnGoingLive } from "../types/map_flow/Get5_OnGoingLive.js";
import { Response } from "express";
import { RowDataPacket } from "mysql2";
import { Get5_OnMatchPausedUnpaused } from "../types/map_flow/Get5_OnMatchPausedUnpaused.js";
import { Get5_OnPlayerDeath } from "../types/map_flow/Get5_OnPlayerDeath.js";
import { Get5_OnBombEvent } from "../types/map_flow/Get5_OnBombEvent.js";
import { Get5_OnRoundEnd } from "../types/map_flow/Get5_OnRoundEnd.js";
import { Get5_OnRoundStart } from "../types/map_flow/Get5_OnRoundStart.js";
import update_challonge_match from "./challonge.js";
import { sendPauseEvent, sendVetoCompleteEmbed } from "./discord.js";
import config from "config";

// ── TeamSpeak talk power levels ────────────────────────────────────────────
const TS_POWER = {
  LIVE:   45, // round en cours (post-freeze)
  FREEZE: 35, // entre les rounds / pause tactique
  TECH:   55, // pause technique ou admin
} as const;

// ── CS2 round constants ────────────────────────────────────────────────────
/** Last regulation round (MR12) */
const REG_ROUNDS = 24;
/** Rounds per OT period (MR3 → 6 rounds total per OT) */
const OT_LEN = 6;

// ── Per-match state ────────────────────────────────────────────────────────
/** true = round in live play (post-freeze), false = freeze time / between rounds */
const roundLiveState = new Map<string, boolean>();

/** Pending TS talk power changes deferred until freeze time (round end) */
interface PendingTsChange {
  team1Id?: number;
  team2Id?: number;
  power: number;
}
const pendingTalkPower = new Map<string, PendingTsChange>();

class MapFlowService {
  // ── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Sets both teams' TS channel talk power for a given match.
   * Silently ignores teams without TS configured.
   */
  private static async setTsMatchTeams(matchId: string, power: number): Promise<void> {
    try {
      const matchInfo: RowDataPacket[] = await db.query(
        "SELECT team1_id, team2_id FROM `match` WHERE id = ?",
        [matchId]
      );
      if (!matchInfo.length) return;
      const [t1, t2] = await Promise.all([
        db.query("SELECT ts_server, ts_channel_id FROM team WHERE id = ?", [matchInfo[0].team1_id]),
        db.query("SELECT ts_server, ts_channel_id FROM team WHERE id = ?", [matchInfo[0].team2_id]),
      ]);
      await Promise.all([
        MapFlowService.setTsChannelTalkPower(t1[0], power),
        MapFlowService.setTsChannelTalkPower(t2[0], power),
      ]);
    } catch (e) {
      console.error("[TS3] setTsMatchTeams error:", (e as Error).message);
    }
  }

  /**
   * Connects to a TeamSpeak server and sets a channel's needed talk power.
   * The ts_server format is "host:queryport" (e.g. "nuc1.infra.local:10011").
   */
  private static async setTsChannelTalkPower(
    tsRow: RowDataPacket | undefined,
    talkPower: number
  ): Promise<void> {
    if (!tsRow || !tsRow.ts_server || !tsRow.ts_channel_id) return;
    const [host, portStr] = String(tsRow.ts_server).split(":");
    const queryport = parseInt(portStr || "10011");
    const serverport = queryport - 30;
    const ts3 = await TeamSpeak.connect({
      host,
      queryport,
      serverport,
      username: "serveradmin",
      password: "80048821",
      nickname: "G5API",
    });
    try {
      await ts3.channelEdit(tsRow.ts_channel_id, { channel_needed_talk_power: talkPower });
    } finally {
      await ts3.quit();
    }
  }

  // ── Map / series flow ─────────────────────────────────────────────────────

  /**
   * Updates the database and emits mapStatUpdate when the map has gone live.
   * @param {Get5_OnGoingLive} event The OnGoingLive event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnGoingLive(
    event: Get5_OnGoingLive,
    res: Response
  ) {
    try {
      let sqlString: string;
      let mapStatInfo: RowDataPacket[];
      let vetoInfo: RowDataPacket[];
      let startTime: string = new Date()
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      let insUpdStatement: object;
      let mapName: string;
      let matchInfo: RowDataPacket[];

      sqlString = "SELECT map FROM veto WHERE match_id = ? AND pick_or_veto = 'pick' ORDER BY id";
      vetoInfo = await db.query(sqlString, [event.matchid]);
      if (vetoInfo.length) {
        mapName = vetoInfo[event.map_number]?.map;
      } else {
        sqlString = "SELECT veto_mappool FROM `match` WHERE id = ?";
        matchInfo = await db.query(sqlString, [event.matchid]);
        mapName = matchInfo[0].veto_mappool.split(" ")[event.map_number];
      }
      sqlString =
        "SELECT id FROM map_stats WHERE match_id = ? AND map_number = ?";
      mapStatInfo = await db.query(sqlString, [
        event.matchid,
        event.map_number
      ]);
      // Determine team1's first side from veto_side
      let team1FirstSide: string | null = null;
      const sidePickInfo: RowDataPacket[] = await db.query(
        `SELECT vs.team_name, vs.side, t1.name AS team1_name, t2.name AS team2_name
         FROM \`match\` m
         JOIN team t1 ON t1.id = m.team1_id
         JOIN team t2 ON t2.id = m.team2_id
         LEFT JOIN veto_side vs ON vs.match_id = m.id AND vs.map = ?
         WHERE m.id = ?`,
        [mapName, event.matchid]
      );
      if (sidePickInfo.length && sidePickInfo[0].team_name) {
        const pickerName: string = sidePickInfo[0].team_name;
        const pickedSide: string = sidePickInfo[0].side?.toUpperCase();
        if (pickerName === sidePickInfo[0].team1_name) {
          team1FirstSide = pickedSide === "CT" ? "CT" : "T";
        } else {
          team1FirstSide = pickedSide === "CT" ? "T" : "CT";
        }
      }

      if (mapStatInfo.length) {
        insUpdStatement = {
          map_number: event.map_number,
          map_name: mapName,
          ...(team1FirstSide !== null && { team1_first_side: team1FirstSide })
        };
        sqlString =
          "UPDATE map_stats SET ? WHERE match_id = ? AND map_number = ?";
        insUpdStatement = await db.buildUpdateStatement(insUpdStatement);
        await db.query(sqlString, [insUpdStatement, event.matchid, event.map_number]);
      } else {
        insUpdStatement = {
          match_id: event.matchid,
          map_number: event.map_number,
          map_name: mapName,
          start_time: startTime,
          team1_score: 0,
          team2_score: 0,
          team1_score_ct: 0,
          team1_score_t: 0,
          team2_score_ct: 0,
          team2_score_t: 0,
          team1_first_side: team1FirstSide
        };
        sqlString = "INSERT INTO map_stats SET ?";
        await db.query(sqlString, insUpdStatement);
        GlobalEmitter.emit("mapStatUpdate");
      }

      // TS: freeze time starting → FREEZE power
      await MapFlowService.setTsMatchTeams(String(event.matchid), TS_POWER.FREEZE);

      // Veto complete: send Discord embed on first map going live
      if (event.map_number === 0) {
        sendVetoCompleteEmbed(Number(event.matchid)).catch(() => {});
      }

      return res.status(200).send({ message: "Success" });
    } catch (error: unknown) {
      console.error(error);
      if (error instanceof Error)
        return res.status(500).send({ message: error.message });
      else return res.status(500).send({ message: error });
    }
  }

  /**
   * Updates the database and emits playerStatsUpdate when a player has died.
   * @param {Get5_OnPlayerDeath} event The Get5_OnPlayerDeath event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnPlayerDeath(
    event: Get5_OnPlayerDeath,
    res: Response
  ) {
    try {
      if (event.player?.is_bot) {
        res
          .status(200)
          .send({ message: "Bot players do not count towards stats." });
        return;
      }
      let sqlString: string;
      let mapInfo: RowDataPacket[];
      let insertObj: object;
      let playerTeamId: RowDataPacket[];

      sqlString =
        "SELECT id FROM map_stats WHERE match_id = ? AND map_number = ?";
      mapInfo = await db.query(sqlString, [event.matchid, event.map_number]);

      sqlString =
        "SELECT team_id FROM team_auth_names JOIN `match` m " +
        "ON (m.team1_id = team_id OR m.team2_id = team_id) WHERE m.id = ? AND auth = ?";
      playerTeamId = await db.query(sqlString, [event.matchid, event.player.steamid]);
      insertObj = {
        match_id: event.matchid,
        map_id: mapInfo[0].id,
        team_id: playerTeamId[0].team_id,
        player_steam_id: event.player.steamid,
        player_name: event.player.name,
        player_side: event.player.side,
        round_number: event.round_number,
        round_time: event.round_time,
        attacker_steam_id: event.attacker.steamid,
        attacker_name: event.attacker.name,
        attacker_side: event.attacker.side,
        weapon: event.weapon.name,
        bomb: event.bomb,
        headshot: event.headshot,
        thru_smoke: event.thru_smoke,
        attacker_blind: event.attacker_blind,
        no_scope: event.no_scope,
        suicide: event.suicide,
        friendly_fire: event.friendly_fire,
        assister_steam_id: event.assist?.player.steamid,
        assister_name: event.assist?.player.name,
        assister_side: event.assist?.player.side,
        assist_friendly_fire: event.assist?.friendly_fire,
        flash_assist: event.assist?.flash_assist
      };
      insertObj = await db.buildUpdateStatement(insertObj);
      sqlString = "INSERT INTO player_stat_extras SET ?";
      await db.query(sqlString, insertObj);

      GlobalEmitter.emit("playerStatsUpdate");
      return res.status(200).send({ message: "Success" });
    } catch (error: unknown) {
      console.error(error);
      if (error instanceof Error)
        return res.status(500).send({ message: error.message });
      else return res.status(500).send({ message: error });
    }
  }

  /**
   * Updates the database and emits bombEvent when a bomb has been planted or defused.
   * @param {Get5_OnBombEvent} event The Get5_OnBombEvent event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnBombEvent(
    event: Get5_OnBombEvent,
    res: Response,
    defused: boolean
  ) {
    try {
      let sqlString: string;
      let mapInfo: RowDataPacket[];
      let playerStatInfo: RowDataPacket[];
      let insObject: object;
      if (event.player?.is_bot) {
        res
          .status(200)
          .send({ message: "Bot players do not count towards stats." });
        return;
      }
      sqlString =
        "SELECT id FROM map_stats WHERE match_id = ? AND map_number = ?";
      mapInfo = await db.query(sqlString, [event.matchid, event.map_number]);
      sqlString =
        "SELECT id FROM player_stats WHERE match_id = ? AND map_id = ? AND steam_id = ?";
      playerStatInfo = await db.query(sqlString, [
        event.matchid,
        mapInfo[0].id,
        event.player.steamid
      ]);
      if (!playerStatInfo.length && !event.player?.is_bot) {
        let teamId: RowDataPacket[];
        sqlString =
          "SELECT t.id FROM team t JOIN team_auth_names ta ON ta.team_id = t.id WHERE ta.auth = ?";
        teamId = await db.query(sqlString, [event.player.steamid]);
        await Utils.updatePlayerStats(event.matchid, teamId[0].id, mapInfo[0].id, event.player, null);

        sqlString =
          "SELECT id FROM player_stats WHERE match_id = ? AND map_id = ? AND steam_id = ?";
        playerStatInfo = await db.query(sqlString, [
          event.matchid,
          mapInfo[0].id,
          event.player.steamid
        ]);
      }
      insObject = {
        match_id: event.matchid,
        map_id: mapInfo[0].id,
        player_stats_id: playerStatInfo[0].id,
        round_number: event.round_number,
        round_time: event.round_time,
        site: event.site,
        defused: defused,
        bomb_time_remaining: event?.bomb_time_remaining
      };

      insObject = await db.buildUpdateStatement(insObject);
      sqlString = "INSERT INTO match_bomb_plants SET ?";
      await db.query(sqlString, insObject);
      GlobalEmitter.emit("bombEvent");
      return res.status(200).send({ message: "Success" });
    } catch (error: unknown) {
      console.error(error);
      if (error instanceof Error)
        return res.status(500).send({ message: error.message });
      else return res.status(500).send({ message: error });
    }
  }

  /**
   * Updates the database and emits playerStatsUpdate when a round has ended.
   * Also snapshots regulation scores at round 24 and tracks per-OT scores.
   * @param {Get5_OnRoundEnd} event The Get5_OnRoundEnd event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnRoundEnd(
    event: Get5_OnRoundEnd,
    res: Response
  ) {
    try {
      // Query current map_stats INCLUDING scores BEFORE this round's update.
      // The pre-update scores are needed as the OT baseline.
      let sqlString: string =
        "SELECT id, team1_score_ct, team1_score_t, team2_score_ct, team2_score_t " +
        "FROM map_stats WHERE match_id = ? AND map_number = ?";
      let mapStatInfo: RowDataPacket[];
      let matchSeasonInfo: RowDataPacket[];
      let playerStats: RowDataPacket[];
      let singlePlayerStat: RowDataPacket[];

      mapStatInfo = await db.query(sqlString, [
        event.matchid,
        event.map_number
      ]);
      sqlString =
        "SELECT * FROM player_stats WHERE match_id = ? AND map_id = ?";
      playerStats = await db.query(sqlString, [
        event.matchid,
        mapStatInfo[0]?.id
      ]);

      // ── Player stats update ──────────────────────────────────────────────
      for (let player of event.team1.players) {
        singlePlayerStat = playerStats.filter(
          (dbPlayer) => dbPlayer.steam_id == player.steamid
        );
        await Utils.updatePlayerStats(
          event.matchid,
          event.team1.id,
          mapStatInfo[0].id,
          player,
          singlePlayerStat[0]?.id
        );
      }
      for (let player of event.team2.players) {
        singlePlayerStat = playerStats.filter(
          (dbPlayer) => dbPlayer.steam_id == player.steamid
        );
        await Utils.updatePlayerStats(
          event.matchid,
          event.team2.id,
          mapStatInfo[0].id,
          player,
          singlePlayerStat[0]?.id
        );
      }
      GlobalEmitter.emit("playerStatsUpdate");

      // ── Regulation score snapshot (end of round 24) ──────────────────────
      if (event.round_number === REG_ROUNDS) {
        await db.query(
          "UPDATE map_stats SET team1_reg_score_ct=?, team1_reg_score_t=?, team2_reg_score_ct=?, team2_reg_score_t=? WHERE id=?",
          [
            event.team1.score_ct, event.team1.score_t,
            event.team2.score_ct, event.team2.score_t,
            mapStatInfo[0].id
          ]
        );
      }

      // ── OT tracking ──────────────────────────────────────────────────────
      if (event.round_number > REG_ROUNDS) {
        const otNum = Math.ceil((event.round_number - REG_ROUNDS) / OT_LEN);
        const isFirstOtRound = (event.round_number - REG_ROUNDS - 1) % OT_LEN === 0;

        if (isFirstOtRound) {
          // Scores in DB right now (before this update) = baseline for this OT
          await db.query(
            `INSERT INTO map_stats_ot
               (map_stats_id, ot_number, team1_first_side,
                team1_score_ct, team1_score_t, team2_score_ct, team2_score_t,
                offset_t1_ct, offset_t1_t, offset_t2_ct, offset_t2_t)
             VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE team1_first_side = VALUES(team1_first_side)`,
            [
              mapStatInfo[0].id, otNum,
              event.team1.starting_side?.toUpperCase() ?? null,
              mapStatInfo[0].team1_score_ct, mapStatInfo[0].team1_score_t,
              mapStatInfo[0].team2_score_ct, mapStatInfo[0].team2_score_t
            ]
          );
        }

        // Update per-OT scores (cumulative - offset stored at OT start)
        const otRow: RowDataPacket[] = await db.query(
          "SELECT offset_t1_ct, offset_t1_t, offset_t2_ct, offset_t2_t FROM map_stats_ot WHERE map_stats_id = ? AND ot_number = ?",
          [mapStatInfo[0].id, otNum]
        );
        if (otRow.length) {
          await db.query(
            `UPDATE map_stats_ot SET team1_score_ct=?, team1_score_t=?, team2_score_ct=?, team2_score_t=?
             WHERE map_stats_id=? AND ot_number=?`,
            [
              event.team1.score_ct - otRow[0].offset_t1_ct,
              event.team1.score_t  - otRow[0].offset_t1_t,
              event.team2.score_ct - otRow[0].offset_t2_ct,
              event.team2.score_t  - otRow[0].offset_t2_t,
              mapStatInfo[0].id, otNum
            ]
          );
        }
      }

      // ── Map stats update ─────────────────────────────────────────────────
      sqlString = "UPDATE map_stats SET ? WHERE id = ?";
      const insUpdStatement = {
        team1_score:    event.team1.score,
        team1_score_ct: event.team1.score_ct,
        team1_score_t:  event.team1.score_t,
        team2_score:    event.team2.score,
        team2_score_ct: event.team2.score_ct,
        team2_score_t:  event.team2.score_t
      };
      await db.query(sqlString, [insUpdStatement, mapStatInfo[0].id]);

      // Challonge update if needed
      sqlString = "SELECT max_maps, season_id, team1_id, team2_id FROM `match` WHERE id = ?";
      matchSeasonInfo = await db.query(sqlString, [event.matchid]);
      if (matchSeasonInfo[0]?.season_id) {
        await update_challonge_match(
          event.matchid,
          matchSeasonInfo[0].season_id,
          matchSeasonInfo[0].team1_id,
          matchSeasonInfo[0].team2_id,
          matchSeasonInfo[0].max_maps
        );
      }
      GlobalEmitter.emit("mapStatUpdate");

      // ── TS: freeze time between rounds ───────────────────────────────────
      const matchKey = String(event.matchid);
      roundLiveState.set(matchKey, false);

      // Si une pause (tactique ou tech) était différée, l'appliquer maintenant
      const pending = pendingTalkPower.get(matchKey);
      if (pending) {
        pendingTalkPower.delete(matchKey);
        await MapFlowService.setTsMatchTeams(matchKey, pending.power);
      } else {
        await MapFlowService.setTsMatchTeams(matchKey, TS_POWER.FREEZE);
      }

      return res.status(200).send({ message: "Success" });
    } catch (error: unknown) {
      console.error(error);
      if (error instanceof Error)
        return res.status(500).send({ message: error.message });
      else return res.status(500).send({ message: error });
    }
  }

  /**
   * Updates the database and emits playerStatsUpdate when a round has been restored and the match has started again.
   * @param {Get5_OnRoundStart} event The Get5_OnRoundStart event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnRoundStart(
    event: Get5_OnRoundStart,
    res: Response
  ) {
    let sqlString: string;
    let mapStatInfo: RowDataPacket[];
    sqlString = "SELECT round_restored, id FROM map_stats WHERE match_id = ? AND map_number = ?";
    mapStatInfo = await db.query(sqlString, [event.matchid, event.map_number]);

    // Freeze time started
    const matchKey = String(event.matchid);
    roundLiveState.set(matchKey, false);
    // TS: stay at FREEZE (explicit, in case of backup restore)
    await MapFlowService.setTsMatchTeams(matchKey, TS_POWER.FREEZE);

    if (mapStatInfo[0]?.round_restored) {
      sqlString =
        "DELETE FROM match_bomb_plants WHERE round_number > ? AND match_id = ? AND map_id = ?";
      await db.query(sqlString, [
        event.round_number,
        event.matchid,
        mapStatInfo[0].id
      ]);

      sqlString =
        "DELETE FROM player_stat_extras WHERE match_id = ? AND map_id = ? AND round_number > ?";
      await db.query(sqlString, [
        event.matchid,
        mapStatInfo[0].id,
        event.round_number
      ]);
      GlobalEmitter.emit("playerStatsUpdate");
    }
    return res.status(200).send({ message: "Success" });
  }

  /** Called when freeze time ends and the round goes live. */
  static async OnRoundLive(event: { matchid: string }, res: Response) {
    const matchKey = String(event.matchid);
    roundLiveState.set(matchKey, true);
    // TS: round is live
    await MapFlowService.setTsMatchTeams(matchKey, TS_POWER.LIVE);
    return res.status(200).send({ message: "Success" });
  }

  /**
   * Updates the database and emits matchUpdate when a match has been paused or unpaused.
   * Also manages TeamSpeak channel talk power and emits a formatted serverEvent SSE.
   * @param {Get5_OnMatchPausedUnpaused} event The Get5_OnMatchPausedUnpaused event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnMatchPausedUnPaused(
    event: Get5_OnMatchPausedUnpaused,
    res: Response
  ) {
    let sqlString: string;
    let matchInfo: RowDataPacket[];
    let pauseInfo: RowDataPacket[];
    let insUpdStatement: object;
    let teamPaused: string;

    sqlString = "SELECT team1_id, team2_id, team1_string, team2_string FROM `match` WHERE id = ?";
    matchInfo = await db.query(sqlString, [event.matchid]);

    sqlString = "SELECT * FROM match_pause WHERE match_id = ?";
    pauseInfo = await db.query(sqlString, [event.matchid]);

    if (event.team == "team1") teamPaused = matchInfo[0].team1_string;
    else if (event.team == "team2") teamPaused = matchInfo[0].team2_string;
    else teamPaused = "Admin";

    if (pauseInfo.length) {
      sqlString = "UPDATE match_pause SET ? WHERE match_id = ?";
      insUpdStatement = {
        pause_type: event.pause_type,
        team_paused: teamPaused,
        side: event.side,
        paused: event.event == "game_paused" ? true : false
      };
      insUpdStatement = await db.buildUpdateStatement(insUpdStatement);
      await db.query(sqlString, [insUpdStatement, event.matchid]);
    } else {
      sqlString = "INSERT INTO match_pause SET ?";
      insUpdStatement = {
        match_id: event.matchid,
        pause_type: event.pause_type,
        team_paused: teamPaused,
        side: event.side,
        paused: event.event == "game_paused" ? true : false
      };
      insUpdStatement = await db.buildUpdateStatement(insUpdStatement);
      await db.query(sqlString, insUpdStatement);
    }

    // ── TeamSpeak talk power management ───────────────────────────────────
    // Tactical → FREEZE (35) | Technical/Admin → TECH (55)
    // Appliqué uniquement en freeze time (après round end, avant round start).
    // Si le round est en cours, différé jusqu'au prochain round end.
    const isPaused = event.event === "game_paused";
    const isTactical = event.pause_type === "tactical";
    const matchKey = String(event.matchid);

    try {
      if (isPaused) {
        const targetPower = isTactical ? TS_POWER.FREEZE : TS_POWER.TECH;
        const isLive = roundLiveState.get(matchKey) === true;
        if (isLive) {
          // Round en cours : différer jusqu'au round end
          pendingTalkPower.set(matchKey, {
            team1Id: matchInfo[0].team1_id,
            team2Id: matchInfo[0].team2_id,
            power: targetPower,
          });
        } else {
          // En freeze time : appliquer immédiatement
          await MapFlowService.setTsMatchTeams(matchKey, targetPower);
        }
      } else {
        // Unpause : annuler tout différé et restaurer l'état courant
        pendingTalkPower.delete(matchKey);
        const power = roundLiveState.get(matchKey) === true ? TS_POWER.LIVE : TS_POWER.FREEZE;
        await MapFlowService.setTsMatchTeams(matchKey, power);
      }
    } catch (tsErr) {
      console.error("[TS3] Erreur gestion talk power:", (tsErr as Error).message);
    }

    // ── Server event SSE notification ─────────────────────────────────────
    const pauseTypeLabel: Record<string, string> = {
      tech:     "Pause Technique",
      admin:    "Pause Admin",
      tactical: "Pause Tactique",
    };
    const sideLabel =
      event.side === "T" ? "Terrorist" :
      event.side === "CT" ? "Counter-Terrorist" : "Admin";
    const typeLabel = pauseTypeLabel[event.pause_type] ?? event.pause_type;
    const statusIcon = isPaused ? "🔴" : "🟢";
    const statusWord = isPaused ? "PAUSE" : "REPRISE";
    const message = `${statusIcon} [${statusWord}] ${teamPaused} | ${sideLabel} | ${typeLabel}`;

    GlobalEmitter.emit("serverEvent", {
      matchid: event.matchid,
      message,
      event: event.event,
      team: teamPaused,
      side: sideLabel,
      pause_type: typeLabel,
    });

    const hostname: string = config.get("server.hostname");
    const matchUrl = `${hostname.replace(/\/$/, "")}/match/${event.matchid}`;
    sendPauseEvent({
      matchid: String(event.matchid),
      matchUrl,
      isPaused,
      teamName: teamPaused,
      side: sideLabel,
      pauseType: typeLabel,
    }).catch(() => {});

    GlobalEmitter.emit("matchUpdate");
    return res.status(200).send({ message: "Success" });
  }
}

export default MapFlowService;
