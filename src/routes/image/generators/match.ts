import { createCanvas, loadImage } from "canvas";
import path from "path";
import Utils from "../../../utility/utils.js";
import { drawText, drawRoundRect, fieldFont, tryRegisterFont } from "../helpers.js";
import type { ImageSettings, MatchRow, MapStatRow, PlayerStatRow, PlayerWithRating } from "../types.js";

export async function generateMatchImage(
  match: MatchRow,
  mapRow: MapStatRow | null,
  players: PlayerStatRow[],
  s: ImageSettings
): Promise<Buffer> {
  const m  = s.match;
  const W  = s.canvas.width;
  const H  = s.canvas.height;

  tryRegisterFont(m.fontFile, [
    m.team1_name, m.team1_score, m.team2_score, m.team2_name, m.map_name,
    m.player_name_l, m.player_name_r,
    m.kills_l, m.assists_l, m.deaths_l, m.rating_l,
    m.kills_r, m.assists_r, m.deaths_r, m.rating_r,
  ].map(f => f.font));

  const withRating = (row: PlayerStatRow): PlayerWithRating => ({
    ...row,
    rating: Utils.getRating(
      Number(row.kills), Number(row.roundsplayed), Number(row.deaths),
      Number(row.k1), Number(row.k2), Number(row.k3), Number(row.k4), Number(row.k5)
    ),
  });

  const team1Players = players.filter(pl => pl.team_id === match.team1_id).slice(0, 5).map(withRating);
  const team2Players = players.filter(pl => pl.team_id !== match.team1_id).slice(0, 5).map(withRating);

  const team1Name  = match.team1_string || match.team1_name || "Team 1";
  const team2Name  = match.team2_string || match.team2_name || "Team 2";
  const t1Score    = mapRow?.team1_score ?? 0;
  const t2Score    = mapRow?.team2_score ?? 0;
  const mapDisplay = (mapRow?.map_name ?? "").replace(/^de_/, "").toUpperCase().split("").join(" ");

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  try {
    ctx.drawImage(await loadImage(path.join(process.cwd(), "public", "img", m.background)), 0, 0, W, H);
  } catch {
    ctx.fillStyle = "#f0ebe3";
    ctx.fillRect(0, 0, W, H);
  }

  // ── Graphical shapes (optional overlay) ────────────────────────────────────
  const sh = m.shapes;
  if (sh.enabled) {
    // Team name pills
    if (sh.team_pill.enabled) {
      const tp = sh.team_pill;
      const hw = tp.width / 2;
      const hh = tp.height / 2;
      drawRoundRect(ctx, m.team1_name.x - hw, m.team1_name.y - hh, tp.width, tp.height, tp.radius, tp.fill, tp.alpha, tp.border, tp.border_alpha, tp.border_width);
      drawRoundRect(ctx, m.team2_name.x - hw, m.team2_name.y - hh, tp.width, tp.height, tp.radius, tp.fill, tp.alpha, tp.border, tp.border_alpha, tp.border_width);
    }

    // Stats table backgrounds + row stripes
    if (sh.stats_table.enabled) {
      const st = sh.stats_table;
      const activeRows = m.rows_y.filter(y => y > 0);
      if (activeRows.length > 0) {
        const firstY = Math.min(...activeRows);
        const lastY  = Math.max(...activeRows);
        const tableH = lastY - firstY + st.row_height;
        const tableY = firstY - st.row_height / 2;
        // Draw both table backgrounds
        drawRoundRect(ctx, st.l_x, tableY, st.width, tableH, st.radius, st.fill, st.alpha);
        drawRoundRect(ctx, st.r_x, tableY, st.width, tableH, st.radius, st.fill, st.alpha);
        // Row stripes
        activeRows.forEach((ry, i) => {
          const rowY = ry - st.row_height / 2;
          const isOdd = i % 2 === 0;
          const rFill  = isOdd ? st.odd_fill  : st.even_fill;
          const rAlpha = isOdd ? st.odd_alpha : st.even_alpha;
          if (rAlpha > 0) {
            // Clip to table bounds for stripes
            ctx.save();
            ctx.beginPath();
            ctx.rect(st.l_x, tableY, st.width, tableH);
            ctx.clip();
            ctx.globalAlpha = rAlpha;
            ctx.fillStyle = rFill;
            ctx.fillRect(st.l_x, rowY, st.width, st.row_height);
            ctx.restore();
            ctx.save();
            ctx.beginPath();
            ctx.rect(st.r_x, tableY, st.width, tableH);
            ctx.clip();
            ctx.globalAlpha = rAlpha;
            ctx.fillStyle = rFill;
            ctx.fillRect(st.r_x, rowY, st.width, st.row_height);
            ctx.restore();
          }
        });
      }
    }

    // Player name pills (left and right)
    if (sh.player_pill.enabled) {
      const pp = sh.player_pill;
      const hh = pp.height / 2;
      m.rows_y.forEach(ry => {
        if (!ry) return;
        drawRoundRect(ctx, pp.l_x, ry - hh, pp.width, pp.height, pp.radius, pp.fill, pp.alpha, pp.border, pp.border_alpha, pp.border_width);
        drawRoundRect(ctx, pp.r_x, ry - hh, pp.width, pp.height, pp.radius, pp.fill, pp.alpha, pp.border, pp.border_alpha, pp.border_width);
      });
    }
  }

  // ── Team pills ─────────────────────────────────────────────────────────────
  if (m.team1_name.enabled)  drawText(ctx, team1Name,       m.team1_name.x,  m.team1_name.y,  fieldFont(m.team1_name),  m.team1_name.color);
  if (m.team1_score.enabled) drawText(ctx, String(t1Score), m.team1_score.x, m.team1_score.y, fieldFont(m.team1_score), m.team1_score.color);
  if (m.team2_score.enabled) drawText(ctx, String(t2Score), m.team2_score.x, m.team2_score.y, fieldFont(m.team2_score), m.team2_score.color);
  if (m.team2_name.enabled)  drawText(ctx, team2Name,       m.team2_name.x,  m.team2_name.y,  fieldFont(m.team2_name),  m.team2_name.color);

  // ── Column headers ─────────────────────────────────────────────────────────
  const ch = m.column_headers;
  if (ch.enabled) {
    const chFont = `${ch.bold ? "bold " : ""}${ch.size}px ${ch.font}`;
    if (ch.kills_label)   { drawText(ctx, ch.kills_label,   m.kills_l.x,   ch.y, chFont, ch.color); drawText(ctx, ch.kills_label,   m.kills_r.x,   ch.y, chFont, ch.color); }
    if (ch.assists_label) { drawText(ctx, ch.assists_label, m.assists_l.x, ch.y, chFont, ch.color); drawText(ctx, ch.assists_label, m.assists_r.x, ch.y, chFont, ch.color); }
    if (ch.deaths_label)  { drawText(ctx, ch.deaths_label,  m.deaths_l.x,  ch.y, chFont, ch.color); drawText(ctx, ch.deaths_label,  m.deaths_r.x,  ch.y, chFont, ch.color); }
    if (ch.rating_label)  { drawText(ctx, ch.rating_label,  m.rating_l.x,  ch.y, chFont, ch.color); drawText(ctx, ch.rating_label,  m.rating_r.x,  ch.y, chFont, ch.color); }
  }

  // ── Player rows ────────────────────────────────────────────────────────────
  for (let i = 0; i < 5; i++) {
    const rowY = m.rows_y[i];
    if (!rowY) continue; // Y=0 → ligne désactivée

    const p1 = team1Players[i];
    if (p1) {
      if (m.player_name_l.enabled) drawText(ctx, p1.name,           m.player_name_l.x, rowY, fieldFont(m.player_name_l), m.player_name_l.color);
      if (m.kills_l.enabled)       drawText(ctx, String(p1.kills),  m.kills_l.x,       rowY, fieldFont(m.kills_l),       m.kills_l.color);
      if (m.assists_l.enabled)     drawText(ctx, String(p1.assists), m.assists_l.x,     rowY, fieldFont(m.assists_l),     m.assists_l.color);
      if (m.deaths_l.enabled)      drawText(ctx, String(p1.deaths), m.deaths_l.x,      rowY, fieldFont(m.deaths_l),      m.deaths_l.color);
      if (m.rating_l.enabled)      drawText(ctx, String(p1.rating), m.rating_l.x,      rowY, fieldFont(m.rating_l),      m.rating_l.color);
    }

    const p2 = team2Players[i];
    if (p2) {
      if (m.player_name_r.enabled) drawText(ctx, p2.name,           m.player_name_r.x, rowY, fieldFont(m.player_name_r), m.player_name_r.color);
      if (m.kills_r.enabled)       drawText(ctx, String(p2.kills),  m.kills_r.x,       rowY, fieldFont(m.kills_r),       m.kills_r.color);
      if (m.assists_r.enabled)     drawText(ctx, String(p2.assists), m.assists_r.x,     rowY, fieldFont(m.assists_r),     m.assists_r.color);
      if (m.deaths_r.enabled)      drawText(ctx, String(p2.deaths), m.deaths_r.x,      rowY, fieldFont(m.deaths_r),      m.deaths_r.color);
      if (m.rating_r.enabled)      drawText(ctx, String(p2.rating), m.rating_r.x,      rowY, fieldFont(m.rating_r),      m.rating_r.color);
    }
  }

  // ── Map name ───────────────────────────────────────────────────────────────
  if (m.map_name.enabled && mapDisplay)
    drawText(ctx, mapDisplay, m.map_name.x, m.map_name.y, fieldFont(m.map_name), m.map_name.color);

  return canvas.toBuffer("image/png");
}
