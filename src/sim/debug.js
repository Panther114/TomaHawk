// Debugging instrumentation. Two independent, read-only collectors that observe
// a running simulation without perturbing it (they draw no RNG and mutate no sim
// state). Both are pure JS with no Node/DOM dependency so the same code runs in
// the browser and in the headless harness (scripts/sim-debug.mjs).
//
//   PerfRecorder  — a per-run performance trace. Records per-tick wall cost and
//                   live entity counts so a slow device can be diagnosed: peak
//                   concurrent entities, ms/tick distribution, the worst tick,
//                   and heap growth. Overwritten every run (it is about the
//                   device, not the battle).
//
//   BattleLogger  — a per-run tactical trace. Samples the whole battlespace at a
//                   fixed sim-time cadence and renders a human-readable frame:
//                   every entity's position/heading/speed/altitude/state/stores,
//                   a one-line translation of what each unit is *doing* and why,
//                   the per-side command posture, and the events since the last
//                   frame. Reading the frames back is meant to let someone (or an
//                   agent) "watch" how the battle and the AI unfolded.

import { NM, KNOT, SHIP_SPEED_MULTIPLIER, SIDE } from "./constants.js";
import { distance } from "./math.js";
import { MISSILES, isAirDefenseCategory } from "./missiles.js";
import { isAircraft, isAirfield, aliveAircraftCount, squadronSize, AIR_STATE } from "./aircraft.js";
import { offensiveMissileCount } from "./ships.js";

const MPS_TO_KT = 1 / (KNOT * SHIP_SPEED_MULTIPLIER);

