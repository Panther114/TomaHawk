# Player guide

The live product UI is Simplified Chinese. This page is the English repo manual. The illustrated, interactive tutorial is available in-app at `/guide`.

## Interactive manual

`/guide` is a semantic single-page task manual rather than a slide deck. Its seven chapters follow the actual play sequence: quick start, console orientation, deployment, running and reading a battle, system tools, Unit Workshop, then shortcuts and troubleshooting.

The code-native mini console is safe to experiment with: it models deployment, selection, the ruler, map layers, playback, time rate, unit details, and the tools menu without starting the simulation core. Each lesson states the action to perform, the result to observe, and a common failure mode. Completed lessons are stored in `localStorage["tomahawk.guideProgress.v1"]`; storage failure does not disable the tutorial.

The deployment, running-state, system-tools, and Unit Workshop chapters use screenshots generated from the current sandbox at 1600×900. Their numbered rectangles and explanations are responsive HTML overlays, so annotations remain selectable and readable on mobile. Regenerate the checked-in image set with:

```bash
npm run screenshot:guide
```

The command drives the public UI with Playwright, verifies that all eight PNGs decode at the expected dimensions, and writes a diagnostic report to `artifacts/guide-screenshots.json`.

## First battle

Open `/sandbox`, then click **部署装备** (Deploy equipment) at the top left. Choose a side, then pick equipment from sea, subsurface, ground, or air categories. After the library closes, the cursor shows a tactical-symbol preview:

- Affiliation-colored outline — valid position; click repeatedly to place more of the same type.
- Red outline — invalid position; a reason appears at the top of the screen.
- `Esc` or right-click — end continuous placement.

Naval units and submarines need open water; ground radar, SAM, and strike batteries need land; aircraft and airfields can be placed anywhere. With at least one living unit on each side, press `Space` to start.

## Reading the console

- Top left: deploy, select, range/ruler.
- Top: living units per side, total durability, anti-ship inventory, air-defence inventory, and aggression.
- Right: unit detail and force list; expands automatically when a unit is selected.
- Bottom left: scale bar, coordinates, and layer controls.
- Bottom: play, single-step, 1–60× rate, and scenario time.
- Top right: save, load, AAR, Unit Workshop, and reset.

The map is the main information surface. Tracks are not true target positions: dashed lines, transparency, and error rings reflect shared or uncertain data.

## Shortcuts

| Action | Key |
| --- | --- |
| Play / pause | `Space` |
| Single step | `.` |
| Ruler | `R` |
| End deploy or cancel tool | `Esc` |
| Cycle units | `Tab` (when the map has focus) |
| Delete unit | `Delete` (setup only) |
| Zoom | Mouse wheel |
| Pan | Middle mouse or `Alt` + drag |

## Saves, AAR, and workshop

The **工具** (Tools) menu can save a scenario to the local library or download a JSON file. AAR filenames start with `tomahawk-aar-`; events keep original fields and add `displayTextZh` for Chinese display text.

Built-in Unit Workshop records are read-only. Clone them to edit parameters and loadouts; custom units live in the browser IndexedDB database `tomahawk-mods` and can be imported or exported as JSON.

The fuller interactive guide is at in-app `/guide` (Simplified Chinese).
