import type { DraftPick, IndexFile, Matchup, Owner, Season, Team } from "./types";
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

export type GameCategory = "regular" | "playoff" | "consolation";

export type WeeklyScore = {
  year: number;
  week: number;
  team: Team;
  opponent?: Team;
  score: number;
  opp_score: number;
  margin: number;
  is_playoff: boolean;
  matchup_type: string | null;
  category: GameCategory;
};

export function categorize(matchup_type: string | null): GameCategory {
  if (!matchup_type || matchup_type === "NONE") return "regular";
  if (matchup_type === "WINNERS_BRACKET") return "playoff";
  return "consolation";
}

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
        const category = categorize(m.matchup_type);
        out.push({
          year: season.year,
          week: week.week,
          team: home,
          opponent: away,
          score: m.home_score,
          opp_score: m.away_score,
          margin: m.home_score - m.away_score,
          is_playoff: m.is_playoff,
          matchup_type: m.matchup_type,
          category,
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
          matchup_type: m.matchup_type,
          category,
        });
      }
    }
  }
  return out;
}

export type RecordBucket = {
  highestScore: WeeklyScore[];
  lowestScore: WeeklyScore[];
  biggestBlowout: WeeklyScore[];
  closestGame: WeeklyScore[];
};

export type Records = {
  regularSeason: RecordBucket;
  playoffs: RecordBucket;
  highestSeasonPF: { year: number; team: Team }[];
  lowestSeasonPF: { year: number; team: Team }[];
};

function bucketFor(weekly: WeeklyScore[]): RecordBucket {
  const high = [...weekly].sort((a, b) => b.score - a.score).slice(0, 10);
  const low = [...weekly].sort((a, b) => a.score - b.score).slice(0, 10);
  const blowouts = [...weekly]
    .filter((w) => w.margin > 0)
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 10);
  // Dedupe close games by (year, week, low team id)
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
  return { highestScore: high, lowestScore: low, biggestBlowout: blowouts, closestGame: close };
}

export function buildRecords(): Records {
  const weekly = allWeeklyScores();
  const regular = weekly.filter((w) => w.category === "regular");
  // Treat consolation alongside playoff for "postseason" — exclude if you want strict.
  const postseason = weekly.filter((w) => w.category !== "regular");

  const seasonPF: { year: number; team: Team }[] = [];
  for (const s of seasons) {
    for (const t of s.teams) {
      seasonPF.push({ year: s.year, team: t });
    }
  }

  return {
    regularSeason: bucketFor(regular),
    playoffs: bucketFor(postseason),
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
  // Walk newest → oldest so the latest first_name wins.
  const ordered = [...seasons].sort((a, b) => b.year - a.year);
  for (const s of ordered) {
    for (const t of s.teams) {
      for (const o of t.owners) {
        if (ownerKey(o) === key) return o;
      }
    }
  }
  return undefined;
}

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "D/ST"] as const;
export type Position = (typeof POSITIONS)[number];
export const TRACKED_POSITIONS = POSITIONS;

export type OwnerDraftStats = {
  owner: Owner;
  totalPicks: number;
  drafts: number;
  keepers: number;
  avgPick: number;
  earliestPick: number;
  positionCounts: Record<string, number>;
  firstRoundPositions: Record<string, number>;
  topPlayers: { name: string; position: string | null; count: number; years: number[] }[];
};

