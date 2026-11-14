// A1.1 reproducible synthetic delivered-spacing experiment.
// The target represents EQUIVALENT TRACK DISTANCE TO GO when leader crosses,
// not a literal final-intercept location or an identified controller instruction.
import {digest,canonical} from '../core.mjs';
import {readFileSync} from 'node:fs';
export const SEP2026_FITTED=Object.freeze(JSON.parse(readFileSync(new URL('./SEP2026_FITTED.json',import.meta.url),'utf8')));
import {observeDay,stats,stratumPairs,hardMetrics,quantileType7,CAPTURE_DIGEST} from './observation.mjs';

export const A11_MODEL_VERSION='A1.1-two-component-2';
export const TARGET_MEANING='TARGET_AS_EQUIVALENT_TRACK_DISTANCE';
const NM=1852, KT_M_PER_MS=1852/3600000;
const SPEEDS=Object.freeze({
 B738:{ias:147.5,n:474},B38M:{ias:147.5,n:474},B737:{ias:147.5,n:474},
 DH8D:{ias:130.6,n:393},E295:{ias:138.2,n:150},A320:{ias:137.5,n:75},
 E190:{ias:134.4,n:64},E75L:{ias:136.7,n:37},
 B744:{ias:154.4,n:228},B748:{ias:154.4,n:228},B77L:{ias:154.4,n:228},
 FALLBACK_J:{ias:133,n:388},FALLBACK_TP:{ias:131.6,n:42}
});
export const SPEED_SOURCE='ESTIMATED_FROM_ADSB_GS_METAR_WIND';
export function profileFor(type,headwindKt=0){
 const k=SPEEDS[type]||SPEEDS[['DH8D','PC12','AT72','AT75','AT76'].includes(type)?'FALLBACK_TP':'FALLBACK_J'];
 return {type,headwindKt,source:SPEED_SOURCE,sourceSegmentNM:'4-2 (median, not stabilised final IAS)',
   segments:[{fromNM:20,toNM:6,iasKt:180},{fromNM:6,toNM:4,iasKt:160},{fromNM:4,toNM:0,iasKt:k.ias}]};
}
export function timeToGoMs(distanceM,profile){
 if(!(Number.isFinite(distanceM)&&distanceM>=0))throw Error('invalid distance');
 let from=distanceM/NM,t=0;
 const segments=profile.segments;
 for(let i=segments.length-1;i>=0;i--){
  const s=segments[i];
  if(from<=s.toNM)continue;
  const length=Math.min(from,s.fromNM)-s.toNM;
  if(length>0)t+=(length*NM)/((s.iasKt-profile.headwindKt)*KT_M_PER_MS);
  if(from>s.fromNM&&i===0)t+=((from-s.fromNM)*NM)/((s.iasKt-profile.headwindKt)*KT_M_PER_MS);
 }
 return Math.round(t);
}
// Reconstruct the synthetic equivalent centreline trajectory from an immutable IAS profile.
export function distanceBeforeThresholdNM(msBefore,profile){
 if(msBefore<=0)return 0;
 let remaining=msBefore/1000;
 for(let i=profile.segments.length-1;i>=0;i--){
  const s=profile.segments[i],speed=(s.iasKt-profile.headwindKt)*1852/3600;
  const span=(s.fromNM-s.toNM)*1852;
  const seconds=span/speed;
  if(remaining<=seconds)return s.toNM+(remaining*speed)/1852;
  remaining-=seconds;
 }
 const top=profile.segments[0];
 return top.fromNM+(remaining*(top.iasKt-profile.headwindKt)*1852/3600)/1852;
}
// Piecewise-linear speed means minima occur at a segment boundary or overlap endpoint.
// This is a modelled common-final proxy, not a real vectoring track.
export function minimumCommonFinalNM(leaderProfile,followerProfile,intervalMs){
 const start=Math.max(-timeToGoMs(20*NM,leaderProfile),intervalMs-timeToGoMs(20*NM,followerProfile));
 if(start>0)return Infinity;
 const times=[start,0];
 for(const d of [20,6,4]){
  const leaderPoint=-timeToGoMs(d*NM,leaderProfile);
  const followerPoint=intervalMs-timeToGoMs(d*NM,followerProfile);
  if(leaderPoint>=start&&leaderPoint<=0)times.push(leaderPoint);
  if(followerPoint>=start&&followerPoint<=0)times.push(followerPoint);
 }
 return Math.min(...times.map(t=>distanceBeforeThresholdNM(intervalMs-t,followerProfile)-
     distanceBeforeThresholdNM(-t,leaderProfile)));
}

