import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonical,digest} from '../core.mjs';
import {DEFAULT_CONFIG,validateConfig,makeManifest,validateManifest,timeline,
 feasibility,simulate,pairedScenarios,minArrivalThresholdGapMs,
 CONDITIONAL,SEQUENTIAL,DISTANCE,TIME,APPROVED_A11_LOCK_SHA256,A11_SPACING_PROVENANCE,
 configForDemandLevel,compareDemandLevels,observedValidityGate,coreOnlySaturationDiagnostic,replicateComparison} from './model.mjs';
import {profileFor,timeToGoMs,assignEffectiveTargets,APPROVED_TYPE_WEIGHTS} from '../a11/model.mjs';
const clone=x=>structuredClone(x);
const simpleArr=(id,requestMs,type='B738',wake='M',headwindKt=0)=>
 ({id,kind:'ARR',requestMs,type,wake,headwindKt,runway:'24'});
const simpleDep=(id,leader,follower,category='MEDIUM_JET',requestMs=0)=>
 ({id,kind:'DEP',requestMs,betweenLeaderId:leader,followerId:follower,category,
   type:category==='HEAVY_JET'?'B744':'B738',wake:category==='HEAVY_JET'?'H':'M'});
const lock=JSON.parse(readFileSync(new URL('../a11/calibration-lock.json',import.meta.url),'utf8'));
const synthetic=(arrivals,departures=[])=>{
 const input=arrivals.map(a=>({...a,targetNormal:0,componentQuantile:1,captureQuantile:.5}));
 const assigned=assignEffectiveTargets({schema:11,synthetic:true,flights:[input]},lock.parameters);
 const core=assignEffectiveTargets({schema:11,synthetic:true,
  flights:[input.map(a=>({...a,componentQuantile:1}))]},lock.parameters);
 return {schema:12,synthetic:true,seed:DEFAULT_CONFIG.seed,
 startUtc:'2026-01-01T00:00:00.000Z',arrivals:assigned.flights[0].map((a,i)=>({...a,
  coreTargetM:core.flights[0][i].effectiveTargetM,
  coreTargetSource:'A11_LOCKED_CORE_SAME_NORMAL',
  arrivalSpacingSource:A11_SPACING_PROVENANCE.distribution})),opportunities:departures,
 a11LockSha256:APPROVED_A11_LOCK_SHA256,a11ParametersSha256:digest(lock.parameters),
 a11FleetWeightsSha256:digest(APPROVED_TYPE_WEIGHTS)};
};
test('A12/E1: named partial order allows line-up to overlap ROT; roll not before clear',()=>{
 const t=timeline(100000,100000,'MEDIUM_JET',CONDITIONAL);
 assert.equal(t.arrivalRunwayClearMs,175000);
 assert.equal(t.departureLineupStartMs,100000);
 assert.equal(t.departureLineupCompleteMs,150000);
 assert.equal(t.departureRunwayEntryMs,175000);
 assert.equal(t.departureRollStartMs,175000);
 assert.equal(t.departureAirborneMs,230000);
 assert.equal(t.followerPhysicalMinimumMs,250000);
 assert.equal(t.requiredGapMs,150000);
 assert.equal(t.flags.departureRollStartsAfterArrivalClear,true);
});
test('A12/E1: delayed conditional lineup completes after clear; uses max event rule',()=>{
 const c=clone(DEFAULT_CONFIG),t=timeline(100000,160000,'MEDIUM_JET',CONDITIONAL,c);
 assert.equal(t.arrivalRunwayClearMs,175000);
 assert.equal(t.departureLineupCompleteMs,210000);
 assert.equal(t.departureRollStartMs,210000);
 assert.equal(t.requiredGapMs,185000);
});
test('A12/E1: conservative sensitivity sums ROT, lineup, roll, buffer',()=>{
 const c=clone(DEFAULT_CONFIG),t=timeline(100000,100000,'MEDIUM_JET',SEQUENTIAL,c);
 assert.equal(t.departureLineupStartMs,175000);
 assert.equal(t.departureRollStartMs,225000);
 assert.equal(t.requiredGapMs,200000);
 assert.equal(t.flags.conditionalLineupSyntheticAssumption,false);
});
test('A12/E2: baseline heavy has longer roll than medium and cannot roll before clear',()=>{
 const medium=timeline(0,0,'MEDIUM_JET',CONDITIONAL);
 const heavy=timeline(0,0,'HEAVY_JET',CONDITIONAL);
 assert.equal(heavy.requiredGapMs-medium.requiredGapMs,15000);
 assert.ok(heavy.departureRollStartMs>=heavy.arrivalRunwayClearMs);
 assert.ok(heavy.departureRunwayClearMs<heavy.followerPhysicalMinimumMs);
});
test('A12/E2: minimum common-final floor changes with wake category, never zero',()=>{
 const a=simpleArr('A',0,'B744','H'),b=simpleArr('B',100000,'DH8D','M');
 assert.ok(minArrivalThresholdGapMs(a,b,DEFAULT_CONFIG)>0);
 const c=simpleArr('C',0),d=simpleArr('D',100000);
 assert.ok(minArrivalThresholdGapMs(a,b,DEFAULT_CONFIG)>=minArrivalThresholdGapMs(c,d,DEFAULT_CONFIG));
});
test('A12/E3: distance request depends on follower IAS and wind',()=>{
 const d=8*1852;
 assert.ok(timeToGoMs(d,profileFor('DH8D',0))>timeToGoMs(d,profileFor('B738',0)));
 assert.ok(timeToGoMs(d,profileFor('B738',12))>timeToGoMs(d,profileFor('B738',0)));
});
test('A12/E4: reproducible immutable manifest and four paired policies',()=>{
 const c=clone(DEFAULT_CONFIG);c.arrivalCount=18;c.departureEvery=2;
 const m=makeManifest(c),frozen=canonical(m);
 const a=pairedScenarios(m,c),b=pairedScenarios(m,c);
 assert.equal(canonical(a),canonical(b));
 assert.equal(canonical(m),frozen);
 assert.equal(a.scenarios.length,4);
 assert.equal(new Set(a.scenarios.map(x=>x.meta.manifestSha256)).size,1);
 for(const s of a.scenarios)
  assert.equal(s.totals.demand,s.totals.served+s.totals.censored+s.totals.rejected+s.totals.goArounds);
});
test('A12/E4: invalid IDs, opportunistic pair and private/non-synthetic inputs rejected',()=>{
 const c=clone(DEFAULT_CONFIG),m=makeManifest(c);
 const invalid=clone(m);invalid.synthetic=false;
 assert.throws(()=>validateManifest(invalid,c),/synthetic/);
 const bad=clone(m);bad.opportunities[0].betweenLeaderId='wrong';
 assert.throws(()=>validateManifest(bad,c),/adjacent arrivals/);
 const dup=clone(m);dup.arrivals[1].id=dup.arrivals[0].id;
 assert.throws(()=>validateManifest(dup,c),/duplicate/);
});
test('B1: no departure ARR–ARR pairs cannot catch up at the 3NM floor',()=>{
 const c=clone(DEFAULT_CONFIG);c.measurementStartMs=0;c.measurementEndMs=3600000;
 const a=simpleArr('SYN-A',0),b=simpleArr('SYN-B',10000),
  d=simpleArr('SYN-C',20000);
 const m=synthetic([a,b,d]);
 const result=simulate(m,c,{sequence:CONDITIONAL,policy:TIME});
 assert.equal(result.arrivals.length,3);
 assert.ok(result.arrivals.every(x=>x.status==='served'));
 for(let i=1;i<3;i++){
  const previous=result.arrivals[i-1],current=result.arrivals[i];
  assert.ok(current.timeMs-previous.timeMs>=current.lockedTargetGapMs);
  assert.ok(current.lockedTargetGapMs>minArrivalThresholdGapMs(previous,current,c),
   'locked delivered gap should exceed hard surveillance floor in test fixture');
 }
 assert.deepEqual(m,synthetic([a,b,d]),'locked targets must be immutable');
});
test('B1: identical arrival targets remain fixed when a departure is inserted, served or missed',()=>{
 const c=clone(DEFAULT_CONFIG);c.measurementStartMs=0;c.measurementEndMs=3600000;
 const a=simpleArr('SYN-A',0),b=simpleArr('SYN-B',200000);
 const dep=simpleDep('SYN-D','SYN-A','SYN-B','HEAVY_JET',0);
 const base=synthetic([a,b]),mixed=synthetic([a,b],[dep]);
 assert.equal(base.arrivals[1].effectiveTargetM,mixed.arrivals[1].effectiveTargetM);
 const time=simulate(mixed,c,{sequence:CONDITIONAL,policy:TIME});
 const distance=simulate(mixed,c,{sequence:CONDITIONAL,policy:DISTANCE});
 assert.equal(time.arrivals[1].lockedTargetM,distance.arrivals[1].lockedTargetM);
 assert.equal(time.arrivals[1].lockedTargetM,base.arrivals[1].effectiveTargetM);
 assert.equal(time.meta.a11Spacing.lockSha256,APPROVED_A11_LOCK_SHA256);
});
test('B1: immutable per-flight normals/component quantiles are required and no runner random draw',()=>{
 const c=configForDemandLevel(DEFAULT_CONFIG,20),m=makeManifest(c);
 assert.equal(m.arrivals.length,40);
 assert.equal(m.a11FleetWeightsSha256,digest(APPROVED_TYPE_WEIGHTS));
 assert.ok(m.arrivals.some(x=>x.effectiveTargetComponent==='TAIL'));
 assert.ok(m.arrivals.some(x=>x.effectiveTargetComponent==='CORE'));
 const noTarget=structuredClone(m);delete noTarget.arrivals[1].effectiveTargetM;
 assert.throws(()=>validateManifest(noTarget,c),/locked A1.1 target/);
 const badDigest=structuredClone(m);badDigest.a11LockSha256='0'.repeat(64);
 assert.throws(()=>validateManifest(badDigest,c),/A1.1 lock/);
 const tampered=structuredClone(m);tampered.arrivals[1].effectiveTargetM+=1000;
 assert.throws(()=>validateManifest(tampered,c),/immutable A1.1 target differs/);
 const changedNormal=structuredClone(m);changedNormal.arrivals[1].targetNormal+=.3;
 assert.throws(()=>validateManifest(changedNormal,c),/immutable A1.1 target differs/);
 const orig=Math.random;Math.random=()=>{throw Error('unexpected random during policy runner');};
 try {
  const x=simulate(m,c,{policy:TIME});
  assert.equal(x.meta.a11Spacing.lockSha256,APPROVED_A11_LOCK_SHA256);
 }finally{Math.random=orig;}
});
test('B2: 18/20/21/22 per hour demands are paired independently and reported at all four policies',()=>{
 const comparison=compareDemandLevels(DEFAULT_CONFIG);
 assert.deepEqual(comparison.levels.map(x=>x.arrivalsPerHour),[18,20,21,22]);
 assert.deepEqual(comparison.levels.map(x=>x.requestedArrivals),[36,40,42,44]);
 for(const level of comparison.levels){
  assert.equal(level.scenarios.length,4);
  assert.equal(new Set(level.scenarios.map(s=>s.meta.manifestSha256)).size,1);
  assert.ok(level.scenarios.every(s=>s.totals.demand===level.requestedArrivals+level.requestedDepartureOpportunities));
  assert.ok(level.scenarios.every(s=>s.metrics.capacityEligible===false));
  assert.ok(level.lockedArrivalFloorRaising.targets===level.requestedArrivals-1);
  assert.ok(level.lockedArrivalFloorRaising.shareRaised>=0 &&
   level.lockedArrivalFloorRaising.shareRaised<=1);
 }
});
test('B2: immutable core-only and full mixture targets share the same locked normal draw',()=>{
 const cfg=configForDemandLevel(DEFAULT_CONFIG,20),manifest=makeManifest(cfg);
 const frozen=canonical(manifest);
 const different=manifest.arrivals.filter((a,i)=>i>0&&a.effectiveTargetComponent==='TAIL');
 assert.ok(different.length>0,'fixture must contain a tail alternative');
 assert.ok(different.some(a=>a.effectiveTargetM>a.coreTargetM*1.5));
 const tampered=structuredClone(manifest);tampered.arrivals[1].coreTargetM+=100;
 assert.throws(()=>validateManifest(tampered,cfg),/immutable A1.1 target differs/);
 assert.equal(canonical(manifest),frozen);
});
test('B2: queued follower uses core regardless of preassigned tail; nonqueued follower keeps tail',()=>{
 const c=clone(DEFAULT_CONFIG);c.measurementStartMs=0;c.measurementEndMs=3600000;
 const arrivals=[simpleArr('SYN-A',0),simpleArr('SYN-B',1000)];
 const queued=synthetic(arrivals);queued.arrivals[1].componentQuantile=0;
 const full=assignEffectiveTargets({schema:11,synthetic:true,flights:[queued.arrivals.map(a=>({...a,componentQuantile:a.id==='SYN-B'?0:1}))]},lock.parameters);
 queued.arrivals[1].effectiveTargetM=full.flights[0][1].effectiveTargetM;
 queued.arrivals[1].effectiveTargetComponent='TAIL';
 const result=simulate(queued,c,{policy:TIME});
 assert.equal(result.arrivals[1].queueConditional,true);
 assert.equal(result.arrivals[1].lockedTargetComponent,'CORE');
 assert.equal(result.arrivals[1].lockedTargetM,queued.arrivals[1].coreTargetM);
 const late=structuredClone(queued);late.arrivals[1].requestMs=600000;
 const r2=simulate(late,c,{policy:TIME});
 assert.equal(r2.arrivals[1].queueConditional,false);
 assert.equal(r2.arrivals[1].lockedTargetComponent,'TAIL');
 assert.equal(r2.arrivals[1].lockedTargetM,late.arrivals[1].effectiveTargetM);
});
test('B2: queue decision is fixed by requested time before departure planning and never redraws',()=>{
 const c=clone(DEFAULT_CONFIG);c.measurementStartMs=0;c.measurementEndMs=3600000;
 const a=simpleArr('SYN-A',0),b=simpleArr('SYN-B',1000);
 const d=simpleDep('SYN-D','SYN-A','SYN-B');
 const m=synthetic([a,b],[d]);
 const x=simulate(m,c,{sequence:CONDITIONAL,policy:DISTANCE});
 const y=simulate(m,c,{sequence:SEQUENTIAL,policy:TIME});
 assert.equal(x.arrivals[1].queueConditional,y.arrivals[1].queueConditional);
 assert.equal(x.arrivals[1].lockedTargetM,y.arrivals[1].lockedTargetM);
 assert.equal(x.arrivals[1].lockedTargetComponent,'CORE');
});
test('B2: observed 20-21 gate is explicitly evaluated and nonmatching demand is not applicable',()=>{
 const levels=compareDemandLevels(DEFAULT_CONFIG);
 assert.equal(levels.levels.length,4);
 assert.equal(levels.levels.find(l=>l.arrivalsPerHour===18).observedValidityGate.status,'NOT_APPLICABLE');
 for(const rate of [20,21]){
  const gate=levels.levels.find(l=>l.arrivalsPerHour===rate).observedValidityGate;
  assert.equal(gate.status,'PASS','observed peak consistency gate must pass, not just be reported');
  assert.ok(gate.modelArrivalsPerHour>=19&&gate.modelArrivalsPerHour<=21);
  assert.ok(gate.modelDeparturesPerHour>=2);
  assert.equal(gate.minAcceptedDeparturesPerHour,2);
  assert.deepEqual(gate.observedArrivalBandPerHour,[19,21]);
 }
 assert.equal(levels.overallObservedValidityStatus,'PASS');
 assert.equal(levels.saturatedArrivalOnly.status,'SYNTHETIC_CORE_ONLY_SATURATED_DIAGNOSTIC_NOT_OBSERVED');
 assert.ok(levels.saturatedArrivalOnly.arrivalsPerHour>0);
 assert.equal(levels.saturatedArrivalOnly.coreQueueShare,1);
 assert.equal(levels.saturatedArrivalOnly.fullMixtureTailSelected,0);
 assert.equal(levels.saturatedArrivalOnly.observedReferenceApproxArrivalsPerHour,22);
});
test('A12/E5: physical gap serves while incremental gate holds a departure in FIFO until drain',()=>{
 const c=clone(DEFAULT_CONFIG);c.measurementStartMs=0;c.measurementEndMs=3600000;
 c.maxIncrementalArrivalDelayMs=100000;
 const a=simpleArr('SYN-A',0),b=simpleArr('SYN-B',150000);
 const d=simpleDep('SYN-D',a.id,b.id);
 const r=simulate(synthetic([a,b],[d]),c,{sequence:CONDITIONAL,policy:TIME});
 assert.equal(r.departures[0].status,'served');
 assert.ok(r.departures[0].actualSlackMs>=0);
 assert.ok(r.departures[0].bindingReasons.includes('DEPARTURE_PHYSICAL') ||
  r.departures[0].bindingReasons.includes('ARRIVAL_A11_LOCKED_DELIVERED_SPACING'));
 assert.ok(r.departures[0].events.departureRollStartMs>=r.departures[0].events.arrivalRunwayClearMs);
 const harsh=clone(c);harsh.maxIncrementalArrivalDelayMs=0;
 const early=simulate(synthetic([a,{...b,requestMs:90000}],[d]),harsh,{sequence:SEQUENTIAL,policy:TIME});
 assert.equal(early.departures[0].status,'served');
 assert.equal(early.departures[0].reason,'DRAIN_FIFO_AFTER_FINAL_ARRIVAL');
 assert.ok(early.events.some(e=>e.event==='fifo-hold-next-gap'));
 assert.equal(early.departures[0].missedOpportunity,false);
 assert.equal(early.totals.demand,3);
});
test('A12/E5: simultaneous distance planning and physical gap can be labelled independently',()=>{
 const c=clone(DEFAULT_CONFIG);c.measurementStartMs=0;c.measurementEndMs=3600000;
 const a=simpleArr('SYN-A',0),b=simpleArr('SYN-B',200000,'DH8D');
 const d=simpleDep('SYN-D',a.id,b.id,'MEDIUM_JET');
 const distance=simulate(synthetic([a,b],[d]),c,{sequence:CONDITIONAL,policy:DISTANCE});
 const timed=simulate(synthetic([a,b],[d]),c,{sequence:CONDITIONAL,policy:TIME});
 assert.equal(distance.meta.manifestSha256,timed.meta.manifestSha256);
 assert.equal(distance.departures.length,1);
 assert.ok(distance.departures[0].planningRequiredMs>0);
 assert.ok(timed.departures[0].requiredGapMs>0);
});
test('A12/E6: rejects LVP, changed surveillance, unknown category and negative timing',()=>{
 const c=clone(DEFAULT_CONFIG);
 const e=clone(c);e.environment.lvp=true;assert.throws(()=>validateConfig(e),/LVP/);
 const f=clone(c);f.surveillanceNM=2;assert.throws(()=>validateConfig(f),/surveillance/);
 const g=clone(c);g.departureByCategory.HEAVY_JET.departureRollToAirborneMs=-1;
 assert.throws(()=>validateConfig(g),/roll/);
 assert.throws(()=>timeline(0,0,'SUPER',CONDITIONAL,c),/unsupported/);
});
test('A12/E7: gates anchored to published September busy development intP10, holdout only reported',()=>{
 const c=clone(DEFAULT_CONFIG),m=feasibility(c,CONDITIONAL,'MEDIUM_JET');
 const h=feasibility(c,CONDITIONAL,'HEAVY_JET'),s=feasibility(c,SEQUENTIAL,'HEAVY_JET');
 assert.equal(m.referenceP10S,162);assert.equal(m.modelMinimumS,150);
 assert.equal(h.referenceP10S,179);assert.equal(h.modelMinimumS,165);
 assert.equal(m.status,'PASS');assert.equal(h.status,'PASS');
 assert.equal(s.status,'MECHANICS_NOT_SUPPORTED_BY_OBSERVED_P10');
 assert.equal(h.holdoutP10S,184.74);assert.equal(h.holdoutRole,'REPORT_ONLY_NOT_A_FIT_TARGET');
 assert.equal(h.referenceMedianS,260);
 assert.ok(h.arrivalHardMinimumS<=h.modelMinimumS);
 assert.ok(h.departurePhysicalMinimumS<=h.modelMinimumS);
 assert.equal(h.assumedLeaderWake,'M');
});
test('A12/E8: scenario outcomes are descriptive, not validated technical capacity',()=>{
 const c=clone(DEFAULT_CONFIG);c.arrivalCount=24;
 const r=pairedScenarios(makeManifest(c),c);
 for(const s of r.scenarios){
  assert.equal(s.metrics.capacityEligible,false);
  assert.equal(s.metrics.capacityLabel,'MECHANICS_ONLY_UNVALIDATED_NOT_TECHNICAL_CAPACITY');
  assert.ok(s.metrics.arrivalRatePerHour>=0);
  assert.ok(s.metrics.departureRatePerHour>=0);
  assert.ok(s.metrics.runwayMovementsPerHour>=0);
  assert.equal(s.metrics.usedDepartureOpportunities+s.metrics.missedDepartureOpportunities+
   s.departures.filter(x=>x.status==='censored'&&!x.missedOpportunity).length,s.departures.length);
  assert.ok(s.departures.every(x=>x.status!=='served'||x.events.departureRollStartMs>=x.events.arrivalRunwayClearMs));
 }
});
test('A12: observation aggregate and A1.1 lock remain read-only, no fitting',()=>{
 const dev=JSON.parse(readFileSync(new URL('../benchmarks/sep2026-dev-busy12.json',import.meta.url),'utf8'));
 const lock=readFileSync(new URL('../a11/calibration-lock.json',import.meta.url),'utf8');
 assert.equal(dev.strata.find(x=>x.id==='8NM_report').intP10,162);
 assert.equal(dev.strata.find(x=>x.id==='10NM_report').intP10,179);
 assert.equal(digest(lock),'be55a9622ce770ea0f66bfdcc6d582f53948577c8e1f4bb4ffda72a7026a85fb');
});

