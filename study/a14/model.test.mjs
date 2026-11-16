import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {digest} from '../core.mjs';
import {CONFIG,VERSION,BASELINE,SENSITIVITY,validate,classifyMetar,secondsFromNM,
 holdingDecision,casaDecision,heavyCriticalDecision,feasibleMixedGap,
 makeManifest,simulate,runReplication} from './model.mjs';
const d=(over={})=>classifyMetar({visibilityM:5000,ceilingFt:1500,rvrAM:2000,...over});
test('L1 METAR inclusive notification, 200ft never optional, overrides preparation',()=>{
 assert.equal(d({ceilingFt:200}).state,'NOTIFICATION');
 assert.equal(d({rvrAM:800}).state,'NOTIFICATION');
 assert.equal(d({visibilityM:1500}).state,'PREPARATION');
 assert.equal(d({ceilingFt:300}).state,'PREPARATION');
 assert.equal(d({ceilingFt:201}).state,'PREPARATION');
 assert.equal(d({ceilingFt:301,visibilityM:1501,rvrAM:801}).state,'NORMAL');
});
test('L2 unknown weather inputs do not automatically imply normal or actual LVP declaration',()=>{
 const u=classifyMetar({rvrAM:null,ceilingFt:null,visibilityM:null});
 assert.equal(u.state,'UNKNOWN');
 assert.equal(u.source,'METAR_PROXY');
 assert.equal(u.operationalDeclarationVerified,false);
 assert.equal(d({ceilingFt:200,rvrAM:null}).state,'NOTIFICATION');
 assert.equal(d({rvrAM:null}).state,'UNKNOWN');
});
test('L3 10NM is recommendation not hard safety minimum; runway06 independent',()=>{
 assert.equal(CONFIG.runways['24'].planningType,'SHOULD_NOT_HARD_MINIMUM');
 assert.notEqual(CONFIG.runways['06'].planningType,CONFIG.runways['24'].planningType);
 assert.equal(CONFIG.runways['06'].observationalStatus,'PARAMETERS_ONLY_NO_OBSERVED_LVP_CASE');
 assert.equal(CONFIG.synthetic.hardSeparationNM,3);
});
test('L4 holding point is exact 10NM medium and 15NM heavy threshold',()=>{
 for(const [cat,limit] of [['MEDIUM',10],['HEAVY',15]]){
  assert.equal(holdingDecision({departureCategory:cat,inboundNM:limit,passageMs:0}).allowed,true);
  assert.equal(holdingDecision({departureCategory:cat,inboundNM:limit-.001,passageMs:0}).allowed,false);
  assert.equal(holdingDecision({departureCategory:cat,inboundNM:limit+1,passageMs:0}).allowed,true);
  assert.equal(holdingDecision({departureCategory:cat,inboundNM:0,phase:'PREPARATION'}).allowed,true);
 }
});
test('L4 baseline after vacated; 266s mixed P10 must FAIL and not be tuned',()=>{
 const medium=feasibleMixedGap(),heavy=feasibleMixedGap(CONFIG,{category:'HEAVY'});
 assert.equal(medium.entryPolicy,BASELINE);
 assert.equal(medium.holdingPassageMs,CONFIG.synthetic.arrivalROTMs);
 assert.equal(medium.minimumFeasibleIntervalS,315);
 assert.equal(heavy.minimumFeasibleIntervalS,427.5);
 assert.equal(medium.gate,'FAIL_MODEL_ASSUMPTION_CONFLICT');
 assert.equal(heavy.gate,'FAIL_MODEL_ASSUMPTION_CONFLICT');
 const sensitivity=feasibleMixedGap(CONFIG,{entryPolicy:SENSITIVITY});
 assert.equal(sensitivity.minimumFeasibleIntervalS,255);
 assert.equal(sensitivity.gate,'PASS');
 assert.equal(sensitivity.baselineActualPractice,false);
});
test('L4 ROT uncertainty 75–110s does not force artificial 266s baseline pass',()=>{
 for(const rotMs of CONFIG.synthetic.arrivalROTSensitivityMs)
  assert.ok(feasibleMixedGap(CONFIG,{rotMs}).minimumFeasibleIntervalS>266);
});
test('L5 CASA default full CAT II/III even if weather suggests CAT I',()=>{
 for(const ceilingFt of [100,200,300]){
  const p=d({ceilingFt});
  if(p.state!=='NOTIFICATION')continue;
  const res=casaDecision({arrival:{id:'A'},phase:p.state,taxiInCasa:true,
   followerAt2NmMs:1000,leaderLandingRunEndMs:2000,casaClearMs:3000});
  assert.equal(res.taxiCasaCheckEnabled,true);
  assert.equal(res.taxiCasaViolation,true);
  assert.equal(res.criticalAreaProtectionRetained,true);
 }
});
test('L5/L6 only explicitly requested CAT_I_ONLY removes taxi CASA check',()=>{
 const base={phase:'NOTIFICATION',taxiInCasa:true,followerAt2NmMs:1000,
  leaderLandingRunEndMs:2000,casaClearMs:3000};
 const one=casaDecision({...base,arrival:{id:'A',catIOnlyRequested:true}});
 const two=casaDecision({...base,arrival:{id:'B',catIOnlyRequested:false}});
 assert.equal(one.taxiCasaCheckEnabled,false);
 assert.equal(one.taxiCasaViolation,false);
 assert.equal(one.sensitiveAreaBlocked,true);
 assert.equal(one.criticalAreaProtectionRetained,true);
 assert.equal(two.taxiCasaCheckEnabled,true);
 assert.equal(two.taxiCasaViolation,true);
 assert.equal(two.source,'DEFAULT_CAT_II_III');
});
test('L7 CASA clear distinct from vacated and leader landing-run end',()=>{
 const m=makeManifest(),result=simulate(m);
 const a=result.arrivals[0];
 assert.notEqual(a.runwayVacatedMs,a.casaClearMs);
 assert.notEqual(a.landingRunEndMs,a.casaClearMs);
 assert.ok(result.events.some(x=>x.event==='ARR_THRESHOLD'));
 assert.ok(result.events.some(x=>x.event==='CASA_CLEAR'));
 assert.ok(result.events.some(x=>x.event==='LANDING_RUN_END'));
});
test('L8 exactly 12NM critical area does not meet inside trigger, just inside does',()=>{
 const a={id:'HEAVY-A'};
 assert.equal(heavyCriticalDecision({arrival:a,inboundNM:12,heavyCriticalAreaOccupied:true}).outcome,'CONTINUE');
 const miss=heavyCriticalDecision({arrival:a,inboundNM:11.99,heavyCriticalAreaOccupied:true,thresholdMs:100});
 assert.equal(miss.outcome,'MISSED_APPROACH');
 assert.equal(miss.reason,'CRITICAL_AREA_HEAVY');
 assert.equal(miss.nextAttemptId,'HEAVY-A:attempt-2');
 assert.equal(miss.reentryAtMs,100+CONFIG.synthetic.goAroundReentryDelayMs);
 assert.equal(heavyCriticalDecision({arrival:a,inboundNM:11,heavyCriticalAreaOccupied:false}).outcome,'CONTINUE');
});
test('L8 simulator conserves missed approach original arrival ID and attempt ID',()=>{
 const m=makeManifest(CONFIG,{seed:42,arrivalOnly:true});
 m.arrivals[0].criticalHeavyInboundNM=11;
 m.arrivals[0].heavyCriticalAreaOccupied=true;
 const x=simulate(m);
 assert.equal(x.totals.missedApproaches,1);
 assert.equal(x.totals.arrivalRequests,m.arrivals.length);
 assert.equal(x.arrivals[0].attemptId,'ARR-0:attempt-2');
 assert.ok(x.events.some(x=>x.event==='MISSED_APPROACH'&&x.reason==='CRITICAL_AREA_HEAVY'));
 assert.equal(new Set(x.arrivals.map(x=>x.id)).size,m.arrivals.length);
});
test('L9 RWY06 is parameter-only and no winter observation is invented',()=>{
 assert.deepEqual(CONFIG.runways['06'].exitNames,['D1','C','END']);
 assert.deepEqual(CONFIG.runways['06'].departureHoldingPoints,['G','B4']);
 assert.equal(CONFIG.observedWinter.lvpWithDeparture.belowBaselineMinimumShare,null);
});
test('L10 baseline runner never conditionally enters behind a landing aircraft',()=>{
 const m=makeManifest(CONFIG,{seed:11,arrivalOnly:false});
 const r=simulate(m,CONFIG,{entryPolicy:BASELINE});
 assert.ok(r.departures.every(x=>x.runwayEntryPractice===BASELINE));
 assert.ok(r.departures.filter(x=>x.status==='served'&&x.reason!=='DRAIN_FIFO')
  .every(x=>x.runwayVacatedBeforeEntry===true));
 assert.equal(r.totals.arrivalRequests,m.arrivals.length);
 assert.equal(r.totals.departureRequests,m.departures.length);
 assert.equal(r.totals.departureRequests,r.totals.servedDepartures+r.totals.censoredDepartures);
});
test('L10 paired 50-seed cases use identical immutable manifests and reconcile demand',()=>{
 const r=runReplication();
 assert.equal(r.cases.length,12);
 assert.equal(r.baselineMixedFeasibility.overall,'FAIL_MODEL_ASSUMPTION_CONFLICT');
 for(const x of r.cases){
  assert.equal(x.n,50);
  assert.equal(x.perSeed.length,50);
  assert.ok(x.allDemandReconciled);
 }
 for(const arrivalOnly of [true,false])for(const phase of ['NORMAL','PREPARATION','NOTIFICATION']){
  const a=r.cases.find(x=>x.arrivalOnly===arrivalOnly&&x.phase===phase&&x.entryPolicy===BASELINE);
  const b=r.cases.find(x=>x.arrivalOnly===arrivalOnly&&x.phase===phase&&x.entryPolicy===SENSITIVITY);
  assert.deepEqual(a.perSeed.map(x=>x.manifestHash),b.perSeed.map(x=>x.manifestHash));
 }
});
test('L11 observed winter source has separate denominators and remains report-only',()=>{
 const w=CONFIG.observedWinter;
 assert.equal(w.fogNoDeparture.pairs,54);
 assert.equal(w.fogNoDeparture.withDistance,17);
 assert.equal(w.fogNoDeparture.intervalS[1],304);
 assert.equal(w.cloudOnlyNoDeparture.distNM[1],9.10);
 assert.equal(w.lvpWithDeparture.pairs,29);
 assert.equal(w.lvpWithDeparture.withDistance,9);
 assert.equal(w.lvpWithDeparture.intervalS[0],266);
 assert.equal(CONFIG.outputs.holdoutValidation,false);
});
test('L12 only unvalidated named assumptions and source-tagged procedure metadata',()=>{
 assert.equal(validate(CONFIG),CONFIG);
 assert.equal(VERSION,'A1.4-LVP-post-vacate-candidate-1');
 assert.equal(CONFIG.sources.sections.holdingPoint,'PENDING_VERIFICATION');
 assert.equal(CONFIG.protection.conditionalSensitivity,SENSITIVITY);
 assert.equal(CONFIG.outputs.operationalCapacityClaim,false);
});

