import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {digest} from '../core.mjs';
import {CONFIG,VERSION,A11_LOCK_SHA256,validateConfig,fittedSpeedContrast,
 makeManifest,validateManifest,gateCrossings,simulate,comparePair,replicate,
 bunchedReadyTimes,evaluateTakeoffIntervalGate,intervalSample} from './model.mjs';

const clone=x=>structuredClone(x);
const fixture=(c=CONFIG,rate=16,bg=1,seed=20261114)=>makeManifest(c,
 {seed,departuresPerHour:rate,backgroundArrivalsPerHour:bg});

test('S1+A1 fitted TP/jet contrast residuals, conditional identifiable scale',()=>{
 const f=fittedSpeedContrast(CONFIG);
 assert.equal(f.gateNM,40);
 assert.equal(f.jetKt,300);
 assert.ok(f.tpKt>230&&f.tpKt<250);
 assert.equal(f.modelSeconds['TP-J'],-119.5);
 assert.equal(f.modelSeconds['J-TP'],119.5);
 assert.equal(f.modelSeconds['J-J'],0);
 assert.equal(f.residualModelMinusObservedSeconds['TP-J'],.5);
 assert.equal(f.residualModelMinusObservedSeconds['J-TP'],.5);
 assert.equal(f.residualModelMinusObservedSeconds['J-J'],-4);
 assert.match(f.identifiability,/HYPOTHETICAL/);
});
test('S1 S6 first outward radial gates have UTC relative time and missingness',()=>{
 const dep={category:'TURBOPROP',gateMissing30:false,gateMissing40:true};
 const gates=gateCrossings(dep,100000);
 assert.ok(gates.crossings.RADIAL_30_NM.timeMs>100000);
 assert.equal(gates.crossings.RADIAL_40_NM.status,'GATE_MISSING_SYNTHETIC');
 assert.equal(gates.crossings.RADIAL_40_NM.timeMs,null);
});
test('S2 source exit weights include OTHER 2% and GTQ 37%',()=>{
 const weights=CONFIG.observed.exitSharesPercent;
 assert.equal(weights.GTQ,37);assert.equal(weights.OTHER_UNKNOWN,2);
 assert.equal(Object.values(weights).reduce((a,b)=>a+b,0),100);
});
test('S2 synthetic manifest has immutable IDs/requests/type/exit and exact demand',()=>{
 for(const dep of [14,16,18,20])for(const arr of [1,7]){
  const m=fixture(CONFIG,dep,arr);
  assert.equal(m.departures.length,dep*2);
  assert.equal(m.arrivals.length,arr*2);
  assert.equal(validateManifest(m,CONFIG),m);
  assert.ok(m.departures.every(x=>x.originalIndex>=0&&Object.hasOwn(CONFIG.observed.exitSharesPercent,x.exit)));
 }
});
test('S3 jet vs TP gate travel-time difference compresses exactly 119.5 seconds',()=>{
 const a=gateCrossings({category:'TURBOPROP',gateMissing30:false,gateMissing40:false},0);
 const b=gateCrossings({category:'JET',gateMissing30:false,gateMissing40:false},120000);
 const change=(b.crossings.RADIAL_40_NM.timeMs-a.crossings.RADIAL_40_NM.timeMs)/1000-120;
 assert.ok(Math.abs(change+119.5)<.002);
});
test('S4 current additional planning default 0; observed 120s sensitivity separate',()=>{
 assert.equal(CONFIG.intervalPresets.CURRENT.extraSameExitMs,0);
 assert.equal(CONFIG.intervalPresets.SEP2026_OBSERVED_SAME_EXIT_120S.extraSameExitMs,120000);
 assert.equal(CONFIG.boundaries.ctotAtfm,'NOT_MODELLED');
 assert.equal(CONFIG.boundaries.lvp,false);
 assert.throws(()=>validateConfig({...CONFIG,intervalPresets:{...CONFIG.intervalPresets,
  CURRENT:{...CONFIG.intervalPresets.CURRENT,extraSameExitMs:120000}}}),/CURRENT/);
});
test('S5 FIFO vs candidate use identical manifest, preserve all demand',()=>{
 const m=fixture(),frozen=digest(m);
 const p=comparePair(m);
 assert.equal(p.manifestSha256,frozen);
 assert.equal(p.fifo.meta.manifestSha256,p.candidate.meta.manifestSha256);
 for(const s of [p.fifo,p.candidate]){
  assert.equal(s.totals.requests,m.departures.length+m.arrivals.length);
  assert.equal(s.totals.requests,s.totals.served+s.totals.censored);
  assert.ok(s.departures.every(x=>x.ctotAtfmStatus==='NOT_MODELLED'));
 }
});
test('A3 adjacent swaps limited to one position and max +120s extra delay',()=>{
 for(let seed=20261114;seed<20261164;seed++){
  const m=fixture(CONFIG,20,7,seed),p=comparePair(m);
  const byId=new Map(p.fifo.departures.map(x=>[x.id,x]));
  assert.ok(p.candidate.departures.every(x=>
   Math.abs(x.originalQueueIndex-x.actualDepartureOrder)<=1));
  for(const x of p.candidate.departures){
   const f=byId.get(x.id);
   if(x.status==='served'&&f.status==='served')
    assert.ok(x.airborneMs-f.airborneMs<=120000);
  }
 }
});
test('S6 different exits have no spacing claim and no gate gap interpreted',()=>{
 const p=comparePair(fixture()).fifo;
 const diffs=p.pairs.filter(x=>!x.sameExit);
 assert.ok(diffs.length>0);
 assert.ok(diffs.every(x=>x.spacingClaim==='DIFFERENT_EXIT_NO_SPACING_CLAIM'&&
  x.gateTimes.RADIAL_40_NM.gapSeconds===null));
});
test('S6 same-exit gate primary outcome is time difference, not radial-distance separation',()=>{
 const p=comparePair(fixture()).fifo;
 const same=p.pairs.filter(x=>x.sameExit);
 assert.ok(same.length>0);
 for(const x of same){
  assert.equal(x.distanceNM,null);
  const gate=x.gateTimes.RADIAL_40_NM;
  if(gate.status==='GATE_AVAILABLE')
   assert.equal(x.change40FromAirborneSeconds,gate.gapSeconds-x.airborneGapSeconds);
 }
});
test('S7 source references are observed descriptions, not enforced minima',()=>{
 assert.equal(CONFIG.observed.sameExitWithin180S.nPairs,52);
 assert.equal(CONFIG.observed.gate40TimeGapChangeMedianSeconds['TP-J'],-120);
 assert.equal(CONFIG.observed.gate40TimeGapChangeMedianSeconds['J-TP'],119);
 assert.equal(CONFIG.observed.gate40TimeGapChangeMedianSeconds['J-J'],4);
 assert.equal(CONFIG.observed.departurePeakMeanPerHour,15.8);
});
test('A2 background arrivals exactly 1 and 7 per synthetic hour, not evening bank',()=>{
 assert.deepEqual(CONFIG.demand.backgroundArrivalsPerHour,[1,7]);
 assert.deepEqual(CONFIG.demand.departureLevelsPerHour,[14,16,18,20]);
 assert.equal(CONFIG.observed.backgroundArrivalReference.morning08xx.arrivalsMean,6.7);
 assert.equal(CONFIG.observed.backgroundArrivalReference.early03xx.arrivalsMean,.9);
});
test('S8 S9 50-seed paired scenarios span two backgrounds, four dep rates and two presets',()=>{
 const r=replicate(CONFIG);
 assert.equal(r.cases.length,16);
 assert.equal(r.seedCount,50);
 for(const x of r.cases){
  assert.equal(x.perSeed.length,50);
  assert.equal(new Set(x.perSeed.map(y=>y.manifestSha256)).size,50);
  assert.ok(x.acceptance.allConserved);
  assert.equal(x.acceptance.ctotAtfm,'NOT_MODELLED');
  assert.ok(x.pairedCandidateMinusFIFO.departuresInHour.pairedMeanCI95.lower<=
   x.pairedCandidateMinusFIFO.departuresInHour.pairedMeanCI95.upper);
  assert.ok(x.gateSummaries.fifo.noDifferentExitSpacingClaim);
  assert.equal(x.gateSummaries.fifo.within180SecondsComparablePopulation.observedReferenceNPairs,52);
  assert.ok(x.gateSummaries.fifo.within180SecondsComparablePopulation.pairs<=x.gateSummaries.fifo.sameExitPairs);
  assert.equal(x.exitMixAudit.syntheticTotalDepartures,50*x.departureDemandPerHour*2);
  assert.equal(Object.values(x.exitMixAudit.syntheticCounts).reduce((sum,n)=>sum+n,0),
   x.exitMixAudit.syntheticTotalDepartures);
  assert.equal(x.exitMixAudit.observedPercent.GTQ,37);
  assert.equal(x.exitMixAudit.observedPercent.OTHER_UNKNOWN,2);
  assert.equal(x.typeMixAudit.observedTPSharePercent,null);
 }
 assert.equal(r.lockSha256,A11_LOCK_SHA256);
});
test('S10 exact A1.1 lock stays sealed and A1.3 nonoperational',()=>{
 const lock=readFileSync(new URL('../a11/calibration-lock.json',import.meta.url),'utf8');
 assert.equal(digest(lock),A11_LOCK_SHA256);
 assert.equal(CONFIG.nonOperational,true);
 assert.equal(VERSION,'A1.3-C2-minute-quantised-candidate-3');
});

