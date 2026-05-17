export type Owner = {
  id: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
};

export type ScheduleEntry = {
  week: number;
  opponent_id: number | null;
  score: number | null;
  outcome: string | null;
};

export type Team = {
  id: number;
  name: string;
  abbrev: string | null;
  owners: Owner[];
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  standing: number;
  final_standing: number | null;
  playoff_pct: number | null;
  logo_url: string | null;
  division_id: number | null;
  division_name: string | null;
  schedule: ScheduleEntry[];
};

export type Matchup = {
  home_team_id: number | null;
  away_team_id: number | null;
  home_score: number;
  away_score: number;
  is_playoff: boolean;
  matchup_type: string | null;
};

export type WeekData = {
  week: number;
  matchups: Matchup[];
};

export type DraftPick = {
  round: number;
  pick: number;
  team_id: number | null;
  player_id: number;
  player_name: string;
  position: string | null;
  pro_team: string | null;
  season_points: number | null;
  avg_points: number | null;
  bid_amount: number | null;
  keeper: boolean;
};

export type Season = {
  year: number;
  league_id: number;
  league_name: string;
  settings: {
    reg_season_count: number;
    playoff_team_count: number | null;
    team_count: number;
    scoring_type: string | null;
  };
  teams: Team[];
  weeks: WeekData[];
  draft: DraftPick[];
};

export type IndexFile = {
  league_id: number;
  years: number[];
  generated_at: string;
};
