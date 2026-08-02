# Changelog

All notable changes to this repository will be documented in this file.

## v1.0.0 — 2026-07-28

### Release summary

- **Tomahawk product transition.** The user-facing product is now **战斧 Tomahawk v1.0**. The app is Simplified-Chinese-first with no language switch; military designations such as DDG, F-22, THAAD and Tomahawk Block V remain where they improve precision.
- **Experience release.** A full-screen equipment library, continuous placement preview, compact battle overview, contextual force drawer, layer controls, playback bar, tools drawer, first-run tour, one-screen landing page and a dedicated responsive guide replace the old mechanical control shell.
- **Complete post-v0.3 simulation delta.** This release also includes every change accumulated since v0.3: carrier basing, THAAD, expanded player aircraft, submarine and electronic warfare, RCS/detection and movement accuracy work, fire-planning fixes, Unit Workshop upgrades, persistence hardening, performance work and the regression fixes detailed below.

### Added — Interface, landing page, symbols and tutorial

- Added `/`, `/sandbox` and `/guide` routes: a cinematic one-screen landing page, the desktop tactical sandbox, and a mobile-readable Chinese player guide.
- Replaced the class dropdown with a searchable, categorized equipment library covering all 22 built-in units and deterministic custom-unit fallbacks.
- Added continuous deployment with affiliation-colored cursor symbols, terrain-validity feedback, right-click/Escape cancellation and clear setup locking.
- Added a MIL-STD-2525E / APP-06-inspired controlled symbol subset using cached `Path2D` geometry. It distinguishes affiliation, domain and major function without claiming full standard compliance.
- Added a shared eight-step tutorial model and first-run guidance persisted under `dawnfall.tutorialDismissed`.

### Changed — Chinese layer, layout, branding and persistence

- Removed the English language state and switch. Dynamic UI and event display now use a centralized Simplified Chinese catalogue.
- Removed the visible tactical feed and About overlay while preserving internal events, debug capture and AAR export. AAR files now use `dawnfall-aar-*` and add `displayTextZh` without changing original event fields.
- Reorganized the sandbox around a large map viewport: mirrored force summaries at top, contextual right drawer, bottom-left layer controls, central playback controls and a compact tools drawer.
- Unit Workshop persistence moves to `dawnfall-mods`; a verified one-time migration copies legacy records before removing the old database. Debug entry points are now `dawnfall.debug` and `window.dawnfallMods`.
- Railway production uses a 64 MiB Node heap and streamed static delivery; simulation, rendering and user persistence remain client-side.

### Documentation

- Replaced the previous bilingual reference bundle with seven maintained English repository documents: `README.md`, `PLAYER_GUIDE.md`, `ARCHITECTURE.md`, `SIMULATION.md`, `MODDING.md`, `SOURCES.md` and `ROADMAP.md`. The in-app `/guide` page remains Simplified Chinese.
- Removed duplicate, stale, and historical demo design drafts; fixed documentation entry points.

### Added — THAAD hypersonic defense battery

- **THAAD ground battery** + **THAAD interceptor**: public-approx ~110 NM reach, ~Mach 8 class interceptor, high-altitude hit-to-kill profile. Magazine 48 (6×8 envelope). AN/TPY-2-class long search radar.
- **Hypersonic-only engagement:** interceptors carry `hypersonicOnly` / `engageProfile: high_energy_only` and fire planning never releases them against cruise missiles or aircraft — only `isHighEnergyThreat` (Mach 5+ / strategic / boost-glide). Better PK band vs LRHW than SM-6 (~40–55% ceiling after penalties).

### Added — Carrier basing (moving airfield)

- **CVN hull** (Nimitz/Ford approx.): sea-domain combatant with `isAirfield:true` — steams, fights, and serves as a rearm/refuel deck for friendly squadrons.
- **Carrier-capable airframes only** recover on CVN (`F-35C`, `AWAC`/E-2, fictional `F15N`); land-based types still need an AFB. Workshop exposes `carrierCapable` and naval **Carrier deck**.
- **Deck stick + lead recovery:** rearming flights ride the moving deck every tick; RTB aims at a lead intercept of the carrier, not its wake. Full decks (`maxParkedSquadrons`) put overflow flights in a holding pattern.

### Fixed / Added — Accuracy pass + player airframes

- **RCS floor no longer collapses LO fighters.** Detection floor 0.12 made F-22 and F-35 identical on radar; floor is now 0.05 with distinct LO RCS values.
- **Air-domain detection lift (O(1)).** Destroyer-referenced fourth-root alone painted non-stealth fighters only at knife-fight range (~38 NM), so track quality never cleared the 0.32 ID gate and SAMs never engaged. Air targets get a capped lift so F-15-class flights paint at ~90 NM while LO stays much shorter.
- **Domain-aware track classification.** Low-quality air/ground tracks no longer read as "surface combatant" (which inflated enemy offense with DDG priors).
- **Air-launched weapons inherit launch altitude** and blend toward cruise profile over ~8 NM (no more Harpoon teleporting to 30 m sea-skim on the launch tick).
- **LO stand-in doctrine is flag-based** (`lowObservable`), not hard-coded to F-35C + Harpoon — F-35A JSOW uses the same low-release gate.
- **Player airframes with public-approx data:** F-22, F-35A, F-35C, F-15C, F-15E, F-15N (role sibling), **F-15EX**, **F-16V** — real class names, differentiated speeds/RCS/radar/loadouts; tags stay alphanumeric (no `-` in prefix, so inventory id split stays correct).

