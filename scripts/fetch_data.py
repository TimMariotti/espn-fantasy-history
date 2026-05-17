"""Pull every available season for the configured ESPN league and write JSON to src/data/."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from espn_api.football import League
from espn_api.requests.espn_requests import ESPNAccessDenied, ESPNInvalidLeague

# Load .env from repo root if present (gitignored).
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

LEAGUE_ID = int(os.environ.get("LEAGUE_ID", "14250"))
ESPN_S2 = os.environ.get("ESPN_S2") or None
SWID = os.environ.get("SWID") or None

# ESPN's v3 fantasy API reliably serves data from 2018 onward.
EARLIEST_YEAR = int(os.environ.get("EARLIEST_YEAR", "2018"))
LATEST_YEAR = int(os.environ.get("LATEST_YEAR", str(datetime.now().year)))

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "src" / "data"
SEASONS_DIR = OUT_DIR / "seasons"


def serialize_team(team) -> dict:
    return {
        "id": team.team_id,
        "name": team.team_name,
        "abbrev": getattr(team, "team_abbrev", None),
        "owners": [
            {
                "id": o.get("id") if isinstance(o, dict) else None,
                "first_name": o.get("firstName") if isinstance(o, dict) else None,
                "last_name": o.get("lastName") if isinstance(o, dict) else None,
                "display_name": o.get("displayName") if isinstance(o, dict) else str(o),
            }
            for o in (team.owners or [])
        ],
        "wins": team.wins,
        "losses": team.losses,
        "ties": team.ties,
        "points_for": team.points_for,
        "points_against": team.points_against,
        "standing": team.standing,
        "final_standing": getattr(team, "final_standing", None),
        "playoff_pct": getattr(team, "playoff_pct", None),
        "logo_url": getattr(team, "logo_url", None),
        "division_id": getattr(team, "division_id", None),
        "division_name": getattr(team, "division_name", None),
        "schedule": [
            {
                "week": i + 1,
                "opponent_id": opp.team_id if opp else None,
                "score": team.scores[i] if i < len(team.scores) else None,
                "outcome": team.outcomes[i] if i < len(team.outcomes) else None,
            }
            for i, opp in enumerate(team.schedule or [])
        ],
    }


def serialize_matchup(m) -> dict:
    return {
        "home_team_id": m.home_team.team_id if m.home_team else None,
        "away_team_id": m.away_team.team_id if m.away_team else None,
        "home_score": m.home_score,
        "away_score": m.away_score,
        "is_playoff": getattr(m, "is_playoff", False),
        "matchup_type": getattr(m, "matchup_type", None),
    }


def serialize_draft_pick(p) -> dict:
    return {
        "round": p.round_num,
        "pick": p.round_pick,
        "team_id": p.team.team_id if p.team else None,
        "player_id": p.playerId,
        "player_name": p.playerName,
        "bid_amount": getattr(p, "bid_amount", None),
        "keeper": getattr(p, "keeper_status", False),
    }


def fetch_season(year: int) -> dict | None:
    league = League(
        league_id=LEAGUE_ID,
        year=year,
        espn_s2=ESPN_S2,
        swid=SWID,
    )

    teams = [serialize_team(t) for t in league.teams]

    weeks = []
    final_week = league.settings.reg_season_count + getattr(league.settings, "playoff_team_count", 0)
    for week in range(1, final_week + 1):
        try:
            matchups = league.scoreboard(week=week)
        except Exception:
            continue
        if not matchups:
            continue
        weeks.append(
            {
                "week": week,
                "matchups": [serialize_matchup(m) for m in matchups],
            }
        )

    draft = []
    try:
        draft = [serialize_draft_pick(p) for p in league.draft]
    except Exception:
        pass

    return {
        "year": year,
        "league_id": LEAGUE_ID,
        "league_name": getattr(league.settings, "name", None),
        "settings": {
            "reg_season_count": league.settings.reg_season_count,
            "playoff_team_count": getattr(league.settings, "playoff_team_count", None),
            "team_count": getattr(league.settings, "team_count", len(league.teams)),
            "scoring_type": getattr(league.settings, "scoring_type", None),
        },
        "teams": teams,
        "weeks": weeks,
        "draft": draft,
    }


def main() -> int:
    SEASONS_DIR.mkdir(parents=True, exist_ok=True)

    available_years: list[int] = []
    for year in range(EARLIEST_YEAR, LATEST_YEAR + 1):
        try:
            print(f"Fetching {year}...", flush=True)
            data = fetch_season(year)
        except (ESPNInvalidLeague, ESPNAccessDenied) as e:
            print(f"  skip {year}: {e}", flush=True)
            continue
        except Exception as e:
            print(f"  error {year}: {e}", flush=True)
            continue
        if not data:
            continue
        (SEASONS_DIR / f"{year}.json").write_text(json.dumps(data, indent=2, default=str))
        available_years.append(year)

    (OUT_DIR / "index.json").write_text(
        json.dumps(
            {
                "league_id": LEAGUE_ID,
                "years": available_years,
                "generated_at": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        )
    )
    print(f"Wrote {len(available_years)} season(s): {available_years}")
    return 0 if available_years else 1


if __name__ == "__main__":
    sys.exit(main())
