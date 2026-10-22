import {makeFacilityStatusContext,facilityStatusMarkdownLines} from './cathode-facility-status.mjs?v=20261022c';
import {cathodeRequirementLines} from './cathode-requirement.mjs';
import {validateCathodeDecision} from './cathode-decision.mjs?v=20261021d';

// Versioned mapping to a reviewed public snapshot; new evidence requires a new review/binding.
const REVIEW = Object.freeze({file:'research-review-43ad3aad1259.json',sha256:'43ad3aad1259b7cbad6f4e60899d234cddbb4b4427568e3cbfb77152b3222508',bytes:8896});
const REVIEW_CANONICAL = '3d84ad926c04f007bde39295e0e9c2e9bddb01ec51d8023afd636b8b2f6607d4';
const ACCESS_REVIEW = Object.freeze({file:'research-review-c00e75a48992.json',sha256:'c00e75a48992b049aadf2b818e30fe5b41ef402175f551a0c30aa48cf60388c9',bytes:9484});
const ACCESS_CANONICAL = '1c3f20575f308a5f842e33790e4b9ad9efbeda4be4867170a757c96b9c780ef3';
const canonical = v => v===null || typeof v!=='object' ? JSON.stringify(v) : Array.isArray(v) ? '['+v.map(canonical).join(',')+']' : '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const clone = v => JSON.parse(JSON.stringify(v));
const check = (ok,message) => {if(!ok)throw new Error(message);};
const sha = async v => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v))))].map(x=>x.toString(16).padStart(2,'0')).join('');
const RULES = [
  {id:'current-operations',title:'Establish current sustained output',sourceIds:['usgs-gunnison-2022','gunnison-publisher','epa-gunnison-2023'],
    sourceCoverage:'Historical context and candidate review links only. No current output measurement is admitted.',
    nextAction:'Resolve the exact facility and process, then find a permitted dated operating measurement and applicable final authorization. Review the EPA document scope before importing any fields.',
    proposedObservation:'Facility ID, process, observation interval, measured cathode product tonnes and operating interruptions, plus a separate authorization record.',
    decisionEffect:'Could support an observed output-rate input for its stated interval. Extrapolation to the requested delivery window would still be an assumption.'},
  {id:'product-quality',title:'Establish an acceptable product',sourceIds:['gunnison-publisher'],
    sourceCoverage:'Publisher link is a lead only; no dated assay, specification or buyer acceptance is admitted.',
    nextAction:'Identify permitted dated product specifications and assay evidence tied to the same facility and lot, then document the required buyer specification and acceptance.',
    proposedObservation:'Facility and lot IDs, sampling/assay date, method, cathode specification and documented acceptance criteria.',
    decisionEffect:'Could establish product compatibility for the specified lot. It would not establish available quantity or allow an unsupported contained-copper conversion.'},
  {id:'allocation',title:'Establish uncommitted quantity',sourceIds:['gunnison-publisher'],
    sourceCoverage:'Publisher link is a lead only; no current inventory or commitment ledger is admitted.',
    nextAction:'Find permitted inventory and allocation evidence for the exact facility and interval. Account for existing commitments before treating any volume as available.',
    proposedObservation:'Dated inventory/output basis, product identity, existing commitments and uncommitted tonnes for the requested interval.',
    decisionEffect:'Could support an available-share or inventory estimate for the stated interval. Capacity minus sales cannot provide this quantity.'},
  {id:'delivery',title:'Establish delivery dates and route',sourceIds:[],
    sourceCoverage:'No suitable delivery source is identified in this reviewed queue.',
    nextAction:'Specify calendar dates and destination, then identify permitted route, lead-time, transport-capacity and loss evidence for the proposed allocation.',
    proposedObservation:'Allocation ID, origin/destination, calendar window, route constraints, shipment or lead-time basis, and product-mass loss accounting.',
    decisionEffect:'Could support timing and retention assumptions for a specified allocation. Country trade totals and customs destinations do not prove this facility-to-buyer route.'},
];

