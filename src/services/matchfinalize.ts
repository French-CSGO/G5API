/**
 * Shared logic to bring a match's game server online and announce the match,
 * used both right after normal match creation and after a pre-match web veto
 * finishes (see prevetoservice.ts).
 */
import config from "config";
import { RowDataPacket } from "mysql2";

import { db } from "./db.js";
import GameServer from "../utility/serverrcon.js";
import GlobalEmitter from "../utility/emitter.js";
import { startAndWait, isEnabled as pterodactylEnabled } from "./pterodactyl.js";
import { announceNewMatch, updateScoreboard, sendGotvMatchEmbed } from "./discord.js";

export async function finalizeMatchServer(matchId: number): Promise<void> {
  const matchRows: RowDataPacket[] = await db.query(
    "SELECT server_id, team1_id, team2_id, api_key FROM `match` WHERE id = ?",
    [matchId]
  );
  if (!matchRows.length) return;
  const { server_id, team1_id, team2_id, api_key } = matchRows[0];

  if (server_id != null) {
    const serveInfo: RowDataPacket[] = await db.query(
      "SELECT rcon_password, ip_string, port, pterodactyl_id FROM game_server WHERE id=?",
      [server_id]
    );
    if (serveInfo.length) {
      if (pterodactylEnabled() && serveInfo[0].pterodactyl_id) {
        await startAndWait(
          serveInfo[0].pterodactyl_id,
          serveInfo[0].ip_string,
          serveInfo[0].port,
          serveInfo[0].rcon_password
        );
      }

      const newServer: GameServer = new GameServer(
        serveInfo[0].ip_string,
        serveInfo[0].port,
        serveInfo[0].rcon_password
      );
      if ((await newServer.isServerAlive()) && (await newServer.isGet5Available())) {
        await db.query("UPDATE game_server SET in_use = 1 WHERE id = ?", [server_id]);

        const get5Version: string = await newServer.getGet5Version();
        await db.query("UPDATE `match` SET plugin_version = ? WHERE id = ?", [
          get5Version,
          matchId
        ]);

        const prepared = await newServer.prepareGet5Match(
          config.get("server.apiURL") + "/matches/" + matchId + "/config",
          api_key
        );
        if (!prepared) {
          console.error(
            `Match ${matchId}: prepareGet5Match failed, server did not accept the config.`
          );
        }
      }
    }
  }

  announceNewMatch(matchId);
  updateScoreboard();
  GlobalEmitter.emit("matchUpdate");

  if (server_id != null) {
    try {
      const gotvServerSql: string =
        "SELECT gs.ip_string, gs.port, t1.name AS team1_name, t2.name AS team2_name " +
        "FROM game_server gs " +
        "JOIN team t1 ON t1.id = ? " +
        "JOIN team t2 ON t2.id = ? " +
        "WHERE gs.id = ?";
      const gotvInfo: RowDataPacket[] = await db.query(gotvServerSql, [
        team1_id,
        team2_id,
        server_id
      ]);
      if (gotvInfo.length > 0) {
        const matchUrl = `${config.get("server.apiURL")}/matches/${matchId}`;
        await sendGotvMatchEmbed({
          matchId,
          team1Name: gotvInfo[0].team1_name,
          team2Name: gotvInfo[0].team2_name,
          serverIp: gotvInfo[0].ip_string,
          serverPort: gotvInfo[0].port,
          matchUrl
        });
      }
    } catch (gotvErr) {
      console.error("GOTV webhook error:", (gotvErr as Error).message);
    }
  }
}
