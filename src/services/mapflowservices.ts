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
import { sendPauseEvent } from "./discord.js";
import config from "config";

/**
 * @class
 * Map flow service class for live games.
 */
/** Per-match round state: true = round in live play (post-freeze), false = freeze time or between rounds */
const roundLiveState = new Map<string, boolean>();

/** Pending TS talk power changes deferred until round end */
interface PendingTsChange {
  team1Id?: number;
  team2Id?: number;
  power: number;
}
const pendingTalkPower = new Map<string, PendingTsChange>();

class MapFlowService {
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
      if (mapStatInfo.length) {
        insUpdStatement = {
          map_number: event.map_number,
          map_name: mapName
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
          team2_score: 0
        };
        sqlString = "INSERT INTO map_stats SET ?";
        await db.query(sqlString, insUpdStatement);
        GlobalEmitter.emit("mapStatUpdate");
        return res.status(200).send({ message: "Success" });
      }
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
      let playerStatVals: RowDataPacket[];
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
      // If player does not have player stats yet, insert them.
      if (!playerStatInfo.length && !event.player?.is_bot) {
        let teamId: RowDataPacket[];
        sqlString =
          "SELECT t.id FROM team t JOIN team_auth_names ta ON ta.team_id = t.id WHERE ta.auth = ?";
        teamId = await db.query(sqlString, [event.player.steamid]);
        await Utils.updatePlayerStats(event.matchid, teamId[0].id, mapInfo[0].id, event.player, null);

        // Grab player info again!
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
   * @param {Get5_OnRoundEnd} event The Get5_OnRoundEnd event provided from the game server.
   * @param {Response} res The express response object to send status responses to the game server.
   */
  static async OnRoundEnd(
    event: Get5_OnRoundEnd,
    res: Response
  ) {
    try {
      let sqlString: string =
        "SELECT id FROM map_stats WHERE match_id = ? AND map_number = ?";
      let insUpdStatement: object;
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
      
      // Update map stats. Grab season info
      sqlString = "UPDATE map_stats SET ? WHERE id = ?";
      insUpdStatement = {
        team1_score: event.team1.score,
        team2_score: event.team2.score
      }
      await db.query(sqlString, [insUpdStatement, mapStatInfo[0].id]);
      // Update Challonge info if needed.
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

      // Round ended: mark not live, apply any deferred TS talk power change
      const matchKey = String(event.matchid);
      roundLiveState.set(matchKey, false);
      const pending = pendingTalkPower.get(matchKey);
      if (pending) {
        pendingTalkPower.delete(matchKey);
        const ops: Promise<void>[] = [];
        if (pending.team1Id) {
          const t1: RowDataPacket[] = await db.query("SELECT ts_server, ts_channel_id FROM team WHERE id = ?", [pending.team1Id]);
          ops.push(MapFlowService.setTsChannelTalkPower(t1[0], pending.power));
        }
        if (pending.team2Id) {
          const t2: RowDataPacket[] = await db.query("SELECT ts_server, ts_channel_id FROM team WHERE id = ?", [pending.team2Id]);
          ops.push(MapFlowService.setTsChannelTalkPower(t2[0], pending.power));
        }
        await Promise.all(ops).catch(e => console.error("[TS3] Erreur pending talk power:", (e as Error).message));
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
    // Check if round was backed up and nuke the additional player stats and bomb plants.
    sqlString = "SELECT round_restored, id FROM map_stats WHERE match_id = ? AND map_number = ?";
    mapStatInfo = await db.query(sqlString, [event.matchid, event.map_number]);
    // Freeze time started: round is no longer live
    const _mk = String(event.matchid);
    roundLiveState.set(_mk, false);

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
      // Only emit if there was an actual update.
      GlobalEmitter.emit("playerStatsUpdate");
    }
    return res.status(200).send({ message: "Success" });
  }

  /** Called when freeze time ends and the round goes live. Sets roundLiveState explicitly. */
  static async OnRoundLive(event: { matchid: string }, res: Response) {
    const mk = String(event.matchid);
    roundLiveState.set(mk, true);
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

    // ── TeamSpeak channel talk power management ────────────────────────────
    const isPaused = event.event === "game_paused";
    const isTactical = event.pause_type === "tactical";

    if (!isTactical) {
      const matchKey = String(event.matchid);
      try {
        if (isPaused) {
          const isLive = roundLiveState.get(matchKey) === true;
          if (event.team === "admin") {
            // Admin pause: both teams
            if (isLive) {
              // Round in progress: defer until round end
              pendingTalkPower.set(matchKey, {
                team1Id: matchInfo[0].team1_id,
                team2Id: matchInfo[0].team2_id,
                power: 60,
              });
              console.log(`[TS3] Pause admin différée (round en cours) — match ${String(matchKey).replace(/[\r\n]/g, " ")}`);
            } else {
              // Freeze time or between rounds: apply immediately
              const [t1, t2] = await Promise.all([
                db.query("SELECT ts_server, ts_channel_id FROM team WHERE id = ?", [matchInfo[0].team1_id]),
                db.query("SELECT ts_server, ts_channel_id FROM team WHERE id = ?", [matchInfo[0].team2_id]),
              ]);
              await Promise.all([
                MapFlowService.setTsChannelTalkPower(t1[0], 60),
                MapFlowService.setTsChannelTalkPower(t2[0], 60),
              ]);
            }
          } else {
            // Tech pause: only the pausing team
            const teamId = event.team === "team1" ? matchInfo[0].team1_id : matchInfo[0].team2_id;
            if (isLive) {
              pendingTalkPower.set(matchKey, { team1Id: teamId, power: 60 });
              console.log(`[TS3] Pause tech différée (round en cours) — match ${String(matchKey).replace(/[\r\n]/g, " ")}`);
            } else {
              const tsInfo: RowDataPacket[] = await db.query(
                "SELECT ts_server, ts_channel_id FROM team WHERE id = ?", [teamId]
              );
              await MapFlowService.setTsChannelTalkPower(tsInfo[0], 60);
            }
          }
        } else {
          // Unpause: always apply immediately + cancel any pending
          pendingTalkPower.delete(matchKey);
          const [t1, t2] = await Promise.all([
            db.query("SELECT ts_server, ts_channel_id FROM team WHERE id = ?", [matchInfo[0].team1_id]),
            db.query("SELECT ts_server, ts_channel_id FROM team WHERE id = ?", [matchInfo[0].team2_id]),
          ]);
          await Promise.all([
            MapFlowService.setTsChannelTalkPower(t1[0], 40),
            MapFlowService.setTsChannelTalkPower(t2[0], 40),
          ]);
        }
      } catch (tsErr) {
        console.error("[TS3] Erreur gestion talk power:", (tsErr as Error).message);
      }
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
    const ts3 = await TeamSpeak.connect({ host, queryport, serverport, username: "serveradmin", password: "80048821", nickname: "G5API" });
    try {
      await ts3.channelEdit(tsRow.ts_channel_id, { channel_needed_talk_power: talkPower });
    } finally {
      await ts3.quit();
    }
  }
}

export default MapFlowService;
