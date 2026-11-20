// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Searchable collections (skills, Enigma stages, endless items, storage, rank rewards, enemy guide, medals, missions,
// talent orbs, scheme items, event tickets): what each offers (catalog) and the edit (apply).
const {SaveDouble}=require('./binary');
const fail=(code,message)=>Object.assign(new Error(message),{code});
function integer(v,max,name='Value'){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw fail('INVALID_INPUT',`${name} must be an integer between 0 and ${max}.`);return v;}
const MAX={talentOrbs:998,eventTickets:9999};
const CATEGORY={eventTickets:1,skills:2,battleItems:3,lucky1:8,lucky2:10};

// Dictionary semantics on a list of [key, value] pairs: an existing key keeps its place, a new key is appended.
const dictHas=(pairs,k)=>pairs.some(p=>p[0]===k);
function dictSet(pairs,k,v){const p=pairs.find(x=>x[0]===k);if(p)p[1]=v;else pairs.push([k,v]);}
// Counted lists ({n, items}) are written with their current length.
const sync=c=>{c.n=c.items.length;};

function orbMaximum(save){return Math.min(MAX.talentOrbs,save.gameVersion<110400?127:32767);}
function setOrb(save,id,value){const o=save.data.talentOrbs,e=o.items.find(x=>x.id===id);if(e)e.value=value;else o.items.push({id,value});sync(o);}

function eventTicketSlots(save,gd){
  const buy=gd.gatyaItemBuy(),names=gd.gatyaItemNames(save.cc),d=save.data;
  if(!buy||!buy.length||!names||!names.length)throw fail('EVENT_TICKET_METADATA_UNAVAILABLE','Ticket data unavailable.');
  const arrays=new Map();
  if(save.gameVersion>=21)arrays.set(CATEGORY.eventTickets,d.eventCapsules);
  if(save.gameVersion>=77)arrays.set(CATEGORY.lucky1,d.luckyTickets);
  if(save.gameVersion>=100400)arrays.set(CATEGORY.lucky2,d.eventCapsules2.items);
  const slots=new Map();
  for(const item of buy){
    const balances=arrays.get(item.category);
    if(!balances||!(item.index>=0&&item.index<balances.length)||!(item.id>=0&&item.id<names.length))continue;
    const name=names[item.id].trim();
    if(name&&!['-','?','？','＠'].includes(name))slots.set(item.id,{balances,index:item.index,name});
  }
  if(!slots.size)throw fail('EVENT_TICKET_STORAGE_UNAVAILABLE','No ticket storage.');
  return slots;
}

function userRank(save){
  const d=save.data;let rank=0;
  d.catsUnlocked.forEach((u,i)=>{if(u){const up=d.catsUpgrade[i];rank+=up.base+1+up.plus;}});
  d.specialSkills.forEach((s,i)=>{if(i!==1)rank+=s.base+1+s.plus;});
  return rank;
}

