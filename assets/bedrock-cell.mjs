// Interpret source cell averages; never infer mineralization or fill missing layers.
const stringFields=['BEDRX_Method','BSMT_TYPE','LandSurf_DataSourceID','TopBedrx_DataSourceID','TopBsmt_DataSourceID','Notes'];
export function cellContext(row,model) {
  if(!Array.isArray(row)||row.length!==14||!/^MC[1-9][0-9]*$/.test(row[0]))throw new Error('Invalid model cell');
  const [id,gridRow,gridColumn,longitude,latitude,landSurfaceM,topBedrockM,topBasementM]=row;
  if([landSurfaceM,topBedrockM,topBasementM].some(v=>v!==null&&!Number.isFinite(v)))throw new Error('Invalid altitude');
  const values=stringFields.map((field,i)=>{
    const value=model.codebooks[field]?.[row[8+i]];
    if(value===undefined)throw new Error('Unknown source dictionary code');
    return value;
  });
  const [bedrockMethod,basementType,landSource,bedrockSource,basementSource,note]=values;
  const absent=bedrockMethod==='BEDRX5';
  const difference=(top,base)=>top===null||base===null||base>top?null:top-base;
  const bedrockDepthM=absent?null:difference(landSurfaceM,topBedrockM);
  const basementDepthM=difference(landSurfaceM,topBasementM);
  const warnings=[];
  if(landSurfaceM===null)warnings.push('Land-surface altitude is missing. No depth below land can be calculated.');
  if(topBedrockM===null&&!absent)warnings.push('Bedrock altitude is missing; this is not zero cover thickness.');
  if(topBasementM===null)warnings.push('Basement altitude is missing.');
  if(note!==null)warnings.push('Source adjustment note: '+note);
  if(absent&&topBedrockM!==null)warnings.push('Source absent-unit code conflicts with a populated bedrock altitude.');
  for(const [label,upper,lower] of [['land/bedrock',landSurfaceM,topBedrockM],['land/basement',landSurfaceM,topBasementM],['bedrock/basement',topBedrockM,topBasementM]]) {
    if(upper!==null&&lower!==null&&lower>upper)warnings.push('Source layer-order conflict: '+label+'. Invalid thickness remains unknown.');
  }
  const references=[['land surface',landSurfaceM,landSource],['bedrock',topBedrockM,bedrockSource],['basement',topBasementM,basementSource]].map(([layer,altitude,raw])=>{
    if(altitude!==null&&raw===null)warnings.push('No source reference is assigned to the '+layer+' altitude.');
    const entries=(raw?.split('|')||[]).map(key=>{
      key=key.trim();const alias=model.sourceAliases?.[key];const resolved=alias?.target||key;
      const source=model.sources.find(s=>s.DataSources_ID===resolved)||null;
      if(!source)warnings.push('Unresolved source identifier: '+key+'.');
      return {key,alias:alias||null,source};
    });
    return {layer,raw,entries};
  });
  return {id,gridRow,gridColumn,longitude,latitude,landSurfaceM,topBedrockM,topBasementM,
    bedrockMethod,basementType,note,bedrockStatus:absent?'absent':topBedrockM===null?'unknown':'modeled',
    bedrockDepthM,basementDepthM,coverDepthM:absent?basementDepthM:bedrockDepthM,
    strataThicknessM:absent?null:difference(topBedrockM,topBasementM),references,warnings};
}
export function cellMetric(row,metric,model) {
  if(metric==='land')return row[5];
  if(metric==='basement')return row[5]===null||row[7]===null||row[7]>row[5]?null:row[5]-row[7];
  if(metric==='bedrock')return model.codebooks.BEDRX_Method[row[8]]==='BEDRX5'||row[5]===null||row[6]===null||row[6]>row[5]?null:row[5]-row[6];
  throw new Error('Unknown layer metric');
}
export function nearestCell(rows,longitude,latitude,maximumKm=3) {
  if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||Math.abs(longitude)>180||Math.abs(latitude)>90||!Number.isFinite(maximumKm)||maximumKm<0)throw new Error('Invalid location');
  const rad=Math.PI/180;let nearest=null;
  for(const row of rows) {
    if(row[3]===null||row[4]===null)continue;
    const dlat=(row[4]-latitude)*rad,dlon=(row[3]-longitude)*rad;
    const a=Math.sin(dlat/2)**2+Math.cos(latitude*rad)*Math.cos(row[4]*rad)*Math.sin(dlon/2)**2;
    const distanceKm=6371.0088*2*Math.asin(Math.min(1,Math.sqrt(a)));
    if(distanceKm<=maximumKm&&(!nearest||distanceKm<nearest.distanceKm))nearest={row,distanceKm};
  }
  return nearest;
}
