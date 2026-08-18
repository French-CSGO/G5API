import Utils from "../../../utility/utils.js";
import {
  escapeHtml, escapeAttr, fieldStyle, pillStyle, pillStyleTopLeft,
  logoStyle, photoStyle, fontFaceCss, toRgba, rowShadeStyle,
} from "../htmlHelpers.js";
import { stripAccents } from "../helpers.js";
import {
  resolveLogoOrFlagUrl, resolvePlayerImageUrl, resolveFontFace,
  resolveBackgroundUrl, stripMapPrefix,
} from "./htmlLoaders.js";
import type { ImageSettings, MatchRow, MapStatRow, PlayerStatRow, PlayerWithRating } from "../types.js";

/** Flat dict of data-f keys → values, used both for the first server-render and for the client-side poll (/data). */
export type MatchViewData = Record<string, string>;

export interface MatchViewInput {
  match: MatchRow;
  mapRow: MapStatRow | null;
  allMaps: MapStatRow[];
  players: PlayerStatRow[];
  mapSlots: MapStatRow[];
  plannedMapNames: string[];
  currentSlotIndex: number;
}

const isSafeSteamId = (id: string): boolean => /^[0-9]{15,20}$/.test(id);

function withRating(row: PlayerStatRow): PlayerWithRating {
  return {
    ...row,
    rating: Utils.getRating(
      Number(row.kills), Number(row.roundsplayed), Number(row.deaths),
      Number(row.k1), Number(row.k2), Number(row.k3), Number(row.k4), Number(row.k5)
    ),
  };
}

/** Builds the plain data dict shared by the HTML's initial render and the /data poll endpoint. */
export function buildMatchViewData(input: MatchViewInput): MatchViewData {
  const { match, mapRow, allMaps, players, mapSlots, plannedMapNames, currentSlotIndex } = input;

  const team1Players = players.filter(pl => pl.team_id === match.team1_id).slice(0, 5).map(withRating);
  const team2Players = players.filter(pl => pl.team_id === match.team2_id).slice(0, 5).map(withRating);

  const team1Name = match.team1_string || match.team1_name || "Team 1";
  const team2Name = match.team2_string || match.team2_name || "Team 2";

  const isMultiMap = allMaps.length > 1;
  const t1Score = isMultiMap
    ? allMaps.filter(r => r.team1_score > r.team2_score).length
    : (mapRow?.team1_score ?? 0);
  const t2Score = isMultiMap
    ? allMaps.filter(r => r.team2_score > r.team1_score).length
    : (mapRow?.team2_score ?? 0);

  const data: MatchViewData = {
    t1n: stripAccents(team1Name),
    t1s: String(t1Score),
    t2s: String(t2Score),
    t2n: stripAccents(team2Name),
    t1logo: resolveLogoOrFlagUrl(match.team1_logo, match.team1_flag) ?? "",
    t2logo: resolveLogoOrFlagUrl(match.team2_logo, match.team2_flag) ?? "",
    mappill_current: String(currentSlotIndex),
  };

  const slotsData = mapSlots.length ? mapSlots : allMaps;
  const mapNames = plannedMapNames.length ? plannedMapNames.slice(0, 3) : slotsData.slice(0, 3).map(r => r.map_name);
  const slotIndices = mapNames.length === 1 ? [1] : [0, 1, 2];
  mapNames.forEach((name, i) => {
    const slotIdx = slotIndices[i] ?? i;
    const playedMap = slotsData[i];
    const displayName = stripMapPrefix(name);
    data[`map${slotIdx}`] = playedMap ? `${playedMap.team1_score}  ${displayName}  ${playedMap.team2_score}` : displayName;
  });

  for (let i = 0; i < 5; i++) {
    const p1 = team1Players[i];
    data[`p-l-${i}-name`] = p1 ? stripAccents(p1.name) : "";
    data[`p-l-${i}-kad`] = p1 ? `${p1.kills} / ${p1.assists} / ${p1.deaths}` : "";
    data[`p-l-${i}-rating`] = p1 ? String(p1.rating) : "";
    data[`p-l-${i}-photo`] = p1 && isSafeSteamId(p1.steam_id) ? resolvePlayerImageUrl(p1.steam_id) : "";

    const p2 = team2Players[i];
    data[`p-r-${i}-name`] = p2 ? stripAccents(p2.name) : "";
    data[`p-r-${i}-kad`] = p2 ? `${p2.kills} / ${p2.assists} / ${p2.deaths}` : "";
    data[`p-r-${i}-rating`] = p2 ? String(p2.rating) : "";
    data[`p-r-${i}-photo`] = p2 && isSafeSteamId(p2.steam_id) ? resolvePlayerImageUrl(p2.steam_id) : "";
  }

  return data;
}

