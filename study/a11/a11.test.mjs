import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureProbability,captureDistance,isBusyArrival,classifyRegime,typeFamily,quantileType7,
  observeDay,stats,hardMetrics,CAPTURE_DIGEST,stratumPairs,selectHourlyMetar,syntheticWeatherClass} from './observation.mjs';
import {profileFor,timeToGoMs,makeScenarioManifest,wakeFloorNM,materialize,assignEffectiveTargets,runAssignedManifest,minimumCommonFinalNM,evaluateSynthetic,
  scoreModel,fitDevelopment,APPROVED_TYPE_WEIGHTS,selectType,FIT_POLICY,A11_PARAMETER_NAMES,parameterVector,fromParameterVector} from './model.mjs';
import {validateHoldout} from './validate.mjs';
import {compare2018,EUROCONTROL_2018_REFERENCE} from './2018.mjs';
import {canonical,digest} from '../core.mjs';
const benchmark=JSON.parse(readFileSync(new URL('../benchmarks/sep2026-dev-busy12.json',import.meta.url),'utf8'));
const SHA='0123456789abcdef0123456789abcdef01234567';
test('approved pooled development targets, exactly 12 hard metrics, immutable holdout split',()=>{
 assert.equal(benchmark.status,'OBSERVED_AGGREGATE_DEV');
 assert.equal(benchmark.strata.find(x=>x.id==='overall_5NM').nPairs,469);
 assert.equal(benchmark.strata.find(x=>x.id==='overall_5NM').nPairsWithDistance,353);
 assert.equal(benchmark.days.development.length,17);assert.equal(benchmark.days.holdout.length,8);
 assert.deepEqual(benchmark.days.holdout,[3,6,9,12,15,24,27,30]);
 assert.equal(hardMetrics(benchmark).length,12);
 assert.equal(benchmark.hardTolerances.overall_5NM.intMedian,13.7277);
 assert.equal(benchmark.hardTolerances.overall_5NM.distMedian,.3694);
 assert.ok(!Object.keys(benchmark).includes('holdoutMetrics'));
});

test('empirical capture is deterministic and upper tail is actually censored',()=>{
 assert.equal(captureProbability(120),1);
 assert.equal(captureProbability(180),120/121);
 assert.equal(captureProbability(240),68/101);
 assert.equal(captureProbability(300),4/30);
 assert.equal(captureProbability(400),0);
 assert.equal(captureDistance(240,.65),true);
 assert.equal(captureDistance(240,.70),false);
 assert.equal(captureDistance(100,.1,false),false);
 assert.match(CAPTURE_DIGEST,/^[a-f0-9]{64}$/);
});

test('event-based busy-12: both windows and half-open endpoint',()=>{
 const xs=Array.from({length:12},(_,i)=>i*180000);
 assert.equal(isBusyArrival(0,xs),true);
 assert.equal(isBusyArrival(1800000,xs),true);
 const sparse=Array.from({length:12},(_,i)=>i*3600000);
 assert.equal(isBusyArrival(sparse[0],sparse),false);
 assert.equal(isBusyArrival(0,[0,...Array.from({length:11},(_,i)=>3600000+i*5000)]),false);
});

test('takeoff boundaries and any heavy precedence, both runways type mapping',()=>{
 const a=1000,b=300000;
 assert.equal(classifyRegime(a,b,[{takeoffMs:1200,mtowTonnes:75}]),'8NM');
 assert.equal(classifyRegime(a,b,[{takeoffMs:1200,mtowTonnes:75},{takeoffMs:2400,mtowTonnes:136}]),'10NM');
 assert.equal(classifyRegime(a,b,[{takeoffMs:1000,mtowTonnes:200},{takeoffMs:300000,mtowTonnes:200}]),'5NM');
 assert.equal(typeFamily('PC12'),'TP');
 assert.equal(typeFamily('AT76'),'TP');
 assert.equal(typeFamily('E295'),'J');
 assert.equal(quantileType7([1,2,3,4],.5),2.5);
});

test('observation retains interval when capture missing and uses separate denominators',()=>{
 const arrivals=Array.from({length:18},(_,i)=>({id:'S'+i,type:i%2?'DH8D':'B738',runway:'24',
  timeMs:i*160000,headwindKt:0,captureQuantile:i===5?.999:0,equivalentDistanceNM:i===5?17:6}));
 const obs=observeDay({dayId:'SYN',arrivals});
 assert.ok(obs.length>0);
 assert.ok(obs.some(p=>p.distanceNM===null));
 const s=stats(obs);
 assert.ok(s.nPairsWithDistance<s.nPairs);
 assert.equal(stratumPairs(obs,'overall_5NM').length,obs.length);
});

