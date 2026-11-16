#!/usr/bin/env node
// B1 non-operational sensitivity output. Run from a clean local Git checkout.
import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {canonical,digest} from '../core.mjs';
import {CONFIG,VERSION,runSweep} from './model.mjs';
const args=process.argv.slice(2),k=args.indexOf('--out');
if(args.includes('--operational')||args.includes('--fit')||args.includes('--approve'))
 throw Error('B1 is NOT operational and cannot fit unobserved tool effects');
const out=resolve(k>=0?args[k+1]:'/tmp/b1-spacing-sensitivity.json');
if(!out.startsWith('/tmp/')||out.endsWith('calibration-lock.json'))
 throw Error('B1 artifacts must be written outside the repository under /tmp');
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
if(git('status','--porcelain'))throw Error('Requires clean checkout for provenance');
const head=git('rev-parse','HEAD');
const sweep=runSweep();
const report={...sweep,headSha:head,configDigest:digest(CONFIG),version:VERSION,
 methodology:'50 PAIRED SEEDS PER CELL; 95 PERCENT PAIRED BOOTSTRAP CI; NO ELLX TOOL PERFORMANCE DATA',
 sources:[6917392204,6917463722],limits:CONFIG.modelLimits};
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,canonical(report));
console.log(canonical({headSha:head,version:VERSION,output:out,rows:sweep.results.length,
 seedsPerCell:CONFIG.replication.seeds,configDigest:digest(CONFIG),
 nonOperational:true,source:sweep.joinInput.id,
 zeroRIdentities:sweep.results.filter(x=>x.r===0).every(x=>
  x.pairedToolMinusBaseline.arrivalRatePerHour.mean===0&&
  x.pairedToolMinusBaseline.departureRatePerHour.mean===0)}));
