# Simulation Assumptions

TomaHawk uses open-source approximate military data. Values are not authoritative and are not represented as classified, exact, or operationally complete.

## Current Ship

The first ship class is an Arleigh Burke Flight IIA-inspired destroyer approximation:

- 96-cell VLS capacity.
- Approximately 31 knot maximum (flank) speed and ~16 knot economical cruise,
  modeled at true real-world scale with realistic acceleration, deceleration,
  and tactical turn rate for a ~9,000-tonne hull.
- Active radar with long-range surface search abstraction.
- Missile inventory configurable per ship.
- Damage is modeled as mission degradation, then mission kill. The current playable rule is mission kill after two successful anti-ship missile hits.

## Current Weapons

The current missile set is intentionally abstract:

- `SM-2MR` / `SM2`: medium/long-range fleet interceptor.
- `SM-6` / `SM6`: dual-role fleet air defense and anti-surface missile abstraction.
- `ESSM`: shorter-range fleet interceptor.
- `MaritimeStrike` / `MSTK`: public-approximate maritime strike missile abstraction, fired in paced four-round salvos for the playable sandbox.
- `TomahawkBlockV` / `TLAM`: long-range surface strike abstraction, fired in paced four-round salvos for the playable sandbox.
- `DarkEagle` / `LRHW`: ground-launched LRHW / Dark Eagle hypersonic boost-glide abstraction. It is ground-only, uses a high-altitude profile, and attacks surface targets (ships and fixed ground units), not aircraft.

Ranges, speeds, and kill probabilities are gameplay/simulation envelopes. They should be refined only with public sources and explicit uncertainty notes.

Missile symbols are tactical categories rather than exact body shapes: anti-ship launches render as squares and anti-air launches render as triangles. An SM-6's role and symbol are fixed when it leaves the launcher.

## Imperfect Information

Ships do not receive perfect enemy positions for decision-making. Radar produces tracks with:

- position error,
- uncertainty radius,
- quality score,
- age,
- classification confidence,
- source identifier.

Lost tracks age out. Shared tracks degrade in quality. The UI can inspect truth for own units, but hostile targeting logic uses perceived tracks.
Friendly and self contacts are not inserted into radar track maps because their truth state is already available to their own force.

## Doctrine

Doctrine is a simplified Observe/Orient/Decide/Act loop:

- patrol when no contact exists,
- close or maintain standoff against tracks,
- launch anti-surface missiles when track quality and range permit,
- maneuver and fire defensive weapons against inbound missiles.
- counterfire when under attack if a good enough hostile track exists.

Ship navigation now treats terrain as a binary navigability problem: a point is
either water or not water. There is no shallow/deep-water model, no draft-based
channel logic, and no beaching state. Setup rejects new placements on land,
dragging preserves the last valid water position, map changes are setup-only,
and running ships either follow a deterministic coastal detour or stop/replan
at the last safe water point rather than crossing land.

Combat firing is now planned at the force level once per second. The planner allocates defensive interceptors to inbound missiles and offensive salvos to hostile ships using local/shared tracks, current queue state, active missiles, track quality, range, magazine depth, and a side-wide command posture. Defensive assignment does not wait for a stale force-wide composite if a local ship already has the inbound threat on radar. That posture is deliberately estimate-based: the commander only sees its own inventory plus the observed enemy picture, then raises aggressiveness when the side has more useful VLS and missile depth and lowers it when missile pressure is high. The force does not directly convert every posture tick into a new mood; instead it moves through persistent strike modes with hysteresis, closer to a real task group committing to a plan for some period of time. High aggression is not just a label: it shortens offensive commit delays, allows more strike allocations per planning pass, and keeps more pressure on already-targeted ships, so a force with advantage actually behaves like a force attempting saturation. This avoids suppressing every other friendly ship simply because one ship already fired.

Strike-empty ships now shift from prosecution to survival. A ship with no dedicated offensive missiles (`MSTK`/`TLAM`) keeps self-defence capability but sets a high-speed retreat waypoint away from the nearest hostile track instead of continuing to close the enemy. If the opposing force is also out of offensive missiles, ships that still hold reserve strike weapons may release those reserves rather than sitting on a clean endgame shot.

Default spawn loadouts are full for the hull class, so a fresh DDG does not begin the scenario with empty VLS cells. That keeps the tactical picture readable and avoids a misleading "already partly depleted" setup state.

Fixed ground shooters do not rearm. Once a SAM, coastal battery, or Dark Eagle battery has no launchable weapons left, fire planning skips it as a shooter while leaving its radar, tracks, CEC sharing, damage state, and win-condition presence intact. Unarmed radar/airfield units were already passive sensors and remain so.

Defensive missile selection uses one SAM engagement-channel pool plus weapon kinematics:

