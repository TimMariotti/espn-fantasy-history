import type { IndexFile, Matchup, Owner, Season, Team } from "./types";
import indexFile from "../data/index.json";

const seasonModules = import.meta.glob<Season>("../data/seasons/*.json", {
  eager: true,
  import: "default",
});

export const seasons: Season[] = Object.values(seasonModules).sort(
  (a, b) => a.year - b.year,
);

export const meta: IndexFile = indexFile as IndexFile;

export function ownerLabel(o: Owner): string {
  const full = [o.first_name, o.last_name].filter(Boolean).join(" ").trim();
  return full || o.display_name;
}

export function teamOwnerLabel(t: Team): string {
  if (!t.owners.length) return "Unknown";
  return t.owners.map(ownerLabel).join(", ");
}

export function ownerKey(o: Owner): string {
  const raw = o.id || o.display_name;
  return raw.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export type OwnerRecord = {
  owner: Owner;
  seasons: number;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  championships: number;
  runner_ups: number;
  playoff_appearances: number;
  best_finish: number | null;
  team_names: Set<string>;
  years: number[];
};

export function buildOwnerLeaderboard(): OwnerRecord[] {
  const records = new Map<string, OwnerRecord>();

  for (const season of seasons) {
    for (const team of season.teams) {
      for (const owner of team.owners) {
        const key = ownerKey(owner);
        if (!key) continue;
        let rec = records.get(key);
        if (!rec) {
          rec = {
            owner,
            seasons: 0,
            wins: 0,
            losses: 0,
            ties: 0,
            points_for: 0,
            points_against: 0,
            championships: 0,
            runner_ups: 0,
            playoff_appearances: 0,
            best_finish: null,
            team_names: new Set<string>(),
            years: [],
          };
          records.set(key, rec);
        }
        rec.seasons += 1;
        rec.wins += team.wins;
        rec.losses += team.losses;
        rec.ties += team.ties;
        rec.points_for += team.points_for;
        rec.points_against += team.points_against;
        rec.team_names.add(team.name);
        rec.years.push(season.year);
        const finish = team.final_standing ?? team.standing;
        if (finish === 1) rec.championships += 1;
        if (finish === 2) rec.runner_ups += 1;
        const playoffCutoff = season.settings.playoff_team_count ?? 6;
        if (finish && finish <= playoffCutoff) rec.playoff_appearances += 1;
        if (finish && (rec.best_finish === null || finish < rec.best_finish)) {
          rec.best_finish = finish;
        }
      }
    }
  }

  return Array.from(records.values()).sort((a, b) => {
    if (b.championships !== a.championships) return b.championships - a.championships;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.points_for - a.points_for;
  });
}

export type WeeklyScore = {
  year: number;
  week: number;
  team: Team;
  opponent?: Team;
  score: number;
  opp_score: number;
  margin: number;
  is_playoff: boolean;
};

export function allWeeklyScores(): WeeklyScore[] {
  const out: WeeklyScore[] = [];
  for (const season of seasons) {
    const teamMap = new Map(season.teams.map((t) => [t.id, t]));
    for (const week of season.weeks) {
      for (const m of week.matchups) {
        if (m.home_team_id === null || m.away_team_id === null) continue;
        const home = teamMap.get(m.home_team_id);
        const away = teamMap.get(m.away_team_id);
        if (!home || !away) continue;
        // Skip unplayed games
        if (m.home_score === 0 && m.away_score === 0) continue;
        out.push({
          year: season.year,
          week: week.week,
          team: home,
          opponent: away,
          score: m.home_score,
          opp_score: m.away_score,
          margin: m.home_score - m.away_score,
          is_playoff: m.is_playoff,
        });
        out.push({
          year: season.year,
          week: week.week,
          team: away,
          opponent: home,
          score: m.away_score,
          opp_score: m.home_score,
          margin: m.away_score - m.home_score,
          is_playoff: m.is_playoff,
        });
      }
    }
  }
  return out;
}

export type Records = {
  highestScore: WeeklyScore[];
  lowestScore: WeeklyScore[];
  biggestBlowout: WeeklyScore[];
  closestGame: WeeklyScore[];
  highestSeasonPF: { year: number; team: Team }[];
  lowestSeasonPF: { year: number; team: Team }[];
};

export function buildRecords(): Records {
  const weekly = allWeeklyScores();

  const sortedHigh = [...weekly].sort((a, b) => b.score - a.score).slice(0, 10);
  const sortedLow = [...weekly].sort((a, b) => a.score - b.score).slice(0, 10);
  const blowouts = [...weekly]
    .filter((w) => w.margin > 0)
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 10);
  // Closest games — dedupe by (year, week, low team id)
  const closeSeen = new Set<string>();
  const close: WeeklyScore[] = [];
  for (const w of [...weekly].sort((a, b) => Math.abs(a.margin) - Math.abs(b.margin))) {
    const lowId = Math.min(w.team.id, w.opponent?.id ?? 0);
    const key = `${w.year}-${w.week}-${lowId}`;
    if (closeSeen.has(key)) continue;
    closeSeen.add(key);
    close.push(w);
    if (close.length === 10) break;
  }

  const seasonPF: { year: number; team: Team }[] = [];
  for (const s of seasons) {
    for (const t of s.teams) {
      seasonPF.push({ year: s.year, team: t });
    }
  }

  return {
    highestScore: sortedHigh,
    lowestScore: sortedLow,
    biggestBlowout: blowouts,
    closestGame: close,
    highestSeasonPF: [...seasonPF].sort((a, b) => b.team.points_for - a.team.points_for).slice(0, 10),
    lowestSeasonPF: [...seasonPF].sort((a, b) => a.team.points_for - b.team.points_for).slice(0, 10),
  };
}

