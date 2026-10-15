// Pure scenario arithmetic. Rates are cathode-product mass, never ore, solution, or payable copper.
export const SCREEN_INPUTS = Object.freeze({
  targetTonnes:{label:'Cathode delivery target',unit:'t cathodes',min:0,max:1e7,exclusiveMin:true,required:true},
  horizonDays:{label:'Delivery window',unit:'days',min:1,max:3650,required:true},
  outputTonnesPerDay:{label:'Assumed sustained cathode output',unit:'t cathodes/day',min:0,max:1e5},
  uncommittedPct:{label:'Assumed share available to this buyer',unit:'%',min:0,max:100},
  deliveryRetentionPct:{label:'Assumed share reaching the buyer',unit:'%',min:0,max:100},
});
const known = value => typeof value === 'number' && Number.isFinite(value);
export function screenCathodeSupply(input, evidence) {
  const errors=[];
  for (const [key,r] of Object.entries(SCREEN_INPUTS)) {
    const v=input[key];
    if ((v===null || v===undefined) && !r.required) continue;
    if (!known(v) || v<r.min || (r.exclusiveMin && v===r.min) || v>r.max) errors.push(`Enter a valid ${r.label.toLowerCase()} (${r.unit}).`);
  }
  const cap=evidence?.facts?.capacity, sales=evidence?.facts?.sales;
  if (cap?.kind!=='nameplate_capacity' || cap.unit!=='t cathodes/year' || !known(cap.value) || cap.value<=0 ||
      sales?.kind!=='reported_sales' || sales.unit!=='t cathodes' || !known(sales.value) || sales.value<0) errors.push('Evidence basis is incompatible.');
  if(errors.length)return {ok:false,errors};
  const {targetTonnes:target,horizonDays:days}=input;
  const available=known(input.uncommittedPct)?input.uncommittedPct/100:null;
  const retained=known(input.deliveryRetentionPct)?input.deliveryRetentionPct/100:null;
  const rate=known(input.outputTonnesPerDay)?input.outputTonnesPerDay:null;
  const missing=['outputTonnesPerDay','uncommittedPct','deliveryRetentionPct'].filter(k=>!known(input[k]));
  const multiplier=available===null || retained===null ? null : available*retained;
  // A measured zero is binding even if another nonnegative factor is missing.
  const zeroDelivery=rate===0 || available===0 || retained===0;
  const conditionalTonnes=zeroDelivery?0:missing.length?null:rate*days*multiplier;
  const requiredGrossRate=multiplier===null || multiplier===0 ? null : target/(days*multiplier);
  const minimumGrossRate=target/days;
  return {
    ok:true,kind:'conditional_scenario', targetTonnes:target,horizonDays:days,
    minimumCathodeRate:minimumGrossRate,minimumAnnualEquivalent:minimumGrossRate*365,
    minimumNameplatePct:minimumGrossRate*365/cap.value*100,
    exceedsHistoricalNameplate:minimumGrossRate*365>cap.value,
    requiredGrossRate,impossibleWithAssumedAllocation:multiplier===0,
    scenarioExceedsHistoricalNameplate:rate!==null && rate*365>cap.value,
    conditionalTonnes,targetMet:conditionalTonnes===null?null:conditionalTonnes>=target,
    gapTonnes:conditionalTonnes===null?null:conditionalTonnes-target,
    missingAssumptions:missing,verifiedDeliverableTonnes:null,
    evidenceAsOf:evidence.evidenceAsOf,
    limitations:[
      'A constant rate across the entire delivery window is assumed; no ramp, outages, starting inventory or transport lag is modeled.',
      'Annual equivalents use 365 days. The historical nameplate comparison is a scale check, not available capacity or a current ceiling.',
      'Sales are a separate dated observation. They are not substituted for output or subtracted from nameplate capacity.',
      'Product purity, acceptance, current permits, delivery timing and contractual commitments remain unverified. A complete scenario does not verify supply.',
    ],
  };
}
export function supplyInvestigations(result) {
  if(!result.ok)return [];
  const items=[
    {id:'current-operations',question:'Establish current operating conditions',action:'Obtain dated operating status, permit conditions, and sustained cathode-output measurements over a stated interval. Historical sales cannot establish the present rate.'},
    {id:'subsurface-flow',question:'Test the reported fluid-flow constraint',action:'Review permitted well-test measurements of solution flow and copper concentration, pressure response, and recovery before and after stimulation. Compare tests with predefined acceptance criteria; do not infer recoverability from a deposit outline.'},
    {id:'allocation-delivery',question:'Establish an uncommitted, deliverable product',action:'Check allocated versus uncommitted volume, cathode assay/specification, inventory, logistics and delivery dates. Obtain evidence before counting a buyer-specific commitment.'},
  ];
  if(result.exceedsHistoricalNameplate)items.unshift({id:'target-scale',question:'Target exceeds the historical design rate',action:'Extend the delivery window, split the requirement across sources, or obtain independently supported expansion evidence. Full nominal capacity alone cannot meet this window.'});
  if(result.impossibleWithAssumedAllocation)items.unshift({id:'zero-allocation',question:'No delivery under the entered allocation',action:'An assumed zero allocation or delivery retention produces zero delivery. Changing that assumption requires supporting evidence.'});
  return items;
}
