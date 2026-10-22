import {resolveCathodeRequirement,cathodeRequirementLines} from './cathode-requirement.mjs';
import {SCREEN_INPUTS,screenCathodeSupply,supplyInvestigations} from './cathode-screen.mjs';

// Exact reviewed snapshots only. Legacy reports retain their original bytes and identities.
const BINDING=Object.freeze({file:'pathway-fef98ccf0c43.json',sha256:'fef98ccf0c432fafcc0bc54528a285da537d63f6122101dbcecc1ce564b5aea5',bytes:3005});
const EVIDENCE_HASH='099a39b48c416c928267ed1bc7190a340b684c541609dc6c5859a40f5d93d041';
const ROLE_BINDING=Object.freeze({"file":"pathway-7d16df18d3d3.json","sha256":"7d16df18d3d373acace27410db5a1f3bb9279691a68724a81fa5c0f3e20ca2cc","bytes":3971});
const ROLE_HASH='e0a66f20480ae62ff39782b02b92024c0230cc30cc2543030a5908da77b5fb7c';
export const DECISION_METHOD=Object.freeze({id:'cathode-decision-v1',calculator:'cathode-screen-v1',calculatorSha256:'c6e6930691281a0501c62d6ff7ff8af7aee304a7c0f8e76496a7daf01453ea21',annualEquivalentDays:365});
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const sha=async value=>[...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const check=(ok,msg)=>{if(!ok)throw new Error(msg);};
const clone=v=>JSON.parse(JSON.stringify(v));

export async function makeCathodeDecision(input,evidence,descriptor,generatedAt,buyerRequest){
  check(typeof generatedAt==='string'&&Number.isFinite(Date.parse(generatedAt))&&new Date(generatedAt).toISOString()===generatedAt,'Use an ISO UTC report timestamp.');
  const roleIdentity=descriptor?.file===ROLE_BINDING.file;
  const binding=roleIdentity?ROLE_BINDING:BINDING,evidenceHash=roleIdentity?ROLE_HASH:EVIDENCE_HASH;
  for(const [key,value]of Object.entries(binding))check(descriptor?.[key]===value,'Decision evidence descriptor does not match the reviewed snapshot.');
  // Snapshot caller data before yielding; never serialize extra input/descriptor fields.
  const requested=buyerRequest===undefined?null:resolveCathodeRequirement(input,buyerRequest);
  const inputs=requested?.inputs??Object.fromEntries(Object.keys(SCREEN_INPUTS).map(k=>[k,input?.[k]??null]));
  const source=clone(evidence);
  check(await sha(canonical(source))===evidenceHash,'Decision evidence content does not match the reviewed snapshot.');
  const result=screenCathodeSupply(inputs,source);
  check(result.ok,result.errors?.join(' ')||'Invalid scenario.');
  const scenarioStatus=result.conditionalTonnes===null?'incomplete':result.targetMet?'reaches_target':'falls_short';
  const report={
    schemaVersion:requested?3:2,kind:'cathode_supply_decision_brief',method:roleIdentity?{...DECISION_METHOD,id:'cathode-decision-v3-role-identity',...(requested?{requirementMethod:'cathode-requirement-v1'}:{})}:requested?{...DECISION_METHOD,id:'cathode-decision-v2-buyer-requirement',requirementMethod:'cathode-requirement-v1'}:{...DECISION_METHOD},
    ...(requested?{buyerRequest:requested.buyerRequest}:{}),
    evidenceBinding:{...binding,canonicalSha256:evidenceHash},
    scope:'Historical Gunnison in-situ pathway only. Related assets, new designs and current operating capability are not established by this evidence.',
    requirement:requested?.requirement??{product:'Copper cathode product',massBasis:'product_mass',targetTonnes:inputs.targetTonnes,horizonDays:inputs.horizonDays,windowStart:null,windowEnd:null,meaning:'Relative scenario window; no calendar delivery date is verified.'},
    inputs,
    assumptions:Object.entries(SCREEN_INPUTS).filter(([,r])=>!r.required).map(([key,r])=>({id:key,label:r.label,value:inputs[key],unit:r.unit,status:inputs[key]===null?'missing':'user_assumption',observed:false})),
    decision:{status:'investigate_before_commitment',verifiedDeliverableTonnes:null,verifiedTargetMet:null,scenarioStatus,
      explanation:'The arithmetic is conditional. No procurement commitment, current supplier offer or production forecast is supported.'},
    result,
    evidenceGates:[
      {id:'current-operations',status:'unverified',requires:roleIdentity?source.identityResolution.admissionRule+' Also require current operating authorization and sustained cathode output over a stated interval. A permit or design rate alone cannot satisfy this gate.':'Dated project identity, current operating authorization and sustained cathode output over a stated interval. A permit or design rate alone cannot satisfy this gate.'},
      {id:'product-quality',status:'unverified',requires:'Dated cathode assay/specification and buyer acceptance. No purity or conversion to contained copper is assumed.'},
      {id:'allocation',status:'unverified',requires:'Uncommitted inventory or output allocation after existing commitments, tied to the same facility and period.'},
      {id:'delivery',status:'unverified',requires:'Calendar delivery dates, route, transport constraints and loss basis for the proposed allocation.'},
    ],
    investigations:supplyInvestigations(result),
    limitations:[...result.limitations,'Investigation priorities are fixed decision rules, not a learned research policy. No test or model improvement is claimed.','Report generation time is not an observation date. Hashes detect changes and bind this snapshot; they do not independently certify source truth.'],
    evidence:source,
  };
  return {...report,reportId:await sha(canonical(report)),generatedAt};
}

export async function validateCathodeDecision(report){
  check(report&&typeof report==='object','A decision report is required.');
  const expected=await makeCathodeDecision(report.inputs,report.evidence,report.evidenceBinding,report.generatedAt,report.schemaVersion===3?report.buyerRequest:undefined);
  check(canonical(report)===canonical(expected),'Decision report changed or uses an unsupported method. Recreate it from the current scenario.');
  return expected;
}

export async function cathodeDecisionMarkdown(report){
  const r=await validateCathodeDecision(report),f=r.evidence.facts;
  const n=v=>v===null?'Unknown':Number(v).toLocaleString('en-US',{maximumFractionDigits:4});
  const status={incomplete:'Incomplete operating assumptions',reaches_target:'Entered scenario reaches the target',falls_short:'Entered scenario falls short'}[r.decision.scenarioStatus];
  return [
    '# Baryon copper supply decision brief','',
    '**Decision: investigate before commitment. Verified deliverable supply: unknown.**','',
    r.decision.explanation,'',
    '## Requirement and conditional result','',
    `- Target: ${n(r.requirement.targetTonnes)} t of cathode product over ${n(r.requirement.horizonDays)} days.`,
    ...(r.schemaVersion===3?cathodeRequirementLines(r.requirement).map(line=>'- '+line):['- Calendar delivery dates: unknown. Product purity and contained-copper mass: unknown.']),
    `- Scenario: ${status}.`,
    `- Conditional delivery: ${n(r.result.conditionalTonnes)} t cathode product.`,
    `- Delivery minus target: ${n(r.result.gapTonnes)} t; a negative number is a shortfall.`,
    `- Required gross plant rate under entered allocation/retention: ${n(r.result.requiredGrossRate)} t cathodes/day.`,
    ...(r.result.impossibleWithAssumedAllocation?['- Zero assumed allocation or retention prevents delivery at any plant rate.']:[]),
    ...(r.result.exceedsHistoricalNameplate?['- The target exceeds the historical nameplate on a constant annual-equivalent comparison; expansion is unverified.']:[]),
    ...(r.result.scenarioExceedsHistoricalNameplate?['- The assumed plant rate exceeds the historical nameplate; expansion is unverified.']:[]),'',
    '## User assumptions','',
    '| Input | Value | Basis |','| --- | ---: | --- |',
    ...r.assumptions.map(a=>`| ${a.label} | ${n(a.value)} ${a.unit} | ${a.status==='missing'?'Missing':'User assumption; not observed'} |`),'',
    `Conditional delivery = assumed plant output × ${r.requirement.windowStart?'inclusive calendar days':'relative days'} × assumed available share × assumed delivery retention. A known zero factor binds delivery at zero even if another factor is missing. Actual readiness and arrival remain unverified.`,'',
    '## Historical evidence','',r.scope,'',
    `Evidence through ${r.evidence.evidenceAsOf}; report published ${r.evidence.source.publicationDate} (month precision); source acquired ${r.evidence.source.acquiredAt}.`,
    `- Reported ${f.sales.period} sales: ${n(f.sales.value)} ${f.sales.unit}. Sales are not production or available inventory.`,
    `- Historical stage-one nameplate: ${n(f.capacity.value)} ${f.capacity.unit}. Ramp-up was delayed; this is not actual output.`,
    `- Reported constraint: ${r.evidence.constraint}`,'',
    ...(r.evidence.identityResolution?['## Physical facility identity','',r.evidence.identityResolution.statement,'',...r.evidence.processRoles.map(p=>`- ${p.id}: ${p.name}; physical facility ID: unknown.`),'',r.evidence.identityResolution.admissionRule,'']:[]),
    `[${r.evidence.source.name}](${r.evidence.source.url}#page=4) — ${r.evidence.source.locator}.`,
    r.evidence.confidence,'',
    '## Evidence required before commitment','',
    ...r.evidenceGates.map(g=>`- **Unverified:** ${g.requires}`),'',
    '## Next investigations','',
    ...r.investigations.map((v,i)=>`${i+1}. **${v.question}.** ${v.action}`),'',
    '## Limits','',...r.limitations.map(v=>`- ${v}`),'',
    '## Reproducibility','',
    `Generated: ${r.generatedAt}. This is the report timestamp, not evidence freshness.`,
    `Report ID: ${r.reportId}`,
    `Method: ${r.method.id}; calculator SHA-256: ${r.method.calculatorSha256}.`,
    `Evidence snapshot: ${r.evidenceBinding.file}; SHA-256: ${r.evidenceBinding.sha256}.`,
    `Original source SHA-256: ${r.evidence.source.rawSha256}.`,
    'The paired JSON contains exact unrounded inputs, outputs, evidence and checks. The report ID excludes generation time; identical scenarios and evidence retain the same ID.','',
    r.evidence.redistribution,`[Source-use policy](${r.evidence.source.rightsUrl})`,'',
  ].join('\n');
}
