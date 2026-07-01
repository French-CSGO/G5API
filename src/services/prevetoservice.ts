/**
 * Pre-match web veto.
 *
 * Lets two teams run the map ban/pick (and, in "standard" side mode, the
 * side choice) procedure over shareable links *before* a match's config is
 * pushed to the game server, mirroring the exact ban/pick/side algorithm
 * MatchZy runs in-game (see MapVeto.cs upstream). Results are written to the
 * existing `veto`/`veto_side` tables so every reader of those tables
 * (VetoTable.vue, VetoDisplay.vue, the Discord veto embed) keeps working
 * unchanged. Once the plan is fully resolved, the match's `veto_mappool`/
 * `map_sides`/`skip_veto` columns are populated and the match is handed off
 * to finalizeMatchServer() to bring the game server online.
 */
import { RowDataPacket } from "mysql2";
import { generate } from "randomstring";

import { db } from "./db.js";
import GlobalEmitter from "../utility/emitter.js";
import { finalizeMatchServer } from "./matchfinalize.js";
import { sendVetoCompleteEmbed } from "./discord.js";

type Team = "team1" | "team2";
type ActionType = "ban" | "pick";
export type Role = "team1" | "team2" | "tablet" | "admin";
type Status = "awaiting_ready" | "awaiting_start" | "in_progress" | "completed" | "cancelled";

interface PlanStep {
  type: ActionType;
  team: Team;
}

interface VetoSessionRow extends RowDataPacket {
  id: number;
  match_id: number;
  status: Status;
  map_pool: string;
  num_maps: number;
  side_type: string;
  starting_team: Team;
  plan: string;
  current_step_index: number;
  pending_side_map: string | null;
  pending_side_team: Team | null;
  last_acting_team: Team | null;
  team1_ready: number;
  team2_ready: number;
  timer_enabled: number;
  timer_seconds: number;
  step_deadline: string | null;
  team1_token: string;
  team2_token: string;
  tablet_token: string;
  admin_token: string;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
}

function otherTeam(team: Team): Team {
  return team === "team1" ? "team2" : "team1";
}

function randomToken(): string {
  return generate({ length: 40, charset: "alphanumeric" });
}

function deadlineFromNow(session: { timer_seconds: number }): Date {
  return new Date(Date.now() + session.timer_seconds * 1000);
}

/**
 * Mirrors MatchZy's GenerateDefaultVetoSetup (MapVeto.cs): builds the
 * alternating ban/pick sequence for a given pool size and series length.
 * The single map that's never explicitly acted on (when one remains) is the
 * "decider" and is resolved automatically once the plan is exhausted.
 */
function buildPlan(poolLength: number, numMaps: number): PlanStep[] {
  const actions: ActionType[] = [];
  if (numMaps === 1) {
    for (let i = 0; i < poolLength - 1; i++) actions.push("ban");
  } else if (numMaps === 2) {
    if (poolLength < 5) {
      actions.push("pick", "pick");
    } else {
      actions.push("ban", "ban", "pick", "pick");
    }
  } else if (poolLength >= numMaps + 2) {
    const startBans = poolLength - (numMaps + 2);
    for (let i = 0; i < startBans; i++) actions.push("ban");
    for (let i = 0; i < numMaps - 1; i++) actions.push("pick");
    const remainingBeforeEnd = poolLength - startBans - (numMaps - 1);
    const endBans = remainingBeforeEnd - 1;
    for (let i = 0; i < endBans; i++) actions.push("ban");
  } else {
    for (let i = 0; i < numMaps; i++) actions.push("pick");
  }
  return actions.map((type, idx) => ({
    type,
    team: idx % 2 === 0 ? "team1" : "team2"
  }));
}

