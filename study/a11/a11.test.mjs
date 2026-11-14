import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {captureProbability,captureDistance,isBusyArrival,classifyRegime,typeFamily,quantileType7,
  observeDay,stats,hardMetrics,CAPTURE_DIGEST,stratumPairs} from './observation.mjs';
import {profileFor,timeToGoMs,makeScenarioManifest,wakeFloorNM,materialize,assignEffectiveTargets,runAssignedManifest,minimumCommonFinalNM,evaluateSynthetic,
  scoreModel,fitDevelopment} from './model.mjs';
import {validateHoldout} from './validate.mjs';
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
 const p={shift:1.8,sigma:.34,mu:[1.48,1.47,1.35]};
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

test('holdout evaluation refuses non-approved lock and no missing-day substitution',()=>{
 const lock={status:'CANDIDATE_NOT_APPROVED',hardMetricCount:12};
 assert.throws(()=>validateHoldout({lock,development:benchmark,holdout:{},lockCommitSha:SHA}),/approved/);
 const holdout={status:'OBSERVED_AGGREGATE_HOLDOUT',days:benchmark.days.holdout.slice(1),strata:[]};
 const approved={...lock,status:'APPROVED_LOCK',sourceStatus:'OBSERVED_AGGREGATE_DEV',benchmarkSha256:digest(benchmark)};
 assert.throws(()=>validateHoldout({lock:approved,development:benchmark,holdout,lockCommitSha:SHA}),/holdout days/);
});

test('generator writes immutable requested target; physical runner uses it without randomness',()=>{
 const raw=makeScenarioManifest({seed:303,days:2,perDay:24});
 const p={shift:1.8,sigma:.34,mu:[1.48,1.47,1.35]};
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
  {shift:.1,sigma:.05,mu:[.1,.1,.1]});
 const result=runAssignedManifest(assigned);
 assert.ok(result.floorRaised>0);
 for(const day of result.days)for(const arr of day.arrivals.slice(1))
  assert.ok(arr.minimumCommonFinalNM>=3-1e-6);
});
