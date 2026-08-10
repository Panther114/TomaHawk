// Geometry, kinematics, and RNG helpers. Pure functions with no simulation
// state, safe to import from any layer.

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  // Simulation coordinates are bounded to theatre-scale values, so the direct
  // Euclidean form cannot overflow/underflow and avoids Math.hypot's scaling
  // overhead on every geometry query.
  return Math.sqrt(dx * dx + dy * dy);
}

// 3D slant range for engagements that have a meaningful vertical medium.
// Surface units are at 0 m, aircraft use altitudeM, and submarines/underwater
// weapons use depthM below the surface. Keep the common 2D distance() hot path
// unchanged for movement, radar, and map geometry.
export function distance3d(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const verticalA = Number.isFinite(a?.depthM)
    ? -a.depthM
    : Number.isFinite(a?.altitudeM) ? a.altitudeM : 0;
  const verticalB = Number.isFinite(b?.depthM)
    ? -b.depthM
    : Number.isFinite(b?.altitudeM) ? b.altitudeM : 0;
  const dz = verticalA - verticalB;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function angleTo(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function wrapAngle(rad) {
  while (rad > Math.PI) rad -= Math.PI * 2;
  while (rad < -Math.PI) rad += Math.PI * 2;
  return rad;
}

// Closed-form intercept (lead) point for a constant-speed pursuer against a
// constant-velocity target. Solves |P + V*t| = s*t for the smallest positive
// time-to-go, then returns the predicted intercept coordinate. Falls back to
// the target's current position when no real positive solution exists (e.g.
// the target outruns the weapon), so guidance always has a valid aimpoint.
export function interceptTime(px, py, speed, tx, ty, tvx, tvy) {
  const rx = tx - px;
  const ry = ty - py;
  const a = tvx * tvx + tvy * tvy - speed * speed;
  const b = 2 * (rx * tvx + ry * tvy);
  const c = rx * rx + ry * ry;
  let t = -1;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) > 1e-9) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b + sq) / (2 * a);
      const t2 = (-b - sq) / (2 * a);
      if (t1 > 1e-6 && t2 > 1e-6) t = Math.min(t1, t2);
      else if (t1 > 1e-6) t = t1;
      else if (t2 > 1e-6) t = t2;
    }
  }
  return t > 0 && Number.isFinite(t) ? t : 0;
}

export function interceptPoint(px, py, speed, tx, ty, tvx, tvy) {
  const t = interceptTime(px, py, speed, tx, ty, tvx, tvy);
  if (t === 0) return { x: tx, y: ty, t: 0 };
  return { x: tx + tvx * t, y: ty + tvy * t, t };
}

export function entityVelocity(entity) {
  if (!entity) return { vx: 0, vy: 0 };
  const speed = entity.speed ?? 0;
  return { vx: Math.cos(entity.heading) * speed, vy: Math.sin(entity.heading) * speed };
}

export class Rng {
  constructor(seed = 123456789) {
    this.seed = seed >>> 0;
  }
  next() {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  range(min, max) {
    return min + (max - min) * this.next();
  }
}
