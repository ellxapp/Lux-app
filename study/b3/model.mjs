// B3: leader-type CASA spacing under hypothetical RWY24 CAT II/III LVP.
// No operational ATC guidance, P-ATC-LVP amendments or verified ROT claims.
import {readFileSync} from 'node:fs';
import {digest} from '../core.mjs';
import {CONFIG as A14,BASELINE as POST_VACATE,makeManifest as a14Manifest,
 simulate as a14Simulate,secondsFromNM,feasibleMixedGap,holdingDecision,
 heavyCriticalDecision} from '../a14/model.mjs';
import {APPROVED_TYPE_WEIGHTS,selectType,wakeFloorNM,profileFor} from '../a11/model.mjs';
export const CONFIG=Object.freeze(JSON.parse(readFileSync(new URL('./B3_HYPOTHETICAL.json',import.meta.url),'utf8')));
export const VERSION='B3-LVP-LEADER-SPACING-CANDIDATE-1';
const H=3600000;
const check=(yes,why)=>{if(!yes)throw Error(why);};
const rand=seed=>{let x=seed>>>0||1;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};};
const quant=(a,p)=>{const s=a.filter(Number.isFinite).sort((x,y)=>x-y);if(!s.length)return null;const k=(s.length-1)*p,i=Math.floor(k);return s[i]+(s[Math.min(i+1,s.length-1)]-s[i])*(k-i);};
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
export function validate(c=CONFIG){
 check(c.schema===3&&c.status==='NON_OPERATIONAL_HYPOTHETICAL_RWY24_CAT_II_III_LVP','non-operational');
 check(c.baseMain==='c11ca1c'&&c.runway==='24'&&c.phase==='NOTIFICATION','base/runway/phase');
 check(JSON.stringify(c.demandArrivalPerHour)==='[10,12,14,16]'&&
  c.saturatedProbeArrivalPerHour===20,'winter demand and probe');
 check(JSON.stringify(c.departurePerHour)==='[0,2]','departure demand');
 check(c.seeds>=50&&c.bootstrapResamples>=1000&&
  JSON.stringify(c.l2TargetGoAroundRates)==='[0.01,0.005,0.001]','analytic L2 target grid');
 check(JSON.stringify(c.tClearScale)==='[0.75,1,1.25]'&&
  c.tClearUniformDeviationFraction===.25,'declared Tclear sensitivity');
 check(JSON.stringify(c.allowedExitByLeader)==='{"TP":["D2","E"],"MEDIUM_JET":["D2","E"],"HEAVY":["E","G","END"]}',
  'Philip corrected exit choices');
 check(c.casaStripHalfWidthM===140&&c.hardSurveillanceNM===3,'geometry/hard surveillance');
 check(c.measurementEndMs-c.measurementStartMs===H&&c.drainEndMs>2*H,'measurement and drain');
 return c;
}
export const leaderClass=t=>['DH8D','PC12','AT72','AT75','AT76'].includes(t)?'TP':
 ['B744','B748','B77L'].includes(t)?'HEAVY':'MEDIUM_JET';
