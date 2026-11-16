// Stage B2b TMA sequencing interventions. HYPOTHETICAL, NOT operational ATC.
// A1.1 lock, A1.2 scheduler, and B1-P1 callback remain unchanged.
import {readFileSync} from 'node:fs';
import {requireS0Gate} from './calibration.mjs';
import {ASSUMPTIONS,makeTmaManifest,runS0,allocateTmaDelay,evaluateS0} from './tma.mjs';
import {simulate as schedule,DEFAULT_CONFIG as A12,CONDITIONAL,DISTANCE,TIME,
 minArrivalThresholdGapMs,A11_SPACING_PROVENANCE} from '../a12/model.mjs';
import {wakeFloorNM,assignEffectiveTargets} from '../a11/model.mjs';
import {spacingDecision,pairedBootstrap} from '../b1/model.mjs';
import {digest} from '../core.mjs';
export const HORIZONS=Object.freeze(['ENTRY','8MIN','5MIN']);
const S=1000,HR=3600000;
const must=(x,msg)=>{if(!x)throw Error(msg);};
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const q=(a,p)=>{if(!a.length)return null;const v=[...a].sort((x,y)=>x-y),i=(v.length-1)*p,k=Math.floor(i);return v[k]+(v[Math.min(k+1,v.length-1)]-v[k])*(i-k);};
const freezeAt=(f,h)=>h==='ENTRY'?f.tmaEntryMs:
 Math.max(f.tmaEntryMs,f.eldtMs-(h==='8MIN'?480:300)*S);
