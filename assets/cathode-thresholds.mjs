import {SCREEN_INPUTS,screenCathodeSupply} from './cathode-screen.mjs';
import {validateCathodeResearchHandoff} from './cathode-research-handoff.mjs';

const FACTORS=['outputTonnesPerDay','uncommittedPct','deliveryRetentionPct','horizonDays'];
const GATES={outputTonnesPerDay:['current-operations'],uncommittedPct:['allocation'],deliveryRetentionPct:['delivery'],horizonDays:['delivery']};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const clone=v=>JSON.parse(JSON.stringify(v));
const sha=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v))))].map(x=>x.toString(16).padStart(2,'0')).join('');
export function compareCathodeThresholds(input,evidence){
  const inputs=Object.fromEntries(Object.keys(SCREEN_INPUTS).map(k=>[k,input?.[k]??null]));
  const checked=screenCathodeSupply(inputs,evidence);
  if(!checked.ok)return {ok:false,errors:checked.errors};
  const rows=FACTORS.map(key=>{
    const rule=SCREEN_INPUTS[key],fixed=FACTORS.filter(k=>k!==key);
    const missing=fixed.filter(k=>inputs[k]===null),zeros=fixed.filter(k=>inputs[k]===0);
    const percentage=key==='uncommittedPct'||key==='deliveryRetentionPct';
    let status='calculated',requiredValue=null;
    // A fixed zero prevents positive delivery even when another fixed factor is unknown.
    if(zeros.length)status='unattainable_fixed_zero';
    else if(missing.length)status='missing_inputs';
    else{
      const denominator=fixed.reduce((p,k)=>p*(k.endsWith('Pct')?inputs[k]/100:inputs[k]),1);
      const value=inputs.targetTonnes/denominator*(percentage?100:1);
      if(!Number.isFinite(value)||value<=0)status='numeric_limit';
      else{requiredValue=value;if(percentage&&value>100)status='unattainable_percentage_limit';}
    }
    const delta=requiredValue===null||inputs[key]===null?null:requiredValue-inputs[key];
    return {key,label:rule.label,unit:rule.unit,currentValue:inputs[key],status,requiredValue,
      changeFromEntered:delta,changeUnit:percentage?'percentage points':rule.unit,
      fixedInputs:Object.fromEntries(fixed.map(k=>[k,inputs[k]])),missingInputs:missing,fixedZeroInputs:zeros,
      inputRange:{min:rule.min,max:rule.max},withinInputRange:requiredValue===null?null:requiredValue>=rule.min&&requiredValue<=rule.max,
      evidenceGateIds:GATES[key].slice(),gateSatisfied:false};
  });
  return {ok:true,kind:'conditional_single_assumption_thresholds',inputs,targetTonnes:inputs.targetTonnes,rows,
    verifiedDeliverableTonnes:null,researchUtility:null,
    limitations:[
      'Each row changes only the named assumption; all other entered factors stay fixed. This is not a combined plan or a feasible operating forecast.',
      'A calculated threshold is the constant-rate arithmetic needed to reach the target, not a measured or achievable capability. A percentage above 100 cannot meet the target by changing that share alone.',
      'Numeric input ranges are calculator limits, not physical bounds or evidence of capacity. A fractional window is an arithmetic duration, not a verified calendar delivery date.',
      'Historical sales and nameplate capacity are never substituted for output, allocation or delivery measurements. No starting inventory, ramp, outage or transport lag is modeled.',
      'Product acceptance and all four supply evidence gates remain unresolved. The row order does not rank research value; no new evidence or model improvement is claimed.',
    ]};
}

export function cathodeThresholdStatus(row){
  const labels=keys=>keys.map(k=>SCREEN_INPUTS[k].label.toLowerCase()).join(', ');
  if(row.status==='unattainable_fixed_zero')return 'Cannot meet the target while fixed at zero: '+labels(row.fixedZeroInputs)+'.';
  if(row.status==='missing_inputs')return 'Unknown; enter '+labels(row.missingInputs)+'.';
  if(row.status==='unattainable_percentage_limit')return 'Requires more than 100%; changing this share alone cannot meet the target.';
  if(row.status==='numeric_limit')return 'Outside numeric precision; revise the extreme inputs.';
  return row.withinInputRange?'Conditional arithmetic only; operating feasibility is unverified.':'Conditional arithmetic outside the calculator input range; that range is not a physical limit.';
}

export async function makeCathodeThresholdReport(handoff){
  const researchHandoff=await validateCathodeResearchHandoff(clone(handoff));
  const decision=researchHandoff.decisionReport;
  const comparison=compareCathodeThresholds(decision.inputs,decision.evidence);
  if(!comparison.ok)throw Error('Invalid threshold comparison');
  const report={schemaVersion:1,kind:'cathode_threshold_comparison',method:'cathode-thresholds-v1',researchHandoff,comparison};
  const identity=clone(report);delete identity.researchHandoff.decisionReport.generatedAt;
  return {...report,reportId:await sha(identity)};
}
export async function validateCathodeThresholdReport(report){
  const snapshot=clone(report),expected=await makeCathodeThresholdReport(snapshot.researchHandoff);
  if(canonical(snapshot)!==canonical(expected))throw Error('Threshold comparison changed or uses an unsupported method.');
  return expected;
}
export async function cathodeThresholdMarkdown(report){
  const r=await validateCathodeThresholdReport(report),h=r.researchHandoff,d=h.decisionReport,c=r.comparison,n=v=>v===null?'Unknown':String(v);
  return ['# Baryon copper threshold comparison','',
    '**Conditional arithmetic. Verified supply remains unknown; all four evidence gates remain unresolved.**','',
    `Target: ${c.targetTonnes} t cathode product. Change one assumption at a time; keep the other entries fixed.`,
    'No action, source acquisition or procurement commitment is performed.','',
    ...c.rows.flatMap(row=>[
      '## '+row.label,'',`Entered: ${n(row.currentValue)} ${row.unit}. Required: ${n(row.requiredValue)} ${row.unit}.`,
      `Required minus entered: ${n(row.changeFromEntered)} ${row.changeUnit}.`,cathodeThresholdStatus(row),
      'Fixed: '+Object.entries(row.fixedInputs).map(([k,v])=>`${SCREEN_INPUTS[k].label}: ${n(v)} ${SCREEN_INPUTS[k].unit}`).join('; ')+'.',
      'Related evidence checks: '+row.evidenceGateIds.map(id=>h.tasks.find(t=>t.id===id).title).join('; ')+'. These remain unresolved.','',
    ]),
    '## Limits','',...c.limitations.map(x=>'- '+x),'',
    '## Source and reproducibility','',`[Historical source](${d.evidence.source.url}); evidence as of ${d.evidence.evidenceAsOf}.`,
    `Source SHA-256: ${d.evidence.source.rawSha256}.`,
    `Decision ID: ${d.reportId}`,`Research handoff ID: ${h.handoffId}`,`Comparison ID: ${r.reportId}`,`Method: ${r.method}`,
    `Decision generated: ${d.generatedAt}; this timestamp does not establish evidence freshness.`,
    'The paired JSON embeds the complete validated research handoff, decision and reviewed public evidence. Exact values are unrounded. Validation reconstructs every comparison; generation time is excluded from the comparison ID.','',
  ].join('\n');
}
