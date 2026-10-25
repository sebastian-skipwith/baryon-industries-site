import {validateCathodeDecision,cathodeDecisionMarkdown} from './cathode-decision.mjs';
import {validateCathodeResearchHandoff,cathodeResearchHandoffMarkdown} from './cathode-research-handoff.mjs?v=msha-identity-20261025';
import {validateCathodeThresholdReport,cathodeThresholdMarkdown} from './cathode-thresholds.mjs?v=msha-identity-20261025';
import {validateCathodeFlowContext,cathodeFlowContextMarkdown} from './cathode-flow-context.mjs?v=facility-context-20261025';
import {validateCopperDemandContext,copperDemandContextMarkdown} from './copper-demand-context.mjs';
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const check=(ok,message)=>{if(!ok)throw Error(message);};
const digest=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v))))].map(v=>v.toString(16).padStart(2,'0')).join('');
export const CATHODE_PACKAGE_METHOD='cathode-decision-package-v1';

export async function makeCathodeDecisionPackage(input){
 // Only named members are serialized. Freeze inputs before any asynchronous validator.
 const raw=Object.fromEntries(['decision','researchHandoff','thresholds','flowContext','demandContext'].map(k=>[k,input?.[k]==null?null:clone(input[k])])),generatedAt=input?.generatedAt;
 check(typeof generatedAt==='string'&&Number.isFinite(Date.parse(generatedAt))&&new Date(generatedAt).toISOString()===generatedAt,'Use an exact UTC package timestamp.');
 check(raw.decision&&raw.researchHandoff&&raw.thresholds&&raw.flowContext,'All four decision reports are required.');
 const decision=await validateCathodeDecision(raw.decision),researchHandoff=await validateCathodeResearchHandoff(raw.researchHandoff),thresholds=await validateCathodeThresholdReport(raw.thresholds),flowContext=await validateCathodeFlowContext(raw.flowContext);
 const demandContext=raw.demandContext?await validateCopperDemandContext(raw.demandContext):null;
 check(canonical(decision)===canonical(researchHandoff.decisionReport)&&canonical(decision)===canonical(flowContext.decisionReport),'Reports belong to different decisions.');
 check(canonical(researchHandoff)===canonical(thresholds.researchHandoff),'Threshold comparison belongs to a different research handoff.');
 check(canonical(researchHandoff.facilityStatus??null)===canonical(flowContext.facilityStatus??null),'Operating-status context differs between reports.');
 if(demandContext){
  check(demandContext.flows&&demandContext.sources.flows,'The attached context must include a reviewed US account.');
  check(canonical(demandContext.sources.flows.binding)===canonical(flowContext.flowBinding),'Attached US source binding does not match the decision account.');
  check(canonical(demandContext.flows.period)===canonical(flowContext.account.period),'Attached US reporting period does not match the decision account.');
 }
 const req=decision.requirement,dp=demandContext?.demand.period;
 const demandPeriodStatus=!dp?'not_attached':!req.windowStart?'buyer_dates_unspecified':req.windowStart===dp.start&&req.windowEnd===dp.end?'same_interval':'different_interval';
 const body={schemaVersion:1,kind:'cathode_integrated_decision_package',method:CATHODE_PACKAGE_METHOD,
  members:{decision,researchHandoff,thresholds,flowContext,demandContext},
  bindings:{decisionId:decision.reportId,researchHandoffId:researchHandoff.handoffId,thresholdReportId:thresholds.reportId,flowContextId:flowContext.reportId,demandContextId:demandContext?.reportId??null},
  compatibility:{status:'investigate_before_commitment',historicalContextAttached:Boolean(demandContext),usAccountBinding:demandContext?'same_source_and_period':'not_attached',buyerToDemandPeriod:demandPeriodStatus,
   explanation:'Historical global demand is context, not this buyer requirement. A matching US account binds provenance only; it cannot establish geographic allocation, product quality, current operations, commitments or delivery.',
   demandShareAllocatedToBuyer:null,globalSupplyGapTonnesCu:null,verifiedDeliverableTonnes:null,verifiedTargetMet:null,productToCopperFactor:null,evidenceGatesPromoted:false},
  learning:{newEvidenceAcquired:false,independentValidationPerformed:false,modelImprovementClaimed:false,researchPolicyGain:null},
  limitations:['The four original report formats and their evidence gates are unchanged; this package binds their exact contents.','Conditional cathode delivery remains arithmetic under user assumptions, not a current offer or forecast.','Demand estimates exclude direct-use scrap and use a different scope from the national account. Mill quantities are gross product mass.','No allocation, supply gap, purity conversion, current output or research improvement follows from attaching historical context.','Buyer entries and reports stay in the page and downloaded files; no server persistence or external communication is performed.']};
 return {...body,packageId:await digest(body),generatedAt};
}

export async function validateCathodeDecisionPackage(report){
 const r=clone(report);check(r?.schemaVersion===1&&r.method===CATHODE_PACKAGE_METHOD,'Unsupported decision package method.');
 const expected=await makeCathodeDecisionPackage({...r.members,generatedAt:r.generatedAt});check(canonical(r)===canonical(expected),'Decision package changed; rebuild from validated reports.');return expected;
}

export async function cathodeDecisionPackageMarkdown(report){
 const r=await validateCathodeDecisionPackage(report),m=r.members;
 const parts=[['Buyer decision',await cathodeDecisionMarkdown(m.decision)],['Research handoff',await cathodeResearchHandoffMarkdown(m.researchHandoff)],['Conditional thresholds',await cathodeThresholdMarkdown(m.thresholds)],['Regional copper account',await cathodeFlowContextMarkdown(m.flowContext)]];
 if(m.demandContext)parts.push(['Historical global demand and production context',await copperDemandContextMarkdown(m.demandContext)]);
 return ['# Baryon integrated copper decision package','',
  '**Investigate before commitment. Verified deliverable supply remains unknown.**','',
  `Historical context: ${m.demandContext?'attached; global demand '+m.demandContext.demand.year:'not attached'}. Buyer-to-demand interval: ${r.compatibility.buyerToDemandPeriod.replaceAll('_',' ')}.`,r.compatibility.explanation,'',
  `Package ID: ${r.packageId}`,`Generated: ${r.generatedAt}`,'',...Object.entries(r.bindings).map(([k,v])=>`- ${k}: ${v??'Not attached'}`),'',...r.limitations.map(v=>'- '+v),'',
  ...parts.flatMap(([title,text])=>['## '+title,'',text.replace(/^# [^\n]+\n\n/,'').replace(/^#/gm,'##'),''])].join('\n');
}
