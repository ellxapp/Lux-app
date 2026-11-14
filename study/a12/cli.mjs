#!/usr/bin/env node
// A1.2 standalone synthetic comparison. No private source data, fitting or lock writes.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {canonical,digest} from '../core.mjs';
import {compareDemandLevels,validateConfig,A12_VERSION,A11_SPACING_PROVENANCE} from './model.mjs';
const args=process.argv.slice(2);
const opt=(flag,fallback)=>{const i=args.indexOf(flag);return i<0?fallback:args[i+1];};
const git=(...xs)=>execFileSync('git',xs,{encoding:'utf8'}).trim();
const sha=git('rev-parse','HEAD'),dirty=Boolean(git('status','--porcelain'));
if(dirty&&!args.includes('--allow-dirty'))throw Error('A1.2 report requires clean checkout');
if(args.includes('--development-fit')||args.includes('--holdout-fit'))throw Error('A1.2 calibration prohibited');
const path=opt('--config','study/a12/MECHANICS_ONLY.json');
if(path!=='study/a12/MECHANICS_ONLY.json')throw Error('Use only the published unvalidated scenario preset');
const cfg=validateConfig(JSON.parse(readFileSync(path,'utf8')));
const result=compareDemandLevels(cfg);
const output=resolve(opt('--out','/tmp/a12-first-candidate.json'));
if(output.includes('/study/')||output.endsWith('/calibration-lock.json'))throw Error('No writing candidate to repository');
const report={schema:1,status:'A12_MECHANICS_ONLY_UNVALIDATED',commitSha:sha,dirty,nodeVersion:process.version,
 version:A12_VERSION,configSha256:digest(cfg),a11Spacing:A11_SPACING_PROVENANCE,
 comparisonLabel:'CONDITIONAL_ON_UNVALIDATED_GROUND_EVENT_DURATIONS',
 demandLevelsPerHour:cfg.arrivalDemandLevelsPerHour,
 overallObservedValidityStatus:result.overallObservedValidityStatus,
 saturatedArrivalOnly:result.saturatedArrivalOnly,
 config:cfg,referenceStatuses:{development:'OBSERVED_AGGREGATE_DEV_NOT_FIT',
 holdout:'REPORT_ONLY_NOT_FIT'},summary:{
  levels:result.levels.map(level=>({
   arrivalsPerHour:level.arrivalsPerHour,manifestSha256:level.manifestSha256,
   requestedArrivals:level.requestedArrivals,
   requestedDepartureOpportunities:level.requestedDepartureOpportunities,
   lockedArrivalFloorRaising:level.lockedArrivalFloorRaising,
   observedValidityGate:level.observedValidityGate,
   scenarios:level.scenarios.map(x=>({sequence:x.meta.sequence,policy:x.meta.policy,
    totals:x.totals,metrics:x.metrics,manifestSha256:x.meta.manifestSha256,
    a11Spacing:x.meta.a11Spacing,fullDetailDigest:digest(x)})),
   feasibility:level.feasibility
  }))},
 warnings:['Not ATC instructions, capacity certification or operational runway clearance rules',
 'Synthetic timing parameters are UNVALIDATED and not inferred from ANA internal events',
 'Observational intP10 is a minimum feasibility screen, not a measured procedure minimum',
 'Holdout data are report-only and never used to fit timings',
 'No A1.1 model, lock, or statistical tolerance is modified',
 'Scenario outcomes and deltas are conditional on unvalidated ground-event durations and arrival deferral assumptions']};
mkdirSync(dirname(output),{recursive:true});
const serial=canonical(report);
writeFileSync(output,serial,'utf8');
console.log(canonical({output,commitSha:sha,status:report.status,
 candidateSha256:digest(serial),a11LockSha256:A11_SPACING_PROVENANCE.lockSha256,
 overallObservedValidityStatus:report.overallObservedValidityStatus,
 saturatedArrivalOnly:report.saturatedArrivalOnly,
 comparisonLabel:report.comparisonLabel,levels:report.summary.levels.map(level=>({
  arrivalsPerHour:level.arrivalsPerHour,manifestSha256:level.manifestSha256,
  requestedArrivals:level.requestedArrivals,
  requestedDepartureOpportunities:level.requestedDepartureOpportunities,
  lockedArrivalFloorRaising:level.lockedArrivalFloorRaising,
  observedValidityGate:level.observedValidityGate,
  scenarios:level.scenarios.map(x=>({sequence:x.sequence,policy:x.policy,
   totals:x.totals,metrics:x.metrics})),
  feasibility:level.feasibility
 }))}));
