# Stage A1.2: time-based ARR–DEP–ARR gap mechanics

**MECHANICS_ONLY_UNVALIDATED**. Offline synthetic decision-support experiment, not
an ELLX runway-clearance, safety, separation or technical capacity model.

Design approved in [panel #6 plan v2, comment 6870153540](https://github.com/ellxapp/panel/issues/6#issuecomment-6870153540),
with Philip's conditional-line-up decision in comment 6870125771.

## What changes and what does not

At **each of three 18, 20, 21 and 22 ARR/hour demand levels**, four matched
cases use exactly one immutable generated synthetic traffic manifest: LINEUP_BEHIND_LANDING (ELLX baseline) or
SEQUENTIAL_AFTER_RUNWAY_CLEAR (conservative sensitivity), each with
DISTANCE (8/10 NM APP–TWR planning request) or TIME (explicit
ARR→DEP→ARR physical timing) planning. Only the prescribed policy/sequence
changes between paired runs. Each case records source SHA, manifest hash,
event times, gap and slack, delays, censoring and binding reasons.

Conditional line-up can begin while the leader still occupies the runway,
but this is a **conditional positioning assumption**, not a modelled runway
entry or take-off clearance. The synthetic runway-entry and take-off roll
occur **no earlier than leader runway clear**. Required time is the maximum
of runway clear and line-up completion, plus roll-to-airborne time and
post-airborne buffer. Conservative sensitivity begins line-up only after
runway clear. Actual conditional line-up location/procedural safeguards are
not represented. No LVP, CAT I exception, runway exit or DEP–DEP gate rule
is implemented.

**B1/B2 corrected ARR–ARR delivery:** every follower (whether or not a departure
is proposed between arrivals) carries a frozen `effectiveTargetM` drawn using
the *exact A1.1 locked eight-parameter two-component distribution*
(SHA-256 `be55a9622ce770ea0f66bfdcc6d582f53948577c8e1f4bb4ffda72a7026a85fb`).
The A1.1 assignment function is reused, with per-flight normal and component
quantiles frozen in each manifest before scenarios run. Each follower's
required ARR–ARR time is at least the time needed to deliver its locked
equivalent track-miles target, and the existing surveillance/wake common-final
floor. After a departure, queued arrivals **cannot recover time by closing up
to the 3 NM surveillance floor** instead of the locked delivered spacing.
**B2 queue-conditional application:** each follower carries TWO immutable
preassigned targets from exactly the locked A1.1 mixture parameters and
the same stored normal: (1) full mixture, with the frozen tail/core draw;
(2) core-only. The simulation evaluates whether its original arrival
request time is strictly earlier than the earliest preceding-arrival
threshold time plus its core-spacing/hard-minimum time. If queued, the
core-only target applies; otherwise the original full-mixture target
applies. The decision precedes any departure-policy decision and
retains the same immutable alternatives across paired policies.
This is Claude's updated queue-pressure interpretation (moderate
confidence), **not independently observed runway/ATCO behaviour**.

**Observed validity gate:** Claude's approved ANA September evening
aggregate reports 20–21 IFR arrivals per hour on seven days, accompanied
by about three departures per hour, about two heavy. The conditional
line-up + DISTANCE case at **both 20 and 21 ARR/h synthetic demand**
is tested against an explicit observed-consistency gate: 19–21
modelled ARR/hour and **at least two modelled DEP/hour**. If either
condition fails, it is reported as `FAIL_OBSERVED_VALIDITY_GATE`;
**do not change the locked A1.1 parameters or assume validation**.
An independent high-demand arrival-only stress diagnostic reports a
core-queue-only saturation rate against Claude's approximate ~22 ARR/h
reference. The approximate value is a diagnostic, not a fitted target.

No retuning or fresh calibration is performed. The synthetic fleet mix also
reuses A1.1's **published pooled 4–2NM speed-sample frequency weights**
(including a representative heavy type), not the original equally-weighted
four-type first candidate. These frequency weights remain an imperfect
proxy for actual busy-bank traffic composition. Each demand-level report
records the share of frozen arrival targets raised by the synthetic hard
minimum and ROT proxy; this is distinct from the original A1.1 calibration
raise fraction of 1.06%. A1.1 remains a descriptive statistical
arrival-spacing baseline, not observed vectoring geometry.

