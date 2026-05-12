/** Fetch for Challonge API v2.1 integration.
 * @const
 */
import {
  CHALLONGE_V2_BASE,
  challongeHeaders,
  challongeFetch as fetch,
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

  // Toutes les données DB nécessaires lues en parallèle
  const [matchRow, tournamentsRow, team1Row, team2Row, mapStatsRows] = await Promise.all([
    db.query("SELECT challonge_id FROM `match` WHERE id = ?", [match_id]) as Promise<RowDataPacket[]>,
    db.query("SELECT challonge_slug FROM season_challonge_tournament WHERE season_id = ? ORDER BY display_order ASC", [season_id]) as Promise<RowDataPacket[]>,
    db.query("SELECT challonge_team_id FROM team WHERE id = ?", [team1_id]) as Promise<RowDataPacket[]>,
    db.query("SELECT challonge_team_id FROM team WHERE id = ?", [team2_id]) as Promise<RowDataPacket[]>,
    db.query("SELECT team1_score, team2_score FROM map_stats WHERE match_id = ? ORDER BY map_number ASC", [match_id]) as Promise<RowDataPacket[]>
  ]);

  const challongeMatchId: number | null = matchRow[0]?.challonge_id ?? null;
  const slugList: string[] = tournamentsRow.length > 0
    ? tournamentsRow.map(t => t.challonge_slug as string)
    : (seasonInfo[0].challonge_url ? [seasonInfo[0].challonge_url as string] : []);

  if (!slugList.length) return;

  const t1cid: number = team1Row[0].challonge_team_id;
  const t2cid: number = team2Row[0].challonge_team_id;
  const team1Scores: number[] = mapStatsRows.map(r => r.team1_score);
  const team2Scores: number[] = mapStatsRows.map(r => r.team2_score);

  let updatedSlug: string | null = null;

  if (challongeMatchId) {
    // challonge_id connu : PUT direct sur chaque slug jusqu'à ce que ça marche
    // (pas de GET préalable pour trouver le bon bracket)
    for (const slug of slugList) {
      const resp = await fetch(
        `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches/${challongeMatchId}.json`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify(buildMatchPutBody(t1cid, t2cid, team1Scores, team2Scores, winner))
        }
      );
      if (resp.ok) { updatedSlug = slug; break; }
    }
  } else {
    // Fallback : GET open matches pour trouver par participants
    for (const slug of slugList) {
      const resp = await fetch(
        `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches.json?state=open&per_page=500`,
        { headers }
      );
      if (!resp.ok) continue;
      const body: any = await resp.json();
      const allMatches: any[] = Array.isArray(body?.data) ? body.data.map(parseV2Match) : [];
      const found = allMatches.find(m =>
        (m.player1_id === t1cid && m.player2_id === t2cid) ||
        (m.player2_id === t1cid && m.player1_id === t2cid)
      );
      if (!found) continue;
      await fetch(
        `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches/${found.id}.json`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify(buildMatchPutBody(t1cid, t2cid, team1Scores, team2Scores, winner))
        }
      );
      updatedSlug = slug;
      break;
    }
  }

  if (!updatedSlug || winner === null) return;

  // Vérification de finalisation uniquement à la fin de la série (winner != null)
  // Vérifier tous les brackets en parallèle
  const openChecks = await Promise.all(
    slugList.map(slug =>
      fetch(`${CHALLONGE_V2_BASE}/tournaments/${slug}/matches.json?state=open&per_page=500`, { headers })
        .then(r => r.json())
        .then((body: any) => ({ slug, open: Array.isArray(body?.data) ? body.data.length : 1 }))
    )
  );

  // Finaliser chaque bracket qui vient de se terminer
  for (const { slug, open } of openChecks) {
    if (open === 0) {
      await fetch(
        `${CHALLONGE_V2_BASE}/tournaments/${slug}/change_state.json`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify(buildTournamentStateBody("finalize"))
        }
      );
    }
  }

  // Clore la saison si tous les brackets sont terminés
  if (openChecks.every(c => c.open === 0)) {
    await db.query(
      "UPDATE season SET end_date = ? WHERE id = ?",
      [new Date().toISOString().slice(0, 19).replace("T", " "), seasonInfo[0].id]
    );
    GlobalEmitter.emit("seasonUpdate");
  }
}

/** Marks a Challonge match as underway using the stored challonge_id.
 * Tries each slug of the season in order until the PUT succeeds.
 */
export async function mark_challonge_match_underway(
  match_id: number | string,
  season_id: number
): Promise<void> {
  console.log(`[Challonge] mark_underway match_id=${match_id} season_id=${season_id}`);

  const seasonInfo: RowDataPacket[] = await db.query(
    "SELECT challonge_url FROM season WHERE id = ?",
    [season_id]
  );
  if (!seasonInfo.length) { console.log("[Challonge] mark_underway: season not found"); return; }
  if (seasonInfo[0].challonge_url?.startsWith("t:")) { console.log("[Challonge] mark_underway: toornament season, skip"); return; }

  const decryptedKey = getSetting("challonge.apiKey");
  if (!decryptedKey) { console.log("[Challonge] mark_underway: no API key"); return; }

  const matchRow: RowDataPacket[] = await db.query(
    "SELECT challonge_id FROM `match` WHERE id = ?",
    [match_id]
  );
  const challongeMatchId: number | null = matchRow[0]?.challonge_id ?? null;
  console.log(`[Challonge] mark_underway: challonge_id=${challongeMatchId}`);
  if (!challongeMatchId) { console.log("[Challonge] mark_underway: no challonge_id on match, abort"); return; }

  const tournaments: RowDataPacket[] = await db.query(
    "SELECT challonge_slug FROM season_challonge_tournament WHERE season_id = ? ORDER BY display_order ASC",
    [season_id]
  );
  const slugList: string[] = tournaments.length > 0
    ? tournaments.map(t => t.challonge_slug as string)
    : (seasonInfo[0].challonge_url ? [seasonInfo[0].challonge_url as string] : []);
  console.log(`[Challonge] mark_underway: slugList=${JSON.stringify(slugList)}`);
  if (!slugList.length) { console.log("[Challonge] mark_underway: no slugs, abort"); return; }

  const headers = challongeHeaders(decryptedKey);

  for (const slug of slugList) {
    const url = `${CHALLONGE_V2_BASE}/tournaments/${slug}/matches/${challongeMatchId}/change_state.json`;
    console.log(`[Challonge] mark_underway: PUT ${url}`);
    const resp = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify(buildMatchStateBody("mark_as_underway"))
    });
    console.log(`[Challonge] mark_underway: response status=${resp.status}`);
    if (resp.ok) break;
    const errBody = await resp.text();
    console.log(`[Challonge] mark_underway: error body=${errBody}`);
  }
}