export async function makeCathodeResearchHandoff(decision,review,descriptor,statusInput){
  // Copy all caller-owned content before the first asynchronous digest.
  const decisionCopy=clone(decision),reviewCopy=clone(review),facilityStatus=makeFacilityStatusContext(statusInput);
  const accessReview=descriptor?.file===ACCESS_REVIEW.file;
  const binding=accessReview?ACCESS_REVIEW:REVIEW,canonicalHash=accessReview?ACCESS_CANONICAL:REVIEW_CANONICAL;
  for(const [key,value]of Object.entries(binding))check(descriptor?.[key]===value,'Research review descriptor does not match the reviewed snapshot.');
  const verified=await validateCathodeDecision(decisionCopy);
  check(await sha(reviewCopy)===canonicalHash,'Research review content does not match the reviewed snapshot.');
  const rules=clone(RULES);
  if(accessReview)Object.assign(rules[0],{
    sourceCoverage:'Historical context and candidate links only. The queued EPA URL returned HTTP 404; document review is incomplete. No current output measurement is admitted.',
    nextAction:'Resolve the exact facility and process, then find a permitted dated operating measurement. Identify an accessible official permit copy or verified replacement before reviewing authorization. A failed download does not establish permit revocation.',
  });
  const roleIdentity=verified.evidence.schemaVersion===2;
  if(roleIdentity)Object.assign(rules[0],{
    title:'Resolve physical identity before measuring output',
    nextAction:verified.evidence.identityResolution.admissionRule+' Then review permitted dated operating measurements and applicable authorization. The previously failed EPA URL remains unresolved; do not retry it without a verified replacement.',
    proposedObservation:'Explicit source-backed role-to-physical-facility link, stable facility identifier or distinguishing name/location, process, valid interval, cathode product tonnes and interruptions; separate authorization evidence.',
  });
  if(verified.schemaVersion===3)rules[3].nextAction='Use the buyer requirement attached to this task; clarify any unspecified dates or destination. Identify permitted route, lead-time, transport-capacity and loss evidence for the same allocation and requested window. Buyer entries do not verify location, capability or arrival.';
  const tasks=rules.map((rule,index)=>{
    const gate=verified.evidenceGates.find(g=>g.id===rule.id);
    check(gate?.status==='unverified','Unsupported evidence gate.');
    const buyerScope=verified.schemaVersion===3?{buyerScope:{targetTonnes:verified.requirement.targetTonnes,horizonDays:verified.requirement.horizonDays,...clone(verified.buyerRequest),provenance:'user_requirement',observed:false}}:{};
    return {...clone(rule),...buyerScope,order:index+1,status:'evidence_needed',gateStatus:gate.status,acceptanceCriteria:gate.requires,
      acquisitionStatus:'not_started',gateSatisfied:false,expectedUtility:null,estimatedCost:null};
  });
  const handoff={schemaVersion:1,kind:'cathode_research_handoff',method:facilityStatus?'cathode-research-handoff-v5-status-context':roleIdentity?'cathode-research-handoff-v4-role-identity':verified.schemaVersion===3?'cathode-research-handoff-v3-buyer-requirement':accessReview?'cathode-research-handoff-v2-source-access':'cathode-research-handoff-v1',
    ...(facilityStatus?{facilityStatus}:{}),
    decisionReport:verified,reviewBinding:{...binding,canonicalSha256:canonicalHash},review:reviewCopy,
    registryHead:clone(reviewCopy.registryHead),tasks,
    sources:reviewCopy.sourceDecisions.filter(s=>tasks.some(t=>t.sourceIds.includes(s.id))),
    evidenceRecordRequired:['Source URL and original artifact SHA-256','Applicable reuse permission and permitted fields','Persistent facility/product/lot identity','Observation interval and publication/retrieval dates','Quantity, units, mass basis, measurement method and uncertainty','Commitment/allocation and delivery linkage where relevant'],
    completionRule:'A link, permission receipt or completed download cannot satisfy a gate. Review dated, correctly scoped observations against its acceptance criteria, publish an explicitly permitted versioned evidence snapshot, then recreate the decision. This handoff performs no acquisition or gate promotion.',
    researchConstraints:{
      geologicalReview:clone(reviewCopy.nextInvestigations.find(i=>i.id==='independent-geological-test')),
      bcOutcome:clone(reviewCopy.outcome),
      selectedCoreEvidence:'Copperwood assays describe selected known-deposit drill cores; they are not representative discovery evidence or independent negative examples.',
      sourceAdmission:'This workflow admits no new assays and changes no audit, protocol, partition or seed. A future geological experiment requires independently reviewed source permission and a frozen evaluation.',
    },
    scheduling:clone(reviewCopy.scheduling),
    evaluation:{selectionPolicy:'fixed_curated_gate_order',researchPolicyGain:null,expectedDecisionUtility:null,observedDecisionUtility:null,newEvidenceAcquired:false,modelImprovementClaimed:false},
    limitations:[
      'All four gates remain unresolved, even when the entered arithmetic reaches the target. Verified deliverable supply remains unknown.',
      'Source status is the recorded review status, not a live permission or operating-status check. No company numerical values are imported.',
      'Candidate links do not establish that the required evidence exists. No suitable delivery source has been identified in this queue.',
      'The gate order is a curated checklist, not a measured ranking of research value. Costs and research-policy gains remain unknown.',
      'The soil and BC audits are permanently consumed. No tuning, new split, renamed cohort or changed seed may reuse them.',
      'Hashes bind these snapshots and detect changes; they do not certify source truth, observation independence or complete coverage.',
    ],
  };
  const identity=clone(handoff);delete identity.decisionReport.generatedAt;
  return {...handoff,handoffId:await sha(identity)};
}

