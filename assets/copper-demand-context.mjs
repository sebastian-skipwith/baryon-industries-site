import {selectIeaDemand} from './iea-demand.mjs';
import {selectChileYear} from './chile-production.mjs';
import {selectFlowPeriod} from './material-flow.mjs';
import {selectUsSemifabricates} from './us-semifabricates.mjs';

const PINS={"demand":{"file":"iea-demand-132da04d1866.json","sha256":"132da04d186604d6bd396671628821a09e8bb6118022f9f2b6ea34f68afc51e5","bytes":4215,"canonicalSha256":"99e8c01ed7704ff4bd3abf7d2e85c68e600da036573f784c26fcd4ff6390b7d4"},"production":{"file":"chile-production-917b87dca8cc.json","sha256":"917b87dca8cc26a56b423eb93db0359fbb6d86c4397c7f1681a6fa155c7e6ad6","bytes":28339,"canonicalSha256":"37d26d487cad2feff1b32653fbc8437043fe6c566a8237fe164232e862bbe1c5"},"flows":{"file":"us-copper-flows-df49d62bed27.json","sha256":"eca489e57d281986a408e17a20898aced4d1b15da3c0d98c5284e6229f387111","bytes":43909,"canonicalSha256":"3e77926e09d604e6080b32bb9b7fa2e562f3fb41d8e1f465371a55fe9638903f"},"manufacturing":{"file":"us-semifabricates-63200dc6e487.json","sha256":"63200dc6e487d4fd4143b1e0187fdb3077c774791f2b0ec870c45f5c3b7316ab","bytes":6364,"canonicalSha256":"6e3476cdd4a1a1da327bfe26f63876b857d781a6a87f979017d887548fd69347"}};
const KEYS=['demand','production','flows','manufacturing'];
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const clone=v=>JSON.parse(JSON.stringify(v));
const check=(ok,message)=>{if(!ok)throw Error(message);};
const digest=async v=>[...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v))))].map(v=>v.toString(16).padStart(2,'0')).join('');
export const COPPER_DEMAND_CONTEXT_METHOD='copper-historical-demand-context-v1';

