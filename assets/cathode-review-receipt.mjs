import {preflightOperatingRecord,sha256Bytes} from '/assets/cathode-operating-preflight.mjs?v=20261023a';
import {validateCathodeResearchHandoff} from '/assets/cathode-research-handoff.mjs?v=20261022c';

export const CATHODE_REVIEW_RECEIPT_METHOD='cathode-review-receipt-v1';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const digest=v=>sha256Bytes(new TextEncoder().encode(canonical(v)));
const check=(ok,message)=>{if(!ok)throw Error(message);};
const time=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
async function binding(handoff){
 const h=await validateCathodeResearchHandoff(handoff),d=h.decisionReport;
 check(d.evidence.schemaVersion===2&&d.evidence.processRoles.some(r=>r.id==='us-az-gunnison-ew'),'Use a handoff with the unresolved physical electrowinning role.');
 const task=h.tasks.find(t=>t.id==='current-operations');
 check(task?.gateStatus==='unverified'&&task.gateSatisfied===false,'The operating task must remain unresolved.');
 return {decisionReportId:d.reportId,researchHandoffId:h.handoffId,taskId:task.id,pathwayRoleId:'us-az-gunnison-ew',evidenceBinding:structuredClone(d.evidenceBinding),sourceReviewBinding:structuredClone(h.reviewBinding),reviewedRegistryHead:structuredClone(h.registryHead)};
}
async function receipt(handoff,activity,reviewedAt){
 check(time(reviewedAt),'Use an ISO UTC receipt timestamp.');
 const taskBinding=await binding(handoff);
 const status=activity.kind==='source_access_failure'?'blocked_on_source_access':activity.preflight.status==='ready_for_manual_review'?'pending_manual_review':'needs_evidence';
 const r={schemaVersion:1,kind:'cathode_evidence_review_receipt',method:CATHODE_REVIEW_RECEIPT_METHOD,reviewedAt,taskBinding,status,activity,
  gateStatus:'unverified',gateSatisfied:false,sourceReviewCompleted:false,observationAdmitted:false,verifiedDeliverableTonnes:null,modelImprovementClaimed:false,researchPolicyGain:null,
  meaning:'A receipt links this review activity to an exact decision and research task. Pending manual review is not accepted evidence. An access failure is not a finding about facility operation or permit validity.',
  nextAction:status==='blocked_on_source_access'?'Identify an authoritative accessible copy or documented availability change before another attempt; do not retry an unchanged failed URL or bypass restrictions. Review document scope and permitted fields before any admission.':status==='needs_evidence'?'Resolve the listed evidence gaps, then rerun the preflight and create a new receipt. Preserve the earlier receipt as an unresolved record.':'Inspect the original documents, observation interval, physical identity, measurement basis and permission independently. Review authorization separately before admitting any explicitly permitted fields.',
  limits:['No source fact, operating input or supply gate is updated by creating this receipt.','Retain the handoff, candidate and original files privately to reproduce the bound checks. Hashes detect changes; they do not certify truth or source origin.','A changed buyer requirement or scenario requires a new handoff and receipt. Older reports remain valid only for their original content.','Registry references are those of the bound historical source review, not a claim about the live registry head. No scientific audit is run or reused.'],
 };
 return {...r,receiptId:await digest(r)};
}

export async function makeCathodeOperatingReviewReceipt(handoff,candidate,artifacts,reviewedAt){
 // Snapshot everything before any digest or validation yields.
 const h=structuredClone(handoff),c=structuredClone(candidate),a=structuredClone(artifacts);
 check(time(reviewedAt),'Use an ISO UTC receipt timestamp.');
 const preflight=await preflightOperatingRecord(c,a,reviewedAt);
 return receipt(h,{kind:'operating_preflight',preflight},reviewedAt);
}
export async function validateCathodeOperatingReviewReceipt(value,handoff,candidate,artifacts){
 const v=structuredClone(value),expected=await makeCathodeOperatingReviewReceipt(handoff,candidate,artifacts,v?.reviewedAt);
 check(canonical(v)===canonical(expected),'Receipt changed or belongs to a different decision, candidate or source binding.');return expected;
}

// Access-only receipts are separate from operating candidates. Headers can never count as a source PDF.
export async function makeCathodeSourceAccessReceipt(handoff,observation,headerBytes,reviewedAt){
 const h=structuredClone(handoff),o=structuredClone(observation),bytes=new Uint8Array(headerBytes).slice();
 check(time(reviewedAt),'Use an ISO UTC receipt timestamp.');
 check(o&&Object.keys(o).sort().join(' ')==='bodyArchived headerSha256 httpStatus method recordedAt responseDate tlsVerificationDisabled url','Unsupported access observation fields.');
 let url;try{url=new URL(o.url);}catch{throw Error('Invalid access source URL.');}
 check(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&o.url.length<=2048,'Use an HTTPS source URL without embedded credentials or fragments.');
 check(o.method==='GET'&&Number.isInteger(o.httpStatus)&&o.httpStatus>=400&&o.httpStatus<=599&&o.bodyArchived===false&&o.tlsVerificationDisabled===false,'Only a failed TLS-verified GET without an archived body is supported.');
 check(time(o.recordedAt)&&o.recordedAt<=reviewedAt&&typeof o.responseDate==='string','Invalid access observation time.');
 const date=new Date(o.responseDate);
 check(Number.isFinite(date.valueOf())&&date.toUTCString()===o.responseDate&&date.toISOString()<=o.recordedAt,'Invalid or inconsistent server response date.');
 check(bytes.length>0&&bytes.length<=16384,'Access headers must be nonempty and at most 16 KiB.');
 check(/^[a-f0-9]{64}$/.test(o.headerSha256)&&await sha256Bytes(bytes)===o.headerSha256,'Access header checksum mismatch.');
 const headers=new TextDecoder('utf-8',{fatal:true}).decode(bytes),statuses=[...headers.matchAll(/^HTTP\/1\.[01] (\d{3})[^\r\n]*\r?$/gm)],dates=[...headers.matchAll(/^Date: ([^\r\n]+)\r?$/gmi)];
 check(statuses.length===1&&Number(statuses[0][1])===o.httpStatus&&dates.length===1&&dates[0][1]===o.responseDate,'Access status or date differs from the archived single response.');
 return receipt(h,{kind:'source_access_failure',observation:o,headerBytes:bytes.length,documentAcquired:false,permissionReviewed:false,observationInterval:null},reviewedAt);
}
export async function validateCathodeSourceAccessReceipt(value,handoff,observation,headerBytes){
 const v=structuredClone(value),expected=await makeCathodeSourceAccessReceipt(handoff,observation,headerBytes,v?.reviewedAt);
 check(canonical(v)===canonical(expected),'Access receipt changed or belongs to another decision or response.');return expected;
}
