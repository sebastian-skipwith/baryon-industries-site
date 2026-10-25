import {planSpatialSupport,formatProbability} from './spatial-support.mjs?v=20261025p';

export function spatialSupportPanel() {
  return `<section class="ev-card ev-card-body" id="ev-spatial-planning" aria-labelledby="ev-planning-title">
    <div class="ev-kicker">Future research / planning assumption</div>
    <h2 id="ev-planning-title">Plan a future geographic test</h2>
    <p>Enough samples can still leave too few geographic groups in a holdout. Explore the probability of meeting group minima before buffers, assuming independent 60/20/20 group allocation.</p>
    <div class="ev-note">Use before a new cohort and protocol are committed. This calculator cannot rescue Tellus or change an existing seed, split, threshold or consumed audit.</div>
    <form id="ev-planning-form" class="ev-toolbar">
      <label for="ev-planning-groups">Available geographic groups <input id="ev-planning-groups" type="number" min="0" max="1000" step="1" value="60" required style="width:7em"></label>
      <label for="ev-planning-minimum">Minimum groups per partition <input id="ev-planning-minimum" type="number" min="0" max="64" step="1" value="8" required style="width:7em"></label>
      <button type="submit" class="ev-button">Calculate planning probability</button>
    </form>
    <p class="ev-small">Initial values are an illustrative scenario, not observed source coverage or a recommended threshold. Allocation stays at 60% training, 20% validation and 20% audit.</p>
    <div id="ev-planning-result" role="status" aria-live="polite"></div>
    <div id="ev-planning-detail"></div>
    <details><summary>Assumptions and how to use this result</summary>
      <p>Expected counts are averages, not guarantees. The three counts sum to the available groups, so their marginal probabilities cannot be multiplied. This calculator uses exact multinomial accounting; displayed percentages are rounded.</p>
      <p>Buffering can only remove memberships. Pre-buffer success is therefore an upper bound under this allocation model. Sample minima, buffer losses, QA lineage, source permissions, spatial dependence and statistical power remain unchecked.</p>
      <p>A grid does not establish independent geological support. A committed deterministic split already has fixed counts; this is not a new probability for that split. No source data, predictions, audit or learned research policy is used.</p>
    </details>
  </section>`;
}

export function activateSpatialSupport(container) {
  const form=container.querySelector('#ev-planning-form');
  const result=container.querySelector('#ev-planning-result');
  const detail=container.querySelector('#ev-planning-detail');
  const groups=container.querySelector('#ev-planning-groups');
  const minimum=container.querySelector('#ev-planning-minimum');
  const clear=()=>{result.textContent='Inputs changed. Calculate again to update the planning result.';detail.replaceChildren();};
  groups.addEventListener('input',clear);minimum.addEventListener('input',clear);
  const calculate=()=>{
    detail.replaceChildren();
    try {
      const m=minimum.valueAsNumber;
      const report=planSpatialSupport({groups:groups.valueAsNumber,minimums:[m,m,m],weights:[3,1,1]});
      result.textContent=`Before buffers: ${formatProbability(report.allMinimumsBeforeBuffers)} probability of all three partitions meeting the group minimum; ${formatProbability(report.anyMinimumMissedBeforeBuffers)} probability that at least one misses it. This is a planning estimate, not a scientific result.`;
      const table=document.createElement('div');table.className='ev-table-wrap';
      // Every interpolated value below is an enum or a validated numeric calculation.
      table.innerHTML=`<table class="ev-table"><thead><tr><th>Partition</th><th>Expected groups</th><th>Required groups</th><th>Probability below minimum</th></tr></thead><tbody>${report.partitions.map(p=>`<tr><td>${p.name}</td><td>${p.expectedGroups.toLocaleString('en-US',{maximumFractionDigits:2})}</td><td>${p.minimumGroups}</td><td>${formatProbability(p.belowMinimumBeforeBuffers)}</td></tr>`).join('')}</tbody></table>`;
      const disclosure=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');
      summary.textContent='Inspect planning inputs and exact probability ratios';pre.className='ev-json';pre.tabIndex=0;pre.textContent=JSON.stringify(report,null,2);
      disclosure.append(summary,pre);detail.append(table,disclosure);
    } catch(error) {result.textContent=`No planning result: ${error.message}`;}
  };
  form.addEventListener('submit',event=>{event.preventDefault();calculate();});
  calculate();
}
