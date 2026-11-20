// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Item edits on a parsed SAVE. Server-managed items (catfood and the rare, platinum and legend tickets) also get a
// change record (records.js, kind "managed_items", payload "<amount>_<time>_<type>_<get|use>"), which the upload
// step sends with the transfer so the server accepts the new balance.
const records=require('./records');

// CanBot's item limits (limits are on unless the session turns maxes off).
const LIMITS={catfood:45000,xp:99999999,normal_tickets:2999,rare_tickets:299,platinum_tickets:9,legend_tickets:4,np:9999,leadership:9999};
const FIELD={catfood:'catfood',xp:'xp',normal_tickets:'normalTickets',rare_tickets:'rareTickets',platinum_tickets:'platinumTickets',legend_tickets:'legendTickets',platinum_shards:'platinumShards',np:'np',leadership:'leadership'};
const MANAGED={catfood:'catfood',rare_tickets:'rareTicket',platinum_tickets:'platinumTicket',legend_tickets:'legendTicket'};
const KIND='managed_items';
const PLATINUM_SHARDS_MIN_GV=100600;

const fail=(code,message)=>Object.assign(new Error(message),{code});
// Leadership is a 16-bit field, the rest 32-bit (the field's range applies when maxes are off).
function limit(save,name){
  const {cap}=require('./settings');
  if(name==='platinum_shards')return cap(Math.max(0,(LIMITS.platinum_tickets-save.data.platinumTickets)*10+9));
  return cap(LIMITS[name],name==='leadership'?15:31);
}

// Managed records: parsed from orderIds in order; writing removes them all and appends the list at the end.
function managedItems(save){
  const out=[];
  for(const entry of save.data.orderIds){
    const body=records.payload(entry,KIND);if(body===null)continue;
    const [amount,at,type,detail]=body.split('_');
    out.push({amount:Number(amount)||0,at:Number(at)||0,type:type||'catfood',detail:detail||'get'});
  }
  return out;
}
function setManagedItems(save,items){
  save.data.orderIds=save.data.orderIds.filter(entry=>!records.isKind(entry,KIND));
  for(const m of items)save.data.orderIds.push(records.make(KIND,`${m.amount}_${m.at}_${m.type}_${m.detail}`));
}
const record=(change,type,now)=>({amount:Math.abs(change),at:now,type,detail:change>0?'get':'use'});

function setItem(save,name,value,{now=()=>Math.floor(Date.now()/1000)}={}){
  if(!Object.hasOwn(FIELD,name))throw fail('INVALID_INPUT','Unsupported item.');
  if(name==='platinum_shards'&&save.gameVersion<PLATINUM_SHARDS_MIN_GV)throw fail('ITEM_UNSUPPORTED_VERSION','Platinum Shards are not stored by this game version.');
  const max=limit(save,name);
  if(typeof value!=='number'||!Number.isSafeInteger(value))throw fail('INVALID_INPUT',`Value must be an integer between 0 and ${max}.`);
  if(value>max)throw fail('ITEM_VALUE_OUT_OF_RANGE',`Value must be an integer between 0 and ${max}.`);
  if(value<0)throw fail('INVALID_INPUT',`Value must be an integer between 0 and ${max}.`);
  const field=FIELD[name],change=value-save.data[field];
  save.data[field]=value;
  if(MANAGED[name])setManagedItems(save,[...managedItems(save),record(change,MANAGED[name],now())]);
}
// Several edits of one managed item collapse into one net change against the values before editing.
function reconcileManaged(save,original,touched,{now=()=>Math.floor(Date.now()/1000)}={}){
  const names=[...new Set(touched)].filter(n=>MANAGED[n]);if(!names.length)return;
  const types=new Set(names.map(n=>MANAGED[n]));
  const items=managedItems(save).filter(m=>!types.has(m.type));
  for(const name of Object.keys(MANAGED)){if(!names.includes(name))continue;const change=save.data[FIELD[name]]-original[name];if(change)items.push(record(change,MANAGED[name],now()));}
  setManagedItems(save,items);
}
const itemValues=save=>Object.fromEntries(Object.entries(FIELD).filter(([,f])=>f in save.data).map(([n,f])=>[n,save.data[f]]));

module.exports={setItem,reconcileManaged,managedItems,setManagedItems,itemValues,limit,LIMITS,FIELD,MANAGED};
