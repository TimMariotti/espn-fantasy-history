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

export type AllPlayRecord = {
  owner: Owner;
  wins: number;
  losses: number;
  ties: number;
};

/**
 * All-play: every regular-season week, compare each team's score against every
 * other team that played. Strips schedule luck — what your record would be if
 * you played the whole field every week.
 */
export function buildAllPlay(): Map<string, AllPlayRecord> {
  const out = new Map<string, AllPlayRecord>();
  for (const s of seasons) {
    const teamMap = new Map(s.teams.map((t) => [t.id, t]));
    for (const w of s.weeks) {
      const scores: { teamId: number; score: number }[] = [];
      for (const m of w.matchups) {
        if (categorize(m.matchup_type) !== "regular") continue;
        if (m.home_team_id === null || m.away_team_id === null) continue;
        if (m.home_score === 0 && m.away_score === 0) continue;
        scores.push({ teamId: m.home_team_id, score: m.home_score });
        scores.push({ teamId: m.away_team_id, score: m.away_score });
      }
      for (const { teamId, score } of scores) {
        const team = teamMap.get(teamId);
        if (!team) continue;
        let wc = 0, lc = 0, tc = 0;
        for (const other of scores) {
          if (other.teamId === teamId) continue;
          if (score > other.score) wc++;
          else if (score < other.score) lc++;
          else tc++;
        }
        for (const o of team.owners) {
          const k = ownerKey(o);
          let rec = out.get(k);
          if (!rec) {
            rec = { owner: o, wins: 0, losses: 0, ties: 0 };
            out.set(k, rec);
          }
          rec.wins += wc;
          rec.losses += lc;
          rec.ties += tc;
          rec.owner = o;
        }
      }
    }
  }
  return out;
}

export type PythagSeason = {
  year: number;
  team: Team;
  reg_pf: number;
  reg_pa: number;
  wins: number;
  losses: number;
  ties: number;
  games: number;
  expected_wins: number;
  delta: number; // actualWinsWithTies - expectedWins (positive = lucky)
};

const PYTHAG_EXP = 2.37;

/**
 * Pythagorean expected wins per team-season using the regular-season schedule.
 * exp_win_pct = PF^k / (PF^k + PA^k), k = 2.37 (commonly cited for fantasy).
 * Delta = actual wins (ties counted as 0.5) − expected wins.
 */
export function buildPythagorean(): PythagSeason[] {
  const out: PythagSeason[] = [];
  for (const s of seasons) {
    const stats = new Map<number, { pf: number; pa: number; w: number; l: number; t: number }>();
    for (const t of s.teams) stats.set(t.id, { pf: 0, pa: 0, w: 0, l: 0, t: 0 });
    for (const w of s.weeks) {
      for (const m of w.matchups) {
        if (categorize(m.matchup_type) !== "regular") continue;
        if (m.home_team_id === null || m.away_team_id === null) continue;
        if (m.home_score === 0 && m.away_score === 0) continue;
        const h = stats.get(m.home_team_id);
        const a = stats.get(m.away_team_id);
        if (!h || !a) continue;
        h.pf += m.home_score; h.pa += m.away_score;
        a.pf += m.away_score; a.pa += m.home_score;
        if (m.home_score > m.away_score) { h.w++; a.l++; }
        else if (m.home_score < m.away_score) { a.w++; h.l++; }
        else { h.t++; a.t++; }
      }
    }
    for (const t of s.teams) {
      const r = stats.get(t.id)!;
      const games = r.w + r.l + r.t;
      if (games === 0) continue;
      const pfx = Math.pow(r.pf, PYTHAG_EXP);
      const pax = Math.pow(r.pa, PYTHAG_EXP);
      const denom = pfx + pax;
      const expWinPct = denom > 0 ? pfx / denom : 0.5;
      const expWins = expWinPct * games;
      const actualWins = r.w + 0.5 * r.t;
      out.push({
        year: s.year,
        team: t,
        reg_pf: r.pf,
        reg_pa: r.pa,
        wins: r.w,
        losses: r.l,
        ties: r.t,
        games,
        expected_wins: expWins,
        delta: actualWins - expWins,
      });
    }
  }
  return out;
}

export type OwnerStreak = {
  owner: Owner;
  kind: "win" | "loss";
  length: number;
  start: { year: number; week: number };
  end: { year: number; week: number };
};

