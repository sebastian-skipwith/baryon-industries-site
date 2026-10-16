import {CHILE_SOURCE_SHA} from './chile-production.mjs';
export const CHILE_EXPORTS_SHA='b2ea2d7dc42f8b2bdb80fd2912bdc639e1ab08430ceac2a39d2a9edb648d88d6';
const YEARS=Array.from({length:10},(_,i)=>2016+i),IDS=['US','CN','BR','OTHER','TOTAL'];
export function validateChileExports(d){
 if(d?.schemaVersion!==1||d.id!=='chile-unwrought-export-destinations-2025-v1-'+CHILE_SOURCE_SHA||d.kind!=='reported_customs_exports'||d.originCountryCode!=='CL'||d.source?.rawSha256!==CHILE_SOURCE_SHA||d.source.table!=='4.9'||d.source.pdfPage!==44)throw Error('Unexpected Chile export source');
 if(d.material?.basis!=='product_mass'||d.material.unit!=='t product'||d.material.containedCopperFraction!==null||d.material.productPurity!==null||d.material.name!=='Unwrought refined copper and unwrought copper alloys')throw Error('Unexpected export material basis');
 if(d.coverage?.allCopperProducts!==false||d.coverage.cathodesOnly!==false||d.coverage.facilityRoutingKnown!==false)throw Error('Export coverage changed');
 if(JSON.stringify(d.years)!==JSON.stringify(YEARS)||JSON.stringify(d.series?.map(s=>s.destinationId))!==JSON.stringify(IDS))throw Error('Unexpected export periods/destinations');
 for(const s of d.series){
  const kind=['US','CN','BR'].includes(s.destinationId)?'country':s.destinationId==='TOTAL'?'total':'residual_group';
  if(s.entityKind!==kind||s.countryCode!==(kind==='country'?s.destinationId:null)||s.observations.length!==10)throw Error('Invalid destination identity');
  for(const [i,o]of s.observations.entries())if(o.year!==YEARS[i]||(o.productTonnes!==null&&(!Number.isSafeInteger(o.productTonnes)||o.productTonnes<0))||o.status!==(o.productTonnes===null?'missing':'reported'))throw Error('Invalid export observation');
 }
 if(!d.unknowns||Object.values(d.unknowns).some(v=>v!==null))throw Error('Unmeasured export fields changed');
 return d;
}
export function selectChileExports(dataset,year){
 validateChileExports(dataset);if(!dataset.years.includes(year))throw Error('No Chile export reporting year');
 const row=s=>{const current=s.observations.find(o=>o.year===year).productTonnes,prior=s.observations.find(o=>o.year===year-1)?.productTonnes??null;return {destinationId:s.destinationId,name:s.name,entityKind:s.entityKind,productTonnes:current,priorYearChangeProductTonnes:current===null||prior===null?null:current-prior,priorYearChangePct:current===null||prior===null||prior===0?null:(current-prior)/prior*100};};
 const total=row(dataset.series.find(s=>s.destinationId==='TOTAL')),rows=dataset.series.filter(s=>s.destinationId!=='TOTAL').map(row).map(r=>({...r,shareOfProductWeightPct:r.productTonnes===null||total.productTonnes===null||total.productTonnes===0?null:r.productTonnes/total.productTonnes*100}));
 const sum=rows.some(r=>r.productTonnes===null)?null:rows.reduce((a,r)=>a+r.productTonnes,0);
 return {year,periodStart:`${year}-01-01`,periodEnd:`${year}-12-31`,basis:'product_mass',unit:'t product',total,rows,reconciliation:{componentsProductTonnes:sum,reportedProductTonnes:total.productTonnes,differenceProductTonnes:sum===null||total.productTonnes===null?null:sum-total.productTonnes},containedCopperTonnes:null,productionMinusExports:null,availableSupply:null,finalDemand:null,completeMaterialBalance:false,facilityAllocationKnown:false};
}
