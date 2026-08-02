// Descriptive map icons for the sandbox (user-facing pictograms, not NATO APP-6).
//
// Design rules:
// - Instantly readable silhouettes: ship ≈ ship, jet ≈ jet, radar ≈ dish, etc.
// - Same shape for blue/red; side is color only (amateur-friendly).
// - Forward = +X so `ctx.rotate(heading)` matches sim heading (0 = east).
// - Paths live in a ~±14 unit box; callers pass screen-space `scale`.
// - Path2D instances are cached — cheap to redraw every frame.

const ICON_CACHE = new Map();

function cachePath(key, build) {
  let path = ICON_CACHE.get(key);
  if (!path) {
    path = new Path2D();
    build(path);
    ICON_CACHE.set(key, path);
  }
  return path;
}

// ——— Silhouettes (forward = +X) ————————————————————————————————

function pathDestroyer(p) {
  // Top-down DDG: sharp bow, fine waterline, parallel mid-body, transom stern.
  p.moveTo(14, 0);
  p.lineTo(8, -2.1);
  p.lineTo(3, -2.7);
  p.lineTo(-9, -2.7);
  p.lineTo(-13, -1.4);
  p.lineTo(-13, 1.4);
  p.lineTo(-9, 2.7);
  p.lineTo(3, 2.7);
  p.lineTo(8, 2.1);
  p.closePath();
}

function pathCruiser(p) {
  // Longer/heavier than DDG — broader midships.
  p.moveTo(14.5, 0);
  p.lineTo(9.5, -2.5);
  p.lineTo(3, -3.2);
  p.lineTo(-9, -3.2);
  p.lineTo(-13.5, -1.5);
  p.lineTo(-13.5, 1.5);
  p.lineTo(-9, 3.2);
  p.lineTo(3, 3.2);
  p.lineTo(9.5, 2.5);
  p.closePath();
}

function pathBattleship(p) {
  // Broad arsenal hull — widest surface combatant.
  p.moveTo(15, 0);
  p.lineTo(10, -2.8);
  p.lineTo(2, -3.9);
  p.lineTo(-9, -3.9);
  p.lineTo(-13.5, -2);
  p.lineTo(-14, -1.3);
  p.lineTo(-14, 1.3);
  p.lineTo(-13.5, 2);
  p.lineTo(-9, 3.9);
  p.lineTo(2, 3.9);
  p.lineTo(10, 2.8);
  p.closePath();
}

function pathFrigate(p) {
  // Compact escort — shorter, thinner than DDG.
  p.moveTo(12.5, 0);
  p.lineTo(8, -2);
  p.lineTo(3, -2.4);
  p.lineTo(-7, -2.4);
  p.lineTo(-10, -1.5);
  p.lineTo(-11.5, -0.9);
  p.lineTo(-11.5, 0.9);
  p.lineTo(-10, 1.5);
  p.lineTo(-7, 2.4);
  p.lineTo(3, 2.4);
  p.lineTo(8, 2);
  p.closePath();
}

function pathCarrier(p) {
  // Long, narrow flight deck with an angled bow and squared stern.
  p.moveTo(14, -1.5);
  p.lineTo(14, 3.5);
  p.lineTo(-11, 4.4);
  p.lineTo(-14, 2.8);
  p.lineTo(-14, -3.2);
  p.lineTo(-6, -4.2);
  p.lineTo(6, -3.8);
  p.lineTo(9, -1.5);
  p.closePath();
}

function pathSubmarine(p) {
  // Teardrop SSN hull (forward = +X).
  p.moveTo(13, 0);
  p.bezierCurveTo(13, -2.6, 8, -3.6, 2, -3.6);
  p.bezierCurveTo(-5, -3.6, -11, -2.8, -13, 0);
  p.bezierCurveTo(-11, 2.8, -5, 3.6, 2, 3.6);
  p.bezierCurveTo(8, 3.6, 13, 2.6, 13, 0);
  p.closePath();
}

