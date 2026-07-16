# TomaHawk Data Model

The current implementation keeps data as plain JavaScript objects defined across the `src/sim/` modules (ship shape in `src/sim/ships.js`, missile catalogue in `src/sim/missiles.js`, scenario/track shapes in `src/sim/scenario.js` and `src/sim/sensors.js`). These objects are intentionally shaped for straightforward JSON persistence without changing the game design.

## Ship

Important fields:

- `id`, `name`, `side`, `className`, `hull`
- `domain` (`"sea"`, `"ground"`, or `"air"`) and `isFixed` (true for stationary ground emplacements)
- `isAirfield` (rearm/refuel node — ground `AFB` or naval `CVN`), `isCarrier` (sea airfield)
- `carrierCapable` / `lowObservable` / `commandHub` / `strikeSpecialist` (air and workshop flags)
- `x`, `y`, `heading`, `speed`, `desiredSpeed`
- `altitudeM`, `targetAltitudeM` (air units; physical altitude for horizon/drag, not a map axis)
- `cruiseSpeed`, `maxSpeed`, `accel`, `decel`, `turnRate`
- `radarRangeM`, `radarInterval`, `radarActive`
- `rcsM2` (optional class override; else domain/displacement default)
- `editable`
- `loadout`
- air lifecycle when `domain === "air"`: `airState` (`mission` / `rtb` / `rearming`), `fuelS`, `flares`, `homeBaseId`, `enduranceS`, `rearmTimeS` (HP pool = `damageResist` plane count)
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
- `launchers` (`sea` / `ground` / `air`)
- `targets` (`missile` / `air` / `sea` / `ground`)
- `rcsM2` (munitions RCS for radar pickup scaling)
- `symbol`
- `rangeM`
- `speedMps`
- `cellCost`
- `pk`
- `salvo`
- `target` [legacy compatibility]
- `preferredMinRangeM`, `preferredMaxRangeM`
- `interceptorsPerThreat`
- `magazineReserveRatio`
- `launchIntervalS`
- `salvoSpacingS`
- `ringStyle`
- `maxTurnRateDps` (airframe turn-rate limit for the guidance law, deg/s)
- `seekerRangeM` (range at which the onboard seeker takes the terminal lock)
- `cruiseAltitudeM`, `terminalAltitudeM`, `terminalSeaSkimming`
- `terminalProfile` (`"hypersonic_glide"` for LRHW-class), `strategic` (raid overflow quota)
- `hypersonicOnly` / `engageProfile: "high_energy_only"` (THAAD-class: only engage high-energy threats)
- `guidance` (`command_inertial` / `command_inertial_active` for interceptors, `inertial_active` for strike)
- `retargetable` [legacy, currently false], `selfDestructOnLoss` (target-loss policy defaults)
- air-to-air: `nezFraction` (no-escape-zone fraction of max range)

Radar detection is not generic across all missiles. The simulation derives a per-missile
detection envelope from an approximate flight profile: higher-flying air-defense
missiles such as `SM-6` are visible much earlier, while very low-altitude cruise
weapons such as `TomahawkBlockV` stay horizon-limited and appear at shorter ranges.

`cellCost` supports quad-packed missiles. For example, ESSM uses `0.25` cells.

`launchers` (`sea`, `ground`, `air`) and `targets` (`missile`, `air`, `sea`, `ground`) are the primary capability model. Legacy custom ammo using `category`, `platforms`, or `target` is still accepted and normalized into those arrays. Each launched missile stores an immutable `launchRole`; anti-surface launches render as squares and anti-air launches render as triangles. `shortLabel` is the tactical map label, such as `SM2`, `SM6`, `ESSM`, `MSTK`, or `TLAM`.

`launchIntervalS` is the minimum interval between actual launches from a ship for that missile type. `salvoSpacingS` controls how a queued salvo is released over time so multiple missiles do not spawn at the same map coordinate.

Preferred ranges, launcher/target capabilities, magazine reserve, and threat timing drive the fire planner. SM-2/SM-6 remain longer-range choices and ESSM remains a closer-range choice through weapon stats, not through a separate area/point defense-layer field. CIWS is represented by ship state.

## Launch Order

Important fields:

- `missileId`
- `targetId`
- `targetSide`
- `targetClassification`
- `targetX`, `targetY`
- `targetTrackQuality`, `targetTrackAgeS`
- `requestedAt`
- `readyAt`
- `launchSequence`

Ships queue launch orders. Each order carries a `defensive` flag and `priority`; defensive missile orders are serviced ahead of offensive strike orders so an inbound raid is not trapped behind a pre-existing strike salvo. Defensive orders also retain the track quality and age used at assignment time, so interceptor PK can account for stale or weak cueing after launch. The launch scheduler releases one eligible order at a time, respecting missile-specific launch spacing plus separate offensive (`nextLaunchAt`) and defensive (`nextDefensiveLaunchAt`) ship cadence gates.

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
- `trackQualityAtLaunch`, `trackAgeAtLaunchS`
- `launchSequence`
- `laneOffset`

