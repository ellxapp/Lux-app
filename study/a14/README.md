# A1.4: ELLX LVP, winter references and runway-entry mechanics

**MECHANICS_ONLY_UNVALIDATED_WITH_WINTER_DESCRIPTIVES. Not for ATC use.**
Last of the A1 study series. Implemented following Philip's explicit
[post-vacate LVP answer](https://github.com/ellxapp/panel/issues/6#issuecomment-6912811713)
and Claude's [plan review](https://github.com/ellxapp/panel/issues/6#issuecomment-6912766866).
Sources and settled winter reference appear in
[#6912637395](https://github.com/ellxapp/panel/issues/6#issuecomment-6912637395)
and [approved plan v2](https://github.com/ellxapp/panel/issues/6#issuecomment-6912743089).

## Baseline vs sensitivity

**Actual ELLX LVP baseline**: after an ARR has vacated the runway,
the departure may pass the CAT II/III holding point, subject to the
next arrival's distance not yet being inside **10NM**, **15NM for HEAVY**.
Holding-point passage is an event distinct from departure roll/airborne.
The inbound arrival never changes its identity when delayed, and
requested departures remain in a separate queue. The **conditional entry
behind landing traffic** option is included *only* as
`HYPOTHETICAL_NOT_ELLX_LVP_PRACTICE`. It is not an alternative way to
claim ELLX operational capacity.

With the illustrative **90s runway occupancy** and **160kt constant
final-approach groundspeed** (both *UNVALIDATED*), the baseline
medium ARR–DEP–ARR minimum is **315s**, versus winter mixed-pair observed
P10 **266s**. For heavy, the model gives **427.5s**. Baseline:
**FAIL_MODEL_ASSUMPTION_CONFLICT**, intentionally, not retuned.
ROT sensitivities 75s/90s/110s are declared and reported.
Conditional entry gives **255s** medium in the same synthetic formula
and is explicitly not current ELLX LVP practice. The observed proxy
dataset may contain METAR-defined LVP conditions when operational LVP
was not declared, and 10NM is a planning "should", not a hard
separation. These are **plausible explanations, not verified causes**.
The **share of observed winter pairs below the modelled minimum is
NOT REPORTED in the aggregate source** and is expressly `null`
pending an authorised calculation. Never infer it from P10.

## Source-tagged procedure decisions

P-ATC-LVP **Rev 14 (9 January 2026)** is internal and not included in
Git. The exact procedure section identifiers for most values are still
`PENDING_VERIFICATION` in the config. Do not pretend the model has
independently verified those sections.

- `LVP_STATE_SOURCE=METAR_PROXY`. Preparation on visibility ≤1500m OR
  ceiling ≤300ft; notification on RVR A ≤800m OR ceiling ≤200ft.
  Equality counts; notification overrides preparation. A missing
  field never automatically becomes good weather. Historical METAR
  thresholds are **not verified ATC declarations**.
- RWY24 inbound **10NM "should"** is a planning value only and is
  separately reported from hard constraints. RWY06 10NM is a separate
  recommendation for go-around risk. RWY06 is *parameters only*, without
  winter observed validation.
- Every LVP arrival defaults to **CAT II/III CASA protection**.
  CAT I-only can be requested **explicitly by the crew for an individual
  arrival only**. No random CAT I fraction is estimated, no weather or
  operator inference. It removes only the taxi CASA infringement
  check, never runway occupancy, critical-area, other CASA safeguards,
  wake, holding restrictions or LVP state.
- Distinguish follower at 2NM, landing-run end, runway-vacated,
  CASA clear and taxi CASA states. Ground/taxi timings are
  **SYNTHETIC_UNVALIDATED**. They are *not observed FRACS/A-SMGCS
  or controller clearances*. The current simple event engine does
  not reconstruct surface taxi trajectories or operational go-around
  timing.
- RWY24 HEAVY in protected critical area while inbound is **inside
  12NM** yields `MISSED_APPROACH/CRITICAL_AREA_HEAVY`, original
  arrival ID preserved and a second attempt after a named **unvalidated
  900s reentry delay** in test fixtures. The critical-area trigger
  comes from a supplied hypothetical event, not a randomly inferred
  missed-approach frequency.
- RWY24 exit metadata: D2/E/F/G; RWY06 D1/C/end, departure holding
  G/B4. Metadata only pending exit geometry and measured ROT.

## Winter reference: observations, not a fit or validation

Claude supplied aggregate counts from earlier ANA-classified annex
`A4_pairs` files from December 2025–February 2026, ADS-B and
METAR. The study does **not** ingest the classified CSVs or raw tracks.
Consecutive arrival pairs are all-day with gap under 600s, not the A1.1
busy-period population.

| Reference stratum | Pairs | With distance | Days | Distance P10/med/P90 NM | Interval P10/med/P90 s |
| --- | ---: | ---: | ---: | --- | --- |
| Dec LVP proxy | 353 | 111 | 16 | 7.86 / 10.02 / 11.51 | 221 / 302 / 487 |
| Fog, no DEP between | 54 | 17 | 3 | 7.48 / 10.01 / 11.28 | 232 / 304 / 461 |
| Cloud only, no DEP | 43 | 19 | 3 | 7.56 / 9.10 / 10.21 | 186 / 221 / 521 |
| LVP with ≥1 DEP between | 29 | 9 | 4 | 10.83 / 12.08 / 13.18 | **266 / 320 / 503** |
| Normal reference | 108 | 54 | 4 | 5.53 / 6.69 / 8.33 | 146 / 207 / 450 |

The **~304s fog median** (roughly 11.8 inverse-interval arrivals/h)
is a descriptive interval proxy, **not a sustained observed runway
throughput or capacity**. The 10.01NM fog median is from only
17 ADS-B distances. Cloud-only 9.10NM and 221s are report-only and
not grounds to infer CAT I approaches. RWY06 has no suitable
observed LVP cases. No independent winter held-out calibration exists.

## Initial 50-seed result, interpret conservatively

The first synthetic request fixture is **12 ARR/h and 3 DEP/h**, with
two hours of demand, a one-hour measurement window and a separate drain.
It produces **12 ARR/h** in the measured hour, with a median
arrival-only interval of approximately **300.2s**, consistent in
*interval scale* with the winter fog median **304s**. But the actual
modelled arrival-only median separation is approximately **13.34NM**,
**not** the observed 10.01NM fog median and **not** a fitted 10NM
delivery distribution. This illustrates why an inverse-interval rate
cannot be converted into observed delivered distance at a fixed
synthetic 160kt speed. Do not describe the 50-seed run as a winter
spacing calibration or validation.

In mixed synthetic NOTIFICATION, the measured hour produces 12 ARR/h
and 3 DEP/h with median arrival interval around **288s** and median
delivered separation around **12.81NM**. **Every one of the six
50-seed paired family comparisons produces zero hourly
conditional-minus-baseline movement delta**, because the fixed
synthetic request times do not create an earlier eligible holding-point
opportunity. A separately constructed deterministic fixture proves
that conditional line-up would change holding passage if it were
hypothetically allowed; that **cannot** be interpreted as a
benefit or actual practice in ELLX LVP.

Most importantly, the *separate* hard holding-point feasibility
calculation remains **315s medium / 427.5s heavy** for actual
post-vacate entry versus observed mixed P10 **266s: FAIL**. The
in-model traffic demand results do not override this procedural
feasibility conflict. Claude's observed aggregate does not include
the exact share of 29 LVP-with-departure intervals below 315s/427.5s;
it remains **NOT_OBSERVED / not inferable from quantiles** pending
an explicit aggregate calculation.

## What the prototype does, and does not

The isolated `study/a14/` module has deterministic METAR phase, holding
and CASA rules, heavy missed-approach re-entry, one-shot synthetic traffic
simulation and 50-seed comparisons under normal, preparation and
notification, arrival-only or mixed, and both post-vacate baseline and
conditional sensitivity. Requests, event times, delays, shortfalls,
holds, missed approaches and censors remain in the JSON artifact.
Runway clearance/CASA times and final speed are illustrative.
The 50 seeds are **stochastic sensitivity tests only**, not empirical
confidence bounds. An illustrative 3NM hard-spacing *placeholder*
is **not verified ELLX surveillance/wake minima**; no operational
safety or separation claim follows from these synthetic mechanics.

No winter records are fitted. No AIRAC, aircraft capability, actual
CAT II/III taxi clearance, verified LVP activation timestamps,
FRACS data, missed approach rate or approved runway capacity is
established. Failure to reproduce 266s is an unresolved model versus
proxy reference discrepancy, and should be presented as such.

Reproduction in a clean Node 22 Git checkout:

    node --test study/a14/*.test.mjs
    node study/a14/cli.mjs --out /tmp/a14-lvp-candidate.json

Existing Stage A, sealed A1.1, A1.2 and A1.3 validation must remain
unchanged in CI. **No merge or deployment without Philip's approval.**
