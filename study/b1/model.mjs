// B1: hypothetical on-final spacing indicator sensitivity. NOT operational ATC guidance.
// Reuses the locked A1.1 distribution and the A1.2 FIFO/runway scheduler unchanged
// unless an explicitly supplied, opt-in spacing callback is active.
import {readFileSync} from 'node:fs';
import {digest} from '../core.mjs';
import {makeManifest as a12Manifest,simulate as a12Simulate,
 DEFAULT_CONFIG as A12,CONDITIONAL,DISTANCE,TIME,minArrivalThresholdGapMs} from '../a12/model.mjs';
import {wakeFloorNM,profileFor,timeToGoMs} from '../a11/model.mjs';
export const CONFIG=Object.freeze(JSON.parse(readFileSync(new URL('./B1_SENSITIVITY.json',import.meta.url),'utf8')));
export const VERSION='B1-SPACING-SENSITIVITY-CANDIDATE-1';
const H=3600000,NM=1852;
const requireTrue=(v,m)=>{if(!v)throw Error(m);};
const random=seed=>{let x=seed>>>0||1;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};};
const quant=(xs,p)=>{const a=xs.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const i=(a.length-1)*p,j=Math.floor(i);return a[j]+(a[Math.min(j+1,a.length-1)]-a[j])*(i-j);};
const avg=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
export function validateB1(c=CONFIG){
 requireTrue(c.schema===1&&c.preset==='B1_HYPOTHETICAL_SPACING_TOOL_NON_OPERATIONAL','B1 sensitivity only');
 requireTrue(JSON.stringify(c.arrivalDemandPerHour)==='[20,22,24]','demand levels');
 requireTrue(JSON.stringify(c.reductionFractions)==='[0,0.25,0.5,0.75]','reduction');
 requireTrue(JSON.stringify(c.toolRequiredLeadDistanceNM)==='[6,8,10]','lead distances');
 requireTrue(c.residualSpreadNM.length===2&&c.residualSpreadNM.every(x=>x>=0),'spread');
 requireTrue(c.replication.seeds>=50&&c.replication.bootstrapReplications>=1000,'replication');
 requireTrue(c.observedJoin.n===1857&&c.observedJoin.id==='OBSERVED_SEP2026_DEV_JOIN','observed join');
 requireTrue(c.observedJoin.inverseCdfKnots[0][0]===0&&
  c.observedJoin.inverseCdfKnots.at(-1)[0]===1,'CDF boundaries');
 requireTrue(c.modelLimits.operationalCapacityClaim===false,'non-operational');
 return c;
}
// Piecewise interpolation is a declared approximation to OBSERVED aggregates,
// not sampling from the unseen classified track-level joins.
export function joinDistanceNM(u,c=CONFIG){
 requireTrue(Number.isFinite(u)&&u>=0&&u<=1,'join quantile');
 const k=c.observedJoin.inverseCdfKnots;
 for(let i=1;i<k.length;i++)if(u<=k[i][0]){
  const [p0,d0]=k[i-1],[p1,d1]=k[i];
  return d0+(d1-d0)*(u-p0)/(p1-p0);
 }
 return k.at(-1)[1];
}
export function b1Config(rate,seed){
 validateB1();
 requireTrue(CONFIG.arrivalDemandPerHour.includes(rate),'rate');
 return {...A12,seed,arrivalCount:rate*A12.arrivalDemandHours,
  arrivalRequestStepMs:Math.round(H/rate)};
}
export function makeManifest(rate,seed,c=CONFIG){
 validateB1(c);
 const ac=b1Config(rate,seed),base=a12Manifest(ac,'OBSERVED_LIKE_3_PER_H_2_HEAVY');
 const rnd=random((seed^0xB1065A1D)>>>0);
 const arrivals=base.arrivals.map((a,i)=>i===0?{...a,joinDistanceNM:null,deliverySpreadQuantile:null}:
  {...a,joinDistanceNM:joinDistanceNM(rnd(),c),deliverySpreadQuantile:rnd(),
   joinSource:c.observedJoin.id});
 return {...base,arrivals,b1Provenance:'HYPOTHETICAL_TOOL_WITH_OBSERVED_JOIN_AGGREGATE',
  observedJoinId:c.observedJoin.id,b1ConfigHash:digest(c)};
}
export function spacingDecision({leader,follower,originalTargetM,hardFloorNM},
 {r,spreadNM,J,policy}){
 requireTrue(['P1','P2'].includes(policy)&&[0,.25,.5,.75].includes(r) &&
  CONFIG.residualSpreadNM.includes(spreadNM)&&CONFIG.toolRequiredLeadDistanceNM.includes(J),
  'B1 policy/parameters');
 const eligible=follower.joinDistanceNM>=J;
 if(!eligible||r===0)return null;
 const floorNM=policy==='P1'?Math.max(5,hardFloorNM):hardFloorNM;
 const originalNM=originalTargetM/NM;
 const buffer=Math.max(0,originalNM-floorNM);
 if(buffer<=0)return null;
 // Nonnegative residual variation. Do not enlarge the original delivered target.
 const residual=spreadNM*follower.deliverySpreadQuantile;
 const candidateNM=Math.min(originalNM,Math.max(floorNM,originalNM-r*buffer+residual));
 const targetM=Math.min(originalTargetM,Math.round(candidateNM*NM));
 return {targetM,originalTargetM,floorNM,bufferNM:buffer,
  deliveredTargetNM:targetM/NM,reductionFraction:r,residualSpreadNM:spreadNM,
  joinDistanceNM:follower.joinDistanceNM,requiredLeadDistanceNM:J,
  policy,eligible:true,source:'HYPOTHETICAL_NOT_OBSERVED_TOOL_PERFORMANCE'};
}
export function runOne(m,{policy='P1',r=0,spreadNM=0,J=8,gapPolicy=DISTANCE}={}){
 requireTrue(m.observedJoinId===CONFIG.observedJoin.id,'manifest join provenance');
 requireTrue([DISTANCE,TIME].includes(gapPolicy),'departure gap');
 const c=b1Config(m.arrivals.length/A12.arrivalDemandHours,m.seed);
 const callback=r===0?null:args=>spacingDecision(args,{policy,r,spreadNM,J});
 const run=a12Simulate(m,c,{sequence:CONDITIONAL,policy:gapPolicy,spacingTool:callback});
 const served=run.arrivals.filter(x=>x.status==='served');
 const pairs=served.slice(1),originalPairs=m.arrivals.slice(1);
 const reachable=originalPairs.filter(x=>x.joinDistanceNM>=J);
 const queuedPairs=pairs.filter(x=>x.queueConditional);
 const reachableQueued=queuedPairs.filter(x=>x.joinDistanceNM>=J);
 const acted=pairs.filter(x=>x.b1ToolDecision);
 let minimaRaised=0,rotBound=0,violations=0;
 const delivery=[];
 for(let i=1;i<served.length;i++){
  const lead=served[i-1],follow=served[i],interval=follow.timeMs-lead.timeMs;
  const fp=profileFor(follow.type,follow.headwindKt);
  const hardNM=Math.max(c.surveillanceNM,wakeFloorNM(lead.wake,follow.wake));
  const hardMs=minArrivalThresholdGapMs(lead,follow,c);
  if(interval<hardMs-1)violations++;
  if(Math.abs(hardMs-c.arrivalROTMs)<=c.stepMs && interval<=hardMs+c.stepMs)rotBound++;
  const targetNM=follow.b1AppliedTargetM?follow.b1AppliedTargetM/NM:follow.lockedTargetM/NM;
  if(follow.b1ToolDecision&&timeToGoMs(follow.b1AppliedTargetM,fp)<hardMs)minimaRaised++;
  delivery.push({id:follow.id,intervalS:interval/1000,
   thresholdEquivalentNM:interval/1000*160/3600,
   selectedTargetNM:targetNM,hardMinNM:hardNM,hardMinS:hardMs/1000,
   observedJoinNM:follow.joinDistanceNM,queued:follow.queueConditional,
   reached:follow.joinDistanceNM>=J,acted:!!follow.b1ToolDecision,
   underTarget:interval+1<timeToGoMs((follow.b1AppliedTargetM??follow.lockedTargetM),fp),
   decision:follow.b1ToolDecision??null});
 }
 const inWindow=x=>x.timeMs>=c.measurementStartMs&&x.timeMs<c.measurementEndMs;
 const windowArr=served.filter(inWindow),windowDep=run.departures.filter(x=>x.status==='served'&&inWindow(x));
 const delay=windowArr.map(x=>x.delayMs/1000);
 requireTrue(violations===0,'B1 hard minimum violated');
 return {meta:{version:VERSION,configHash:digest(CONFIG),manifestHash:digest(m),
  a11LockSha256:run.meta.a11Spacing.lockSha256,policy,gapPolicy,r,spreadNM,J,
  hypothetical:true,operational:false},
  metrics:{arrivalRatePerHour:windowArr.length,departureRatePerHour:windowDep.length,
   arrivalDelayMeanS:avg(delay),arrivalDelayP90S:quant(delay,.9),
   servedArrivalsByDrain:served.length,servedDeparturesByDrain:run.departures.filter(x=>x.status==='served').length,
   demandArrivals:m.arrivals.length,demandDepartures:m.opportunities.length,
   censoredArrivals:run.arrivals.filter(x=>x.status==='censored').length,
   censoredDepartures:run.departures.filter(x=>x.status==='censored').length,
   reachablePairs:reachable.length,allPairs:originalPairs.length,
   toolReachableShare:originalPairs.length?reachable.length/originalPairs.length:null,
   queuedPairs:queuedPairs.length,reachableQueuedPairs:reachableQueued.length,
   reachableQueuedShare:queuedPairs.length?reachableQueued.length/queuedPairs.length:null,
   toolActedPairs:acted.length,rotBindingPairs:rotBound,hardMinRaisedPairs:minimaRaised,
   hardMinimumViolations:violations,deliveredIntervalMedianS:quant(delivery.map(x=>x.intervalS),.5),
   deliveredTargetMedianNM:quant(delivery.map(x=>x.selectedTargetNM),.5),
   measurementStartMs:c.measurementStartMs,measurementEndMs:c.measurementEndMs,
   drainEndMs:c.drainEndMs},delivery,departures:run.departures,
  arrivals:run.arrivals};
}
export function pairedBootstrap(values,seed=CONFIG.replication.bootstrapSeed,n=CONFIG.replication.bootstrapReplications){
 const a=values.filter(Number.isFinite);if(!a.length)return {mean:null,interval95:[null,null],n:0};
 const rand=random(seed),boot=[];
 for(let k=0;k<n;k++){let sum=0;for(let i=0;i<a.length;i++)sum+=a[Math.floor(rand()*a.length)];boot.push(sum/a.length);}
 return {mean:avg(a),interval95:[quant(boot,.025),quant(boot,.975)],n:a.length};
}
export function runSweep({seeds=CONFIG.replication.seeds,rates=CONFIG.arrivalDemandPerHour}={}){
 validateB1();requireTrue(seeds>=50,'minimum 50 paired seeds');
 const result=[];
 for(const rate of rates)for(const gapPolicy of [DISTANCE,TIME]){
  const manifests=Array.from({length:seeds},(_,i)=>makeManifest(rate,CONFIG.replication.seedStart+i));
  const baseline=manifests.map(m=>runOne(m,{r:0,gapPolicy}));
  for(const policy of ['P1','P2'])for(const J of CONFIG.toolRequiredLeadDistanceNM)
   for(const spreadNM of CONFIG.residualSpreadNM)for(const r of CONFIG.reductionFractions){
    const runs=r===0?baseline:manifests.map(m=>runOne(m,{policy,J,spreadNM,r,gapPolicy}));
    const keys=['arrivalRatePerHour','departureRatePerHour','arrivalDelayMeanS','arrivalDelayP90S'];
    const diffs=Object.fromEntries(keys.map((key,i)=>[key,pairedBootstrap(runs.map((x,j)=>
      x.metrics[key]-baseline[j].metrics[key]),CONFIG.replication.bootstrapSeed+rate*1000+i*100+J*10+Math.round(r*100))]));
    const means=Object.fromEntries(Object.keys(runs[0].metrics).filter(k=>
     typeof runs[0].metrics[k]==='number').map(k=>[k,avg(runs.map(x=>x.metrics[k]))]));
    result.push({rate,gapPolicy,policy,J,spreadNM,r,n:seeds,
     baselineManifestHashes:baseline.map(x=>x.meta.manifestHash),
     identicalPairedManifests:runs.every((x,i)=>x.meta.manifestHash===baseline[i].meta.manifestHash),
     means,pairedToolMinusBaseline:diffs,capacityEligible:false});
   }
 }
 return {version:VERSION,notOperational:true,
  baseCommit:CONFIG.baseCommit,configHash:digest(CONFIG),
  joinInput:CONFIG.observedJoin,results:result,
  warnings:['NO_OBSERVED_TOOL_EFFECTIVENESS','JOIN_INVERSE_CDF_INTERPOLATED_AGGREGATES',
   'ROT_GROUND_TIMING_UNVALIDATED','P2_UNAPPROVED_HYPOTHETICAL_RULE_CHANGE',
   'NO_SAFETY_OR_RUNWAY_CAPACITY_CLAIM','THREE_TO_FOUR_ARR_PER_H_SANITY_BOUND_NOT_FIT_TARGET']};
}
