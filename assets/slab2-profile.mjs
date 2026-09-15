// Display/query helpers for the sampled USGS Slab2 archive. No inferred depths are created.
export function wrapLongitude(longitude) {
  if (!Number.isFinite(longitude)) throw new Error('Longitude must be finite');
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}
export function gridNode(region, point) {
  const [row,column,depthKm,uncertaintyKm,strikeDeg,dipDeg,thicknessKm]=point;
  const sourceLongitude=region.grid.longitudes[column], latitude=region.grid.latitudes[row];
  if (![sourceLongitude,latitude,depthKm].every(Number.isFinite)) throw new Error('Invalid model node');
  return { kind:'sampled_grid_node',row,column,sourceLongitude,longitude:wrapLongitude(sourceLongitude),latitude,depthKm,uncertaintyKm,strikeDeg,dipDeg,thicknessKm };
}
export function latitudeRows(region) {
  const counts=new Map();
  for (const node of region.nodes) counts.set(node[0],(counts.get(node[0])||0)+1);
  return [...counts].sort(([a],[b])=>a-b).map(([row,count])=>({row,latitude:region.grid.latitudes[row],count}));
}
export function latitudeProfile(region,row) {
  if (!Number.isInteger(row) || row<0 || row>=region.grid.latitudes.length) throw new Error('Invalid latitude row');
  const latitude=region.grid.latitudes[row], halfWidthDegrees=region.grid.displayStepLatitude/2;
  const nodes=region.nodes.filter(n=>n[0]===row).sort((a,b)=>a[1]-b[1]).map(n=>gridNode(region,n));
  const supplementary=region.supplement.filter(n=>Math.abs(n[1]-latitude)<=halfWidthDegrees+1e-8).map(n=>({
    kind:'supplementary_node',sourceLongitude:n[0],longitude:wrapLongitude(n[0]),latitude:n[1],depthKm:n[2],strikeDeg:n[3],dipDeg:n[4],uncertaintyKm:n[5],shiftUncertaintyKm:n[6],smoothingUncertaintyKm:n[7],thicknessKm:n[8],sourceRow:n[9],
  }));
  const all=[...nodes,...supplementary];
  if (!all.length) return {latitude,halfWidthDegrees,nodes:[],supplementary:[],segments:[],originLongitude:null};
  const originLongitude=Math.min(...all.map(n=>n.sourceLongitude));
  const scale=6371.0088*Math.cos(latitude*Math.PI/180)*Math.PI/180;
  for (const point of all) point.distanceKm=(point.sourceLongitude-originLongitude)*scale;
  const segments=[];
  for (const point of nodes) {
    const last=segments.at(-1)?.at(-1);
    if (!last || point.column-last.column!==region.grid.displayStride) segments.push([]);
    segments.at(-1).push(point);
  }
  return {latitude,halfWidthDegrees,nodes,supplementary,segments,originLongitude};
}