function pathJet(p) {
  // Top-down fighter: nose, swept wings, twin tails.
  p.moveTo(12, 0);
  p.lineTo(3, -1.8);
  p.lineTo(-2, -8.5);
  p.lineTo(-5, -8.5);
  p.lineTo(-3, -1.8);
  p.lineTo(-9, -3.2);
  p.lineTo(-11, -1);
  p.lineTo(-8, 0);
  p.lineTo(-11, 1);
  p.lineTo(-9, 3.2);
  p.lineTo(-3, 1.8);
  p.lineTo(-5, 8.5);
  p.lineTo(-2, 8.5);
  p.lineTo(3, 1.8);
  p.closePath();
}

function pathAwacs(p) {
  // Twin-engine AEW with dorsal radar disc.
  p.moveTo(11, 0);
  p.lineTo(4, -2);
  p.lineTo(-1, -7);
  p.lineTo(-4, -7);
  p.lineTo(-2, -2);
  p.lineTo(-9, -2.5);
  p.lineTo(-11, -1);
  p.lineTo(-9, 0);
  p.lineTo(-11, 1);
  p.lineTo(-9, 2.5);
  p.lineTo(-2, 2);
  p.lineTo(-4, 7);
  p.lineTo(-1, 7);
  p.lineTo(4, 2);
  p.closePath();
}

function pathSam(p) {
  // Pad + twin upright missiles (reads as “missile battery” even small).
  p.moveTo(-8, 5);
  p.lineTo(8, 5);
  p.lineTo(7, 8);
  p.lineTo(-7, 8);
  p.closePath();
  // Left missile
  p.moveTo(-5.5, 5);
  p.lineTo(-5.5, -7);
  p.lineTo(-3.5, -10);
  p.lineTo(-1.5, -7);
  p.lineTo(-1.5, 5);
  p.closePath();
  // Right missile
  p.moveTo(1.5, 5);
  p.lineTo(1.5, -7);
  p.lineTo(3.5, -10);
  p.lineTo(5.5, -7);
  p.lineTo(5.5, 5);
  p.closePath();
}

function pathBmd(p) {
  // Single tall interceptor on a pad.
  p.rect(-6, 4, 12, 3.5);
  p.moveTo(-2.2, 4);
  p.lineTo(-2.2, -9);
  p.lineTo(0, -12);
  p.lineTo(2.2, -9);
  p.lineTo(2.2, 4);
  p.closePath();
}

function pathStrikeBattery(p) {
  // Transporter-erector: cab + angled missile tube.
  p.rect(-10, -2, 8, 6);
  p.rect(-2, -1, 10, 4);
  p.moveTo(-1, 0);
  p.lineTo(11, -6);
  p.lineTo(12, -4.5);
  p.lineTo(0, 2);
  p.closePath();
}

function pathHypersonic(p) {
  // Heavier TEL with a longer tube.
  p.rect(-11, -2.5, 9, 7);
  p.rect(-2, -1.5, 9, 5);
  p.moveTo(-1, -0.5);
  p.lineTo(12, -7);
  p.lineTo(13, -5);
  p.lineTo(0, 2.5);
  p.closePath();
}

function pathRadar(p) {
  // A compact radar pictogram: open dish, angled pedestal, and base. The
  // essential silhouette lives in the body path so it remains recognizable
  // even when the optional detail pass is intentionally skipped elsewhere.
  p.moveTo(-10, -1);
  p.quadraticCurveTo(-8, -9, 0, -10);
  p.quadraticCurveTo(8, -9, 10, -1);
  p.lineTo(3, 7);
  p.lineTo(-3, 7);
  p.closePath();
  p.rect(-6, 7, 12, 2.5);
}

function pathAirfield(p) {
  // Runway strip + hangar block.
  p.rect(-12, -2, 24, 4.5);
  p.rect(-11, -8, 7, 5.5);
}

function pathSeaUnit(p) {
  pathDestroyer(p);
}

function pathGroundUnit(p) {
  p.rect(-6, -6, 12, 12);
}

function pathAirUnit(p) {
  pathJet(p);
}