function nm(v) { return v / NM; }
function fxNm(v) { const n = nm(v); return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`; }
function kt(speedMps) { return Math.round(speedMps * MPS_TO_KT); }
function hdg(rad) { return String(((Math.round(rad * 180 / Math.PI) % 360) + 360) % 360).padStart(3, "0"); }

// --- weapon-store summary ---------------------------------------------------
function storeSummary(ship) {
  let aaw = 0; let asuw = 0;
  const lo = ship.loadout ?? {};
  for (const id in lo) {
    const spec = MISSILES[id];
    if (!spec || lo[id] <= 0) continue;
    if (spec.category === "anti_ship") asuw += lo[id];
    if (isAirDefenseCategory(spec.category)) aaw += lo[id];
  }
  return { aaw, asuw };
}

function hp(ship) {
  const max = Math.max(1, Math.ceil(ship.damageResist ?? 1));
  return `${Math.max(0, max - Math.round(ship.damage ?? 0))}/${max}`;
}

// Nearest *alive* enemy of a domain predicate, by true position (ground truth —
// this is a debug oracle, not what the unit's own sensors hold).
function nearestEnemy(sim, ship, pred) {
  let best = null; let bestD = Infinity;
  for (const other of sim.ships) {
    if (!other.alive || other.side === ship.side) continue;
    if (pred && !pred(other)) continue;
    const d = distance(ship, other);
    if (d < bestD) { bestD = d; best = other; }
  }
  return best ? { unit: best, rangeM: bestD } : null;
}

const isSurface = (s) => s.domain !== "air";

// Nearest enemy track the unit's *side* actually holds in the fused force picture
// (what the AI vectors on), not ground truth. Returns {id, rangeM} or null.
function nearestPictureContact(sim, ship, wantAir) {
  const pic = sim.forcePicture?.get(ship.side);
  if (!pic) return null;
  let best = null; let bestD = Infinity;
  for (const t of pic.values()) {
    if (t.side === ship.side || String(t.id).startsWith("M-")) continue;
    if (((t.domain ?? "sea") === "air") !== wantAir) continue;
    if ((t.quality ?? 0) <= 0.12) continue;
    const d = distance(ship, t);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best ? { id: best.id, rangeM: bestD } : null;
}

// One-line translation of a squadron's current behaviour and reason — derived
// from the same fused picture the AI uses, so a "searching" flight is one that
// genuinely holds no track (not one whose target is merely far away).
function describeAircraftIntent(sim, ship) {
  if (ship.airState === AIR_STATE.REARMING) return "REARM/refuel at base";
  if (ship.evading) return "EVADING — breaking against inbound missile";
  if (ship.airState === AIR_STATE.RTB) {
    return ship.homeBaseId ? `RTB → ${ship.homeBaseId}` : "RTB → friendly territory (no base)";
  }
  const { asuw, aaw } = storeSummary(ship);
  const air = nearestPictureContact(sim, ship, true);
  const surf = nearestPictureContact(sim, ship, false);
  if (air && aaw > 0 && air.rangeM <= 60 * NM && (!surf || air.rangeM <= surf.rangeM || asuw <= 0)) {
    return `A2A vs ${air.id} @ ${nm(air.rangeM).toFixed(0)}NM (alt ${Math.round(ship.altitudeM ?? 0)}m)`;
  }
  if (surf && asuw > 0) {
    const r = nm(surf.rangeM);
    const stand = ship._standoffNm ?? null;
    const phase = stand == null ? "ingress"
      : r > stand * 1.06 ? "ingress"
        : r < stand * 0.72 ? "EGRESS (open to stand-off)"
          : "on station at stand-off — releasing strike";
    return `strike ${phase} vs ${surf.id} @ ${r.toFixed(0)}NM (alt ${Math.round(ship.altitudeM ?? 0)}m)`;
  }
  if (air && aaw > 0) return `A2A sweep vs ${air.id} @ ${nm(air.rangeM).toFixed(0)}NM`;
  // An unarmed flight (aaw and asuw both 0 — a support/sensor asset like the
  // AWAC AEW&C squadron) never screens forward; it orbits behind the guide
  // instead (see the unarmed branch in decideAircraft).
  return aaw > 0 || asuw > 0 ? "CAP screen (no track held)" : "support orbit (unarmed sensor asset)";
}

// Mirrors decideShip's decision order exactly (see movement.js) so the log
// never narrates a posture the ship isn't actually flying. The ammo-exhausted
// retreat branch in particular used to be invisible here: a ship with an
// empty magazine permanently retreats (decideShip has no "return to port to
// rearm" concept for surface ships — only aircraft RTB/rearm at an airfield),
// but this function kept reporting range-based posture ("close to engage")
// as if it were still trying to fight, which reads as a live contradiction
// once you check the ship's actual heading/position over time.
function describeShipIntent(sim, ship) {
  if (isAirfield(ship)) return "airfield (rearm/refuel node)";
  if (ship.isFixed) return "fixed emplacement";
  // Inbound missile defence dominates the movement decision.
  for (const m of sim.missiles) {
    if (m.alive && m.side !== ship.side && m.targetId === ship.id) return "DEFENDING — combing away from inbound";
  }
  if (offensiveMissileCount(ship, false) <= 0) {
    return "WINCHESTER — retreating (no rearm-at-sea; permanent unless resupply is added)";
  }
  const surf = nearestEnemy(sim, ship, isSurface);
  const role = ship.isOTC ? "OTC " : ship.fleetRole === "AAWC" ? "AAWC " : "";
  if (!surf) return `${role}patrol (no contact)`;
  const r = nm(surf.rangeM);
  const stand = (ship.doctrine?.standoffNm ?? 70);
  const posture = r < stand * 0.72 ? "open range" : r > stand * 1.25 ? "close to engage" : "hold stand-off";
  return `${role}${posture} vs ${surf.unit.id} @ ${r.toFixed(0)}NM`;
}

// ---------------------------------------------------------------------------
export class BattleLogger {
  constructor({ intervalS = 10, label = "scenario" } = {}) {
    this.intervalS = intervalS;
    this.label = label;
    this.frames = [];
    this._nextFrameAt = 0;
    this._lastDrainT = -Infinity;
    this._pendingEvents = [];
    this._startWall = Date.now();
  }

  // Call once per tick AFTER stepSim. Drains the tick's new events every tick (so
  // none are lost to the event-log cap) and emits a frame at the chosen cadence.
  sample(sim, { force = false } = {}) {
    // Drain only this tick's new events. The log is newest-first, so scan from
    // the front and stop at the first already-drained event — O(new) per tick,
    // not O(event-cap), which matters when sampling every browser frame.
    for (const e of sim.events) {
      if (e.t <= this._lastDrainT + 1e-9) break;
      if (e.t <= sim.time + 1e-9) this._pendingEvents.push(e);
    }
    this._lastDrainT = sim.time;
    if (!force && sim.time + 1e-9 < this._nextFrameAt) return;
    this._nextFrameAt = sim.time + this.intervalS;
    this.frames.push(this._renderFrame(sim));
    this._pendingEvents.length = 0;
  }

  _renderFrame(sim) {
    const mm = Math.floor(sim.time / 60).toString().padStart(2, "0");
    const ss = Math.floor(sim.time % 60).toString().padStart(2, "0");
    const lines = [];
    lines.push(`================ t=${mm}:${ss}  (sim ${sim.time.toFixed(1)}s) ================`);

    // Per-side command posture (the "AI strategy" readout).
    for (const side of [SIDE.BLUE, SIDE.RED]) {
      const cs = sim.commandState?.get(side);
      const cmd = sim.fleetCommand?.get(side);
      if (!cs) continue;
      const otc = cmd?.otc ? cmd.otc.id : "—";
      const axisDeg = cmd && Number.isFinite(cmd.axis) ? hdg(cmd.axis) : "—";
      lines.push(
        `[${side}] mode=${cs.mode} aggr=${cs.aggression.toFixed(2)} adv=${cs.advantage.toFixed(2)} ` +
        `breadth=${cs.targetBreadth} raidDepth=${cs.raidDepth} OTC=${otc} axis=${axisDeg} ` +
        `| ownOff=${Math.round(cs.ownOffense)} enemyEst=${Math.round(cs.enemyOffenseEstimate)} pressure=${cs.missilePressure}`
      );
    }

    // Per-entity ground-truth lines, grouped by side.
    for (const side of [SIDE.BLUE, SIDE.RED]) {
      const units = sim.ships.filter((s) => s.side === side && s.alive);
      for (const ship of units) {
        if (isAircraft(ship)) {
          const { aaw, asuw } = storeSummary(ship);
          lines.push(
            `  ${pad(`[${side} ${ship.id}]`, 16)} air pos(${fxNm(ship.x)},${fxNm(ship.y)}) ` +
            `hdg ${hdg(ship.heading)} spd ${kt(ship.speed)}kt alt ${Math.round(ship.altitudeM ?? 0)}m ` +
            `AC ${aliveAircraftCount(ship)}/${squadronSize(ship)} flares ${ship.flares ?? 0} ` +
            `AAW ${aaw} ASUW ${asuw} fuel ${Math.round((ship.fuelS ?? 0))}s ` +
            `:: ${describeAircraftIntent(sim, ship)}`
          );
        } else {
          const { aaw, asuw } = storeSummary(ship);
          lines.push(
            `  ${pad(`[${side} ${ship.id}]`, 16)} ${pad(ship.hull, 4)} pos(${fxNm(ship.x)},${fxNm(ship.y)}) ` +
            `hdg ${hdg(ship.heading)} spd ${kt(ship.speed)}kt HP ${hp(ship)} ` +
            `SAM ${aaw} STRK ${asuw} ` +
            `:: ${describeShipIntent(sim, ship)}`
          );
        }
      }
    }

    // Missiles in flight, summarised per side (too many to list individually).
    const mAir = { Blue: 0, Red: 0 }; const mShip = { Blue: 0, Red: 0 }; const mTerm = { Blue: 0, Red: 0 };
    for (const m of sim.missiles) {
      if (!m.alive) continue;
      const spec = MISSILES[m.missileId];
      const role = spec?.category === "anti_ship" ? mShip : mAir;
      if (role[m.side] !== undefined) role[m.side] += 1;
      if (m.terminal && mTerm[m.side] !== undefined) mTerm[m.side] += 1;
    }
    lines.push(
      `  missiles in flight — BLUE: ${mShip.Blue} ASCM / ${mAir.Blue} SAM-AAM (${mTerm.Blue} terminal); ` +
      `RED: ${mShip.Red} ASCM / ${mAir.Red} SAM-AAM (${mTerm.Red} terminal)`
    );

    // Events since the previous frame (the tactical narrative). Oldest-first.
    if (this._pendingEvents.length) {
      const ordered = [...this._pendingEvents].sort((a, b) => a.t - b.t);
      lines.push(`  -- events --`);
      for (const e of ordered) {
        const em = Math.floor(e.t / 60).toString().padStart(2, "0");
        const es = Math.floor(e.t % 60).toString().padStart(2, "0");
        lines.push(`     ${em}:${es} ${e.side} ${e.text}`);
      }
    }
    return lines.join("\n");
  }

  format() {
    const header = [
      `SIMULATION DEBUG LOG — ${this.label}`,
      `frame cadence: ${this.intervalS}s sim-time | frames: ${this.frames.length}`,
      `(ground-truth positions; intent lines translate each unit's behaviour)`,
      ""
    ].join("\n");
    return `${header}\n${this.frames.join("\n\n")}\n`;
  }
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + " ".repeat(n - s.length); }

