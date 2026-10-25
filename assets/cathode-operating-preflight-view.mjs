import {makeCathodeOperatingReviewReceipt} from '/assets/cathode-review-receipt.mjs?v=msha-identity-20261025';
import {blankOperatingRecord,preflightOperatingRecord,sha256Bytes,PREFLIGHT_LIMITS} from '/assets/cathode-operating-preflight.mjs?v=20261023a';

export function mountOperatingPreflight(host){
 host.className='ev-card ev-card-body';
 host.innerHTML=`<h2>Review an operating evidence record</h2>
 <p>Prepare a source-backed record for the unresolved Gunnison electrowinning role. This preflight finds missing information and mismatched dates or files before manual review. It never changes the supply calculation or verifies a supplier.</p>
 <p class="ev-small">Files are read on your device. Nothing is uploaded, saved to browser storage or fetched from a source URL. The downloadable result contains checks and hashes, not the submitted facts or file names.</p>
 <button id="op-template" class="ev-button" type="button">Download blank record template</button>
 <details><summary>How to prepare the record</summary><p>Fill the template from original documents. Keep unknowns as null. Each source needs its HTTPS link, publication date at the known precision (year, month or day), acquisition timestamp, SHA-256, byte count, exact reuse basis and permitted fields. Refer to that source and a precise document location for each claim.</p>
 <ul><li>Identity: distinguish the physical facility and locality, name the electrowinning process, and document actual processing over the entire output interval. A proposed plant association or common owner is insufficient.</li><li>Output: record measured or reported cathode output in tonnes of gross product mass, with dates and documented interruptions. Sales, capacity, modeled estimates and permits cannot substitute.</li><li>Permission: record document-specific permission for identity and operating-output fields. A government website alone does not establish permission for third-party material.</li></ul>
 <p class="ev-small">Template values: relation = explicit_actual_processing; process = electrowinning or solvent_extraction_electrowinning; kind = measured_output or reported_output; product = copper_cathode; unit = t; massBasis = gross_product_mass. Reuse status = documented_permission, with permittedFields identity and/or operating_output. Interruptions status = documented_interruptions or explicitly_no_interruptions, with a source locator. These entries are declarations to inspect, not verification.</p></details>
 <div class="ev-input-grid"><label for="op-record">Completed record · JSON, up to 64 KiB<input id="op-record" type="file" accept=".json,application/json"></label><label for="op-originals">Original source files · up to four, 16 MiB each<input id="op-originals" type="file" multiple></label></div>
 <div class="ev-links"><button id="op-check" class="ev-button" type="button" disabled>Check record</button><button id="op-clear" class="ev-button" type="button">Clear files</button><button id="op-download" class="ev-button" type="button" disabled>Download preflight result</button></div>
 <div id="op-result" role="status" aria-live="polite">Select a record to check. Original sources remain subject to manual review.</div>
 <h3>Connect this review to your requirement</h3><p id="op-link-state" role="status" aria-live="polite">Create the brief and research handoff above, then link a checked record to its operating-evidence task. Editing the requirement invalidates the link.</p>
 <div class="ev-links"><button id="op-link" class="ev-button" type="button" disabled>Link to current research handoff</button><button id="op-receipt" class="ev-button" type="button" disabled>Download review receipt</button></div>`;
 const $=id=>host.querySelector('#'+id);let revision=0,report=null,handoff=null,checkedInput=null,linkedReceipt=null,linkRevision=0;
 function download(value,name){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const clearReceipt=()=>{linkRevision++;linkedReceipt=null;$('op-receipt').disabled=true;$('op-link').disabled=!(handoff&&report&&checkedInput);$('op-link-state').textContent=handoff?'A current handoff is available. Link a checked record to its unresolved operating-evidence task.':'Create a brief and research handoff above before linking this review. Supply remains unverified.';};
 const invalidate=()=>{revision++;report=null;checkedInput=null;clearReceipt();$('op-download').disabled=true;$('op-check').disabled=!$('op-record').files.length;$('op-result').textContent='Files changed. Check the current record before downloading a result.';};
 $('op-template').addEventListener('click',()=>download(blankOperatingRecord(),'baryon-operating-record-template.json'));
 $('op-record').addEventListener('change',invalidate);$('op-originals').addEventListener('change',invalidate);
 $('op-clear').addEventListener('click',()=>{$('op-record').value='';$('op-originals').value='';invalidate();$('op-result').textContent='Files cleared. No evidence was admitted.';});
 $('op-download').addEventListener('click',()=>{if(report)download(report,'baryon-operating-preflight.json');});
 $('op-check').addEventListener('click',async()=>{
  const version=++revision;report=null;checkedInput=null;clearReceipt();$('op-download').disabled=true;$('op-check').disabled=true;$('op-result').textContent='Checking local files…';
  try{
   const file=$('op-record').files[0],originals=[...$('op-originals').files];
   if(!file||!file.size||file.size>PREFLIGHT_LIMITS.candidateBytes)throw Error('Select a nonempty JSON record no larger than 64 KiB.');
   if(originals.length>PREFLIGHT_LIMITS.sourceCount||originals.some(f=>!f.size||f.size>PREFLIGHT_LIMITS.artifactBytes))throw Error('Select at most four nonempty original files, each no larger than 16 MiB.');
   const raw=await file.text();let record;try{record=JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw Error('The record is not valid JSON. Use the blank template.');}
   const bindings=[];
   for(const original of originals){const bytes=await original.arrayBuffer();if(bytes.byteLength>PREFLIGHT_LIMITS.artifactBytes)throw Error('Original file exceeds 16 MiB.');bindings.push({sha256:await sha256Bytes(bytes),bytes:bytes.byteLength});}
   const result=await preflightOperatingRecord(record,bindings,new Date().toISOString());
   if(version!==revision||!host.isConnected)return;
   report=result;checkedInput={candidate:record,artifacts:bindings};clearReceipt();const box=$('op-result');box.replaceChildren();
   const title=document.createElement('h3');title.textContent=result.status==='ready_for_manual_review'?'Ready for manual review · supply remains unverified':'Evidence still needed';box.append(title);
   const explanation=document.createElement('p');explanation.textContent=result.interpretation;box.append(explanation);
   if(result.issues.length){const list=document.createElement('ul');for(const issue of result.issues){const li=document.createElement('li');li.textContent=issue.path+': '+issue.message;list.append(li);}box.append(list);}
   const next=document.createElement('p');next.textContent=result.nextReview;box.append(next);$('op-download').disabled=false;
  }catch(error){if(version===revision&&host.isConnected)$('op-result').textContent='Could not check the record: '+error.message;}
  finally{if(version===revision&&host.isConnected)$('op-check').disabled=!$('op-record').files.length;}
 });
 $('op-link').addEventListener('click',async()=>{
  if(!handoff||!report||!checkedInput)return;
  const version=++linkRevision,request=checkedInput,reviewedAt=report.reviewedAt,current=handoff;
  linkedReceipt=null;$('op-link').disabled=true;$('op-receipt').disabled=true;$('op-link-state').textContent='Linking the checked record to the current task…';
  try{
   const receipt=await makeCathodeOperatingReviewReceipt(current,request.candidate,request.artifacts,reviewedAt);
   if(version!==linkRevision||!host.isConnected)return;
   linkedReceipt=receipt;$('op-receipt').disabled=false;
   $('op-link-state').textContent=receipt.status==='pending_manual_review'?'Linked to the current operating-evidence task. Manual source review is pending; no observation or supply gate is accepted.':'Linked to the current operating-evidence task with evidence gaps. The task and all supply gates remain unresolved.';
  }catch{if(version===linkRevision&&host.isConnected)$('op-link-state').textContent='Could not validate this task link. Recreate the brief and check the record again.';}
  finally{if(version===linkRevision&&host.isConnected)$('op-link').disabled=!(handoff&&report&&checkedInput);}
 });
 $('op-receipt').addEventListener('click',()=>{if(linkedReceipt)download(linkedReceipt,'baryon-operating-review-receipt.json');});
 return {
  setHandoff(value){handoff=structuredClone(value);clearReceipt();},
  clearHandoff(){handoff=null;clearReceipt();},
 };
}
