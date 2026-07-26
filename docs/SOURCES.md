# Sources And References

This project references public information and public UI concepts only.

## DCS Map View Reference

The UI direction references DCS World's map/F10-style tactical view: map-first presentation, grid/coordinates, side-aware unit symbols, compact controls, and visibility options. It does not copy DCS assets.

Useful public references:

- DCS F10/mission-editor map-symbol community reference: `https://www.digitalcombatsimulator.com/en/files/3322523/`
- DCS manual references describe the F10 map as an in-simulation map view whose visible units depend on map-view options.

## Naval Data References

Current public references used by the simulation:

- U.S. Navy AEGIS Weapon System fact file: `https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2166739/aegis/aegis-weapon-system/`
- U.S. Navy Standard Missile fact file: `https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2169011/standard-missile/standard-missile/`
- U.S. Navy ESSM fact file: `https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2168978/evolved-seasparrow-missile-block-1-essm-rim-162d/`
- U.S. Navy Phalanx CIWS fact file: `https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2167831/mk-15-phalanx-close-in-weapon-system-ciws/linkId/100000022912029/mk-15-phalanx-close-in-weapon-system-ciws/`
- U.S. Navy Tomahawk fact file: `https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2169229/tomohawk-cruise-missile/linkId/tomahawk-cruise-missile/`
- U.S. Navy Cooperative Engagement Capability fact file: `https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2166802/cec-cooperative-engagement-capability/`
- U.S. Navy destroyer class pages and ship characteristics pages for high-level public ship facts.
- NAVAIR SPY-1 public pages for high-level radar context.

## Data Policy

Do not add classified, leaked, or operationally sensitive data. If a parameter is uncertain, encode it as an approximate simulation envelope and document the uncertainty in `docs/SIMULATION_ASSUMPTIONS.md`.

---

## Current Additional References

### Ship Classes
- Arleigh Burke Flight IIA: public US Navy factsheets, displacement ~9,200 t, 96-cell Mk 41 VLS
- Ticonderoga-class: public US Navy factsheets, 122-cell Mk 41 VLS, AN/SPY-1B AEGIS
- Constellation-class (FFG-62): public US Navy programme documents, 32-cell Mk 41 VLS, EASR radar
- Trump-class arsenal battleship: speculative arsenal-ship concept, 288-cell Mk 57 PVLS, ~28,000 t
- Nimitz / Ford-class carriers: public US Navy fact files for displacement, speed class, and air-wing role; in-sim `CVN` is a compact moving airfield with a small self-defence magazine, not a full air-wing model

### Weapons
- AIM-120 AMRAAM: U.S. Air Force fact sheet (`https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104576/aim-120-amraam/`) and NAVAIR AMRAAM public product page (`https://www.navair.navy.mil/product/AMRAAM`) for all-weather BVR active-radar guidance context
- AIM-120C-8 / AIM-120D-3: RTX/Raytheon AMRAAM pages (`https://www.rtx.com/raytheon/what-we-do/air/amraam-missile`, `https://raytheon.mediaroom.com/2023-09-01-US-Air-Force%2C-RTX-complete-first-flight-test-of-AIM-120C-8`) for modern variant and F3R context
- AIM-9X: public NAVAIR / Raytheon Sidewinder materials for WVR IR / HOBS context
- AGM-84 Harpoon / AGM-154 JSOW: public U.S. Navy / NAVAIR programme pages for air-launched anti-ship and stand-off anti-ground roles
- SM-6 (RIM-174 ERAM): public Raytheon factsheets, ~200 NM range, Mach 3.5, active radar seeker, dual-role
- THAAD (Terminal High Altitude Area Defense): public MDA / Lockheed Martin programme materials — hit-to-kill interceptor, ~200 km class engagement envelope, high-altitude endo/exo-atmospheric intercept of ballistic (and by sandbox extension high-energy boost-glide) threats; **not** a cruise-missile or aircraft weapon. Battery magazine and AN/TPY-2 association are open-source approximations for play
- Dark Eagle / LRHW: public U.S. Army programme materials for ground-launched boost-glide hypersonic surface strike; ranges and kinematics in-sim are sandbox envelopes only
- Virginia-class attack submarine: U.S. Navy fact file (`https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2169558/attack-submarines-ssn/`) for public Block V dimensions, 25+ knot class, four torpedo tubes, Tomahawk role, and VPM capacity
- Virginia Block V / Acoustic Superiority: U.S. Navy contract release (`https://www.navy.mil/Press-Office/Press-Releases/display-pressreleases/Article/2032257/navy-awards-contract-for-nine-virginia-class-submarines/`) for VPM 12-to-40 Tomahawk capacity and Acoustic Superiority context
- Mk 48: U.S. Navy fact file (`https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2167907/mk-48-heavyweight-torpedo/`) for 21-inch heavyweight acoustic-homing ASW/ASuW role, dimensions, and warhead; operational range/speed remain undisclosed and are gameplay envelopes
- Naval sonar: U.S. Navy public sonar overview (`https://www.nepa.navy.mil/SOTS/At-Sea-Policy/Sonar-101/`) for passive-listening and active-ping distinctions
- AN/SLQ-32 SEWIP: U.S. Navy fact file (`https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2167559/surface-electronic-warfare-improvement-program-sewip/`) for electronic-support and electronic-attack roles
- EA-18G Growler: U.S. Navy fact file (`https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2166036/ea-18g-growler-airborne-electronic-attack-aircraft/`) for airborne electronic attack, ALQ-218/ALQ-99, APG-79, AIM-120, and AGM-88 roles
- Nulka active decoy: U.S. Navy fact file (`https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2167877/mk-53-decoy-launching-system-nulka/`) for off-board active RF decoy purpose; the sim combines this role with chaff in a bounded `radarDecoys` store

### Aircraft (player airframes — public approximations only)
- F-22 Raptor: public USAF / Lockheed materials — Mach ~2.25 class dash, supercruise, ~9 g, AN/APG-77-class AESA, internal AAM carriage, very low observability (aspect-averaged flight RCS for sim, not single-ship frontal "marble" estimates)
- F-35A / F-35C Lightning II: public JSF programme materials — Mach ~1.6, ~7 g (A) / lower for C, AN/APG-81, LO; C has larger wing/fuel for carrier ops
- F-15C Eagle / F-15E Strike Eagle: public USAF fact sheets — Mach 2.5 class, large non-stealth RCS, deep external load (E)
- F-15EX Eagle II: public USAF / Boeing programme materials — APG-82 AESA, EPAWSS, very large external magazine
- F-16V (Block 70/72) Viper: public Lockheed / USAF materials — APG-83 AESA class, high agility, shorter combat radius than F-15 family
- All speeds, RCS, radar reach, and loadouts in the sim are **open-source envelopes for sandbox play**, not classified or operationally authoritative data

### Sensors
- Radar horizon: standard 4/3 Earth-radius atmospheric refraction model
- ESM passive detection and noise jamming: implemented as public-role-informed range/quality abstractions, not claimed system performance
- CEC (Cooperative Engagement Capability): public US Navy / Johns Hopkins APL references

### Performance
- Pre-computed indexes pattern: standard game-loop optimisation (entity-component-system)
- Benchmark methodology: 1000-tick warm-up, 1000-tick measurement, Node.js `performance.now()`

All values are public-domain approximations. No classified or operationally sensitive data is used.