test('A12 candidate default synthetic demand exercises real departure opportunities and policy differences',()=>{
 const c=clone(DEFAULT_CONFIG);
 const run=pairedScenarios(makeManifest(c),c);
 assert.equal(run.scenarios.length,4);
 assert.ok(run.scenarios.every(x=>x.metrics.usedDepartureOpportunities>0),
  'default scenario must not silently contain zero served departures');
 // A policy difference in calculated gap need not result in a departure gain.
 // Do not force a misleading capacity delta when the locked arrival distribution binds.
 const dist=run.scenarios.find(x=>x.meta.sequence===CONDITIONAL&&x.meta.policy===DISTANCE);
 const time=run.scenarios.find(x=>x.meta.sequence===CONDITIONAL&&x.meta.policy===TIME);
 assert.ok(dist.departures.some((d,i)=>d.planningRequiredMs!==time.departures[i].planningRequiredMs),
  'time and distance policies must calculate distinct planning requirements');
 assert.ok(run.scenarios.every(x=>x.totals.demand===x.totals.served+x.totals.censored+
  x.totals.rejected+x.totals.goArounds));
});

test('B3: at least 50 deterministic seeds across every demand level and both demand profiles',()=>{
 const cfg=clone(DEFAULT_CONFIG);
 assert.ok(cfg.replication.seeds>=50);
 const result=replicateComparison(cfg);
 assert.equal(result.seedCount,cfg.replication.seeds);
 assert.deepEqual([...new Set(result.results.map(x=>x.arrivalsPerHour))],[18,20,21,22]);
 assert.equal(result.results.length,8);
 for(const level of result.results){
  assert.equal(level.seedCount,50);
  assert.equal(level.perSeedManifestSha256.length,50);
  assert.equal(new Set(level.perSeedManifestSha256.map(x=>x.sha256)).size,50);
  assert.equal(level.statistics.length,4);
  assert.equal(level.pairedDifferences.length,2);
  assert.equal(level.monotonicity.length,2);
  for(const stat of level.statistics)for(const name of
    ['arrivalsPerHour','departuresPerHour','missedDepartureOpportunities','meanArrivalDelaySeconds']){
   assert.equal(stat.statistics[name].n,50);
   assert.ok(stat.statistics[name].p10<=stat.statistics[name].mean ||
     Number.isFinite(stat.statistics[name].mean)); // quantile and mean are legitimate observations
   assert.ok(stat.statistics[name].p10<=stat.statistics[name].p90);
  }
  for(const seq of level.pairedDifferences)for(const metric of Object.values(seq.differences)){
   assert.equal(metric.n,50);
   assert.ok(metric.pairedMeanCI95.lower<=metric.pairedMeanCI95.upper);
   assert.equal(metric.pairedMeanCI95.replicates,2000);
  }
  for(const m of level.monotonicity){
   assert.equal(m.n,50);
   assert.equal(m.violations.length,m.violatingSeeds);
   assert.equal(m.shareSequentialHigher,m.violatingSeeds/50);
   assert.ok(m.violations.every(v=>v.seed>=cfg.replication.seedStart&&
     v.excessDeparturesInWindow>0&&v.needsIndependentTechnicalReview===true&&
     v.firstMeasurementWindowDifference!==null&&
     v.evidenceClassification!=='UNRESOLVED_MONOTONICITY_VIOLATION'));
  }
 }
 assert.equal(result.a11LockSha256,APPROVED_A11_LOCK_SHA256);
});
test('N2: observed-like requests explicitly total 3 departures/hour with two heavy',()=>{
 for(const rate of [18,20,21,22]){
  const cfg=configForDemandLevel(DEFAULT_CONFIG,rate);
  const manifest=makeManifest(cfg,'OBSERVED_LIKE_3_PER_H_2_HEAVY');
  assert.equal(manifest.opportunities.length,6);
  assert.equal(manifest.opportunities.filter(x=>x.category==='HEAVY_JET').length,4);
  assert.equal(manifest.opportunities.filter(x=>x.category==='MEDIUM_JET').length,2);
  assert.equal(new Set(manifest.opportunities.map(x=>x.followerId)).size,6);
  assert.equal(manifest.departureDemandProfile,'OBSERVED_LIKE_3_PER_H_2_HEAVY');
  const results=pairedScenarios(manifest,cfg);
  assert.ok(results.scenarios.every(x=>x.totals.demand===cfg.arrivalCount+6));
 }
});
test('B3: reproducible matched seed and paired-difference sign convention',()=>{
 const cfg=clone(DEFAULT_CONFIG);cfg.replication.seeds=50;
 const r=replicateComparison(cfg);
 const level=r.results.find(x=>x.profile==='INSERTABLE_EVERY_SECOND_ARR'&&x.arrivalsPerHour===20);
 const c=level.statistics.find(x=>x.sequence===CONDITIONAL&&x.policy===DISTANCE);
 const t=level.statistics.find(x=>x.sequence===CONDITIONAL&&x.policy===TIME);
 const delta=level.pairedDifferences.find(x=>x.sequence===CONDITIONAL).differences.departuresPerHour;
 assert.ok(Math.abs((t.statistics.departuresPerHour.mean-c.statistics.departuresPerHour.mean)-delta.mean)<1e-9);
 const gate=level.observedGate;
 assert.equal(gate.status,'REPLICATED_OBSERVED_COMPARATOR');
 assert.ok(['PASS','FAIL_OBSERVED_VALIDITY_GATE'].includes(gate.verdict));
});

