export const IEA_DEMAND_SOURCE_SHA='722c7333e2100b2404f9fb9b25f693ec1670a6cbd54961a0ee45541cecc43db0';
export const IEA_DEMAND_SHA='4454564889f78e5d263d1dfeb753208f78a9d891c0036f79d76333e30efd4e9a';
const massKeys=['cleanEnergy','networks','ev','solar','otherEnergy','otherUses','total'];
export function validateIeaDemand(d){
 if(d?.schemaVersion!==1||d.id!=='iea-copper-historical-demand-2026-v1'||d.kind!=='publisher_historical_demand_estimates'||d.geography!=='World'||d.unit!=='kt Cu'||d.sourceResolutionKt!==1||d.sourceShareResolutionPct!==1)throw Error('Historical demand identity or units mismatch');
 if(d.independentValidationEligible!==false||d.method?.status!=='publisher_estimates'||d.boundary?.product!=='refined_copper'||d.boundary.directUseScrapIncluded!==false||d.boundary.facilityAllocationKnown!==false)throw Error('Demand evidence role or scope mismatch');
 if(d.source?.rawSha256!==IEA_DEMAND_SOURCE_SHA||d.source.tablePage!==347||d.source.licence!=='CC BY 4.0'||d.source.publicationDate!=='2026-07-16')throw Error('Demand source mismatch');
 if(JSON.stringify(d.partitions)!==JSON.stringify({total:['cleanEnergy','otherUses'],cleanEnergy:['networks','ev','solar','otherEnergy']}))throw Error('Demand hierarchy mismatch');
 if(!Array.isArray(d.rows)||d.rows.length!==2)throw Error('Historical rows mismatch');
 for(const [i,row] of d.rows.entries()){
  if(row.year!==[2021,2025][i]||row.status!=='historical_estimate'||!row.values||Object.keys(row.values).sort().join()!==[...massKeys,'cleanSharePct'].sort().join())throw Error('Historical periods or fields mismatch');
  for(const k of massKeys)if(row.values[k]!==null&&(!Number.isSafeInteger(row.values[k])||row.values[k]<0))throw Error('Invalid demand quantity');
  const p=row.values.cleanSharePct;if(p!==null&&(!Number.isInteger(p)||p<0||p>100))throw Error('Invalid demand share');
 }
 for(const key of ['currentDemandKt','forecastDemandKt','verifiedDeliverableSupplyTonnes','regionalAllocation','independentPredictionError'])if(d.unknowns?.[key]!==null)throw Error('Unsupported demand inference');
 return d;
}
export function selectIeaDemand(dataset,year){
 const d=validateIeaDemand(dataset),r=d.rows.find(r=>r.year===year);if(!r)throw Error('No historical estimate for selected year');
 const balances=Object.entries(d.partitions).map(([parent,keys])=>{const sum=keys.every(k=>r.values[k]!==null)?keys.reduce((s,k)=>s+r.values[k],0):null;return {parent,components:[...keys],componentSum:sum,reportedTotal:r.values[parent],residual:sum===null||r.values[parent]===null?null:sum-r.values[parent]};});
 return {year,unit:d.unit,values:{...r.values},balances,independentValidationEligible:false,unknowns:{...d.unknowns}};
}
