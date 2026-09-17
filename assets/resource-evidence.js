import {renderFlows} from '/assets/copper-flows-view.mjs?v=20260917a';
import * as maplibregl from '/maplibre/maplibre-gl.mjs';
import { wrapLongitude, gridNode, latitudeRows, latitudeProfile } from '/assets/slab2-profile.mjs?v=20260915f';
import { renderBedrock, activateBedrock } from '/assets/bedrock-view.mjs?v=20260916a';
import { calculateCopperSupply, scenarioPreset, nextSupplyInvestigations, INPUTS } from '/assets/copper-balance.mjs?v=20260915d';
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
  const view=['soil','cores','models','trade','supply','structure','bedrock','flows'].includes(requested)?requested:'world';
  document.querySelectorAll('[data-ri-view]').forEach(node=>{node.hidden=node.dataset.riView!==view;});
  document.querySelectorAll('.ri-nav a').forEach(node=>{if(node.hash===`#${view}`)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});
  window.dispatchEvent(new CustomEvent('baryon:view',{detail:view}));
  if(view==='world'){window.dispatchEvent(new Event('resize'));return;}
  if(initialized.has(view)){if(view==='soil')soilMap?.resize();if(view==='structure')structureMap?.resize();if(view==='bedrock')activateBedrock();return;}
  initialized.add(view);
  const target=$(`view-${view}`);
  target.innerHTML='<div class="ev-container" role="status">Loading verified evidence…</div>';
  try {
    manifest=await data('manifest.json');
    target.innerHTML='<div class="ev-container"></div>';
    const container=target.firstElementChild;
    await ({flows:c=>renderFlows(c,{descriptor:manifest.flows,data,helpers:{heading,fmt,escape,jsonDetails,footer}}),soil:renderSoil,cores:renderCores,models:renderModels,trade:renderTrade,supply:renderSupply,structure:renderStructure,bedrock:c=>renderBedrock(c,{model:manifest.bedrock,data,helpers:{heading,metric,fmt,escape,jsonDetails,footer}})}[view])(container);
  }catch(error){initialized.delete(view);fail(target,error);}
}
window.addEventListener('hashchange',selectView);
selectView();

