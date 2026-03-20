import path from "path";
import fs from "fs";
import type { FC, FX, ImageSettings } from "./types.js";

export const SETTINGS_PATH = path.join(process.cwd(), "public", "image-settings.json");

export const fc = (enabled: boolean, font: string, color: string, size: number, bold: boolean, x: number, y: number): FC =>
  ({ enabled, font, color, size, bold, x, y });

export const fx = (enabled: boolean, font: string, color: string, size: number, bold: boolean, x: number): FX =>
  ({ enabled, font, color, size, bold, x });

export const DEFAULT_SETTINGS: ImageSettings = {
  canvas: { width: 1920, height: 1080 },

  match: {
    background:    "marble.png",
    fontFile:      "",
    rows_y:        [485, 625, 770, 0, 0],
    team1_name:    fc(true, "Arial", "#1a1a2e", 30, true, 415,  302),
    team1_score:   fc(true, "Arial", "#1a1a2e", 30, true, 806,  302),
    team2_score:   fc(true, "Arial", "#1a1a2e", 30, true, 1114, 302),
    team2_name:    fc(true, "Arial", "#1a1a2e", 30, true, 1595, 302),
    map_name:      fc(true, "Arial", "#1a1a2e", 28, true, 960,  980),
    player_name_l: fx(true, "Arial", "#1a1a2e", 20, true, 180),
    player_name_r: fx(true, "Arial", "#1a1a2e", 20, true, 1450),
    kills_l:       fx(true, "Arial", "#1a1a2e", 20, false, 630),
    assists_l:     fx(true, "Arial", "#1a1a2e", 20, false, 710),
    deaths_l:      fx(true, "Arial", "#1a1a2e", 20, false, 800),
    rating_l:      fx(true, "Arial", "#1a1a2e", 20, false, 890),
    kills_r:       fx(true, "Arial", "#1a1a2e", 20, false, 1025),
    assists_r:     fx(true, "Arial", "#1a1a2e", 20, false, 1105),
    deaths_r:      fx(true, "Arial", "#1a1a2e", 20, false, 1195),
    rating_r:      fx(true, "Arial", "#1a1a2e", 20, false, 1280),
    column_headers: {
      enabled: false, y: 400,
      font: "Arial", color: "#1a1a2e", size: 20, bold: true,
      kills_label: "K", assists_label: "A", deaths_label: "D", rating_label: "RTG",
    },
    shapes: {
      enabled:     false,
      team_pill: {
        enabled:      true,
        fill:         "#000000",
        alpha:        0.35,
        radius:       50,
        width:        480,
        height:       70,
        border:       "#ffffff",
        border_alpha: 0.2,
        border_width: 2,
      },
      player_pill: {
        enabled:      true,
        fill:         "#ffffff",
        alpha:        0.18,
        radius:       50,
        width:        420,
        height:       58,
        border:       "#ffffff",
        border_alpha: 0.3,
        border_width: 1.5,
        l_x:          60,
        r_x:          1440,
      },
      stats_table: {
        enabled:    true,
        fill:       "#000000",
        alpha:      0.2,
        radius:     22,
        l_x:        510,
        r_x:        920,
        width:      430,
        pad_y:      30,
        row_height: 58,
        odd_fill:   "#000000",
        odd_alpha:  0.08,
        even_fill:  "#ffffff",
        even_alpha: 0.05,
      },
    },
  },

  player: {
    background:  "marble.png",
    fontFile:    "",
    team1_name:  fc(true, "Arial", "#1a1a2e", 36, true, 480,  220),
    vs:          fc(true, "Arial", "#1a1a2e", 36, true, 960,  220),
    team2_name:  fc(true, "Arial", "#1a1a2e", 36, true, 1440, 220),
    player_name: fc(true, "Arial", "#1a1a2e", 52, true, 960,  380),
    kills:       fc(true, "Arial", "#1a1a2e", 28, false, 500,  600),
    assists:     fc(true, "Arial", "#1a1a2e", 28, false, 700,  600),
    deaths:      fc(true, "Arial", "#1a1a2e", 28, false, 900,  600),
    rating:      fc(true, "Arial", "#1a1a2e", 28, false, 1100, 600),
    hs:          fc(true, "Arial", "#1a1a2e", 28, false, 1310, 600),
    clutches:    fc(true, "Arial", "#1a1a2e", 28, false, 1500, 600),
    column_headers: {
      enabled: false, y: 530, y2: 530,
      font: "Arial", color: "#1a1a2e", size: 20, bold: true,
      kills_label: "Kills", assists_label: "Assists", deaths_label: "Deaths",
      rating_label: "Rating", hs_label: "HS%", clutches_label: "Clutches",
    },
    shapes: {
      enabled:     false,
      team_pill: {
        enabled:      true,
        fill:         "#000000",
        alpha:        0.35,
        radius:       50,
        width:        400,
        height:       65,
        border:       "#ffffff",
        border_alpha: 0.2,
        border_width: 2,
      },
      player_pill: {
        enabled:      true,
        fill:         "#000000",
        alpha:        0.3,
        radius:       50,
        width:        600,
        height:       75,
        border:       "#ffffff",
        border_alpha: 0.2,
        border_width: 2,
      },
      stats_bar: {
        enabled:      true,
        fill:         "#000000",
        alpha:        0.2,
        radius:       22,
        x:            420,
        y:            0,
        width:        1140,
        height:       70,
        border:       "#ffffff",
        border_alpha: 0.1,
        border_width: 1,
      },
    },
  },

  team_season: {
    background:    "marble.png",
    fontFile:      "",
    team_name:    fc(true, "Arial", "#1a1a2e", 42, true,  960,  150),
    team_rating:  fc(true, "Arial", "#1a1a2e", 24, true,  960,  460),
    best_map_label: { ...fc(true, "Arial", "#1a1a2e", 22, false, 960, 510), text: "Meilleure Map" },
    players: {
      enabled:      true,
      font:         "Arial",
      color:        "#1a1a2e",
      size:         26,
      bold:         true,
      x:            [320, 640, 960, 1280, 1600],
      name_y:       320,
      show_rating:  true,
      rating_font:  "Arial",
      rating_color: "#1a1a2e",
      rating_size:  20,
      rating_bold:  false,
      rating_y:     380,
    },
    kills:       fc(true, "Arial", "#1a1a2e", 24, false, 400,  620),
    deaths:      fc(true, "Arial", "#1a1a2e", 24, false, 640,  620),
    plants:      fc(true, "Arial", "#1a1a2e", 24, false, 880,  620),
    defuses:     fc(true, "Arial", "#1a1a2e", 24, false, 1120, 620),
    rounds_won:  fc(true, "Arial", "#2e7d32", 24, false, 320,  760),
    rounds_lost: fc(true, "Arial", "#c62828", 24, false, 600,  760),
    wins:        fc(true, "Arial", "#2e7d32", 24, false, 900,  760),
    losses:      fc(true, "Arial", "#c62828", 24, false, 1140, 760),
    stat_labels: {
      enabled:           true,
      font:              "Arial",
      color:             "#888888",
      size:              16,
      bold:              false,
      y_offset:          30,
      team_rating_label: "Rating",
      kills_label:       "Kills",
      deaths_label:      "Décès",
      plants_label:      "Plants",
      defuses_label:     "Défuses",
      rounds_won_label:  "Rounds gagnés",
      rounds_lost_label: "Rounds perdus",
      wins_label:        "Victoires",
      losses_label:      "Défaites",
    },
    map_image:   { enabled: true, x: 760, y: 390, width: 400, height: 225 },
    shapes: {
      enabled:     false,
      team_pill: {
        enabled:      true,
        fill:         "#000000",
        alpha:        0.35,
        radius:       50,
        width:        600,
        height:       75,
        border:       "#ffffff",
        border_alpha: 0.2,
        border_width: 2,
      },
      player_pill: {
        enabled:      true,
        fill:         "#000000",
        alpha:        0.25,
        radius:       50,
        width:        280,
        height:       55,
        border:       "#ffffff",
        border_alpha: 0.2,
        border_width: 1.5,
      },
      stats_background: {
        enabled:      true,
        fill:         "#000000",
        alpha:        0.15,
        radius:       22,
        x:            220,
        y:            580,
        width:        1480,
        height:       240,
      },
    },
  },
};

