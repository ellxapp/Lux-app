#!/usr/bin/env node
// B2b stage candidate, ALL intervention results blocked unless actual S0 gate passes.
// Outputs aggregate-only, non-operational synthetic results to /tmp.
import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {evaluateS0} from './tma.mjs';
import {runB2Sweep} from './scenarios.mjs';
const a=process.argv.slice(2),k=a.indexOf('--out');
const output=resolve(k<0?'/tmp/b2-sequencing-candidate.json':a[k+1]);
if(!output.startsWith('/tmp/'))throw Error('No B2 artefact in repository or private staff directories');
const s0=evaluateS0({seeds:50});
if(s0.gate.status!=='PASS'){
 console.log(JSON.stringify({stage:'B2b',status:'BLOCKED_S0_FAIL',
  residuals:s0.gate.diagnostics,calibration:s0.data,
  noInterventionResults:true}));
 process.exitCode=2;
}else{
 const report=runB2Sweep({seeds:50});
 // N1 reporting only. No model, scheduler, calibration or pairing changes.
 // Headline: realistic-demand cases. Holding values are MODEL-ALLOCATED, NOT observed.
 const summarize=r=>({
  policy:r.policy,horizon:r.horizon,b1P1:r.withB1,
  meanTmaExcessOverP10S:r.mean.tmaExcessMeanS,
  assumedHoldingS:r.mean.holdingMeanS,
  assumedPathStretchS:r.mean.pathStretchMeanS,
  assumedSpeedS:r.mean.speedMeanS,
  syntheticServedArrivalsPerHour:r.mean.arrivalRate,
  pairedArrivalDifference:r.pairedMinusS0.arrivalRate
 });
 const mainRates=[20,22,24];
 const find=(rate,policy,horizon,withB1)=>report.results.find(r=>
  r.rate===rate&&r.gapPolicy==='DISTANCE'&&r.policy===policy&&
  r.horizon===horizon&&r.withB1===withB1);
 const realisticDemand=mainRates.map(rate=>({
  requestedArrivalsPerHour:rate,
  S0:summarize(find(rate,'S0',null,false)),
  S1_ENTRY:summarize(find(rate,'S1','ENTRY',false)),
  B1_P1:summarize(find(rate,'S0',null,true)),
  S1_ENTRY_B1_P1:summarize(find(rate,'S1','ENTRY',true))
 }));
 const capacityProbe={
  requestedArrivalsPerHour:30,
  classification:'SATURATED_SYNTHETIC_CAPACITY_PROBE_ONLY_NOT_DELAY_ESTIMATE',
  reason:'Holding accumulates with simulation session length; never treat as an operational delay estimate',
  S0:summarize(find(30,'S0',null,false)),
  S1_ENTRY_B1_P1:summarize(find(30,'S1','ENTRY',true))
 };
 const presentation={
  primaryDemandRatesPerHour:mainRates,
  scenario:'DISTANCE_GAP_HYPOTHETICAL_NON_OPERATIONAL',
  delayMeaning:'MODELLED_EXCESS_OVER_B2A_P10_PROXY_NOT_DIRECTLY_OBSERVED_ATC_DELAY',
  assumedHoldingMeaning:'UNOBSERVED_MODEL_RESIDUAL_AFTER_ASSUMED_SPEED_AND_PATH_EXTENSION',
  empiricalInputs:'B2a measured total transit excess and path-stretch envelopes; NOT holding durations',
  holdingAndStretchAreNotObserved:true,
  capacityProbeIsNotDelayEstimate:true,
  realisticDemand,capacityProbe
 };
 const artifact={...report,reporting:presentation};
 mkdirSync(dirname(output),{recursive:true});
 writeFileSync(output,JSON.stringify(artifact));
 console.log(JSON.stringify({stage:'B2b',status:'CANDIDATE_NON_OPERATIONAL',
  gate:report.gate.status,reference:report.reference,
  horizons:report.horizons,nCells:report.results.length,pairedSeeds:report.pairedSeeds,
  output,headline:realisticDemand,capacityProbe,
  holdingAndStretchAreNotObserved:true,warnings:report.warnings}));
}
