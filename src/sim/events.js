// Event-log helpers: appending tactical events, classifying their severity,
// and formatting log output. No simulation dependencies beyond the `sim`
// object's own `events`/`time` fields.

export function eventSeverity(text) {
  const t = String(text).toLowerCase();
  if (t.includes("mission-killed") || t.includes("sinking") || t.includes("hit by")) return "kill";
  if (t.includes("intercepted") || t.includes("destroyed incoming")) return "intercept";
  if (t.includes("launched") || t.includes("queued")) return "launch";
  if (t.includes("missed") || t.includes("failed") || t.includes("exhausted") || t.includes("leaked")) return "miss";
  return "info";
}

export function addEvent(sim, text, side = "SYS") {
  const id = sim._nextEventId ?? 1;
  sim._nextEventId = id + 1;
  sim.events.unshift({ id, t: sim.time, side, text, severity: eventSeverity(text) });
  if (sim.events.length > 500) sim.events.pop();
}

export function formatTime(t) {
  const minutes = Math.floor(t / 60).toString().padStart(2, "0");
  const seconds = Math.floor(t % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function formatLogLines(events) {
  return events.map((event) => `${formatTime(event.t)} ${event.side} ${event.text}`).join("\n");
}
