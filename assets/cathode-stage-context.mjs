import {validateKennecottStages,canonical} from './kennecott-stages.mjs?v=kennecott-stages-20261025';
export const STAGE_BINDING={"file":"facility-stages-05e3aef2b171.json","sha256":"05e3aef2b171b7a72d52ae680c2a628608166850a71689dd4471e8b847b79f30","bytes":6850};
export function makeStageContext(input){
 if(input===undefined)return undefined;
 if(!input||canonical(Object.keys(input).sort())!==canonical(['binding','evidence'])||canonical(input.binding)!==canonical(STAGE_BINDING))throw Error('Production-stage descriptor differs from the reviewed snapshot.');
 const evidence=structuredClone(input.evidence);validateKennecottStages(evidence);
 return {binding:{...STAGE_BINDING},evidence,scope:'historical_kennecott_stages_only',appliesToGunnison:false,canPopulateCathodeScenario:false,canReconcileNationalAccount:false,canPromoteBuyerGates:false,verifiedDeliverableTonnes:null,
  decisionEffect:'These 2022 Kennecott estimates describe two distinct product stages in Magna. They do not resolve the Gunnison physical refinery, actual current output, product compatibility, buyer allocation or delivery.'};
}
export function stageContextMarkdownLines(context){
 if(context===undefined)return [];
 const expected=makeStageContext({evidence:context.evidence,binding:context.binding});if(canonical(context)!==canonical(expected))throw Error('Production-stage context was changed.');
 const e=expected.evidence,s=e.source;
 return ['## Kennecott: two production stages, one historical year','',...e.observations.flatMap(o=>[`### ${e.facilities.find(f=>f.id===o.facilityId).name}`,'',`${o.value} ${o.unit} of ${o.material}; ${o.period.start} through ${o.period.end}. Kind: ${o.kind}.`,o.basisNote,o.rounding,'']),
 e.observations[0].method,e.identity.basis,e.constraint,e.interpretation.rule,'',
 'Recovery, utilization, transfers, inventory change and verified supply: unknown. No stage ratio or difference is calculated.','',
 'Evidence needed for reconciliation:',...e.interpretation.missingEvidence.map(v=>'- '+v),'',expected.decisionEffect,
 e.limitations.at(-1),'',`[Output, PDF page 5](${s.url}#page=5); identity on PDF page 4; methods on PDF page 3. Published ${s.publicationDate}; acquired ${s.acquiredAt}.`,s.attribution,s.permission,`Snapshot SHA-256: ${expected.binding.sha256}; original SHA-256: ${s.rawSha256}.`,''];
}
