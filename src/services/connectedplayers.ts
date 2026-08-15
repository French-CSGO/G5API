/** Tracks players currently connected to a live match's game server.
 * Populated by MatchZy's player_connect/player_disconnect webhook events
 * (see routes/v2/api.ts) — avoids RCON status polling.
 * @module services/connectedplayers
 */
import { db } from "./db.js";
import { RowDataPacket } from "mysql2";

export interface ConnectedPlayer {
  steamid: string;
  name: string;
  team: string;
  is_bot: boolean;
  connected_at: number;
}

const connectedByMatch = new Map<string, Map<string, ConnectedPlayer>>();

/** Resolves a player's team1/team2/coach_team1/coach_team2 assignment from
 * the match's own roster (team_auth_names), rather than trusting whatever
 * team MatchZy reports — MatchZy only assigns a connecting player to their
 * in-game side a moment after the connect event fires, so its own value can
 * lag behind the actual roster.
 */
async function resolveTeamKey(
  matchId: string | number,
  steamid: string,
  fallback: string
): Promise<string> {
  try {
    const matchRows: RowDataPacket[] = await db.query(
      "SELECT team1_id, team2_id FROM `match` WHERE id = ?",
      [matchId]
    );
    const team1Id = matchRows[0]?.team1_id;
    const team2Id = matchRows[0]?.team2_id;
    if (!team1Id && !team2Id) return fallback;

    const authRows: RowDataPacket[] = await db.query(
      "SELECT team_id, coach FROM team_auth_names WHERE auth = ? AND team_id IN (?, ?)",
      [steamid, team1Id, team2Id]
    );
    if (!authRows.length) return fallback;

    const base = authRows[0].team_id == team1Id ? "team1" : "team2";
    return authRows[0].coach ? `coach_${base}` : base;
  } catch {
    return fallback;
  }
}

class ConnectedPlayersService {
  static async onConnect(
    matchId: string | number,
    player: { steamid: string; name: string; team: string; is_bot: boolean }
  ): Promise<void> {
    const resolvedTeam = player.is_bot
      ? player.team
      : await resolveTeamKey(matchId, player.steamid, player.team);

    const key = String(matchId);
    let players = connectedByMatch.get(key);
    if (!players) {
      players = new Map();
      connectedByMatch.set(key, players);
    }
    players.set(player.steamid, {
      ...player,
      team: resolvedTeam,
      connected_at: Date.now(),
    });
  }

  static onDisconnect(matchId: string | number, steamid: string): void {
    connectedByMatch.get(String(matchId))?.delete(steamid);
  }

  static getConnected(matchId: string | number): ConnectedPlayer[] {
    return Array.from(connectedByMatch.get(String(matchId))?.values() ?? []);
  }
}

export default ConnectedPlayersService;