test('type-specific IAS estimates, segments and time-to-go differ',()=>{
 const b=profileFor('B738'),d=profileFor('DH8D');
 assert.equal(b.segments[0].iasKt,180);
 assert.equal(b.segments[1].iasKt,160);
 assert.equal(b.segments[2].iasKt,147.5);
 assert.equal(d.segments[2].iasKt,130.6);
 assert.ok(timeToGoMs(4*1852,d)>timeToGoMs(4*1852,b));
 assert.ok(timeToGoMs(6*1852,b)>timeToGoMs(4*1852,b));
 assert.ok(timeToGoMs(4*1852,profileFor('B738',10))>timeToGoMs(4*1852,b));
});

test('ICAO PANS-ATM minima and no Super fallback',()=>{
 assert.equal(wakeFloorNM('H','H'),4);
 assert.equal(wakeFloorNM('H','M'),5);
 assert.equal(wakeFloorNM('H','L'),6);
 assert.equal(wakeFloorNM('M','L'),5);
 assert.equal(wakeFloorNM('M','M'),3);
 assert.throws(()=>wakeFloorNM('J','S'),/unsupported wake/);
});

test('manifest quantiles are immutable and model outputs reproducible without PRNG',()=>{
 const manifest=makeScenarioManifest({seed:12,days:5,perDay:24});
 const p={shift:1.8,sigma:.34,mu:[1.48,1.47,1.35],w:.25,muTail:2.3,sigmaTail:.4};
 const before=canonical(manifest);
 const orig=Math.random;Math.random=()=>{throw Error('runner used Math.random');};
 try {
  const a=evaluateSynthetic(manifest,p),b=evaluateSynthetic(manifest,p);
  assert.equal(canonical(a),canonical(b));
  assert.equal(canonical(manifest),before);
  const m=materialize(manifest,p);
  assert.equal(m.days[0].arrivals[1].effectiveTargetSource,'TARGET_AS_EQUIVALENT_TRACK_DISTANCE');
  assert.ok(m.days[0].arrivals[1].effectiveTargetM>0);
 }finally{Math.random=orig;}
});

test('fit is development-only and deterministic on synthetic small sample',()=>{
 const a=fitDevelopment(benchmark,{seed:22,days:5,perDay:24,maxRounds:2});
 const b=fitDevelopment(benchmark,{seed:22,days:5,perDay:24,maxRounds:2});
 assert.equal(canonical(a.parameters),canonical(b.parameters));
 assert.equal(canonical(a.score),canonical(b.score));
 assert.equal(a.provenance.benchmarkSha256,digest(benchmark));
 assert.equal(a.provenance.captureDigest,CAPTURE_DIGEST);
 const bad=structuredClone(benchmark);bad.status='OBSERVED_AGGREGATE_ALL_DAYS';
 assert.throws(()=>fitDevelopment(bad,{days:5,perDay:24,maxRounds:1}),/only approved/);
});

test('holdout refuses absent, forged or mismatched approval attestation',()=>{
 const lock=JSON.parse(readFileSync(new URL('./calibration-lock.json',import.meta.url),'utf8'));
 const attestation=JSON.parse(readFileSync(new URL('./calibration-approval.json',import.meta.url),'utf8'));
 const holdout=JSON.parse(readFileSync(new URL('../benchmarks/sep2026-holdout-busy12.json',import.meta.url),'utf8'));
 const SHA_LOCK=attestation.lockCommitSha;
 assert.throws(()=>validateHoldout({lock,development:benchmark,holdout,lockCommitSha:SHA_LOCK}),/approved/);
 assert.throws(()=>validateHoldout({lock,attestation:{...attestation,lockSha256:'0'.repeat(64)},development:benchmark,holdout,lockCommitSha:SHA_LOCK}),/approved/);
 assert.throws(()=>validateHoldout({lock,attestation,development:benchmark,holdout:{...holdout,days:holdout.days.slice(1)},lockCommitSha:SHA_LOCK}),/holdout days/);
 assert.throws(()=>validateHoldout({lock,attestation,development:benchmark,holdout,lockCommitSha:SHA}),/approved/);
 assert.equal(attestation.lockSha256,digest(lock));
 const result=validateHoldout({lock,attestation,development:benchmark,holdout,lockCommitSha:SHA_LOCK});
 assert.equal(result.status,'PASS');
 assert.equal(result.results.length,12);
 assert.ok(result.results.every(r=>r.status==='PASS'));
});

