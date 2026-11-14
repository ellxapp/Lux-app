// A1.3 departure sequencing mechanics. HYPOTHETICAL radial gates; not ATC instructions.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {digest} from '../core.mjs';

export const VERSION='A1.3-C2-minute-quantised-candidate-3';
export const CONFIG=Object.freeze(JSON.parse(readFileSync(new URL('./MECHANICS_ONLY.json',import.meta.url),'utf8')));
const LOCK='be55a9622ce770ea0f66bfdcc6d582f53948577c8e1f4bb4ffda72a7026a85fb';
const lockSha=createHash('sha256').update(readFileSync(new URL('../a11/calibration-lock.json',import.meta.url))).digest('hex');
if(lockSha!==LOCK)throw Error('A1.1 approved lock has changed');
export const A11_LOCK_SHA256=LOCK;
const H=3600000;
const check=(x,msg)=>{if(!x)throw Error(msg);};
const isnum=n=>Number.isFinite(n);
const integer=(n,k,min=0)=>check(Number.isSafeInteger(n)&&n>=min,'invalid '+k);
export function validateConfig(c){
 check(c?.schema===1&&c.preset==='A13_MECHANICS_ONLY_UNVALIDATED'&&c.nonOperational===true,'A1.3 nonoperational config');
 check(JSON.stringify(c.demand.departureLevelsPerHour)==='[14,16,18,20]','departure demand levels');
 check(JSON.stringify(c.demand.backgroundArrivalsPerHour)==='[1,7]','background-arrival regimes');
 check(c.demand.durationHours===2,'two-hour synthetic demand');
 check(c.demand.measurementEndMs-c.demand.measurementStartMs===H,'measurement window must be one hour');
 check(c.demand.drainEndMs>c.demand.durationHours*H,'separate drain horizon');
 integer(c.reorder.maxPositions,'max positions',1);
 check(c.reorder.maxPositions===1,'only one-position swaps permitted');
 integer(c.reorder.maxAdditionalDelayMs,'max unvalidated swap delay');
 check(c.intervalPresets.CURRENT.extraSameExitMs===0&&
  c.intervalPresets.CURRENT.extraDifferentExitMs===0,'CURRENT must add zero planning buffer');
 check(c.intervalPresets.SEP2026_OBSERVED_SAME_EXIT_120S.extraSameExitMs===120000&&
  c.intervalPresets.SEP2026_OBSERVED_SAME_EXIT_120S.extraDifferentExitMs===0,'120s sensitivity only');
 check(c.replication.seeds>=50&&c.replication.seeds<=500,'50 or more fixed seeds');
 check(c.gate.definitions.length===2&&c.gate.definitions[0].distanceNM===30&&
  c.gate.definitions[1].distanceNM===40&&c.gate.exitFixCoordinates===null,'30/40 NM radial proxy only');
 check(c.observed.takeoffIntervals?.gate?.medianAbsToleranceSeconds===30&&
  c.observed.takeoffIntervals.gate.shareLE120AbsoluteTolerancePercentagePoints===10,
  'observed interval gate must be fixed');
 for(const k of ['early','late']){
  const p=c.readyTimeProcess[k];
  check(p&&p.singleFraction>=0&&p.singleFraction<1&&p.tripleFraction>=0&&
   p.tripleFraction<1&&p.singleFraction+p.tripleFraction<1&&
   Number.isSafeInteger(p.withinClusterGapMs)&&p.withinClusterGapMs>=0&&
   p.centerJitterFraction>=0&&p.centerJitterFraction<=.4,'bunch parameters');
 }
 check(JSON.stringify(c.fittedSpeedContrast.jetAnchorSensitivityKt)==='[260,300,340]',
  'fixed three anchor sensitivity values');
 check(c.boundaries.lvp===false&&c.boundaries.ctotAtfm==='NOT_MODELLED','LVP and CTOT excluded');
 const shares=Object.values(c.observed.exitSharesPercent);
 check(shares.every(v=>v>=0)&&shares.reduce((a,b)=>a+b,0)===100,'exit share must include 2% residual');
 for(const p of Object.values(c.categories)){
  for(const key of ['lineupMs','rollMs','runwayClearAfterAirborneMs'])integer(p[key],key);
 }
 return c;
}
export function fittedSpeedContrast(c=CONFIG,jetAnchorKt=c.fittedSpeedContrast.jetAnchorKt){
 validateConfig(c);
 const obs=c.fittedSpeedContrast,targetA=obs.targetTPJetChangeSeconds,targetB=obs.targetJetTPChangeSeconds;
 // At the same 40 NM radial ring, symmetric type-pair gaps constrain only
 // delta travel time. Absolute jet speed is NOT identified by this aggregate.
 const contrastSeconds=(targetB-targetA)/2;
 const jet=jetAnchorKt;check(jet>0,'jet anchor');
 const tp=40/(40/jet+contrastSeconds/3600);
 check(tp>0&&tp<jet,'TP speed must be lower than jet anchor');
 const predictions={'TP-J':-contrastSeconds,'J-TP':contrastSeconds,'J-J':0};
 return {gateNM:40,jetKt:jet,tpKt:tp,
  speedRatioTPOverJet:tp/jet,
  identifiability:'ONE_FITTED_TRAVEL_TIME_CONTRAST_PLUS_HYPOTHETICAL_JET_SPEED_ANCHOR',
  status:'FITTED_TO_SEP2026_DEV_CHANGE_MEDIANS_CONDITIONAL_ON_ANCHOR',
  observedSeconds:structuredClone(c.observed.gate40TimeGapChangeMedianSeconds),
  modelSeconds:predictions,
  residualModelMinusObservedSeconds:Object.fromEntries(Object.entries(predictions)
   .map(([k,v])=>[k,v-c.observed.gate40TimeGapChangeMedianSeconds[k]])),
  objective:'MINIMISE_SQUARED_RESIDUALS_TP_J_AND_J_TP; J_J_HAS_NO_IDENTIFIED_CONTRAST'};
}
function xorshift(seed){let x=(seed>>>0)||0x9e3779b9;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function quant(xs,p){
 if(!xs.length)return null;
 const a=[...xs].sort((x,y)=>x-y),v=(a.length-1)*p,i=Math.floor(v);
 return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(v-i);
}
function stats(xs){
 const values=xs.filter(isnum);
 return {n:values.length,mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,
  p10:quant(values,.1),median:quant(values,.5),p90:quant(values,.9)};
}
const exitQuant=(q,shares)=>{
 let r=q*100;
 for(const [name,share] of Object.entries(shares)){r-=share;if(r<0)return name;}
 return 'OTHER_UNKNOWN';
};
function typeCategory(q,c){
 if(q<c.fleet.turbopropShare)return 'TURBOPROP';
 const jetPart=(q-c.fleet.turbopropShare)/(1-c.fleet.turbopropShare);
 return jetPart<c.fleet.heavyJetShareWithinJets?'HEAVY_JET':'JET';
}
export function bunchedReadyTimes(c,seed,count,backgroundArrivalsPerHour){
 validateConfig(c);
 const wave=backgroundArrivalsPerHour===1?'early':'late',p=c.readyTimeProcess[wave];
 const next=xorshift((seed^0x9e3779b9)>>>0);
 const clusters=[];
 for(let i=0;i<count;){
  const sizeDraw=next(),size=sizeDraw<p.singleFraction?1:
   sizeDraw<p.singleFraction+p.tripleFraction?3:2;
  const n=Math.min(size,count-i);
  clusters.push({size:n,jitter:next()-.5});
  i+=n;
 }
 const totalMs=c.demand.durationHours*H,span=totalMs/clusters.length;
 const times=[];
 for(let i=0;i<clusters.length;i++){
  const group=clusters[i],center=(i+.5)*span+
   group.jitter*2*span*p.centerJitterFraction;
  for(let j=0;j<group.size;j++){
   const within=(j-(group.size-1)/2)*p.withinClusterGapMs;
   times.push(Math.max(0,Math.round(center+within)));
  }
 }
 return {times:times.sort((a,b)=>a-b),wave,clusters:clusters.length,
  parameters:{...p},source:'FITTED_TO_SEP2026_TAKEOFF_INTERVALS'};
}
export function makeManifest(c=CONFIG,{seed=c.replication.seedStart,departuresPerHour=16,backgroundArrivalsPerHour=1}={}){
 validateConfig(c);integer(seed,'seed');
 check(c.demand.departureLevelsPerHour.includes(departuresPerHour),'unknown departure demand rate');
 check(c.demand.backgroundArrivalsPerHour.includes(backgroundArrivalsPerHour),'unknown arrival regime');
 const rnd=xorshift(seed),deps=[],arr=[];
 const arrStep=H/backgroundArrivalsPerHour;
 const ready=bunchedReadyTimes(c,seed,departuresPerHour*c.demand.durationHours,backgroundArrivalsPerHour);
 for(let i=0;i<departuresPerHour*c.demand.durationHours;i++){
  const type=typeCategory(rnd(),c),exit=exitQuant(rnd(),c.observed.exitSharesPercent);
  const requestMs=ready.times[i];
  const missingGate=rnd()<c.gate.missingCrossingProbability;
  deps.push({id:'D'+String(i).padStart(3,'0'),kind:'DEP',originalIndex:i,
   requestMs,category:type,wake:type==='HEAVY_JET'?'H':'M',exit,
   gateMissing30:missingGate,gateMissing40:missingGate||rnd()<c.gate.missingCrossingProbability,
   sourceStatus:'HYPOTHETICAL_SYNTHETIC'});
 }
 deps.sort((a,b)=>a.requestMs-b.requestMs||a.id.localeCompare(b.id));
 deps.forEach((d,i)=>d.originalIndex=i);
 for(let i=0;i<backgroundArrivalsPerHour*c.demand.durationHours;i++)
  arr.push({id:'A'+String(i).padStart(3,'0'),kind:'ARR',originalIndex:i,
   requestMs:Math.round((i+.5)*arrStep+(rnd()-.5)*2*arrStep*c.demand.arrivalJitterFraction),
   sourceStatus:'SYNTHETIC_BACKGROUND_ARRIVAL_NOT_REPLAY'});
 return {schema:13,synthetic:true,seed,departuresPerHour,backgroundArrivalsPerHour,
  departures:deps,arrivals:arr,readyTimeProcess:{wave:ready.wave,clusters:ready.clusters,
   source:ready.source,parameters:ready.parameters},
  exitWeightsSource:'SEP2026_POOLED_EXIT_SHARES',
  provenance:'ALL_REQUESTS_SYNTHETIC_AND_IMMUTABLE',a11LockSha256:LOCK};
}
export function validateManifest(m,c=CONFIG){
 check(m?.schema===13&&m.synthetic===true&&m.a11LockSha256===LOCK,'locked synthetic manifest');
 check(c.demand.departureLevelsPerHour.includes(m.departuresPerHour)&&
  c.demand.backgroundArrivalsPerHour.includes(m.backgroundArrivalsPerHour),'manifest rates');
 check(m.departures.length===m.departuresPerHour*c.demand.durationHours&&
  m.arrivals.length===m.backgroundArrivalsPerHour*c.demand.durationHours,'manifest demand count');
 const ids=new Set();
 for(let i=0;i<m.departures.length;i++){
  const x=m.departures[i];
  check(x.kind==='DEP'&&!ids.has(x.id)&&x.originalIndex===i,'departure ID and FIFO order');
  ids.add(x.id);integer(x.requestMs,'dep request');
  check(c.categories[x.category]&&Object.hasOwn(c.observed.exitSharesPercent,x.exit),'dep type and exit');
  check(typeof x.gateMissing30==='boolean'&&typeof x.gateMissing40==='boolean','missing gate markers');
  if(i)check(m.departures[i-1].requestMs<=x.requestMs,'FIFO ordered manifest');
 }
 for(const x of m.arrivals){check(x.kind==='ARR'&&!ids.has(x.id),'arrival ID');ids.add(x.id);integer(x.requestMs,'ARR request');}
 return m;
}
function profile(category,fit){
 return category==='TURBOPROP'?{meanGroundspeedKt:fit.tpKt,source:'FITTED_CONTRAST_CONDITIONAL_ON_ANCHOR'}:
  {meanGroundspeedKt:fit.jetKt,source:'HYPOTHETICAL_JET_SPEED_ANCHOR'};
}
export function gateCrossings(dep,airborneMs,c=CONFIG,fit=fittedSpeedContrast(c)){
 const p=profile(dep.category,fit),crossings={};
 for(const gate of c.gate.definitions){
  const missing=dep[gate.distanceNM===30?'gateMissing30':'gateMissing40'];
  crossings[gate.id]=missing?{status:'GATE_MISSING_SYNTHETIC',timeMs:null,source:'INJECTED_MISSINGNESS'}:
   {status:'SYNTHETIC_FIRST_OUTWARD_CROSSING',timeMs:Math.round(airborneMs+
      H*gate.distanceNM/p.meanGroundspeedKt),source:'RADIAL_CONSTANT_MEAN_SPEED_PROXY'};
 }
 return {crossings,profile:p};
}
export function intervalSample(run,c=CONFIG){
 const start=c.demand.measurementStartMs,end=c.demand.measurementEndMs;
 const within=run.departures.filter(d=>d.status==='served'&&d.airborneMs>=start&&d.airborneMs<end)
  .sort((a,b)=>a.airborneMs-b.airborneMs||a.id.localeCompare(b.id));
 // ANA act_date_d is a whole-minute take-off timestamp. Apply that
 // observation operator to each absolute airborne time BEFORE differencing.
 // Do not round the interval itself or quantise the simulator's runway events.
 const observedTakeoffMs=within.map(d=>Math.floor(d.airborneMs/60000)*60000);
 const intervals=[],sameExit=[];
 for(let i=1;i<within.length;i++){
  intervals.push((observedTakeoffMs[i]-observedTakeoffMs[i-1])/1000);
  sameExit.push(within[i].exit===within[i-1].exit?1:0);
 }
 return {intervals,sameExit,departureCount:within.length,
  observationOperator:'FLOOR_EACH_ABSOLUTE_TAKEOFF_TIMESTAMP_TO_UTC_MINUTE_BEFORE_DIFFERENCE',
  timeResolutionSeconds:60};
}
export function evaluateTakeoffIntervalGate(c=CONFIG,{seeds=c.replication.seeds,
 rates=c.demand.departureLevelsPerHour}={}){
 validateConfig(c);
 const result={};
 for(const bg of c.demand.backgroundArrivalsPerHour){
  const wave=bg===1?'early':'late',all=[],same=[],byRate={};
  for(const rate of rates){
   const xs=[],ss=[];
   for(let i=0;i<seeds;i++){
    const seed=c.replication.seedStart+i*c.replication.seedStride;
    const m=makeManifest(c,{seed,departuresPerHour:rate,backgroundArrivalsPerHour:bg});
    const sample=intervalSample(simulate(m,c,{policy:'FIFO',preset:'CURRENT'}),c);
    xs.push(...sample.intervals);ss.push(...sample.sameExit);
   }
   byRate[rate]={intervalCount:xs.length,medianS:quant(xs,.5),
    shareLE120:xs.length?xs.filter(x=>x<=120).length/xs.length:null};
   all.push(...xs);same.push(...ss);
  }
  const obs=c.observed.takeoffIntervals[wave],measured=stats(all);
  const shareLE=seconds=>all.length?all.filter(x=>x<=seconds).length/all.length:null;
  const share120=shareLE(120),sameExitShare=same.length?
   same.reduce((a,b)=>a+b,0)/same.length:null;
  const medianResidual=measured.median-obs.medianS,
   share120ResidualPP=100*(share120-obs.shareLE120);
  result[wave]={
   source:'FITTED_TO_SEP2026_TAKEOFF_INTERVALS_NO_HOLDOUT',
   inputs:{backgroundArrivalsPerHour:bg,seedCount:seeds,rates,readyParameters:c.readyTimeProcess[wave],
    comparator:'FIFO_CURRENT_SYNTHETIC_TAKEOFF_EVENTS_FLOORED_TO_MINUTE_IN_1H_WINDOW',
    observationOperator:'FLOOR_EACH_ABSOLUTE_TAKEOFF_TIMESTAMP_TO_UTC_MINUTE_BEFORE_DIFFERENCE',
    observedWholeMinuteResolutionSeconds:obs.intervalResolutionSeconds??60},
   observed:{nIntervals:obs.intervals,p10S:obs.p10S,medianS:obs.medianS,p90S:obs.p90S,
    shareLE60:obs.shareLE60,shareLE120:obs.shareLE120,shareLE180:obs.shareLE180,
    consecutiveSameExitShare:obs.consecutiveSameExitShare},
   model:{intervals:measured.n,p10S:measured.p10,medianS:measured.median,p90S:measured.p90,
    shareLE60:shareLE(60),shareLE120:share120,shareLE180:shareLE(180),
    consecutiveSameExitShare:sameExitShare,byRate},
   residual:{medianSeconds:medianResidual,shareLE120PercentagePoints:share120ResidualPP,
    consecutiveSameExitPercentagePoints:100*(sameExitShare-obs.consecutiveSameExitShare),
    p10Seconds:measured.p10-obs.p10S,p90Seconds:measured.p90-obs.p90S},
   gate:{
    medianWithin30Seconds:Math.abs(medianResidual)<=c.observed.takeoffIntervals.gate.medianAbsToleranceSeconds,
    shareLE120Within10PP:Math.abs(share120ResidualPP)<=c.observed.takeoffIntervals.gate.shareLE120AbsoluteTolerancePercentagePoints,
    status:Math.abs(medianResidual)<=30&&Math.abs(share120ResidualPP)<=10?
     'PASS':'FAIL_OBSERVED_TAKEOFF_INTERVAL_GATE',
    sameExitShare:'REPORT_ONLY',
    sourceStatus:'FITTED_TO_SEP2026_TAKEOFF_INTERVALS_NO_HOLDOUT'}
  };
 }
 return {label:'FITTED_TO_SEP2026_TAKEOFF_INTERVALS_NO_HOLDOUT',
  early:result.early,late:result.late,
  overall:result.early.gate.status==='PASS'&&result.late.gate.status==='PASS'?
   'PASS':'FAIL_OBSERVED_TAKEOFF_INTERVAL_GATE'};
}
export function calibrateReadyTimeGrid(base=CONFIG,{developmentSeeds=12}={}){
 validateConfig(base);
 const all={};
 for(const wave of ['early','late']){
  const combinations=[];
  for(const singleFraction of [0,.12,.24,.36])
   for(const tripleFraction of [0,.12,.24])
    for(const withinClusterGapMs of [0,30000,60000,90000,120000])
     for(const centerJitterFraction of [0,.10]){
      if(singleFraction+tripleFraction>=1)continue;
      const parameters={singleFraction,tripleFraction,withinClusterGapMs,centerJitterFraction};
      const c={...base,readyTimeProcess:{...base.readyTimeProcess,[wave]:parameters}};
      const r=evaluateTakeoffIntervalGate(c,{seeds:developmentSeeds});
      const x=r[wave],loss=
       Math.abs(x.residual.medianSeconds)/30+
       Math.abs(x.residual.shareLE120PercentagePoints)/10+
       .1*Math.abs(x.residual.p90Seconds)/180;
      combinations.push({parameters,loss,
       medianS:x.model.medianS,shareLE120:x.model.shareLE120,
       p90S:x.model.p90S,n:x.model.intervals,
       gate:x.gate.status,medianResidualS:x.residual.medianSeconds,
       share120ResidualPP:x.residual.shareLE120PercentagePoints});
     }
  combinations.sort((a,b)=>a.loss-b.loss||
   a.parameters.withinClusterGapMs-b.parameters.withinClusterGapMs||
   a.parameters.singleFraction-b.parameters.singleFraction);
  all[wave]={sourceStatus:'FITTED_TO_SEP2026_TAKEOFF_INTERVALS_NO_HOLDOUT',
   searchedCandidates:combinations.length,developmentSeedCount:developmentSeeds,
   best:combinations[0],topThree:combinations.slice(0,3),
   observed:base.observed.takeoffIntervals[wave],
   noSealedHoldout:true};
 }
 return {method:'DETERMINISTIC_GRID_MIN_ABS_MEDIAN_30S_PLUS_SHARE_120_10PP_PLUS_P90_SOFT',
  seedPolicy:'SHARED_DEVELOPMENT_SEEDS_NOT_A_HOLDOUT',...all};
}
function chooseSwaps(m,c){
 // Disjoint adjacent swaps: TP followed by jet on SAME EXIT, only
 // when the *request-time* difference does not already exceed the
 // unvalidated max additional wait for the overtaken TP.
 const indices=[],used=new Set();
 for(let i=0;i<m.departures.length-1;i++){
  if(used.has(i)||used.has(i+1))continue;
  const a=m.departures[i],b=m.departures[i+1];
  if(a.category==='TURBOPROP'&&b.category!=='TURBOPROP'&&a.exit===b.exit&&
   b.requestMs-a.requestMs<=c.reorder.maxAdditionalDelayMs){
   indices.push(i);used.add(i);used.add(i+1);i++;
  }
 }
 return indices;
}
function orderWithSwaps(deps,indices){
 const arr=[...deps];
 for(const i of indices)[arr[i],arr[i+1]]=[arr[i+1],arr[i]];
 return arr;
}
export function simulate(m,c=CONFIG,{policy='FIFO',preset='CURRENT',
 jetAnchorKt=c.fittedSpeedContrast.jetAnchorKt}={}){
 validateConfig(c);validateManifest(m,c);
 check(['FIFO','TYPE_EXIT_ONE_SWAP'].includes(policy),'policy');
 check(Object.hasOwn(c.intervalPresets,preset),'preset');
 const fit=fittedSpeedContrast(c,jetAnchorKt),p=c.intervalPresets[preset];
 const baselineOrder=m.departures,eligible=policy==='FIFO'?[]:chooseSwaps(m,c);
 const run=(indices)=>{
  const sorted=orderWithSwaps(baselineOrder,indices),rows=[],arrivals=[],events=[];
  let d=0,a=0,runwayClearMs=0,lastMovement=null,lastDeparture=null;
  while(d<sorted.length||a<m.arrivals.length){
   const dep=sorted[d],arr=m.arrivals[a];
   const pickArrival=!dep||(arr&&arr.requestMs<=dep.requestMs);
   if(pickArrival){
    const actual=Math.max(arr.requestMs,runwayClearMs+
      (lastMovement?.kind==='DEP'?20000:0));
    const clear=actual+c.arrivals.runwayOccupancyMs;
    arrivals.push({...arr,status:actual<=c.demand.drainEndMs?'served':'censored',
     thresholdMs:actual<=c.demand.drainEndMs?actual:null,
     delayMs:actual<=c.demand.drainEndMs?actual-arr.requestMs:null,
     runwayClearMs:clear,source:'SYNTHETIC_UNVALIDATED'});
    if(actual<=c.demand.drainEndMs)events.push({id:arr.id,kind:'ARR',timeMs:actual,runwayClearMs:clear});
    runwayClearMs=clear;lastMovement={kind:'ARR',thresholdMs:actual,runwayClearMs:clear};a++;
    continue;
   }
   const cat=c.categories[dep.category],startMs=Math.max(dep.requestMs,runwayClearMs);
   const lineupStartMs=lastMovement?.kind==='ARR'?
    Math.max(dep.requestMs,lastMovement.thresholdMs):startMs;
   const lineupCompleteMs=lineupStartMs+cat.lineupMs;
   const rollStartMs=Math.max(startMs,lineupCompleteMs);
   const rawAirborne=rollStartMs+cat.rollMs;
   const sameExit=lastDeparture?.exit===dep.exit;
   const addBuffer=sameExit?p.extraSameExitMs:p.extraDifferentExitMs;
   const airborne=Math.max(rawAirborne,(lastDeparture?.airborneMs??-1e15)+addBuffer);
   const clear=airborne+cat.runwayClearAfterAirborneMs;
   const served=airborne<=c.demand.drainEndMs;
   const gate=served?gateCrossings(dep,airborne,c,fit):null;
   const row={...dep,status:served?'served':'censored',
    reason:served?'SYNTHETIC_AIRBORNE':'DRAIN_HORIZON',
    actualDepartureOrder:d,departurePolicy:policy,planningPreset:preset,
    lineupStartMs,rollStartMs,airborneMs:served?airborne:null,
    runwayClearMs:served?clear:null,delayMs:served?airborne-dep.requestMs:null,
    bindingReasons:[startMs>dep.requestMs?'RUNWAY_OCCUPANCY':null,
      airborne>rawAirborne?'ADDITIONAL_SAME_EXIT_SENSITIVITY_BUFFER':null].filter(Boolean),
    gateCrossings:gate?.crossings??null,radialProfile:gate?.profile??null,
    ctotAtfmStatus:'NOT_MODELLED',extraPlanningIntervalMs:addBuffer,
    originalQueueIndex:dep.originalIndex};
   rows.push(row);if(served)events.push({id:dep.id,kind:'DEP',timeMs:airborne});
   lastDeparture=served?{...dep,airborneMs:airborne}:lastDeparture;
   runwayClearMs=clear;lastMovement={kind:'DEP',runwayClearMs:clear};d++;
  }
  rows.sort((x,y)=>x.airborneMs===null?1:y.airborneMs===null?-1:x.airborneMs-y.airborneMs);
  const pairs=[];let previous=null;
  for(const follower of rows){
   if(follower.status!=='served')continue;
   if(previous){
    const sameExit=previous.exit===follower.exit;
    const times={};
    for(const def of c.gate.definitions){
     const g=def.id,lt=previous.gateCrossings[g],ft=follower.gateCrossings[g];
     times[g]={leaderTimeMs:lt.timeMs,followerTimeMs:ft.timeMs,
      status:lt.timeMs===null||ft.timeMs===null?'PAIR_NOT_EVALUABLE_GATE_MISSING':
       'GATE_AVAILABLE',
      gapSeconds:sameExit&&lt.timeMs!==null&&ft.timeMs!==null?
       (ft.timeMs-lt.timeMs)/1000:null};
    }
    const dT=(follower.airborneMs-previous.airborneMs)/1000;
    const forty=times.RADIAL_40_NM;
    pairs.push({leaderId:previous.id,followerId:follower.id,leaderCategory:previous.category,
     followerCategory:follower.category,leaderExit:previous.exit,followerExit:follower.exit,
     sameExit,categoryPair:(previous.category==='TURBOPROP'?'TP':'J')+'-'+
      (follower.category==='TURBOPROP'?'TP':'J'),
     airborneGapSeconds:dT,gateTimes:times,
     change40FromAirborneSeconds:sameExit&&forty.gapSeconds!==null?
      forty.gapSeconds-dT:null,
     gateCrossingOrder40:forty.gapSeconds===null?'NOT_EVALUABLE':
      forty.gapSeconds<0?'FOLLOWER_BEFORE_LEADER':
      forty.gapSeconds===0?'TIE':'LEADER_BEFORE_FOLLOWER',
     spacingClaim:sameExit?'TIME_DIFFERENCE_ONLY_NO_CERTIFIED_SEPARATION':
      'DIFFERENT_EXIT_NO_SPACING_CLAIM',distanceNM:null});
   }
   previous=follower;
  }
  const served=rows.filter(x=>x.status==='served'),allServedArr=arrivals.filter(x=>x.status==='served');
  const start=c.demand.measurementStartMs,end=c.demand.measurementEndMs,within=x=>x>=start&&x<end;
  const nDep=served.filter(x=>within(x.airborneMs)).length,
   nArr=allServedArr.filter(x=>within(x.thresholdMs)).length;
  const samePairs=pairs.filter(x=>x.sameExit);
  const evaluable=samePairs.filter(x=>x.gateTimes.RADIAL_40_NM.gapSeconds!==null);
  const counted=rows.length+arrivals.length;
  check(counted===m.departures.length+m.arrivals.length,'movement conservation');
  return {meta:{version:VERSION,policy,preset,seed:m.seed,
   mainBaseSha:c.mainBaseSha,manifestSha256:digest(m),configSha256:digest(c),
   modelStatus:'MECHANICS_ONLY_UNVALIDATED',ctotAtfm:'NOT_MODELLED',
   radialGateInterpretation:'SYNTHETIC_TIME_PROXY_NOT_EXIT_FIX_GEOMETRY',
   jetAnchorKt,readyWave:m.readyTimeProcess?.wave??null},
   totals:{requests:counted,served:served.length+allServedArr.length,
    censored:rows.filter(x=>x.status==='censored').length+arrivals.filter(x=>x.status==='censored').length,
    departedByDrain:served.length,arrivalRequests:arrivals.length},
   metrics:{departuresInHour:nDep,arrivalsInHour:nArr,departuresByDrain:served.length,
    totalDepartureDelayS:served.reduce((sum,x)=>sum+x.delayMs,0)/1000,
    meanDepartureDelayS:stats(served.map(x=>x.delayMs/1000)).mean,
    sameExitPairs:samePairs.length,sameExitEvaluablePairs:evaluable.length,
    sameExitGate40GapS:stats(evaluable.map(x=>x.gateTimes.RADIAL_40_NM.gapSeconds)),
    sameExitGapChange40S:stats(evaluable.map(x=>x.change40FromAirborneSeconds)),
    sameExitNegativeGateGapCount:evaluable.filter(x=>x.gateTimes.RADIAL_40_NM.gapSeconds<0).length,
    pairNotEvaluableCount:samePairs.length-evaluable.length,
    differentExitPairs:pairs.length-samePairs.length},
   swaps:indices.map(i=>({leftOriginalIndex:i,rightOriginalIndex:i+1,
    earlierId:baselineOrder[i].id,laterId:baselineOrder[i+1].id})),
   departures:rows,arrivals,pairs,events};
 };
 const fifo=run([]);
 if(policy==='FIFO')return fifo;
 let swaps=[...eligible],attempt=0,runResult;
 while(true){
  runResult=run(swaps);
  const fifoById=new Map(fifo.departures.map(x=>[x.id,x]));
  const exceeding=runResult.departures.filter(x=>{
   const b=fifoById.get(x.id);
   return x.status==='served'&&b.status==='served'&&
    x.airborneMs-b.airborneMs>c.reorder.maxAdditionalDelayMs;
  });
  if(exceeding.length===0)break;
  if(!swaps.length)throw Error('swap feasibility impossible');
  // Drop the latest eligible swap that can affect an excessive departure.
  const offender=exceeding[0],idx=swaps.findIndex(i=>
   baselineOrder[i].id===offender.id||baselineOrder[i+1].id===offender.id);
  swaps.splice(idx<0?swaps.length-1:idx,1);
  if(++attempt>eligible.length)throw Error('swap guard not converged');
 }
 check(runResult.departures.every(x=>Math.abs(x.originalQueueIndex-x.actualDepartureOrder)<=1),
  'more than one position moved');
 const b=new Map(fifo.departures.map(x=>[x.id,x]));
 check(runResult.departures.every(x=>{
  const baseline=b.get(x.id);
  return x.status!=='served'||baseline.status!=='served'||
   x.airborneMs-baseline.airborneMs<=c.reorder.maxAdditionalDelayMs;
 }), 'unvalidated 120s extra delay exceeded');
 return {...runResult,eligibleSwapCount:eligible.length,rejectedSwapCount:eligible.length-swaps.length};
}
export function comparePair(m,c=CONFIG,{preset='CURRENT',
 jetAnchorKt=c.fittedSpeedContrast.jetAnchorKt}={}){
 const fifo=simulate(m,c,{policy:'FIFO',preset,jetAnchorKt}),candidate=simulate(m,c,{policy:'TYPE_EXIT_ONE_SWAP',preset,jetAnchorKt});
 check(fifo.meta.manifestSha256===candidate.meta.manifestSha256,'paired manifest mismatch');
 return {manifestSha256:digest(m),fifo,candidate};
}
function bootstrap(values,c,seed){
 const random=xorshift(seed),b=c.replication.pairedBootstrapReplicates,out=[];
 for(let i=0;i<b;i++){
  let sum=0;
  for(let j=0;j<values.length;j++)sum+=values[Math.floor(random()*values.length)];
  out.push(sum/values.length);
 }
 return {method:'PAIRED_SEED_RESAMPLE_MEAN_PERCENTILE',replicates:b,
  lower:quant(out,.025),upper:quant(out,.975)};
}
export function replicate(c=CONFIG,{jetAnchorKt=c.fittedSpeedContrast.jetAnchorKt}={}){
 validateConfig(c);
 const fit=fittedSpeedContrast(c,jetAnchorKt),cases=[];
 const metrics=['departuresInHour','arrivalsInHour','departuresByDrain','totalDepartureDelayS',
  'meanDepartureDelayS','sameExitNegativeGateGapCount'];
 for(const bg of c.demand.backgroundArrivalsPerHour)
  for(const rate of c.demand.departureLevelsPerHour)
   for(const preset of Object.keys(c.intervalPresets)){
    const rows=[];
    for(let i=0;i<c.replication.seeds;i++){
     const seed=c.replication.seedStart+i*c.replication.seedStride;
     const manifest=makeManifest(c,{seed,departuresPerHour:rate,backgroundArrivalsPerHour:bg});
     const pair=comparePair(manifest,c,{preset,jetAnchorKt});
     rows.push({seed,manifestSha256:pair.manifestSha256,fifo:pair.fifo,candidate:pair.candidate,
      syntheticDepartureTypes:manifest.departures.map(x=>x.category),
      syntheticExitCounts:Object.fromEntries(Object.keys(c.observed.exitSharesPercent).map(exit=>
       [exit,manifest.departures.filter(x=>x.exit===exit).length]))});
    }
    const summaries={};
    for(const policy of ['fifo','candidate'])
     summaries[policy]=Object.fromEntries(metrics.map(k=>[k,stats(rows.map(r=>r[policy].metrics[k]))]));
    const deltas=Object.fromEntries(metrics.map((key,k)=>{
     const values=rows.map(r=>r.candidate.metrics[key]-r.fifo.metrics[key]);
     return [key,{...stats(values),pairedMeanCI95:bootstrap(values,c,
      c.replication.bootstrapSeed+bg*10000+rate*101+(preset==='CURRENT'?0:3000)+k*13)}];
    }));
    const pairedGate40Median=rows.map(r=>{
     const a=r.candidate.metrics.sameExitGate40GapS.median;
     const b=r.fifo.metrics.sameExitGate40GapS.median;
     return isnum(a)&&isnum(b)?a-b:null;
    }).filter(isnum);
    const pairedGate40P10=rows.map(r=>{
     const a=r.candidate.metrics.sameExitGate40GapS.p10;
     const b=r.fifo.metrics.sameExitGate40GapS.p10;
     return isnum(a)&&isnum(b)?a-b:null;
    }).filter(isnum);
    const gateTimePaired={
     medianS:{...stats(pairedGate40Median),pairedMeanCI95:pairedGate40Median.length>=2?
      bootstrap(pairedGate40Median,c,c.replication.bootstrapSeed+bg*20000+rate*211+
       (preset==='CURRENT'?0:9000)+61):null},
     p10S:{...stats(pairedGate40P10),pairedMeanCI95:pairedGate40P10.length>=2?
      bootstrap(pairedGate40P10,c,c.replication.bootstrapSeed+bg*20000+rate*211+
       (preset==='CURRENT'?0:9000)+67):null}
    };
    const swapsAccepted=rows.map(r=>r.candidate.swaps.length),
     swapsEligible=rows.map(r=>r.candidate.eligibleSwapCount??0),
     swapsRejected=rows.map(r=>r.candidate.rejectedSwapCount??0);
    const swapAudit={
     seedsWithAcceptedSwaps:swapsAccepted.filter(x=>x>0).length,
     seedShareWithAcceptedSwaps:swapsAccepted.filter(x=>x>0).length/rows.length,
     acceptedSwaps:stats(swapsAccepted),eligibleSwaps:stats(swapsEligible),
     rejectedSwaps:stats(swapsRejected),
     eligibleTotal:swapsEligible.reduce((a,b)=>a+b,0),
     acceptedTotal:swapsAccepted.reduce((a,b)=>a+b,0),
     limitMs:c.reorder.maxAdditionalDelayMs,maxPositions:c.reorder.maxPositions,
     ctotAtfm:'NOT_MODELLED'
    };
    const detail=rows.map(r=>{
     const summarizeRun=x=>({
      departuresByDrain:x.metrics.departuresByDrain,
      depHour:x.metrics.departuresInHour,
      arrHour:x.metrics.arrivalsInHour,
      meanDepDelayS:x.metrics.meanDepartureDelayS,
      totalDepDelayS:x.metrics.totalDepartureDelayS,
      swapped:x.swaps.length,
      sameExitGate40:x.metrics.sameExitGate40GapS,
      sameExitMissing:x.metrics.pairNotEvaluableCount});
     return {seed:r.seed,manifestSha256:r.manifestSha256,
      fifo:summarizeRun(r.fifo),candidate:summarizeRun(r.candidate),
      swapIds:r.candidate.swaps,
      conservation:r.fifo.totals.requests===r.fifo.totals.served+r.fifo.totals.censored&&
       r.candidate.totals.requests===r.candidate.totals.served+r.candidate.totals.censored};
    });
    const representative=rows[0];
    const syntheticExitCounts=Object.fromEntries(Object.keys(c.observed.exitSharesPercent)
     .map(exit=>[exit,rows.reduce((sum,r)=>sum+r.syntheticExitCounts[exit],0)]));
    const totalDepRequests=rows.length*rate*c.demand.durationHours;
    const syntheticExitPercent=Object.fromEntries(Object.entries(syntheticExitCounts)
     .map(([exit,count])=>[exit,100*count/totalDepRequests]));
    const tpCount=rows.reduce((sum,r)=>sum+r.syntheticDepartureTypes.filter(x=>x==='TURBOPROP').length,0);
    const typeMixAudit={syntheticTPSharePercent:100*tpCount/totalDepRequests,
     hypotheticalTPSharePercent:100*c.fleet.turbopropShare,
     observedTPSharePercent:null,source:'HYPOTHETICAL_NOT_OBSERVED_TYPE_MIX'};
    const gates={};
    for(const policy of ['fifo','candidate']){
     const samePairs=rows.flatMap(r=>r[policy].pairs.filter(p=>p.sameExit));
     const within180=samePairs.filter(p=>p.airborneGapSeconds<=180);
     const evaluable=samePairs.filter(p=>p.gateTimes.RADIAL_40_NM.gapSeconds!==null);
     const evaluableWithin180=within180.filter(p=>p.gateTimes.RADIAL_40_NM.gapSeconds!==null);
     const byOrder={};
     for(const type of ['TP-J','J-TP','J-J'])
      byOrder[type]=stats(evaluable.filter(p=>p.categoryPair===type)
       .map(p=>p.change40FromAirborneSeconds));
     gates[policy]={sameExitPairs:samePairs.length,evaluableSameExitPairs:evaluable.length,
      coverage:evaluable.length/Math.max(1,samePairs.length),
      sameExitAirborneGapS:stats(samePairs.map(p=>p.airborneGapSeconds)),
      within180SecondsComparablePopulation:{
       pairs:within180.length,withGate40:evaluableWithin180.length,
       observedReferenceNPairs:52,observedReferenceAirborneGapApproxSeconds:120,
       airborneGapS:stats(within180.map(p=>p.airborneGapSeconds)),
       gate40TimeGapS:stats(evaluableWithin180.map(p=>p.gateTimes.RADIAL_40_NM.gapSeconds)),
       status:'SYNTHETIC_CONDITIONED_SAME_EXIT_WITHIN_180_SECONDS_NOT_VALIDATED'},
      gate30GapS:stats(samePairs.map(p=>p.gateTimes.RADIAL_30_NM.gapSeconds)),
      gate40GapS:stats(evaluable.map(p=>p.gateTimes.RADIAL_40_NM.gapSeconds)),
      change40ByOrderS:byOrder,
      differentExitPairs:rows.reduce((sum,r)=>sum+r[policy].metrics.differentExitPairs,0),
      noDifferentExitSpacingClaim:true};
    }
    cases.push({backgroundArrivalsPerHour:bg,departureDemandPerHour:rate,preset,
     jetAnchorKt,seedCount:rows.length,
     fifo:summaries.fifo,candidate:summaries.candidate,pairedCandidateMinusFIFO:deltas,
     pairedGate40GapCandidateMinusFIFO:gateTimePaired,swapAudit,
     gateSummaries:gates,
     exitMixAudit:{observedPercent:c.observed.exitSharesPercent,
      syntheticCounts:syntheticExitCounts,syntheticPercent:syntheticExitPercent,
      syntheticTotalDepartures:totalDepRequests,source:'POOLED_OBSERVED_SHARES_APPLIED_TO_SYNTHETIC_SEEDED_REQUESTS'},
     typeMixAudit,
     acceptance:{allConserved:detail.every(x=>x.conservation),
      anySwap:detail.some(x=>x.candidate.swapped>0),
      noSafetyMinimaChange:true,ctotAtfm:'NOT_MODELLED',operationalCapacity:false},
     perSeed:detail,
     representativeManifestSha256:representative.manifestSha256});
   }
 return {schema:1,status:'MECHANICS_ONLY_UNVALIDATED',version:VERSION,
  mainBaseSha:c.mainBaseSha,lockSha256:LOCK,fit,jetAnchorKt,sources:c.sourceComments,
  cases,seedCount:c.replication.seeds,observed:c.observed,
  warnings:['Not an operational ATC, CTOT/ATFM, separation or runway capacity model',
   '300kt jet anchor is HYPOTHETICAL; only jet–TP travel-time contrast is identifiable from source medians',
   '30/40NM are synthetic radial-time gates, not projected exit fixes',
   'Observed ~120s airborne same-exit spacing is sensitivity only, not a clearance minimum',
   'GTQ 37% is pooled observed exit frequency, synthetic independent assignments',
   'Background ARR 1/h and 7/h are synthetic requests matched to observed broad regimes',
   'Type and heavy shares are UNVALIDATED, no observed departure aircraft type shares supplied',
   'CTOT/ATFM slot compliance NOT MODELLED', 'No new hard wake/procedural minima substituted']};
}