### Fixed — Fire planning, aircraft doctrine, peer aggression, and lag

- **Realistic hypersonic intercept difficulty (perf-safe).** SAM/CIWS hit chance against high-energy threats was only a flat −0.28 speed step, so SM-6 vs Dark Eagle still landed near ~50% single-shot PK. Intercepts now use an O(1) model: continuous Mach kinematic penalty, boost-glide/strategic profile + altitude, interceptor-layer match (ESSM/CIWS collapse; SM-6-class least-bad with a hard ~30% ceiling), plus existing track/saturation terms. Defensive planning prioritises hypersonic threats, commits multi-shot depth, and prefers SM-6 over ESSM. Custom Workshop `strategic` / hypersonic-glide ammo uses the same path.
- **Dark Eagle / specialist starvation.** Force offensive planning used a single target slot filled by the nearest destroyers’ ASCMs, so DEB (and often CDB/air strike) magazines never received an allocation in multi-shooter fights even though isolated DEB tests passed. Specialists now get a first allocation pass; hypersonic / very-long-range weapons may use a small strategic overflow after the general raid cap is full; domain-specialist target slots keep ground-only and sea-only magazines usable.
- **Unit Workshop support for specialist / strategic fire planning.** Ammo records expose **Strategic / deep-strike**, **flight profile** (hypersonic glide), and cruise/terminal altitudes; naval/ground/aircraft expose **Strike specialist**. Custom LRHW-class munitions and arsenal-ship / coastal-battery hulls register into the same planning path as vanilla DEB/Dark Eagle (round-trip via `toInternalSpec` / `vanillaUnits`).
- **Aircraft locked unfireable domains.** JSOW-only flights vectored onto ships and Harpoon-only flights onto SAMs, then “released” forever with full magazines. Surface locks are weapon-domain-filtered; stand-off range uses fireable weapons only; on-station starts with a short nose-on release geometry before beam weave.
- **CAP / path wobble.** Threat axis mean included missile tracks (raid thrash) and CAP stations rewrote every decision tick. Axis is unit-tracks-only; CAP/support stations use a waypoint deadband.
- **Peer-fight aggression floor.** Own offense counted only MSTK/TLAM/SM-6 while enemy priors already weighted DEB×2 and air — near-equal mixed fights opened in `survive` (aggr ~0.09). Own strike depth now counts all surface munitions; parity baseline ~0.50 with light pressure penalty and fog-of-war pull only when the picture is empty/thin; focus mode can take two surface targets at healthy aggression.
- **Frame lag spikes.** Browser catch-up could force several heavy sim ticks into one animation frame under large raids. Sim work is budgeted per frame (carry debt); debug perf/battle logging is opt-in (`?debug=1` or `localStorage dawnfall.debug=1`).
- Added `tests/ai-doctrine-fixes.test.mjs` and `scripts/validate-ai-fixes.mjs`.

### Added — RCS unification + Unit Workshop exposure

- **Every missile now has a real radar cross-section.** Detection used to rely on a hand-tuned "visibilityFactor" magic number per weapon with no relationship to any actual RCS value; every missile in the catalogue now carries a public-source-approximate `rcsM2` (a tiny WVR dogfight round through a larger long-range cruise missile), and a radar's pickup chance scales the same fourth-root radar-range-equation way already used for ships/aircraft — referenced to the largest vanilla munition rather than a destroyer, since every weapon is 3-4 orders of magnitude smaller than even a stealth fighter. Altitude/profile (sea-skim vs. lofted) remains a separate, legitimate factor on top.
- **RCS is now editable in the Unit Workshop.** Real bug: RCS was fully implemented in the sim engine but completely invisible in the Workshop — every custom/cloned naval, ground, or aircraft unit silently got an auto-computed default with no way to see or override it. Every unit type (naval/ground/aircraft/ammo) now exposes `rcsM2` as a plain field, round-tripping the exact value the sim uses (vanilla hulls without an explicit value show the same domain/displacement-derived default the engine itself falls back to).

### Changed — Aircraft naming + hardpoint polish

