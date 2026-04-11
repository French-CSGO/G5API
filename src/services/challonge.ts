/** Fetch for Challonge API v2.1 integration.
 * @const
 */
import fetch from "node-fetch";

import {
  CHALLONGE_V2_BASE,
  challongeHeaders,
  parseV2Match,
  buildMatchPutBody,
  buildMatchStateBody,
  buildTournamentStateBody
} from "../utility/challongeV2.js";

import { getSetting } from "./settings.js";

import update_toornament_match from "./toornament.js";

/** Database module.
 * @const
 */
import {db} from "../services/db.js";

/**
 * @const
 * Global Server Sent Emitter class for real time data.
 */
import GlobalEmitter from "../utility/emitter.js";
import { RowDataPacket } from "mysql2";

/*** A PUT call to Challonge v2.1 to update a match that is currently being played.
 * @function
 * @memberof module:legacy/api
 * @param {number} match_id - The internal ID of the match being played.
 * @param {number} season_id - The internal ID of the current season of the match being played.
 * @param {number} team1_id - The internal team ID of the first team.
 * @param {number} team2_id - The internal team ID of the second team.
 * @param {number} num_maps - The number of maps in the current match.
 * @param {string} [winner=null] - The string value representing the winner of the match.
 */
export default
async function update_challonge_match(
  match_id: number | string,
  season_id: number,
  team1_id: number,
  team2_id: number,
  num_maps: number,
  winner: string | null = null
): Promise<void> {
  // Récupérer la saison
  const seasonInfo: RowDataPacket[] = await db.query(
    "SELECT id, challonge_url, user_id, is_challonge FROM season WHERE id = ?",
    [season_id]
  );
  if (!seasonInfo.length || !seasonInfo[0].is_challonge) return;

  // Toornament : déléguer
  if (seasonInfo[0].challonge_url?.startsWith("t:")) {
    update_toornament_match(seasonInfo[0].challonge_url.slice(2), match_id, team1_id, team2_id, num_maps, winner);
    return;
  }

  // Récupérer la clé API Challonge depuis les paramètres système
  const decryptedKey = getSetting("challonge.apiKey");
  if (!decryptedKey) return;

  const headers = challongeHeaders(decryptedKey);

  // Trouver le challonge_id stocké sur le match G5
  const matchRow: RowDataPacket[] = await db.query(
    "SELECT challonge_id FROM `match` WHERE id = ?",
    [match_id]
  );
  const challongeMatchId: number | null = matchRow[0]?.challonge_id ?? null;

  // Récupérer tous les brackets de la saison
  const tournaments: RowDataPacket[] = await db.query(
    "SELECT challonge_slug FROM season_challonge_tournament WHERE season_id = ? ORDER BY display_order ASC",
    [season_id]
  );

  // Fallback sur challonge_url si pas de brackets dans la nouvelle table
  const slugList: string[] = tournaments.length > 0
    ? tournaments.map(t => t.challonge_slug as string)
    : (seasonInfo[0].challonge_url ? [seasonInfo[0].challonge_url as string] : []);

  if (!slugList.length) return;

  const team1ChallongeId: RowDataPacket[] = await db.query(
    "SELECT challonge_team_id FROM team WHERE id = ?",
    [team1_id]
  );
  const team2ChallongeId: RowDataPacket[] = await db.query(
    "SELECT challonge_team_id FROM team WHERE id = ?",
    [team2_id]
  );

  const t1cid: number = team1ChallongeId[0].challonge_team_id;
  const t2cid: number = team2ChallongeId[0].challonge_team_id;

  for (const slug of slugList) {
    let matchData: any | null = null;

    if (challongeMatchId) {
      // Cherche directement par ID de match Challonge (v2.1)
      const resp = await fetch(
        `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches/${challongeMatchId}.json`,
        { headers }
      );
      if (!resp.ok) continue;
      const body: any = await resp.json();
      // v2.1 single match response: { data: { id, attributes: { ... } } }
      if (body?.data) matchData = parseV2Match(body.data);
    } else {
      // Fallback : récupère tous les matchs ouverts et filtre par participants
      const resp = await fetch(
        `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches.json?state=open&per_page=500`,
        { headers }
      );
      if (!resp.ok) continue;
      const body: any = await resp.json();
      // v2.1 list response: { data: [ { id, attributes: { ... } } ] }
      const allMatches: any[] = Array.isArray(body?.data) ? body.data.map(parseV2Match) : [];
      matchData = allMatches.find(m =>
        (m.player1_id === t1cid && m.player2_id === t2cid) ||
        (m.player2_id === t1cid && m.player1_id === t2cid)
      ) ?? null;
    }

    if (!matchData) continue;

    // Récupérer tous les scores par map (live + terminés), triés par map_number
    const mapStatsRows: RowDataPacket[] = await db.query(
      "SELECT team1_score, team2_score FROM map_stats WHERE match_id = ? ORDER BY map_number ASC",
      [match_id]
    );

    // v2.1 : le PUT utilise participant_id explicite, pas besoin de swapper selon player1/player2
    const team1Scores: number[] = mapStatsRows.map(r => r.team1_score);
    const team2Scores: number[] = mapStatsRows.map(r => r.team2_score);

    // PUT v2.1 — mise à jour du score
    await fetch(
      `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches/${matchData.id}.json`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify(buildMatchPutBody(t1cid, t2cid, team1Scores, team2Scores, winner))
      }
    );

    // Vérifier s'il reste des matchs ouverts dans CE bracket
    const openResp = await fetch(
      `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches.json?state=open&per_page=500`,
      { headers }
    );
    const openBody: any = await openResp.json();
    const openMatches: any[] = Array.isArray(openBody?.data) ? openBody.data : [];
    if (openMatches.length === 0) {
      // Finaliser ce bracket via change_state
      await fetch(
        `${CHALLONGE_V2_BASE}/tournaments/${slug}/change_state.json`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify(buildTournamentStateBody("finalize"))
        }
      );
    }

    break; // match trouvé et mis à jour
  }

  // Vérifier si TOUS les brackets de la saison sont terminés pour clore la saison
  let allFinished = true;
  for (const slug of slugList) {
    const openResp = await fetch(
      `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches.json?state=open&per_page=500`,
      { headers }
    );
    const openBody: any = await openResp.json();
    const openMatches: any[] = Array.isArray(openBody?.data) ? openBody.data : [];
    if (openMatches.length > 0) { allFinished = false; break; }
  }
  if (allFinished && slugList.length > 0) {
    await db.query(
      "UPDATE season SET end_date = ? WHERE id = ?",
      [new Date().toISOString().slice(0, 19).replace("T", " "), seasonInfo[0].id]
    );
    GlobalEmitter.emit("seasonUpdate");
  }
}

