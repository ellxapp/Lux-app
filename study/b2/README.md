# Stage B2b: TMA sequencing-support sensitivity (review-only)

**NOT OPERATIONAL / NOT A CERTIFIED CAPACITY ESTIMATE.** Candidate on `b2-sequencing`, based on `main 102d02b`. See ellxapp/panel issue #6: B2a [6921599723](https://github.com/ellxapp/panel/issues/6#issuecomment-6921599723), [6921795946](https://github.com/ellxapp/panel/issues/6#issuecomment-6921795946), Claude's S0 guidance [6922243126](https://github.com/ellxapp/panel/issues/6#issuecomment-6922243126), and actual TMA-boundary addendum [6922589286](https://github.com/ellxapp/panel/issues/6#issuecomment-6922589286). CLKEX in ANA is displayed as **RITAX (Brussels sector)** per comment 6922696104; the raw field remains CLKEX.

## Gate sequence, no bypass

1. Construct aggregate-only synthetic S0 streams at a 40 NM ring, with ANA entry-fix mix, a single runway direction per synthetic two-hour run and an 80/20 RWY 24/06 cross-run mixture. An aircraft's ELDT is ring entry plus entry-fix/runway P10 reference and explicitly unvalidated non-delay jitter.
2. Sort by ELDT. Attach A1.2 aircraft type/wake and **unchanged locked A1.1** draws to ELDT ranks, preserving the existing A1.2 event ordering and adjacent departure requests.
3. Feed **that ordered request stream** to the unmodified A1.2 scheduler (conditional line-up; DISTANCE or TIME). Arrival threshold minus the original ELDT is recorded as excess over P10, not proven ATC delay.
4. Fit **S0 only**: median 40 NM excess in each five ANA demand band within ±30s; 40 NM landing-pair inversion share within ±4 percentage points of 68/549, and declared entry/runway/transition mix tolerances. This is **in-sample reproduction**, not holdout validity.
5. `requireS0Gate` blocks *all* S1/S2 and joint B1 candidate generation unless all required S0 metrics are present and PASS. The CLI exits nonzero on failure.
6. At the exact same paired demand/flight draws, test S0/S1/S2, each without/with B1-P1 only, at 20/22/24/30 ARR/h, DISTANCE and TIME, 50 paired seeds and 1000-replicate 95% paired bootstrap intervals. One-hour throughput and by-drain counts are reported separately.

## Scope and provenance

The 40 NM ring is **not the actual TMA boundary**; it is used for the original B2a S0 calibration. For intervention horizons, the later B2a actual-TMA-boundary analysis supersedes it: source P10 TMA transit is BITBU 279s, RMS 276s, GIVOR 452s, CLKEX/RITAX 582s, MMD 662s (RWY 24). S1 horizon is **at TMA entry**, or **8 min** or **5 min** before ELDT, *capped at TMA entry*. The short BITBU/RMS flows cannot enjoy eight minutes of TMA-only preparation. Runway 06 and less-observed fixes use source-labelled **UNVALIDATED** transit assumptions; no invented observed values are asserted.

S0 uses *no tactical-swaps-to-fit*. The difference between ring-entry order and ELDT landing order arises from entry-fix P10 differences and demand timing. S0's fitted synthetic input includes explicit three-aircraft arrival clusters, and a particularly smooth 20 ARR/h stream; this should **not** be mistaken for an observed sequencing practice. Different plausible synthetic clustering choices may change the gain estimate. The B2a 20+ stratum is a **small sample**.

For an arrival above its unimpeded P10: S0 allocates excess to transition path stretch first, within the B2a P90/published path envelope, then holding; vectored flows have no *published transition* envelope, but the simulator imposes a **declared arbitrary 8 NM physical TMA feasibility cap**, then counts remaining delay as holding. Path distance conversion uses an **unvalidated 150 kt equivalent**. No controller workload, holding-stack volume, or weather is independently calibrated.

S1 fixes target times at the declared causal freeze instant, with a bounded hypothetical speed-delay budget first, then path stretch, then holding. It reports freeze conflicts rather than retroactively claiming all plans can be executed. Improvements to join lead distance and delivery spread are **UNVALIDATED** hypotheses and affect the **existing B1-P1** opt-in callback. S2 may additionally swap adjacent unfrozen flights when type/wake timing advantages exceed a declared threshold and both aircraft have physically entered the TMA. Maximum displacement is one position; it never assumes unrestricted airborne overtakes. S2 uses the **same locked A1.1 parameters and flight-level random draws**, reassigning the pair-dependent locked targets after a real hypothetical order change; no calibration is refitted.

The B1-P1 current 5 NM SLA and coordinated 4-5 NM arrangements are unchanged; B1-P2 and TBS are **excluded**. Arrival hard wake/surveillance minima, the frozen A1.1 lock and all A1.2 runway/departure timing logic are unchanged. The 75s ROT and departure assumptions remain synthetic.

## Reproducible commands

```sh
node --test study/b2/*.test.mjs
node study/b2/cli.mjs
node study/b2/candidate-cli.mjs --out /tmp/b2-sequencing-candidate.json
```

CI runs the complete Stage A/B1 regression suite plus B2 tests; the rapid B2 job writes an **aggregate-only** JSON artifact to Actions. **No raw ANA or ADS-B tracks enter Git, CI logs or the artifact.** The candidate must be reviewed by Philip and Claude before merging. A successful *calibration* gate is not evidence that AMAN or final-approach spacing will produce the simulated output in ELLX operations.
