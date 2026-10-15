import {CHILE_SOURCE_SHA,validateChileProduction} from './chile-production.mjs';
export const CHILE_SALES_SHA='94e7dc73bae371ec42b7cdcb5c97abae7f32e96227699746223c124f4f62693c';
export function validateChileSales(d){
 if(d?.schemaVersion!==1||d.id!=='chile-covered-cathode-sales-2025-v1-'+CHILE_SOURCE_SHA||d.kind!=='reported_scoped_sales'||d.source.rawSha256!==CHILE_SOURCE_SHA||d.source.table!=='2.9'||d.source.pdfPage!==27)throw Error('Unexpected Chile sales source');
 if(d.material?.basis!=='contained_copper'||d.material.unit!=='t Cu'||d.material.productPurity!==null)throw Error('Unexpected sales material basis');
 if(d.coverage?.allDomesticSales!==false||d.coverage.allManufacturingDemand!==false||d.coverage.individualAllocationsKnown!==false)throw Error('Sales coverage widened');
 if(d.relationship?.kind!=='reported_sales'||d.relationship.from!=='cl-producers-covered-domestic-sales'||d.relationship.to!=='cl-manufacturers-covered-domestic-sales')throw Error('Unexpected sales relationship');
 if(d.relationship.observations.length!==10||JSON.stringify(d.years)!==JSON.stringify(Array.from({length:10},(_,i)=>2016+i)))throw Error('Unexpected sales periods');
 for(const [i,o]of d.relationship.observations.entries())if(o.year!==d.years[i]||(o.tonnesCu!==null&&(!Number.isSafeInteger(o.tonnesCu)||o.tonnesCu<0||o.tonnesCu%100!==0))||o.status!==(o.tonnesCu===null?'missing':'reported'))throw Error('Invalid reported sales observation');
 return d;
}
export function selectChileSales(sales,production,year){
 validateChileSales(sales);validateChileProduction(production);
 if(!sales.years.includes(year)||!production.years.includes(year))throw Error('No matched Chile sales reporting year');
 const current=sales.relationship.observations.find(o=>o.year===year),prior=sales.relationship.observations.find(o=>o.year===year-1),refined=production.series.find(s=>s.id==='cl-refined');
 if(!refined||refined.stage!=='refined_output'||refined.basis!==sales.material.basis||refined.unit!==sales.material.unit)throw Error('Incompatible refined comparison');
 const denominator=refined.observations.find(o=>o.year===year).tonnesCu;
 return {year,periodStart:`${year}-01-01`,periodEnd:`${year}-12-31`,reportedSalesTonnesCu:current.tonnesCu,reportedRefinedTonnesCu:denominator,
  salesToRefinedPct:current.tonnesCu===null||denominator===null||denominator===0?null:current.tonnesCu/denominator*100,
  priorYearChangeTonnesCu:current.tonnesCu===null||prior?.tonnesCu==null?null:current.tonnesCu-prior.tonnesCu,
  basis:'contained_copper',salesKind:'reported_sales',comparisonKind:'partial_sales_to_national_output',
  totalManufacturingDemandTonnesCu:null,availableSupplyTonnesCu:null,confirmedShipmentTonnesCu:null,
  completeMaterialBalance:false,individualFacilityAllocation:false};
}
