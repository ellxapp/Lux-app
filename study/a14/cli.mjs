#!/usr/bin/env node
// A1.4 candidate: mechanics-only, no operational or empirical holdout pass.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {canonical,digest} from '../core.mjs';
import {CONFIG,validate,VERSION,BASELINE,SENSITIVITY,
 feasibleMixedGap,runReplication,makeManifest,simulate,classifyMetar,casaDecision} from './model.mjs';

const args=process.argv.slice(2),idx=args.indexOf('--out');
const out=resolve(idx<0?'/tmp/a14-lvp-candidate.json':args[idx+1]);
if(out.includes('/study/')||out.endsWith('calibration-lock.json'))throw Error('No repo/lock writes');
if(args.includes('--operational')||args.includes('--fit-holdout'))throw Error('Not operational or holdout fitting');
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
const head=git('rev-parse','HEAD');
if(git('status','--porcelain'))throw Error('Candidate requires clean Git tree');
const c=validate(JSON.parse(readFileSync(new URL('./MECHANICS_ONLY.json',import.meta.url),'utf8')));
const r=runReplication(c);
const missFixture=makeManifest(c,{seed:42,arrivalOnly:true});
missFixture.arrivals[0].heavyCriticalAreaOccupied=true;
missFixture.arrivals[0].criticalHeavyInboundNM=11;
const missRun=simulate(missFixture,c,{entryPolicy:BASELINE});
const catIOnly=casaDecision({arrival:{id:'SYN-CAT-I',catIOnlyRequested:true},
 phase:'NOTIFICATION',taxiInCasa:true,followerAt2NmMs:1000,
 leaderLandingRunEndMs:2000,casaClearMs:3000},c);
const defaultCasa=casaDecision({arrival:{id:'SYN-CAT-II-III'},phase:'NOTIFICATION',
 taxiInCasa:true,followerAt2NmMs:1000,leaderLandingRunEndMs:2000,
 casaClearMs:3000},c);
const explicitEventFixtures={
 heavyCriticalMiss:{flightId:missRun.arrivals[0].id,
  attemptId:missRun.arrivals[0].attemptId,
  missedApproaches:missRun.totals.missedApproaches,
  events:missRun.events.filter(x=>x.event==='MISSED_APPROACH'),
  originalDemand:missRun.totals.arrivalRequests},
 catIOnlyTaxiCasa:catIOnly,defaultFullCasa:defaultCasa,
 exactly200Ft:classifyMetar({visibilityM:5000,ceilingFt:200,rvrAM:1200},c)
};
const report={schema:14,status:'MECHANICS_ONLY_UNVALIDATED_WITH_WINTER_DESCRIPTIVES',
 headSha:head,baseMainSha:c.baseMainSha,version:VERSION,configSha256:digest(c),
 provenance:c.sources,weatherSource:c.lvpStateSource,
 winterReferencePopulation:c.observedWinter.pairsPopulation,
 noHeldOutWinterValidation:true,
 baseline:BASELINE,conditionalSensitivity:SENSITIVITY,
 observedShareBelowBaselineMin:{
  value:c.observedWinter.lvpWithDeparture.belowBaselineMinimumShare,
  status:c.observedWinter.lvpWithDeparture.shareStatus,
  note:'Not inferable from only P10/median/P90; Claude to provide if available'},
 winterFeasibility:r.baselineMixedFeasibility,
 conditionalEntrySensitivity:r.conditionalSensitivity,
 scenarios:r.cases,
 explicitEventFixtures,
 references:r.observedWinter,
 warnings:r.warnings};
mkdirSync(dirname(out),{recursive:true});
const payload=canonical(report);writeFileSync(out,payload);
const slim=r.cases.map(x=>({phase:x.phase,arrivalOnly:x.arrivalOnly,
 entryPolicy:x.entryPolicy,n:x.n,allDemandReconciled:x.allDemandReconciled,
 hourlyArrivals:x.metrics.arrivalRatePerHour,hourlyDepartures:x.metrics.departureRatePerHour,
 totalHourlyMovements:x.metrics.totalMovementsInHour,
 planningShortfalls:x.metrics.planningShortfalls,
 holds:x.metrics.departureHolds,
 intervalMedianS:x.arrivalIntervalMedianS,
 spacingMedianNM:x.deliveredSpacingMedianNM}));
const baselineSensitivity=Object.values(['MEDIUM','HEAVY']).map(category=>({
 category,baseline:feasibleMixedGap(c,{category}),conditionalHypothetical:
 feasibleMixedGap(c,{category,entryPolicy:SENSITIVITY}),
 rotSensitivity:c.synthetic.arrivalROTSensitivityMs.map(rotMs=>
  ({rotMs,baseline:feasibleMixedGap(c,{category,rotMs})}))}));
console.log(canonical({headSha:head,candidateSha256:digest(payload),configSha256:digest(c),
 version:VERSION,status:report.status,seedCount:c.scenario.seedCount,scenarioCount:r.cases.length,
 feasibility:r.baselineMixedFeasibility,observedBelowMinShare:report.observedShareBelowBaselineMin,
 baselineSensitivity,explicitEventFixtures,summary:slim,outputPath:out}));
