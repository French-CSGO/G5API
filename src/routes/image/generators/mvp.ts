import { createCanvas, loadImage } from "canvas";
import path from "path";
import fs from "fs";
import Utils from "../../../utility/utils.js";
import { drawText, drawMultilineText, drawRoundRect, fieldFont, tryRegisterFont } from "../helpers.js";
import type { ImageSettings, LogoConfig, PlayerStatExtended, MatchRow, MapStatRow } from "../types.js";

/** Charge un logo depuis public/img/logos/ — retourne null si introuvable */
async function tryLoadLogo(logoName: string | null | undefined) {
  if (!logoName) return null;
  const logosDir = path.join(process.cwd(), "public", "img", "logos");
  const exts = [".png", ".svg", ".jpg", ".jpeg", ".webp"];
  const candidates = [
    ...exts.map(e => path.join(logosDir, logoName + e)),
    path.join(logosDir, logoName),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return await loadImage(p); } catch { /* skip */ }
    }
  }
  return null;
}

/** Charge un drapeau : local public/img/flags/ en priorité, sinon flagcdn.com */
async function tryLoadFlag(flag: string | null | undefined) {
  if (!flag) return null;
  const code = flag.toLowerCase();
  const flagsDir = path.join(process.cwd(), "public", "img", "flags");
  const exts = [".png", ".svg", ".jpg"];
  for (const ext of exts) {
    const p = path.join(flagsDir, code + ext);
    if (fs.existsSync(p)) {
      try { return await loadImage(p); } catch { /* skip */ }
    }
  }
  try { return await loadImage(`https://flagcdn.com/w160/${code}.png`); } catch { /* skip */ }
  return null;
}

/** Charge un logo, avec fallback sur le drapeau de l'équipe */
async function tryLoadLogoOrFlag(logo: string | null | undefined, flag: string | null | undefined) {
  return (await tryLoadLogo(logo)) ?? (await tryLoadFlag(flag));
}

/** Charge une image de map depuis public/img/maps/ */
async function tryLoadMapImage(mapName: string) {
  if (!mapName) return null;
  const mapsDir = path.join(process.cwd(), "public", "img", "maps");
  const exts = [".png", ".jpg", ".jpeg", ".webp"];
  const candidates = [mapName, mapName.replace(/^de_/, ""), mapName.replace(/^cs_/, "")]
    .flatMap(n => exts.map(e => path.join(mapsDir, n + e)));
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return await loadImage(p); } catch { /* skip */ }
    }
  }
  return null;
}

/** Charge l'image d'un joueur depuis public/img/players/{steamId}.{ext}, fallback sur default.{ext} */
async function tryLoadPlayerImage(steamId: string) {
  const playersDir = path.join(process.cwd(), "public", "img", "players");
  const exts = [".png", ".jpg", ".jpeg", ".webp"];
  // Image spécifique au joueur
  if (steamId) {
    for (const ext of exts) {
      const p = path.join(playersDir, steamId + ext);
      if (fs.existsSync(p)) {
        try { return await loadImage(p); } catch { /* skip */ }
      }
    }
  }
  // Fallback image par défaut
  for (const ext of exts) {
    const p = path.join(playersDir, "default" + ext);
    if (fs.existsSync(p)) {
      try { return await loadImage(p); } catch { /* skip */ }
    }
  }
  return null;
}

/** Dessine un logo centré sur (cx, cy) avec une taille size×size */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawLogoCentered(ctx: any, img: any, cfg: LogoConfig) {
  if (!img) return;
  const half = cfg.size / 2;
  ctx.drawImage(img, cfg.x - half, cfg.y - half, cfg.size, cfg.size);
}

