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
 mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report));
 const show=report.results.filter(r=>r.rate===30&&r.gapPolicy==='DISTANCE'&&
  (r.policy==='S0'||r.horizon==='ENTRY')).map(r=>({
   policy:r.policy,horizon:r.horizon,b1P1:r.withB1,
   arrivalRate:r.mean.arrivalRate,departureRate:r.mean.departureRate,
   servedByDrain:r.mean.servedArrivalsByDrain,
   tmaExcessMeanS:r.mean.tmaExcessMeanS,
   holdingMeanS:r.mean.holdingMeanS,
   pathStretchMeanNM:r.mean.pathStretchMeanNM,
   pairedArrivalGain:r.pairedMinusS0.arrivalRate,
   joinReachableShare:r.mean.joinReachableShare,
   swaps:r.mean.resequenceSwaps
  }));
 console.log(JSON.stringify({stage:'B2b',status:'CANDIDATE_NON_OPERATIONAL',
  gate:report.gate.status,reference:report.reference,
  horizons:report.horizons,nCells:report.results.length,pairedSeeds:report.pairedSeeds,
  output,examples30h:show,warnings:report.warnings}));
}