test('B4: cumulative arrival delay is reported but never vetoes release',()=>{
 const c=clone(DEFAULT_CONFIG);c.measurementStartMs=0;c.measurementEndMs=3600000;
 c.maxIncrementalArrivalDelayMs=90000;
 const a=simpleArr('SYN-A',0),b=simpleArr('SYN-B',30000),f=simpleArr('SYN-C',60000);
 const d=simpleDep('SYN-D','SYN-B','SYN-C','MEDIUM_JET',0);
 const m=synthetic([a,b,f],[d]);
 const r=simulate(m,c,{sequence:CONDITIONAL,policy:TIME});
 assert.ok(r.arrivals.at(-1).delayMs>90000);
 assert.equal(r.departures[0].status,'served');
 assert.equal(r.metrics.missedDepartureOpportunities,0);
});
test('B4: held departure is retried, FIFO order is preserved, no request discarded before drain',()=>{
 const c=clone(DEFAULT_CONFIG);c.measurementStartMs=0;c.measurementEndMs=3600000;
 c.maxIncrementalArrivalDelayMs=0;
 const arr=[0,100000,200000,300000,400000].map((t,i)=>simpleArr('A'+i,t));
 const d1=simpleDep('D1','A0','A1','HEAVY_JET',0);
 const d2=simpleDep('D2','A2','A3','MEDIUM_JET',120000);
 const result=simulate(synthetic(arr,[d1,d2]),c,{sequence:SEQUENTIAL,policy:TIME});
 assert.deepEqual(result.departures.map(x=>x.id),['D1','D2']);
 assert.ok(result.departures.every(x=>x.status==='served'));
 assert.ok(result.departures[0].timeMs<=result.departures[1].timeMs);
 assert.ok(result.events.some(e=>e.event==='fifo-hold-next-gap'));
 assert.equal(result.totals.demand,7);
 assert.equal(result.totals.censored,0);
});
test('B4: censored FIFO requests only at insufficient drain horizon',()=>{
 const c=clone(DEFAULT_CONFIG);c.measurementStartMs=0;c.measurementEndMs=3600000;
 c.drainEndMs=3600000;c.maxIncrementalArrivalDelayMs=0;
 const arr=[0,100000,200000].map((t,i)=>simpleArr('A'+i,t));
 const d=simpleDep('D1','A0','A1','HEAVY_JET',3599000);
 const r=simulate(synthetic(arr,[d]),c,{sequence:SEQUENTIAL,policy:TIME});
 assert.equal(r.departures[0].status,'censored');
 assert.equal(r.departures[0].reason,'drain-horizon');
 assert.equal(r.departures[0].missedOpportunity,true);
});