const BODY_BUILDERS = {
  "surface-destroyer": pathDestroyer,
  "surface-cruiser": pathCruiser,
  "surface-battleship": pathBattleship,
  "surface-frigate": pathFrigate,
  "surface-carrier": pathCarrier,
  submarine: pathSubmarine,
  "subsurface-submarine": pathSubmarine,
  "subsurface-unit": pathSubmarine,
  "ground-sam": pathSam,
  "ground-bmd": pathBmd,
  "ground-strike": pathStrikeBattery,
  "ground-hypersonic": pathHypersonic,
  "ground-radar": pathRadar,
  "ground-airfield": pathAirfield,
  "ground-unit": pathGroundUnit,
  "air-fighter": pathJet,
  "air-strike": pathJet,
  "air-carrier-strike": pathJet,
  "air-multirole": pathJet,
  "air-ew": pathJet,
  "air-aew": pathAwacs,
  "air-unit": pathAirUnit,
  "sea-unit": pathSeaUnit
};

function resolveBodyKey(symbolId = "sea-unit") {
  const id = String(symbolId || "sea-unit");
  if (BODY_BUILDERS[id]) return id;
  // Fallback matching for custom / glyph-based ids from unitPresentation.
  if (id.includes("carrier") && !id.includes("air")) return "surface-carrier";
  if (id.includes("battleship")) return "surface-battleship";
  if (id.includes("cruiser")) return "surface-cruiser";
  if (id.includes("destroyer")) return "surface-destroyer";
  if (id.includes("frigate")) return "surface-frigate";
  if (id.includes("submarine") || id.includes("subsurface")) return "submarine";
  if (id.includes("airfield")) return "ground-airfield";
  if (id.includes("hypersonic")) return "ground-hypersonic";
  if (id.includes("bmd") || id.includes("thaad")) return "ground-bmd";
  if (id.includes("sam")) return "ground-sam";
  if (id.includes("radar") || id.includes("aew") && id.includes("ground")) return "ground-radar";
  if (id.includes("strike") && id.includes("ground")) return "ground-strike";
  if (id.includes("aew")) return "air-aew";
  if (id.includes("ew")) return "air-ew";
  if (id.includes("air") || id.includes("fighter") || id.includes("aircraft")) return "air-fighter";
  if (id.includes("ground") || id.includes("bunker")) return "ground-unit";
  if (id.includes("sea") || id.includes("surface")) return "surface-destroyer";
  return "sea-unit";
}

function bodyPath(symbolId) {
  const key = resolveBodyKey(symbolId);
  return cachePath(`body:${key}`, BODY_BUILDERS[key] || pathSeaUnit);
}

function isGroundSymbol(symbolId, domain) {
  if (domain === "ground") return true;
  const id = String(symbolId || "");
  return id.startsWith("ground-") || id.includes("airfield") || id.includes("sam")
    || id.includes("radar") || id.includes("bmd") || id.includes("bunker");
}

function isSubSymbol(symbolId, domain) {
  if (domain === "subsurface") return true;
  const id = String(symbolId || "");
  return id.includes("submarine") || id.includes("subsurface");
}

