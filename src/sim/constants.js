// Core units, enumerations, and presentation constants shared across the
// simulation. No dependencies — this is the lowest layer of the sim.

export const NM = 1852;
export const KNOT = 0.514444;
// Ship movement now runs at true real-world speed (1x). Time compression for
// playability is handled by the sim-rate control in the UI, not by inflating
// the platform's physical speed. Kept exported so saved scenarios and external
// tooling that reference the constant continue to resolve.
export const SHIP_SPEED_MULTIPLIER = 1;
export const SIDE = Object.freeze({ BLUE: "Blue", RED: "Red" });

// Rules of engagement weapon-control states (AEGIS-style).
export const WEAPON_STATE = Object.freeze({ FREE: "free", TIGHT: "tight", HOLD: "hold" });
// Fleet command roles assigned dynamically each planning cycle.
export const FLEET_ROLE = Object.freeze({ OTC: "OTC", AAWC: "AAWC", UNIT: "UNIT" });
export const SCENARIO_MODE = Object.freeze({ SETUP: "setup", RUNNING: "running", ENDED: "ended" });
export const VISUAL_CONFIG = Object.freeze({
  missileMinPx: 1.5,
  missileMaxPx: 6.5,
  missileLabelPx: 6,
  shipLabelPx: 9,
  rangeLabelPx: 8,
  uiBasePx: 8,
  logPx: 7
});
