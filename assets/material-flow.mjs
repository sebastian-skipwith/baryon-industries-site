// Accounting across published periods; this does not simulate plant conversion or forecast demand.
export function flowBalance(values) {
  const keys=['balancePrimary','balanceOldScrap','balanceImports','balanceExports','balanceStockChange'];
  for(const key of [...keys,'balanceApparent']){
    const v=values[key]?.value;
    if(v!==null&&(!Number.isFinite(v)||(key!=='balanceStockChange'&&v<0)))throw new Error('Invalid copper quantity: '+key);
  }
  const known=keys.every(key=>values[key].value!==null);
  const get=key=>values[key].value;
  const reconstructed=known?get('balancePrimary')+get('balanceOldScrap')+get('balanceImports')-get('balanceExports')-get('balanceStockChange'):null;
  return {reconstructed,reported:get('balanceApparent'),roundingDifference:known&&get('balanceApparent')!==null?reconstructed-get('balanceApparent'):null,
    netRefinedImports:get('balanceImports')===null||get('balanceExports')===null?null:get('balanceImports')-get('balanceExports'),
    stockContribution:get('balanceStockChange')===null?null:-get('balanceStockChange'),containsEstimates:keys.some(k=>values[k].includesEstimates),
    availableForPurchase:null,currentProduction:null,unmetDemand:null,processRecovery:null};
}
export function selectFlowPeriod(dataset,id) {
  const period=dataset.periods.find(p=>p.id===id),row=dataset.observations.find(r=>r.periodId===id);
  if(!period||!row)throw new Error('Unknown reporting period');
  return {period,values:row.values,balance:flowBalance(row.values)};
}
export function monthlyFlowRows(dataset) {
  return dataset.periods.filter(p=>p.kind==='month').sort((a,b)=>a.start.localeCompare(b.start)).map(p=>selectFlowPeriod(dataset,p.id));
}
