// A1.1 observation definitions from issue #6 comments 6868718102 / 6868863680.
// Non-operational; purely synthetic data accepted by these functions.
import {digest,byteCompare} from '../core.mjs';

export const CAPTURE_EMPIRICAL_SEP2026_DEV=Object.freeze([
  {maxIntervalS:120,pairs:37,observed:37},
  {maxIntervalS:150,pairs:140,observed:140},
  {maxIntervalS:180,pairs:121,observed:120},
  {maxIntervalS:240,pairs:101,observed:68},
  {maxIntervalS:300,pairs:30,observed:4},
  {maxIntervalS:900,pairs:66,observed:0}
]);
export const CAPTURE_DIGEST=digest(CAPTURE_EMPIRICAL_SEP2026_DEV);
export function captureProbability(intervalS){
 const bin=CAPTURE_EMPIRICAL_SEP2026_DEV.find(b=>intervalS<=b.maxIntervalS);
 return bin?bin.observed/bin.pairs:0;
}
export function captureDistance(intervalS,quantile,inside15NM=true){
 if(!(Number.isFinite(quantile)&&quantile>=0&&quantile<1))throw Error('invalid capture quantile');
 return inside15NM&&quantile<captureProbability(intervalS);
}
export const TP=new Set(['DH8D','PC12','AT72','AT75','AT76']);
export function typeFamily(type){if(!type||typeof type!=='string')throw Error('unknown aircraft type');return TP.has(type.toUpperCase())?'TP':'J';}
export function typePair(leader,follower){return typeFamily(leader)+'-'+typeFamily(follower);}
export function quantileType7(sorted,p){
 if(!sorted.length)return null;
 if(p<0||p>1)throw Error('invalid probability');
 const h=(sorted.length-1)*p,i=Math.floor(h),j=Math.min(i+1,sorted.length-1);
 return sorted[i]+(sorted[j]-sorted[i])*(h-i);
}
const quant=(values,p)=>quantileType7([...values].sort((a,b)=>a-b),p);
export function stats(pairs){
 const intervals=pairs.map(p=>p.intervalS);
 const withDistance=pairs.filter(p=>p.distanceNM!==null&&Number.isFinite(p.distanceNM));
 const distances=withDistance.map(p=>p.distanceNM);
 return {nPairs:pairs.length,nPairsWithDistance:withDistance.length,
  distMedian:quant(distances,.5),distP10:quant(distances,.1),distP90:quant(distances,.9),
  fracBelow5:distances.length?distances.filter(d=>d<5).length/distances.length:null,
  intMedian:quant(intervals,.5),intP10:quant(intervals,.1)};
}
// Exact event-based busy test from Claude: starts at every arrival time in [t-3600,t] plus t-3599.
// ANA inputs are threshold timestamps in milliseconds. Half-open [start,start+3600000).
export function isBusyArrival(t,allArrivals,threshold=12){
 const from=t-3600000;
 const starts=[from+1000,...allArrivals.filter(x=>x>=from&&x<=t)];
 const sorted=[...allArrivals].sort((a,b)=>a-b);
 const lower=x=>{let lo=0,hi=sorted.length;while(lo<hi){const mid=(lo+hi)>>1;if(sorted[mid]<x)lo=mid+1;else hi=mid;}return lo;};
 for(const start of starts)if(lower(start+3600000)-lower(start)>=threshold)return true;
 return false;
}
// A1.1 extraction filter, not an operational LVP declaration model (A1.4).
// Timestamp units are UTC milliseconds. Only reports at or before follower hh:00 are eligible.
export function selectHourlyMetar(followerTimeMs,reports){
 const hourStart=Math.floor(followerTimeMs/3600000)*3600000;
 const valid=reports.filter(r=>Number.isFinite(r.timeMs)&&r.timeMs<=hourStart&&hourStart-r.timeMs<=5400000)
  .sort((a,b)=>b.timeMs-a.timeMs);
 return valid[0]||null;
}
export function syntheticWeatherClass(metar,runwayHeadingDeg){
 if(!metar)return {classification:'UNKNOWN',fitEligible:false,source:'NO_METAR'};
 const lvp= (Number.isFinite(metar.rvrAM)&&metar.rvrAM<=800)||
  (Number.isFinite(metar.visibilityM)&&metar.visibilityM<=800)||
  (['BKN','OVC','VV'].includes(metar.ceilingType)&&Number.isFinite(metar.ceilingFt)&&metar.ceilingFt<=200);
 const component=Number.isFinite(metar.windDirectionDeg)&&Number.isFinite(metar.windKt)?
  metar.windKt*Math.cos((metar.windDirectionDeg-runwayHeadingDeg)*Math.PI/180):null;
 const highHeadwind=component!==null&&component>=15;
 return {classification:lvp?'LVP_PROXY':highHeadwind?'HW15_REPORT':'GOOD_WEATHER',
  fitEligible:!lvp&&!highHeadwind,headwindKt:component===null?null:Math.round(component*1000)/1000,
  source:'A1.1_METAR_HOURLY_PROXY',lvpProxy:lvp,windUnknown:component===null};
}

