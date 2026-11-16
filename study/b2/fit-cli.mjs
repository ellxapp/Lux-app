// B2b S0 fit-search only: no S1/S2 result on this exploratory calibration.
// Every candidate is a labelled synthetic arrival bunching assumption.
import {ASSUMPTIONS,makeTmaManifest,runS0} from './tma.mjs';
import {B2A} from './calibration.mjs';
const rates=[['<=7',6],['8-11',10],['12-15',14],['16-19',18],['20+',20]];
const factors=[.1,.25,.4,.55,.7,.85,1];
const quant=(a,p)=>{const s=a.sort((x,y)=>x-y),i=(s.length-1)*p,k=Math.floor(i);return s[k]+(s[Math.min(k+1,s.length-1)]-s[k])*(i-k);};
for(const [band,rate] of rates){
 const results=[];
 for(const f of factors){
  const settings={...ASSUMPTIONS,clusterFactorByRate:{[rate]:f}},v=[];let inv=0,n=0;
  try{
   for(let i=0;i<50;i++){
    const m=makeTmaManifest(rate,20261116+i,settings),s=runS0(m,{settings});
    v.push(...s.allocation.map(x=>x.delayS));inv+=s.inversions.inversions;n+=s.inversions.pairs;
   }
   const median=quant(v,.5);
   results.push({factor:f,median,delta:median-B2A.excess40[band].median,inv:inv/n});
  }catch(e){results.push({factor:f,error:String(e)});}
 }
 console.log(JSON.stringify({band,rate,observed:B2A.excess40[band].median,results}));
}
