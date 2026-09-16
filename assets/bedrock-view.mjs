import * as maplibregl from '/maplibre/maplibre-gl.mjs';
import {cellContext,cellMetric,nearestCell} from '/assets/bedrock-cell.mjs?v=20260916a';
let map,model,read,helpers,overview=[],displayRows=[],selected=null,displayRequest=0,locationRequest=0,lastQuery='',ready=false;
const $=id=>document.getElementById(id);
const safeLink=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}};
const features=rows=>({type:'FeatureCollection',features:rows.filter(r=>r[3]!==null&&r[4]!==null).map(r=>({type:'Feature',geometry:{type:'Point',coordinates:[r[3],r[4]]},properties:{id:r[0],value:cellMetric(r,$('ev-bedrock-layer').value,model)??0,missing:cellMetric(r,$('ev-bedrock-layer').value,model)===null,absent:model.codebooks.BEDRX_Method[r[8]]==='BEDRX5',adjusted:r[13]!==0}}))});

export async function renderBedrock(container,context) {
  model=context.model;read=context.data;helpers=context.helpers;
  if(!model)throw new Error('Bedrock model is not available in this snapshot.');
  const {heading,metric,fmt,escape:e,jsonDetails,footer}=helpers,s=model.summary;
  container.innerHTML=heading('Earth model / conterminous United States','From land surface to basement','Inspect a regional model of land surface, bedrock and basement. Each 2.5 km cell retains its source, geological definitions and adjustment notes.','Preliminary USGS model · 2025')+
    `<div class="ev-metrics">${metric(fmt(s.landSurfaceCells),'cells with land elevation')}${metric('2.5 km','native cell spacing')}${metric(fmt(s.bedrockUnitAbsent),'bedrock unit absent')}${metric(fmt(s.cellsWithNotes),'cells with source notes')}</div>
    <div class="ev-card"><div class="ev-toolbar"><label>Model layer <select id="ev-bedrock-layer" disabled><option value="bedrock">Depth to bedrock</option><option value="basement">Depth to basement</option><option value="land">Land-surface altitude</option></select></label><button id="ev-bedrock-reset" class="ev-button" disabled>United States view</button><span class="ev-legend" id="ev-bedrock-legend"></span></div><div class="ev-map" id="ev-bedrock-map" aria-label="USGS three-layer geology map"></div><div class="ev-caption" id="ev-bedrock-map-status" role="status">Loading verified model preview…</div></div>
    <div class="ev-card ev-card-body"><h2>Find regional context for a location</h2><form id="ev-bedrock-location" class="ev-location-form"><label>Longitude <input id="ev-bedrock-lon" type="number" min="-180" max="180" step="any" required placeholder="e.g. -100"></label><label>Latitude <input id="ev-bedrock-lat" type="number" min="-90" max="90" step="any" required placeholder="e.g. 40"></label><button class="ev-button" id="ev-bedrock-find" disabled>Find nearby cell</button></form><p class="ev-small">Returns the nearest model-cell center within 3 km. Cell averages cannot establish conditions at a drill hole or property.</p><div id="ev-bedrock-location-status" role="status"></div></div>
    <div class="ev-note">This preliminary compilation is regional geological context. Its informal bedrock/basement definitions vary by region, some altitudes were manually adjusted, and no formal accuracy assessment is supplied. It does not establish mineralization or a local drilling depth.</div>
    <div id="ev-bedrock-detail"><div class="ev-card ev-card-body"><h2>Inspect a cell</h2><p>Select a map point or enter coordinates. Zoom in to load the native 2.5 km model cells.</p></div></div>
    <div class="ev-split"><div class="ev-card ev-card-body"><h2>Coverage and missing layers</h2><p>${fmt(s.records)} source records; ${fmt(s.landSurfaceMissing)} have no land-surface altitude, ${fmt(s.basementMissing)} have no basement altitude, and ${fmt(s.missingGeometry)} has no map geometry. A missing layer is not a zero depth. The BEDRX5 code instead identifies an absent stratified bedrock unit.</p><p>${fmt(s.missingSourceReferenceFields)} populated altitude fields lack their source-reference field. Cell inspectors expose these gaps. Known source key DAS1 is linked to table entry DAS01 using a disclosed zero-padding alias; the original key is retained.</p><p>${e(model.scope)}</p><div class="ev-links"><a href="#cores">Measured drill-core assays</a><a href="#structure">Deep slab geometry</a><a href="#supply">Copper supply scenario</a></div></div>
    <div class="ev-card ev-card-body"><h2>USGS three-layer model · version 1.1</h2><p>Sweetkind, Zellman and Goldberg. First released ${e(model.source.publicationDate)}; revised ${e(model.source.revisionDate)}. Methodology report: ${e(model.source.reportPublicationDate)}. Acquired ${e(model.source.acquiredAt.slice(0,10))} UTC.</p><p>${e(model.source.license)} Altitudes use the report's NAVD 88 datum; Baryon applies no vertical transformation. Map coordinates are transformed from NAD83 / Conus Albers for display.</p><div class="ev-links"><a href="${e(model.source.url)}" target="_blank" rel="noopener">Source data ↗</a><a href="${e(model.source.reportUrl)}" target="_blank" rel="noopener">Methodology and limits ↗</a><a href="/data/evidence/${e(model.unlocated.file)}" download>Unlocated source record</a></div>${jsonDetails('Source provenance, resolution and warnings',{source:model.source,grid:model.grid,summary:model.summary,unresolvedSourceKeys:model.unresolvedSourceKeys})}</div></div>${footer()}`;
  overview=await read(model.overview);
  map=new maplibregl.Map({container:'ev-bedrock-map',center:[-98,38],zoom:3.4,style:{version:8,sources:{imagery:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics'}},layers:[{id:'background',type:'background',paint:{'background-color':'#102022'}},{id:'imagery',type:'raster',source:'imagery',paint:{'raster-opacity':.55}}]}});
  map.addControl(new maplibregl.NavigationControl(),'top-right');
  map.on('load',()=>{
    displayRows=overview;
    map.addSource('bedrock',{type:'geojson',data:features(overview)});
    map.addLayer({id:'bedrock',type:'circle',source:'bedrock',paint:{'circle-radius':['interpolate',['linear'],['zoom'],3,1.8,7,4,10,6],'circle-color':'#4cae9a','circle-opacity':.8,'circle-stroke-color':'#86592c','circle-stroke-width':['case',['get','adjusted'],1,0]}});
    map.addSource('bedrock-selected',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
    map.addLayer({id:'bedrock-selected',type:'circle',source:'bedrock-selected',paint:{'circle-radius':8,'circle-color':'#fff','circle-opacity':.3,'circle-stroke-color':'#111','circle-stroke-width':2}});
    ready=true;
    map.on('click','bedrock',event=>{const id=event.features?.[0]?.properties.id,row=displayRows.find(r=>r[0]===id)||overview.find(r=>r[0]===id);if(row)inspect(row);});
    map.on('mouseenter','bedrock',()=>{map.getCanvas().style.cursor='pointer';});map.on('mouseleave','bedrock',()=>{map.getCanvas().style.cursor='';});
    map.on('moveend',loadVisible);
    $('ev-bedrock-layer').disabled=$('ev-bedrock-reset').disabled=$('ev-bedrock-find').disabled=false;
    $('ev-bedrock-layer').onchange=()=>{map.getSource('bedrock').setData(features(displayRows));updateColors();};
    $('ev-bedrock-reset').onclick=()=>map.flyTo({center:[-98,38],zoom:3.4});
    $('ev-bedrock-location').onsubmit=event=>{event.preventDefault();const lon=$('ev-bedrock-lon').value,lat=$('ev-bedrock-lat').value;if(lon!==''&&lat!==''){const hash=`#bedrock?lon=${encodeURIComponent(lon)}&lat=${encodeURIComponent(lat)}`;if(location.hash===hash)focusLocation(Number(lon),Number(lat));else location.hash=hash;}};
    updateColors();loadVisible();activateBedrock();
  });
}
export function activateBedrock() {
  map?.resize();if(!ready)return;
  const query=location.hash.split('?')[1]||'';
  if(query&&query!==lastQuery){lastQuery=query;const params=new URLSearchParams(query);const lon=params.get('lon'),lat=params.get('lat');if(lon!==null&&lat!==null&&lon.trim()!==''&&lat.trim()!=='')focusLocation(Number(lon),Number(lat));}
}
function updateColors() {
  const layer=$('ev-bedrock-layer').value,max=layer==='bedrock'?2000:layer==='basement'?16000:4000;
  map.setPaintProperty('bedrock','circle-color',['case',...(layer==='bedrock'?[['get','absent'],'#a997b3']:[]),['get','missing'],'#c8ceca',['interpolate',['linear'],['get','value'],0,'#b5def8',max*.15,'#44b9ba',max*.4,'#ead786',max*.7,'#f28a48',max,'#e45b45']]);
  $('ev-bedrock-legend').innerHTML=`${layer==='land'?'Altitude':'Depth'} m · ≤0 <i class="ev-gradient"></i> ${helpers.fmt(max)}+<br>Gray: unknown${layer==='bedrock'?' · violet: unit absent':''} · brown outline: source note`;
}
async function loadVisible() {
  if(!ready)return;const request=++displayRequest;
  const b=map.getBounds(),tiles=model.tiles.filter(t=>t.bounds[0]<=b.getEast()&&t.bounds[2]>=b.getWest()&&t.bounds[1]<=b.getNorth()&&t.bounds[3]>=b.getSouth());
  if(map.getZoom()<6||tiles.length>16){displayRows=overview;map.getSource('bedrock').setData(features(displayRows));$('ev-bedrock-map-status').textContent=`Overview: ${helpers.fmt(overview.length)} cell centers sampled every fifth native row and column (12.5 km spacing). Zoom in for native 2.5 km cells. Missing source cells are shown as unknown.`;return;}
  $('ev-bedrock-map-status').textContent=`Loading ${tiles.length} verified regional tiles…`;
  try {
    const rows=(await Promise.all(tiles.map(read))).flat();if(request!==displayRequest)return;
    displayRows=rows;map.getSource('bedrock').setData(features(rows));$('ev-bedrock-map-status').textContent=`Native model: ${helpers.fmt(rows.length)} cell centers in ${tiles.length} loaded tiles. Cells are 2.5 km × 2.5 km in the source projection. Points show cell averages, not measurements at their centers.`;
  }catch(error){if(request===displayRequest)$('ev-bedrock-map-status').textContent='Model tile load failed: '+error.message;}
}
async function focusLocation(lon,lat) {
  const status=$('ev-bedrock-location-status'),request=++locationRequest;
  selected=null;map.getSource('bedrock-selected').setData({type:'FeatureCollection',features:[]});
  $('ev-bedrock-detail').innerHTML='<div class="ev-card ev-card-body"><h2>No cell selected</h2><p>A successful lookup will show the source model cell here.</p></div>';
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon< -130||lon> -60||lat<20||lat>55){status.textContent='Enter a location in the conterminous United States. This model has no global coverage.';return;}
  $('ev-bedrock-lon').value=lon;$('ev-bedrock-lat').value=lat;status.textContent='Finding a verified nearby model cell…';map.flyTo({center:[lon,lat],zoom:8});
  const tiles=model.tiles.filter(t=>t.bounds[0]<=lon+.1&&t.bounds[2]>=lon-.1&&t.bounds[1]<=lat+.1&&t.bounds[3]>=lat-.1);
  try{const rows=(await Promise.all(tiles.map(read))).flat();if(request!==locationRequest)return;const found=nearestCell(rows,lon,lat);if(!found){status.textContent='No source cell center lies within 3 km. Coverage remains unknown.';return;}status.textContent=`Nearest model-cell center: ${helpers.fmt(found.distanceKm,3)} km from the requested location. This is regional context; no site value is interpolated.`;inspect(found.row,false);}
  catch(error){if(request===locationRequest)status.textContent='Location lookup failed: '+error.message;}
}
function inspect(row,updateInputs=true) {
  if(updateInputs)locationRequest++;
  selected=row;const c=cellContext(row,model),{fmt,escape:e,jsonDetails}=helpers;
  if(updateInputs){$('ev-bedrock-lon').value=c.longitude;$('ev-bedrock-lat').value=c.latitude;$('ev-bedrock-location-status').textContent='Selected a source model-cell center.';}
  map.getSource('bedrock-selected').setData({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[c.longitude,c.latitude]},properties:{}}]});
  const tile=model.tiles.find(t=>c.longitude>=t.bounds[0]&&c.longitude<t.bounds[2]&&c.latitude>=t.bounds[1]&&c.latitude<t.bounds[3]);
  const term=key=>model.glossary.find(g=>g.Term===key);
  const sourceEntry=entry=>{const s=entry.source,url=safeLink(s?.URL);return `<li><b>${e(entry.key)}</b>${entry.alias?` → ${e(entry.alias.target)} <span class="ev-small">(${e(entry.alias.basis)})</span>`:''}${s?`: ${e(s.FullCitation)}${url?` <a href="${e(url)}" target="_blank" rel="noopener">Source ↗</a>`:''}<p class="ev-small">${e(s.SourceInput_Contribution)}</p>${s.Notes?jsonDetails('Source compilation notes',s.Notes):''}`:': source table entry unresolved'}</li>`;};
  $('ev-bedrock-detail').innerHTML=`<div class="ev-card"><div class="ev-card-body"><div class="ev-kicker">Cell ${e(c.id)} / modeled regional context</div><h2>Geological column at ${fmt(c.latitude,5)}°, ${fmt(c.longitude,5)}°</h2><p>Values summarize a 2.5 km cell. Numeric source uncertainty is unavailable. Reported datum: NAVD 88; no Baryon vertical transformation.</p>${c.warnings.length?`<div class="ev-note"><b>Source qualifications</b><ul>${c.warnings.map(w=>`<li>${e(w)}</li>`).join('')}</ul></div>`:''}<div class="ev-split"><div>${column(c)}<p class="ev-small">Conceptual column from cell-average altitudes. No local stratigraphy, mineral composition, borehole trajectory or accuracy interval is inferred.</p></div><div><table class="ev-table"><thead><tr><th>Modeled surface</th><th>Altitude</th><th>Below land</th></tr></thead><tbody><tr><td>Land surface</td><td>${fmt(c.landSurfaceM)} m</td><td>${c.landSurfaceM===null?'Unknown':'Reference'}</td></tr><tr><td>Top of bedrock</td><td>${c.bedrockStatus==='absent'?'Unit absent':fmt(c.topBedrockM)+' m'}</td><td>${fmt(c.bedrockDepthM)}${c.bedrockDepthM===null?'':' m'}</td></tr><tr><td>Top of basement</td><td>${fmt(c.topBasementM)} m</td><td>${fmt(c.basementDepthM)}${c.basementDepthM===null?'':' m'}</td></tr></tbody></table><p>Stratified bedrock thickness: <b>${c.bedrockStatus==='absent'?'unit absent':c.strataThicknessM===null?'unknown':fmt(c.strataThicknessM)+' m'}</b>.</p><p>${c.bedrockStatus==='absent'?'BEDRX5 means the stratified bedrock unit is absent. Cover may overlie basement directly; a null bedrock altitude is not replaced with zero.':'Depth and thickness values are derived by subtracting available, ordered source altitudes.'}</p></div></div><div class="ev-links">${tile?`<a href="/data/evidence/${e(tile.file)}" download>Download this regional tile</a>`:''}<a href="#bedrock?lon=${c.longitude}&lat=${c.latitude}">Link to this cell’s vicinity</a></div>${jsonDetails('Cell values and source references',c)}</div></div>
    <div class="ev-split"><div class="ev-card ev-card-body"><h2>Definitions at this cell</h2>${[c.bedrockMethod,c.basementType].map(key=>`<h3>${e(key||'Unassigned')}</h3><p>${e(term(key)?.Definition||'The source does not assign a geological definition.')}</p>`).join('')}</div><div class="ev-card ev-card-body"><h2>Trace the compiled sources</h2>${c.references.map(r=>`<h3>${e(r.layer)}</h3>${r.entries.length?`<ul>${r.entries.map(sourceEntry).join('')}</ul>`:'<p>No source reference assigned.</p>'}`).join('')}</div></div>`;
}
function column(c) {
  const {fmt}=helpers;
  if(c.landSurfaceM===null)return '<div class="ev-note">No land-surface altitude. A depth column cannot be calculated.</div>';
  const horizons=[{name:'Land',depth:0,color:'#334d40'},...(c.bedrockDepthM===null?[]:[{name:'Bedrock',depth:c.bedrockDepthM,color:'#177b74'}]),...(c.basementDepthM===null?[]:[{name:'Basement',depth:c.basementDepthM,color:'#ad670f'}])];
  if(horizons.length===1)return '<div class="ev-note">No modeled subsurface altitude is available for a depth column.</div>';
  if(horizons.every(h=>h.depth===0))return '<div class="ev-note">All populated modeled horizons coincide with the cell-average land surface (0 m depth). Missing horizons remain unknown.</div>';
  const max=Math.max(1,...horizons.map(h=>h.depth)),y=d=>35+260*d/max;
  const bed=c.bedrockDepthM,base=c.basementDepthM,cover=c.coverDepthM;
  return `<svg class="ev-column-profile" viewBox="0 0 480 350" role="img" aria-label="Conceptual depth column for ${c.id}"><title>Cell-average modeled depths; missing horizons stay unknown</title>${cover===null?'':`<rect x="150" y="35" width="95" height="${y(cover)-35}" fill="#d7e9dd"/>`}${bed===null||base===null||base<bed?'':`<rect x="150" y="${y(bed)}" width="95" height="${y(base)-y(bed)}" fill="#ecdcb9"/>`}${horizons.map((h,i)=>`<line x1="150" x2="${255+i*85}" y1="${y(h.depth)}" y2="${y(h.depth)}" stroke="${h.color}"/><circle cx="${255+i*85}" cy="${y(h.depth)}" r="4" fill="${h.color}"/><text x="${255+i*85}" y="${y(h.depth)-10}" text-anchor="middle">${fmt(h.depth)} m</text>`).join('')}<text x="150" y="325">Depth below cell-average land surface</text><text x="150" y="345"><tspan fill="#334d40">● Land</tspan> · <tspan fill="#177b74">● Bedrock</tspan> · <tspan fill="#ad670f">● Basement</tspan></text></svg>`;
}
