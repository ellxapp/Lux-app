#!/usr/bin/env node
// Non-operational B3 sensitivity, never a P-ATC-LVP authorisation.
import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {canonical,digest} from '../core.mjs';
import {CONFIG,VERSION,runSweep} from './model.mjs';
const args=process.argv.slice(2),i=args.indexOf('--out');
if(args.some(x=>['--operational','--fit','--approve'].includes(x)))
 throw Error('B3 cannot authorise LVP operation or fit unobserved Tclear');
const output=resolve(i>=0?args[i+1]:'/tmp/b3-lvp-leader-spacing.json');
if(!output.startsWith('/tmp/'))throw Error('Artifact must remain outside Git repository under /tmp');
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
if(git('status','--porcelain'))throw Error('Requires clean tree for reproducible commit provenance');
const headSha=git('rev-parse','HEAD');
const report={...runSweep(),headSha,configSha256:digest(CONFIG),
 generatedFrom:'NON_OPERATIONAL_HYPOTHETICAL_RWY24_LVP_APPROVED_STUDY',
 referenceComments:CONFIG.approval,
 method:'EXACT_ANALYTIC_T_CLEAR_QUANTILES_L2;_REALIZED_GO_AROUNDS_CLOPPER_PEARSON'};
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,canonical(report));
// One reproducible compact comparison per winter demand, DEP case and missed-exit p.
// The complete 2250-cell matrix, exit extrema and Tclear sensitivities are in the JSON.
const compact=x=>({rate:x.rate,depPerHour:x.depPerHour,pMiss:x.pMiss,
 policy:x.policy,target:x.target,arrivalsPerHour:x.means.arrivalsPerHour,
 deltaVersusL0:x.pairedPolicyMinusL0.arrivalsPerHour,
 casaGoAroundExact95:x.casaGoAroundExact95});
const central=report.scenarios.filter(x=>x.scale===1&&x.mix==='EQUAL_SPLIT');
console.log(canonical({headSha,version:VERSION,configSha256:digest(CONFIG),
 output,scenarios:report.scenarioCount,pairedSeeds:CONFIG.seeds,
 baselineGate:report.feasibilityGate,
 winterHeadline10to16:central.filter(x=>x.headlineWinter).map(compact),
 saturatedProbe20:central.filter(x=>x.saturatedProbe).map(compact),
 warnings:report.warnings}));
