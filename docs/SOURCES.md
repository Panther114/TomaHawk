# Sources and attribution

Tomahawk builds engineering approximations from public material. Values are not classified data and do not represent any official assessment by a government or agency.

## Main source types

- Public fact sheets from the U.S. DoD, Navy, Air Force, and Missile Defense Agency
- Manufacturer public product pages and press material
- Public symbol standards published by NATO and the U.S. Defense Logistics Agency
- Natural Earth public-domain coastline data
- Open research papers and government reports on radar horizon, RCS, and kinematics basics

## Tactical symbols

Map symbols draw on:

- MIL-STD-2525E Change 1
- NATO APP-06 Edition E

The implementation is explicitly a “controlled subset in a standard-inspired style.” It covers affiliation, domain, major function, and a few modifiers needed by this game, and does not claim full standard compliance.

## Visual assets

The landing-page hero and the 22 built-in equipment-card assets were generated with GPT Image 2 under constraints of no text, trademarks, or watermarks, and unbranded equipment composition. Map tactical symbols and technical fallback art are code-generated; no photo or icon packs of unclear license are used.

UI Chinese typefaces use a local subset of Adobe Source Han Sans SC 2.005R, distributed under the SIL Open Font License 1.1. Full license text is in `src/fonts/OFL-SourceHanSans.txt`. The project does not load fonts from the network.

## Data interpretation

Range, speed, RCS, hit probability, magazines, and durability are converted to common units and calibrated to the simulation scale. Where solid public data is missing, conservative class approximations are used. Real equipment names in docs only identify the simulated object.