const horizonMinutes=h=>h==='ENTRY'?null:(h==='8MIN'?8:5);
export const POLICY_ASSUMPTIONS=Object.freeze({
 targetBufferS:25, // UNVALIDATED: scheduler target lead buffer, no published AMAN spec
 planningSpeedBudgetS:{ENTRY:45,'8MIN':30,'5MIN':15}, // UNVALIDATED speed contribution
 joinLeadImprovementNM:{ENTRY:1,'8MIN':.6,'5MIN':.2}, // UNVALIDATED B1 reach impact
 deliverySpreadMultiplier:{ENTRY:.5,'8MIN':.7,'5MIN':.9}, // UNVALIDATED
 requiredSwapAdvantageS:20,minimumSwapExecutionS:120, // UNVALIDATED operational feasibility
 maxSwapDisplacement:1,freezeRule:'NON_RETROACTIVE_TMA_ENTRY_CAPPED'
});
const metricWindow=(x,c)=>x.status==='served'&&x.timeMs>=c.measurementStartMs&&x.timeMs<c.measurementEndMs;
function swapPairs(m,h,assumptions){
 // One-adjacent-position displacement, no first-flight/priority alteration.
 // No unrestricted overtakes, no swap after either flight's freeze event.
 const a=[...m.arrivals],c={...A12,seed:m.seed,arrivalCount:a.length,
  arrivalRequestStepMs:Math.round(HR/(a.length/2))};
 const swaps=[];let i=1;
 while(i<a.length-1){
  const l=a[i],r=a[i+1],prev=a[i-1],next=a[i+2];
  if(l.runway!==r.runway){i++;continue;}
  const decision=Math.max(l.tmaEntryMs,r.tmaEntryMs);
  if(decision>Math.min(freezeAt(l,h),freezeAt(r,h))||
     Math.min(l.eldtMs,r.eldtMs)-decision<assumptions.minimumSwapExecutionS*S){
   i++;continue;
  }
  const cost=(x,y)=>minArrivalThresholdGapMs(x,y,c);
  const old=cost(prev,l)+cost(l,r)+(next?cost(r,next):0);
  const alternative=cost(prev,r)+cost(r,l)+(next?cost(l,next):0);
  if(old-alternative>=assumptions.requiredSwapAdvantageS*S){
   [a[i],a[i+1]]=[a[i+1],a[i]];
   swaps.push({left:l.id,right:r.id,advantageS:(old-alternative)/S,
    decisionMs:decision,source:'UNVALIDATED_TACTICAL_EXECUTABILITY'});
   i+=2;
  }else i++;
 }
 return {arrivals:a,swaps};
}
export function planTma(m,{policy='S1',horizon='ENTRY',assumptions=POLICY_ASSUMPTIONS}={}){
 must(['S1','S2'].includes(policy),'S1 or S2 only');
 must(HORIZONS.includes(horizon),'out-of-scope horizon');
 let {arrivals,swaps}=policy==='S2'?swapPairs(m,horizon,assumptions):
  {arrivals:[...m.arrivals],swaps:[]};
 if(swaps.length){
  // The A1.1 target depends on leader/follower type. Reapply the LOCKED
  // distribution to the changed order using the SAME flight quantiles and
  // normal draws; parameters, distributions and draws remain unchanged.
  const params=JSON.parse(readFileSync(new URL('../a11/calibration-lock.json',import.meta.url),'utf8')).parameters;
  const paired=assignEffectiveTargets({schema:11,synthetic:true,flights:[arrivals]},params).flights[0];
  const core=assignEffectiveTargets({schema:11,synthetic:true,
   flights:[arrivals.map(a=>({...a,componentQuantile:1}))]},params).flights[0];
  arrivals=paired.map((a,i)=>({...a,coreTargetM:core[i].effectiveTargetM,
   coreTargetSource:'A11_LOCKED_CORE_SAME_NORMAL',
   arrivalSpacingSource:A11_SPACING_PROVENANCE.distribution}));
 }
 const c={...A12,seed:m.seed,arrivalCount:arrivals.length,
  arrivalRequestStepMs:Math.round(HR/(arrivals.length/2))};
 let prior=null;
 const planned=arrivals.map((f,i)=>{
  const freezeMs=freezeAt(f,horizon);
  const prevVisible=!prior||prior.freezeMs<=freezeMs;
  const required=prior?minArrivalThresholdGapMs(prior,f,c)+
    assumptions.targetBufferS*S:0;
  const targetMs=Math.round(Math.max(f.eldtMs,
    prior&&prevVisible?prior.plannedTargetMs+required:f.eldtMs));
  // Monotone A1.2 demand stream, but no request earlier than own ELDT.
  const requestMs=Math.round(Math.max(targetMs,prior?.requestMs??0));
  const p={...f,requestMs,plannedTargetMs:targetMs,freezeMs,
   freezeVisibilityConflict:!prevVisible,
   plannedSpeedBudgetS:assumptions.planningSpeedBudgetS[horizon],
   horizonAvailableS:Math.max(0,(f.eldtMs-freezeMs)/S),
   planningHorizon:horizon,
   joinDistanceNM:i===0?null:Math.min(15,(f.joinDistanceNM??0)+
     assumptions.joinLeadImprovementNM[horizon]),
   deliverySpreadQuantile:i===0?null:(f.deliverySpreadQuantile??0)*
     assumptions.deliverySpreadMultiplier[horizon]};
  prior=p;return p;
 });
 const opportunities=[...m.opportunities];
 if(swaps.length){
  // Departure request times, categories and IDs remain immutable; only
  // adjacent pair attachments follow the new rank. Never reorder departure FIFO.
  const baseIdx=new Map(m.arrivals.map((a,i)=>[a.id,i]));
  const original=opportunities.map(d=>({d,index:baseIdx.get(d.followerId)}));
  for(const {d,index} of original){
   must(index>0,'departure predecessor');
   const j=opportunities.findIndex(x=>x.id===d.id);
   opportunities[j]={...d,betweenLeaderId:planned[index-1].id,
    followerId:planned[index].id};
  }
 }
 return {manifest:{...m,arrivals:planned,opportunities,
  b2Intervention:policy,b2Horizon:horizon},swaps,assumptions,
  freezeConflicts:planned.filter(x=>x.freezeVisibilityConflict).length};
}
function report(run,original,metadata,assumptions){
 const c={...A12,seed:original.seed,arrivalCount:original.arrivals.length,
  arrivalRequestStepMs:Math.round(HR/(original.arrivals.length/2))};
 const served=run.arrivals.filter(a=>a.status==='served');
 const allocation=served.map(a=>{
  const delayS=Math.max(0,(a.timeMs-a.eldtMs)/S);
  const speedFirstS=metadata.policy==='S0'?0:
   Math.min(assumptions.planningSpeedBudgetS[metadata.horizon],
    Math.max(0,a.horizonAvailableS)*.15);
  return {id:a.id,delayS,...allocateTmaDelay(a,delayS,original.b2PolicySettings??ASSUMPTIONS,{speedFirstS})};
 });
 const intervalErrors=served.map(a=>Math.abs(a.timeMs-
  (a.plannedTargetMs??a.eldtMs))/S);
 let hardViolations=0;
 for(let i=1;i<served.length;i++)if(served[i].timeMs+1<
  served[i-1].timeMs+minArrivalThresholdGapMs(served[i-1],served[i],c))hardViolations++;
 must(hardViolations===0,'A1.2 hard minimum violation');
 return {policy:metadata.policy,horizon:metadata.horizon??null,
  withB1:metadata.withB1,gapPolicy:metadata.gapPolicy,
  metrics:{arrivalRate:served.filter(a=>metricWindow(a,c)).length,
   departureRate:run.departures.filter(a=>metricWindow(a,c)).length,
   servedArrivalsByDrain:served.length,
   servedDeparturesByDrain:run.departures.filter(a=>a.status==='served').length,
   censoredArrivals:run.arrivals.filter(a=>a.status==='censored').length,
   censoredDepartures:run.departures.filter(a=>a.status==='censored').length,
   tmaExcessMeanS:avg(allocation.map(x=>x.delayS)),
   tmaExcessP90S:q(allocation.map(x=>x.delayS),.9),
   tmaExcessMedianS:q(allocation.map(x=>x.delayS),.5),
   speedMeanS:avg(allocation.map(x=>x.speedS)),
   pathStretchMeanS:avg(allocation.map(x=>x.stretchS)),
   holdingMeanS:avg(allocation.map(x=>x.holdS)),
   pathStretchMeanNM:avg(allocation.map(x=>x.stretchNM)),
   joinReachableShare:served.length>1?served.slice(1)
    .filter(x=>(x.joinDistanceNM??0)>=ASSUMPTIONS.b1LeadNM).length/(served.length-1):null,
   deliveryErrorP90S:q(intervalErrors,.9),
   deliveryErrorMeanS:avg(intervalErrors),
   b1ActedPairs:served.filter(x=>x.b1ToolDecision).length,
   resequenceSwaps:metadata.swaps??0,
   freezeConflicts:metadata.freezeConflicts??0,
   hardMinimumViolations:hardViolations,
   requestsTotal:original.arrivals.length+original.opportunities.length,
   processedTotal:run.arrivals.length+run.departures.length},
  manifestDigest:digest(original),runway:original.arrivals[0].runway};
}
export function runB2(m,{policy='S0',horizon=null,withB1=false,
 gapPolicy=DISTANCE,gate,settings=ASSUMPTIONS,
 assumptions=POLICY_ASSUMPTIONS}={}){
 requireS0Gate(gate);must([DISTANCE,TIME].includes(gapPolicy),'gap policy');
 must(m.b2Settings===digest(settings),'immutable paired manifest settings');
 let input=m,metadata={policy,horizon,withB1,gapPolicy,swaps:0,freezeConflicts:0};
 if(policy!=='S0'){
  const planned=planTma(m,{policy,horizon,assumptions});
  input=planned.manifest;metadata.swaps=planned.swaps.length;
  metadata.freezeConflicts=planned.freezeConflicts;
 }else must(horizon===null,'S0 has no planning horizon');
 const c={...A12,seed:m.seed,arrivalCount:m.arrivals.length,
  arrivalRequestStepMs:Math.round(HR/(m.arrivals.length/2))};
 const callback=withB1?args=>spacingDecision(args,{policy:'P1',
  r:settings.b1Reduction,spreadNM:settings.b1ResidualSpreadNM,
  J:settings.b1LeadNM}):null;
 const run=schedule(input,c,{sequence:CONDITIONAL,policy:gapPolicy,spacingTool:callback});
 const r=report(run,m,metadata,assumptions);
 must(r.metrics.requestsTotal===r.metrics.processedTotal,'request loss');
 return r;
}
const keys=['arrivalRate','departureRate','servedArrivalsByDrain',
 'servedDeparturesByDrain','tmaExcessMeanS','tmaExcessP90S',
 'holdingMeanS','pathStretchMeanNM','deliveryErrorP90S','joinReachableShare',
 'b1ActedPairs','resequenceSwaps','freezeConflicts'];
