#!/usr/bin/env node
// Historical technical-reference discrepancy, NEVER a calibrator.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {run2018Illustration} from './2018.mjs';
import {canonical,digest} from '../core.mjs';
const git=(...xs)=>execFileSync('git',xs,{encoding:'utf8'}).trim();
if(git('status','--porcelain'))throw Error('2018 reproducibility requires clean repo');
const sha=git('rev-parse','HEAD');
const config=JSON.parse(readFileSync('study/presets/EUROCONTROL_2018.json','utf8'));
const report=run2018Illustration(config,{commitSha:sha,count:70,stepMs:18000});
const out=resolve(process.argv[2]||'/tmp/a11-2018-discrepancy.json');
if(out.includes('/study/'))throw Error('Write report outside the repo');
mkdirSync(dirname(out),{recursive:true});
const data=canonical({provenance:{codeCommitSha:sha,nodeVersion:process.version,configSha256:digest(config)},...report});
writeFileSync(out,data,'utf8');
console.log(canonical({reportPath:out,sha256:digest(data),rows:report.rows.length,
  comparisonStatuses:[...new Set(report.rows.map(x=>x.comparison))],notCalibration:true}));
