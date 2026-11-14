import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonical,digest} from '../core.mjs';
import {DEFAULT_CONFIG,validateConfig,makeManifest,validateManifest,timeline,
 feasibility,simulate,pairedScenarios,minArrivalThresholdGapMs,
 CONDITIONAL,SEQUENTIAL,DISTANCE,TIME} from './model.mjs';
import {profileFor,timeToGoMs} from '../a11/model.mjs';
const clone=x=>structuredClone(x);
const simpleArr=(id,requestMs,type='B738',wake='M',headwindKt=0)=>
 ({id,kind:'ARR',requestMs,type,wake,headwindKt,runway:'24'});
const simpleDep=(id,leader,follower,category='MEDIUM_JET',requestMs=0)=>
 ({id,kind:'DEP',requestMs,betweenLeaderId:leader,followerId:follower,category,
   type:category==='HEAVY_JET'?'B744':'B738',wake:category==='HEAVY_JET'?'H':'M'});
const synthetic=(arrivals,departures=[])=>({schema:12,synthetic:true,seed:DEFAULT_CONFIG.seed,
 startUtc:'2026-01-01T00:00:00.000Z',arrivals,opportunities:departures});
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
test('A12/E5: exact zero-slack threshold served and negative slack opportunity rejected',()=>{
 const c=clone(DEFAULT_CONFIG);c.measurementStartMs=0;c.measurementEndMs=3600000;
 c.maxArrivalDeferralMs=100000;
 const a=simpleArr('SYN-A',0),b=simpleArr('SYN-B',150000);
 const d=simpleDep('SYN-D',a.id,b.id);
 const r=simulate(synthetic([a,b],[d]),c,{sequence:CONDITIONAL,policy:TIME});
 assert.equal(r.departures[0].status,'served');
 assert.equal(r.departures[0].actualSlackMs,0);
 assert.ok(r.departures[0].bindingReasons.includes('DEPARTURE_PHYSICAL'));
 assert.ok(r.departures[0].events.departureRollStartMs>=r.departures[0].events.arrivalRunwayClearMs);
 const harsh=clone(c);harsh.maxArrivalDeferralMs=0;
 const early=simulate(synthetic([a,{...b,requestMs:90000}],[d]),harsh,{sequence:SEQUENTIAL,policy:TIME});
 assert.equal(early.departures[0].status,'censored');
 assert.equal(early.departures[0].missedOpportunity,true);
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