/**
 * Longest regular-season win/loss streaks per owner, across all history.
 * Streaks cross season boundaries; ties terminate a streak.
 */
export function buildStreaks(): { winStreaks: OwnerStreak[]; lossStreaks: OwnerStreak[] } {
  const games = new Map<
    string,
    { owner: Owner; year: number; week: number; outcome: -1 | 0 | 1 }[]
  >();
  for (const s of seasons) {
    const teamMap = new Map(s.teams.map((t) => [t.id, t]));
    const orderedWeeks = [...s.weeks].sort((a, b) => a.week - b.week);
    for (const w of orderedWeeks) {
      for (const m of w.matchups) {
        if (categorize(m.matchup_type) !== "regular") continue;
        if (m.home_team_id === null || m.away_team_id === null) continue;
        if (m.home_score === 0 && m.away_score === 0) continue;
        const home = teamMap.get(m.home_team_id);
        const away = teamMap.get(m.away_team_id);
        if (!home || !away) continue;
        const outcome: -1 | 0 | 1 = m.home_score > m.away_score ? 1
          : m.home_score < m.away_score ? -1 : 0;
        for (const o of home.owners) {
          const k = ownerKey(o);
          let arr = games.get(k);
          if (!arr) { arr = []; games.set(k, arr); }
          arr.push({ owner: o, year: s.year, week: w.week, outcome });
        }
        for (const o of away.owners) {
          const k = ownerKey(o);
          let arr = games.get(k);
          if (!arr) { arr = []; games.set(k, arr); }
          arr.push({ owner: o, year: s.year, week: w.week, outcome: (-outcome) as -1 | 0 | 1 });
        }
      }
    }
  }

  const all: OwnerStreak[] = [];
  for (const arr of games.values()) {
    arr.sort((a, b) => a.year - b.year || a.week - b.week);
    let cur: OwnerStreak | null = null;
    const close = () => { if (cur) all.push(cur); cur = null; };
    for (const g of arr) {
      if (g.outcome === 0) { close(); continue; }
      const kind: "win" | "loss" = g.outcome === 1 ? "win" : "loss";
      if (cur && cur.kind === kind) {
        cur.length += 1;
        cur.end = { year: g.year, week: g.week };
        cur.owner = g.owner;
      } else {
        close();
        cur = {
          owner: g.owner,
          kind,
          length: 1,
          start: { year: g.year, week: g.week },
          end: { year: g.year, week: g.week },
        };
      }
    }
    close();
  }

  return {
    winStreaks: all.filter((s) => s.kind === "win").sort((a, b) => b.length - a.length).slice(0, 10),
    lossStreaks: all.filter((s) => s.kind === "loss").sort((a, b) => b.length - a.length).slice(0, 10),
  };
}

export type ScoreDistribution = {
  owner: Owner;
  scores: number[];
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  count: number;
};

export function buildScoreDistributions(): ScoreDistribution[] {
  const map = new Map<string, { owner: Owner; scores: number[] }>();
  for (const s of seasons) {
    const teamMap = new Map(s.teams.map((t) => [t.id, t]));
    for (const w of s.weeks) {
      for (const m of w.matchups) {
        if (categorize(m.matchup_type) !== "regular") continue;
        if (m.home_team_id === null || m.away_team_id === null) continue;
        if (m.home_score === 0 && m.away_score === 0) continue;
        const pairs: [Team | undefined, number][] = [
          [teamMap.get(m.home_team_id), m.home_score],
          [teamMap.get(m.away_team_id), m.away_score],
        ];
        for (const [team, score] of pairs) {
          if (!team) continue;
          for (const o of team.owners) {
            const k = ownerKey(o);
            let entry = map.get(k);
            if (!entry) { entry = { owner: o, scores: [] }; map.set(k, entry); }
            entry.scores.push(score);
            entry.owner = o;
          }
        }
      }
    }
  }
  const quantile = (sorted: number[], p: number) => {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  return Array.from(map.values())
    .map((e) => {
      const sorted = [...e.scores].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      return {
        owner: e.owner,
        scores: sorted,
        min: sorted[0] ?? 0,
        q1: quantile(sorted, 0.25),
        median: quantile(sorted, 0.5),
        q3: quantile(sorted, 0.75),
        max: sorted[sorted.length - 1] ?? 0,
        mean: sorted.length ? sum / sorted.length : 0,
        count: sorted.length,
      };
    })
    .sort((a, b) => b.median - a.median);
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
