import {validateCopperDemandContext} from '/assets/copper-demand-context.mjs?v=20261023h';
const copy=value=>value===null?null:JSON.parse(JSON.stringify(value));
let selected=null,revision=0;
const listeners=new Set();
const notify=()=>{for(const listener of listeners)listener(copy(selected));};
export const getCopperContextSelection=()=>copy(selected);
export function cancelCopperContextSelection(){++revision;}
export function clearCopperContextSelection(){++revision;selected=null;notify();}
export async function selectCopperContext(report){
 const requested=++revision,snapshot=copy(report);
 const verified=await validateCopperDemandContext(snapshot);
 if(!verified.flows||!verified.sources.flows)throw Error('This context needs a reviewed US account before attaching it to the buyer workflow.');
 if(requested!==revision)return false;
 selected=verified;notify();return true;
}
export function onCopperContextSelection(listener){listeners.add(listener);return ()=>listeners.delete(listener);}
