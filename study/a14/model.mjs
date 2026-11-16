// A1.4: deterministic synthetic LVP event model, NOT operative ATC guidance.
import {readFileSync} from 'node:fs';
import {digest} from '../core.mjs';
export const VERSION='A1.4-LVP-post-vacate-candidate-1';
export const CONFIG=Object.freeze(JSON.parse(readFileSync(new URL('./MECHANICS_ONLY.json',import.meta.url),'utf8')));
export const BASELINE='SEQUENTIAL_AFTER_RUNWAY_VACATED';
export const SENSITIVITY='HYPOTHETICAL_NOT_ELLX_LVP_PRACTICE';
const H=3600000;
const must=(b,m)=>{if(!b)throw Error(m);};
const quant=(a,q)=>{const v=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!v.length)return null;const z=(v.length-1)*q,i=Math.floor(z);return v[i]+(v[Math.min(i+1,v.length-1)]-v[i])*(z-i);};
const desc=a=>({n:a.filter(Number.isFinite).length,mean:a.length?a.reduce((x,y)=>x+y,0)/a.length:null,p10:quant(a,.1),median:quant(a,.5),p90:quant(a,.9)});
const rng=(seed)=>{let x=seed>>>0||1;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};};
export function validate(c=CONFIG){
 must(c.schema===14&&c.lvpStateSource==='METAR_PROXY','LVP config');
 must(c.protection.departureBaseline===BASELINE&&c.protection.conditionalSensitivity===SENSITIVITY,'post-vacate baseline mandatory');
 must(c.runways['24'].inboundPlanningNM===10&&c.runways['06'].inboundPlanningNM===10,'separate 10NM planning');
 must(c.runways['24'].planningType==='SHOULD_NOT_HARD_MINIMUM','10NM is SHOULD');
 must(c.protection.holdingInboundNM.MEDIUM===10&&c.protection.holdingInboundNM.HEAVY===15,'hold limits');
 must(c.protection.heavyCriticalAreaInsideNM===12&&c.protection.arrivalCasaTriggerNM===2,'critical/casa thresholds');
 must(c.weatherThresholds.notificationCeilingFt===200&&c.weatherThresholds.notificationRvrAM===800,'notification');
 must(c.synthetic.allGroundTimingStatus==='SYNTHETIC_UNVALIDATED','ROT provenance');
 must(c.scenario.seedCount>=50&&c.scenario.drainEndMs>c.scenario.mixedDemandHours*H,'replication and drain');
 must(c.observedWinter?.lvpWithDeparture?.intervalS?.[0]===266,'frozen winter P10');
 must(c.outputs.holdoutValidation===false,'no winter holdout');
 return c;
}
export function classifyMetar(m,c=CONFIG){
 validate(c);
 const fields=['visibilityM','ceilingFt','rvrAM'],v={};
 for(const k of fields){const a=m?.[k];must(a==null||(Number.isFinite(a)&&a>=0),'invalid METAR '+k);v[k]=a??null;}
 const t=c.weatherThresholds;
 const n=(v.rvrAM!==null&&v.rvrAM<=t.notificationRvrAM)||(v.ceilingFt!==null&&v.ceilingFt<=t.notificationCeilingFt);
 const p=(v.visibilityM!==null&&v.visibilityM<=t.preparationVisibilityM)||(v.ceilingFt!==null&&v.ceilingFt<=t.preparationCeilingFt);
 const missing=fields.filter(k=>v[k]===null);
 return {state:n?'NOTIFICATION':p?'PREPARATION':missing.length?'UNKNOWN':'NORMAL',
  source:'METAR_PROXY',operationalDeclarationVerified:false,missingInputs:missing,
  observationGranularityMinutes:t.metarResolutionMinutes,
  timestampUtc:m?.timestampUtc??null,weatherInputs:v,
  preparationThresholdMet:p,notificationThresholdMet:n,
  appliedSyntheticLvpProtection:n};
}
export function secondsFromNM(n,c=CONFIG){must(Number.isFinite(n)&&n>=0,'distance');return 3600*n/c.synthetic.finalApproachSpeedKt;}
export function holdingDecision({departureCategory,inboundNM,phase='NOTIFICATION',passageMs=null},c=CONFIG){
 validate(c);must(['MEDIUM','HEAVY'].includes(departureCategory),'departure class');
 must(Number.isFinite(inboundNM)&&inboundNM>=0,'inbound distance');
 const limit=c.protection.holdingInboundNM[departureCategory],blocked=phase==='NOTIFICATION'&&inboundNM<limit;
 return {allowed:!blocked,limitNM:limit,inboundNM,passageMs,
  event:'CAT_II_III_HOLDING_POINT_PASSAGE',
  reason:blocked?'HOLD_INBOUND_INSIDE_'+limit+'NM':'HOLDING_PASSAGE_PERMITTED',
  exactBoundaryAllowed:inboundNM===limit,source:'PROCEDURE_RULE_DISTANCE_ESTIMATED'};
}
export function casaDecision({arrival,phase='NOTIFICATION',taxiInCasa=false,
 followerAt2NmMs=null,leaderLandingRunEndMs=null,casaClearMs=null},c=CONFIG){
 validate(c);must(arrival&&typeof arrival.id==='string','arrival ID');
 must(arrival.catIOnlyRequested===undefined||typeof arrival.catIOnlyRequested==='boolean','explicit CAT I flag');
 const catI=arrival.catIOnlyRequested===true,active=phase==='NOTIFICATION';
 const taxiBlocked=active&&!catI&&taxiInCasa&&Number.isFinite(followerAt2NmMs)&&
  (!Number.isFinite(casaClearMs)||followerAt2NmMs<casaClearMs);
 const sensitiveBlocked=active&&Number.isFinite(followerAt2NmMs)&&
  Number.isFinite(leaderLandingRunEndMs)&&followerAt2NmMs<leaderLandingRunEndMs;
 return {arrivalId:arrival.id,catIOnlyExplicit:catI,
  source:catI?'HYPOTHETICAL_CREW_REQUEST':'DEFAULT_CAT_II_III',
  taxiCasaCheckEnabled:active&&!catI,taxiCasaViolation:taxiBlocked,
  sensitiveAreaBlocked:sensitiveBlocked,criticalAreaProtectionRetained:true,
  runwayProtectionRetained:true,holdingProtectionRetained:true,
  planningSpacingRetained:true,event:'ARR_FOLLOWER_2NM',
  followerAt2NmMs,leaderLandingRunEndMs,casaClearMs,
  casaClearDistinctFromRunwayVacated:true};
}
export function heavyCriticalDecision({arrival,runway='24',inboundNM,
 heavyCriticalAreaOccupied,phase='NOTIFICATION',attemptNumber=1,thresholdMs=0},c=CONFIG){
 validate(c);must(arrival&&arrival.id&&Number.isFinite(inboundNM),'arrival/distance');
 const miss=runway==='24'&&phase==='NOTIFICATION'&&heavyCriticalAreaOccupied===true&&inboundNM<12;
 return {flightId:arrival.id,attemptId:arrival.id+':attempt-'+attemptNumber,
  outcome:miss?'MISSED_APPROACH':'CONTINUE',reason:miss?'CRITICAL_AREA_HEAVY':null,
  nextAttemptId:miss?arrival.id+':attempt-'+(attemptNumber+1):null,
  reentryAtMs:miss?thresholdMs+c.synthetic.goAroundReentryDelayMs:null,
  reentryStatus:miss?'QUEUED_UNVALIDATED_DELAY':'NOT_NEEDED',originalArrivalRequests:1};
}
export function feasibleMixedGap(c=CONFIG,{category='MEDIUM',rotMs=c.synthetic.arrivalROTMs,
 entryPolicy=BASELINE}={}){
 validate(c);must(['MEDIUM','HEAVY'].includes(category),'category');
 must([BASELINE,SENSITIVITY].includes(entryPolicy),'entry mode');
 const holdNM=c.protection.holdingInboundNM[category],approachTimeMs=secondsFromNM(holdNM,c)*1000;
 const passageMs=entryPolicy===BASELINE?rotMs:c.synthetic.lineupBehindPassageDelayMs;
 const rolloutMs=Math.max(rotMs,passageMs+c.synthetic.departureLineupMs)+
  c.synthetic.departureRollToAirborneMs+c.synthetic.departureRunwayClearAfterAirborneMs;
 const minimumMs=Math.max(passageMs+approachTimeMs,rolloutMs,
  secondsFromNM(c.synthetic.hardSeparationNM,c)*1000);
 const obs=c.observedWinter.lvpWithDeparture.intervalS[0];
 return {category,entryPolicy,holdNM,rotMs,holdingPassageMs:passageMs,
  minimumFeasibleIntervalS:minimumMs/1000,observedP10S:obs,
  gate:minimumMs/1000<=obs?'PASS':'FAIL_MODEL_ASSUMPTION_CONFLICT',
  runwayOccupancyProtected:true,
  baselineActualPractice:entryPolicy===BASELINE,
  sourceStatus:'SYNTHETIC_GROUND_TIMINGS_NOT_ANA_LVP_MEASUREMENTS'};
}
export function makeManifest(c=CONFIG,{seed=c.scenario.seedStart,arrivalOnly=false}={}){
 validate(c);const rand=rng(seed),s=c.scenario;
 const nA=s.demandArrivalPerHour*(arrivalOnly?s.arrivalOnlyDemandHours:s.mixedDemandHours);
 const nD=arrivalOnly?0:s.demandDeparturePerHour*s.mixedDemandHours;
 const arr=Array.from({length:nA},(_,i)=>({id:'ARR-'+i,kind:'ARR',requestMs:Math.round(
  (i+.5)*H/s.demandArrivalPerHour+(rand()-.5)*2*s.arrivalRequestJitterMs),
  catIOnlyRequested:false,source:'SYNTHETIC_REQUEST_NOT_OBSERVED'}));
 const deps=Array.from({length:nD},(_,i)=>({id:'DEP-'+i,kind:'DEP',
  requestMs:Math.round((i+.5)*H/s.demandDeparturePerHour+(rand()-.5)*2*s.departureRequestJitterMs),
  category:i%3===0?'HEAVY':'MEDIUM',source:'SYNTHETIC_READY_TIME_NOT_OBSERVED'}));
 return {schema:14,seed,arrivalOnly,arrivals:arr,departures:deps,
  source:'SYNTHETIC_IMMUTABLE_MANIFEST',catISelection:'NO_RANDOM_CAT_I_ONLY_REQUEST'};
}
export function simulate(m,c=CONFIG,{phase='NOTIFICATION',entryPolicy=BASELINE}={}){
 validate(c);must(m?.schema===14&&[BASELINE,SENSITIVITY].includes(entryPolicy),'manifest/entry policy');
 must(['NORMAL','PREPARATION','NOTIFICATION'].includes(phase),'phase');
 const protectedLvp=phase==='NOTIFICATION';
 const arrivals=[],departures=[],events=[],holds=[];
 const ready=[...m.departures],servedDep=new Set();
 let prev=null,missedApproaches=0,shortfalls=0;
 for(const item of m.arrivals){
  const thresholdFloor=prev?prev.thresholdMs+Math.max(c.synthetic.arrivalROTMs,
   secondsFromNM(protectedLvp?c.runways['24'].inboundPlanningNM:c.synthetic.hardSeparationNM,c)*1000):item.requestMs;
  let threshold=Math.max(item.requestMs,thresholdFloor);
  // The 10NM should targets planning, not the hard 3NM floor.
  // Only NOTIFICATION activates the source-tagged LVP constraints.
  const d=ready.find(x=>!servedDep.has(x.id)&&x.requestMs<=threshold);
  if(d){
   const vacate=prev?prev.runwayVacatedMs:0;
   const passage=protectedLvp&&entryPolicy===BASELINE?Math.max(d.requestMs,vacate):
    Math.max(d.requestMs,prev?prev.thresholdMs+c.synthetic.lineupBehindPassageDelayMs:0);
   const holdNM=protectedLvp?c.protection.holdingInboundNM[d.category]:0;
   const holdBeforeFollower=passage+secondsFromNM(holdNM,c)*1000;
   const rollStart=Math.max(passage+c.synthetic.departureLineupMs,vacate);
   const airborne=rollStart+c.synthetic.departureRollToAirborneMs;
   const depClear=airborne+c.synthetic.departureRunwayClearAfterAirborneMs;
   const chosen=Math.max(threshold,holdBeforeFollower,depClear);
   const actualInboundAtPassage=Math.max(0,(chosen-passage)/1000*
     c.synthetic.finalApproachSpeedKt/3600);
   const holdCheck=holdingDecision({departureCategory:d.category,inboundNM:actualInboundAtPassage,
    phase,passageMs:passage},c);
   const shouldBlock=protectedLvp&&!holdCheck.allowed;
   if(shouldBlock)holds.push({id:d.id,reason:holdCheck.reason,passage,attemptedThresholdMs:chosen});
   else{
    threshold=chosen;
    servedDep.add(d.id);
    departures.push({...d,status:'served',holdingPointPassageMs:passage,
     firstRunwayEntryMs:passage,airborneMs:airborne,runwayClearMs:depClear,
     delayMs:airborne-d.requestMs,holdingCheck:holdCheck,
     runwayEntryPractice:entryPolicy,runwayVacatedBeforeEntry:passage>=vacate});
    events.push({id:d.id,event:'CAT_II_III_HOLDING_POINT_PASSAGE',timeMs:passage},
     {id:d.id,event:'DEPARTURE_AIRBORNE',timeMs:airborne});
   }
  }
  const planningGapNM=protectedLvp?c.runways['24'].inboundPlanningNM:c.synthetic.hardSeparationNM;
  // A delayed follower is still not a new ARR request. CAT I-only never
  // arises from weather. Distinct CASA event times and conservative hold.
  const twoNmTime=Math.round(threshold-secondsFromNM(2,c)*1000);
  const casa=prev?casaDecision({arrival:item,phase,
   taxiInCasa:true,followerAt2NmMs:twoNmTime,
   leaderLandingRunEndMs:prev.landingRunEndMs,casaClearMs:prev.casaClearMs},c):null;
  if(casa?.taxiCasaViolation||casa?.sensitiveAreaBlocked){
   const clearance=Math.max(prev.landingRunEndMs,prev.casaClearMs);
   threshold=Math.max(threshold,clearance+secondsFromNM(2,c)*1000);
   events.push({id:item.id,event:'CASA_2NM_DELAY',
    untilMs:clearance,source:'SYNTHETIC_CASA_CLEAR_NOT_OBSERVED'});
  }
  const row={...item,status:'served',thresholdMs:threshold,
   delayMs:threshold-item.requestMs,planningTargetNM:planningGapNM,
   runwayVacatedMs:threshold+c.synthetic.arrivalROTMs,
   landingRunEndMs:threshold+c.synthetic.landingRunEndAfterThresholdMs,
   casaClearMs:threshold+c.synthetic.landingRunEndAfterThresholdMs+
    c.synthetic.casaClearAfterLandingRunMs,
   attemptId:item.id+':attempt-1',casa,phase,
   source:'SYNTHETIC_EVENT_TIMES_UNVALIDATED'};
  if(prev){
   row.deliveredSpacingNM=(threshold-prev.thresholdMs)/1000*
    c.synthetic.finalApproachSpeedKt/3600;
   row.planningShortfall=row.deliveredSpacingNM<planningGapNM;
   if(row.planningShortfall)shortfalls++;
  }
  arrivals.push(row);
  events.push({id:item.id,event:'ARR_THRESHOLD',timeMs:threshold},
   {id:item.id,event:'LANDING_RUN_END',timeMs:row.landingRunEndMs},
   {id:item.id,event:'CASA_CLEAR',timeMs:row.casaClearMs},
   {id:item.id,event:'RUNWAY_VACATED',timeMs:row.runwayVacatedMs});
  prev=row;
 }
 // Remaining FIFO departure demand is held and drained after the last arrival.
 let clear=prev?.runwayVacatedMs??0;
 for(const d of ready){
  if(servedDep.has(d.id))continue;
  const passage=Math.max(d.requestMs,clear);
  const airborne=passage+c.synthetic.departureLineupMs+c.synthetic.departureRollToAirborneMs;
  const complete=airborne+c.synthetic.departureRunwayClearAfterAirborneMs;
  const ok=airborne<=c.scenario.drainEndMs;
  departures.push({...d,status:ok?'served':'censored',reason:ok?'DRAIN_FIFO':'DRAIN_HORIZON',
   holdingPointPassageMs:ok?passage:null,airborneMs:ok?airborne:null,
   delayMs:ok?airborne-d.requestMs:null,runwayEntryPractice:entryPolicy});
  if(ok)events.push({id:d.id,event:'DRAIN_FIFO_DEPARTURE',timeMs:airborne});
  clear=complete;
 }
 must(arrivals.length===m.arrivals.length&&departures.length===m.departures.length,'demand conservation');
 const served=departures.filter(x=>x.status==='served');
 const inHour=(x)=>x>=c.scenario.measurementStartMs&&x<c.scenario.measurementEndMs;
 const gap=arrivals.slice(1).map((x,i)=>(x.thresholdMs-arrivals[i].thresholdMs)/1000);
 return {meta:{phase,entryPolicy,lvpStateSource:'METAR_PROXY',operationalLvpVerified:false,
   manifestSha256:digest(m),source:'SYNTHETIC_UNVALIDATED',version:VERSION},
  totals:{arrivalRequests:m.arrivals.length,departureRequests:m.departures.length,
   servedArrivals:arrivals.length,servedDepartures:served.length,
   censoredDepartures:departures.length-served.length,missedApproaches},
  metrics:{arrivalRatePerHour:arrivals.filter(x=>inHour(x.thresholdMs)).length,
   departureRatePerHour:served.filter(x=>inHour(x.airborneMs)).length,
   arrivalIntervalsSeconds:desc(gap),arrivalSpacingNM:desc(arrivals.slice(1).map(x=>x.deliveredSpacingNM)),
   planningShortfalls:shortfalls,departureHolds:holds.length,
   arrivalDelaySeconds:desc(arrivals.map(x=>x.delayMs/1000)),
   departureDelaySeconds:desc(served.map(x=>x.delayMs/1000)),
   totalMovementsInHour:arrivals.filter(x=>inHour(x.thresholdMs)).length+
    served.filter(x=>inHour(x.airborneMs)).length,
   capacityEligible:false},
  arrivals,departures,events,holds};
}
export function runReplication(c=CONFIG){
 validate(c);const cases=[];
 for(const arrivalOnly of [true,false])
  for(const phase of ['NORMAL','PREPARATION','NOTIFICATION'])
   for(const policy of [BASELINE,SENSITIVITY]){
    const rows=[];
    for(let i=0;i<c.scenario.seedCount;i++){
     const m=makeManifest(c,{seed:c.scenario.seedStart+i,arrivalOnly});
     const result=simulate(m,c,{phase,entryPolicy:policy});
     rows.push({seed:m.seed,manifestHash:digest(m),result});
    }
    const metrics=['arrivalRatePerHour','departureRatePerHour','totalMovementsInHour',
     'planningShortfalls','departureHolds'];
    cases.push({arrivalOnly,phase,entryPolicy:policy,n:rows.length,
     metrics:Object.fromEntries(metrics.map(k=>[k,desc(rows.map(r=>r.result.metrics[k]))])),
     arrivalIntervalMedianS:desc(rows.map(r=>r.result.metrics.arrivalIntervalsSeconds.median)),
     deliveredSpacingMedianNM:desc(rows.map(r=>r.result.metrics.arrivalSpacingNM.median)),
     allDemandReconciled:rows.every(r=>r.result.totals.arrivalRequests===r.result.totals.servedArrivals&&
      r.result.totals.departureRequests===r.result.totals.servedDepartures+r.result.totals.censoredDepartures),
     perSeed:rows.map(r=>({seed:r.seed,manifestHash:r.manifestHash,
      totals:r.result.totals,metrics:r.result.metrics}))});
   }
 const medium=feasibleMixedGap(c,{category:'MEDIUM'}),heavy=feasibleMixedGap(c,{category:'HEAVY'});
 return {schema:14,status:'MECHANICS_ONLY_UNVALIDATED_WITH_WINTER_DESCRIPTIVES',
  sourceComments:c.sources.comments,baseMainSha:c.baseMainSha,version:VERSION,
  observedWinter:c.observedWinter,observedValidation:'REFERENCE_ONLY_NO_HOLDOUT',
  baselineMixedFeasibility:{medium,heavy,
   observedShareBelowModelMin:c.observedWinter.lvpWithDeparture.belowBaselineMinimumShare,
   observedShareStatus:c.observedWinter.lvpWithDeparture.shareStatus,
   overall:'FAIL_MODEL_ASSUMPTION_CONFLICT'},
  conditionalSensitivity:{medium:feasibleMixedGap(c,{category:'MEDIUM',entryPolicy:SENSITIVITY}),
   heavy:feasibleMixedGap(c,{category:'HEAVY',entryPolicy:SENSITIVITY}),
   practice:'HYPOTHETICAL_NOT_ELLX_LVP_PRACTICE'},
  arrivalOnlyFogIntervalReferenceS:304,arrivalOnly10NmPlanningNM:10,
  cases,warnings:['METAR_PROXY not an LVP declaration',
   '10NM is planning SHOULD, not minimum separation',
   'Baseline departures enter only AFTER runway vacated',
   '266s observed mixed P10 is a feasibility conflict, NOT permission for conditional line-up',
   'Conditional line-up is hypothetical and not ELLX LVP practice',
   'No observed distribution of how many of 29 proxy pairs fall below model minimum',
   'RWY06 parameters only','CASA/ROT/taxi timings unvalidated','No winter holdout or actual LVP capacity claim']};
}
