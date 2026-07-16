# Map Data

The coastline presentation layer is generated from the public-domain
Natural Earth 1:50m land and coastline datasets. The checked-in bundle is
pinned to Natural Earth vector revision
`ca96624a56bd078437bca8184e78163e5039ad19`.

## Coverage and projection

- Source CRS: WGS84 longitude/latitude (`EPSG:4326`).
- Source coverage: full globe (`-180..180` longitude, `-90..90` latitude).
- Display projection: spherical equirectangular meters, centered at `0, 0`.
- Map bounds: one full Earth circumference wide by half an Earth circumference
  tall, so the coastline layer covers the complete globe.
- Land and coastlines are rendered separately, preserving small islands.

Run `npm run map:data` to regenerate
`src/ui/data/east-china-sea-data.js`. The application loads the generated local
module and does not require network access at runtime.

Terrain is no longer presentation-only. `src/world/terrain.js` exposes the
shared binary water/land queries used by both rendering and the simulation:
setup placement checks, setup-only map resets, direct-path tests, coastal
detours, and final swept-segment movement guards all use the same projected
Natural Earth geometry. Placement is domain-aware: **sea** units (including
`CVN`) must sit on water; **fixed ground** emplacements (SAM, THAAD, CDB, DEB,
EWR) must sit on land (`isLandPoint`); **airfields** (`AFB` / ground
`isAirfield`) may sit on land or water; **air** squadrons may be placed
anywhere and overfly terrain. There is still no shallow/deep-water concept; the
navigability rule is simply water vs not-water.

Runtime terrain queries do not scan every Natural Earth vertex. A lazy 0.5 NM
water mask identifies cells whose expanded bounds contain no land, while 24 NM
ring and edge grids narrow coastal queries to relevant geometry. The mask is
conservative: uncertain cells always fall back to polygon containment and
continuous segment/edge intersection checks, so the grid cannot classify an
uncertain coastal cell as navigable water.

The renderer also culls terrain features by viewport before drawing the cached
terrain layer, so global coverage does not mean every coastline path is stroked
on every camera movement.