/** Detail strokes drawn after the filled body (masts, dishes, runways…). */
function drawDetails(ctx, symbolId) {
  const key = resolveBodyKey(symbolId);
  ctx.beginPath();
  if (key === "surface-destroyer" || key === "sea-unit") {
    // Bridge + mast + VLS block
    ctx.rect(-2.2, -2.4, 5.5, 4.8);
    ctx.rect(4, -1.5, 3.2, 3);
    ctx.moveTo(0.5, -2.4);
    ctx.lineTo(0.5, -5.8);
    ctx.moveTo(-0.8, -4.6);
    ctx.lineTo(1.8, -4.6);
  } else if (key === "surface-frigate") {
    ctx.rect(-1.5, -2, 4.2, 4);
    ctx.moveTo(0.5, -2);
    ctx.lineTo(0.5, -5);
  } else if (key === "surface-cruiser") {
    ctx.rect(-3.5, -2.6, 8, 5.2);
    ctx.rect(5, -1.6, 3.5, 3.2);
    ctx.moveTo(-1, -2.6);
    ctx.lineTo(-1, -6);
    ctx.moveTo(3, -2.6);
    ctx.lineTo(3, -5.4);
  } else if (key === "surface-battleship") {
    ctx.rect(-4, -2.8, 8.5, 5.6);
    // Twin turrets fore/aft
    ctx.moveTo(7.5, 0);
    ctx.arc(7.5, 0, 1.6, 0, Math.PI * 2);
    ctx.moveTo(-7.5, 0);
    ctx.arc(-7.5, 0, 1.6, 0, Math.PI * 2);
    ctx.moveTo(0, -2.8);
    ctx.lineTo(0, -6.2);
  } else if (key === "surface-carrier") {
    // Angled deck stripe + island superstructure
    ctx.moveTo(-11, 1.2);
    ctx.lineTo(11, -0.6);
    ctx.rect(2, -5.2, 4, 3.4);
    ctx.moveTo(4, -5.2);
    ctx.lineTo(4, -7);
  } else if (key === "submarine" || key === "subsurface-submarine" || key === "subsurface-unit") {
    // Sail + dive plane
    ctx.rect(-1.2, -6, 3.4, 3.4);
    ctx.moveTo(0.5, -6);
    ctx.lineTo(0.5, -8.2);
    ctx.moveTo(3, -1.2);
    ctx.lineTo(3, -3.2);
  } else if (key === "ground-radar") {
    // Dish mesh spokes
    ctx.moveTo(0, -1);
    ctx.lineTo(0, -8);
    ctx.moveTo(-5, -2);
    ctx.lineTo(5, -2);
  } else if (key === "ground-airfield") {
    // Runway dashed centerline
    ctx.moveTo(-10, 0.2);
    ctx.lineTo(-4, 0.2);
    ctx.moveTo(-1, 0.2);
    ctx.lineTo(5, 0.2);
    ctx.moveTo(8, 0.2);
    ctx.lineTo(11, 0.2);
  } else if (key === "air-aew") {
    // Radar disc on top
    ctx.ellipse(-1, -0.2, 4.2, 2.2, 0, 0, Math.PI * 2);
  } else if (key === "air-ew") {
    // Small wingtip pods
    ctx.moveTo(-1, -7);
    ctx.lineTo(1, -9);
    ctx.moveTo(-1, 7);
    ctx.lineTo(1, 9);
  } else if (key.startsWith("air-")) {
    // Cockpit canopy hint
    ctx.moveTo(6, 0);
    ctx.lineTo(3, 0);
  }
  ctx.stroke();
}

/**
 * Draw a descriptive unit icon at screen position (x, y).
 * `scale` is screen-space (typically ~0.5–1.2); icons stay readable when zooming.
 */
export function drawTacticalSymbol(ctx, {
  x,
  y,
  side,
  domain = "sea",
  symbolId = "sea-unit",
  selected = false,
  alive = true,
  heading = 0,
  color,
  scale = 1,
  preview = false,
  valid = true,
  simple = false
}) {
  const ground = isGroundSymbol(symbolId, domain);
  const sub = isSubSymbol(symbolId, domain);
  const body = bodyPath(symbolId);

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alive ? 1 : 0.35;

  // Orient movable units with heading; ground stays map-north-up.
  if (!ground && Number.isFinite(heading)) {
    ctx.rotate(heading);
  }

  const symbolColor = valid ? color : "#0e1012";
  ctx.strokeStyle = symbolColor;
  ctx.fillStyle = selected || preview
    ? `${symbolColor}30`
    : "rgba(248, 250, 251, .95)";
  ctx.lineWidth = selected ? 1.7 : (simple ? 1.05 : 1.2);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash(preview ? [3, 2] : []);
  if (sub && !preview && !simple) {
    // Dashed outline cues “underwater” without losing the silhouette.
    ctx.setLineDash([3.5, 2.2]);
  }
  ctx.fill(body);
  ctx.stroke(body);
  ctx.setLineDash([]);

  // Skip interior detail when strategically zoomed out (cheaper + less noise).
  if (!simple) {
    ctx.strokeStyle = valid
      ? (selected ? color : "rgba(14, 16, 18, .42)")
      : symbolColor;
    ctx.lineWidth = selected ? 1.15 : 0.9;
    drawDetails(ctx, symbolId);
  }

  if (!alive) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-9, -7);
    ctx.lineTo(9, 7);
    ctx.moveTo(9, -7);
    ctx.lineTo(-9, 7);
    ctx.stroke();
  }

  ctx.restore();
}

export function symbolCacheSize() {
  return ICON_CACHE.size;
}

/** Test/helpers: which body key a symbolId resolves to. */
export function resolveSymbolBodyKey(symbolId) {
  return resolveBodyKey(symbolId);
}