test('generator writes immutable requested target; physical runner uses it without randomness',()=>{
 const raw=makeScenarioManifest({seed:303,days:2,perDay:24});
 const p={shift:1.8,sigma:.34,mu:[1.48,1.47,1.35],w:.25,muTail:2.3,sigmaTail:.4};
 const assigned=assignEffectiveTargets(raw,p);
 assert.ok(Number.isSafeInteger(assigned.flights[0][1].effectiveTargetM));
 assert.equal(raw.flights[0][1].effectiveTargetM,undefined);
 const before=canonical(assigned);
 const a=runAssignedManifest(assigned);
 assert.equal(canonical(a),canonical(runAssignedManifest(assigned)));
 assert.equal(canonical(assigned),before);
 assert.equal(a.days[0].arrivals[1].effectiveTargetM,assigned.flights[0][1].effectiveTargetM);
 assert.throws(()=>runAssignedManifest(raw),/assigned synthetic/);
});
test('different type trajectories retain 3NM common-final floor',()=>{
 const a=profileFor('DH8D'),b=profileFor('B738');
 const interval=timeToGoMs(3*1852,b);
 assert.ok(Number.isFinite(minimumCommonFinalNM(a,b,interval)));
 const assigned=assignEffectiveTargets(makeScenarioManifest({seed:15,days:3,perDay:24}),
  {shift:.1,sigma:.05,mu:[.1,.1,.1],w:.1,muTail:2.3,sigmaTail:.4});
 const result=runAssignedManifest(assigned);
 assert.ok(result.floorRaised>0);
 for(const day of result.days)for(const arr of day.arrivals.slice(1))
  assert.ok(arr.minimumCommonFinalNM>=3-1e-6);
});

test('2018 reference distinguishes observed/optimal technical capacities and unit types',()=>{
 const aa=compare2018({mode:'AA',runway:'24',syntheticRate:32,capacityEligible:false,matchedMode:true});
 assert.equal(aa.observedTechnical,21.3);
 assert.equal(aa.optimalTechnical,24.2);
 assert.equal(aa.measure,'ARRIVALS_PER_HOUR');
 assert.equal(aa.comparison,'NOT_COMPARABLE');
 assert.equal(aa.deltaObserved,null);
 assert.equal(aa.illustrativeArithmeticDeltaObserved,10.7);
 const ada=compare2018({mode:'ADA',runway:'24',syntheticRate:32,capacityEligible:true,matchedMode:false});
 assert.equal(ada.measure,'MOVEMENTS_PER_HOUR');
 assert.equal(ada.observedTechnical,26.5);
 assert.equal(ada.optimalTechnical,34.64);
 assert.equal(ada.comparison,'NOT_COMPARABLE');
 assert.equal(EUROCONTROL_2018_REFERENCE.metrics.DD['06'].optimal,29.6);
});

test('hourly METAR matching, non-LVP and 15kt boundaries are deterministic filters only',()=>{
 const hour=8*3600000,follow=hour+40*60000;
 const r1={timeMs:hour-91*60000,visibilityM:9999};
 const r2={timeMs:hour-90*60000,visibilityM:9999};
 const r3={timeMs:hour-30*60000,visibilityM:9999,windDirectionDeg:240,windKt:15};
 const r4={timeMs:hour+1000,visibilityM:300};
 assert.equal(selectHourlyMetar(follow,[r1,r2,r3,r4]),r3);
 assert.equal(selectHourlyMetar(follow,[r1,r4]),null);
 assert.equal(selectHourlyMetar(follow,[r2]),r2);
 assert.equal(syntheticWeatherClass(r3,240).classification,'HW15_REPORT');
 assert.equal(syntheticWeatherClass({...r3,windKt:14.9},240).classification,'GOOD_WEATHER');
 assert.equal(syntheticWeatherClass({...r3,ceilingType:'BKN',ceilingFt:200},240).classification,'LVP_PROXY');
 assert.equal(syntheticWeatherClass({...r3,rvrAM:800},240).classification,'LVP_PROXY');
 assert.equal(syntheticWeatherClass({...r3,windDirectionDeg:null,windKt:null},240).classification,'GOOD_WEATHER');
 assert.equal(syntheticWeatherClass(null,240).fitEligible,false);
});

