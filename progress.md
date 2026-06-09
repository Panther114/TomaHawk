# Progress

Original prompt: reevaluate fleet strategy so the sim models saturation attacks, side-wide aggressiveness, and target prioritization from only what each commander can actually observe.

Current implementation notes:
- Added side-wide command posture derived from own offensive depth, VLS depth, and observed enemy force-picture depth.
- Offensive planning now concentrates on the highest-value observed targets first and scales salvo depth from posture.
- The HUD shows a faction aggressiveness bar for each side.
- Documentation has been updated to describe the new command model and its estimate-only constraints.
