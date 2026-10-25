import {makeFacilityStatusContext,facilityStatusMarkdownLines} from './cathode-facility-status.mjs';
import {makeFacilityOutputContext,facilityOutputMarkdownLines} from './cathode-facility-output.mjs?v=facility-context-20261025';
import {cathodeRequirementLines,requirementMarkdownText} from './cathode-requirement.mjs';
import {validateCathodeDecision} from './cathode-decision.mjs';
import {selectFlowPeriod} from './material-flow.mjs';
import {validateUsCircuits} from './us-circuits.mjs';
const FLOW={file:'us-copper-flows-df49d62bed27.json',sha256:'eca489e57d281986a408e17a20898aced4d1b15da3c0d98c5284e6229f387111',bytes:43909};
const CIRCUITS={file:'us-circuits-8796521375e6.json',sha256:'8796521375e64486464ad588a0238415f0c41bc835d54ed4cd1dd4cd4cc5f3d3',bytes:6746};
const FLOW_HASH='3e77926e09d604e6080b32bb9b7fa2e562f3fb41d8e1f465371a55fe9638903f',CIRCUITS_HASH='423ea9cbf362495bf8a4c59eebe66e898ba05af31f0da3819a4be85463e727c9';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const clone=v=>JSON.parse(JSON.stringify(v)),check=(ok,message)=>{if(!ok)throw Error(message);};
const sha=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v))))].map(x=>x.toString(16).padStart(2,'0')).join('');
const TERMS=[['balancePrimary',1],['balanceOldScrap',1],['balanceImports',1],['balanceExports',-1],['balanceStockChange',-1]];

