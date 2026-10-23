// Structural review of analyst declarations. Never imports evidence or satisfies a supply gate.
export const OPERATING_PREFLIGHT_METHOD='cathode-operating-preflight-v1';
export const PREFLIGHT_LIMITS=Object.freeze({candidateBytes:65536,sourceCount:4,artifactBytes:16777216});
const hashPattern=/^[a-f0-9]{64}$/;
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export async function sha256Bytes(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
const digest=v=>sha256Bytes(new TextEncoder().encode(canonical(v)));
const check=(ok,message)=>{if(!ok)throw Error(message);};
function shape(value,keys,where){
 check(value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype,'Expected a plain record at '+where+'.');
 check(Object.keys(value).sort().join('|')===keys.split(' ').sort().join('|'),'Unexpected or missing fields at '+where+'. Use the blank template.');
}
const text=(v,max=600)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const key=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(v);
function day(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||v<'1900-01-01'||v>'2199-12-31')return false;
 const d=new Date(v+'T00:00:00.000Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===v;
}
function timestamp(v){return typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;}
function publication(v){
 if(typeof v!=='string')return null;
 if(day(v))return {start:v,end:v,precision:'day'};
 if(/^\d{4}-\d{2}$/.test(v)&&day(v+'-01')){
  const d=new Date(v+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);
  return {start:v+'-01',end:d.toISOString().slice(0,10),precision:'month'};
 }
 if(/^\d{4}$/.test(v)&&day(v+'-01-01'))return {start:v+'-01-01',end:v+'-12-31',precision:'year'};
 return null;
}
function https(v){try{const u=new URL(v);return text(v,2048)&&u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;}catch{return false;}}
export function blankOperatingRecord(){return {
 schemaVersion:1,pathwayRoleId:'us-az-gunnison-ew',
 sources:[{id:'operating-record',url:null,publicationDate:null,acquiredAt:null,rawSha256:null,rawBytes:null,reuse:{status:'unreviewed',basis:null,locator:null,permittedFields:[]}}],
 identity:{facilityKey:null,facilityName:null,locality:null,process:null,relation:null,validFrom:null,validTo:null,sourceId:'operating-record',locator:null},
 output:{facilityKey:null,kind:null,periodStart:null,periodEnd:null,value:null,unit:null,product:null,massBasis:null,interruptions:{status:'unknown',locator:null},sourceId:'operating-record',locator:null},
};}

export async function preflightOperatingRecord(candidate,artifacts,reviewedAt){
 // Snapshot synchronously: an edit during hashing cannot change the report's candidate or checks.
 const c=structuredClone(candidate),supplied=structuredClone(artifacts);
 shape(c,'schemaVersion pathwayRoleId sources identity output','candidate');
 check(c.schemaVersion===1,'Unsupported operating record schema.');
 check(c.pathwayRoleId==='us-az-gunnison-ew','This preflight covers the historical Gunnison electrowinning role only.');
 check(timestamp(reviewedAt),'Use an ISO UTC review timestamp.');
 check(new TextEncoder().encode(canonical(c)).length<=PREFLIGHT_LIMITS.candidateBytes,'Candidate exceeds 64 KiB.');
 check(Array.isArray(c.sources)&&c.sources.length>=1&&c.sources.length<=PREFLIGHT_LIMITS.sourceCount,'Include one to four sources.');
 check(Array.isArray(supplied)&&supplied.length<=PREFLIGHT_LIMITS.sourceCount,'Supply at most four artifact bindings.');
 const issue=[],add=(code,path,message)=>issue.push({code,path,message});
 const today=reviewedAt.slice(0,10),seen=new Set();
 for(const a of supplied){
  shape(a,'sha256 bytes','artifact');
  check(hashPattern.test(a.sha256)&&Number.isSafeInteger(a.bytes)&&a.bytes>0&&a.bytes<=PREFLIGHT_LIMITS.artifactBytes,'Invalid or oversized supplied artifact binding.');
  check(!seen.has(a.sha256),'Duplicate supplied artifact binding.');seen.add(a.sha256);
 }
 const ids=new Set();
 for(const [i,s]of c.sources.entries()){
  const p='sources['+i+']';
  shape(s,'id url publicationDate acquiredAt rawSha256 rawBytes reuse',p);
  shape(s.reuse,'status basis locator permittedFields',p+'.reuse');
  check(key(s.id)&&!ids.has(s.id),'Source IDs must be unique lowercase keys.');ids.add(s.id);
  if(!https(s.url))add('source_url',p+'.url','Record an HTTPS source URL without embedded credentials or a fragment.');
  const pub=publication(s.publicationDate);
  if(!pub||pub.start>today)add('publication_date',p+'.publicationDate','Record a real, nonfuture publication date at its known year, month or day precision.');
  if(!timestamp(s.acquiredAt)||s.acquiredAt>reviewedAt||(pub&&pub.start>s.acquiredAt.slice(0,10)))add('acquisition_date',p+'.acquiredAt','Record an original acquisition timestamp consistent with publication and this review.');
  const bound=hashPattern.test(s.rawSha256)&&Number.isSafeInteger(s.rawBytes)&&s.rawBytes>0&&s.rawBytes<=PREFLIGHT_LIMITS.artifactBytes;
  if(!bound||!supplied.some(a=>a.sha256===s.rawSha256&&a.bytes===s.rawBytes))add('original_artifact',p,'Supply original artifact bytes matching the declared SHA-256 and size. Search text and access-failure headers cannot substitute for the source document.');
  check(Array.isArray(s.reuse.permittedFields)&&s.reuse.permittedFields.every(k=>['identity','operating_output'].includes(k))&&new Set(s.reuse.permittedFields).size===s.reuse.permittedFields.length,'Invalid permitted-field declaration.');
  if(s.reuse.status!=='documented_permission'||!text(s.reuse.basis)||!text(s.reuse.locator))add('reuse_review',p+'.reuse','Document the applicable permission basis and its locator for the exact fields; public hosting alone does not establish reuse permission.');
 }
 for(const a of supplied)if(!c.sources.some(s=>s.rawSha256===a.sha256&&s.rawBytes===a.bytes))add('unreferenced_artifact','artifacts','A supplied artifact is not referenced by this candidate.');
 const identity=c.identity,o=c.output;
 shape(identity,'facilityKey facilityName locality process relation validFrom validTo sourceId locator','identity');
 shape(o,'facilityKey kind periodStart periodEnd value unit product massBasis interruptions sourceId locator','output');
 shape(o.interruptions,'status locator','output.interruptions');
 for(const [obj,path,field]of [[identity,'identity','identity'],[o,'output','operating_output']]){
  const source=c.sources.find(s=>s.id===obj.sourceId);
  if(!source||!text(obj.locator))add('source_locator',path,'Link the claim to one declared source and a precise page, section or table.');
  if(source&&!source.reuse.permittedFields.includes(field))add('field_permission',path,'The source permission declaration does not cover this field category.');
 }
 if(!key(identity.facilityKey)||!text(identity.facilityName,240)||!text(identity.locality,240))add('physical_identity','identity','Identify a distinguishing physical facility name, locality and documented key; a process-role key alone is insufficient.');
 if(identity.facilityKey===c.pathwayRoleId)add('role_is_not_facility','identity.facilityKey','The historical role key cannot stand in for a physical facility identity.');
 if(!['electrowinning','solvent_extraction_electrowinning'].includes(identity.process))add('process','identity.process','The facility process must explicitly include electrowinning.');
 if(identity.relation!=='explicit_actual_processing')add('actual_processing_link','identity.relation','Require a source-backed link describing actual processing for the stated interval. A proposed association, shared owner or similar name is insufficient.');
 const identityDates=day(identity.validFrom)&&day(identity.validTo)&&identity.validFrom<=identity.validTo&&identity.validTo<=today;
 if(!identityDates)add('identity_interval','identity','Record a valid, nonfuture interval for the documented actual processing link.');
 const outputDates=day(o.periodStart)&&day(o.periodEnd)&&o.periodStart<=o.periodEnd&&o.periodEnd<=today;
 if(!outputDates)add('output_interval','output','Record a complete, ordered, nonfuture observation interval.');
 if(identityDates&&outputDates&&(identity.validFrom>o.periodStart||identity.validTo<o.periodEnd))add('interval_mismatch','output','The physical processing link must cover the entire output observation interval.');
 if(!key(o.facilityKey)||o.facilityKey!==identity.facilityKey)add('facility_mismatch','output.facilityKey','Output and the documented physical processing link must refer to the same facility.');
 if(!['measured_output','reported_output'].includes(o.kind))add('output_kind','output.kind','Record measured or reported actual output. Capacity, sales, inventory, plans, permits and modeled estimates do not establish observed sustained output.');
 if(typeof o.value!=='number'||!Number.isFinite(o.value)||o.value<0)add('output_quantity','output.value','Record a finite, nonnegative observed quantity. Missing output is unknown, not zero.');
 if(o.unit!=='t'||o.product!=='copper_cathode'||o.massBasis!=='gross_product_mass')add('product_mass_basis','output','Require tonnes of copper cathode product with an explicit gross product mass basis. Do not infer purity or convert copper content, ore or concentrate.');
 if(!['documented_interruptions','explicitly_no_interruptions'].includes(o.interruptions.status)||!text(o.interruptions.locator))add('interruptions','output.interruptions','Document operating interruptions or an explicit no-interruptions statement for this interval; absence of reporting is not evidence of continuous operation.');
 for(const [obj,path,end]of [[identity,'identity',identityDates?identity.validTo:null],[o,'output',outputDates?o.periodEnd:null]]){
  const source=c.sources.find(s=>s.id===obj.sourceId),pub=publication(source?.publicationDate);
  if(end&&((pub&&pub.end<end)||(timestamp(source?.acquiredAt)&&source.acquiredAt.slice(0,10)<end)))add('record_predates_observation',path,'The cited document was published or acquired before the claimed observation interval ended.');
 }
 const result={schemaVersion:1,method:OPERATING_PREFLIGHT_METHOD,reviewedAt,candidateSha256:await digest(c),pathwayRoleId:c.pathwayRoleId,
  artifactBindings:supplied.sort((a,b)=>a.sha256.localeCompare(b.sha256)),status:issue.length?'needs_evidence':'ready_for_manual_review',issues:issue,
  interpretation:'This preflight checks declarations and supplied artifact bindings. It does not read source claims, verify their truth, grant reuse permission or admit evidence. Ready for manual review never means verified supply.',
  sourceTruthVerified:false,permissionIndependentlyVerified:false,physicalIdentityIndependentlyVerified:false,outputAccepted:false,gateSatisfied:false,verifiedDeliverableTonnes:null,modelImprovementClaimed:false,
  nextReview:'Independently inspect the original documents, physical processing link, dates, output method, uncertainty and permission scope. Review applicable operating authorization separately. Publish only explicitly permitted reviewed fields in a new evidence snapshot before recreating a decision. Product quality, allocation and delivery remain separate unresolved checks.',
 };
 return {...result,reviewId:await digest(result)};
}
