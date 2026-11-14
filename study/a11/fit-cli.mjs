#!/usr/bin/env node
// Produce an unapproved candidate OUTSIDE the repository. NEVER writes calibration-lock.json.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fitDevelopment,FIT_POLICY,A11_PARAMETER_NAMES,APPROVED_TYPE_WEIGHTS} from './model.mjs';
import {canonical,digest} from '../core.mjs';

const args=process.argv.slice(2);
const val=(flag,otherwise)=>{const i=args.indexOf(flag);return i<0?otherwise:args[i+1];};
const getGit=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
const current=getGit('rev-parse','HEAD'),dirty=Boolean(getGit('status','--porcelain'));
const allowDirty=args.includes('--allow-dirty');
if(dirty&&!allowDirty)throw Error('Dirty git tree: use --allow-dirty; never pass this option in CI');
if(Number(process.versions.node.split('.')[0])<20)throw Error('Node 20+ required');
const source=val('--development','study/benchmarks/sep2026-dev-busy12.json');
if(!source.endsWith('sep2026-dev-busy12.json'))throw Error('Fitting accepts only the approved development benchmark');
const benchmark=JSON.parse(readFileSync(source,'utf8'));
const out=resolve(val('--candidate-out','/tmp/a11-calibration-lock.candidate.json'));
if(out.endsWith('/calibration-lock.json')||out.includes('/study/'))throw Error('Candidate must not write into repo or use calibration-lock.json');
// A lock candidate is always produced with the ONE frozen published fitting policy.
// Small or shortened runs are possible only via direct unit-test APIs, not lock CLI.
if(args.includes('--days')||args.includes('--per-day')||args.includes('--rounds')||args.includes('--seed'))
 throw Error('A1.1 lock candidate must use the single published FIT_POLICY; no sampling/round overrides');
const fitted=fitDevelopment(benchmark,FIT_POLICY);
const {days,perDay,maxRounds}=FIT_POLICY;
const minCoverage={overall_5NM:5000,'J-J':1000,'J-TP':1000,'TP-J':1000};
const coverage=Object.fromEntries(Object.entries(fitted.output.observations).map(([id,x])=>[id,x.nPairs]));
const meetsSample=Object.entries(minCoverage).every(([id,n])=>(coverage[id]||0)>=n);
if(!meetsSample)throw Error('Insufficient synthetic busy-pair coverage: '+JSON.stringify({coverage,minimum:minCoverage}));
const candidate={
 schema:1,status:'CANDIDATE_NOT_APPROVED',sourceStatus:'OBSERVED_AGGREGATE_DEV',
 sourceComment:'https://github.com/ellxapp/panel/issues/6#issuecomment-6868493243',
 codeCommitSha:current,dirty,allowDirty,nodeVersion:process.version,createdBy:'A1.1 deterministic CI fit',
 benchmarkSha256:digest(benchmark),extractionExportSha256:benchmark.extractionExportSha256,
 captureDigest:fitted.provenance.captureDigest,
 observationOperator:'busy12_event_window_half_open_v1',
 fittingObjective:'minimax_absolute_normalised_error',
 typeMap:benchmark.typeMap,hardMetricCount:12,hardTolerances:benchmark.hardTolerances,
 bootstrap:benchmark.bootstrap,days:benchmark.days,
 samplePolicy:fitted.provenance.samplePolicy,seed:FIT_POLICY.seed,
 parameterNames:A11_PARAMETER_NAMES,typeMixWeights:APPROVED_TYPE_WEIGHTS,
 parameterFamily:'SHARED_TWO_COMPONENT_SHIFTED_LOGNORMAL',freeParameterCount:8,
 stopping:fitted.stopping,converged:fitted.stopping.converged,
 fitPolicySha256:digest(FIT_POLICY),
 parameters:fitted.parameters,modelVersion:fitted.provenance.modelVersion,
 targetMeaning:fitted.provenance.targetMeaning,
 metricComparisons:fitted.score.hardMetrics.map(x=>({stratum:x.id,metric:x.metric,target:x.target,
  fitted:Number.isFinite(x.actual)?x.actual:null,tolerance:x.tolerance,normalisedError:Number.isFinite(x.normalised)?x.normalised:null})),
 fitScore:Number.isFinite(fitted.score.maxNormalisedError)?fitted.score.maxNormalisedError:null,
 floorRaising:fitted.output.totals,
 syntheticHourlyCountStatus:fitted.output.meta.hourlyCountStatus,
 rotProxyStatus:'SYNTHETIC_UNVALIDATED_MINIMUM_THRESHOLD_INTERVAL',
 syntheticCoverage:Object.fromEntries(Object.entries(fitted.output.observations).map(([id,s])=>[id,{nPairs:s.nPairs,nPairsWithDistance:s.nPairsWithDistance}])),
 representable:!fitted.score.fitNotRepresentable,
 warnings:['Non-operational simplified A1.1 synthetic model','No holdout observations have been read','CAPTURE_EMPIRICAL_SEP2026_DEV is aggregate censoring, not a final-track geometry model',
 '4-2NM IAS estimates are median proxies, not terminal speed certification']
};
const serial=canonical(candidate);
mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,serial,'utf8');
console.log(canonical({candidatePath:out,candidateSha256:digest(serial),
 status:candidate.status,fitScore:candidate.fitScore,representable:candidate.representable,
 stopping:candidate.stopping,converged:candidate.converged,
 hardMetricCount:12,syntheticCoverage:coverage,sourceCommit:current,outputNotCommitted:true}));
