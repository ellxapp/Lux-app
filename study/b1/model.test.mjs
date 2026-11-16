import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIG,joinDistanceNM,makeManifest,runOne,spacingDecision,pairedBootstrap,validateB1,runSweep} from './model.mjs';
import {DEFAULT_CONFIG as A12,simulate as baselineSimulate,makeManifest as baselineManifest,
 CONDITIONAL,DISTANCE,TIME} from '../a12/model.mjs';
import {digest} from '../core.mjs';

test('B1 approval, policy and observed join provenance remain explicit',()=>{
 assert.equal(validateB1(),CONFIG);
 assert.equal(CONFIG.observedJoin.n,1857);
 assert.deepEqual([.1,.25,.5,.75,.9].map(x=>joinDistanceNM(x)),[7.9,8.6,9,10.7,13.6]);
 assert.equal(CONFIG.modelLimits.operationalCapacityClaim,false);
});
test('empirical aggregate interpolation reaches approximately 89% at 8NM and 30% at 10NM',()=>{
 const xs=Array.from({length:10000},(_,i)=>joinDistanceNM((i+.5)/10000));
 assert.ok(Math.abs(xs.filter(x=>x>=8).length/10000-.89)<.002);
 assert.ok(Math.abs(xs.filter(x=>x>=10).length/10000-.30)<.002);
 assert.ok(xs.every(x=>x>=6&&x<=15));
});
test('B1 fixed manifests preserve the A1.1 core assignments and observed-like 3 DEP/h incl 2 heavy',()=>{
 const m=makeManifest(24,20261116);
 assert.equal(m.arrivals.length,48);
 assert.equal(m.opportunities.length,6);
 assert.equal(m.opportunities.filter(d=>d.category==='HEAVY_JET').length,4);
 assert.equal(m.arrivals.slice(1).every(a=>a.coreTargetSource==='A11_LOCKED_CORE_SAME_NORMAL'),true);
 assert.equal(digest(m),digest(makeManifest(24,20261116)));
});
test('r=0 is EXACT A1.2 baseline metric replay regardless of policy / J / spread',()=>{
 const seed=20261116,rate=20,m=makeManifest(rate,seed);
 const c={...A12,seed,arrivalCount:40,arrivalRequestStepMs:180000};
 const original=baselineManifest(c,'OBSERVED_LIKE_3_PER_H_2_HEAVY');
 for(const gapPolicy of [DISTANCE,TIME]){
  const base=baselineSimulate(original,c,{sequence:CONDITIONAL,policy:gapPolicy});
  const zero=runOne(m,{r:0,gapPolicy});
  assert.equal(zero.metrics.arrivalRatePerHour,base.metrics.arrivalRatePerHour);
  assert.equal(zero.metrics.departureRatePerHour,base.metrics.departureRatePerHour);
  assert.equal(zero.metrics.servedArrivalsByDrain,base.arrivals.filter(x=>x.status==='served').length);
  assert.equal(zero.metrics.servedDeparturesByDrain,base.departures.filter(x=>x.status==='served').length);
  assert.equal(zero.metrics.hardMinimumViolations,0);
  assert.equal(zero.metrics.toolActedPairs,0);
  assert.equal(digest(original.arrivals.map(a=>a.coreTargetM)),
   digest(m.arrivals.map(a=>a.coreTargetM)));
 }
});
test('J is required tool lead distance, not the aircraft join distance',()=>{
 const common={leader:{},originalTargetM:7*1852,hardFloorNM:3};
 const follower={joinDistanceNM:9,deliverySpreadQuantile:0};
 assert.equal(spacingDecision({...common,follower},{r:.5,spreadNM:0,J:10,policy:'P1'}),null);
 const a=spacingDecision({...common,follower},{r:.5,spreadNM:0,J:8,policy:'P1'});
 assert.ok(a&&a.targetM<common.originalTargetM);
 assert.ok(a.targetM>=5*1852);
 assert.equal(a.joinDistanceNM,9);
 assert.equal(a.requiredLeadDistanceNM,8);
});
test('P2 never cuts through wake/surveillance floor; P1 cannot change coordinated 4-5NM target',()=>{
 const common={leader:{},follower:{joinDistanceNM:14,deliverySpreadQuantile:0},originalTargetM:4.5*1852,hardFloorNM:3};
 assert.equal(spacingDecision(common,{r:.75,spreadNM:0,J:10,policy:'P1'}),null);
 const heavy={...common,originalTargetM:8*1852,hardFloorNM:6};
 const p2=spacingDecision(heavy,{r:.75,spreadNM:0,J:10,policy:'P2'});
 assert.ok(p2.targetM>=6*1852);
 assert.ok(p2.targetM<8*1852);
});
test('at matched seeds tool never violates hard arrival minima; r=0 deltas have zero CI',()=>{
 const m=makeManifest(22,20261118);
 for(const policy of ['P1','P2'])for(const gapPolicy of [TIME,DISTANCE]){
  const x=runOne(m,{policy,r:.75,spreadNM:.3,J:8,gapPolicy});
  assert.equal(x.metrics.hardMinimumViolations,0);
  assert.equal(x.metrics.demandArrivals,x.metrics.servedArrivalsByDrain+x.metrics.censoredArrivals);
  assert.equal(x.metrics.demandDepartures,x.metrics.servedDeparturesByDrain+x.metrics.censoredDepartures);
  assert.ok(x.metrics.toolActedPairs<=x.metrics.reachableQueuedPairs);
  assert.equal(x.meta.manifestHash,digest(m));
 }
 assert.deepEqual(pairedBootstrap([0,0,0],5,1000).interval95,[0,0]);
});