export async function createVetoSession(
  matchId: number,
  mapPool: string[],
  numMaps: number,
  sideType: string,
  timerEnabled: boolean,
  timerSeconds: number
): Promise<{ team1: string; team2: string; tablet: string; admin: string }> {
  const plan = buildPlan(mapPool.length, numMaps);
  const tokens = {
    team1: randomToken(),
    team2: randomToken(),
    tablet: randomToken(),
    admin: randomToken()
  };
  await db.query("INSERT INTO veto_session SET ?", [
    {
      match_id: matchId,
      status: "awaiting_ready",
      map_pool: mapPool.join(" "),
      num_maps: numMaps,
      side_type: sideType,
      starting_team: "team1",
      plan: JSON.stringify(plan),
      current_step_index: 0,
      team1_ready: false,
      team2_ready: false,
      timer_enabled: timerEnabled,
      timer_seconds: timerSeconds,
      // No deadline yet: the veto (and its timer) only starts once both teams are ready.
      step_deadline: null,
      team1_token: tokens.team1,
      team2_token: tokens.team2,
      tablet_token: tokens.tablet,
      admin_token: tokens.admin
    }
  ]);
  return tokens;
}

async function getSessionByToken(
  token: string
): Promise<{ session: VetoSessionRow; role: Role } | null> {
  const rows: RowDataPacket[] = await db.query(
    "SELECT * FROM veto_session WHERE team1_token = ? OR team2_token = ? OR tablet_token = ? OR admin_token = ?",
    [token, token, token, token]
  );
  if (!rows.length) return null;
  const session = rows[0] as VetoSessionRow;
  let role: Role;
  if (session.team1_token === token) role = "team1";
  else if (session.team2_token === token) role = "team2";
  else if (session.tablet_token === token) role = "tablet";
  else role = "admin";
  return { session, role };
}

async function getSessionRowById(id: number): Promise<VetoSessionRow | null> {
  const rows: RowDataPacket[] = await db.query("SELECT * FROM veto_session WHERE id = ?", [id]);
  return rows.length ? (rows[0] as VetoSessionRow) : null;
}

async function resolveTeamName(matchId: number, team: Team): Promise<string> {
  const matchRows: RowDataPacket[] = await db.query(
    "SELECT team1_id, team2_id FROM `match` WHERE id = ?",
    [matchId]
  );
  const teamId = team === "team1" ? matchRows[0].team1_id : matchRows[0].team2_id;
  const teamRows: RowDataPacket[] = await db.query("SELECT name FROM team WHERE id = ?", [teamId]);
  return teamRows[0]?.name ?? "Decider";
}

async function insertVetoRow(
  matchId: number,
  team: Team | null,
  map: string,
  type: ActionType
): Promise<void> {
  const teamName = team != null ? await resolveTeamName(matchId, team) : "Decider";
  await db.query("INSERT INTO veto SET ?", [
    {
      match_id: matchId,
      team_name: teamName,
      map,
      pick_or_veto: type === "ban" ? "veto" : "pick"
    }
  ]);
  GlobalEmitter.emit("vetoUpdate");
}

