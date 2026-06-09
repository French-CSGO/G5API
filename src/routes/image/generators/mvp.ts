import { createCanvas } from "canvas";
import type { CanvasRenderingContext2D } from "canvas";
import Utils from "../../../utility/utils.js";
import { drawText, drawRoundRect, drawLogoCentered, drawBackground, fieldFont, tryRegisterFont } from "../helpers.js";
import { tryLoadLogoOrFlag, tryLoadMapImage, tryLoadPlayerImage, stripMapPrefix } from "./loaders.js";
import type { ImageSettings, LogoConfig, PlayerStatExtended, MatchRow, MapStatRow } from "../types.js";

export async function generateMapMvpImage(
  match: MatchRow,
  mapRow: MapStatRow,
  player: PlayerStatExtended,
  s: ImageSettings,
  allMaps?: MapStatRow[],
  plannedMapNames?: string[],
  currentSlotIndex?: number,
): Promise<Buffer> {
  const cfg = s.mvp;
  const W   = s.canvas.width;
  const H   = s.canvas.height;

  tryRegisterFont(cfg.fontFile, [
    cfg.map1, cfg.map2, cfg.map3,
    cfg.team1_name, cfg.team1_score, cfg.team2_score, cfg.team2_name,
    cfg.mvp_label, cfg.player_name, cfg.player_team,
    cfg.kills, cfg.assists, cfg.deaths, cfg.rating, cfg.hs, cfg.clutches,
  ].map(f => f.font));

  const [logo1, logo2, playerImg] = await Promise.all([
    tryLoadLogoOrFlag(match.team1_logo, match.team1_flag),
    tryLoadLogoOrFlag(match.team2_logo, match.team2_flag),
    cfg.player_image?.enabled ? tryLoadPlayerImage(player.steam_id) : Promise.resolve(null),
  ]);

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d") as CanvasRenderingContext2D;

  // Custom background first, then optional map image overlay
  await drawBackground(ctx, cfg.background, W, H);
  if (cfg.map_image?.enabled) {
    const mapImg = await tryLoadMapImage(mapRow.map_name);
    if (mapImg) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx.drawImage(mapImg as any, 0, 0, W, H);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  // ── Team logos ────────────────────────────────────────────────────────────
  if (cfg.team1_logo?.enabled) drawLogoCentered(ctx, logo1, cfg.team1_logo as LogoConfig);
  if (cfg.team2_logo?.enabled) drawLogoCentered(ctx, logo2, cfg.team2_logo as LogoConfig);

  // ── Player photo ──────────────────────────────────────────────────────────
  const pi = cfg.player_image;
  if (pi?.enabled && playerImg) {
    const pw   = (pi.width  ?? pi.size) || pi.size;
    const ph   = (pi.height ?? pi.size) || pi.size;
    const halfW = pw / 2;
    const halfH = ph / 2;
    if (pi.circle) {
      const r = Math.min(pw, ph) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(pi.x, pi.y, r, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx.drawImage(playerImg as any, pi.x - halfW, pi.y - halfH, pw, ph);
      ctx.restore();
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx.drawImage(playerImg as any, pi.x - halfW, pi.y - halfH, pw, ph);
    }
  }

  // ── Shapes ────────────────────────────────────────────────────────────────
  const sh = cfg.shapes;
  if (sh.enabled) {
    if (sh.team_pill.enabled) {
      const tp = sh.team_pill;
      const hw = tp.width / 2;
      const hh = tp.height / 2;
      if (cfg.team1_name.enabled)
        drawRoundRect(ctx, cfg.team1_name.x - hw, cfg.team1_name.y - hh, tp.width, tp.height, tp.radius, tp.fill, tp.alpha, tp.border, tp.border_alpha, tp.border_width);
      if (cfg.team2_name.enabled)
        drawRoundRect(ctx, cfg.team2_name.x - hw, cfg.team2_name.y - hh, tp.width, tp.height, tp.radius, tp.fill, tp.alpha, tp.border, tp.border_alpha, tp.border_width);
    }
    if (sh.player_pill.enabled && cfg.player_name.enabled) {
      const pp = sh.player_pill;
      drawRoundRect(ctx, cfg.player_name.x - pp.width / 2, cfg.player_name.y - pp.height / 2, pp.width, pp.height, pp.radius, pp.fill, pp.alpha, pp.border, pp.border_alpha, pp.border_width);
    }
    if (sh.stats_bar.enabled) {
      const sb = sh.stats_bar;
      const statY = sb.y > 0 ? sb.y
        : ([cfg.kills, cfg.assists, cfg.deaths, cfg.rating, cfg.hs, cfg.clutches].find(f => f.enabled)?.y ?? 620);
      drawRoundRect(ctx, sb.x, statY - sb.height / 2, sb.width, sb.height, sb.radius, sb.fill, sb.alpha, sb.border, sb.border_alpha, sb.border_width);
    }
  }

  const team1Name = match.team1_string || match.team1_name || "Team 1";
  const team2Name = match.team2_string || match.team2_name || "Team 2";

  // ── Map slots ─────────────────────────────────────────────────────────────
  {
    // Build the list of map names to display:
    // veto picks (if available) give us all planned maps including not-yet-played ones
    const mapNames: string[] = plannedMapNames?.length
      ? plannedMapNames.slice(0, 3)
      : (allMaps ?? []).slice(0, 3).map(r => r.map_name);

    // BO1: center the single map in slot 1 (index 0 → slot 1)
    const slotIndices: (0 | 1 | 2)[] = mapNames.length === 1 ? [1] : [0, 1, 2];
    const slotCfgs = [cfg.map1, cfg.map2, cfg.map3] as const;
    const mp = cfg.shapes?.map_pill;
    const curSlot = currentSlotIndex ?? -1;

    mapNames.forEach((name, i) => {
      const slotIdx = slotIndices[i] ?? (i as 0 | 1 | 2);
      const slot = slotCfgs[slotIdx];
      if (!slot?.enabled) return;

      const playedMap = allMaps?.[i];
      const isCurrent = slotIdx === curSlot;

      // Box behind map name
      if (cfg.shapes?.enabled && mp?.enabled) {
        const pillAlpha = isCurrent ? mp.current_alpha : mp.alpha;
        drawRoundRect(
          ctx,
          slot.x - mp.width / 2, slot.y - mp.height / 2,
          mp.width, mp.height, mp.radius,
          mp.fill, pillAlpha,
          mp.border, mp.border_alpha, mp.border_width
        );
      }

      const displayName = stripMapPrefix(name);
      const text = playedMap
        ? `${playedMap.team1_score}  ${displayName}  ${playedMap.team2_score}`
        : displayName;
      drawText(ctx, text, slot.x, slot.y, fieldFont(slot), slot.color);
    });
  }

  // ── Team names + scores ───────────────────────────────────────────────────
  if (cfg.team1_name.enabled)  drawText(ctx, team1Name,                  cfg.team1_name.x,  cfg.team1_name.y,  fieldFont(cfg.team1_name),  cfg.team1_name.color);
  if (cfg.team1_score.enabled) drawText(ctx, String(mapRow.team1_score), cfg.team1_score.x, cfg.team1_score.y, fieldFont(cfg.team1_score), cfg.team1_score.color);
  if (cfg.team2_score.enabled) drawText(ctx, String(mapRow.team2_score), cfg.team2_score.x, cfg.team2_score.y, fieldFont(cfg.team2_score), cfg.team2_score.color);
  if (cfg.team2_name.enabled)  drawText(ctx, team2Name,                  cfg.team2_name.x,  cfg.team2_name.y,  fieldFont(cfg.team2_name),  cfg.team2_name.color);

  if (cfg.mvp_label.enabled)   drawText(ctx, "MVP", cfg.mvp_label.x, cfg.mvp_label.y, fieldFont(cfg.mvp_label), cfg.mvp_label.color);
  if (cfg.player_name.enabled) drawText(ctx, player.name, cfg.player_name.x, cfg.player_name.y, fieldFont(cfg.player_name), cfg.player_name.color);

  if (cfg.player_team.enabled) {
    const team = player.team_id === match.team1_id ? team1Name : team2Name;
    drawText(ctx, team, cfg.player_team.x, cfg.player_team.y, fieldFont(cfg.player_team), cfg.player_team.color);
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const kills    = Number(player.kills);
  const deaths   = Number(player.deaths);
  const assists  = Number(player.assists);
  const rounds   = Number(player.roundsplayed);
  const hsk      = Number(player.headshot_kills);
  const clutches = Number(player.v1) + Number(player.v2) + Number(player.v3) + Number(player.v4) + Number(player.v5);
  const rating   = Utils.getRating(
    kills, rounds, deaths,
    Number(player.k1), Number(player.k2), Number(player.k3), Number(player.k4), Number(player.k5)
  );
  const hsp = kills > 0 ? Math.round((hsk / kills) * 100) : 0;

  const ch = cfg.column_headers;
  if (ch.enabled) {
    const chFont = `${ch.bold ? "bold " : ""}${ch.size}px ${ch.font}`;
    if (ch.kills_label)    drawText(ctx, ch.kills_label,    cfg.kills.x,    ch.y,  chFont, ch.color);
    if (ch.assists_label)  drawText(ctx, ch.assists_label,  cfg.assists.x,  ch.y,  chFont, ch.color);
    if (ch.deaths_label)   drawText(ctx, ch.deaths_label,   cfg.deaths.x,   ch.y,  chFont, ch.color);
    if (ch.rating_label)   drawText(ctx, ch.rating_label,   cfg.rating.x,   ch.y2, chFont, ch.color);
    if (ch.hs_label)       drawText(ctx, ch.hs_label,       cfg.hs.x,       ch.y2, chFont, ch.color);
    if (ch.clutches_label) drawText(ctx, ch.clutches_label, cfg.clutches.x, ch.y2, chFont, ch.color);
  }

  if (cfg.kills.enabled)    drawText(ctx, String(kills),    cfg.kills.x,    cfg.kills.y,    fieldFont(cfg.kills),    cfg.kills.color);
  if (cfg.assists.enabled)  drawText(ctx, String(assists),  cfg.assists.x,  cfg.assists.y,  fieldFont(cfg.assists),  cfg.assists.color);
  if (cfg.deaths.enabled)   drawText(ctx, String(deaths),   cfg.deaths.x,   cfg.deaths.y,   fieldFont(cfg.deaths),   cfg.deaths.color);
  if (cfg.rating.enabled)   drawText(ctx, String(rating),   cfg.rating.x,   cfg.rating.y,   fieldFont(cfg.rating),   cfg.rating.color);
  if (cfg.hs.enabled)       drawText(ctx, `${hsp}%`,        cfg.hs.x,       cfg.hs.y,       fieldFont(cfg.hs),       cfg.hs.color);
  if (cfg.clutches.enabled) drawText(ctx, String(clutches), cfg.clutches.x, cfg.clutches.y, fieldFont(cfg.clutches), cfg.clutches.color);

  return canvas.toBuffer("image/png");
}