// ---------------------------------------------------------------------------
export class PerfRecorder {
  constructor({ label = "scenario", heapEverySamples = 200, maxSamples = 120000 } = {}) {
    this.label = label;
    this.heapEverySamples = heapEverySamples;
    // Bound the per-tick sample buffer so a long-running browser session cannot
    // grow it without limit: when full, halve it (keep every other sample). The
    // distribution stays representative for the percentile heuristic; running
    // max/avg/worst are tracked separately and so are never lost.
    this.maxSamples = maxSamples;
    this.tickMs = [];
    this.ticks = 0;
    this.sumMs = 0;
    this.maxMs = 0;
    this.worst = null;            // { tick, simTime, ms, missiles, ships }
    // Render-frame cost (browser only; the headless runner never renders). Lets
    // the report attribute lag to the SIM step vs the canvas RENDER path.
    this.renderMs = [];
    this.renderFrames = 0;
    this.renderSum = 0;
    this.renderMax = 0;
    this.peakMissiles = 0;
    this.peakShips = 0;
    this.peakEntities = 0;
    this.heapStartMB = heapMB();
    this.heapPeakMB = this.heapStartMB;
    this._sinceHeap = 0;
  }

  // Call once per tick with the wall-clock cost of that stepSim call (ms).
  record(sim, tickMs) {
    this.ticks += 1;
    this.sumMs += tickMs;
    if (this.tickMs.length >= this.maxSamples) {
      let w = 0;
      for (let i = 0; i < this.tickMs.length; i += 2) this.tickMs[w++] = this.tickMs[i];
      this.tickMs.length = w;
    }
    this.tickMs.push(tickMs);
    const ships = countAlive(sim.ships);
    const missiles = countAlive(sim.missiles);
    const entities = ships + missiles;
    if (missiles > this.peakMissiles) this.peakMissiles = missiles;
    if (ships > this.peakShips) this.peakShips = ships;
    if (entities > this.peakEntities) this.peakEntities = entities;
    if (tickMs > this.maxMs) {
      this.maxMs = tickMs;
      this.worst = { tick: this.ticks, simTime: sim.time, ms: tickMs, missiles, ships };
    }
    if (++this._sinceHeap >= this.heapEverySamples) {
      this._sinceHeap = 0;
      const mb = heapMB();
      if (mb != null && mb > this.heapPeakMB) this.heapPeakMB = mb;
    }
  }

