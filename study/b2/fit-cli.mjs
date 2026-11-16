// High-demand S0 sensitivity: ring jitter only. No S1/S2.
import {ASSUMPTIONS,makeTmaManifest,runS0} from './tma.mjs';
const quant=(v,p)=>{const a=v.sort((x,y)=>x-y),k=(a.length-1)*p,i=Math.floor(k);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(k-i);};
for(const j of [0,15,30,60,90,120,180,240])for(const gapPolicy of ['DISTANCE','TIME']){
 const settings={...ASSUMPTIONS,entryRingJitterByRateS:{20:j}},xs=[],inv=[];
 for(let k=0;k<50;k++){const m=makeTmaManifest(20,20261116+k,settings),r=runS0(m,{settings,gapPolicy});
  xs.push(...r.allocation.map(x=>x.delayS));inv.push(r.inversions.rate);}
 console.log(JSON.stringify({rate:20,jitterS:j,gapPolicy,median:quant(xs,.5),inversionMean:inv.reduce((a,b)=>a+b,0)/inv.length}));
}