function xorshift(seed){let x=(seed>>>0)||0x9e3779b9;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function normal(next){return Math.sqrt(-2*Math.log(Math.max(1e-12,next())))*Math.cos(2*Math.PI*next());}
// Published good-weather 4–2NM speed-observation family counts, not a claim
// of September flight-level composition. Types are sampled independently.
export const APPROVED_TYPE_WEIGHTS=Object.freeze([
 {type:'B738',count:474,wake:'M'}, // B737NG/MAX pooled family
 {type:'DH8D',count:393,wake:'M'},
 {type:'E295',count:150,wake:'M'},
 {type:'A320',count:75,wake:'M'},
 {type:'E190',count:64,wake:'M'},
 {type:'E75L',count:37,wake:'M'},
 {type:'B744',count:228,wake:'H'}, // Heavy (B744/B748/B77L) pooled family
 {type:'OTHER_J',count:388,wake:'M'},
 {type:'PC12',count:42,wake:'L'} // Other TP proxy; PC12 is ICAO light
]);
export const TYPE_WEIGHTS_PROVENANCE='PUBLISHED_SPEED_SAMPLE_COUNTS_6868718102';
const TYPE_TOTAL=APPROVED_TYPE_WEIGHTS.reduce((a,t)=>a+t.count,0);
export function selectType(quantile){
 if(!(quantile>=0&&quantile<1))throw Error('type quantile outside [0,1)');
 let pick=quantile*TYPE_TOTAL;
 for(const item of APPROVED_TYPE_WEIGHTS){pick-=item.count;if(pick<0)return item;}
 return APPROVED_TYPE_WEIGHTS.at(-1);
}
export function makeScenarioManifest({seed=20261114,days=140,perDay=56}={}){
 if(!Number.isInteger(days)||days<1||!Number.isInteger(perDay)||perDay<20)throw Error('invalid sample policy');
 const next=xorshift(seed),flights=[];
 for(let day=0;day<days;day++){
  const local=[];
  for(let i=0;i<perDay;i++){
   const selected=selectType(next());
   local.push({id:'SYN'+String(day).padStart(3,'0')+'F'+String(i).padStart(3,'0'),
    type:selected.type,kind:'ARR',wake:selected.wake,
    dayId:'SYN-DAY-'+String(day).padStart(3,'0'),runway:day%2?'06':'24',ifr:true,
    targetNormal:normal(next),componentQuantile:next(),captureQuantile:next(),
    headwindKt:0,deliveryErrorMs:0,quantileSeed:seed});
  }
  flights.push(local);
 }
 return {schema:11,synthetic:true,seed,days,perDay,flights,
  typeWeightsSha256:digest(APPROVED_TYPE_WEIGHTS),typeWeightsSource:TYPE_WEIGHTS_PROVENANCE};
}
export function wakeFloorNM(leader,follower){
 const allowed=['H','M','L'];
 if(!allowed.includes(leader)||!allowed.includes(follower))throw Error('unsupported wake / Super');
 return SEP2026_FITTED.wakeNM[leader]?.[follower]??SEP2026_FITTED.surveillanceNM;
}
// Exactly eight free parameters: shift, core sigma, core mu by three pair
// classes, mixture weight, shared tail mu and shared tail sigma.
export function parameterCheck(p){
 if(!p||!Array.isArray(p.mu)||p.mu.length!==3)throw Error('8-parameter mixture required');
 if(!Number.isFinite(p.shift)||p.shift<0||p.shift>4||
    !Number.isFinite(p.sigma)||p.sigma<.04||p.sigma>1.4||
    !p.mu.every(x=>Number.isFinite(x)&&x>=-.5&&x<=3.2)||
    !Number.isFinite(p.w)||p.w<.01||p.w>.70||
    !Number.isFinite(p.muTail)||p.muTail<1.2||p.muTail>4.0||
    !Number.isFinite(p.sigmaTail)||p.sigmaTail<.06||p.sigmaTail>1.5)
  throw Error('invalid 8-parameter mixture bounds');
 return p;
}
export const A11_PARAMETER_NAMES=Object.freeze(['shift','sigma','muJ_J','muJ_TP','muTP_J','w','muTail','sigmaTail']);
export function parameterVector(p){parameterCheck(p);return[p.shift,p.sigma,...p.mu,p.w,p.muTail,p.sigmaTail];}
export function fromParameterVector(v){if(!Array.isArray(v)||v.length!==8)throw Error('8 parameters required');return parameterCheck({
 shift:v[0],sigma:v[1],mu:v.slice(2,5),w:v[5],muTail:v[6],sigmaTail:v[7]});}
const pairKey=(leader,follow)=>{
 const tp=t=>['DH8D','PC12','AT72','AT75','AT76'].includes(t);
 return (tp(leader.type)?'TP':'J')+'-'+(tp(follow.type)?'TP':'J');
};
// The generator assigns a requested effectiveTargetM once. The runner receives
// that immutable target; it does not draw, infer or refit any target.
export function assignEffectiveTargets(manifest,params){
 parameterCheck(params);
 if(!manifest.synthetic||manifest.schema!==11)throw Error('synthetic A1.1 manifest required');
 const muTP=Math.log(Math.max(.05,5.15-params.shift));
 const flights=manifest.flights.map(day=>day.map((base,i)=>{
  const lead=i?day[i-1]:null,key=lead?pairKey(lead,base):null;
  const mu=key==='J-J'?params.mu[0]:key==='J-TP'?params.mu[1]:key==='TP-J'?params.mu[2]:muTP;
  const component=base.componentQuantile<params.w?'TAIL':'CORE';
  const target=lead?Math.round((params.shift+Math.exp(
    component==='TAIL'?params.muTail+params.sigmaTail*base.targetNormal:
    mu+params.sigma*base.targetNormal))*NM):null;
  return {...base,effectiveTargetM:target,effectiveTargetComponent:lead?component:null,
   effectiveTargetSource:TARGET_MEANING};
 }));
 return {...manifest,flights,assignedBy:'A1.1_DISTRIBUTION_GENERATOR',distributionParametersSha256:digest(params)};
}
export function materialize(manifest,params){
 return runAssignedManifest(assignEffectiveTargets(manifest,params));
}
export function runAssignedManifest(manifest){
 if(!manifest.synthetic||manifest.schema!==11||manifest.assignedBy!=='A1.1_DISTRIBUTION_GENERATOR')throw Error('assigned synthetic A1.1 manifest required');
 let floorRaised=0,numberTargets=0,maxRaiseM=0,rotFloorBindings=0;
 const days=[];
 for(const fl of manifest.flights){
  let clockMs=0;const arrivals=[];
  for(let i=0;i<fl.length;i++){
   const base=fl[i],lead=arrivals.at(-1);
   if(lead&&(!Number.isSafeInteger(base.effectiveTargetM)||base.effectiveTargetM<=0))throw Error('immutable effectiveTargetM missing');
   const requestedNM=lead?base.effectiveTargetM/NM:null;
   const minNM=lead?Math.max(SEP2026_FITTED.surveillanceNM,wakeFloorNM(lead.wake,base.wake)):0;
   const effectiveNM=lead?Math.max(requestedNM,minNM):null;
   const followerProfile=profileFor(base.type,base.headwindKt);
   const unconstrainedIntervalMs=lead?timeToGoMs(effectiveNM*NM,followerProfile):0;
   const rotProxy=SEP2026_FITTED.arrivalRotProxyMs;
   if(lead&&unconstrainedIntervalMs<rotProxy)rotFloorBindings++;
   let intervalMs=lead?Math.max(rotProxy,unconstrainedIntervalMs):0;
   let minimumAlongPathNM=null;
   if(lead){
    const leaderProfile=profileFor(lead.type,lead.headwindKt);
    // Hold upstream while the final-path hard minimum would be infringed.
    // An upper bound of 15 additional minutes prevents infinite loops.
    let addedMs=0;
    while((minimumAlongPathNM=minimumCommonFinalNM(leaderProfile,followerProfile,intervalMs))<minNM-1e-8){
     intervalMs+=1000;addedMs+=1000;
     if(addedMs>900000)throw Error('hard separation cannot be represented');
    }
    if(effectiveNM<minNM||addedMs>0){
     floorRaised++;
     const achieved=distanceBeforeThresholdNM(intervalMs,followerProfile);
     maxRaiseM=Math.max(maxRaiseM,Math.round(Math.max(0,achieved-requestedNM)*NM));
    }
    numberTargets++;
   }
   clockMs+=intervalMs;
   const deliveredNM=lead?distanceBeforeThresholdNM(intervalMs,followerProfile):null;
   arrivals.push({...base,requestMs:clockMs,
     effectiveTargetM:base.effectiveTargetM,appliedFloorM:effectiveNM===null?null:Math.round(effectiveNM*NM),
     targetRaisedToMinimum:lead?(effectiveNM>requestedNM||deliveredNM>requestedNM+1e-8):false,
     minimumCommonFinalNM:minimumAlongPathNM,
     equivalentDistanceNM:deliveredNM,effectiveTargetSource:TARGET_MEANING,timeMs:clockMs});
  }
  days.push({dayId:fl[0].dayId,arrivals,departures:[],weatherGood:true});
 }
 return {days,floorRaised,numberTargets,maxRaiseM,rotFloorBindings,raiseFraction:numberTargets?floorRaised/numberTargets:0,
   manifestSha256:digest(manifest),materializedDigest:digest(days)};
}
export function evaluateSynthetic(manifest,params){
 const m=materialize(manifest,params);
 const pairs=m.days.flatMap(observeDay);
 const ids=['overall_5NM','J-J','J-TP','TP-J','TP-TP_report','8NM_report','10NM_report'];
 const observations=Object.fromEntries(ids.map(id=>[id,stats(stratumPairs(pairs,id))]));
 return {observations,totals:{qualifiedPairs:pairs.length,raisedTargets:m.floorRaised,
  targets:m.numberTargets,raiseFraction:m.raiseFraction,maxRaiseM:m.maxRaiseM,rotFloorBindings:m.rotFloorBindings},
  meta:{modelVersion:A11_MODEL_VERSION,targetMeaning:TARGET_MEANING,capture:'CAPTURE_EMPIRICAL_SEP2026_DEV',
   captureDigest:CAPTURE_DIGEST,manifestSha256:m.manifestSha256,materializedDigest:m.materializedDigest,
   syntheticDays:manifest.days,syntheticFlights:manifest.days*manifest.perDay,preset:SEP2026_FITTED.preset,source:'FITTED_SYNTHETIC',
   hourlyCountStatus:'SYNTHETIC_SATURATED_DEMAND_NOT_COMPARABLE_TO_OBSERVED_BUSY_COUNTS',
   rotProxyMs:SEP2026_FITTED.arrivalRotProxyMs,typeWeightsSha256:digest(APPROVED_TYPE_WEIGHTS)}};
}
export function scoreModel(output,benchmark){
 const measures=hardMetrics(benchmark),errors=measures.map(m=>{
  const actual=output.observations[m.id]?.[m.metric];
  return {...m,actual,normalised:Number.isFinite(actual)?Math.abs(actual-m.target)/m.tolerance:Infinity};
 });
 return {maxNormalisedError:Math.max(...errors.map(x=>x.normalised)),hardMetrics:errors,
   fitNotRepresentable:output.totals.raiseFraction>SEP2026_FITTED.hardFloorRaiseLimitFraction};
}
// One published fitting policy, shared by the CLI, CI and Claude's reproduction.
export const FIT_POLICY=Object.freeze({
 seed:20261114,days:110,perDay:60,maxRounds:60,stepTolerance:.004,
 startingSteps:[.30,.065,.085,.085,.085,.05,.12,.06],
 shrinkFactor:.58,optimizer:'deterministic_bounded_coordinate_descent',
 objective:'minimax_absolute_normalised_error',
 requireFullConvergence:true
});
export function fitDevelopment(benchmark,{seed=FIT_POLICY.seed,days=FIT_POLICY.days,
 perDay=FIT_POLICY.perDay,maxRounds=FIT_POLICY.maxRounds}={}){
 if(benchmark.status!=='OBSERVED_AGGREGATE_DEV'||benchmark.strata.length!==8||
   Object.values(benchmark.hardTolerances).reduce((n,v)=>n+Object.keys(v).length,0)!==12)
  throw Error('only approved 12-metric development benchmark permitted');
 if(!Number.isSafeInteger(maxRounds)||maxRounds<0||maxRounds>FIT_POLICY.maxRounds)throw Error('invalid max rounds');
 const manifest=makeScenarioManifest({seed,days,perDay});
 const ln=x=>Math.log(x);
 const initial={shift:1.5,sigma:.23,
  mu:[ln(5.7-1.5),ln(5.65-1.5),ln(5.3-1.5)],w:.23,muTail:ln(10.5-1.5),sigmaTail:.48};
 let best=initial;
 let result=evaluateSynthetic(manifest,best),sc=scoreModel(result,benchmark);
 let step=[...FIT_POLICY.startingSteps],iterations=0,evaluations=1,improvements=0,shrinkEvents=0;
 let termination='MAX_ROUNDS';
 for(let round=0;round<maxRounds;round++){
  iterations++;
  let improved=false;
  for(let j=0;j<8;j++)for(const direction of [-1,1]){
   const vec=parameterVector(best);
   vec[j]+=direction*step[j];
   let trial;
   try{trial=fromParameterVector(vec);}catch{continue;}
   const value=evaluateSynthetic(manifest,trial),check=scoreModel(value,benchmark);evaluations++;
   // A solution with >5% hard-floor raising is infeasible regardless of its fit.
   const quality=check.maxNormalisedError+(check.fitNotRepresentable?100:0);
   const oldQuality=sc.maxNormalisedError+(sc.fitNotRepresentable?100:0);
   if(quality+1e-10<oldQuality){
    best=trial;result=value;sc=check;improved=true;improvements++;
   }
  }
  if(!improved){step=step.map(x=>x*FIT_POLICY.shrinkFactor);shrinkEvents++;}
  if(!improved&&Math.max(...step)<FIT_POLICY.stepTolerance){
   termination='STEP_TOLERANCE';break;
  }
 }
 const stopping={termination,converged:termination==='STEP_TOLERANCE',
  iterations,evaluations,improvements,shrinkEvents,finalStepSizes:step,
  stepTolerance:FIT_POLICY.stepTolerance,maxRounds};
 return {parameters:best,score:sc,output:result,manifest,stopping,
  provenance:{benchmarkSha256:digest(benchmark),captureDigest:CAPTURE_DIGEST,seed,
   targetMeaning:TARGET_MEANING,fitObjective:FIT_POLICY.objective,
   modelVersion:A11_MODEL_VERSION,parameterFamily:'SHARED_TWO_COMPONENT_SHIFTED_LOGNORMAL',
   freeParameterCount:8,typeWeightsSha256:digest(APPROVED_TYPE_WEIGHTS),
   optimiser:FIT_POLICY.optimizer,samplePolicy:{seed,days,perDay,maxRounds,
    stepTolerance:FIT_POLICY.stepTolerance},status:'CANDIDATE_NOT_APPROVED'}};
}
