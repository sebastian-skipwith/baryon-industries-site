import {makeCopperDemandContext,copperDemandContextMarkdown} from '/assets/copper-demand-context.mjs?v=20261023h';

export function renderCopperDemandContext(container,{demand,demandDescriptor,chileDescriptor,flowDescriptor,manufacturingDescriptor,data,helpers:h,getDemandYear}){
 const {escape:e,fmt}=h;
 container.innerHTML=`<section class="ev-card ev-card-body"><h2>Copper decision-context brief</h2><p>Put the selected global demand estimate beside dated Chile production and US activity. The brief records which periods and accounting boundaries can be compared, and which evidence a supply decision still needs.</p><div class="ev-toolbar"><label>Chile production year <select id="cdc-chile-year" ${chileDescriptor?'':'disabled'}>${chileDescriptor?Array.from({length:10},(_,i)=>2025-i).map(y=>`<option>${y}</option>`).join(''):'<option>Missing evidence</option>'}</select></label><label>US reporting period <select id="cdc-us-period" ${flowDescriptor||manufacturingDescriptor?'':'disabled'}><option value="2025-01:09">Jan–Sep 2025 · year to date</option></select></label></div><p class="ev-small">Demand is a full-year global estimate. US coverage ends in September 2025. Mill quantities are gross product mass; they are not contained copper. Dates can match while coverage remains incompatible.</p><button type="button" class="ev-button" id="cdc-prepare">Prepare decision context</button><div id="cdc-result" aria-live="polite"></div><div class="ev-links" id="cdc-downloads"></div><div class="ev-links"><a href="#pathway">Open the separate buyer supply workflow →</a></div></section>`;
 const $=id=>container.querySelector('#'+id);let version=0,urls=[],datasets=null,observing=false;
 const revoke=()=>{for(const url of urls)URL.revokeObjectURL(url);urls=[];};
 const clear=()=>{++version;revoke();$('cdc-result').textContent='Selections changed; prepare a new brief.';$('cdc-downloads').replaceChildren();$('cdc-prepare').disabled=false;};
 const load=async()=>{
  if(datasets)return datasets;
  const entries=await Promise.all([['production',chileDescriptor],['flows',flowDescriptor],['manufacturing',manufacturingDescriptor]].map(async([key,descriptor])=>[key,descriptor?{descriptor,data:await data(descriptor)}:null]));
  const result=Object.fromEntries(entries);datasets=result;return result;
 };
 // Use the reviewed inventory of periods, not synthetic time-series values.
 const periodIds=['2025-01:09',...Array.from({length:9},(_,i)=>`2025-${String(9-i).padStart(2,'0')}`),'2024-01:12','2024-12','2024-11','2024-10','2024-07:09','2024-01:09'];
 const label=id=>id==='2025-01:09'?'2025-01-01 to 2025-09-30 · year to date':id==='2024-01:12'?'2024 · full year':id==='2024-07:09'?'Jul–Sep 2024 · quarter':id==='2024-01:09'?'Jan–Sep 2024 · year to date':id+' · month';
 $('cdc-us-period').innerHTML=flowDescriptor||manufacturingDescriptor?periodIds.map(id=>`<option value="${id}">${label(id)}</option>`).join(''):'<option>Missing evidence</option>';
 $('cdc-chile-year').onchange=clear;$('cdc-us-period').onchange=clear;
 $('cdc-prepare').onclick=async()=>{
  if(!observing){observer.observe(container.ownerDocument.body,{childList:true,subtree:true});observing=true;}
  clear();const current=version,selection={demandYear:getDemandYear(),productionYear:chileDescriptor?Number($('cdc-chile-year').value):null,usPeriodId:flowDescriptor||manufacturingDescriptor?$('cdc-us-period').value:null};
  $('cdc-prepare').disabled=true;$('cdc-result').textContent='Checking source snapshots…';
  try{
   const context=await load();
   const report=await makeCopperDemandContext({selection,generatedAt:new Date().toISOString(),sources:{demand:{data:demand,descriptor:demandDescriptor},...context}});
   const markdown=await copperDemandContextMarkdown(report);
   if(current!==version)return;
   const checks=report.compatibility.checks;
   $('cdc-result').innerHTML=`<p><strong>${report.demand.year} global demand: ${fmt(report.demand.values.total)} kt Cu.</strong> Verified deliverable supply and supply gaps: unknown.</p><details id="cdc-checks"><summary>Why these accounts cannot define a supply gap</summary>${checks.map(c=>`<section><h3>${e(c.id.replaceAll('-',' '))} · ${e(c.status.replaceAll('_',' '))}</h3><p>${e(c.reason)}</p><p class="ev-small">Needed: ${e(c.needed)}</p></section>`).join('')}</details>`;
   for(const [ext,text,type]of [['json',JSON.stringify(report,null,2)+'\n','application/json'],['md',markdown,'text/markdown']]){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));urls.push(url);a.href=url;a.download=`baryon-copper-context-${selection.demandYear}.${ext}`;a.textContent=ext==='json'?'Download evidence brief (JSON)':'Download readable brief (Markdown)';$('cdc-downloads').append(a);}
  }catch(error){if(current===version)$('cdc-result').textContent='Could not prepare context: '+error.message;}
  finally{if(current===version)$('cdc-prepare').disabled=false;}
 };
 // Revoke when a different evidence view replaces this detached staging container.
 const observer=new MutationObserver(()=>{if(!container.isConnected){++version;revoke();observer.disconnect();}});
 return {setDemandYear:()=>{if(chileDescriptor)$('cdc-chile-year').value=String(getDemandYear());clear();}};
}