Demand levels use **36, 40, 42 and 44 ARR requests over two hours** respectively,
equivalent to 18/20/21/22 ARR/hour, on separate seeded manifestations. The same
manifest is reused in all four policies for a given demand level; a separate
manifest is used at each demand level. A one-hour measurement window is
reported, with the full two-hour horizon and drain status also retained.
The new demand rates are scenarios, not a declaration of observed ELLX
demand or an achieved capacity level.

The four categories of interval are NOT the same as safety minima: the
8/10 NM values are planning requests and remain distinct from hard
surveillance/wake/physical protections. The follower's profile comes from
the frozen A1.1 speed-family helper; time at 8/10 NM is calculated from
the follower's individual IAS-proxy/wind, never from a constant sec/NM.
A1.1 effectiveTargetM is equivalent along-track distance to go, NOT actual
vectoring geometry.

The unobserved ground subevents (runway vacated, line-up, roll initiation)
are **SYNTHETIC_UNVALIDATED** assumptions. EUROCONTROL 2019 reported
ARR category ROT 66–109 seconds; CAPAN Dec 2025's 120 seconds is a
simulation assumption. Neither certifies local line-up/roll timings.
Assumptions in MECHANICS_ONLY.json are **examples**, not official limits.

## Reference checks, not calibration

The approved September 2026 busy-period development strata are:
- 8 NM non-heavy intervening DEP: 191 pairs, threshold interval P10 **162 s**,
  median 263 s
- 10 NM heavy intervening DEP: 51 pairs, interval P10 **179 s**,
  median 260 s

For each line-up sequence/category, report whether the **hypothetical
minimum feasible physical gap** is at or below the observed development
P10. Never tune to the observed median. A failed conservative sensitivity
is a diagnostic, not grounds to rewrite the source or lower a hard
protection. The independently published eight-day holdout values are
**report-only**: 8 NM P10 163.89 s (111 pairs), 10 NM P10 184.74 s (24
pairs), and neither is an A1.2 fitting target. All source records stay
internal; only Philip-approved pooled aggregates appear in the repository.

**All throughput, slack and delay comparisons are CONDITIONAL ON UNVALIDATED
GROUND-EVENT DURATIONS**, specifically arrival runway occupancy, conditional
line-up, take-off roll, post-airborne buffer and the illustrative 90-second
arrival deferral ceiling. No resulting difference is an established capacity
benefit. The generator deliberately creates demand, not measured 2026 traffic.
Arrival/departure rates are explicitly *synthetic realised movements per
measurement hour*, never a certification of technical runway capacity.
A missed departure opportunity is censored, not dropped. Runway-event
timings have no independent observational validation and the model
does not identify the real ELLX controller's decisions.

## Reproduction (Node >=20, clean full-history clone)

    node --test study/*.test.mjs
    node --test study/a11/*.test.mjs
    node --test study/a12/*.test.mjs
    node study/a11/validate-cli.mjs --out /tmp/a11-sealed-holdout.json
    node study/a12/cli.mjs --out /tmp/a12-first-candidate.json

The CLI creates a deterministic report **outside the repo**. No model or
calibration-lock files are changed. A1.1 history must include the original
lock-writing commit (checkout fetch-depth: 0) for its sealed holdout CLI.
A1.1 source lock SHA-256 remains
be55a9622ce770ea0f66bfdcc6d582f53948577c8e1f4bb4ffda72a7026a85fb.

## Scope and limitations

One DEP opportunity per selected adjacent ARR pair; no multi-runway
intersection modelling, runway-entry taxi physics, controller workload,
taxi queue, departure-to-departure constraints, capacity declaration
or movement-file replay. A requested departure that cannot fit without
exceeding the configured maximum ARR deferral is counted as a
missed/censored opportunity. Every arrival-only pair retains the locked A1.1
spacing requirement, independent of acceptance of departures. Physical and planning slack are recorded
separately. Per-flight aircraft and requested-event times are generated
synthetically. This is a first candidate for independent review, not
operational approval.
