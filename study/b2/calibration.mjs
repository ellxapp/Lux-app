// Stage B2b observational calibration gate. Aggregate-only; non-operational.
// The gate must pass BEFORE S1/S2 benefit calculations. No synthetic fit is evidence of operational validity.
export const B2A=Object.freeze({
  source:'ellxapp/panel#6 comments 6921599723, 6921795946',
  sample:'ANA September 2026 and ADS-B; 40 NM is a TMA proxy, not actual boundary',
  demandBands:['<=7','8-11','12-15','16-19','20+'],
  excess40:{
    '<=7':{median:35,p90:131,mean:50},
    '8-11':{median:66,p90:182,mean:86},
    '12-15':{median:66,p90:230,mean:101},
    '16-19':{median:148,p90:386,mean:170},
    '20+':{median:81,p90:208,mean:110,smallN:true}
  },
  overtakes40:{count:68,denominator:549,share:68/549},
  overtakes20:{count:212,denominator:1832,share:212/1832},
  transitionUse:{share:0.67,denominator:2743,approximate:true},
  runway24Share:0.80,
  entryMix:{GIVOR:.27,BITBU:.22,MMD:.20,CLKEX:.18,DYINB:.05,RMS:.04,LADAT:.02,DIK:.01},
  actualTmaEntry:{source:'ellxapp/panel#6 comment 6922589286',n:686,all:{p10:305,median:565,p90:792},
    byFix24:{BITBU:{n:140,p10:279,median:317,p90:509},RMS:{n:30,p10:276,median:307,p90:346},
     GIVOR:{n:161,p10:452,median:503,p90:645},CLKEX:{n:141,p10:582,median:641,p90:773},
     MMD:{n:124,p10:662,median:763,p90:911}},
    planningHorizons:['ENTRY','8MIN','5MIN'],
    labelAlias:{CLKEX:'RITAX (Brussels sector)'},
    note:'TMA polygon and altitude cap based on existing Lux-app GEO.areas; supersedes 40NM ring only for horizon design'},
  fixRunway24:{
    GIVOR:{n:161,p10:757,median:839,p90:994,flownMedianNM:54},
    CLKEX:{n:141,p10:715,median:782,p90:946,flownMedianNM:54},
    BITBU:{n:140,p10:610,median:674,p90:921,flownMedianNM:39},
    MMD:{n:124,p10:851,median:911,p90:1078,flownMedianNM:65},
    RMS:{n:30,p10:624,median:694,p90:787,flownMedianNM:42}
  },
  transitions:[
    {runway:'24',fix:'EXCOS',n:538,publishedNM:19.3,flownMedianNM:18.5,ratio:[.90,.96,1.14]},
    {runway:'24',fix:'PONIG',n:393,publishedNM:15.0,flownMedianNM:14.9,ratio:[.97,.99,1.01]},
    {runway:'24',fix:'BETEX',n:311,publishedNM:15.8,flownMedianNM:16.3,ratio:[.93,1.03,1.20]},
    {runway:'24',fix:'DIK',n:251,publishedNM:25.7,flownMedianNM:25.1,ratio:[.95,.98,1.24]},
    {runway:'24',fix:'IRTON',n:64,publishedNM:50.5,flownMedianNM:48.8,ratio:[.93,.97,1.02]},
    {runway:'06',fix:'IRTON',n:76,publishedNM:26.9,flownMedianNM:28.0,ratio:[.97,1.04,1.23]},
    {runway:'06',fix:'BREDI',n:69,publishedNM:25.7,flownMedianNM:24.5,ratio:[.92,.96,1.23]}
  ]
});
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const residual=(model,observed,tolerance,units)=>({
 model:finite(model)?model:null,observed,tolerance,units,
 delta:finite(model)?model-observed:null,
 pass:finite(model)&&Math.abs(model-observed)<=tolerance
});
/**
 * Accept S0 aggregate metrics, never raw tracks. No missing metric is imputed.
 * data.excess40[band].median is a 40-NM entry-to-threshold excess-over-P10
 * median, NOT a zero-ATC-delay measurement.
 * data.overtakeShare40 is the fraction of consecutive landing pairs whose
 * ring crossing is reversed; FIFO at entry gives zero and must FAIL.
 */
export function calibrateS0(data,{medianToleranceS=30,overtakeTolerancePP=4,
 transitionUseTolerancePP=5,runwayShareTolerancePP=5}={}){
 if(!data||!data.excess40)throw Error('S0 aggregate evidence required');
 const excess=Object.fromEntries(B2A.demandBands.map(b=>[b,
  residual(data.excess40[b]?.median,B2A.excess40[b].median,medianToleranceS,'s')]));
 const overtake40=residual(data.overtakeShare40,B2A.overtakes40.share,
  overtakeTolerancePP/100,'share');
 const transitionUse=residual(data.transitionUseShare,B2A.transitionUse.share,
  transitionUseTolerancePP/100,'share');
 const runway24=residual(data.runway24Share,B2A.runway24Share,
  runwayShareTolerancePP/100,'share');
 const entries=Object.fromEntries(Object.entries(B2A.entryMix).map(([fix,share])=>[
  fix,residual(data.entryMix?.[fix],share,.05,'share')]));
 const missing=[];
 const diagnostics={excess40:excess,overtake40,transitionUse,runway24,entryMix:entries};
 for(const [name,item] of Object.entries({...excess,...entries,overtake40,transitionUse,runway24}))
  if(item.model===null)missing.push(name);
 const all=[...Object.values(excess),overtake40,transitionUse,runway24,...Object.values(entries)];
 const pass=all.every(x=>x.pass);
 return {stage:'B2b_S0',status:pass?'PASS':'FAIL_NOT_VALIDATED',
  canRunInterventions:pass,
  dataSource:B2A.source,
  rules:{medianToleranceS,overtakeTolerancePP,transitionUseTolerancePP,runwayShareTolerancePP},
  diagnostics,missing,
  limitations:['TMA_RING_PROXY_NOT_BOUNDARY','P10_UNIMPEDED_PROXY_NOT_ZERO_ATC_DELAY',
   '20NM_ALTITUDE_CAPTURE_88_PERCENT','40NM_SIX_WIDE_DAYS',
   'TRANSITION_USE_APPROXIMATE','CONTROLLER_WORKLOAD_UNVALIDATED',
   'SEQUENCING_EFFECTIVENESS_UNOBSERVED','NO_RUNWAY_CAPACITY_CLAIM'],
  interpretation:pass?'MATCHED_SELECTED_AGGREGATES_NOT_INDEPENDENT_VALIDATION':
   'DO_NOT_RUN_OR_REPORT_S1_S2_BENEFITS'};
}
export function requireS0Gate(gate){
 if(!gate||gate.stage!=='B2b_S0'||gate.status!=='PASS'||gate.canRunInterventions!==true)
  throw Error('B2b hard stop: S0 not calibrated to B2a; S1/S2 comparison prohibited');
 return true;
}