export async function makeCopperDemandContext(input){
 const selection=clone(input?.selection??{}),generatedAt=input?.generatedAt;
 check(typeof generatedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(generatedAt)&&Number.isFinite(Date.parse(generatedAt))&&new Date(generatedAt).toISOString()===generatedAt,'Use an exact UTC timestamp.');
 check(Object.keys(selection).sort().join()===['demandYear','productionYear','usPeriodId'].sort().join(),'Unexpected context selections.');
 check(Number.isInteger(selection.demandYear)&&[2021,2025].includes(selection.demandYear),'Select an admitted historical demand year.');
 // Snapshot before any await: content and descriptor cannot change during verification.
 const sources=Object.fromEntries(KEYS.map(key=>{
  const supplied=input?.sources?.[key];
  if(supplied==null){check(key!=='demand','Historical demand evidence is required.');return [key,null];}
  check(supplied.data&&supplied.descriptor,`Present ${key} requires data and descriptor.`);
  const descriptor=Object.fromEntries(['file','sha256','bytes'].map(k=>[k,supplied.descriptor[k]]));
  for(const [k,v]of Object.entries(descriptor))check(v===PINS[key][k],`Unreviewed ${key} descriptor.`);
  return [key,{descriptor,data:clone(supplied.data)}];
 }));
 check(sources.production?Number.isInteger(selection.productionYear):selection.productionYear===null,'Production selection must match evidence availability.');
 check(sources.flows||sources.manufacturing?typeof selection.usPeriodId==='string':selection.usPeriodId===null,'US period must match evidence availability.');
 for(const key of KEYS)if(sources[key])check(await digest(sources[key].data)===PINS[key].canonicalSha256,`Changed ${key} content.`);
 const demand=selectIeaDemand(sources.demand.data,selection.demandYear);
 const p=sources.production?selectChileYear(sources.production.data,selection.productionYear):null;
 const f=sources.flows?selectFlowPeriod(sources.flows.data,selection.usPeriodId):null;
 const m=sources.manufacturing?selectUsSemifabricates(sources.manufacturing.data,selection.usPeriodId):null;
 const period={start:`${demand.year}-01-01`,end:`${demand.year}-12-31`,kind:'year'};
 const match=(start,end)=>start===period.start&&end===period.end;
 const us=f?.period??m?.period??null;
 const checks=[
  {id:'chile-period',status:p?(match(p.periodStart,p.periodEnd)?'same_interval':'different_interval'):'missing_evidence',reason:p?`Chile ${p.periodStart} through ${p.periodEnd}; demand ${period.start} through ${period.end}. Same dates alone do not match geographic or product coverage.`:'Chile production is not included; missing evidence is not zero.',needed:'Select dated evidence with a common interval before comparing activity.'},
  {id:'us-period',status:us?(match(us.start,us.end)?'same_interval':'different_interval'):'missing_evidence',reason:us?`US ${us.start} through ${us.end} (${us.kind}); demand ${period.start} through ${period.end}. No annualization or addition of overlapping periods.`:'US evidence is not included; missing evidence is not zero.',needed:'A complete matching interval; do not extrapolate a month or year-to-date total to a year.'},
  {id:'geography',status:'incompatible_coverage',reason:'Global demand, Chile production and US activity are different geographic accounts. No regional allocation of IEA demand or facility-to-buyer shipment is established.',needed:'Compatible global supply coverage or an evidenced regional demand allocation, trade, stocks and physical routes.'},
  {id:'scrap-boundary',status:f?'incompatible_boundary':'missing_evidence',reason:'IEA refined-copper demand excludes direct-use scrap. US apparent consumption includes old-scrap recovery in broader forms, including direct melt. Reported US refined use is a separate series.',needed:'Harmonized copper form and scrap coverage with independently justified adjustments.'},
  {id:'mass-basis',status:m?'incompatible_mass_basis':'missing_evidence',reason:'Demand is kt Cu; Chile output and the US copper account are t Cu. Mill production, shipments and stocks are t gross product, with unknown contained-copper fractions. Changing scale cannot repair a boundary mismatch.',needed:'Dated composition and product coverage before any gross-product-to-copper conversion.'},
  {id:'production-stages',status:p||f?'not_additive':'missing_evidence',reason:'Mine, smelter and refined outputs are overlapping stages. Mill production and shipments are also separate measures; adding them double-counts activity.',needed:'Matched feeds, outputs, intermediate inventories and process boundaries before calculating recovery or a closed balance.'},
  {id:'buyer-supply',status:'unresolved',reason:'Historical aggregate demand is not a buyer requirement. Reported production, shipments and capacity do not establish uncommitted deliverable supply.',needed:'A dated buyer quantity/specification/destination plus verified facility identity, current output, commitments and delivery evidence.'},
  {id:'independence',status:'not_independent_validation',reason:'IEA historical estimates are publisher assessments. US flow and mill tables share one survey; cross-table agreement is not independent replication.',needed:'Preregistered independent evidence with resolved lineage before claiming predictive or research-policy improvement.'}
 ];
 const production=p?{country:'CL',unit:'t Cu',massBasis:'contained_copper',period:{start:p.periodStart,end:p.periodEnd,kind:'year'},rows:p.rows.filter(r=>['cl-mine','cl-smelter','cl-refined'].includes(r.id)).map(r=>({id:r.id,label:r.name,value:r.observation.tonnesCu,status:r.observation.status,table:r.table,pdfPage:r.pdfPage})),reconciliations:p.reconciliations}:null;
 const flows=f?{country:'US',unit:'t Cu',period:clone(f.period),values:clone(f.values),columns:clone(sources.flows.data.columns),balance:clone(f.balance),directUseScrapIncludedInApparentConsumption:true}:null;
 const body={schemaVersion:1,kind:'historical_copper_decision_context',method:COPPER_DEMAND_CONTEXT_METHOD,selection,
  availability:Object.fromEntries(KEYS.map(k=>[k,sources[k]?'included':'missing'])),
  sources:Object.fromEntries(KEYS.map(k=>[k,sources[k]?{binding:{...PINS[k]},evidence:sources[k].data}:null])),
  demand:{...demand,geography:'World',period,evidenceRole:'publisher_historical_estimate',directUseScrapIncluded:false},production,flows,manufacturing:m?{country:'US',...m}:null,
  compatibility:{status:'context_only_not_reconciled',checks,canCalculateSupplyGap:false,globalSupplyGapTonnesCu:null,regionalSupplyGapTonnesCu:null,verifiedDeliverableTonnes:null,buyerRequirement:null,productionShareOfGlobalDemand:null,productToCopperFactor:null},
  limitations:['This brief reuses historical public evidence. It does not observe current conditions, forecast output or establish procurement supply.','Missing data remain unknown; mismatched dates, geography and product boundaries prohibit an inferred deficit or allocation.','Retain source units, reported precision, estimate flags and rounding residuals. No aggregate is silently converted, annualized or forced to close.','All source snapshots and publication/acquisition dates are retained; generating this brief does not refresh those dates.'],
  learning:{newObservations:0,modelImprovementClaimed:false,researchPolicyImprovementClaimed:false,independentValidationEligible:false}};
 return {...body,reportId:await digest(body),generatedAt};
}

