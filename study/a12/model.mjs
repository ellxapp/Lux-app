// Stage A1.2: non-operational, paired ARR–DEP–ARR opportunity mechanics.
// Does not model tower clearances, runway geometry or certified separation.
import {readFileSync} from 'node:fs';
import {digest,byteCompare} from '../core.mjs';
import {profileFor,timeToGoMs,distanceBeforeThresholdNM,minimumCommonFinalNM,wakeFloorNM} from '../a11/model.mjs';

export const A12_VERSION='A1.2-mechanics-candidate-1';
export const CONDITIONAL='LINEUP_BEHIND_LANDING';
export const SEQUENTIAL='SEQUENTIAL_AFTER_RUNWAY_CLEAR';
export const TIME='TIME';
export const DISTANCE='DISTANCE';
export const DEFAULT_CONFIG=Object.freeze(JSON.parse(readFileSync(new URL('./MECHANICS_ONLY.json',import.meta.url),'utf8')));
const NM=1852, HR=3600000;
const sequences=[CONDITIONAL,SEQUENTIAL],policies=[DISTANCE,TIME];
function check(ok,msg){if(!ok)throw Error(msg);}
function integer(v,k,min=0){check(Number.isSafeInteger(v)&&v>=min,'invalid '+k);}
export function validateConfig(c){
 check(c&&c.schema===1&&c.preset==='A12_MECHANICS_ONLY_UNVALIDATED'&&c.nonOperational===true,'non-operational A1.2 preset required');
 for(const k of ['arrivalROTMs','airborneToFollowerThresholdBufferMs','maxArrivalDeferralMs','runwayClearAfterDepAirborneMs','measurementStartMs','measurementEndMs','drainEndMs','stepMs','seed','arrivalCount','arrivalRequestStepMs','arrivalRequestJitterMs','departureEvery','departureDemandDelayMs'])integer(c[k],k);
 check(c.arrivalROTMs>0&&c.stepMs>0&&c.departureEvery>0&&c.arrivalCount>=2,'invalid positive timing or counts');
 check(c.measurementEndMs>c.measurementStartMs&&c.drainEndMs>=c.measurementEndMs,'invalid windows');
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
export function makeManifest(c=DEFAULT_CONFIG){
 validateConfig(c);
 const next=xorshift(c.seed),arrivals=[],opportunities=[];
 const types=[{type:'B738',wake:'M'},{type:'DH8D',wake:'M'},{type:'E295',wake:'M'},{type:'B744',wake:'H'}];
 for(let i=0;i<c.arrivalCount;i++){
  const selected=types[Math.floor(next()*types.length)],jitter=Math.floor(next()*c.arrivalRequestJitterMs);
  arrivals.push({id:'SYN-A'+String(i).padStart(3,'0'),kind:'ARR',wake:selected.wake,type:selected.type,
   runway:i%2?'24':'24',headwindKt:0,requestMs:i*c.arrivalRequestStepMs+jitter});
  if(i>0&&i%c.departureEvery===0){
   const category=c.departureCategories[(Math.floor(i/c.departureEvery)-1)%c.departureCategories.length];
   opportunities.push({id:'SYN-D'+String(i).padStart(3,'0'),kind:'DEP',category,
    type:category==='HEAVY_JET'?'B744':category==='TURBOPROP'?'DH8D':'B738',
    wake:category==='HEAVY_JET'?'H':'M',
    betweenLeaderId:arrivals[i-1].id,followerId:arrivals[i].id,
    requestMs:arrivals[i-1].requestMs+c.departureDemandDelayMs});
  }
 }
 return {schema:12,synthetic:true,seed:c.seed,startUtc:'2026-01-01T00:00:00.000Z',
  arrivals,opportunities,source:'SYNTHETIC_ONLY_FIXED_MANIFEST',version:A12_VERSION};
}
export function validateManifest(m,c){
 check(m?.synthetic===true&&m.schema===12&&m.seed===c.seed,'synthetic A1.2 manifest required');
 check(Array.isArray(m.arrivals)&&Array.isArray(m.opportunities),'manifest flights required');
 const ids=new Set();
 for(const a of m.arrivals){
  check(a.kind==='ARR'&&typeof a.id==='string'&&!ids.has(a.id),'invalid/duplicate arrival');
  ids.add(a.id);integer(a.requestMs,'arrival request');
  check(['H','M','L'].includes(a.wake),'invalid wake');
  profileFor(a.type,a.headwindKt);
 }
 for(const d of m.opportunities){
  check(d.kind==='DEP'&&typeof d.id==='string'&&!ids.has(d.id),'invalid/duplicate departure');
  ids.add(d.id);integer(d.requestMs,'departure request');
  check(c.departureByCategory[d.category]!==undefined,'unsupported departure category');
  const index=m.arrivals.findIndex(a=>a.id===d.followerId);
  check(index>0&&m.arrivals[index-1].id===d.betweenLeaderId,'opportunity must reference adjacent arrivals');
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
  const noDepTime=prev?Math.max(f.requestMs,prev.timeMs+noDepFloor):f.requestMs;
  const d=dByFollower.get(f.id);
  let selectedTime=noDepTime;
  if(d){
   const t=timeline(prev.timeMs,d.requestMs,d.category,sequence,c);
   const profile=profileFor(f.type,f.headwindKt);
   const plannedDistanceMs=timeToGoMs(c.distancePlanningNM[d.category]*NM,profile);
   const planningMs=policy===DISTANCE?plannedDistanceMs:t.requiredGapMs;
   const requiredMs=Math.max(t.requiredGapMs,planningMs,noDepFloor);
   const candidate=Math.max(f.requestMs,prev.timeMs+requiredMs);
   const delayFromDemandMs=candidate-f.requestMs;
   const canServe=candidate<=c.drainEndMs&&delayFromDemandMs<=c.maxArrivalDeferralMs;
   const reason=!canServe?'ARRIVAL_DEFERRAL_CEILING':
     policy===DISTANCE?'DISTANCE_PLANNING':'TIME_PLANNING';
   selectedTime=canServe?candidate:noDepTime;
   const reasons=[];
   if(canServe){
    for(const [name,ms] of [['ARRIVAL_HARD_MINIMA',noDepFloor],['DEPARTURE_PHYSICAL',t.requiredGapMs],
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
  bindingReasons:binding,capacityEligible:false,capacityLabel:'MECHANICS_ONLY_UNVALIDATED_NOT_TECHNICAL_CAPACITY'};
 return {meta:{modelVersion:A12_VERSION,sequence,policy,manifestSha256:digest(manifest),
  configSha256:digest(c),preset:c.preset,observation:'HYPOTHETICAL_MECHANICS',source:'SYNTHETIC_ONLY',
  a11LockReadOnly:true,units:{time:'integer-ms',distance:'NM'},
  measurement:{startMs:c.measurementStartMs,endMs:c.measurementEndMs,drainEndMs:c.drainEndMs}},
  totals,metrics,arrivals,departures,opportunities,events};
}
export function pairedScenarios(manifest,c=DEFAULT_CONFIG){
 const all=[];
 for(const sequence of sequences)for(const policy of policies)all.push(simulate(manifest,c,{sequence,policy}));
 check(new Set(all.map(x=>x.meta.manifestSha256)).size===1,'paired manifest mismatch');
 return {manifestSha256:digest(manifest),scenarios:all,
  feasibility:[...sequences.flatMap(seq=>['MEDIUM_JET','HEAVY_JET','TURBOPROP'].map(cat=>
   feasibility(c,seq,cat,cat==='TURBOPROP'?'DH8D':'B738')))],
  references:c.reference,sourceStatus:'MECHANICS_ONLY_UNVALIDATED'};
}
