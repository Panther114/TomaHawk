// Event-log helpers: appending tactical events, classifying their severity,
// and formatting log output. No simulation dependencies beyond the `sim`
// object's own `events`/`time` fields.

export function eventSeverity(text) {
  if (/mission-killed|sinking|hit by/i.test(text)) return "kill";
  if (/intercepted|destroyed incoming/i.test(text)) return "intercept";
  if (/launched|queued/i.test(text)) return "launch";
  if (/missed|failed|exhausted|leaked/i.test(text)) return "miss";
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
