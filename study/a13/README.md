# A1.3 — departure-to-departure type and exit sequencing

**MECHANICS_ONLY_UNVALIDATED.** Offline synthetic experiment for review, not an ATC
clearance system, separation standard, forecast of runway capacity, CTOT/ATFM
slot compliance tool, or approved procedure. Approved on panel issue #6 in
comments **6877190634** (Claude A1–A3) and **6877231875** (Philip approval).

## Two observed background-arrival regimes and four departure demand levels

The source contains September 2026 departure-peak aggregates, not reconstructed
flight requests or observed unconstrained demand. Synthetic departure demand:
**14, 16, 18, 20/h**, each with **1 ARR/h** (early wave, observed approx 0.7–0.9)
or **7 ARR/h** (08:xx UTC, observed approx 6.7) over two hours.
Synthetic departure requests include type, exit and demand jitter. The exit
assignment uses the published pooled proportions: GTQ **37%**, ASMOX 21%,
RAPOR 18%, DYOUT 17%, DIK 5%, **OTHER_UNKNOWN 2%**. The missing 2% is
an explicit residual, not silently reassigned. Observed busiest departure-hour
mean 15.8/h, maximum 20/h, is realised output, NOT demand or capacity.

**Type mix is not empirically known** in these aggregates; synthetic TP share
and heavy share are marked UNVALIDATED in the config. Mean speed profiles are
an abstract radial-distance model rather than measured ELLX SID tracks.

## A1 speed-contrast calibration (development medians only)

Observed median change of same-exit departure time gap from follower airborne
to 40NM: TP→jet **−120 s**, jet→TP **+119 s**, jet→jet **+4 s**. The
model fits the symmetric difference in 40NM travel times: **119.5 seconds**
(least-squares TP/jet contrast), with residuals **+0.5, +0.5, −4.0 s**.
A jet mean speed of **300 kt** is an explicit HYPOTHETICAL anchor; the TP
speed is derived conditionally (about 240 kt). **The three gap-change
medians do not identify two absolute speeds.** This model does not claim to
have independently fitted both speed parameters or to reproduce actual
exit-fix tracks. Any further empirical model fit requires more observations
and an explicitly approved new validation/holdout design.

## A2 / A3 policies, safety and CTOT limitation

- **FIFO** request ordering, **CURRENT** additional departure planning interval
  **0 ms**, preserving pre-existing runway occupancy/protection assumptions.
  Zero is not a relaxation of a hard procedural or wake minimum.
- **TYPE_EXIT_ONE_SWAP** makes disjoint, adjacent swaps only for a
  TP followed by a jet on the **same exit**. Each aircraft can move at
  most one position. A synthetic **120 s maximum extra delay** relative
  to the paired FIFO per-aircraft airborne time is checked, with any
  noncompliant swap undone. This limit is an UNVALIDATED planning
  assumption. ATFM CTOT and slot constraints are **NOT MODELLED**.
- **SEP2026_OBSERVED_SAME_EXIT_120S** is a **SENSITIVITY PRESET ONLY**, not a
  local operative wake/procedural minimum, clearance requirement or
  replacement for the CURRENT default. Gate-time distributions are
  not validated against a sector-entry separation requirement.

Synthetic arrivals reserve runway occupancy (75 s illustrative A1.2
assumption) and retain a post-departure occupancy buffer. Their request
timestamps are synthetic and paired across alternatives. No controller
workload, LVP, runway-exit geometry or airport demand reconstruction.

## Configurable sector-entry gate proxy

First outward **30NM and 40NM radial crossing UTC-relative time** are
computed from simple mean synthetic groundspeeds. The primary same-exit
metric is **follower gate crossing time minus leader gate crossing time**,
plus the change in that time gap since follower airborne. Negative
time gaps and crossing-order reversals are reported, not suppressed.

For **different-exit pairs**, only the crossing timestamps and coverage
are descriptive. **No spacing or along-track separation claim** is made.
Missing ring crossings receive `GATE_MISSING_SYNTHETIC` and
`PAIR_NOT_EVALUABLE_GATE_MISSING` statuses and remain in denominators.
Missingness here is an *injected synthetic test condition*, not observed
ADS-B coverage. Actual GTQ/ASMOX/RAPOR/DYOUT/DIK fix coordinates,
SID corridors and exit-fix projections remain unavailable. Ring crossing
is not actual TMA sector entry.

Observed distance descriptors for 52 consecutive same-exit departures
airborne within 180 s are held as contextual aggregate only: follower
airborne median 5.6 NM (P10 4.5), 30NM median 15.6 NM (P10 10.1),
40NM median 18.1 NM (minimum 7.3). These are **not numerical constraints**.

## Reproduction and review

A clean full-history Node 22 checkout:

    node --test study/a13/*.test.mjs
    node study/a13/cli.mjs --out /tmp/a13-first-candidate.json

The existing CI additionally runs Stage A, A1.1 and A1.2 tests, A1.1
sealed holdout, and A1.2 candidate. A1.1 approved lock is byte-identical.
There are **50 fixed, independent synthetic seeds** at each of the
2 background ARR × 4 DEP demand × 2 planning presets cases, each evaluated
under FIFO and a type/exit one-position-swap candidate. Reports include
movement conservation, gate-time quantiles and missingness, difference
of FIFO vs candidate in departures/arrivals per measured hour, total
departure delay, 95% paired bootstrap CI, swap count, provenance and
individual seed details. These bootstrap intervals reflect only the
frozen synthetic simulation, **not** uncertainty in real-world capacity.

All A1.3 files remain additive under `study/a13/`. No new model lock,
deployment or PR merge is authorised without Philip's subsequent approval.
