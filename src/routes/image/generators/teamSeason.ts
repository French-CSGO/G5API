import { createCanvas } from "canvas";
import Utils from "../../../utility/utils.js";
import { drawText, drawRoundRect, drawBackground, fieldFont, tryRegisterFont } from "../helpers.js";
import { tryLoadMapImage } from "./loaders.js";
import type { ImageSettings, PlayerStatExtended, TeamSeasonRow, RoundsRow, WinsRow } from "../types.js";

export async function generateTeamSeasonImage(
  teamName: string,
  players: PlayerStatExtended[],
  teamStats: TeamSeasonRow,
  rounds: RoundsRow,
  winsLosses: WinsRow,
  bestMap: string | null,
  s: ImageSettings
): Promise<Buffer> {
  const cfg = s.team_season;
  const W   = s.canvas.width;
  const H   = s.canvas.height;

  tryRegisterFont(cfg.fontFile, [
    cfg.team_name, cfg.team_rating, cfg.best_map_label,
    cfg.kills, cfg.deaths, cfg.plants, cfg.defuses,
    cfg.rounds_won, cfg.rounds_lost, cfg.wins, cfg.losses,
    { font: cfg.players.font }, { font: cfg.players.rating_font },
    { font: cfg.stat_labels.font },
  ].map(f => f.font));

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  await drawBackground(ctx, cfg.background, W, H, "#f0ebe3");

  // ── Graphical shapes ──────────────────────────────────────────────────────
  const sh = cfg.shapes;
  if (sh.enabled) {
    if (sh.team_pill.enabled && cfg.team_name.enabled) {
      const tp = sh.team_pill;
      drawRoundRect(ctx, cfg.team_name.x - tp.width / 2, cfg.team_name.y - tp.height / 2, tp.width, tp.height, tp.radius, tp.fill, tp.alpha, tp.border, tp.border_alpha, tp.border_width);
    }
    if (sh.player_pill.enabled && cfg.players.enabled) {
      const pp = sh.player_pill;
      const hw = pp.width / 2;
      const hh = pp.height / 2;
      cfg.players.x.forEach(px => {
        if (px) drawRoundRect(ctx, px - hw, cfg.players.name_y - hh, pp.width, pp.height, pp.radius, pp.fill, pp.alpha, pp.border, pp.border_alpha, pp.border_width);
      });
    }
    if (sh.stats_background.enabled) {
      const sb = sh.stats_background;
      drawRoundRect(ctx, sb.x, sb.y, sb.width, sb.height, sb.radius, sb.fill, sb.alpha);
    }
  }

  // ── Best map image ────────────────────────────────────────────────────────
  if (cfg.map_image.enabled && bestMap) {
    const mapImg = await tryLoadMapImage(bestMap);
    if (mapImg) {
      const mi = cfg.map_image;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx.drawImage(mapImg as any, mi.x, mi.y, mi.width, mi.height);
    }
  }

  // ── Team name ─────────────────────────────────────────────────────────────
  if (cfg.team_name.enabled)
    drawText(ctx, teamName, cfg.team_name.x, cfg.team_name.y, fieldFont(cfg.team_name), cfg.team_name.color);

  // ── Players ───────────────────────────────────────────────────────────────
  if (cfg.players.enabled) {
    const pl = cfg.players;
    const nameFont = `${pl.bold ? "bold " : ""}${pl.size}px ${pl.font}`;
    const ratFont  = `${pl.rating_bold ? "bold " : ""}${pl.rating_size}px ${pl.rating_font}`;
    players.slice(0, 5).forEach((p, i) => {
      drawText(ctx, p.name, pl.x[i], pl.name_y, nameFont, pl.color);
      if (pl.show_rating) {
        const r = Utils.getRating(
          Number(p.kills), Number(p.roundsplayed), Number(p.deaths),
          Number(p.k1), Number(p.k2), Number(p.k3), Number(p.k4), Number(p.k5)
        );
        drawText(ctx, String(r), pl.x[i], pl.rating_y, ratFont, pl.rating_color);
      }
    });
  }

  // ── Team rating ───────────────────────────────────────────────────────────
  if (cfg.team_rating.enabled) {
    const top = players.slice(0, 5);
    const avg = top.length > 0
      ? (top.reduce((acc, p) => acc + Utils.getRating(
          Number(p.kills), Number(p.roundsplayed), Number(p.deaths),
          Number(p.k1), Number(p.k2), Number(p.k3), Number(p.k4), Number(p.k5)
        ), 0) / top.length).toFixed(2)
      : "0.00";
    drawText(ctx, avg, cfg.team_rating.x, cfg.team_rating.y, fieldFont(cfg.team_rating), cfg.team_rating.color);
  }

  // ── Stat labels ───────────────────────────────────────────────────────────
  const sl = cfg.stat_labels;
  if (sl.enabled) {
    const slFont = `${sl.bold ? "bold " : ""}${sl.size}px ${sl.font}`;
    const lY = (stat: { y: number }) => stat.y - sl.y_offset;
    if (cfg.team_rating.enabled && sl.team_rating_label)
      drawText(ctx, sl.team_rating_label, cfg.team_rating.x, cfg.team_rating.y - sl.y_offset, slFont, sl.color);
    if (cfg.kills.enabled       && sl.kills_label)       drawText(ctx, sl.kills_label,       cfg.kills.x,       lY(cfg.kills),       slFont, sl.color);
    if (cfg.deaths.enabled      && sl.deaths_label)      drawText(ctx, sl.deaths_label,      cfg.deaths.x,      lY(cfg.deaths),      slFont, sl.color);
    if (cfg.plants.enabled      && sl.plants_label)      drawText(ctx, sl.plants_label,      cfg.plants.x,      lY(cfg.plants),      slFont, sl.color);
    if (cfg.defuses.enabled     && sl.defuses_label)     drawText(ctx, sl.defuses_label,     cfg.defuses.x,     lY(cfg.defuses),     slFont, sl.color);
    if (cfg.rounds_won.enabled  && sl.rounds_won_label)  drawText(ctx, sl.rounds_won_label,  cfg.rounds_won.x,  lY(cfg.rounds_won),  slFont, sl.color);
    if (cfg.rounds_lost.enabled && sl.rounds_lost_label) drawText(ctx, sl.rounds_lost_label, cfg.rounds_lost.x, lY(cfg.rounds_lost), slFont, sl.color);
    if (cfg.wins.enabled        && sl.wins_label)        drawText(ctx, sl.wins_label,        cfg.wins.x,        lY(cfg.wins),        slFont, sl.color);
    if (cfg.losses.enabled      && sl.losses_label)      drawText(ctx, sl.losses_label,      cfg.losses.x,      lY(cfg.losses),      slFont, sl.color);
  }

  // ── Stats values ──────────────────────────────────────────────────────────
  if (cfg.kills.enabled)
    drawText(ctx, String(Number(teamStats.kills)),    cfg.kills.x,       cfg.kills.y,       fieldFont(cfg.kills),       cfg.kills.color);
  if (cfg.deaths.enabled)
    drawText(ctx, String(Number(teamStats.deaths)),   cfg.deaths.x,      cfg.deaths.y,      fieldFont(cfg.deaths),      cfg.deaths.color);
  if (cfg.plants.enabled)
    drawText(ctx, String(Number(teamStats.plants)),   cfg.plants.x,      cfg.plants.y,      fieldFont(cfg.plants),      cfg.plants.color);
  if (cfg.defuses.enabled)
    drawText(ctx, String(Number(teamStats.defuses)),  cfg.defuses.x,     cfg.defuses.y,     fieldFont(cfg.defuses),     cfg.defuses.color);
  if (cfg.rounds_won.enabled)
    drawText(ctx, String(Number(rounds.rounds_won)),  cfg.rounds_won.x,  cfg.rounds_won.y,  fieldFont(cfg.rounds_won),  cfg.rounds_won.color);
  if (cfg.rounds_lost.enabled)
    drawText(ctx, String(Number(rounds.rounds_lost)), cfg.rounds_lost.x, cfg.rounds_lost.y, fieldFont(cfg.rounds_lost), cfg.rounds_lost.color);
  // Wins/losses use configurable label suffix from stat_labels, falling back to French defaults
  const winsLabel   = sl.enabled && sl.wins_label   ? sl.wins_label   : "VICTOIRES";
  const lossesLabel = sl.enabled && sl.losses_label ? sl.losses_label : "DEFAITES";
  if (cfg.wins.enabled)
    drawText(ctx, `${Number(winsLosses.wins)} ${winsLabel}`,   cfg.wins.x,   cfg.wins.y,   fieldFont(cfg.wins),   cfg.wins.color);
  if (cfg.losses.enabled)
    drawText(ctx, `${Number(winsLosses.losses)} ${lossesLabel}`, cfg.losses.x, cfg.losses.y, fieldFont(cfg.losses), cfg.losses.color);

  if (cfg.best_map_label.enabled && bestMap)
    drawText(ctx, cfg.best_map_label.text || "Meilleure Map", cfg.best_map_label.x, cfg.best_map_label.y, fieldFont(cfg.best_map_label), cfg.best_map_label.color);

  return canvas.toBuffer("image/png");
}
