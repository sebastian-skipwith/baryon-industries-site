import {makeChileContext,chileContextMarkdown} from '/assets/chile-context.mjs?v=20261023d';

export function mountChileContext(container,sources){
 let year=null,generation=0;
 container.innerHTML=`<section class="ev-card ev-card-body" aria-label="Chile evidence brief"><h2>Take the evidence into a supply review</h2><p>Download the selected year’s production, energy inputs, covered sales and exports with source checksums, units and unresolved facility questions.</p><p class="ev-small">National context only. The brief does not calculate facility requirements, total demand or available supply.</p><button type="button" class="ev-button" id="cl-context-prepare">Prepare evidence brief</button><p id="cl-context-status" role="status"></p><div id="cl-context-downloads" class="ev-links"></div></section>`;
 const button=container.querySelector('#cl-context-prepare'),status=container.querySelector('#cl-context-status'),links=container.querySelector('#cl-context-downloads');
 button.onclick=async()=>{
  const version=++generation,selectedYear=year;links.replaceChildren();button.disabled=true;status.textContent=`Checking source snapshots for ${year}…`;
  try{
   const report=await makeChileContext({year:selectedYear,generatedAt:new Date().toISOString(),sources});
   const markdown=await chileContextMarkdown(report);
   if(version!==generation||!container.isConnected)return;
   const missing=Object.entries(report.availability).filter(([,v])=>v==='missing').map(([k])=>k);
   status.textContent=`${selectedYear} brief ready. ${missing.length?'Missing evidence: '+missing.join(', ')+'.':'Four source snapshots verified.'} Facility supply remains unknown.`;
   // Data URLs belong to their anchors and require no lingering object-URL registry.
   for(const [ext,mime,text,label]of [['json','application/json',JSON.stringify(report,null,2)+'\n','Download JSON'],['md','text/markdown',markdown,'Download Markdown']]){
    const a=document.createElement('a');a.download=`baryon-chile-context-${selectedYear}.${ext}`;a.href=`data:${mime};charset=utf-8,`+encodeURIComponent(text);a.textContent=label;links.append(a);
   }
  }catch(error){if(version===generation&&container.isConnected){links.replaceChildren();status.textContent='Could not prepare brief: '+error.message;}}
  finally{if(version===generation)button.disabled=false;}
 };
 return selectedYear=>{
  if(year===selectedYear)return;
  year=selectedYear;generation++;links.replaceChildren();button.disabled=false;button.textContent=`Prepare ${year} evidence brief`;status.textContent='Select a year, then prepare its evidence brief.';
 };
}