export function classifyRegime(leaderMs,followerMs,departures){
 const between=departures.filter(d=>d.takeoffMs>leaderMs&&d.takeoffMs<followerMs);
 if(between.some(d=>d.mtowTonnes>=136))return '10NM';
 if(between.length)return '8NM';
 return '5NM';
}
export function observeDay({arrivals,departures=[],dayId,source='SYNTHETIC',weatherGood=true}){
 if(!Array.isArray(arrivals)||!dayId)throw Error('synthetic arrivals and dayId required');
 const order=[...arrivals].sort((a,b)=>a.timeMs-b.timeMs||byteCompare(a.id,b.id));
 const all=order.filter(a=>a.ifr!==false).map(a=>a.timeMs);
 const out=[];
 for(let i=1;i<order.length;i++){
  const leader=order[i-1],follower=order[i],intervalS=(follower.timeMs-leader.timeMs)/1000;
  if(leader.runway!==follower.runway||intervalS>900||intervalS<0||!weatherGood)continue;
  if(!isBusyArrival(follower.timeMs,all))continue;
  const regime=classifyRegime(leader.timeMs,follower.timeMs,departures);
  const applicable=regime==='5NM'&&follower.headwindKt>=15?'hw15_report':regime;
  const captured=captureDistance(intervalS,follower.captureQuantile,Number.isFinite(follower.equivalentDistanceNM)&&follower.equivalentDistanceNM<=15);
  out.push({dayId,leaderId:leader.id,followerId:follower.id,regime:applicable,
    pair:typePair(leader.type,follower.type),intervalS,distanceNM:captured?follower.equivalentDistanceNM:null,
    distanceCaptured:captured,captureMode:'CAPTURE_EMPIRICAL_SEP2026_DEV',
    targetMeaning:'TARGET_AS_EQUIVALENT_TRACK_DISTANCE',source});
 }
 return out;
}
export function stratumPairs(pairs,id){
 if(id==='overall_5NM')return pairs.filter(p=>p.regime==='5NM');
 if(['J-J','J-TP','TP-J'].includes(id))return pairs.filter(p=>p.regime==='5NM'&&p.pair===id);
 if(id==='TP-TP_report')return pairs.filter(p=>p.regime==='5NM'&&p.pair==='TP-TP');
 if(id==='hw15_report')return pairs.filter(p=>p.regime==='hw15_report');
 if(id==='8NM_report'||id==='10NM_report')return pairs.filter(p=>p.regime===id.replace('_report',''));
 return [];
}
export function hardMetrics(benchmark){
 return Object.entries(benchmark.hardTolerances).flatMap(([id,metrics])=>
  Object.entries(metrics).map(([metric,tolerance])=>({id,metric,tolerance,target:benchmark.strata.find(s=>s.id===id)?.[metric]})));
}
