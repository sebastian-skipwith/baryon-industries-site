import {selectChileYear} from '/assets/chile-production.mjs?v=20261015d';
import {selectChileEnergy} from '/assets/chile-energy.mjs?v=20261023c';
import {selectChileSales} from '/assets/chile-sales.mjs?v=20261015e';
import {selectChileExports} from '/assets/chile-exports.mjs?v=20261016b';
const PINS = {"production":{"file":"chile-production-917b87dca8cc.json","sha256":"917b87dca8cc26a56b423eb93db0359fbb6d86c4397c7f1681a6fa155c7e6ad6","bytes":28339,"canonicalSha256":"37d26d487cad2feff1b32653fbc8437043fe6c566a8237fe164232e862bbe1c5"},"energy":{"file":"chile-energy-5e0629db4d2c.json","sha256":"5e0629db4d2c5ef7c4876ef9257076f2bdf11dbd2539e7bc287a0709621e87b5","bytes":9459,"canonicalSha256":"f47bd479ef2f7c958881e7e15784b3a9d4af9a0d5f83621e0d6b1853bc47b0de"},"sales":{"file":"chile-sales-bfca9725ec28.json","sha256":"bfca9725ec282974858f2ebc2f66d5ae0090c22dc297f1578ee36d4e4eb66e2c","bytes":3709,"canonicalSha256":"291cf13706bacf4df6ccc293f43ca81ef730f2adb167f00d106b023bac1053b3"},"exports":{"file":"chile-exports-b30862e0e23d.json","sha256":"b30862e0e23dd1415dcf79a34c210153646d4b750641a8d5bfac0a17db4a8218","bytes":7590,"canonicalSha256":"9d69697104cf5be52e1453aa4105f88e0681a35286c4426c7468f33e5cc4b2cd"}};
const KEYS=['production','energy','sales','exports'];
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const clone=v=>JSON.parse(JSON.stringify(v));
const check=(ok,message)=>{if(!ok)throw Error(message);};
const digest=async v=>[...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v))))].map(v=>v.toString(16).padStart(2,'0')).join('');
export const CHILE_CONTEXT_METHOD='chile-production-input-context-v1';

export async function makeChileContext(input){
 const year=input?.year,generatedAt=input?.generatedAt;
 check(Number.isInteger(year)&&year>=2016&&year<=2025,'Unsupported Chile context year.');
 check(typeof generatedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(generatedAt)&&Number.isFinite(Date.parse(generatedAt))&&new Date(generatedAt).toISOString()===generatedAt,'Use an exact UTC report timestamp.');
 // Snapshot caller-owned values before the first asynchronous operation.
 const sources=Object.fromEntries(KEYS.map(key=>{
  const value=input?.sources?.[key];
  if(value==null){check(key!=='production','Production evidence is required.');return [key,null];}
  check(value.data&&value.descriptor,'Present evidence requires both content and descriptor.');
  const data=clone(value.data),descriptor=Object.fromEntries(['file','sha256','bytes'].map(k=>[k,value.descriptor[k]]));
  for(const [k,v]of Object.entries(descriptor))check(v===PINS[key][k],`Unreviewed ${key} snapshot descriptor.`);
  return [key,{data,descriptor}];
 }));
 for(const key of KEYS)if(sources[key])check(await digest(sources[key].data)===PINS[key].canonicalSha256,`Changed ${key} snapshot content.`);
 const p=selectChileYear(sources.production.data,year);
 const energy=sources.energy?selectChileEnergy(sources.energy.data,year):null;
 const sales=sources.sales?selectChileSales(sources.sales.data,sources.production.data,year):null;
 const exports=sources.exports?selectChileExports(sources.exports.data,year):null;
 const checks=[
  {id:'production-stages',status:'not_additive',reason:'Mine, smelter and refined outputs overlap. No stage sum or recovery is inferred.',needed:'Matched facility feeds, intermediate inventories, process outputs and dates.'},
  {id:'energy-to-output',status:energy?'coverage_unmatched':'missing_evidence',reason:'Shared country and year do not establish matched production and energy coverage. TJ is energy, not copper mass.',needed:'Dated facility/process energy and throughput records with the same boundary; marginal requirements need separate evidence.'},
  {id:'sales-to-demand',status:sales?'partial_coverage':'missing_evidence',reason:'Covered cathode sales under Law 16.624 do not establish shipments, total manufacturing demand or buyer allocation.',needed:'Buyer/seller identities, matched shipments and consumption, coverage, stocks and commitments.'},
  {id:'exports-to-production',status:exports?'incompatible_mass_basis':'missing_evidence',reason:'Export tonnes measure unwrought refined copper and copper-alloy product weight; production measures contained copper. No subtraction or purity assumption is valid.',needed:'Product specification and contained-copper fraction, comparable product coverage, stocks and dated facility routes.'},
  {id:'current-facility-supply',status:'unresolved',reason:'Historical national aggregates establish neither present operation nor uncommitted deliverable supply.',needed:'Verified physical facility, current output interval, product specification, energy access, sales commitments and delivery route.'}
 ];
 const body={schemaVersion:1,method:CHILE_CONTEXT_METHOD,country:'CL',year,periodStart:p.periodStart,periodEnd:p.periodEnd,
  availability:Object.fromEntries(KEYS.map(k=>[k,sources[k]?'included':'missing'])),
  sources:Object.fromEntries(KEYS.map(k=>[k,sources[k]?{binding:{...PINS[k]},evidence:sources[k].data}:null])),
  production:{unit:'t Cu',basis:'contained_copper',rows:p.rows.filter(r=>['cl-mine','cl-smelter','cl-refined','cl-sxew','cl-electrorefined'].includes(r.id)).map(r=>({id:r.id,name:r.name,value:r.observation.tonnesCu,status:r.observation.status,table:r.table,pdfPage:r.pdfPage})),reconciliations:p.reconciliations},
  energy,sales:sales?{unit:'t Cu',basis:'contained_copper',kind:'reported_scoped_sales',value:sales.reportedSalesTonnesCu,coverage:sources.sales.data.coverage.description}:null,
  exports,compatibility:{checks,closedFacilityBalance:false,matchedEnergyPerTonneCopper:null,productionMinusExports:null,totalManufacturingDemandTonnesCu:null,verifiedAdditionalSupplyTonnes:null},
  limitations:['Context only: these datasets do not close a facility material or energy balance.','No national aggregate is assigned to a named physical facility or buyer.','No new observations, model gain, research-policy gain, economic forecast or supply-gate promotion is claimed.','This brief is separate from the historical Gunnison and US-accounting reports.'],
  learning:{newObservations:0,modelImprovementClaimed:false,researchPolicyImprovementClaimed:false}};
 return {...body,reportId:await digest(body),generatedAt};
}

