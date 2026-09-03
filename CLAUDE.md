# espn-fantasy-history

Static Astro site of an ESPN fantasy league's history. `scripts/fetch_data.py` pulls each
season from ESPN into `src/data/**.json`; Astro builds the site from that JSON at the repo root;
GitHub Actions refreshes weekly (Wednesday cron) and deploys to GitHub Pages.

## Comment style (this repo only)

Personal project — the global `[ai]` comment-tag rule does **not** apply here. Do not prefix
comments with `[ai]`. Instead:

- Start each source file with a short summary comment of what the file does.
- Keep other comments sparse and plain — only the non-obvious *why*.
