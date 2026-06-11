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

### Weapons
- SM-6 (RIM-174 ERAM): public Raytheon factsheets, ~200 NM range, Mach 3.5, active radar seeker, dual-role
- Nulka decoy: background reference only; not implemented in the current sim
- Chaff: background reference only; not implemented in the current sim
- AN/SLQ-32 SEWIP: background reference only; not implemented in the current sim

### Sensors
- Radar horizon: standard 4/3 Earth-radius atmospheric refraction model
- ESM passive detection: background reference only; not implemented in the current sim
- CEC (Cooperative Engagement Capability): public US Navy / Johns Hopkins APL references

### Performance
- Pre-computed indexes pattern: standard game-loop optimisation (entity-component-system)
- Benchmark methodology: 1000-tick warm-up, 1000-tick measurement, Node.js `performance.now()`

All values are public-domain approximations. No classified or operationally sensitive data is used.
