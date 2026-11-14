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
Synthetic departure requests include type, exit and C1 bunched runway-ready times. The exit
assignment uses the published pooled proportions: GTQ **37%**, ASMOX 21%,
RAPOR 18%, DYOUT 17%, DIK 5%, **OTHER_UNKNOWN 2%**. The missing 2% is
an explicit residual, not silently reassigned. Observed busiest departure-hour
mean 15.8/h, maximum 20/h, is realised output, NOT demand or capacity.

**Type mix is not empirically known** in these aggregates; synthetic TP share
and heavy share are marked UNVALIDATED in the config. Mean speed profiles are
an abstract radial-distance model rather than measured ELLX SID tracks.

## C1: observed take-off intervals and bunched ready-time fit

Claude's PR #4 review `5905137012` provides ANA September 2026 IFR
**take-off** time-interval aggregates, derived from whole-minute
`act_date_d` timestamps (not controller runway-ready/line-up times).
The early 03/04 UTC peak contains **263** consecutive intervals,
P10/median/P90 **120/120/360s**, and **51% ≤120s**.
The 08/16 UTC peak contains **180** intervals,
P10/median/P90 **60/180/420s**, and **38% ≤120s**.
Consecutive same-exit shares **30% early** and **18% late** are
reported against, but never included in the fitting gate.

Synthetic runway-ready requests now arrive in **clusters**, not
equally spaced requests. Each cluster is 1, 2 or 3 aircraft according
to a seeded, wave-specific categorical distribution, with a within-
cluster ready-time gap and wave-level centre spacing. Ready time is a
**hypothetical input**, not a reconstructed movement or ATFM time.

The deterministic development-only grid search
(`node study/a13/fit-ready-cli.mjs`) evaluates **120 parameter
combinations per wave**, **12 fixed development seeds**, the four
approved 14/16/18/20 departures/hour cases, and their proper
1 or 7 background arrivals/hour. It minimises normalised deviations
from observed median and share ≤120s, with P90 as a low-weight
descriptive term. The two selected parameter families are stored in
`MECHANICS_ONLY.json`, labelled
`FITTED_TO_SEP2026_TAKEOFF_INTERVALS_NO_HOLDOUT`.
The full **50-seed** replication (including the 12 development seeds) rechecks each wave's
**FIFO CURRENT** take-off events within the one-hour measurement
window. The preregistered gate requires:
**|model median − observed median| ≤30s** AND
**|model share ≤120s − observed share| ≤10 percentage points**.
This is an in-model development-consistency gate, **not sealed
out-of-sample validation**. P10, P90, shares ≤60/180 and same-exit
shares remain report-only; these may reveal structural mismatches
even if the two stated gates pass.

The candidate reports the number of viable one-position swaps,
the percentage of seeds with at least one accepted swap, and paired
FIFO-versus-candidate changes to departures, total delay and
40NM gate-time differences, including zero or adverse outcomes.

## C2: minute-quantised take-off observations (Claude review 5907827059)

ANA's `act_date_d` observations have **whole-minute timestamps**. A departure
at 00:59.999 and the next at 01:00.001 is recorded as a **60 s interval**
although the physical interval is approximately 0 s. Two departures within
one recorded minute yield a **0 s interval**. To compare the **observed
take-off interval distribution**, the model now applies
`floor(airborneMs / 60000) * 60000` to **each absolute take-off time
before differencing consecutive departures**. The original continuous
airborne times remain intact for runway mechanics, gate-time calculations,
departure delay, resequencing and capacity proxies. The observation
operator is used **only for the take-off interval fit and its gate**.

After implementing this operator, a fresh 120-combination-per-wave,
12-development-seed grid search selected early bunch parameters
(single 0.12, triple 0.12, within-cluster 60s, centre jitter 0.10) and
late bunch parameters (single 0.24, triple 0, within-cluster 90s,
centre jitter 0). The 50-seed replication repeats the specified gate
(median within ±30 s, share ≤120 s within ±10 percentage points).
P10 and P90, both modelled and observed, and same-exit shares must be
shown in every compact review table.

The required label is **`FITTED_TO_SEP2026_TAKEOFF_INTERVALS_NO_HOLDOUT`**.
This is a development fit using the published whole-minute take-off
interval aggregates, with the 12 fit seeds included in the 50-seed
verification. It is **not** independent observed-ready-time validation
and has no separate sealed departure holdout.

### Preliminary resequencing finding

Under the fitted bunched morning-wave demand, restricting a candidate
to a **single adjacent TP→jet same-exit swap** with at most **120 s
additional individual delay** yields **rare accepted swaps**.
In the first corrected C1 candidate, the 1 ARR/h, 20 DEP/h,
CURRENT case accepted 12 swaps across 50 seed-level runs, but the
candidate produced **no extra departures per measured hour** and only
small changes to 40NM gate-time gaps. The C2 minute-quantised refit
must be assessed afresh; it must not be claimed to establish a new
capacity gain. The study's **preliminary, moderate-confidence finding**
is that **limited one-position resequencing has little effect at the
modelled ELLX demand levels**. Potential benefits of longer-horizon
planned sequencing (DMAN/TSAT) lie **outside A1.3**. CTOT/ATFM
constraints and physical exit-fix geometry are not modelled.

## N1: jet-speed-anchor sensitivity

The default **300kt** synthetic jet anchor remains hypothetical.
Two additional **260kt** and **340kt** anchor cases rerun the
identical 50-seed paired grid, with the turboprop speed recomputed
from the unchanged fitted **119.5s** 40NM travel-time contrast.
For each anchor, show type speeds, fit residuals and gate-time and
sequencing outcomes. The three anchors are **sensitivity cases**,
not measured or independently fitted jet climb speeds, and none
changes the input take-off intervals or operational restrictions.

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
