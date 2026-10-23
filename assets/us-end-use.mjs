export const US_END_USE_SOURCE_SHA='7ca8f4f8b5e2483ed5220ad9db7d06db9bcd595a3e13569cb81229f330bc007c';
export const US_END_USE_SHA='a880b06308899f4ea93731be3fd5d5d747d19c5cb51c4aad893050e00789956d';
const categories=['construction','electrical','industrial','transportation','consumer'];
const keys=[...categories,'apparentConsumption'];
export function validateUsEndUse(d){
 if(d?.schemaVersion!==1||d.id!=='us-copper-end-use-1975-2003-v1'||d.kind!=='modeled_historical_end_use'||d.country!=='US'||d.unit!=='t Cu'||d.sourceResolutionTonnes!==10000)throw Error('Historical end-use identity or units mismatch');
 if(d.evidenceRole!=='allocation_dependent_on_apparent_consumption'||d.independentValidationEligible!==false||d.method?.status!=='publisher_derived_estimates'||d.method.denominator!=='US copper apparent consumption')throw Error('Dependent estimates cannot become independent demand evidence');
 if(d.source?.rawSha256!==US_END_USE_SOURCE_SHA||d.source.tablePage!==1||d.source.methodsPage!==3||d.source.lastModifiedDate!=='2005-09-01')throw Error('Historical end-use source mismatch');
 if(d.coverage?.startYear!==1975||d.coverage.endYear!==2003||d.coverage.entityKind!=='national_end_use_allocation'||d.coverage.facilityIdentitiesKnown!==false)throw Error('Historical end-use coverage mismatch');
 if(!Array.isArray(d.categories)||d.categories.map(c=>c.id).join()!==categories.join())throw Error('Historical categories mismatch');
 if(!Array.isArray(d.rows)||d.rows.length!==29)throw Error('Historical years mismatch');
 for(const [i,row] of d.rows.entries()){
  if(row.year!==1975+i||!row.values||Object.keys(row.values).sort().join()!==[...keys].sort().join())throw Error('Historical row mismatch');
  if(keys.some(k=>row.values[k]!==null&&(!Number.isSafeInteger(row.values[k])||row.values[k]<0||row.values[k]%10000)))throw Error('Invalid historical quantity');
 }
 for(const key of ['currentDemandTonnes','forecastDemandTonnes','availableSupplyTonnes','facilityAllocation','originalCdaShares'])if(d.unknowns?.[key]!==null)throw Error('Unsupported end-use inference');
 return d;
}
export function selectUsEndUse(dataset,year){
 const d=validateUsEndUse(dataset),r=d.rows.find(r=>r.year===year);if(!r)throw Error('Unknown historical year');
 const allocations=d.categories.map(c=>({...c,value:r.values[c.id]}));
 const componentTotal=allocations.every(c=>c.value!==null)?allocations.reduce((s,c)=>s+c.value,0):null;
 const apparentConsumption=r.values.apparentConsumption;
 return {year,unit:d.unit,allocations,componentTotal,apparentConsumption,residual:componentTotal===null||apparentConsumption===null?null:componentTotal-apparentConsumption,
  independentValidationEligible:false,unknowns:{...d.unknowns}};
}
