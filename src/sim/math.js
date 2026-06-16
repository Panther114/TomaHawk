// Geometry, kinematics, and RNG helpers. Pure functions with no simulation
// state, safe to import from any layer.

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
export function interceptPoint(px, py, speed, tx, ty, tvx, tvy) {
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
      const positives = [t1, t2].filter((v) => v > 1e-6);
      if (positives.length) t = Math.min(...positives);
    }
  }
  if (!(t > 0) || !Number.isFinite(t)) return { x: tx, y: ty, t: 0 };
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
