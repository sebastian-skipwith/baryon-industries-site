export const CHILE_ENERGY_SOURCE_SHA = '1f4afae4412d40cd60cb49df783919758503724068be60a19f02003c5a1545b1';
export const CHILE_ENERGY_SHA = 'cf517fd326df7884b98f96fa99f284120a2da3a845aa6a13e7505ab1ee0cd3a3';
const processes = ['open-pit','concentration','sx-ew','seawater','smelting','services','underground','refining'];
const carriers = ['fuels','electricity'];
const years = Array.from({length:10},(_,i)=>2016+i);
const equal = (a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function validateChileEnergy(d){
 if(d?.schemaVersion!==1||d.id!==`chile-energy-2025-v1-${CHILE_ENERGY_SOURCE_SHA}`||d.kind!=='reported_annual_energy_use'||d.country!=='CL'||d.unit!=='TJ'||d.sourceResolutionTJ!==1)throw Error('Invalid Chile energy identity or unit');
 if(d.source?.rawSha256!==CHILE_ENERGY_SOURCE_SHA||d.source.table!=='6.3'||d.source.pdfPage!==67||d.source.permissionPage!==115)throw Error('Invalid Chile energy provenance');
 if(d.coverage?.entityKind!=='national_sector_aggregate'||d.coverage.individualFacilitiesKnown!==false||d.accounting?.sameTotal!==true||!equal(d.accounting.partitions,['process','carrier']))throw Error('Invalid Chile energy coverage/accounting');
 const unknowns=['facilityAllocation','marginalEnergyPerTonneCopper','availableElectricityTJ','waterVolume','availableCopperSupplyTonnes'];
 if(!d.unknowns||!equal(Object.keys(d.unknowns).sort(),[...unknowns].sort())||unknowns.some(k=>d.unknowns[k]!==null))throw Error('Unsupported Chile energy inference');
 if(!equal(d.years,years)||!Array.isArray(d.series)||d.series.length!==11||new Set(d.series.map(s=>s.id)).size!==11)throw Error('Invalid Chile energy series/years');
 for(const s of d.series){
  const partition=processes.includes(s.id)?'process':carriers.includes(s.id)?'carrier':s.id==='total'?'total':null;
  if(!partition||s.partition!==partition||typeof s.name!=='string'||!s.name||typeof s.sourceRow!=='string'||!s.sourceRow||!Array.isArray(s.observations)||s.observations.length!==10)throw Error('Invalid Chile energy reporting series');
  for(const [i,o] of s.observations.entries()){
   if(o.year!==years[i]||(o.valueTJ!==null&&(!Number.isSafeInteger(o.valueTJ)||o.valueTJ<0))||o.status!==(o.valueTJ===null?'missing':'reported'))throw Error('Invalid Chile energy observation');
  }
 }
 return d;
}

export function selectChileEnergy(dataset,year){
 const d=validateChileEnergy(dataset),index=years.indexOf(year);
 if(index<0)throw Error('Unsupported energy reporting year');
 const rows=d.series.map(s=>({id:s.id,name:s.name,partition:s.partition,sourceRow:s.sourceRow,valueTJ:s.observations[index].valueTJ}));
 const totalTJ=rows.find(r=>r.id==='total').valueTJ;
 const reconcile=partition=>{
  const members=rows.filter(r=>r.partition===partition),componentTJ=members.every(r=>r.valueTJ!==null)?members.reduce((a,r)=>a+r.valueTJ,0):null;
  return {partition,componentTJ,reportedTotalTJ:totalTJ,differenceTJ:componentTJ===null||totalTJ===null?null:componentTJ-totalTJ};
 };
 return {year,periodStart:`${year}-01-01`,periodEnd:`${year}-12-31`,unit:'TJ',totalTJ,
  processes:rows.filter(r=>r.partition==='process'),carriers:rows.filter(r=>r.partition==='carrier'),
  reconciliations:['process','carrier'].map(reconcile),facilityAllocation:null,marginalEnergyPerTonneCopper:null,
  availableElectricityTJ:null,availableCopperSupplyTonnes:null};
}
