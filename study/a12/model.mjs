// Stage A1.2: non-operational, paired ARR–DEP–ARR opportunity mechanics.
// Does not model tower clearances, runway geometry or certified separation.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {digest,byteCompare} from '../core.mjs';
import {profileFor,timeToGoMs,distanceBeforeThresholdNM,minimumCommonFinalNM,wakeFloorNM,assignEffectiveTargets,selectType,APPROVED_TYPE_WEIGHTS} from '../a11/model.mjs';

export const A12_VERSION='A1.2-incremental-fifo-candidate-5';
export const CONDITIONAL='LINEUP_BEHIND_LANDING';
export const SEQUENTIAL='SEQUENTIAL_AFTER_RUNWAY_CLEAR';
export const TIME='TIME';
export const DISTANCE='DISTANCE';
export const DEFAULT_CONFIG=Object.freeze(JSON.parse(readFileSync(new URL('./MECHANICS_ONLY.json',import.meta.url),'utf8')));
const NM=1852, HR=3600000;
export const APPROVED_A11_LOCK_SHA256='be55a9622ce770ea0f66bfdcc6d582f53948577c8e1f4bb4ffda72a7026a85fb';
const lockBytes=readFileSync(new URL('../a11/calibration-lock.json',import.meta.url));
const lockSha256=createHash('sha256').update(lockBytes).digest('hex');
if(lockSha256!==APPROVED_A11_LOCK_SHA256)throw Error('A1.1 approved locked spacing file has changed');
const lockedA11=Object.freeze(JSON.parse(lockBytes.toString('utf8')));
if(lockedA11.freeParameterCount!==8||lockedA11.modelVersion!=='A1.1-two-component-2'||
   lockedA11.status!=='CANDIDATE_NOT_APPROVED'||
   lockedA11.parameterFamily!=='SHARED_TWO_COMPONENT_SHIFTED_LOGNORMAL')
 throw Error('Unexpected A1.1 locked delivery distribution');
export const A11_SPACING_PROVENANCE=Object.freeze({
 lockSha256,sourceCommitSha:lockedA11.codeCommitSha,
 modelVersion:lockedA11.modelVersion,
 distribution:'LOCKED_EIGHT_PARAMETER_TWO_COMPONENT_EQUIVALENT_DISTANCE',
 status:'A11_LOCKED_OBSERVED_AGGREGATE_VALIDATED_NOT_OPERATIONAL'
});

