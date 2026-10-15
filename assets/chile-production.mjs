export const CHILE_SOURCE_SHA='1f4afae4412d40cd60cb49df783919758503724068be60a19f02003c5a1545b1';
export const CHILE_DATA_SHA='886eab084c957e2d14138320444626e977c04bf192dbd96bc58ed2d8a39db574';
export function validateChileProduction(d){
 if(d?.schemaVersion!==1||d.kind!=='reported_annual_production'||d.id!=='chile-copper-2025-v1-'+CHILE_SOURCE_SHA||d.source.rawSha256!==CHILE_SOURCE_SHA)throw Error('Unexpected Chile evidence identity');
 if(d.series.length!==25||new Set(d.series.map(s=>s.id)).size!==25)throw Error('Unexpected Chile series');
 if(JSON.stringify(d.years)!==JSON.stringify(Array.from({length:10},(_,i)=>2016+i)))throw Error('Unexpected Chile periods');
 for(const s of d.series){
  if(s.unit!=='t Cu'||s.basis!=='contained_copper'||s.observations.length!==10)throw Error('Unexpected Chile units or observations');
  for(const [i,o]of s.observations.entries())if(o.year!==d.years[i]||(o.tonnesCu!==null&&(!Number.isSafeInteger(o.tonnesCu)||o.tonnesCu<0||o.tonnesCu%100!==0))||o.status!==(o.tonnesCu===null?'missing':'reported'))throw Error('Invalid Chile observation');
 }
 return d;
}
export function selectChileYear(dataset,year){
 validateChileProduction(dataset);
 if(!dataset.years.includes(year))throw Error('Unknown Chile reporting year');
 const rows=dataset.series.map(s=>{
  const now=s.observations.find(o=>o.year===year),prior=s.observations.find(o=>o.year===year-1),change=now.tonnesCu===null||prior?.tonnesCu==null?null:now.tonnesCu-prior.tonnesCu;
  return {...s,observation:now,previousTonnesCu:prior?.tonnesCu??null,changeTonnesCu:change,changePct:change===null||!prior?.tonnesCu?null:change/prior.tonnesCu*100};
 });
 const values=Object.fromEntries(rows.map(r=>[r.id,r.observation.tonnesCu]));
 const partition=(id,label,total,parts)=>{const vs=parts.map(p=>values[p]),sum=vs.some(v=>v==null)?null:vs.reduce((a,b)=>a+b,0);return {id,label,totalId:total,partIds:parts,publishedTonnesCu:values[total],componentTonnesCu:sum,differenceTonnesCu:sum===null||values[total]===null?null:sum-values[total]};};
 return {year,periodStart:`${year}-01-01`,periodEnd:`${year}-12-31`,rows,reconciliations:[
  partition('national','Codelco own + other producers','cl-mine',['cl-codelco-own','cl-private-total']),
  partition('codelco','Seven Codelco divisions','cl-codelco-own',rows.filter(r=>r.entityKind==='division').map(r=>r.id)),
  partition('private','Ten named private operations + other operations','cl-private-total',[...rows.filter(r=>r.entityKind==='operation').map(r=>r.id),'cl-other-private']),
  partition('refined','SX-EW + electrorefined cathodes','cl-refined',['cl-sxew','cl-electrorefined'])],
  scope:'Reconciliation of explicit reporting partitions only. No mine/smelter/refined sum, process recovery, available supply or future-output estimate.'};
}
