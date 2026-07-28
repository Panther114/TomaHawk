import { SIDE } from "../sim.js";

const FRAME_CACHE = new Map();

function framePath(domain, hostile) {
  const key = `${domain}:${hostile ? "hostile" : "friendly"}`;
  if (FRAME_CACHE.has(key)) return FRAME_CACHE.get(key);
  const path = new Path2D();
  if (hostile) {
    path.moveTo(0, -10);
    path.lineTo(14, 0);
    path.lineTo(0, 10);
    path.lineTo(-14, 0);
    path.closePath();
  } else if (domain === "air") {
    path.moveTo(-14, 8);
    path.lineTo(-14, 0);
    path.bezierCurveTo(-14, -9, -8, -12, 0, -12);
    path.bezierCurveTo(8, -12, 14, -9, 14, 0);
    path.lineTo(14, 8);
    path.closePath();
  } else if (domain === "subsurface") {
    path.moveTo(-14, -8);
    path.lineTo(-14, 0);
    path.bezierCurveTo(-14, 9, -8, 12, 0, 12);
    path.bezierCurveTo(8, 12, 14, 9, 14, 0);
    path.lineTo(14, -8);
    path.closePath();
  } else if (domain === "sea") {
    path.ellipse(0, 0, 14, 10, 0, 0, Math.PI * 2);
  } else {
    path.rect(-14, -10, 28, 20);
  }
  FRAME_CACHE.set(key, path);
  return path;
}

function drawFunction(ctx, symbolId) {
  ctx.beginPath();
  if (symbolId.includes("carrier") || symbolId.includes("airfield")) {
    ctx.moveTo(-8, 0); ctx.lineTo(8, 0);
    ctx.moveTo(-3, -5); ctx.lineTo(4, 5);
    ctx.moveTo(2, -5); ctx.lineTo(7, 5);
  } else if (symbolId.includes("submarine")) {
    ctx.ellipse(0, 1, 8, 3, 0, 0, Math.PI * 2);
    ctx.moveTo(0, -2); ctx.lineTo(0, -6);
  } else if (symbolId.includes("radar") || symbolId.includes("aew")) {
    ctx.arc(0, 3, 7, Math.PI, Math.PI * 2);
    ctx.moveTo(0, 3); ctx.lineTo(5, -3);
    ctx.moveTo(0, 3); ctx.lineTo(0, 7);
  } else if (symbolId.includes("sam") || symbolId.includes("bmd")) {
    ctx.moveTo(-7, 6); ctx.lineTo(0, -6); ctx.lineTo(7, 6);
    ctx.moveTo(-5, 2); ctx.lineTo(5, 2);
  } else if (symbolId.includes("strike") || symbolId.includes("hypersonic")) {
    ctx.moveTo(-8, 5); ctx.lineTo(7, -5);
    ctx.moveTo(2, -5); ctx.lineTo(7, -5); ctx.lineTo(7, 0);
  } else if (symbolId.includes("ew")) {
    ctx.moveTo(-8, -5); ctx.lineTo(-3, 5); ctx.lineTo(2, -5); ctx.lineTo(7, 5);
  } else if (symbolId.includes("air")) {
    ctx.moveTo(-9, 4); ctx.lineTo(0, -5); ctx.lineTo(9, 4);
    ctx.moveTo(0, -5); ctx.lineTo(0, 7);
  } else if (symbolId.includes("destroyer")) {
    ctx.moveTo(-8, 4); ctx.lineTo(7, 4); ctx.lineTo(4, -3); ctx.lineTo(-4, -3); ctx.closePath();
    ctx.moveTo(0, -3); ctx.lineTo(0, -7);
  } else if (symbolId.includes("cruiser") || symbolId.includes("battleship")) {
    ctx.moveTo(-9, 4); ctx.lineTo(9, 4); ctx.lineTo(6, -3); ctx.lineTo(-6, -3); ctx.closePath();
    ctx.moveTo(-3, -3); ctx.lineTo(-3, -7);
    ctx.moveTo(3, -3); ctx.lineTo(3, -7);
  } else if (symbolId.includes("frigate")) {
    ctx.moveTo(-8, 4); ctx.lineTo(7, 4); ctx.lineTo(3, -3); ctx.lineTo(-5, -3); ctx.closePath();
  } else {
    ctx.moveTo(-7, 0); ctx.lineTo(7, 0);
    ctx.moveTo(0, -6); ctx.lineTo(0, 6);
  }
  ctx.stroke();
}

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
  valid = true
}) {
  const hostile = side === SIDE.RED || side === "red";
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alive ? 1 : 0.35;
  ctx.strokeStyle = valid ? color : "#ff766f";
  ctx.fillStyle = selected || preview ? `${color}26` : "rgba(4,13,18,.86)";
  ctx.lineWidth = selected ? 1.7 : 1.15;
  ctx.setLineDash(preview ? [3, 2] : []);
  const frame = framePath(domain, hostile);
  ctx.fill(frame);
  ctx.stroke(frame);
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  drawFunction(ctx, symbolId);
  if (Number.isFinite(heading) && !domain.includes("ground")) {
    ctx.rotate(heading);
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(0, -18);
    ctx.lineTo(-2, -15.5);
    ctx.moveTo(0, -18);
    ctx.lineTo(2, -15.5);
    ctx.stroke();
  }
  if (!alive) {
    ctx.beginPath();
    ctx.moveTo(-10, -7); ctx.lineTo(10, 7);
    ctx.moveTo(10, -7); ctx.lineTo(-10, 7);
    ctx.stroke();
  }
  ctx.restore();
}

export function symbolCacheSize() {
  return FRAME_CACHE.size;
}