const sequences=[CONDITIONAL,SEQUENTIAL],policies=[DISTANCE,TIME];
function check(ok,msg){if(!ok)throw Error(msg);}
function integer(v,k,min=0){check(Number.isSafeInteger(v)&&v>=min,'invalid '+k);}
export function validateConfig(c){
 check(c&&c.schema===1&&c.preset==='A12_MECHANICS_ONLY_UNVALIDATED'&&c.nonOperational===true,'non-operational A1.2 preset required');
 for(const k of ['arrivalROTMs','airborneToFollowerThresholdBufferMs','maxIncrementalArrivalDelayMs','runwayClearAfterDepAirborneMs','measurementStartMs','measurementEndMs','drainEndMs','stepMs','seed','arrivalCount','arrivalRequestStepMs','arrivalRequestJitterMs','departureEvery','departureDemandDelayMs'])integer(c[k],k);
 check(c.arrivalROTMs>0&&c.stepMs>0&&c.departureEvery>0&&c.arrivalCount>=2,'invalid positive timing or counts');
 check(c.measurementEndMs>c.measurementStartMs&&c.drainEndMs>=c.measurementEndMs,'invalid windows');
 check(Array.isArray(c.arrivalDemandLevelsPerHour)&&
  JSON.stringify(c.arrivalDemandLevelsPerHour)==='[18,20,21,22]','fixed 18/20/21/22 ARR/h scenarios required');
 integer(c.arrivalDemandHours,'arrivalDemandHours',1);
 check(c.arrivalDemandHours===2,'two-hour demand horizon required');
 const rep=c.replication;
 check(rep&&Number.isSafeInteger(rep.seeds)&&rep.seeds>=50&&rep.seeds<=500&&
  Number.isSafeInteger(rep.seedStart)&&Number.isSafeInteger(rep.seedStride)&&rep.seedStride>0&&
  Number.isSafeInteger(rep.pairedMeanCiBootstrapReplicates)&&rep.pairedMeanCiBootstrapReplicates>=1000&&
  Number.isSafeInteger(rep.pairedMeanCiSeed)&&rep.confidence===.95,
  'at least 50 fixed paired seeds and bootstrap policy required');
 check(c.departureDemandProfiles?.OBSERVED_LIKE_3_PER_H_2_HEAVY?.departuresPerHour===3&&
  c.departureDemandProfiles.OBSERVED_LIKE_3_PER_H_2_HEAVY.heavyPerHour===2&&
  JSON.stringify(c.departureDemandProfiles.OBSERVED_LIKE_3_PER_H_2_HEAVY.orderPerHour)===
   '["HEAVY_JET","HEAVY_JET","MEDIUM_JET"]','observed-like 3 departures/hour with 2 heavy is required');
 check(c.environment?.lvp===false,'LVP excluded from A1.2');
 for(const name of ['MEDIUM_JET','HEAVY_JET','TURBOPROP']){
  const x=c.departureByCategory?.[name];
  check(x&&x.source==='SYNTHETIC_UNVALIDATED','unknown departure timing provenance');
  integer(x.departureLineupMs,name+' lineup');integer(x.departureRollToAirborneMs,name+' roll');
  check(x.departureRollToAirborneMs>0,'invalid departure roll');
  check(c.distancePlanningNM?.[name]=== (name==='HEAVY_JET'?10:8),'planning distance cannot be changed by A1.2');
 }
 check(c.surveillanceNM===3,'A1.1 3NM surveillance floor must remain unchanged');
 check(Array.isArray(c.departureCategories)&&c.departureCategories.length>0&&
  c.departureCategories.every(x=>['MEDIUM_JET','HEAVY_JET','TURBOPROP'].includes(x)),'invalid category set');
 return c;
}
function xorshift(seed){let x=(seed>>>0)||0x9e3779b9;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function normal(next){return Math.sqrt(-2*Math.log(Math.max(1e-12,next())))*Math.cos(2*Math.PI*next());}
export function configForDemandLevel(base,arrivalsPerHour){
 validateConfig(base);
 check(base.arrivalDemandLevelsPerHour.includes(arrivalsPerHour),'unknown ARR demand level');
 return {...base,arrivalCount:arrivalsPerHour*base.arrivalDemandHours,
  arrivalRequestStepMs:Math.round(HR/arrivalsPerHour)};
}
export function makeManifest(c=DEFAULT_CONFIG,departureProfile='INSERTABLE_EVERY_SECOND_ARR'){
 validateConfig(c);
 const next=xorshift(c.seed),arrivals=[],opportunities=[];
 for(let i=0;i<c.arrivalCount;i++){
  // Same approved *pooled speed-sample proxy* as A1.1, not an assumed
  // equally-weighted four-type fleet (which would over-sample heavies).
  const selected=selectType(next()),jitter=Math.floor(next()*c.arrivalRequestJitterMs);
  arrivals.push({id:'SYN-A'+String(i).padStart(3,'0'),kind:'ARR',wake:selected.wake,type:selected.type,
   runway:'24',headwindKt:0,requestMs:i*c.arrivalRequestStepMs+jitter,
   targetNormal:normal(next),componentQuantile:next(),captureQuantile:next()});
  if(departureProfile==='INSERTABLE_EVERY_SECOND_ARR'&&i>0&&i%c.departureEvery===0){
   const category=c.departureCategories[(Math.floor(i/c.departureEvery)-1)%c.departureCategories.length];
   opportunities.push({id:'SYN-D'+String(i).padStart(3,'0'),kind:'DEP',category,
    type:category==='HEAVY_JET'?'B744':category==='TURBOPROP'?'DH8D':'B738',
    wake:category==='HEAVY_JET'?'H':'M',
    betweenLeaderId:arrivals[i-1].id,followerId:arrivals[i].id,
    requestMs:arrivals[i-1].requestMs+c.departureDemandDelayMs});
  }
 }
 check(['INSERTABLE_EVERY_SECOND_ARR','OBSERVED_LIKE_3_PER_H_2_HEAVY'].includes(departureProfile),
  'unknown departure demand profile');
 if(departureProfile==='OBSERVED_LIKE_3_PER_H_2_HEAVY'){
  const profile=c.departureDemandProfiles.OBSERVED_LIKE_3_PER_H_2_HEAVY;
  const n=profile.departuresPerHour*c.arrivalDemandHours;
  for(let k=0;k<n;k++){
   // Three non-overlapping opportunities in each synthetic demand hour,
   // approximately at minute 10, 30 and 50, never reverse-fitted to ANA.
   const desiredMs=Math.round(((k+.5)*HR)/profile.departuresPerHour);
   let followerIndex=1;
   for(let i=2;i<arrivals.length;i++)
    if(Math.abs(arrivals[i].requestMs-desiredMs)<
       Math.abs(arrivals[followerIndex].requestMs-desiredMs))followerIndex=i;
   check(!opportunities.some(x=>x.followerId===arrivals[followerIndex].id),
    'observed-like demand selection must be unique');
   const cat=profile.orderPerHour[k%profile.departuresPerHour];
   const leader=arrivals[followerIndex-1],follower=arrivals[followerIndex];
   opportunities.push({id:'SYN-OD'+String(k).padStart(3,'0'),
    kind:'DEP',category:cat,type:cat==='HEAVY_JET'?'B744':'B738',
    wake:cat==='HEAVY_JET'?'H':'M',
    betweenLeaderId:leader.id,followerId:follower.id,
    requestMs:leader.requestMs+c.departureDemandDelayMs});
  }
  check(opportunities.length===6&&
    opportunities.filter(x=>x.category==='HEAVY_JET').length===4,
    'observed-like two-hour demand must have 6 requests, 4 heavy');
 }
 // Reuse the exact locked A1.1 assignment function, not a new approximate
 // mixture sampler. All draws are immutable manifest fields before any run.
 const assigned=assignEffectiveTargets({schema:11,synthetic:true,flights:[arrivals]},lockedA11.parameters);
 // Draw both alternatives before scheduling, from the SAME preassigned normal.
 // A1.1's original mixture sampler remains unchanged. For core-only, force
 // the immutable component quantile above the locked mixing probability.
 const assignedCore=assignEffectiveTargets({schema:11,synthetic:true,
  flights:[arrivals.map(a=>({...a,componentQuantile:1}))]},lockedA11.parameters);
 const fixedArrivals=assigned.flights[0].map((a,i)=>({...a,
   coreTargetM:assignedCore.flights[0][i].effectiveTargetM,
   coreTargetSource:'A11_LOCKED_CORE_SAME_NORMAL',
   arrivalSpacingSource:A11_SPACING_PROVENANCE.distribution}));
 return {schema:12,synthetic:true,seed:c.seed,startUtc:'2026-01-01T00:00:00.000Z',
  arrivals:fixedArrivals,opportunities,source:'SYNTHETIC_ONLY_FIXED_MANIFEST',version:A12_VERSION,
  departureDemandProfile:departureProfile,
  a11LockSha256:A11_SPACING_PROVENANCE.lockSha256,
  a11ParametersSha256:assigned.distributionParametersSha256,
  a11FleetWeightsSha256:digest(APPROVED_TYPE_WEIGHTS)};
}
export function validateManifest(m,c){
 check(m?.synthetic===true&&m.schema===12&&m.seed===c.seed,'synthetic A1.2 manifest required');
 check(m.a11LockSha256===APPROVED_A11_LOCK_SHA256&&
   m.a11ParametersSha256===digest(lockedA11.parameters)&&
   m.a11FleetWeightsSha256===digest(APPROVED_TYPE_WEIGHTS),
   'manifest must be bound to exact A1.1 lock and parameters');
 check(Array.isArray(m.arrivals)&&Array.isArray(m.opportunities),'manifest flights required');
 const ids=new Set();
 for(const a of m.arrivals){
  check(a.kind==='ARR'&&typeof a.id==='string'&&!ids.has(a.id),'invalid/duplicate arrival');
  ids.add(a.id);integer(a.requestMs,'arrival request');
  check(['H','M','L'].includes(a.wake),'invalid wake');
  profileFor(a.type,a.headwindKt);
  if(a.id===m.arrivals[0].id){
   check(a.effectiveTargetM===null||a.effectiveTargetM===undefined,'first ARR cannot have a follower target');
  }else{
   check(Number.isSafeInteger(a.effectiveTargetM)&&a.effectiveTargetM>0 &&
     Number.isSafeInteger(a.coreTargetM)&&a.coreTargetM>0 &&
     a.coreTargetSource==='A11_LOCKED_CORE_SAME_NORMAL' &&
     a.effectiveTargetSource==='TARGET_AS_EQUIVALENT_TRACK_DISTANCE' &&
     a.arrivalSpacingSource===A11_SPACING_PROVENANCE.distribution,
     'immutable locked A1.1 target required for every arrival pair');
  }
 }
 for(const d of m.opportunities){
  check(d.kind==='DEP'&&typeof d.id==='string'&&!ids.has(d.id),'invalid/duplicate departure');
  ids.add(d.id);integer(d.requestMs,'departure request');
  check(c.departureByCategory[d.category]!==undefined,'unsupported departure category');
  const index=m.arrivals.findIndex(a=>a.id===d.followerId);
  check(index>0&&m.arrivals[index-1].id===d.betweenLeaderId,'opportunity must reference adjacent arrivals');
 }
 // The caller cannot supply a superficially valid but altered target. Reconstruct
 // it from the frozen manifest quantiles and the exact A1.1 locked parameters.
 const recomputed=assignEffectiveTargets({schema:11,synthetic:true,
  flights:[m.arrivals]},lockedA11.parameters).flights[0];
 const recomputedCore=assignEffectiveTargets({schema:11,synthetic:true,
  flights:[m.arrivals.map(a=>({...a,componentQuantile:1}))]},lockedA11.parameters).flights[0];
 for(let i=0;i<m.arrivals.length;i++){
  const observed=m.arrivals[i],expected=recomputed[i];
  check(observed.effectiveTargetM===expected.effectiveTargetM&&
   observed.effectiveTargetComponent===expected.effectiveTargetComponent&&
   observed.coreTargetM===recomputedCore[i].effectiveTargetM&&
   observed.coreTargetSource==='A11_LOCKED_CORE_SAME_NORMAL'&&
   observed.effectiveTargetSource===expected.effectiveTargetSource,
   'immutable A1.1 target differs from locked normal/component quantiles');
 }
 check(m.arrivals.every((a,i)=>i===0||a.requestMs>=m.arrivals[i-1].requestMs),'arrival demand ordering');
 check(m.opportunities.length===new Set(m.opportunities.map(x=>x.followerId)).size,'one departure opportunity per arrival pair in A1.2');
 return m;
}
const quant=(xs,p)=>{
 if(!xs.length)return null;
 const a=[...xs].sort((x,y)=>x-y),v=(a.length-1)*p,j=Math.floor(v);
 return a[j]+(a[Math.min(j+1,a.length-1)]-a[j])*(v-j);
};
export function minArrivalThresholdGapMs(leader,follower,c){
 const lp=profileFor(leader.type,leader.headwindKt);
 const fp=profileFor(follower.type,follower.headwindKt);
 const minNM=Math.max(c.surveillanceNM,wakeFloorNM(leader.wake,follower.wake));
 let ms=Math.max(c.arrivalROTMs,timeToGoMs(minNM*NM,fp)),n=0;
 while(minimumCommonFinalNM(lp,fp,ms)<minNM-1e-8){
  ms+=c.stepMs;if(++n>1000)throw Error('A1.2 common-final hard floor unsatisfiable');
 }
 return ms;
}
export function timeline(leadMs,depRequestMs,category,sequence,c=DEFAULT_CONFIG){
 validateConfig(c);
 check(sequences.includes(sequence),'unknown lineup sequence');
 integer(leadMs,'leader time');integer(depRequestMs,'departure requested time');
 const p=c.departureByCategory[category];
 check(p,'unsupported departure category');
 const tClear=leadMs+c.arrivalROTMs;
 const tLineupStart=sequence===CONDITIONAL?
  Math.max(leadMs,depRequestMs):Math.max(tClear,depRequestMs);
 const tLineupComplete=tLineupStart+p.departureLineupMs;
 const tRunwayEntry=Math.max(tClear,depRequestMs); // conditional positioning is not a runway-entry clearance
 const tRollStart=Math.max(tRunwayEntry,tLineupComplete);
 const tAirborne=tRollStart+p.departureRollToAirborneMs;
 const tDepClear=tAirborne+c.runwayClearAfterDepAirborneMs;
 const tFollowerPhysicalMinimum=Math.max(tAirborne+c.airborneToFollowerThresholdBufferMs,tDepClear);
 return {leaderThresholdMs:leadMs,arrivalRunwayClearMs:tClear,
  conditionalPositioningMs:sequence===CONDITIONAL?tLineupStart:null,
  departureLineupStartMs:tLineupStart,departureLineupCompleteMs:tLineupComplete,
  departureRunwayEntryMs:tRunwayEntry,departureRollStartMs:tRollStart,
  departureAirborneMs:tAirborne,departureRunwayClearMs:tDepClear,
  followerPhysicalMinimumMs:tFollowerPhysicalMinimum,
  requiredGapMs:tFollowerPhysicalMinimum-leadMs,
  sequence,category,
  flags:{conditionalLineupSyntheticAssumption:sequence===CONDITIONAL,
   departureRollStartsAfterArrivalClear:tRollStart>=tClear,
   actualELLXRunwayClearOrLineupObserved:false},
  componentsMs:{arrivalROTMs:c.arrivalROTMs,departureLineupMs:p.departureLineupMs,
   departureRollToAirborneMs:p.departureRollToAirborneMs,
   airborneToFollowerThresholdBufferMs:c.airborneToFollowerThresholdBufferMs,
   depClearAfterAirborneMs:c.runwayClearAfterDepAirborneMs}};
}
export function feasibility(c=DEFAULT_CONFIG,sequence=CONDITIONAL,category='MEDIUM_JET',followerType='B738'){
 validateConfig(c);
 const group=category==='HEAVY_JET'?'heavy':'nonheavy';
 const observed=c.reference.development[group];
 const dep=timeline(0,0,category,sequence,c);
 const fp=profileFor(followerType,0);
 const distancePlanningMs=timeToGoMs(c.distancePlanningNM[category]*NM,fp);
 // The representative ARR–ARR safety floor remains independent of the
 // intervening departure. It may dominate the time-based minimum.
 const representativeLeader={type:'B738',wake:'M',headwindKt:0};
 const representativeFollower={type:followerType,
  wake:followerType==='PC12'?'L':'M',headwindKt:0};
 const arrivalHardFloorMs=minArrivalThresholdGapMs(representativeLeader,representativeFollower,c);
 const minimumFeasibleS=Math.max(dep.requiredGapMs,arrivalHardFloorMs)/1000;
 return {sequence,category,followerType,status:minimumFeasibleS<=observed.intP10S?'PASS':'MECHANICS_NOT_SUPPORTED_BY_OBSERVED_P10',
  modelMinimumS:minimumFeasibleS,departurePhysicalMinimumS:dep.requiredGapMs/1000,
  arrivalHardMinimumS:arrivalHardFloorMs/1000,
  assumedLeaderType:'B738',assumedLeaderWake:'M',
  referenceP10S:observed.intP10S,referenceMedianS:observed.intMedianS,
  referencePairs:observed.nPairs,distancePlanningEquivalentS:distancePlanningMs/1000,
  holdoutP10S:c.reference.holdoutReportOnly[group].intP10S,
  holdoutPairs:c.reference.holdoutReportOnly[group].nPairs,
  holdoutRole:'REPORT_ONLY_NOT_A_FIT_TARGET',
  sourceStatus:'SYNTHETIC_UNVALIDATED_VS_OBSERVED_AGGREGATE_DEV',
  notOperationalMinimum:true};
}
export function simulate(manifest,config=DEFAULT_CONFIG,{sequence=CONDITIONAL,policy=DISTANCE}={}){
 const c=validateConfig(config);validateManifest(manifest,c);
 check(sequences.includes(sequence)&&policies.includes(policy),'invalid scenario');
 const arrivals=[],departures=[],events=[];
 const requests=[...manifest.opportunities].sort((a,b)=>
  a.requestMs-b.requestMs||a.id.localeCompare(b.id));
 const pending=[];
 let requestIndex=0,stopped=false;
 const enqueueThrough=(timeMs)=>{
  while(requestIndex<requests.length&&requests[requestIndex].requestMs<=timeMs)
   pending.push({...requests[requestIndex++],queuedSinceMs:timeMs});
 };
 const release=(d,t,prev,f,selectedTime,planningMs,requiredMs,extraDelayMs,noDepTime,reasons,tailDrain=false)=>{
  const profile=f?profileFor(f.type,f.headwindKt):null;
  const actualIntervalMs=f?selectedTime-prev.timeMs:null;
  const row={...d,status:'served',reason:tailDrain?'DRAIN_FIFO_AFTER_FINAL_ARRIVAL':
    policy===DISTANCE?'DISTANCE_PLANNING':'TIME_PLANNING',
   missedOpportunity:false,sequence,policy,requestedMs:d.requestMs,
   originalLeaderId:d.betweenLeaderId,originalFollowerId:d.followerId,
   leaderId:prev.id,followerId:f?.id??null,leaderThresholdMs:prev.timeMs,
   followerThresholdMs:tailDrain?null:selectedTime,
   availableGapMs:actualIntervalMs,requiredGapMs:t.requiredGapMs,
   planningRequiredMs:planningMs,incrementalArrivalDelayMs:tailDrain?0:extraDelayMs,
   noDepartureFollowerThresholdMs:tailDrain?null:noDepTime,
   actualSlackMs:tailDrain?null:actualIntervalMs-t.requiredGapMs,
   planningSlackMs:tailDrain?null:actualIntervalMs-planningMs,
   distanceAtLeaderThresholdNM:profile?distanceBeforeThresholdNM(actualIntervalMs,profile):null,
   planningDistanceNM:c.distancePlanningNM[d.category],
   earliestPhysicalFollowerMs:prev.timeMs+t.requiredGapMs,
   bindingReasons:reasons,events:t,timeMs:t.departureAirborneMs,
   delayMs:Math.max(0,t.departureAirborneMs-d.requestMs),
   queueWaitMs:Math.max(0,t.departureAirborneMs-d.requestMs),
   fifoQueuePosition:0,sourceStatus:'SYNTHETIC_UNVALIDATED'};
  departures.push(row);
  events.push({flightId:d.id,event:'departure-airborne',timeMs:t.departureAirborneMs});
  check(t.departureRollStartMs>=t.arrivalRunwayClearMs,'unsafe roll before arrival clear');
  if(!tailDrain)check(selectedTime>=t.followerPhysicalMinimumMs,
   'follower before departure protection');
  return row;
 };
 for(let i=0;i<manifest.arrivals.length;i++){
  const f=manifest.arrivals[i],prev=arrivals.at(-1);
  if(stopped||(prev&&prev.status!=='served')){
   stopped=true;
   arrivals.push({...f,status:'censored',reason:'drain-horizon',
    timeMs:null,delayMs:null,sourceStatus:'SYNTHETIC_UNVALIDATED'});
   continue;
  }
  const noDepFloor=prev?minArrivalThresholdGapMs(prev,f,c):0;
  const followerProfile=profileFor(f.type,f.headwindKt);
  const coreTargetGapMs=prev?timeToGoMs(f.coreTargetM,followerProfile):0;
  const coreRequiredMs=Math.max(noDepFloor,coreTargetGapMs);
  const isQueued=!!prev&&f.requestMs<prev.timeMs+coreRequiredMs;
  const selectedTargetM=isQueued?f.coreTargetM:f.effectiveTargetM;
  const selectedComponent=isQueued?'CORE':f.effectiveTargetComponent;
  const lockedTargetMs=prev?timeToGoMs(selectedTargetM,followerProfile):0;
  const noDepRequiredMs=Math.max(noDepFloor,lockedTargetMs);
  const noDepTime=prev?Math.max(f.requestMs,prev.timeMs+noDepRequiredMs):f.requestMs;
  let selectedTime=noDepTime;
  // A request arriving before the earliest follower threshold is eligible for
  // this opportunity, regardless of which future pair it was first tied to.
  // Later requests cannot jump an earlier pending request (strict FIFO).
  if(prev)enqueueThrough(noDepTime);
  if(prev&&pending.length){
   const d=pending[0];
   const t=timeline(prev.timeMs,d.requestMs,d.category,sequence,c);
   const plannedDistanceMs=timeToGoMs(c.distancePlanningNM[d.category]*NM,followerProfile);
   const planningMs=policy===DISTANCE?plannedDistanceMs:t.requiredGapMs;
   const requiredMs=Math.max(t.requiredGapMs,planningMs,noDepRequiredMs);
   const candidate=Math.max(f.requestMs,prev.timeMs+requiredMs);
   const extraDelayMs=Math.max(0,candidate-noDepTime);
   const canRelease=candidate<=c.drainEndMs&&
    extraDelayMs<=c.maxIncrementalArrivalDelayMs &&
    t.departureAirborneMs<=candidate;
   if(canRelease){
    selectedTime=candidate;
    const reasons=[];
    for(const [name,ms] of [
     ['ARRIVAL_A11_LOCKED_DELIVERED_SPACING',noDepRequiredMs],
     ['DEPARTURE_PHYSICAL',t.requiredGapMs],
     [policy===DISTANCE?'DISTANCE_PLANNING':'TIME_PLANNING',planningMs]]){
     if(Math.abs(requiredMs-ms)<=c.stepMs)reasons.push(name);
    }
    const released=pending.shift();
    release(released,t,prev,f,selectedTime,planningMs,requiredMs,extraDelayMs,noDepTime,reasons);
   }else{
    // The request remains at queue head and is retried at the NEXT arrival gap.
    // It is not censored, rejected, or replaced by later requests here.
    events.push({flightId:d.id,event:'fifo-hold-next-gap',timeMs:noDepTime,
     reason:extraDelayMs>c.maxIncrementalArrivalDelayMs?
      'INCREMENTAL_DELAY_EXCEEDS_LIMIT':'HORIZON_OR_RELEASE_TIMING',
     incrementalArrivalDelayMs:extraDelayMs});
   }
  }
  if(selectedTime>c.drainEndMs){
   stopped=true;
   arrivals.push({...f,status:'censored',reason:'drain-horizon',
    timeMs:null,delayMs:null,sourceStatus:'SYNTHETIC_UNVALIDATED'});
   continue;
  }
  const row={...f,status:'served',timeMs:selectedTime,delayMs:selectedTime-f.requestMs,
   arrivalClearMs:selectedTime+c.arrivalROTMs,bindingReasons:[],
   lockedTargetM:selectedTargetM??null,lockedTargetComponent:selectedComponent??null,
   lockedTargetGapMs:lockedTargetMs,fullMixtureTargetM:f.effectiveTargetM??null,
   coreOnlyTargetM:f.coreTargetM??null,queueConditional:isQueued,
   queueThresholdMs:prev?prev.timeMs+coreRequiredMs:null,
   queueDecisionRule:'REQUEST_EARLIER_THAN_PREV_THRESHOLD_PLUS_CORE_REQUIRED',
   a11LockedSpacingBinding:!!prev&&selectedTime>=prev.timeMs+noDepRequiredMs,
   sourceStatus:'SYNTHETIC_UNVALIDATED'};
  arrivals.push(row);
  events.push({flightId:f.id,event:'arrival-threshold',timeMs:selectedTime});
 }
 // After the final ARR there is no follower to delay. FIFO departures can
 // use the remaining declared DRAIN window after the final ARR has vacated.
 // This is reported separately, never retroactively counted as an hourly
 // movement in the measurement window.
 const last=arrivals.filter(a=>a.status==='served').at(-1);
 if(last){
  enqueueThrough(c.drainEndMs);
  let nextAvailableMs=last.arrivalClearMs;
  while(pending.length){
   const d=pending[0];
   const leader={...last,timeMs:Math.max(last.timeMs,nextAvailableMs-c.arrivalROTMs)};
   const t=timeline(leader.timeMs,d.requestMs,d.category,SEQUENTIAL,c);
   if(t.departureAirborneMs>c.drainEndMs)break;
   pending.shift();
   release(d,t,leader,null,null,null,t.requiredGapMs,0,null,
    ['FIFO_DRAIN_AFTER_LAST_ARRIVAL'],true);
   nextAvailableMs=Math.max(t.departureRunwayClearMs,t.departureAirborneMs);
  }
 }
 // Requests that remain unserved at the declared drain horizon are the only
 // ones censored. Count every original request exactly once.
 enqueueThrough(c.drainEndMs);
 for(const d of pending)departures.push({...d,status:'censored',
  reason:'drain-horizon',missedOpportunity:true,sequence,policy,
  timeMs:null,delayMs:null,queueWaitMs:null,events:null,
  bindingReasons:['DRAIN_HORIZON'],sourceStatus:'SYNTHETIC_UNVALIDATED'});
 const assigned=new Set(departures.map(d=>d.id));
 check(assigned.size===departures.length,'departure queued more than once');
 for(const d of requests)check(assigned.has(d.id),'lost departure demand');
 const opportunities=requests.map(d=>departures.find(x=>x.id===d.id));
 const all=[...arrivals,...departures];
 const totals={demand:all.length,served:all.filter(x=>x.status==='served').length,
  censored:all.filter(x=>x.status==='censored').length,rejected:0,goArounds:0};
 check(totals.demand===totals.served+totals.censored+totals.rejected+
  totals.goArounds,'demand conservation');
 const servedArr=arrivals.filter(x=>x.status==='served'),
  servedDep=departures.filter(x=>x.status==='served');
 const window=x=>x.timeMs>=c.measurementStartMs&&x.timeMs<c.measurementEndMs;
 const nArr=servedArr.filter(window).length,nDep=servedDep.filter(window).length;
 const rate=HR/(c.measurementEndMs-c.measurementStartMs);
 const slack=opportunities.filter(x=>x.status==='served'&&x.actualSlackMs!==null)
  .map(x=>x.actualSlackMs/1000);
 const arrDelay=servedArr.map(x=>x.delayMs/1000),
  depDelay=servedDep.map(x=>x.delayMs/1000);
 const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
 const binding={};
 for(const x of opportunities)for(const k of x.bindingReasons)
  binding[k]=(binding[k]||0)+1;
 const metrics={
  arrivalRatePerHour:nArr*rate,departureRatePerHour:nDep*rate,
  runwayMovementsPerHour:(nArr+nDep)*rate,
  measurementArrivals:nArr,measurementDepartures:nDep,
  usedDepartureOpportunities:servedDep.length,
  missedDepartureOpportunities:departures.filter(x=>x.missedOpportunity).length,
  pendingAtDrain:pending.length,
  departedDuringDrain:servedDep.filter(x=>x.reason==='DRAIN_FIFO_AFTER_FINAL_ARRIVAL').length,
  slackSeconds:{p10:quant(slack,.1),median:quant(slack,.5),p90:quant(slack,.9),
   negativeShare:slack.length?slack.filter(x=>x<0).length/slack.length:null},
  arrivalDelaySeconds:{mean:mean(arrDelay),median:quant(arrDelay,.5),p90:quant(arrDelay,.9)},
  departureDelaySeconds:{mean:mean(depDelay),median:quant(depDelay,.5),p90:quant(depDelay,.9)},
  departureMeasurementDelaySeconds:{mean:mean(servedDep.filter(window).map(x=>x.delayMs/1000))},
  bindingReasons:binding,
  queueConditions:{queued:arrivals.filter(x=>x.queueConditional===true).length,
   nonqueued:arrivals.filter((x,i)=>i>0&&x.queueConditional===false).length,
   coreSelected:arrivals.filter(x=>x.lockedTargetComponent==='CORE').length,
   tailSelected:arrivals.filter(x=>x.lockedTargetComponent==='TAIL').length},
  capacityEligible:false,capacityLabel:'MECHANICS_ONLY_UNVALIDATED_NOT_TECHNICAL_CAPACITY'};
 return {meta:{modelVersion:A12_VERSION,sequence,policy,manifestSha256:digest(manifest),
  configSha256:digest(c),preset:c.preset,observation:'HYPOTHETICAL_MECHANICS',
  source:'SYNTHETIC_ONLY',departureDemandProfile:
   manifest.departureDemandProfile??'INSERTABLE_EVERY_SECOND_ARR',
  a11LockReadOnly:true,a11Spacing:A11_SPACING_PROVENANCE,
  arrivalTargetApplication:'QUEUE_CONDITIONAL_CORE_IF_REQUEST_BEFORE_EARLIEST_CORE_THRESHOLD_ELSE_FULL_MIXTURE',
  queueConditionalSource:'CLAUDE_REVIEW_5903308924_MODERATE_CONFIDENCE',
  departureQueueRule:'FIFO_INCREMENTAL_ARR_DELAY_GATE_ONLY_CENSOR_AT_DRAIN',
  units:{time:'integer-ms',distance:'NM'},
  measurement:{startMs:c.measurementStartMs,endMs:c.measurementEndMs,
   drainEndMs:c.drainEndMs}},
  totals,metrics,arrivals,departures,opportunities,events};
}
export function lockedArrivalFloorDiagnostics(manifest,c=DEFAULT_CONFIG){
 validateManifest(manifest,c);
 const rows=manifest.arrivals.slice(1).map((f,i)=>{
  const lead=manifest.arrivals[i],requestedMs=timeToGoMs(f.effectiveTargetM,profileFor(f.type,f.headwindKt));
  const physicalMinMs=minArrivalThresholdGapMs(lead,f,c);
  return {raised:physicalMinMs>requestedMs,requestedMs,physicalMinMs};
 });
 const raisedTargets=rows.filter(x=>x.raised).length;
 return {targets:rows.length,raisedTargets,shareRaised:rows.length?raisedTargets/rows.length:null,
  source:'LOCKED_A11_EQUIVALENT_TARGET_VS_A12_UNVALIDATED_ROT_AND_HARD_MINIMA',
  a11FitRaiseFraction:lockedA11.floorRaising.raiseFraction,
  a11FitRaiseStatus:'REFERENCE_DIFFERENT_FLEET_AND_COHORT_NOT_A12_PERFORMANCE'};
}
export function pairedScenarios(manifest,c=DEFAULT_CONFIG){
 const all=[];
 for(const sequence of sequences)for(const policy of policies)all.push(simulate(manifest,c,{sequence,policy}));
 check(new Set(all.map(x=>x.meta.manifestSha256)).size===1,'paired manifest mismatch');
 return {manifestSha256:digest(manifest),scenarios:all,
  lockedArrivalFloorRaising:lockedArrivalFloorDiagnostics(manifest,c),
  feasibility:[...sequences.flatMap(seq=>['MEDIUM_JET','HEAVY_JET','TURBOPROP'].map(cat=>
   feasibility(c,seq,cat,cat==='TURBOPROP'?'DH8D':'B738')))],
  references:c.reference,sourceStatus:'MECHANICS_ONLY_UNVALIDATED'};
}
export function coreOnlySaturationDiagnostic(base=DEFAULT_CONFIG){
 validateConfig(base);
 // Separate stress manifest, not one of the four operational comparison cases.
 // High synthetic arrival demand is intentional: keep the server continuously
 // queued and measure output after the first hour's warm-up.
 const sat=base.saturatedArrivalOnly;
 check(sat&&sat.status==='SYNTHETIC_CORE_ONLY_UNVALIDATED'&&
  sat.demandPerHour>=30&&sat.durationHours>=3&&sat.warmupHours>=1,
  'invalid saturated core-only diagnostic');
 const c={...base,arrivalCount:sat.demandPerHour*sat.durationHours,
  arrivalRequestStepMs:Math.round(HR/sat.demandPerHour),
  departureEvery:1000000,measurementStartMs:sat.warmupHours*HR,
  measurementEndMs:sat.durationHours*HR,drainEndMs:(sat.durationHours+5)*HR};
 const manifest=makeManifest(c),result=simulate(manifest,c,{sequence:CONDITIONAL,policy:DISTANCE});
 const denominator=sat.durationHours-sat.warmupHours;
 const inWindow=result.arrivals.filter(a=>a.status==='served'&&
  a.timeMs>=c.measurementStartMs&&a.timeMs<c.measurementEndMs);
 const coreShare=result.metrics.queueConditions.queued/
  Math.max(1,result.arrivals.length-1);
 return {status:'SYNTHETIC_CORE_ONLY_SATURATED_DIAGNOSTIC_NOT_OBSERVED',
  requestedDemandPerHour:sat.demandPerHour,
  arrivalsPerHour:inWindow.length/denominator,
  measuredArrivals:inWindow.length,measurementHours:denominator,
  coreQueueShare:coreShare,queueCount:result.metrics.queueConditions.queued,
  fullMixtureTailSelected:result.metrics.queueConditions.tailSelected,
  observedReferenceApproxArrivalsPerHour:sat.referenceApproxRatePerHour,
  observedReferenceRole:'CLAUDE_APPROXIMATE_EXPECTATION_NOT_FIT_GATE',
  manifestSha256:digest(manifest),lockSha256:A11_SPACING_PROVENANCE.lockSha256,
  notes:'Synthetic saturated arrival-only diagnostic with no departure opportunities; no capacity certification'};
}
export function observedValidityGate(level,config=DEFAULT_CONFIG){
 const gate=config.observedValidityGate;
 check(gate&&gate.status==='OBSERVED_AGGREGATE'&&gate.minMeasuredDeparturesPerHour===2,
  'unregistered observed validity gate');
 const referenceCase=level.scenarios.find(x=>x.meta.sequence===CONDITIONAL&&x.meta.policy===DISTANCE);
 check(referenceCase,'missing conditional distance comparator');
 const arrivals=referenceCase.metrics.arrivalRatePerHour;
 const departures=referenceCase.metrics.departureRatePerHour;
 const eligible=gate.demandLevelsPerHour.includes(level.arrivalsPerHour);
 return {status:!eligible?'NOT_APPLICABLE':
   arrivals>=gate.minMeasuredArrivalsPerHour&&arrivals<=gate.maxMeasuredArrivalsPerHour&&
   departures>=gate.minMeasuredDeparturesPerHour?'PASS':'FAIL_OBSERVED_VALIDITY_GATE',
  demandArrivalsPerHour:level.arrivalsPerHour,modelArrivalsPerHour:arrivals,
  modelDeparturesPerHour:departures,observedArrivalBandPerHour:
   [gate.minMeasuredArrivalsPerHour,gate.maxMeasuredArrivalsPerHour],
  observedApproxDeparturesPerHour:gate.observedApproxDeparturesPerHour,
  observedHeavyDeparturesPerHour:gate.observedHeavyDeparturesPerHour,
  minAcceptedDeparturesPerHour:gate.minMeasuredDeparturesPerHour,
  observedReference:'SEPTEMBER_EVENING_PEAKS_7_DAYS_ANA_AGGREGATE_REVIEW_5903308924',
  unvalidatedGroundEvents:true,notAnOperationalCapacityClaim:true};
}
export function compareDemandLevels(base=DEFAULT_CONFIG){
 validateConfig(base);
 const levels=base.arrivalDemandLevelsPerHour.map(arrivalsPerHour=>{
  const config=configForDemandLevel(base,arrivalsPerHour);
  const manifest=makeManifest(config),result=pairedScenarios(manifest,config);
  const level={arrivalsPerHour,manifestSha256:digest(manifest),
   requestedArrivals:manifest.arrivals.length,requestedDepartureOpportunities:manifest.opportunities.length,
   lockedArrivalFloorRaising:result.lockedArrivalFloorRaising,
   scenarios:result.scenarios,feasibility:result.feasibility};
  return {...level,observedValidityGate:observedValidityGate(level,base)};
 });
 return {levels,a11Spacing:A11_SPACING_PROVENANCE,
  saturatedArrivalOnly:coreOnlySaturationDiagnostic(base),
  overallObservedValidityStatus:levels.filter(l=>l.observedValidityGate.status!=='NOT_APPLICABLE')
   .every(l=>l.observedValidityGate.status==='PASS')?'PASS':'FAIL_OBSERVED_VALIDITY_GATE',
  sourceStatus:'MECHANICS_ONLY_UNVALIDATED_NOT_CAPACITY'};
}

const MEASURES=[
 ['arrivalsPerHour',s=>s.metrics.arrivalRatePerHour],
 ['departuresPerHour',s=>s.metrics.departureRatePerHour],
 ['missedDepartureOpportunities',s=>s.metrics.missedDepartureOpportunities],
 ['meanArrivalDelaySeconds',s=>s.metrics.arrivalDelaySeconds.mean],
 ['meanDepartureDelaySeconds',s=>s.metrics.departureDelaySeconds.mean]
];
function describe(xs){
 const finite=xs.filter(Number.isFinite);
 return {n:finite.length,mean:finite.length?finite.reduce((a,b)=>a+b,0)/finite.length:null,
  p10:quant(finite,.1),p90:quant(finite,.9)};
}
function bootstrapMeanInterval(paired,config,levelSeed,profileId,sequenceId,metricId){
 const b=config.replication.pairedMeanCiBootstrapReplicates;
 const seed=(config.replication.pairedMeanCiSeed+
   levelSeed*1009+profileId*131+sequenceId*31+metricId*17)>>>0;
 const next=xorshift(seed), means=[];
 for(let j=0;j<b;j++){
  let sum=0;
  for(let i=0;i<paired.length;i++)
   sum+=paired[Math.floor(next()*paired.length)];
  means.push(sum/paired.length);
 }
 return {level:.95,lower:quant(means,.025),upper:quant(means,.975),
  method:'PAIRED_SEED_BOOTSTRAP_MEAN_PERCENTILE',replicates:b,seed};
}
function explainNonmonotonic(cond,seq,seed,policy){
 const bc=new Map(cond.departures.map(d=>[d.id,d]));
 const first=seq.departures.find(d=>{
  const c=bc.get(d.id);
  return c&&c.status!==d.status;
 });
 const d=first?bc.get(first.id):null;
 const isInWindow=(x,m)=>x?.status==='served'&&
  x.timeMs>=m.startMs&&x.timeMs<m.endMs;
 const firstWindow=seq.departures.find(x=>{
  const c=bc.get(x.id);
  return c&&isInWindow(x,seq.meta.measurement)!==isInWindow(c,cond.meta.measurement);
 });
 const wc=firstWindow?bc.get(firstWindow.id):null;
 const mechanism=first?'DIFFERENT_RELEASE_OR_MISSED_STATUS':
  firstWindow?'MEASUREMENT_WINDOW_BOUNDARY_CROSSING':'UNRESOLVED_MONOTONICITY_VIOLATION';
 return {seed,policy,
  conditionalDeparturesInWindow:cond.metrics.measurementDepartures,
  sequentialDeparturesInWindow:seq.metrics.measurementDepartures,
  excessDeparturesInWindow:seq.metrics.measurementDepartures-cond.metrics.measurementDepartures,
  conditionalAllServed:cond.metrics.usedDepartureOpportunities,
  sequentialAllServed:seq.metrics.usedDepartureOpportunities,
  conditionalArrivalsInWindow:cond.metrics.measurementArrivals,
  sequentialArrivalsInWindow:seq.metrics.measurementArrivals,
  evidenceClassification:mechanism,
  firstMeasurementWindowDifference:firstWindow?{
   departureId:firstWindow.id,
   conditionalCounted:isInWindow(wc,cond.meta.measurement),
   sequentialCounted:isInWindow(firstWindow,seq.meta.measurement),
   conditionalAirborneMs:wc?.timeMs??null,
   sequentialAirborneMs:firstWindow.timeMs??null,
   conditionalStatus:wc?.status??null,sequentialStatus:firstWindow.status,
   measurementStartMs:seq.meta.measurement.startMs,
   measurementEndMs:seq.meta.measurement.endMs
  }:null,
  earliestStatusDivergence:first?{
   departureId:first.id,conditionalStatus:d?.status??null,sequentialStatus:first.status,
   conditionalFollowerThresholdMs:d?.followerThresholdMs??null,
   sequentialFollowerThresholdMs:first.followerThresholdMs??null,
   conditionalDecisionReasons:d?.bindingReasons??[],
   sequentialDecisionReasons:first.bindingReasons??[],
   conditionalLeaderThresholdMs:d?.leaderThresholdMs??null,
   sequentialLeaderThresholdMs:first.leaderThresholdMs??null}:null,
  explanation:'Classification is based on the first divergent release status and first measurement-window crossing; greedy queue path-dependence and censoring are model hypotheses, not demonstrated physical advantages.',
  needsIndependentTechnicalReview:true};
}
export function replicateComparison(base=DEFAULT_CONFIG){
 validateConfig(base);
 const result=[];
 for(const [profileIndex,profile] of
   ['INSERTABLE_EVERY_SECOND_ARR','OBSERVED_LIKE_3_PER_H_2_HEAVY'].entries()){
  for(const arrivalsPerHour of base.arrivalDemandLevelsPerHour){
   const rows=[],demandSeed=base.replication.seedStart;
   for(let i=0;i<base.replication.seeds;i++){
    const seed=demandSeed+i*base.replication.seedStride;
    const cfg=configForDemandLevel({...base,seed},arrivalsPerHour);
    const manifest=makeManifest(cfg,profile);
    const four=pairedScenarios(manifest,cfg);
    rows.push({seed,manifestSha256:four.manifestSha256,
     scenarios:four.scenarios});
   }
   const summary=[];
   for(const sequence of sequences){
    const distance=rows.map(r=>r.scenarios.find(s=>s.meta.sequence===sequence&&s.meta.policy===DISTANCE));
    const time=rows.map(r=>r.scenarios.find(s=>s.meta.sequence===sequence&&s.meta.policy===TIME));
    for(const [policy,scenarios] of [[DISTANCE,distance],[TIME,time]]){
     summary.push({sequence,policy,n:scenarios.length,
      statistics:Object.fromEntries(MEASURES.map(([k,fn])=>
       [k,describe(scenarios.map(fn))]))});
    }
   }
   const pairedDifferences=[];
   for(const [si,sequence] of sequences.entries()){
    const dist=rows.map(r=>r.scenarios.find(s=>s.meta.sequence===sequence&&s.meta.policy===DISTANCE));
    const time=rows.map(r=>r.scenarios.find(s=>s.meta.sequence===sequence&&s.meta.policy===TIME));
    pairedDifferences.push({sequence,interpretation:'TIME_MINUS_DISTANCE_SAME_SEED_AND_MANIFEST',
     differences:Object.fromEntries(MEASURES.map(([key,fn],mi)=>{
      const values=dist.map((s,i)=>fn(time[i])-fn(s));
      const summary=describe(values);
      return [key,{...summary,pairedMeanCI95:bootstrapMeanInterval(values,base,arrivalsPerHour,profileIndex,si,mi)}];
     }))});
   }
   const monotonicity=[];
   for(const policy of policies){
    const violations=[];
    for(const r of rows){
     const conditional=r.scenarios.find(x=>x.meta.sequence===CONDITIONAL&&x.meta.policy===policy);
     const sequential=r.scenarios.find(x=>x.meta.sequence===SEQUENTIAL&&x.meta.policy===policy);
     if(sequential.metrics.departureRatePerHour>conditional.metrics.departureRatePerHour)
      violations.push(explainNonmonotonic(conditional,sequential,r.seed,policy));
    }
    const share=violations.length/rows.length;
    const fullRunViolations=rows.filter(r=>{
     const conditional=r.scenarios.find(x=>x.meta.sequence===CONDITIONAL&&x.meta.policy===policy);
     const sequential=r.scenarios.find(x=>x.meta.sequence===SEQUENTIAL&&x.meta.policy===policy);
     return sequential.metrics.usedDepartureOpportunities>
      conditional.metrics.usedDepartureOpportunities;
    }).map(r=>r.seed);
    monotonicity.push({policy,n:rows.length,violatingSeeds:violations.length,
     fullRunViolatingSeeds:fullRunViolations.length,
     fullRunSequentialHigherShare:fullRunViolations.length/rows.length,
     fullRunViolatingSeedIds:fullRunViolations,
     shareSequentialHigher:share,violations,flag:share>base.replication.monotonicityMaxViolationShareAdvisory?
      'ELEVATED_NONMONOTONICITY_REQUIRES_REVIEW':'LOW_NONMONOTONICITY',
     sourceStatus:'GREEDY_SCHEDULER_DIAGNOSTIC_NOT_SAFETY_GATE'});
   }
   const observedGate=profile==='OBSERVED_LIKE_3_PER_H_2_HEAVY'&&[20,21].includes(arrivalsPerHour)?
    {status:'REPLICATED_OBSERVED_LIKE_FIFO_GATE',
     reference:'CLAUDE_REVIEW_5903407826_ABOUT_20_ARR_H_AND_ALL_3_DEP_H',
     observedBand:[19,21],requestedDeparturesPerHour:3,
     fullRunRequestedDepartureCount:6,
     conditionalDistanceMeanARRPerHour:summary[0].statistics.arrivalsPerHour.mean,
     conditionalDistanceMeanDEPPerHour:summary[0].statistics.departuresPerHour.mean,
     conditionalDistanceMeanDepartureDelaySeconds:rows.reduce((sum,r)=>sum+
      (r.scenarios[0].metrics.departureDelaySeconds.mean??0),0)/rows.length,
     allRequestedDeparturesServedShare:rows.filter(r=>
      r.scenarios[0].metrics.usedDepartureOpportunities===6).length/rows.length,
     measurementDepartureDemandPerHour:3,
     requiresAllThreeDeparturesInMeasurementHour:true,
     measurementWindowAllThreeServedShare:rows.filter(r=>
      r.scenarios[0].metrics.measurementDepartures>=3).length/rows.length,
     verdict:summary[0].statistics.arrivalsPerHour.mean>=19&&
      summary[0].statistics.arrivalsPerHour.mean<=21&&
      rows.every(r=>r.scenarios[0].metrics.usedDepartureOpportunities===6)&&
      rows.every(r=>r.scenarios[0].metrics.measurementDepartures>=3)?
      'PASS':'FAIL_OBSERVED_LIKE_FIFO_GATE'}:
    profile==='INSERTABLE_EVERY_SECOND_ARR'&&[20,21].includes(arrivalsPerHour)?
    {status:'REPLICATED_OBSERVED_COMPARATOR',
     conditionalDistanceMeanARRPerHour:summary[0].statistics.arrivalsPerHour.mean,
     conditionalDistanceMeanDEPPerHour:summary[0].statistics.departuresPerHour.mean,
     reference:'CLAUDE_SEPT2026_EVENING_PEAK_20_21_ARR_PER_H_3_DEP_PER_H_2_HEAVY',
     observedBand:[19,21],minDeparturePerHour:2,
     verdict:summary[0].statistics.arrivalsPerHour.mean>=19&&
      summary[0].statistics.arrivalsPerHour.mean<=21&&
      summary[0].statistics.departuresPerHour.mean>=2?'PASS':'FAIL_OBSERVED_VALIDITY_GATE'}:
     {status:'NOT_APPLICABLE'};
   result.push({profile,arrivalsPerHour,seedCount:rows.length,
    seedStart:base.replication.seedStart,seedStride:base.replication.seedStride,
    requestedArrivals:arrivalsPerHour*base.arrivalDemandHours,
    requestedDepartureOpportunities:profile==='OBSERVED_LIKE_3_PER_H_2_HEAVY'?6:
      Math.floor((arrivalsPerHour*base.arrivalDemandHours-1)/base.departureEvery),
    profileDescription:base.departureDemandProfiles[profile].description??
      base.departureDemandProfiles[profile].note,
    referenceDataStatus:profile==='OBSERVED_LIKE_3_PER_H_2_HEAVY'?
     'OBSERVED_LIKE_REQUEST_COUNT_AND_HEAVY_MIX_NOT_OBSERVED_TIMES':
     'SYNTHETIC_INSERTABLE_OPPORTUNITIES_NOT_OBSERVED_DEMAND',
    statistics:summary,pairedDifferences,monotonicity,observedGate,
    perSeedManifestSha256:rows.map(r=>({seed:r.seed,sha256:r.manifestSha256}))});
  }
 }
 return {schema:1,status:'A12_PRELIMINARY_REPLICATED_MECHANICS_UNVALIDATED',
  seedCount:base.replication.seeds,demandProfiles:['INSERTABLE_EVERY_SECOND_ARR','OBSERVED_LIKE_3_PER_H_2_HEAVY'],
  demandLevelsPerHour:base.arrivalDemandLevelsPerHour,
  results:result,pairedBootstrap:base.replication,
  a11LockSha256:APPROVED_A11_LOCK_SHA256,
  assumptionStatus:'CONDITIONAL_ON_UNVALIDATED_GROUND_EVENT_DURATIONS',
  warning:'Monotonicity violations are shown with seed-level divergence evidence; do not hide or force monotonicity. Insertable capacity is not observed throughput.'};
}