export async function validateCopperDemandContext(report){
 const r=clone(report);check(r?.method===COPPER_DEMAND_CONTEXT_METHOD&&r.schemaVersion===1,'Unsupported copper context method.');
 const sources=Object.fromEntries(KEYS.map(k=>[k,r.sources?.[k]?{data:r.sources[k].evidence,descriptor:r.sources[k].binding}:null]));
 const expected=await makeCopperDemandContext({selection:r.selection,generatedAt:r.generatedAt,sources});
 check(canonical(r)===canonical(expected),'Copper context changed; rebuild from reviewed evidence.');return expected;
}

export async function copperDemandContextMarkdown(report){
 const r=await validateCopperDemandContext(report),n=v=>v===null?'Unknown':Number(v).toLocaleString('en-US',{maximumFractionDigits:3}),s=r.sources.demand.evidence;
 const section=(title,rows)=>['## '+title,'','| Measure | Value |','| --- | --- |',...rows.map(([label,value])=>`| ${label} | ${value} |`),''];
 const publication=source=>`Published ${source.publicationDate} (precision: ${source.publicationDatePrecision}); acquired ${source.acquiredAt}.`;
 return ['# Baryon copper decision-context brief','',`Demand interval: ${r.demand.period.start} through ${r.demand.period.end}.`,
  '**Historical context only. Supply gaps, buyer requirements and verified deliverable supply remain unknown.**','',
  ...section('Global demand — publisher historical estimates',['cleanEnergy','otherUses','total'].map(k=>[s.labels[k],n(r.demand.values[k])+' kt Cu'])),
  `Published clean-energy share: ${n(r.demand.values.cleanSharePct)}%. Direct-use scrap is excluded.`,s.method.description,'',
  ...section('Inside clean energy — already included above',s.partitions.cleanEnergy.map(k=>[s.labels[k],n(r.demand.values[k])+' kt Cu'])),
  ...r.demand.balances.map(b=>`${s.labels[b.parent]}: component sum minus published total = ${n(b.residual)} kt Cu.`),'',
  ...(r.production?[`Chile interval: ${r.production.period.start} through ${r.production.period.end}.`,'',...section('Chile production — overlapping stages',r.production.rows.map(v=>[`${v.label} (table ${v.table}, page ${v.pdfPage})`,n(v.value)+' t Cu']))]:['## Chile production','','Missing evidence; not zero.','']),
  ...(r.flows?[`US interval: ${r.flows.period.start} through ${r.flows.period.end} (${r.flows.period.kind}).`,'',...section('US account — selected period only',r.flows.columns.map(c=>{const v=r.flows.values[c.id];return [`${c.label} (table ${c.table}, page ${c.page})`,`${n(v.value)} t Cu · ${v.sourceEstimated?'estimated':v.includesEstimates?'includes estimates':'reported'}`];})),`Apparent-consumption component sum minus published value: ${n(r.flows.balance.roundingDifference)} t Cu.`,'']:['## US copper account','','Missing evidence; not zero.','']),
  ...(r.manufacturing?[`US mill interval: ${r.manufacturing.period.start} through ${r.manufacturing.period.end}.`,'',...section('US mills — gross product mass',r.manufacturing.categories.flatMap(c=>[['Production',c.production],['Shipments',c.shipments],['Closing stocks',c.closingStocks],['Opening stocks',c.openingStocks],['Production minus shipments minus stock change',c.residual]].map(([label,value])=>[c.name+' — '+label,n(value)+' t gross product']))),'Contained copper and final demand are unknown. Gross product mass is not converted to t Cu.','']:['## US mills','','Missing evidence; not zero.','']),
  '## Compatibility and next evidence','',...r.compatibility.checks.flatMap(c=>[`### ${c.id.replaceAll('-',' ')} · ${c.status.replaceAll('_',' ')}`,'',c.reason,`Needed: ${c.needed}`,'']),
  '## Sources and reuse','',...KEYS.flatMap(k=>{const v=r.sources[k];if(!v)return [`- ${k}: missing.`];const source=v.evidence.source;return [`### ${k}`,'',`[${source.name}](${source.url})`,publication(source),`Original SHA-256: ${source.rawSha256}`,`Public snapshot: ${v.binding.file}; SHA-256 ${v.binding.sha256}; ${v.binding.bytes} bytes.`,source.attribution??source.name,source.permission??source.license??source.permissionScope,''];}),
  `[IEA CC BY 4.0 licence](${s.source.licenceUrl}) · [IEA reuse notice](${s.source.termsUrl})`,s.source.attribution,s.source.adaptation,
  'Brief adaptation: Baryon selects historical rows and places them alongside separately scoped Chile and US evidence; it calculates no cross-source supply gap or forecast.',s.source.derivedWorkNotice,'',
  '## Reproducibility and limits','',`Method: ${r.method}`,`Report ID: ${r.reportId}`,`Generated: ${r.generatedAt}`,'',...r.limitations.map(v=>'- '+v),'- No new observations, independent validation, model gain or research-policy improvement.',''].join('\n');
}
