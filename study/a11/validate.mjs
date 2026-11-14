// Pure read-only verification against a sealed/approved pooled holdout export.
// No fitting or parameter modification is permitted after lock commit.
import {makeScenarioManifest,evaluateSynthetic} from './model.mjs';
import {hardMetrics} from './observation.mjs';
import {digest} from '../core.mjs';

export function validateHoldout({lock,attestation,development,holdout,lockCommitSha}){
 if(!/^[a-f0-9]{40}$/.test(lockCommitSha||''))throw Error('Committed lock SHA required');
 // The approved lock is deliberately immutable and still says CANDIDATE_NOT_APPROVED.
 // Philip's approval is a separate, strongly bound attestation.
 if(!attestation||attestation.status!=='APPROVED_LOCK'||
    attestation.attestationKind!=='SEPARATE_APPROVAL_DOES_NOT_MODIFY_LOCK'||
    attestation.approvedBy!=='Philip'||
    attestation.lockSha256!=='be55a9622ce770ea0f66bfdcc6d582f53948577c8e1f4bb4ffda72a7026a85fb'||
    attestation.lockSha256!==digest(lock)||
    attestation.lockCommitSha!==lockCommitSha||
    attestation.modelSourceCommitSha!==lock.codeCommitSha||
    lock.status!=='CANDIDATE_NOT_APPROVED'||lock.hardMetricCount!==12)
  throw Error('Not an approved and digest-bound 12-metric lock');
 if(lock.benchmarkSha256!==digest(development))throw Error('Development benchmark mismatch');
 if(lock.sourceStatus!=='OBSERVED_AGGREGATE_DEV'||holdout.status!=='OBSERVED_AGGREGATE_HOLDOUT')throw Error('invalid input roles');
 if(lock.hardMetricCount!==hardMetrics(development).length)throw Error('hard metric count changed');
 if(!Array.isArray(holdout.days)||holdout.days.join(',')!==development.days.holdout.join(',')||
    attestation.holdoutDates.join(',')!==holdout.days.join(','))throw Error('holdout days changed');
 if(holdout.lockSha256!==attestation.lockSha256||holdout.lockCommitSha!==lockCommitSha)
  throw Error('Holdout export is not bound to approved locked commit');
 if(!holdout.strata||!Array.isArray(holdout.strata))throw Error('missing holdout strata');
 // Recompute predicted model outcomes from locked parameters, not holdout-derived parameters.
 const sample=lock.samplePolicy;
 const synthetic=evaluateSynthetic(makeScenarioManifest({seed:lock.seed,days:sample.days,perDay:sample.perDay}),lock.parameters);
 // Frozen fitted targets MUST remain unchanged after the lock. No recalibration,
 // no silent runner changes, no holdout-informed model parameters.
 const frozen=new Map(lock.metricComparisons.map(x=>[x.stratum+'|'+x.metric,x.fitted]));
 for(const h of hardMetrics(development)){
  const predicted=synthetic.observations[h.id]?.[h.metric];
  const recorded=frozen.get(h.id+'|'+h.metric);
  if(!Number.isFinite(predicted)||!Number.isFinite(recorded)||Math.abs(predicted-recorded)>1e-9)
   throw Error('Locked predicted metric mismatch: '+h.id+'/'+h.metric);
 }
 const results=[];
 for(const h of hardMetrics(development)){
  const observed=holdout.strata.find(s=>s.id===h.id);
  const number=observed?.[h.metric];
  const isDistance=h.metric.startsWith('dist')||h.metric==='fracBelow5';
  const n=isDistance?observed?.nPairsWithDistance:observed?.nPairs;
  const nDays=isDistance?observed?.nDaysWithDistance:observed?.nDays;
  const predicted=synthetic.observations[h.id]?.[h.metric];
  let status='PASS',absoluteError=null;
  if(!Number.isFinite(n)||n<15||!Number.isFinite(nDays)||nDays<5)status='INSUFFICIENT_HOLDOUT';
  else if(!Number.isFinite(number)||!Number.isFinite(predicted))status='NOT_EVALUATED';
  else {
   absoluteError=Math.abs(number-predicted);
   if(absoluteError>h.tolerance+1e-12)status='FAIL';
  }
  results.push({stratum:h.id,metric:h.metric,observed:number??null,predicted:predicted??null,
   tolerance:h.tolerance,absoluteError,status,nPairs:observed?.nPairs??null,
   nPairsWithDistance:observed?.nPairsWithDistance??null,nDays:nDays??null});
 }
 const status=results.every(r=>r.status==='PASS')?'PASS':
   results.some(r=>r.status==='FAIL')?'FAIL':results.some(r=>r.status==='INSUFFICIENT_HOLDOUT')?'INSUFFICIENT_HOLDOUT':'NOT_EVALUATED';
 return {status,results,provenance:{status:'FITTED_SYNTHETIC_VS_OBSERVED_AGGREGATE_HOLDOUT',
  lockCommitSha,lockSha256:digest(lock),approvalAttestationSha256:digest(attestation),developmentSha256:digest(development),
  holdoutSha256:digest(holdout),captureDigest:lock.captureDigest,seed:lock.seed,
  noRefit:true,holdoutDays:holdout.days}};
}
