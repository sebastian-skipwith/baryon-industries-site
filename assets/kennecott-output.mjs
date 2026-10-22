import {validateUsCircuits} from './us-circuits.mjs';

export const KENNECOTT_RAW_SHA256='74ee534b17fe338d8c250f3b2d9e407677190a66928776bfa190fe02ca8bfabf';
export function makeKennecottOutput(){
 return {
  schemaVersion:1,id:'kennecott-cathode-output-2022-v1',kind:'historical_facility_output',reviewedAt:'2026-10-22',
  source:{id:'usgs-myb-2022-copper-kennecott',name:'USGS 2022 Minerals Yearbook: Copper (advance release)',author:'Daniel M. Flanagan',url:'https://pubs.usgs.gov/myb/vol1/2022/myb1-2022-copper.pdf',rawSha256:KENNECOTT_RAW_SHA256,publicationDate:'2026-05',publicationDatePrecision:'month',acquiredAt:'2026-10-15T01:48:01.187Z',locator:'Kennecott paragraph, printed pages 20.2–20.3 / PDF pages 4–5; methods and rounding on PDF page 3',pdfPages:[3,4,5],rightsPdfPage:2,rightsUrl:'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',permission:'Original factual summary of reviewed USGS-authored narrative, U.S. public domain. No corporate reports, third-party tables, illustrations or raw PDF are exported.',attribution:'U.S. Geological Survey, Flanagan, Copper—2022, advance release published May 2026.'},
  facility:{id:'magna-refinery',name:'Kennecott electrolytic refinery',locality:'Magna, Utah, United States',operatorAsReported:'Rio Tinto',role:'electrolytic_refining',idAuthority:'baryon_curated',externalRegistryId:null,coordinates:null},
  circuitLink:{circuitId:'bingham-magna',facilityId:'magna-refinery',status:'curated_documentary_match',basis:'The Yearbook names the Kennecott electrolytic refinery in Magna, Utah in the paragraph continued onto the cathode-output statement. The SIR names the Rio Tinto refinery in Magna, Utah. This matches the reported name, locality and process; it is not an external registry-ID match.',sourceUrl:'https://pubs.usgs.gov/sir/2023/5082/sir20235082.pdf',sourceRawSha256:'95eb20be6fc8507a811c2aa55e2e0aa167447a6018b8a0059151667ce89edd4d',locator:'Printed page 85 / PDF page 97',independentProductionConfirmation:false,establishesShipment:false},
  observations:[{id:'kennecott-cathodes-2022',facilityId:'magna-refinery',period:{start:'2022-01-01',end:'2022-12-31',precision:'year'},kind:'public_report_based_output_estimate',material:'Copper cathodes',value:148000,unit:'t',massBasis:'reported_cathode_output_basis_unspecified',basisNote:'Tonnes of cathode output as stated. The selected narrative does not distinguish gross cathode-product mass from copper-content mass or specify purity; no conversion is made.',rounding:'Source quantities rounded to at most three significant digits; no exact underlying value or uncertainty interval supplied.',method:'USGS states that 2021–2022 smelter and electrolytic-refinery outputs were estimated from public company information, rather than actual production reported confidentially to USGS. The Kennecott paragraph cites company reports; this is not an independent Baryon measurement.',sourceId:'usgs-myb-2022-copper-kennecott',locator:'Printed page 20.3 / PDF page 5, continuation of Kennecott paragraph',uncertainty:null}],
  constraint:'The source reports unplanned smelter-anode-furnace maintenance in the fourth quarter of 2022. Annual output does not establish a sustained daily rate.',
  unknowns:{currentOperatingStatus:null,currentOutput:null,sustainedDailyRate:null,cathodePurity:null,productToCopperFactor:null,uncommittedInventory:null,buyerAllocation:null,shipmentQuantity:null,verifiedDeliverableSupply:null},
  limitations:[
   'This observation covers 2022. May 2026 is the publication month, not the observation date or proof of current operation.',
   'The reported cathode output is separate from mine copper, anode output, nameplate capacity and sales. Do not sum stages or derive recovery from their ratios.',
   'A reported processing association does not prove how much of the cathode output came from Bingham, from other feed or from inventory.',
   'The source reports are not independent production measurements. No confidence probability or new model evaluation is inferred.',
   'No quantity is assigned to Gunnison or another facility, and no buyer evidence gate is satisfied. Current supply, product compatibility and delivery remain unverified.',
  ],
  modelImprovementClaimed:false,
 };
}
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export function validateKennecottOutput(data){
 if(canonical(data)!==canonical(makeKennecottOutput()))throw new Error('Kennecott output differs from the reviewed historical evidence.');
 return data;
}
export function selectCircuitOutput(data,circuits,circuitId){
 validateKennecottOutput(data);validateUsCircuits(circuits);
 const circuit=circuits.circuits.find(c=>c.id===circuitId);
 if(!circuit)throw new Error('Unknown processing group.');
 const matches=data.circuitLink.circuitId===circuitId&&circuit.facilities.some(f=>f.id===data.facility.id);
 return structuredClone({circuitId,observations:matches?data.observations:[],facility:matches?data.facility:null,link:matches?data.circuitLink:null,status:matches?'historical_output_only':'no_reviewed_output_for_group',verifiedDeliverableSupply:null,currentOutput:null,canPopulateCathodeScenario:false});
}
