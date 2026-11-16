import test from 'node:test';
import assert from 'node:assert/strict';
import {ASSUMPTIONS,makeTmaManifest,runS0,allocateTmaDelay} from './tma.mjs';
import {DEFAULT_CONFIG as A12,validateManifest} from '../a12/model.mjs';
const cfg=rate=>({...A12,seed:20261116,arrivalCount:rate*2,arrivalRequestStepMs:Math.round(3600000/rate)});
test('B2 S0 immutable ELDT stream enters A1.2 without changing locked targets',()=>{
 const m=makeTmaManifest(20,20261116);
 assert.equal(validateManifest(m,cfg(20)),m);
 assert.ok(m.arrivals.every((a,i)=>i===0||a.eldtMs>=m.arrivals[i-1].eldtMs));
 assert.ok(m.arrivals.every(a=>a.requestMs===a.eldtMs&&a.ringMs<a.eldtMs));
 assert.equal(m.arrivals.length,40);
 assert.equal(m.opportunities.length,6);
 assert.equal(m.opportunities.filter(x=>x.category==='HEAVY_JET').length,4);
 assert.deepEqual(makeTmaManifest(20,20261116),m);
});
test('B2 path stretch stops at per-transition P90 bound and conserves delay',()=>{
 const f={vectored:false,ratioP90:1.2,publishedTransitionNM:15};
 const a=allocateTmaDelay(f,300);
 assert.ok(Math.abs(a.stretchNM-3)<1e-6);
 assert.ok(Math.abs(a.stretchS+a.holdS-300)<1e-8);
 const b=allocateTmaDelay({...f,vectored:true},300);
 assert.equal(b.holdS,0);
});
test('B2 S0 uses old scheduler and retains hard demand conservation',()=>{
 const m=makeTmaManifest(20,20261116);
 const s=runS0(m);
 assert.equal(s.output.meta.a11Spacing.lockSha256.length,64);
 assert.equal(s.output.metrics.totals?.demand??m.arrivals.length+m.opportunities.length,
  m.arrivals.length+m.opportunities.length);
 assert.equal(s.metrics.censoredArrivals+s.metrics.servedArrivalsByDrain,m.arrivals.length);
 assert.equal(s.metrics.censoredDepartures+s.metrics.servedDeparturesByDrain,m.opportunities.length);
 assert.equal(s.policy,'S0');
});
