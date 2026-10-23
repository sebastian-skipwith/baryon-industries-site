// Manufacturing gross product mass. No copper conversion, demand or supply inference.
export const US_SEMIFABRICATES_SOURCE_SHA='7557067fc331a3b01ea8d24935e274edd6d075fb9e9315d2684d78948849f822';
export const US_SEMIFABRICATES_SHA='b3efafef24bf68440d4d5e69528da0bde425e04572dc9634826c0e76cce9c27e';
const keys=['brassProduction','wireProduction','brassShipments','wireShipments','brassStocks','wireStocks'];
const periods=['2024-01:09','2024-07:09','2024-10','2024-11','2024-12','2024-01:12',...Array.from({length:9},(_,i)=>`2025-${String(i+1).padStart(2,'0')}`),'2025-01:09'];
const previousDay=day=>new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);
export function validateUsSemifabricates(d){
 if(d?.schemaVersion!==1||d.id!=='us-semifabricates-2025q3-v1'||d.kind!=='reported_semifabricate_activity'||d.country!=='US'||d.unit!=='t gross product')throw Error('Manufacturing identity or mass basis mismatch');
 if(d.source?.rawSha256!==US_SEMIFABRICATES_SOURCE_SHA||d.source.table!==6||d.source.pdfPage!==9||d.source.publicationDate!=='2026-05')throw Error('Manufacturing source mismatch');
 if(!Array.isArray(d.rows)||JSON.stringify(d.rows.map(r=>r.period?.id))!==JSON.stringify(periods))throw Error('Manufacturing periods mismatch');
 for(const {period:p,values:v} of d.rows){
  const [year,first,last]=p.id.includes(':')?[Number(p.id.slice(0,4)),Number(p.id.slice(5,7)),Number(p.id.slice(8))]:[Number(p.id.slice(0,4)),Number(p.id.slice(5)),Number(p.id.slice(5))];
  const start=`${year}-${String(first).padStart(2,'0')}-01`,end=new Date(Date.UTC(year,last,0)).toISOString().slice(0,10);
  const kind=first===last?'month':last===12?'year':first===7?'quarter':'year_to_date';
  if(p.start!==start||p.end!==end||p.kind!==kind)throw Error('Manufacturing interval mismatch');
  if(!v||Object.keys(v).sort().join()!==[...keys].sort().join()||keys.some(k=>v[k]!==null&&(!Number.isSafeInteger(v[k])||v[k]<0)))throw Error('Invalid manufacturing quantity');
 }
 // End-of-period inventories repeated for monthly/aggregate rows must agree.
 for(const p of d.rows)for(const q of d.rows)if(p.period.end===q.period.end)for(const k of ['brassStocks','wireStocks'])if(p.values[k]!==q.values[k])throw Error('Conflicting repeated inventory snapshot');
 for(const key of ['containedCopperTonnes','finalDemandTonnes','facilityAllocation','availableForPurchaseTonnes'])if(d.unknowns?.[key]!==null)throw Error('Unsupported manufacturing inference');
 return d;
}
export function selectUsSemifabricates(dataset,id){
 const d=validateUsSemifabricates(dataset),row=d.rows.find(r=>r.period.id===id);
 if(!row)throw Error('Unknown manufacturing period');
 const openingDate=previousDay(row.period.start),opening=d.rows.find(r=>r.period.end===openingDate);
 return {period:{...row.period},unit:d.unit,openingDate,categories:[['brass','Brass mills'],['wire','Wire-rod mills']].map(([key,name])=>{
  const production=row.values[key+'Production'],shipments=row.values[key+'Shipments'],closingStocks=row.values[key+'Stocks'],openingStocks=opening?.values[key+'Stocks']??null;
  const stockChange=openingStocks===null||closingStocks===null?null:closingStocks-openingStocks;
  return {id:key,name,production,shipments,closingStocks,openingStocks,stockChange,
   residual:production===null||shipments===null||stockChange===null?null:production-shipments-stockChange};
 }),unknowns:{...d.unknowns}};
}