test('in a saturated request scenario, the hypothetical indicator acts only on reachable queued core pairs',()=>{
 const m=makeManifest(24,20261116);
 const base=runOne(m,{policy:'P1',r:0,spreadNM:0,J:6,gapPolicy:DISTANCE});
 const tool=runOne(m,{policy:'P1',r:.75,spreadNM:0,J:6,gapPolicy:DISTANCE});
 assert.equal(tool.meta.manifestHash,base.meta.manifestHash);
 assert.ok(tool.metrics.toolActedPairs>0,'must actually exercise the B1 transformation');
 assert.ok(tool.arrivals.some(a=>a.b1ToolDecision),'tool decision diagnostics required');
 assert.ok(tool.arrivals.every(a=>!a.b1ToolDecision||
  (a.queueConditional&&a.b1ToolDecision.joinDistanceNM>=6)));
 assert.equal(tool.metrics.hardMinimumViolations,0);
});

test('R1 30/h saturated demand preserves original manifests and both baseline/drain counts',()=>{
 const seed=20261116,m=makeManifest(30,seed);
 assert.equal(m.arrivals.length,60);
 assert.equal(m.opportunities.length,6);
 assert.equal(m.opportunities.filter(d=>d.category==='HEAVY_JET').length,4);
 const raw={...A12,seed,arrivalCount:60,arrivalRequestStepMs:120000};
 for(const gapPolicy of [DISTANCE,TIME]){
  const baseline=baselineSimulate(baselineManifest(raw,'OBSERVED_LIKE_3_PER_H_2_HEAVY'),raw,
   {sequence:CONDITIONAL,policy:gapPolicy});
  const zero=runOne(m,{policy:'P2',r:0,spreadNM:.3,J:10,gapPolicy});
  assert.equal(zero.metrics.arrivalRatePerHour,baseline.metrics.arrivalRatePerHour);
  assert.equal(zero.metrics.departureRatePerHour,baseline.metrics.departureRatePerHour);
  assert.equal(zero.metrics.servedArrivalsByDrain,baseline.arrivals.filter(a=>a.status==='served').length);
  assert.equal(zero.metrics.servedDeparturesByDrain,baseline.departures.filter(d=>d.status==='served').length);
  assert.equal(zero.metrics.demandArrivals,zero.metrics.servedArrivalsByDrain+zero.metrics.censoredArrivals);
  assert.equal(zero.metrics.demandDepartures,zero.metrics.servedDeparturesByDrain+zero.metrics.censoredDepartures);
 }
});
test('N1: served-by-drain counts distinguish one-hour boundary shifts and conserve requests',()=>{
 const m=makeManifest(20,20261117);
 const baseline=runOne(m,{r:0,gapPolicy:DISTANCE});
 for(const policy of ['P1','P2']){
  const tool=runOne(m,{policy,r:.75,spreadNM:0,J:8,gapPolicy:DISTANCE});
  for(const x of [baseline,tool]){
   assert.equal(x.metrics.demandArrivals,x.metrics.servedArrivalsByDrain+x.metrics.censoredArrivals);
   assert.equal(x.metrics.demandDepartures,x.metrics.servedDeparturesByDrain+x.metrics.censoredDepartures);
   assert.ok(x.metrics.arrivalRatePerHour<=x.metrics.servedArrivalsByDrain);
   assert.ok(x.metrics.departureRatePerHour<=x.metrics.servedDeparturesByDrain);
  }
  assert.equal(tool.meta.manifestHash,baseline.meta.manifestHash);
 }
});
test('R1 sweep covers all 30/h policy × J × r × spread × departure-gap cells with paired N1 fields',()=>{
 const x=runSweep({rates:[30],seeds:50});
 assert.equal(x.results.length,96);
 assert.ok(x.results.every(row=>row.saturatedArrivalDemand&&row.n===50&&
  row.identicalPairedManifests&&row.syntheticCapacityComparison&&
  row.syntheticCapacityComparison.requestRatePerHour===30));
 for(const policy of ['P1','P2'])for(const J of [6,8,10])for(const r of [0,.25,.5,.75])
  assert.equal(x.results.filter(z=>z.policy===policy&&z.J===J&&z.r===r).length,4);
 for(const row of x.results){
  const a=row.pairedToolMinusBaseline;
  assert.equal(a.servedArrivalsByDrain.n,50);
  assert.equal(a.servedDeparturesByDrain.n,50);
  assert.equal(a.arrivalRatePerHour.n,50);
  assert.equal(a.arrivalRatePerHour.interval95.length,2);
  assert.equal(row.syntheticCapacityComparison.pairedToolMinusBaseline,a.arrivalRatePerHour);
  if(row.r===0)for(const key of ['arrivalRatePerHour','departureRatePerHour',
   'servedArrivalsByDrain','servedDeparturesByDrain'])
   assert.deepEqual(a[key].interval95,[0,0]);
 }
});
