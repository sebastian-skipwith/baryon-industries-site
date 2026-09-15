import * as maplibregl from '/maplibre/maplibre-gl.mjs';
maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (value, digits=2) => value === null || value === undefined ? 'Unknown' : Number(value).toLocaleString('en-US',{maximumFractionDigits:digits});
const day = value => value ? String(value).slice(0,10) : 'Unknown';
const quality = flags => flags.length ? flags.map(v=>v.replaceAll('_',' ')).join('; ') : 'No conflict detected by importer';
const jsonDetails = (title, object) => `<details><summary>${escape(title)}</summary><pre class="ev-json">${escape(JSON.stringify(object,null,2))}</pre></details>`;
const metric = (value,label) => `<div class="ev-metric"><strong>${escape(value)}</strong><span>${escape(label)}</span></div>`;
const heading = (kicker,title,description,badge='Observed evidence') => `<div class="ev-heading"><div><div class="ev-kicker">${kicker}</div><h1>${title}</h1><p>${description}</p></div><span class="ev-badge">${badge}</span></div>`;
const assay = a => !a ? 'Not analyzed' : a.qualifier === 'exact' ? `${fmt(a.value)} mg/kg` : a.bound !== null ? `${a.qualifier === 'less_equal' ? '≤' : '<'}${fmt(a.bound)} mg/kg` : a.qualifier.replaceAll('_',' ');
const cache = new Map();
async function data(descriptor) {
  const file = typeof descriptor === 'string' ? descriptor : descriptor.file;
  if (!cache.has(file)) cache.set(file, (async()=>{
    const response = await fetch(`/data/evidence/${file}`, {cache: file === 'manifest.json' ? 'no-cache' : 'default'});
    if (!response.ok) throw new Error(`Could not load evidence (${response.status}).`);
    const buffer = await response.arrayBuffer();
    if (descriptor.sha256) {
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if (digest !== descriptor.sha256) throw new Error('Evidence integrity check failed. Reload to retry.');
    }
    return JSON.parse(new TextDecoder().decode(buffer));
  })().catch(error=>{cache.delete(file);throw error;}));
  return cache.get(file);
}
let manifest, soilMap, soilRows=[], soilRequest=0, coreRequest=0;
const initialized = new Set();
const footer = () => `<div class="ev-footer">Public evidence snapshot · ${escape(day(manifest.generatedAt))} UTC · source publication and collection dates shown separately. <a href="/data/evidence/manifest.json">Dataset manifest &amp; checksums</a></div>`;
function fail(target,error) { target.innerHTML=`<div class="ev-error" role="alert">${escape(error.message)} <button class="ev-button" onclick="location.reload()">Reload evidence</button></div>`; }
async function selectView() {
  const requested=location.hash.slice(1).split('?')[0];
  const view=['soil','cores','models','trade'].includes(requested)?requested:'world';
  document.querySelectorAll('[data-ri-view]').forEach(node=>{node.hidden=node.dataset.riView!==view;});
  document.querySelectorAll('.ri-nav a').forEach(node=>{if(node.hash===`#${view}`)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});
  window.dispatchEvent(new CustomEvent('baryon:view',{detail:view}));
  if(view==='world'){window.dispatchEvent(new Event('resize'));return;}
  if(initialized.has(view)){if(view==='soil')soilMap?.resize();return;}
  initialized.add(view);
  const target=$(`view-${view}`);
  target.innerHTML='<div class="ev-container" role="status">Loading verified evidence…</div>';
  try {
    manifest=await data('manifest.json');
    target.innerHTML='<div class="ev-container"></div>';
    const container=target.firstElementChild;
    await ({soil:renderSoil,cores:renderCores,models:renderModels,trade:renderTrade}[view])(container);
  }catch(error){initialized.delete(view);fail(target,error);}
}
window.addEventListener('hashchange',selectView);
selectView();

