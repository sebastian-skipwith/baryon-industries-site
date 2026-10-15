import {SCREEN_INPUTS,screenCathodeSupply,supplyInvestigations} from '/assets/cathode-screen.mjs?v=20261015b';
export async function renderPathway(container,{descriptor,data,helpers:h}) {
  if(!descriptor)throw new Error('Operating pathway evidence is not included in this snapshot.');
  const e=await data(descriptor),{escape:esc,fmt,heading,metric,jsonDetails,footer}=h;
  const source=`<a href="${esc(e.source.url)}#page=4" target="_blank" rel="noopener">USGS Copper Yearbook · page 20.2 ↗</a>`;
  container.innerHTML=heading('Supply decisions / Gunnison, Arizona','Can this pathway meet a copper requirement?','Follow a documented route from underground leaching to copper cathodes. Compare a delivery target with historical evidence, then test explicitly assumed operating conditions.','Historical evidence · 2022')+
    `<div class="ev-note"><strong>Evidence year: 2022. Report published: May 2026.</strong> Current operating status and available supply are unknown in this snapshot.</div>
    <div class="ev-card ev-card-body"><h2>Check newer sources before using this pathway</h2><p>The historical process does not establish the current project design, operating status or production of any related facility. Identify the exact facility before carrying a figure into a supply decision.</p><p>Newer company information is linked for review. Company figures are withheld pending applicable reuse permission; no current rate has been inferred here.</p><div class="ev-links"><a href="https://www.gunnisoncopper.com/projects/gunnison-permitting" target="_blank" rel="noopener">Publisher project information ↗</a><a href="https://www.gunnisoncopper.com/disclaimer" target="_blank" rel="noopener">Publisher reuse terms ↗</a><a href="#models">Inspect research outcomes and source decisions →</a></div></div>
    <div class="ev-metrics">${metric('471 t','reported cathode sales · 2022')}${metric('11,300 t/year','stage-one nameplate · ramp delayed')}${metric('Unknown','actual annual production')}${metric('Unknown','verified deliverable supply')}</div>
    <div class="ev-card ev-card-body"><h2>From the deposit to a product</h2><div class="ev-flow">
      <div class="ev-flow-step"><span>1 · In situ extraction</span><strong>Wellfield</strong><small>Gunnison, Arizona</small></div>
      <div class="ev-flow-step"><span>2 · Recovery wells</span><strong>Solution</strong><small>Flow and copper concentration unknown</small></div>
      <div class="ev-flow-step"><span>3 · Electrowinning</span><strong>Cathodes</strong><small>Production rate and purity unknown</small></div>
      <div class="ev-flow-step"><span>4 · Buyer delivery</span><strong>Unverified</strong><small>Allocation and logistics unresolved</small></div></div>
      <p>${esc(e.process)}</p><p><strong>Reported constraint:</strong> ${esc(e.constraint)}</p><p class="ev-small">The first three steps summarize the reported process; the buyer step is a requirement to investigate. There are no measured flow quantities on the connections.</p><div class="ev-links">${source}</div></div>
    <div class="ev-supply-grid"><div class="ev-card ev-card-body"><h2>Set a cathode requirement</h2><p class="ev-small">All mass inputs are tonnes of cathode product. No product purity or copper-content conversion is assumed. Optional operating inputs start blank.</p>
    <div class="ev-input-grid">${Object.entries(SCREEN_INPUTS).map(([key,r])=>`<label for="cp-${key}">${esc(r.label)} <span>${esc(r.unit)}${r.required?'':' · assumption'}</span><input id="cp-${key}" type="number" min="${r.exclusiveMin?0.001:r.min}" max="${r.max}" step="any" ${r.required?'required':''} value="${key==='targetTonnes'?1000:key==='horizonDays'?365:''}"></label>`).join('')}</div>
    <p class="ev-small">The output rate is gross plant cathode production. The available share excludes other buyers’ commitments; delivery retention accounts for transport/handling. No start-up delay, starting inventory or ramp is modeled.</p><button id="cp-clear" class="ev-button">Clear operating assumptions</button></div>
    <div id="cp-answer" class="ev-card ev-card-body" aria-live="polite"></div></div>
    <div class="ev-split"><div class="ev-card ev-card-body"><h2>What to investigate next</h2><ol id="cp-investigations" class="ev-investigations"></ol><p class="ev-small">Fixed decision rules based on evidence gaps. This is not a learned research policy or a claim that tests have been performed.</p></div>
    <div class="ev-card ev-card-body"><h2>Keep the evidence bases separate</h2><p>471 tonnes is a full-year sales observation. It is not a production measurement, inventory balance or current supply offer. The 11,300 t/year figure is nameplate capacity whose ramp-up was delayed.</p><p>Subtracting sales from capacity would not measure spare capacity. Dividing the two would not establish plant utilization. A subsurface copper occurrence does not determine fluid flow or recoverable product.</p><div class="ev-links"><a href="#supply">Compare the Copperwood development scenario →</a><a href="#flows">Inspect dated US copper accounts →</a><a href="#models">Review model evaluations →</a></div></div></div>
    <div class="ev-card ev-card-body"><h2>Evidence and scenario record</h2><p>${esc(e.confidence)} ${esc(e.scope)}</p><p>${esc(e.redistribution)} ${source} · <a href="${esc(e.source.rightsUrl)}" target="_blank" rel="noopener">Source-use policy ↗</a></p>
    ${jsonDetails('Reported facts, persistent facility IDs and unknowns',e)}
    <div class="ev-links"><a href="/data/evidence/${esc(descriptor.file)}" download>Download evidence snapshot</a><button class="ev-button" id="cp-report-button">View decision report</button></div><div id="cp-report" hidden></div></div>${footer()}`;
  const $=id=>container.querySelector('#'+id);let input,result,url;
  function update(){
    if(url){URL.revokeObjectURL(url);url=null;}
    $('cp-report').hidden=true;$('cp-report').textContent='';
    input=Object.fromEntries(Object.keys(SCREEN_INPUTS).map(k=>[k,$('cp-'+k).value===''?null:$('cp-'+k).valueAsNumber]));
    result=screenCathodeSupply(input,e);$('cp-report-button').disabled=!result.ok;
    if(!result.ok){$('cp-answer').innerHTML=`<h2>Revise the requirement</h2><div role="alert" class="ev-error">${result.errors.map(esc).join('<br>')}</div>`;$('cp-investigations').textContent='Enter a valid requirement.';return;}
    const r=result;
    $('cp-answer').innerHTML=`<div class="ev-kicker">Required delivery rate</div><div class="ev-supply-total">${fmt(r.minimumCathodeRate,2)} <span>t cathodes/day</span></div><p>At least ${fmt(r.minimumAnnualEquivalent,0)} t/year on a constant 365-day basis: ${fmt(r.minimumNameplatePct,2)}% of the historical stage-one nameplate, before allocation or delivery losses.</p>
    ${r.exceedsHistoricalNameplate?'<div class="ev-note"><strong>Target exceeds the historical design rate.</strong> A longer window, other sources or supported expansion would be needed on this comparison.</div>':''}
    <h2>${r.conditionalTonnes===null?'Delivery cannot yet be calculated':r.targetMet?'Entered scenario reaches the target':'Entered scenario falls short'}</h2>
    <p>${r.conditionalTonnes===null?'Enter the optional operating assumptions to calculate a conditional result.':`${fmt(r.conditionalTonnes,2)} t cathodes conditionally delivered over ${fmt(r.horizonDays,0)} days; ${fmt(Math.abs(r.gapTonnes),2)} t ${r.gapTonnes>=0?'above':'below'} target.`}</p>
    ${r.requiredGrossRate!==null?`<p>Required gross plant rate under the entered allocation and retention: <strong>${fmt(r.requiredGrossRate,2)} t/day</strong>.</p>`:''}
    ${r.impossibleWithAssumedAllocation?'<p>A zero allocation or retention prevents delivery at any plant rate.</p>':''}
    ${r.scenarioExceedsHistoricalNameplate?'<p><strong>The assumed plant rate exceeds the historical nameplate.</strong> Expansion has not been verified.</p>':''}
    <div class="ev-note"><strong>Verified deliverable supply: unknown.</strong> Product specification, current operating capability, commitments and timing still require evidence. A scenario result is not an offer or forecast.</div>`;
    $('cp-investigations').innerHTML=supplyInvestigations(r).map(v=>`<li><h3>${esc(v.question)}</h3><p>${esc(v.action)}</p></li>`).join('');
  }
  container.querySelectorAll('input').forEach(n=>n.addEventListener('input',update));
  $('cp-clear').addEventListener('click',()=>{for(const [k,r]of Object.entries(SCREEN_INPUTS))if(!r.required)$('cp-'+k).value='';update();});
  $('cp-report-button').addEventListener('click',()=>{
    if(!result.ok)return;
    const report={schemaVersion:1,generatedAt:new Date().toISOString(),evidenceId:e.id,evidenceSha256:descriptor.sha256,inputs:input,result,investigations:supplyInvestigations(result),evidence:e};
    const raw=JSON.stringify(report,null,2);if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
    $('cp-report').innerHTML=`<h3>Decision report</h3><a href="${esc(url)}" download="baryon-gunnison-decision.json">Save report as JSON</a><pre class="ev-json" tabindex="0">${esc(raw)}</pre>`;$('cp-report').hidden=false;
  });
  update();
}
