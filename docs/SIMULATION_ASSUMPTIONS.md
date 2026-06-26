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

- `SM-2MR` / `SM2`: area air-defense interceptor.
- `SM-6` / `SM6`: dual-role fleet air defense and anti-surface missile abstraction.
- `ESSM`: point-defense interceptor.
- `MaritimeStrike` / `MSTK`: public-approximate maritime strike missile abstraction, fired in paced four-round salvos for the playable sandbox.
- `TomahawkBlockV` / `TLAM`: long-range surface strike abstraction, fired in paced four-round salvos for the playable sandbox.

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

Defensive missile selection is layered:

- SM-2 is the area-defense layer for earlier, longer-range, saturated, or high-risk missile engagements.
- ESSM is the preferred point-defense layer for closer inbound threats when it can reasonably cover the threat.
- Survival overrides magazine conservation: if ESSM is depleted or the raid is saturated, SM-2 can be used even when conservation would otherwise be preferred.
- CIWS is the terminal last-ditch layer only.
- The planner is not satisfied by the mere existence of one assigned interceptor. It estimates whether already-active or queued shots can actually arrive before the inbound missile hits, and it can order multiple concurrent interceptors onto one threat when a single late or single-shot engagement would be tactically unsound. Close-in, last-chance, or one-leak-kills cases bias that extra shot toward ESSM when the point-defense layer can cover.

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

### Missile Guidance

Weapons no longer steer at the bare current position of the target. Each tick a
weapon solves a closed-form intercept against the target's estimated velocity and
flies the resulting lead (collision) course, limited by its airframe turn rate
(a proportional-navigation-style law). If the assigned target is destroyed in
flight, the weapon receives a commanded mid-course abort and self-destruct —
it is never left coasting toward a dead datum. There is no retargeting or
hand-off to a replacement contact in the current simulation.

Launches are paced through a queue. The queue is an abstraction for launch-system sequencing and tactical-map readability: a salvo is ordered as one decision, but missiles leave the launcher over several seconds instead of appearing at the same coordinate. Defensive launch orders have priority over offensive strike orders and use a separate defensive cadence gate; this prevents a ship from ignoring inbound missiles simply because it is already releasing a surface-strike salvo. When the force commits to an anti-ship raid, multiple ships can also be given the same release window against the same target so the salvo arrives as a coordinated wave rather than a random sequence of independent fires.

Normal anti-ship doctrine orders four-round salvos from each ship that has a valid shot. Multi-ship sides can contribute multiple salvos against one hostile target until the force-level raid size is saturated. Counterfire can happen before the first salvo fully resolves if the defending force has usable hostile tracks and reaction delay has elapsed.

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
Three fixed land-based unit types extend the same ship model with `domain: "ground"`, `isFixed: true`, and zero speed: SAM (coastal surface-to-air battery), CDB (coastal anti-ship battery), and EWR (early-warning radar, no weapons). They are deliberately implemented as stationary ship-entities so they reuse the existing sensor, cooperative-engagement, fire-planning, damage, and win-condition logic rather than a parallel system:

- **Placement.** Ground units must be placed on land (and are rejected on water on terrain maps); they never move, are never assigned a formation station or the OTC role, and are never re-seated to water on restore or map change.
- **Cross-domain behaviour.** A ground radar (especially the EWR) contributes to the side's cooperative force picture, so ships can engage on a ground unit's remote track and vice versa; naval anti-ship fire targets and destroys enemy ground units, and a coastal SAM can defend nearby friendly ships.
- **CDB targeting radar.** The coastal anti-ship battery is given a long, over-the-horizon targeting radar (≈250 NM) so its long-range missiles are usable at standoff; a battery whose radar is shorter than its weapons would otherwise sit blind and passive. Beyond its own radar it still depends on external cueing (e.g. an EWR) through CEC.
- **Win condition.** Unchanged — a side is eliminated when all of its units (sea and ground) are destroyed.

### SM-6 Dual-Role
SM-6 (RIM-174 ERAM) fills the gap between area air defence and anti-surface strike. It has 200 NM range, Mach 3.5 speed, PK 0.55, and `target: "dual"`. Its launch order permanently assigns either the anti-surface profile and square icon or the interceptor profile and triangle icon. SM-6 is preferred for long-range/high-threat defensive engagements and can be used offensively when magazine depth permits (>12 rounds).

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
Interceptor PK now includes supersonic penalty (-0.15 for Mach 2+ targets), sea-skimming penalty (-0.14), and defence saturation penalty (concurrent threats degrade each interceptor's PK). CIWS PK uses a base 0.45 × saturation ratio with penalties for sea-skimmer (-0.18), damage (-0.06), and supersonic speed (-0.12).

### Radar Horizon
A 4/3 Earth-radius model limits detection probability beyond the geometric horizon (~20 NM ship-to-ship). Beyond the horizon, detection probability falls off over 120 NM to a floor of 0.20.

### CEC Latency
Track sharing now has a 1.8s propagation delay. Tracks younger than the latency window are not shared to other units. Shared track quality is degraded (0.85×) with increased uncertainty (+1500m).
CEC selects from local sensor reports only, so a track cannot relay through multiple ships. One shared report is stored per side/contact and resolved together with each receiver's local reports; it is not copied into every receiving ship. The fused force picture refreshes fully every 0.5s and updates dirty contacts immediately when radar or CEC data changes.

### UI: Ship Detail Popup
Compact overlay cards showing subsystem health, effective speed, and CIWS ammo. Appears on right-click+drag ship selection. Multiple ships selectable simultaneously. Clears on right-click blank space.

### Performance
Persistent entity indexes and per-planning-cycle target, side, queue, track, and engagement indexes avoid repeated O(n) scans in hot paths. Track ageing uses lazy state projection plus an expiry heap; CEC stores one shared side/contact report; sensor scans use a deterministic adaptive spatial broad phase. Terrain uses conservative raster/grid broad phases followed by exact polygon checks, and blocked-route plans are reused for their cache window. The UI caches stable DOM panels and range metadata, clusters labels spatially, resolves targets through entity indexes, and culls offscreen symbols. `npm run bench` reports Open Sea combat throughput and determinism plus an East China Sea route case; `npm run bench:frontend` measures isolated high-density rendering helpers. Results are machine-dependent.

### Scenario Default
Default starting distance reduced from 120 NM to 40 NM so engagements begin within 1-2 minutes at 1× speed.

## Current Weapons (updated)

- `SM-2MR` / `SM2`: area air-defence interceptor (90 NM, Mach 3.1, PK 0.45)
- `SM-6` / `SM6`: dual-role fleet AAW and anti-surface (200 NM, Mach 3.5, PK 0.55)
- `ESSM`: point-defence interceptor, quad-packable (28 NM, Mach 2.9, PK 0.35)
- `MaritimeStrike` / `MSTK`: subsonic anti-ship cruise missile (120 NM, Mach 0.8, PK 0.42)
- `TomahawkBlockV` / `TLAM`: long-range surface strike (650 NM, Mach 0.7, PK 0.34)
