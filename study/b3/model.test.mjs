import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIG,validate,leaderClass,chooseExit,exitChoices,clearanceRange,
 clearanceCdf,clearanceQuantile,clearanceClassMean,clearanceTime,
 followerTimeMs,followerDistanceNM,requiredIntervalMs,table,
 manifest,simulate,reproduceA14,exactBinomial,runSweep} from './model.mjs';
import {digest} from '../core.mjs';

test('approved B3 RWY24-only and exact corrected exit sets',()=>{
 assert.equal(validate(),CONFIG);
 assert.deepEqual(exitChoices('TP'),['D2','E']);
 assert.deepEqual(exitChoices('MEDIUM_JET'),['D2','E']);
 assert.deepEqual(exitChoices('HEAVY'),['E','G','END']);
 assert.deepEqual(exitChoices('TP','TP_MEDIUM_ALL_D2'),['D2']);
 assert.deepEqual(exitChoices('MEDIUM_JET','TP_MEDIUM_ALL_E'),['E']);
 assert.deepEqual(exitChoices('HEAVY','HEAVY_ALL_E'),['E']);
 assert.deepEqual(exitChoices('HEAVY','HEAVY_ALL_END'),['END']);
 assert.equal(chooseExit('HEAVY',.99),'END');
 assert.equal(chooseExit('TP',.51),'E');
 assert.equal(leaderClass('DH8D'),'TP');
 assert.equal(leaderClass('B744'),'HEAVY');
 assert.equal(leaderClass('B738'),'MEDIUM_JET');
});
test('estimated geometry and ±25% sensitivity, separate ROT vs CASA Tclear',()=>{
 assert.equal(CONFIG.casaStripHalfWidthM,140);
 assert.equal(CONFIG.exits.D2.thr24DistanceM,2050);
 assert.equal(CONFIG.exits.END.thr24DistanceM,3950);
 assert.deepEqual(clearanceRange('D2'),[63.75,106.25]);
 assert.equal(clearanceTime('D2',.5),85);
 assert.equal(clearanceTime('D2',.5,.75),63.75);
 assert.equal(clearanceTime('D2',.5,1.25),106.25);
 assert.equal(CONFIG.syntheticRunwayVacateMs,90000);
});
test('L2 table is sized analytically from leader-class uniform-mixture clearance quantiles',()=>{
 const l1=table({policy:'L1'}),l2=table({policy:'L2',target:.005});
 assert.equal(l1.TP.clearMeanS,91.25);
 assert.equal(l1.TP.clearanceTargetS,101.25);
 for(const cls of ['TP','MEDIUM_JET','HEAVY']){
  const q=l2[cls].clearanceTargetS;
  assert.ok(Math.abs(clearanceCdf(cls,q)-.995)<1e-9);
  assert.equal(l2[cls].quantile,.995);
  assert.ok(q>=clearanceClassMean(cls));
  assert.ok(l2[cls].sizing.startsWith('ANALYTIC'));
 }
 for(const p of CONFIG.l2TargetGoAroundRates){
  const t=table({policy:'L2',target:p});
  assert.ok(Math.abs(clearanceCdf('HEAVY',t.HEAVY.clearanceTargetS)-(1-p))<1e-9);
 }
});
test('follower 2 NM time is type-specific; interval and NM inversion consistent',()=>{
 for(const type of ['DH8D','B738','B744']){
  const s=followerTimeMs(2,type);
  assert.ok(s>40_000&&s<60_000);
  for(const d of [2,4,10,15]){
   assert.ok(Math.abs(followerDistanceNM(followerTimeMs(d,type),type)-d)<.002);
  }
 }
 const leader={leaderClass:'HEAVY',wake:'H',type:'B744'};
 const follower={type:'B738',wake:'M'};
 const interval=requiredIntervalMs(leader,follower,{policy:'L2',target:.01});
 assert.ok(interval>=followerTimeMs(2,'B738'));
 assert.equal(requiredIntervalMs(leader,follower,{policy:'L0'}),225000);
});
test('immutable matched manifests: 10-16 and 20/h, departure 0 or 2, no random CAT I',()=>{
 for(const rate of [10,12,14,16,20])for(const depPerHour of [0,2]){
  const m=manifest({rate,depPerHour,seed:20261116});
  assert.equal(m.runway,'24');
  assert.equal(m.arrivals.length,rate*2);
  assert.equal(m.departures.length,depPerHour*2);
  assert.ok(m.arrivals.every(a=>a.catIOnlyRequested===false&&a.exitQuantile>=0&&
   a.clearanceQuantile>=0&&a.heavyCriticalAreaOccupied===false));
  assert.equal(digest(m),digest(manifest({rate,depPerHour,seed:20261116})));
 }
});
test('B3 L0 reproduces A1.4 unchanged LVP 10NM baseline with post-vacate departure practice',()=>{
 for(const rate of [10,12,14,16,20])for(const depPerHour of [0,2]){
  const m=manifest({rate,depPerHour,seed:20261118});
  const x=simulate(m,{policy:'L0'}),baseline=reproduceA14(m);
  assert.equal(x.metrics.arrivalsPerHour,baseline.metrics.arrivalRatePerHour);
  assert.equal(x.metrics.departuresPerHour,baseline.metrics.departureRatePerHour);
  assert.equal(x.totals.servedArrivalsByDrain,baseline.totals.servedArrivals);
  assert.equal(x.totals.servedDeparturesByDrain,baseline.totals.servedDepartures);
  assert.equal(x.totals.casaGoArounds,0);
  assert.equal(x.totals.heavyCriticalGoArounds,0);
  for(const d of x.departures.filter(a=>a.status==='served'&&a.reason!=='FIFO_DRAIN'))
   assert.equal(d.runwayVacatedBeforeEntry===false,false); // passage constrained by gate
 }
});
test('go-around is an attempt event at follower 2 NM, not a served landing',()=>{
 const m=manifest({rate:20,depPerHour:0,seed:20261116});
 m.arrivals[0].leaderClass='HEAVY';m.arrivals[0].wake='H';
 m.arrivals[0].exitQuantile=.999;
 m.arrivals[0].clearanceQuantile=.999;
 m.arrivals[1].type='B738';m.arrivals[1].wake='M';
 // Increase clear time on a single leader through an explicit synthetic draw.
 const x=simulate(m,{policy:'L1',scale:1.25,mix:'HEAVY_ALL_END'});
 assert.equal(x.totals.arrivalRequests,m.arrivals.length);
 assert.equal(x.totals.arrivalRequests,x.totals.servedArrivalsByDrain+x.totals.censoredArrivals);
 assert.equal(x.totals.departureRequests,x.totals.servedDeparturesByDrain+x.totals.censoredDepartures);
 assert.ok(x.attempts.every(a=>a.event==='MISSED_APPROACH'));
 assert.ok(x.arrivals.filter(a=>a.status==='served').every(a=>a.attemptCount>=1));
});
test('Clopper-Pearson exact confidence bounds include rare zero and all-event cases',()=>{
 const z=exactBinomial(0,100);
 assert.equal(z.lower,0);
 assert.ok(Math.abs(z.upper-.03621669264517642)<1e-8);
 const all=exactBinomial(100,100);
 assert.equal(all.upper,1);
 assert.ok(Math.abs(all.lower-Math.pow(.025,1/100))<1e-8);
 const one=exactBinomial(1,10);
 assert.ok(Math.abs(one.lower-.00252857854)<1e-7);
 assert.ok(Math.abs(one.upper-.44501612)<1e-6);
 assert.equal(one.method,'CLOPPER_PEARSON_EXACT');
});
test('50 paired seeds produce L0/L1/L2 under both DEP cases and exact-binomial outputs',()=>{
 const result=runSweep({rates:[10],seedCount:50,scales:[1],mixes:['EQUAL_SPLIT']});
 assert.equal(result.scenarioCount,10);
 assert.ok(result.scenarios.every(s=>s.seedCount===50&&s.pairedEqualManifests&&
  s.perSeed.length===50&&s.casaGoAroundExact95));
 for(const depPerHour of [0,2]){
  const cases=result.scenarios.filter(x=>x.depPerHour===depPerHour);
  assert.equal(cases.length,5);
  assert.equal(cases.filter(x=>x.policy==='L2').length,3);
  assert.ok(cases.every(x=>x.pairedByDrain.servedArrivalsByDrain.n===50));
  const l0=cases.find(x=>x.policy==='L0');
  assert.deepEqual(l0.pairedPolicyMinusL0.arrivalsPerHour.ci95,[0,0]);
  assert.equal(l0.casaGoAroundExact95.method,'CLOPPER_PEARSON_EXACT');
 }
});
