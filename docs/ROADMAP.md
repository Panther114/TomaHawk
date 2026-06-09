# TIDES Roadmap

## Playable V1 Included Now

- Local tactical map with pan, zoom, grid, and coordinates.
- Default Blue/Red Burke-like destroyers starting 40 NM apart for faster first contact at real ship speed.
- Setup mode with draggable starting positions, multi-DDG placement, right-click/box selection, and keyboard deletion.
- Scrollable fleet missile inventory.
- Active radar toggle.
- Overlay filters for grid, tracks, radar rings, and weapons.
- Compact professional tactical UI pass.
- World-scaled ship and missile symbols.
- Missile category symbols and labels.
- All-ship low-alpha weapon engagement-zone range rings from loaded weapons.
- Paced salvo launch queue and launch cooldowns.
- Public-source-informed force fire planner for defensive and offensive missile allocation.
- Layered defense: SM-2/SM-6 area defense, ESSM point defense, terminal-only CIWS, ammo/cooldown, and saturation leakers.
- Combat focus strip and dense inventory/log readouts.
- Scenario save/load JSON.
- After-action JSON export.
- Copyable timestamped battle log.
- Imperfect tracks with quality, age, and uncertainty.
- Autonomous two-sided doctrine.
- Anti-surface missile launches, missile flight, point defense, hits, misses, and mission kill.
- Realistic ship kinematics (true 1x speed, cruise/flank, accel/decel, turn rate).
- Velocity-lead (proportional-navigation-style) missile guidance.
- Mid-course abort and self-destruct on target loss.
- Cooperative Engagement Capability: fused composite force track picture and engage-on-remote.
- Cooperative mid-course missile datalink guidance with terminal seeker lock.
- Explicit fleet command hierarchy (OTC / AAWC) with deterministic succession.
- AAW sector responsibility anchored on the threat axis.
- Formation doctrine with screen stations on the guide.
- Rules of engagement: weapon-control states, identification gate, target-loss policy.
- Known-seed end-to-end battle regression test.
- Event log and compact fleet inventory panel.

## Next Simulation Upgrades

- Add more radar modes: sector scan and emission control.
- Add improved missile detection geometry, track confidence, and cooperative defense timing.
- Add terrain/coastline, bathymetry placeholders, and restricted operating areas.
- Extend the datalink model with explicit topology, link latency, and link loss (current CEC fusion is idealized/instantaneous).
- Editable ROE and weapon-control presets per side from the UI.
- Add richer scenario metadata, multiple starting templates, and replay timeline scrubbing.

## Next UI Upgrades

- Add more DCS-style map filters for own units, contacts, missiles, sensor rings, and uncertainty overlays.
- Add editable doctrine presets.
- Add keyboard shortcuts for pause, step, selection modes, and zoom-to-unit.
- Add scalable icon set for more ship classes and aircraft later.

---

## v0.2 Completed

### Ship Classes
- [x] CCG (Ticonderoga-class cruiser): 122 VLS, 32.5kn, 3.8 DR, 2× CIWS, premium AEGIS
- [x] BBG (Trump-class arsenal battleship): 288 VLS, 24kn, 8.0 DR, 5× CIWS, massive magazine
- [x] FFG (Constellation-class frigate): 32 VLS, 26kn, 2.2 DR, agile but fragile
- [x] Ship class selector dropdown in UI (DDG/CCG/BBG/FFG)
- [x] Per-class: kinematics, sensors, magazine, CIWS, defence channels, damage resilience

### Weapons
- [x] SM-6 dual-role missile (200 NM, Mach 3.5, PK 0.55, diamond symbol)
- [x] SM-6 integrated into offensive and defensive fire planners
- [x] Dual-role target resolution (anti-ship terminal vs intercept endgame)
- [x] Inventory shows SM-6 column

### Damage & Defence
- [x] Subsystem damage model: 6 subsystems (radar/VLS/propulsion/fireControl/CIWS/CIC)
- [x] Subsystem degradation from hits: 2-3 systems per hit, 15-45% each
- [x] Radar damage → reduced track quality; propulsion damage → reduced speed
- [x] CIWS PK refined: base 0.45 × saturation ratio with sea-skimmer/supersonic/damage penalties
- [x] Interceptor PK refined: supersonic penalty, sea-skimming penalty, defence saturation

### Sensors & CEC
- [x] Radar horizon: 4/3 Earth-radius model with soft falloff
- [x] CEC latency: 1.8s propagation delay with quality degradation
- [x] Hostile missile radar detection at close range

### UI
- [x] Ship detail popup: right-click+drag shows compact subsystem health cards
- [x] Additive selection: multiple ships can have detail cards simultaneously
- [x] Right-click blank space clears all detail cards
- [x] Inventory panel HP column with amber damage indication
- [x] Map labels show hull type (DDG/CCG/BBG/FFG)
- [x] Inventory SHIP column shows hull type first

### Performance
- [x] Pre-computed missile/ship indexes for hot-path functions
- [x] 8,300+ ticks/sec on 4v4 with 150+ missiles (~555× headroom at 60fps)
- [x] Event log expanded to 500 entries
- [x] Default starting distance 40 NM (was 120 NM) for faster engagements

## Next Upgrades (priority order)

- [ ] Electronic warfare: directional jamming, burn-through range, ECCM
- [ ] Terrain/coastline, bathymetry placeholders, restricted operating areas
- [ ] LRASM stealth ASCM, NSM, Harpoon, SM-3 exo-atmospheric
- [ ] Submarine and ASW layer (torpedoes, sonar, depth charges)
- [ ] Aircraft: maritime patrol, strike fighters, AEW&C
- [ ] Weather/sea-state effects on sensors, movement, and missile flight
- [ ] Replay timeline scrubbing
- [ ] Editable ROE and doctrine presets from the UI
- [ ] Spatial indexing for very-large scenarios (50+ ships)
