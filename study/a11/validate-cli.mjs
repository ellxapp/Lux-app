#!/usr/bin/env node
// Cannot validate before calibration-lock.json has been approved AND committed.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {canonical} from '../core.mjs';
import {createHash} from 'node:crypto';
import {validateHoldout} from './validate.mjs';
const args=process.argv.slice(2);
const val=(key,def)=>{const i=args.indexOf(key);return i<0?def:args[i+1];};
const git=(...xs)=>execFileSync('git',xs,{encoding:'utf8'}).trim();
const path=val('--lock','study/a11/calibration-lock.json');
if(path!=='study/a11/calibration-lock.json')throw Error('Only the reviewed committed lock file is accepted');
const lockCommitSha=git('log','-1','--format=%H','--',path);
if(!/^[a-f0-9]{40}$/.test(lockCommitSha)||!git('ls-files','--',path))throw Error('No committed approved lock');
if(Boolean(git('status','--porcelain')))throw Error('Read-only evaluation requires clean git tree');
const lockBytes=readFileSync(path);
const attestation=JSON.parse(readFileSync('study/a11/calibration-approval.json','utf8'));
const rawSha256=createHash('sha256').update(lockBytes).digest('hex');
const blobSha1=git('hash-object',path);
if(attestation.lockPath!==path||attestation.lockSha256!==rawSha256||
   attestation.lockGitBlobSha1!==blobSha1||attestation.lockCommitSha!==lockCommitSha)
 throw Error('Approved lock byte-for-byte hash, Git blob or lock commit differs');
const lock=JSON.parse(lockBytes.toString('utf8'));
const development=JSON.parse(readFileSync('study/benchmarks/sep2026-dev-busy12.json','utf8'));
const holdout=JSON.parse(readFileSync(val('--holdout','study/benchmarks/sep2026-holdout-busy12.json'),'utf8'));
const result=validateHoldout({lock,attestation,development,holdout,lockCommitSha});
const out=resolve(val('--out','/tmp/a11-holdout-evaluation.json'));
if(out.includes('/study/'))throw Error('Output must stay outside repository');
mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,canonical(result));
console.log(canonical({status:result.status,output:out,lockCommitSha,lockSha256:rawSha256,
 hardMetricCount:result.results.length,maxErrorOverTolerance:Math.max(...result.results.map(x=>x.absoluteError===null?Infinity:x.absoluteError/x.tolerance)),
 results:result.results}));
if(result.status!=='PASS')process.exitCode=2;