`phase`, `terminal`, `terminalReason`, `seaSkimming`, and `timeToImpactEstimate` support layered defense decisions and UI explanation. `assignedDefenders` and `threatScore` support force-level defensive fire allocation. `trackQualityAtLaunch` and `trackAgeAtLaunchS` let interceptor PK reflect cue quality. `launchSequence` and `laneOffset` make salvos visually distinguishable on the map.

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
- `ended` — `null` while live; winning side string (`"BLUE"` / `"RED"`) on wipeout; `"draw"` on mutual magazine exhaustion (see `stepSim`)
- `mapId` (`openSea` or `eastChinaSea`)
- `ships`
- `missiles`
- `events`
- `nextFirePlanAt`
- `nextForcePictureAt`

New scenarios begin in `setup`. The app's default scenario is an empty East China Sea setup, centred on the tactical-map coordinate 13,900 km east and 3,600 km south. The lower-level `createScenario` helper remains available for compact 1v1 setup tests and custom starts. The simulation-core default map is `openSea`; the app selects the UI's current tactical map when creating or resetting a scenario. Setup mode allows adding units, dragging starting positions, right-click selection, box selection, and keyboard deletion. Placement is domain-aware: **sea units require water**; **fixed ground emplacements require land** except **airfields** (`isAirfield` ground units / `AFB`) which may sit on land or water; **carriers** are sea units and stay on water. Dragging keeps the last valid position for the unit's domain, sea-unit duplication/restores normalize into open water while fixed ground units stay on land, and setup-only map changes reseat the **sea** forces onto deterministic water starts while leaving fixed emplacements in place. The simulation can run only when at least one alive Blue and one alive Red unit exist. Imported scenarios are capped at 200 ships, 5,000 missiles, and 500 events; browser-file imports are limited to 5 MB.

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
picture; hidden enemy loadouts are not read directly. `ownOffense` is
`offensiveMissileCount` over every alive unit — all surface-capable munitions
still aboard (MSTK, TLAM, Dark Eagle, AGM-84/154, and dual-role SM-6 when
included), not only naval ASCMs. Peer fights open near half-aggression; an
empty force picture pulls advantage toward neutral rather than inventing a
panic. `mode` is a persistent fleet strike state (`survive`, `focus`,
`pressure`, `saturate`) selected with hysteresis so the force does not
oscillate unrealistically every planning tick. Offensive fire planning then
uses that posture for two-pass allocation (strike specialists first, then
general shooters), optional dual target breadth at healthy focus, and a small
strategic overflow for hypersonic / very-long-range weapons.

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

Live catalogues live in `src/sim/ships.js` (`SHIP_CLASSES`) and are extended at
runtime by the Unit Workshop. Built-ins below match the code defaults.

### Naval (`domain: "sea"`, not fixed)

`defenseChannels` is `{ sam, ciws }` — one SAM engagement-channel pool plus CIWS
mount concurrency (legacy `area`/`point` fields are normalized into `sam` on load).

| Hull | Class | Prefix | VLS | Speed | Turn | DR | CIWS | `sam` / `ciws` |
|------|-------|--------|-----|-------|------|-----|------|----------------|
| DDG | Burke Flight IIA | DDG | 96 | 31 kn | 2.6°/s | 2 | 1 | 4 / 1 |
| CCG | Ticonderoga Cruiser | CG | 122 | 32.5 kn | 2.2°/s | 3 | 2 | 7 / 2 |
| BBG | Trump Arsenal Battleship | BBG | 288 | 24 kn | 1.2°/s | 5 | 5 | 10 / 4 |
| FFG | Constellation Frigate | FFG | 32 | 26 kn | 3.2°/s | 1 | 1 | 2 / 1 |
| CVN | Nimitz/Ford-class carrier approx. | CVN | 24 | 30 kn | 0.9°/s | 6 | 3 | 4 / 3 |

`CVN` sets `isAirfield: true`, `isCarrier: true`, `maxParkedSquadrons: 6`, and
defaults to `SM-2MR`×8 + `ESSM`×64. It is a **moving rearm deck**, not a fixed
ground site.

### Ground emplacements (`domain: "ground"`, `isFixed: true`, speed 0)

Placed on **land** (except airfields). Same object shape as ships; never move;
explicit type magazines via `baseLoadout`.

| Hull | Role | Prefix | Radar | Default loadout |
|------|------|--------|------:|-----------------|
| SAM | coastal surface-to-air battery | SAM | 160 nm | SM-2MR×32, SM-6×8, ESSM×16 |
| THAAD | hypersonic / BM defense only | THAAD | 500 nm | THAAD×48 |
| CDB | coastal strike battery (OTH radar) | Coast Strike | 250 nm | MaritimeStrike×32, TomahawkBlockV×8 |
| DEB | Dark Eagle hypersonic strike battery | Dark Eagle | 500 nm | DarkEagle×8 |
| EWR | early-warning radar (no weapons) | EW Radar | 400 nm | — |
| AFB | airfield / rearm-refuel node | Airfield | 180 nm | — |