test('L4 targeted ready-time fixture distinguishes actual post-vacate from hypothetical entry',()=>{
 const m=makeManifest(CONFIG,{seed:88,arrivalOnly:false});
 m.departures[0].requestMs=180000;m.departures[0].category='MEDIUM';
 const actual=simulate(m,CONFIG,{entryPolicy:BASELINE});
 const conditional=simulate(m,CONFIG,{entryPolicy:SENSITIVITY});
 const a=actual.departures.find(x=>x.id==='DEP-0');
 const b=conditional.departures.find(x=>x.id==='DEP-0');
 assert.equal(a.status,'served');
 assert.equal(b.status,'served');
 assert.equal(a.runwayVacatedBeforeEntry,true);
 assert.equal(b.runwayVacatedBeforeEntry,false);
 assert.ok(a.holdingPointPassageMs>b.holdingPointPassageMs);
 assert.equal(b.runwayEntryPractice,'HYPOTHETICAL_NOT_ELLX_LVP_PRACTICE');
 assert.ok(actual.arrivals[1].thresholdMs>=conditional.arrivals[1].thresholdMs);
});
test('L4 holding gate is evaluated at passage time, not at roll or airborne',()=>{
 const x=holdingDecision({departureCategory:'HEAVY',inboundNM:14.999,passageMs:1234});
 assert.equal(x.allowed,false);
 assert.equal(x.event,'CAT_II_III_HOLDING_POINT_PASSAGE');
 assert.equal(x.passageMs,1234);
});
