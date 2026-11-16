// B2b synthetic TMA 40NM entry -> ELDT -> unchanged A1.2 threshold scheduler.
// Observed B2a aggregate priors; all per-flight samples SYNTHETIC, NOT operational.
import {B2A,calibrateS0,requireS0Gate} from './calibration.mjs';
import {makeManifest as makeA12,simulate as runA12,DEFAULT_CONFIG as A12,
 CONDITIONAL,DISTANCE,TIME,minArrivalThresholdGapMs} from '../a12/model.mjs';
import {joinDistanceNM,spacingDecision} from '../b1/model.mjs';
import {digest} from '../core.mjs';
const H=3600000, NM=1852;
const assert=(v,m)=>{if(!v)throw Error(m);};
const rng=s=>{let x=s>>>0||1;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};};
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const quant=(a,p)=>{if(!a.length)return null;const v=[...a].sort((x,y)=>x-y),t=(v.length-1)*p,i=Math.floor(t);return v[i]+(v[Math.min(i+1,v.length-1)]-v[i])*(t-i);};
export const ASSUMPTIONS=Object.freeze({
  nonDelayJitterS:12, // UNVALIDATED: observational P10 not zero-delay time
  missingFixP10S:720, // UNVALIDATED placeholder for absent 06/fix strata
  missingTmaFixP10S:350, // UNVALIDATED placeholder for absent boundary/fix strata
  pathStretchEquivalentSpeedKt:150, // UNVALIDATED, not actual aircraft speed
  entryRingJitterS:180, // UNVALIDATED; calibrated synthetic bunching
  entryRingJitterByRateS:{20:0}, // UNVALIDATED fitted high-demand input regularity
  entryRingStepMultiplierByRate:{20:1.01}, // UNVALIDATED high-demand +1% smoothing
  clusterFactorByRate:{6:.15,11:.1,14:.1,19:.15,20:1}, // UNVALIDATED: S0 fit to B2a bins
  tacticalSwapRate:0, // UNVALIDATED only when geometry fails
  b1Policy:'P1',b1Reduction:.75,b1ResidualSpreadNM:.3,b1LeadNM:8,
  s1TargetBufferS:0,s2MaxPositionDisplacement:1,
  status:'SYNTHETIC_UNVALIDATED_FOR_ATC'
});
const fixEntries=Object.entries(B2A.entryMix),totalFix=fixEntries.reduce((s,[,v])=>s+v,0);
const selected=(r,values)=>{const x=r()*values.reduce((s,[,w])=>s+w,0);let total=0;for(const [v,w] of values){total+=w;if(x<total)return v;}return values.at(-1)[0];};
const transitionWeights={
 '24':[['EXCOS',538],['PONIG',393],['BETEX',311],['DIK',251],['IRTON',64],['VAVOT',36]],
 '06':[['IRTON',76],['BREDI',69]]
};
const p10=(fix,runway,settings)=>{
 const row=runway==='24'?B2A.fixRunway24[fix]:null;
 return {seconds:row?.p10??settings.missingFixP10S,
  provenance:row?'B2A_OBSERVED_FIX_RUNWAY_P10':'UNVALIDATED_MISSING_FIX_RUNWAY_REFERENCE'};
};
const env=(runway,ifFix)=>B2A.transitions.find(x=>x.runway===runway&&x.fix===ifFix);
const b2Config=(rate,seed)=>({...A12,seed,arrivalCount:rate*2,arrivalRequestStepMs:Math.round(H/rate)});
export function makeTmaManifest(rate,seed,settings=ASSUMPTIONS){
 assert(Number.isInteger(rate)&&rate>=2&&rate<=30,'synthetic demand rate');
 assert(settings.tacticalSwapRate>=0&&settings.tacticalSwapRate<=.2,'swap fraction');
 const c=b2Config(rate,seed),raw=makeA12(c,'OBSERVED_LIKE_3_PER_H_2_HEAVY');
 const next=rng((seed^0xB2A2026)>>>0),step=H/rate*(settings.entryRingStepMultiplierByRate?.[rate]??1);
 // Single runway direction per synthetic two-hour session; 80/20 is cross-session mix.
 const scenarioRunway=((seed-20261116)%5+5)%5===0?'06':'24'; // 20% RWY06, stratified paired seeds
 const entries=Array.from({length:rate*2},(_,i)=>{
  const fix=selected(next,fixEntries),runway=scenarioRunway;
  const vectored=next()>=B2A.transitionUse.share;
  const ifFix=vectored?null:selected(next,transitionWeights[runway]);
  const ref=p10(fix,runway,settings);
  const factor=settings.clusterFactorByRate?.[rate]??1;
  assert(factor>0&&factor<=1,'cluster factor bounds');
  const syntheticArrivalStep=(Math.floor(i/3)*3+(i%3)*factor)*step;
  const jitterS=settings.entryRingJitterByRateS?.[rate]??settings.entryRingJitterS;
  const ringMs=Math.round(-900000+syntheticArrivalStep+
    (next()-.5)*2*jitterS*1000);
  const jitterMs=Math.round(next()*settings.nonDelayJitterS*1000);
  const eldtMs=ringMs+ref.seconds*1000+jitterMs;
  const tma=B2A.actualTmaEntry.byFix24[runway==='24'?fix:'']??null;
  const tmaP10S=tma?.p10??settings.missingTmaFixP10S;
  const tmaEntryMs=ringMs+Math.max(0,ref.seconds-tmaP10S)*1000;
  return {entryIndex:i,fix,runway,vectored,ifFix,ringMs,eldtMs,tmaEntryMs,tmaP10S,
   tmaEntrySource:tma?'B2A_TMA_POLYGON_FIX_P10':'UNVALIDATED_TMA_ENTRY_FIX_PROXY',
   unimpededS:ref.seconds,unimpededSource:ref.provenance,
   geometry:env(runway,ifFix),joinU:next(),spreadU:next()};
 });
 // Align simulation origin after all ring draws; 40NM crossings can precede t=0.
 const minEldt=Math.min(...entries.map(e=>e.eldtMs));
 if(minEldt<0)for(const e of entries){e.ringMs-=minEldt;e.eldtMs-=minEldt;e.tmaEntryMs-=minEldt;}
 // Important: type/wake/locked core fields belong to the preassigned A1.2
 // rank stream. Entry metadata are attached in ELDT order, BEFORE scheduling.
 entries.sort((a,b)=>a.eldtMs-b.eldtMs||a.entryIndex-b.entryIndex);
 const arrivals=raw.arrivals.map((a,i)=>{
  const e=entries[i];
  return {...a,requestMs:e.eldtMs,entryIndex:e.entryIndex,entryFix:e.fix,
   runway:e.runway,ringMs:e.ringMs,eldtMs:e.eldtMs,vectored:e.vectored,
   entryFlowLabel:e.fix==='CLKEX'?'RITAX (Brussels sector)':e.fix,
   tmaEntryMs:e.tmaEntryMs,tmaP10S:e.tmaP10S,tmaEntrySource:e.tmaEntrySource,
   transitionIF:e.ifFix,publishedTransitionNM:e.geometry?.publishedNM??null,
   ratioP90:e.geometry?.ratio?.[2]??null,
   unimpededS:e.unimpededS,unimpededSource:e.unimpededSource,
   joinDistanceNM:i?joinDistanceNM(e.joinU):null,
   deliverySpreadQuantile:i?e.spreadU:null};
 });
 // A1.2 request validation and adjacency remain unchanged; each departure
 // remains coupled to its original adjacent pair in this ELDT-ranked stream.
 const byId=new Map(arrivals.map(a=>[a.id,a]));
 const opportunities=raw.opportunities.map(d=>({...d,
  requestMs:byId.get(d.betweenLeaderId).requestMs+c.departureDemandDelayMs}));
 return {...raw,arrivals,opportunities,
  b2Provenance:'TMA_RING_PROXY_SEPT2026_AGGREGATE_SYNTHETIC',
  b2Settings:digest(settings),entryMixReference:B2A.source};
}
export function allocateTmaDelay(f,delayS,settings=ASSUMPTIONS,{speedFirstS=0}={}){
 assert(delayS>=-1e-6,'negative TMA delay');
 const speedS=Math.min(Math.max(0,speedFirstS),Math.max(0,delayS));
 const remaining=Math.max(0,delayS-speedS);
 const availableNM=f.vectored?null:Math.max(0,(f.ratioP90??1)-1)*(f.publishedTransitionNM??0);
 const maxStretchS=f.vectored?Infinity:availableNM/settings.pathStretchEquivalentSpeedKt*3600;
 const stretchS=Math.min(remaining,maxStretchS),holdS=Math.max(0,remaining-stretchS);
 return {speedS,stretchS,holdS,stretchNM:stretchS*settings.pathStretchEquivalentSpeedKt/3600,
  maxStretchNM:availableNM,stretchEnvelopeSource:f.vectored?
   'VECTORED_NO_PUBLISHED_TRANSITION_CAP_UNVALIDATED':
   f.ratioP90?'OBSERVED_B2A_TRANSITION_RATIO_P90_UNVALIDATED_SPEED':'NO_TRANSITION_ENVELOPE',
  residualCounted:true};
}
function inversionRate(arrivals){
 const rows=arrivals.filter(x=>x.status==='served');
 let n=0,inv=0;for(let i=1;i<rows.length;i++){
  n++;if(rows[i].ringMs<rows[i-1].ringMs)inv++;
 }
 return {rate:n?inv/n:null,inversions:inv,pairs:n};
}
export function runS0(m,{gapPolicy=DISTANCE,settings=ASSUMPTIONS,spacingTool=false}={}){
 assert(m.b2Settings===digest(settings),'paired immutable TMA settings mismatch');
 const rate=m.arrivals.length/2,c=b2Config(rate,m.seed);
 const callback=spacingTool?x=>spacingDecision(x,{policy:'P1',
  r:settings.b1Reduction,spreadNM:settings.b1ResidualSpreadNM,J:settings.b1LeadNM}):null;
 const output=runA12(m,c,{sequence:CONDITIONAL,policy:gapPolicy,spacingTool:callback});
 const allocation=output.arrivals.filter(x=>x.status==='served').map(f=>({
  id:f.id,delayS:Math.max(0,(f.timeMs-f.eldtMs)/1000),
  ...allocateTmaDelay(f,Math.max(0,(f.timeMs-f.eldtMs)/1000),settings)}));
 const inversions=inversionRate(output.arrivals);
 const served=output.arrivals.filter(x=>x.status==='served');
 const inWindow=x=>x.timeMs>=c.measurementStartMs&&x.timeMs<c.measurementEndMs;
 return {policy:'S0',runwayScheduler:'UNCHANGED_A12',gapPolicy,output,
  allocation,inversions,
  metrics:{excessMedianS:quant(allocation.map(x=>x.delayS),.5),
   excessMeanS:avg(allocation.map(x=>x.delayS)),
   excessP90S:quant(allocation.map(x=>x.delayS),.9),
   overtakes40:inversions.rate,
   arrivalRate:served.filter(inWindow).length,
   departureRate:output.departures.filter(x=>x.status==='served'&&inWindow(x)).length,
   servedArrivalsByDrain:served.length,
   servedDeparturesByDrain:output.departures.filter(x=>x.status==='served').length,
   censoredArrivals:output.arrivals.filter(x=>x.status==='censored').length,
   censoredDepartures:output.departures.filter(x=>x.status==='censored').length,
   stretchMeanS:avg(allocation.map(x=>x.stretchS)),
   holdingMeanS:avg(allocation.map(x=>x.holdS)),
   pathStretchMeanNM:avg(allocation.map(x=>x.stretchNM)),
   actedB1:served.filter(x=>x.b1ToolDecision).length,
   manifestHash:digest(m)}};
}
export function evaluateS0({seeds=50,settings=ASSUMPTIONS}={}){
 assert(seeds>=50,'S0 calibration must use >=50 seeds');
 const demand=[['<=7',6],['8-11',11],['12-15',14],['16-19',19],['20+',20]];
 const diagnostics={},all=[];
 for(const [band,rate] of demand){
  const sample=[];
  for(let i=0;i<seeds;i++){
   const m=makeTmaManifest(rate,20261116+i,settings);
   const s=runS0(m,{settings});
   sample.push(...s.allocation.map(a=>a.delayS));
   all.push(...s.output.arrivals.map(a=>({group:band+':'+i,id:a.id,
    ringMs:a.ringMs,timeMs:a.timeMs,status:a.status})));
  }
  diagnostics[band]={median:quant(sample,.5),p90:quant(sample,.9),
   mean:avg(sample),n:sample.length};
 }
 const ordered=all.filter(x=>x.status==='served');
 // Each seed is a separate stream: do not count cross-seed boundary pairs.
 const pairMap=new Map();
 let reversals=0,pairs=0;
 for(const f of ordered){
  const key=f.group,prev=pairMap.get(key);
  if(prev){pairs++;if(f.ringMs<prev.ringMs)reversals++;}
  pairMap.set(key,f);
 }
 const mix={};for(const [fix] of fixEntries)mix[fix]=0;
 let n=0,n24=0,nTr=0;
 for(const [band,rate] of demand)for(let i=0;i<seeds;i++){
  const m=makeTmaManifest(rate,20261116+i,settings);
  for(const a of m.arrivals){mix[a.entryFix]++;n++;if(a.runway==='24')n24++;if(!a.vectored)nTr++;}
 }
 for(const fix of Object.keys(mix))mix[fix]/=n;
 const data={excess40:diagnostics,overtakeShare40:reversals/pairs,
  transitionUseShare:nTr/n,runway24Share:n24/n,entryMix:mix};
 return {data,gate:calibrateS0(data),counts:{pairs,reversals,arrivals:n},
  configHash:digest(settings),notes:'OBSERVED_AGGREGATE_CALIBRATED_NOT_INDEPENDENT_VALIDATION'};
}