async function finalizeSession(session: VetoSessionRow): Promise<void> {
  const picks: RowDataPacket[] = await db.query(
    "SELECT map FROM veto WHERE match_id = ? AND pick_or_veto = 'pick' ORDER BY id",
    [session.match_id]
  );
  const maplist: string[] = picks.map((p) => p.map);

  let mapSides: string[] | null = null;
  if (session.side_type === "standard") {
    const matchRows: RowDataPacket[] = await db.query(
      "SELECT team1_id, team2_id FROM `match` WHERE id = ?",
      [session.match_id]
    );
    const teamRows: RowDataPacket[] = await db.query(
      "SELECT id, name FROM team WHERE id = ? OR id = ?",
      [matchRows[0].team1_id, matchRows[0].team2_id]
    );
    const nameToTeamKey = new Map<string, Team>();
    for (const t of teamRows) {
      if (t.id === matchRows[0].team1_id) nameToTeamKey.set(t.name, "team1");
      if (t.id === matchRows[0].team2_id) nameToTeamKey.set(t.name, "team2");
    }
    const sides: RowDataPacket[] = await db.query(
      "SELECT map, team_name, side FROM veto_side WHERE match_id = ?",
      [session.match_id]
    );
    const sideByMap = new Map<string, string>();
    for (const s of sides) {
      const teamKey = nameToTeamKey.get(s.team_name) ?? "team1";
      sideByMap.set(s.map, `${teamKey}_${s.side}`);
    }
    mapSides = maplist.map((m) => sideByMap.get(m) ?? "knife");
  }

  await db.query(
    "UPDATE `match` SET pending_veto = 0, skip_veto = 1, veto_mappool = ?, map_sides = ? WHERE id = ?",
    [maplist.join(" "), mapSides ? mapSides.join(",") : null, session.match_id]
  );
  await db.query("UPDATE veto_session SET status = 'completed', step_deadline = NULL WHERE id = ?", [
    session.id
  ]);
  GlobalEmitter.emit("prevetoUpdateAny");
  GlobalEmitter.emit("matchUpdate");

  try {
    await finalizeMatchServer(session.match_id);
  } catch (err) {
    console.error(`Match ${session.match_id}: finalizeMatchServer failed after veto completion:`, err);
  }
  try {
    await sendVetoCompleteEmbed(session.match_id);
  } catch (err) {
    console.error(`Match ${session.match_id}: sendVetoCompleteEmbed failed:`, err);
  }
}

/**
 * Re-evaluates state once the explicit ban/pick plan is exhausted: auto-adds
 * the decider map (and its side-choice, in standard mode) and finalizes the
 * session once every map (and, if applicable, every side) is resolved.
 */
async function progressSession(session: VetoSessionRow): Promise<void> {
  if (session.status !== "in_progress") return;
  if (session.pending_side_map) return;
  const plan: PlanStep[] = JSON.parse(session.plan);
  if (session.current_step_index < plan.length) return;

  const pool: string[] = session.map_pool.split(" ").filter(Boolean);
  const history: RowDataPacket[] = await db.query(
    "SELECT map, pick_or_veto FROM veto WHERE match_id = ?",
    [session.match_id]
  );
  const used = new Set(history.map((h) => h.map));
  const remaining = pool.filter((m) => !used.has(m));
  const pickedCount = history.filter((h) => h.pick_or_veto === "pick").length;

  // The decider map (the one nobody explicitly picked) is always settled by
  // an in-game knife round, never a web side choice — matches the standard
  // competitive convention MatchZy itself falls back to for undecided maps.
  if (remaining.length === 1 && pickedCount === session.num_maps - 1) {
    const map = remaining[0];
    await insertVetoRow(session.match_id, null, map, "pick");
  }

  const finalCount: RowDataPacket[] = await db.query(
    "SELECT COUNT(*) AS cnt FROM veto WHERE match_id = ? AND pick_or_veto = 'pick'",
    [session.match_id]
  );
  const decidedMaps = finalCount[0].cnt;
  if (decidedMaps >= session.num_maps) {
    if (session.side_type === "standard") {
      // Only explicit picks need a web side choice; the decider (if any)
      // always resolves via in-game knife instead.
      const sidesNeeded: RowDataPacket[] = await db.query(
        "SELECT COUNT(*) AS cnt FROM veto WHERE match_id = ? AND pick_or_veto = 'pick' AND team_name != 'Decider'",
        [session.match_id]
      );
      const sideCount: RowDataPacket[] = await db.query(
        "SELECT COUNT(*) AS cnt FROM veto_side WHERE match_id = ?",
        [session.match_id]
      );
      if (sideCount[0].cnt < sidesNeeded[0].cnt) return;
    }
    const refreshed = await getSessionRowById(session.id);
    if (refreshed && refreshed.status === "in_progress") {
      await finalizeSession(refreshed);
    }
  }
}

