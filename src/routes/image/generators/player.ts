import { createCanvas, loadImage } from "canvas";
import path from "path";
import Utils from "../../../utility/utils.js";
import { drawText, fieldFont, tryRegisterFont } from "../helpers.js";
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

  // Stats
  if (cfg.kills.enabled)    drawText(ctx, String(kills),    cfg.kills.x,    cfg.kills.y,    fieldFont(cfg.kills),    cfg.kills.color);
  if (cfg.assists.enabled)  drawText(ctx, String(assists),  cfg.assists.x,  cfg.assists.y,  fieldFont(cfg.assists),  cfg.assists.color);
  if (cfg.deaths.enabled)   drawText(ctx, String(deaths),   cfg.deaths.x,   cfg.deaths.y,   fieldFont(cfg.deaths),   cfg.deaths.color);
  if (cfg.rating.enabled)   drawText(ctx, String(rating),   cfg.rating.x,   cfg.rating.y,   fieldFont(cfg.rating),   cfg.rating.color);
  if (cfg.hs.enabled)       drawText(ctx, `${hsp}%`,        cfg.hs.x,       cfg.hs.y,       fieldFont(cfg.hs),       cfg.hs.color);
  if (cfg.clutches.enabled) drawText(ctx, String(clutches), cfg.clutches.x, cfg.clutches.y, fieldFont(cfg.clutches), cfg.clutches.color);

  return canvas.toBuffer("image/png");
}