async function renderSoil(container) {
  const s=manifest.soil, summary=s.summary;
  container.innerHTML=heading('Earth model / United States','From samples to an Earth model','Explore measured soil chemistry at three reported horizons. Each point retains its source, collection date, depth and assay qualifiers. Unmeasured regions and deeper geology remain unknown.')+
    `<div class="ev-metrics">${metric(fmt(summary.sites),'sample sites')}${metric(fmt(summary.samples),'horizon records')}${metric(fmt(summary.cells),'1° cells with samples')}${metric(fmt(summary.flaggedDepthSamples),'depth warnings')}</div>
    <div class="ev-card"><div class="ev-toolbar"><label>Soil layer <select id="ev-horizon"><option value="top5cm">Surface · 0–5 cm</option><option value="ahorizon">A horizon · reported depth</option><option value="chorizon">C horizon · reported depth</option></select></label><span class="ev-legend">Copper mg/kg · 0 <i class="ev-gradient"></i> 100+</span></div>
    <div id="ev-soil-map" class="ev-map" aria-label="Map of measured USGS soil copper"></div><div class="ev-caption" id="ev-soil-status" role="status">Loading sample layer…</div></div>
    <div class="ev-card"><div class="ev-toolbar"><h2>Sample evidence</h2><input id="ev-soil-search" aria-label="Search soil samples" placeholder="Site ID or state code, e.g. UT"></div><div class="ev-table-wrap" id="ev-soil-table"></div><div class="ev-caption" id="ev-soil-count"></div><div class="ev-card-body" id="ev-soil-detail">Select a sample to inspect all five elements, location and depth qualifiers.</div></div>
    <div class="ev-split"><div class="ev-card ev-card-body"><h2>Coverage is point evidence</h2><p>One-degree cells are an angular index, not equal-area coverage. A sample does not establish the composition of a whole cell or a subsurface volume. ${fmt(summary.unknownDepthSamples)} records have unknown or unusable intervals; overlapping A/C horizons and conflicting depths retain warnings.</p><div class="ev-note">Measured soil chemistry does not establish ore, reserves, recoverability or deep mineralization.</div><a href="#models">View the frozen soil-model evaluation →</a></div>
    <div class="ev-card ev-card-body"><h2>USGS Data Series 801</h2><p>Published ${escape(s.source.publicationDate)} · acquired ${day(s.source.acquiredAt)} UTC.</p><p>${escape(s.source.method)}</p><p class="ev-small">${escape(s.source.useConstraints)}</p><div class="ev-links"><a href="${escape(s.source.url)}" target="_blank" rel="noopener">Source report ↗</a><a href="${escape(s.source.metadataUrl)}" target="_blank" rel="noopener">Source metadata ↗</a><a id="ev-soil-download" download>Download this horizon</a></div>${jsonDetails('Source provenance and hashes',s.source)}</div></div>${footer()}`;
  soilMap=new maplibregl.Map({container:'ev-soil-map',center:[-98,38],zoom:3,style:{version:8,projection:{type:'globe'},sources:{imagery:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics'}},layers:[{id:'background',type:'background',paint:{'background-color':'#102022'}},{id:'imagery',type:'raster',source:'imagery',paint:{'raster-opacity':.65}}]}});
  soilMap.addControl(new maplibregl.NavigationControl(),'top-right');
  soilMap.on('load',()=>{
    soilMap.addSource('soil',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    soilMap.addLayer({id:'soil',type:'circle',source:'soil',paint:{'circle-radius':['interpolate',['linear'],['zoom'],2,2,7,5],'circle-color':['interpolate',['linear'],['get','cu'],0,'#b5def8',10,'#44b9ba',25,'#ead786',50,'#f28a48',100,'#e45b45'],'circle-stroke-width':.4,'circle-stroke-color':'#082d25'}});
    soilMap.on('click','soil',event=>{const row=soilRows.find(r=>r.id===event.features?.[0]?.properties?.id);if(row)showSoil(row,true);});
    soilMap.on('mouseenter','soil',()=>{soilMap.getCanvas().style.cursor='pointer';});
    soilMap.on('mouseleave','soil',()=>{soilMap.getCanvas().style.cursor='';});
    updateSoilMap();
  });
  $('ev-horizon').addEventListener('change',loadSoil);
  $('ev-soil-search').addEventListener('input',soilTable);
  $('ev-soil-table').addEventListener('click',event=>{const id=event.target.closest('[data-soil]')?.dataset.soil;if(id){const row=soilRows.find(r=>r.id===id);if(row)showSoil(row,true);}});
  await loadSoil();
}
async function loadSoil() {
  const request=++soilRequest, horizon=$('ev-horizon').value;
  $('ev-soil-status').textContent='Loading sample layer…';
  try {
    const rows=await data(manifest.soil.layers[horizon]);
    if(request!==soilRequest)return;
    soilRows=rows;
    document.querySelectorAll('#ev-soil-map .maplibregl-popup').forEach(n=>n.remove());
    $('ev-soil-detail').textContent='Select a sample to inspect all five elements, location and depth qualifiers.';
    $('ev-soil-download').href=`/data/evidence/${manifest.soil.layers[horizon].file}`;
    soilTable();updateSoilMap();
  }catch(error){if(request===soilRequest){soilRows=[];updateSoilMap();$('ev-soil-status').textContent=error.message;fail($('ev-soil-table'),error);}}
}
function updateSoilMap() {
  const rows=soilRows.filter(r=>r.assays.cu.qualifier==='exact' && r.depth.topM!==null && r.depth.bottomM!==null);
  soilMap?.getSource('soil')?.setData({type:'FeatureCollection',features:rows.map(r=>({type:'Feature',geometry:{type:'Point',coordinates:[r.longitude,r.latitude]},properties:{id:r.id,cu:r.assays.cu.value}}))});
  $('ev-soil-status').textContent=`${fmt(rows.length)} copper measurements with usable depths · ${fmt(soilRows.length)} records in this horizon. Click a point to inspect it. Colors show observations; blank regions remain unknown.`;
}
function soilTable() {
  const query=$('ev-soil-search').value.trim().toLowerCase();
  const rows=soilRows.filter(r=>!query || r.siteId.toLowerCase().includes(query) || r.state.toLowerCase()===query);
  $('ev-soil-table').innerHTML=`<table class="ev-table"><thead><tr><th>Site / collected</th><th>Reported depth</th><th>Cu</th><th>Ni</th><th>Zn</th><th>Evidence</th></tr></thead><tbody>${rows.slice(0,50).map(r=>`<tr><td>${escape(r.siteId)} · ${escape(r.state)}<small>${day(r.observedOn)}</small></td><td>${escape(r.depth.raw||'Unknown')} cm<small>${r.depth.flags.length?'Depth warning':''}</small></td><td>${assay(r.assays.cu)}</td><td>${assay(r.assays.ni)}</td><td>${assay(r.assays.zn)}</td><td><button data-soil="${escape(r.id)}">Inspect sample</button></td></tr>`).join('')}</tbody></table>`;
  $('ev-soil-count').textContent=`Showing ${Math.min(50,rows.length)} of ${fmt(rows.length)} matching records. Search to narrow the table; the horizon download contains every record, including missing and censored values.`;
}
function showSoil(row,fly) {
  $('ev-soil-detail').innerHTML=`<h2>Site ${escape(row.siteId)} · ${escape(row.state)}</h2><p>${Object.entries(row.assays).map(([key,a])=>`${key.toUpperCase()}: ${assay(a)}`).join(' · ')}</p><p>WGS84 ${row.latitude}, ${row.longitude} · collected ${day(row.observedOn)} · source depth ${escape(row.depth.raw)} cm.</p><p>${escape(quality(row.depth.flags))}</p>${jsonDetails('Complete normalized sample',row)}`;
  if(fly){
    soilMap.flyTo({center:[row.longitude,row.latitude],zoom:Math.max(soilMap.getZoom(),5),essential:false});
    const popup=document.createElement('div');popup.className='ev-popup';popup.textContent=`USGS site ${row.siteId} · ${row.state}\nCopper: ${assay(row.assays.cu)}\nReported depth: ${row.depth.raw || 'Unknown'} cm\nCollected: ${day(row.observedOn)}\n${quality(row.depth.flags)}\nSoil evidence; no ore or reserve inference.`;
    new maplibregl.Popup().setLngLat([row.longitude,row.latitude]).setDOMContent(popup).addTo(soilMap);
  }
}

async function renderCores(container) {
  const c=manifest.core,s=c.summary;
  container.innerHTML=heading('Earth model / Copperwood, Michigan','Inside the drill-core record','Inspect source-reported intervals and method-specific copper assays from the Western Syncline. These are selected samples from a known deposit; borehole trajectories and true vertical depths are unavailable.')+
    `<div class="ev-metrics">${metric(fmt(s.records),'core records')}${metric(fmt(s.drillHoles),'drill holes')}${metric(fmt(s.deepestReportedM,1)+' m','deepest reported endpoint')}${metric(fmt(s.flaggedRecords),'records with warnings')}</div>
    <div class="ev-card"><div class="ev-toolbar"><label>Drill hole <select id="ev-hole">${c.holes.map(h=>`<option value="${escape(h.id)}">${escape(h.id)} · ${h.records} records</option>`).join('')}</select></label><a id="ev-core-download" download>Download selected hole</a></div><div id="ev-core-content" class="ev-card-body" role="status">Loading drill hole…</div></div>
    <div class="ev-split"><div class="ev-card ev-card-body"><h2>Depth and assay interpretation</h2><p>${escape(c.source.depthInterpretation)} Empty chart intervals have no plotted measurement. Censored and missing assays remain in the evidence table. Cu methods are kept separate.</p><div class="ev-note">No 3D borehole reconstruction, true ore thickness or current reserve estimate is inferred. These records have not been used to claim a model-performance improvement.</div><p>${escape(c.source.positionalAccuracy)}</p></div>
    <div class="ev-card ev-card-body"><h2>USGS Copperwood data release</h2><p>Published ${c.source.publicationDate} · acquired ${day(c.source.acquiredAt)} UTC. ${escape(c.source.license)}</p><div class="ev-links"><a href="${escape(c.source.url)}" target="_blank" rel="noopener">Source release &amp; files ↗</a></div>${jsonDetails('Methods, laboratories and detection limits',c.methods)}${jsonDetails('Source provenance and hashes',c.source)}</div></div>${footer()}`;
  $('ev-hole').addEventListener('change',loadCore);
  await loadCore();
}
async function loadCore() {
  const request=++coreRequest, hole=manifest.core.holes.find(h=>h.id===$('ev-hole').value), target=$('ev-core-content');
  target.textContent='Loading drill hole…';
  $('ev-core-download').removeAttribute('href');
  try {
    const rows=await data(hole);if(request!==coreRequest)return;
    $('ev-core-download').href=`/data/evidence/${hole.file}`;
    target.innerHTML=`<h2>Drill hole ${escape(hole.id)}</h2><p>${hole.records} records · ${hole.flaggedRecords} flagged · ${escape(hole.coordinateStatus)}.</p><p class="ev-small"><span class="ev-teal">● Cu: four-acid OES</span> &nbsp; <span class="ev-amber">● Cu: sinter AES</span> · mg/kg on a log1p horizontal scale. Vertical axis is reported interval depth in metres, not established as true vertical.</p>${profile(rows,hole)}<div class="ev-table-wrap"><table class="ev-table"><thead><tr><th>Sample / collected</th><th>Source depth → metres</th><th>Cu · four-acid OES</th><th>Cu · sinter AES</th><th>Geology / quality</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escape(r.sampleId)}<small>${day(r.collectedOn)}</small>${jsonDetails('All assays & metadata',r)}</td><td>${escape(r.depth.raw)}<small>${r.depth.fromM===null?'Interval unusable':`${fmt(r.depth.fromM,3)}–${fmt(r.depth.toM,3)} m`}</small></td><td>${assay(r.assays.find(a=>a.sourceField==='Cu_pct_OES_HF'))}</td><td>${assay(r.assays.find(a=>a.sourceField==='Cu_ppm_AES_ST'))}</td><td>${escape(r.lithology||'Unknown lithology')}<small>${escape(r.stratigraphy||'Unknown stratigraphy')}</small><small>${escape(quality([...r.flags,...r.depth.flags]))}</small></td></tr>`).join('')}</tbody></table></div>`;
  }catch(error){if(request===coreRequest)fail(target,error);}
}
function profile(rows,hole) {
  const points=rows.flatMap(r=>r.depth.fromM===null?[]:r.assays.filter(a=>a.sourceField.startsWith('Cu_')&&a.qualifier==='exact'&&a.value!==null).map(a=>({r,a})));
  if(!points.length)return '<div class="ev-note">No exact copper assays with usable intervals in this hole.</div>';
  const width=850,left=75,right=810,top=36,bottom=400,max=Math.max(100,...points.map(p=>p.a.value)),from=hole.fromM,to=hole.toM;
  const x=value=>left+Math.log1p(value)/Math.log1p(max)*(right-left),y=value=>top+(value-from)/(to-from||1)*(bottom-top);
  return `<svg class="ev-profile" viewBox="0 0 ${width} 450" role="img" aria-label="Copper assays by source-reported depth for ${escape(hole.id)}"><title>Reported depth intervals; gaps unmeasured; trajectory unknown</title>${[0,.25,.5,.75,1].map(t=>`<line x1="${left}" x2="${right}" y1="${top+t*(bottom-top)}" y2="${top+t*(bottom-top)}" stroke="#e6eae5"/><text x="${left-12}" y="${top+t*(bottom-top)+4}" text-anchor="end">${fmt(from+t*(to-from),1)} m</text>`).join('')}${[0,10,100,1000,10000,100000].filter(n=>n<=max).map(n=>`<line x1="${x(n)}" x2="${x(n)}" y1="${top}" y2="${bottom}" stroke="#f0f2ee"/><text x="${x(n)}" y="425" text-anchor="middle">${fmt(n)}</text>`).join('')}${points.map(({r,a})=>`<line x1="${x(a.value)}" x2="${x(a.value)}" y1="${y(r.depth.fromM)}" y2="${y(r.depth.toM)}" stroke="${a.sourceField==='Cu_pct_OES_HF'?'#17877e':'#b47418'}" stroke-width="5" opacity=".8"><title>${escape(r.sampleId)}: ${assay(a)}, ${fmt(r.depth.fromM,3)}–${fmt(r.depth.toM,3)} m; ${escape(a.sourceField)}</title></line>`).join('')}<text x="${left}" y="18">Reported depth (m)</text><text x="${right}" y="448" text-anchor="end">Copper (mg/kg) · log1p scale</text></svg>`;
}

async function renderModels(container) {
  const experiment=await data(manifest.experiment),r=experiment.result,p=experiment.plan,selected=r.validation.candidates.find(c=>c.candidate.id===r.selected.id);
  container.innerHTML=heading('Research / frozen evaluation','Measure improvement, preserve the test','One completed experiment tests regional interpolation of historical 0–5 cm soil copper. Its saved audit is shown here without rerunning or retuning it.','Limited research result')+
    `<div class="ev-metrics">${metric(fmt(r.audit.relativeRmseGain*100,2)+'%','audit RMSE reduction')}${metric(fmt(r.audit.candidate.n),'audit sites')}${metric(fmt(r.audit.candidate.blocks),'audit blocks')}${metric('1','completed experiment')}</div>
    <div class="ev-split"><div class="ev-card ev-card-body"><h2>Audit error · lower is better</h2><p>RMSE on log1p(copper mg/kg), compared with the training mean.</p><div class="ev-score"><span>Training mean</span><i style="width:55%"></i><b>${fmt(r.audit.baseline.rmseLog1p,4)}</b></div><div class="ev-score"><span>Selected IDW</span><i class="candidate" style="width:${55*r.audit.candidate.rmseLog1p/r.audit.baseline.rmseLog1p}%"></i><b>${fmt(r.audit.candidate.rmseLog1p,4)}</b></div><p>95% paired block-bootstrap interval for aggregate RMSE improvement: <b>${r.audit.blockBootstrapGain95.map(n=>fmt(n*100,2)+'%').join('–')}</b>.</p><div class="ev-note">${escape(r.scope)} Nine audit blocks provide limited evidence. This interval is not calibrated uncertainty for a location.</div></div>
    <div class="ev-card ev-card-body"><h2>Frozen before scoring</h2><p>${escape(p.split)}</p><p>Training: ${fmt(r.trainingSamples)} sites / ${r.trainingBlocks} blocks. Validation: ${fmt(r.validation.baseline.n)} sites / ${r.validation.baseline.blocks} blocks. Baseline: training mean. Validation selected ${r.selected.neighbors}-neighbor inverse-square distance weighting.</p><p>Gate: ≥${p.gate.minimumSamples} sites and ≥${p.gate.minimumBlocks} blocks in each holdout, ≥${p.gate.minimumRelativeRmseGain*100}% RMSE improvement on both and a positive bootstrap lower bound.</p><div class="ev-note">Promoted for regional research. The audit is consumed; future selection requires independent evaluation.</div></div></div>
    <div class="ev-card"><div class="ev-card-body"><h2>Measured scores</h2></div><div class="ev-table-wrap"><table class="ev-table"><thead><tr><th>Evaluation</th><th>Baseline RMSE</th><th>Candidate RMSE</th><th>Sites / blocks</th></tr></thead><tbody><tr><td>Validation · selected k=${r.selected.neighbors}</td><td>${fmt(r.validation.baseline.rmseLog1p,6)}</td><td>${fmt(selected.metrics.rmseLog1p,6)}</td><td>${r.validation.baseline.n} / ${r.validation.baseline.blocks}</td></tr><tr><td>One-use audit</td><td>${fmt(r.audit.baseline.rmseLog1p,6)}</td><td>${fmt(r.audit.candidate.rmseLog1p,6)}</td><td>${r.audit.candidate.n} / ${r.audit.candidate.blocks}</td></tr></tbody></table></div></div>
    <div class="ev-card ev-card-body"><h2>What this result establishes</h2><ul>${r.limitations.map(l=>`<li>${escape(l)}</li>`).join('')}</ul><div class="ev-links"><a href="/data/evidence/${manifest.experiment.file}" download>Download result &amp; plan summary</a><a href="#soil">Inspect the source observations</a></div>${jsonDetails('Candidate validation scores and provenance',experiment)}</div>
    <div class="ev-card ev-card-body"><h2>Research system in development</h2><p>Evidence ingestion and this bounded model-selection experiment are implemented. A general preregistered research registry, an evaluated acquisition policy, independent depth-model validation and integration with production constraints remain unfinished. New data counts and repeated downloads do not establish recursive improvement.</p></div>${footer()}`;
}
async function renderTrade(container) {
  const t=manifest.trade;
  container.innerHTML=heading('Physical economy / trade evidence','Connect materials to their movement','The existing world model maps sourced facilities, product chains and trade corridors. A monthly copper-trade evidence importer now runs locally; its public data release is pending redistribution rights.','Source access')+
    `<div class="ev-split"><div class="ev-card ev-card-body"><h2>Monthly copper corridor</h2><p>The initial query covers Chile–China copper ores and concentrates, refined cathodes, and waste and scrap. The local ledger retains the query scope, period, retrieval time, source-response hash, missing quantities and estimation flags.</p><div class="ev-note">${escape(t.note)}</div><div class="ev-links"><a href="${t.sourceUrl}" target="_blank" rel="noopener">Explore UN Comtrade ↗</a><a href="${t.policyUrl}" target="_blank" rel="noopener">Publication policy ↗</a></div></div>
    <div class="ev-card ev-card-body"><h2>From trade to usable supply</h2><p>Trade records describe reported goods, not live shipments, production, capacity or demand. Ore weight includes non-metal material. Imports and mirror exports cannot be added together.</p><p>Connecting geology to additional supply still requires processing routes, recovery, infrastructure, timing and independently sourced production constraints. Missing rows are not zero.</p><div class="ev-links"><a href="#world">Explore the world model →</a><a href="#models">Inspect evaluated model results →</a></div></div></div>${footer()}`;
}
