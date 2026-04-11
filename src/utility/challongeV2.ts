/**
 * Challonge API v2.1 helper utilities.
 * Authentication: API key passed in Authorization header (Authorization-Type: v1).
 * Base URL: https://api.challonge.com/v2.1
 */

export const CHALLONGE_V2_BASE = "https://api.challonge.com/v2.1";

/** Returns the required headers for every Challonge v2.1 request (API key auth). */
export function challongeHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/vnd.api+json",
    "Accept": "application/json",
    "Authorization-Type": "v1",
    "Authorization": apiKey
  };
}

/**
 * Normalised match shape used internally across the codebase.
 * Maps v2.1 JSON:API match object to a flat structure equivalent to v1.
 */
export interface NormalisedMatch {
  id: number;
  state: string;
  round: number;
  suggested_play_order: number | null;
  scheduled_time: string | null;
  scores_csv: string | null;
  player1_id: number | null;
  player2_id: number | null;
  winner_id: number | null;
}

/** Parse a single v2.1 match item (from data[] or data object).
 *
 * Challonge v2.1 puts `relationships` either:
 *  - inside `attributes` (non-standard, seen in bracket phase)
 *  - at the root of the resource object (JSON:API standard, seen in group stage)
 * We check both locations so both phases resolve correctly.
 */
export function parseV2Match(item: any): NormalisedMatch {
  const attr = item.attributes ?? {};
  // Relationships: prefer root-level (JSON:API standard), fallback to inside attributes
  const rel = item.relationships ?? attr.relationships ?? {};

  const readId = (side: "player1" | "player2"): number | null => {
    const id = rel[side]?.data?.id;
    return id != null && id !== "" ? parseInt(String(id), 10) : null;
  };

  return {
    id: parseInt(item.id, 10),
    state: attr.state ?? "pending",
    round: attr.round ?? 0,
    suggested_play_order: attr.suggested_play_order ?? null,
    // scheduled_time may live under timestamps.scheduled_at in some versions
    scheduled_time: attr.scheduled_time ?? attr.timestamps?.scheduled_at ?? null,
    scores_csv: attr.scores ?? null,
    player1_id: readId("player1"),
    player2_id: readId("player2"),
    winner_id: attr.winner_id != null ? parseInt(String(attr.winner_id), 10) : null
  };
}

/** Parse a single v2.1 participant item. */
export function parseV2Participant(item: any): { id: number; display_name: string; name: string } {
  const attr = item.attributes ?? {};
  return {
    id: parseInt(item.id, 10),
    display_name: attr.name ?? "",
    name: attr.name ?? ""
  };
}

/**
 * Build the v2.1 PUT body to update a match score.
 * When winner is null, only scores are sent (intermediate update).
 * When winner is "team1" or "team2", rank + advancing are added.
 */
export function buildMatchPutBody(
  team1ChallongeId: number | string,
  team2ChallongeId: number | string,
  team1Score: number,
  team2Score: number,
  winner: string | null
): object {
  const team1Wins = winner === "team1";
  const matchArr: any[] = [
    {
      participant_id: String(team1ChallongeId),
      score_set: String(team1Score),
      ...(winner !== null && { rank: team1Wins ? 1 : 2, advancing: team1Wins })
    },
    {
      participant_id: String(team2ChallongeId),
      score_set: String(team2Score),
      ...(winner !== null && { rank: team1Wins ? 2 : 1, advancing: !team1Wins })
    }
  ];
  return {
    data: {
      type: "Match",
      attributes: {
        match: matchArr,
        tie: false
      }
    }
  };
}

/** Build the v2.1 PUT body to change tournament state (e.g. finalize). */
export function buildTournamentStateBody(state: string): object {
  return {
    data: {
      type: "TournamentState",
      attributes: { state }
    }
  };
}
