import {validateKennecottOutput,selectCircuitOutput} from './kennecott-output.mjs';
import {validateUsCircuits} from './us-circuits.mjs';
const BINDING={file:'facility-output-4b08bd220e65.json',sha256:'4b08bd220e653458699fae3a95a159824a17acfcea25979da5cea11d548071e8',bytes:4195};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export function makeFacilityOutputContext(input,circuits){
 if(input===undefined)return undefined;
 if(!input||canonical(Object.keys(input).sort())!==canonical(['binding','evidence'])||canonical(input.binding)!==canonical(BINDING))throw Error('Facility-output descriptor does not match the reviewed snapshot.');
 const evidence=structuredClone(input.evidence);validateKennecottOutput(evidence);validateUsCircuits(circuits);
 const processors=circuits.circuits.flatMap(group=>{
  const match=selectCircuitOutput(evidence,circuits,group.id);
  return group.facilities.map(facility=>({facilityId:facility.id,name:facility.name,state:facility.state,processRole:facility.kind,circuitId:group.id,
   observationIds:match.observations.filter(o=>o.facilityId===facility.id).map(o=>o.id),
   outputCoverage:match.observations.some(o=>o.facilityId===facility.id)?'historical_output_estimate':'no_reviewed_output_observation',
   currentOutput:null,availableSupply:null}));
 });
 return {binding:{...BINDING},evidence,processors,scope:'dated_output_context_for_reviewed_processors_only',
  coverageLimit:'Only the five named processors in the three reviewed historical groups are listed. This is not an exhaustive supplier inventory or a ranking. Missing output evidence is not zero production.',
  appliesToGunnison:false,canPopulateCathodeScenario:false,canReconcileNationalAccount:false,
  decisionEffect:'The Kennecott estimate belongs to the Magna refinery, not the unresolved Gunnison electrowinning role. It establishes no buyer allocation or deliverable quantity.',
  comparisonBarriers:[
   {id:'facility-identity',status:'unresolved',reason:'A curated Magna documentary match cannot identify the Gunnison physical refinery or a facility-to-buyer route.'},
   {id:'observation-period',status:'unresolved',reason:'The observation covers 2022. Publication in May 2026 does not make it current; no interpolation or constant daily rate is justified.'},
   {id:'product-mass-basis',status:'unresolved',reason:'The source says tonnes of cathode output without distinguishing gross product mass from copper-content mass. Buyer tonnes and national t Cu cannot be compared without that basis and an explicit product assay.'},
   {id:'estimate-and-availability',status:'unresolved',reason:'This rounded public-report-based estimate has no supplied uncertainty interval, current inventory, uncommitted allocation, accepted product specification or delivery evidence.'}],
  verifiedDeliverableTonnes:null,targetShareOfOutput:null,productToCopperFactor:null,sustainedDailyRate:null,
 };
}
export function facilityOutputMarkdownLines(context,circuits){
 if(context===undefined)return [];
 const expected=makeFacilityOutputContext({binding:context.binding,evidence:context.evidence},circuits);
 if(canonical(context)!==canonical(expected))throw Error('Facility-output context was changed.');
 const e=expected.evidence,o=e.observations[0],s=e.source;
 return ['## Dated evidence for named processors','',expected.coverageLimit,'',
  ...expected.processors.map(p=>`- ${p.name}, ${p.state} (${p.processRole}; ${p.facilityId}): ${p.outputCoverage==='historical_output_estimate'?'reviewed historical output estimate':'no reviewed output observation'}. Current output and available supply: unknown.`),'',
  `### ${e.facility.name} — ${e.facility.locality}`,'',
  `${o.value} ${o.unit} of ${o.material}; ${o.period.start} through ${o.period.end}. Kind: ${o.kind}.`,
  o.method,o.rounding,`Mass basis: ${o.basisNote}`,e.constraint,
  `Identity link: ${e.circuitLink.basis}`,expected.decisionEffect,'',
  '### What prevents comparison with this requirement','',...expected.comparisonBarriers.map(b=>'- '+b.reason),'',
  '**Verified deliverable supply remains unknown. No daily rate, target-share ratio, purity conversion or available quantity is calculated from this observation.**','',
  `[Reported output, PDF page 5](${s.url}#page=5); identity on PDF page 4; methods on PDF page 3. Published ${s.publicationDate} (month precision), acquired ${s.acquiredAt}.`,
  s.attribution,s.permission,`Snapshot SHA-256: ${expected.binding.sha256}; original SHA-256: ${s.rawSha256}.`,'',
 ];
}
