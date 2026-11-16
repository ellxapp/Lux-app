# Stage B1: final-approach spacing-tool sensitivity

**NON-OPERATIONAL / HYPOTHETICAL / NOT VALIDATED FOR ATC.** Approved by Philip in panel issue #6 following [B1 plan #6917392204](https://github.com/ellxapp/panel/issues/6#issuecomment-6917392204) and [Claude addition #6917463722](https://github.com/ellxapp/panel/issues/6#issuecomment-6917463722). No observed ELLX spacing-tool performance is available. P2 is an **unapproved hypothetical procedure**, not an available operating option.

## Mechanics and frozen references

The only integration with the previous model is an **optional, disabled-by-default** callback in the Stage A1.2 event scheduler. All earlier default execution paths, the A1.1 locked eight-parameter mixture, its calibration lock, synthetic request generation and FIFO departure/line-up mechanics remain unchanged. B1 uses the A1.1 locked core when the A1.2 queue-conditional gate selects core; never adjusts nonqueued tail arrivals. Baseline is `r=0` with the callback **absent**, allowing an exact decision-level A1.2 regression comparison. A1.2's existing departure options `LINEUP_BEHIND_LANDING` and `DISTANCE`/`TIME` are reused. The A1.2 synthetic lineup and ground timings are **not measured ELLX clearances**.

For an eligible queued pair, `original` is the frozen A1.1 core effective target. `floor` is the larger of the P1 **5 NM** indicator target and hard minima (or, for **P2**, the hard minimum only). The tool decreases the positive buffer by `r` = 0/25/50/75% and adds nonnegative residual spread `s` = 0/0.3 NM, capped at the original target and never below the floor. Both spread levels are **declared sensitivity assumptions**, not empirical tool precision. The scheduler independently keeps 3 NM surveillance, the locked ICAO wake matrix, common-final minima, and arrival runway occupancy/ARR–DEP–ARR timing. ROT is an illustrative **75s A1.2 default**; the 66–109s context is not a measured ELLX category-specific ROT distribution. TBS is out of scope.

## Join observability and meaning of J

Source `OBSERVED_SEP2026_DEV_JOIN`: Claude's ADS-B September development aggregate, **1,857 arrivals** first seen established inside a 1 NM / 25° corridor, distance capped at 15 NM; flight tracks are not included in this repository. Quantiles P10/P25/P50/P75/P90: **7.9 / 8.6 / 9.0 / 10.7 / 13.6 NM**. Reported established by 8/10/12 NM: **89/30/16%**. The model uses a labelled **piecewise-interpolated inverse CDF** (not the raw empirical distribution) with knots enforcing these aggregate proportions. It excludes joins below 6 NM, consistent with the observation's capture boundary, not a claim that they never occur.

The join is sampled **once per follower in the immutable manifest**. `J=6/8/10 NM` means the **required tool lead distance**. A follower is tool-reachable when its preassigned join distance is **at least J**; J is **not** the join itself. The approximate 40% still vectored at leader landing is background context, not a calibration target.

## Scenario and output specification

The sweep is **20/22/24 ARR requests/h plus saturated 30 ARR requests/h plus saturated 30 ARR requests/h × 3 DEP/h including 2 heavy × DISTANCE/TIME × P1/P2 × J 6/8/10 × r 0/.25/.50/.75 × spread 0/.3**, using **50 shared seed manifests** per paired comparison. The original A1.2 two-hour demand, 30-minute warm-up, one-hour measurement window and subsequent drain are preserved. The same aircraft, immutable locked targets, departure requests, join distances and spread quantiles feed baseline and treatment; no independent stochastic draws occur during scheduling.

Each cell records served ARR/h and DEP/h, measured-window mean and P90 arrival delay, censored requests, tool reachability among all and queued pairs, acted-pair counts, ROT/hard-minimum binding diagnostics, under-target flags and paired treatment-minus-baseline mean differences with **95% bootstrap intervals**. Each cell includes per-seed manifest digests and never makes an approved-capacity claim. The prior **+3–4 ARR/h** estimate is a **sanity upper bound only**, not a fit target. Results can be demand-limited, throughput-neutral or negative; these outcomes are to be reported rather than tuned away.

**Known limitations:** the join CDF is reconstructed from aggregate percentiles, A1.2 aircraft-type samples are pooled speed-sample weights, runway and departure timing remain synthetic and unvalidated, and the model has no measured intervention effectiveness. A1.2's conditional line-up is illustrative and does not independently certify operational release procedures. The `measurement` output counts movements in a one-hour window, **not proven runway capacity**. P1's coordinated 4–5 NM arrangements are not automatically changed; P2 must never be presented as operationally authorised.

## Reproduction

In a clean Node 22 checkout:

```sh
node --test study/a11/*.test.mjs study/a12/*.test.mjs study/a13/*.test.mjs study/a14/*.test.mjs study/b1/*.test.mjs
node study/b1/cli.mjs --out /tmp/b1-spacing-sensitivity.json
```

The CLI rejects operational/fit flags and repository output paths, requires a clean tree and embeds the commit and input hashes. Until the CLI and tests have been executed on this branch, **no numerical benefit or PASS status is claimed**.

## Claude PR #6 review additions: R1 and N1

[Review 5922218912](https://github.com/ellxapp/Lux-app/pull/6) accepted the initial B1 mechanics but found the tool's 24 ARR/h results demand-capped, so apparent policy/r convergence did not establish its saturated limit. **R1** adds a separately tagged **30 ARR/h synthetic request** case to the *same* paired matrix, for both P1/P2, J=6/8/10, every r and residual spread and both DISTANCE/TIME departure-gap modes. This is a **synthetic served-measurement-hour throughput under saturated requests**, NOT an approved capacity. Each saturated cell explicitly gives baseline and tool mean ARR/h, paired delta and 95% interval; the earlier +3–4 ARR/h idea is a comparison bound rather than an enforced output.

**N1** adds `servedArrivalsByDrain` and `servedDeparturesByDrain` to paired-difference keys with 95% intervals, plus baseline and treatment means; censored arrivals/departures and original request conservation remain separate. A slightly negative one-hour count can reflect arrivals crossing the *measurement-hour boundary* earlier, not necessarily fewer requests served by drain. Report BOTH quantities without treating these populations as interchangeable.

The 30/h scenarios have **60 synthetic arrival requests over two hours**, **six synthetic departure requests (four heavy)**, a 30-minute warm-up, one-hour measurement window and a separately defined post-demand drain. All other fixed A1.1/A1.2 mechanics, manifest draws, rules and non-operational warnings are unchanged.
