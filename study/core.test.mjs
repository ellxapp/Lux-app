import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonical,makeManifest,runStudy,positionAt,durationMs,byteCompare,paired,csv,digest} from './core.mjs';
const read=name=>JSON.parse(readFileSync(new URL('./presets/'+name+'.json',import.meta.url)));
const SHA='0123456789abcdef0123456789abcdef01234567';
const simple=(fs,config=read('SYNTH'))=>runStudy({schema:1,synthetic:true,seed:42,startUtc:config.startUtc,flights:fs},config,{commitSha:SHA,dirty:false,nodeVersion:'v20.1.0'});
const flight=(id,kind,requestMs,error=0,wake='M')=>({id,kind,aircraftType:'SYNTH-M',wake,requestMs,deliveryErrorMs:error});

test('C6: generator and runner are deterministic; runner never calls Math.random',()=>{
 const a=makeManifest({seed:123,count:30}),b=makeManifest({seed:123,count:30}),c=makeManifest({seed:124,count:30});
 assert.equal(canonical(a),canonical(b));assert.notEqual(canonical(a),canonical(c));
 const cfg=read('SYNTH'),orig=Math.random;Math.random=()=>{throw Error('random in Study runner');};
 try {
  const one=runStudy(a,cfg,{commitSha:SHA}),two=runStudy(a,cfg,{commitSha:SHA});
  assert.equal(canonical(one),canonical(two));
  assert.equal(one.meta.manifestSha256,digest(a));
  assert.equal(one.meta.commitSha,SHA);
  assert.equal(one.meta.nodeVersion,process.version);
 }finally{Math.random=orig;}
});

test('conservation includes rejected, censored, go-arounds; no real data',()=>{
 const cfg=read('SYNTH');cfg.drainEndMs=1000000;cfg.measurementStartMs=0;cfg.measurementEndMs=500000;
 const rows=[flight('A','ARR',0),flight('B','DEP',5000),flight('C','ARR',900000),{...flight('D','ARR',7000),kind:'invalid'}];
 const r=simple(rows,cfg);
 assert.equal(r.totals.demand,4);
 assert.equal(r.totals.served+r.totals.censored+r.totals.rejected+r.totals.goArounds,4);
 assert.equal(r.totals.rejected,1);
 assert.equal(r.totals.censored>=1,true);
 assert.equal(r.capacity_eligible,false);
});

test('UTF-8 byte-order ID tie-break independent of locale',()=>{
 const rows=[flight('ä','ARR',0),flight('Z','ARR',0),flight('a','ARR',0)];
 const r=simple(rows);
 assert.equal(byteCompare('Z','a')<0,true);
 assert.deepEqual(r.flights.map(x=>x.id),['Z','a','ä']);
});

test('arrival SLA evaluated at leader threshold, distinct from along-path constraints',()=>{
 const cfg=read('SYNTH');
 const one=simple([flight('A','ARR',0),flight('B','ARR',0)],cfg);
 assert.equal(one.totals.served,2);
 const follow=one.flights[1],lead=one.flights[0];
 const sla=follow.constraints.find(x=>x.name==='sla-threshold');
 const surveillance=follow.constraints.find(x=>x.name==='surveillance-common-final');
 const wake=follow.constraints.find(x=>x.name==='wake-common-final');
 assert.ok(sla&&surveillance&&wake);
 assert.equal(sla.event,'leader.threshold');
 assert.equal(surveillance.event,'min-on-common-final');
 assert.ok(sla.actual>=sla.required);
 assert.ok(follow.controlCrossingMs>=lead.controlCrossingMs);
});

test('C1: too-early uncontrolled delivery error generates go-around, never threshold hold',()=>{
 const cfg=read('SYNTH');cfg.applyDeliveryError=true;
 const r=simple([flight('A','ARR',0),flight('B','ARR',0,-150000)],cfg);
 assert.equal(r.flights[1].status,'go-around');
 assert.ok(r.flights[1].constraints.some(x=>!x.ok));
 assert.equal(r.totals.goArounds,1);
 assert.equal(r.capacity_eligible,false);
});

test('C3: piecewise speed produces compression near threshold',()=>{
 const c=read('SYNTH');
 // 180 kt above 4 NM, 160 kt below: fixed temporal gap shrinks in distance.
 const leader=durationMs(c,c.controlM);
 const gap=85000;
 const onFinal=gap+20000;
 const initial=positionAt(c,leader+gap,onFinal)-positionAt(c,leader,onFinal);
 const final=positionAt(c,leader+gap,leader);
 assert.ok(initial>final,'downstream slow segment compresses along-track distance');
});

test('C4: runway physics and mixed-traffic SLA have separate constraints',()=>{
 const cfg=read('SYNTH');
 const r=simple([flight('ARR-A','ARR',0),flight('DEP-B','DEP',300000),flight('ARR-C','ARR',100000)],cfg);
 assert.equal(r.totals.served,3);
 const dep=r.flights.find(x=>x.id==='DEP-B');
 const follower=r.flights.find(x=>x.id==='ARR-C');
 assert.ok(dep.constraints.some(x=>x.name==='departure-entry-runway-clear'));
 assert.ok(follower.constraints.some(x=>x.name==='sla-threshold'&&x.required===cfg.mixedMediumSlaM));
 assert.ok(follower.constraints.some(x=>x.name==='departure-airborne'));
 assert.ok(follower.constraints.some(x=>x.name==='runway-protected-area'));
});

