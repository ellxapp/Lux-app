// Isolated, non-operational Stage A synthetic simulation. No shared app code imported.
import {createHash} from 'node:crypto';
export const STUDY_MODEL_VERSION='1.0.0';
export const METRES_PER_NM=1852;
const hr=3600000;
function requireValue(ok,msg){if(!ok)throw new Error(msg);}
function int(n,label,min=0){requireValue(Number.isSafeInteger(n)&&n>=min,'invalid '+label);}
export function stableObject(x){if(Array.isArray(x))return x.map(stableObject);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,stableObject(x[k])]));return x;}
export function canonical(x){return JSON.stringify(stableObject(x))+'\n';}
export function digest(x){return createHash('sha256').update(typeof x==='string'?x:canonical(x)).digest('hex');}
export function byteCompare(a,b){return Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8'));}
export function byDemand(a,b){return a.requestMs-b.requestMs||byteCompare(a.id,b.id);}
export function makeManifest({seed=42,count=60,stepMs=30000,startUtc='2026-01-01T00:00:00.000Z',departureModulo=4}={}){
 int(seed,'seed');int(count,'count');int(stepMs,'stepMs');int(departureModulo,'departureModulo');
 requireValue(startUtc.endsWith('Z')&&!Number.isNaN(Date.parse(startUtc)),'UTC');
 let state=(seed>>>0)||0x9e3779b9;const next=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;};
 const flights=[];
 for(let i=0;i<count;i++){
   const kind=departureModulo>0&&(i+1)%departureModulo===0?'DEP':'ARR';
   const heavy=next()<0.2;
   flights.push({id:'SYN'+String(i).padStart(5,'0'),kind,aircraftType:heavy?'SYNTH-H':'SYNTH-M',wake:heavy?'H':'M',
     requestMs:i*stepMs+Math.floor(next()*1000),deliveryErrorMs:Math.floor((next()-.5)*14000)});
 }
 return {schema:1,synthetic:true,seed,startUtc,flights:flights.sort(byDemand)};
}
export function validateConfig(c){
 requireValue(c&&['SYNTH','EUROCONTROL_2018','CAPAN_2025','LOCAL_ONLY'].includes(c.preset),'invalid preset');
 const allowed=new Set(['preset','source','startUtc','controlM','profile','arrivalRotMs','departureAirborneAfterEntryMs','departureClearAfterEntryMs','afterDepartureAirborneBufferMs','sensitiveAfterClearMs','normalSlaM','mixedMediumSlaM','mixedHeavySlaM','surveillanceM','wakeFallbackM','wakeM','measurementStartMs','measurementEndMs','drainEndMs','sensitiveGateM','lvpSlaM','lvp','applyDeliveryError','declaredCapacityInputOnly','lvpRwy24HeavyVacateFlag']);
 for(const name of Object.keys(c))requireValue(allowed.has(name),'unknown config field: '+name);
 if(c.lvpRwy24HeavyVacateFlag!==undefined)requireValue(typeof c.lvpRwy24HeavyVacateFlag==='boolean','invalid LVP flag');
 requireValue(typeof c.startUtc==='string'&&c.startUtc.endsWith('Z')&&!Number.isNaN(Date.parse(c.startUtc)),'invalid UTC');
 const fields=['lvpSlaM','controlM','arrivalRotMs','departureAirborneAfterEntryMs','departureClearAfterEntryMs','afterDepartureAirborneBufferMs','sensitiveAfterClearMs','normalSlaM','mixedMediumSlaM','mixedHeavySlaM','surveillanceM','wakeFallbackM','measurementStartMs','measurementEndMs','drainEndMs','sensitiveGateM'];
 for(const f of fields)int(c[f],f);
 requireValue(c.controlM>c.mixedHeavySlaM && c.measurementStartMs<c.measurementEndMs && c.measurementEndMs<=c.drainEndMs,'control or window invalid');
 requireValue(c.departureClearAfterEntryMs>=c.departureAirborneAfterEntryMs,'departure event ordering');
 requireValue(typeof c.applyDeliveryError==='boolean'&&typeof c.lvp==='boolean','scenario switches');
 requireValue(Array.isArray(c.profile)&&c.profile.length>0,'profile required');
 let prev=c.controlM;
 for(const p of c.profile){int(p.toM,'profile.toM');int(p.iasKt,'profile.iasKt',1);requireValue(Number.isSafeInteger(p.headwindKt||0),'headwind');requireValue(p.toM<prev&&p.iasKt-(p.headwindKt||0)>30,'profile segment');prev=p.toM;}
 requireValue(prev===0,'last profile breakpoint must reach threshold');
 requireValue(c.sensitiveGateM<c.controlM,'sensitive gate');
 requireValue(c.wakeM&&typeof c.wakeM==='object','wake matrix required');
 for(const row of Object.values(c.wakeM))for(const v of Object.values(row))int(v,'wake matrix entry');
 return c;
}
function mPerMs(seg){return (seg.iasKt-(seg.headwindKt||0))*METRES_PER_NM/hr;}
export function durationMs(c,fromM){
 let d=fromM,time=0;
 while(d>0){
   const s=c.profile.find(p=>d>p.toM);
   requireValue(s,'undefined speed segment');
   const to=s.toM;time+=(d-to)/mPerMs(s);d=to;
 }
 return Math.round(time);
}
export function positionAt(c,thresholdMs,t){
 const time=thresholdMs-t;
 if(time<=0)return 0;
 let remain=time,down=0;
 for(let i=c.profile.length-1;i>=0;i--){
   const p=c.profile[i],up=i===0?c.controlM:c.profile[i-1].toM;
   const dur=(up-down)/mPerMs(p);
   if(remain<=dur)return down+remain*mPerMs(p);
   remain-=dur;down=up;
 }
 return c.controlM+1;
}
function closestOnCommonFinal(c,leadMs,followMs){
 const start=Math.max(leadMs-durationMs(c,c.controlM),followMs-durationMs(c,c.controlM));
 if(start>leadMs)return Infinity;
 let nearest=Infinity;
 // breakpoints are tested along with each 250 ms sample; a simulation approximation.
 for(let t=start;t<leadMs;t+=250){
   const a=positionAt(c,leadMs,t),b=positionAt(c,followMs,t);
   if(a<=c.controlM&&b<=c.controlM)nearest=Math.min(nearest,b-a);
 }
 const b=positionAt(c,followMs,leadMs);
 if(b<=c.controlM)nearest=Math.min(nearest,b);
 return nearest;
}
function evaluate(c,flight,time,history){
 const constraints=[];
 function add(name,actual,required,unit,event){
   const margin=Math.round(actual-required);
   constraints.push({name,actual:Math.round(actual),required,margin,unit,event,ok:margin>=0});
 }
 const last=history.at(-1);
 const leader=[...history].reverse().find(x=>x.kind==='ARR');
 const intervening=leader&&history.slice(history.indexOf(leader)+1).filter(x=>x.kind==='DEP');
 if(flight.kind==='ARR'){
   if(leader){
     const delivered=positionAt(c,time,leader.timeMs);
     const dep=intervening&&intervening.at(-1);
     const sla= c.lvp?c.lvpSlaM:(dep?(dep.wake==='H'?c.mixedHeavySlaM:c.mixedMediumSlaM):c.normalSlaM);
     add('sla-threshold',delivered,sla,'m','leader.threshold');
     const closest=closestOnCommonFinal(c,leader.timeMs,time);
     add('surveillance-common-final',closest,c.surveillanceM,'m','min-on-common-final');
     const wake=c.wakeM[leader.wake]?.[flight.wake]??c.wakeFallbackM;
     add('wake-common-final',closest,wake,'m','min-on-common-final');
   }
   if(last){
     add('runway-protected-area',time,last.clearMs,'ms','follower.threshold');
     if(last.kind==='DEP')add('departure-airborne',time,last.airborneMs+c.afterDepartureAirborneBufferMs,'ms','follower.threshold');
     if(c.lvp){
       const atGate=time-durationMs(c,c.sensitiveGateM);
       add('ils-sensitive-area',atGate,last.sensitiveClearMs,'ms','follower.at-sensitive-gate');
     }
   }
 }else if(last){
   add('departure-entry-runway-clear',time,last.clearMs,'ms','departure.runway-entry');
 }
 return constraints;
}
function validFlight(f){
 requireValue(f&&typeof f.id==='string'&&f.id.length>0,'flight ID');
 requireValue(['ARR','DEP'].includes(f.kind),'kind');
 requireValue(typeof f.aircraftType==='string'&&typeof f.wake==='string','aircraft info');
 int(f.requestMs,'request time');
 requireValue(Number.isSafeInteger(f.deliveryErrorMs),'delivery error');
}
export function runStudy(manifest,config,{commitSha,dirty=false,nodeVersion=process.version}={}){
 const c=structuredClone(validateConfig(config));
 requireValue(manifest&&manifest.synthetic===true&&manifest.schema===1&&Array.isArray(manifest.flights),'synthetic manifest only');
 requireValue(/^[a-f0-9]{40}$/.test(commitSha||''),'full commit SHA mandatory');
 requireValue(manifest.startUtc===c.startUtc,'UTC origin mismatch');
 const controlTravel=durationMs(c,c.controlM);
 // Compare demand at the same physical runway reference event, not ARR control-point demand vs DEP runway-entry demand.
 const demandAtEvent=f=>f.requestMs+(f.kind==='ARR'?controlTravel:0);
 const ordered=[...manifest.flights].sort((a,b)=>demandAtEvent(a)-demandAtEvent(b)||byteCompare(a.id,b.id)),ids=new Set(),rows=[],history=[],events=[];
 for(const input of ordered){
   const f=structuredClone(input);
   requireValue(typeof f.id==='string'&&!ids.has(f.id),'duplicate/invalid id');ids.add(f.id);
   try{validFlight(f);}catch(e){rows.push({...f,status:'rejected',reason:e.message,attempts:[],constraints:[]});continue;}
   const eventDemand=demandAtEvent(f);
   let planned=eventDemand,attempts=[],found=false;
   while(planned<=c.drainEndMs){
     const checks=evaluate(c,f,planned,history);
     attempts.push({plannedMs:planned,blockedBy:checks.filter(x=>!x.ok).map(x=>x.name)});
     if(checks.every(x=>x.ok)){found=true;break;}
     planned+=1000; // hold upstream, not at threshold
   }
   if(!found){rows.push({...f,status:'censored',reason:'drain-horizon',attempts,constraints:attempts.length?evaluate(c,f,c.drainEndMs,history):[]});continue;}
   const actual=planned+(c.applyDeliveryError&&f.kind==='ARR'?f.deliveryErrorMs:0);
   const constraints=evaluate(c,f,actual,history);
   // SLA is a planning/coordination target, not an automatic go-around safety minimum.
   const slaShortfalls=constraints.filter(x=>x.name==='sla-threshold'&&!x.ok);
   const failing=constraints.filter(x=>x.name!=='sla-threshold'&&!x.ok);
   const status=failing.length?'go-around':'served';
   const row={...f,status,reason:failing.map(x=>x.name).join('|')||(slaShortfalls.length?'sla-infringement':null),slaInfringement:slaShortfalls.length>0,plannedMs:planned,timeMs:actual,
     controlCrossingMs:f.kind==='ARR'?planned-controlTravel:null,delayMs:planned-eventDemand,
     attempts, constraints,binding:constraints.filter(x=>x.margin>=0&&x.margin<=1000).map(x=>x.name)};
   if(status==='served'){
     if(f.kind==='ARR'){
       row.clearMs=actual+c.arrivalRotMs;
       row.sensitiveClearMs=row.clearMs+c.sensitiveAfterClearMs;
     }else{
       row.airborneMs=actual+c.departureAirborneAfterEntryMs;
       row.clearMs=actual+c.departureClearAfterEntryMs;
       row.sensitiveClearMs=row.clearMs+c.sensitiveAfterClearMs;
     }
     history.push(row);
     events.push({id:f.id,event:f.kind==='ARR'?'arrival-threshold':'departure-runway-entry',timeMs:actual});
     if(f.kind==='DEP')events.push({id:f.id,event:'departure-airborne',timeMs:row.airborneMs});
     events.push({id:f.id,event:'protected-area-clear',timeMs:row.clearMs});
     events.push({id:f.id,event:'sensitive-area-clear',timeMs:row.sensitiveClearMs});
   }else events.push({id:f.id,event:'go-around',timeMs:actual});
   rows.push(row);
 }
 events.sort((a,b)=>a.timeMs-b.timeMs||byteCompare(a.id,b.id)||byteCompare(a.event,b.event));
 const inWindow=rows.filter(r=>r.status==='served'&&r.timeMs>=c.measurementStartMs&&r.timeMs<c.measurementEndMs);
 const arrivals=inWindow.filter(r=>r.kind==='ARR').length,deps=inWindow.length-arrivals;
 const rate=hr/(c.measurementEndMs-c.measurementStartMs);
 const totals={demand:rows.length,served:rows.filter(r=>r.status==='served').length,censored:rows.filter(r=>r.status==='censored').length,
   rejected:rows.filter(r=>r.status==='rejected').length,goArounds:rows.filter(r=>r.status==='go-around').length};
 requireValue(totals.demand===totals.served+totals.censored+totals.rejected+totals.goArounds,'conservation');
 const violations=rows.filter(r=>r.status==='go-around').reduce((n,r)=>n+r.constraints.filter(x=>!x.ok&&x.name!=='sla-threshold').length,0);
 const slaInfringements=rows.filter(r=>r.slaInfringement).length;
 // Check continuous backlog of valid, not-yet-processed traffic throughout the hour.
 let backlogAllHour=true;
 for(let t=c.measurementStartMs;t<c.measurementEndMs;t+=1000){
   const waiting=rows.filter(r=>r.status!=='rejected'&&demandAtEvent(r)<=t&&(r.plannedMs??Infinity)>t).length;
   if(waiting===0){backlogAllHour=false;break;}
 }
 const eligible=violations===0&&slaInfringements===0&&totals.goArounds===0&&totals.rejected===0&&backlogAllHour;
 return {meta:{studyModelVersion:STUDY_MODEL_VERSION,commitSha,nodeVersion,dirty,preset:c.preset,
    source:c.source||null,seed:manifest.seed,manifestSha256:digest(manifest),configSha256:digest(c),startUtc:c.startUtc,
    units:{time:'integer-ms',distance:'integer-m'},delaySearchStepMs:1000,bindingTolerance:{m:1000,ms:1000},window:{startMs:c.measurementStartMs,endMs:c.measurementEndMs,drainEndMs:c.drainEndMs}},
   totals,violations,slaInfringements,capacity_eligible:eligible,capacity_label:eligible?'synthetic-saturation':'demand-limited-or-infeasible',
   backlogAllHour,metrics:{measurementArrivals:arrivals,measurementDepartures:deps,arrivalRatePerHour:arrivals*rate,
    departureRatePerHour:deps*rate,runwayRatePerHour:inWindow.length*rate,sectorDemandCount:ordered.length,
    sectorProcessedCount:totals.served,declaredCapacityInputOnly:c.declaredCapacityInputOnly??null},events,flights:rows};
}
export function csv(rows){
 const fields=['commitSha','nodeVersion','dirty','id','kind','aircraftType','wake','requestMs','plannedMs','timeMs','controlCrossingMs','delayMs','status','reason','slaInfringement','binding','constraints'];
 const cell=x=>{const s=x===undefined||x===null?'':typeof x==='object'?JSON.stringify(x):String(x);
   return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
 return fields.join(',')+'\r\n'+rows.map(r=>fields.map(k=>cell(r[k])).join(',')).join('\r\n')+(rows.length?'\r\n':'');
}
export function paired(left,right){
 requireValue(left.meta.manifestSha256===right.meta.manifestSha256,'matched manifest required');
 return {manifestSha256:left.meta.manifestSha256,configLeft:left.meta.configSha256,configRight:right.meta.configSha256,
   deltaArrivalRatePerHour:right.metrics.arrivalRatePerHour-left.metrics.arrivalRatePerHour,
   deltaRunwayRatePerHour:right.metrics.runwayRatePerHour-left.metrics.runwayRatePerHour};
}