let structureMap, structureRegion, structureRequest=0, structurePoints=[];
async function renderStructure(container) {
  const s=manifest.structure;
  if(!s)throw new Error('Earth structure is not available in this evidence snapshot.');
  container.innerHTML=heading('Earth model / deep geological context','Inside the subduction zones','Explore the USGS Slab2 geometry model across 27 regions. Choose a region and latitude to inspect modeled depth, source uncertainty and overlapping slab branches.','External model · 2018')+
    `<div class="ev-metrics">${metric(fmt(s.summary.regions),'model regions')}${metric(fmt(s.summary.nativeGridNodes),'native grid nodes')}${metric(fmt(s.summary.supplementaryNodes),'overlapping branch nodes')}${metric(fmt(s.summary.depthRangeKm[1],1)+' km','deepest modeled node')}</div>
    <div class="ev-card"><div class="ev-toolbar"><label>Slab region <select id="ev-structure-region" disabled>${s.regions.map(r=>`<option value="${r.code}" ${r.code==='cas'?'selected':''}>${escape(r.name)}</option>`).join('')}</select></label><button class="ev-button" id="ev-structure-global" disabled>Global view</button><span class="ev-legend">Depth km · 0 <i class="ev-gradient"></i> 700</span></div>
    <div id="ev-structure-map" class="ev-map" aria-label="USGS slab geometry map"></div><div class="ev-caption" id="ev-structure-map-status" role="status">Loading global model preview…</div></div>
    <div class="ev-note">This is a published geophysical model, not measured mineral composition or a new Baryon prediction. Regions outside the model remain unknown. Ingesting it does not establish improved discovery accuracy.</div>
    <div id="ev-structure-region-body" aria-live="polite"></div>
    <div class="ev-split"><div class="ev-card ev-card-body"><h2>What this layer adds</h2><p>Deep structural context for the Earth model. Soil samples, drill-core assays and slab geometry represent different physical quantities and depth scales; their proximity alone does not establish mineralization.</p><p>${escape(s.scope)}</p><div class="ev-links"><a href="#soil">Measured soil chemistry</a><a href="#cores">Reported drill-core intervals</a><a href="#models">Research and evaluation</a></div></div>
    <div class="ev-card ev-card-body"><h2>USGS Slab2 · March 2018 release</h2><p>Gavin Hayes / U.S. Geological Survey. ${escape(s.source.license)}. Acquired ${day(s.source.acquiredAt)} UTC; acquisition is not a model update.</p><p>${escape(s.source.updateFrequency)}. Horizontal and vertical datums are not named in the supplied grid metadata.</p><div class="ev-links"><a href="${escape(s.source.productUrl)}" target="_blank" rel="noopener">USGS product ↗</a><a href="${escape(s.source.url)}" target="_blank" rel="noopener">Data release ↗</a><a href="${escape(s.source.paperUrl)}" target="_blank" rel="noopener">Model paper ↗</a></div>${jsonDetails('Source dates, conventions, warnings and fingerprints',s.source)}</div></div>${footer()}`;
  const overview=await data(s.overview);
  structureMap=new maplibregl.Map({container:'ev-structure-map',center:[-155,12],zoom:1.3,style:{version:8,projection:{type:'globe'},sources:{imagery:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics'}},layers:[{id:'background',type:'background',paint:{'background-color':'#102022'}},{id:'imagery',type:'raster',source:'imagery',paint:{'raster-opacity':.6}}]}});
  structureMap.addControl(new maplibregl.NavigationControl(),'top-right');
  structureMap.on('load',()=>{
    structureMap.addSource('slabs',{type:'geojson',data:{type:'FeatureCollection',features:overview.map(([region,lon,lat,depth,index,kind])=>({type:'Feature',geometry:{type:'Point',coordinates:[wrapLongitude(lon),lat]},properties:{region,depth,index,kind}}))}});
    structureMap.addLayer({id:'slabs',type:'circle',source:'slabs',paint:{'circle-radius':['interpolate',['linear'],['zoom'],1,1.7,6,4],'circle-color':['interpolate',['linear'],['get','depth'],0,'#b5def8',100,'#44b9ba',300,'#ead786',500,'#f28a48',700,'#e45b45'],'circle-opacity':.8,'circle-stroke-width':['case',['==',['get','kind'],1],1,0],'circle-stroke-color':'#fff'}});
    structureMap.addSource('slab-profile',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    structureMap.addLayer({id:'slab-profile',type:'circle',source:'slab-profile',paint:{'circle-radius':5,'circle-color':'#fff','circle-stroke-width':1.5,'circle-stroke-color':'#172e28','circle-opacity':.8}});
    structureMap.on('click','slabs',event=>{const p=event.features?.[0]?.properties;if(p){$('ev-structure-region').value=p.region;loadStructureRegion(p.region,false,{kind:Number(p.kind),index:Number(p.index)});}});
    structureMap.on('mouseenter','slabs',()=>{structureMap.getCanvas().style.cursor='pointer';});
    structureMap.on('mouseleave','slabs',()=>{structureMap.getCanvas().style.cursor='';});
    $('ev-structure-map-status').textContent=`${fmt(s.summary.displayGridNodes)} sampled grid points + ${fmt(overview.length-s.summary.displayGridNodes)} branch preview points. Color = modeled depth; white outline = supplementary branch. Click a point or choose a region. Missing cells stay absent.`;
    if(structureRegion)updateStructureProfile();
  });
  $('ev-structure-global').onclick=()=>structureMap.flyTo({center:[-155,12],zoom:1.3});
  $('ev-structure-region').onchange=()=>loadStructureRegion($('ev-structure-region').value,true);
  await loadStructureRegion('cas',false);
  $('ev-structure-region').disabled=false;
  $('ev-structure-global').disabled=false;
}
async function loadStructureRegion(code,fly,selection) {
  const request=++structureRequest, target=$('ev-structure-region-body');
  structureRegion=null;
  target.innerHTML='<p role="status">Loading verified regional model…</p>';
  structureMap.getSource('slab-profile')?.setData({type:'FeatureCollection',features:[]});
  try {
    const descriptor=manifest.structure.regions.find(r=>r.code===code), region=await data(descriptor);
    if(request!==structureRequest)return;
    const rows=latitudeRows(region);
    if(!rows.length)throw new Error('No sampled latitude rows in this region.');
    structureRegion=region;
    let chosen=rows[Math.floor(rows.length/2)].row, selectedNode;
    if(selection?.kind===0){selectedNode=gridNode(region,region.nodes[selection.index]);chosen=selectedNode.row;}
    if(selection?.kind===1){const p=region.supplement[selection.index];chosen=rows.reduce((a,b)=>Math.abs(a.latitude-p[1])<Math.abs(b.latitude-p[1])?a:b).row;selectedNode={kind:'supplementary_node',sourceLongitude:p[0],longitude:wrapLongitude(p[0]),latitude:p[1],depthKm:p[2],strikeDeg:p[3],dipDeg:p[4],uncertaintyKm:p[5],shiftUncertaintyKm:p[6],smoothingUncertaintyKm:p[7],thicknessKm:p[8],sourceRow:p[9]};}
    target.innerHTML=`<div class="ev-card"><div class="ev-toolbar"><h2>${escape(region.name)} · cross-section</h2><label>Latitude <select id="ev-structure-latitude">${rows.map(r=>`<option value="${r.row}" ${r.row===chosen?'selected':''}>${fmt(r.latitude,3)}° · ${r.count} grid nodes</option>`).join('')}</select></label></div><div class="ev-card-body" id="ev-structure-chart"></div><div class="ev-caption" id="ev-structure-profile-caption"></div></div>
      <div class="ev-split"><div class="ev-card ev-card-body"><h2>Node inspector</h2><div id="ev-structure-node">Select a chart point or a table row to inspect its source attributes.</div></div><div class="ev-card ev-card-body"><h2>Resolution and limits</h2><p>Native grid: ${fmt(region.grid.sourceStepLongitude,3)}° × ${fmt(region.grid.sourceStepLatitude,3)}°. Preview: every fifth index (${fmt(region.grid.displayStepLongitude,3)}° × ${fmt(region.grid.displayStepLatitude,3)}°). Angular spacing is not a uniform distance.</p><p>${fmt(region.summary.nativeGridNodes)} native grid nodes; ${fmt(region.nodes.length)} preview nodes; ${fmt(region.supplement.length)} supplementary nodes retained. Native depth range: ${region.summary.nativeDepthRangeKm.map(n=>fmt(n,3)).join(' to ')} km.</p><p>${region.warnings.map(escape).join(' ')}</p><div class="ev-links"><a href="/data/evidence/${escape(descriptor.file)}" download>Download regional model</a><a href="${escape(region.sourceUrl)}" target="_blank" rel="noopener">Regional source ↗</a></div>${jsonDetails('Regional source hashes and coverage',{sourceFiles:region.sourceFiles,summary:region.summary,warnings:region.warnings})}</div></div>
      <div class="ev-card"><div class="ev-card-body"><h2>Cross-section nodes</h2><p id="ev-structure-table-caption"></p></div><div class="ev-table-wrap" id="ev-structure-table"></div></div>`;
    $('ev-structure-latitude').onchange=updateStructureProfile;
    updateStructureProfile();
    if(selectedNode)inspectStructureNode(selectedNode);
    if(fly){const first=region.nodes[0],last=region.nodes.at(-1),x=region.grid.longitudes,y=region.grid.latitudes;structureMap.flyTo({center:[wrapLongitude((x[0]+x.at(-1))/2),(y[first[0]]+y[last[0]])/2],zoom:3.5});}
  }catch(error){if(request===structureRequest)fail(target,error);}
}
function inspectStructureNode(point) {
  const branch=point.kind==='supplementary_node';
  $('ev-structure-node').innerHTML=`<span class="ev-badge">${branch?'Supplementary branch':'Sampled grid node'}</span><h3>${fmt(point.depthKm,3)} km modeled depth</h3><p>${fmt(point.latitude,6)}° latitude, ${fmt(point.longitude,6)}° longitude.<br>Source PDF standard deviation: ${fmt(point.uncertaintyKm,3)}${point.uncertaintyKm===null?'':' km'}.<br>Strike: ${fmt(point.strikeDeg,3)}° · dip: ${fmt(point.dipDeg,3)}° · thickness: ${fmt(point.thicknessKm,3)} km.</p><p class="ev-small">2018 external model. ${branch?'CSV row '+point.sourceRow:'Source grid row '+point.row+', column '+point.column+' (zero-based)'}. Datum unspecified. Source standard deviation is not total uncertainty or a calibrated Baryon prediction interval.</p>${jsonDetails('All source attributes for this node',point)}`;
}
function updateStructureProfile() {
  if(!structureRegion || !$('ev-structure-latitude'))return;
  const p=latitudeProfile(structureRegion,Number($('ev-structure-latitude').value));
  structurePoints=[...p.nodes,...p.supplementary];
  $('ev-structure-node').textContent='Select a chart point or a table row to inspect its source attributes.';
  $('ev-structure-chart').innerHTML=structureChart(p);
  $('ev-structure-profile-caption').textContent=`${fmt(p.latitude,3)}° latitude · ${fmt(p.nodes.length)} grid nodes on this row; ${fmt(p.supplementary.length)} supplementary nodes projected from ±${fmt(p.halfWidthDegrees,3)}° latitude. Horizontal distance runs east along this latitude from ${fmt(wrapLongitude(p.originLongitude),3)}°. Points are not joined across gaps. Vertical bars show source PDF standard deviation; absent uncertainty is not zero. Axes have different scales; no ground-surface or borehole tie is implied.`;
  const table=[...p.nodes.slice(0,60),...p.supplementary.slice(0,60)];
  $('ev-structure-table-caption').textContent=`Showing ${table.length} of ${fmt(structurePoints.length)} profile points (up to 60 per type). The chart includes every profile point; regional download contains all retained nodes.`;
  $('ev-structure-table').innerHTML=`<table class="ev-table"><thead><tr><th>Inspect</th><th>Longitude / latitude</th><th>Modeled depth</th><th>Source PDF SD</th></tr></thead><tbody>${table.map(n=>`<tr><td><button data-slab-node="${structurePoints.indexOf(n)}">${n.kind==='sampled_grid_node'?'Grid '+n.row+':'+n.column:'Branch row '+n.sourceRow}</button></td><td>${fmt(n.longitude,4)}° / ${fmt(n.latitude,4)}°</td><td>${fmt(n.depthKm,3)} km</td><td>${n.uncertaintyKm===null?'Unknown':fmt(n.uncertaintyKm,3)+' km'}</td></tr>`).join('')}</tbody></table>`;
  $('ev-structure-region-body').querySelectorAll('[data-slab-node]').forEach(el=>{el.onclick=()=>{inspectStructureNode(structurePoints[Number(el.dataset.slabNode)]);$('ev-structure-node').scrollIntoView({block:'nearest'});};});
  structureMap.getSource('slab-profile')?.setData({type:'FeatureCollection',features:p.nodes.map(n=>({type:'Feature',geometry:{type:'Point',coordinates:[n.longitude,n.latitude]},properties:{}}))});
}
function structureChart(profile) {
  const points=[...profile.nodes,...profile.supplementary],left=80,right=850,top=35,bottom=360;
  const extent=points.reduce((a,p)=>{const u=p.uncertaintyKm??0;return {min:Math.min(a.min,p.depthKm-u),max:Math.max(a.max,p.depthKm+u),distance:Math.max(a.distance,p.distanceKm)};},{min:0,max:0,distance:1});
  const span=extent.max-extent.min||1,x=n=>left+n/extent.distance*(right-left),y=n=>top+(n-extent.min)/span*(bottom-top);
  return `<div class="ev-chart-scroll"><svg class="ev-structure-profile" viewBox="0 0 890 415" role="img" aria-label="${escape(structureRegion.name)} modeled slab depth at ${fmt(profile.latitude,3)} degrees latitude"><title>Slab depth profile: modeled nodes and source uncertainty; no interpolation</title>${[0,.25,.5,.75,1].map(t=>`<line x1="${left}" x2="${right}" y1="${top+t*(bottom-top)}" y2="${top+t*(bottom-top)}" stroke="#e3e9e3"/><text x="${left-12}" y="${top+t*(bottom-top)+4}" text-anchor="end">${fmt(extent.min+t*span,1)}</text><text x="${left+t*(right-left)}" y="388" text-anchor="middle">${fmt(t*extent.distance,0)}</text>`).join('')}${points.map((n,i)=>{const branch=n.kind==='supplementary_node',color=branch?'#ad670f':'#177b74',u=n.uncertaintyKm;return `${u===null?'':`<line x1="${x(n.distanceKm)}" x2="${x(n.distanceKm)}" y1="${y(n.depthKm-u)}" y2="${y(n.depthKm+u)}" stroke="${color}" opacity=".18"/>`}<circle data-slab-node="${i}" cx="${x(n.distanceKm)}" cy="${y(n.depthKm)}" r="${branch?2.4:3.5}" fill="${branch?'white':color}" stroke="${color}" stroke-width="1" style="cursor:pointer"><title>${branch?'Branch':'Grid'}: ${fmt(n.depthKm,3)} km, ${fmt(n.longitude,4)}° longitude; source SD ${fmt(u,3)} km</title></circle>`;}).join('')}<text x="${left}" y="16">Modeled depth (km) ↓</text><text x="${right}" y="413" text-anchor="end">Distance east along latitude (km) →</text></svg></div><p class="ev-small"><span class="ev-teal">● Sampled grid</span> · <span class="ev-amber">○ Supplementary branch</span> · source standard deviation bars. Click points to inspect; the table provides keyboard access.</p>`;
}

async function renderSoil(container) {
  const s=manifest.soil, summary=s.summary;
  container.innerHTML=heading('Earth model / United States','From samples to an Earth model','Explore measured soil chemistry at three reported horizons. Each point retains its source, collection date, depth and assay qualifiers. Unmeasured regions and deeper geology remain unknown.')+
    `<div class="ev-metrics">${metric(fmt(summary.sites),'sample sites')}${metric(fmt(summary.samples),'horizon records')}${metric(fmt(summary.cells),'1° cells with samples')}${metric(fmt(summary.flaggedDepthSamples),'depth warnings')}</div>
    <div class="ev-card"><div class="ev-toolbar"><label>Soil layer <select id="ev-horizon"><option value="top5cm">Surface · 0–5 cm</option><option value="ahorizon">A horizon · reported depth</option><option value="chorizon">C horizon · reported depth</option></select></label><span class="ev-legend">Copper mg/kg · 0 <i class="ev-gradient"></i> 100+</span></div>
    <div id="ev-soil-map" class="ev-map" aria-label="Map of measured USGS soil copper"></div><div class="ev-caption" id="ev-soil-status" role="status">Loading sample layer…</div></div>
    <div class="ev-card"><div class="ev-toolbar"><h2>Sample evidence</h2><input id="ev-soil-search" aria-label="Search soil samples" placeholder="Site ID or state code, e.g. UT"></div><div class="ev-card-body" id="ev-soil-detail">Select a sample to inspect all five elements, location and depth qualifiers.</div><div class="ev-table-wrap" id="ev-soil-table"></div><div class="ev-caption" id="ev-soil-count"></div></div>
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
    const regional=rows.find(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude));
    const regionalLink=manifest.bedrock&&regional?`<p><a href="#bedrock?lon=${regional.longitude}&lat=${regional.latitude}">Inspect regional bedrock near the first source coordinate →</a></p><p class="ev-small">Regional cell averages do not establish this hole's collar elevation or trajectory.</p>`:'';

    target.innerHTML=`<h2>Drill hole ${escape(hole.id)}</h2>${regionalLink}<p>${hole.records} records · ${hole.flaggedRecords} flagged · ${escape(hole.coordinateStatus)}.</p><p class="ev-small"><span class="ev-teal">● Cu: four-acid OES</span> &nbsp; <span class="ev-amber">● Cu: sinter AES</span> · mg/kg on a log1p horizontal scale. Vertical axis is reported interval depth in metres, not established as true vertical.</p>${profile(rows,hole)}<div class="ev-table-wrap"><table class="ev-table"><thead><tr><th>Sample / collected</th><th>Source depth → metres</th><th>Cu · four-acid OES</th><th>Cu · sinter AES</th><th>Geology / quality</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escape(r.sampleId)}<small>${day(r.collectedOn)}</small>${jsonDetails('All assays & metadata',r)}</td><td>${escape(r.depth.raw)}<small>${r.depth.fromM===null?'Interval unusable':`${fmt(r.depth.fromM,3)}–${fmt(r.depth.toM,3)} m`}</small></td><td>${assay(r.assays.find(a=>a.sourceField==='Cu_pct_OES_HF'))}</td><td>${assay(r.assays.find(a=>a.sourceField==='Cu_ppm_AES_ST'))}</td><td>${escape(r.lithology||'Unknown lithology')}<small>${escape(r.stratigraphy||'Unknown stratigraphy')}</small><small>${escape(quality([...r.flags,...r.depth.flags]))}</small></td></tr>`).join('')}</tbody></table></div>`;
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
  const registry=await registryPanel();
  container.innerHTML=heading('Research / frozen evaluation','Measure improvement, preserve the test','One completed experiment tests regional interpolation of historical 0–5 cm soil copper. Its saved audit is shown here without rerunning or retuning it.','Limited research result')+
    `<div class="ev-metrics">${metric(fmt(r.audit.relativeRmseGain*100,2)+'%','audit RMSE reduction')}${metric(fmt(r.audit.candidate.n),'audit sites')}${metric(fmt(r.audit.candidate.blocks),'audit blocks')}${metric('1','completed experiment')}</div>${registry}
    <div class="ev-split"><div class="ev-card ev-card-body"><h2>Audit error · lower is better</h2><p>RMSE on log1p(copper mg/kg), compared with the training mean.</p><div class="ev-score"><span>Training mean</span><div class="ev-score-track"><i style="width:100%"></i></div><b>${fmt(r.audit.baseline.rmseLog1p,4)}</b></div><div class="ev-score"><span>Selected IDW</span><div class="ev-score-track"><i class="candidate" style="width:${100*r.audit.candidate.rmseLog1p/r.audit.baseline.rmseLog1p}%"></i></div><b>${fmt(r.audit.candidate.rmseLog1p,4)}</b></div><p>95% paired block-bootstrap interval for aggregate RMSE improvement: <b>${r.audit.blockBootstrapGain95.map(n=>fmt(n*100,2)+'%').join('–')}</b>.</p><div class="ev-note">${escape(r.scope)} Nine audit blocks provide limited evidence. This interval is not calibrated uncertainty for a location.</div></div>
    <div class="ev-card ev-card-body"><h2>Frozen before scoring</h2><p>${escape(p.split)}</p><p>Training: ${fmt(r.trainingSamples)} sites / ${r.trainingBlocks} blocks. Validation: ${fmt(r.validation.baseline.n)} sites / ${r.validation.baseline.blocks} blocks. Baseline: training mean. Validation selected ${r.selected.neighbors}-neighbor inverse-square distance weighting.</p><p>Gate: ≥${p.gate.minimumSamples} sites and ≥${p.gate.minimumBlocks} blocks in each holdout, ≥${p.gate.minimumRelativeRmseGain*100}% RMSE improvement on both and a positive bootstrap lower bound.</p><div class="ev-note">Promoted for regional research. The audit is consumed; future selection requires independent evaluation.</div></div></div>
    <div class="ev-card"><div class="ev-card-body"><h2>Measured scores</h2></div><div class="ev-table-wrap"><table class="ev-table"><thead><tr><th>Evaluation</th><th>Baseline RMSE</th><th>Candidate RMSE</th><th>Sites / blocks</th></tr></thead><tbody><tr><td>Validation · selected k=${r.selected.neighbors}</td><td>${fmt(r.validation.baseline.rmseLog1p,6)}</td><td>${fmt(selected.metrics.rmseLog1p,6)}</td><td>${r.validation.baseline.n} / ${r.validation.baseline.blocks}</td></tr><tr><td>One-use audit</td><td>${fmt(r.audit.baseline.rmseLog1p,6)}</td><td>${fmt(r.audit.candidate.rmseLog1p,6)}</td><td>${r.audit.candidate.n} / ${r.audit.candidate.blocks}</td></tr></tbody></table></div></div>
    <div class="ev-card ev-card-body"><h2>What this result establishes</h2><ul>${r.limitations.map(l=>`<li>${escape(l)}</li>`).join('')}</ul><div class="ev-links"><a href="/data/evidence/${manifest.experiment.file}" download>Download result &amp; plan summary</a><a href="#soil">Inspect the source observations</a></div>${jsonDetails('Candidate validation scores and provenance',experiment)}</div>
    <div class="ev-card ev-card-body"><h2>Research system in development</h2><p>Evidence ingestion, immutable research protocols, audit-exposure tracking and the original bounded soil experiment are implemented. New evaluation adapters, an evaluated acquisition policy, independent depth-model validation and integration with production constraints remain unfinished. Registry entries and repeated downloads do not establish recursive improvement.</p></div>${footer()}`;
}
async function registryPanel() {
  if(!manifest.registry)return '';
  const registry=await data(manifest.registry);
  const labels={historical_completed:'Historical result · audit consumed',frozen:'Protocol frozen',audit_started:'Audit started · consumed',audit_failed_consumed:'Audit failed · remains consumed'};
  return `<div class="ev-card ev-card-body" id="ev-research-registry"><div class="ev-kicker">Research process / inspectable history</div><h2>Research registry</h2><p>Protocols record source eligibility, grouped holdouts, baseline, fixed candidates, evaluation budget and promotion rules. Audit reservations cannot be reopened by changing a plan ID or data normalization.</p>
    <div class="ev-note">${registry.events.length} recorded events · ${registry.experiments.filter(e=>e.status==='frozen').length} new frozen protocols · ${registry.proposals.length} research proposal. Protocol checks and audit reservations are active; new automatic scoring and promotion are not connected.</div>
    ${registry.experiments.map(e=>`<h3>${escape(e.title)}</h3><span class="ev-badge">${escape(labels[e.status]||e.status)}</span><p>${escape(e.scope||e.plan?.question||'')}</p><p class="ev-small">${escape(e.registrationTiming||'Protocol recorded before any audit start in this registry.')} Registry entry: ${escape(e.registeredAt)}.</p>${e.originalPlanCreatedAt?`<p class="ev-small">Original plan: ${escape(e.originalPlanCreatedAt)} · original completion: ${escape(e.originalCompletedAt)}.</p>`:''}${jsonDetails('Inspect protocol, fingerprints and status',e)}`).join('')}
    ${registry.proposals.map(p=>`<h3>Next proposal: ${escape(p.title)}</h3><p>${escape(p.question)}</p><p class="ev-small">Proposal only; not registered, evaluated or promoted.</p><details><summary>Required before registration</summary><ul>${p.requiredBeforeRegistration.map(v=>`<li>${escape(v)}</li>`).join('')}</ul><p>${p.limitations.map(escape).join(' ')}</p></details>`).join('')}
    <div class="ev-links"><a href="/data/evidence/${escape(manifest.registry.file)}" download>Download registry snapshot</a></div>${jsonDetails('Event history and integrity limits',{head:registry.head,events:registry.events,capabilities:registry.capabilities,limitations:registry.limitations})}</div>`;
}
async function renderTrade(container) {
  const t=manifest.trade;
  container.innerHTML=heading('Physical economy / trade evidence','Connect materials to their movement','The existing world model maps sourced facilities, product chains and trade corridors. A monthly copper-trade evidence importer now runs locally; its public data release is pending redistribution rights.','Source access')+
    `<div class="ev-split"><div class="ev-card ev-card-body"><h2>Monthly copper corridor</h2><p>The initial query covers Chile–China copper ores and concentrates, refined cathodes, and waste and scrap. The local ledger retains the query scope, period, retrieval time, source-response hash, missing quantities and estimation flags.</p><div class="ev-note">${escape(t.note)}</div><div class="ev-links"><a href="${t.sourceUrl}" target="_blank" rel="noopener">Explore UN Comtrade ↗</a><a href="${t.policyUrl}" target="_blank" rel="noopener">Publication policy ↗</a></div></div>
    <div class="ev-card ev-card-body"><h2>From trade to usable supply</h2><p>Trade records describe reported goods, not live shipments, production, capacity or demand. Ore weight includes non-metal material. Imports and mirror exports cannot be added together.</p><p>Connecting geology to additional supply still requires processing routes, recovery, infrastructure, timing and independently sourced production constraints. Missing rows are not zero.</p><div class="ev-links"><a href="#world">Explore the world model →</a><a href="#models">Inspect evaluated model results →</a></div></div></div>${footer()}`;
}

async function renderSupply(container) {
  if (!manifest.supply) throw new Error('Supply evidence is not included in this snapshot.');
  const evidence = await data(manifest.supply), f = evidence.facts;
  const sources = ids => ids.map(id => { const s = evidence.sources[id]; return `<a href="${escape(s.url)}" target="_blank" rel="noopener">${escape(s.name)} · ${escape(s.publicationDate || 'publication date unknown')} ↗</a>`; }).join(' · ');
  const defaults = scenarioPreset(evidence);
  container.innerHTML = heading('Supply decisions / Copperwood, Michigan','From ore to usable copper','Test one potential copper source against an annual requirement. Follow the calculation from ore feed to concentrate and payable metal, then inspect what is still needed to establish delivery.','Scenario · sourced inputs') +
    `<div class="ev-metrics">${metric('29,291 t/year','2023 study · payable Cu average')}${metric('1.45% Cu','reported reserve-average grade')}${metric('Unverified','first delivery date')}${metric(fmt(manifest.core.summary.drillHoles),'linked USGS drill holes')}</div>
    <div class="ev-supply-grid">
      <div class="ev-card ev-card-body"><h2>Set the scenario</h2><p class="ev-small">A 365-day year. Throughput is the nominal rate before availability. All outputs below are calculations from these inputs.</p>
      <div class="ev-preset-row"><button class="ev-button" data-supply-preset="early">2023 · first 3 years</button><button class="ev-button" data-supply-preset="later">2023 · later years</button><button class="ev-button" data-supply-preset="optimization">2026 · recovery sensitivity</button></div>
      <p id="ev-preset-note" class="ev-small">2023 later-year design with reserve-average grade as a proxy.</p>
      <div class="ev-input-grid">${Object.entries(INPUTS).map(([key,rule]) => `<label for="ev-input-${key}">${escape(rule.label)} <span>${escape(rule.unit)}</span><input type="number" id="ev-input-${key}" data-supply-input="${key}" value="${defaults[key]}" min="${rule.exclusiveMin ? 0.01 : rule.min}" max="${rule.max}" step="any" required></label>`).join('')}</div>
      <p class="ev-small">Effective payability includes the study's concentrate loss. The grade proxy does not reproduce the annual mining schedule.</p></div>
      <div><div id="ev-supply-answer" class="ev-card ev-card-body" aria-live="polite"></div>
      <div class="ev-card ev-card-body"><h2>Reported study benchmark</h2><p>${fmt(f.annualPayable.value,0)} t/year of payable copper. The simplified scenario can differ because the full feasibility model follows a mine schedule and ramp-up exclusions.</p><div class="ev-links">${sources(['fs2023'])}</div><p class="ev-small">The 2026 recovery preset combines proposed metallurgy with older throughput and grade assumptions. It is a sensitivity case, not an updated feasibility result.</p></div></div>
    </div>
    <div class="ev-card ev-card-body"><h2>The material path</h2><div id="ev-supply-flow" aria-live="polite"></div><p class="ev-small">Grinding and flotation produce concentrate. Payability is a commercial metal basis; it does not measure refining recovery or a physical shipment. No smelter or refinery output is inferred.</p></div>
    <div class="ev-split"><div class="ev-card ev-card-body"><h2>What constrains delivery?</h2>${evidence.gates.map(g => `<div class="ev-gate"><span class="ev-badge">${escape(g.status)}</span><h3>${escape(g.title)}</h3><p>${escape(g.text)}</p><div class="ev-links">${sources(g.sourceIds)}</div></div>`).join('')}</div>
      <div><div class="ev-card ev-card-body"><h2>Next evidence to acquire</h2><div id="ev-supply-investigations"></div><p class="ev-small">Rules prioritize availability, downstream delivery, then process adequacy. This is an investigation guide; acquisitions and decision improvements have not been executed or evaluated.</p></div>
      <div class="ev-card ev-card-body"><h2>Connect the evidence</h2>${evidence.context.map(c => `<h3>${escape(c.title)}</h3><p>${escape(c.text)}</p><div class="ev-links">${sources(c.sourceIds)}</div>`).join('')}<div class="ev-links"><a href="#cores">Inspect the drill-core record →</a><a href="#world">Explore the global inventory →</a><a href="#trade">Trade integration status →</a></div></div></div></div>
    <div class="ev-card ev-card-body"><h2>Sources and assumptions</h2><p class="ev-small">Reviewed ${evidence.reviewedAt}. Publication dates and retrieval dates are separate. ${escape(evidence.confidence)}</p><details><summary>Inspect every reported input</summary><div class="ev-table-wrap"><table class="ev-table"><thead><tr><th>Input</th><th>Value</th><th>Evidence type</th><th>Source and vintage</th></tr></thead><tbody>${Object.values(f).map(v => `<tr><td>${escape(v.label)}<small>${escape(v.note)}</small></td><td>${fmt(v.value)} ${escape(v.unit)}</td><td>${escape(v.kind.replaceAll('_',' '))}</td><td>${sources([v.sourceId])}<small>${escape(v.section)}${v.effectiveDate ? ' · effective '+v.effectiveDate : ''}</small></td></tr>`).join('')}</tbody></table></div></details>
    ${jsonDetails('Source retrieval dates and fingerprints',evidence.sources)}<div class="ev-links"><a href="/data/evidence/${escape(manifest.supply.file)}" download>Download evidence snapshot</a><button class="ev-button" id="ev-supply-download">View scenario report</button></div><div id="ev-supply-report" hidden></div><p class="ev-small">${escape(evidence.scope)}</p></div>${footer()}`;
  let currentInput, currentResult, reportUrl;
  const recalculate = () => {
    $('ev-supply-report').hidden = true;
    $('ev-supply-report').textContent = '';
    if (reportUrl) { URL.revokeObjectURL(reportUrl); reportUrl = null; }
    currentInput = Object.fromEntries(Object.keys(INPUTS).map(key => [key,$(`ev-input-${key}`).valueAsNumber]));
    currentResult = calculateCopperSupply(currentInput);
    $('ev-supply-download').disabled = !currentResult.ok;
    if (!currentResult.ok) {
      $('ev-supply-answer').innerHTML = `<h2>Revise the scenario</h2><div class="ev-error" role="alert">${currentResult.errors.map(escape).join('<br>')}</div>`;
      $('ev-supply-flow').textContent = 'No result for invalid or incomplete inputs.';
      $('ev-supply-investigations').textContent = 'Enter a valid scenario to see the process investigation.';
      return;
    }
    const r = currentResult;
    $('ev-supply-answer').innerHTML = `<div class="ev-kicker">Calculated payable copper</div><div class="ev-supply-total">${fmt(r.payableCopperTonnes,0)} <span>t Cu/year</span></div><h2>${r.targetMet ? 'Scenario reaches the target' : 'Scenario falls short of the target'}</h2><p>${fmt(Math.abs(r.targetGapTonnes),0)} t/year ${r.targetMet ? 'above' : 'below'} the ${fmt(r.targetTonnes,0)} t/year payable target.</p><p>Required copper recovery with the other inputs fixed: <strong>${r.requiredRecoveryPct === null ? 'No finite solution' : fmt(r.requiredRecoveryPct,2)+'%'}</strong>. ${r.targetPossibleAtFullRecovery ? 'This is an arithmetic threshold, not demonstrated recovery.' : 'Recovery alone cannot reach this target.'}</p><div class="ev-note"><strong>Delivered refined copper: unknown.</strong><br>Development timing and downstream commitments remain unverified even when the scenario meets the target.</div>`;
    $('ev-supply-flow').innerHTML = `<div class="ev-flow">${[
      ['Ore feed',r.oreTonnes,'t ore/year'],['Copper in feed',r.containedCopperTonnes,'t Cu/year'],['Copper in concentrate',r.recoveredCopperTonnes,'t Cu/year'],['Payable copper',r.payableCopperTonnes,'t Cu/year'],
    ].map(([label,value,unit],i) => `<div class="ev-flow-step"><span>${i+1} · ${escape(label)}</span><strong>${fmt(value,0)}</strong><small>${unit}</small></div>`).join('')}</div><p>${fmt(r.concentrateDryTonnes,0)} t/year dry concentrate at ${fmt(currentInput.concentrateGradePct)}% Cu. ${fmt(r.residualCopperTonnes,0)} t/year of feed copper remains outside the recovered concentrate.</p>`;
    $('ev-supply-investigations').innerHTML = `<ol class="ev-investigations">${nextSupplyInvestigations(r).map(item => `<li><h3>${escape(item.question)}</h3><p>${escape(item.action)}</p><p class="ev-small">${escape(item.reason)}</p></li>`).join('')}</ol>`;
  };
  container.querySelectorAll('[data-supply-input]').forEach(node => node.addEventListener('input',() => {
    $('ev-preset-note').textContent = 'Edited scenario. Check the source ledger to compare your assumptions with reported inputs.';
    recalculate();
  }));
  container.querySelectorAll('[data-supply-preset]').forEach(node => node.addEventListener('click',() => {
    const preset = scenarioPreset(evidence,node.dataset.supplyPreset);
    for (const key of Object.keys(INPUTS)) if (key !== 'targetTonnes') $(`ev-input-${key}`).value = preset[key];
    $('ev-preset-note').textContent = node.dataset.supplyPreset === 'optimization' ? 'Hybrid sensitivity: proposed 2026 metallurgy with 2023 later-year throughput and reserve grade. No updated feasibility result is implied.' : `2023 ${node.dataset.supplyPreset === 'early' ? 'first-three-year' : 'later-year'} design with reserve-average grade as a proxy.`;
    recalculate();
  }));
  $('ev-supply-download').addEventListener('click',() => {
    if (!currentResult.ok) return;
    const report = { generatedAt: new Date().toISOString(), evidenceId: evidence.id, evidenceSha256: manifest.supply.sha256, input: currentInput, result: currentResult, investigations: nextSupplyInvestigations(currentResult), evidence };
    const raw = JSON.stringify(report,null,2);
    if (reportUrl) URL.revokeObjectURL(reportUrl);
    reportUrl = URL.createObjectURL(new Blob([raw],{type:'application/json'}));
    $('ev-supply-report').innerHTML = `<h3>Scenario report</h3><p class="ev-small">This report includes your assumptions, calculated outputs, unknowns, source references and the evidence fingerprint. Select the text to copy it, or save it as JSON.</p><a href="${escape(reportUrl)}" download="baryon-copperwood-scenario.json">Save report as JSON</a><pre class="ev-json" tabindex="0" aria-label="Scenario report JSON">${escape(raw)}</pre>`;
    $('ev-supply-report').hidden = false;
  });
  recalculate();
}