async function applyReady(session: VetoSessionRow, team: Team): Promise<void> {
  if (session.status !== "awaiting_ready") return;
  const team1Ready = team === "team1" ? true : !!session.team1_ready;
  const team2Ready = team === "team2" ? true : !!session.team2_ready;

  if (team1Ready && team2Ready) {
    const deadline = session.timer_enabled ? deadlineFromNow(session) : null;
    await db.query(
      "UPDATE veto_session SET team1_ready = 1, team2_ready = 1, status = 'awaiting_start', step_deadline = ? WHERE id = ?",
      [deadline, session.id]
    );
  } else {
    await db.query(
      "UPDATE veto_session SET team1_ready = ?, team2_ready = ? WHERE id = ?",
      [team1Ready, team2Ready, session.id]
    );
  }
  GlobalEmitter.emit("prevetoUpdateAny");
}

async function applyStartChoice(session: VetoSessionRow, choice: "start" | "swap"): Promise<void> {
  let plan: PlanStep[] = JSON.parse(session.plan);
  let startingTeam: Team = "team1";
  if (choice === "swap") {
    plan = plan.map((s) => ({ type: s.type, team: otherTeam(s.team) }));
    startingTeam = "team2";
  }
  const deadline = session.timer_enabled ? deadlineFromNow(session) : null;
  await db.query(
    "UPDATE veto_session SET status = 'in_progress', plan = ?, starting_team = ?, current_step_index = 0, step_deadline = ? WHERE id = ?",
    [JSON.stringify(plan), startingTeam, deadline, session.id]
  );
  await db.query("UPDATE `match` SET veto_first = ? WHERE id = ?", [startingTeam, session.match_id]);
  GlobalEmitter.emit("prevetoUpdateAny");
  const refreshed = await getSessionRowById(session.id);
  if (refreshed) await progressSession(refreshed);
}

async function applyAction(session: VetoSessionRow, team: Team, type: ActionType, map: string): Promise<void> {
  await insertVetoRow(session.match_id, team, map, type);
  const nextIndex = session.current_step_index + 1;

  if (type === "pick" && session.side_type === "standard") {
    const chooser = otherTeam(team);
    const deadline = session.timer_enabled ? deadlineFromNow(session) : null;
    await db.query(
      "UPDATE veto_session SET current_step_index = ?, last_acting_team = ?, pending_side_map = ?, pending_side_team = ?, step_deadline = ? WHERE id = ?",
      [nextIndex, team, map, chooser, deadline, session.id]
    );
    GlobalEmitter.emit("prevetoUpdateAny");
    return;
  }

  const deadline = session.timer_enabled ? deadlineFromNow(session) : null;
  await db.query(
    "UPDATE veto_session SET current_step_index = ?, last_acting_team = ?, step_deadline = ? WHERE id = ?",
    [nextIndex, team, deadline, session.id]
  );
  GlobalEmitter.emit("prevetoUpdateAny");
  const refreshed = await getSessionRowById(session.id);
  if (refreshed) await progressSession(refreshed);
}

async function applySide(session: VetoSessionRow, team: Team, side: "ct" | "t"): Promise<void> {
  if (!session.pending_side_map) return;
  const teamName = await resolveTeamName(session.match_id, team);

  const vetoRows: RowDataPacket[] = await db.query(
    "SELECT id FROM veto WHERE match_id = ? AND map = ? ORDER BY id DESC LIMIT 1",
    [session.match_id, session.pending_side_map]
  );
  const vetoId = vetoRows[0]?.id ?? null;

  await db.query("INSERT INTO veto_side SET ?", [
    {
      match_id: session.match_id,
      veto_id: vetoId,
      team_name: teamName,
      map: session.pending_side_map,
      side
    }
  ]);
  GlobalEmitter.emit("vetoSideUpdate");

  const plan: PlanStep[] = JSON.parse(session.plan);
  const stillHasSteps = session.current_step_index < plan.length;
  const deadline = stillHasSteps && session.timer_enabled ? deadlineFromNow(session) : null;
  await db.query(
    "UPDATE veto_session SET pending_side_map = NULL, pending_side_team = NULL, step_deadline = ? WHERE id = ?",
    [deadline, session.id]
  );
  GlobalEmitter.emit("prevetoUpdateAny");
  if (!stillHasSteps) {
    const refreshed = await getSessionRowById(session.id);
    if (refreshed) await progressSession(refreshed);
  }
}