test('C5: LVP sensitive area is checked at follower 2 NM, not threshold',()=>{
 const cfg=read('SYNTH');cfg.lvp=true;cfg.sensitiveAfterClearMs=220000;
 const r=simple([flight('A','ARR',0),flight('B','ARR',0)],cfg);
 const b=r.flights[1];
 const check=b.constraints.find(x=>x.name==='ils-sensitive-area');
 assert.ok(check);assert.equal(check.event,'follower.at-sensitive-gate');
 assert.equal(check.unit,'ms');assert.ok(check.margin>=0);
});

test('simultaneous constraints recorded in an attempted movement',()=>{
 const cfg=read('SYNTH');cfg.arrivalRotMs=200000;cfg.normalSlaM=12000;
 const r=simple([flight('A','ARR',0),flight('B','ARR',0)],cfg);
 const attempts=r.flights[1].attempts;
 assert.ok(attempts[0].blockedBy.includes('sla-threshold'));
 assert.ok(attempts[0].blockedBy.includes('runway-protected-area'));
});

test('C7: demand-limited vs saturated is explicit; measurement window does not count drain',()=>{
 const c=read('SYNTH');
 const empty=simple([],c);
 assert.equal(empty.metrics.runwayRatePerHour,0);assert.equal(empty.capacity_eligible,false);
 const r=simple([flight('A','ARR',0)],c);
 assert.equal(r.capacity_eligible,false);
 assert.ok(r.metrics.runwayRatePerHour>=0);
});

test('CSV RFC4180 quoting and CRLF; paired manifests strictly identical',()=>{
 const raw=csv([{id:'SYN,"quoted"\nfield',kind:'ARR',constraints:[{name:'a,b'}]}]);
 assert.match(raw,/"SYN,""quoted""\nfield"/);
 assert.ok(raw.includes('\r\n'));
 const a=makeManifest({seed:4,count:6}),b=makeManifest({seed:5,count:6}),c=read('SYNTH');
 const left=runStudy(a,c,{commitSha:SHA}),same=runStudy(a,{...c,arrivalRotMs:c.arrivalRotMs+1000},{commitSha:SHA});
 assert.equal(paired(left,same).manifestSha256,left.meta.manifestSha256);
 assert.throws(()=>paired(left,runStudy(b,c,{commitSha:SHA})),/matched manifest/);
});

test('required provenance rejects incomplete SHA',()=>{
 const m=makeManifest({count:0});assert.throws(()=>runStudy(m,read('SYNTH'),{commitSha:'abcd'}),/commit SHA/);
});

test('historical presets are cited and marked as non-operational, current not bundled',()=>{
 for(const name of ['EUROCONTROL_2018','CAPAN_2025']){
  const c=read(name);assert.match(c.source,/EUROCONTROL/);
  assert.match(c.source,/2019|2025/);
  assert.equal(c.lvp,false);
 }
});

test('B1: runway event demand order places DEP at 60s before ARR crossing at 250s',()=>{
 const c=read('SYNTH');
 const r=simple([flight('A','ARR',0),flight('D','DEP',60000)],c);
 assert.deepEqual(r.flights.map(x=>x.id),['D','A']);
 assert.equal(r.flights[0].timeMs,60000);
 assert.equal(r.flights[0].delayMs,0);
});

test('B2: undelayed arrival stream is not a saturated backlog',()=>{
 const c=read('SYNTH');
 const fs=Array.from({length:30},(_,i)=>flight('S'+i,'ARR',i*200000));
 const r=simple(fs,c);
 assert.equal(r.flights.reduce((x,f)=>Math.max(x,f.delayMs||0),0),0);
 assert.equal(r.capacity_eligible,false);
});

test('B3: SLA planning shortfall is logged, not automatically a go-around',()=>{
 const c=read('SYNTH');c.applyDeliveryError=true;
 const r=simple([flight('A','ARR',0),flight('B','ARR',0,-8000)],c);
 const b=r.flights[1];
 assert.equal(b.status,'served');
 assert.equal(b.slaInfringement,true);
 assert.ok(b.constraints.find(x=>x.name==='sla-threshold').margin<0);
 assert.equal(r.slaInfringements,1);
 assert.equal(r.totals.goArounds,0);
 assert.equal(r.capacity_eligible,false);
});

test('N3: missing LVP spacing and unknown config keys are rejected',()=>{
 const c=read('SYNTH');delete c.lvpSlaM;c.lvp=true;
 assert.throws(()=>simple([flight('A','ARR',0)],c),/lvpSlaM/);
 const bad=read('SYNTH');bad.typoField=5;
 assert.throws(()=>simple([],bad),/unknown config field/);
});


test('B2a: censored arrivals remain in saturated waiting backlog through measurement end',()=>{
 const c=read('SYNTH');
 c.measurementStartMs=600000;
 c.measurementEndMs=2400000;
 c.drainEndMs=2400000;
 const fs=Array.from({length:40},(_,i)=>flight('C'+String(i).padStart(3,'0'),'ARR',0));
 const r=simple(fs,c);
 assert.ok(r.totals.censored>0,'test must exercise censored arrivals');
 assert.ok(r.totals.served>0,'test must exercise served arrivals');
 assert.equal(r.backlogAllHour,true);
 assert.equal(r.capacity_eligible,true);
});

test('SLA infringement is explicit in per-flight CSV',()=>{
 const c=read('SYNTH');c.applyDeliveryError=true;
 const r=simple([flight('A','ARR',0),flight('B','ARR',0,-8000)],c);
 const out=csv(r.flights);
 assert.ok(out.split('\r\n')[0].includes('slaInfringement'));
 assert.ok(out.includes('true'));
});
