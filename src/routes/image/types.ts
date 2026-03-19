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
  };

  team_season: {
    background: string;
    fontFile:   string;
    team_name:   FC;
    team_rating: FC;
    players: {
      enabled:      boolean;
      font:         string;
      color:        string;
      size:         number;
      bold:         boolean;
      x:            [number, number, number];
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
    map_image: {
      enabled: boolean;
      x:       number;
      y:       number;
      width:   number;
      height:  number;
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