function field(dataKey: string, cfg: { enabled: boolean; font: string; color: string; size: number; bold: boolean }, x: number, y: number, value: string): string {
  if (!cfg.enabled) return "";
  return `<div class="field" data-f="${dataKey}" style="${fieldStyle(cfg, x, y)}">${escapeHtml(value)}</div>`;
}

function photoImg(dataKey: string, url: string, x: number, y: number, width: number, height: number, circle: boolean): string {
  return `<img class="photo" data-f="${dataKey}" src="${escapeAttr(url)}" style="${photoStyle(x, y, width, height, circle)}" onerror="this.style.visibility='hidden'">`;
}

export function renderMatchHtml(input: MatchViewInput, settings: ImageSettings, dataUrl: string, refreshMs = 4000): string {
  const m = settings.match;
  const W = settings.canvas.width;
  const H = settings.canvas.height;
  const d = buildMatchViewData(input);

  // tryRegisterFont() (canvas path) aliases the uploaded font file under every
  // family name referenced by a field, not just its own filename — a field's
  // `font` is just whichever name the admin typed, and it only resolves to the
  // uploaded file because canvas registers that file under all of them. Mirror
  // that here with one @font-face per distinct family, same src.
  const fontFace = resolveFontFace(m.fontFile);
  const fontFamiliesInUse = new Set<string>([
    m.team1_name, m.team1_score, m.team2_score, m.team2_name,
    m.map1, m.map2, m.map3, m.player_name_l, m.player_name_r,
    m.kad_l, m.rating_l, m.kad_r, m.rating_r,
  ].map(f => f.font).concat(m.column_headers.enabled ? [m.column_headers.font] : []));
  const bgUrl = resolveBackgroundUrl(m.background);

  const parts: string[] = [];

  // ── Shapes (team pill, stats table row shading, player pills) ─────────────
  const sh = m.shapes;
  if (sh.enabled) {
    if (sh.team_pill.enabled) {
      const tp = sh.team_pill;
      parts.push(`<div class="pill" style="${pillStyle(tp, m.team1_name.x, m.team1_name.y, tp.width, tp.height)}"></div>`);
      parts.push(`<div class="pill" style="${pillStyle(tp, m.team2_name.x, m.team2_name.y, tp.width, tp.height)}"></div>`);
    }

    if (sh.stats_table.enabled) {
      const st = sh.stats_table;
      const activeRows = m.rows_y.filter(y => y > 0);
      if (activeRows.length > 0) {
        const firstY = Math.min(...activeRows);
        const lastY = Math.max(...activeRows);
        const tableH = lastY - firstY + st.row_height;
        const tableY = firstY - st.row_height / 2;
        for (const lx of [st.l_x, st.r_x]) {
          const rows = activeRows.map((ry, i) => {
            const rFill = i % 2 === 0 ? st.odd_fill : st.even_fill;
            const rAlpha = i % 2 === 0 ? st.odd_alpha : st.even_alpha;
            if (rAlpha <= 0) return "";
            const rowY = ry - st.row_height / 2 - tableY;
            return `<div style="${rowShadeStyle(rowY, st.row_height, rFill, rAlpha)}"></div>`;
          }).join("");
          parts.push(
            `<div class="pill" style="${pillStyleTopLeft(st, lx, tableY, st.width, tableH)};overflow:hidden">${rows}</div>`
          );
        }
      }
    }

    if (sh.player_pill.enabled) {
      const pp = sh.player_pill;
      m.rows_y.forEach(ry => {
        if (!ry) return;
        parts.push(`<div class="pill" style="${pillStyle(pp, pp.l_x, ry, pp.width, pp.height)}"></div>`);
        parts.push(`<div class="pill" style="${pillStyle(pp, pp.r_x, ry, pp.width, pp.height)}"></div>`);
      });
    }
  }

  // ── Logos ───────────────────────────────────────────────────────────────
  if (m.team1_logo?.enabled) {
    parts.push(`<img class="logo" data-f="t1logo" src="${escapeAttr(d.t1logo)}" style="${logoStyle(m.team1_logo.x, m.team1_logo.y, m.team1_logo.size)}" onerror="this.style.visibility='hidden'">`);
  }
  if (m.team2_logo?.enabled) {
    parts.push(`<img class="logo" data-f="t2logo" src="${escapeAttr(d.t2logo)}" style="${logoStyle(m.team2_logo.x, m.team2_logo.y, m.team2_logo.size)}" onerror="this.style.visibility='hidden'">`);
  }

  // ── Team names / scores ─────────────────────────────────────────────────
  parts.push(field("t1n", m.team1_name, m.team1_name.x, m.team1_name.y, d.t1n));
  parts.push(field("t1s", m.team1_score, m.team1_score.x, m.team1_score.y, d.t1s));
  parts.push(field("t2s", m.team2_score, m.team2_score.x, m.team2_score.y, d.t2s));
  parts.push(field("t2n", m.team2_name, m.team2_name.x, m.team2_name.y, d.t2n));

  // ── Column headers ──────────────────────────────────────────────────────
  const ch = m.column_headers;
  if (ch.enabled) {
    const firstEnabledIdx = m.rows_y.findIndex(y => y > 0);
    const xIdx = firstEnabledIdx >= 0 ? firstEnabledIdx : 0;
    const chCfg = { enabled: true, font: ch.font, color: ch.color, size: ch.size, bold: ch.bold };
    const pairs: [string | undefined, number, number][] = [
      [ch.kad_label, m.kad_l.x[xIdx], m.kad_r.x[xIdx]],
      [ch.rating_label, m.rating_l.x[xIdx], m.rating_r.x[xIdx]],
    ];
    for (const [label, lx, rx] of pairs) {
      if (!label) continue;
      parts.push(`<div class="field" style="${fieldStyle(chCfg, lx, ch.y)}">${escapeHtml(stripAccents(label))}</div>`);
      parts.push(`<div class="field" style="${fieldStyle(chCfg, rx, ch.y)}">${escapeHtml(stripAccents(label))}</div>`);
    }
  }

  // ── Player rows ─────────────────────────────────────────────────────────
  for (let i = 0; i < 5; i++) {
    if (!m.rows_y[i]) continue;

    if (m.player_photo_l?.enabled) parts.push(photoImg(`p-l-${i}-photo`, d[`p-l-${i}-photo`], m.player_photo_l.x[i], m.player_photo_l.y[i], m.player_photo_l.width, m.player_photo_l.height, m.player_photo_l.circle));
    parts.push(field(`p-l-${i}-name`, m.player_name_l, m.player_name_l.x[i], m.player_name_l.y[i], d[`p-l-${i}-name`]));
    parts.push(field(`p-l-${i}-kad`, m.kad_l, m.kad_l.x[i], m.kad_l.y[i], d[`p-l-${i}-kad`]));
    parts.push(field(`p-l-${i}-rating`, m.rating_l, m.rating_l.x[i], m.rating_l.y[i], d[`p-l-${i}-rating`]));

    if (m.player_photo_r?.enabled) parts.push(photoImg(`p-r-${i}-photo`, d[`p-r-${i}-photo`], m.player_photo_r.x[i], m.player_photo_r.y[i], m.player_photo_r.width, m.player_photo_r.height, m.player_photo_r.circle));
    parts.push(field(`p-r-${i}-name`, m.player_name_r, m.player_name_r.x[i], m.player_name_r.y[i], d[`p-r-${i}-name`]));
    parts.push(field(`p-r-${i}-kad`, m.kad_r, m.kad_r.x[i], m.kad_r.y[i], d[`p-r-${i}-kad`]));
    parts.push(field(`p-r-${i}-rating`, m.rating_r, m.rating_r.x[i], m.rating_r.y[i], d[`p-r-${i}-rating`]));
  }

  // ── Map slots ────────────────────────────────────────────────────────────
  {
    const slotsData = input.mapSlots.length ? input.mapSlots : input.allMaps;
    const mapNames = input.plannedMapNames.length ? input.plannedMapNames.slice(0, 3) : slotsData.slice(0, 3).map(r => r.map_name);
    const slotIndices = mapNames.length === 1 ? [1] : [0, 1, 2];
    const slotCfgs = [m.map1, m.map2, m.map3] as const;
    const mp = m.shapes?.map_pill;

    mapNames.forEach((_name, i) => {
      const slotIdx = (slotIndices[i] ?? i) as 0 | 1 | 2;
      const slot = slotCfgs[slotIdx];
      if (!slot?.enabled) return;

      if (mp?.enabled) {
        parts.push(
          `<div class="pill map-pill map-pill-${slotIdx}" data-mappill="${slotIdx}" style="${pillStyle(mp, slot.x, slot.y, mp.width, mp.height)}"></div>`
        );
      }
      parts.push(field(`map${slotIdx}`, slot, slot.x, slot.y, d[`map${slotIdx}`] ?? ""));
    });
  }

  const mp = m.shapes?.map_pill;
  const mapPillCurrentCss = mp?.enabled
    ? [0, 1, 2].map(i => `.map-pill-${i}.is-current{background:${toRgba(mp.fill, mp.current_alpha)}}`).join("")
    : "";

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Match Stats</title>
<style>
${fontFace ? [fontFace.family, ...fontFamiliesInUse].filter((v, i, a) => a.indexOf(v) === i).map(family => fontFaceCss(fontFace.url, family)).join("\n") : ""}
html,body{margin:0;padding:0;background:transparent;overflow:hidden;}
.stage{position:relative;width:${W}px;height:${H}px;}
.bg{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;}
.field{pointer-events:none;}
${mapPillCurrentCss}
</style>
</head>
<body>
<div class="stage" id="stage">
${bgUrl ? `<img class="bg" src="${escapeAttr(bgUrl)}" onerror="this.style.display='none'">` : ""}
${parts.join("\n")}
</div>
<script>
(function(){
  var dataUrl = ${JSON.stringify(dataUrl)};
  function apply(d){
    document.querySelectorAll("[data-f]").forEach(function(el){
      var k = el.getAttribute("data-f");
      if (!(k in d)) return;
      var v = d[k];
      if (el.tagName === "IMG") { if (v && el.src !== v) el.src = v; }
      else { el.textContent = v; }
    });
    document.querySelectorAll("[data-mappill]").forEach(function(el){
      var idx = Number(el.getAttribute("data-mappill"));
      el.classList.toggle("is-current", Number(d.mappill_current) === idx);
    });
  }
  function tick(){
    fetch(dataUrl, { cache: "no-store" })
      .then(function(r){ return r.json(); })
      .then(apply)
      .catch(function(){ /* keep last known values on transient errors */ });
  }
  setInterval(tick, ${refreshMs});
})();
</script>
</body>
</html>`;
}