export async function validateCathodeResearchHandoff(handoff){
  const snapshot=clone(handoff);
  const expected=await makeCathodeResearchHandoff(snapshot.decisionReport,snapshot.review,snapshot.reviewBinding,snapshot.facilityStatus?{evidence:snapshot.facilityStatus.evidence,binding:snapshot.facilityStatus.binding}:undefined);
  check(canonical(snapshot)===canonical(expected),'Research handoff changed or uses an unsupported method. Recreate it from the current scenario.');
  return expected;
}

export async function cathodeResearchHandoffMarkdown(handoff){
  const r=await validateCathodeResearchHandoff(handoff),d=r.decisionReport;
  const n=v=>v===null?'Unknown':String(v);
  return ['# Baryon copper research handoff','',
    '**Investigate before commitment. Verified deliverable supply: unknown. All four evidence gates are unresolved.**','',
    `Requirement: ${n(d.requirement.targetTonnes)} t cathode product over ${n(d.requirement.horizonDays)} ${d.requirement.windowStart?'calendar':'relative'} days. Product purity remains unverified.`,
    ...(d.schemaVersion===3?cathodeRequirementLines(d.requirement):['Calendar dates are unknown.']),
    `Entered scenario: ${d.decision.scenarioStatus}; conditional delivery ${n(d.result.conditionalTonnes)} t; delivery minus target ${n(d.result.gapTonnes)} t.`,
    'These figures are arithmetic under user assumptions, not measured current supply or a forecast. The paired JSON includes the complete decision brief and exact assumptions.','',
    '## Evidence tasks','',...r.tasks.flatMap(t=>[
      `### ${t.order}. ${t.title}`,'',`**Unresolved.** ${t.acceptanceCriteria}`,'',
      `Next action: ${t.nextAction}`,`Record: ${t.proposedObservation}`,`Possible decision effect: ${t.decisionEffect}`,
      `Source coverage: ${t.sourceCoverage}`,
      ...t.sourceIds.map(id=>{const s=r.sources.find(s=>s.id===id);return `- [${s.name}](${s.sourceUrl}) — ${s.status}; reviewed ${s.reviewedAt}. ${s.permittedUse}${s.policy?` [Recorded reuse policy](${s.policy.url})`:''}`;}),
      'Acquisition: not started. Gate satisfied: no. Expected utility and cost: unknown.','',
    ]),
    ...facilityStatusMarkdownLines(r.facilityStatus),
    '## Evidence acceptance record','',...r.evidenceRecordRequired.map(x=>'- '+x),'',r.completionRule,'',
    '## Research safeguards','',r.researchConstraints.geologicalReview.reason,
    ...r.researchConstraints.geologicalReview.requires.map(x=>'- '+x),
    `BC outcome: ${r.researchConstraints.bcOutcome.decision}; the uncertainty gate failed. No accepted improvement from that candidate.`,
    r.researchConstraints.selectedCoreEvidence,r.researchConstraints.sourceAdmission,'',
    '## Revisit triggers','',...r.sources.map(s=>`- ${s.name}: ${s.revisitWhen}`),'',r.scheduling.rule,
    'No automatic source polling, evidence acquisition, external communication or learned priority selection is performed. Research-policy gain and observed decision utility are unknown.','',
    '## Limits','',...r.limitations.map(x=>'- '+x),'',
    '## Reproduce this handoff','',`Decision generated: ${d.generatedAt}; source review date: ${r.review.reviewedAt}. Generation is not evidence freshness.`,
    `Decision ID: ${d.reportId}`,`Handoff ID: ${r.handoffId}`,`Method: ${r.method}`,
    `Review: ${r.reviewBinding.file}; SHA-256 ${r.reviewBinding.sha256}.`,
    `Reviewed registry: sequence ${r.registryHead.sequence}; ${r.registryHead.hash}.`,
    'The JSON embeds the validated decision and reviewed public source snapshot. Revalidation recomputes both the decision and all gate mappings; generation time is excluded from the handoff ID.','',
  ].join('\n');
}
