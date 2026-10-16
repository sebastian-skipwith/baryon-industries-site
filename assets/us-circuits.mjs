// Curated USGS-authored prose, SIR 2023-5082 p.85. No corporate report tables or estimated inventories.
export const US_CIRCUITS_RAW_SHA256='95eb20be6fc8507a811c2aa55e2e0aa167447a6018b8a0059151667ce89edd4d';
const mine=(id,name,state)=>({id,name,state,kind:'mine'});
const facility=(id,name,state,kind)=>({id,name,state,kind});
const unmeasured=()=>({shipmentQuantity:null,quantityUnit:null,shipmentPeriodStart:null,shipmentPeriodEnd:null,transportMode:null,transportPath:null,feedGrade:null,recovery:null,productPurity:null,currentThroughput:null,currentOperatingStatus:null,availableSupply:null,customerAllocation:null});
export function makeUsCircuits(){
 return {
  schemaVersion:1,id:'usgs-sir20235082-us-copper-circuits-2022-v1',kind:'reported_processing_relationships',
  source:{name:'USGS Scientific Investigations Report 2023-5082',title:'Critical Minerals in Subduction-related Magmatic-Hydrothermal Systems of the United States',authors:'Vikre and others',url:'https://pubs.usgs.gov/sir/2023/5082/sir20235082.pdf',doi:'https://doi.org/10.3133/sir20235082',publishedYear:2023,publishedOn:null,acquiredAt:null,rawSha256:US_CIRCUITS_RAW_SHA256,pdfPages:[96,97],printedPages:[84,85],rightsUrl:'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits',rights:'USGS-authored information is U.S. public domain; credit USGS. Only the reviewed narrative relationships and accounting caveats are included.',rightsPdfPage:4,attribution:'U.S. Geological Survey, Vikre and others (2023), SIR 2023-5082, pages 84–85.'},
  temporalScope:{asOfYear:2022,observedOn:null,meaning:'The source frames these processing relationships as of 2022. It supplies no dated shipment observations or current status.'},
  evidenceStatus:'Government synthesis of reported processing relationships; not Baryon measurements or shipment verification.',
  circuits:[
   {id:'bingham-magna',name:'Bingham district / Magna',operatorAsReported:'Rio Tinto',origins:[{id:'bingham-district-mines',name:'Bingham district mines',state:'Utah',kind:'mining_district_group'}],facilities:[facility('magna-refinery','Magna refinery','Utah','refinery')],materialDescription:'Copper-molybdenum ore origins; the paragraph does not identify the transported material at each processing step.',qualification:'The source connects the nearby Bingham district mines with the Magna refinery. It does not name a smelter in this relationship.',originCoverage:'District group; individual mines are not enumerated here.',relationshipKind:'reported_origin_to_processing_group',measured:unmeasured()},
   {id:'asarco-hayden-amarillo',name:'Ray, Mission and Silver Bell / Hayden and Amarillo',operatorAsReported:'ASARCO',origins:[mine('ray-mine','Ray mine','Arizona'),mine('mission-mine','Mission mine','Arizona'),mine('silver-bell-mine','Silver Bell mine','Arizona')],facilities:[facility('hayden-smelter','Hayden smelter','Arizona','smelter'),facility('amarillo-refinery','Amarillo refinery','Texas','refinery')],materialDescription:'Copper-molybdenum ore origins; the paragraph does not quantify concentrates or anodes on individual legs.',qualification:'The source identifies these mines as the primary origins for the named smelter/refinery group. Other feed is not ruled out.',originCoverage:'Primarily these mines, not an exhaustive or exclusive feed inventory.',relationshipKind:'reported_origin_to_processing_group',measured:unmeasured()},
   {id:'freeport-miami-el-paso',name:'Seven reported mine origins / Miami and El Paso',operatorAsReported:'Freeport-McMoRan',origins:[mine('morenci-mine','Morenci mine','Arizona'),mine('bagdad-mine','Bagdad mine','Arizona'),mine('safford-mine','Safford mine','Arizona'),mine('miami-mine','Miami mine','Arizona'),mine('sierrita-mine','Sierrita mine','Arizona'),mine('chino-mine','Chino mine','New Mexico'),mine('tyrone-mine','Tyrone mine','New Mexico')],facilities:[facility('freeport-miami-smelter','Miami smelter','Arizona','smelter'),facility('freeport-el-paso-refinery','El Paso refinery','Texas','refinery')],materialDescription:'Reported ore origins; the material form and quantity on each leg are unspecified.',qualification:'The source describes feed from these mines as steady to episodic. Membership does not establish continuous shipments from every mine.',originCoverage:'Reported origins with varying frequency; no source allocation fractions.',relationshipKind:'reported_origin_to_processing_group',measured:unmeasured()}
  ],
  limitations:[
   'A processing group is a reported association, not a set of measured mine-to-smelter-to-refinery shipments. Do not expand it into every possible pairwise route.',
   'National production, capacity, reserves and modeled critical-mineral inventories cannot fill missing shipment quantities or available supply.',
   'The source discusses outside/tolled feed, scrap, exported intermediates and incomplete metallurgical accounting. The named origins are not a closed mass balance.',
   'Processing methods can differ within one mining operation. A listed mine does not imply that all its output uses this circuit.',
   'Facility names are qualified by operator and role as reported. The historical ASARCO El Paso refinery and the Freeport El Paso refinery must not be conflated.',
   'General electrorefining descriptions do not certify any facility’s current product purity, recovery or customer specification.'
  ],
  nextEvidence:[
   {id:'status',need:'Current facility identity and operating status',effect:'Establish whether the historical relationship is still relevant.'},
   {id:'flow',need:'Dated feed and output quantities, material basis and inventories',effect:'Quantify individual legs and reconcile throughput without double counting.'},
   {id:'quality',need:'Product assay, recovery and customer specification',effect:'Determine whether output can meet a particular material requirement.'},
   {id:'allocation',need:'Uncommitted allocation and shipment evidence',effect:'Determine what can be delivered, where and when.'}
  ],
  modelImprovementClaimed:false
 };
}
function canonical(x){return JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);}
export function validateUsCircuits(data){
 if(canonical(data)!==canonical(makeUsCircuits()))throw new Error('USGS circuit snapshot differs from reviewed facts or scope');
 return data;
}
export function selectUsCircuit(data,id){
 validateUsCircuits(data);
 const circuit=data.circuits.find(c=>c.id===id);
 if(!circuit)throw new Error('Unknown circuit');
 return structuredClone({circuit,asOfYear:data.temporalScope.asOfYear,verifiedDeliverableSupply:null,measuredShipmentCount:0,decisionStatus:'More evidence required',nextEvidence:data.nextEvidence});
}
