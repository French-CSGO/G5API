import { createCanvas } from "canvas";
import Utils from "../../../utility/utils.js";
import { drawText, drawRoundRect, drawLogoCentered, drawBackground, fieldFont, tryRegisterFont } from "../helpers.js";
import { tryLoadLogoOrFlag, stripMapPrefix } from "./loaders.js";
import type { ImageSettings, LogoConfig, MatchRow, MapStatRow, PlayerStatRow, PlayerWithRating } from "../types.js";

export async function generateMatchImage(
  match: MatchRow,
  mapRow: MapStatRow | null,
  allMaps: MapStatRow[],
  players: PlayerStatRow[],
  s: ImageSettings,
  mapSlots?: MapStatRow[],
  plannedMapNames?: string[],
  currentSlotIndex?: number,
): Promise<Buffer> {
  const m = s.match;
  const W = s.canvas.width;
  const H = s.canvas.height;

  tryRegisterFont(m.fontFile, [
    m.team1_name, m.team1_score, m.team2_score, m.team2_name,
    m.map1, m.map2, m.map3,
    m.player_name_l, m.player_name_r,
    m.kills_l, m.assists_l, m.deaths_l, m.rating_l,
    m.kills_r, m.assists_r, m.deaths_r, m.rating_r,
  ].map(f => f.font));

  const [logo1, logo2] = await Promise.all([
    tryLoadLogoOrFlag(match.team1_logo, match.team1_flag),
    tryLoadLogoOrFlag(match.team2_logo, match.team2_flag),
  ]);

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  await drawBackground(ctx, m.background, W, H, "#f0ebe3");

  // ── Graphical shapes ──────────────────────────────────────────────────────
  const sh = m.shapes;
  if (sh.enabled) {
    if (sh.team_pill.enabled) {
      const tp = sh.team_pill;
      const hw = tp.width / 2;
      const hh = tp.height / 2;
      drawRoundRect(ctx, m.team1_name.x - hw, m.team1_name.y - hh, tp.width, tp.height, tp.radius, tp.fill, tp.alpha, tp.border, tp.border_alpha, tp.border_width);
      drawRoundRect(ctx, m.team2_name.x - hw, m.team2_name.y - hh, tp.width, tp.height, tp.radius, tp.fill, tp.alpha, tp.border, tp.border_alpha, tp.border_width);
    }

    if (sh.stats_table.enabled) {
      const st = sh.stats_table;
      const activeRows = m.rows_y.filter(y => y > 0);
      if (activeRows.length > 0) {
        const firstY = Math.min(...activeRows);
        const lastY  = Math.max(...activeRows);
        const tableH = lastY - firstY + st.row_height;
        const tableY = firstY - st.row_height / 2;
        drawRoundRect(ctx, st.l_x, tableY, st.width, tableH, st.radius, st.fill, st.alpha);
        drawRoundRect(ctx, st.r_x, tableY, st.width, tableH, st.radius, st.fill, st.alpha);
        activeRows.forEach((ry, i) => {
          const rowY  = ry - st.row_height / 2;
          const rFill  = i % 2 === 0 ? st.odd_fill  : st.even_fill;
          const rAlpha = i % 2 === 0 ? st.odd_alpha : st.even_alpha;
          if (rAlpha > 0) {
            for (const lx of [st.l_x, st.r_x]) {
              ctx.save();
              ctx.beginPath();
              ctx.rect(lx, tableY, st.width, tableH);
              ctx.clip();
              ctx.globalAlpha = rAlpha;
              ctx.fillStyle = rFill;
              ctx.fillRect(lx, rowY, st.width, st.row_height);
              ctx.restore();
            }
          }
        });
      }
    }

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

  if (m.team1_logo?.enabled) drawLogoCentered(ctx, logo1, m.team1_logo as LogoConfig);
  if (m.team2_logo?.enabled) drawLogoCentered(ctx, logo2, m.team2_logo as LogoConfig);

  const team1Name = match.team1_string || match.team1_name || "Team 1";
  const team2Name = match.team2_string || match.team2_name || "Team 2";

  const isMultiMap = allMaps.length > 1;
  const t1Score = isMultiMap
    ? allMaps.filter(r => r.team1_score > r.team2_score).length
    : (mapRow?.team1_score ?? 0);
  const t2Score = isMultiMap
    ? allMaps.filter(r => r.team2_score > r.team1_score).length
    : (mapRow?.team2_score ?? 0);

  if (m.team1_name.enabled)  drawText(ctx, team1Name,       m.team1_name.x,  m.team1_name.y,  fieldFont(m.team1_name),  m.team1_name.color);
  if (m.team1_score.enabled) drawText(ctx, String(t1Score), m.team1_score.x, m.team1_score.y, fieldFont(m.team1_score), m.team1_score.color);
  if (m.team2_score.enabled) drawText(ctx, String(t2Score), m.team2_score.x, m.team2_score.y, fieldFont(m.team2_score), m.team2_score.color);
  if (m.team2_name.enabled)  drawText(ctx, team2Name,       m.team2_name.x,  m.team2_name.y,  fieldFont(m.team2_name),  m.team2_name.color);

  const ch = m.column_headers;
  if (ch.enabled) {
    const chFont = `${ch.bold ? "bold " : ""}${ch.size}px ${ch.font}`;
    const pairs: [string | undefined, number, number][] = [
      [ch.kills_label,   m.kills_l.x,   m.kills_r.x],
      [ch.assists_label, m.assists_l.x, m.assists_r.x],
      [ch.deaths_label,  m.deaths_l.x,  m.deaths_r.x],
      [ch.rating_label,  m.rating_l.x,  m.rating_r.x],
    ];
    for (const [label, lx, rx] of pairs) {
      if (label) {
        drawText(ctx, label, lx, ch.y, chFont, ch.color);
        drawText(ctx, label, rx, ch.y, chFont, ch.color);
      }
    }
  }

  const withRating = (row: PlayerStatRow): PlayerWithRating => ({
    ...row,
    rating: Utils.getRating(
      Number(row.kills), Number(row.roundsplayed), Number(row.deaths),
      Number(row.k1), Number(row.k2), Number(row.k3), Number(row.k4), Number(row.k5)
    ),
  });
  const team1Players = players.filter(pl => pl.team_id === match.team1_id).slice(0, 5).map(withRating);
  const team2Players = players.filter(pl => pl.team_id === match.team2_id).slice(0, 5).map(withRating);

  for (let i = 0; i < 5; i++) {
    const rowY = m.rows_y[i];
    if (!rowY) continue;
    const p1 = team1Players[i];
    if (p1) {
      if (m.player_name_l.enabled) drawText(ctx, p1.name,            m.player_name_l.x, rowY, fieldFont(m.player_name_l), m.player_name_l.color);
      if (m.kills_l.enabled)       drawText(ctx, String(p1.kills),   m.kills_l.x,       rowY, fieldFont(m.kills_l),       m.kills_l.color);
      if (m.assists_l.enabled)     drawText(ctx, String(p1.assists), m.assists_l.x,     rowY, fieldFont(m.assists_l),     m.assists_l.color);
      if (m.deaths_l.enabled)      drawText(ctx, String(p1.deaths),  m.deaths_l.x,      rowY, fieldFont(m.deaths_l),      m.deaths_l.color);
      if (m.rating_l.enabled)      drawText(ctx, String(p1.rating),  m.rating_l.x,      rowY, fieldFont(m.rating_l),      m.rating_l.color);
    }
    const p2 = team2Players[i];
    if (p2) {
      if (m.player_name_r.enabled) drawText(ctx, p2.name,            m.player_name_r.x, rowY, fieldFont(m.player_name_r), m.player_name_r.color);
      if (m.kills_r.enabled)       drawText(ctx, String(p2.kills),   m.kills_r.x,       rowY, fieldFont(m.kills_r),       m.kills_r.color);
      if (m.assists_r.enabled)     drawText(ctx, String(p2.assists), m.assists_r.x,     rowY, fieldFont(m.assists_r),     m.assists_r.color);
      if (m.deaths_r.enabled)      drawText(ctx, String(p2.deaths),  m.deaths_r.x,      rowY, fieldFont(m.deaths_r),      m.deaths_r.color);
      if (m.rating_r.enabled)      drawText(ctx, String(p2.rating),  m.rating_r.x,      rowY, fieldFont(m.rating_r),      m.rating_r.color);
    }
  }

  // ── Map slots ─────────────────────────────────────────────────────────────
  {
    const slotsData = mapSlots ?? allMaps;
    const mapNames: string[] = plannedMapNames?.length
      ? plannedMapNames.slice(0, 3)
      : slotsData.slice(0, 3).map(r => r.map_name);

    const slotIndices: (0 | 1 | 2)[] = mapNames.length === 1 ? [1] : [0, 1, 2];
    const slotCfgs = [m.map1, m.map2, m.map3] as const;
    const mp = m.shapes?.map_pill;
    const curSlot = currentSlotIndex ?? -1;

    mapNames.forEach((name, i) => {
      const slotIdx = slotIndices[i] ?? (i as 0 | 1 | 2);
      const slot = slotCfgs[slotIdx];
      if (!slot?.enabled) return;

      const playedMap = slotsData[i];
      const isCurrent = slotIdx === curSlot;

      if (mp?.enabled) {
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

  return canvas.toBuffer("image/png");
}