async function autoResolveTimeout(session: VetoSessionRow): Promise<void> {
  if (session.status === "awaiting_start") {
    await applyStartChoice(session, "start");
    return;
  }
  if (session.status !== "in_progress") return;
  if (session.pending_side_map && session.pending_side_team) {
    const side: "ct" | "t" = Math.random() < 0.5 ? "ct" : "t";
    await applySide(session, session.pending_side_team, side);
    return;
  }
  const plan: PlanStep[] = JSON.parse(session.plan);
  if (session.current_step_index >= plan.length) return;
  const step = plan[session.current_step_index];
  const pool: string[] = session.map_pool.split(" ").filter(Boolean);
  const history: RowDataPacket[] = await db.query("SELECT map FROM veto WHERE match_id = ?", [
    session.match_id
  ]);
  const used = new Set(history.map((h) => h.map));
  const remaining = pool.filter((m) => !used.has(m));
  if (!remaining.length) return;
  const map = remaining[Math.floor(Math.random() * remaining.length)];
  await applyAction(session, step.team, step.type, map);
}

let sweepStarted = false;
export function startPreVetoTimerSweep(): void {
  if (sweepStarted) return;
  sweepStarted = true;
  setInterval(async () => {
    try {
      const rows: RowDataPacket[] = await db.query(
        "SELECT * FROM veto_session WHERE timer_enabled = 1 AND step_deadline IS NOT NULL AND step_deadline <= NOW() " +
          "AND status IN ('awaiting_start', 'in_progress')"
      );
      for (const row of rows) {
        await autoResolveTimeout(row as VetoSessionRow);
      }
    } catch (err) {
      console.error("[PreVeto] Timer sweep error:", err);
    }
  }, 2000);
}

export async function submitStartChoice(token: string, choice: "start" | "swap"): Promise<ActionResult> {
  const found = await getSessionByToken(token);
  if (!found) return { ok: false, message: "Session introuvable." };
  const { session, role } = found;
  if (session.status !== "awaiting_start") {
    return { ok: false, message: "Cette étape est déjà terminée." };
  }
  if (role !== "team1" && role !== "tablet") {
    return { ok: false, message: "Seule l'équipe 1 peut choisir de commencer ou d'inverser." };
  }
  await applyStartChoice(session, choice);
  return { ok: true };
}

export async function submitAction(token: string, actionType: ActionType, map: string): Promise<ActionResult> {
  const found = await getSessionByToken(token);
  if (!found) return { ok: false, message: "Session introuvable." };
  const { session, role } = found;
  if (session.status !== "in_progress") return { ok: false, message: "Le veto n'est pas en cours." };
  if (session.pending_side_map) return { ok: false, message: "Un choix de côté est en attente." };
  const plan: PlanStep[] = JSON.parse(session.plan);
  if (session.current_step_index >= plan.length) {
    return { ok: false, message: "Toutes les étapes de sélection sont terminées." };
  }
  const step = plan[session.current_step_index];
  if (step.type !== actionType) {
    return { ok: false, message: `L'étape actuelle est un ${step.type === "ban" ? "ban" : "pick"}.` };
  }
  if (role !== "tablet" && role !== step.team) {
    return { ok: false, message: "Ce n'est pas votre tour." };
  }
  const pool: string[] = session.map_pool.split(" ").filter(Boolean);
  if (!pool.includes(map)) return { ok: false, message: "Cette map ne fait pas partie du pool." };
  const history: RowDataPacket[] = await db.query("SELECT map FROM veto WHERE match_id = ?", [
    session.match_id
  ]);
  if (history.some((h) => h.map === map)) {
    return { ok: false, message: "Cette map a déjà été traitée." };
  }
  await applyAction(session, step.team, actionType, map);
  return { ok: true };
}