export function getSeason(year: number): Season | undefined {
  return seasons.find((s) => s.year === year);
}

export function fmtScore(n: number): string {
  return n.toFixed(2);
}

export function findOwnerByKey(key: string): Owner | undefined {
  for (const s of seasons) {
    for (const t of s.teams) {
      for (const o of t.owners) {
        if (ownerKey(o) === key) return o;
      }
    }
  }
  return undefined;
}

export function ownerSeasons(key: string): { season: Season; team: Team }[] {
  const out: { season: Season; team: Team }[] = [];
  for (const s of seasons) {
    for (const t of s.teams) {
      if (t.owners.some((o) => ownerKey(o) === key)) {
        out.push({ season: s, team: t });
      }
    }
  }
  return out.sort((a, b) => b.season.year - a.season.year);
}

export type H2HCell = { wins: number; losses: number; ties: number; pf: number; pa: number };

export function buildH2H(): { owners: Owner[]; matrix: Map<string, Map<string, H2HCell>> } {
  const ownerMap = new Map<string, Owner>();
  const matrix = new Map<string, Map<string, H2HCell>>();

  const cell = (a: string, b: string): H2HCell => {
    let row = matrix.get(a);
    if (!row) {
      row = new Map();
      matrix.set(a, row);
    }
    let c = row.get(b);
    if (!c) {
      c = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 };
      row.set(b, c);
    }
    return c;
  };

  for (const s of seasons) {
    const teamMap = new Map(s.teams.map((t) => [t.id, t]));
    for (const team of s.teams) {
      for (const o of team.owners) {
        const k = ownerKey(o);
        if (!ownerMap.has(k)) ownerMap.set(k, o);
      }
    }
    for (const week of s.weeks) {
      for (const m of week.matchups) {
        if (m.home_team_id === null || m.away_team_id === null) continue;
        if (m.home_score === 0 && m.away_score === 0) continue;
        const home = teamMap.get(m.home_team_id);
        const away = teamMap.get(m.away_team_id);
        if (!home || !away) continue;
        for (const ho of home.owners) {
          for (const ao of away.owners) {
            const hk = ownerKey(ho);
            const ak = ownerKey(ao);
            const homeCell = cell(hk, ak);
            const awayCell = cell(ak, hk);
            homeCell.pf += m.home_score;
            homeCell.pa += m.away_score;
            awayCell.pf += m.away_score;
            awayCell.pa += m.home_score;
            if (m.home_score > m.away_score) {
              homeCell.wins += 1;
              awayCell.losses += 1;
            } else if (m.home_score < m.away_score) {
              homeCell.losses += 1;
              awayCell.wins += 1;
            } else {
              homeCell.ties += 1;
              awayCell.ties += 1;
            }
          }
        }
      }
    }
  }

  return { owners: Array.from(ownerMap.values()), matrix };
}