export async function validateChileContext(report){
 const r=clone(report);
 check(r?.method===CHILE_CONTEXT_METHOD&&r.schemaVersion===1,'Unsupported Chile context method.');
 const sources=Object.fromEntries(KEYS.map(k=>[k,r.sources?.[k]?{data:r.sources[k].evidence,descriptor:r.sources[k].binding}:null]));
 const expected=await makeChileContext({year:r.year,generatedAt:r.generatedAt,sources});
 check(canonical(r)===canonical(expected),'Chile context report changed; rebuild it from reviewed evidence.');
 return expected;
}

export async function chileContextMarkdown(report){
 const r=await validateChileContext(report),n=v=>v===null?'Unknown':Number(v).toLocaleString('en-US',{maximumFractionDigits:2});
 const section=(title,rows)=>['## '+title,'','| Measure | Value |','| --- | --- |',...rows.map(([label,value])=>`| ${label} | ${value} |`),''];
 return ['# Baryon Chile copper evidence brief','',`Reporting interval: ${r.periodStart} through ${r.periodEnd}.`,
  '**Historical context only. Facility requirements, total demand and additional deliverable supply remain unknown.**','',
  ...section('Production — contained copper',r.production.rows.map(v=>[`${v.name} (table ${v.table}, page ${v.pdfPage})`,n(v.value)+' t Cu'])),
  'Mine, smelter and refined output overlap; do not add them or infer recovery.','',
  ...section('Explicit production partitions',r.production.reconciliations.map(v=>[v.label,`components ${n(v.componentTonnesCu)} t Cu; published total ${n(v.publishedTonnesCu)} t Cu; difference ${n(v.differenceTonnesCu)} t Cu`])),
  'Differences are component sum minus published total. Source precision is 100 t Cu; residuals remain unadjusted.','',
  ...(r.energy?section('Energy — terajoules',[['Reported total',n(r.energy.totalTJ)+' TJ'],...r.energy.carriers.map(v=>[v.name,n(v.valueTJ)+' TJ']),...r.energy.processes.map(v=>[v.name,n(v.valueTJ)+' TJ'])]):['## Energy','','Missing from this brief. Missing evidence is not zero.','']),
  ...(r.energy?['Process and carrier partitions describe the same total; do not add them together.',...r.energy.reconciliations.map(v=>`${v.partition}: component sum ${n(v.componentTJ)} TJ; published total ${n(v.reportedTotalTJ)} TJ; component-minus-total difference ${n(v.differenceTJ)} TJ.`),'',...r.sources.energy.evidence.notes,'']:[]),
  '## Sales and export coverage','',r.sales?`Covered domestic cathode sales: ${n(r.sales.value)} t Cu. ${r.sales.coverage}`:'Covered domestic sales: missing from this brief; not zero.',
  r.exports?`Recorded exports: ${n(r.exports.total.productTonnes)} t product, including unwrought copper alloys. Contained copper and final demand remain unknown.`:'Export destinations: missing from this brief; not zero.','',
  ...(r.exports?[...section('Recorded export destinations',r.exports.rows.map(v=>[v.name,n(v.productTonnes)+' t product'])),`Destination sum ${n(r.exports.reconciliation.componentsProductTonnes)} t product; published total ${n(r.exports.reconciliation.reportedProductTonnes)} t product; difference ${n(r.exports.reconciliation.differenceProductTonnes)} t product.`, 'Customs destinations are not identified buyers or measured plant-to-plant routes.','']:[]),
  '## Evidence still needed for a facility decision','',...r.compatibility.checks.flatMap(v=>[`### ${v.id.replaceAll('-',' ')} · ${v.status.replaceAll('_',' ')}`,'',v.reason,`Needed: ${v.needed}`,'']),
  '## Source snapshots','',...KEYS.flatMap(k=>{const s=r.sources[k];if(!s)return [`- ${k}: missing.`];const source=s.evidence.source;return [`### ${k}`,'',`[Original source](${source.url}); original SHA-256 ${source.rawSha256}.`,`Public snapshot: ${s.binding.file}; SHA-256 ${s.binding.sha256}; ${s.binding.bytes} bytes.`,source.table?`Table ${source.table}, PDF page ${source.pdfPage}.`:`Reviewed tables: ${source.reviewedTables.join(', ')}; row-level pages retained in the JSON.`,source.attribution,source.confidence,source.permission,`Publication year ${source.publicationYear||source.publicationDate}; acquired ${source.acquiredAt}.`,''];}),
  '## Reproducibility and limits','',`Method: ${r.method}`,`Report ID: ${r.reportId}`,`Generated: ${r.generatedAt}`,'',...r.limitations.map(v=>'- '+v),''].join('\n');
}