export async function submitSide(token: string, side: "ct" | "t"): Promise<ActionResult> {
  const found = await getSessionByToken(token);
  if (!found) return { ok: false, message: "Session introuvable." };
  const { session, role } = found;
  if (session.status !== "in_progress" || !session.pending_side_map || !session.pending_side_team) {
    return { ok: false, message: "Aucun choix de côté en attente." };
  }
  if (role !== "tablet" && role !== session.pending_side_team) {
    return { ok: false, message: "Ce n'est pas à votre équipe de choisir le côté." };
  }
  if (side !== "ct" && side !== "t") return { ok: false, message: "Côté invalide." };
  await applySide(session, session.pending_side_team, side);
  return { ok: true };
}

export async function adminForce(token: string): Promise<ActionResult> {
  const found = await getSessionByToken(token);
  if (!found) return { ok: false, message: "Session introuvable." };
  const { session, role } = found;
  if (role !== "admin") return { ok: false, message: "Action réservée à l'administrateur." };
  if (session.status === "awaiting_ready") {
    await applyReady(session, "team1");
    const refreshed = await getSessionRowById(session.id);
    if (refreshed) await applyReady(refreshed, "team2");
    return { ok: true };
  }
  if (session.status !== "awaiting_start" && session.status !== "in_progress") {
    return { ok: false, message: "Rien à forcer, le veto est terminé." };
  }
  await autoResolveTimeout(session);
  return { ok: true };
}

export async function submitReady(token: string, team?: "team1" | "team2"): Promise<ActionResult> {
  const found = await getSessionByToken(token);
  if (!found) return { ok: false, message: "Session introuvable." };
  const { session, role } = found;
  if (session.status !== "awaiting_ready") {
    return { ok: false, message: "Cette étape est déjà terminée." };
  }
  let targetTeam: Team;
  if (role === "team1") targetTeam = "team1";
  else if (role === "team2") targetTeam = "team2";
  else if (role === "tablet" && (team === "team1" || team === "team2")) targetTeam = team;
  else return { ok: false, message: "Action non autorisée." };

  await applyReady(session, targetTeam);
  return { ok: true };
}

export async function adminReset(token: string): Promise<ActionResult> {
  const found = await getSessionByToken(token);
  if (!found) return { ok: false, message: "Session introuvable." };
  const { session, role } = found;
  if (role !== "admin") return { ok: false, message: "Action réservée à l'administrateur." };

  await db.query("DELETE FROM veto_side WHERE match_id = ?", [session.match_id]);
  await db.query("DELETE FROM veto WHERE match_id = ?", [session.match_id]);
  const pool = session.map_pool.split(" ").filter(Boolean);
  const plan = buildPlan(pool.length, session.num_maps);
  await db.query(
    "UPDATE veto_session SET status = 'awaiting_ready', plan = ?, starting_team = 'team1', current_step_index = 0, " +
      "pending_side_map = NULL, pending_side_team = NULL, last_acting_team = NULL, " +
      "team1_ready = 0, team2_ready = 0, step_deadline = NULL WHERE id = ?",
    [JSON.stringify(plan), session.id]
  );
  await db.query(
    "UPDATE `match` SET pending_veto = 1, skip_veto = 0, veto_mappool = ?, map_sides = NULL, veto_first = NULL WHERE id = ?",
    [session.map_pool, session.match_id]
  );
  GlobalEmitter.emit("prevetoUpdateAny");
  GlobalEmitter.emit("vetoUpdate");
  GlobalEmitter.emit("vetoSideUpdate");
  GlobalEmitter.emit("matchUpdate");
  return { ok: true };
}