export async function generateMapMvpImage(
  match: MatchRow,
  mapRow: MapStatRow,
  player: PlayerStatExtended,
  s: ImageSettings,
  allMaps?: MapStatRow[]
): Promise<Buffer> {
  const cfg = s.mvp;
  const W   = s.canvas.width;
  const H   = s.canvas.height;

  // Enregistrement des fonts
  tryRegisterFont(cfg.fontFile, [
    cfg.map_name, cfg.team1_name, cfg.team1_score, cfg.team2_score, cfg.team2_name,
    cfg.mvp_label, cfg.player_name, cfg.player_team,
    cfg.kills, cfg.assists, cfg.deaths, cfg.rating, cfg.hs, cfg.clutches,
  ].map(f => f.font));

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ── Background ────────────────────────────────────────────────────────────
  // 1. Fond custom — toujours dessiné en premier (transparence PNG préservée)
  try {
    ctx.drawImage(await loadImage(path.join(process.cwd(), "public", "img", cfg.background)), 0, 0, W, H);
  } catch { /* canvas reste transparent si fond absent */ }
  // 2. Image de map par-dessus (si activée), avec overlay sombre
  if (cfg.map_image?.enabled) {
    const mapImg = await tryLoadMapImage(mapRow.map_name);
    if (mapImg) {
      ctx.drawImage(mapImg, 0, 0, W, H);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  // ── Logos d'équipes + photo joueur ───────────────────────────────────────
  const [logo1, logo2, playerImg] = await Promise.all([
    tryLoadLogoOrFlag(match.team1_logo, match.team1_flag),
    tryLoadLogoOrFlag(match.team2_logo, match.team2_flag),
    cfg.player_image?.enabled ? tryLoadPlayerImage(player.steam_id) : Promise.resolve(null),
  ]);
  if (cfg.team1_logo?.enabled) drawLogoCentered(ctx, logo1, cfg.team1_logo);
  if (cfg.team2_logo?.enabled) drawLogoCentered(ctx, logo2, cfg.team2_logo);

  // ── Photo joueur ──────────────────────────────────────────────────────────
  const pi = cfg.player_image;
  if (pi?.enabled && playerImg) {
    const pw = (pi.width  ?? pi.size) || pi.size;
    const ph = (pi.height ?? pi.size) || pi.size;
    const halfW = pw / 2;
    const halfH = ph / 2;
    if (pi.circle) {
      const halfR = Math.min(pw, ph) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(pi.x, pi.y, halfR, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      (ctx as any).drawImage(playerImg, pi.x - halfW, pi.y - halfH, pw, ph);
      ctx.restore();
    } else {
      (ctx as any).drawImage(playerImg, pi.x - halfW, pi.y - halfH, pw, ph);
    }
  }

  // ── Graphical shapes ──────────────────────────────────────────────────────
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

  // Noms d'équipes + scores
  const team1Name = match.team1_string || match.team1_name || "Team 1";
  const team2Name = match.team2_string || match.team2_name || "Team 2";

  if (cfg.map_name.enabled) {
    if (allMaps && allMaps.length > 1) {
      const mapDisplay = allMaps
        .map(r => `${r.team1_score}  ${r.map_name.replace(/^(de_|cs_|ar_)/, "").toUpperCase()}  ${r.team2_score}`)
        .join("\n");
      const lineHeight = Math.round(cfg.map_name.size * 1.5);
      drawMultilineText(ctx, mapDisplay, cfg.map_name.x, cfg.map_name.y, fieldFont(cfg.map_name), cfg.map_name.color, lineHeight);
    } else {
      const displayMap = mapRow.map_name.replace(/^(de_|cs_|ar_)/, "").toUpperCase();
      drawText(ctx, displayMap, cfg.map_name.x, cfg.map_name.y, fieldFont(cfg.map_name), cfg.map_name.color);
    }
  }
  if (cfg.team1_name.enabled)  drawText(ctx, team1Name,                    cfg.team1_name.x,  cfg.team1_name.y,  fieldFont(cfg.team1_name),  cfg.team1_name.color);
  if (cfg.team1_score.enabled) drawText(ctx, String(mapRow.team1_score),   cfg.team1_score.x, cfg.team1_score.y, fieldFont(cfg.team1_score), cfg.team1_score.color);
  if (cfg.team2_score.enabled) drawText(ctx, String(mapRow.team2_score),   cfg.team2_score.x, cfg.team2_score.y, fieldFont(cfg.team2_score), cfg.team2_score.color);
  if (cfg.team2_name.enabled)  drawText(ctx, team2Name,                    cfg.team2_name.x,  cfg.team2_name.y,  fieldFont(cfg.team2_name),  cfg.team2_name.color);

  // Label MVP
  if (cfg.mvp_label.enabled)   drawText(ctx, "MVP", cfg.mvp_label.x, cfg.mvp_label.y, fieldFont(cfg.mvp_label), cfg.mvp_label.color);

  // Nom du joueur
  if (cfg.player_name.enabled) drawText(ctx, player.name, cfg.player_name.x, cfg.player_name.y, fieldFont(cfg.player_name), cfg.player_name.color);

  // Équipe du joueur
  if (cfg.player_team.enabled) {
    const isTeam1 = player.team_id === match.team1_id;
    drawText(ctx, isTeam1 ? team1Name : team2Name, cfg.player_team.x, cfg.player_team.y, fieldFont(cfg.player_team), cfg.player_team.color);
  }

  // Calcul des stats
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

  // ── En-têtes de colonnes ──────────────────────────────────────────────────
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

  // ── Stats ─────────────────────────────────────────────────────────────────
  if (cfg.kills.enabled)    drawText(ctx, String(kills),    cfg.kills.x,    cfg.kills.y,    fieldFont(cfg.kills),    cfg.kills.color);
  if (cfg.assists.enabled)  drawText(ctx, String(assists),  cfg.assists.x,  cfg.assists.y,  fieldFont(cfg.assists),  cfg.assists.color);
  if (cfg.deaths.enabled)   drawText(ctx, String(deaths),   cfg.deaths.x,   cfg.deaths.y,   fieldFont(cfg.deaths),   cfg.deaths.color);
  if (cfg.rating.enabled)   drawText(ctx, String(rating),   cfg.rating.x,   cfg.rating.y,   fieldFont(cfg.rating),   cfg.rating.color);
  if (cfg.hs.enabled)       drawText(ctx, `${hsp}%`,        cfg.hs.x,       cfg.hs.y,       fieldFont(cfg.hs),       cfg.hs.color);
  if (cfg.clutches.enabled) drawText(ctx, String(clutches), cfg.clutches.x, cfg.clutches.y, fieldFont(cfg.clutches), cfg.clutches.color);

  return canvas.toBuffer("image/png");
}