- SM-2 is preferred for earlier, longer-range, saturated, or high-risk missile engagements.
- ESSM is preferred for closer inbound threats when it can reasonably cover the threat.
- Survival overrides magazine conservation: if ESSM is depleted or the raid is saturated, SM-2 can be used even when conservation would otherwise be preferred.
- CIWS is the terminal last-ditch layer only.
- Missile defense respects each unit's `defenseChannels.sam` count. SM-2MR, SM-6, and ESSM all consume the same SAM channel until intercept, miss, abort, or timeout. CIWS remains governed by mount count, ammunition, and cycle time.
- Clean single midcourse tracks can receive one interceptor, but raid pressure, terminal threats, weak or stale tracks, late time-to-impact, a late first solution, or a leaker that would kill the target can drive shoot-shoot. Third shots are allowed for terminal or late high-pressure cases if magazines and channels allow it.
- Defensive missile PK keeps the per-shot weapon values but applies modest penalties for stale or low-quality tracks in addition to the existing speed, sea-skimming, and local saturation penalties. Misses therefore come from bad cueing, late engagements, and saturation instead of a global interceptor nerf.

CIWS is deliberately not modeled as an overpowered shield. It only engages terminal inbound missiles inside a very short envelope, consumes ammunition in bursts, has a cooldown between bursts, and takes a saturation penalty when multiple terminal missiles arrive together. This makes salvo timing and leakers possible while still giving the ship a last-ditch defensive layer.

### AEGIS Fleet Mechanics

Force-level air defence now models the high-end concepts at an abstract but
behaviourally meaningful level:

- **Command hierarchy.** Each side dynamically designates the most air-defence-
  capable surviving unit as Officer in Tactical Command (OTC / formation guide)
  and the next as Anti-Air Warfare Commander (AAWC). Selection is deterministic
  and re-evaluated as ships are damaged or lost.
- **Sector responsibility.** AAW sectors are anchored on the mean threat axis and
  divided among the units, so each ship owns a slice of sky. The unit that owns
  the sector an inbound threat is in engages it first, spreading a raid across
  the screen instead of piling every interceptor onto one launcher.
- **Formation doctrine.** Non-guide units take screen stations on a ring around
  the OTC and keep station when not prosecuting a close contact.
- **Cooperative Engagement Capability (CEC).** All sensors on a side are fused
  into one composite, fire-control-grade track picture. A ship can fire on a
  track built entirely by another unit's radar (engage-on-remote), and the same
  picture supplies missile mid-course datalink updates.
- **Cooperative / mid-course missile guidance.** Anti-ship weapons fly mid-course
  on the controlling force's datalink track and switch to their own seeker only
  in the terminal phase. Interceptors are command-guided under fire-control radar.
- **Rules of engagement.** Weapon-control states (free / tight / hold), a
  positive-identification quality gate, and an in-flight target-loss policy
  (self-destruct only) govern release. Self-defence is always authorised.

### Missile Altitude & Energy Bleed
Every weapon carries a cruise altitude (anti-ship rounds sea-skim ~30 m and drop
to ~12 m for the terminal run-in; air-defence/strike rounds loft to several
thousand metres) and a bounded drag model: a missile is fastest at launch and
bleeds speed toward the end of its reach, faster in the denser air at low
altitude, so a long-range or sea-skimming shot arrives slower than a lofted one.
The bleed is clamped (a weapon never drops below ~62% of its launch speed) so the
tuned engagement envelopes and balance stay close to before. The map remains
top-down — altitude is a hidden scalar that drives the radar horizon, the drag
model, and the detail display, not a third movement axis. The per-tick cost is a
few arithmetic operations per missile.

Two further effects couple this to real energy physics rather than a flat
formula:

- **Maneuver-induced drag.** A missile forced to pull a hard turn to keep
  tracking a maneuvering/notching target bleeds real speed doing it — the same
  induced-drag effect that costs an aircraft airspeed through a hard break.
  The bleed scales with how large a fraction of the missile's own design
  turn-rate ceiling it is pulling that tick (missiles here have a flat
  turn-rate cap with no separate airspeed-dependent formula, unlike aircraft,
  so this is a proportionate load-factor proxy, not a full derivation), and is
  most significant in the terminal endgame — the exact moment a missile has
  the least energy margin left, which is the real physical mechanism behind
  why the notch/beam+dive defense works, not just the aspect/NEZ PK penalty
  below (which reflects the same effect at the hit-probability level but
  previously never touched the missile's own kinematics).
- **Terminal-dive GPE→KE conversion.** At the exact tick a missile snaps into
  its terminal dive (sea-skim run-in, or JSOW's terminal glide), it gains a
  small, heavily-damped one-time speed bump proportional to the altitude just
  dropped — a controlled guided descent converts only a small fraction of that
  potential energy into forward speed (most of it is bled off as drag
  maintaining stable flight, unlike a literal free-fall), but it is a real,
  physically-motivated effect rather than the dive being energy-free.

### Aircraft Energy State (GPE ↔ KE)
An aircraft's altitude and airspeed were previously two fully independent
bounded-rate integrators with no physical coupling at all — climbing or diving
never affected speed. A small-angle gravity term now couples them: diving
genuinely gains real airspeed (gravity trades altitude for speed) and climbing
genuinely costs it, on top of (not instead of) the existing thrust/drag-limited
accel/decel model and the turn-induced speed bleed from a hard heading change.
This is what makes the defensive dive above actually matter kinematically, not
just cosmetically — a flight that dives hard during a break measurably outruns
one that doesn't.

### Afterburner
Every aircraft class (5th- and 4.5-gen alike — reheat is an engine property,
not an airframe generation) can go to afterburner: a configurable multiplier
over its MIL-power top speed and a much stronger acceleration multiplier, at a
steep fuel-burn multiplier. The AI engages it only for demanding moments — a
missile-defense break or closing an air-to-air intercept — and reverts to MIL
power for cruise/ingress/patrol/RTB so fuel is conserved on those legs.

### Strategic Bearing Estimate (Imperfect Pre-Contact Awareness)
Before any side holds a real radar contact, its units are not aimless: a
periodically-refreshed (not instantaneous), deliberately imprecise (bounded
random error, not a precise fix) estimate of the opposing force's general
bearing orients CAP/orbit stations and ship patrol legs — representing the
general battlespace awareness a real task group has (patrol patterns, prior
contact reports, expected transit lanes) rather than either a fixed compass
heading or the literal random patrol heading used previously for ships. Once a
side holds a real fused track, its actual (sensor-quality-limited) bearing is
used instead — this estimate is only the pre-contact default.

### Air-to-Air Geometry
Air-to-air kill probability is shaped by engagement geometry, not just a flat PK:

- **No-escape-zone (NEZ).** A shot taken within a weapon's `nezFraction` of its
  reach keeps its energy and is hard to defeat; a max-range shot is energy-depleted
  and far easier to out-run. `nezFraction` is a per-missile, editor-customizable
  field (AMRAAM 0.5, Sidewinder 0.6).
- **Aspect / closure.** A tail-chase (the target opening away from the missile)
  loses closure energy and PK; a head-on shot is hardest to defeat.
- **AI.** A flight prefers the high-percentage NEZ shot when one is available —
  closing for a Sidewinder kill rather than lobbing a max-range AMRAAM — so engagements
  naturally progress from a radar BVR phase to an infrared WVR phase as the merge develops.

These build on the bounded missile energy-bleed model, so a long-range or
low-altitude shot both arrives slower and is geometrically easier to defeat.

### Missile Guidance

Weapons no longer steer at the bare current position of the target. Each tick a
weapon solves a closed-form intercept against the target's estimated velocity and
flies the resulting lead (collision) course, limited by its airframe turn rate
(a proportional-navigation-style law). If the assigned target is destroyed in
flight, the weapon receives a commanded mid-course abort and self-destruct —
it is never left coasting toward a dead datum. There is no retargeting or
hand-off to a replacement contact in the current simulation.

Launches are paced through a queue. The queue is an abstraction for launch-system sequencing and tactical-map readability: a salvo is ordered as one decision, but missiles leave the launcher over several seconds instead of appearing at the same coordinate. Defensive launch orders have priority over offensive strike orders and use a separate defensive cadence gate; this prevents a ship from ignoring inbound missiles simply because it is already releasing a surface-strike salvo. When the force commits to an anti-ship raid, multiple ships can also be given the same release window against the same target so the salvo arrives as a coordinated wave rather than a random sequence of independent fires.

Normal anti-ship doctrine orders four-round salvos from each ship that has a valid shot. Multi-ship sides can contribute multiple salvos against one hostile target until the force-level raid size is saturated. Once a meaningful non-terminal wave is already in flight, the planner pauses top-ups against that target until the wave resolves, becomes terminal, or proves too small. Counterfire can still happen before the first salvo fully resolves if the defending force has usable hostile tracks and reaction delay has elapsed.

## Scenario Setup

The default destroyers begin 40 NM apart, 20 NM on each side of the origin. This is a gameplay choice for immediate tactical testing at real ship speed, not a claim about real-world doctrine. Setup mode lets the player drag ships, add multiple destroyers, right-click or box-select ships, and delete selected ships before running the battle.

Map switching is not a live-simulation feature. The tactical map may only be
changed in `setup`; changing it resets the existing forces onto deterministic
open-water starts valid for the newly selected map while preserving the ships
themselves and their configured loadouts/doctrine.

Amber/yellow missile rendering means terminal/endgame phase. For anti-ship missiles this begins inside the modeled terminal envelope; for interceptors it represents the final intercept endgame.

Ship movement now runs at true real-world speed (`SHIP_SPEED_MULTIPLIER = 1`). The
earlier 5x movement inflation has been removed; tempo for an active sandbox comes
from the UI sim-rate (time-compression) control instead, which scales how many
simulation seconds pass per real second without distorting the physical
speed relationships between ships and missiles.

This is a plausible simulation abstraction, not a real-world tactical procedure.

---

## Current Additions

### Ship Classes
Four naval ship classes are now modelled (see DATA_MODEL.md for full table): DDG (Burke destroyer), CCG (Ticonderoga cruiser), BBG (Trump arsenal battleship), FFG (Constellation frigate). Each has per-class kinematics (max speed, acceleration, turn rate, turnRateFlank), sensor fit (radar range, scan interval), magazine capacity (a single VLS-cell pool shared by every missile via its cell cost), CIWS mounts/ammo/cycle parameters, defence channels, damage resilience, and damage degradation. The compact setup rail includes a class selector (Naval / Ground groups) for newly placed Blue and Red units.

### Ground Emplacements
Four fixed land-based unit types extend the same ship model with `domain: "ground"`, `isFixed: true`, and zero speed: SAM (coastal surface-to-air battery), CDB (coastal anti-ship battery), DEB (Dark Eagle hypersonic strike battery), and EWR (early-warning radar, no weapons). They are deliberately implemented as stationary ship-entities so they reuse the existing sensor, cooperative-engagement, fire-planning, damage, and win-condition logic rather than a parallel system:

- **Placement.** Ground units must be placed on land (and are rejected on water on terrain maps); they never move, are never assigned a formation station or the OTC role, and are never re-seated to water on restore or map change.
- **Cross-domain behaviour.** A ground radar (especially the EWR) contributes to the side's cooperative force picture, so ships can engage on a ground unit's remote track and vice versa; naval anti-ship fire targets and destroys enemy ground units, and a coastal SAM can defend nearby friendly ships.
- **CDB targeting radar.** The coastal anti-ship battery is given a long, over-the-horizon targeting radar (≈250 NM) so its long-range missiles are usable at standoff; a battery whose radar is shorter than its weapons would otherwise sit blind and passive. Beyond its own radar it still depends on external cueing (e.g. an EWR) through CEC.
- **DEB remote cueing.** The Dark Eagle battery has a long-range surface-search abstraction so it can participate in the sandbox, but its 1,500 NM LRHW shots can also use shared tracks from EWR, aircraft, or ships. The missile flies high and fast, so it can be detected earlier than a sea-skimmer but gives defenders less engagement time.
- **Win condition.** Unchanged — a side is eliminated when all of its units (sea and ground) are destroyed.

### SM-6 Dual-Role
SM-6 (RIM-174 ERAM) fills the gap between long-range fleet air defense and anti-surface strike. It has 200 NM range, Mach 3.5 speed, PK 0.74, and `targets: ["missile", "air", "sea", "ground"]`. Its launch order permanently assigns either the anti-surface profile and square icon or the interceptor profile and triangle icon. SM-6 is preferred for long-range/high-threat defensive engagements and can be used offensively when magazine depth permits (>12 rounds).

### Subsystem Damage
Each anti-ship hit degrades 2-3 of six subsystems (radar, VLS, propulsion, fireControl, CIWS, CIC) by 15-45%. Combat effects: radar damage reduces track quality, propulsion damage reduces max speed, CIWS damage reduces PK. Subsystem state is visible in the ship detail popup with colour-coded health bars.

### Missile Detection and Kinetic Defense
`scanSensors()` can detect hostile missiles once they are close enough to appear on the radar picture. Those tracks feed the normal force-picture pipeline, and defensive launch planning only reacts to observed missile tracks. There is no passive ESM missile detection and no soft-kill defeat layer; missile defense is kinetic only (SM-2, SM-6, ESSM, CIWS).

Missile detection is now profile-specific. Tomahawk is modeled as an extremely
low-altitude cruise weapon, so its radar pickup is strongly horizon-limited and
late. SM-6 is modeled as a much higher-altitude, high-energy air-defense weapon,
so it is visible materially earlier. These are public-source-informed
approximations of flight profile and detectability, not exact sensor
performance claims.

### Interceptor PK Refinements
Interceptor PK now includes a speed penalty (-0.15 for fast supersonic targets, -0.28 for hypersonic targets), sea-skimming penalty (-0.14), stale/low-quality track penalty, and defence saturation penalty (concurrent threats degrade each interceptor's PK). Hard-kill missile intercepts are capped at 0.90 after modifiers. CIWS PK uses a base 0.45 × saturation ratio with penalties for sea-skimmer (-0.18), damage (-0.06), and supersonic speed (-0.12).

Saturation is now a **true local spatial density**, not a per-target proxy: both the interceptor penalty and the CIWS saturation ratio count the live threat missiles physically crowding the airspace around the interceptor / point-defence bubble (from any raid), via a pooled per-tick missile grid. This makes a dense, multi-axis raid degrade defences the way a single concentrated raid does, and is bounded to a handful of nearby grid cells rather than a naive scan of every missile.

### Radar Horizon
A 4/3 Earth-radius model limits detection probability beyond the geometric horizon (~20 NM ship-to-ship). Beyond the horizon, detection probability falls off over 120 NM to a floor of 0.20.

### RCS- and Altitude-Based Detection
Detection is no longer a rigid radar-range cutoff. Every unit carries a radar
cross-section (`rcsM2`) and an altitude (`altitudeM`), and a contact's effective
detection range scales with the fourth root of its RCS (the radar-range equation),
referenced to a typical destroyer:

- **RCS.** Surface hulls default their RCS from displacement (so destroyer-vs-
  destroyer play is near-unchanged), ground structures are large, and an aircraft
  flight is a small target — a 190 NM ship radar holds another warship out to
  ~180 NM but a fighter flight only inside ~40 NM. A class may set `rcsM2`
  directly (e.g. a future low-observable / stealth hull). The factor is capped at
  the radar's nominal range, so RCS only *shortens* detection for small or
  stealthy targets; it never extends a radar beyond its rated reach.
- **Altitude + horizon shadow.** A flying entity uses its altitude for the
  geometric-horizon term — on BOTH sides of a detection pair, observer as well as
  target, so a high-flying aircraft not only is seen far but itself looks (and
  looks *down*) far too, while a ship or a sea-skimming weapon is masked beyond
  the horizon — a radar shadow with no need for terrain elevation (the world
  surface is uniform sea/ground). Ships and ground units sit at sea level and use
  their structural mast height, on either side of the pair, as before. (An
  earlier version only applied altitude to the target side; an aircraft acting as
  the *observer* was silently treated as sitting at ~18m regardless of its actual
  altitude, capping e.g. a 9,000m-cruising fighter's look-down range against a
  sea-skimming missile at ~19NM instead of the 200+NM its altitude actually
  affords — fixed, since it made every aircraft's own radar performance far
  worse than its altitude should allow.)

Both are cheap scalars (one `pow` and one height lookup per detection candidate);
they do not change the O(observers × candidates) sensor cost. Altitude is shown in
a selected squadron's detail card; it is not drawn on the top-down map.

**Munitions now carry RCS too.** Every missile in the catalogue has an
`rcsM2` (public-source-approximate, from a tiny WVR dogfight round to a larger
long-range cruise missile) and a radar's chance of picking one up scales the
same fourth-root way, referenced to the largest vanilla munition rather than a
destroyer (every weapon is 3-4 orders of magnitude smaller than even a stealth
fighter, so reusing the platform reference would clamp every missile to the
same floor and erase the distinction between them). This replaces what used
to be a hand-tuned "visibilityFactor" magic number per weapon with no
relationship to any actual per-weapon RCS value. Altitude/profile (sea-skim
vs. lofted) remains a separate, legitimate per-weapon factor feeding the same
horizon model above — RCS governs how big the return is once in view, not
whether the horizon masks it.

**RCS is now editable in the Unit Workshop.** Every naval, ground, and
aircraft class (and every ammo record) exposes `rcsM2` as a plain numeric
field, round-tripping the exact value the sim uses (vanilla hulls without an
explicit value show the same domain/displacement-derived default the engine
itself falls back to, rather than an invented number). Previously RCS was
fully implemented in the engine but completely invisible and non-editable in
the Workshop — every custom/cloned unit silently got an auto-computed default
with no way to see or override it.

### CEC Latency
Track sharing now has a 1.8s propagation delay. Tracks younger than the latency window are not shared to other units. Shared track quality is degraded (0.85×) with increased uncertainty (+1500m).
CEC selects from local sensor reports only, so a track cannot relay through multiple ships. One shared report is stored per side/contact and resolved together with each receiver's local reports; it is not copied into every receiving ship. The fused force picture refreshes fully every 0.5s and updates dirty contacts immediately when radar or CEC data changes.

### UI: Ship Detail Popup
Compact overlay cards showing subsystem health, effective speed, and CIWS ammo. Appears on right-click+drag ship selection. Multiple ships selectable simultaneously. Clears on right-click blank space.

### Performance
Persistent entity indexes and per-planning-cycle target, side, queue, track, and engagement indexes avoid repeated O(n) scans in hot paths. The inbound-raid count on each ship is memoized for the fire-planning cycle (it is constant while planning yet queried once per threat), removing the dominant quadratic in a saturated defence; the missile saturation grid is a pooled per-tick uniform grid whose buckets are reused across ticks to keep allocation and GC low. The per-cycle engagement-index Maps are likewise pooled and cleared in place rather than reallocated each second (refilled in the same deterministic order, so behaviour is identical). The event log is intentionally left as a capped newest-first array rather than a ring buffer, because it is consumed as a plain array (indexing, `map`, spread, serialization) in many places and any O(1) ring structure would change its order or representation. Track ageing uses lazy state projection plus an expiry heap; CEC stores one shared side/contact report; sensor scans use a deterministic adaptive spatial broad phase. Terrain uses conservative raster/grid broad phases followed by exact polygon checks, and blocked-route plans are reused for their cache window. The UI caches stable DOM panels and range metadata, clusters labels spatially, resolves targets through entity indexes, and culls offscreen symbols. `npm run bench` reports Open Sea combat throughput and determinism plus an East China Sea route case; `npm run bench:frontend` measures isolated high-density rendering helpers. Results are machine-dependent.

### Scenario Default
Default starting distance reduced from 120 NM to 40 NM so engagements begin within 1-2 minutes at 1× speed.

### Air Units (Aircraft Squadrons)

Aircraft are modelled with `domain: "air"` on the same entity as ships, so they
reuse the sensor, cooperative-engagement, fire-planning, damage, and win-condition
pipelines rather than a parallel system (see `src/sim/aircraft.js`). Everything in
`AIRCRAFT_TEMP_CONFIG` is intentionally provisional and meant to be retuned.

- **One squadron = one entity, several aircraft.** A squadron costs one ship's
  worth of latency (one radar, one track-file, one decision, one fire plan) but
  renders and attrits as a flight. Its hit-point pool **is** the plane count:
  each missile hit downs exactly one aircraft, and combat power scales with the
  survivors. This keeps the per-tick budget flat as aircraft (which vastly
  outnumber ships) are added. "Squadron is a point" is intentional — modelling
  each airframe individually was judged a large performance cost for little gain.
- **Movement.** Air units overfly land and sea (no water-collision/seating), are
  placeable anywhere, and are excluded from OTC/AAWC command roles and AAW sector
  responsibility (they are mobile strikers, not sectorised pickets).
- **Survivability.** A squadron is a small, fast, hard target: every missile that
  reaches it loses a large slice of its terminal PK (`evasionBase`), more while
  the flight is breaking (`evasionManeuver`), so SAMs cost many shots per kill
  rather than ~1. When a missile closes inside the reaction envelope the flight
  performs an **evasive break** (notches perpendicular to the threat at max speed)
  and pops **flares**; infrared seekers (e.g. Sidewinder) can be decoyed outright.
- **Six fixed-identity airframes, two generations × three roles.** Each hull has
  a **rigid** default loadout that defines its role — `vlsCells` is sized to
  exactly fit it, so a squadron spawns as (and stays) purpose-built rather than
  a generic hardpoint budget a player reconfigures. `AGM-154` (JSOW) is the
  dedicated anti-ground stand-off weapon and `AGM-84` (Harpoon) the dedicated
  anti-ship weapon — a strike airframe never carries both, and an
  air-superiority airframe carries neither: `F22` and `F15C` are air-to-air
  only, `F35A`/`F15E` carry JSOW, `F35C`/`F15N` carry Harpoon. The 5th-gen trio
  (`F22`, `F35A`, `F35C`) has a tiny `rcsM2` so hostile radars only see them
  deep inside their nominal reach (they shoot first and absorb far fewer SAM
  shots) plus an intrinsic `airEvasionBonus`; the 4.5-gen trio (`F15E`, `F15N`,
  `F15C`) is non-stealth — a larger radar cross-section and no evasion bonus,
  but the biggest magazines of the roster (they survive by stand-off and
  terrain masking, not signature). All six are tunable `SHIP_CLASSES` entries
  (the internal hull ids — `F22`, `F35A`, etc. — are unchanged and still what
  `placeShip`/scenarios reference; only the *displayed* unit tag and class name
  changed, see below).
- **Concise unit tags and class names, uniform hardpoints per generation.**
  Displayed names used to read as a real-airframe name plus a parenthetical
  ("F-22 Raptor Squadron (5th-gen air-superiority) approx."). Tags now follow
  a Generation × Role scheme — `G5`/`G4` × `AA` (air-superiority) / `AG`
  (anti-ground, matching this project's own `AGM-`-prefixed weapon naming) /
  `AS` (anti-ship) — paired with a short class name ("5th Gen Air Supremacy",
  "5th Gen Strike", "5th Gen Naval Strike", and the 4.5-gen equivalents
  rounded to "4th Gen" for the same brevity already used in the Chinese
  labels). Every 5th-gen hull shares the same hardpoint count (8) and every
  4.5-gen hull shares its own (14) — a deliberate uniform gameplay number, not
  a claim about real internal-bay capacity (a real 5th-gen internal bay is
  smaller; external carriage's RCS penalty is a future refinement, not
  modeled yet) — with each loadout rebalanced to fill its cap exactly.
- **A seventh, unarmed hull: AWAC (AEW&C) as a command hub.** `AWAC` carries no
  weapons at all (`baseLoadout: {}`) and models a single, high-value, moving
  radar (`damageResist: 1` — one aircraft, not a 4-ship flight; any hit is a
  mission kill, matching the real vulnerability of an unescorted AEW&C
  aircraft), with the longest radar (`radarRangeNm: 350`) and slowest, least
  manoeuvrable airframe (`maxGLoad: 3`) of the roster. Because every combat
  branch in `decideAircraft` is gated on carrying a strike or air-to-air
  weapon, an unarmed flight falls through to the fallback branch automatically
  — no aircraft-specific code path was needed to make it never fight. That
  fallback itself distinguishes armed from unarmed: an armed flight screens
  *ahead* of the formation guide on the threat axis (a combat air patrol); an
  unarmed one orbits *behind* it, on the side away from the threat
  (`supportOrbitM`). The `commandHub` flag (any hull can set it, not just
  `AWAC`) is the "acts as a command hub when present" behaviour: while a
  commandHub unit is alive and on-mission (not RTB/rearming), its side's CEC
  track-sharing latency in `shareTracks` tightens from the baseline 1.8s to
  0.6s, representing a centralized high-bandwidth relay/correlation node
  instead of every ship pair propagating and merging tracks independently.
- **Mission doctrine (vectored on the fleet picture).** A squadron prosecutes the
  fused **CEC force picture** — the same picture the ships fire on — so it is
  cued onto targets by the fleet's long-range radars/datalink instead of only the
  handful its own short-range set can see. Its geometry then follows its role:
  - *Stand-off strike.* A striker vectors onto a surface target, **descends to a
    low-level ingress altitude** (so the radar-horizon model masks it until much
    closer — the "go low" of a strike run), and holds at a **stand-off ring** just
    inside its best anti-ship weapon's reach. It fires from there and never bores
    into the ship's air-defence envelope; if it drifts too close it turns cold and
    **egresses** to re-open the range. (`standoffFrac`, `egressFrac`,
    `ingressStartFrac`, `cruiseAltitudeM`, `ingressAltitudeM`.)
    F-35C anti-ship runs use a low-observable stand-in variant: they must descend
    below `lowObservableReleaseAltitudeM` (500 m) and close to
    `lowObservableStandInFrac` (0.65) of AGM-84 range before release. F-15N
    Harpoon runs and F-35A/F-15E JSOW attacks keep the normal stand-off release.
  - *Defensive air-to-air.* A striker breaks off for an enemy flight only when it
    closes inside self-defence/merge range (`a2aSelfDefenseRangeM`) — it does not
    abandon its run to chase a distant fighter, so strike packages press their
    attack instead of every flight collapsing into a furball. The break/resume
    boundary is hysteresis-gated (`a2aSelfDefenseExitFrac`) so a fighter loitering
    right at the merge line doesn't flip the striker every tick.
  - *Sweep.* A flight with no strike to fly (pure air-superiority load, or strike
    spent) runs down enemy flights for air-to-air (`a2aEngageRangeM`), staying high
    for energy and closing to a no-escape-zone shot.
  - *Target lock persistence.* A flight keeps vectoring on the same locked target
    as long as it appears anywhere in the fused picture, and **coasts** on the
    target's last known (smoothed) position for up to `trackCoastS` if it briefly
    drops out of the picture entirely (one missed radar sweep at long range),
    before conceding the lock and picking a fresh target. The steering aim point
    itself is exponentially filtered (not the raw noisy per-detection track
    position) so the flight flies a clean course instead of visibly chasing sensor
    noise. Both are pure deterministic filters on already-sampled data — no new
    RNG draws.
- **Air-to-air missiles need a facing shot.** A fighter cannot employ a forward-
  firing AAM at a target well behind its own nose — unlike a ship's/battery's
  vertical-launch SAM, which fires in any direction and turns onto the intercept
  course after launch. `a2aLaunchConeDeg` (permissive: allows a beam or high-aspect
  shot, reflecting real off-boresight seeker/HMD capability) gates every aircraft
  AAM launch, offensive or the anti-ship-missile hard-kill below; ship and ground
  VLS launches are unaffected.
- **Altitude is an attribute, not a movement axis.** A flight's `altitudeM` climbs
  or descends toward an AI-commanded `targetAltitudeM` (high cruise for CAP/sweep/
  transit — lookout and energy; low for a strike ingress — masking) at a bounded
  vertical rate, rather than teleporting between them. It drives the sensor
  radar-horizon only; the map stays top-down. No RNG is involved, so determinism
  is unaffected.
- **Missile defense is a combination maneuver, not just a lateral break.** Real
  BVR/WVR doctrine pairs the beam/notch (turning perpendicular to the threat's
  line of sight, nulling the closure rate a semi-active/active seeker keys on)
  with a hard descent — "go low" — and afterburner: diving trades altitude for
  the airspeed/energy needed to keep out-turning a missile with little energy
  margin left late in its flight, denies a look-down seeker a clean picture, and
  (via the missile's own maneuver-drag model below) costs the missile more to
  keep following. Previously the evasion branch changed heading but never
  touched altitude at all — the defensive dive was completely missing.
- **Afterburner.** Every airframe in the roster, 5th- or 4.5-gen alike, has
  reheat available (a property of the engine, not the generation): a
  meaningfully higher speed ceiling and much stronger acceleration than MIL
  power, at several times the fuel-flow rate. The AI reserves it for genuinely
  demanding moments — a defensive break, closing an air-to-air intercept —
  rather than running it continuously, so cruise/ingress/patrol/RTB legs still
  fly on MIL power and conserve fuel.
- **Air defence of the fleet.** A squadron will hard-kill an inbound anti-ship
  missile with its long-range radar AAM, but only conservatively — IR rounds are
  reserved for the dogfight and a heavy (≈70%) reserve of the radar AAM is kept,
  so a flight does not strip its air-to-air load chasing cruise missiles.
- **CAP fallback.** With no track held at all, a flight flies a combat air patrol
  screening the fleet — a station ahead of the formation guide (OTC) along the
  force's threat axis — instead of wandering independently. Aircraft are excluded
  from the OTC/AAWC roles and AAW sector division (they are mobile screeners).
- **Volley scales with the flight.** A squadron's coordinated volley is capped by
  its surviving aircraft, and its relaunch cadence scales with them (one shooter
  per plane), so a four-ship flight throws a fast alpha-strike while a lone
  survivor fires slowly.
- **Return to base / fuel.** A squadron flies its mission until it is Winchester,
  has spent its strike load (anti-ship `AGM-84` or anti-ground `AGM-154`,
  whichever it carries), or is low on fuel, then returns to the
  nearest friendly **airfield** to rearm/refuel (a flat timer) and relaunch. With
  no airfield reachable it limps toward friendly territory and splashes when fuel
  runs out. Fighter endurance is tuned as combat radius with return reserve:
  roughly 600 nm for the 5th-gen set and 680 nm for the 4.5-gen set. A flight
  will not rearm on a destroyed airfield. Carriers, sortie generation, and
  per-airframe fuel are out of scope for now.
- **Airfields.** An airfield (`AFB`, or any ground unit with `isAirfield`) is a
  fixed unit placeable on land **or** water that rearms/refuels friendly flights.
- **UI.** The force inventory has an air sub-table (flight strength / lifecycle
  state / AAW / ASUW), and a selected squadron's detail card shows flight readouts
  (aircraft, fuel, flares, state, AAW/ASUW) instead of ship subsystems. Rendering
  draws one dart per surviving aircraft; labels are skipped when zoomed far out
  (level-of-detail culling) so a large, zoomed-out air battle stays responsive.

### Coordinated Strike Allocation (anti-overcommit)

Offensive fire planning avoids two wasteful failure modes observed in air/surface
battles:

- **Dedicated strike weapons are preferred over dual-role rounds.** When choosing
  an anti-ship weapon a shooter picks a dedicated `anti_ship` round (Maritime
  Strike / Tomahawk / Harpoon) ahead of the dual-role `SM-6`, so the fleet's
  precious area-air-defence missile is conserved for the air battle instead of
  being burned as the primary strike weapon. (Selection is otherwise unchanged —
  range fit, then reach — so a hull whose only in-range option is dedicated is
  unaffected.)
- **Raid size is capped by target toughness** in the default/measured postures:
  the fleet sizes a raid to score the target's remaining hit points through the
  expected defensive leakage plus a few leakers, rather than dumping a full
  saturation salvo on a lightly-built ship. A deliberate `saturate` doctrine is
  exempt — its whole purpose is to overwhelm.
- **A strike target always keeps a slot.** A high-value enemy flight can outscore
  every ship; with a narrow target breadth it would monopolise the side's whole
  salvo and leave the strikers' anti-ship rounds unused. The planner guarantees
  the top surface/ground target a slot so the fleet keeps prosecuting ships even
  while fighters are up. (A no-op when every observed target is already surface,
  so pure-surface play is unchanged.)

### Debug Instrumentation

Two read-only collectors (`src/sim/debug.js`) observe a run without perturbing it
(they draw no RNG and mutate no sim state) and are persisted to `debug/`,
**overwritten every run**:

- **`PerfRecorder` → `debug/perf-debug.log`.** A device/workload performance trace:
  per-tick **sim** cost (avg / p50 / p95 / p99 / max), per-frame **render** cost
  (browser only), peak concurrent entities, the worst tick and what was alive then,
  heap growth, and a short lag diagnosis that **attributes a slow frame to the sim
  step vs the canvas render path**. It is about the *device*, to explain stutter —
  not the battle. Typical numbers on this hardware: sim p50 ≈ 0.1 ms/tick, p95 ≈ 1
  ms/tick — so the simulation core is not the bottleneck; browser slowness is the
  render path (which scales with on-screen ships/missiles/weapon-range-rings/labels
  and is amplified by zoom and by the **speed multiplier**, which runs many sim
  ticks per rendered frame), plus the occasional GC pause (a one-off 100–240 ms
  tick). Lower the speed slider, zoom in, or hide the WEZ rings / tracks to recover
  frame rate.
- **`BattleLogger` → `debug/sim-debug.log`.** A tactical trace sampled at a fixed
  sim-time cadence: every entity's position/heading/speed/altitude/state/stores, a
  one-line translation of what each unit is *doing and why* (derived from the same
  fused picture the AI uses), the per-side command posture, and the events since
  the last frame — enough to "watch" how the battle and the AI unfolded offline.

Both run headless via `npm run debug:sim` — `scripts/sim-debug.mjs` builds a
**highly asymmetric** deterministic battle (a BLUE air task force of two stealth
5-gen and two 4.5-gen squadrons + a picket + an airfield, raiding a RED surface
group that is strong in anti-ship fires but thin on air defence). Unlike a
mirrored match-up it resolves decisively and exercises the full strike → RTB →
rearm → relaunch cycle. The same two logs are also written from the browser app,
which POSTs them to the server (`POST /debug/save`) on every run.

## Current Weapons (updated)

- `SM-2MR` / `SM2`: fleet interceptor (90 NM, Mach 3.1, PK 0.64)
- `SM-6` / `SM6`: dual-role fleet AAW and anti-surface (200 NM, Mach 3.5, PK 0.74)
- `ESSM`: short-range interceptor, quad-packable (28 NM, Mach 2.9, PK 0.60)
- `MaritimeStrike` / `MSTK`: subsonic anti-ship cruise missile (120 NM, Mach 0.8, PK 0.48)
- `TomahawkBlockV` / `TLAM`: long-range surface strike (650 NM, Mach 0.7, PK 0.40)
- `DarkEagle` / `LRHW`: ground-launched hypersonic surface strike (1,500 NM, Mach 5+, PK 0.58)
- `AIM-120C` / `120C`: BVR active-radar air-to-air missile for 4.5-gen aircraft (55 NM, PK 0.72, `targets: ["air"]`)
- `AIM-120D` / `120D`: extended-envelope BVR active-radar air-to-air missile for 5th-gen aircraft (82 NM, PK 0.76, `targets: ["air"]`)
- `AIM-9X` / `AIM9`: WVR infrared air-to-air missile (18 NM, PK 0.78, flare-decoyable)
- `AGM-84` / `HPN`: air-launched anti-ship missile (67 NM, subsonic, PK 0.52)
