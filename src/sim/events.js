// Event-log helpers: appending tactical events, classifying their severity,
// and formatting log output. No simulation dependencies beyond the `sim`
// object's own `events`/`time` fields.

import { SIDE } from "./constants.js";
import { MISSILES } from "./missiles.js";

export function countInterceptionEvent(totals, event) {
  const counts = totals[event.side];
  if (!counts) return;
  if (event.combat === "attack") counts.launched++;
  else if (event.combat === "intercept") counts.intercepted++;
  else if (event.combat == null) {
    const text = String(event.text ?? "");
    if (/ launched /.test(text) && !/ queued /.test(text)) {
      const target = text.split(" at ").pop().replace(/\.+$/, "");
      if (!Object.entries(MISSILES).some(([id, spec]) => id === target || spec.shortLabel === target)) counts.launched++;
    }
    if (/intercepted incoming|CIWS destroyed incoming/i.test(text)) counts.intercepted++;
  }
}

export function emptyInterceptionTotals() {
  return {
    [SIDE.BLUE]: { launched: 0, intercepted: 0 },
    [SIDE.RED]: { launched: 0, intercepted: 0 }
  };
}

export function eventSeverity(text) {
  const t = String(text).toLowerCase();
  if (t.includes("mission-killed") || t.includes("sinking") || t.includes("hit by")) return "kill";
  if (t.includes("intercepted") || t.includes("destroyed incoming")) return "intercept";
  if (t.includes("launched") || t.includes("queued")) return "launch";
  if (t.includes("missed") || t.includes("failed") || t.includes("exhausted") || t.includes("leaked")) return "miss";
  return "info";
}

export function addEvent(sim, text, side = "SYS", combat) {
  const id = sim._nextEventId ?? 1;
  sim._nextEventId = id + 1;
  sim.events.unshift({ id, t: sim.time, side, text, severity: eventSeverity(text), ...(combat ? { combat } : {}) });
  if (sim.events.length <= 500) return;
  const archive = sim.eventArchive ??= [];
  archive.push(sim.events.pop());
  if (archive.length > 25000) {
    const totals = sim.interceptionTotals ??= emptyInterceptionTotals();
    const omitted = archive.splice(0, 500);
    for (const event of omitted) countInterceptionEvent(totals, event);
    sim.omittedEvents = (sim.omittedEvents ?? 0) + omitted.length;
  }
}

export function formatTime(t) {
  const minutes = Math.floor(t / 60).toString().padStart(2, "0");
  const seconds = Math.floor(t % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function formatLogLines(events) {
  return events.map((event) => `${formatTime(event.t)} ${event.side} ${event.text}`).join("\n");
}
