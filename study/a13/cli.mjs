#!/usr/bin/env node
// A1.3 synthetic-only report; requires a clean checkout and writes outside Git.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {canonical,digest} from '../core.mjs';
import {CONFIG,validateConfig,replicate,fittedSpeedContrast,evaluateTakeoffIntervalGate,A11_LOCK_SHA256} from './model.mjs';
const args=process.argv.slice(2),index=args.indexOf('--out');
const out=resolve(index<0?'/tmp/a13-first-candidate.json':args[index+1]);
if(out.includes('/study/')||out.endsWith('/calibration-lock.json'))throw Error('No writes to study repository or lock');
if(args.includes('--fit-holdout')||args.includes('--operational'))throw Error('No holdout fitting or operational claims allowed');
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
const sha=git('rev-parse','HEAD');
if(git('status','--porcelain')&&!args.includes('--allow-dirty'))throw Error('Clean checkout required');
const config=validateConfig(JSON.parse(readFileSync(new URL('./MECHANICS_ONLY.json',import.meta.url),'utf8')));
const comparison=replicate(config);
const readyIntervalGate=evaluateTakeoffIntervalGate(config,{seeds:config.replication.seeds});
const anchorSensitivity=[260,340].map(jetAnchorKt=>{
 const comparison=replicate(config,{jetAnchorKt});
 return {jetAnchorKt,fit:comparison.fit,
  cases:comparison.cases.map(x=>({
   backgroundARRPerHour:x.backgroundArrivalsPerHour,
   requestedDEPPerHour:x.departureDemandPerHour,preset:x.preset,
   fifoDepH:x.fifo.departuresInHour.mean,candidateDepH:x.candidate.departuresInHour.mean,
   pairedDeltaDepH:x.pairedCandidateMinusFIFO.departuresInHour,
   meanGate40S:x.gateSummaries.candidate.gate40GapS.mean,
   medianGate40S:x.gateSummaries.candidate.gate40GapS.median,
   negativeGatePairs:x.candidate.sameExitNegativeGateGapCount.mean,
   swapAudit:x.swapAudit,
   pairedGate40GapCandidateMinusFIFO:x.pairedGate40GapCandidateMinusFIFO
  }))};
});
const report={schema:1,source:'SYNTHETIC_ONLY',status:'MECHANICS_ONLY_UNVALIDATED',
 commitSha:sha,configSha256:digest(config),mainBaseSha:config.mainBaseSha,
 a11LockSha256:A11_LOCK_SHA256,approvalScope:'A1_A2_A3_AND_120S_SENSITIVITY_ONLY',
 speedFit:fittedSpeedContrast(config),
 takeoffIntervalFitStatus:'FITTED_TO_SEP2026_TAKEOFF_INTERVALS_NO_HOLDOUT',
 preliminaryResequencingFinding:{status:'PRELIMINARY_MODERATE_CONFIDENCE_MECHANICS_ONLY',
  statement:'Limited one-position type/exit resequencing has little effect at modelled ELLX demand levels; possible longer-horizon DMAN/TSAT benefit lies outside A1.3',
  acceptedSwapsPerCell:comparison.cases.map(x=>({backgroundArrivalsPerHour:x.backgroundArrivalsPerHour,
   demandDeparturesPerHour:x.departureDemandPerHour,preset:x.preset,
   acceptedOver50Seeds:x.swapAudit.acceptedTotal,
   meanAdditionalDeparturesPerHour:x.pairedCandidateMinusFIFO.departuresInHour.mean,
   meanTotalDepartureDelayDeltaS:x.pairedCandidateMinusFIFO.totalDepartureDelayS.mean})),
  evidenceStatus:'SYNTHETIC_NOT_VALIDATED_NO_INDEPENDENT_HOLDOUT'},
 readyIntervalGate,jetAnchorSensitivity:anchorSensitivity,
 output:comparison,
 warnings:['No operational separation minima or ATC clearance rules are introduced',
 'GTQ 37% and other observed exit shares are descriptive, with unassigned 2% explicit',
 'FITTED_TO_SEP2026_TAKEOFF_INTERVALS_NO_HOLDOUT: model take-off times floored individually to UTC minutes for observed interval statistics; fitted development data, no independent holdout',
 'Preliminary resequencing result: rare feasible single-position swaps, no demonstrated departure throughput gain; DMAN/TSAT planned sequencing outside A1.3',
 'Only speed contrast is fit; 300kt jet anchor is hypothetical and unidentifiable from gate-gap changes',
 'Observed ~120s same-exit take-off spacing is a sensitivity preset only, CURRENT adds zero interval',
 '30/40 NM first outward radial crossings are synthetic gate-time proxies, not actual exit fixes',
 'CTOT/ATFM compliance NOT MODELLED',
 'No actual morning-wave traffic timestamps; background arrivals 1/h and 7/h are scenario family counts',
 'Any capacity, sector-entry separation or operational sequencing benefit is UNVALIDATED']};
mkdirSync(dirname(out),{recursive:true});const payload=canonical(report);
writeFileSync(out,payload);
const summary=comparison.cases.map(x=>({
 backgroundARRPerHour:x.backgroundArrivalsPerHour,requestedDEPPerHour:x.departureDemandPerHour,
 preset:x.preset,n:x.seedCount,
 fifo:{depH:x.fifo.departuresInHour.mean,arrH:x.fifo.arrivalsInHour.mean,
  totalDepDelayS:x.fifo.totalDepartureDelayS.mean},
 candidate:{depH:x.candidate.departuresInHour.mean,arrH:x.candidate.arrivalsInHour.mean,
  totalDepDelayS:x.candidate.totalDepartureDelayS.mean},
 pairedDeltaDepH:x.pairedCandidateMinusFIFO.departuresInHour,
 pairedDeltaDelayS:x.pairedCandidateMinusFIFO.totalDepartureDelayS,
 gateSameExit40:x.gateSummaries.candidate.gate40GapS,
 gateChanges:x.gateSummaries.candidate.change40ByOrderS,
 sameExitPairs:x.gateSummaries.candidate.sameExitPairs,
 evaluablePairs:x.gateSummaries.candidate.evaluableSameExitPairs,
 comparableWithin180:x.gateSummaries.candidate.within180SecondsComparablePopulation,
 observedGTQSharePercent:x.exitMixAudit.observedPercent.GTQ,
 realisedGTQSharePercent:x.exitMixAudit.syntheticPercent.GTQ,
 syntheticTPSharePercent:x.typeMixAudit.syntheticTPSharePercent,
 swapAudit:x.swapAudit,
 pairedGate40GapCandidateMinusFIFO:x.pairedGate40GapCandidateMinusFIFO,
 anySwap:x.acceptance.anySwap,allConserved:x.acceptance.allConserved}));
console.log(canonical({commitSha:sha,candidateSha256:digest(payload),
 a11LockSha256:A11_LOCK_SHA256,mainBaseSha:config.mainBaseSha,
 speedFit:report.speedFit,
 takeoffIntervalFitStatus:report.takeoffIntervalFitStatus,
 preliminaryResequencingFinding:report.preliminaryResequencingFinding,
 readyIntervalGate,anchorSensitivity:anchorSensitivity.map(x=>({
  jetAnchorKt:x.jetAnchorKt,fit:x.fit,cases:x.cases})),
 scenarioCount:comparison.cases.length,
 seedCount:comparison.seedCount,summary,outputPath:out}));
