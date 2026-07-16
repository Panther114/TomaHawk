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
- Nulka decoy: background reference only; not implemented in the current sim
- Chaff: background reference only; not implemented in the current sim
- AN/SLQ-32 SEWIP: background reference only; not implemented in the current sim

### Aircraft (player airframes — public approximations only)
- F-22 Raptor: public USAF / Lockheed materials — Mach ~2.25 class dash, supercruise, ~9 g, AN/APG-77-class AESA, internal AAM carriage, very low observability (aspect-averaged flight RCS for sim, not single-ship frontal "marble" estimates)
- F-35A / F-35C Lightning II: public JSF programme materials — Mach ~1.6, ~7 g (A) / lower for C, AN/APG-81, LO; C has larger wing/fuel for carrier ops
- F-15C Eagle / F-15E Strike Eagle: public USAF fact sheets — Mach 2.5 class, large non-stealth RCS, deep external load (E)
- F-15EX Eagle II: public USAF / Boeing programme materials — APG-82 AESA, EPAWSS, very large external magazine
- F-16V (Block 70/72) Viper: public Lockheed / USAF materials — APG-83 AESA class, high agility, shorter combat radius than F-15 family
- All speeds, RCS, radar reach, and loadouts in the sim are **open-source envelopes for sandbox play**, not classified or operationally authoritative data

### Sensors
- Radar horizon: standard 4/3 Earth-radius atmospheric refraction model
- ESM passive detection: background reference only; not implemented in the current sim
- CEC (Cooperative Engagement Capability): public US Navy / Johns Hopkins APL references

### Performance
- Pre-computed indexes pattern: standard game-loop optimisation (entity-component-system)
- Benchmark methodology: 1000-tick warm-up, 1000-tick measurement, Node.js `performance.now()`

All values are public-domain approximations. No classified or operationally sensitive data is used.
