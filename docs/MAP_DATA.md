# Map Data

The East China Sea presentation layer is generated from the public-domain
Natural Earth 1:10m land and coastline datasets. The checked-in subset is
pinned to Natural Earth vector revision
`ca96624a56bd078437bca8184e78163e5039ad19`.

## Coverage and projection

- Source CRS: WGS84 longitude/latitude (`EPSG:4326`).
- Source crop: `116-134 E`, `23-34 N`, retaining geometry beyond the visible
  rectangle so coastlines clip cleanly at its edge.
- Display projection: spherical azimuthal equidistant, centered at
  `125 E, 28.2 N`.
- Initial operational core: approximately `118.2-131.8 E`, `25.2-31.2 N`.
  The projected map continues to the viewport edges without stretching or an
  artificial clipping rectangle.
- Land and coastlines are rendered separately, preserving small islands and
  preventing data-crop edges from being mistaken for coastlines.

Run `npm run map:data` to regenerate
`src/ui/data/east-china-sea-data.js`. The application loads the generated local
module and does not require network access at runtime.

Terrain remains presentation-only. `isLandPoint()` is available for later
placement, routing, and collision work, but the simulation currently does not
perform land avoidance.