test('A3: deliberate co-requested same-exit TP then jet can swap under 120s limit',()=>{
 const m=fixture(CONFIG,14,1,20261114);
 const one=m.departures[0],two=m.departures[1];
 one.category='TURBOPROP';one.exit='GTQ';one.requestMs=0;
 two.category='JET';two.exit='GTQ';two.requestMs=0;
 for(let i=2;i<m.departures.length;i++)m.departures[i].requestMs+=1000000;
 const r=comparePair(m);
 assert.ok(r.candidate.swaps.length>0,'targeted feasible adjacent swap must exercise intervention');
 assert.equal(r.candidate.swaps[0].earlierId,one.id);
 assert.equal(r.candidate.swaps[0].laterId,two.id);
 const fifo=new Map(r.fifo.departures.map(x=>[x.id,x]));
 for(const x of r.candidate.departures){
  const original=fifo.get(x.id);
  if(x.status==='served'&&original.status==='served')
   assert.ok(x.airborneMs-original.airborneMs<=120000);
 }
});

test('C1: fixed 50-seed fitted early and late observed takeoff gates both PASS',()=>{
 const r=evaluateTakeoffIntervalGate(CONFIG,{seeds:50});
 assert.equal(r.label,'FITTED_TO_SEP2026_TAKEOFF_INTERVALS_NO_HOLDOUT');
 assert.equal(r.overall,'PASS');
 for(const [wave,observedMedian,observedShare,background] of [
  ['early',120,.51,1],['late',180,.38,7]]){
  const x=r[wave];
  assert.equal(x.gate.status,'PASS');
  assert.ok(Math.abs(x.model.medianS-observedMedian)<=30);
  assert.ok(Math.abs(x.model.shareLE120-observedShare)<=.10);
  assert.equal(x.inputs.backgroundArrivalsPerHour,background);
  assert.equal(x.inputs.seedCount,50);
  assert.ok(x.model.intervals>0);
  assert.equal(x.gate.sameExitShare,'REPORT_ONLY');
  assert.ok(Number.isFinite(x.residual.p10Seconds)&&Number.isFinite(x.residual.p90Seconds));
 }
});
test('C1: ready times are bunched, deterministic and preserve exactly all demand',()=>{
 const a=bunchedReadyTimes(CONFIG,20261114,32,1);
 const b=bunchedReadyTimes(CONFIG,20261114,32,1);
 assert.deepEqual(a,b);
 assert.equal(a.times.length,32);
 assert.ok(a.clusters<32);
 assert.ok(a.times.some((t,i)=>i>0&&t-a.times[i-1]<=60000));
 assert.equal(a.source,'FITTED_TO_SEP2026_TAKEOFF_INTERVALS_NO_HOLDOUT');
 const m=fixture(CONFIG,16,1);
 assert.deepEqual(m.departures.map(x=>x.requestMs),a.times);
 assert.equal(m.readyTimeProcess.wave,'early');
});
test('C1: 50-seed comparison has accepted feasible swaps and reports paired gate-time changes',()=>{
 const r=replicate(CONFIG);
 assert.ok(r.cases.some(x=>x.swapAudit.acceptedTotal>0));
 for(const x of r.cases){
  assert.equal(x.swapAudit.eligibleTotal,
   x.swapAudit.acceptedTotal+Math.round(x.swapAudit.rejectedSwaps.mean*50));
  assert.ok(x.swapAudit.seedShareWithAcceptedSwaps>=0&&
   x.swapAudit.seedShareWithAcceptedSwaps<=1);
  assert.ok(x.pairedGate40GapCandidateMinusFIFO.medianS.n>0);
  assert.ok(x.pairedGate40GapCandidateMinusFIFO.p10S.n>0);
  assert.equal(x.acceptance.allConserved,true);
  assert.equal(x.swapAudit.ctotAtfm,'NOT_MODELLED');
 }
});
test('N1: 260/300/340 kt sensitivity keeps contrast residuals and identical manifests',()=>{
 const anchors=[260,300,340].map(jet=>fittedSpeedContrast(CONFIG,jet));
 for(const [i,jet] of [260,300,340].entries()){
  assert.equal(anchors[i].jetKt,jet);
  assert.equal(anchors[i].modelSeconds['TP-J'],-119.5);
  assert.equal(anchors[i].modelSeconds['J-TP'],119.5);
  assert.equal(anchors[i].residualModelMinusObservedSeconds['TP-J'],.5);
  assert.ok(anchors[i].tpKt<jet);
 }
 assert.ok(anchors[0].tpKt<anchors[1].tpKt&&anchors[1].tpKt<anchors[2].tpKt);
 const m=fixture(),before=digest(m);
 const runs=[260,300,340].map(jetAnchorKt=>comparePair(m,CONFIG,{jetAnchorKt}));
 assert.equal(digest(m),before);
 assert.ok(runs.every(x=>x.manifestSha256===before));
 assert.ok(runs.every(x=>x.candidate.metrics.departuresInHour===runs[1].candidate.metrics.departuresInHour));
 const follower=m.departures[0],d260=gateCrossings(follower,0,CONFIG,anchors[0]),
  d340=gateCrossings(follower,0,CONFIG,anchors[2]);
 if(!follower.gateMissing40)
  assert.ok(d260.crossings.RADIAL_40_NM.timeMs>d340.crossings.RADIAL_40_NM.timeMs);
});

