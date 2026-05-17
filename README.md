# ESPN Fantasy League History

Static history site for an ESPN fantasy football league. Python pulls every available season into JSON, Astro builds a static site from that JSON, GitHub Actions runs both on a weekly cron and deploys to GitHub Pages.

## Stack

- `scripts/fetch_data.py` — uses [`espn-api`](https://github.com/cwendt94/espn-api) to fetch each season and write `src/data/seasons/<year>.json` + `src/data/index.json`
- Astro 5 static site at the repo root, reading those JSON files at build time via `import.meta.glob`
- `.github/workflows/build-and-deploy.yml` — runs fetch + build, deploys to GitHub Pages

## Configuration

Set in `.github/workflows/build-and-deploy.yml` via repo **Variables** and **Secrets**:

| Name | Where | Required | Notes |
| --- | --- | --- | --- |
| `LEAGUE_ID` | variable | yes (default `14250`) | Your ESPN league ID |
| `ESPN_S2` | secret | only for private leagues | Browser cookie `espn_s2` |
| `SWID` | secret | only for private leagues | Browser cookie `SWID` (keep the braces) |
| `ASTRO_SITE` / `ASTRO_BASE` | variable | optional | Override defaults for a custom domain |

To grab cookies: log in to ESPN, open devtools → Application → Cookies → `espn.com`, copy `espn_s2` and `SWID`.

## Local development

Requires **Node 18.20.8+** (or 20+) and **Python 3.10+**. The Node 16 you may have system-wide is too old for Astro 5.

```sh
# 1. Pull data
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
LEAGUE_ID=14250 .venv/bin/python scripts/fetch_data.py

# 2. Run the site
npm install
npm run dev
```

## Deploy

1. Push to GitHub.
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. (Private league only) Repo → Settings → Secrets and variables → Actions → add `ESPN_S2` and `SWID`.
4. Trigger the workflow manually the first time (`Actions` tab → Build and Deploy → Run workflow), then the Tuesday cron keeps it fresh.

## Adding new records / pages

- Aggregations live in `src/lib/data.ts` — add a new helper (e.g. `buildLongestWinStreak`) and surface it in `src/pages/records.astro`.
- Per-season pages are generated from `src/pages/seasons/[year].astro` via `getStaticPaths`.
