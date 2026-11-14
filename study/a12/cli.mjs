#!/usr/bin/env node
// A1.2 standalone synthetic comparison. No private source data, fitting or lock writes.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {canonical,digest} from '../core.mjs';
import {makeManifest,pairedScenarios,validateConfig,A12_VERSION} from './model.mjs';
const args=process.argv.slice(2);
const opt=(flag,fallback)=>{const i=args.indexOf(flag);return i<0?fallback:args[i+1];};
const git=(...xs)=>execFileSync('git',xs,{encoding:'utf8'}).trim();
const sha=git('rev-parse','HEAD'),dirty=Boolean(git('status','--porcelain'));
if(dirty&&!args.includes('--allow-dirty'))throw Error('A1.2 report requires clean checkout');
if(args.includes('--development-fit')||args.includes('--holdout-fit'))throw Error('A1.2 calibration prohibited');
const path=opt('--config','study/a12/MECHANICS_ONLY.json');
if(path!=='study/a12/MECHANICS_ONLY.json')throw Error('Use only the published unvalidated scenario preset');
const cfg=validateConfig(JSON.parse(readFileSync(path,'utf8')));
const manifest=makeManifest(cfg);
const result=pairedScenarios(manifest,cfg);
const output=resolve(opt('--out','/tmp/a12-first-candidate.json'));
if(output.includes('/study/')||output.endsWith('/calibration-lock.json'))throw Error('No writing candidate to repository');
const report={schema:1,status:'A12_MECHANICS_ONLY_UNVALIDATED',commitSha:sha,dirty,nodeVersion:process.version,
 version:A12_VERSION,manifestSha256:digest(manifest),configSha256:digest(cfg),
 config:cfg,referenceStatuses:{development:'OBSERVED_AGGREGATE_DEV_NOT_FIT',
 holdout:'REPORT_ONLY_NOT_FIT'},summary:{
  scenarios:result.scenarios.map(s=>({sequence:s.meta.sequence,policy:s.meta.policy,
   totals:s.totals,metrics:s.metrics,manifestSha256:s.meta.manifestSha256,
   fullDetailDigest:digest(s)})),
  feasibility:result.feasibility},
 warnings:['Not ATC instructions, capacity certification or operational runway clearance rules',
 'Synthetic timing parameters are UNVALIDATED and not inferred from ANA internal events',
 'Observational intP10 is a minimum feasibility screen, not a measured procedure minimum',
 'Holdout data are report-only and never used to fit timings',
 'No A1.1 model, lock, or statistical tolerance is modified']};
mkdirSync(dirname(output),{recursive:true});
const serial=canonical(report);
writeFileSync(output,serial,'utf8');
console.log(canonical({output,commitSha:sha,status:report.status,manifestSha256:report.manifestSha256,
 candidateSha256:digest(serial),scenarios:report.summary.scenarios,feasibility:report.summary.feasibility}));
