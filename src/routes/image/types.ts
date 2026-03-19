import { RowDataPacket } from "mysql2";

/** Config complète d'un champ : activation, police, couleur, taille, gras, X, Y */
export interface FC {
  enabled: boolean;
  font:    string;
  color:   string;
  size:    number;
  bold:    boolean;
  x:       number;
  y:       number;
}

/** Champ sans Y — colonnes du match (le Y vient de rows_y) */
export interface FX {
  enabled: boolean;
  font:    string;
  color:   string;
  size:    number;
  bold:    boolean;
  x:       number;
}

export interface MatchColumnHeaders {
  enabled:       boolean;
  y:             number;
  font:          string;
  color:         string;
  size:          number;
  bold:          boolean;
  kills_label:   string;
  assists_label: string;
  deaths_label:  string;
  rating_label:  string;
}

export interface PlayerColumnHeaders {
  enabled:         boolean;
  y:               number;
  y2:              number;
  font:            string;
  color:           string;
  size:            number;
  bold:            boolean;
  kills_label:     string;
  assists_label:   string;
  deaths_label:    string;
  rating_label:    string;
  hs_label:        string;
  clutches_label:  string;
}

export interface ImageSettings {
  canvas: { width: number; height: number };

  match: {
    background: string;
    fontFile:   string;
    rows_y:     [number, number, number, number, number];
    team1_name:    FC;
    team1_score:   FC;
    team2_score:   FC;
    team2_name:    FC;
    map_name:      FC;
    player_name_l: FX;
    player_name_r: FX;
    kills_l:   FX;
    assists_l: FX;
    deaths_l:  FX;
    rating_l:  FX;
    kills_r:   FX;
    assists_r: FX;
    deaths_r:  FX;
    rating_r:  FX;
    column_headers: MatchColumnHeaders;
    shapes: {
      enabled:           boolean;
      team_pill: {
        enabled:         boolean;
        fill:            string;
        alpha:           number;
        radius:          number;
        width:           number;
        height:          number;
        border:          string;
        border_alpha:    number;
        border_width:    number;
      };
      player_pill: {
        enabled:         boolean;
        fill:            string;
        alpha:           number;
        radius:          number;
        width:           number;
        height:          number;
        border:          string;
        border_alpha:    number;
        border_width:    number;
        l_x:             number;
        r_x:             number;
      };
      stats_table: {
        enabled:         boolean;
        fill:            string;
        alpha:           number;
        radius:          number;
        l_x:             number;
        r_x:             number;
        width:           number;
        pad_y:           number;
        row_height:      number;
        odd_fill:        string;
        odd_alpha:       number;
        even_fill:       string;
        even_alpha:      number;
      };
    };
  };

  player: {
    background: string;
    fontFile:   string;
    team1_name:  FC;
    vs:          FC;
    team2_name:  FC;
    player_name: FC;
    kills:    FC;
    assists:  FC;
    deaths:   FC;
    rating:   FC;
    hs:       FC;
    clutches: FC;
    column_headers: PlayerColumnHeaders;
    shapes: {
      enabled:     boolean;
      team_pill: {
        enabled:      boolean;
        fill:         string;
        alpha:        number;
        radius:       number;
        width:        number;
        height:       number;
        border:       string;
        border_alpha: number;
        border_width: number;
      };
      player_pill: {
        enabled:      boolean;
        fill:         string;
        alpha:        number;
        radius:       number;
        width:        number;
        height:       number;
        border:       string;
        border_alpha: number;
        border_width: number;
      };
      stats_bar: {
        enabled:      boolean;
        fill:         string;
        alpha:        number;
        radius:       number;
        x:            number;
        y:            number;
        width:        number;
        height:       number;
        border:       string;
        border_alpha: number;
        border_width: number;
      };
    };
  };

  team_season: {
    background: string;
    fontFile:   string;
    team_name:   FC;
    team_rating: FC;
    best_map_label: FC & { text: string };
    players: {
      enabled:      boolean;
      font:         string;
      color:        string;
      size:         number;
      bold:         boolean;
      x:            [number, number, number, number, number];
      name_y:       number;
      show_rating:  boolean;
      rating_font:  string;
      rating_color: string;
      rating_size:  number;
      rating_bold:  boolean;
      rating_y:     number;
    };
    kills:       FC;
    deaths:      FC;
    plants:      FC;
    defuses:     FC;
    rounds_won:  FC;
    rounds_lost: FC;
    wins:        FC;
    losses:      FC;
    stat_labels: {
      enabled:           boolean;
      font:              string;
      color:             string;
      size:              number;
      bold:              boolean;
      y_offset:          number;
      team_rating_label: string;
      kills_label:       string;
      deaths_label:      string;
      plants_label:      string;
      defuses_label:     string;
      rounds_won_label:  string;
      rounds_lost_label: string;
      wins_label:        string;
      losses_label:      string;
    };
    map_image: {
      enabled: boolean;
      x:       number;
      y:       number;
      width:   number;
      height:  number;
    };
    shapes: {
      enabled:     boolean;
      team_pill: {
        enabled:      boolean;
        fill:         string;
        alpha:        number;
        radius:       number;
        width:        number;
        height:       number;
        border:       string;
        border_alpha: number;
        border_width: number;
      };
      player_pill: {
        enabled:      boolean;
        fill:         string;
        alpha:        number;
        radius:       number;
        width:        number;
        height:       number;
        border:       string;
        border_alpha: number;
        border_width: number;
      };
      stats_background: {
        enabled:      boolean;
        fill:         string;
        alpha:        number;
        radius:       number;
        x:            number;
        y:            number;
        width:        number;
        height:       number;
      };
    };
  };
}

// ─── DB row interfaces ────────────────────────────────────────────────────────

export interface MatchRow extends RowDataPacket {
  team1_id: number; team2_id: number;
  team1_string: string | null; team2_string: string | null;
  team1_name: string | null;   team2_name: string | null;
}
export interface MapStatRow extends RowDataPacket {
  id: number; map_name: string;
  team1_score: number; team2_score: number;
}
export interface PlayerStatRow extends RowDataPacket {
  steam_id: string; name: string; team_id: number;
  kills: number; deaths: number; assists: number; roundsplayed: number;
  k1: number; k2: number; k3: number; k4: number; k5: number;
}
export interface PlayerWithRating extends PlayerStatRow { rating: number; }

export interface PlayerStatExtended extends RowDataPacket {
  steam_id: string; name: string; team_id: number;
  kills: number; deaths: number; assists: number; roundsplayed: number;
  headshot_kills: number;
  k1: number; k2: number; k3: number; k4: number; k5: number;
  v1: number; v2: number; v3: number; v4: number; v5: number;
}
export interface TeamSeasonRow extends RowDataPacket {
  kills: number; deaths: number; plants: number; defuses: number;
  roundsplayed: number;
  k1: number; k2: number; k3: number; k4: number; k5: number;
}
export interface RoundsRow   extends RowDataPacket { rounds_won: number; rounds_lost: number; }
export interface WinsRow     extends RowDataPacket { wins: number; losses: number; }
export interface TeamNameRow extends RowDataPacket { name: string; }
export interface BestMapRow  extends RowDataPacket { map_name: string; wins: number; }