export function runB2Sweep({seeds=50,rates=[20,22,24,30],
 settings=ASSUMPTIONS,assumptions=POLICY_ASSUMPTIONS}={}){
 must(seeds>=50,'at least 50 paired replications');
 const calibration=evaluateS0({seeds:50,settings});
 requireS0Gate(calibration.gate); // HARD STOP: no S1/S2 output on failure
 const results=[];
 for(const rate of rates)for(const gapPolicy of [DISTANCE,TIME]){
  const manifests=Array.from({length:seeds},(_,i)=>makeTmaManifest(rate,20261116+i,settings));
  const runs=new Map();
  for(const policy of ['S0','S1','S2'])
   for(const horizon of (policy==='S0'?[null]:HORIZONS))
    for(const withB1 of [false,true]){
     const key=policy+'_'+(horizon??'NONE')+'_'+withB1;
     runs.set(key,manifests.map(m=>runB2(m,{policy,horizon,withB1,
      gapPolicy,gate:calibration.gate,settings,assumptions})));
    }
  const baseline=runs.get('S0_NONE_false');
  const b1=runs.get('S0_NONE_true');
  for(const [key,rows] of runs){
   const [policy,h,flag]=key.split('_'),withB1=flag==='true',horizon=h==='NONE'?null:h;
   const mean=Object.fromEntries(keys.map(k=>[k,avg(rows.map(r=>r.metrics[k]).filter(Number.isFinite))]));
   const paired=Object.fromEntries(keys.map((k,mi)=>[k,pairedBootstrap(
    rows.map((r,i)=>r.metrics[k]-baseline[i].metrics[k]).filter(Number.isFinite),
    20261117+rate*100+mi+(horizon?HORIZONS.indexOf(horizon)*1000:0),1000)]));
   const interaction=withB1&&policy!=='S0'?pairedBootstrap(
    rows.map((r,i)=>{
     const noTool=runs.get(policy+'_'+h+'_false')[i];
     return (r.metrics.arrivalRate-noTool.metrics.arrivalRate)-
      (b1[i].metrics.arrivalRate-baseline[i].metrics.arrivalRate);
    }),20261212+rate,1000):null;
   const standAloneB1=pairedBootstrap(b1.map((r,i)=>r.metrics.arrivalRate-
    baseline[i].metrics.arrivalRate),20261213+rate,1000);
   const denominatorPositive=standAloneB1.interval95[0]>0;
   const contingentShare=withB1&&policy==='S1'&&denominatorPositive?
    ((mean.arrivalRate-runs.get(policy+'_'+h+'_false').map(r=>r.metrics.arrivalRate)
      .reduce((a,b)=>a+b,0)/seeds-standAloneB1.mean)/standAloneB1.mean):null;
   results.push({rate,gapPolicy,policy,horizon,withB1,n:seeds,
    pairedManifestHashes:manifests.map(digest),mean,pairedMinusS0:paired,
    interactionB1:interaction,incrementalInteractionOverStandaloneB1:contingentShare,
    contingentShareDenominator:denominatorPositive?standAloneB1:'N/A_ZERO_OR_UNCERTAIN_B1',
    source:'HYPOTHETICAL_TMA_ONLY_NOT_OPERATIONAL_CAPACITY'});
  }
 }
 return {version:'B2b-TMA-S1-S2-CANDIDATE-1',gate:calibration.gate,
  inputHash:digest(settings),assumptionHash:digest(assumptions),
  horizons:HORIZONS,reference:'ACTUAL_TMA_ENTRY_PER_CLAUDE_6922589286',
  pairedSeeds:seeds,results,
  warnings:['IN_SAMPLE_CALIBRATION_NOT_INDEPENDENT_VALIDATION',
   'S1_JOIN_LEAD_SPEED_AND_PRECISION_UNVALIDATED','S2_OVERTAKE_FEASIBILITY_UNVALIDATED',
   'RUNWAY_DIRECTION_SINGLE_PER_SYNTHETIC_SESSION','P1_ONLY_NO_P2_TBS',
   'NO_ACTUAL_ELLX_CAPACITY_OR_AMAN_PERFORMANCE_CLAIM',
   'INTERACTION_RATIO_RELATIVE_TO_STANDALONE_B1_NOT_FRACTION_OF_TOTAL_GAIN']};
}
