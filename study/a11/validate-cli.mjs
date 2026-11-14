#!/usr/bin/env node
// Cannot validate before calibration-lock.json has been approved AND committed.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {canonical} from '../core.mjs';
import {validateHoldout} from './validate.mjs';
const args=process.argv.slice(2);
const val=(key,def)=>{const i=args.indexOf(key);return i<0?def:args[i+1];};
const git=(...xs)=>execFileSync('git',xs,{encoding:'utf8'}).trim();
const path=val('--lock','study/a11/calibration-lock.json');
if(path!=='study/a11/calibration-lock.json')throw Error('Only the reviewed committed lock file is accepted');
const lockCommitSha=git('log','-1','--format=%H','--',path);
if(!/^[a-f0-9]{40}$/.test(lockCommitSha)||!git('ls-files','--',path))throw Error('No committed approved lock');
if(Boolean(git('status','--porcelain')))throw Error('Read-only evaluation requires clean git tree');
const lock=JSON.parse(readFileSync(path,'utf8'));
const development=JSON.parse(readFileSync('study/benchmarks/sep2026-dev-busy12.json','utf8'));
const holdout=JSON.parse(readFileSync(val('--holdout','study/benchmarks/sep2026-holdout-busy12.json'),'utf8'));
const result=validateHoldout({lock,development,holdout,lockCommitSha});
const out=resolve(val('--out','/tmp/a11-holdout-evaluation.json'));
if(out.includes('/study/'))throw Error('Output must stay outside repository');
mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,canonical(result));
console.log(canonical({status:result.status,output:out,lockCommitSha}));
if(result.status!=='PASS')process.exitCode=2;