test('C2: floor EACH absolute airborne timestamp to minute before taking successive differences',()=>{
 const mk=(id,timeMs,exit='GTQ')=>({id,status:'served',airborneMs:timeMs,exit});
 const sample=intervalSample({departures:[
  mk('A',59999),mk('B',60001),mk('C',119999),mk('D',120001)
 ]},{...CONFIG,demand:{...CONFIG.demand,measurementStartMs:0,measurementEndMs:3600000}});
 assert.deepEqual(sample.intervals,[60,0,60]);
 assert.deepEqual(sample.sameExit,[1,1,1]);
 assert.equal(sample.observationOperator,
  'FLOOR_EACH_ABSOLUTE_TAKEOFF_TIMESTAMP_TO_UTC_MINUTE_BEFORE_DIFFERENCE');
 assert.ok(sample.intervals.every(x=>x%60===0));
});
test('C2: quantisation does not change underlying modelled departure airborne times or total delay',()=>{
 const m=fixture(CONFIG,20,1);
 const before=simulate(m,CONFIG,{policy:'FIFO',preset:'CURRENT'});
 const raw=before.departures.map(x=>[x.id,x.airborneMs,x.delayMs]);
 intervalSample(before,CONFIG);
 assert.deepEqual(before.departures.map(x=>[x.id,x.airborneMs,x.delayMs]),raw);
});
