// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Map clears. Each category is a set of
// maps -> crowns (stars) -> stages. Clearing a stage raises the crown's progress, sets the clear count and marks the
// crown played (unlock state 3); clearing the last stage opens the next crown and the next map - but only for the
// event containers: the others do not carry their stage total in this path. Unclearing lowers progress,
// zeroes the stage and closes later crowns (and the next map when it is the first crown). Zero Legends and the
// Catclaw dojo do not store those unlock changes.
const fail=(code,message)=>Object.assign(new Error(message),{code});
const MAPS={
  sol:{kind:'event',type:0,code:'N',base:0},
  event:{kind:'event',type:1,code:'S',base:1000},
  collab:{kind:'event',type:2,code:'C',base:2000},
  uncanny:{kind:'chapters',path:['uncanny'],code:'NA',base:13000},
  catamin_stages:{kind:'chapters',path:['cataminStages'],code:'B',base:14000},
  towers:{kind:'chapters',path:['tower'],code:'V',base:7000},
  gauntlets:{kind:'chapters',path:['gauntlets'],code:'A',base:24000},
  collab_gauntlets:{kind:'chapters',path:['collabGauntlets'],code:'CA',base:27000},
  behemoth_culling:{kind:'chapters',path:['behemothCulling'],code:'Q',base:31000},
  clear_enigma_stages:{kind:'chapters',path:['enigmaClears'],code:'H',base:25000},
  legend_quest:{kind:'legend',path:['legendQuest'],code:'D',base:16000},
  zero_legends:{kind:'zero',path:['zeroLegends'],code:'ND',base:34000},
  dojo_catclaw_championships:{kind:'zero',path:['block140000','dojoChapters'],code:'G',base:37000,noR:true},
};
const MAX_CLEAR=9999;
function integer(v,max,name){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw fail('INVALID_INPUT',`${name} must be an integer between 0 and ${max}.`);return v;}

// One adapter shape for every layout: maps(), stars(m), stages(m,s), progress/unlock/clear get+set.
function adapter(save,def){
  const d=save.data;
  if(def.kind==='event'){
    const e=d.eventStages,t=def.type;
    return {event:true,maps:()=>e.subchapters,stars:()=>e.stars,stages:()=>e.stagesPer,
      progress:(m,s,v)=>v===undefined?e.progress[t][m][s]:(e.progress[t][m][s]=v),unlock:(m,s,v)=>v===undefined?e.unlock[t][m][s]:(e.unlock[t][m][s]=v),
      clear:(m,s,i,v)=>v===undefined?e.clears[t][m][i][s]:(e.clears[t][m][i][s]=v)};
  }
  const c=def.path.reduce((o,k)=>o?.[k],d);if(!c)return null;
  if(def.kind==='chapters'){
    const n=c.chapters1??c.chapters,stars=c.stars1??c.stars,stages=c.stages3??c.stages;
    return {maps:()=>n,stars:()=>stars,stages:()=>stages,
      progress:(m,s,v)=>v===undefined?c.progress[m][s]:(c.progress[m][s]=v),unlock:(m,s,v)=>v===undefined?c.unlock[m][s]:(c.unlock[m][s]=v),
      clear:(m,s,i,v)=>v===undefined?c.clears[m][i][s]:(c.clears[m][i][s]=v)};
  }
  if(def.kind==='legend'){
    return {legend:true,maps:()=>c.chapters,stars:()=>c.stars,stages:()=>c.stages,
      progress:(m,s,v)=>v===undefined?c.progress[m][s]:(c.progress[m][s]=v),unlock:(m,s,v)=>v===undefined?c.unlock[m][s]:(c.unlock[m][s]=v),
      clear:(m,s,i,v)=>{const sd=c.stagesData[m];if(v===undefined)return sd.clears[i][s];sd.clears[i][s]=v;sd.tries[i][s]=v;}};
  }
  // Zero Legends: per map a star list, per star its own stage list; unlock changes are not stored.
  const maps=c.items;
  return {zero:true,maps:()=>maps.length,stars:m=>maps[m].stars.items.length,stages:(m,s)=>maps[m].stars.items[s].clears.items.length,
    progress:(m,s,v)=>v===undefined?maps[m].stars.items[s].progress:(maps[m].stars.items[s].progress=v),unlock:()=>undefined,
    clear:(m,s,i,v)=>v===undefined?maps[m].stars.items[s].clears.items[i]:(maps[m].stars.items[s].clears.items[i]=v)};
}

function clearStage(a,m,s,i,amount){
  a.progress(m,s,Math.max(a.progress(m,s),i+1));a.clear(m,s,i,amount);a.unlock(m,s,3);
  const finished=a.event&&i===a.stages(m,s)-1;
  if(finished){if(s+1<a.stars(m))a.unlock(m,s+1,1);if(m+1<a.maps())a.unlock(m+1,0,1);}
}
function unclearStage(a,m,s,i){
  a.progress(m,s,Math.min(a.progress(m,s),i));a.clear(m,s,i,0);
  for(let k=s+1;k<a.stars(m);k++)a.unlock(m,k,0);
  if(m+1<a.maps()&&s===0)for(let k=0;k<a.stars(m+1);k++)a.unlock(m+1,k,0);
}

