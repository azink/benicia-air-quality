# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (runs Express + Vite dev server concurrently)
npm run dev

# Production build (output to dist/)
npm run build

# Start production server (serves built dist/ as static files)
npm start
```

There are no tests or linters configured.

## Architecture

This is a full-stack air quality dashboard for Benicia, CA. The Express backend and React frontend are bundled together in one Node process for production.

**Data flow:**
1. `collector.js` polls OpenAQ (official BAAQMD/CARB stations) and PurpleAir (community sensors) every 10 minutes via `node-cron`, writing to a local SQLite DB
2. `db.js` initializes the SQLite database using Node's built-in `node:sqlite` (`DatabaseSync`) — requires Node 22+
3. `server.js` exposes the data via REST API endpoints and serves the React SPA from `dist/`
4. `src/App.jsx` is the entire frontend — a single-file React component that polls the API every 5 minutes and renders sensor cards + a Recharts trend chart

**Dev vs production:**
- In dev (`npm run dev`), Vite runs its own dev server on a separate port with `/api` proxied to Express at `:3001` (see `vite.config.js`)
- In production, Express serves the Vite build from `dist/` via `express.static` plus a `GET *` catch-all for SPA routing; the `heroku-postbuild` script runs `vite build` automatically on Heroku

**API endpoints (all on Express):**
- `GET /api/sensors` — all known sensors
- `GET /api/readings/latest` — most recent reading per sensor (joined with sensor metadata)
- `GET /api/readings/history?sensor_id=&hours=24` — time-series for one or all sensors
- `GET /api/readings/trend?hours=168` — hourly averages across all sensors (for the chart)
- `GET /api/stats` — aggregate counts and date range
- `POST /api/collect` — trigger an immediate collection run

**Environment variables** (see `.env.example`):
- `OPENAQ_API_KEY` — required for official station data
- `PURPLEAIR_READ_KEY` — optional, adds hyperlocal community sensors
- `PORT` — defaults to 3001

**Known issues in the codebase:**
- `sensor_index` is missing from the PurpleAir `fields` request param (`collector.js:119`), causing all PurpleAir sensor IDs to use the sensor name instead of the numeric index
- The EPA PM2.5→AQI breakpoint table has gaps (e.g. 12.0–12.1) and no guard for negative values — both return AQI 500 incorrectly
- The `hours` query param is not validated; non-numeric values throw `RangeError` in the route handler
- `upsertSensor` never updates `latitude`/`longitude` on conflict, freezing coordinates at first-seen values
