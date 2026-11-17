# B3: RWY24 CAT II/III LVP leader-type spacing sensitivity

**NON-OPERATIONAL HYPOTHETICAL PROCEDURE STUDY.** Approval: [Philip plan #6925949716](https://github.com/ellxapp/panel/issues/6#issuecomment-6925949716) and [Claude analytic L2 recommendation #6925987977](https://github.com/ellxapp/panel/issues/6#issuecomment-6925987977). Branch from `main c11ca1c`. This does not amend **P-ATC-LVP**, permit spacing below 10 NM, validate runway capacity, or establish an acceptable go-around risk.

## Source and geometry

Latest [exit correction #6925893435](https://github.com/ellxapp/panel/issues/6#issuecomment-6925893435) supersedes earlier assignments: TP and medium jet **D2 or E** (default equal 50/50), HEAVY **E/G/runway end** (default 1/3 each). Named sensitivity extremes are all D2/all E for TP/medium and all E/all end for heavy; G remains a central-value exit. The exit is chosen from an immutable flight quantile, independent of the policy. No exit/flight tracks or private FRACS data are in the repository.

CASA tail clearance is when the tail leaves the **±140 m strip** on the exit. The unvalidated chart-based central estimates are D2 **85 s** (2050 m), E **97.5 s** (2430 m), G **117.5 s** (3240 m), and runway end **135 s** (3950 m). The chart-derived geometry carries ±30 m uncertainty. `T_clear` is **distinct** from A1.4's unvalidated **90 s runway-vacated** event. Clearance times are drawn from **uniform ±25% around the *actual* exit's central T_clear**, with an additional multiplicative **0.75, 1.00, 1.25 sensitivity**. R2 adds a separate **unvalidated missed-next-exit Bernoulli tail p_miss = 2%, 5%, 10%**: D2→E, E→G, G→runway end, runway end→runway end (no further defined exit). Draws are frozen once per aircraft, common to every policy. Planned and actual exits are reported separately. These are named modelling assumptions, **not FRACS observations**.

## Policies and physical gate

- **L0** is the A1.4 10 NM planning baseline with post-runway-vacate departure entry and 10/15 NM departure holding restrictions. The A1.4 simulator is independently replayed read-only for validation. The B3 L0 output additionally records synthetic leader exit/CASA timing and checks the follower at 2 NM.
- **L1** is a fixed class table. Each leader class's clearance requirement is **the deterministic upper bound of its full T_clear mixture**, including the possible missed-next-exit tail and ±25% spread. Under the stated bounded synthetic model this makes **zero CASA go-arounds by construction** for L1, before other runway constraints; it is not a real-world safety guarantee. For each follower, the minimum threshold interval includes **its own 2 NM-to-threshold time** at the A1.1 type-specific low-final speed. Equivalent follower distance uses **160 kt outside 4 NM**, then the type low-final speed. The table is fixed before simulation; actual exit and clearance draws cannot alter its sizing.
- **L2** is analytically sized *before the simulation*. For leader class `C` and declared target `p` in **1%, 0.5%, 0.1%**, the table's clearance requirement is the **(1 − p) quantile of the explicit class-wise planned/missed-exit mixture T_clear CDF**, plus the follower's 2 NM time. The simulation **does not tune** the L2 table to realised outcomes. It only reports realised CASA go-arounds and **two-sided exact Clopper–Pearson 95% intervals**, with exposed attempts and original arrivals distinguished. Rare 0.1% events are not statistically established by 50 seeds.

For all policies, independently enforce the larger of 3 NM surveillance and ICAO wake thresholds, runway occupancy, the heavy-critical-area 12 NM trigger for explicitly occupied critical areas, and departure passage only **after runway vacated** with next inbound outside **10 NM medium / 15 NM heavy**. A CASA occupied-at-follower-2-NM event produces a **recorded missed approach and synthetic 900 s reentry**, not an unreported spacing reduction. Original flight/request IDs and attempted movements are kept separate from completed landings. CAT II/III protection is the default; never infer CAT I-only from weather.

## Runs / diagnostics

50 identical manifest seeds per comparison. **N1: headline winter request levels** **10/12/14/16 ARR/h** and a separately tagged **20 ARR/h saturation probe**, each at **0 or 2 DEP/h**. `L0/L1/L2` × **3 missed-exit probabilities** × **3 T_clear sensitivity scales** × **5 exit-mix assumptions** with **3 L2 target probabilities**. Two-hour demand, one-hour measurement from 0.5h to 1.5h and a separate drain to 4h. The result includes per-seed original request conservation, served-by-drain counts, arrival/departure hourly rates, mean/P90 arrival delay, spacing and time-gap summaries, per-policy leader tables, go-around counts and exact binomial intervals, departure restriction binding, paired differences with bootstrap 95% intervals and immutable manifest/config hashes.

Descriptive references only: winter fog **10.01 NM / 304 s**, A1.4 synthetic saturated about **16/h** with constant 160 kt and a 10 NM floor, CAPAN **13–14/h**, and A1.4's unresolved **L4 model-assumption conflict** (mixed observed P10 266 s below illustrative 315 s medium feasibility). Distinct populations are not calibration proof. There is no validated LVP declaration dataset, independently measured T_clear, go-around rate, operational safety approval, workload estimate or certified capacity here.

## Reproduce

In a clean Node 22 Git checkout:

```sh
node --test study/b3/*.test.mjs
node study/b3/cli.mjs --out /tmp/b3-lvp-leader-spacing.json
```

The CLI prevents writing its artifact to the repository. Reproduce A1.4 without changing its lock or defaults with `node --test study/a14/*.test.mjs`. The full CI repeats all Stage A, B1, B2 and B3 test suites. No merge/deployment before independent review.

## PR #8 review R1/R2/N1

Claude's [PR review pullrequestreview-5925985825](https://github.com/ellxapp/Lux-app/pull/8) requires a conservative L1 comparator, a physically interpretable missed-exit tail and a winter-demand headline. With `p_miss > 0`, each leader class L1 table uses the maximum upper endpoint across all planned/missed-exit pathways. L2 is **not** chosen by observing simulation outcomes: the class table uses analytic inversion of the exact finite mixture (base exit weight `(1-p_miss)/n`, next-exit weight `p_miss/n`), evaluated at `1-target`. The fixed 10 NM L0 continues to be an A1.4 comparator, but actual synthetic CASA events and resulting go-around delays under missed-exit tails may make its outcomes differ from the original A1.4 reference. Report this explicitly rather than claiming unqualified A1.4 equality.

The user-facing headline compares the **10, 12, 14 and 16 ARR/h** winter levels at **0 and 2 DEP/h**, across `p_miss = .02/.05/.10` and L0/L1/L2. The 20 ARR/h saturated case is reported separately and does not represent observed winter traffic. Every reported go-around percentage has a **two-sided exact Clopper–Pearson 95% interval**, with exposure counts; these intervals do not account for cluster dependence or real LVP conditions. The full scenario artifact retains the three clearance-time scales and all five exit-choice scenarios.
