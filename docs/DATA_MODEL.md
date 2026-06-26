# TomaHawk Data Model

The current implementation keeps data as plain JavaScript objects defined across the `src/sim/` modules (ship shape in `src/sim/ships.js`, missile catalogue in `src/sim/missiles.js`, scenario/track shapes in `src/sim/scenario.js` and `src/sim/sensors.js`). These objects are intentionally shaped for straightforward JSON persistence without changing the game design.

## Ship

Important fields:

- `id`, `name`, `side`, `className`
- `domain` (`"sea"` or `"ground"`) and `isFixed` (true for stationary land emplacements)
- `x`, `y`, `heading`, `speed`, `desiredSpeed`
- `cruiseSpeed`, `maxSpeed`, `accel`, `decel`, `turnRate`
- `radarRangeM`, `radarInterval`, `radarActive`
- `editable`
- `loadout`
- `launchQueue`
- `nextLaunchAt`
- `nextDefensiveLaunchAt`
- `lastLaunchAtByMissile`
- `reactionAvailableAt`
- `defenseReactionAvailableAt`
- `ciwsAmmo`, `ciwsBurstUntil`, `nextCiwsAt`, `ciwsCooldown`
- `defenseChannels`
- `engagementAssignments`
- `lastFirePlanAt`
- `tracks`
- `doctrine`
- `defenseDoctrine`
- `offenseDoctrine`
- `roe` (rules of engagement: `weaponState`, `identifyThreshold`, `tightMinQuality`, `tightCommitRangeNm`, `retargetAllowed` [legacy, currently false], `selfDestructOnTargetLoss`, `ciwsRelease`)
- `fleetRole` (`OTC` / `AAWC` / `UNIT`), `isOTC`
- `sectorCenter`, `sectorHalfWidth` (assigned AAW sector responsibility, radians)
- `station` (assigned formation station relative to the guide, or `null`)
- `waypoint` (the ship's strategic intent waypoint)
- `navigationWaypoint` (a temporary terrain-avoidance detour waypoint, or `null`)
- `damage`, `alive` (damage accumulates in whole hits; the UI renders whole-number HP)

All world-space values use meters, seconds, and radians internally.

Ship speed is now modeled at true real-world scale (`SHIP_SPEED_MULTIPLIER = 1`):
a ~16 kn economical `cruiseSpeed`, ~31 kn `maxSpeed`, a slow `accel` and slightly
faster `decel` reflecting a 9,000-tonne hull, and a modest tactical `turnRate`.
Time compression for playability is handled by the UI sim-rate control, not by
inflating platform speed.

## Missile Type

Important fields:

- `name`
- `displayName`
- `shortLabel`
- `role`
- `category`
- `symbol`
- `rangeM`
- `speedMps`
- `cellCost`
- `pk`
- `salvo`
- `target`
- `defenseLayer`
- `preferredMinRangeM`, `preferredMaxRangeM`
- `interceptorsPerThreat`
- `magazineReserveRatio`
- `launchIntervalS`
- `salvoSpacingS`
- `ringStyle`
- `maxTurnRateDps` (airframe turn-rate limit for the guidance law, deg/s)
- `seekerRangeM` (range at which the onboard seeker takes the terminal lock)
- `guidance` (`command_inertial` for datalink/mid-course interceptors, `inertial_active` for strike)
- `retargetable` [legacy, currently false], `selfDestructOnLoss` (target-loss policy defaults)

Radar detection is not generic across all missiles. The simulation derives a per-missile
detection envelope from an approximate flight profile: higher-flying air-defense
missiles such as `SM-6` are visible much earlier, while very low-altitude cruise
weapons such as `TomahawkBlockV` stay horizon-limited and appear at shorter ranges.

`cellCost` supports quad-packed missiles. For example, ESSM uses `0.25` cells.

`category` is currently `anti_ship`, `anti_air`, or `dual_role`. Each launched missile stores an immutable `launchRole`; anti-ship launches render as squares and anti-air launches as triangles. An SM-6 therefore receives its symbol from its launch role rather than a separate dual-role diamond. `shortLabel` is the tactical map label, such as `SM2`, `SM6`, `ESSM`, `MSTK`, or `TLAM`.

`launchIntervalS` is the minimum interval between actual launches from a ship for that missile type. `salvoSpacingS` controls how a queued salvo is released over time so multiple missiles do not spawn at the same map coordinate.

`defenseLayer` and the preferred range fields drive the public-source-informed fire planner: SM-2 and SM-6 are area-defense layers, ESSM is the point-defense layer, CIWS is represented by ship state, and strike weapons use reserve ratios to avoid emptying magazines too casually.

## Launch Order

Important fields:

- `missileId`
- `targetId`
- `targetSide`
- `targetClassification`
- `targetX`, `targetY`
- `requestedAt`
- `readyAt`
- `launchSequence`

Ships queue launch orders. Each order carries a `defensive` flag and `priority`; defensive missile orders are serviced ahead of offensive strike orders so an inbound raid is not trapped behind a pre-existing strike salvo. The launch scheduler releases one eligible order at a time, respecting missile-specific launch spacing plus separate offensive (`nextLaunchAt`) and defensive (`nextDefensiveLaunchAt`) ship cadence gates.

Offensive orders may also share a side-wide coordinated `readyAt` when the force
is conducting a raid. That lets multiple ships release as one tactical wave
instead of dribbling shots independently.

## Missile Instance

Important fields:

- `id`
- `side`
- `launcherId`
- `targetId`
- `missileId`
- `x`, `y`
- `heading`
- `speed`
- `maxRangeM`
- `targetX`, `targetY` (current commanded datum / lead point, used for rendering)
- `aimX`, `aimY` (computed velocity-lead intercept point)
- `controllerSide`, `guidance`
- `retargetable` [legacy, currently false], `targetLost`
- `losAngle`, `losRate` (line-of-sight state for the proportional-navigation law)
- `phase`
- `terminal`
- `terminalReason`
- `seaSkimming`
- `timeToImpactEstimate`
- `assignedDefenders`
- `threatScore`
- `launchSequence`
- `laneOffset`

`phase`, `terminal`, `terminalReason`, `seaSkimming`, and `timeToImpactEstimate` support layered defense decisions and UI explanation. `assignedDefenders` and `threatScore` support force-level defensive fire allocation. `launchSequence` and `laneOffset` make salvos visually distinguishable on the map.

Guidance is a velocity-lead law, not pursuit of the bare target position. Each
tick the weapon solves a closed-form intercept (`interceptPoint`) against the
target's estimated velocity and steers toward that lead point within its
airframe turn limit (`maxTurnRateDps`). Anti-ship weapons fly mid-course on the
controlling force's cooperative (CEC) datalink track and switch to the true
target only inside `seekerRangeM` (terminal seeker lock). When a target is
destroyed in flight, the weapon executes a commanded mid-course abort /
self-destruct (`selfDestructOnTargetLoss`) — it never coasts on a dead datum.
There is no retargeting or hand-off to a replacement contact in the current
simulation.

## Scenario

Important fields:

- `mode`: `setup`, `running`, or `ended`
- `paused`
- `ended`
- `mapId` (`openSea` or `eastChinaSea`)
- `ships`
- `missiles`
- `events`
- `nextFirePlanAt`
- `nextForcePictureAt`

New scenarios begin in `setup`. The app's default scenario now loads the supplied 4v4 East China Sea template, while the lower-level `createScenario` helper remains available for compact setup tests and custom starts. The simulation-core default map is `openSea`; the app selects the UI's current tactical map when creating or resetting a scenario. Setup mode allows adding units, dragging starting positions, right-click selection, box selection, and keyboard deletion. Placement is domain-aware: **sea units require water and fixed ground emplacements require land** (the terrain-less open-sea map accepts ground units anywhere). Dragging keeps the last valid position for the unit's domain, sea-unit duplication/restores normalize into open water while ground units stay on land, and setup-only map changes reseat the **sea** forces onto deterministic water starts while leaving fixed emplacements in place. The simulation can run only when at least one alive Blue and one alive Red unit exist.

## Visual Config

`VISUAL_CONFIG` centralizes compact tactical rendering constants used by the UI:

- `missileMinPx`, `missileMaxPx`
- `missileLabelPx`
- `shipLabelPx`
- `rangeLabelPx`
- `uiBasePx`
- `logPx`

These values keep missile squares/triangles and labels intentionally small. Weapon range rings are generated from `weaponRangeEntries(ship)`, which only includes nonzero loadout weapons.

## Track

Important fields:

- `id`
- `side`
- `classification`
- `x`, `y`
- `vx`, `vy`
- `quality`
- `uncertainty`
- `source`
- `age`
- `lastSeen`

Tracks are the decision input for hostile contacts. They are deliberately noisy and stale over time. Tracks that reference live missile ids (`M-*`) are pruned as soon as the missile is no longer alive, so an intercepted missile does not keep rendering as an extrapolated radar contact.

Each ship's `tracks` map contains only reports produced by that ship's own
sensor. Delayed CEC reports are stored once per side and contact in
`sim.sharedTracksBySide`. `tracksForShip()` overlays the receiver's local
reports on that shared map, while `trackForShip()` resolves one contact. Track
objects retain their last materialized state and timestamp; `currentTrack()`
projects position, quality, and uncertainty to `sim.time` without rewriting
every track on every tick. Serialization materializes these derived values so
save/restore remains plain JSON and deterministic.

## Doctrine

Important fields:

- `aggression`
- `standoffNm`
- `defensiveRangeNm`
- `conserveWeapons`

Doctrine is per ship. Both Red and Blue use the same decision engine.

## Cooperative Force Picture (CEC)

At most every 0.5 seconds, and immediately after new radar or CEC data,
`buildForcePicture(sim)` fuses every alive ship's local hostile track files into one
composite picture per side (`sim.forcePicture`). Reports of the same contact are
combined: position is a quality-weighted average across all reporting sensors,
velocity comes from the firmest report, and the fused quality is boosted above
any single radar (sensor-netting / track build-up). This composite, fire-control
grade track is what allows **engage-on-remote** — a ship can launch on a picture
built entirely by another unit's radar — and it feeds missile mid-course
datalink updates. This is the Cooperative Engagement Capability abstraction.
The 1.8-second delayed/degraded CEC layer is represented separately by
`sim.sharedTracksBySide`; it is shared by reference rather than duplicated into
each receiving ship's local map. Dirty contact ids permit immediate incremental
fusion between the scheduled full rebuilds.

## Fleet Command

`computeFleetCommand(sim)` runs once per planning cycle and, per side, names the
most air-defence-capable surviving unit the Officer in Tactical Command (`OTC`,
the formation guide), the next most capable the Anti-Air Warfare Commander
(`AAWC`), and the rest `UNIT`s. It then anchors a set of AAW sectors on the mean
threat axis and divides them among the units (`sectorCenter` / `sectorHalfWidth`),
so each ship owns a slice of sky, and assigns non-guide units formation
`station`s on a screen ring around the OTC. Sector ownership prioritises which
unit services a given inbound threat; formation stations drive station-keeping
movement when no close contact is being prosecuted.

The same planner now also stores a side-wide `commandState` with `aggression`,
`rawAggression`, `advantage`, `ownOffense`, `ownVls`, `ownPower`,
`enemyOffenseEstimate`, `enemyVlsEstimate`, `enemyPower`, `missilePressure`,
`observedTargets`, `mode`, `targetBreadth`, and `raidDepth`. Those values are
derived from the side’s own inventory plus only its observed enemy force
picture; hidden enemy loadouts are not read directly. `mode` is a persistent
fleet strike state (`survive`, `focus`, `pressure`, `saturate`) selected with
hysteresis so the force does not oscillate unrealistically every planning tick.
Offensive fire planning then uses that posture to decide whether to run a broad
saturation attack or a narrow concentrated raid against the best-value observed
targets.

Defensive planning is related but separate: it chooses the best currently
available local or shared track for each hostile missile, so an inbound threat
can be serviced before the slower fused force picture fully catches up.

`nextForcePictureAt` is serialized with scenario state so the bounded refresh
cadence survives save/restore without an artificial immediate rebuild.

## Rules of Engagement (ROE)

Per ship, `roe` governs weapon release. `weaponState` is `free`, `tight`, or
`hold`: `hold` forbids offensive release entirely, `tight` additionally requires
a firmer identification (`tightMinQuality`) and a closer commit range
(`tightCommitRangeNm`), and `free` permits release on any positively identified
contact above `identifyThreshold`. Self-defence (defensive interceptors and
CIWS) is always authorised regardless of weapon state, matching real ROE where a
unit may always defend itself. `retargetAllowed` is legacy only and currently
false; `selfDestructOnTargetLoss` sets the in-flight target-loss policy;
`ciwsRelease` authorises the terminal gun.

---

## Ship Classes

Four naval hull classes are modelled, each with per-class physics, sensors, magazine capacity, damage resilience, and combat systems:

| Hull | Class | Prefix | VLS | Speed | Turn | DR | CIWS | AAW Channels |
|------|-------|--------|-----|-------|------|-----|------|-------------|
| DDG | Burke Flight IIA | DDG | 96 | 31kn | 2.6°/s | 2 | 1× Phalanx | 2/2/1 |
| CCG | Ticonderoga Cruiser | CG | 122 | 32.5kn | 2.2°/s | 3 | 2× Phalanx | 4/3/2 |
| BBG | Trump Arsenal Battleship | BBG | 288 | 24kn | 1.2°/s | 5 | 5× CIWS | 6/4/4 |
| FFG | Constellation Frigate | FFG | 32 | 26kn | 3.2°/s | 1 | 1× SeaRAM | 1/1/1 |

Three fixed ground emplacement classes share the same object shape but set `domain: "ground"`, `isFixed: true`, and zero speed. They are placed on land, never move, and carry an explicit type-specific magazine rather than a VLS-scaled loadout:

| Hull | Role | Prefix | Radar | Default loadout |
|------|------|--------|------:|-----------------|
| SAM | coastal surface-to-air battery | SAM | 160 nm | SM-2MR×32, SM-6×8, ESSM×16 |
| CDB | coastal anti-ship battery (OTH radar) | CDB | 250 nm | MaritimeStrike×32, TomahawkBlockV×8 |
| EWR | early-warning radar (no weapons) | EWR | 400 nm | — |

Key per-class fields on every ship object:
- `hull` — class key (`"DDG"`, `"CCG"`, `"BBG"`, `"FFG"`, `"SAM"`, `"CDB"`, `"EWR"`)
- `domain` / `isFixed` — `"ground"` + `true` for stationary land emplacements
- `vlsCells` — total VLS capacity; every missile draws from this one pool by its `cellCost`
- `damageResist` — whole-hit damage points before mission-kill
- `damageDegrade` — speed/manoeuvre penalty per damage point
- `turnRateFlank` — reduced turn rate at >75% flank speed
- `ciwsCount` / `ciwsBurstRounds` / `ciwsBurstS` / `ciwsCycleS` — per-class CIWS parameters
- `displacementT` / `draftM` — used for radar horizon and hit-chance size bonus

Ships spawn with a full default magazine for their hull class, with the loadout filling the available VLS cells at setup time.

## SM-6 Dual-Role Missile

`SM-6` (Standard Missile 6 ERAM) is a dual-role weapon:
- `category: "dual_role"`, `symbol: "diamond"`, `target: "dual"`
- 200 NM range, Mach 3.5 (1190 m/s), PK 0.55
- Can engage both missiles (area defence) and ships (anti-surface strike)
- At launch, `launchRole` is fixed to `anti_ship` or `anti_air`; guidance, hit resolution, summaries, and the square/triangle icon use that role for the missile's lifetime
- Used offensively only when magazine depth exceeds 12 rounds (reserve for AAW)

## Subsystem Damage

Every ship has a `subsystems` object with six fields initialised to `1.0`:
`{ radar, vls, propulsion, fireControl, ciws, cic }`

Each anti-ship hit degrades 2-3 randomly selected subsystems by 15-45%. Effects:
- **radar** — reduces track quality multiplier in `scanSensors`
- **propulsion** — reduces effective max speed in `moveShips`
- **vls** — tracked; no separate combat effect beyond magazine state
- **fireControl** — tracked; no separate combat effect beyond combat resolution inputs
- **ciws** — reduces CIWS PK in `pointDefense`
- **cic** — tracked; no separate combat effect beyond command and sensing state

## Missile Detection and Defense

`scanSensors(sim, dt)` detects hostile missiles on radar once they are close enough to be seen on the ship's own sensor picture. Those missile tracks are then shared through the normal force-picture pipeline and are the input to defensive launch planning. There is no passive ESM missile detection and no soft-kill defeat path; missile defense is kinetic only (missiles and CIWS).

## UI: Ship Detail Popup

`renderShipDetails()` — called every frame, renders compact detail cards for ships in `selectedIds`:
- Subsystem health bars (colour-coded: green >60%, amber 30-60%, red <30%)
- Effective speed accounting for propulsion damage
- CIWS ammo
- Positioned near the primary selected ship on screen
- Right-click+drag on ship → add to `selectedIds` (additive)
- Right-click blank space → clear `selectedIds`

## Scenario Defaults

Default starting distance reduced from 120 NM to 40 NM (20 NM each side of origin) so engagements begin within 1-2 minutes at 1× speed (seconds at default 8×).

All `loadout` counts are normalized to non-negative integers inside the
simulation layer. UI tables read those normalized values rather than raw
floating-point state.