- **Concise unit tags and class names, replacing the real-airframe-name-plus-parenthetical style** ("F-22 Raptor Squadron (5th-gen air-superiority) approx." → tag `G5AA`, name "5th Gen Air Supremacy"). Tags follow a Generation × Role scheme: `G5`/`G4` × `AA` (air-superiority) / `AG` (anti-ground, matching this project's own `AGM-`-prefixed weapon naming) / `AS` (anti-ship). Internal hull ids (`F22`, `F35A`, etc.) are unchanged — only the displayed tag/name changed, in both the Unit Workshop list and live gameplay (Force Inventory, ship detail card, and the placement dropdown all read the same updated label).
- **Uniform hardpoints per generation**: every 5th-gen hull now carries 8 hardpoints and every 4.5-gen hull 14 (a deliberate uniform gameplay number, not a claim about real internal-bay capacity — external-carriage RCS impact is a possible future refinement, not modeled now), with each loadout rebalanced to fill its cap exactly.

### Added — Movement & air-combat physics polish

- **Rough strategic bearing estimate for units with no radar contact.** Every unit now has a periodically-refreshed, deliberately imprecise sense of the enemy's general direction — representing real pre-contact battlespace awareness — instead of either a fixed compass heading (aircraft CAP fallback) or, for ships, literal RNG-jitter with no relationship to the enemy's actual position at all. Real fused tracks still take over the moment a side holds one.
- **Real bug fixed: missile evasion never dropped altitude.** Verified in code: the defensive-break branch changed heading but never touched `targetAltitudeM`. Real BVR/WVR doctrine pairs the beam/notch maneuver with a hard dive and afterburner; the flight now does all three together.
- **Afterburner**, modeled uniformly across every airframe (a property of the engine, not the generation): a speed/acceleration multiplier at a steep fuel-burn cost, engaged by the AI only for a defensive break or closing an air-to-air intercept — cruise/ingress/patrol/RTB still fly MIL power.
- **Aircraft energy state (GPE↔KE).** Altitude and airspeed were fully independent integrators with zero physical coupling; a diving aircraft now genuinely gains real airspeed from gravity and a climbing one genuinely loses it, on top of the existing thrust/drag and turn-bleed model — this is what makes the new defensive dive matter kinematically, not just visually.
- **Missile maneuver-induced energy bleed + terminal-dive speed bump.** A missile forced to pull a hard turn chasing an evading/notching target now genuinely bleeds speed doing it (most significant, and most consequential, in the terminal endgame) — the actual physical mechanism behind why notch/beam+dive defense works, previously modeled only as a PK-formula fudge factor with zero effect on the missile's own kinematics. A missile also gains a small, heavily-damped one-time speed bump at the exact tick it snaps into its terminal dive (GPE→KE, damped for a controlled guided descent rather than free-fall).

### Fixed — Unit Workshop ammo classification

- **Real bug: the Unit Workshop let any unit type equip any registered weapon**, including combinations that make no physical sense — most visibly, an aircraft squadron's loadout could accept `ESSM`, a ship/ground point-defense missile with no aircraft seeker or air-launch model behind it at all. The root cause: the old `anti_air` category was a single bucket shared by ship-launched SAMs (SM-2MR/ESSM) and aircraft-carried AAMs (AIM-120/AIM-9X), and nothing anywhere checked which platform type a weapon was actually built for.
- **Split `anti_air` into `ship_sam` and `air_to_air`**, and added an explicit, modder-editable **launch-platform field** (`Ship-launched` / `Ground-launched` / `Air-launched` checkboxes on every ammo record) that is the actual gate — independent of category, since e.g. `anti_ship` already legitimately spans a ship-launched round (`MaritimeStrike`) and an air-launched one (`AGM-84`). The Workshop's "add ammo" picker now only offers weapons compatible with the unit being edited, and `validateUnit` rejects an incompatible weapon in a hand-edited/imported loadout as defense-in-depth. Every vanilla weapon's platform list matches its existing real-world role (ship SAMs: sea+ground; AAMs and air-launched strike weapons: air only); custom ammo without the field keeps working everywhere it always did (unrestricted), so no existing mod is silently broken.

### Fixed — Air-to-air combat

- **Real bug: opposing flights could fly apart forever and never detect each other, no matter how close they were placed.** The fleet-command "threat axis" (which orients CAP/orbit stations before any radar contact is held) defaulted to a fixed compass heading — "BLUE's enemy is always east, RED's enemy is always west" — instead of the actual bearing to the opposing force. That default is only correct for the canonical default battle layout; any manual placement outside it (e.g. via the Unit Workshop, or a pure air-only fight with no surface OTC to anchor on) sent both flights screening *away* from each other. Since RCS-limited air-to-air radar only triggers within its own effective range, and the flights never closed that range, no detection — and no engagement — ever happened, even well inside AIM-9 range. Fixed by deriving the default threat axis from each side's actual whole-fleet position instead of a fixed heading, and by having the no-surface-OTC CAP fallback re-read that axis every decision tick (instead of committing to one straight leg and holding it forever).

### Changed — Air unit roster overhaul

- **Replaced the generic `VFA`/`VFS` pair with six fixed-identity squadron hulls** spanning two generations and three roles: 5th-gen low-observable `F22` (air-superiority only), `F35A` (anti-ground strike), `F35C` (anti-ship strike), and 4.5-gen non-stealth `F15E` (anti-ground strike), `F15N` (anti-ship strike, fictional), `F15C` (air-superiority only). Each hull's default loadout is now **rigid** — `vlsCells` is sized to exactly fit it — so a squadron spawns as, and stays, purpose-built rather than a generic multirole hardpoint budget.
- **Added `AGM-154` (JSOW)**, a dedicated air-launched stand-off anti-ground weapon with its own range/speed/detection profile, distinct from the anti-ship `AGM-84` (Harpoon). It reuses the existing anti-ship engagement pipeline (fixed ground emplacements were already valid targets for that category), so no new targeting logic was needed — only a genuinely separate weapon so anti-ground-loadout squadrons are no longer stuck repurposing an anti-ship missile against SAM/CDB/EWR sites.

### Added — AWAC command hub

- **New unarmed `AWAC` (E-2D Hawkeye-style AEW&C) squadron**: the longest-ranged mobile radar in the roster, never carries a weapon, and never screens ahead of the fleet — it orbits *behind* the formation guide, on the far side from the threat axis, at a generous stand-off. It still returns to a friendly airfield to refuel like any other squadron.
- **Generalized `commandHub` ship-class flag** (any hull can opt in via the Unit Workshop, not just the AWAC): while an alive, on-mission command-hub unit is present, its side's CEC track-sharing latency tightens from 1.8s to 0.6s, modelling a centralized high-bandwidth relay instead of every ship pair correlating tracks independently.

### Fixed — Aircraft AI

- **Target-lock "wobble."** Fighters holding a stale or momentarily-undetected track used to re-acquire a *different* nearest contact every few decision ticks instead of holding their lock, producing visibly indecisive heading changes. Locks now persist through brief detection dropouts (an 8s coast window on the last-known position) and the aim point is exponentially smoothed, instead of snapping to a fresh nearest-contact pick on every miss.
- **Air-to-air launches now require facing the target.** A launch cone (±100° of the launcher's heading) gates every aircraft-fired `anti_air`/`dual_role` shot; ship and ground VLS launches are unaffected (they already fire omnidirectionally, realistically).
- **Radar horizon ignored the observer's own altitude.** The 4/3-earth-radius horizon calculation only ever used the *target's* height, so a 9,000m-cruising fighter's look-down range against a sea-skimming missile was capped as if the fighter were sitting at sea level (~19NM) instead of the ~220NM its altitude actually affords. Now computed symmetrically for both sides of the detection pair.
- **A newly-discovered "winchester" RTB loop for any zero-loadout aircraft** (most consequentially, the new `AWAC`): a squadron built with an empty default loadout read as permanently "out of ammo," so it RTB'd on its very first decision tick, parked to rearm into the same empty magazine, and immediately RTB'd again — a park-forever loop that never let it fly its actual station-keeping mission. The "out of ammo" condition now only applies to squadrons that are designed to carry a weapon in the first place; a squadron with no weapons in its base loadout, by design, is never grounded for "winchester" (it still RTBs normally on low fuel).

### Fixed — UI

- **Chinese aircraft-class names now convey generation and role instead of a flavor nickname.** `F-22`/`F-35A`/`F-35C`/`F-15C`/`F-15E`/`F-15N` were labelled 猛禽/隐攻/隐舰/空鹰/攻鹰/舰鹰 in Chinese — evocative but uninformative next to their English names, which already read as generation+role. Relabeled to 5代空优/5代对地/5代反舰/4代空优/4代对地/4代反舰 (4.5-gen airframes rounded to "4代" for brevity). English names unchanged.
- **Force Inventory per-missile stock color now follows one universal, automatic rule** (independent missile columns, not the aggregate VLS column, which keeps its own separate rule): white above 67% of baseline, yellow from 33–67%, red below 33%, grey at zero — computed from each ship's actual starting loadout rather than a fixed hull-wide color.
- **Unit detail cards are now built per unit *type*** (naval / ground / air), not per individual hull, so a custom aircraft added through the Unit Workshop automatically gets an aircraft-shaped card (flight/fuel/altitude readouts, no VLS row) without any per-unit UI code.
- Overlapping same-type/same-faction weapon-range rings merged into one visual outline but still drew one label per underlying ring; a merged cluster now draws exactly one label (30% more transparent, 30% smaller than before) regardless of how many rings feed it.

### Fixed — Bug-fix pass

- **Air squadrons could be wrongly designated OTC.** When a side had no mobile surface unit (an all-air or all-fixed-remainder force), the fleet-command guide fell back to an air squadron and marked it `isOTC`, violating the "air is never OTC" invariant. OTC/AAWC roles are now surface-only (mobile surface preferred, fixed emplacement as last resort); an all-air side simply has no surface command tier, and the threat axis still derives from the best available unit.
- **Dead missile re-vector branch removed.** `handleTargetLoss` always deactivated the missile and returned `false`, so the `if (!handleTargetLoss(...))` re-resolution path in `updateMissiles` was unreachable. Simplified to the actual behaviour (no re-vectoring), so the code matches the documented intent.
- **`restoreScenario` could leave `selectedId` pointing at a missing ship.** A hand-edited or stale save no longer leaves a dangling selection; it snaps to a valid hull (or `null`).
- **Wrong first-load status text.** The status bar hardcoded "Default 4v4 scenario loaded" while the real default is an empty setup; it now shows an accurate `SETUP READY` mode chip (RUNNING / PAUSED / ENDED while in battle), and the dead `status.setup` string was removed.
- **Battle status bar was never localized.** `renderBattleStatus` / `postureBar` emitted hardcoded English (`HP`/`AS`/`AA`/`AGG`); the metric labels now follow the active language (耐久/反舰/防空/攻势 in Chinese).
- **Keyboard shortcuts leaked through focused dropdowns.** The global keydown guard only checked `HTMLInputElement`, so Space/R/Tab/Delete fired while a `<select>` was focused. It now also covers `HTMLSelectElement`, `HTMLTextAreaElement`, and contenteditable elements.
- **Tab stole keyboard focus navigation.** Tab now cycles units only when no control is focused (focus rests on the body/canvas); when a button or field is focused, Tab moves focus normally.
- **`confirmDialog` had no keyboard support and leaked sim shortcuts.** The modal now traps keyboard (Escape = cancel, Enter = confirm) and stops the global handler from toggling the sim behind it.
- **Reset left a `null` in the selection set.** Resetting to the empty default no longer produces `selectedIds = Set{ null }`.
- **Custom-location save had no error handling.** The File System Access path sat outside the `try/catch`; a thrown write no longer leaves the popup open and sim paused. Cancelling the OS file picker now keeps the Save form instead of discarding it, and a success status is shown.
- **Dead editable-ship handlers and CSS removed.** The `change`/`input` listeners for `#radar-toggle` / `[data-missile]` / `[data-doc]` (and the `setLoadout` import) referenced elements the removed doctrine panel left behind; the `.toggle` / `.loadout` / `#doctrine-tab` CSS rules were equally dead. All removed.
- **Unit Workshop preload could reject unhandled.** `modEditor.preload()` is now `.catch()`-guarded so a blocked IndexedDB context never crashes the app.
- **Mod save/delete mutated the live catalogue before persisting.** `saveMod` / `deleteMod` now persist first and register/unregister after, so a failed write never leaves a phantom unit live-but-unsaved (or gone-live-but-still-in-storage). `loadMods` is resilient: a blocked/broken IndexedDB falls back to vanilla-only instead of rejecting. Save/delete/import paths in the editor surface failures with a retry message instead of unhandled rejections.
- **Undocumented single-step key.** The `.` key (advance one tick) is now listed in the About overlay and the README/REFERENCE controls.

## v0.3.0 — 2026-06-30

### Release summary

- Third public release of the TomaHawk / 战斧 local naval sandbox. It collects every change made since `v0.2`. The headline is **air units** — aircraft squadrons as first-class entities that scout, strike, dogfight, and rearm, woven into the existing sensor / Cooperative-Engagement (CEC) / fire-planning / damage / win pipeline rather than a parallel system. Around them: a **detection-realism overhaul** (radar cross-section + altitude / radar-horizon shadow, missile altitude and energy bleed, air-to-air no-escape-zone geometry), an **anti-overcommit** rework of offensive fire planning, the **Unit Workshop** modding system, new **performance** work (spatial saturation grid, pooled fire-planning indexes, throttled DOM render path), and a read-only **debug-logging** toolkit.
- The simulation remains deterministic, dependency-light, and build-step-free; everything below was verified through `npm test` (170 tests) and the determinism + machine-independent complexity checks in `npm run bench` (complexity score ≈ 0.8, sub-linear).

### Added — Air units (aircraft squadrons)

- **One squadron = one entity, several aircraft.** A flight is a single `domain:"air"` entity that costs one ship's worth of latency (one radar, one track-file, one decision, one fire plan) but renders and attrits as several aircraft: its hit-point pool **is** its plane count, so each hit downs one aircraft and combat power (volley size, relaunch cadence) scales with the survivors. Modelling each airframe individually was deliberately avoided to keep the per-tick budget flat.
- **Two generations.** `VFA` is a 4.5-gen multirole flight (large RCS, big external load); `VFS` is a 5-gen low-observable flight (tiny `rcsM2` so radars see it only deep inside their reach, an intrinsic `airEvasionBonus`, a smaller internal-carriage magazine, a better sensor).
- **Stand-off strike doctrine.** Flights vector on the fused CEC fleet picture (not just their own short radar), fly a **low-altitude stand-off strike** — ingress → descend for radar-horizon masking → hold at a stand-off ring (a back-and-forth racetrack) → release → **egress** — never boring into the SAM envelope. They break to air-to-air only inside self-defence range, sweep when they have no strike to fly, and otherwise screen the fleet on CAP. Altitude is a per-flight attribute (high cruise vs low ingress) that drives sensor masking only — not a movement axis.
- **Air-to-air, evasion, and flares.** Flights fight with radar BVR and infrared WVR missiles and attrit each other; a flight is a small, fast, hard target (large inherent evasion, more while breaking) so SAMs cost many shots per kill. When a missile closes inside the reaction envelope a flight performs an **evasive break** and pops **flares** — infrared seekers can be decoyed outright. A flight will also hard-kill an inbound anti-ship missile with its radar AAM, but conservatively (keeping a reserve for the dogfight).
- **Airfields, RTB, rearm, and fuel.** An **airfield** (`AFB`, or any ground unit with `isAirfield`) is placeable on land **or** water and serves as a rearm/refuel node. A flight flies its mission until it is Winchester, has spent its anti-ship load, or is low on fuel, then returns to the nearest friendly airfield, rearms/refuels on a timer, and relaunches; with no field reachable it limps toward friendly territory and splashes when fuel runs out. It will not rearm on a destroyed airfield. Save/restore preserves mid-flight lifecycle/fuel/flare state.
- **UI.** The force inventory gains an air sub-table (flight strength / lifecycle state / AAW / ASUW); a selected squadron's detail card shows flight readouts (aircraft, fuel, flares, state, altitude, effector counts) instead of ship subsystems; rendering draws one dart per surviving aircraft with label level-of-detail culling.

### Added — Detection & missile realism

- **RCS-based detection.** Radar range against a target scales with the fourth root of its radar cross-section (`rcsM2`, referenced to a destroyer), so a small fighter flight is only seen far closer than a ship and a low-observable hull closer still — replacing the old rigid detection distance while keeping surface-vs-surface play near-unchanged.
- **Altitude + radar horizon (the "radar shadow").** A 4/3-Earth-radius horizon model uses each contact's altitude: high flyers are seen far, sea-skimmers and low-level ingressers are masked beyond the geometric horizon.
- **Missile altitude + bounded energy bleed.** Missiles carry a cruise altitude (anti-ship sea-skim vs lofted air-defence/strike) and lose speed toward the end of their reach via a bounded drag model (denser low air bleeds faster), clamped so a weapon never stalls and tuned envelopes hold.
- **Air-to-air geometry.** Per-missile no-escape-zone (`nezFraction`, editor-tunable) plus aspect/closure: a shot inside the NEZ keeps its energy and is hard to defeat, a max-range or tail-chase shot is far easier to out-run. The AI prefers high-percentage NEZ shots (a BVR→WVR progression).
- **New air weapons.** `AIM-120` AMRAAM (BVR active radar), `AIM-9X` Sidewinder (WVR infrared, flare-decoyable), `AGM-84` Harpoon (air-launched sea-skimming anti-ship).
- **OTC air-picture integration.** Aircraft feed and consume the same fused CEC force picture as ships (engage-on-remote both ways); they are excluded from OTC/AAWC roles and AAW sector division (mobile screeners, not pickets).

### Added — Anti-overcommit fire planning

- Ships prefer dedicated anti-ship weapons over the dual-role `SM-6` (conserving fleet air defence), cap raid size by target toughness outside the deliberate `saturate` doctrine, and always keep a slot for the top surface target so strikers still get to use their anti-ship rounds when an enemy flight outscores every ship.

### Added — Unit modding system

- **Unit Workshop.** A new folder-icon button beside the language toggle opens a dense editor popup: a lockable unit list on the left, and a curated, schema-driven parameter form on the right (empty until a unit is selected). Edits live in a working copy — closing the popup or switching units discards unsaved changes; **Save** is the only commit path.
- **Three unit types.** `naval` and `ground` units are deployable from the placement dropdown; `ammo` units are not deployable and instead populate the loadout pickers of naval/ground units. Selecting a type re-renders the lower fields from that type's schema.
- **Self-contained JSON units, permanently stored in the browser.** Each unit is a self-contained JSON record kept in IndexedDB (no Downloads/Desktop, no server changes — works identically for local runs and the cloud build). Drag a unit `.json` onto the popup to import it; **Export** writes a unit back out as a file to share.
- **Vanilla units are locked, not deletable.** All built-in hulls, ground emplacements, and weapons are seeded into the store as read-only records and re-healed to canonical values on every boot. They render read-only with a **Clone** action; custom units add **Save**/**Delete**.
- **Live registries.** `MISSILES` and `SHIP_CLASSES` are now mutable registries (not frozen) with `registerMissile`/`registerShipClass` (+ `isBuiltin…`/`unregister…`). Custom units flow through the existing sensor/CEC/engagement/win pipeline with no parallel code path. Ground units carry an explicit `glyph` (`sam`/`radar`/`bunker`) so custom emplacements pick a map symbol.

### Added — Debug instrumentation

- **`PerfRecorder` → `debug/perf-debug.log`.** A per-run performance trace: sim ms/tick (avg/p50/p95/p99/max) and browser render ms/frame, peak concurrent entities, the worst tick, heap growth, and a lag diagnosis that **attributes a slow frame to the sim step vs the canvas render path**.
- **`BattleLogger` → `debug/sim-debug.log`.** A per-run tactical narrative sampled at a fixed cadence: every entity's position/altitude/state/stores, a one-line translation of what each unit is doing and why, the per-side command posture, and the events since the last frame — enough to "watch" how the battle and the AI unfolded offline.
- Both are read-only (no RNG, no sim mutation, so determinism is unaffected) and written to `debug/`, overwritten every run — headless via `npm run debug:sim` (a highly asymmetric air-vs-surface scenario that resolves) and from the browser app, which POSTs them to the server (`POST /debug/save`) on every run.

### Changed

- **`MISSILES` / `SHIP_CLASSES` are now live registries** (not frozen objects); all built-in values are preserved exactly, so the deterministic regression suite and complexity score are unchanged.
- **Removed the strike-cell concept.** `vlsStrikeCells` is gone from the model, the editor, and saved scenarios: every missile now draws from one shared VLS pool by its `cellCost`. Vanilla default loadouts are byte-identical (the old cap never bound any built-in hull), so determinism is unaffected.
- **Render-path performance.** The DOM side-panels (status, inventory, event log, detail cards) now refresh at ~20 Hz instead of every frame (the canvas still draws at full frame rate), eliminating the per-frame inventory/event-log rebuild + reflow that dominated browser cost during combat. The per-missile glow (`shadowBlur`) is dropped above ~50 live missiles, and weapon-range rings entirely off-screen are culled. No simulation logic changed.
- **Local default serving port moved from `4173` to `4172`** (`server.mjs`, `quickrun.bat`, `.claude/launch.json`, docs).

### Fixed

- **Blurry map.** Root cause was a fractional `devicePixelRatio` (e.g. 1.5) leaving the canvas backing store a half-pixel off the CSS size; fixed with exact CSS sizing and an identity-transform terrain blit so the backing store maps 1:1 to device pixels.
- Aircraft no longer own or draw an AAW sector (they are mobile strikers, not sectorised air-defence pickets).

### Performance

- **Spatial missile saturation grid + raid-count memoization.** Interceptor and CIWS saturation now read a true local missile density from a pooled per-tick uniform grid (more realistic than the old same-target proxy and bounded to nearby cells), and the inbound-raid count is memoized per planning cycle — removing the dominant quadratic in a saturated defence.
- **Pooled per-cycle engagement-index Maps.** The seven fire-planning index structures are reused and cleared in place across cycles instead of reallocated each second — provably behaviour-preserving (the event-stream hash is unchanged).
- Per-tick entity indexes let the movement / point-defence / aircraft paths skip the full all-missiles scan when nothing is inbound.

### Removed

- Naval editor: the **Hull** (length/beam/draft/displacement), **CIWS hardware**, and **Strike cells** fields — all defaulted internally to keep the form lean. Mobility fields now auto-derive from cruise speed. Ammo identity is reduced to **ID** (the weapon labels itself with its ID).

## v0.2

### Release summary

- Second public release of the TomaHawk / 战斧 local naval sandbox. It collects every change made since `v0.1`: a geographic terrain layer, terrain-aware navigation, fixed land-based unit types, a fully bilingual UI, Railway deployment, a modularized simulation core, and a machine-independent performance-regression guard.
- The simulation remains deterministic, dependency-light, and build-step-free; everything below was verified through `npm test` and the determinism check in `npm run bench`.

### Added — Terrain and maps

- **Tactical maps with a real coastline.** A selectable **East China Sea** layer renders locally bundled Natural Earth 1:10m land and coastline data in a regional azimuthal-equidistant projection, alongside the original border-less **Open Sea** layer. Map selection is a setup-only control.
- **Shared world geometry.** `src/world/map-spec.js` and `src/world/terrain.js` own the map dimensions, projection, and binary water/land queries consumed by both the renderer and the simulation. The tactical world was expanded to nine times the core map width and 9.6 times its height, and the camera now clamps to that rigid border instead of zooming past it.
- **Kilometre scale UI.** Map coordinates, a 20 km grid, a dynamic scale bar, rulers, and visible weapon ranges all read in kilometres; internal simulation distances stay in metres.
- `docs/MAP_DATA.md` records the Natural Earth provenance and the `npm run map:data` regeneration step.

### Added — Terrain-aware navigation

- Ship movement now treats terrain as a binary navigability problem (water vs. not-water). Ships plan deterministic coastal detours around land, fall back to stopping/replanning at the last safe water point rather than crossing a coastline, and reuse a blocked-route plan for its cache window.
- Setup placement enforces terrain: **sea units must be placed on water** and snap back to the last valid water position when dragged onto land.

### Added — Ground-based unit types

- **Three fixed, land-based emplacements** modeled as stationary ship-entities so they flow through the existing sensor / CEC / engagement / win pipeline:
  - **SAM** — coastal surface-to-air battery (area + point interceptors).
  - **CDB** — coastal anti-ship defence battery with an over-the-horizon targeting radar.
  - **EWR** — early-warning radar with a long search range and no weapons.
- Ground units **must be placed on land** (and on terrain maps are rejected on water); they never move, are never chosen as the formation guide, and are never re-seated to water on restore or map change.
- **Cross-domain cooperation works both ways:** a ground radar feeds the fleet's cooperative (CEC) picture and a ship can engage on a ground unit's remote track; naval anti-ship fire targets and destroys enemy ground units, and a coastal SAM defends nearby friendly ships.
- The Force Inventory now groups each faction into a **naval sub-table and a ground sub-table** with their own column headers and unique unit tags (`SAM-`, `CDB-`, `EWR-`), and ground units render as distinct map glyphs (SAM triangle, EWR diamond + sweep, battery bunker).

### Added — UI, i18n, and deployment

- **Full English/Chinese UI** with a one-click language toggle covering panels, controls, ship/role labels, and the tactical event log (including localized clipboard export).
- A wired-up **RULER** tool (button + `R`) that supports multiple simultaneous range/bearing measurements.
- **One-click Railway deployment**: a root `railway.json`, `PORT` binding, and a `/health` endpoint, with local `npm start` unchanged.
- Overlapping weapon-range rings of the **same weapon type and faction** now render as a single union outline (internal arcs removed) instead of a tangle of crossing circles. Style, colour, and dash are unchanged; rings of different types or factions are never merged.

### Added — Tooling, tests, and license

- **Modularized simulation core**: `src/sim.js` is a re-export barrel; the implementation lives in focused modules under `src/sim/` (`constants`, `math`, `events`, `missiles`, `ships`, `sensors`, `command`, `movement`, `combat`, `scenario`, `step`).
- `src/ui/view.js` — pure, DOM-free presentation helpers (coordinate transforms, panel HTML builders, per-ship derived state), unit-tested in `tests/ui.test.mjs`.
- **Benchmarks**: `npm run bench` reports ticks/sec by battle size plus a determinism check and a terrain-route case; `npm run bench:frontend` measures dense rendering helpers.
- **Machine-independent performance-regression guard**: `scripts/perf-harness.mjs` produces a *complexity score* (the ratio of per-tick cost at two force sizes; ~1.0 linear, ~5.0 quadratic), asserted under a ceiling by `tests/performance-regressions.test.mjs` so an accidental O(n²) hot loop fails CI.
- **CI**: `.github/workflows/ci.yml` runs `npm test` on every push/PR across Node 20/22 on Linux + Windows; `package.json` declares `engines.node >= 20`.
- **License**: released under the **PolyForm Noncommercial License 1.0.0** (free for any noncommercial use; commercial use is not permitted). `package.json` declares `LicenseRef-PolyForm-Noncommercial-1.0.0`.

### Changed

- **Real-scale ship motion** (`SHIP_SPEED_MULTIPLIER = 1`): tempo now comes from the UI sim-rate (time-compression) control rather than inflated platform speed.
- The coastal defence battery's targeting radar was widened to an over-the-horizon range so its long anti-ship missiles are usable at standoff instead of leaving the battery blind and passive beyond a short radar.
- Hot-path lookups use persistent per-tick id indexes; track ageing is lazy with an expiry heap; the cooperative force picture refreshes on a bounded cadence with incremental dirty updates. All verified deterministic (byte-identical event streams).
- Repeated UI passes tightened the dense tactical layout (retractable feed, compact inventory and detail cards, side-coloured emphasis) without raising the base type scale.
- `README.md` was slimmed to a concise bilingual overview; the full manual lives in `docs/REFERENCE.md`.

### Fixed

- Each launched missile now stores an immutable `launchRole`, so an SM-6 keeps the correct square/triangle icon and anti-ship/anti-air behaviour for its whole flight.
- Duplicating a ground emplacement keeps the copy on land instead of letting its offset spill into the sea.

### Documentation

- Reorganized and refreshed the documentation set for `v0.2`: `README.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/SIMULATION_ASSUMPTIONS.md`, `docs/MAP_DATA.md`, `docs/ROADMAP.md`, `src/README.md`, and `AGENTS.md`.

## v0.1

### Release summary

- Establishes the current public baseline for the TomaHawk / 战斧 local naval sandbox.
- Formalizes the repository's current release line as `v0.1`.
- Captures the lightweight Node.js + browser runtime and deterministic simulation core already present in the repository.

### Included in v0.1

- Local static server via `server.mjs` serving the application at `127.0.0.1:4173`.
- Browser-based tactical map UI implemented in `src/app.js` and `src/styles.css`.
- Deterministic naval combat simulation core implemented in `src/sim.js`.
- Seeded scenario creation, setup/running/ended modes, and JSON save/load/AAR export.
- Force-level doctrine, offensive raid planning, defensive missile allocation, and ROE-aware engagement logic.
- Imperfect radar tracks, cooperative force-picture abstraction, and profile-based missile detection behavior.
- Four ship hull categories: `DDG`, `CCG`, `BBG`, and `FFG`.
- Five modeled missile families: `SM-2MR`, `ESSM`, `MaritimeStrike`, `TomahawkBlockV`, and `SM-6`.
- Existing automated regression coverage through `npm test` (`node --test`).
- Expanded top-level documentation in `README.md` for both English and Chinese readers.

### Documentation set for v0.1

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/SIMULATION_ASSUMPTIONS.md`
- `docs/SOURCES.md`
- `docs/ROADMAP.md`

### Notes

- `docs/` contains some forward-looking `v0.2+` design notes; they remain planning/reference material and do not change the current release tag of `v0.1`.