test('L1: exactly eight free parameters, deterministic core/tail assignment and long tail',()=>{
 const p={shift:1.8,sigma:.2,mu:[1.4,1.4,1.4],w:.3,muTail:2.6,sigmaTail:.3};
 assert.equal(parameterVector(p).length,8);
 assert.equal(A11_PARAMETER_NAMES.length,8);
 assert.deepEqual(fromParameterVector(parameterVector(p)),p);
 assert.throws(()=>fromParameterVector([1,2,3,4,5]),/8 parameters/);
 const raw=makeScenarioManifest({seed:43,days:8,perDay:48});
 const assigned=assignEffectiveTargets(raw,p);
 const comps=assigned.flights.flat().map(x=>x.effectiveTargetComponent);
 assert.ok(comps.includes('TAIL'));assert.ok(comps.includes('CORE'));
 const tail=assigned.flights.flat().filter(x=>x.effectiveTargetComponent==='TAIL');
 assert.ok(tail.some(x=>x.effectiveTargetM>9*1852),'tail must reach longer equivalent track miles');
 assert.equal(assigned.distributionParametersSha256,digest(p));
});
test('L2: pooled family counts are exact, heavies present, wake categories exercised',()=>{
 assert.equal(APPROVED_TYPE_WEIGHTS.reduce((n,t)=>n+t.count,0),1851);
 const h=selectType(.8);assert.ok(h);
 const m=makeScenarioManifest({seed:20261114,days:15,perDay:60});
 const fs=m.flights.flat();
 assert.ok(fs.some(x=>x.wake==='H'&&x.type==='B744'));
 assert.ok(fs.some(x=>x.type==='A320'));
 assert.ok(fs.some(x=>x.type==='E190'));
 assert.ok(fs.some(x=>x.type==='PC12'));
 assert.ok(fs.some((x,i)=>i>0&&x.wake==='M'&&fs[i-1].wake==='H'));
 assert.equal(wakeFloorNM('H','M'),5);
});
test('N1: cross-runway consecutive arrivals are kept as observed pairs',()=>{
 const arrivals=Array.from({length:20},(_,i)=>({id:'S'+i,type:'B738',
  runway:i%2?'06':'24',timeMs:i*150000,headwindKt:0,captureQuantile:0,equivalentDistanceNM:6}));
 const pairs=observeDay({dayId:'SYN',arrivals});
 assert.ok(pairs.length>0);
 assert.ok(pairs.some(p=>p.leaderId==='S0'&&p.followerId==='S1'));
});
test('N2 and N3: ROT floor is named, binding is recorded, synthetic counts not observed capacity',()=>{
 const preset=JSON.parse(readFileSync(new URL('./SEP2026_FITTED.json',import.meta.url),'utf8'));
 assert.equal(preset.arrivalRotProxyMs,80000);
 const p={shift:.1,sigma:.05,mu:[.1,.1,.1],w:.1,muTail:2.4,sigmaTail:.3};
 const r=evaluateSynthetic(makeScenarioManifest({seed:2,days:3,perDay:24}),p);
 assert.ok(r.totals.rotFloorBindings>=0);
 assert.equal(r.meta.rotProxyMs,80000);
 assert.match(r.meta.hourlyCountStatus,/NOT_COMPARABLE/);
});
test('L3: single published candidate fitting policy and stopping provenance',()=>{
 assert.equal(FIT_POLICY.maxRounds,60);
 assert.equal(FIT_POLICY.seed,20261114);
 const r=fitDevelopment(benchmark,{seed:12,days:4,perDay:24,maxRounds:2});
 assert.ok(['MAX_ROUNDS','STEP_TOLERANCE'].includes(r.stopping.termination));
 assert.ok(Number.isInteger(r.stopping.iterations));
 assert.ok(r.stopping.evaluations>0);
 assert.equal(r.provenance.freeParameterCount,8);
});

test('locked holdout has approved exact dates, denominator gates and no fit input contamination',()=>{
 const h=JSON.parse(readFileSync(new URL('../benchmarks/sep2026-holdout-busy12.json',import.meta.url),'utf8'));
 assert.equal(h.status,'OBSERVED_AGGREGATE_HOLDOUT');
 assert.deepEqual(h.days,[3,6,9,12,15,24,27,30]);
 assert.equal(h.strata.find(x=>x.id==='overall_5NM').nPairs,259);
 assert.equal(h.strata.find(x=>x.id==='overall_5NM').nPairsWithDistance,198);
 for(const id of ['overall_5NM','J-J','J-TP','TP-J']){
  const st=h.strata.find(x=>x.id===id);
  assert.ok(st.nPairsWithDistance>=15&&st.nDaysWithDistance>=5);
 }
 assert.equal(h.sourceExportFullSha256NotPublished,true);
 assert.equal(h.lockSha256,'be55a9622ce770ea0f66bfdcc6d582f53948577c8e1f4bb4ffda72a7026a85fb');
});
