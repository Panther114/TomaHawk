# Tomahawk (战斧)

A deterministic modern joint-warfare simulation that runs in the browser. It centers on sensor detection, track fusion, cooperative engagement, magazine management, and subsystem damage so you can quickly build blue/red scenarios and review the engagement chain. Two symmetric command AIs act only on tracks each side can detect and share; the same seed and inputs always produce the same result.

Current version: **v1.0.0**

## Quick start

Requires Node.js 20 or newer. No third-party dependencies to install.

```bash
npm start
```

Open <http://127.0.0.1:4172>:

- `/` — one-screen product landing page
- `/sandbox` — tactical sandbox (desktop browser content area of at least 960×560 recommended)
- `/guide` — in-app Chinese player manual

Run checks:

```bash
npm test
npm run bench:frontend
npm run bench
npm run bench:server
```

## Railway deployment

Root `railway.json` is set up for `npm start`, a `/health` check, and restart-on-failure. Connect the GitHub repo and deploy; no database, volume, build command, or extra environment variables are required. The process listens on Railway’s `0.0.0.0:$PORT`.

Production only streams static files, caps the Node heap at 64 MiB, and does not cache maps or images. Simulation, Canvas drawing, scenario serialization, AAR, tutorial state, and the Unit Workshop all run in the browser. On Railway, local disk scenario endpoints and debug log endpoints are disabled. User saves use browser downloads, file pickers, and IndexedDB.

## What it models

- Coordinated naval, subsurface, ground, and air units
- Radar, sonar, ESM, radar horizon, RCS, and track ageing
- Fused force picture, track sharing, and engage-on-remote cooperative fire
- Layered air defence, point defence, anti-ship, strike, ASW, and hypersonic offence/defence
- Aircraft fuel, RTB, rearm, carrier deck, and airfield support
- Electronic attack, burn-through, anti-radiation pressure, and limited soft-kill decoys
- Subsystem damage, per-aircraft attrition, and magazine exhaustion
- Local Unit Workshop, scenario saves, and AAR reports

This project is not a validated mission-planning or operational-analysis tool. It does not model mines, logistics, weather/sea state, crew training, or political decisions. Public equipment parameters are engineering abstractions built from open sources.

## Basic play

1. In the sandbox, open **部署装备** (Deploy equipment) at the top left and choose Blue or Red.
2. Pick a unit from the library and click repeatedly on the map to place; a red preview means the position is invalid.
3. Place at least one living unit on each side.
4. Press `Space` or use the bottom play control to start.
5. Watch the top battle strip, map tracks, and right-hand unit detail.

Full repo notes are in the [Player guide](docs/PLAYER_GUIDE.md). The illustrated in-app manual is at `/guide` (Simplified Chinese).

## Project structure

- `index.html` — landing page
- `sandbox.html` — tactical sandbox shell
- `guide.html` — in-app Chinese player tutorial
- `src/app.js` — Canvas drawing, UI state, and interaction
- `src/ui/` — Simplified Chinese messages, equipment catalog, tactical symbols, tutorial steps
- `src/sim/` — deterministic simulation core
- `src/mods/` — Unit Workshop and local migration
- `server.mjs` — low-memory static file server; disk saves and debug endpoints are local-dev only
- `tests/` — rules, persistence, UI, and performance regression tests

Architecture boundaries: [Architecture](docs/ARCHITECTURE.md). Simulation rules: [Simulation](docs/SIMULATION.md).

## Documentation

- [Player guide](docs/PLAYER_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Simulation](docs/SIMULATION.md)
- [Unit Workshop](docs/MODDING.md)
- [Sources](docs/SOURCES.md)
- [Roadmap](docs/ROADMAP.md)
- [Changelog](CHANGELOG.md)

## License

Code is released under the [PolyForm Noncommercial 1.0.0](LICENSE) license. Real equipment names only identify simulated objects and do not imply endorsement by any manufacturer, service, or agency.