export function exitChoices(cls,mix='EQUAL_SPLIT',c=CONFIG){
 check(c.exitMixScenarios.includes(mix),'unknown exit mix');
 const allowed=c.allowedExitByLeader[cls];check(allowed,'unknown leader class');
 if(cls==='HEAVY'){
  if(mix==='HEAVY_ALL_E')return ['E'];
  if(mix==='HEAVY_ALL_END')return ['END'];
 }else{
  if(mix==='TP_MEDIUM_ALL_D2')return ['D2'];
  if(mix==='TP_MEDIUM_ALL_E')return ['E'];
 }
 return allowed;
}
export function chooseExit(cls,u,mix='EQUAL_SPLIT',c=CONFIG){
 check(u>=0&&u<1,'immutable exit draw');
 const a=exitChoices(cls,mix,c);return a[Math.floor(u*a.length)];
}
export function clearanceRange(exit,scale=1,c=CONFIG){
 check(c.tClearScale.includes(scale)&&c.exits[exit],'clearance sensitivity');
 const m=c.exits[exit].centralCasaTailClearSeconds*scale;
 return [m*(1-c.tClearUniformDeviationFraction),m*(1+c.tClearUniformDeviationFraction)];
}
export function clearanceTime(exit,u,scale=1,c=CONFIG){
 check(u>=0&&u<1,'immutable clearance draw');
 const [lo,hi]=clearanceRange(exit,scale,c);return lo+(hi-lo)*u;
}
export function clearanceCdf(cls,t,scale=1,mix='EQUAL_SPLIT',c=CONFIG){
 const choices=exitChoices(cls,mix,c);
 return choices.reduce((sum,exit)=>{const [lo,hi]=clearanceRange(exit,scale,c);
  return sum+Math.min(1,Math.max(0,(t-lo)/(hi-lo)))/choices.length;
 },0);
}
// Analytic inversion of a finite uniform-mixture CDF. No simulation fitting.
export function clearanceQuantile(cls,p,scale=1,mix='EQUAL_SPLIT',c=CONFIG){
 check(p>=0&&p<=1,'quantile');
 const ranges=exitChoices(cls,mix,c).map(e=>clearanceRange(e,scale,c));
 let lo=Math.min(...ranges.map(x=>x[0])),hi=Math.max(...ranges.map(x=>x[1]));
 if(p===0)return lo;if(p===1)return hi;
 for(let k=0;k<65;k++){const mid=(lo+hi)/2;
  if(clearanceCdf(cls,mid,scale,mix,c)<p)lo=mid;else hi=mid;
 }
 return (lo+hi)/2;
}
export function clearanceClassMean(cls,scale=1,mix='EQUAL_SPLIT',c=CONFIG){
 return mean(exitChoices(cls,mix,c).map(exit=>mean(clearanceRange(exit,scale,c))));
}
const leaderTableCache=new Map();
export function table({policy='L1',target=null,scale=1,mix='EQUAL_SPLIT'}={}){
 validate();check(['L1','L2'].includes(policy),'table policy');
 const key=JSON.stringify([policy,target,scale,mix]);
 if(leaderTableCache.has(key))return leaderTableCache.get(key);
 if(policy==='L2')check(CONFIG.l2TargetGoAroundRates.includes(target),'unapproved target');
 const result={};
 for(const cls of ['TP','MEDIUM_JET','HEAVY']){
  const center=clearanceClassMean(cls,scale,mix);
  const margin=policy==='L1'?CONFIG.l1FixedMarginSeconds:0;
  const quantileTarget=policy==='L2'?1-target:null;
  const sized=policy==='L2'?clearanceQuantile(cls,quantileTarget,scale,mix):center+margin;
  result[cls]={leaderClass:cls,exitChoices:exitChoices(cls,mix),
   clearMeanS:center,clearanceTargetS:sized,marginAboveMeanS:sized-center,
   sizing:policy==='L2'?'ANALYTIC_MIXTURE_CDF_QUANTILE':'MEAN_PLUS_DECLARED_FIXED_MARGIN',
   targetCasaGoAroundRate:policy==='L2'?target:null,quantile:quantileTarget,
   clearanceStatus:'UNVALIDATED_UNIFORM_MIXTURE_NOT_FRACS'};
 }
 leaderTableCache.set(key,result);
 return result;
}
// Profile: 160 kt outside 4 NM, then A1.1 type-specific 4–0 NM speed.
// Invert duration consistently rather than adding a geometric 2 NM twice.
export function followerTimeMs(distanceNM,type){
 check(distanceNM>=0,'follower distance');
 const profile=profileFor(type,0),low=profile.segments.at(-1).iasKt;
 return Math.round(1000*3600*(Math.min(distanceNM,4)/low+
  Math.max(0,distanceNM-4)/CONFIG.syntheticFinalAbove4NmKt));
}
export function followerDistanceNM(timeMs,type){
 check(timeMs>=0,'follower time');
 const low=profileFor(type,0).segments.at(-1).iasKt;
 const first=4*3600000/low;
 return timeMs<=first?timeMs*low/3600000:4+(timeMs-first)*CONFIG.syntheticFinalAbove4NmKt/3600000;
}
export function requiredIntervalMs(leader,follower,{policy='L0',target=null,
 scale=1,mix='EQUAL_SPLIT'}={}){
 check(['L0','L1','L2'].includes(policy),'spacing policy');
 if(policy==='L0')return Math.round(secondsFromNM(10,A14)*1000);
 const row=table({policy,target,scale,mix})[leader.leaderClass];
 const physicalClearToTwoNmMs=Math.round(1000*row.clearanceTargetS)+followerTimeMs(2,follower.type);
 const hardNM=Math.max(CONFIG.hardSurveillanceNM,wakeFloorNM(leader.wake,follower.wake));
 const hardMs=followerTimeMs(hardNM,follower.type);
 return Math.max(physicalClearToTwoNmMs,hardMs,CONFIG.syntheticRunwayVacateMs);
}
export function a14Config(depPerHour=0){
 check(CONFIG.departurePerHour.includes(depPerHour),'departures');
 return {...A14,scenario:{...A14.scenario,demandDeparturePerHour:depPerHour,
  measurementStartMs:CONFIG.measurementStartMs,measurementEndMs:CONFIG.measurementEndMs,
  drainEndMs:CONFIG.drainEndMs}};
}
export function manifest({seed=CONFIG.seedStart,rate=12,depPerHour=0}={}){
 validate();check([...CONFIG.demandArrivalPerHour,CONFIG.saturatedProbeArrivalPerHour].includes(rate),'rate');
 check(CONFIG.departurePerHour.includes(depPerHour),'departure demand');
 const base=a14Manifest(a14Config(depPerHour),{seed,arrivalOnly:depPerHour===0,arrivalDemandPerHour:rate});
 const next=rand((seed^0xB30024)>>>0);
 return {...base,synthetic:true,runway:'24',b3Version:VERSION,
  arrivals:base.arrivals.map(a=>{const t=selectType(next());return {...a,type:t.type,wake:t.wake,
   leaderClass:leaderClass(t.type),exitQuantile:next(),clearanceQuantile:next(),
   heavyCriticalAreaOccupied:false,criticalHeavyInboundNM:20};}),
  source:'SYNTHETIC_IMMUTABLE_WITH_UNVALIDATED_EXIT_AND_CLEARANCE_DRAWS',
  a14ModelVersion:'A1.4-D1-floor-bound-saturation-candidate-2'};
}
function getExit(a,mix,scale){
 const exit=chooseExit(a.leaderClass,a.exitQuantile,mix);
 return {exit,clearanceS:clearanceTime(exit,a.clearanceQuantile,scale)};
}
export function casaAtTwoNM(leader,followerThresholdMs,followerType,leaderClearMs){
 const gateMs=followerThresholdMs-followerTimeMs(2,followerType);
 return {event:'ARR_FOLLOWER_2NM',followerAtTwoNmMs:gateMs,leaderCasaTailClearMs:leaderClearMs,
  occupied:gateMs<leaderClearMs,clearMarginMs:gateMs-leaderClearMs};
}
export function simulate(m,{policy='L0',target=null,scale=1,mix='EQUAL_SPLIT'}={}){
 validate();check(m?.b3Version===VERSION&&m.runway==='24'&&m.synthetic,'B3 manifest');
 check(['L0','L1','L2'].includes(policy)&&CONFIG.tClearScale.includes(scale)&&
  CONFIG.exitMixScenarios.includes(mix),'scenario');
 if(policy==='L2')check(CONFIG.l2TargetGoAroundRates.includes(target),'L2 target');
 const depPerHour=m.departures.length/CONFIG.demandHours;
 const c=a14Config(depPerHour),tab=policy==='L0'?null:table({policy,target,scale,mix});
 const arrivals=[],departures=[],events=[],attempts=[],holds=[],depUsed=new Set();
 const reqs=m.departures;
 let prev=null,missCasa=0,missCritical=0,censoredArrivals=0,departureGateBindings=0,stopped=false;
 for(const f of m.arrivals){
  if(stopped){censoredArrivals++;arrivals.push({...f,status:'censored',thresholdMs:null,
   delayMs:null,reason:'DRAIN_HORIZON',attemptCount:0});continue;}
  if(prev===null){
   const x=getExit(f,mix,scale),thresholdMs=f.requestMs;
   const row={...f,status:'served',thresholdMs,delayMs:0,exit:x.exit,
    casaClearMs:thresholdMs+Math.round(x.clearanceS*1000),sampledTclearS:x.clearanceS,
    runwayVacatedMs:thresholdMs+c.synthetic.arrivalROTMs,
    landingRunEndMs:thresholdMs+c.synthetic.landingRunEndAfterThresholdMs,
    attemptCount:1};
   arrivals.push(row);events.push({id:f.id,event:'ARR_THRESHOLD',timeMs:thresholdMs});prev=row;continue;
  }
  const gap=requiredIntervalMs(prev,f,{policy,target,scale,mix});
  const requestThreshold=Math.max(f.requestMs,prev.thresholdMs+gap);
  let threshold=requestThreshold;
  const d=reqs.find(x=>!depUsed.has(x.id)&&x.requestMs<=threshold);
  let depCandidate=null;
  if(d){
   const passage=Math.max(d.requestMs,prev.runwayVacatedMs);
   const airborne=passage+c.synthetic.departureLineupMs+c.synthetic.departureRollToAirborneMs;
   const depClear=airborne+c.synthetic.departureRunwayClearAfterAirborneMs;
   const holdTime=policy==='L0'?Math.round(secondsFromNM(c.protection.holdingInboundNM[d.category],c)*1000):
    followerTimeMs(c.protection.holdingInboundNM[d.category],f.type)+1000; // 1s conservative rounding guard
   const constrained=Math.max(threshold,passage+holdTime,depClear);
   depCandidate={d,passage,airborne,depClear,holdTime};
   if(constrained>threshold)departureGateBindings++;
   threshold=constrained;
  }
  // An intentionally provided critical-area occupancy is handled independently.
  const critical=heavyCriticalDecision({arrival:f,runway:'24',phase:'NOTIFICATION',
   inboundNM:f.criticalHeavyInboundNM,heavyCriticalAreaOccupied:f.heavyCriticalAreaOccupied,
   thresholdMs:threshold},c);
  let count=1,missed=false;
  if(critical.outcome==='MISSED_APPROACH'){
   missCritical++;missed=true;count++;
   attempts.push({id:f.id,attempt:1,reason:'CRITICAL_AREA_HEAVY',
    event:'MISSED_APPROACH',timeMs:threshold,source:'EXPLICIT_FIXTURE_ONLY'});
   threshold=Math.max(threshold,critical.reentryAtMs);
  }
  let checkCasa=casaAtTwoNM(prev,threshold,f.type,prev.casaClearMs);
  if(checkCasa.occupied){
   missCasa++;missed=true;
   attempts.push({id:f.id,attempt:count,reason:'CASA_OCCUPIED_AT_2NM',
    event:'MISSED_APPROACH',timeMs:checkCasa.followerAtTwoNmMs,
    leaderCasaTailClearMs:prev.casaClearMs});
   count++;
   threshold+=CONFIG.syntheticGoAroundReentryDelayMs;
   checkCasa=casaAtTwoNM(prev,threshold,f.type,prev.casaClearMs);
  }
  check(!checkCasa.occupied,'reentry must clear CASA, otherwise mark censor');
  // Re-test the prearranged departure at the actual re-entry threshold.
  if(depCandidate){
   const {d,passage,airborne,depClear,holdTime}=depCandidate;
   const inbound=policy==='L0'?(threshold-passage)/1000*c.synthetic.finalApproachSpeedKt/3600:
    followerDistanceNM(threshold-passage,f.type);
   const holdCheck=holdingDecision({departureCategory:d.category,inboundNM:inbound,
    phase:'NOTIFICATION',passageMs:passage},c);
   check(holdCheck.allowed&&threshold>=passage+holdTime&&
    passage>=prev.runwayVacatedMs&&threshold>=depClear,
    'LVP departure holding / post-vacate / follower physical gate');
   depUsed.add(d.id);
   departures.push({...d,status:'served',holdingPointPassageMs:passage,
    airborneMs:airborne,runwayClearMs:depClear,timeMs:airborne,
    delayMs:airborne-d.requestMs,holdingCheck:holdCheck,runwayEntryPractice:POST_VACATE});
   events.push({id:d.id,event:'CAT_II_III_HOLDING_POINT_PASSAGE',timeMs:passage},
    {id:d.id,event:'DEPARTURE_AIRBORNE',timeMs:airborne});
  }
  if(threshold>CONFIG.drainEndMs){
   stopped=true;censoredArrivals++;arrivals.push({...f,status:'censored',thresholdMs:null,
    delayMs:null,attemptCount:count,reason:'DRAIN_HORIZON'});continue;
  }
  const exit=getExit(f,mix,scale);
  const row={...f,status:'served',thresholdMs:threshold,delayMs:threshold-f.requestMs,
   exit:exit.exit,sampledTclearS:exit.clearanceS,
   casaClearMs:threshold+Math.round(exit.clearanceS*1000),
   runwayVacatedMs:threshold+c.synthetic.arrivalROTMs,
   landingRunEndMs:threshold+c.synthetic.landingRunEndAfterThresholdMs,
   casaAtTwoNM:checkCasa,attemptCount:count,missedApproach:missed,
   targetIntervalMs:gap,deliveredSpacingNM:followerDistanceNM(threshold-prev.thresholdMs,f.type),
   source:'HYPOTHETICAL_LVP_SPACING_UNVALIDATED'};
  arrivals.push(row);events.push({id:f.id,event:'ARR_THRESHOLD',timeMs:threshold},
   {id:f.id,event:'CASA_TAIL_CLEAR',timeMs:row.casaClearMs,exit:row.exit});
  prev=row;
 }
 // Unreleased departures remain FIFO and can depart in the drain after last ARR.
 let runwayReadyMs=prev?.runwayVacatedMs??0;
 for(const d of reqs){
  if(depUsed.has(d.id))continue;
  const passage=Math.max(d.requestMs,runwayReadyMs);
  const airborne=passage+c.synthetic.departureLineupMs+c.synthetic.departureRollToAirborneMs;
  const clear=airborne+c.synthetic.departureRunwayClearAfterAirborneMs;
  const ok=airborne<=CONFIG.drainEndMs;
  departures.push({...d,status:ok?'served':'censored',timeMs:ok?airborne:null,
   holdingPointPassageMs:ok?passage:null,airborneMs:ok?airborne:null,
   runwayClearMs:ok?clear:null,delayMs:ok?airborne-d.requestMs:null,
   reason:ok?'FIFO_DRAIN':'DRAIN_HORIZON',runwayEntryPractice:POST_VACATE});
  if(ok)events.push({id:d.id,event:'DRAIN_FIFO_DEPARTURE',timeMs:airborne});
  runwayReadyMs=clear;
 }
 check(arrivals.length===m.arrivals.length&&departures.length===m.departures.length,'demand conservation');
 const servedArr=arrivals.filter(x=>x.status==='served'),servedDep=departures.filter(x=>x.status==='served');
 const inHour=t=>t>=CONFIG.measurementStartMs&&t<CONFIG.measurementEndMs;
 const windowArr=servedArr.filter(x=>inHour(x.thresholdMs));
 const windowDep=servedDep.filter(x=>inHour(x.airborneMs));
 const pairIntervals=servedArr.slice(1).map((a,i)=>(a.thresholdMs-servedArr[i].thresholdMs)/1000);
 const delays=windowArr.map(x=>x.delayMs/1000);
 const exposures=servedArr.length-1+attempts.filter(x=>x.reason==='CASA_OCCUPIED_AT_2NM').length;
 return {meta:{version:VERSION,runway:'24',phase:'NOTIFICATION',policy,target,scale,mix,
   manifestHash:digest(m),configHash:digest(CONFIG),entryPolicy:POST_VACATE,
   operational:false,approval:[6925949716,6925987977]},
  totals:{arrivalRequests:m.arrivals.length,departureRequests:m.departures.length,
   servedArrivalsByDrain:servedArr.length,servedDeparturesByDrain:servedDep.length,
   censoredArrivals,censoredDepartures:departures.length-servedDep.length,
   casaGoArounds:missCasa,heavyCriticalGoArounds:missCritical,
   casaExposedFollowerAttempts:exposures,
   originalArrivalsExposed:Math.max(0,m.arrivals.length-1)},
  metrics:{arrivalsPerHour:windowArr.length,departuresPerHour:windowDep.length,
   arrivalDelayMeanS:mean(delays),arrivalDelayP90S:quant(delays,.9),
   arrivalIntervalMedianS:quant(pairIntervals,.5),
   arrivalSpacingMedianNM:quant(servedArr.slice(1).map(x=>x.deliveredSpacingNM),.5),
   departureHoldingGateBindings:departureGateBindings,
   casaGoAroundRatePerExposedAttempt:exposures?missCasa/exposures:null,
   casaGoAroundRatePerOriginalArrival:m.arrivals.length?missCasa/m.arrivals.length:null,
   capacityEligible:false},
  table:tab,arrivals,departures,attempts,events,holds};
}
// L0 baseline replay via A1.4 is retained as an independent reference gate;
// no edits to its code or calibration data.
export function reproduceA14(m){
 const depPerHour=m.departures.length/CONFIG.demandHours;
 return a14Simulate(m,a14Config(depPerHour),{phase:'NOTIFICATION',entryPolicy:POST_VACATE});
}
// Numerical Recipes regularized incomplete beta for exact Clopper–Pearson inversion.
function logGamma(z){
 const p=[.99999999999980993,676.5203681218851,-1259.1392167224028,
 771.32342877765313,-176.6150291621406,12.507343278686905,
 -.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
 if(z<.5)return Math.log(Math.PI)-Math.log(Math.sin(Math.PI*z))-logGamma(1-z);
 let x=p[0],t=z-1;
 for(let i=1;i<p.length;i++)x+=p[i]/(t+i);
 return .5*Math.log(2*Math.PI)+(t+.5)*Math.log(t+7.5)-(t+7.5)+Math.log(x);
}
function betaFraction(a,b,x){
 const max=240,eps=3e-14,fp=1e-300;
 let c=1,d=1-(a+b)*x/(a+1);if(Math.abs(d)<fp)d=fp;d=1/d;let h=d;
 for(let m=1;m<=max;m++){
  let aa=m*(b-m)*x/((a+2*m-1)*(a+2*m));
  d=1+aa*d;if(Math.abs(d)<fp)d=fp;c=1+aa/c;if(Math.abs(c)<fp)c=fp;d=1/d;h*=d*c;
  aa=-(a+m)*(a+b+m)*x/((a+2*m)*(a+2*m+1));
  d=1+aa*d;if(Math.abs(d)<fp)d=fp;c=1+aa/c;if(Math.abs(c)<fp)c=fp;d=1/d;
  const delta=d*c;h*=delta;if(Math.abs(delta-1)<eps)break;
 }
 return h;
}
function betaReg(x,a,b){
 if(x<=0)return 0;if(x>=1)return 1;
 const factor=Math.exp(logGamma(a+b)-logGamma(a)-logGamma(b)+a*Math.log(x)+b*Math.log1p(-x));
 return x<(a+1)/(a+b+2)?factor*betaFraction(a,b,x)/a:
  1-factor*betaFraction(b,a,1-x)/b;
}
function betaInv(p,a,b){
 let lo=0,hi=1;
 for(let i=0;i<70;i++){const mid=(lo+hi)/2;
  if(betaReg(mid,a,b)<p)lo=mid;else hi=mid;
 }
 return (lo+hi)/2;
}
export function exactBinomial(k,n,alpha=.05){
 check(Number.isInteger(k)&&Number.isInteger(n)&&k>=0&&k<=n&&n>0,'binomial sample');
 return {count:k,exposures:n,rate:k/n,confidence:1-alpha,method:'CLOPPER_PEARSON_EXACT',
  lower:k===0?0:betaInv(alpha/2,k,n-k+1),
  upper:k===n?1:betaInv(1-alpha/2,k+1,n-k)};
}
export function pairedCI(a,seed=CONFIG.bootstrapSeed){
 const xs=a.filter(Number.isFinite);if(!xs.length)return {n:0,mean:null,ci95:[null,null]};
 const next=rand(seed),boot=[];
 for(let j=0;j<CONFIG.bootstrapResamples;j++){let sum=0;for(let i=0;i<xs.length;i++)
  sum+=xs[Math.floor(next()*xs.length)];boot.push(sum/xs.length);}
 return {n:xs.length,mean:mean(xs),ci95:[quant(boot,.025),quant(boot,.975)]};
}
export function runSweep({seedCount=CONFIG.seeds,rates=[...CONFIG.demandArrivalPerHour,
 CONFIG.saturatedProbeArrivalPerHour],scales=CONFIG.tClearScale,
 mixes=CONFIG.exitMixScenarios}={}){
 validate();check(seedCount>=50,'at least 50 matched seeds');
 const scenarios=[];
 for(const rate of rates)for(const depPerHour of CONFIG.departurePerHour)
  for(const scale of scales)for(const mix of mixes){
   const ms=Array.from({length:seedCount},(_,i)=>manifest({seed:CONFIG.seedStart+i,rate,depPerHour}));
   const base=ms.map(m=>simulate(m,{policy:'L0',scale,mix}));
   for(const policy of ['L0','L1','L2'])for(const target of
    policy==='L2'?CONFIG.l2TargetGoAroundRates:[null]){
    const runs=policy==='L0'?base:ms.map(m=>simulate(m,{policy,target,scale,mix}));
    const a0=base.map(x=>x.metrics),a1=runs.map(x=>x.metrics);
    const metrics=['arrivalsPerHour','departuresPerHour','arrivalDelayMeanS','arrivalDelayP90S'];
    const deltas=Object.fromEntries(metrics.map((name,i)=>[name,pairedCI(a1.map((x,j)=>
     x[name]-a0[j][name]),CONFIG.bootstrapSeed+rate*1000+depPerHour*100+i+Math.round(scale*100))]));
    const totals=runs.map(x=>x.totals);
    const casas=totals.reduce((v,x)=>v+x.casaGoArounds,0),
     exposures=totals.reduce((v,x)=>v+x.casaExposedFollowerAttempts,0);
    const meanKeys=['arrivalsPerHour','departuresPerHour','arrivalDelayMeanS','arrivalDelayP90S',
     'arrivalIntervalMedianS','arrivalSpacingMedianNM','departureHoldingGateBindings'];
    const averages=Object.fromEntries(meanKeys.map(k=>[k,mean(a1.map(x=>x[k]).filter(Number.isFinite))]));
    const totalsByDrain=['servedArrivalsByDrain','servedDeparturesByDrain',
     'censoredArrivals','censoredDepartures','casaGoArounds','heavyCriticalGoArounds'];
    const drain=Object.fromEntries(totalsByDrain.map(k=>[k,mean(totals.map(x=>x[k]))]));
    const drainPaired=Object.fromEntries(['servedArrivalsByDrain','servedDeparturesByDrain'].map((k,i)=>
     [k,pairedCI(totals.map((v,j)=>v[k]-base[j].totals[k]),CONFIG.bootstrapSeed+rate*100+i)]));
    scenarios.push({rate,depPerHour,saturatedProbe:rate===CONFIG.saturatedProbeArrivalPerHour,
     scale,mix,policy,target,seedCount,baselineA14Lock:'READ_ONLY',
     manifestHashes:ms.map(digest),pairedEqualManifests:runs.every((x,i)=>
      x.meta.manifestHash===base[i].meta.manifestHash),
     means:averages,byDrain:drain,pairedByDrain:drainPaired,
     casaGoAroundExact95:exposures?exactBinomial(casas,exposures):null,
     pairedPolicyMinusL0:deltas,
     leaderTable:policy==='L0'?null:runs[0].table,
     perSeed:runs.map((x,i)=>({seed:ms[i].seed,hash:digest(ms[i]),
      metrics:x.metrics,totals:x.totals,
      baselineArrivalsPerHour:base[i].metrics.arrivalsPerHour}))});
   }
  }
 return {version:VERSION,baseMain:CONFIG.baseMain,nonOperational:true,
  status:'HYPOTHETICAL_UNVALIDATED',configHash:digest(CONFIG),
  baselineReproduction:'A14_COMPARE_SEPARATELY_WITH_NO_MODIFICATION',
  scenarioCount:scenarios.length,scenarios,
  winterReference:A14.observedWinter,
  feasibilityGate:{medium:feasibleMixedGap(A14,{category:'MEDIUM'}).gate,
   heavy:feasibleMixedGap(A14,{category:'HEAVY'}).gate},
  warnings:CONFIG.limitations};
}
