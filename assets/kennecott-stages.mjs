import {makeKennecottOutput} from './kennecott-output.mjs';
// Reviewed USGS narrative only. No extrapolation or feed/inventory assumptions.
export function makeKennecottStages(){
 const prior=makeKennecottOutput(),cathode=prior.observations[0];
 return {schemaVersion:1,id:'kennecott-production-stages-2022-v1',kind:'historical_production_stage_context',reviewedAt:'2026-10-25',source:prior.source,
  facilities:[{id:'kennecott-smelter',name:'Kennecott copper smelter',locality:prior.facility.locality,operatorAsReported:'Rio Tinto',role:'smelting_anode_production',idAuthority:'baryon_curated',externalRegistryId:null,coordinates:null},prior.facility],
  observations:[{...cathode,id:'kennecott-anodes-2022',facilityId:'kennecott-smelter',material:'Copper anodes',value:145000,massBasis:'reported_anode_output_basis_unspecified',basisNote:'Tonnes of anode output as stated. The selected narrative does not distinguish gross anode-product mass from copper-content mass or specify purity; no conversion is made.'},cathode],
  identity:{status:'curated_documentary_match',basis:'The same USGS paragraph names the Kennecott smelter and electrolytic refinery in Magna, Utah, and continues with their respective 2022 anode and cathode outputs. The smelter identifier is newly curated from this narrative; it is not an external registry identifier or an additional node in the older SIR processing-group dataset.',locator:'Printed pages 20.2–20.3 / PDF pages 4–5',refineryCircuitLink:prior.circuitLink,independentProductionConfirmation:false,establishesMeasuredTransfer:false},
  constraint:prior.constraint,
  interpretation:{status:'distinct_stages_not_reconciled',sameObservationYear:true,closedPlantBalance:false,recovery:null,utilization:null,anodeToCathodeTransferTonnes:null,feedQuantity:null,otherFeedQuantity:null,inventoryChangeTonnes:null,productToCopperFactors:null,currentOutput:null,verifiedDeliverableTonnes:null,
   missingEvidence:['Dated, mass-basis-compatible feed and transfer records for each named facility.','Opening and closing inventories plus other inputs, outputs and losses over the same boundary and period.','Product assays and explicit gross-product versus contained-copper mass bases.'],
   rule:'Do not sum these stages into supply, divide cathode by anode output to infer recovery, or interpret their difference as an inventory change. Shared year and locality do not establish a closed mass balance or a measured transfer.'},
  limitations:[...prior.limitations,'The cathode row is the existing kennecott-cathodes-2022 observation, included for context with the same ID and exact fields. It is not a second independent cathode observation or new cathode evidence.'],
  modelImprovementClaimed:false};
}
export const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export function validateKennecottStages(value){if(canonical(value)!==canonical(makeKennecottStages()))throw Error('Production stages differ from the reviewed Kennecott evidence.');return value;}
