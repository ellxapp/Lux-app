#!/usr/bin/env node
// Study-only S0 gate diagnostics. No S1/S2 run can be claimed from this tool.
import {evaluateS0} from './tma.mjs';
const x=evaluateS0({seeds:50});
console.log(JSON.stringify({stage:'B2b_S0',status:x.gate.status,
 data:x.data,diagnostics:x.gate.diagnostics,counts:x.counts,
 notes:x.notes,configHash:x.configHash}));
if(x.gate.status!=='PASS')console.error('S0 GATE FAIL: S1/S2 BLOCKED');
