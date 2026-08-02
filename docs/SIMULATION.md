# Simulation

## Core principles

Tomahawk is a deterministic, discrete-time 2D joint-warfare model. The simulation core lives in `src/sim/`; the UI does not rewrite engagement outcomes directly. The same seed, initial state, and inputs should produce the same event sequence.

## One clock tick

`stepSim` advances one deterministic tick in this order: advance time and
rebuild entity indexes; age tracks; move surface and air units; update aircraft
fuel, submarine depth, and electronic-warfare state; scan radar and sonar;
share tracks when the datalink interval is due; rebuild the fused force picture;
make unit decisions; plan engagements; process launch queues; update missiles;
run point defence; prune dead tracks; then evaluate win/draw conditions. The UI
does not call `stepSim` while paused, so pause is an application-level gate and
the core function itself also respects `sim.paused`; the UI's explicit
single-step command passes an `allowPaused` override. Decisions therefore
consume the sensor picture produced earlier in the same tick, after movement
has already occurred.

## Sensors and tracks

Radar detection depends on range, scan period, target RCS, altitude, and radar horizon; submarines are found mainly by sonar; ESM can passively detect emitters. Tracks have quality, error, age, and source — they are not omniscient truth. Friendly sharing adds latency; command or AEW nodes can shorten it.

## Command and fire

Each side scores own and enemy force, firepower, and threat from the fused picture, then adjusts aggression and raid depth. Weapons are chosen by target domain, platform fit, range, track quality, ROE, and magazine. Defence considers area SAM, point SAM, dedicated BMD, and CIWS in turn; saturation can still break through.

## Movement, aircraft, and submarines

Surface ships respect water constraints and formation stations. Aircraft carry speed, altitude, fuel, mission, evasion, RTB, and rearm state; only compatible airframes recover on a carrier. Submarines are constrained by depth, noise, sonar, and underwater weapons.

## Damage and end conditions

Hits reduce hit points and may degrade radar, propulsion, fire control, CIWS, CIC, sonar, electronic warfare, or aircraft count. When one side has no living units, the other wins; when neither side can form an effective offence, the battle may end as magazine-exhaustion draw.

## Model boundaries

Parameters are public approximations and engineering abstractions from open sources, not for real mission planning. Mines, logistics, weather/sea state, crew training, communications network topology, and political decisions are not modeled.