export function mergeFC(def: FC, saved: Partial<FC> | undefined): FC {
  return { ...def, ...(saved ?? {}) };
}

export function mergeFX(def: FX, saved: Partial<FX> | undefined): FX {
  return { ...def, ...(saved ?? {}) };
}

export function loadSettings(): ImageSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    const p   = JSON.parse(raw);
    const dm  = DEFAULT_SETTINGS.match;
    const dp  = DEFAULT_SETTINGS.player;
    const dt  = DEFAULT_SETTINGS.team_season;
    const sm  = p.match       ?? {};
    const sp  = p.player      ?? {};
    const st  = p.team_season ?? {};
    return {
      canvas: { ...DEFAULT_SETTINGS.canvas, ...(p.canvas ?? {}) },
      match: {
        background:    sm.background ?? dm.background,
        fontFile:      sm.fontFile   ?? dm.fontFile,
        rows_y:        sm.rows_y     ?? dm.rows_y,
        team1_name:    mergeFC(dm.team1_name,    sm.team1_name),
        team1_score:   mergeFC(dm.team1_score,   sm.team1_score),
        team2_score:   mergeFC(dm.team2_score,   sm.team2_score),
        team2_name:    mergeFC(dm.team2_name,    sm.team2_name),
        map_name:      mergeFC(dm.map_name,      sm.map_name),
        player_name_l: mergeFX(dm.player_name_l, sm.player_name_l),
        player_name_r: mergeFX(dm.player_name_r, sm.player_name_r),
        kills_l:       mergeFX(dm.kills_l,       sm.kills_l),
        assists_l:     mergeFX(dm.assists_l,      sm.assists_l),
        deaths_l:      mergeFX(dm.deaths_l,       sm.deaths_l),
        rating_l:      mergeFX(dm.rating_l,       sm.rating_l),
        kills_r:        mergeFX(dm.kills_r,        sm.kills_r),
        assists_r:      mergeFX(dm.assists_r,      sm.assists_r),
        deaths_r:       mergeFX(dm.deaths_r,       sm.deaths_r),
        rating_r:       mergeFX(dm.rating_r,       sm.rating_r),
        column_headers: { ...dm.column_headers, ...(sm.column_headers ?? {}) },
        shapes: {
          ...dm.shapes,
          ...(sm.shapes ?? {}),
          team_pill:   { ...dm.shapes.team_pill,   ...(sm.shapes?.team_pill   ?? {}) },
          player_pill: { ...dm.shapes.player_pill, ...(sm.shapes?.player_pill ?? {}) },
          stats_table: { ...dm.shapes.stats_table, ...(sm.shapes?.stats_table ?? {}) },
        },
      },
      player: {
        background:  sp.background ?? dp.background,
        fontFile:    sp.fontFile   ?? dp.fontFile,
        team1_name:  mergeFC(dp.team1_name,  sp.team1_name),
        vs:          mergeFC(dp.vs,          sp.vs),
        team2_name:  mergeFC(dp.team2_name,  sp.team2_name),
        player_name: mergeFC(dp.player_name, sp.player_name),
        kills:       mergeFC(dp.kills,       sp.kills),
        assists:     mergeFC(dp.assists,     sp.assists),
        deaths:      mergeFC(dp.deaths,      sp.deaths),
        rating:      mergeFC(dp.rating,      sp.rating),
        hs:             mergeFC(dp.hs,          sp.hs),
        clutches:       mergeFC(dp.clutches,    sp.clutches),
        column_headers: { ...dp.column_headers, ...(sp.column_headers ?? {}) },
        shapes: {
          ...dp.shapes,
          ...(sp.shapes ?? {}),
          team_pill:   { ...dp.shapes.team_pill,   ...(sp.shapes?.team_pill   ?? {}) },
          player_pill: { ...dp.shapes.player_pill, ...(sp.shapes?.player_pill ?? {}) },
          stats_bar:   { ...dp.shapes.stats_bar,   ...(sp.shapes?.stats_bar   ?? {}) },
        },
      },
      team_season: {
        background:    st.background ?? dt.background,
        fontFile:      st.fontFile   ?? dt.fontFile,
        team_name:      mergeFC(dt.team_name,    st.team_name),
        team_rating:    mergeFC(dt.team_rating,  st.team_rating),
        best_map_label: { ...dt.best_map_label, ...(st.best_map_label ?? {}) },
        players:       {
          ...dt.players, ...(st.players ?? {}),
          x: ([0,1,2,3,4] as const).map(i => st.players?.x?.[i] ?? dt.players.x[i]) as [number,number,number,number,number],
        },
        kills:         mergeFC(dt.kills,         st.kills),
        deaths:        mergeFC(dt.deaths,        st.deaths),
        plants:        mergeFC(dt.plants,        st.plants),
        defuses:       mergeFC(dt.defuses,       st.defuses),
        rounds_won:    mergeFC(dt.rounds_won,    st.rounds_won),
        rounds_lost:   mergeFC(dt.rounds_lost,   st.rounds_lost),
        wins:          mergeFC(dt.wins,          st.wins),
        losses:        mergeFC(dt.losses,        st.losses),
        stat_labels:   { ...dt.stat_labels,      ...(st.stat_labels ?? {}) },
        map_image:     { ...dt.map_image,        ...(st.map_image ?? {}) },
        shapes: {
          ...dt.shapes,
          ...(st.shapes ?? {}),
          team_pill:        { ...dt.shapes.team_pill,        ...(st.shapes?.team_pill        ?? {}) },
          player_pill:      { ...dt.shapes.player_pill,      ...(st.shapes?.player_pill      ?? {}) },
          stats_background: { ...dt.shapes.stats_background, ...(st.shapes?.stats_background ?? {}) },
        },
      },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: ImageSettings): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), "utf-8");
}