function catalog(save,gd,kind){
  const d=save.data,unavailable=()=>fail('COLLECTION_DATA_UNAVAILABLE',`${kind} data unavailable.`);
  if(kind==='skills'){
    const items=gd.gatyaByCategory(CATEGORY.skills),abilities=gd.abilityData(),count=d.specialSkills.length-1;
    if(!items||!abilities||Math.min(items.length,abilities.length)<count)throw unavailable();
    const entries=items.slice(0,count).map((it,i)=>({id:i,baseMax:abilities[i].maxBase,plusMax:abilities[i].maxPlus}));
    return {entries};
  }
  if(kind==='enigma'){const m=gd.mapNames(save.cc,'H',25000);if(!m)throw unavailable();return {entries:[...m.names.keys()].sort((a,b)=>a-b).map(id=>({id})),actions:['append','replace']};}
  if(kind==='endless'){
    if(save.gameVersion<100300)throw fail('COLLECTION_UNSUPPORTED_VERSION','Not stored by this game version.');
    const names=gd.gatyaItemNames(save.cc),items=gd.gatyaByCategory(CATEGORY.battleItems),n=d.battleItems.length;
    if(!names||!items)throw unavailable();
    if(items.some(it=>it.id>=names.length))throw unavailable();
    if(items.length<n)throw unavailable();
    return {entries:items.slice(0,n).map((_,i)=>({id:i})),duration:true};
  }
  if(kind==='storage_skills'){
    const items=gd.gatyaByCategory(CATEGORY.skills);if(!items)throw unavailable();
    return {entries:items.map((_,i)=>({id:i})),maximum:d.storageTypes.filter(t=>t===0).length};
  }
  if(kind==='rank_rewards'){
    const gifts=gd.rankGifts();if(!gifts)throw unavailable();
    const desc=gd.rankGiftDescriptions(),rank=userRank(save),entries=[];
    for(const g of [...gifts].sort((a,b)=>a.threshold-b.threshold)){
      if(g.threshold>rank||!(g.index>=0&&g.index<d.userRankRewards.length))continue;
      if(!desc||!desc.some(x=>x.threshold===g.threshold))throw unavailable();
      entries.push({id:g.index,threshold:g.threshold});
    }
    return {entries,actions:['claimed','unclaimed']};
  }
  if(kind==='enemy_guide')return {entries:d.enemyGuide.map((_,id)=>({id})),actions:['add','remove']};
  if(kind==='medals'){const names=gd.medalNames();if(!names)throw unavailable();return {entries:names.map((_,id)=>({id})).filter((_,i)=>names[i].length),actions:['add','remove']};}
  if(kind==='missions'){
    const names=gd.missionNames(save.cc),conditions=gd.missionConditions();if(!names||!conditions)throw unavailable();
    const entries=[...names.keys()].filter(id=>dictHas(d.missions.clearStates,id)&&conditions.has(id)).map(id=>({id}));
    return {entries,actions:['reward','claimed','remove']};
  }
  if(kind==='talent_orbs'){const orbs=gd.orbList();if(!orbs)throw unavailable();return {entries:orbs.map(o=>({id:o.id})),maximum:orbMaximum(save)};}
  if(kind==='scheme_items'){
    const rows=gd.schemeItems();if(!rows)throw unavailable();const loc=gd.localizable();
    for(const r of rows)if(!loc||!loc.has(`scheme_popup_${r.id}`))throw unavailable();
    return {entries:rows.map(r=>({id:r.id})),actions:['add','remove']};
  }
  if(kind==='storage')return {entries:d.storageTypes.map((t,id)=>({id,t})).filter(x=>x.t).map(({id})=>({id})),actions:['remove']};
  if(kind==='event_tickets'){const slots=eventTicketSlots(save,gd);return {entries:[...slots].map(([id,s])=>({id,name:s.name,value:s.balances[s.index]})),maximum:MAX.eventTickets};}
  throw fail('INVALID_INPUT','Unsupported collection.');
}

function selection(edit,valid){
  const ids=edit.ids;
  if(!Array.isArray(ids)||!ids.length||ids.some(i=>typeof i!=='number'||!Number.isSafeInteger(i)||!valid.has(i)))throw fail('INVALID_INPUT','Invalid collection selection.');
  return [...new Set(ids)];
}