export function buildDraftStats(): OwnerDraftStats[] {
  const map = new Map<string, OwnerDraftStats>();
  const draftYearsByOwner = new Map<string, Set<number>>();
  // owner_key -> player_id -> { name, position, years }
  const playerCounts = new Map<
    string,
    Map<number, { name: string; position: string | null; years: number[] }>
  >();

  for (const season of seasons) {
    const teamOwners = new Map<number, Owner[]>(
      season.teams.map((t) => [t.id, t.owners]),
    );
    for (const pick of season.draft) {
      if (pick.team_id === null) continue;
      const owners = teamOwners.get(pick.team_id) || [];
      for (const owner of owners) {
        const key = ownerKey(owner);
        let rec = map.get(key);
        if (!rec) {
          rec = {
            owner,
            totalPicks: 0,
            drafts: 0,
            keepers: 0,
            avgPick: 0,
            earliestPick: Infinity,
            positionCounts: {},
            firstRoundPositions: {},
            topPlayers: [],
          };
          map.set(key, rec);
        }
        rec.owner = owner;
        rec.totalPicks += 1;
        if (pick.keeper) rec.keepers += 1;
        const overall = (pick.round - 1) * (season.teams.length || 10) + pick.pick;
        rec.avgPick += overall;
        if (overall < rec.earliestPick) rec.earliestPick = overall;
        const pos = pick.position || "?";
        rec.positionCounts[pos] = (rec.positionCounts[pos] || 0) + 1;
        if (pick.round === 1) {
          rec.firstRoundPositions[pos] = (rec.firstRoundPositions[pos] || 0) + 1;
        }
        let years = draftYearsByOwner.get(key);
        if (!years) {
          years = new Set<number>();
          draftYearsByOwner.set(key, years);
        }
        years.add(season.year);

        let pmap = playerCounts.get(key);
        if (!pmap) {
          pmap = new Map();
          playerCounts.set(key, pmap);
        }
        let entry = pmap.get(pick.player_id);
        if (!entry) {
          entry = {
            name: pick.player_name,
            position: pick.position,
            years: [],
          };
          pmap.set(pick.player_id, entry);
        }
        entry.years.push(season.year);
      }
    }
  }

  for (const [key, rec] of map) {
    rec.drafts = draftYearsByOwner.get(key)?.size ?? 0;
    rec.avgPick = rec.totalPicks > 0 ? rec.avgPick / rec.totalPicks : 0;
    if (rec.earliestPick === Infinity) rec.earliestPick = 0;
    const pmap = playerCounts.get(key);
    if (pmap) {
      rec.topPlayers = Array.from(pmap.values())
        .map((e) => ({
          name: e.name,
          position: e.position,
          count: e.years.length,
          years: e.years.slice().sort((a, b) => a - b),
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 5);
    }
  }

  return Array.from(map.values()).sort((a, b) => b.totalPicks - a.totalPicks);
}

export type DraftValueEntry = {
  season: Season;
  pick: DraftPick;
  overall: number;
  posDraftOrder: number; // 1 = first player at this position drafted in this league
  posFinishRank: number; // 1 = top scorer at this position among drafted players
  vodp: number; // posDraftOrder - posFinishRank (positional). Positive = steal.
  team: Team | undefined;
};

/**
 * Compute positional "Value Over Draft Position" for every drafted player who
 * has season points. Within each season+position bucket we rank players by
 * draft order and by season points; VODP is the difference. Higher = steal.
 * Keepers are excluded — their slot is fixed, not a value choice.
 */
export function buildDraftValues(): DraftValueEntry[] {
  const out: DraftValueEntry[] = [];
  for (const season of seasons) {
    const teamCount = season.teams.length || 10;
    const teamMap = new Map(season.teams.map((t) => [t.id, t]));
    const overallOf = (p: DraftPick) => (p.round - 1) * teamCount + p.pick;

    const byPos = new Map<string, DraftPick[]>();
    for (const p of season.draft) {
      if (p.keeper) continue;
      if (p.season_points === null || p.season_points === undefined) continue;
      const pos = p.position || "?";
      let bucket = byPos.get(pos);
      if (!bucket) {
        bucket = [];
        byPos.set(pos, bucket);
      }
      bucket.push(p);
    }

    for (const picks of byPos.values()) {
      const draftOrder = new Map<number, number>();
      [...picks]
        .sort((a, b) => overallOf(a) - overallOf(b))
        .forEach((p, i) => draftOrder.set(p.player_id, i + 1));
      const finishRank = new Map<number, number>();
      [...picks]
        .sort((a, b) => (b.season_points ?? 0) - (a.season_points ?? 0))
        .forEach((p, i) => finishRank.set(p.player_id, i + 1));

      for (const p of picks) {
        const pdo = draftOrder.get(p.player_id)!;
        const pfr = finishRank.get(p.player_id)!;
        out.push({
          season,
          pick: p,
          overall: overallOf(p),
          posDraftOrder: pdo,
          posFinishRank: pfr,
          vodp: pdo - pfr,
          team: p.team_id !== null ? teamMap.get(p.team_id) : undefined,
        });
      }
    }
  }
  return out;
}

export function ownerDraftPicks(key: string): { season: Season; pick: DraftPick }[] {
  const out: { season: Season; pick: DraftPick }[] = [];
  for (const s of seasons) {
    const teamOwners = new Map<number, Owner[]>(
      s.teams.map((t) => [t.id, t.owners]),
    );
    for (const pick of s.draft) {
      if (pick.team_id === null) continue;
      const owners = teamOwners.get(pick.team_id) || [];
      if (owners.some((o) => ownerKey(o) === key)) {
        out.push({ season: s, pick });
      }
    }
  }
  return out.sort((a, b) => {
    if (a.season.year !== b.season.year) return b.season.year - a.season.year;
    return a.pick.round * 100 + a.pick.pick - (b.pick.round * 100 + b.pick.pick);
  });
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

export type WeeklyStanding = {
  team: Team;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  rank: number;
};

export type SeasonStandingsHistory = {
  year: number;
  teams: Team[];
  regSeasonWeeks: number;
  weeks: { week: number; standings: WeeklyStanding[] }[];
};

/**
 * Walk regular-season weeks in order and produce the cumulative standings
 * after each completed week. Rank uses win% then PF — the common fantasy tiebreak.
 */
export function buildSeasonStandingsHistory(year: number): SeasonStandingsHistory | undefined {
  const season = getSeason(year);
  if (!season) return undefined;
  const regWeeks = season.settings.reg_season_count ?? 0;
  const totals = new Map<number, { wins: number; losses: number; ties: number; pf: number }>();
  for (const t of season.teams) totals.set(t.id, { wins: 0, losses: 0, ties: 0, pf: 0 });

  const orderedWeeks = [...season.weeks].sort((a, b) => a.week - b.week);
  const history: { week: number; standings: WeeklyStanding[] }[] = [];
  for (const w of orderedWeeks) {
    if (regWeeks && w.week > regWeeks) break;
    let counted = 0;
    for (const m of w.matchups) {
      if (m.home_team_id === null || m.away_team_id === null) continue;
      if (categorize(m.matchup_type) !== "regular") continue;
      if (m.home_score === 0 && m.away_score === 0) continue;
      const home = totals.get(m.home_team_id);
      const away = totals.get(m.away_team_id);
      if (!home || !away) continue;
      home.pf += m.home_score;
      away.pf += m.away_score;
      if (m.home_score > m.away_score) {
        home.wins += 1;
        away.losses += 1;
      } else if (m.home_score < m.away_score) {
        away.wins += 1;
        home.losses += 1;
      } else {
        home.ties += 1;
        away.ties += 1;
      }
      counted += 1;
    }
    if (!counted) continue;
    const ranked = season.teams
      .map((t) => {
        const r = totals.get(t.id)!;
        return {
          team: t,
          wins: r.wins,
          losses: r.losses,
          ties: r.ties,
          points_for: r.pf,
        };
      })
      .sort((a, b) => {
        const aWp = a.wins + 0.5 * a.ties;
        const bWp = b.wins + 0.5 * b.ties;
        if (bWp !== aWp) return bWp - aWp;
        return b.points_for - a.points_for;
      });
    history.push({
      week: w.week,
      standings: ranked.map((r, i) => ({ ...r, rank: i + 1 })),
    });
  }
  return { year: season.year, teams: season.teams, regSeasonWeeks: regWeeks, weeks: history };
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
