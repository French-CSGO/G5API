export interface ToornamentLogo {
  logo_small: string;
  logo_medium: string;
  logo_large: string;
  original: string;
  id: string;
}

export interface ToornamentTournament {
  id: string;
  name: string;
  logo: ToornamentLogo | null;
  scheduled_date_start: string;
}