// now(): seconds (float) for Enigma start times and endless item windows.
function apply(save,gd,edit,{now=()=>Date.now()/1000}={}){
  const kind=edit.collection,d=save.data;
  if(kind==='event_tickets'){
    const slots=eventTicketSlots(save,gd),ids=selection(edit,new Set(slots.keys())),value=integer(edit.value,MAX.eventTickets);
    for(const i of ids){const s=slots.get(i);s.balances[s.index]=value;}
    return;
  }
  const meta=catalog(save,gd,kind),ids=selection(edit,new Set(meta.entries.map(e=>e.id))),action=edit.action;
  if(meta.actions&&!meta.actions.includes(action))throw fail('INVALID_INPUT','Invalid collection action.');
  const value='maximum' in meta?integer(edit.value,meta.maximum):null;
  if(kind==='skills'){
    const picked=meta.entries.filter(e=>ids.includes(e.id));
    const base=integer(edit.base,Math.min(...picked.map(e=>e.baseMax))),plus=integer(edit.plus,Math.min(...picked.map(e=>e.plusMax)));
    if(base<1)throw fail('INVALID_INPUT','Base level must be at least 1.');
    for(const e of picked){
      const b=Math.min(base-1,e.baseMax-1),p=Math.min(plus,e.plusMax),targets=e.id===0?[0,1]:[e.id+1];
      for(const t of targets){if(b!==-1)d.specialSkills[t].base=b;if(p!==-1)d.specialSkills[t].plus=p;}
    }
    d.rankUpSaleValue=0x7fffffff;
  }
  else if(kind==='enigma'){
    const st=d.enigma.stages,existing=action==='replace'?[]:[...st.items];
    if(existing.length+ids.length>127)throw fail('INVALID_INPUT','Too many Enigma stages.');
    if(action==='replace')for(const s of st.items)dictSet(d.eventCompletionCount,s.stageId,0);
    for(const i of ids){const abs=i+25000;dictSet(d.eventCompletionCount,abs,0);existing.push({level:3,stageId:abs,decoding:2,startTime:new SaveDouble(Math.floor(now()))});}
    st.items=existing;sync(st);
  }
  else if(kind==='endless'){
    const raw=edit.value;let mins;
    if(raw==='infinity')mins=Infinity;
    else if(typeof raw==='number'&&Number.isFinite(raw)&&raw>=0&&Number.isFinite(raw*60))mins=raw;
    else throw fail('INVALID_INPUT','Invalid duration.');
    for(const i of ids){const e=d.endlessItems[i],start=now();e.a=true;e.b=true;e.c=0;e.d=new SaveDouble(start);e.e=new SaveDouble(start+mins*60);}
  }
  else if(kind==='storage_skills'){
    if(value*ids.length>meta.maximum)throw fail('INVALID_INPUT','Not enough storage space.');
    for(const i of ids)for(let k=0;k<value;k++){const slot=d.storageTypes.indexOf(0);if(slot<0)break;d.storageTypes[slot]=2;d.storageIds[slot]=i;}
  }
  else if(kind==='rank_rewards')for(const i of ids)d.userRankRewards[i]=action==='claimed';
  else if(kind==='enemy_guide')for(const i of ids)d.enemyGuide[i]=action==='add'?1:0;
  else if(kind==='medals'){
    const m=d.medals;
    for(const i of ids){
      if(action==='add'){if(m.list1.items.includes(i))continue;m.list1.items.push(i);const e=m.list2.items.find(x=>x.key===i);if(e)e.value=0;else m.list2.items.push({key:i,value:0});}
      else{m.list2.items=m.list2.items.filter(x=>x.key!==i);const at=m.list1.items.indexOf(i);if(at>=0)m.list1.items.splice(at,1);}
    }
    sync(m.list1);sync(m.list2);
  }
  else if(kind==='missions'){
    const conditions=gd.missionConditions(),ms=d.missions;
    for(const i of ids){
      dictSet(ms.clearStates,i,{reward:2,claimed:4,remove:0}[action]);
      const c=conditions.get(i);
      if(action!=='remove'&&c)dictSet(ms.requirements,i,c.progressCount);
      else if(action==='remove'&&dictHas(ms.requirements,i))dictSet(ms.requirements,i,0);
    }
  }
  else if(kind==='talent_orbs')for(const i of ids)setOrb(save,i,value);
  else if(kind==='scheme_items'){
    for(const i of ids){
      if(action==='add'&&!d.schemeToObtain.includes(i))d.schemeToObtain.push(i);
      if(action==='remove'){const at=d.schemeToObtain.indexOf(i);if(at>=0)d.schemeToObtain.splice(at,1);}
      const r=d.schemeReceived.indexOf(i);if(r>=0)d.schemeReceived.splice(r,1);
    }
  }
  else if(kind==='storage')for(const i of ids){d.storageTypes[i]=0;d.storageIds[i]=0;}
}

// Max Account helpers.
function maxHighestTalentOrbs(save,gd){
  const orbs=gd.orbList();if(!orbs)throw fail('COLLECTION_DATA_UNAVAILABLE','Talent orb data unavailable.');
  const best=new Map();
  for(const o of orbs){const key=`${o.target}|${o.effect}`,cur=best.get(key);if(!cur||o.rank>cur.rank)best.set(key,o);}
  if(!best.size)throw fail('COLLECTION_DATA_UNAVAILABLE','Talent orb data is empty.');
  const max=orbMaximum(save);for(const o of best.values())setOrb(save,o.id,max);
}
function unlockAllEnemies(save){const g=save.data.enemyGuide;if(!g.length)throw fail('COLLECTION_DATA_UNAVAILABLE','Enemy guide unavailable.');g.fill(1);}

module.exports={apply,catalog,maxHighestTalentOrbs,unlockAllEnemies,userRank};
