import { createCanvas } from "canvas";
import type { CanvasRenderingContext2D } from "canvas";
import Utils from "../../../utility/utils.js";
import { drawText, drawLogoCentered, drawBackground, fieldFont, tryRegisterFont } from "../helpers.js";
import { tryLoadLogoOrFlag, tryLoadPlayerImage } from "./loaders.js";
import type { ImageSettings, LogoConfig, PlayerStatRow, PlayerWithRating } from "../types.js";

/** Image de stats d'une seule équipe pour un match (ou une map) donné :
 *  logo + nom d'équipe, photos des 5 titulaires, et un champ combiné "K / A / D" + rating. */
export async function generateTeamMatchImage(
  teamName: string,
  teamLogo: string | null,
  teamFlag: string | null,
  players: PlayerStatRow[],
  s: ImageSettings,
): Promise<Buffer> {
  const cfg = s.team_match;
  const W = s.canvas.width;
  const H = s.canvas.height;

  tryRegisterFont(cfg.fontFile, [
    cfg.team_name, cfg.player_name, cfg.kad, cfg.rating,
    { font: cfg.row_labels.font },
  ].map(f => f.font));

  const withRating = (row: PlayerStatRow): PlayerWithRating => ({
    ...row,
    rating: Utils.getRating(
      Number(row.kills), Number(row.roundsplayed), Number(row.deaths),
      Number(row.k1), Number(row.k2), Number(row.k3), Number(row.k4), Number(row.k5)
    ),
  });
  const topPlayers = players
    .slice()
    .sort((a, b) => Number(b.kills) - Number(a.kills))
    .slice(0, 5)
    .map(withRating);

  const [logo, ...photos] = await Promise.all([
    cfg.team_logo?.enabled ? tryLoadLogoOrFlag(teamLogo, teamFlag) : Promise.resolve(null),
    ...topPlayers.map(p => (cfg.photos?.enabled ? tryLoadPlayerImage(p.steam_id) : Promise.resolve(null))),
  ]);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

  await drawBackground(ctx, cfg.background, W, H);

  if (cfg.team_logo?.enabled) drawLogoCentered(ctx, logo, cfg.team_logo as LogoConfig);
  if (cfg.team_name.enabled) {
    drawText(ctx, teamName, cfg.team_name.x, cfg.team_name.y, fieldFont(cfg.team_name), cfg.team_name.color);
  }

  // ── Une colonne par titulaire : photo, nom, puis stats ─────────────────────
  for (let i = 0; i < 5; i++) {
    const p = topPlayers[i];
    if (!p) continue;

    if (cfg.photos?.enabled) {
      const img = photos[i];
      if (img) {
        const pw = cfg.photos.width;
        const ph = cfg.photos.height;
        const x = cfg.photos.x[i];
        const y = cfg.photos.y[i];
        const halfW = pw / 2;
        const halfH = ph / 2;
        if (cfg.photos.circle) {
          const r = Math.min(pw, ph) / 2;
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx.drawImage(img as any, x - halfW, y - halfH, pw, ph);
          ctx.restore();
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx.drawImage(img as any, x - halfW, y - halfH, pw, ph);
        }
      }
    }

    if (cfg.player_name.enabled) {
      drawText(ctx, p.name, cfg.player_name.x[i], cfg.player_name.y[i], fieldFont(cfg.player_name), cfg.player_name.color);
    }
    if (cfg.kad.enabled) {
      const kad = `${p.kills} / ${p.assists} / ${p.deaths}`;
      drawText(ctx, kad, cfg.kad.x[i], cfg.kad.y[i], fieldFont(cfg.kad), cfg.kad.color);
    }
    if (cfg.rating.enabled) {
      drawText(ctx, String(p.rating), cfg.rating.x[i], cfg.rating.y[i], fieldFont(cfg.rating), cfg.rating.color);
    }
  }

  // ── Étiquettes à gauche de chaque ligne de stat ────────────────────────────
  const rl = cfg.row_labels;
  if (rl.enabled) {
    const rlFont = `${rl.bold ? "bold " : ""}${rl.size}px ${rl.font}`;
    if (rl.kad_label)    drawText(ctx, rl.kad_label,    rl.x, rl.kad_y,    rlFont, rl.color, "left");
    if (rl.rating_label) drawText(ctx, rl.rating_label, rl.x, rl.rating_y, rlFont, rl.color, "left");
  }

  return canvas.toBuffer("image/png");
}
