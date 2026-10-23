import {mountOperatingPreflight} from '/assets/cathode-operating-preflight-view.mjs?v=20261023b';
import {makeFacilityStatusContext} from '/assets/cathode-facility-status.mjs?v=20261022c';
import {resolveCathodeRequirement} from '/assets/cathode-requirement.mjs?v=20261021d';
import {makeCathodeDecision,cathodeDecisionMarkdown} from '/assets/cathode-decision.mjs?v=20261021d';
import {makeCathodeResearchHandoff,cathodeResearchHandoffMarkdown} from '/assets/cathode-research-handoff.mjs?v=20261022c';
import {SCREEN_INPUTS,screenCathodeSupply,supplyInvestigations} from '/assets/cathode-screen.mjs?v=20261015b';
import {compareCathodeThresholds,cathodeThresholdStatus,makeCathodeThresholdReport,cathodeThresholdMarkdown} from '/assets/cathode-thresholds.mjs?v=20261022c';
import {makeCathodeFlowContext,cathodeFlowContextMarkdown} from '/assets/cathode-flow-context.mjs?v=20261022c';
export async function renderPathway(container,{descriptor,reviewDescriptor,flowDescriptor,circuitDescriptor,facilityStatusDescriptor,data,helpers:h}) {
  if(!descriptor)throw new Error('Operating pathway evidence is not included in this snapshot.');
  const e=await data(descriptor),{escape:esc,fmt,heading,metric,jsonDetails,footer}=h;
  const identity=e.identityResolution??{statement:'This historical snapshot uses Baryon process-role keys. Physical refinery identity has not been resolved.',admissionRule:'Resolve a permitted dated physical-facility link before assigning output, inventory, product assays or shipments. Common ownership and similar names are insufficient.'};
  let flowEvidence,circuitEvidence,contextError;
  try{if(!flowDescriptor||!circuitDescriptor)throw new Error('National account or processing-group snapshot is unavailable.');[flowEvidence,circuitEvidence]=await Promise.all([data(flowDescriptor),data(circuitDescriptor)]);}catch(error){contextError=error.message;}
  let statusInput,statusError;
  try{if(facilityStatusDescriptor){statusInput={evidence:await data(facilityStatusDescriptor),binding:facilityStatusDescriptor};makeFacilityStatusContext(statusInput);}}catch(error){statusError=error.message;}
  const source=`<a href="${esc(e.source.url)}#page=4" target="_blank" rel="noopener">USGS Copper Yearbook · page 20.2 ↗</a>`;
  container.innerHTML=heading('Supply decisions / Gunnison, Arizona','Can this pathway meet a copper requirement?','Follow a documented route from underground leaching to copper cathodes. Compare a delivery target with historical evidence, then test explicitly assumed operating conditions.','Historical evidence · 2022')+
    `<div class="ev-note"><strong>Evidence year: 2022. Report published: May 2026.</strong> Current operating status and available supply are unknown in this snapshot.</div>
    <div class="ev-card ev-card-body"><h2>Check newer sources before using this pathway</h2><p>The historical process does not establish the current project design, operating status or production of any related facility. Identify the exact facility before carrying a figure into a supply decision.</p><p>Newer company information is linked for review. Company figures are withheld pending applicable reuse permission; no current rate has been inferred here.</p><div class="ev-links"><a href="https://www.gunnisoncopper.com/projects/gunnison-permitting" target="_blank" rel="noopener">Publisher project information ↗</a><a href="https://www.gunnisoncopper.com/disclaimer" target="_blank" rel="noopener">Publisher reuse terms ↗</a><a href="#models">Inspect research outcomes and source decisions →</a></div></div>
    <div class="ev-metrics">${metric('471 t','reported cathode sales · 2022')}${metric('11,300 t/year','stage-one nameplate · ramp delayed')}${metric('Unknown','actual annual production')}${metric('Unknown','verified deliverable supply')}</div>
    <div class="ev-card ev-card-body"><h2>From the deposit to a product</h2><div class="ev-flow">
      <div class="ev-flow-step"><span>1 · In situ extraction</span><strong>Wellfield</strong><small>Gunnison, Arizona</small></div>
      <div class="ev-flow-step"><span>2 · Recovery wells</span><strong>Solution</strong><small>Flow and copper concentration unknown</small></div>
      <div class="ev-flow-step"><span>3 · Electrowinning</span><strong>Cathodes</strong><small>Physical refinery identity, production rate and purity unknown</small></div>
      <div class="ev-flow-step"><span>4 · Buyer delivery</span><strong>Unverified</strong><small>Allocation and logistics unresolved</small></div></div>
      <p>${esc(e.process)}</p><p><strong>Reported constraint:</strong> ${esc(e.constraint)}</p><p class="ev-small">The first three steps summarize the reported process; the buyer step is a requirement to investigate. There are no measured flow quantities on the connections.</p><div class="ev-links">${source}</div></div>
    <section id="cp-identity" class="ev-card ev-card-body"><h2>Physical refinery identity is unresolved</h2><p>${esc(identity.statement)}</p><p>${esc(identity.admissionRule)}</p><p class="ev-small">The links above describe historical process roles. No physical asset, location or current production is assigned to them.</p></section>
    <div class="ev-supply-grid"><div class="ev-card ev-card-body"><h2>Set a cathode requirement</h2><p class="ev-small">All mass inputs are tonnes of cathode product. No product purity or copper-content conversion is assumed. Optional operating inputs start blank.</p>
    <div class="ev-input-grid">${Object.entries(SCREEN_INPUTS).map(([key,r])=>`<label for="cp-${key}">${esc(r.label)} <span>${esc(r.unit)}${r.required?'':' · assumption'}</span><input id="cp-${key}" type="number" min="${r.exclusiveMin?0.001:r.min}" max="${r.max}" step="any" ${r.required?'required':''} value="${key==='targetTonnes'?1000:key==='horizonDays'?365:''}"></label>`).join('')}</div>
    <fieldset id="cp-buyer-requirement"><legend>Buyer request · optional</legend><p class="ev-small">Enter both dates to calculate the window, counting the first and last day. Leave both blank to use relative days. These are requested conditions; supplier capability and arrival remain unverified.</p>
    <div class="ev-input-grid"><label for="cp-windowStart">First delivery day<input id="cp-windowStart" type="date" min="1900-01-01" max="2199-12-31"></label><label for="cp-windowEnd">Last delivery day · inclusive<input id="cp-windowEnd" type="date" min="1900-01-01" max="2199-12-31"></label><label for="cp-destination">Requested destination<input id="cp-destination" type="text" maxlength="240" autocomplete="off" placeholder="City, receiving site or port"></label><label for="cp-productSpecification">Buyer product requirement<input id="cp-productSpecification" type="text" maxlength="600" autocomplete="off" placeholder="Required grade, specification or acceptance criteria"></label></div>
    <p id="cp-window-note" class="ev-small" aria-live="polite"></p><p class="ev-small">These entries stay in this page and your downloads. They are not sent to a supplier or saved to a server.</p><button id="cp-clear-request" class="ev-button" type="button">Clear buyer request</button></fieldset>
    <p class="ev-small">The output rate is gross plant cathode production. The available share excludes other buyers’ commitments; delivery retention accounts for transport/handling. No start-up delay, starting inventory or ramp is modeled.</p><button id="cp-clear" class="ev-button">Clear operating assumptions</button></div>
    <div id="cp-answer" class="ev-card ev-card-body" aria-live="polite"></div></div>
    <section id="cp-thresholds" class="ev-card ev-card-body" aria-label="Compare single assumption thresholds" aria-live="polite"></section>
    <div class="ev-split"><div class="ev-card ev-card-body"><h2>What to investigate next</h2><ol id="cp-investigations" class="ev-investigations"></ol><p class="ev-small">Fixed decision rules based on evidence gaps. This is not a learned research policy or a claim that tests have been performed.</p></div>
    <div class="ev-card ev-card-body"><h2>Keep the evidence bases separate</h2><p>471 tonnes is a full-year sales observation. It is not a production measurement, inventory balance or current supply offer. The 11,300 t/year figure is nameplate capacity whose ramp-up was delayed.</p><p>Subtracting sales from capacity would not measure spare capacity. Dividing the two would not establish plant utilization. A subsurface copper occurrence does not determine fluid flow or recoverable product.</p><div class="ev-links"><a href="#supply">Compare the Copperwood development scenario →</a><a href="#flows">Inspect dated US copper accounts →</a><a href="#models">Review model evaluations →</a></div></div></div>
    <div class="ev-card ev-card-body"><h2>Evidence and scenario record</h2><p>${esc(e.confidence)} ${esc(e.scope)}</p><p>${esc(e.redistribution)} ${source} · <a href="${esc(e.source.rightsUrl)}" target="_blank" rel="noopener">Source-use policy ↗</a></p>
    ${jsonDetails('Reported facts, historical role keys and unresolved physical identity',e)}
    <h3>Connect the requirement to national accounts</h3><p>Select one historical US copper reporting period. The context report reconciles that national balance and explains why its period, mass basis and geographic scope cannot establish buyer-specific cathode supply.</p>
    ${contextError?'<p class="ev-error">National context unavailable: '+esc(contextError)+'</p>':'<label for="cp-context-period">National reporting period</label> <select id="cp-context-period">'+[...flowEvidence.periods].reverse().map(p=>'<option value="'+esc(p.id)+'" '+(p.id==='2025-09'?'selected':'')+'>'+esc(p.label)+' · '+esc(p.kind.replaceAll('_',' '))+'</option>').join('')+'</select>'}
    <p id="cp-status-coverage">${statusError?'Operating-status qualification could not be verified: '+esc(statusError):statusInput?'The reports will include the historical ASARCO operating-status disagreement as context about other facilities. It does not resolve any Gunnison supply check.':'No operating-status qualification is included in this snapshot. Historical processing associations do not establish operation.'}</p>
    <p>Create a decision brief and an evidence handoff: four unresolved checks, candidate source links, recorded access status and the observations needed next.</p>
    <div class="ev-links"><a href="/data/evidence/${esc(descriptor.file)}" download>Download evidence snapshot</a><button class="ev-button" id="cp-report-button">Create brief + research handoff</button></div><div id="cp-report" hidden></div></div><section id="cp-operating-preflight"></section>${footer()}`;
  const $=id=>container.querySelector('#'+id);let input,result,buyerRequest,revision=0,preflightControl=null;let relativeDays='365';const urls=[];
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
    revision++;releaseDownloads();preflightControl?.clearHandoff();
    $('cp-report').hidden=true;$('cp-report').textContent='';
    input=Object.fromEntries(Object.keys(SCREEN_INPUTS).map(k=>[k,$('cp-'+k).value===''?null:$('cp-'+k).valueAsNumber]));
    buyerRequest=Object.fromEntries(['windowStart','windowEnd','destination','productSpecification'].map(k=>[k,$('cp-'+k).value]));
    const dated=Boolean(buyerRequest.windowStart||buyerRequest.windowEnd);
    if(!$('cp-horizonDays').disabled)relativeDays=$('cp-horizonDays').value;
    $('cp-horizonDays').disabled=dated;
    if(!dated){$('cp-horizonDays').value=relativeDays;input.horizonDays=relativeDays===''?null:Number(relativeDays);}
    try{
      const resolved=resolveCathodeRequirement(input,buyerRequest);input=resolved.inputs;buyerRequest=resolved.buyerRequest;
      if(dated)$('cp-horizonDays').value=input.horizonDays;
      $('cp-window-note').textContent=dated?`${input.horizonDays} calendar days, both dates inclusive. Changing the dates changes the scenario duration; lead time is not modeled.`:'Using the relative delivery window above. Calendar delivery timing is unspecified.';
      result=screenCathodeSupply(input,e);
    }catch(error){result={ok:false,errors:[error.message]};$('cp-window-note').textContent=error.message;}
    $('cp-report-button').disabled=!result.ok;
    $('cp-thresholds').innerHTML=renderThresholds(result.ok?compareCathodeThresholds(input,e):{ok:false});
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
  $('cp-clear-request').addEventListener('click',()=>{for(const key of ['windowStart','windowEnd','destination','productSpecification'])$('cp-'+key).value='';update();});
  $('cp-clear').addEventListener('click',()=>{for(const [k,r]of Object.entries(SCREEN_INPUTS))if(!r.required)$('cp-'+k).value='';update();});
  $('cp-context-period')?.addEventListener('change',update);
  $('cp-report-button').addEventListener('click',async()=>{
    if(!result.ok)return;
    const requestedRevision=revision,requestedPeriod=$('cp-context-period')?.value;$('cp-report-button').disabled=true;
    try{
      const report=await makeCathodeDecision(input,e,descriptor,new Date().toISOString(),buyerRequest);
      const markdown=await cathodeDecisionMarkdown(report);
      if(!reviewDescriptor)throw new Error('Research review is missing from this snapshot. Reload to retry.');
      const review=await data(reviewDescriptor);
      if(statusError)throw new Error('Operating-status qualification could not be verified: '+statusError);
      const handoff=await makeCathodeResearchHandoff(report,review,reviewDescriptor,statusInput);
      const handoffMarkdown=await cathodeResearchHandoffMarkdown(handoff);
      const thresholdReport=await makeCathodeThresholdReport(handoff);
      const thresholdMarkdown=await cathodeThresholdMarkdown(thresholdReport);
      if(contextError)throw new Error('National context unavailable: '+contextError);
      const flowContext=await makeCathodeFlowContext(report,flowEvidence,flowDescriptor,circuitEvidence,circuitDescriptor,requestedPeriod,statusInput);
      const contextMarkdown=await cathodeFlowContextMarkdown(flowContext);
      if(requestedRevision!==revision)return;
      releaseDownloads();
      const raw=JSON.stringify(report,null,2);
      const jsonUrl=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
      const markdownUrl=URL.createObjectURL(new Blob([markdown],{type:'text/markdown;charset=utf-8'}));
      const handoffUrl=URL.createObjectURL(new Blob([JSON.stringify(handoff,null,2)],{type:'application/json'}));
      const handoffMarkdownUrl=URL.createObjectURL(new Blob([handoffMarkdown],{type:'text/markdown;charset=utf-8'}));
      const thresholdUrl=URL.createObjectURL(new Blob([JSON.stringify(thresholdReport,null,2)],{type:'application/json'}));
      const thresholdMarkdownUrl=URL.createObjectURL(new Blob([thresholdMarkdown],{type:'text/markdown;charset=utf-8'}));
      const contextUrl=URL.createObjectURL(new Blob([JSON.stringify(flowContext,null,2)],{type:'application/json'}));
      const contextMarkdownUrl=URL.createObjectURL(new Blob([contextMarkdown],{type:'text/markdown;charset=utf-8'}));
      urls.push(jsonUrl,markdownUrl,handoffUrl,handoffMarkdownUrl,thresholdUrl,thresholdMarkdownUrl,contextUrl,contextMarkdownUrl);
      const qualification=flowContext.facilityStatus;
      const statusHtml=qualification?`<section id="cp-status-context"><h3>ASARCO processing status: reports disagree for 2022</h3><p>${esc(qualification.decisionEffect)}</p>${qualification.evidence.claims.map(claim=>{const s=qualification.evidence.sources.find(x=>x.id===claim.sourceId);return `<p><strong>${esc(s.title)} · published ${esc(s.publicationDate)}</strong><br>${esc(claim.summary)} <a href="${esc(s.url)}#page=${s.pdfPage}" target="_blank" rel="noopener">Source · page ${s.pdfPage} ↗</a></p>`;}).join('')}<p>${esc(qualification.evidence.assessment.temporalLimit)}</p><p>${esc(qualification.evidence.assessment.quantityLimit)}</p><p><strong>Current operation and available supply: unknown.</strong> Both claims and the unresolved assessment are preserved in the account context and research handoff downloads.</p><p>Separate contextual review: ${esc(qualification.nextReview.action)}. ${esc(qualification.nextReview.acceptanceCriteria)}</p></section>`:'';
      const sourceLabels={historical_context_used:'Historical context only',links_only_reuse_restricted:'Links only · reuse restricted',document_review_pending:'Document review pending',source_unavailable_review_incomplete:'Source unavailable · review incomplete'};
      $('cp-report').innerHTML=`<h3>Decision brief</h3><div class="ev-note"><strong>Investigate before commitment.</strong> Verified deliverable supply remains unknown, including when the entered scenario reaches the target.</div>
        <p>Save a readable brief with the requirement, assumptions, historical facts, unresolved evidence checks and next investigations. The paired JSON retains exact values and the evidence fingerprint. Downloads stay in your browser; no scenario is sent to a server.</p>
        <div id="cp-buyer-summary"><h3>Buyer request</h3><p>${report.requirement.windowStart?esc(report.requirement.windowStart)+' through '+esc(report.requirement.windowEnd)+' · both inclusive':esc(String(report.requirement.horizonDays))+' relative days · dates unspecified'}</p><p>Requested destination: ${esc(report.requirement.destination??'Unspecified')}</p><p>Buyer product requirement: ${esc(report.requirement.productSpecification??'Unspecified')}</p><p class="ev-small">Buyer intent only. Actual product quality, route and delivery timing remain unverified.</p></div>
        <ul>${report.evidenceGates.map(g=>`<li><strong>Unverified:</strong> ${esc(g.requires)}</li>`).join('')}</ul>
        <div class="ev-links"><a href="${esc(markdownUrl)}" download="baryon-gunnison-decision.md">Download decision brief (.md)</a><a href="${esc(jsonUrl)}" download="baryon-gunnison-decision.json">Download exact scenario (.json)</a></div>
        ${jsonDetails('Exact scenario, evidence and reproducibility record',report)}
        <h3>One assumption at a time</h3><p>Save the required changes calculated above, with the exact assumptions, decision and research handoff. All evidence checks remain unresolved.</p>
        <div class="ev-links"><a href="${esc(thresholdMarkdownUrl)}" download="baryon-copper-thresholds.md">Download threshold comparison (.md)</a><a href="${esc(thresholdUrl)}" download="baryon-copper-thresholds.json">Download exact comparison (.json)</a></div>
        <section id="cp-flow-context" aria-label="Requirement and national copper accounts"><h2>The requirement and the national account</h2>
        <div class="ev-note"><strong>Context only; this requirement is not reconciled with the national account.</strong> Verified supply and the target's share of available supply remain unknown.</div>
        <p>Requirement: ${fmt(report.requirement.targetTonnes)} t cathode product over ${fmt(report.requirement.horizonDays)} ${report.requirement.windowStart?'calendar':'relative'} days. Account: United States, ${esc(flowContext.account.period.label)}, ${esc(flowContext.account.period.start)} through ${esc(flowContext.account.period.end)}; tonnes of copper.</p>
        <h3>Reconcile this national period only</h3><ul>${flowContext.account.components.map(t=>'<li>'+esc(t.label)+': '+fmt(t.value)+' t Cu; signed contribution '+(t.signedContribution>0?'+':'')+fmt(t.signedContribution)+' t Cu · '+(t.sourceEstimated?'Estimated':t.includesEstimates?'Includes estimates':'Reported')+'</li>').join('')}</ul>
        <p><strong>Reconstructed: ${fmt(flowContext.account.balance.reconstructed)} t Cu.</strong> Published apparent consumption: ${fmt(flowContext.account.balance.reported)} t Cu. Reconstructed minus published: ${fmt(flowContext.account.balance.roundingDifference)} t Cu. Rounded components and published totals are retained separately.</p>
        <p>Reported refined use: ${fmt(flowContext.account.reportedRefinedUse.value)} t Cu (${flowContext.account.reportedRefinedUse.sourceEstimated?'estimated':flowContext.account.reportedRefinedUse.includesEstimates?'includes estimates':'reported'}). The national balance ${flowContext.account.balance.containsEstimates?'includes estimates':'uses reported terms'}. Its coverage differs from apparent consumption; the difference is not unmet demand. Old-scrap recovery includes forms beyond refined cathodes. ${esc(flowContext.account.periodRule)}</p>
        <h3>What prevents a direct reconciliation?</h3><ul class="ev-investigations">${flowContext.compatibility.checks.map(v=>'<li data-context-check="'+esc(v.id)+'"><p><strong>Requirement:</strong> '+esc(v.requirement)+'</p><p><strong>Account/context:</strong> '+esc(v.context)+'</p><p><strong>Evidence needed:</strong> '+esc(v.needed)+'</p></li>').join('')}</ul>
        <p>Plant sales, capacity and scenario output are not added to national terms. No product-purity conversion, target-share ratio, current availability or demand forecast is inferred.</p>
        <div class="ev-links"><a href="${esc(flowEvidence.source.url)}#page=11" target="_blank" rel="noopener">USGS national balance · table 8 ↗</a><a href="${esc(circuitEvidence.source.url)}#page=97" target="_blank" rel="noopener">USGS processing groups · page 85 ↗</a><a href="#flows">Inspect all copper-flow accounts →</a></div><p class="ev-small">National account published ${esc(flowEvidence.source.publicationDate)}. Processing relationships are framed as of 2022. These source dates do not establish present conditions.</p>
        ${statusHtml}
        <div class="ev-links"><a href="${esc(contextMarkdownUrl)}" download="baryon-copper-flow-context.md">Download account context (.md)</a><a href="${esc(contextUrl)}" download="baryon-copper-flow-context.json">Download exact account context (.json)</a></div>
        ${jsonDetails('National account, incompatibilities and source bindings',flowContext)}</section>
        <section id="cp-handoff" aria-label="Copper evidence research handoff"><h2>From this scenario to evidence</h2>
        <p>Four checks still need evidence. These are proposed research tasks; no source has been acquired and no check has been satisfied by creating this handoff. Source statuses below were recorded in the ${esc(review.reviewedAt)} review.</p>
        <ol class="ev-investigations">${handoff.tasks.map(t=>`<li data-gate="${esc(t.id)}"><h3>${esc(t.title)}</h3><p><strong>Unresolved:</strong> ${esc(t.acceptanceCriteria)}</p><p>${esc(t.nextAction)}</p><p class="ev-small">${esc(t.sourceCoverage)}</p>
          ${t.sourceIds.map(id=>{const s=handoff.sources.find(s=>s.id===id);return `<p class="ev-small"><a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a> · <strong>${esc(sourceLabels[s.status])}</strong> · reviewed ${esc(s.reviewedAt)}${s.policy?` · <a href="${esc(s.policy.url)}" target="_blank" rel="noopener">Recorded reuse policy ↗</a>`:''}</p>`;}).join('')}
          <details><summary>Observation needed and possible decision effect</summary><p>${esc(t.proposedObservation)}</p><p>${esc(t.decisionEffect)}</p><p class="ev-small">Expected utility and cost: unknown. This order is a curated checklist.</p></details></li>`).join('')}</ol>
        <div class="ev-note">${esc(handoff.completionRule)}</div>
        <p>The soil and BC audits are consumed; the BC geological candidate did not pass its uncertainty gate. Copperwood cores remain selected known-deposit evidence. Research-policy improvement has not been demonstrated.</p>
        <div class="ev-links"><a href="${esc(handoffMarkdownUrl)}" download="baryon-copper-research-handoff.md">Download research handoff (.md)</a><a href="${esc(handoffUrl)}" download="baryon-copper-research-handoff.json">Download reproducible handoff (.json)</a><a href="#models">Inspect research outcomes →</a></div>
        ${jsonDetails('Research tasks, source bindings and consumed-audit safeguards',handoff)}</section>`;
      $('cp-report').hidden=false;preflightControl?.setHandoff(handoff);
    }catch(error){
      if(requestedRevision!==revision)return;
      releaseDownloads();$('cp-report').innerHTML=`<div role="alert" class="ev-error">Could not create the brief: ${esc(error.message)}</div>`;$('cp-report').hidden=false;
    }finally{if(requestedRevision===revision)$('cp-report-button').disabled=!result.ok;}
  });
  update();
  preflightControl=mountOperatingPreflight($('cp-operating-preflight'));
}