function context(save,gd,category){
  const def=MAPS[category];if(!def)throw fail('INVALID_INPUT','Unsupported map category.');
  const names=gd.mapNames(save.cc,def.code,def.base,def.noR),options=gd.mapOptions(),a=adapter(save,def);
  if(!options||!names||!names.names.size||!a)throw fail('INVALID_INPUT','Map metadata is unavailable.');
  return {def,names,options,a};
}
// display: also the stage names, a cleared mark per stage and crown, and the crowns the game defines (GUI tiles).
function metadata(save,gd,category,{display=false}={}){
  const {def,names,options,a}=context(save,gd,category),total=a.maps(),maps=[];
  for(const [index,name] of [...names.names.entries()].sort((x,y)=>x[0]-y[0])){
    if(index<0||index>=total)continue;
    const option=options.get(def.base+index),max=a.stars(index),stars=option?Math.min(max,option.crowns):max;
    const stageNames=names.stageNames.get(index)?.filter(x=>x!=='＠');if(!stageNames||!stageNames.length)continue;
    const counts=Array.from({length:Math.max(0,stars)},(_,s)=>Math.min(stageNames.length,a.stages(index,s)));
    if(!counts.length||!counts.every(Boolean))continue;
    if(!display){maps.push({id:index,name:String(name??`Map ${index}`),stageCounts:counts});continue;}
    const row={id:index,name:String(name??`Map ${index}`),stages:stageNames.map(String),stageCounts:counts};
    try{row.clears=counts.map((n,s)=>Array.from({length:n},(_,i)=>{const v=a.clear(index,s,i);if(v===undefined)throw new Error('layout');return v?1:0;}));}catch{}
    if(option&&option.crowns>0)row.crownMax=option.crowns;
    maps.push(row);
  }
  return {maps,clearMax:MAX_CLEAR};
}
function validate(edit,meta){
  const byId=new Map(meta.maps.map(m=>[m.id,m])),index=edit.mapId;
  if(!Number.isInteger(index)||!byId.has(index))throw fail('INVALID_INPUT','Invalid map ID.');
  const entry=byId.get(index),star=integer(edit.star,entry.stageCounts.length-1,'Crown'),count=entry.stageCounts[star];
  if(edit.mode!=='whole'&&edit.mode!=='specific')throw fail('INVALID_INPUT','Invalid stage selection mode.');
  const stages=edit.mode==='whole'?Array.from({length:count},(_,i)=>i):edit.stages;
  if(!Array.isArray(stages)||!stages.length)throw fail('INVALID_INPUT','Select stages.');
  for(const s of stages)integer(s,count-1,'Stage');
  const clear=edit.clear??true;if(typeof clear!=='boolean')throw fail('INVALID_INPUT','Invalid clear operation.');
  const amount=integer(edit.amount??1,meta.clearMax,'Clear count');
  return {index,star,stages:[...new Set(stages)].sort((x,y)=>x-y),clear,amount,stageCount:count,hasNextCrown:star+1<entry.stageCounts.length,hasNextMap:byId.has(index+1)};
}
function execute(a,def,plan){
  const {index,star}=plan;
  for(const s of plan.stages)plan.clear?clearStage(a,index,star,s,plan.amount):unclearStage(a,index,star,s);
  if(def.kind!=='event'||def.type!==0||!plan.clear||!plan.amount)return;
  // Stories of Legend: after the real last stage (before padding), open the next crown and map.
  const slots=a.stages(index,star);
  if(slots<=plan.stageCount)return;
  for(let i=0;i<plan.stageCount;i++)if(!(a.clear(index,star,i)>0))return;
  if(plan.hasNextCrown&&a.unlock(index,star+1)===0)a.unlock(index,star+1,1);
  if(plan.hasNextMap&&a.unlock(index+1,0)===0)a.unlock(index+1,0,1);
}
function applyMap(save,gd,edit){const meta=metadata(save,gd,edit.category),plan=validate(edit,meta),{def,a}=context(save,gd,edit.category);execute(a,def,plan);}
function applyMapBatch(save,gd,edit){
  const ids=edit.mapIds;if(!Array.isArray(ids)||!ids.length||ids.some(i=>!Number.isInteger(i)))throw fail('INVALID_INPUT','Select maps.');
  const meta=metadata(save,gd,edit.category),plans=[...new Set(ids)].map(i=>validate({...edit,mapId:i},meta)),{def,a}=context(save,gd,edit.category);
  for(const p of plans)execute(a,def,p);
}
// Max Account map scopes: every crown of every listed map, cleared once.
function prepareCategories(save,gd,categories){
  if(!Array.isArray(categories)||categories.some(c=>typeof c!=='string'||!MAPS[c]))throw fail('INVALID_INPUT','Invalid map categories.');
  const out=[];
  for(const category of [...new Set(categories)]){
    const meta=metadata(save,gd,category);if(!meta.maps.length)throw fail('INVALID_INPUT','No maps available for the selected category.');
    const {def,a}=context(save,gd,category);
    for(const m of meta.maps)for(let s=0;s<m.stageCounts.length;s++)out.push([a,def,validate({mapId:m.id,star:s,mode:'whole',amount:1,clear:true},meta)]);
  }
  return out;
}

module.exports={applyMap,applyMapBatch,prepareCategories,execute,metadata,MAPS};
