# TIDES Data Model

The current implementation keeps data as plain JavaScript objects in `src/sim.js`. These objects are intentionally shaped so they can later move to JSON, TOML, or a Rust data layer without changing the game design.

## Ship

Important fields:

- `id`, `name`, `side`, `className`
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
- `waypoint`
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
weapons such as `TomahawkBlockV` stay horizon-limited and appear later.

`cellCost` supports quad-packed missiles. For example, ESSM uses `0.25` cells.

`category` is currently `anti_ship`, `anti_air`, or `dual_role`. Rendering maps anti-ship missiles to square symbols, anti-air missiles to triangle symbols, and SM-6 dual-role missiles to diamond symbols. `shortLabel` is the tactical map label, such as `SM2`, `SM6`, `ESSM`, `MSTK`, or `TLAM`.

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
- `ships`
- `missiles`
- `events`
- `nextFirePlanAt`

New scenarios begin in `setup`. The default Blue and Red destroyers start 40 NM apart, 20 NM on each side of the origin, so engagements begin quickly while ship movement remains at real 1x speed. Setup mode allows adding ships, dragging starting positions, right-click selection, box selection, and keyboard deletion. The simulation can run only when at least one alive Blue and one alive Red ship exist.

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

## Doctrine

Important fields:

- `aggression`
- `standoffNm`
- `defensiveRangeNm`
- `conserveWeapons`

Doctrine is per ship. Both Red and Blue use the same decision engine.

## Cooperative Force Picture (CEC)

Each tick, `buildForcePicture(sim)` fuses every alive ship's track files into one
composite picture per side (`sim.forcePicture`). Reports of the same contact are
combined: position is a quality-weighted average across all reporting sensors,
velocity comes from the firmest report, and the fused quality is boosted above
any single radar (sensor-netting / track build-up). This composite, fire-control
grade track is what allows **engage-on-remote** — a ship can launch on a picture
built entirely by another unit's radar — and it feeds missile mid-course
datalink updates. This is the Cooperative Engagement Capability abstraction.

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

## Ship Classes (v0.2+)

Four ship classes are modelled, each with per-class physics, sensors, magazine capacity, damage resilience, and combat systems:

| Hull | Class | Prefix | VLS | Speed | Turn | DR | CIWS | AAW Channels |
|------|-------|--------|-----|-------|------|-----|------|-------------|
| DDG | Burke Flight IIA | DDG | 96 | 31kn | 2.6°/s | 2 | 1× Phalanx | 2/2/1 |
| CCG | Ticonderoga Cruiser | CG | 122 | 32.5kn | 2.2°/s | 3 | 2× Phalanx | 4/3/2 |
| BBG | Trump Arsenal Battleship | BBG | 288 | 24kn | 1.2°/s | 5 | 5× CIWS | 6/4/4 |
| FFG | Constellation Frigate | FFG | 32 | 26kn | 3.2°/s | 1 | 1× SeaRAM | 1/1/1 |

Key per-class fields on every ship object:
- `hull` — class key (`"DDG"`, `"CCG"`, `"BBG"`, `"FFG"`)
- `vlsCells` / `vlsStrikeCells` — total and strike-length VLS capacity
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
- At launch, target type is determined at runtime — SM-6 against a ship flies an anti-surface terminal profile; against a missile flies an intercept profile
- Used offensively only when magazine depth exceeds 12 rounds (reserve for AAW)

## Subsystem Damage

Every ship has a `subsystems` object with six fields initialised to `1.0`:
`{ radar, vls, propulsion, fireControl, ciws, cic }`

Each anti-ship hit degrades 2-3 randomly selected subsystems by 15-45%. Effects:
- **radar** — reduces track quality multiplier in `scanSensors`
- **propulsion** — reduces effective max speed in `moveShips`
- **vls** — (tracked, combat effect reserved for future)
- **fireControl** — (tracked, combat effect reserved for future)
- **ciws** — reduces CIWS PK in `pointDefense`
- **cic** — (tracked, combat effect reserved for future)

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
