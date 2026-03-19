import { createCanvas, loadImage } from "canvas";
import path from "path";
import Utils from "../../../utility/utils.js";
import { drawText, drawRoundRect, fieldFont, tryRegisterFont } from "../helpers.js";
import type { ImageSettings, PlayerStatExtended } from "../types.js";

export async function generatePlayerImage(
  team1Name: string,
  team2Name: string,
  player: PlayerStatExtended,
  s: ImageSettings
): Promise<Buffer> {
  const cfg = s.player;
  const W   = s.canvas.width;
  const H   = s.canvas.height;

  tryRegisterFont(cfg.fontFile, [
    cfg.team1_name, cfg.vs, cfg.team2_name, cfg.player_name,
    cfg.kills, cfg.assists, cfg.deaths, cfg.rating, cfg.hs, cfg.clutches,
  ].map(f => f.font));

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  try {
    ctx.drawImage(await loadImage(path.join(process.cwd(), "public", "img", cfg.background)), 0, 0, W, H);
  } catch {
    ctx.fillStyle = "#f0ebe3";
    ctx.fillRect(0, 0, W, H);
  }

  // ── Graphical shapes ──────────────────────────────────────────────────────
  const sh = cfg.shapes;
  if (sh.enabled) {
    // Team name pills (behind team1_name, and a combined pill for vs+team2_name)
    if (sh.team_pill.enabled) {
      const tp = sh.team_pill;
      const hw = tp.width / 2;
      const hh = tp.height / 2;
      if (cfg.team1_name.enabled)
        drawRoundRect(ctx, cfg.team1_name.x - hw, cfg.team1_name.y - hh, tp.width, tp.height, tp.radius, tp.fill, tp.alpha, tp.border, tp.border_alpha, tp.border_width);
      // VS + team2 share one pill: tight left edge (just radius before VS), full hw after team2
      if (cfg.vs.enabled || cfg.team2_name.enabled) {
        const refY  = cfg.vs.enabled ? cfg.vs.y : cfg.team2_name.y;
        const clampedR = Math.min(tp.radius, tp.height / 2);
        const leftX  = cfg.vs.enabled
          ? cfg.vs.x - clampedR
          : cfg.team2_name.x - hw;
        const rightX = cfg.team2_name.enabled
          ? cfg.team2_name.x + hw
          : cfg.vs.x + hw;
        drawRoundRect(ctx, leftX, refY - hh, rightX - leftX, tp.height, tp.radius, tp.fill, tp.alpha, tp.border, tp.border_alpha, tp.border_width);
      }
    }
    // Player name pill
    if (sh.player_pill.enabled && cfg.player_name.enabled) {
      const pp = sh.player_pill;
      drawRoundRect(ctx, cfg.player_name.x - pp.width / 2, cfg.player_name.y - pp.height / 2, pp.width, pp.height, pp.radius, pp.fill, pp.alpha, pp.border, pp.border_alpha, pp.border_width);
    }
    // Stats bar (behind all stat values)
    if (sh.stats_bar.enabled) {
      const sb = sh.stats_bar;
      const statY = sb.y > 0 ? sb.y
        : ([cfg.kills, cfg.assists, cfg.deaths, cfg.rating, cfg.hs, cfg.clutches].find(f => f.enabled)?.y ?? 600);
      drawRoundRect(ctx, sb.x, statY - sb.height / 2, sb.width, sb.height, sb.radius, sb.fill, sb.alpha, sb.border, sb.border_alpha, sb.border_width);
    }
  }

  // Team names + VS
  if (cfg.team1_name.enabled)  drawText(ctx, team1Name,  cfg.team1_name.x,  cfg.team1_name.y,  fieldFont(cfg.team1_name),  cfg.team1_name.color);
  if (cfg.vs.enabled)          drawText(ctx, "VS",        cfg.vs.x,          cfg.vs.y,          fieldFont(cfg.vs),          cfg.vs.color);
  if (cfg.team2_name.enabled)  drawText(ctx, team2Name,  cfg.team2_name.x,  cfg.team2_name.y,  fieldFont(cfg.team2_name),  cfg.team2_name.color);

  // Player name
  if (cfg.player_name.enabled) drawText(ctx, player.name, cfg.player_name.x, cfg.player_name.y, fieldFont(cfg.player_name), cfg.player_name.color);

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

  // ── Column headers ─────────────────────────────────────────────────────────
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

  // Stats
  if (cfg.kills.enabled)    drawText(ctx, String(kills),    cfg.kills.x,    cfg.kills.y,    fieldFont(cfg.kills),    cfg.kills.color);
  if (cfg.assists.enabled)  drawText(ctx, String(assists),  cfg.assists.x,  cfg.assists.y,  fieldFont(cfg.assists),  cfg.assists.color);
  if (cfg.deaths.enabled)   drawText(ctx, String(deaths),   cfg.deaths.x,   cfg.deaths.y,   fieldFont(cfg.deaths),   cfg.deaths.color);
  if (cfg.rating.enabled)   drawText(ctx, String(rating),   cfg.rating.x,   cfg.rating.y,   fieldFont(cfg.rating),   cfg.rating.color);
  if (cfg.hs.enabled)       drawText(ctx, `${hsp}%`,        cfg.hs.x,       cfg.hs.y,       fieldFont(cfg.hs),       cfg.hs.color);
  if (cfg.clutches.enabled) drawText(ctx, String(clutches), cfg.clutches.x, cfg.clutches.y, fieldFont(cfg.clutches), cfg.clutches.color);

  return canvas.toBuffer("image/png");
}
