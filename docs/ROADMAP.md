# TomaHawk Current Status

## Current Capabilities

- Local tactical map with pan, zoom, grid, and coordinates.
- Default Blue/Red destroyers starting 40 NM apart for quick first contact at real ship speed.
- Setup mode with draggable starting positions, multi-ship placement, right-click/box selection, and keyboard deletion.
- Scrollable fleet missile inventory.
- Active radar toggle.
- Overlay filters for grid, tracks, radar rings, and weapons.
- Compact tactical UI pass.
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
- Velocity-lead missile guidance.
- Mid-course abort and self-destruct on target loss.
- Cooperative Engagement Capability: fused composite force track picture and engage-on-remote.
- Cooperative mid-course missile datalink guidance with terminal seeker lock.
- Explicit fleet command hierarchy (OTC / AAWC) with deterministic succession.
- AAW sector responsibility anchored on the threat axis.
- Formation doctrine with screen stations on the guide.
- Rules of engagement: weapon-control states, identification gate, target-loss policy.
- Known-seed end-to-end battle regression test.
- Event log and compact fleet inventory panel.
- CCG, BBG, and FFG ship classes alongside DDG.
- SM-6 dual-role missile support in offensive and defensive planning.
- Subsystem damage model across radar, VLS, propulsion, fire control, CIWS, and CIC.
- Radar horizon modeling and hostile missile radar detection.
- Ship detail popup with compact subsystem health cards.
- Pre-computed indexes for hot-path functions.
- Large-battle performance headroom with 8,300+ ticks/sec on a 4v4 seed.

## Current Defaults

- Default ship loadouts start full for the selected hull class.
- The event log supports 500 entries.
- The default starting distance is 40 NM for faster engagements.

## Notes

- The repository documents the current playable implementation only.
