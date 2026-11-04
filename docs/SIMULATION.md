# Simulation

## Core principles

Tomahawk is a deterministic, discrete-time 2D joint-warfare model. The simulation core lives in `src/sim/`; the UI does not rewrite engagement outcomes directly. The same seed, initial state, and inputs should produce the same event sequence.

Browser playback consumes fixed quarter-second ticks. The speed slider changes how many ticks the browser attempts per second. When the frame budget is exceeded, playback can run slower than the requested rate. Changing the rate discards pending wall-clock time. New scenario saves retain the command, sensor and exhaustion state needed to continue the same sequence.

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

Shared reports carry the reporting position. Tactical reception and cooperative weapon updates use a bounded link range with a longer allowance for elevated nodes. Weapons without a midcourse update continue from their last reported datum. Submarine evasive orders require a credible inbound track. The geographic scenario uses a shelf acoustics approximation with reduced propagation across a representative layer and greater passive range uncertainty than bearing uncertainty.

## Command and fire

Each side scores own and enemy force, firepower, and threat from the fused picture, then adjusts aggression and raid depth. Weapons are chosen by target domain, platform fit, range, track quality, ROE, and magazine. Defence considers area SAM, point SAM, dedicated BMD, and CIWS in turn; saturation can still break through.

## Movement, aircraft, and submarines

Surface ships respect water constraints and formation stations. Aircraft carry speed, altitude, fuel, mission, evasion, RTB, and rearm state; only compatible airframes recover on a carrier. Submarines are constrained by depth, noise, sonar, and underwater weapons.

Airfields and carriers have a finite pool of squadron turnarounds and a per-base relaunch cadence. Rearm scales with the remaining aircraft. The geographic map ruler reports great-circle distance. Tactical movement and sensor-grid geometry still use the projected coordinates.

## Damage and end conditions

Hits reduce hit points and may degrade radar, propulsion, fire control, CIWS, CIC, sonar, electronic warfare, or aircraft count. Air intercepts and underwater weapons check vertical separation during closest approach. Weapons cannot travel past their remaining range. A victory waits for hostile weapons still targeting survivors to resolve. When neither side has a viable attack path, a sustained exhaustion interval can end the battle as a draw. After-action reports include the archived events and an omission count when retention is exceeded.

## Model boundaries

Parameters are public approximations and engineering abstractions from open sources, not for real mission planning. The model does not include mines, logistics beyond the sortie pool, weather or sea state, detailed bathymetry, terrain elevation, full communications topology, crew training, or political decisions.
