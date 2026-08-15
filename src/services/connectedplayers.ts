/** Tracks players currently connected to a live match's game server.
 * Populated by MatchZy's player_connect/player_disconnect webhook events
 * (see routes/v2/api.ts) — avoids RCON status polling.
 * @module services/connectedplayers
 */

export interface ConnectedPlayer {
  steamid: string;
  name: string;
  team: string;
  is_bot: boolean;
  connected_at: number;
}

const connectedByMatch = new Map<string, Map<string, ConnectedPlayer>>();

class ConnectedPlayersService {
  static onConnect(
    matchId: string | number,
    player: { steamid: string; name: string; team: string; is_bot: boolean }
  ): void {
    const key = String(matchId);
    let players = connectedByMatch.get(key);
    if (!players) {
      players = new Map();
      connectedByMatch.set(key, players);
    }
    players.set(player.steamid, { ...player, connected_at: Date.now() });
  }

  static onDisconnect(matchId: string | number, steamid: string): void {
    connectedByMatch.get(String(matchId))?.delete(steamid);
  }

  static getConnected(matchId: string | number): ConnectedPlayer[] {
    return Array.from(connectedByMatch.get(String(matchId))?.values() ?? []);
  }
}

export default ConnectedPlayersService;