  // Call once per rendered frame with the cost of the render() call (ms).
  recordRender(ms) {
    this.renderFrames += 1;
    this.renderSum += ms;
    if (ms > this.renderMax) this.renderMax = ms;
    if (this.renderMs.length >= this.maxSamples) {
      let w = 0;
      for (let i = 0; i < this.renderMs.length; i += 2) this.renderMs[w++] = this.renderMs[i];
      this.renderMs.length = w;
    }
    this.renderMs.push(ms);
  }

  summary() {
    const sorted = [...this.tickMs].sort((a, b) => a - b);
    const pct = (p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;
    const rsorted = [...this.renderMs].sort((a, b) => a - b);
    const rpct = (p) => rsorted.length ? rsorted[Math.min(rsorted.length - 1, Math.floor(p * rsorted.length))] : 0;
    return {
      ticks: this.ticks,
      avgMs: this.ticks ? this.sumMs / this.ticks : 0,
      p50Ms: pct(0.50),
      p95Ms: pct(0.95),
      p99Ms: pct(0.99),
      maxMs: this.maxMs,
      worst: this.worst,
      peakShips: this.peakShips,
      peakMissiles: this.peakMissiles,
      peakEntities: this.peakEntities,
      heapStartMB: this.heapStartMB,
      heapPeakMB: this.heapPeakMB,
      renderFrames: this.renderFrames,
      renderAvgMs: this.renderFrames ? this.renderSum / this.renderFrames : 0,
      renderP95Ms: rpct(0.95),
      renderMaxMs: this.renderMax,
      // How many sim ticks were stepped per rendered frame (≈ speed multiplier);
      // per-frame sim cost ≈ avgMs × ticksPerFrame, comparable to render cost.
      ticksPerFrame: this.renderFrames ? this.ticks / this.renderFrames : 0
    };
  }

  // Cheap heuristic explaining what is most likely to make a device lag here.
  _diagnose(s) {
    const notes = [];
    // Sim vs render attribution (only when render frames were recorded — browser).
    if (s.renderFrames > 0) {
      const simPerFrame = s.avgMs * Math.max(1, s.ticksPerFrame);
      const total = simPerFrame + s.renderAvgMs;
      const renderShare = total > 0 ? (s.renderAvgMs / total) * 100 : 0;
      notes.push(
        `Per frame: ~${simPerFrame.toFixed(2)}ms sim (${s.avgMs.toFixed(3)}ms/tick × ${s.ticksPerFrame.toFixed(1)} ticks/frame) ` +
        `vs ~${s.renderAvgMs.toFixed(2)}ms render (p95 ${s.renderP95Ms.toFixed(2)}, max ${s.renderMaxMs.toFixed(2)}) — ` +
        `render is ${renderShare.toFixed(0)}% of frame cost.`
      );
      if (s.renderAvgMs > simPerFrame * 1.5 && s.renderAvgMs > 4) {
        notes.push(`Bottleneck is the RENDER (canvas) path, not the simulation. It scales with on-screen ships/missiles/range-rings/labels and is amplified by zoom (more on screen) and the speed multiplier (more state churns between draws). Lower the speed slider, zoom in, or hide range rings (WEZ) / labels to recover frame rate.`);
      } else if (simPerFrame > s.renderAvgMs * 1.5 && simPerFrame > 4) {
        notes.push(`Bottleneck is the SIM step: the speed multiplier runs ${s.ticksPerFrame.toFixed(1)} ticks/frame. Lower the speed slider to reduce ticks per frame.`);
      }
    }
    if (s.peakMissiles >= 250) {
      notes.push(`High concurrent-missile peak (${s.peakMissiles}). Missile flight + saturation scans are the dominant per-tick cost; expect frame spikes during saturation raids.`);
    }
    if (s.maxMs > s.p95Ms * 3 && s.maxMs > 4) {
      notes.push(`Spiky sim-tick cost (max ${s.maxMs.toFixed(2)}ms vs p95 ${s.p95Ms.toFixed(2)}ms) — likely GC pauses or a burst of launches/kills; smooth by reducing per-tick allocation.`);
    }
    if (s.heapStartMB != null && s.heapPeakMB - s.heapStartMB > 64) {
      notes.push(`Heap grew ${(s.heapPeakMB - s.heapStartMB).toFixed(0)}MB during the run — watch for retained per-tick structures on low-RAM machines.`);
    }
    if (s.avgMs > 4) {
      notes.push(`Average sim tick ${s.avgMs.toFixed(2)}ms (>4ms): a large battle; fast-forward will stutter.`);
    }
    if (!notes.length) notes.push(`No bottleneck flagged: peak ${s.peakEntities} entities, avg ${s.avgMs.toFixed(2)}ms/tick.`);
    return notes;
  }

  format() {
    const s = this.summary();
    const lines = [];
    lines.push(`PERFORMANCE DEBUG — ${this.label}`);
    lines.push(`(overwritten every run; describes the device + workload, not the battle outcome)`);
    lines.push("");
    lines.push(`ticks measured     : ${s.ticks}`);
    lines.push(`sim ms/tick        : avg ${s.avgMs.toFixed(3)} | p50 ${s.p50Ms.toFixed(3)} | p95 ${s.p95Ms.toFixed(3)} | p99 ${s.p99Ms.toFixed(3)} | max ${s.maxMs.toFixed(3)}`);
    if (s.renderFrames > 0) {
      lines.push(`render ms/frame    : avg ${s.renderAvgMs.toFixed(3)} | p95 ${s.renderP95Ms.toFixed(3)} | max ${s.renderMaxMs.toFixed(3)}  (${s.ticksPerFrame.toFixed(1)} sim ticks/frame)`);
    } else {
      lines.push(`render ms/frame    : n/a (headless run — no rendering)`);
    }
    lines.push(`peak entities      : ${s.peakEntities} (ships ${s.peakShips}, missiles ${s.peakMissiles})`);
    if (s.worst) {
      lines.push(`worst tick         : #${s.worst.tick} @ sim ${s.worst.simTime.toFixed(1)}s — ${s.worst.ms.toFixed(3)}ms with ${s.worst.missiles} missiles / ${s.worst.ships} ships alive`);
    }
    if (s.heapStartMB != null) {
      lines.push(`heap (MB)          : start ${s.heapStartMB.toFixed(1)} | peak ${s.heapPeakMB.toFixed(1)} | growth ${(s.heapPeakMB - s.heapStartMB).toFixed(1)}`);
    } else {
      lines.push(`heap (MB)          : unavailable (no process.memoryUsage in this environment)`);
    }
    lines.push("");
    lines.push(`diagnosis:`);
    for (const n of this._diagnose(s)) lines.push(`  - ${n}`);
    return lines.join("\n") + "\n";
  }
}

function countAlive(list) {
  let n = 0;
  for (const e of list) if (e.alive) n++;
  return n;
}

function heapMB() {
  try {
    if (typeof process !== "undefined" && process.memoryUsage) {
      return process.memoryUsage().heapUsed / (1024 * 1024);
    }
  } catch { /* ignore */ }
  return null;
}
