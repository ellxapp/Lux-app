import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTmaManifest,ASSUMPTIONS} from './tma.mjs';
import {HORIZONS,planTma,runB2,POLICY_ASSUMPTIONS} from './scenarios.mjs';
import {validateManifest,DEFAULT_CONFIG as A12} from '../a12/model.mjs';
const gate={stage:'B2b_S0',status:'PASS',canRunInterventions:true,
  interpretation:'TEST_FIXTURE_ONLY_NOT_REAL_CALIBRATION'};
const c={...A12,seed:20261116,arrivalCount:40,arrivalRequestStepMs:180000};
test('S1 freeze is capped by TMA entry with flow-dependent 5/8 minute horizon',()=>{
 const m=makeTmaManifest(20,20261116);
 for(const h of HORIZONS){
  const p=planTma(m,{policy:'S1',horizon:h});
  assert.equal(validateManifest(p.manifest,c),p.manifest);
  assert.ok(p.manifest.arrivals.every(a=>a.freezeMs>=a.tmaEntryMs&&
   a.requestMs>=a.eldtMs));
 }
});
test('S2 swaps at most adjacent unfrozen and preserves immutable IDs, A1.1 targets and departure request types',()=>{
 const m=makeTmaManifest(20,20261116);
 const p=planTma(m,{policy:'S2',horizon:'ENTRY'});
 assert.equal(validateManifest(p.manifest,c),p.manifest);
 assert.deepEqual(new Set(p.manifest.arrivals.map(a=>a.id)),
  new Set(m.arrivals.map(a=>a.id)));
 assert.deepEqual(p.manifest.opportunities.map(d=>[d.id,d.category,d.requestMs]),
  m.opportunities.map(d=>[d.id,d.category,d.requestMs]));
 assert.ok(p.swaps.every(s=>s.source==='UNVALIDATED_TACTICAL_EXECUTABILITY'));
});
test('S1/S2 and even B1 opt-in fail closed without a real gate',()=>{
 const m=makeTmaManifest(20,20261116);
 for(const policy of ['S0','S1','S2'])assert.throws(()=>runB2(m,{
  policy,horizon:policy==='S0'?null:'ENTRY',gate:{stage:'B2b_S0',status:'FAIL_NOT_VALIDATED'}
 }),/hard stop/);
});
test('synthetic TEST FIXTURE allows mechanics-only S1 S2 run; hard minima and request conservation remain',()=>{
 const m=makeTmaManifest(20,20261116);
 for(const policy of ['S0','S1','S2'])for(const withB1 of [false,true]){
  const x=runB2(m,{policy,horizon:policy==='S0'?null:'5MIN',withB1,gate});
  assert.equal(x.metrics.requestsTotal,x.metrics.processedTotal);
  assert.equal(x.metrics.hardMinimumViolations,0);
  assert.equal(x.manifestDigest.length,64);
  assert.equal(x.policy,policy);
 }
});
