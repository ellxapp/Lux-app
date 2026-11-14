# Stage A1.1: development-only synthetic arrival fit (PR candidate)

NON-OPERATIONAL. This is an *isolated model of equivalent track distance to go*,
NOT a reconstruction of actual vectoring or ATCO decisions. Its outputs are
**not ELLX capacity, separation approvals, procedures or safety assessments**.

Source decisions: ellxapp/panel#6 comments **6868095627**, **6868190637**,
**6868452613**, **6868493243**, **6868718102**, **6868863680**.
Claude's final correction **retains ALL TWELVE hard metrics**. In particular
the threshold-to-threshold interval median remains hard.

## Data permission, sources and observation model

Only the publication-approved *pooled* development table is committed:
study/benchmarks/sep2026-dev-busy12.json. The ANA September movement file,
annex A1–A7 scripts, raw/wide ADS-B and private exports are held in Philip's
Google Drive folder "ELLX spacing study (ANA Tech)" and are **not** in this
repository, CI or artifacts. Claude alone produces any further pooled
aggregates. The eight September holdout days are reserved and no holdout
values are included.

Observation operator: consecutive arrivals, both runways, threshold gap
≤900s, busy test of at least 12 IFR arrivals in a rolling [s,s+3600s)
window (event-based candidate starts as described by Claude). A takeoff
between the two arrivals at ANA act_date_d +30s gives the 8NM/10NM regime,
with any heavy MTOW≥136t taking precedence; otherwise the 5NM regime.
Distance requires corridor/15NM capture; **intervals are retained when
distance is missing**. The included empirical probability table models
the observed non-final capture by threshold interval, not actual
vectoring geometry. Each capture decision uses a stored random quantile
from the immutable synthetic manifest. Label: CAPTURE_EMPIRICAL_SEP2026_DEV.

Time and distance measurements have different denominators. The old
25-day evening-bank figures are NOT_FOR_FIT. The new busy12 population
includes qualifying times throughout the day, mainly morning, afternoon
and evening. Fitted good-weather September data do not calibrate LVP,
high winds, runway-exit usage or controller workload.

The fitted effectiveTargetM represents the follower's **equivalent track
distance to go** at leader threshold, label
TARGET_AS_EQUIVALENT_TRACK_DISTANCE. It is *not* geometrical
distance to threshold while vectoring. Final approach segment speeds are
published 4–2NM IAS *estimates* from ADS-B GS + METAR wind and an approximate
TAS-to-IAS conversion; they are NOT stabilised approach speeds.
The speed profile carries a documented 180kt to 6NM /160kt to 4NM
draft-SLA assumption before that estimated segment.

The target distribution is shifted-lognormal, with shared shift/sigma and
class mu for J-J, J-TP, TP-J. TP-TP mu is fixed from a report-only pooled
median. Type draws are independent with approximately 29% turboprop;
sequence correlation is not inferred. The manifest stores per-flight
normal and capture quantiles; runs are deterministic and draw no randomness.
Named preset study/a11/SEP2026_FITTED.json explicitly fixes the historical
3NM surveillance floor, ICAO PANS-ATM wake matrix, observation/capture labels
and 5% target-raise threshold. This is not a CURRENT_2026 operational preset.
Hard surveillance 3NM and ICAO PANS-ATM category wake minima are never
lowered. Target-raising to a hard minimum is counted; >5% produces
FIT_NOT_REPRESENTABLE. A negative APP–TWR SLA planning gap is a
diagnostic and not itself a go-around.

## Fit commands (from clean checkout, Node >=20)

    node --version
    node --test study/*.test.mjs
    node --test study/a11/*.test.mjs
    node study/a11/fit-cli.mjs --candidate-out /tmp/a11-lock.candidate.json --days 110 --per-day 60 --rounds 8
    node study/a11/2018-cli.mjs /tmp/a11-2018-discrepancy.json

The command reads ONLY the published approved development aggregate file.
It refuses a dirty tree unless --allow-dirty is recorded. It writes an
**unapproved candidate** outside the repository, not calibration-lock.json.
The candidate reports model source commit, Node version, source and capture
digests, all 12 dev metric fits, parameters, 20k day-bootstrap *metadata*
and previously approved fixed tolerances. The actual bootstrap was run
by Claude on private day-cluster records and cannot be reconstructed
from pooled aggregates. No holdout data are read.

Hard metrics: overall 5NM distance median/P10/P90, fraction below 5NM,
threshold interval median/P10; J-J, J-TP, TP-J distance median and below-5NM
fraction each. All twelve are mandatory. Exact fixed Bonferroni-adjusted
tolerances are in the committed development benchmark. The minimum hard
metric error normalised to tolerance is an optimisation objective;
this remains a *descriptive fit*, not a capacity or causal estimate.

**Lock protocol:** Claude reviews the *candidate* fit and parameters, then
Philip explicitly approves committing calibration-lock.json. A future
approved lock must be marked APPROVED_LOCK and committed before
holdout validation is enabled. Only *after that commit*, Claude produces
and posts the approved pooled holdout aggregates using the same extraction
scripts. The validator requires the committed lock and checks all hard
metrics read-only with sample sufficiency. Do not move holdout dates,
retune parameters or treat an insufficient/failing holdout as a pass.

The 2018 reference module distinguishes observed/optimal variants of
EUROCONTROL technical capacity (AA arrivals-only and DD/ADA/Combined
total movements). Its numbers are a discrepancy report, **not fit targets**.
Without a like-for-like mode, validated runway physics and continuous
demand saturation, comparisons are marked NOT_COMPARABLE.

## Known limitations for review

- Runner is a simplified *equivalent-track-distance* population model,
  not a full final-vectoring geometry/replay or CAPAN workload model.
- Synthetic good-weather runway demand and type mixing are constrained
  approximations; matching pooled statistics cannot identify the
  controller's selected target, coordination or a delivery-error process.
- The empirical capture table uses all-weather 5NM pairs, while the
  numerical fit targets are good-weather only; this is an explicit
  transfer assumption requiring validation.
- Neither 2018 synthetic-versus-technical capacity nor planned A1.2–A1.4
  interventions are calibration targets. No calibration-lock.json exists
  at this stage.
