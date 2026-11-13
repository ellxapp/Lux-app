#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {canonical,makeManifest,runStudy,csv,paired} from './core.mjs';
if(Number(process.versions.node.split('.')[0])<20)throw Error('Node 20+ required');
const args=process.argv.slice(2);
const option=(name,fallback)=>{const ix=args.indexOf(name);return ix<0?fallback:args[ix+1];};
const configPath=option('--config','study/presets/SYNTH.json');
const outDir=option('--out','/tmp/lux-study-a');
const comparePath=option('--compare',null);
const allowDirty=args.includes('--allow-dirty');
const git=(...xs)=>execFileSync('git',xs,{encoding:'utf8'}).trim();
const commitSha=git('rev-parse','HEAD');
const dirty=Boolean(git('status','--porcelain'));
if(dirty&&!allowDirty)throw Error('Refusing dirty working copy. Use --allow-dirty to record an override.');
const c=JSON.parse(readFileSync(configPath,'utf8'));
const count=Number(option('--count','200'));
const seed=Number(option('--seed','42'));
const stepMs=Number(option('--step-ms','18000'));
const departureModulo=Number(option('--departure-modulo','4'));
const manifest=makeManifest({seed,count,startUtc:c.startUtc,stepMs,departureModulo});
const provenance={commitSha,nodeVersion:process.version,dirty,allowDirty};
const result=runStudy(manifest,c,provenance);
mkdirSync(outDir,{recursive:true});
const put=(name,s)=>writeFileSync(resolve(outDir,name),s,'utf8');
put('manifest.json',canonical({provenance,manifest}));
put('summary.json',canonical({...result,events:undefined,flights:undefined}));
put('events.json',canonical({provenance,events:result.events}));
put('flights.csv',csv(result.flights.map(f=>({...f,commitSha,nodeVersion:process.version,dirty}))));
if(comparePath){
 const other=JSON.parse(readFileSync(comparePath,'utf8'));
 const next=runStudy(manifest,other,provenance);
 put('paired.json',canonical({provenance,comparison:paired(result,next)}));
}
console.log(canonical({outDir,provenance,totals:result.totals,capacity_eligible:result.capacity_eligible,metrics:result.metrics}));
