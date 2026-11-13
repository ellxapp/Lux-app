# Stage A: isolated synthetic Study core

NON-OPERATIONAL. This offline model is separate from Lux-app Demo/Score/Race/Live.
It is NOT calibrated to ELLX, contains no controller workload model, and must
not be used for operational spacing, runway release or capacity decisions.

Requires Node >=20 and git, run from a clean checkout:

    node --version
    node --test study/*.test.mjs
    node study/cli.mjs --config study/presets/SYNTH.json --out /tmp/lux-stage-a --count 30
    node study/cli.mjs --config study/presets/EUROCONTROL_2018.json --out /tmp/lux-2018 --count 30 --departure-modulo 0

The CLI refuses dirty checkouts unless --allow-dirty is given. Outputs
manifest.json, summary.json, events.json and flights.csv contain the full
commit SHA, Node runtime, scenario provenance, a UTC origin and input digests.
CSV uses UTF-8 and RFC4180 double-quote escaping with CRLF line endings.
The per-flight CSV includes `slaInfringement`: a negative planning-spacing
margin by itself leaves the movement **served**, records an SLA infringement,
and makes the run ineligible for capacity claims. Only safety-constraint
violations generate a go-around. A censored flight remains in the queue
when its runway-event demand is in the past and it is not yet served.
Use `--departure-modulo 0` for arrival-only demand; 4 is the default mix.
Times are integer ms from startUtc; distances are integer metres in configs
(1 NM = 1852 m). Intermediate simulation positions are floating-point and
are rounded before recording. UTF-8 byte ordering breaks demand-time ties.
Manifest generation uses xorshift32; the runner never uses randomness.

ARR requestMs is demand at an upstream control point. Holds can occur before
the point, never at the threshold. A piecewise IAS/headwind speed profile
determines threshold passage. An immutable manifest deliveryErrorMs can shift
the actual threshold time after the control point; unresolved conflicts create
a go-around, not a hold. No go-around re-entry is modelled.

Independent constraints are logged as margins at explicit events:
(1) SLA-like follower distance at leader threshold; (2) minimum common-final
surveillance and wake distance, approximated at 250 ms intervals; (3) runway
protected-area clear and departure airborne before follower threshold; and
(4) LVP sensitive-area clear when follower reaches a chosen reference gate.
Departures separately record runway entry, airborne, protected-area clear and
sensitive-area clear. No taxiway network, actual winds, controller actions,
voice coordination, aircraft performance, exit behaviour or manoeuvres exist.

Each flight is terminally served, censored, rejected or go-around.
Measurement counts use [measurementStartMs,measurementEndMs); remaining
flights at the drain deadline are censored. Capacity eligibility requires
zero safety violations, go-arounds or rejects AND continuous backlog in the
measurement window; all other rates are demand-limited or infeasible.
Sector entries here are only synthetic demand/processed counts. Declared
capacity is input-only, never inferred. Compare arrival-only and mixed
arrival rates separately.

Historical presets contain citations and **synthetic approximations**:
EUROCONTROL_2018 cites EUROCONTROL, Evaluation de la capacité aéroportuaire,
Luxembourg Findel, edition 1.0, 27 June 2019, summary p1, §5.3 p31,
Tables 6-7 pp38-39, and Annex A1.4 pp51-60. Benchmark observed technical
arrival-only capacity 21.2/21.3 movements/h and combined 22.0/22.7 for
RWY06/RWY24. The included 87.5 s ROT is an illustrative midpoint of the
66-109 s category-MEAN range, NOT measured ROT by aircraft or a probability
distribution; other unspecified inputs are also synthetic.

CAPAN_2025 cites EUROCONTROL Luxembourg TMA CAPAN Final Results Report,
8 December 2025, §4 p18 and §6-7 pp39-42. Its published timing values
were simulation assumptions, not verified current APP-TWR rules. Study
is NOT a recreation of RCAPAN, and cross-model capacity differences are
not controller workload costs. CURRENT_2026 remains an uncommitted local
config until signed procedures are verified.

index.html, relay-worker.js, README.md and .nojekyll must have zero diff
against the base. The existing Demo generator uses unseeded random schedule
construction; its event-log hash cannot be reproduced without a later harness.
Fixtures contain only SYN synthetic identifiers. Privacy scan scope:
actual callsigns, registrations, ICAO24 addresses and operational datasets.
The entire study/ directory becomes public if deployed via GitHub Pages.

## Explicitly deferred to Stage A.1

- Per-type/category speed profiles for fleet-mix and FTD/ITD comparisons.
- RWY 24 LVP heavy-vacating behaviour: the flag is configuration-only.
- A 2018 technical-capacity discrepancy report. The illustrative model
  produced about 32 arrivals/h arrivals-only versus EUROCONTROL's historical
  observed 21.2–21.3/h; this discrepancy is **not calibrated away**.
- Distinct binding-margin tolerances in metres and milliseconds. Both are
  currently 1000 in metadata and should not be interpreted as equivalent.

Historical preset inputs beyond the precisely attributed items are synthetic,
not certified operational settings. In particular the CAPAN_2025 preset's
80s/240s effective intervals are *unsourced synthetic* model inputs and do
not reproduce CAPAN's cited 120-second assumptions.
