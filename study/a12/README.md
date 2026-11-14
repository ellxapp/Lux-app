# Stage A1.2: time-based ARR–DEP–ARR gap mechanics

**MECHANICS_ONLY_UNVALIDATED**. Offline synthetic decision-support experiment, not
an ELLX runway-clearance, safety, separation or technical capacity model.

Design approved in [panel #6 plan v2, comment 6870153540](https://github.com/ellxapp/panel/issues/6#issuecomment-6870153540),
with Philip's conditional-line-up decision in comment 6870125771.

## What changes and what does not

Four matched cases use exactly one immutable generated synthetic traffic
manifest: LINEUP_BEHIND_LANDING (ELLX baseline) or
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

The generator deliberately creates demand, not measured 2026 traffic.
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
missed/censored opportunity. Physical and planning slack are recorded
separately. Per-flight aircraft and requested-event times are generated
synthetically. This is a first candidate for independent review, not
operational approval.
