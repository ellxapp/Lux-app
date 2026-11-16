import test from 'node:test';
import assert from 'node:assert/strict';
import {B2A,calibrateS0,requireS0Gate} from './calibration.mjs';
const reference=()=>({
 excess40:Object.fromEntries(B2A.demandBands.map(b=>[b,{median:B2A.excess40[b].median}])),
 overtakeShare40:68/549,transitionUseShare:.67,runway24Share:.8,
 entryMix:{...B2A.entryMix}
});
test('S0 gate passes complete aggregate reproduction but does not claim independent validation',()=>{
 const gate=calibrateS0(reference());
 assert.equal(gate.status,'PASS');
 assert.equal(requireS0Gate(gate),true);
 assert.equal(gate.limitations.includes('NO_RUNWAY_CAPACITY_CLAIM'),true);
});
test('strict FIFO at ring entry must fail the observed 12.4% overtaking calibration',()=>{
 const gate=calibrateS0({...reference(),overtakeShare40:0});
 assert.equal(gate.status,'FAIL_NOT_VALIDATED');
 assert.equal(gate.diagnostics.overtake40.pass,false);
 assert.throws(()=>requireS0Gate(gate),/hard stop/);
});
test('excess medians outside ±30s fail and no missing metric is inferred',()=>{
 const r=reference();r.excess40['16-19'].median+=31;
 assert.equal(calibrateS0(r).status,'FAIL_NOT_VALIDATED');
 const missing=reference();delete missing.excess40['8-11'];
 const gate=calibrateS0(missing);
 assert.equal(gate.status,'FAIL_NOT_VALIDATED');
 assert.ok(gate.missing.includes('8-11'));
});
test('no stage S1 or S2 can be passed off as an S0 gate',()=>{
 assert.throws(()=>requireS0Gate({stage:'S1',status:'PASS',canRunInterventions:true}));
 assert.throws(()=>calibrateS0(null));
});