`AFB`: `isAirfield: true`, `maxParkedSquadrons: 12`, placeable on land **or**
water. `THAAD` fires only the `THAAD` interceptor (`hypersonicOnly` /
`engageProfile: "high_energy_only"`) — cruise missiles and aircraft are ignored.

### Air squadrons (`domain: "air"`)

One entity per flight; `damageResist` is the plane count (each hit downs one
aircraft). Placeable anywhere; overfly terrain; rearm at a friendly airfield.
Displayed names are real-airframe approximations (F-22, F-35A, …); internal hull
ids remain `F22`, `F35A`, etc. Hardpoint budgets (`vlsCells`) follow each
airframe’s rigid default loadout — they are **not** a single generation-wide
constant.

| Hull | Role | Prefix | Radar | HP | Hardpoints | Default loadout | Carrier |
|------|------|--------|------:|---:|-----------:|-----------------|:-------:|
| F22 | F-22 Raptor approx. (A2A, LO) | F22 | 130 nm | 4 | 8 | AIM-120D×6, AIM-9X×2 | no |
| F35A | F-35A Lightning II approx. (anti-ground, LO) | F35A | 120 nm | 4 | 8 | AIM-120D×2, AIM-9X×2, AGM-154×4 | no |
| F35C | F-35C Lightning II approx. (anti-ship, LO) | F35C | 120 nm | 4 | 8 | AIM-120D×2, AIM-9X×2, AGM-84×4 | yes |
| F15E | F-15E Strike Eagle approx. (anti-ground) | F15E | 95 nm | 4 | 16 | AIM-120C×4, AIM-9X×2, AGM-154×10 | no |
| F15N | F-15 Sea Strike approx. (fictional anti-ship) | F15N | 95 nm | 4 | 16 | AIM-120C×4, AIM-9X×2, AGM-84×10 | yes |
| F15C | F-15C Eagle approx. (A2A) | F15C | 100 nm | 4 | 14 | AIM-120C×10, AIM-9X×4 | no |
| F15EX | F-15EX Eagle II approx. (multirole) | F15EX | 115 nm | 4 | 18 | AIM-120D×8, AIM-9X×2, AGM-154×4, AGM-84×4 | no |
| F16V | F-16V Viper approx. (light multirole) | F16V | 85 nm | 4 | 10 | AIM-120C×4, AIM-9X×2, AGM-154×4 | no |
| AWAC | E-2D Hawkeye approx. (AEW&C, unarmed hub) | AWAC | 350 nm | 1 | 0 | — | yes |

**Carrier basing:** any unit with `isAirfield: true` is a rearm node. Ground
AFBs accept every squadron. Sea carriers (`CVN`, or any naval Workshop hull with
**Carrier deck**) only recover airframes with `carrierCapable: true`. While
`airState === "rearming"`, the squadron is pinned to the base position each
movement tick (a steaming CVN carries parked flights). `maxParkedSquadrons`
caps concurrent deck slots; overflow flights hold a pattern nearby.

Fighter endurance is combat radius with return reserve (not ferry range): roughly
600 nm class for the 5th-gen set and ~680 nm class for the heavy 4.5-gen set
(exact `enduranceS` values live on each class).

Key per-class fields:
- `hull` — class key (`DDG`…`FFG`, `CVN`, `SAM`, `THAAD`, `CDB`, `DEB`, `EWR`,
  `AFB`, `F22`…`F16V`, `AWAC`, plus Workshop ids)
- `domain` / `isFixed` / `isAirfield` / `isCarrier`
- `vlsCells` — magazine / hardpoint pool; every munition draws by `cellCost`
- `damageResist` / `damageDegrade`
- `turnRateFlank` — naval hulls only at >75% flank; aircraft use `maxGLoad` for
  combat turns (see `aircraftTurnRateRadPerS` in `movement.js`)
- `commandHub` — while alive and on-mission, tightens side CEC latency
- `lowObservable` — LO stand-in strike release profile (vanilla F-35 family)
- `carrierCapable` — may recover on a sea airfield
- `maxParkedSquadrons` — concurrent rearm slots on an airfield
- `ciwsCount` / burst / cycle parameters
- `displacementT` / `draftM` / `rcsM2` — size, horizon, and detection scaling
  (air uses `altitudeM` for horizon — see `docs/SIMULATION_ASSUMPTIONS.md`)

Ships spawn with a full default magazine for their hull class.

Surface-strike ammo declares `targets: ["sea", "ground"]`. Legacy custom ammo
using `category: "anti_ship"` / `target: "ship"` is interpreted the same way.
`DarkEagle` is ground-launched surface strike only. `THAAD` is ground-launched
missile defense only and refuses non-hypersonic targets in
`chooseDefensiveWeapon`.

## SM-6 Dual-Role Missile

`SM-6` (Standard Missile 6 ERAM) is a dual-role weapon:
- `launchers: ["sea", "ground"]`, `targets: ["missile", "air", "sea", "ground"]`
- 200 NM range, Mach 3.5 (1190 m/s), PK 0.74
- Can engage missiles, aircraft, ships, and fixed ground units
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