test('B4: FIFO held head is released in a later ARR gap before the drain',()=>{
 const c=clone(DEFAULT_CONFIG);c.measurementStartMs=0;c.measurementEndMs=3600000;
 c.maxIncrementalArrivalDelayMs=0;
 const arr=[simpleArr('A0',0),simpleArr('A1',60000),simpleArr('A2',500000),
  simpleArr('A3',800000)];
 const d1=simpleDep('D1','A0','A1','HEAVY_JET',0);
 const d2=simpleDep('D2','A1','A2','MEDIUM_JET',100000);
 const r=simulate(synthetic(arr,[d1,d2]),c,{sequence:SEQUENTIAL,policy:TIME});
 assert.ok(r.events.some(x=>x.flightId==='D1'&&x.event==='fifo-hold-next-gap'));
 assert.equal(r.departures[0].id,'D1');
 assert.equal(r.departures[0].status,'served');
 assert.notEqual(r.departures[0].reason,'DRAIN_FIFO_AFTER_FINAL_ARRIVAL');
 assert.ok(r.departures[0].delayMs>=0);
 assert.ok(r.departures.every(x=>x.status==='served'));
 assert.ok(r.departures[0].timeMs<=r.departures[1].timeMs);
});
test('B4: no release is vetoed merely by cumulative follower-request delay',()=>{
 const c=clone(DEFAULT_CONFIG);
 c.maxIncrementalArrivalDelayMs=90000;
 const m=makeManifest(configForDemandLevel(c,21),'OBSERVED_LIKE_3_PER_H_2_HEAVY');
 const r=simulate(m,configForDemandLevel(c,21),{sequence:CONDITIONAL,policy:DISTANCE});
 assert.ok(r.arrivals.some(a=>a.delayMs>90000));
 assert.equal(r.departures.filter(x=>x.status==='served').length,6);
 assert.ok(r.departures.every(x=>x.delayMs!==null&&x.delayMs>=0));
 assert.ok(r.metrics.departureDelaySeconds.mean>0);
 assert.equal(r.metrics.pendingAtDrain,0);
});
