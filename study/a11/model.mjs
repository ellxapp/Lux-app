// A1.1 reproducible synthetic delivered-spacing experiment.
// The target represents EQUIVALENT TRACK DISTANCE TO GO when leader crosses,
// not a literal final-intercept location or an identified controller instruction.
import {digest,canonical} from '../core.mjs';
import {observeDay,stats,stratumPairs,hardMetrics,quantileType7,CAPTURE_DIGEST} from './observation.mjs';

export const A11_MODEL_VERSION='A1.1-candidate-1';
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
function xorshift(seed){let x=(seed>>>0)||0x9e3779b9;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function normal(next){return Math.sqrt(-2*Math.log(Math.max(1e-12,next())))*Math.cos(2*Math.PI*next());}
export function makeScenarioManifest({seed=20261114,days=140,perDay=56}={}){
 if(!Number.isInteger(days)||days<1||!Number.isInteger(perDay)||perDay<20)throw Error('invalid sample policy');
 const next=xorshift(seed),flights=[];
 for(let day=0;day<days;day++){
  const local=[];
  for(let i=0;i<perDay;i++){
   const tp=next()<.29;
   const type=tp?'DH8D':next()<.65?'B738':'E295';
   local.push({id:'SYN'+String(day).padStart(3,'0')+'F'+String(i).padStart(3,'0'),
    type,kind:'ARR',wake:'M',dayId:'SYN-DAY-'+String(day).padStart(3,'0'),runway:day%2?'06':'24',ifr:true,
    targetNormal:normal(next),captureQuantile:next(),headwindKt:0,deliveryErrorMs:0,
    quantileSeed:seed});
  }
  flights.push(local);
 }
 return {schema:11,synthetic:true,seed,days,perDay,flights};
}
export function wakeFloorNM(leader,follower){
 const allowed=['H','M','L'];
 if(!allowed.includes(leader)||!allowed.includes(follower))throw Error('unsupported wake / Super');
 if(leader==='H')return follower==='H'?4:follower==='M'?5:6;
 if(leader==='M'&&follower==='L')return 5;
 return 3;
}
export function parameterCheck(p){
 if(!p||p.mu.length!==3)throw Error('parameters required');
 if(!Number.isFinite(p.shift)||p.shift<0||p.shift>4||
    !Number.isFinite(p.sigma)||p.sigma<.04||p.sigma>1.6||
    !p.mu.every(x=>Number.isFinite(x)&&x>=-1&&x<=3))throw Error('parameter bounds');
 return p;
}
const pairKey=(leader,follow)=>{
 const tp=t=>['DH8D','PC12','AT72','AT75','AT76'].includes(t);
 return (tp(leader.type)?'TP':'J')+'-'+(tp(follow.type)?'TP':'J');
};
export function materialize(manifest,params){
 parameterCheck(params);
 if(!manifest.synthetic||manifest.schema!==11)throw Error('synthetic A1.1 manifest required');
 const muTP= Math.log(Math.max(.05,5.15-params.shift));
 let floorRaised=0,numberTargets=0,maxRaiseM=0;
 const days=[];
 for(const fl of manifest.flights){
  let clockMs=0;const arrivals=[];
  for(let i=0;i<fl.length;i++){
   const base=fl[i],lead=arrivals.at(-1);
   const key=lead?pairKey(lead,base):null;
   const mu=key==='J-J'?params.mu[0]:key==='J-TP'?params.mu[1]:key==='TP-J'?params.mu[2]:muTP;
   const requestedNM=lead?params.shift+Math.exp(mu+params.sigma*base.targetNormal):null;
   const minNM=lead?wakeFloorNM(lead.wake,base.wake):0;
   const effectiveNM=lead?Math.max(requestedNM,minNM):null;
   if(lead&&requestedNM<minNM){floorRaised++;maxRaiseM=Math.max(maxRaiseM,Math.round((minNM-requestedNM)*NM));}
   if(lead)numberTargets++;
   const intervalMs=lead?Math.max(80000,timeToGoMs(effectiveNM*NM,profileFor(base.type,base.headwindKt))):0;
   clockMs+=intervalMs;
   arrivals.push({...base,requestMs:clockMs,effectiveTargetM:effectiveNM===null?null:Math.round(effectiveNM*NM),
     targetRaisedToMinimum:lead?requestedNM<minNM:false,equivalentDistanceNM:effectiveNM,
     effectiveTargetSource:TARGET_MEANING,timeMs:clockMs});
  }
  days.push({dayId:fl[0].dayId,arrivals,departures:[],weatherGood:true});
 }
 return {days,floorRaised,numberTargets,maxRaiseM,raiseFraction:numberTargets?floorRaised/numberTargets:0,
   manifestSha256:digest(manifest),materializedDigest:digest(days)};
}
export function evaluateSynthetic(manifest,params){
 const m=materialize(manifest,params);
 const pairs=m.days.flatMap(observeDay);
 const ids=['overall_5NM','J-J','J-TP','TP-J','TP-TP_report','8NM_report','10NM_report'];
 const observations=Object.fromEntries(ids.map(id=>[id,stats(stratumPairs(pairs,id))]));
 return {observations,totals:{qualifiedPairs:pairs.length,raisedTargets:m.floorRaised,
  targets:m.numberTargets,raiseFraction:m.raiseFraction,maxRaiseM:m.maxRaiseM},
  meta:{modelVersion:A11_MODEL_VERSION,targetMeaning:TARGET_MEANING,capture:'CAPTURE_EMPIRICAL_SEP2026_DEV',
   captureDigest:CAPTURE_DIGEST,manifestSha256:m.manifestSha256,materializedDigest:m.materializedDigest,
   syntheticDays:manifest.days,syntheticFlights:manifest.days*manifest.perDay,source:'FITTED_SYNTHETIC'}};
}
export function scoreModel(output,benchmark){
 const measures=hardMetrics(benchmark),errors=measures.map(m=>{
  const actual=output.observations[m.id]?.[m.metric];
  return {...m,actual,normalised:Number.isFinite(actual)?Math.abs(actual-m.target)/m.tolerance:Infinity};
 });
 return {maxNormalisedError:Math.max(...errors.map(x=>x.normalised)),hardMetrics:errors,
   fitNotRepresentable:output.totals.raiseFraction>.05};
}
export function fitDevelopment(benchmark,{seed=20261114,days=140,perDay=56,maxRounds=24}={}){
 if(benchmark.status!=='OBSERVED_AGGREGATE_DEV'||benchmark.strata.length!==8||
   Object.values(benchmark.hardTolerances).reduce((n,v)=>n+Object.keys(v).length,0)!==12)throw Error('only approved 12-metric development benchmark permitted');
 const manifest=makeScenarioManifest({seed,days,perDay});
 const logMean=x=>Math.log(x);
 const initial={shift:1.8,sigma:.34,mu:[logMean(6.19-1.8),logMean(6.18-1.8),logMean(5.72-1.8)]};
 let best=initial;
 let result=evaluateSynthetic(manifest,best),sc=scoreModel(result,benchmark);
 let step=[.35,.09,.12,.12,.12];
 for(let round=0;round<maxRounds;round++){
  let improved=false;
  for(let j=0;j<5;j++)for(const direction of [-1,1]){
   const vec=[best.shift,best.sigma,...best.mu];
   vec[j]+=direction*step[j];
   const trial={shift:vec[0],sigma:vec[1],mu:vec.slice(2)};
   try{parameterCheck(trial);}catch{continue;}
   const value=evaluateSynthetic(manifest,trial),check=scoreModel(value,benchmark);
   if(check.maxNormalisedError+1e-10<sc.maxNormalisedError){
    best=trial;result=value;sc=check;improved=true;
   }
  }
  if(!improved)step=step.map(x=>x*.62);
  if(Math.max(...step)<.002)break;
 }
 return {parameters:best,score:sc,output:result,manifest,
  provenance:{benchmarkSha256:digest(benchmark),captureDigest:CAPTURE_DIGEST,seed,
   targetMeaning:TARGET_MEANING,fitObjective:'minimax-absolute-normalised-error',
   modelVersion:A11_MODEL_VERSION,optimiser:'fixed-coordinate-search',
   samplePolicy:{days,perDay,maxRounds},status:'CANDIDATE_NOT_APPROVED'}};
}
