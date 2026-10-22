import {validateAsarcoStatus} from './asarco-status.mjs?v=20261022b';
const BINDING={file:'facility-status-5d833baa8d3e.json',sha256:'5d833baa8d3e78062b1e108153a023a879d625f3691088837b5da69cdb834e85',bytes:4510};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export function makeFacilityStatusContext(input){
 if(input===undefined)return undefined;
 if(!input||canonical(Object.keys(input).sort())!==canonical(['binding','evidence'])||canonical(input.binding)!==canonical(BINDING))throw Error('Facility-status descriptor does not match the reviewed snapshot.');
 const evidence=structuredClone(input.evidence);validateAsarcoStatus(evidence);
 return {binding:{...BINDING},evidence,scope:'historical_processing_group_context_only',appliesToGunnison:false,
  decisionEffect:'This ASARCO qualification is context about other processing facilities. It supplies no Gunnison operating status, output, allocation or delivery evidence and satisfies no buyer gate.',
  nextReview:{status:'evidence_needed',action:evidence.nextEvidence.need,acceptanceCriteria:evidence.nextEvidence.acceptance,acquisitionStatus:'not_started',expectedUtility:null,estimatedCost:null},
 };
}
export function facilityStatusMarkdownLines(context){
 if(context===undefined)return [];
 const expected=makeFacilityStatusContext({binding:context.binding,evidence:context.evidence});
 if(canonical(context)!==canonical(expected))throw Error('Facility-status context was changed.');
 const e=expected.evidence;
 return ['## Historical processing-status disagreement','',
  '**ASARCO Hayden / Amarillo: reports disagree for 2022. Current operating status and deliverable supply remain unknown.**','',
  ...e.claims.flatMap(c=>{const s=e.sources.find(s=>s.id===c.sourceId);return [
   `### ${s.title}`,'',`Published ${s.publicationDate} (${s.publicationDatePrecision} precision); ${c.period.asOfYear?'as of '+c.period.asOfYear:c.period.start+' through '+c.period.end}.`,
   c.summary,c.scope,`[Source, PDF page ${s.pdfPage}, printed ${s.printedPage}](${s.url}#page=${s.pdfPage}).`,
   `${s.attribution} Original source SHA-256: ${s.rawSha256}. Acquisition: ${s.acquiredAt??'unknown'}.`,'',
  ];}),e.assessment.summary,e.assessment.temporalLimit,e.assessment.quantityLimit,expected.decisionEffect,'',
  `Context review needed: ${expected.nextReview.action}.`,expected.nextReview.acceptanceCriteria,
  'This contextual review is separate from the four unresolved buyer evidence gates. No acquisition or gate promotion is performed; expected utility and cost remain unknown.','',
  `Qualification reviewed: ${e.reviewedAt}; snapshot ${expected.binding.file}; SHA-256 ${expected.binding.sha256}.`,e.permission,'',
 ];
}