/** Marks a Challonge match as underway. Called when the first map goes live. */
export async function mark_challonge_match_underway(
  match_id: number | string,
  season_id: number,
  team1_id: number,
  team2_id: number
): Promise<void> {
  const seasonInfo: RowDataPacket[] = await db.query(
    "SELECT id, challonge_url FROM season WHERE id = ?",
    [season_id]
  );
  if (!seasonInfo.length) return;
  if (seasonInfo[0].challonge_url?.startsWith("t:")) return;

  const decryptedKey = getSetting("challonge.apiKey");
  if (!decryptedKey) return;

  const headers = challongeHeaders(decryptedKey);

  const tournaments: RowDataPacket[] = await db.query(
    "SELECT challonge_slug FROM season_challonge_tournament WHERE season_id = ? ORDER BY display_order ASC",
    [season_id]
  );
  const slugList: string[] = tournaments.length > 0
    ? tournaments.map(t => t.challonge_slug as string)
    : (seasonInfo[0].challonge_url ? [seasonInfo[0].challonge_url as string] : []);
  if (!slugList.length) return;

  const t1Row: RowDataPacket[] = await db.query("SELECT challonge_team_id FROM team WHERE id = ?", [team1_id]);
  const t2Row: RowDataPacket[] = await db.query("SELECT challonge_team_id FROM team WHERE id = ?", [team2_id]);
  const t1cid: number = t1Row[0]?.challonge_team_id;
  const t2cid: number = t2Row[0]?.challonge_team_id;
  if (!t1cid || !t2cid) return;

  for (const slug of slugList) {
    const resp = await fetch(
      `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches.json?state=open&per_page=500`,
      { headers }
    );
    if (!resp.ok) continue;
    const body: any = await resp.json();
    const allMatches: any[] = Array.isArray(body?.data) ? body.data.map(parseV2Match) : [];
    const matchData = allMatches.find(m =>
      (m.player1_id === t1cid && m.player2_id === t2cid) ||
      (m.player2_id === t1cid && m.player1_id === t2cid)
    );
    if (!matchData) continue;

    await fetch(
      `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches/${matchData.id}/change_state.json`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify(buildMatchStateBody("mark_as_underway"))
      }
    );
    break;
  }
}
