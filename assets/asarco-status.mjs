import {validateUsCircuits} from './us-circuits.mjs';

export function makeAsarcoStatus(){
 return {
  schemaVersion:1,id:'asarco-hayden-amarillo-status-2022-v1',kind:'historical_operating_status_disagreement',reviewedAt:'2026-10-22',
  sources:[
   {id:'sir-2023-5082',title:'USGS SIR 2023-5082',url:'https://pubs.usgs.gov/sir/2023/5082/sir20235082.pdf',rawSha256:'95eb20be6fc8507a811c2aa55e2e0aa167447a6018b8a0059151667ce89edd4d',publicationDate:'2023',publicationDatePrecision:'year',acquiredAt:null,pdfPage:97,printedPage:'85',rightsPdfPage:4,attribution:'U.S. Geological Survey, Vikre and others (2023), Critical Minerals in Subduction-related Magmatic-Hydrothermal Systems of the United States.'},
   {id:'myb-2022-copper',title:'USGS 2022 Copper Yearbook (advance release)',url:'https://pubs.usgs.gov/myb/vol1/2022/myb1-2022-copper.pdf',rawSha256:'74ee534b17fe338d8c250f3b2d9e407677190a66928776bfa190fe02ca8bfabf',publicationDate:'2026-05',publicationDatePrecision:'month',acquiredAt:'2026-10-15T01:48:01.187Z',pdfPage:4,printedPage:'20.2',rightsPdfPage:2,attribution:'U.S. Geological Survey, Flanagan, Copper—2022, advance release published May 2026.'},
  ],
  permission:'Original factual summaries of reviewed USGS-authored narrative, U.S. public domain. Corporate reports, third-party tables, illustrations and raw PDFs are excluded.',
  rightsUrl:'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',
  circuitId:'asarco-hayden-amarillo',
  facilities:[
   {id:'hayden-smelter',name:'ASARCO Hayden smelter',locality:'Hayden, Arizona, United States',role:'smelting',externalRegistryId:null},
   {id:'amarillo-refinery',name:'ASARCO Amarillo electrolytic refinery',locality:'Amarillo, Texas, United States',role:'electrolytic_refining',externalRegistryId:null},
  ],
  identityLink:{status:'curated_documentary_match',basis:'Both reports identify ASARCO, the Hayden smelter in Arizona and the Amarillo refinery in Texas. Baryon matches these names, localities and process roles to the existing circuit nodes; no external registry identifier is supplied.',establishesShipment:false},
  claims:[
   {id:'sir-operating-context',sourceId:'sir-2023-5082',facilityIds:['hayden-smelter','amarillo-refinery'],status:'operating_refinery_context_and_processing_association',period:{asOfYear:2022,start:null,end:null,precision:'as_of_year'},summary:'The SIR describes three domestic refineries as operating as of 2022, including Amarillo, and associates the ASARCO Hayden smelter and Amarillo refinery primarily with Ray, Mission and Silver Bell mine origins.',scope:'A broad refinery-status statement and processing association; no dated shipment or plant-specific operating measurement.'},
   {id:'yearbook-idle-2022',sourceId:'myb-2022-copper',facilityIds:['hayden-smelter','amarillo-refinery'],status:'reported_idle',period:{asOfYear:null,start:'2022-01-01',end:'2022-12-31',precision:'year'},summary:'The Yearbook reports that the Hayden smelter and Amarillo electrolytic refinery remained idle in 2022 after shutdowns in October 2019. As of yearend 2022, a restart date had not been publicly announced.',scope:'A facility-specific historical status report, citing company and other published information; not an independent Baryon operating observation.'},
  ],
  assessment:{status:'unresolved_source_disagreement',by:'Baryon documentary review',summary:'The operating-refinery description and the later, facility-specific idle report disagree for 2022. Preserve both statements and the reported processing association; do not treat the association as evidence of actual 2022 operations or material movements.',temporalLimit:'Both statements concern 2022. Publication in May 2026 does not establish operation in 2026, and publication order alone does not resolve the disagreement.',quantityLimit:'Reported idle status is not a measured zero-output or zero-shipment observation. Inventory and available supply are not established.',currentOperatingStatus:null,currentOutput:null,historicalOutputQuantity:null,shipmentQuantity:null,availableSupply:null,verifiedDeliverableSupply:null},
  nextEvidence:{need:'Dated operating records for the named Hayden and Amarillo facilities',acceptance:'Establish the physical facility, process role and reporting interval; retain source permissions and independent provenance. Resolve the historical disagreement separately from current operation, product quality, inventory, allocation and delivery.'},
  modelImprovementClaimed:false,
 };
}
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export function validateAsarcoStatus(data){
 if(canonical(data)!==canonical(makeAsarcoStatus()))throw new Error('ASARCO status differs from the reviewed source disagreement.');
 return data;
}
export function selectCircuitStatus(data,circuits,circuitId){
 validateAsarcoStatus(data);validateUsCircuits(circuits);
 const circuit=circuits.circuits.find(c=>c.id===circuitId);
 if(!circuit)throw new Error('Unknown processing group.');
 const matches=data.circuitId===circuitId&&data.facilities.every(f=>circuit.facilities.some(n=>n.id===f.id));
 return structuredClone({circuitId,qualification:matches?data:null,status:matches?'historical_source_disagreement':'no_reviewed_status_for_group',currentOperatingStatus:null,verifiedDeliverableSupply:null,canPopulateCathodeScenario:false});
}
