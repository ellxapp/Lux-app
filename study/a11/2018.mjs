// Published 2019 EUROCONTROL Airport Capacity Assessment, using 2018 inputs.
// Numbers explicitly cleared in ellxapp/panel#6 comment 6868190637.
// These are OBSERVED/OPTIMAL variants of technical-capacity assessment, not raw traffic counts.
import {makeManifest,runStudy,digest} from '../core.mjs';
export const EUROCONTROL_2018_REFERENCE=Object.freeze({
 source:'EUROCONTROL Airport Capacity Assessment (2019), 2018 traffic inputs',
 sourceComment:'https://github.com/ellxapp/panel/issues/6#issuecomment-6868190637',
 unit:'movements per hour',
 metrics:{
  AA:{'06':{observed:21.2,optimal:24.4},'24':{observed:21.3,optimal:24.2}},
  DD:{'06':{observed:21.2,optimal:29.6},'24':{observed:23.8,optimal:31.1}},
  ADA:{'06':{observed:27.1,optimal:33.9},'24':{observed:26.5,optimal:34.64}},
  COMBINED:{'06':{observed:22,optimal:30.8},'24':{observed:22.7,optimal:31.2}}
 },
 limitations:{arrivalRotCategoryMeanSeconds:[66,109],departureRotCategoryMeanSeconds:[89,122],lineupSeconds:[43,63],
  detailedExitConditionedROT:'NOT_AVAILABLE',flightLevelHistoricalData:'NOT_COMMITTED',
  sourcePageRefs:'NOT_VERIFIED_NO_PAGE_REFERENCES_IN_APPROVED_PROJECT_RECORD'}
});
export function compare2018({mode,runway,syntheticRate,capacityEligible,matchedMode=false}){
 const historical=EUROCONTROL_2018_REFERENCE.metrics[mode]?.[runway];
 if(!historical)throw Error('unknown mode or runway');
 const measure=mode==='AA'?'ARRIVALS_PER_HOUR':'MOVEMENTS_PER_HOUR';
 const comparable=Boolean(capacityEligible&&matchedMode&&Number.isFinite(syntheticRate));
 return {mode,runway,measure,observedTechnical:historical.observed,optimalTechnical:historical.optimal,
  syntheticRate:Number.isFinite(syntheticRate)?syntheticRate:null,
  deltaObserved:comparable?syntheticRate-historical.observed:null,
  deltaOptimal:comparable?syntheticRate-historical.optimal:null,
  illustrativeArithmeticDeltaObserved:Number.isFinite(syntheticRate)?syntheticRate-historical.observed:null,
  illustrativeArithmeticDeltaOptimal:Number.isFinite(syntheticRate)?syntheticRate-historical.optimal:null,
  comparison:comparable?'SIMPLIFIED_SYNTHETIC_VS_HISTORICAL_TECHNICAL':'NOT_COMPARABLE',
  warning:'2018 is a discrepancy reference, never a fitting target; mode/ROT/speed/exits/coordination not equivalent'};
}
export function run2018Illustration(config,{commitSha,seed=20261114,count=110,stepMs=25000}={}){
 const output=[];
 for(const mode of ['AA','DD','ADA','COMBINED']){
  let manifest=makeManifest({seed,count,stepMs,startUtc:config.startUtc,
   departureModulo:mode==='AA'?0:mode==='ADA'?3:4});
  if(mode==='DD')manifest={...manifest,flights:manifest.flights.map(f=>({...f,kind:'DEP'}))};
  const result=runStudy(manifest,config,{commitSha});
  for(const runway of ['06','24']){
   // Only AA and DD have unambiguous all-ARR/all-DEP synthetic traffic modes.
   // Historical ADA and Combined demand allocations have not been reconstructed.
   const matchedMode=(mode==='AA'||mode==='DD');
   const rate=mode==='AA'?result.metrics.arrivalRatePerHour:result.metrics.runwayRatePerHour;
   output.push({...compare2018({mode,runway,syntheticRate:rate,capacityEligible:result.capacity_eligible,matchedMode}),
    syntheticCounts:result.metrics,modelCapacityEligible:result.capacity_eligible,
    syntheticConfigSha256:digest(config),syntheticManifestSha256:digest(manifest)});
  }
 }
 return {status:'EUROCONTROL_2018_REFERENCE',source:EUROCONTROL_2018_REFERENCE,rows:output,
  noRetrospectiveTuning:true,sourceComment:EUROCONTROL_2018_REFERENCE.sourceComment};
}
