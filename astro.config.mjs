import { defineConfig } from "astro/config";

// Site URL is set by the deploy workflow via ASTRO_SITE / ASTRO_BASE env vars.
const site = process.env.ASTRO_SITE || "http://localhost:4321";
const base = process.env.ASTRO_BASE || "/";

export default defineConfig({
  site,
  base,
  trailingSlash: "ignore",
  build: {
    format: "directory",
  },
});
