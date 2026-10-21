import {SCREEN_INPUTS} from './cathode-screen.mjs';

const check=(ok,message)=>{if(!ok)throw Error(message);};
function optionalText(value,label,max){
  if(value===null||value===undefined||value==='')return null;
  check(typeof value==='string'&&value.length<=max&&!/[\p{Cc}\p{Cf}]/u.test(value),`${label} must be one line of at most ${max} characters.`);
  return value.trim()||null;
}
function date(value,label){
  if(value===null||value===undefined||value==='')return null;
  check(typeof value==='string'&&/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value),`${label} must be a valid YYYY-MM-DD date between 1900 and 2199.`);
  const ms=Date.parse(value+'T00:00:00.000Z');
  check(Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value,`${label} is not a real calendar date.`);
  return value;
}

// Buyer intent only. Never geocode, fetch, persist, infer purity or satisfy an evidence gate.
export function resolveCathodeRequirement(input,request){
  check(request&&typeof request==='object'&&!Array.isArray(request),'A buyer requirement object is required.');
  const buyerRequest={
    windowStart:date(request.windowStart,'First delivery day'),
    windowEnd:date(request.windowEnd,'Last delivery day'),
    destination:optionalText(request.destination,'Destination',240),
    productSpecification:optionalText(request.productSpecification,'Buyer product requirement',600),
  };
  const {windowStart,windowEnd}=buyerRequest;
  check(Boolean(windowStart)===Boolean(windowEnd),'Enter both delivery dates, or leave both blank for a relative window.');
  const inputs=Object.fromEntries(Object.keys(SCREEN_INPUTS).map(k=>[k,input?.[k]??null]));
  if(windowStart){
    const days=(Date.parse(windowEnd+'T00:00:00Z')-Date.parse(windowStart+'T00:00:00Z'))/86400000+1;
    check(days>=1&&days<=SCREEN_INPUTS.horizonDays.max,'Delivery dates must be ordered and span 1 to 3,650 inclusive calendar days.');
    inputs.horizonDays=days;
  }
  return {inputs,buyerRequest,requirement:{
    product:'Copper cathode product',massBasis:'product_mass',targetTonnes:inputs.targetTonnes,horizonDays:inputs.horizonDays,
    windowStart,windowEnd,windowConvention:windowStart?'inclusive_calendar_dates':null,
    destination:buyerRequest.destination,productSpecification:buyerRequest.productSpecification,
    provenance:'user_requirement',observed:false,
    meaning:windowStart?'Buyer-requested calendar dates, both inclusive. This duration drives constant-rate scenario arithmetic; production readiness, transport lead time and actual arrival are unverified.':'Relative scenario window; no calendar delivery date is specified or verified.',
  }};
}

// Buyer free text is inert in generated Markdown, including HTML, links and table syntax.
export const requirementMarkdownText=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/[\\`*_[\]{}()#+.!|~\-]/g,'\\$&');
export function cathodeRequirementLines(requirement){
  const r=requirement,m=requirementMarkdownText;
  return [
    `Buyer-requested window: ${r.windowStart?`${r.windowStart} through ${r.windowEnd}, both dates inclusive (${r.horizonDays} days)`:`${r.horizonDays} relative days; calendar dates unspecified`}. Actual delivery timing remains unverified.`,
    `Requested destination: ${r.destination?m(r.destination):'Unspecified'}. Location and route are unverified.`,
    `Buyer product requirement: ${r.productSpecification?m(r.productSpecification):'Unspecified'}. This is requested acceptance criteria, not a supplier assay or confirmed product specification.`,
  ];
}