export interface PreVetoAwaiting {
  type: "start_choice" | "ban" | "pick" | "side_choice";
  team: Team;
  map?: string;
}

export interface PreVetoReadyState {
  team1: boolean;
  team2: boolean;
  can_ready_team1: boolean;
  can_ready_team2: boolean;
}

export interface PreVetoState {
  role: Role;
  match_id: number;
  team1_name: string | null;
  team2_name: string | null;
  status: Status;
  num_maps: number;
  side_type: string;
  map_pool: string[];
  remaining_pool: string[];
  history: { team_name: string; map: string; pick_or_veto: string; side: string | null; side_team: string | null }[];
  ready: PreVetoReadyState;
  awaiting: PreVetoAwaiting | null;
  can_act: boolean;
  is_admin: boolean;
  timer_enabled: boolean;
  timer_seconds: number;
  deadline: string | null;
}

export async function getPublicState(token: string): Promise<PreVetoState | null> {
  const found = await getSessionByToken(token);
  if (!found) return null;
  const { session, role } = found;

  const matchRows: RowDataPacket[] = await db.query(
    "SELECT t1.name AS team1_name, t2.name AS team2_name " +
      "FROM `match` m LEFT JOIN team t1 ON t1.id = m.team1_id LEFT JOIN team t2 ON t2.id = m.team2_id " +
      "WHERE m.id = ?",
    [session.match_id]
  );
  const match = matchRows[0];

  const plan: PlanStep[] = JSON.parse(session.plan);
  const pool: string[] = session.map_pool.split(" ").filter(Boolean);

  const history: RowDataPacket[] = await db.query(
    `SELECT v.team_name, v.map, v.pick_or_veto, vs.side, vs.team_name AS side_team
     FROM veto v LEFT JOIN veto_side vs ON vs.veto_id = v.id
     WHERE v.match_id = ? ORDER BY v.id`,
    [session.match_id]
  );

  const usedMaps = new Set(history.map((h) => h.map));
  const remainingPool = pool.filter((m) => !usedMaps.has(m));

  let awaiting: PreVetoAwaiting | null = null;
  if (session.status === "awaiting_start") {
    awaiting = { type: "start_choice", team: "team1" };
  } else if (session.status === "in_progress") {
    if (session.pending_side_map && session.pending_side_team) {
      awaiting = { type: "side_choice", team: session.pending_side_team, map: session.pending_side_map };
    } else if (session.current_step_index < plan.length) {
      const step = plan[session.current_step_index];
      awaiting = { type: step.type, team: step.team };
    }
  }

  const canAct =
    awaiting != null && (role === "tablet" || (role !== "admin" && role === awaiting.team));

  const team1Ready = !!session.team1_ready;
  const team2Ready = !!session.team2_ready;
  const canReadyTeam1 = session.status === "awaiting_ready" && !team1Ready && (role === "team1" || role === "tablet");
  const canReadyTeam2 = session.status === "awaiting_ready" && !team2Ready && (role === "team2" || role === "tablet");

  return {
    role,
    match_id: session.match_id,
    team1_name: match?.team1_name ?? null,
    team2_name: match?.team2_name ?? null,
    status: session.status,
    num_maps: session.num_maps,
    side_type: session.side_type,
    map_pool: pool,
    remaining_pool: remainingPool,
    history: history.map((h) => ({
      team_name: h.team_name,
      map: h.map,
      pick_or_veto: h.pick_or_veto,
      side: h.side ?? null,
      side_team: h.side_team ?? null
    })),
    ready: {
      team1: team1Ready,
      team2: team2Ready,
      can_ready_team1: canReadyTeam1,
      can_ready_team2: canReadyTeam2
    },
    awaiting,
    can_act: canAct,
    is_admin: role === "admin",
    timer_enabled: !!session.timer_enabled,
    timer_seconds: session.timer_seconds,
    deadline: session.step_deadline
  };
}
