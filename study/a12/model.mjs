// Stage A1.2: non-operational, paired ARR–DEP–ARR opportunity mechanics.
// Does not model tower clearances, runway geometry or certified separation.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {digest,byteCompare} from '../core.mjs';
import {profileFor,timeToGoMs,distanceBeforeThresholdNM,minimumCommonFinalNM,wakeFloorNM,assignEffectiveTargets,selectType,APPROVED_TYPE_WEIGHTS} from '../a11/model.mjs';

export const A12_VERSION='A1.2-queue-conditional-candidate-3';
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
 for(const k of ['arrivalROTMs','airborneToFollowerThresholdBufferMs','maxArrivalDeferralMs','runwayClearAfterDepAirborneMs','measurementStartMs','measurementEndMs','drainEndMs','stepMs','seed','arrivalCount','arrivalRequestStepMs','arrivalRequestJitterMs','departureEvery','departureDemandDelayMs'])integer(c[k],k);
 check(c.arrivalROTMs>0&&c.stepMs>0&&c.departureEvery>0&&c.arrivalCount>=2,'invalid positive timing or counts');
 check(c.measurementEndMs>c.measurementStartMs&&c.drainEndMs>=c.measurementEndMs,'invalid windows');
 check(Array.isArray(c.arrivalDemandLevelsPerHour)&&
  JSON.stringify(c.arrivalDemandLevelsPerHour)==='[18,20,21,22]','fixed 18/20/21/22 ARR/h scenarios required');
 integer(c.arrivalDemandHours,'arrivalDemandHours',1);
 check(c.arrivalDemandHours===2,'two-hour demand horizon required');
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
export function makeManifest(c=DEFAULT_CONFIG){
 validateConfig(c);
 const next=xorshift(c.seed),arrivals=[],opportunities=[];
 for(let i=0;i<c.arrivalCount;i++){
  // Same approved *pooled speed-sample proxy* as A1.1, not an assumed
  // equally-weighted four-type fleet (which would over-sample heavies).
  const selected=selectType(next()),jitter=Math.floor(next()*c.arrivalRequestJitterMs);
  arrivals.push({id:'SYN-A'+String(i).padStart(3,'0'),kind:'ARR',wake:selected.wake,type:selected.type,
   runway:'24',headwindKt:0,requestMs:i*c.arrivalRequestStepMs+jitter,
   targetNormal:normal(next),componentQuantile:next(),captureQuantile:next()});
  if(i>0&&i%c.departureEvery===0){
   const category=c.departureCategories[(Math.floor(i/c.departureEvery)-1)%c.departureCategories.length];
   opportunities.push({id:'SYN-D'+String(i).padStart(3,'0'),kind:'DEP',category,
    type:category==='HEAVY_JET'?'B744':category==='TURBOPROP'?'DH8D':'B738',
    wake:category==='HEAVY_JET'?'H':'M',
    betweenLeaderId:arrivals[i-1].id,followerId:arrivals[i].id,
    requestMs:arrivals[i-1].requestMs+c.departureDemandDelayMs});
  }
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
 const arrivals=[],departures=[],opportunities=[],events=[],dByFollower=new Map(manifest.opportunities.map(x=>[x.followerId,x]));
 let stopped=false;
 for(let i=0;i<manifest.arrivals.length;i++){
  const f=manifest.arrivals[i],prev=arrivals.at(-1);
  if(stopped||(prev&&prev.status!=='served')){
   stopped=true;
   arrivals.push({...f,status:'censored',reason:'drain-horizon',timeMs:null,delayMs:null});
   const dep=dByFollower.get(f.id);
   if(dep){
    const missed={...dep,status:'censored',reason:'arrival-drain-horizon',missedOpportunity:true,
     sequence,policy,bindingReasons:['DRAIN_HORIZON'],timeMs:null,delayMs:null};
    departures.push(missed);opportunities.push(missed);
   }
   continue;
  }
  const noDepFloor=prev?minArrivalThresholdGapMs(prev,f,c):0;
  // The delivered-spacing target is frozen per follower, independent of
  // whether an intervening departure is attempted, accepted or missed.
  // No post-departure catch-up at the 3NM surveillance minimum.
  const followerProfile=profileFor(f.type,f.headwindKt);
  const coreTargetGapMs=prev?timeToGoMs(f.coreTargetM,followerProfile):0;
  const coreRequiredMs=Math.max(noDepFloor,coreTargetGapMs);
  // Decision uses original request time BEFORE any departure release attempt.
  // Queued => core-only; nonqueued => original full mixture, including tail.
  const isQueued=!!prev && f.requestMs < prev.timeMs+coreRequiredMs;
  const selectedTargetM=isQueued?f.coreTargetM:f.effectiveTargetM;
  const selectedComponent=isQueued?'CORE':f.effectiveTargetComponent;
  const lockedTargetMs=prev?timeToGoMs(selectedTargetM,followerProfile):0;
  const noDepRequiredMs=Math.max(noDepFloor,lockedTargetMs);
  const noDepTime=prev?Math.max(f.requestMs,prev.timeMs+noDepRequiredMs):f.requestMs;
  const d=dByFollower.get(f.id);
  let selectedTime=noDepTime;
  if(d){
   const t=timeline(prev.timeMs,d.requestMs,d.category,sequence,c);
   const profile=profileFor(f.type,f.headwindKt);
   const plannedDistanceMs=timeToGoMs(c.distancePlanningNM[d.category]*NM,profile);
   const planningMs=policy===DISTANCE?plannedDistanceMs:t.requiredGapMs;
   const requiredMs=Math.max(t.requiredGapMs,planningMs,noDepRequiredMs);
   const candidate=Math.max(f.requestMs,prev.timeMs+requiredMs);
   const delayFromDemandMs=candidate-f.requestMs;
   const canServe=candidate<=c.drainEndMs&&delayFromDemandMs<=c.maxArrivalDeferralMs;
   const reason=!canServe?'ARRIVAL_DEFERRAL_CEILING':
     policy===DISTANCE?'DISTANCE_PLANNING':'TIME_PLANNING';
   selectedTime=canServe?candidate:noDepTime;
   const reasons=[];
   if(canServe){
    for(const [name,ms] of [['ARRIVAL_A11_LOCKED_DELIVERED_SPACING',noDepRequiredMs],
      ['DEPARTURE_PHYSICAL',t.requiredGapMs],
      [policy==='DISTANCE'?'DISTANCE_PLANNING':'TIME_PLANNING',planningMs]]){
     if(Math.abs(requiredMs-ms)<=c.stepMs)reasons.push(name);
    }
   }
   const actualIntervalMs=selectedTime-prev.timeMs;
   const distanceAtLeaderThresholdNM=distanceBeforeThresholdNM(actualIntervalMs,profile);
   const row={...d,status:canServe?'served':'censored',reason:canServe?reason:'missed-opportunity',
    missedOpportunity:!canServe,sequence,policy,requestedMs:d.requestMs,
    leaderId:prev.id,followerId:f.id,leaderThresholdMs:prev.timeMs,
    followerThresholdMs:selectedTime,availableGapMs:actualIntervalMs,requiredGapMs:t.requiredGapMs,
    planningRequiredMs:planningMs,actualSlackMs:actualIntervalMs-t.requiredGapMs,
    planningSlackMs:actualIntervalMs-planningMs,
    distanceAtLeaderThresholdNM,planningDistanceNM:c.distancePlanningNM[d.category],
    earliestPhysicalFollowerMs:prev.timeMs+t.requiredGapMs,
    bindingReasons:canServe?reasons:['ARRIVAL_DEFERRAL_CEILING'],
    events:canServe?t:null,
    timeMs:canServe?t.departureAirborneMs:null,
    delayMs:canServe?Math.max(0,t.departureAirborneMs-d.requestMs):null,
    sourceStatus:'SYNTHETIC_UNVALIDATED'};
   departures.push(row);opportunities.push(row);
   if(canServe){
    check(t.departureRollStartMs>=t.arrivalRunwayClearMs,'unsafe roll before arrival clear');
    check(selectedTime>=t.followerPhysicalMinimumMs,'follower before departure safety buffer');
    events.push({flightId:d.id,event:'departure-airborne',timeMs:t.departureAirborneMs});
   }
  }
  if(selectedTime>c.drainEndMs){
   stopped=true;
   arrivals.push({...f,status:'censored',reason:'drain-horizon',timeMs:null,delayMs:null});continue;
  }
  const row={...f,status:'served',timeMs:selectedTime,delayMs:selectedTime-f.requestMs,
   arrivalClearMs:selectedTime+c.arrivalROTMs,bindingReasons:[],
   lockedTargetM:selectedTargetM??null,
   lockedTargetComponent:selectedComponent??null,
   lockedTargetGapMs:lockedTargetMs,
   fullMixtureTargetM:f.effectiveTargetM??null,
   coreOnlyTargetM:f.coreTargetM??null,
   queueConditional:isQueued,
   queueThresholdMs:prev?prev.timeMs+coreRequiredMs:null,
   queueDecisionRule:'REQUEST_EARLIER_THAN_PREV_THRESHOLD_PLUS_CORE_REQUIRED',
   a11LockedSpacingBinding:!!prev&&selectedTime>=prev.timeMs+noDepRequiredMs,
   sourceStatus:'SYNTHETIC_UNVALIDATED'};
  arrivals.push(row);
  events.push({flightId:f.id,event:'arrival-threshold',timeMs:selectedTime});
 }
 const all=[...arrivals,...departures];
 const totals={demand:all.length,served:all.filter(x=>x.status==='served').length,
  censored:all.filter(x=>x.status==='censored').length,rejected:0,goArounds:0};
 check(totals.demand===totals.served+totals.censored+totals.rejected+totals.goArounds,'demand conservation');
 const servedArr=arrivals.filter(x=>x.status==='served'),servedDep=departures.filter(x=>x.status==='served');
 const window=(x)=>x.timeMs>=c.measurementStartMs&&x.timeMs<c.measurementEndMs;
 const nArr=servedArr.filter(window).length,nDep=servedDep.filter(window).length;
 const rate=HR/(c.measurementEndMs-c.measurementStartMs);
 const slack=opportunities.filter(x=>x.status==='served').map(x=>x.actualSlackMs/1000);
 const arrDelay=servedArr.map(x=>x.delayMs/1000),depDelay=servedDep.map(x=>x.delayMs/1000);
 const binding={};
 for(const x of opportunities)for(const k of x.bindingReasons)binding[k]=(binding[k]||0)+1;
 const metrics={arrivalRatePerHour:nArr*rate,departureRatePerHour:nDep*rate,runwayMovementsPerHour:(nArr+nDep)*rate,
  measurementArrivals:nArr,measurementDepartures:nDep,
  usedDepartureOpportunities:servedDep.length,missedDepartureOpportunities:departures.filter(x=>x.missedOpportunity).length,
  slackSeconds:{p10:quant(slack,.1),median:quant(slack,.5),p90:quant(slack,.9),
   negativeShare:slack.length?slack.filter(x=>x<0).length/slack.length:null},
  arrivalDelaySeconds:{median:quant(arrDelay,.5),p90:quant(arrDelay,.9)},
  departureDelaySeconds:{median:quant(depDelay,.5),p90:quant(depDelay,.9)},
  bindingReasons:binding,
  queueConditions:{queued:arrivals.filter(x=>x.queueConditional===true).length,
   nonqueued:arrivals.filter((x,i)=>i>0&&x.queueConditional===false).length,
   coreSelected:arrivals.filter(x=>x.lockedTargetComponent==='CORE').length,
   tailSelected:arrivals.filter(x=>x.lockedTargetComponent==='TAIL').length},
  capacityEligible:false,capacityLabel:'MECHANICS_ONLY_UNVALIDATED_NOT_TECHNICAL_CAPACITY'};
 return {meta:{modelVersion:A12_VERSION,sequence,policy,manifestSha256:digest(manifest),
  configSha256:digest(c),preset:c.preset,observation:'HYPOTHETICAL_MECHANICS',source:'SYNTHETIC_ONLY',
  a11LockReadOnly:true,a11Spacing:A11_SPACING_PROVENANCE,
  arrivalTargetApplication:'QUEUE_CONDITIONAL_CORE_IF_REQUEST_BEFORE_EARLIEST_CORE_THRESHOLD_ELSE_FULL_MIXTURE',
  queueConditionalSource:'CLAUDE_REVIEW_5903308924_MODERATE_CONFIDENCE',
  units:{time:'integer-ms',distance:'NM'},
  measurement:{startMs:c.measurementStartMs,endMs:c.measurementEndMs,drainEndMs:c.drainEndMs}},
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