export async function makeCathodeFlowContext(decision,flows,flowDescriptor,circuits,circuitDescriptor,periodId,statusInput,outputInput){
  // Snapshot all caller-owned values before any async digest, and export only reviewed bindings.
  const d=clone(decision),f=clone(flows),c=clone(circuits),facilityStatus=makeFacilityStatusContext(statusInput),facilityOutput=makeFacilityOutputContext(outputInput,c);
  for(const [binding,supplied]of [[FLOW,flowDescriptor],[CIRCUITS,circuitDescriptor]])for(const [key,value]of Object.entries(binding))check(supplied?.[key]===value,'Flow context descriptor does not match the reviewed snapshot.');
  const verified=await validateCathodeDecision(d);
  check(await sha(f)===FLOW_HASH,'Flow context content does not match the reviewed national account.');
  check(await sha(c)===CIRCUITS_HASH,'Flow context content does not match the reviewed processing groups.');
  validateUsCircuits(c);
  const selected=selectFlowPeriod(f,periodId),{period,values,balance}=selected;
  const components=TERMS.map(([id,sign])=>({id,sign,...clone(f.columns.find(col=>col.id===id)),...clone(values[id]),signedContribution:values[id].value===null?null:sign*values[id].value}));
  const account={country:f.country,period:clone(period),massBasis:'copper_mass',unit:'t Cu',components,balance:clone(balance),reportedRefinedUse:clone(values.useReported),
    scope:'National reported/estimated accounting for this single period, not a closed plant balance or buyer allocation.',
    aggregatePeriod:period.kind!=='month',periodRule:'Use this period alone. Do not add quarter, year or year-to-date totals to overlapping months.'};
  const roleIdentity=verified.evidence.schemaVersion===2;
  // Process-role keys must never join to physical assets, even if their labels or keys match.
  const sourceIds=roleIdentity?verified.evidence.processRoles.flatMap(x=>x.physicalFacilityId===null?[]:[x.physicalFacilityId]):verified.evidence.facilities.map(x=>x.id);
  const matchingGroups=c.circuits.filter(g=>[...g.origins,...g.facilities].some(x=>sourceIds.includes(x.id))).map(g=>g.id);
  const checks=[
    {id:'mass-basis',status:'unresolved',requirement:'Cathode-product mass; purity and contained-copper conversion are unknown.',context:'Copper mass across refined metal and broader old-scrap recovery forms.',needed:'A dated product assay and explicit mass-basis conversion; no 100% purity assumption.'},
    {id:'period',status:'unresolved',requirement:`${verified.requirement.horizonDays} relative days; calendar start/end are unknown. Historical pathway evidence is from 2022.`,context:`${period.start} through ${period.end}; historical national account.`,needed:'A dated requirement and compatible observations for the same interval. Matching a duration alone cannot align periods.'},
    {id:'geography-allocation',status:'unresolved',requirement:'Gunnison pathway in Arizona; buyer destination and geographic accounting boundary are unspecified.',context:'United States aggregate, with imports, exports, scrap and stocks; no buyer allocation.',needed:'Facility-to-buyer identity, location and uncommitted allocation for the chosen interval.'},
    {id:'physical-link',status:'unresolved',requirement:'A documented Gunnison-to-buyer delivery path is needed.',context:'The three reviewed processing groups describe other historical associations; no Gunnison shipment is established by this snapshot.',needed:'Dated shipments and product/lot linkage. A missing match is not proof that no physical route exists.'},
  ];
  if(verified.schemaVersion===3){
    const r=verified.requirement;
    checks[1].requirement=r.windowStart?`Buyer requests ${r.windowStart} through ${r.windowEnd}, both inclusive (${r.horizonDays} days). Actual delivery timing remains unverified; historical pathway evidence is from 2022.`:`${r.horizonDays} relative days; calendar dates unspecified. Historical pathway evidence is from 2022.`;
    checks[2].requirement=r.destination?`Buyer-requested destination: ${r.destination}. Location, geographic boundary and actual route remain unverified.`:'Gunnison pathway in Arizona; buyer destination and geographic accounting boundary are unspecified.';
  }
  if(roleIdentity){
    checks[3].requirement=verified.evidence.identityResolution.statement;
    checks[3].needed=verified.evidence.identityResolution.admissionRule+' Dated shipments and product/lot linkage remain separately required.';
  }
  const report={schemaVersion:1,kind:'cathode_national_flow_context',method:facilityOutput?'cathode-flow-context-v5-facility-output':facilityStatus?'cathode-flow-context-v4-status-context':roleIdentity?'cathode-flow-context-v3-role-identity':verified.schemaVersion===3?'cathode-flow-context-v2-buyer-requirement':'cathode-flow-context-v1',decisionReport:verified,
    ...(facilityStatus?{facilityStatus}:{}),
    ...(facilityOutput?{facilityOutput}:{}),
    flowBinding:{...FLOW,canonicalSha256:FLOW_HASH},circuitBinding:{...CIRCUITS,canonicalSha256:CIRCUITS_HASH},flowEvidence:f,circuitEvidence:c,
    account,compatibility:{status:'context_only_not_reconciled',checks,canReconcileRequirement:false,targetShareOfAccount:null,verifiedDeliverableTonnes:null,unmetDemand:null,productToCopperFactor:null,buyerGeography:null},
    pathwayLink:{...(roleIdentity?{identityStatus:verified.evidence.identityResolution.status,matchedIdentityBasis:'physical_facility_id_only'}:{}),pathwayId:verified.evidence.id,historicalEvidenceAsOf:verified.evidence.evidenceAsOf,reviewedCircuitYear:c.temporalScope.asOfYear,matchingReviewedGroupIds:matchingGroups,verifiedShipmentQuantity:null,closedPlantBalance:false},
    limitations:[f.notes.production,f.notes.scrap,f.notes.use,f.notes.stocks,f.notes.rounding,
      'Only the selected national period is reconciled. Plant cathode sales, nameplate capacity and scenario output are not added to these national terms.',
      'No target-share ratio, annualization, product-purity conversion, available supply or unmet demand is inferred from incompatible evidence.',
      'A reported processing group does not establish a shipment quantity, current route, customer allocation or product quality. No new evidence or model improvement is claimed.']};
  const identity=clone(report);delete identity.decisionReport.generatedAt;
  return {...report,reportId:await sha(identity)};
}
export async function validateCathodeFlowContext(report){
  const r=clone(report),expected=await makeCathodeFlowContext(r.decisionReport,r.flowEvidence,r.flowBinding,r.circuitEvidence,r.circuitBinding,r.account.period.id,r.facilityStatus?{evidence:r.facilityStatus.evidence,binding:r.facilityStatus.binding}:undefined,r.facilityOutput?{evidence:r.facilityOutput.evidence,binding:r.facilityOutput.binding}:undefined);
  check(canonical(r)===canonical(expected),'Flow context changed or uses an unsupported method.');return expected;
}
export async function cathodeFlowContextMarkdown(report){
 const r=await validateCathodeFlowContext(report),a=r.account,b=a.balance,n=v=>v===null?'Unknown':String(v),status=v=>v.sourceEstimated?'Estimated':v.includesEstimates?'Includes estimates':'Reported';
 return ['# Baryon copper requirement and national accounts','',
  '**Context only. This requirement cannot be reconciled with the selected national account; verified supply remains unknown.**','',
  `Requirement: ${r.decisionReport.requirement.targetTonnes} t cathode product over ${r.decisionReport.requirement.horizonDays} ${r.decisionReport.requirement.windowStart?'calendar':'relative'} days.`,
  ...(r.decisionReport.schemaVersion===3?cathodeRequirementLines(r.decisionReport.requirement):[]),
  `Account: ${a.country}, ${a.period.label} (${a.period.start} through ${a.period.end}); ${a.unit}.`,a.periodRule,'',
  '## National accounting only','',...a.components.map(t=>`- ${t.label}: ${n(t.value)} t Cu; signed contribution ${n(t.signedContribution)} t Cu; ${status(t)}. Table ${t.table}, PDF page ${t.page}.`),
  `Reconstructed from rounded components: ${n(b.reconstructed)} t Cu.`,
  `Published apparent consumption: ${n(b.reported)} t Cu; reconstructed minus published: ${n(b.roundingDifference)} t Cu.`,
  `Reported refined use: ${n(a.reportedRefinedUse.value)} t Cu (${status(a.reportedRefinedUse)}); separate coverage, not unmet demand.`,'',
  '## What prevents a requirement-level reconciliation','',...r.compatibility.checks.flatMap(v=>['### '+v.id,'',`Requirement: ${requirementMarkdownText(v.requirement)}`,`Account/context: ${v.context}`,`Needed: ${v.needed}`,'']),
  ...facilityOutputMarkdownLines(r.facilityOutput,r.circuitEvidence),
  ...facilityStatusMarkdownLines(r.facilityStatus),
  '## Limits','',...r.limitations.map(v=>'- '+v),'',
  '## Sources and reproducibility','',`[USGS national account](${r.flowEvidence.source.url}); published ${r.flowEvidence.source.publicationDate}.`,
  `[USGS processing groups](${r.circuitEvidence.source.url}); relationships framed as of ${r.circuitEvidence.temporalScope.asOfYear}.`,
  `Decision ID: ${r.decisionReport.reportId}`,`Context ID: ${r.reportId}`,`Method: ${r.method}`,
  `Flow snapshot SHA-256: ${r.flowBinding.sha256}; original source SHA-256: ${r.flowEvidence.source.rawSha256}.`,
  `Circuit snapshot SHA-256: ${r.circuitBinding.sha256}; original source SHA-256: ${r.circuitEvidence.source.rawSha256}.`,
  `Decision generated: ${r.decisionReport.generatedAt}; this does not establish evidence freshness.`,
  'JSON retains the complete validated decision, pinned public accounts, exact single-period arithmetic and incompatibilities. Generation time is excluded from the context ID.','',
 ].join('\n');
}
