import {makeCathodeDecision,cathodeDecisionMarkdown} from '/assets/cathode-decision.mjs?v=20261016c';
import {makeCathodeResearchHandoff,cathodeResearchHandoffMarkdown} from '/assets/cathode-research-handoff.mjs?v=20261019b';
import {SCREEN_INPUTS,screenCathodeSupply,supplyInvestigations} from '/assets/cathode-screen.mjs?v=20261015b';
import {compareCathodeThresholds,cathodeThresholdStatus,makeCathodeThresholdReport,cathodeThresholdMarkdown} from '/assets/cathode-thresholds.mjs?v=20261020a';
export async function renderPathway(container,{descriptor,reviewDescriptor,data,helpers:h}) {
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
    <section id="cp-thresholds" class="ev-card ev-card-body" aria-label="Compare single assumption thresholds" aria-live="polite"></section>
    <div class="ev-split"><div class="ev-card ev-card-body"><h2>What to investigate next</h2><ol id="cp-investigations" class="ev-investigations"></ol><p class="ev-small">Fixed decision rules based on evidence gaps. This is not a learned research policy or a claim that tests have been performed.</p></div>
    <div class="ev-card ev-card-body"><h2>Keep the evidence bases separate</h2><p>471 tonnes is a full-year sales observation. It is not a production measurement, inventory balance or current supply offer. The 11,300 t/year figure is nameplate capacity whose ramp-up was delayed.</p><p>Subtracting sales from capacity would not measure spare capacity. Dividing the two would not establish plant utilization. A subsurface copper occurrence does not determine fluid flow or recoverable product.</p><div class="ev-links"><a href="#supply">Compare the Copperwood development scenario →</a><a href="#flows">Inspect dated US copper accounts →</a><a href="#models">Review model evaluations →</a></div></div></div>
    <div class="ev-card ev-card-body"><h2>Evidence and scenario record</h2><p>${esc(e.confidence)} ${esc(e.scope)}</p><p>${esc(e.redistribution)} ${source} · <a href="${esc(e.source.rightsUrl)}" target="_blank" rel="noopener">Source-use policy ↗</a></p>
    ${jsonDetails('Reported facts, persistent facility IDs and unknowns',e)}
    <p>Create a decision brief and an evidence handoff: four unresolved checks, candidate source links, recorded access status and the observations needed next.</p>
    <div class="ev-links"><a href="/data/evidence/${esc(descriptor.file)}" download>Download evidence snapshot</a><button class="ev-button" id="cp-report-button">Create brief + research handoff</button></div><div id="cp-report" hidden></div></div>${footer()}`;
  const $=id=>container.querySelector('#'+id);let input,result,revision=0;const urls=[];
  const releaseDownloads=()=>{for(const url of urls)URL.revokeObjectURL(url);urls.length=0;};
  const thresholdNumber=v=>v===null?'Unknown':new Intl.NumberFormat('en-US',{maximumSignificantDigits:6}).format(v);
  function renderThresholds(comparison){
    if(!comparison.ok)return '<h2>What would need to change?</h2><p>Enter a valid requirement to compare assumptions.</p>';
    const gateLabels={'current-operations':'Current sustained output',allocation:'Uncommitted quantity',delivery:'Delivery dates and route'};
    return '<h2>What would need to change?</h2><p>Each row varies one assumption and holds the other entries fixed. These are alternative arithmetic comparisons, not a combined operating plan. Changing the window changes the requirement.</p>'+
      '<div class="ev-table-wrap" role="region" aria-label="Conditional thresholds" tabindex="0"><table class="ev-table"><thead><tr><th scope="col">Vary only</th><th scope="col">Entered</th><th scope="col">Required to reach target</th><th scope="col">Meaning and evidence needed</th></tr></thead><tbody>'+comparison.rows.map(row=>
        '<tr data-threshold="'+esc(row.key)+'"><th scope="row">'+esc(row.label)+'<small>'+esc(row.unit)+'</small></th><td data-label="Entered">'+thresholdNumber(row.currentValue)+'</td><td data-label="Required to reach target" data-required="'+esc(row.key)+'">'+thresholdNumber(row.requiredValue)+
        (row.changeFromEntered===null?'':'<small>Required minus entered: '+thresholdNumber(row.changeFromEntered)+' '+esc(row.changeUnit)+'</small>')+'</td><td data-label="Meaning and evidence needed">'+esc(cathodeThresholdStatus(row))+
        '<small>Unresolved check: '+row.evidenceGateIds.map(id=>gateLabels[id]).join(', ')+'. Product acceptance also remains unverified.</small><details><summary>Other assumptions held fixed</summary><ul>'+Object.entries(row.fixedInputs).map(([key,value])=>'<li>'+esc(SCREEN_INPUTS[key].label)+': '+thresholdNumber(value)+' '+esc(SCREEN_INPUTS[key].unit)+'</li>').join('')+'</ul></details></td></tr>').join('')+
      '</tbody></table></div><p class="ev-small">Values shown to six significant digits; the comparison download retains exact values. A required share above 100% cannot meet the target by changing that share alone. Calculator input ranges are not physical limits. No threshold establishes available capacity or verified supply.</p><a href="#cp-report-button">Save this comparison with the decision and research handoff ↓</a>';
  }
  function update(){
    revision++;releaseDownloads();
    $('cp-report').hidden=true;$('cp-report').textContent='';
    input=Object.fromEntries(Object.keys(SCREEN_INPUTS).map(k=>[k,$('cp-'+k).value===''?null:$('cp-'+k).valueAsNumber]));
    result=screenCathodeSupply(input,e);$('cp-report-button').disabled=!result.ok;
    $('cp-thresholds').innerHTML=renderThresholds(compareCathodeThresholds(input,e));
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
  $('cp-report-button').addEventListener('click',async()=>{
    if(!result.ok)return;
    const requestedRevision=revision;$('cp-report-button').disabled=true;
    try{
      const report=await makeCathodeDecision(input,e,descriptor,new Date().toISOString());
      const markdown=await cathodeDecisionMarkdown(report);
      if(!reviewDescriptor)throw new Error('Research review is missing from this snapshot. Reload to retry.');
      const review=await data(reviewDescriptor);
      const handoff=await makeCathodeResearchHandoff(report,review,reviewDescriptor);
      const handoffMarkdown=await cathodeResearchHandoffMarkdown(handoff);
      const thresholdReport=await makeCathodeThresholdReport(handoff);
      const thresholdMarkdown=await cathodeThresholdMarkdown(thresholdReport);
      if(requestedRevision!==revision)return;
      releaseDownloads();
      const raw=JSON.stringify(report,null,2);
      const jsonUrl=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
      const markdownUrl=URL.createObjectURL(new Blob([markdown],{type:'text/markdown;charset=utf-8'}));
      const handoffUrl=URL.createObjectURL(new Blob([JSON.stringify(handoff,null,2)],{type:'application/json'}));
      const handoffMarkdownUrl=URL.createObjectURL(new Blob([handoffMarkdown],{type:'text/markdown;charset=utf-8'}));
      const thresholdUrl=URL.createObjectURL(new Blob([JSON.stringify(thresholdReport,null,2)],{type:'application/json'}));
      const thresholdMarkdownUrl=URL.createObjectURL(new Blob([thresholdMarkdown],{type:'text/markdown;charset=utf-8'}));
      urls.push(jsonUrl,markdownUrl,handoffUrl,handoffMarkdownUrl,thresholdUrl,thresholdMarkdownUrl);
      const sourceLabels={historical_context_used:'Historical context only',links_only_reuse_restricted:'Links only · reuse restricted',document_review_pending:'Document review pending',source_unavailable_review_incomplete:'Source unavailable · review incomplete'};
      $('cp-report').innerHTML=`<h3>Decision brief</h3><div class="ev-note"><strong>Investigate before commitment.</strong> Verified deliverable supply remains unknown, including when the entered scenario reaches the target.</div>
        <p>Save a readable brief with the requirement, assumptions, historical facts, unresolved evidence checks and next investigations. The paired JSON retains exact values and the evidence fingerprint. Downloads stay in your browser; no scenario is sent to a server.</p>
        <ul>${report.evidenceGates.map(g=>`<li><strong>Unverified:</strong> ${esc(g.requires)}</li>`).join('')}</ul>
        <div class="ev-links"><a href="${esc(markdownUrl)}" download="baryon-gunnison-decision.md">Download decision brief (.md)</a><a href="${esc(jsonUrl)}" download="baryon-gunnison-decision.json">Download exact scenario (.json)</a></div>
        ${jsonDetails('Exact scenario, evidence and reproducibility record',report)}
        <h3>One assumption at a time</h3><p>Save the required changes calculated above, with the exact assumptions, decision and research handoff. All evidence checks remain unresolved.</p>
        <div class="ev-links"><a href="${esc(thresholdMarkdownUrl)}" download="baryon-copper-thresholds.md">Download threshold comparison (.md)</a><a href="${esc(thresholdUrl)}" download="baryon-copper-thresholds.json">Download exact comparison (.json)</a></div>
        <section id="cp-handoff" aria-label="Copper evidence research handoff"><h2>From this scenario to evidence</h2>
        <p>Four checks still need evidence. These are proposed research tasks; no source has been acquired and no check has been satisfied by creating this handoff. Source statuses below were recorded in the ${esc(review.reviewedAt)} review.</p>
        <ol class="ev-investigations">${handoff.tasks.map(t=>`<li data-gate="${esc(t.id)}"><h3>${esc(t.title)}</h3><p><strong>Unresolved:</strong> ${esc(t.acceptanceCriteria)}</p><p>${esc(t.nextAction)}</p><p class="ev-small">${esc(t.sourceCoverage)}</p>
          ${t.sourceIds.map(id=>{const s=handoff.sources.find(s=>s.id===id);return `<p class="ev-small"><a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a> · <strong>${esc(sourceLabels[s.status])}</strong> · reviewed ${esc(s.reviewedAt)}${s.policy?` · <a href="${esc(s.policy.url)}" target="_blank" rel="noopener">Recorded reuse policy ↗</a>`:''}</p>`;}).join('')}
          <details><summary>Observation needed and possible decision effect</summary><p>${esc(t.proposedObservation)}</p><p>${esc(t.decisionEffect)}</p><p class="ev-small">Expected utility and cost: unknown. This order is a curated checklist.</p></details></li>`).join('')}</ol>
        <div class="ev-note">${esc(handoff.completionRule)}</div>
        <p>The soil and BC audits are consumed; the BC geological candidate did not pass its uncertainty gate. Copperwood cores remain selected known-deposit evidence. Research-policy improvement has not been demonstrated.</p>
        <div class="ev-links"><a href="${esc(handoffMarkdownUrl)}" download="baryon-copper-research-handoff.md">Download research handoff (.md)</a><a href="${esc(handoffUrl)}" download="baryon-copper-research-handoff.json">Download reproducible handoff (.json)</a><a href="#models">Inspect research outcomes →</a></div>
        ${jsonDetails('Research tasks, source bindings and consumed-audit safeguards',handoff)}</section>`;
      $('cp-report').hidden=false;
    }catch(error){
      if(requestedRevision!==revision)return;
      releaseDownloads();$('cp-report').innerHTML=`<div role="alert" class="ev-error">Could not create the brief: ${esc(error.message)}</div>`;$('cp-report').hidden=false;
    }finally{if(requestedRevision===revision)$('cp-report-button').disabled=!result.ok;}
  });
  update();
}
