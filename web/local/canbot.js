#!/usr/bin/env node
// canbot.js - CanBot local editor (built by tools/local/build.js; do not edit by hand).
// SPDX-License-Identifier: AGPL-3.0-or-later  Copyright (C) 2026 CanBot  https://www.gnu.org/licenses/agpl-3.0.html
// Termux: pkg install nodejs   then   node canbot.js
'use strict';
(function(){
const __files={
"src/canbot-engine/apply.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// A whole SAVE request's edit list: Max Account / Max All first, then the other edits in order; user-rank rewards
// claimed around each edit when the session asks for it; managed-item records reconciled to one net change at the end.
const items=require('./items'),cats=require('./cats'),levels=require('./levels'),talents=require('./talents'),story=require('./story');
const maps=require('./maps'),expedition=require('./expedition'),collections=require('./collections'),extra=require('./extra');
const {maxAccount,maxResources}=require('./maxaccount');
const misc=require('./misc'),settingsModule=require('./settings');
const fail=(code,message)=>Object.assign(new Error(message),{code});
const MANAGED=Object.keys(items.MANAGED);
const BROAD=new Set(['max_account','max_all']);
const SUPPORTED_TYPES=new Set(['item','cat','max_all','max_account','story_clear','treasures','timed_scores','outbreaks','playtime','inventory','gacha_seed','special_skills','map','map_batch','expedition','collection','extra','clear_to_japan','simple','score']);
const CAT_LEVEL=new Set(['max_upgrade','upgrade_by','set_level','max_base_plus','max_talents','storage_add']);

function unsupportedReason(edits,settings){
  for(const e of edits){
    if(!SUPPORTED_TYPES.has(e?.type))return `type:${String(e?.type).slice(0,30)}`;
    if(e.type==='cat'&&!cats.OPERATIONS.includes(e.operation)&&!CAT_LEVEL.has(e.operation))return `cat:${String(e.operation).slice(0,30)}`;
  }
  return '';
}
function claimRankRewards(save,gd){
  const gifts=gd.rankGifts();if(!gifts)throw fail('RANK_REWARDS_UNAVAILABLE','User-rank reward metadata unavailable.');
  const rank=collections.userRank(save),rewards=save.data.userRankRewards;
  for(const g of gifts)if(g.threshold<=rank){if(!(g.index>=0&&g.index<rewards.length))throw fail('RANK_REWARDS_UNAVAILABLE','User-rank reward data is incomplete.');rewards[g.index]=true;}
}
function catIds(edit){
  const ids=edit.catIds??[edit.catId];if(!Array.isArray(ids)||!ids.length)throw fail('INVALID_INPUT','catIds must contain at least one Cat ID.');
  for(const v of ids)if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw fail('INVALID_INPUT','catId must be an integer >= 0.');
  return [...new Set(ids)];
}
function applyOne(save,gd,edit,opts){
  const t=edit.type,d=save.data;
  if(t==='item')return items.setItem(save,edit.item,edit.value,{now:()=>Math.floor(opts.now())});
  if(t==='max_all')return maxResources(save,{now:opts.now});
  if(t==='max_account')return maxAccount(save,gd,edit,{now:opts.now});
  if(t==='cat'){
    const ids=catIds(edit),op=edit.operation;
    if(op==='storage_add')return misc.storageAdd(save,ids,edit.amount);
    if(op==='max_talents')return talents.maxTalents(save,gd,ids);
    if(op==='max_base_plus'){levels.maxBasePlus(save,gd,ids);d.rankUpSaleValue=0x7fffffff;return;}
    if(op==='set_level'){levels.setLevel(save,gd,ids,edit.base,edit.plus);d.rankUpSaleValue=0x7fffffff;return;}
    if(op==='max_upgrade'){levels.maxUpgrade(save,gd,ids);d.rankUpSaleValue=0x7fffffff;return;}
    if(op==='upgrade_by'){levels.upgradeBy(save,gd,ids,edit.amount);d.rankUpSaleValue=0x7fffffff;return;}
    return cats.applyCatOperation(save,gd,op,ids);
  }
  if(['story_clear','treasures','timed_scores','outbreaks'].includes(t))return story.applyStory(save,edit,{random:opts.random});
  if(t==='playtime')return story.setPlaytime(save,edit);
  if(t==='inventory')return story.setInventory(save,edit);
  if(t==='gacha_seed')return story.setSeed(save,edit);
  if(t==='special_skills')return story.setSkills(save,gd);
  if(t==='map')return maps.applyMap(save,gd,edit);
  if(t==='map_batch')return maps.applyMapBatch(save,gd,edit);
  if(t==='expedition')return expedition.apply(save,gd,edit);
  if(t==='collection')return collections.apply(save,gd,edit,{now:opts.now});
  if(t==='extra')return extra.apply(save,edit,{now:()=>Math.floor(opts.now()),random:opts.random});
  if(t==='clear_to_japan')return misc.clearToJapan(save,gd);
  if(t==='simple')return misc.simpleAction(save,edit,{now:opts.now,random:opts.random});
  if(t==='score')return misc.setScore(save,edit);
  throw fail('UNSUPPORTED_EDIT',`Unsupported edit type: ${t}`);
}
// opts: {now: () => seconds, random: () => [0,1)}.
function applyEdits(save,gd,edits,settings={},opts={}){
  const o={now:opts.now||(()=>Date.now()/1000),random:opts.random||Math.random};
  const touched=new Set();for(const e of edits){if(BROAD.has(e.type))MANAGED.forEach(n=>touched.add(n));else if(e.type==='item'&&MANAGED.includes(e.item))touched.add(e.item);}
  const original={};for(const n of touched){const v=save.data[items.FIELD[n]];if(Number.isSafeInteger(v))original[n]=v;}
  const plan=[...edits.filter(e=>BROAD.has(e.type)),...edits.filter(e=>!BROAD.has(e.type))];
  for(const e of plan){
    const claim=(e.settings||settings).claim_user_rank_rewards===true;
    // Settings: the edit's own or the request's, one edit at a time.
    settingsModule.use(settingsModule.fromSession(e.settings||settings),()=>{
      if(claim)claimRankRewards(save,gd);
      applyOne(save,gd,e,o);
      if(claim)claimRankRewards(save,gd);
    });
  }
  items.reconcileManaged(save,original,[...touched].filter(n=>n in original),{now:()=>Math.floor(o.now())});
}
module.exports={applyEdits,unsupportedReason,SUPPORTED_TYPES};

},
"src/canbot-engine/binary.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Little-endian byte reader and writer for Battle Cats SAVE files. Every value is kept so that writing it back gives
// the same bytes: a bool keeps its raw byte (the game also stores 2 there), a variable-length int keeps how many bytes
// it used, a double keeps its exact 8 bytes while unchanged. The reader can log every read (start, length, kind) so a
// parse can be compared step by step with a reference trace.

class SaveReader{
  constructor(buffer,{end=buffer.length,log=null}={}){this.b=buffer;this.p=0;this.end=end;this.log=log;}
  take(n,kind){
    if(!Number.isSafeInteger(n)||n<0||this.p+n>this.end)throw Object.assign(new Error(`SAVE ends early: ${kind} of ${n} bytes at ${this.p}`),{code:'SAVE_TRUNCATED',offset:this.p});
    const start=this.p;this.p+=n;if(this.log)this.log.push({start,len:n,kind});return start;
  }
  int(){return this.b.readInt32LE(this.take(4,'int'));}
  uint(){return this.b.readUInt32LE(this.take(4,'uint'));}
  short(){return this.b.readInt16LE(this.take(2,'short'));}
  ushort(){return this.b.readUInt16LE(this.take(2,'ushort'));}
  byte(){return this.b.readInt8(this.take(1,'byte'));}
  ubyte(){return this.b.readUInt8(this.take(1,'ubyte'));}
  // The raw byte: 0 is false, anything else true; 2 stays 2.
  bool(){return this.b.readUInt8(this.take(1,'bool'));}
  long(){return this.b.readBigInt64LE(this.take(8,'long'));}
  double(){const at=this.take(8,'double');return new SaveDouble(this.b.readDoubleLE(at),this.b.subarray(at,at+8));}
  // 1 to 4 bytes, 7 bits each, high bit set on all but the last.
  varint(){let value=0,n=0;for(;n<4;){const byte=this.b.readUInt8(this.take(1,'varint'));n++;value=(value<<7|(byte&0x7f))>>>0;if(!(byte&0x80))break;}return new SaveVarint(value,n);}
  bytes(n){const at=this.take(n,'bytes');return Buffer.from(this.b.subarray(at,at+n));}
  string(){const n=this.int(),at=this.take(n,'string');return new SaveString(this.b.subarray(at,at+n));}
  get remaining(){return this.end-this.p;}
}

// A double that writes its original 8 bytes until its value is changed (NaN payloads and -0 survive).
class SaveDouble{
  constructor(value,raw=null){this.value=value;this.raw=raw?Buffer.from(raw):null;}
  bytes(){if(this.raw&&Object.is(this.raw.readDoubleLE(0),this.value))return this.raw;const out=Buffer.alloc(8);out.writeDoubleLE(this.value);return out;}
  valueOf(){return this.value;}
  toJSON(){return this.value;}
}
// A variable-length int that keeps the byte count it was stored with.
class SaveVarint{
  constructor(value,size=null){this.value=value>>>0;this.size=size;}
  bytes(){const groups=[];let v=this.value;do{groups.unshift(v&0x7f);v>>>=7;}while(v);const want=Math.min(4,Math.max(groups.length,this.size||0));while(groups.length<want)groups.unshift(0);return Buffer.from(groups.map((g,i)=>i<groups.length-1?g|0x80:g));}
  valueOf(){return this.value;}
  toJSON(){return this.value;}
}
// A string that keeps its exact bytes (even if they are not valid UTF-8) until its text is changed.
class SaveString{
  constructor(raw){this.raw=Buffer.from(raw);this.text=this.original=this.raw.toString('utf8');}
  bytes(){return this.text===this.original?this.raw:Buffer.from(this.text,'utf8');}
  toString(){return this.text;}
  toJSON(){return this.text;}
}

// Writes into one buffer that doubles when full (a SAVE is about 500 KB, so a few growths at most). Out-of-range values
// throw (RangeError from Buffer) instead of being wrapped.
class SaveWriter{
  constructor(initial=600*1024){this.b=Buffer.allocUnsafe(initial);this.size=0;}
  room(n){if(this.size+n<=this.b.length)return;let cap=this.b.length*2;while(cap<this.size+n)cap*=2;const next=Buffer.allocUnsafe(cap);this.b.copy(next,0,0,this.size);this.b=next;}
  push(buf){this.room(buf.length);buf.copy(this.b,this.size);this.size+=buf.length;}
  int(v){this.room(4);this.b.writeInt32LE(v,this.size);this.size+=4;}
  uint(v){this.room(4);this.b.writeUInt32LE(v,this.size);this.size+=4;}
  short(v){this.room(2);this.b.writeInt16LE(v,this.size);this.size+=2;}
  ushort(v){this.room(2);this.b.writeUInt16LE(v,this.size);this.size+=2;}
  byte(v){this.room(1);this.b.writeInt8(v,this.size);this.size+=1;}
  ubyte(v){this.room(1);this.b.writeUInt8(v,this.size);this.size+=1;}
  bool(v){this.room(1);this.b.writeUInt8(typeof v==='boolean'?(v?1:0):v,this.size);this.size+=1;}
  long(v){this.room(8);this.b.writeBigInt64LE(BigInt(v),this.size);this.size+=8;}
  double(v){this.push(v instanceof SaveDouble?v.bytes():new SaveDouble(Number(v)).bytes());}
  varint(v){this.push(v instanceof SaveVarint?v.bytes():new SaveVarint(Number(v)).bytes());}
  bytes(v){this.push(Buffer.isBuffer(v)?v:Buffer.from(v));}
  string(v){const raw=v instanceof SaveString?v.bytes():Buffer.from(String(v),'utf8');this.int(raw.length);this.push(raw);}
  toBuffer(){return Buffer.from(this.b.subarray(0,this.size));}
}

module.exports={SaveReader,SaveWriter,SaveDouble,SaveVarint,SaveString};

},
"src/canbot-engine/cats.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Cat edits on a parsed SAVE, under the session settings (settings.js: reset cat data on removal, set the current
// form, unlock a cat when it is edited). Cats are addressed by id; the
// per-cat columns of the SAVE are indexed by the cat's position (= its id).
const fail=(code,message)=>Object.assign(new Error(message),{code});

function catIndex(save,id){if(!Number.isSafeInteger(id)||id<0||id>=save.data.catsUnlocked.length)throw fail('INVALID_INPUT',`Cat ID ${id} was not found.`);return id;}
const setAt=(list,i,v)=>{if(Array.isArray(list)&&i>=0&&i<list.length)list[i]=v;};
// The cat's talents entry (catId, talents) or undefined.
const talentsOf=(save,id)=>save.data.talents.find(t=>t.catId===id);
// chara_new_flags is a dictionary kept as [key, value] pairs; a new key goes to the end (insertion order).
function setNewFlag(save,id,value){const row=save.data.catsNewFlags.find(p=>p[0]===id);if(row)row[1]=value;else save.data.catsNewFlags.push([id,value]);}

function setDrops(save,gd,id,value){const drops=gd.dropsOf(id);if(!drops)return;for(const d of drops)setAt(save.data.unitDrops,d.saveId,value);}

function unlock(save,gd,id){
  const i=catIndex(save,id);
  save.data.catsUnlocked[i]=1;
  save.data.catsSeen[i]=1;
  setDrops(save,gd,id,1);
  // The equipment menu (menuUnlocks[2]) opens with the first cat.
  save.data.menuUnlocks[2]=Math.max(save.data.menuUnlocks[2],1);
}
function remove(save,gd,id){
  const i=catIndex(save,id),d=save.data;
  d.catsUnlocked[i]=0;
  if(!cfg().resetCatData)return;
  // reset_cat_data: everything about the cat goes back to zero.
  d.catsForm[i]=0;d.catsUnlockedForms[i]=0;d.catsSeen[i]=0;d.catGuideCollected[i]=0;
  setAt(d.catsFourthForm,i,0);setAt(d.catsCatseyesUsed,i,0);
  d.catsUpgrade[i].plus=0;d.catsUpgrade[i].base=0;
  for(const t of talentsOf(save,id)?.talents||[])t.level=0;
  setNewFlag(save,id,0);
  setDrops(save,gd,id,0);
}
const cfg=()=>require('./settings').get();
const editUnlock=(save,gd,id)=>{if(cfg().unlockOnEdit)unlock(save,gd,id);};
function setForm(save,gd,id,form){editUnlock(save,gd,id);const i=catIndex(save,id);save.data.catsUnlockedForms[i]=form+1;if(cfg().setCurrentForms)save.data.catsForm[i]=form;}
function unlockFourth(save,gd,id){const i=catIndex(save,id);if(cfg().setCurrentForms)save.data.catsForm[i]=3;save.data.catsUnlockedForms[i]=3;editUnlock(save,gd,id);setAt(save.data.catsFourthForm,i,2);}
function setFormTrue(save,gd,id,totalForms,fourth){
  const i=catIndex(save,id);
  if(totalForms===4&&fourth)unlockFourth(save,gd,id);
  else if(totalForms>=3)setForm(save,gd,id,2);
  else if(totalForms===2){save.data.catsUnlockedForms[i]=0;save.data.catsForm[i]=1;}
  else{save.data.catsUnlockedForms[i]=0;save.data.catsForm[i]=0;}
}
function forms(save,gd,ids,{fourth=false,force=false}={}){
  const book=gd.pictureBook();
  for(const id of ids){
    if(force){fourth?unlockFourth(save,gd,id):setForm(save,gd,id,2);continue;}
    const entry=book?.find(c=>c.catId===id);if(entry)setFormTrue(save,gd,id,entry.totalForms,fourth);
  }
}
function removeTrueForm(save,id){const i=catIndex(save,id),d=save.data;d.catsUnlockedForms[i]=0;d.catsForm[i]=Math.min(d.catsForm[i],1);setAt(d.catsFourthForm,i,0);}
function removeFourthForm(save,id){const i=catIndex(save,id),d=save.data;d.catsForm[i]=Math.min(d.catsForm[i],2);setAt(d.catsFourthForm,i,0);}
function catGuide(save,gd,id,on){if(on)editUnlock(save,gd,id);save.data.catGuideCollected[catIndex(save,id)]=on?1:0;}
function removeTalents(save,id){for(const t of talentsOf(save,id)?.talents||[])t.level=0;}
const setRankUpSale=save=>{save.data.rankUpSaleValue=0x7fffffff;};

// One operation on a list of cat ids (ids de-duplicated, in order),
// followed by the rank-up sale flag. Level and talent operations are not here yet.
const OPERATIONS=['unlock','remove','cat_guide','remove_cat_guide','true_form','force_true_form','remove_true_form','fourth_form','force_fourth_form','remove_fourth_form','remove_talents'];
function applyCatOperation(save,gd,operation,ids){
  if(!OPERATIONS.includes(operation))throw fail('INVALID_INPUT',`Unsupported cat operation: ${operation}`);
  const unique=[...new Set(ids)];if(!unique.length)throw fail('INVALID_INPUT','catIds must contain at least one Cat ID.');
  unique.forEach(id=>catIndex(save,id));
  if(operation==='true_form'||operation==='fourth_form'){
    const book=gd.pictureBook(),minimum=operation==='true_form'?3:4;
    const ok=unique.filter(id=>(book?.find(c=>c.catId===id)?.totalForms??0)>=minimum);
    if(!ok.length)throw fail('CAT_FORM_UNSUPPORTED','No selected cat has that form.');
    forms(save,gd,ok,{fourth:operation==='fourth_form'});
  }
  else if(operation==='force_true_form')forms(save,gd,unique,{force:true});
  else if(operation==='force_fourth_form')forms(save,gd,unique,{force:true,fourth:true});
  else for(const id of unique){
    if(operation==='unlock')unlock(save,gd,id);
    else if(operation==='remove')remove(save,gd,id);
    else if(operation==='cat_guide')catGuide(save,gd,id,true);
    else if(operation==='remove_cat_guide')catGuide(save,gd,id,false);
    else if(operation==='remove_true_form')removeTrueForm(save,id);
    else if(operation==='remove_fourth_form')removeFourthForm(save,id);
    else if(operation==='remove_talents')removeTalents(save,id);
  }
  setRankUpSale(save);
}

module.exports={applyCatOperation,OPERATIONS,unlock,editUnlock,remove,forms,catGuide};

},
"src/canbot-engine/codec.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Format building blocks. Each codec reads a value from a SaveReader and writes the same value to a SaveWriter, so the
// SAVE layout is described once (format.js) and serves both directions.
//   ctx    {gv, cc, jp}: game version as an integer (15.7.0 = 150700), region, and whether the region is JP
//   struct named fields in order; a field may be skipped with when(), and later fields may depend on earlier ones
//   list   items with a 4-byte count in front, a fixed count, or a count computed from what was read before

const prim=kind=>({kind,read:r=>r[kind](),write:(w,v)=>w[kind](v)});
const T={int:prim('int'),uint:prim('uint'),short:prim('short'),ushort:prim('ushort'),byte:prim('byte'),ubyte:prim('ubyte'),bool:prim('bool'),long:prim('long'),double:prim('double'),varint:prim('varint'),string:prim('string')};

// count: undefined (4-byte count first), a number, or (ctx, parent) => number.
function list(item,count){
  return {item,counted:count===undefined,
    read(r,ctx,parent){const n=count===undefined?r.int():typeof count==='function'?count(ctx,parent):count;if(!Number.isSafeInteger(n)||n<0||n>1e6)throw Object.assign(new Error(`Bad list length ${n} at ${r.p}`),{code:'SAVE_FORMAT_ERROR',offset:r.p});const out=new Array(n);for(let i=0;i<n;i++)out[i]=item.read(r,ctx,parent);return out;},
    write(w,v,ctx,parent){if(count===undefined)w.int(v.length);else{const n=typeof count==='function'?count(ctx,parent):count;if(n!==v.length)throw Object.assign(new Error(`List needs ${n} items, has ${v.length}`),{code:'SAVE_FORMAT_ERROR'});}for(const x of v)item.write(w,x,ctx,parent);},
  };
}
// A pair of values read one after the other, e.g. a dictionary entry (key, value).
const pair=(a,b)=>({pair:[a,b],read:(r,ctx,p)=>[a.read(r,ctx,p),b.read(r,ctx,p)],write:(w,v,ctx,p)=>{a.write(w,v[0],ctx,p);b.write(w,v[1],ctx,p);}});
const dict=(k,v,count)=>list(pair(k,v),count);
// fields: [name, codec] or when(pred, [name, codec]) items. The parent object is passed on so nested lengths and
// conditions can look at fields read earlier in the same struct.
function struct(fields){
  return {fields:fields.map(f=>f.when?f.field:f),
    read(r,ctx){const o={};for(const f of fields){if(f.when){if(!f.when(ctx,o))continue;o[f.field[0]]=f.field[1].read(r,ctx,o);}else o[f[0]]=f[1].read(r,ctx,o);}return o;},
    write(w,o,ctx){for(const f of fields){if(f.when){if(!f.when(ctx,o))continue;f.field[1].write(w,o[f.field[0]],ctx,o);}else f[1].write(w,o[f[0]],ctx,o);}},
  };
}
const when=(pred,field)=>({when:pred,field});
// The rest of the SAVE body that the format does not describe yet: kept as raw bytes so writing still reproduces it.
const rest={read:r=>r.bytes(r.remaining),write:(w,v)=>w.bytes(v)};

module.exports={T,list,pair,dict,struct,when,rest};

},
"src/canbot-engine/collections.js":function(module,exports,require){
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

},
"src/canbot-engine/compat.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Compatibility with earlier CanBot builds. By default the engine uses CanBot's own names: the "_canbot:" record key
// (records.js) and the METADATA_FAILED error code. Services that must answer exactly like the earlier editor switch
// to its names with use('legacy') or CANBOT_COMPAT=legacy: records then use only the "_bcsfe:" key and the metadata
// error code is BCSFE_METADATA_FAILED.
let legacy=typeof process!=='undefined'&&process.env?.CANBOT_COMPAT==='legacy';

function use(mode){
  if(mode!=='own'&&mode!=='legacy')throw new Error(`Unknown compatibility mode: ${mode}`);
  legacy=mode==='legacy';
}
const isLegacy=()=>legacy;

module.exports={use,isLegacy};

},
"src/canbot-engine/edit.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Safe edits on a parsed SAVE and a field-level change list.
//   set(save, path, value)  changes one primitive field after checking its kind and range. Fields that shape the file
//                           (counts, sizes, version markers) and account identity fields are refused: changing them
//                           would break the layout or the account.
//   diff(before, after)     the fields that differ, with identity values masked. Lists are compared item by item.
const format=require('./format');
const {SaveDouble,SaveVarint,SaveString}=require('./binary');

const RANGE={int:[-2147483648,2147483647],uint:[0,4294967295],short:[-32768,32767],ushort:[0,65535],byte:[-128,127],ubyte:[0,255],bool:[0,255],varint:[0,268435455]};
// Account identity: never changed here and never shown.
const IDENTITY=new Set(['transferCode','confirmationCode','inquiryCode','playerId','passwordRefreshToken','saveDataHash4']);
// Fields other fields depend on (counts and sizes) and the game's version markers.
// Entry names (key, catId, id) are refused too: changing one could duplicate another entry.
const STRUCTURAL=/(^marker|^(key|catId|id)$|Count$|^count$|^n$|^gameVersion$|^(types|subchapters|stars|stagesPer|chapters|stages)\d?$|^(itemReward|timedScore)(Subchapters|Stages|Stars)$|^legendRestriction(Types|Subchapters)$|^towerItemObtain(Stars|Stages)$|^levelCount$|^ototoSelectedPartsCount$|^lineupCount$)/;

const fail=(message,code='SAVE_EDIT_REFUSED')=>Object.assign(new Error(message),{code});
const parts=path=>Array.isArray(path)?path:String(path).split('.').map(p=>/^\d+$/.test(p)?Number(p):p);

// Walk the codec tree alongside the data to find the codec of the value at path.
function codecAt(save,path){
  let codec=format.save,value=save.data,dictKey=false;
  for(const key of parts(path)){
    if(codec===format.tail){
      // tail.sections.<i>.fields... -> the section's layout
      if(key==='sections'){value=value.sections;codec={tailSections:true};continue;}
      throw fail(`No field ${key} in the tail.`,'SAVE_EDIT_PATH');
    }
    if(codec?.tailSections){const s=value[key];if(!s?.fields)throw fail('This tail section is kept raw.','SAVE_EDIT_PATH');codec={section:format.TAIL.find(([m])=>m===s.marker)[1]};value=s;continue;}
    if(codec?.section){if(key!=='fields')throw fail('Use tail.sections.<i>.fields.<name>.','SAVE_EDIT_PATH');codec=codec.section;value=value.fields;continue;}
    if(codec?.fields){const f=codec.fields.find(([name])=>name===key);if(!f||!(key in value))throw fail(`No field ${key}.`,'SAVE_EDIT_PATH');codec=f[1];value=value[key];continue;}
    if(codec?.countKind){if(key!=='items')throw fail('Use .items.<i> for this list.','SAVE_EDIT_PATH');value=value.items;codec={item:codec.item,counted:false};continue;}
    if(codec?.item){if(!Number.isInteger(key)||key<0||key>=value.length)throw fail(`No item ${key}.`,'SAVE_EDIT_PATH');codec=codec.item;value=value[key];continue;}
    if(codec?.pair){if(key!==0&&key!==1)throw fail('A dictionary entry has 0 (key) and 1 (value).','SAVE_EDIT_PATH');dictKey=key===0;codec=codec.pair[key];value=value[key];continue;}
    dictKey=false;
    throw fail(`Cannot go into ${key}.`,'SAVE_EDIT_PATH');
  }
  return {codec,value,dictKey};
}

function check(kind,value){
  if(kind==='long'){if(typeof value!=='bigint'&&!Number.isSafeInteger(value))throw fail('A whole number is needed.','SAVE_EDIT_VALUE');const v=BigInt(value);if(v<-(2n**63n)||v>2n**63n-1n)throw fail('Out of range.','SAVE_EDIT_VALUE');return v;}
  if(kind==='double'){if(typeof value!=='number'||!Number.isFinite(value))throw fail('A finite number is needed.','SAVE_EDIT_VALUE');return value;}
  if(kind==='string'){if(typeof value!=='string'||Buffer.byteLength(value)>4096)throw fail('Text up to 4096 bytes is needed.','SAVE_EDIT_VALUE');return value;}
  if(kind==='bool'&&typeof value==='boolean')return value?1:0;
  const [lo,hi]=RANGE[kind]||[];if(lo===undefined)throw fail(`Unknown kind ${kind}.`,'SAVE_EDIT_VALUE');
  if(!Number.isSafeInteger(value)||value<lo||value>hi)throw fail(`${kind} must be a whole number from ${lo} to ${hi}.`,'SAVE_EDIT_VALUE');
  return value;
}

// The header's last-played date (savedYear/savedMonth/savedDay with hour/minute/second) and the date2/3/4 groups.
const HEADER_DATE={savedYear:'year',savedMonth:'month',savedDay:'day',hour:'hour',minute:'minute',second:'second'};
const DATE_GROUP={year:'year',month:'month',day:'day',hour:'hour',minute:'minute',second:'second'};
function dateParts(keys,parent){
  if(keys.length===1&&HEADER_DATE[keys[0]]){const d={map:HEADER_DATE};for(const [f,k] of Object.entries(HEADER_DATE))d[k]=parent[f];return d;}
  if(keys.length===2&&/^date\d$/.test(keys[0])&&DATE_GROUP[keys[1]]){const d={map:DATE_GROUP};for(const k of Object.keys(DATE_GROUP))d[k]=parent[k];return d;}
  return null;
}
function validDate({year,month,day,hour,minute,second}){
  if(!(year>=1&&year<=9999&&month>=1&&month<=12&&hour>=0&&hour<=23&&minute>=0&&minute<=59&&second>=0&&second<=59&&day>=1))return false;
  return day<=new Date(Date.UTC(2000,month,0)).getUTCDate()+(month===2&&!((year%4===0&&year%100!==0)||year%400===0)?-1:0);
}

function set(save,path,value){
  const keys=parts(path),name=[...keys].reverse().find(k=>typeof k==='string');
  if(IDENTITY.has(name))throw fail('Account identity fields are not edited here.');
  if(STRUCTURAL.test(name||''))throw fail('This field shapes the file (a count, a size or a version marker).');
  const {codec,dictKey}=codecAt(save,keys);
  // A dictionary key names its entry; changing it could duplicate another key (the game keeps one per key).
  if(dictKey)throw fail('Dictionary keys are not edited; edit the value (index 1).');
  if(!codec?.kind)throw fail('Only single values can be set; this is a group or list.');
  const v=check(codec.kind,value);
  // Assign into the parent, keeping wrapper types (exact bytes stay until the value really changes).
  let parent=save.data;for(const k of keys.slice(0,-1))parent=parent[k];
  const last=keys[keys.length-1],cur=parent[last];
  // Dates must stay real calendar dates (the game builds a date from them).
  const date=dateParts(keys,parent);
  if(date){const next={...date,[date.map[last]]:v};if(!validDate(next))throw fail('That would make an invalid date.','SAVE_EDIT_VALUE');}
  if(cur instanceof SaveDouble)cur.value=v;else if(cur instanceof SaveVarint)cur.value=v>>>0;else if(cur instanceof SaveString)cur.text=v;else parent[last]=v;
  return save;
}

const leaf=v=>v instanceof SaveDouble||v instanceof SaveVarint?v.value:v instanceof SaveString?v.text:Buffer.isBuffer(v)?`<${v.length} bytes>`:v;
const same=(a,b)=>{const x=leaf(a),y=leaf(b);if(Buffer.isBuffer(a)&&Buffer.isBuffer(b))return a.equals(b);return Object.is(x,y)||(typeof x==='number'&&typeof y==='number'&&x===y);};
const show=(name,v)=>IDENTITY.has(name)?'[hidden]':typeof leaf(v)==='bigint'?String(leaf(v)):leaf(v);
function diff(before,after,{limit=500}={}){
  const out=[];
  const walk=(a,b,path,name)=>{
    if(out.length>=limit)return;
    const isObj=v=>v&&typeof v==='object'&&!Buffer.isBuffer(v)&&!(v instanceof SaveDouble)&&!(v instanceof SaveVarint)&&!(v instanceof SaveString);
    if(isObj(a)&&isObj(b)){
      if(Array.isArray(a)&&a.length!==b.length)out.push({path:path.join('.'),before:`${a.length} items`,after:`${b.length} items`});
      for(const k of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[k],b[k],[...path,k],/^\d+$/.test(k)?name:k);
      return;
    }
    if(a===undefined||b===undefined||!same(a,b))out.push({path:path.join('.'),before:a===undefined?null:show(name,a),after:b===undefined?null:show(name,b)});
  };
  walk(before.data,after.data,[],null);
  return {changes:out,truncated:out.length>=limit};
}

module.exports={set,diff,codecAt,IDENTITY,STRUCTURAL};

},
"src/canbot-engine/expedition.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Gamatoto, Cat Shrine and Ototo edits.
const {SaveDouble}=require('./binary');
const fail=(code,message)=>Object.assign(new Error(message),{code});
function integer(v,max,name='Value'){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw fail('INVALID_INPUT',`${name} must be an integer between 0 and ${max}.`);return v;}

// Gamatoto level -> XP: level 1 is 0, else the xp of row level-2.
function xpFromLevel(levels,level){if(!levels)return null;level-=1;if(level<1)return 0;return levels[level-1]?.xpNeeded??null;}
// Shrine XP -> level and level -> XP over the cumulative boundaries.
function shrineLevel(b,xp){if(!b)return null;for(let i=0;i<b.length;i++)if(xp<b[i])return i+1;return b.length;}
function shrineXp(b,level){if(!b)return null;if(level<1)return 0;if(level>b.length)return Math.max(...b);return b[level-2];}

function rarityNames(members){if(!members)return null;const names=new Map();for(const m of members)names.set(m.rarity,m.rarityName);const out=[];for(let i=0;i<names.size;i++){if(!names.has(i))throw fail('INVALID_INPUT','Gamatoto game data is unavailable.');out.push(names.get(i));}return out;}
const maxPartLevel=(recipes,part)=>recipes?recipes.reduce((m,r)=>r.part===part&&r.level>m?r.level:m,0):null;
const maxLevel=(recipes,cannon,part)=>recipes?recipes.reduce((m,r)=>r.cannon===cannon&&r.part===part&&r.level>m?r.level:m,0):null;

function metadata(save,gd){
  const limit=gd.gamatotoLimit(),members=gd.gamatotoMembers(save.cc),rarities=rarityNames(members);
  if(!limit||rarities===null)throw fail('INVALID_INPUT','Gamatoto game data is unavailable.');
  const descriptions=gd.cannonDescriptions(save.cc),recipes=gd.recipeUnlocks();
  for(const [id,cannon] of save.data.ototoCannons){
    if(!descriptions?.some(d=>d.cannonId===id))throw fail('INVALID_INPUT','Cannon game data is unavailable.');
    for(let p=0;p<cannon.levels.length;p++)if(maxPartLevel(recipes,p)===null)throw fail('INVALID_INPUT','Cannon game data is unavailable.');
  }
  return {maxLevel:limit.maxLevel,maxHelpers:limit.totalHelpers,rarities,rarityCounts:rarities.map((_,i)=>members.filter(m=>m.rarity===i).length),engineerMax:gd.maxEngineers(),members};
}
function shrineLimits(gd,cc){const b=gd.shrineBoundaries(cc);if(!b)throw fail('INVALID_INPUT','Cat Shrine data unavailable.');return {b,max:b.length,maxXp:b.length?Math.max(...b):undefined};}
const setShrineDialogs=(save,v)=>{if('shrineDialogs' in save.data)save.data.shrineDialogs=v;};

function maxAccount(save,gd){
  const data=metadata(save,gd),levels=gd.gamatotoLevels(),xp=xpFromLevel(levels,data.maxLevel);
  if(xp===null)throw fail('INVALID_INPUT','Gamatoto level data unavailable.');
  const highest=data.members.filter(m=>m.rarity===data.rarities.length-1);
  if(highest.length<data.maxHelpers)throw fail('INVALID_INPUT','Highest-rarity helper data unavailable.');
  const {b,max}=shrineLimits(gd,save.cc),sxp=shrineXp(b,max);if(sxp===null||sxp===undefined)throw fail('INVALID_INPUT','Cat Shrine level data unavailable.');
  const cannons=save.data.ototoCannons;if(!cannons.length)throw fail('INVALID_INPUT','Ototo cannon data unavailable.');
  const recipes=gd.recipeUnlocks(),plans=cannons.map(([id,c])=>[c,c.levels.map((_,p)=>{const m=maxLevel(recipes,id,p);if(m===null)throw fail('INVALID_INPUT','Ototo cannon limits unavailable.');return p===0?m-1:m;})]);
  save.data.gamatoto.xp=xp;
  save.data.gamatotoHelpers=highest.slice(0,data.maxHelpers).map(m=>m.id);
  save.data.catShrine.xpOffering=BigInt(sxp);setShrineDialogs(save,max-1);
  save.data.ototoEngineers=data.engineerMax;
  for(const [c,values] of plans){c.development=Math.max(c.development,3);c.levels=values;}
}

function apply(save,gd,edit){
  const op=edit.operation,d=save.data;
  if(['shrine_level','shrine_xp','shrine_appear','shrine_disappear'].includes(op)){
    const {b,max,maxXp}=shrineLimits(gd,save.cc);
    if(op==='shrine_level'){const v=integer(edit.value,max);if(v<1)throw fail('INVALID_INPUT','Shrine level must be at least 1.');d.catShrine.xpOffering=BigInt(v===1?0:shrineXp(b,v));}
    else if(op==='shrine_xp')d.catShrine.xpOffering=BigInt(integer(edit.value,maxXp));
    else if(op==='shrine_appear'){d.catShrine.gone=0;d.catShrine.stamp1=new SaveDouble(0);d.catShrine.stamp2=new SaveDouble(0);}
    else d.catShrine.gone=1;
    const level=shrineLevel(b,Number(d.catShrine.xpOffering));if(level===null)throw fail('INVALID_INPUT','Cat Shrine level unavailable.');
    setShrineDialogs(save,level-1);
  }
  else if(op==='xp')d.gamatoto.xp=integer(edit.value,2**31-1);
  else if(op==='level'){const limit=gd.gamatotoLimit();if(!limit)throw fail('INVALID_INPUT','Level data is unavailable.');const v=integer(edit.value,limit.maxLevel);if(v<1)throw fail('INVALID_INPUT','Level must be at least 1.');const xp=xpFromLevel(gd.gamatotoLevels(),v);if(xp===null)throw fail('INVALID_INPUT','Level data is unavailable.');d.gamatoto.xp=xp;}
  else if(op==='engineers')d.ototoEngineers=integer(edit.value,gd.maxEngineers());
  else if(op==='helpers'){
    const data=metadata(save,gd),counts=edit.counts;
    if(!Array.isArray(counts)||counts.length!==data.rarities.length)throw fail('INVALID_INPUT','Invalid helper counts.');
    counts.forEach((c,i)=>integer(c,data.rarityCounts[i]));
    if(counts.reduce((a,c)=>a+c,0)>data.maxHelpers)throw fail('INVALID_INPUT','Too many helpers.');
    d.gamatotoHelpers=counts.flatMap((c,r)=>data.members.filter(m=>m.rarity===r).slice(0,c).map(m=>m.id));
  }
  else if(op==='cannon_levels'||op==='cannon_development'){
    const row=d.ototoCannons.find(p=>p[0]===edit.cannonId);if(typeof edit.cannonId==='boolean'||!row)throw fail('INVALID_INPUT','Invalid cannon.');
    const c=row[1];
    if(op==='cannon_development'){const v=integer(edit.value,3);if(edit.cannonId===0)throw fail('INVALID_INPUT','Normal cannon has no development selector.');c.development=v;}
    else{
      const values=edit.levels;if(!Array.isArray(values)||values.length!==c.levels.length)throw fail('INVALID_INPUT','Invalid cannon levels.');
      const recipes=gd.recipeUnlocks();values.forEach((v,p)=>{const m=maxPartLevel(recipes,p);if(m===null)throw fail('INVALID_INPUT','Cannon limits unavailable.');integer(v,m);});
      c.development=Math.max(c.development,3);c.levels=values.map((v,p)=>p===0?v-1:v);
    }
  }
  else throw fail('INVALID_INPUT','Unsupported expedition edit.');
}

module.exports={apply,maxAccount,metadata,maxPartLevel,shrineLimits,rarityNames};

},
"src/canbot-engine/extra.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Additional single operations (rare ticket trade, gold pass, slots, aku realm, ...).
const {SaveDouble}=require('./binary');
const fail=(code,message)=>Object.assign(new Error(message),{code});
function integer(v,max,name='Value'){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw fail('INVALID_INPUT',`${name} must be an integer between 0 and ${max}.`);return v;}
const LIMITS={rareTickets:299,hundredMillion:9999,stageClear:9999};
const MIN_VERSION={gold_add:80000,gold_remove:80000,aku:100900,hundred_million:140200};

function metadata(save,op){
  const min=MIN_VERSION[op];if(min!==undefined&&save.gameVersion<min)throw fail('EXTRA_UNSUPPORTED_VERSION','Not stored by this game version.');
  const d=save.data;
  if(op==='rare_trade')return {fields:[{id:'value',max:Math.min(Math.max(LIMITS.rareTickets-d.rareTickets,0),Math.floor(2147483647/5))}]};
  if(op==='hundred_million')return {fields:[{id:'value',max:require('./settings').cap(LIMITS.hundredMillion)}]};
  if(op==='slots'){let cap=Math.min(d.lineups.length,save.gameVersion<90700?10:127);if(save.gameVersion>=91000)cap=Math.min(cap,d.lineupNames.n);if(cap<=0)throw fail('LINEUP_LAYOUT_UNAVAILABLE','Lineups are unavailable.');return {fields:[{id:'value',max:cap}]};}
  if(op==='aku'){const st=d.aku?.clears?.[0]?.[0];if(!st||!st.length)throw fail('AKU_LAYOUT_UNAVAILABLE','Aku stages are unavailable.');return {fields:[{id:'progress',max:st.length},{id:'count',max:require('./settings').cap(LIMITS.stageClear,15)}]};}
  if(op==='gold_add')return {fields:[{id:'value',max:2147483647}]};
  if(op==='gold_remove')return {fields:[]};
  throw fail('INVALID_INPUT','Unsupported operation.');
}
const dbl=v=>new SaveDouble(v);
function resetLogin(save){const row=save.data.logins.find(p=>p[0]===5100);if(row)row[1]=0;}

function apply(save,edit,{now=()=>Math.floor(Date.now()/1000),random=Math.random}={}){
  const op=edit.operation,meta=metadata(save,op),v=Object.fromEntries(meta.fields.map(f=>[f.id,integer(edit[f.id],f.max)])),d=save.data;
  if(op==='rare_trade'){
    const i=d.storageTypes.findIndex((t,k)=>t===0||(t===2&&d.storageIds[k]===1));
    if(meta.fields[0].max===0||i<0)throw fail('INVALID_INPUT','No ticket capacity or storage space.');
    d.storageTypes[i]=2;d.storageIds[i]=1;d.gachaTradeProgress=v.value*5;
  }
  else if(op==='hundred_million')d.hundredMillionTicket=v.value;
  else if(op==='slots')d.unlockedLineups=v.value;
  else if(op==='aku'){const st=d.aku.clears[0][0];st.forEach((_,i)=>{st[i]=i<v.progress?v.count:0;});}
  else if(op==='gold_add'){
    const g=d.goldPass,id=v.value||(1+Math.floor(random()*(2**16-1))),start=now(),end=start+30*86400,endTotal=start+60*86400;
    g.officerId=id;g.renewals=2;g.startNow=dbl(start);g.endNow=dbl(end);g.startNext=dbl(end);g.endNext=dbl(endTotal);g.startTotal=dbl(start);g.endTotal=dbl(endTotal);
    g.timeErrorEnd=dbl(start);g.stateUpdates=2;g.loginBonusDate=dbl(end);g.remainingDaysPopup=dbl(0);g.firstPopup=1;if('badge' in g)g.badge=0;
    resetLogin(save);g.claimedRewards=[];
  }
  else if(op==='gold_remove')removeGoldPass(save);
}
// Removes the Gold Pass (also used by the Officer Pass fix).
function removeGoldPass(save){
  const g=save.data.goldPass;g.officerId=-1;g.renewals=0;for(const k of ['startNow','endNow','startNext','endNext','startTotal','endTotal','timeErrorEnd','loginBonusDate','remainingDaysPopup'])g[k]=dbl(0);
  g.stateUpdates=0;g.firstPopup=0;if('badge' in g)g.badge=0;resetLogin(save);g.claimedRewards=[];
}

module.exports={apply,metadata,removeGoldPass};

},
"src/canbot-engine/format.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Battle Cats SAVE layout, in file order. Written for CanBot from the observed read order of SAVE files (field order,
// sizes and version conditions); the parts not described yet are kept as raw bytes in `rest`. Field names are ours.
const {T,list,struct,when}=require('./codec');
const {SaveReader,SaveWriter}=require('./binary');

const notJp=ctx=>!ctx.jp;
// A daylight-saving flag the game writes after some dates, outside JP from version 49 on.
const dst=name=>when(ctx=>!ctx.jp&&ctx.gv>=49,[name,T.bool]);

const header=[
  ['gameVersion',T.int],
  when(ctx=>ctx.gv>=10||notJp(ctx),['flag0',T.bool]),
  ['muteMusic',T.bool],
  ['muteSound',T.bool],
  ['catfood',T.int],
  ['energy',T.int],
  // The last-played date is stored twice per part (year, year, month, month, day, day).
  ['savedYear',T.int],['year',T.int],
  ['savedMonth',T.int],['month',T.int],
  ['savedDay',T.int],['day',T.int],
  ['timestamp',T.double],
  ['hour',T.int],['minute',T.int],['second',T.int],
  dst('dst0'),
  ['unknown1',T.int],
  ['stampValue',T.int],
  ['unknown2',T.int],
  ['upgradeState',T.int],
  ['xp',T.int],
  ['tutorialState',T.int],
  ['unknown3',T.int],
  ['koreaSuperiorTreasureState',T.int],
  ['unlockPopups11',list(T.int,3)],
  ['unknown5',T.int],
  ['enemyGuideUnlocked',T.int],
  ['unknown6',T.int],
  ['flag1',T.bool],
  ['unknown7',T.int],
  ['clearedEoc1',T.int],
  ['unknown8',T.int],
  ['endingUnlocked',T.int],
];

const upgrade=struct([['plus',T.ushort],['base',T.ushort]]);
const date=struct([['year',T.int],['month',T.int],['day',T.int],['hour',T.int],['minute',T.int],['second',T.int]]);
// Per-cat columns: each section stores its own count, but the number of entries always follows the unlocked list.
const catCount=(ctx,o)=>o.catsUnlocked.length;
const varintDict=(value)=>struct([['count',T.varint],['entries',list(struct([['key',T.varint],['value',value]]),(ctx,o)=>Number(o.count))]]);

const early=[
  // Lineups: a count byte, then 10 cat slots each.
  ['lineupCount',T.byte],
  ['lineups',list(list(T.int,10),(ctx,o)=>o.lineupCount)],
  ['stampCurrent',T.int],['stampCollected',list(T.int,30)],['stampUnknown',T.int],['stampDailyReward',T.int],
  // Story: 10 chapters; selected stage, progress, then 51 clear counts and 49 treasure levels per chapter.
  ['storySelected',list(T.int,10)],
  ['storyProgress',list(T.int,10)],
  ['storyClearTimes',list(list(T.int,51),10)],
  ['storyTreasure',list(list(T.int,49),10)],
  ['enemyGuide',list(T.int)],
  ['catsUnlocked',list(T.int)],
  ['catsUpgradeCount',T.int],['catsUpgrade',list(upgrade,catCount)],
  ['catsFormCount',T.int],['catsForm',list(T.int,catCount)],
  ['specialSkills',list(upgrade,11)],
  ['menuUnlocks',list(T.int)],
  ['unlockPopups0',list(T.int)],
  ['battleItems',list(T.int,6)],
  ['newDialogs2',list(T.int)],
  ['unknownList1',list(T.int,20)],
  ['monekoBonus',list(T.int,1)],
  ['dailyRewardInitialized',list(T.int,1)],
  ['battleItemsLockAll',T.bool],['battleItemsLocked',list(T.bool,6)],
  dst('dst1'),
  ['date2',date],
  // Treasure festival, 10 chapters each.
  ['treasureChanceTimeLeft',list(T.int,10)],['treasureChanceDuration',list(T.int,10)],['treasureChanceValue',list(T.int,10)],['treasureChanceStage',list(T.int,10)],['treasureFestivalType',list(T.int,10)],
  dst('dst2'),
  ['date3',date],
  ['stageUnlockCatValue',T.int],
  ['showEndingValue',T.int],
  ['chapterClearCatUnlock',T.int],
  ['unknown9',T.int],
  ['iosAndroidMonth',T.int],
  ['unknown10',T.int],
  ['saveDataHash4',T.string],
  ['mySaleBonus',varintDict(T.varint)],
  ['mySaleFlags',varintDict(T.bool)],
  ['charaFlags',list(T.int,2)],
  ['charaFlags2',list(T.int,2)],
  ['normalTickets',T.int],
  ['rareTickets',T.int],
  ['catsSeenCount',T.int],['catsSeen',list(T.int,catCount)],
  ['specialSkillsSeen',list(T.int,10)],
  // Cat storage: a count, then the item ids, then the item types.
  ['storageCount',T.short],['storageIds',list(T.int,(ctx,o)=>o.storageCount)],['storageTypes',list(T.int,(ctx,o)=>o.storageCount)],
];

// Event stages (game version 8.1 and later): four sizes, then four blocks indexed [type][subchapter][star]:
// selected stage, clear progress, the clear count of each stage, and the unlock state.
// Stage clears are stored stage-major: [type][subchapter][stage][star] (every star of stage 0, then 1, ...).
const grid=(item,last)=>list(list(last?list(list(item,(c,o)=>o.stars),(c,o)=>o.stagesPer):list(item,(c,o)=>o.stars),(c,o)=>o.subchapters),(c,o)=>o.types);
const eventStages=struct([
  ['types',T.byte],['subchapters',T.short],['stars',T.byte],['stagesPer',T.byte],
  ['selected',grid(T.byte)],
  ['progress',grid(T.byte)],
  ['clears',grid(T.short,true)],
  ['unlock',grid(T.byte)],
]);

const middle=[
  ['eventStages',eventStages],
  ['itfEnding',T.int],
  ['continueFlag',T.int],
  ['unlockPopups8',list(T.int,36)],
  ['unitDrops',list(T.int)],
  ['rareSeed',T.uint],['normalSeed',T.uint],
];

// Account identity strings (transfer code, confirmation code, inquiry code, player id) live in this part. The engine
// keeps them like any other field; nothing in CanBot may log or print them.
const jpOnly=ctx=>ctx.jp;
const account=[
  ['getEventData',T.bool],
  ['achievements',list(T.bool,7)],
  ['osValue',T.int],
  dst('dst3'),
  ['date4',date],
  ['gachaFlags',struct([['a',T.int],['b',T.int],['c',T.int],['d',T.int],['e',T.int],['f',T.bool],['g',T.bool],['h',T.bool]])],
  when(notJp,['playerId',T.string]),
  ['orderIds',list(T.string)],
  when(notJp,['gTimestamp',T.double]),
  when(notJp,['gServerTimestamp',T.double]),
  when(notJp,['mGetTimeSave',T.double]),
  when(notJp,['unknownStrings1',list(T.string)]),
  when(notJp,['energyNotification',T.bool]),
  when(notJp,['fullGameVersion',T.int]),
  ['selectedLineup',T.int],
  ['unlockedLineups',T.byte],
  // Legend restrictions: two stored sizes, but one value per event [type][subchapter] read above.
  ['legendRestrictionTypes',T.int],['legendRestrictionSubchapters',T.int],
  ['legendRestrictions',list(list(T.int,(c,o)=>o.eventStages.subchapters),(c,o)=>o.eventStages.types)],
  ['gTimestamp2',T.double],['gServerTimestamp2',T.double],['mGetTimeSave2',T.double],['unknownTimestamp',T.double],
  ['gachaTradeProgress',T.int],
  when(notJp,['mGetTimeSave2b',T.double]),
  when(jpOnly,['unknown11',T.int]),
  ['catsMaxUpgradeCount',T.int],['catsMaxUpgrade',list(upgrade,catCount)],
  ['specialSkillsMaxUpgrade',list(upgrade,11)],
  ['userRankRewards',list(T.bool)],
  when(jpOnly,['mGetTimeSave2b',T.double]),
  ['catsUnlockedFormsCount',T.int],['catsUnlockedForms',list(T.int,catCount)],
  ['transferCode',T.string],
  ['confirmationCode',T.string],
  ['transferFlag',T.bool],
  // Item reward stages [subchapter][star][stage] and timed scores, each with three stored sizes.
  ['itemRewardSubchapters',T.int],['itemRewardStages',T.int],['itemRewardStars',T.int],
  ['itemReward',list(list(list(T.bool,(c,o)=>o.itemRewardStages),(c,o)=>o.itemRewardStars),(c,o)=>o.itemRewardSubchapters)],
  ['timedScoreSubchapters',T.int],['timedScoreStages',T.int],['timedScoreStars',T.int],
  ['timedScore',list(list(list(T.int,(c,o)=>o.timedScoreStages),(c,o)=>o.timedScoreStars),(c,o)=>o.timedScoreSubchapters)],
  ['inquiryCode',T.string],
  ['officerPassPlayTime',T.int],
  ['hasAccount',T.byte],
  ['backupState',T.int],
  when(notJp,['flag2',T.bool]),
  ['marker44',T.int],
  ['itf1Complete',T.int],
  ['itfTimedScores',list(T.int,153)],
  ['titleChapterBg',T.int],
  ['comboUnlocks',list(T.int)],
  ['comboUnlocked10kUr',T.bool],
  ['marker45',T.int],
  ['marker46',T.int],
  ['eventSeed',T.uint],
  ['eventCapsules',list(T.int)],
  ['eventCapsulesCounter',list(T.int)],
  ['marker47',T.int],
  ['marker48',T.int],
  when(jpOnly,['energyNotification',T.bool]),
  ['mGetTimeSave3',T.double],
  ['gachaSeenLuckyDrops',list(T.int)],
  ['showBanMessage',T.bool],
  ['catfoodBeginnerPurchased',list(T.bool,3)],
  ['nextWeekTimestamp',T.double],
  ['catfoodBeginnerExpired',list(T.bool,3)],
  ['rankUpSaleValue',T.int],
  ['marker49',T.int],
  ['marker50',T.int],
  ['marker51',T.int],
  ['catGuideCollectedCount',T.int],['catGuideCollected',list(T.bool,catCount)],
  ['marker52',T.int],
];

const {dict}=require('./codec');
const intInt=dict(T.int,T.int),intBool=dict(T.int,T.bool),intDouble=dict(T.int,T.double);
// Shared "chapters" block (tower, challenge, ...): four blocks, each with its own stored sizes; the loops follow the
// first sizes, and the stage block uses the stage count of the third. Stage clears are stored [chapter][stage][star].
const chapters=struct([
  ['chapters1',T.int],['stars1',T.int],
  ['selected',list(list(T.int,(c,o)=>o.stars1),(c,o)=>o.chapters1)],
  ['chapters2',T.int],['stars2',T.int],
  ['progress',list(list(T.int,(c,o)=>o.stars1),(c,o)=>o.chapters1)],
  ['chapters3',T.int],['stages3',T.int],['stars3',T.int],
  ['clears',list(list(list(T.int,(c,o)=>o.stars1),(c,o)=>o.stages3),(c,o)=>o.chapters1)],
  ['chapters4',T.int],['stars4',T.int],
  ['unlock',list(list(T.int,(c,o)=>o.stars1),(c,o)=>o.chapters1)],
]);
// Ototo cannons: per cannon a level count n, the development stage, then n - 1 levels.
const cannon=struct([['levelCount',T.int],['development',T.int],['levels',list(T.int,(c,o)=>Math.max(0,o.levelCount-1))]]);
const outbreakChapters=dict(T.int,dict(T.int,T.bool));

const progress=[
  ['timeSinceCheckCumulative',T.double],
  ['serverTimestamp',T.double],
  ['lastEnergyRecoveryCheck',T.double],
  ['timeSinceCheck',T.double],
  ['lastExpeditionCheck',T.double],
  ['catfruit',list(T.int)],
  ['catsFourthForm',list(T.int)],
  ['catsCatseyesUsed',list(T.int)],
  ['catseyes',list(T.int)],
  ['catamins',list(T.int)],
  ['gamatoto',struct([['remainingSeconds',T.double],['returnFlag',T.bool],['xp',T.int],['destination',T.int],['reconLength',T.int],['unknown',T.int],['notifyValue',T.int]])],
  ['unlockPopups6',list(T.bool)],
  ['exStages',list(list(T.int,12))],
  ['marker53',T.int],
  ['gamatotoHelpers',list(T.int)],
  ['gamatotoAdPresent',T.bool],
  ['marker54a',T.int],
  ['itemPackPurchases',dict(T.int,dict(T.string,T.bool))],
  ['marker54b',T.int],
  ['gamatotoSkin',T.int],
  ['platinumTickets',T.int],
  ['logins',intInt],
  ['rewardRemainingTime',T.double],
  ['lastRewardCheck',T.double],
  ['announcements',list(struct([['a',T.int],['b',T.int]]),16)],
  ['backupCounter',T.int],
  ['unknown12',T.int],['unknown13',T.int],['unknown14',T.int],
  ['marker55',T.int],
  ['flag3',T.bool],
  ['itemObtains',dict(T.int,intBool)],
  ['unobtainedItems',intBool],
  ['stepUpStages',intInt],
  ['stepUpDurations',intDouble],
  ['backupFrame',T.int],
  ['marker56',T.int],
  ['flag4',T.bool],
  ['catsFavorites',intBool],
  ['marker57',T.int],
  ['dojoChapters',dict(T.int,intInt)],
  ['dojoItemLockAll',T.bool],['dojoItemLocks',list(T.bool,6)],
  ['marker58',T.int],
  ['lastZombieCheck',T.double],
  ['outbreaks',outbreakChapters],
  ['zombieEventRemaining',T.double],
  ['schemeToObtain',list(T.int)],['schemeReceived',list(T.int)],
  ['currentOutbreaks',outbreakChapters],
  ['firstLocks',intBool],
  ['energyPenaltyTimestamp',T.double],
  ['marker60',T.int],
  ['catsNewFlags',intInt],
  ['shownMaxCollabMessage',T.bool],
  ['itemPackDisplayed',intBool],
  ['marker61',T.int],
  ['unlockPopups',intBool],
  ['marker63',T.int],
  ['ototoMaterials',list(T.int)],
  ['ototoRemainingSeconds',T.double],['ototoReturnFlag',T.bool],['ototoImproveId',T.int],['ototoEngineers',T.int],
  ['ototoCannons',dict(T.int,cannon)],
  ['ototoSelectedPartsCount',T.byte],['ototoSelectedParts',list(list(T.byte,3),(c,o)=>o.ototoSelectedPartsCount)],
  ['lastCastleCheck',T.double],
  ['marker64',T.int],
  ['beaconInts',intInt],['beaconStrings',dict(T.int,list(T.string))],['beaconBools',intBool],
  ['marker65',T.int],
  ['tower',chapters],
  ['missions',struct([['clearStates',intInt],['requirements',intInt],['progressTypes',intInt],['gamatotoValues',intInt],['nyancomboValues',intInt],['userRankValues',intInt],['expiryValues',intInt],['preparingValues',intInt]])],
  ['towerItemObtainStars',T.int],['towerItemObtainStages',T.int],
  ['towerItemObtain',list(list(T.bool,(c,o)=>o.towerItemObtainStages),(c,o)=>o.towerItemObtainStars)],
  ['marker66',T.int],
  ['dojoRanking',struct([['score',T.int],['ranking',T.int],['submitted',T.bool],['completed',T.bool],['seenResults',T.bool],['startDate',T.int],['endDate',T.int],['eventNumber',T.int],['showRankDescription',T.bool],['showStartMessage',T.bool],['submitError',T.bool],when(ctx=>ctx.gv>=140500,['other',T.string])])],
  ['itemPackThreeDaysStarted',T.bool],['itemPackThreeDaysEnd',T.double],
  ['challenge',chapters],
  ['challengeScores',list(T.int)],
  ['challengePopupShown',T.bool],
  ['marker67',T.int],
  ['weeklyMissions',intBool],
  ['dojoDidWinRewards',T.bool],
  ['eventUpdateFlags',T.bool],
  ['marker68',T.int],
  ['eventCompletionCount',intInt],['eventClearedLimitText',intBool],['eventStartDates',intInt],['eventRewardClaimed',list(T.int)],
  ['cotc1Complete',T.int],
  ['marker69',T.int],
  ['gamatotoCollabFlags',intBool],['gamatotoCollabDurations',intDouble],
];

// Chapters with their sizes stored once (Uncanny, Catamin stages), followed by one extra int per chapter.
const chaptersOnce=struct([
  ['chapters',T.int],['stages',T.int],['stars',T.int],
  ['selected',list(list(T.int,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['progress',list(list(T.int,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['clears',list(list(list(T.int,(c,o)=>o.stars),(c,o)=>o.stages),(c,o)=>o.chapters)],
  ['unlock',list(list(T.int,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['extra',list(T.int,(c,o)=>o.chapters)],
]);
// Legend Quest: byte sizes; clears then tries, each [chapter][stage][star] as shorts.
const legendQuest=struct([
  ['chapters',T.byte],['stages',T.byte],['stars',T.byte],
  ['selected',list(list(T.byte,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['progress',list(list(T.byte,(c,o)=>o.stars),(c,o)=>o.chapters)],
  // Per chapter: all clears, then all tries. The sizes come from the Legend Quest object (the list passes it on).
  ['stagesData',list({
    read(r,ctx,lq){const grid=()=>list(list(T.short,lq.stars),lq.stages).read(r,ctx,lq);return {clears:grid(),tries:grid()};},
    write(w,v,ctx,lq){const g=list(list(T.short,lq.stars),lq.stages);g.write(w,v.clears,ctx,lq);g.write(w,v.tries,ctx,lq);},
  },(c,o)=>o.chapters)],
  ['unlock',list(list(T.byte,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['unknown',list(T.byte,(c,o)=>o.chapters)],
  ['ids',list(T.int,(c,o)=>o.stages)],
]);
// Lists whose count is a short or a byte; the count is kept as read ({n, items}).
const counted=kind=>(item)=>({item,countKind:kind,read(r,ctx,p){const n=r[kind]();const out=new Array(Math.max(0,n));for(let i=0;i<n;i++)out[i]=item.read(r,ctx,p);return {n,items:out};},write(w,v,ctx,p){w[kind](v.n);for(const x of v.items)item.write(w,x,ctx,p);}});
const shortCount=counted('short'),byteCount=counted('byte');
// Gauntlet-style chapters: short/byte/byte sizes stored once; byte selected/progress/unlock, short clears
// [chapter][stage][star], then one byte per chapter.
const gauntlet=()=>struct([
  ['chapters',T.short],['stages',T.byte],['stars',T.byte],
  ['selected',list(list(T.byte,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['progress',list(list(T.byte,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['clears',list(list(list(T.short,(c,o)=>o.stars),(c,o)=>o.stages),(c,o)=>o.chapters)],
  ['unlock',list(list(T.byte,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['unknown',list(T.byte,(c,o)=>o.chapters)],
]);
const enigmaStage=struct([['level',T.int],['stageId',T.int],['decoding',T.byte],['startTime',T.double]]);

const later=[
  ['marker71',T.int],
  ['uncanny',chaptersOnce],
  ['marker76',T.int],
  ['cataminStages',chaptersOnce],
  ['luckyTickets',list(T.int)],
  ['flag5',T.bool],
  ['marker77',T.int],
  ['goldPass',struct([['officerId',T.int],['renewals',T.int],['startNow',T.double],['endNow',T.double],['startNext',T.double],['endNext',T.double],['startTotal',T.double],['endTotal',T.double],['timeErrorEnd',T.double],['stateUpdates',T.int],['loginBonusDate',T.double],['claimedRewards',intInt],['remainingDaysPopup',T.double],['firstPopup',T.bool],when(ctx=>ctx.gv>=80100,['badge',T.bool])])],
  ['talents',list(struct([['catId',T.int],['talents',list(struct([['id',T.int],['level',T.int]]))]]))],
  ['np',T.int],
  ['flag6',T.bool],
  ['marker80000',T.int],
  ['flag7',T.bool],
  ['leadership',T.short],
  ['officerCatId',T.short],['officerCatForm',T.short],
  ['marker80200',T.int],
  ['filibusterStage',T.byte],['filibusterEnabled',T.bool],
  ['marker80300',T.int],
  ['stageIds10s',list(T.int)],
  ['marker80500',T.int],
  ['unknownList6',shortCount(T.int)],
  ['legendQuest',legendQuest],
  ['unknownShort1',T.short],
  ['unknownByte1',T.byte],
  ['marker80600',T.int],
  ['unknownIntLists',dict(T.int,list(T.int))],
  ['marker80700',T.int],
  when(ctx=>ctx.gv>=100600&&ctx.cc==='en',['enByte',T.byte]),
  when(ctx=>ctx.gv>=100600&&ctx.cc==='en',['marker100600',T.int]),
  ['restartPack',T.byte],
  ['marker81000',T.int],
  ['medals',struct([['u1',T.int],['u2',T.int],['u3',T.int],['list1',shortCount(T.short)],['list2',shortCount(struct([['key',T.short],['value',T.byte]]))],['flag',T.bool]])],
  ['wildcatCompleted',shortCount(struct([['key',T.short],['value',T.bool]]))],
  ['wildcatValues',shortCount(struct([['key',T.short],['values',shortCount(struct([['key',T.short],['value',T.short]]))]]))],
  ['wildcatStartTimes',shortCount(struct([['key',T.short],['value',T.int]]))],
  ['marker90000',T.int],
  ['unknownShort2',T.short],['unknownShort3',T.short],['unknown15',T.int],['unknownDouble1',T.double],
  ['marker90100',T.int],
  ['unknownTuples',shortCount(struct([['a',T.int],['b',T.int],['c',T.short],['d',T.int],['e',T.int],['f',T.int],['g',T.short]]))],
  ['unknownIntDoubles',shortCount(struct([['key',T.int],['value',T.double]]))],
  ['gauntlets',gauntlet()],
  ['marker90300',T.int],
  ['enigmaClears',gauntlet()],
  ['enigma',struct([['energySince1',T.int],['energySince2',T.int],['level',T.byte],['unknown1',T.byte],['unknown2',T.bool],['stages',byteCount(enigmaStage)],when(ctx=>ctx.gv>=140500,['hasExtra',T.bool]),when((ctx,o)=>ctx.gv>=140500&&o.hasExtra,['extra',enigmaStage])])],
  // Cleared lineups per stage; the last table's values are kept as raw bytes (JP 16.0.3 stores 2 there).
  ['clearedSlotsCats',shortCount(struct([['index',T.short],['cats',list(struct([['catId',T.short],['form',T.byte]]),10)],['u1',T.byte],['u2',T.byte],['u3',T.byte]]))],
  ['clearedStageSlots',shortCount(struct([['index',T.short],['stages',shortCount(T.int)]]))],
  ['clearedSlotsUnknown',shortCount(struct([['key',T.short],['value',T.bool]]))],
  ['marker90400',T.int],
  ['collabGauntlets',gauntlet()],
  ['flag8',T.bool],['unknownDouble2',T.double],['unknownDouble3',T.double],['unknown16',T.int],
  when(ctx=>ctx.gv>=100300,['unknownByte3',T.byte]),when(ctx=>ctx.gv>=100300,['flag9',T.bool]),when(ctx=>ctx.gv>=100300,['unknownDouble4',T.double]),when(ctx=>ctx.gv>=100300,['unknownDouble5',T.double]),
  when(ctx=>ctx.gv>=130700,['unknownIntBytes',shortCount(struct([['key',T.int],['value',T.byte]]))]),
  when(ctx=>ctx.gv>=130700,['unknownIntDoubles2',shortCount(struct([['key',T.int],['value',T.double]]))]),
  when(ctx=>ctx.gv>=140100,['unknownIntDoubles3',shortCount(struct([['key',T.int],['value',T.double]]))]),
  ['marker90500',T.int],
  ['talentOrbs',shortCount(struct([['id',T.short],['value',{read:(r,ctx)=>ctx.gv<110400?r.byte():r.short(),write:(w,v,ctx)=>ctx.gv<110400?w.byte(v):w.short(v)}]]))],
  ['unknownNested',shortCount(struct([['key',T.short],['values',byteCount(struct([['key',T.byte],['value',T.short]]))]]))],
  ['flag10',T.bool],
  ['marker90700',T.int],
  ['unknownList7',shortCount(T.int)],
  ['unknownBools2',list(T.bool,10)],
  ['marker90800',T.int],
  ['catShrine',struct([['unknown',T.bool],['stamp1',T.double],['stamp2',T.double],['gone',T.bool],['flags',byteCount(T.byte)],['xpOffering',T.long]])],
  ['unknownDouble6',T.double],['unknownDouble7',T.double],
  ['marker90900',T.int],
  // Lineup names (byte count from 11.6 on, 15 before).
  ['lineupNames',{read:(r,ctx)=>{const n=ctx.gv>=110600?r.byte():15;const items=[];for(let i=0;i<n;i++)items.push(r.string());return {n,items};},write:(w,v,ctx)=>{if(ctx.gv>=110600)w.byte(v.n);for(const s of v.items)w.string(s);}}],
  ['marker91000',T.int],
  ['legendTickets',T.int],
  ['unknownBytePairs',byteCount(struct([['a',T.byte],['b',T.int]]))],
  ['flag11',T.bool],['flag12',T.bool],
  // The account's password refresh token: kept like any field, never logged.
  ['passwordRefreshToken',T.string],
  ['flag13',T.bool],['unknownByte4',T.byte],['unknownByte5',T.byte],['unknownDouble8',T.double],['unknownDouble9',T.double],
  ['marker100000',T.int],
];

const gv=n=>ctx=>ctx.gv>=n;
// Aku realm: short/byte/byte sizes; current stage bytes [chapter][star]; clears shorts [chapter][star][stage].
const aku=struct([
  ['chapters',T.short],['stages',T.byte],['stars',T.byte],
  ['current',list(list(T.byte,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['clears',list(list(list(T.short,(c,o)=>o.stages),(c,o)=>o.stars),(c,o)=>o.chapters)],
]);
// Zero Legends (and the 14.0 dojo chapters): per chapter an unknown byte and a byte star count; per star selected,
// progress and unlock bytes plus a short count of stage clears.
const zeroLegends=shortCount(struct([['unknown',T.byte],['stars',byteCount(struct([['selected',T.byte],['progress',T.byte],['unlock',T.byte],['clears',shortCount(T.short)]]))]]));

const recent=[
  when(gv(100100),['dateInt',T.int]),when(gv(100100),['marker100100',T.int]),
  when(gv(100300),['endlessItems',list(struct([['a',T.bool],['b',T.bool],['c',T.byte],['d',T.double],['e',T.double]]),6)]),when(gv(100300),['marker100300',T.int]),
  when(gv(100400),['eventCapsules2',byteCount(T.int)]),when(gv(100400),['twoBattleLines',T.bool]),when(gv(100400),['marker100400',T.int]),
  when(gv(100600),['unknownDouble10',T.double]),when(gv(100600),['platinumShards',T.int]),when(gv(100600),['flag15',T.bool]),when(gv(100600),['marker100600b',T.int]),
  when(gv(100700),['catScratcherCompleted',shortCount(struct([['key',T.short],['value',T.bool]]))]),
  when(gv(100700),['catScratcherValues',shortCount(struct([['key',T.short],['values',shortCount(struct([['key',T.short],['value',T.short]]))]]))]),
  when(gv(100700),['catScratcherStartTimes',shortCount(struct([['key',T.short],['value',T.int]]))]),
  when(gv(100700),['marker100700',T.int]),
  when(gv(100900),['aku',aku]),when(gv(100900),['flag16',T.bool]),when(gv(100900),['flag17',T.bool]),
  when(gv(100900),['unknownShortLists',shortCount(struct([['key',T.short],['values',shortCount(T.short)]]))]),
  when(gv(100900),['unknownShortDoubles',shortCount(struct([['key',T.short],['value',T.double]]))]),
  when(gv(100900),['unknownShortDoubles2',shortCount(struct([['key',T.short],['value',T.double]]))]),
  when(gv(100900),['flag18',T.bool]),when(gv(100900),['marker100900',T.int]),
  when(gv(101000),['unknownByte6',T.byte]),when(gv(101000),['marker101000',T.int]),
  when(gv(110000),['unknownIntBytePairs',shortCount(struct([['key',T.int],['a',T.byte],['b',T.byte]]))]),when(gv(110000),['marker110000',T.int]),
  when(gv(110500),['behemothCulling',gauntlet()]),when(gv(110500),['flag19',T.bool]),when(gv(110500),['marker110500',T.int]),
  when(gv(110600),['flag20',T.bool]),when(gv(110600),['marker110600',T.int]),
  when(gv(110700),['unknownIntDoublePairs',list(struct([['key',T.int],['a',T.double],['b',T.double]]))]),
  when(ctx=>ctx.gv>=110700&&!ctx.jp,['flag20b',T.bool]),
  when(gv(110700),['marker110700',T.int]),
  when(gv(110800),['shrineDialogs',T.int]),when(gv(110800),['flag21',T.bool]),when(gv(110800),['dojo3xSpeed',T.bool]),when(gv(110800),['flag22',T.bool]),when(gv(110800),['flag23',T.bool]),when(gv(110800),['marker110800',T.int]),
  when(gv(111000),['labyrinth',struct([
    ['ui17',T.int],['ush4',T.short],['uby7',T.byte],['uby8',T.byte],['ub24',T.bool],['uby9',T.byte],
    ['shorts1',byteCount(T.short)],['shorts2',shortCount(T.short)],['shorts3',shortCount(T.short)],
    ['ui18',T.int],['ui19',T.int],['ui20',T.int],['ush5',T.short],['ush6',T.short],['ush7',T.short],['ush8',T.short],
    ['uby10',T.byte],['ub25',T.bool],['ub26',T.bool],['ub27',T.bool],['ub28',T.bool],['ub29',T.bool],['ub30',T.bool],['uby11',T.byte],
    ['shorts4',shortCount(T.short)],['bools3',list(T.bool,14)],['medals',byteCount(T.short)],
  ])]),
  when(gv(111000),['marker111000',T.int]),
  when(gv(120000),['zeroLegends',zeroLegends]),when(gv(120000),['unknownByte12',T.byte]),when(gv(120000),['marker120000',T.int]),
  when(gv(120100),['shorts6',shortCount(T.short)]),when(gv(120100),['marker120100',T.int]),
  when(gv(120200),['flag31',T.bool]),when(gv(120200),['unknownShort9',T.short]),when(gv(120200),['unknownShortShorts',byteCount(struct([['key',T.short],['value',T.short]]))]),when(gv(120200),['marker120200',T.int]),
  when(gv(120400),['unknownDouble11',T.double]),when(gv(120400),['unknownDouble12',T.double]),when(gv(120400),['marker120400',T.int]),
  when(gv(120500),['flag32',T.bool]),when(gv(120500),['flag33',T.bool]),when(gv(120500),['flag34',T.bool]),when(gv(120500),['unknown21',T.int]),when(gv(120500),['goldenCpuCount',T.byte]),when(gv(120500),['marker120500',T.int]),
  when(gv(120600),['soundEffectsVolume',T.byte]),when(gv(120600),['musicVolume',T.byte]),when(gv(120600),['marker120600',T.int]),
  when(ctx=>(!ctx.jp&&ctx.gv>=120700)||(ctx.jp&&ctx.gv>=130000),['stringPairs',byteCount(struct([['a',T.string],['b',T.string]]))]),
  when(ctx=>(!ctx.jp&&ctx.gv>=120700)||(ctx.jp&&ctx.gv>=130000),['marker120700',T.int]),
  when(gv(130100),['intLongs',list(struct([['a',T.int],['b',T.long]]))]),when(gv(130100),['marker130100',T.int]),
  when(gv(130301),['stringIntDoubles',list(struct([['key',T.string],['a',T.int],['b',T.double]]))]),when(gv(130301),['marker130301',T.int]),
  when(gv(130400),['unknownDouble13',T.double]),when(gv(130400),['unknownDouble14',T.double]),when(gv(130400),['marker130400',T.int]),
  when(gv(130500),['nested130500',shortCount(struct([['id',T.byte],['entries',byteCount(struct([['a',T.byte],['b',T.byte],['c',T.byte],['values',shortCount(T.short)]]))]]))]),when(gv(130500),['marker130500',T.int]),
  when(gv(130600),['unknownByte14',T.byte]),when(ctx=>ctx.gv>=130600&&!ctx.jp,['unknownShort12',T.short]),when(gv(130600),['marker130600',T.int]),
  when(ctx=>ctx.gv>=130700&&ctx.jp,['unknownShort12',T.short]),
  when(gv(130700),['block130700',struct([['ud15',T.double],['uby15',T.byte],['uby16',T.byte],['ush11',T.short],['uby17',T.byte],['uby18',T.byte],['uby19',T.byte],['ud16',T.double],
    ['entries',shortCount(struct([['key',T.short],['value',T.short],['value2',T.int],['map',shortCount(struct([['key',T.short],['value',T.short]]))]]))]])]),
  when(gv(130700),['marker130700',T.int]),
  when(gv(140000),['block140000',struct([['ui22',T.int],['ud17',T.double],['uby20',T.byte],
    ['byteLists',byteCount(struct([['key',T.int],['values',byteCount(T.byte)]]))],
    ['dojoChapters',zeroLegends],['ints9',shortCount(T.int)],['ub35',T.bool],['ud18',T.double],
    ['shortBytes',shortCount(struct([['key',T.short],['value',T.byte]]))]])]),
  when(gv(140000),['marker140000',T.int]),
  when(ctx=>ctx.gv>=140100&&ctx.gv<140500,['unknownByte21',T.byte]),when(ctx=>ctx.gv>=140100&&ctx.gv<140500,['marker140100',T.int]),
  when(gv(140200),['entries140200',byteCount(struct([['v1',T.int],['v2',T.int],['v3',T.bool],['v4',T.bool],['v5',T.bool],['v6',T.int],['v7',T.int],['v8',T.int],['v9',T.bool],['v10',T.bool],['v11',T.bool],when(gv(140500),['v12',T.string]),['v13',T.bool]]))]),
  when(gv(140200),['intDoubles140200',byteCount(struct([['key',T.int],['value',T.double]]))]),
  when(gv(140200),['hundredMillionTicket',T.int]),when(gv(140200),['marker140200',T.int]),
  when(gv(140300),['bytes11',byteCount(T.byte)]),
  when(gv(150300),['ui24',T.int]),when(gv(150300),['ub38',T.bool]),
  when(gv(150500),['ub39',T.bool]),
  when(gv(140300),['ub36',T.bool]),
  when(gv(140300),['treasureChests',byteCount(T.int)]),
  when(gv(140300),['ui23',T.int]),
  when(gv(140300),['ints13',shortCount(T.int)]),
  when(gv(140300),['ub37',T.bool]),
  when(gv(140300),['marker140300',T.int]),
];

// ---- After the 14.3 block (the rest is kept as raw bytes) --------------------------------------------------
// Worked out by CanBot from SAVE data alone. Each later game version closed its new data with its version number as
// an int (140500, 140700, 150000 ... 150700), so the tail is split at those markers first; a section is then decoded
// with the layout below only when the layout uses exactly the bytes up to its marker, otherwise it stays raw. Writing
// is byte-exact either way. Fields whose meaning is not known yet are fixed-size `unknown` byte runs.
const bytesN=n=>({read:r=>r.bytes(n),write:(w,v)=>{if(v.length!==n)throw Object.assign(new Error(`Needs ${n} bytes`),{code:'SAVE_FORMAT_ERROR'});w.bytes(v);}});
const TAIL=[
  [140500,struct([['unknown',bytesN(10)]])],
  [140700,struct([['unknown',bytesN(19)]])],
  [150000,struct([['value',T.int]])],
  // A short count of 16-byte entries: an id (1128, 1158 ... seen), a value, then 8 bytes; then 14 bytes.
  [150100,struct([['entries',shortCount(struct([['id',T.int],['value',T.int],['extra',T.double]]))],['a',T.int],['b',T.int],['c',T.int],['d',T.byte],['e',T.byte]])],
  [150200,struct([['a',T.int],['b',T.int],['unknown',bytesN(14)]])],
  [150300,struct([['flag',T.bool]])],
  // Two flags, three unknown bytes, a timestamp in seconds, a flag.
  [150400,struct([['flag1',T.bool],['flag2',T.bool],['unknown',bytesN(3)],['timestamp',T.double],['flag3',T.bool]])],
  // A double, a flag, two bytes, then a counted list of groups (12 shorts and a byte each seen), then 18 bytes.
  [150600,struct([['a',T.double],['flag',T.bool],['unknown1',bytesN(2)],['groups',list(struct([['values',list(T.short)],['flag',T.byte]]))],['unknown2',bytesN(18)]])],
  [150700,struct([['a',T.int],['b',T.int],['c',T.double],when(ctx=>ctx.jp,['jpUnknown',bytesN(5)])])],
];
function findMarker(r,value){for(let i=r.p;i+4<=r.end;i++)if(r.b.readInt32LE(i)===value)return i;return -1;}
const tail={
  read(r,ctx){
    const sections=[];
    for(const [marker,layout] of TAIL){
      if(ctx.gv<marker)break;const at=findMarker(r,marker);if(at<0)break;
      const raw=r.bytes(at-r.p);r.int();
      let fields=null;try{const sub=new SaveReader(raw);const v=layout.read(sub,ctx);if(sub.p===raw.length)fields=v;}catch{}
      sections.push(fields?{marker,fields}:{marker,raw});
    }
    return {sections,rest:r.bytes(r.remaining)};
  },
  write(w,v,ctx){
    for(const s of v.sections){
      if(s.fields){const sub=new SaveWriter();TAIL.find(([m])=>m===s.marker)[1].write(sub,s.fields,ctx);w.bytes(sub.toBuffer());}else w.bytes(s.raw);
      w.int(s.marker);
    }
    w.bytes(v.rest);
  },
};

const save=struct([...header,...early,...middle,...account,...progress,...later,...recent,['tail',tail]]);
module.exports={save,sections:{header,early,middle,account,progress,later,recent},TAIL,tail};

},
"src/canbot-engine/gamedata-pack.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Game data for the local editor in one gzip file, made and read with Node alone (no tar on the server or the
// member's device). Layout before gzip: "CBGD1\n", a JSON line {files:[[relative path, size], ...]}, then the files
// back to back. Only DataLocal/ and resLocal/ of one game version are packed.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const MAGIC='CBGD1\n',FOLDERS=['DataLocal','resLocal'];

function pack(dir){
  const files=[],chunks=[];
  const walk=rel=>{for(const name of fs.readdirSync(path.join(dir,rel)).sort()){const r=`${rel}/${name}`,full=path.join(dir,r),st=fs.statSync(full);
    if(st.isDirectory())walk(r);else if(st.isFile()){const b=fs.readFileSync(full);files.push([r,b.length]);chunks.push(b);}}};
  for(const f of FOLDERS)if(fs.existsSync(path.join(dir,f)))walk(f);
  return zlib.gzipSync(Buffer.concat([Buffer.from(MAGIC+JSON.stringify({files})+'\n','utf8'),...chunks]),{level:6});
}
// The files of a pack as a Map of relative path -> Buffer, without writing anything (what canbot.js uses).
function read(buffer){
  const raw=zlib.gunzipSync(buffer),files=new Map();
  if(raw.subarray(0,MAGIC.length).toString('utf8')!==MAGIC)throw Object.assign(new Error('Not a game data pack.'),{code:'GAME_DATA_PACK'});
  const end=raw.indexOf(10,MAGIC.length);let at=end+1;
  for(const [rel,size] of JSON.parse(raw.subarray(MAGIC.length,end).toString('utf8')).files){if(!Number.isSafeInteger(size)||size<0||at+size>raw.length)throw Object.assign(new Error('Bad game data pack.'),{code:'GAME_DATA_PACK'});files.set(String(rel),raw.subarray(at,at+size));at+=size;}
  return files;
}
// Writes the files under `dir`. Paths must stay inside DataLocal/ or resLocal/.
function unpack(buffer,dir){
  const raw=zlib.gunzipSync(buffer);
  if(raw.subarray(0,MAGIC.length).toString('utf8')!==MAGIC)throw Object.assign(new Error('Not a game data pack.'),{code:'GAME_DATA_PACK'});
  const end=raw.indexOf(10,MAGIC.length),{files}=JSON.parse(raw.subarray(MAGIC.length,end).toString('utf8'));
  let at=end+1;
  for(const [rel,size] of files){
    const parts=String(rel).split('/');
    if(!FOLDERS.includes(parts[0])||parts.some(p=>!p||p==='.'||p==='..')||!Number.isSafeInteger(size)||size<0||at+size>raw.length)throw Object.assign(new Error('Bad game data pack.'),{code:'GAME_DATA_PACK'});
    const out=path.join(dir,...parts);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,raw.subarray(at,at+size));at+=size;
  }
  return files.length;
}
module.exports={pack,unpack,read};

},
"src/canbot-engine/gamedata.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Game data files (DataLocal/*.csv of one game version) for SAVE edits. CanBot's table reading:
// lines split on commas, anything after "//" dropped, cells trimmed, and EMPTY CELLS AND EMPTY LINES REMOVED (later
// columns shift left). A number that is not a plain integer reads as 0.
const fs=require('node:fs'),path=require('node:path');

// Quote removal in one pass: a quote at the start of a field opens a quoted run, "" inside it is one quote and the
// next lone quote closes it; the quotes themselves are dropped. Delimiters inside a quoted run stay as plain
// characters (so they still split cells afterwards).
function unquote(line,delim){
  let out='',quoted=false,fieldStart=true;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(quoted){
      if(ch!=='"')out+=ch;
      else if(line[i+1]==='"'){out+='"';i++;}
      else quoted=false;
      continue;
    }
    if(ch==='"'&&fieldStart){quoted=true;fieldStart=false;continue;}
    out+=ch;fieldStart=ch===delim;
  }
  return out;
}
// Line breaks: CRLF and every single-character break (LF, CR, VT, FF, FS, GS, RS, NEL, LS, PS).
const LINE_BREAKS=new RegExp(String.raw`\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]`);
// Rows of cells: quotes removed, "//" comments cut, split on the delimiter, cells trimmed, empty cells and empty lines
// dropped. keepEmpty keeps them (an empty line is then a row with one empty cell).
function parseCsv(text,delim=',',keepEmpty=false){
  const rows=[],lines=String(text).split(LINE_BREAKS);
  if(lines.length&&lines[lines.length-1]==='')lines.pop();
  for(const line of lines){
    const cells=unquote(line,delim).split('//')[0].split(delim).map(c=>c.trim()).filter(c=>keepEmpty||c!=='');
    if(cells.length||keepEmpty)rows.push(cells);
  }
  return rows;
}
const toInt=v=>{const s=String(v??'').trim();return /^[+-]?\d+(?:_\d+)*$/.test(s)?Number(s.replace(/_/g,'')):0;};

class GameData{
  // dir: the game data folder of one version, e.g. <game data>/kr/15.7.0
  // files: optional Map of "DataLocal/x.csv" -> Buffer (a game data pack read into memory) used instead of the folder.
  constructor(dir,files=null){this.dir=dir;this.files=files;this.cache=new Map();}
  // Name files are comma separated in the Japanese game and '|' separated elsewhere. The data's own region (its
  // folder, <region>/<version>) decides; the SAVE's region is only the fallback. They differ only when names are read
  // from another region's data for display (canbot.js in another language).
  region(){const r=path.basename(path.dirname(this.dir));return ['kr','en','jp','tw'].includes(r)?r:null;}
  delim(cc){return (this.region()||cc)==='jp'?',':'|';}
  _read(rel,encoding){if(this.files){const b=this.files.get(rel);if(!b)throw Object.assign(new Error('missing '+rel),{code:'ENOENT'});return encoding?b.toString(encoding):b;}return fs.readFileSync(path.join(this.dir,...rel.split('/')),encoding);}
  csv(file,folder='DataLocal',delim=',',keepEmpty=false){const key=`${folder}/${file}/${keepEmpty}`;if(!this.cache.has(key)){let text=null;try{text=this._read(`${folder}/${file}`,'utf8');}catch{}this.cache.set(key,text===null?null:parseCsv(text,delim,keepEmpty));}return this.cache.get(key);}
  // Gamatoto: levels (row i = level i+1, column 0 = cumulative XP needed) and the limit row (max level, stages, helpers).
  gamatotoLevels(){const rows=this.csv('GamatotoExpedition.csv');return rows&&rows.map((r,i)=>({level:i+1,xpNeeded:toInt(r[0])}));}
  gamatotoLimit(){const rows=this.csv('GamatotoExpedition_Limit.csv');return rows&&rows.length?{maxLevel:toInt(rows[0][0]),totalStages:toInt(rows[0][1]),totalHelpers:toInt(rows[0][2])}:null;}
  // Gamatoto members (header skipped, id -1 skipped; empty cells kept): id, rarity, bonus, name, rarity name.
  gamatotoMembers(cc){const rows=this.csv(`GamatotoExpedition_Members_name_${this.lang()}.csv`,'resLocal',this.delim(cc),true);return rows&&rows.slice(1).filter(r=>toInt(r[0])!==-1).map(r=>({id:toInt(r[0]),rarity:toInt(r[1]),rarityName:String(r[4]??'')}));}
  // Cat Shrine: cumulative XP boundaries from jinja_level.
  shrineBoundaries(cc){const rows=this.csv('jinja_level.csv','resLocal',this.delim(cc));if(!rows)return null;let sum=0;return rows.map(r=>(sum+=toInt(r[0])));}
  // Ototo: recipe unlocks (cannon, part, ?, ?, level), cannon descriptions (empty cells kept) and the engineer limit.
  recipeUnlocks(){const rows=this.csv('CastleRecipeUnlock.csv');return rows&&rows.map((r,i)=>({index:i,cannon:toInt(r[0]),part:toInt(r[1]),level:toInt(r[4])}));}
  cannonDescriptions(cc){const rows=this.csv('CastleRecipeDescriptions.csv','resLocal',this.delim(cc),true);return rows&&rows.map(r=>({cannonId:toInt(r[0]),name:String(r[6]??'')}));}
  maxEngineers(){const rows=this.csv('CastleCustomLimit.csv');return rows?toInt(rows[0]?.[0]):5;}
  // Talents: SkillAcquisition (header skipped; cat id, type, then 14 numbers per skill), SkillLevel must exist, and
  // the talent names (resLocal SkillDescriptions; "|"-separated outside JP) - a talent without a name is skipped.
  talentData(cc){
    if(this._td!==undefined)return this._td;
    const acq=this.csv('SkillAcquisition.csv'),levels=this.csv('SkillLevel.csv'),names=this.csv('SkillDescriptions.csv','resLocal',this.delim(cc));
    if(!acq||!levels||!names){this._td=null;return null;}
    const cats=new Map();
    for(const r of acq.slice(1)){const at=i=>toInt(r[i]);const skills=[];for(let i=2;i<r.length;i+=14)skills.push({abilityId:at(i),maxLv:at(i+1),textId:at(i+10)});cats.set(at(0),{catId:at(0),typeId:at(1),skills});}
    const nameIds=new Set(names.slice(1).map(r=>toInt(r[0])));
    this._td={cats,nameIds};return this._td;
  }
  // Cat picture book: one line per cat id (line index); column 2 is the number of forms.
  pictureBook(){const rows=this.csv('nyankoPictureBookData.csv');return rows&&rows.map((r,i)=>({catId:i,displayed:toInt(r[0])!==0,limited:toInt(r[1])!==0,totalForms:toInt(r[2])}));}
  // Drop characters: header line skipped; stage id, the unitDrops index, cat id.
  drops(){if(this._drops===undefined){const rows=this.csv('drop_chara.csv');this._drops=rows&&rows.slice(1).map(r=>({stageId:toInt(r[0]),saveId:toInt(r[1]),catId:toInt(r[2])}));}return this._drops;}
  // Drop entries of one cat, in file order.
  dropsOf(catId){if(this._dropsByCat===undefined){const all=this.drops();this._dropsByCat=all&&new Map();for(const d of all||[]){if(!this._dropsByCat.has(d.catId))this._dropsByCat.set(d.catId,[]);this._dropsByCat.get(d.catId).push(d);}}return this._dropsByCat?(this._dropsByCat.get(catId)||[]):null;}
  // Unit purchase/upgrade table, one line per cat id. A missing cell reads as 0.
  unitBuy(){if(!this._ub){const rows=this.csv('unitbuy.csv');this._ub=rows&&rows.map((r,i)=>({id:i,rarity:toInt(r[13]),originalMax:[toInt(r[18]),toInt(r[19])],unlockSource:toInt(r[12]),unknown22:toInt(r[22]),maxNoCatseye:toInt(r[49]),maxCatseye:toInt(r[50]),maxPlus:toInt(r[51]),gameVersion:toInt(r[57])}));}return this._ub;}
  // Language code of the game data (resLocal/localizable.tsv "lang"); "en" when it is missing.
  lang(){const rows=this.csv('localizable.tsv','resLocal','\t');const row=rows?.find(r=>r[0]==='lang');return row?.[1]||'en';}
  // Map names: StageName_[R]<code>_<lang> rows (row index = map index) and Map_Name ids from base. A map listed in
  // Map_Name gets a name (or null); the header row is read too (its id parses as 0).
  mapNames(cc,code,base,noR=false){
    const delim=this.delim(cc),stageRows=this.csv(`StageName_${noR?'':'R'}${code}_${this.lang()}.csv`,'resLocal',delim);if(!stageRows)return null;
    const stageNames=new Map(stageRows.map((r,i)=>[i,r]));
    const nameRows=this.csv('Map_Name.csv','resLocal',delim);if(!nameRows)return null;
    const names=new Map(),total=stageNames.size;
    for(const r of nameRows){const id=toInt(r[0]),name=String(r[1]??'').trim();for(let i=0;i<total;i++)if(id===i+base){names.set(i,name||null);break;}}
    return {names,stageNames};
  }
  // Map_option: header skipped; map id, crown count, ...
  mapOptions(){const rows=this.csv('Map_option.csv');return rows&&new Map(rows.slice(1).map(r=>[toInt(r[0]),{crowns:toInt(r[1])}]));}
  // Special skills: one line per skill (no header): sell price, rarity, max base level, max plus level, ...
  abilityData(){const rows=this.csv('AbilityData.csv');return rows&&rows.map(r=>({maxBase:toInt(r[2]),maxPlus:toInt(r[3])}));}
  // Unit level limits: the reward ids that raise each cat's cap.
  unitLimit(){if(!this._ul){const rows=this.csv('unitlimit.csv');this._ul=rows&&rows.map(r=>r.map(toInt));}return this._ul;}
  // User-rank gifts: threshold, then (reward id, amount) pairs until -1.
  rankGifts(){if(!this._rg){const rows=this.csv('rankGift.csv');this._rg=rows&&rows.map((r,i)=>{const rewards=[];for(let c=1;c<r.length;c+=2){const v=toInt(r[c]);if(v===-1)break;rewards.push([v,toInt(r[c+1])]);}return {index:i,threshold:toInt(r[0]),rewards};});}return this._rg;}
  // Item table (header skipped; item id = row index after the header). Category and index pick a SAVE slot.
  gatyaItemBuy(){if(!this._gb){const rows=this.csv('Gatyaitembuy.csv');this._gb=rows&&rows.slice(1).map((r,i)=>({id:i,rarity:toInt(r[0]),price:toInt(r[2]),quantity:toInt(r[4]),serverId:toInt(r[5]),category:toInt(r[6]),index:toInt(r[7])}));}return this._gb;}
  // Items of one category, stably sorted by their index column.
  gatyaByCategory(category){const buy=this.gatyaItemBuy();return buy&&buy.filter(x=>x.category===category).sort((a,b)=>a.index-b.index);}
  gatyaItemNames(cc){const rows=this.csv('GatyaitemName.csv','resLocal',this.delim(cc));return rows&&rows.map(r=>String(r[0]??''));}
  medalNames(){return this.csv('medalname.tsv','resLocal','\t');}
  missionNames(cc){const rows=this.csv('Mission_Name.csv','resLocal',this.delim(cc));return rows&&new Map(rows.map(r=>[toInt(r[0]),String(r[1]??'')]));}
  // Mission conditions. Files with a shortcut_id column are read with the progress count in column 4 (the older
  // layout); otherwise column 3.
  missionConditions(){
    const rows=this.csv('Mission_Condition.csv');if(!rows)return null;
    const legacy=['id','mission_type','conditions_type','shortcut_id','progress_count','conditions_value'].every((h,i)=>rows[0]?.[i]===h);
    return new Map((legacy?rows.slice(1):rows).map(r=>[toInt(r[0]),{missionType:toInt(r[1]),conditionsType:toInt(r[2]),progressCount:toInt(r[legacy?4:3]),values:r.slice(legacy?5:4).map(toInt)}]));
  }
  // Main story stage names of one chapter group (0 EoC, 1 ItF, 2 CotC): first cell per row, at most 48.
  storyStageNames(cc,group){const rows=this.csv(`StageName${group}_${this.lang()}.csv`,'resLocal',this.delim(cc));return rows&&rows.map(r=>String(r[0]??'')).slice(0,48);}
  // Gacha item name: an id past the list gives the untranslated key.
  gatyaName(cc,id){const names=this.gatyaItemNames(cc);if(!names)return null;return id<names.length?names[id]:'gatya_item_unknown_name';}
  // Enemyname.tsv (empty lines kept): first cell per line.
  enemyNames(){const rows=this.csv('Enemyname.tsv','resLocal','	',true);return rows&&rows.map(r=>String(r[0]??''));}
  // Unit_Explanation<id+1>_<lang>.csv: one line per form, the name first.
  catNames(cc,id){const rows=this.csv(`Unit_Explanation${id+1}_${this.lang()}.csv`,'resLocal',this.delim(cc),true);return rows&&rows.map(r=>String(r[0]??''));}
  // Matatabi.tsv (header skipped): catfruit gacha item ids in SAVE order.
  catfruitIds(){const rows=this.csv('Matatabi.tsv','DataLocal','	');return rows&&rows.slice(1).map(r=>toInt(r[0]));}
  // Talent orb name tables: grade (column 3), attribute (column 0), effect (column 0).
  orbNames(){if(this._orbNames===undefined){const g=this.csv('equipmentgrade.csv'),a=this.csv('attribute_explonation.tsv','resLocal','	'),e=this.csv('equipment_explonation.tsv','resLocal','	');this._orbNames=g&&a&&e?{grade:i=>String(g[i]?.[3]??''),attribute:i=>String(a[i]?.[0]??''),effect:i=>String(e[i]?.[0]??'')}:null;}return this._orbNames;}
  // GatyaDataSetR1.csv: the cat ids of each rare gacha set (-1 dropped).
  gatyaDataSet(){const rows=this.csv('GatyaDataSetR1.csv');return rows&&rows.map(r=>r.map(toInt).filter(x=>x!==-1));}
  // Banner title from the cached event page in the game data store (other_game_data/<cc>/gatya_info/R###.html): the
  // <h2> text without its <span>.
  bannerName(cc,id){
    try{const file=path.join(this.dir,'..','..','..','other_game_data',cc,'gatya_info',`R${String(id).padStart(3,'0')}.html`),b=fs.readFileSync(file);
      const h2=b.indexOf('<h2>');if(h2<0)return null;const end=b.indexOf('</h2>',h2);if(end<0)return null;
      const text=b.subarray(h2+4,end).toString('utf8'),span=text.indexOf('<span');if(span<0)return text;const spanEnd=text.indexOf('</span>',span);if(spanEnd<0)return text;return text.slice(0,span)+text.slice(spanEnd+7);
    }catch{return null;}
  }
  version(){return path.basename(this.dir);}
  rankGiftDescriptions(){const rows=this.csv('user_info.tsv','resLocal','\t');return rows&&rows.map(r=>({threshold:toInt(r[0]),text:String(r[1]??'')}));}
  localizable(){if(this._loc===undefined){const rows=this.csv('localizable.tsv','resLocal','\t');this._loc=rows&&new Map(rows.map(r=>[String(r[0]??''),String(r[1]??'')]));}return this._loc;}
  schemeItems(){const rows=this.csv('schemeItemData.tsv','DataLocal','\t');return rows&&rows.slice(1).map(r=>({id:toInt(r[0]),type:toInt(r[2]),itemId:toInt(r[3]),amount:toInt(r[4])}));}
  // Talent orbs: equipmentlist.json "ID" entries (orb id = position); the name tables must also exist.
  orbList(){
    if(this._orbs===undefined){
      this._orbs=null;
      try{
        for(const f of ['DataLocal/equipmentgrade.csv','resLocal/attribute_explonation.tsv','resLocal/equipment_explonation.tsv'])this._read(f);
        const data=JSON.parse(this._read('DataLocal/equipmentlist.json','utf8'));
        this._orbs=data.ID.map((o,id)=>({id,rank:o.gradeID,effect:o.content,target:o.attribute??null}));
      }catch{}
    }
    return this._orbs;
  }
}

module.exports={GameData,parseCsv,toInt};

},
"src/canbot-engine/index.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// CanBot SAVE engine (JS). parse() reads a SAVE into fields, serialize() writes it back; an unchanged parse must give
// the same bytes. The file ends with a 32-character MD5 hex of
// a region salt plus the body.
const crypto=require('node:crypto');
const {SaveReader,SaveWriter}=require('./binary');
const format=require('./format');

const REGIONS=['kr','jp','en','tw'],DETECT_ORDER=['en','jp','kr','tw'];
const salt=cc=>`battlecats${cc==='jp'?'':cc}`;
function checksum(body,cc){return crypto.createHash('md5').update(Buffer.concat([Buffer.from(salt(cc)),body])).digest('hex');}

function parse(buffer,cc,{log=null}={}){
  if(!REGIONS.includes(cc))throw Object.assign(new Error('Unknown region.'),{code:'SAVE_REGION'});
  if(!Buffer.isBuffer(buffer)||buffer.length<64)throw Object.assign(new Error('SAVE is too short.'),{code:'SAVE_TRUNCATED'});
  const end=buffer.length-32,stored=buffer.subarray(end).toString('latin1'),body=buffer.subarray(0,end);
  // The region whose checksum the file carries wins over the requested one (tried in DETECT_ORDER): the layout
  // differs by region (an EN-only byte) and the file is written back with that region's checksum. The requested region applies only when no checksum matches.
  const detected=DETECT_ORDER.find(c=>stored===checksum(body,c)),region=detected||cc;
  const ctx={cc:region,jp:region==='jp',gv:buffer.readInt32LE(0)};
  const reader=new SaveReader(buffer,{end,log});
  const data=format.save.read(reader,ctx);
  return {cc:region,requestedCc:cc,gameVersion:ctx.gv,checksumOk:Boolean(detected),data};
}
function serialize(save){
  const ctx={cc:save.cc,jp:save.cc==='jp',gv:save.data.gameVersion};
  const w=new SaveWriter();format.save.write(w,save.data,ctx);
  const body=w.toBuffer();return Buffer.concat([body,Buffer.from(checksum(body,save.cc),'latin1')]);
}
// Bytes described by named fields, as a share of the body. `raw` is what is kept undecoded (tail sections whose layout
// did not fit, and anything after the last known section); `unknown` counts fixed-size unknown runs inside decoded
// sections (named, kept exactly, meaning not known yet).
function coverage(save,size){
  const t=save.data.tail||{sections:[],rest:Buffer.alloc(0)},body=size-32;
  const raw=t.rest.length+t.sections.reduce((n,s)=>n+(s.raw?s.raw.length:0),0);
  const unknown=t.sections.reduce((n,s)=>n+(s.fields?Object.values(s.fields).reduce((m,v)=>m+(Buffer.isBuffer(v)?v.length:0),0):0),0);
  return {parsed:body-raw,body,raw,unknown,ratio:(body-raw)/body,sections:t.sections.map(s=>`${s.marker}${s.fields?'':'(raw)'}`)};
}
const versionText=gv=>{const s=String(gv).padStart(6,'0');return `${Number(s.slice(0,2))}.${Number(s.slice(2,4))}.${Number(s.slice(4,6))}`;};

const {set,diff}=require('./edit');
module.exports={parse,serialize,checksum,coverage,versionText,set,diff,REGIONS};

},
"src/canbot-engine/items.js":function(module,exports,require){
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

},
"src/canbot-engine/levels.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Cat level edits. Stored base levels are zero-based (level 1 = base 0).
//
// A cat climbs one level at a time. Under its cap it takes a normal level-up; at the cap, a cat of rarity above
// Normal whose level is in its catseye range climbs with a catseye (counted in catsCatseyesUsed and in the cap record)
// up to its catseye maximum. The cap is the unit's original maximum plus the cat's cap record (catsMaxUpgrade.base),
// which is rebuilt from the user-rank gifts that raise this unit's limit.
//
// Strict upgrade (session setting) follows the SAVE more closely: only claimed rank gifts count, a cat held at its
// special level needs upgrade state 2 for a normal level-up, and catseye levels need user rank 1600 (re-read at every
// step, since levelling raises the rank). Without strict upgrade none of these restrict anything.
const {unlock}=require('./cats');
const settings=require('./settings');
const fail=(code,message,extra={})=>Object.assign(new Error(message),{code,...extra});
const setAt=(list,i,v)=>{if(Array.isArray(list)&&i>=0&&i<list.length)list[i]=v;};
const CATSEYE_RANK=1600;

// Rebuilds the cap record from the rank gifts whose rewards are this unit's limit ids (1000-1599 raise the base cap,
// 4000-4599 the plus cap). Units without limit data keep their record. Returns the base bonus for this edit.
function rebuildCapRecord(save,gd,id,strict){
  const record=save.data.catsMaxUpgrade[id],limitIds=gd.unitLimit()?.[id]??null;
  if(!limitIds)return record.base;
  record.base=0;record.plus=0;
  const gifts=gd.rankGifts(),claimed=save.data.userRankRewards;
  for(let r=0;r<claimed.length;r++){
    const gift=gifts&&r<gifts.length?gifts[r]:null;
    if(!gift||(strict&&!claimed[r]))continue;
    for(const [reward,amount] of gift.rewards){
      const hits=limitIds.filter(l=>l===reward).length;if(!hits)continue;
      if(reward>=1000&&reward<=1599)record.base+=amount*hits;
      else if(reward>=4000&&reward<=4599)record.plus+=amount*hits;
    }
  }
  return record.base;
}

// One cat's levelling for this edit. Creating it rebuilds the cap record.
function climber(save,gd,id){
  const cfg=settings.get(),strict=cfg.strictUpgrade;
  const unit=gd.unitBuy()?.[id]??null,record=save.data.catsMaxUpgrade[id],bonus=rebuildCapRecord(save,gd,id,strict);
  const up=save.data.catsUpgrade[id];
  const touch=()=>{if(cfg.unlockOnEdit)unlock(save,gd,id);};
  const inCatseyeRange=lv=>unit.rarity!==0&&lv>=unit.maxNoCatseye&&lv<unit.maxCatseye;

  // 'normal', 'catseye' or null for a cat at level lv (1-based) under the cap.
  function nextStep(lv,cap){
    if(lv<cap){
      const held=strict&&lv===unit.unknown22&&save.data.upgradeState<2;
      if(!held||inCatseyeRange(lv))return 'normal';
    }
    const rankOk=!strict||require('./collections').userRank(save)>=CATSEYE_RANK;
    if(unit.maxNoCatseye!==-1&&unit.maxNoCatseye<=cap&&inCatseyeRange(lv)&&rankOk)return 'catseye';
    return null;
  }
  function step(){
    if(!unit)return false;
    const kind=nextStep(up.base+1,Math.min(unit.originalMax[0]+bonus,unit.maxCatseye));
    if(!kind)return false;
    touch();up.base+=1;
    if(kind==='catseye'){setAt(save.data.catsCatseyesUsed,id,(save.data.catsCatseyesUsed[id]??0)+1);record.base+=1;}
    return true;
  }
  return {
    unit,
    climbAll(){while(step());},
    climb(n){for(let i=0;i<n&&step();i++);},
    reset(){up.base=0;setAt(save.data.catsCatseyesUsed,id,0);},
    setPlus(plus){touch();up.plus=plus;},
    maxBase:()=>unit?unit.maxCatseye:90,
    maxPlus:()=>unit?unit.maxPlus:90,
  };
}

// CanBot's rule: keep the SAVE's own cap record unless the new level needs more under the cap formula.
function keepCapRecords(save,gd,ids,run){
  const snapshot=ids.map(id=>[id,save.data.catsMaxUpgrade[id].base,save.data.catsMaxUpgrade[id].plus]);
  try{return run();}
  finally{
    for(const [id,base,plus] of snapshot){
      const record=save.data.catsMaxUpgrade[id],row=gd.unitBuy()?.[id];
      if(!row){record.base=base;record.plus=plus;continue;}
      const up=save.data.catsUpgrade[id];
      record.base=up.base+1<=row.originalMax[0]+base?base:Math.max(base,record.base);
      record.plus=up.plus<=row.originalMax[1]+plus?plus:Math.max(plus,record.plus);
    }
  }
}
const unavailable=()=>fail('CAT_LEVEL_METADATA_UNAVAILABLE','Level data is unavailable.');
function climbers(save,gd,ids,{requireAll=false}={}){
  const cs=ids.map(id=>climber(save,gd,id));
  if(requireAll?cs.some(c=>!c.unit):cs.length&&cs.every(c=>!c.unit))throw requireAll?fail('CAT_LEVEL_METADATA','Level data is unavailable.'):unavailable();
  return cs;
}

function maxUpgrade(save,gd,ids){keepCapRecords(save,gd,ids,()=>climbers(save,gd,ids).forEach(c=>c.climbAll()));}
function upgradeBy(save,gd,ids,amount){
  if(!Number.isSafeInteger(amount)||amount<=0)throw fail('INVALID_INPUT','amount must be greater than 0.');
  keepCapRecords(save,gd,ids,()=>climbers(save,gd,ids).forEach(c=>c.climb(amount)));
}
function setLevel(save,gd,ids,base,plus){
  keepCapRecords(save,gd,ids,()=>{
    const cs=climbers(save,gd,ids,{requireAll:true});
    if(!Number.isSafeInteger(base)||!Number.isSafeInteger(plus))throw fail('INVALID_INPUT','base and plus must be integers.');
    if(base<1)throw fail('INVALID_INPUT','Base level must be at least 1.');
    for(const c of cs)if(base>c.maxBase()||plus>c.maxPlus())throw fail('CAT_LEVEL_LIMIT','Level is above the limit.');
    cs.forEach((c,i)=>{
      c.reset();c.climb(base-1);c.setPlus(plus);
      const up=save.data.catsUpgrade[ids[i]];if(up.base!==base-1||up.plus!==plus)throw fail('CAT_LEVEL_UNREACHABLE','That level cannot be reached.');
    });
  });
}
// Max base and plus: every cat must have catalog limits; each climbs as far as it can and takes the catalog plus, and
// the result must be the catalog maximum.
function maxBasePlus(save,gd,ids){
  keepCapRecords(save,gd,ids,()=>{
    const rows=gd.unitBuy();if(!rows)throw unavailable();
    const expected=ids.map(id=>{const row=rows[id];if(!row)throw unavailable();if(row.maxCatseye<1||row.maxPlus<0)throw fail('CAT_LEVEL_UNSUPPORTED','Unsupported level data.');return [row.maxCatseye-1,row.maxPlus];});
    const cs=ids.map(id=>climber(save,gd,id));
    cs.forEach((c,i)=>{c.climbAll();c.setPlus(expected[i][1]);});
    cs.forEach((c,i)=>{const up=save.data.catsUpgrade[ids[i]];if(up.base!==expected[i][0]||up.plus!==expected[i][1])throw fail('CAT_LEVEL_BACKEND_FAILURE','Level did not reach the maximum.');});
  });
}

module.exports={maxUpgrade,upgradeBy,setLevel,maxBasePlus,climber};

},
"src/canbot-engine/maps.js":function(module,exports,require){
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

},
"src/canbot-engine/maxaccount.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Max Account: one composite edit, in this order:
// resources, cats (unlock, levels, forms, guide, talents), special skills, Gamatoto/Ototo, talent orbs, enemy guide,
// tutorial, story, treasures, outbreaks, then the selected map categories.
const fail=(code,message,extra={})=>Object.assign(new Error(message),{code},extra);
const cats=require('./cats'),levels=require('./levels'),talents=require('./talents'),story=require('./story');
const maps=require('./maps'),expedition=require('./expedition'),collections=require('./collections'),items=require('./items');

const COMPONENTS=['resources','cats','specialSkills','expedition','talentOrbs','enemyGuide','story','treasures','outbreaks','tutorial'];
const MAX={catfood:45000,xp:99999999,normal:2999,hundredMillion:9999,rare:299,platinum:9,legend:4,np:9999,leadership:9999,battleItems:9999,catamins:9999,catseyes:9999,labyrinth:9999,chests:9999};

// Resources at their maximums. Catfood and the rare/platinum/legend tickets record their change (none for 0).
function maxResources(save,{now}){
  const d=save.data;
  const managed=(field,type,value)=>{const change=value-d[field];d[field]=value;if(change){const list=items.managedItems(save).filter(m=>m.amount!==0);list.push({amount:Math.abs(change),at:Math.floor(now()),type,detail:change>0?'get':'use'});items.setManagedItems(save,list);}};
  managed('catfood','catfood',MAX.catfood);d.xp=MAX.xp;d.normalTickets=MAX.normal;
  managed('rareTickets','rareTicket',MAX.rare);managed('platinumTickets','platinumTicket',MAX.platinum);managed('legendTickets','legendTicket',MAX.legend);
  if('platinumShards' in d)d.platinumShards=10*MAX.platinum;
  d.np=MAX.np;d.leadership=MAX.leadership;d.battleItems.fill(MAX.battleItems);d.catamins.fill(MAX.catamins);d.catseyes.fill(MAX.catseyes);
  d.labyrinth?.medals?.items?.fill(MAX.labyrinth);d.treasureChests?.items?.fill(MAX.chests);
  if('hundredMillionTicket' in d)d.hundredMillionTicket=MAX.hundredMillion;
}
function maxCats(save,gd,at){
  const book=gd.pictureBook(),rows=gd.unitBuy();
  if(!book||!rows)throw fail('CAT_LEVEL_METADATA_UNAVAILABLE','Level data is unavailable.');
  const shown=new Set(book.filter(c=>c.displayed).map(c=>c.catId));
  const obtainable=save.data.catsUnlocked.map((_,id)=>id).filter(id=>shown.has(id));
  const eligible=[];
  for(const id of obtainable){const row=rows[id];if(!row||row.gameVersion===-1)throw fail('CAT_LEVEL_METADATA_UNAVAILABLE','Level data is unavailable.');if(row.gameVersion<=save.gameVersion)eligible.push(id);}
  at('cat_unlock');for(const id of eligible)cats.unlock(save,gd,id);
  at('cat_levels');if(eligible.length)levels.maxBasePlus(save,gd,eligible);
  at('cat_forms');cats.forms(save,gd,eligible,{fourth:false});cats.forms(save,gd,eligible,{fourth:true});
  at('cat_guide');for(const id of eligible){cats.editUnlock(save,gd,id);save.data.catGuideCollected[id]=1;}
  at('cat_talents');const outcome=eligible.length?talents.maxTalents(save,gd,eligible,{composite:true}):null;
  at('cat_rank_sale');save.data.rankUpSaleValue=0x7fffffff;
  return outcome;
}

// edit: {components:{name:bool}, mapCategories:[...]}; now(): seconds, for the managed-item records.
function maxAccount(save,gd,edit={},{now=()=>Date.now()/1000}={}){
  const components=edit.components??{};
  if(typeof components!=='object'||Array.isArray(components)||Object.entries(components).some(([k,v])=>!COMPONENTS.includes(k)||typeof v!=='boolean'))throw fail('INVALID_INPUT','Invalid Max Account component policy.');
  const on=k=>components[k]??true;
  let component='maps_prepare',outcome=null;
  try{
    const plans=maps.prepareCategories(save,gd,edit.mapCategories??[]);
    if(!COMPONENTS.some(on)&&!plans.length)throw fail('INVALID_INPUT','Max Account has no enabled components or selected maps.',{policy:true});
    component='story_metadata';
    const chapters=['story','treasures','outbreaks'].some(on)?[...Array(story.layout(save)).keys()]:[];
    component='resources';if(on('resources'))maxResources(save,{now});
    component='cat_metadata';if(on('cats'))outcome=maxCats(save,gd,c=>{component=c;});
    component='specialSkills';if(on('specialSkills'))story.setSkills(save,gd);
    component='expedition';if(on('expedition'))expedition.maxAccount(save,gd);
    component='talentOrbs';if(on('talentOrbs'))collections.maxHighestTalentOrbs(save,gd);
    component='enemyGuide';if(on('enemyGuide'))collections.unlockAllEnemies(save);
    component='tutorial';if(on('tutorial'))story.clearTutorial(save);
    component='story';if(on('story'))story.applyStory(save,{type:'story_clear',chapters,mode:'whole'});
    component='treasures';if(on('treasures'))story.applyStory(save,{type:'treasures',chapters,mode:'whole',value:3});
    component='outbreaks';if(on('outbreaks'))story.completeAllOutbreaks(save);
    component='maps';for(const [a,def,plan] of plans)maps.execute(a,def,plan);
    return outcome;
  }catch(err){
    if(err.policy)throw err;
    const trusted=/^CAT_(LEVEL|TALENT)_/.test(err.code||'');
    throw fail(trusted?err.code:'MAX_ACCOUNT_COMPONENT_FAILED','Max Account failed.',{component,reason:trusted?err.code:'MAX_ACCOUNT_BACKEND_FAILURE',cause:err});
  }
}

module.exports={maxAccount,maxResources,COMPONENTS};

},
"src/canbot-engine/metadata.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Read-only answers the editors ask for (metadata actions): names, limits, current values and the editor's own
// explanations, as JSON.
const story=require('./story'),maps=require('./maps'),expedition=require('./expedition'),extra=require('./extra');
const items=require('./items'),settings=require('./settings'),misc=require('./misc'),collections=require('./collections'),talents=require('./talents');
const e={versionText:gv=>{const s=String(gv).padStart(6,'0');return `${Number(s.slice(0,2))}.${Number(s.slice(2,4))}.${Number(s.slice(4,6))}`;}};
const fail=(code,message)=>Object.assign(new Error(message),{code});
const MAX={treasureLevel:9999,itfTimedScore:9999,stageClear:9999,platinumTickets:9};
const ITEM_NAMES=['catfood','xp','normal_tickets','rare_tickets','platinum_tickets','legend_tickets','platinum_shards','np','leadership'];
const INVENTORY_CATEGORY={catamins:6,catseyes:5,labyrinth_medals:11,treasure_chests:12,base_materials:7,battle_items:3};

function storyMeta(save,gd){
  const d=save.data,loc=gd.localizable(),names=[];
  const base=story.layout(save),{chapters}=misc.storyMetadata(save,gd);
  for(let id=0;id<base;id++){const [key,n]=id<3?['everyplay_mapname_J',id+1]:id<6?['everyplay_mapname_W',id-2]:['everyplay_mapname_P',id-5];names.push(loc.get(key).replace('%d',String(n)));}
  return {chapters:chapters.map(c=>{const raw=c.id<3?c.id:c.id+1,ob=d.outbreaks.find(p=>p[0]===raw);
      return {id:c.id,group:story.chapterType(c.id),name:names[c.id],stages:c.stages,outbreakStages:ob?ob[1].map(p=>p[0]).sort((a,b)=>a-b):[]};}),
    treasureMax:3,treasureCustomMax:MAX.treasureLevel,scoreMax:MAX.itfTimedScore,clearMax:settings.cap(MAX.stageClear,15)};
}
function itemMeta(save){
  const d=save.data,shards='platinumShards' in d,current={};
  for(const n of ITEM_NAMES){const v=d[items.FIELD[n]];if(Number.isInteger(v))current[n]=v;}
  const limits=disable=>settings.use({...settings.get(),disableMaxes:disable},()=>Object.fromEntries(ITEM_NAMES.map(n=>[n,n==='platinum_shards'&&!shards?null:items.limit(save,n)])));
  const recommended=limits(false);
  return {limits:recommended,recommendedLimits:recommended,extendedLimits:limits(true),currentValues:current,
    storage:{emptySlots:d.storageTypes.filter(t=>t===0).length,occupiedSlots:d.storageTypes.map((t,i)=>t?i:-1).filter(i=>i>=0)},
    dependencies:{platinum_shards:{item:'platinum_tickets',maximum:MAX.platinumTickets,multiplier:10,remainder:9}}};
}
function inventoryMeta(save,gd,name){
  if(!['catamins','catseyes','labyrinth_medals','treasure_chests','base_materials','battle_items','catfruit'].includes(name))throw fail('INVALID_INPUT','Unsupported inventory.');
  if(name==='catfruit')return catfruitMeta(save,gd);
  const list=gd.gatyaByCategory(INVENTORY_CATEGORY[name]);if(!list)throw fail('INVALID_INPUT','Item metadata is unavailable.');
  const values=story.inventoryValues(save,name);
  if(list.length<values.length)throw fail('INVALID_INPUT','Item metadata is incomplete.');
  return {entries:list.slice(0,values.length).map((it,i)=>({id:i,name:gd.gatyaName(save.cc,it.id)||`Item ${i}`,value:values[i]})),maximum:story.inventoryLimit(save,name)};
}
function expeditionMeta(save,gd){
  const d=save.data,base=expedition.metadata(save,gd),descriptions=gd.cannonDescriptions(save.cc),recipes=gd.recipeUnlocks();
  const cannons=d.ototoCannons.map(([id,c])=>({id,name:descriptions.find(x=>x.cannonId===id).name,maximums:c.levels.map((_,p)=>expedition.maxPartLevel(recipes,p)),current:[...c.levels]}));
  const levels=gd.gamatotoLevels(),limit=gd.gamatotoLimit(),current={};
  try{
    const xp=d.gamatoto.xp,max=limit.maxLevel;let row=null;
    for(const l of levels){if(l.level>=max)break;if(l.xpNeeded===-1)continue;if(xp<l.xpNeeded){row=l;break;}}
    if(!row)row=max>=levels.length?levels[levels.length-1]:levels[max-1];
    if(xp>=0&&levels.length&&max){
      const level=Math.min(row.level,max),floor=level<=1?0:levels[level-2].xpNeeded,ceiling=level<max&&level-1<levels.length?levels[level-1].xpNeeded:null;
      current.gamatoto=floor<0||ceiling!==null&&ceiling<=floor?{level,maxLevel:max,xp}:{level,maxLevel:max,xp,levelXp:floor,nextLevelXp:ceiling,toNext:ceiling!==null?Math.max(0,ceiling-xp):0};
    }
  }catch{}
  const rarityOf=new Map(base.members.map(m=>[m.id,m.rarity])),counts=base.rarities.map(()=>0);
  for(const h of d.gamatotoHelpers){const r=rarityOf.get(h);if(r!==undefined)counts[r]++;}
  current.helpers={total:d.gamatotoHelpers.filter(h=>h>=0).length,byRarity:counts};
  if(d.ototoEngineers>=0)current.engineers=d.ototoEngineers;
  try{
    const b=gd.shrineBoundaries(save.cc),xp=Number(d.catShrine.xpOffering);
    if(b&&b.length&&xp>=0){
      let level=b.length;for(let i=0;i<b.length;i++)if(xp<b[i]){level=i+1;break;}
      const ceiling=level<b.length?b[level-1]:null;
      current.shrine={level,maxLevel:b.length,xp,levelXp:level<=1?0:b[level-2],nextLevelXp:ceiling,toNext:ceiling!==null?Math.max(0,ceiling-xp):0,visible:!d.catShrine.gone};
    }
  }catch{}
  return {maxLevel:base.maxLevel,maxHelpers:base.maxHelpers,rarities:base.rarities,rarityCounts:base.rarityCounts,engineerMax:base.engineerMax,cannons,current};
}
function shrineMeta(save,gd){const {max,maxXp}=expedition.shrineLimits(gd,save.cc);if(!max)throw fail('INVALID_INPUT','Cat Shrine data unavailable.');return {shrineLevelMax:max,shrineXpMax:maxXp};}
// The editor's field names and explanations for the extra operations.
const EXTRA_TEXT={
  rare_trade:{name:'Tickets to prepare for trade',nameKo:'교환할 레어 티켓 수량',note:'Prepares trade progress and one special-skill storage slot. Tickets are obtained by trading in game; the ticket balance is not changed here.',noteKo:'특수 능력 저장고에 교환에 필요한 항목을 준비합니다. 레어 티켓은 게임에서 교환을 완료해야 받을 수 있습니다.'},
  hundred_million:{name:'100 Million Tickets',nameKo:'1억 다운로드 기념 티켓 수량',note:'This is the legacy 100-million-download ticket field; availability depends on the game event.',noteKo:'1억 다운로드 기념 티켓 수량을 바꿉니다. 게임 내 사용 가능 여부는 이벤트에 따라 달라집니다.'},
  slots:{name:'Unlocked Lineups',nameKo:'해금된 편성 슬롯 수'},
  aku:{names:[['First stages to clear','처음부터 클리어 처리할 스테이지 수'],['Clear count','스테이지별 클리어 횟수']],note:'Applies the count to the first N Aku stages and resets every later stage to zero, matching the original progress editor.',noteKo:'처음부터 지정한 수만큼의 마계편 스테이지에 클리어 횟수를 적용합니다. 이후 스테이지의 클리어 횟수는 0이 됩니다.'},
  gold_add:{name:'Officer ID (0 = random)',nameKo:'회원 번호 (0이면 자동 생성)',note:'Applies the upstream Gold Pass state with a 30-day term and renewal. Resets its claimed rewards and login bonus counter.',noteKo:'30일 골드 회원 상태를 등록합니다. 수령한 회원 보상 기록과 로그인 보너스 횟수를 초기화합니다.'},
  gold_remove:{note:'Removes Gold Pass state and resets its claimed rewards and login bonus counter.',noteKo:'골드 회원 상태를 해제하고 수령한 회원 보상 기록과 로그인 보너스 횟수를 초기화합니다.'},
};
function extraMeta(save,op){
  const base=extra.metadata(save,op),t=EXTRA_TEXT[op];
  const fields=base.fields.map((f,i)=>({id:f.id,name:t.names?t.names[i][0]:t.name,nameKo:t.names?t.names[i][1]:t.nameKo,max:f.max}));
  if(op==='slots')fields[0].value=save.data.unlockedLineups;
  return {fields,...(t.note?{note:t.note,noteKo:t.noteKo}:{})};
}
function mapMeta(save,gd,category){return maps.metadata(save,gd,category,{display:true});}

function catfruitMeta(save,gd){
  const ids=gd.catfruitIds();if(!ids)throw fail('INVALID_INPUT','Catfruit metadata unavailable.');
  const names=ids.map(id=>gd.gatyaName(save.cc,id)),values=save.data.catfruit;
  return {entries:values.map((v,i)=>({id:i,name:i<names.length&&names[i]?names[i]:`Catfruit ${i}`,value:v})),maximum:story.inventoryLimit(save,'catfruit')};
}

// Collections: the catalog (collections.js) decides the entries; this adds names and labels.
const COLLECTION_ACTIONS={enigma:{append:'Add to Existing Enigmas',replace:'Replace Existing Enigmas'},rank_rewards:{claimed:'Mark Claimed',unclaimed:'Mark Unclaimed'},
  enemy_guide:{add:'Unlock',remove:'Remove'},medals:{add:'Add',remove:'Remove'},missions:{reward:'Complete — Reward Available',claimed:'Complete — Reward Claimed',remove:'Uncomplete'},
  scheme_items:{add:'Make Available',remove:'Remove'},storage:{remove:'Remove from Storage'}};
function collectionMeta(save,gd,kind){
  const d=save.data,meta=collections.catalog(save,gd,kind),actions=COLLECTION_ACTIONS[kind];
  const gname=id=>gd.gatyaName(save.cc,id);
  let entries;
  if(kind==='skills'){
    const list=gd.gatyaByCategory(2),valid=d.specialSkills.filter((_,i)=>i!==1);
    entries=meta.entries.map(e=>({id:e.id,name:gname(list[e.id].id)||String(list[e.id].id),baseMax:e.baseMax,plusMax:e.plusMax,base:valid[e.id].base+1,plus:valid[e.id].plus}));
    return {entries,fields:[{id:'base',name:'Base level (minimum 1)',nameKo:'기본 레벨 (최소 1)',max:Math.max(...entries.map(e=>e.baseMax))},{id:'plus',name:'Plus level',nameKo:'플러스 레벨',max:Math.max(...entries.map(e=>e.plusMax))}]};
  }
  if(kind==='enigma'){const names=gd.mapNames(save.cc,'H',25000).names;entries=meta.entries.map(e=>({id:e.id,name:names.get(e.id)||`Enigma ${e.id}`}));}
  else if(kind==='endless'){const names=gd.gatyaItemNames(save.cc),list=gd.gatyaByCategory(3);return {entries:meta.entries.map(e=>({id:e.id,name:names[list[e.id].id]})),duration:true};}
  else if(kind==='storage_skills'){const list=gd.gatyaByCategory(2);return {entries:meta.entries.map(e=>({id:e.id,name:gname(list[e.id].id)||String(list[e.id].id)})),maximum:meta.maximum};}
  else if(kind==='rank_rewards'){const desc=gd.rankGiftDescriptions();entries=meta.entries.map(e=>{const text=desc.find(x=>x.threshold===e.threshold).text;return {id:e.id,name:`${e.threshold} · `+text.replace(/<br>/g,' ').replace(/<[^>]*>/g,'')};});}
  else if(kind==='enemy_guide'){const names=gd.enemyNames();entries=meta.entries.map(e=>{let name=null;if(names){name=e.id<names.length?(names[e.id]||'enemy_not_in_name_list'):'enemy_unknown_name';}return {id:e.id,name:name||`Enemy ${e.id}`,owned:Boolean(d.enemyGuide[e.id])};});}
  else if(kind==='medals'){const names=gd.medalNames();entries=meta.entries.map(e=>({id:e.id,name:names[e.id][0]}));}
  else if(kind==='missions'){
    const names=gd.missionNames(save.cc),conditions=gd.missionConditions();
    entries=meta.entries.map(e=>{const c=conditions.get(e.id);let name=names.get(e.id).split('<br>')[0].split('%d').join(String(c.progressCount));if(c.values.length>2)name=name.split('%@').join(String(c.values[2]));return {id:e.id,name};});
  }
  else if(kind==='talent_orbs'){
    const orbs=gd.orbList(),t=gd.orbNames(),owned=new Map(d.talentOrbs.items.map(o=>[o.id,o.value]));
    return {entries:orbs.map(o=>({id:o.id,name:t.effect(o.effect).replace('%@',t.grade(o.rank)).replace('%@',o.target===null?'':t.attribute(o.target)),value:owned.get(o.id)??0})),maximum:meta.maximum};
  }
  else if(kind==='scheme_items'){
    const loc=gd.localizable();
    entries=gd.schemeItems().map(r=>{
      let name=loc.get(`scheme_popup_${r.id}`),item;
      if(r.type===1){const n=gd.catNames(save.cc,r.itemId);item=n&&n.length?n[0]:String(r.itemId);}else item=gname(r.itemId)||String(r.itemId);
      name=name.split('<flash>,').join('').split('<flash>').join('').split('<br>').join(' ');
      if(r.type===1)name=name.split('%@').join(item);
      else{const first=name.indexOf('%@'),second=first>=0?name.indexOf('%@',first+2):-1;if(first>=0&&second>=0)name=name.slice(0,first)+`${r.amount} ${item}`+name.slice(second+2);}
      return {id:r.id,name};
    });
  }
  else if(kind==='storage'){const label={1:'cat',2:'special_skill',3:'item'};entries=meta.entries.map(e=>({id:e.id,name:label[d.storageTypes[e.id]]||'unrecognised_storage_item'}));}
  else if(kind==='event_tickets'){
    return {entries:meta.entries.map(e=>({id:e.id,name:e.name,value:e.value})),maximum:meta.maximum,
      note:'Stored tickets for this exact game version. Event availability in game can differ.',noteKo:'이 지역·버전의 저장 데이터에 있는 티켓입니다. 게임에서 사용 가능 여부는 이벤트에 따라 달라집니다.'};
  }
  else throw fail('INVALID_INPUT','Unsupported collection.');
  return {entries,...(actions?{actions}:{})};
}

function catLevelMeta(save,gd,ids){
  if(!Array.isArray(ids)||!ids.length)throw fail('INVALID_INPUT','Select cats first.');
  const rows=gd.unitBuy(),entries=[];
  for(const id of [...new Set(ids)]){
    if(typeof id!=='number'||!Number.isSafeInteger(id)||id<0||id>=save.data.catsUnlocked.length)throw fail('INVALID_INPUT',`Cat ID ${id} was not found.`);
    const r=rows?.[id];if(!r)throw fail('CAT_LEVEL_METADATA','Level data is unavailable.');
    entries.push({baseMax:r.maxCatseye,plusMax:r.maxPlus});
  }
  return {baseMax:Math.min(...entries.map(e=>e.baseMax)),plusMax:Math.min(...entries.map(e=>e.plusMax))};
}
function talentMeta(save,gd,ids){
  const versions={saveGameVersion:e.versionText(save.gameVersion),catalogGameVersion:gd.version()};
  if(!Array.isArray(ids)||!ids.length)throw fail('CAT_TALENT_INVALID_TARGET','TARGET_CHECK');
  for(const id of ids)if(typeof id!=='number'||!Number.isSafeInteger(id)||id<0||id>=save.data.catsUnlocked.length)throw fail('CAT_TALENT_INVALID_TARGET','TARGET_CHECK');
  const td=gd.talentData(save.cc);if(!td)throw Object.assign(fail('CAT_TALENT_METADATA_UNAVAILABLE','METADATA_READ'),{versions});
  return {members:[...new Set(ids)].map(id=>talents.classify(td,save,id)[0]),versions};
}

function selectorIds(save,gd,mode,value){
  const d=save.data,all=d.catsUnlocked.map((_,i)=>i),rows=gd.unitBuy();
  const shown=()=>{const book=gd.pictureBook();if(!book)return null;return new Set(book.filter(c=>c.displayed).map(c=>c.catId));};
  if(mode==='all')return all;
  if(mode==='unlocked')return all.filter(i=>d.catsUnlocked[i]);
  if(mode==='not_unlocked')return all.filter(i=>!d.catsUnlocked[i]);
  if(mode==='obtainable'){const s=shown();return s?all.filter(i=>s.has(i)):null;}
  if(mode==='unobtainable'){const s=shown();return s?all.filter(i=>!s.has(i)):null;}
  if(mode==='non_gacha')return all.filter(i=>rows?.[i]&&rows[i].unlockSource!==2);
  const words=String(value??'').trim().replace(/,/g,' ').split(/\s+/).filter(Boolean);
  if(mode==='ids'){
    const max=all.length-1,ids=[];
    for(const w of words){if(w.includes('-')){const [a,b]=w.split('-',2).map(Number);if(!(Number.isInteger(a)&&Number.isInteger(b)&&0<=a&&a<=b&&b<=max))throw fail('INVALID_INPUT','Invalid cat ID range.');for(let i=a;i<=b;i++)ids.push(i);}else{const n=Number(w);if(!Number.isInteger(n))throw fail('INVALID_INPUT','Invalid cat ID.');ids.push(n);}}
    return all.filter(i=>ids.includes(i));
  }
  if(mode==='rarity'){const wanted=words.map(Number);return all.filter(i=>rows?.[i]&&wanted.includes(rows[i].rarity));}
  if(mode==='gacha'){const set=gd.gatyaDataSet()||[],ids=new Set();for(const w of words){const row=set[Number(w)];if(row)for(const id of row)ids.add(id);}return all.filter(i=>ids.has(i));}
  if(mode==='game_version'){
    const parse=t=>{const p=t.split('.').map(Number);return p[0]*10000+(p[1]||0)*100+(p[2]||0);};
    const wanted=words.map(w=>{if(w.includes('-')){const [a,b]=w.split('-',2).map(parse);return [Math.min(a,b),Math.max(a,b)];}const v=parse(w);return [v,v];});
    return rows?all.filter(i=>rows[i]&&wanted.some(([a,b])=>a<=rows[i].gameVersion&&rows[i].gameVersion<=b)):[];
  }
  // Name search: the text inside any form name, ignoring case.
  if(mode==='name'){const q=String(value??'').trim().toLowerCase();return all.filter(i=>{const n=gd.catNames(save.cc,i);return Boolean(n)&&n.some(x=>x.toLowerCase().includes(q));});}
  throw fail('NOT_PORTED',`cat selector mode ${mode}`);
}
const zfillVersion=v=>{const s=String(v).padStart(6,'0');return `${s.slice(0,2)}.${s.slice(2,4)}.${s.slice(4,6)}`;};
function selectorInfo(save,gd){
  const set=gd.gatyaDataSet(),rows=gd.unitBuy(),loc=gd.localizable(),rarities=[];
  for(let i=1;loc&&loc.has(`rarity_name_${i}`);i++)rarities.push(loc.get(`rarity_name_${i}`));
  const versions=rows?[...new Set(rows.map(r=>r.gameVersion).filter(v=>v!==-1))].sort((a,b)=>a-b):[];
  return {success:true,maxCatId:Math.max(0,save.data.catsUnlocked.length-1),gachaBannerMaxId:set?Math.max(0,set.length-1):null,
    gameVersions:versions.map(zfillVersion),rarities,banners:set?set.map((_,i)=>({id:i,name:gd.bannerName(save.cc,i)||'unknown_banner'})):[]};
}
function catSelector(save,gd,request){
  try{
    if(request.mode==='selector_info')return selectorInfo(save,gd);
    const ids=selectorIds(save,gd,String(request.mode??''),request.value);
    if(ids===null)throw fail('INVALID_INPUT','Cat metadata is unavailable.');
    return {success:true,catIds:[...new Set(ids)].sort((a,b)=>a-b)};
  }catch(err){if(err.code==='NOT_PORTED')throw err;return {success:false,error:'CAT_SELECTOR_STAGE: '+String(err.message).slice(0,200)};}
}

// request: {action, ...}. Returns the answer ({success: true, ...}).
function handle(save,gd,request){
  return settings.use(settings.fromSession(request.settings||{}),()=>{
    const a=request.action;
    if(a==='metadata'){try{return {success:true,...storyMeta(save,gd)};}catch(err){if(/^STORY_/.test(err.code||''))return {success:false,errorCode:err.code,error:'METADATA_STAGE: StoryError'};throw err;}}
    if(a==='item_metadata')return {success:true,...itemMeta(save)};
    if(a==='inventory_metadata')return {success:true,...inventoryMeta(save,gd,request.inventory)};
    if(a==='expedition_metadata')return {success:true,...expeditionMeta(save,gd)};
    if(a==='shrine_metadata')return {success:true,...shrineMeta(save,gd)};
    if(a==='map_metadata')return {success:true,...mapMeta(save,gd,request.category)};
    if(a==='extra_metadata'){try{return {success:true,...extraMeta(save,request.operation)};}catch(err){if(/^(EXTRA_|LINEUP_|AKU_)/.test(err.code||''))return {success:false,errorCode:err.code};throw err;}}
    if(a==='collection_metadata'){try{return {success:true,...collectionMeta(save,gd,request.collection)};}catch(err){if(/^(COLLECTION_UNSUPPORTED_VERSION|EVENT_TICKET_)/.test(err.code||''))return {success:false,errorCode:err.code};throw err;}}
    if(a==='cat_level_metadata'){
      try{return {success:true,...catLevelMeta(save,gd,request.catIds)};}
      catch(err){const level=/^CAT_LEVEL_/.test(err.code||'');return {success:false,errorCode:level?err.code:(require('./compat').isLegacy()?'BCSFE_METADATA_FAILED':'METADATA_FAILED'),error:`METADATA_STAGE: ${level?'CatLevelError':'ValueError'}`,diagnostics:{stage:'METADATA',exceptionClass:level?'CatLevelError':'ValueError'}};}
    }
    if(a==='cat_talent_metadata'){
      try{return {success:true,...talentMeta(save,gd,request.catIds)};}
      catch(err){return {success:false,errorCode:/^CAT_TALENT_/.test(err.code||'')?err.code:'CAT_TALENT_METADATA_UNAVAILABLE',error:'METADATA_STAGE: CatTalentError',diagnostics:{stage:'METADATA',exceptionClass:'CatTalentError',talentStage:err.message,...(err.versions||{})}};}
    }
    if(a==='cat_selector')return catSelector(save,gd,request);
    throw fail('NOT_PORTED',`${a} is not ported yet`);
  });
}
module.exports={handle};

},
"src/canbot-engine/misc.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// The remaining single edits: Clear to Japan, the fixes and small unlocks (simple actions: fixes, basic items,
// gambling events, aku realm), scores and adding cats to storage.
const {SaveDouble}=require('./binary');
const story=require('./story'),{removeGoldPass}=require('./extra');
const fail=(code,message)=>Object.assign(new Error(message),{code});
function integer(v,max,name='Value'){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw fail('INVALID_INPUT',`${name} must be an integer between 0 and ${max}.`);return v;}
const convertStage=i=>i===46||i===47?i:45-i;

// Story metadata: every chapter needs its name keys and 48 stage names; returns stage names per chapter.
function storyMetadata(save,gd){
  const real=story.layout(save),loc=gd.localizable();
  if(!loc||!['everyplay_mapname_J','everyplay_mapname_W','everyplay_mapname_P'].every(k=>loc.has(k)))throw fail('STORY_METADATA_UNAVAILABLE','Story chapter names are unavailable.');
  const chapters=[];
  for(let index=0;index<real;index++){
    const raw=gd.storyStageNames(save.cc,story.chapterType(index));
    if(!raw||raw.length<48)throw fail('STORY_METADATA_UNAVAILABLE','Story stage names are unavailable.');
    chapters.push({id:index,stages:Array.from({length:48},(_,i)=>raw[convertStage(i)])});
  }
  return {chapters};
}

function clearToJapan(save,gd){
  const chapter=storyMetadata(save,gd).chapters[0];let found;
  if(save.cc==='jp'){
    // Mission 8 references 300006 (the first chapter's seventh stage, Fukuoka) in all regions.
    const gate=gd.missionConditions()?.get(8);
    found=gate&&gate.missionType===0&&gate.conditionsType===1&&gate.progressCount===1&&gate.values.length===1&&gate.values[0]===300006&&chapter.stages.length>6?[6]:[];
  }else found=chapter.stages.map((n,i)=>['japan','日本','일본'].includes(n.trim().toLowerCase())?i:-1).filter(i=>i>=0);
  if(found.length!==1)throw fail('STORY_JAPAN_STAGE_UNAVAILABLE','The Japan or Fukuoka milestone could not be verified for this SAVE. No edits were applied.');
  story.clearTutorial(save);
  story.applyStory(save,{type:'story_clear',chapters:[0],mode:'specific',stages:Array.from({length:found[0]+1},(_,i)=>i)});
}

// Event map clear that keeps existing clear counts (an uncleared stage becomes 1), then opens the next crown and map.
function clearEventMap(save,type,map,star){
  const e=save.data.eventStages,stages=e.stagesPer;
  if(!e.progress[type]?.[map])throw fail('EVENT_MAP_UNAVAILABLE','Event map not stored.');
  e.progress[type][map][star]=stages;e.unlock[type][map][star]=3;
  for(let i=0;i<stages;i++)e.clears[type][map][i][star]=e.clears[type][map][i][star]||1;
  if(star+1<e.stars)e.unlock[type][map][star+1]=1;
  if(map+1<e.subchapters)e.unlock[type][map+1][0]=1;
}
const emptyCounted=()=>({n:0,items:[]});
// opts.now(): seconds (float); opts.random(): [0,1).
const SIMPLE={
  fix_gamatoto_crash:save=>{save.data.gamatotoSkin=2;},
  fix_ototo_crash:save=>{const d=save.data,gv=save.gameVersion;d.ototoCannons=[];const parts=gv<80200?1:gv>90699?0:10;d.ototoSelectedParts=Array.from({length:parts},()=>[0,0,0]);if('ototoSelectedPartsCount' in d)d.ototoSelectedPartsCount=parts;},
  fix_time_errors:(save,o)=>{const t=o.now(),dt=new Date(t*1000),d=save.data;
    d.date3={year:dt.getFullYear(),month:dt.getMonth()+1,day:dt.getDate(),hour:dt.getHours(),minute:dt.getMinutes(),second:dt.getSeconds()};
    d.timestamp=new SaveDouble(t);if('energyPenaltyTimestamp' in d)d.energyPenaltyTimestamp=new SaveDouble(t);},
  fix_officer_pass_crash:save=>{const d=save.data;d.officerCatId=0;d.officerCatForm=0;d.officerPassPlayTime=0;if(d.goldPass)removeGoldPass(save);},
  unlock_equip_menu:save=>{const m=save.data.menuUnlocks;m[2]=Math.max(m[2],1);},
  restart_pack:save=>{save.data.restartPack=1;},
  reset_gambling_events:save=>{const d=save.data;for(const k of ['wildcatCompleted','wildcatValues','wildcatStartTimes','catScratcherCompleted','catScratcherValues','catScratcherStartTimes'])if(k in d)d[k]=emptyCounted();},
  reset_golden_cat_cpus:save=>{if('goldenCpuCount' in save.data)save.data.goldenCpuCount=0;},
  unlock_aku_realm:save=>{for(const id of [255,256,257,258,265,266,268])clearEventMap(save,1,id,0);},
  filibuster_reclearing:(save,o)=>{save.data.filibusterEnabled=true;save.data.filibusterStage=Math.floor(o.random()*48);},
};
function simpleAction(save,edit,{now=()=>Date.now()/1000,random=Math.random}={}){
  const run=SIMPLE[edit.operation];if(!run)throw fail('INVALID_INPUT','Unsupported action.');run(save,{now,random});
}

function dictSet(pairs,k,v){const p=pairs.find(x=>x[0]===k);if(p)p[1]=v;else pairs.push([k,v]);}
function setScore(save,edit){
  const value=integer(edit.value,2**31-1),d=save.data;
  if(edit.score==='dojo'){let ch=d.dojoChapters.find(p=>p[0]===0);if(!ch){ch=[0,[]];d.dojoChapters.push(ch);}dictSet(ch[1],0,value);return;}
  if(edit.score==='challenge'){
    const c=d.challenge;if(!c||!c.chapters1||!c.stars1||!c.stages3)throw fail('CHALLENGE_STAGE_UNAVAILABLE','Challenge stage unavailable.');
    if(!d.challengeScores.length)d.challengeScores=[0];d.challengeScores[0]=value;d.challengePopupShown=true;
    // Chapters.clear_stage(0, 0, 0, False): progress, unlock state 3, clear count False (0).
    c.progress[0][0]=Math.max(c.progress[0][0],1);c.unlock[0][0]=3;c.clears[0][0][0]=0;return;
  }
  throw fail('INVALID_INPUT','Unsupported score.');
}

// Cats to storage (item type 1), quantity per cat, into free slots.
function storageAdd(save,ids,amount){
  const d=save.data;
  if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<0)throw fail('INVALID_INPUT','amount must be an integer >= 0.');
  if(amount<1)throw fail('INVALID_INPUT','Amount must be positive.');
  const space=d.storageTypes.filter(t=>t===0).length;if(amount*ids.length>space)throw fail('STORAGE_CAPACITY','Not enough storage space.');
  for(const id of ids)for(let k=0;k<amount;k++){const slot=d.storageTypes.indexOf(0);if(slot<0)break;d.storageTypes[slot]=1;d.storageIds[slot]=id;}
}
module.exports={clearToJapan,simpleAction,setScore,storageAdd,storyMetadata,SIMPLE_ACTIONS:Object.keys(SIMPLE)};

},
"src/canbot-engine/ponos.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// CanBot's PONOS account client for the local editor (canbot.js). It speaks the game's own account protocol
// (signed requests, password -> token -> save key -> S3 upload -> transfer codes) with CanBot's design:
//   - Credentials live outside the SAVE, in a store the caller provides (canbot.js keeps one private file per
//     account), and are reused while valid. Nothing of ours is written into the uploaded SAVE; editor records
//     (records.js) are taken out of the upload, so no password or token ever travels inside a SAVE.
//   - One attempt per step, never a hidden retry and never a silent new account. Every failure says which step
//     failed and whether the SAVE may already have reached PONOS (uploadPossible).
//   - Faster: credentials and the save key are fetched while the member is still editing (prepare), so a SAVE
//     only waits for the upload itself and the transfer; a valid token is reused across runs. (Measured: the upload
//     goes to the storage host named in the save key, so no connection is opened ahead to a guessed host.)
// Network, clock and randomness are injectable for tests: {fetch, now (ms), randomHex(n), uuid()}.
const crypto=require('node:crypto');
const {SaveString,SaveDouble}=require('./binary');
const collections=require('./collections');
const records=require('./records');

const HOST={auth:'https://nyanko-auth.ponosgames.com',save:'https://nyanko-save.ponosgames.com',managed:'https://nyanko-managed-item.ponosgames.com',s3:'https://nyanko-service-data-prd.s3.amazonaws.com'};
const AGENT='Dalvik/2.1.0 (Linux; U; Android 9; SM-G955F Build/N2G48B)';
const TOKEN_MARGIN_MS=120000,KEY_MARGIN_MS=60000;

class PonosError extends Error{
  constructor(code,step,{uploadPossible=false,status=null}={}){super(`${step}: ${code}`);this.code=code;this.step=step;this.uploadPossible=uploadPossible;this.status=status;}
}
// The JSON the game sends: compact, non-ASCII as \u escapes.
const body=value=>JSON.stringify(value).replace(/[\u007f-￿]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const defaultHex=n=>crypto.randomBytes(Math.ceil(n/2)).toString('hex').slice(0,n);
const regionCode=cc=>cc==='jp'?'ja':cc;
const text=s=>s instanceof SaveString?s.text:String(s??'');
// Seconds until a JWT expires, from its own claims (not verified: PONOS checks it, this only avoids a stale reuse).
function tokenExpiry(token){try{return Number(JSON.parse(Buffer.from(String(token).split('.')[1],'base64url').toString('utf8')).exp)*1000||0;}catch{return 0;}}
function keyExpiry(key){try{return Date.parse(JSON.parse(Buffer.from(String(key.policy),'base64').toString('utf8')).expiration)||0;}catch{return 0;}}

// Item changes the editor recorded in the SAVE (records.js kind "managed_items", "<amount>_<at>_<type>_<detail>"),
// which PONOS receives with the transfer as managedItemDetails.
function managedChanges(save){
  return save.data.orderIds.map(entry=>records.payload(entry,'managed_items')).filter(p=>p!==null).map(p=>p.split(':')[0])
    .map(s=>{const [amount,at,type,detail]=s.split('_');return {amount:Number(amount),at:Number(at),type,detail};}).filter(m=>m.amount&&m.type&&m.detail);
}
// The SAVE as it is uploaded: without editor bookkeeping entries.
function withoutEditorEntries(save){const before=save.data.orderIds;save.data.orderIds=before.filter(entry=>!records.isRecord(entry));return ()=>{save.data.orderIds=before;};}

// onStep({step, ms, status}): called after each PONOS request (status 0 = no answer), for progress display only.
function createPonos({fetch=globalThis.fetch,now=Date.now,randomHex=defaultHex,uuid=()=>crypto.randomUUID(),timeoutMs=60000,onStep=null}={}){
  const report=(step,started,status)=>{if(onStep)try{onStep({step,ms:Date.now()-started,status});}catch{}};
  async function http(step,method,url,headers,payload,{json=true}={}){
    let res;const started=Date.now();
    try{res=await fetch(url,{method,headers,body:payload,signal:AbortSignal.timeout(timeoutMs)});}
    catch{report(step,started,0);throw new PonosError('NO_CONNECTION',step);}
    report(step,started,res.status);
    const buf=Buffer.from(await res.arrayBuffer());
    if(!json)return {status:res.status,headers:res.headers,body:buf};
    let data;try{data=JSON.parse(buf.toString('utf8'));}catch{throw new PonosError('BAD_RESPONSE',step,{status:res.status});}
    return {status:res.status,headers:res.headers,data};
  }
  // A request PONOS checks by HMAC-SHA256 keyed with the account code.
  function signed(account,payload){
    const salt=randomHex(64),signature=salt+crypto.createHmac('sha256',account.code+salt).update(payload).digest('hex');
    return {'accept-encoding':'gzip',connection:'keep-alive','content-type':'application/json','nyanko-signature':signature,'nyanko-timestamp':String(Math.floor(now()/1000)),
      'nyanko-signature-version':'1','nyanko-signature-algorithm':'HMACSHA256','user-agent':AGENT};
  }
  async function post(step,account,url,obj,token){
    const payload=body(obj),headers=signed(account,payload);if(token)headers.authorization='Bearer '+token;
    const r=await http(step,'POST',url,headers,payload);
    if(r.data?.statusCode!==1)throw new PonosError(`STATUS_${r.data?.statusCode??r.status}`,step,{status:r.status});
    return {payload:r.data.payload||{},timestamp:r.data.timestamp??null};
  }

  // Transfer code reception. Returns {save bytes, refreshToken, password} or throws.
  async function receive(transferCode,pin,cc,gameVersion){
    const payload=body({clientInfo:{client:{countryCode:regionCode(cc),version:gameVersion},device:{model:'SM-G955F'},os:{type:'android',version:'9'}},nonce:randomHex(32),pin});
    const r=await http('RECEIVE','POST',`${HOST.save}/v2/transfers/${encodeURIComponent(transferCode)}/reception`,{'content-type':'application/json','accept-encoding':'gzip',connection:'keep-alive','user-agent':AGENT},payload,{json:false});
    if((r.headers.get('content-type')||'')!=='application/octet-stream')throw new PonosError('CODES_REJECTED','RECEIVE',{status:r.status});
    return {bytes:r.body,refreshToken:r.headers.get('nyanko-password-refresh-token'),password:r.headers.get('nyanko-password')};
  }

  // One account (the SAVE being uploaded). store: {get():object|null, set(object)} for {password, token} of this
  // account; changes to the SAVE's own account fields are written into `save` before anything is uploaded.
  function account(save,store={get:()=>null,set:()=>{}}){
    // The account's identity is kept here and written into whichever SAVE is uploaded, so credentials fetched early
    // (prepare) still land in the SAVE that is finally edited and sent.
    const d=save.data,ident={code:text(d.inquiryCode),refresh:text(d.passwordRefreshToken),createdAt:Math.trunc(Number(d.energyPenaltyTimestamp)),penalty:null};
    const acc={get code(){return ident.code;}};
    let creds={...(store.get()||{})},key=null,keyTask=null;
    const keep=()=>store.set({password:creds.password||null,token:creds.token||null,code:acc.code});
    const clientInfo=()=>({clientInfo:{client:{countryCode:regionCode(save.cc),version:save.gameVersion},device:{model:'SM-G955F'},os:{type:'android',version:'9'}},nonce:randomHex(32)});
    // A password answer can carry a new account code (PONOS moved the account): the SAVE follows it, and the item
    // amounts are reported for the new code, as the game does.
    async function adoptPassword(result){
      const {password,passwordRefreshToken,accountCode}=result.payload;
      if(!password||!passwordRefreshToken)throw new PonosError('NO_PASSWORD','PASSWORD');
      ident.refresh=String(passwordRefreshToken);creds={password};
      if(accountCode&&accountCode!==acc.code){
        ident.code=String(accountCode);
        if(result.timestamp!=null)ident.penalty=Math.trunc(Number(result.timestamp));
        keep();const token=await tokenFor(password);
        await post('MANAGED_ITEMS',acc,`${HOST.managed}/v1/managed-items`,{catfoodAmount:d.catfood,isPaid:true,legendTicketAmount:d.legendTickets,nonce:randomHex(32),platinumTicketAmount:d.platinumTickets,rareTicketAmount:d.rareTickets},token);
      }
      keep();return password;
    }
    async function tokenFor(password){
      const r=await post('TOKEN',acc,`${HOST.auth}/v1/tokens`,{...clientInfo(),password,accountCode:acc.code});
      if(!r.payload.token)throw new PonosError('NO_TOKEN','TOKEN');
      creds={...creds,password,token:r.payload.token};keep();return creds.token;
    }
    // A valid token: the cached one, else from the cached password, else from a refreshed password, else from a
    // password registered for this account (accounts that never had one). No new account is ever made here.
    // safe: only what never changes the account (a cached token, or a token from the cached password). Refreshing
    // or registering a password changes the account at PONOS, so it waits until the member actually saves.
    async function token({safe=false}={}){
      const sameAccount=creds.code===undefined||creds.code===acc.code;
      if(creds.token&&sameAccount&&tokenExpiry(creds.token)-TOKEN_MARGIN_MS>now())return creds.token;
      if(!sameAccount)creds={};
      if(creds.password){try{return await tokenFor(creds.password);}catch(err){if(err.code==='NO_CONNECTION'||safe)throw err;creds={};}}
      if(safe)throw new PonosError('NEEDS_SIGN_IN','PREPARE');
      let password;
      try{password=await adoptPassword(await post('PASSWORD',acc,`${HOST.auth}/v1/user/password`,{accountCode:acc.code,passwordRefreshToken:ident.refresh,nonce:randomHex(32)}));}
      catch(err){if(err.code==='NO_CONNECTION')throw err;password=await adoptPassword(await post('PASSWORD',acc,`${HOST.auth}/v1/users`,{accountCode:acc.code,accountCreatedAt:ident.createdAt,nonce:randomHex(32)}));}
      // A moved account already got its token while reporting item amounts.
      return creds.token&&creds.password===password?creds.token:tokenFor(password);
    }
    async function saveKey(opts){
      const t=await token(opts);
      const r=await http('SAVE_KEY','GET',`${HOST.save}/v2/save/key?nonce=${randomHex(32)}`,{'accept-encoding':'gzip',connection:'keep-alive',authorization:'Bearer '+t,'nyanko-timestamp':String(Math.floor(now()/1000)),'user-agent':AGENT});
      if(r.data?.statusCode!==1||!r.data.payload?.key)throw new PonosError(`STATUS_${r.data?.statusCode??r.status}`,'SAVE_KEY',{status:r.status});
      key=r.data.payload;return key;
    }
    const keyFresh=()=>key&&(keyExpiry(key)===0||keyExpiry(key)-KEY_MARGIN_MS>now());
    // Credentials and a save key ahead of the upload (safe to call while the member edits; errors surface on upload).
    // While the member edits: a token and a save key if that is possible without changing the account.
    function prepare(){if(!keyTask)keyTask=saveKey({safe:true}).catch(err=>{keyTask=null;throw err;});keyTask.catch(()=>{});return keyTask;}
    // When the member saves: everything needed for the upload (may refresh the password).
    async function ready(){if(keyTask){try{await keyTask;}catch{}}if(!keyFresh()){key=null;keyTask=null;await saveKey();}return key;}
    // Uploads the SAVE and returns {transferCode, confirmationCode}. serialize(save) -> bytes is called after the
    // account fields are final. On success the editor's item records are cleared from `save`.
    // Writes the current identity into a SAVE (the one being uploaded).
    function stamp(target){
      const t=target.data;
      if(text(t.inquiryCode)!==ident.code)t.inquiryCode=new SaveString(Buffer.from(ident.code,'utf8'));
      if(text(t.passwordRefreshToken)!==ident.refresh)t.passwordRefreshToken=new SaveString(Buffer.from(ident.refresh,'utf8'));
      if(ident.penalty!==null)t.energyPenaltyTimestamp=new SaveDouble(ident.penalty);
    }
    // upload(target, serialize) or upload(serialize) for the SAVE given to account().
    async function upload(target,serialize){
      if(typeof target==='function'){serialize=target;target=save;}
      target.data.showBanMessage=false;
      await ready();
      const k=key;stamp(target);const changes=managedChanges(target);
      const restore=withoutEditorEntries(target);let bytes;try{bytes=serialize(target);}finally{restore();}
      const boundary=crypto.randomBytes(16).toString('hex'),parts=[];
      for(const [name,value] of Object.entries(k))if(name!=='url')parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\nContent-Type: text/plain\r\n\r\n${value}\r\n`,'utf8'));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="file.sav"\r\nContent-Type: application/octet-stream\r\n\r\n`,'utf8'),bytes,Buffer.from(`\r\n--${boundary}--\r\n`,'utf8'));
      let s3;try{s3=await http('UPLOAD','POST',k.url||`${HOST.s3}/`,{'accept-encoding':'gzip',connection:'keep-alive','user-agent':AGENT,'content-type':`multipart/form-data; boundary=${boundary}`},Buffer.concat(parts),{json:false});}
      catch(err){throw new PonosError(err.code||'NO_CONNECTION','UPLOAD',{uploadPossible:true});}
      if(s3.status!==204)throw new PonosError(`HTTP_${s3.status}`,'UPLOAD',{uploadPossible:s3.status>=500,status:s3.status});
      key=null;keyTask=null;
      const items=changes.map(m=>({amount:m.amount,detailCode:uuid(),detailCreatedAt:m.at,detailType:m.detail,managedItemType:m.type}));
      const salt=randomHex(40),itemsJson=body(items);
      const meta={managedItemDetails:items,nonce:randomHex(32),playTime:target.data.officerPassPlayTime,rank:collections.userRank(target),receiptLogIds:[],
        signature_v1:salt+crypto.createHmac('sha1',acc.code+salt).update(itemsJson+itemsJson).digest('hex'),saveKey:k.key};
      let r;try{r=await post('TRANSFER',acc,`${HOST.save}/v2/transfers`,meta,creds.token);}
      catch(err){err.uploadPossible=true;if(/^STATUS_/.test(err.code)){creds={...creds,token:null};keep();}throw err;}
      const {transferCode,pin}=r.payload;if(!transferCode||!pin)throw new PonosError('NO_CODES','TRANSFER',{uploadPossible:true});
      target.data.orderIds=target.data.orderIds.filter(entry=>!records.isKind(entry,'managed_items'));
      return {transferCode:String(transferCode),confirmationCode:String(pin),bytes};
    }
    return {prepare,ready,upload,stamp,get code(){return acc.code;}};
  }
  // After reception: the refresh token the server sent goes into the SAVE (the game's own field).
  function adoptReception(save,received){if(received.refreshToken)save.data.passwordRefreshToken=new SaveString(Buffer.from(String(received.refreshToken),'utf8'));}
  return {receive,account,adoptReception};
}
module.exports={createPonos,PonosError,managedChanges,HOST};

},
"src/canbot-engine/records.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Editor records: CanBot's own bookkeeping entries in a SAVE's order-id list, each a text "<key><kind>:<payload>".
// The game ignores them; the upload step reads the item records (net changes of server-managed items) and leaves
// every record out of the uploaded SAVE.
//
// The key is "_canbot:". Saves edited by earlier CanBot builds carry "_bcsfe:" records; those are read, replaced and
// left out of uploads the same way. In legacy compatibility (compat.js) only the earlier key is read and written.
const {SaveString}=require('./binary');
const compat=require('./compat');

const OWN='_canbot:',LEGACY='_bcsfe:';
const writeKey=()=>compat.isLegacy()?LEGACY:OWN;
const readKeys=()=>compat.isLegacy()?[LEGACY]:[OWN,LEGACY];
const text=s=>s instanceof SaveString?s.text:String(s??'');

// The payload of a record of this kind, or null.
function payload(entry,kind){
  const t=text(entry);
  for(const key of readKeys())if(t.startsWith(key+kind+':'))return t.slice(key.length+kind.length+1);
  return null;
}
const isRecord=entry=>{const t=text(entry);return readKeys().some(key=>t.startsWith(key));};
const isKind=(entry,kind)=>payload(entry,kind)!==null;
const make=(kind,body)=>new SaveString(Buffer.from(`${writeKey()}${kind}:${body}`,'utf8'));

module.exports={payload,isRecord,isKind,make,OWN,LEGACY};

},
"src/canbot-engine/settings.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Session editor settings, set for each edit:
//   resetCatData     removing a cat clears its forms, levels, talents and guide entry (else only "unlocked")
//   setCurrentForms  evolving a cat also switches it to the new form
//   strictUpgrade    level-ups follow the SAVE's upgrade state, user rank and only claimed user-rank rewards
//   unlockOnEdit     editing a cat's forms, levels, talents or guide entry also unlocks it
//   disableMaxes     item and clear-count limits become the field's integer range
// The current values are module state for the edit being applied (single-threaded, set per edit).
const DEFAULTS=Object.freeze({resetCatData:true,setCurrentForms:true,strictUpgrade:false,unlockOnEdit:true,disableMaxes:false});
const FROM_SESSION={reset_cat_data:'resetCatData',set_cat_current_forms:'setCurrentForms',strict_upgrade:'strictUpgrade',unlock_cat_on_edit:'unlockOnEdit',disable_item_maxes:'disableMaxes'};
let current={...DEFAULTS};
const get=()=>current;
// session: CanBot session settings (snake_case booleans); missing keys use the defaults.
function fromSession(session={}){const out={...DEFAULTS};for(const [k,name] of Object.entries(FROM_SESSION))if(typeof session[k]==='boolean')out[name]=session[k];return out;}
function use(values,run){const before=current;current={...DEFAULTS,...values};try{return run();}finally{current=before;}}
// A limit, or with maxes disabled the signed range of the field (i16 32767, i32 2147483647).
const cap=(limit,bits=31)=>current.disableMaxes?2**bits-1:limit;
module.exports={DEFAULTS,get,fromSession,use,cap};

},
"src/canbot-engine/story.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Story, treasure, outbreak and other single-area edits. Main story:
// 10 chapter slots of 51 stages, slot 3 unused; the 9 real chapters have 48 playable stages. Treasures are stored in
// a different stage order (convert below).
const fail=(code,message)=>Object.assign(new Error(message),{code});
const LIMIT={stageClear:9999,treasure:9999,timedScore:9999,catamins:9999,catseyes:9999,labyrinth_medals:9999,treasure_chests:9999,base_materials:9999,battle_items:9999,catfruit_old:128,catfruit_new:998};
const FPS=30;

function integer(v,max,name='Value'){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw fail('INVALID_INPUT',`${name} must be an integer between 0 and ${max}.`);return v;}
const rawChapter=cid=>cid<3?cid:cid+1;
const chapterType=index=>index<3?0:index<6?1:2;
const treasureIndex=i=>i===46||i===47?i:45-i;

function layout(save){
  const d=save.data;
  if(d.storyClearTimes.length!==10||d.storyClearTimes.some(c=>c.length!==51))throw fail('STORY_LAYOUT_UNSUPPORTED','This SAVE has a story layout CanBot does not know; nothing was changed.');
  return 9;
}
const getPair=(dict,key)=>dict.find(p=>p[0]===key);
// Outbreak chapters are [chapterId, [[stageId, cleared]...]] in file order; real chapter ids skip slot 3.
const outbreakChapter=(dict,cid)=>getPair(dict,rawChapter(cid));

function clearStage(save,raw,stage,amount){const d=save.data;d.storyProgress[raw]=Math.max(d.storyProgress[raw],stage+1);d.storyClearTimes[raw][stage]=amount;}

function applyStory(save,edit,{random=Math.random}={}){
  const kind=edit.type,real=layout(save),d=save.data;
  const chapters=edit.chapters;if(!Array.isArray(chapters)||!chapters.length)throw fail('INVALID_INPUT','Select at least one chapter.');
  const selections=[];
  for(const cid of chapters){
    if(!Number.isInteger(cid)||cid<0||cid>=real)throw fail('STORY_CHAPTER_NOT_FOUND','That story chapter does not exist.');
    const count=48;
    if(kind==='timed_scores'&&chapterType(cid)!==1)throw fail('INVALID_INPUT','Timed scores require Into the Future.');
    const ob=outbreakChapter(d.outbreaks,cid);
    const valid=kind==='outbreaks'&&ob?ob[1].map(p=>p[0]).sort((a,b)=>a-b):Array.from({length:count},(_,i)=>i);
    if(kind==='outbreaks'&&!ob)throw fail('INVALID_INPUT','This chapter has no outbreak data.');
    if(edit.mode!=='whole'&&edit.mode!=='specific')throw fail('INVALID_INPUT','Invalid stage selection mode.');
    const stages=edit.mode==='whole'?valid:edit.stages;
    if(!Array.isArray(stages)||!stages.length)throw fail('INVALID_INPUT','Select at least one stage.');
    for(const s of stages){if(!Number.isInteger(s)||s<0||s>=count)throw fail('STORY_STAGE_NOT_FOUND','That story stage does not exist.');if(!valid.includes(s))throw fail('INVALID_INPUT','Selected outbreak stage is unavailable.');}
    selections.push([cid,[...new Set(stages)].sort((a,b)=>a-b)]);
  }
  let value=edit.value;
  if(kind==='story_clear')value=integer(edit.value??1,require('./settings').cap(LIMIT.stageClear,15));
  if(kind==='treasures')integer(value,LIMIT.treasure);
  const range=edit.scoreRange;
  if(kind==='timed_scores'){if(range==null)integer(value,LIMIT.timedScore);else{if(!Array.isArray(range)||range.length!==2)throw fail('INVALID_INPUT','Invalid score range.');range.forEach(x=>integer(x,LIMIT.timedScore));if(range[0]>range[1])throw fail('INVALID_INPUT','Invalid score range.');}}
  if(kind==='outbreaks'&&typeof value!=='boolean')throw fail('INVALID_INPUT','Clear must be a boolean.');
  if(!['story_clear','treasures','timed_scores','outbreaks'].includes(kind))throw fail('INVALID_INPUT','Unsupported story edit.');
  for(const [cid,stages] of selections){
    const raw=rawChapter(cid);
    for(const s of stages){
      if(kind==='story_clear')clearStage(save,raw,s,value);
      else if(kind==='treasures')d.storyTreasure[raw][treasureIndex(s)]=value;
      else if(kind==='timed_scores')d.itfTimedScores[(raw-4)*51+s]=range==null?value:range[0]+Math.floor(random()*(range[1]-range[0]+1));
      else if(kind==='outbreaks'){
        const ch=outbreakChapter(d.outbreaks,cid),st=ch&&getPair(ch[1],s);if(st)st[1]=value?1:0;
        if(value){const cur=outbreakChapter(d.currentOutbreaks,cid),cs=cur&&getPair(cur[1],s);if(cs)cs[1]=0;}
      }
    }
  }
}

// Every real chapter's 48 outbreaks cleared (missing entries created), and every current outbreak not cleared.
function completeAllOutbreaks(save){
  layout(save);const d=save.data;
  for(let cid=0;cid<9;cid++){
    const id=rawChapter(cid),existing=getPair(d.outbreaks,id);
    if(!existing)d.outbreaks.push([id,Array.from({length:48},(_,s)=>[s,1])]);
    else for(let s=0;s<48;s++){const st=getPair(existing[1],s);if(st)st[1]=1;else existing[1].push([s,1]);}
  }
  for(const [,stages] of d.currentOutbreaks)for(const st of stages)st[1]=0;
}

function clearTutorial(save){
  const d=save.data;
  d.tutorialState=Math.max(d.tutorialState,1);
  d.koreaSuperiorTreasureState=Math.max(d.koreaSuperiorTreasureState,2);
  d.unknown6=Math.max(d.unknown6,1);
  while(d.newDialogs2.length<6)d.newDialogs2.push(0);
  d.newDialogs2[1]=Math.max(d.newDialogs2[1],2);
  d.newDialogs2[5]=Math.max(d.newDialogs2[5],2);
  if(d.storyClearTimes[0][0]===0)clearStage(save,0,0,0);
}

function setPlaytime(save,edit){
  const h=integer(edit.hours,2**31-1,'Hours'),m=integer(edit.minutes,59,'Minutes'),s=integer(edit.seconds,59,'Seconds');
  const frames=(h*3600+m*60+s)*FPS;integer(frames,2**31-1,'Playtime frames');save.data.officerPassPlayTime=frames;
}
function setSeed(save,edit){const field={rare:'rareSeed',normal:'normalSeed',event:'eventSeed'}[edit.seed];if(!field)throw fail('INVALID_INPUT','Invalid gacha seed.');save.data[field]=integer(edit.value,2**32-1);}
// Special skills (AbilityData rows): every valid skill (all but slot 1) to its maximum; slot 0 (cannon power) is
// mirrored to the hidden slot 1. Then the rank-up sale flag.
function setSkills(save,gd){
  const rows=gd.abilityData(),skills=save.data.specialSkills,valid=skills.length-1;
  if(!rows||rows.length<valid)throw fail('INVALID_INPUT','Skill data is unavailable.');
  for(let i=0;i<valid;i++){
    const maxBase=rows[i].maxBase-1,maxPlus=rows[i].maxPlus,base=Math.min(maxBase,maxBase),plus=Math.min(maxPlus,maxPlus);
    const target=skills[i===0?0:i+1];if(base!==-1)target.base=base;if(plus!==-1)target.plus=plus;
    if(i===0){if(base!==-1)skills[1].base=base;if(plus!==-1)skills[1].plus=plus;}
  }
  save.data.rankUpSaleValue=0x7fffffff;
}

// Inventories: one value set on the selected entries.
const INVENTORIES=['catamins','catseyes','labyrinth_medals','treasure_chests','base_materials','battle_items','catfruit'];
function inventoryLimit(save,name){return name==='catfruit'?(save.gameVersion<110400?LIMIT.catfruit_old:LIMIT.catfruit_new):LIMIT[name];}
function inventoryValues(save,name){const d=save.data;return {catamins:d.catamins,catseyes:d.catseyes,labyrinth_medals:d.labyrinth?.medals?.items,treasure_chests:d.treasureChests?.items,base_materials:d.ototoMaterials,battle_items:d.battleItems,catfruit:d.catfruit}[name];}
function setInventory(save,edit){
  const name=edit.inventory;if(!INVENTORIES.includes(name))throw fail('INVALID_INPUT','Unsupported inventory.');
  const values=inventoryValues(save,name);if(!values)throw fail('INVALID_INPUT','Unsupported inventory.');
  const ids=edit.ids;if(!Array.isArray(ids)||!ids.length)throw fail('INVALID_INPUT','Select inventory entries.');
  const amount=integer(edit.value,inventoryLimit(save,name));for(const i of ids)integer(i,values.length-1,'Item ID');
  const updated=[...values];for(const i of ids)updated[i]=amount;
  if(name==='catfruit'&&save.gameVersion<110400&&updated.reduce((a,b)=>a+b,0)>inventoryLimit(save,name))throw fail('INVALID_INPUT','This save version has a cumulative catfruit limit.');
  for(const i of ids)values[i]=amount;
}

module.exports={applyStory,completeAllOutbreaks,clearTutorial,setPlaytime,setSeed,setSkills,setInventory,layout,chapterType,treasureIndex,inventoryValues,inventoryLimit};

},
"src/canbot-engine/talents.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Talent edits. Stored talents are the authority: only talents the SAVE already holds are raised; a catalog
// talent is never created. A cat's talents live in save.data.talents as {catId, talents:[{id, level}]}; a cat with no
// entry has no talent block.
const {unlock}=require('./cats');
const FULL_MATCH='FULL_MATCH',VALID_SUBSET='VALID_SUBSET',NO_BLOCK='NO_BLOCK',INVALID='INVALID',NO_TALENTS='NO_TALENTS';
const fail=(code,stage,extra={})=>Object.assign(new Error(code),{code,stage,...extra});
const stored=(save,id)=>save.data.talents.find(t=>t.catId===id)?.talents??null;

// The maximum level of each talent the cat stores that the catalog describes with a name (max level 0 reads as 1;
// a talent listed twice takes its last row).
function storedMaxima(td,skill,talents){
  const maxima=new Map();
  for(const s of skill.skills)if(td.nameIds.has(s.textId)&&talents.some(t=>t.id===s.abilityId))maxima.set(s.abilityId,s.maxLv===0?1:s.maxLv);
  return maxima;
}
function outcome(id,talents,status,reason,storedN=0,catalog=0,missing=[]){const m={id,status:status===FULL_MATCH||status===VALID_SUBSET?'SUPPORTED':'EXCLUDED',talentStatus:status,talentBlockPresent:Boolean(talents?.length),talentsStored:storedN,talentsCatalog:catalog,talentsMissing:missing.length,talentMissingIds:[...missing]};if(reason)m.reason=reason;return m;}
function classify(td,save,id){
  const skill=td.cats.get(id),talents=stored(save,id),has=Boolean(talents?.length);
  const refused=(status,reason)=>[outcome(id,talents,status,reason),null];
  if(!skill)return has?refused(INVALID,'CAT_TALENT_METADATA_UNAVAILABLE'):refused(NO_TALENTS,'CAT_TALENT_UNSUPPORTED');
  const semantic=skill.skills.some(s=>s.abilityId>0);
  let catalog=[...new Set(skill.skills.filter(s=>s.abilityId>0).map(s=>s.abilityId))];
  if(!semantic&&has&&talents.some(t=>t.id===0))catalog=[0];
  if(!catalog.length)return (talents||[]).some(t=>t.id!==0)?refused(INVALID,'CAT_TALENT_METADATA_UNAVAILABLE'):refused(NO_TALENTS,'CAT_TALENT_UNSUPPORTED');
  if(!has)return [outcome(id,talents,NO_BLOCK,'CAT_TALENT_NO_BLOCK',0,catalog.length,catalog),null];
  const maxima=storedMaxima(td,skill,talents);
  const entries=talents.filter(t=>!semantic||t.id!==0),ids=entries.map(t=>t.id);
  if(!ids.length||ids.some(x=>!Number.isSafeInteger(x)||x<0)||new Set(ids).size!==ids.length||!ids.every(x=>catalog.includes(x)))return refused(INVALID,'CAT_TALENT_INVALID_STORAGE');
  const levels=[];
  for(const t of entries){const max=maxima.get(t.id);if(max===undefined)return refused(INVALID,'CAT_TALENT_METADATA_UNAVAILABLE');if(!(max>=1&&max<=2147483647)||!(t.level>=0&&t.level<=max))return refused(INVALID,'CAT_TALENT_INVALID_LEVEL');levels.push([t.id,max]);}
  const missing=catalog.filter(x=>!ids.includes(x));
  return [outcome(id,talents,missing.length?VALID_SUBSET:FULL_MATCH,null,ids.length,catalog.length,missing),levels];
}

// composite: Max Account (cats without talents and NO_BLOCK cats are skipped). INVALID always stops.
function maxTalents(save,gd,ids,{composite=false}={}){
  const td=gd.talentData(save.cc);if(!td)throw fail('CAT_TALENT_METADATA_UNAVAILABLE','METADATA_READ');
  const members=[],targets=new Map();
  for(const id of ids){const [m,levels]=classify(td,save,id);members.push(m);if(levels)targets.set(id,levels);}
  let blocking=members.filter(m=>m.talentStatus===INVALID||(m.talentStatus===NO_TALENTS&&!composite));
  const selected=ids.filter(id=>targets.has(id)),skipped=members.filter(m=>m.talentStatus===NO_BLOCK);
  if(!blocking.length&&!selected.length&&skipped.length&&!composite)blocking=skipped;
  if(blocking.length)throw fail(blocking[0].reason,'TARGET_CHECK');
  const result=members.filter(m=>m.talentStatus!==NO_TALENTS);
  if(!selected.length)return result;
  // Raise: each selected cat is unlocked (when edits unlock) and every target talent set to its maximum. Placeholder
  // talents (id 0) of a cat with real talents are not targets and keep their level.
  const shape=new Map(selected.map(id=>[id,stored(save,id).map(t=>t.id)]));
  const unlockOnEdit=require('./settings').get().unlockOnEdit;
  for(const id of selected){
    if(unlockOnEdit)unlock(save,gd,id);
    const talents=stored(save,id);
    for(const [x,max] of targets.get(id))talents.find(t=>t.id===x).level=max;
  }
  // Check: the talent list kept its shape and every target is at its maximum.
  for(const id of selected){
    if(JSON.stringify(stored(save,id).map(t=>t.id))!==JSON.stringify(shape.get(id)))throw fail('CAT_TALENT_BACKEND_FAILURE','VERIFY');
    for(const [x,max] of targets.get(id)){const t=stored(save,id).find(q=>q.id===x);if(!t||t.level!==max)throw fail('CAT_TALENT_BACKEND_FAILURE','VERIFY');}
  }
  return result;
}

module.exports={maxTalents,classify};

},
"src/edit-labels.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Korean names of editor features for the admin AI log ("AI가 이해한 것"): the actual feature each proposed or applied
// edit uses, instead of internal names such as "edit" or "cat:unlock". Same wording as the web editor.
const ITEMS={catfood:'통조림',xp:'XP',normal_tickets:'냥코 티켓',rare_tickets:'레어 티켓',platinum_tickets:'플래티넘 티켓',legend_tickets:'레전드 티켓',platinum_shards:'플래티넘 조각',np:'NP',leadership:'리더십'};
const CAT={unlock:'획득',remove:'삭제',set_level:'레벨 설정',max_upgrade:'최대 강화',max_base_plus:'기본+플러스 최대',upgrade_by:'레벨 올리기',true_form:'3형태',fourth_form:'4형태',remove_true_form:'3형태 해제',remove_fourth_form:'4형태 해제',max_talents:'본능 최대',remove_talents:'본능 제거',cat_guide:'도감 등록',remove_cat_guide:'도감 제거',storage_add:'저장고 추가'};
const STORY={story_clear:'스토리 클리어',treasures:'보물',outbreaks:'좀비 스테이지',timed_scores:'타임 스코어'};
const INVENTORY={catfruit:'개다래 열매·씨앗',catamins:'고양이 드링크',catseyes:'캣츠아이',base_materials:'성 재료',battle_items:'배틀 아이템',treasure_chests:'보물상자',labyrinth_medals:'미궁 훈장'};
const MAPS={sol:'레전드 스토리',event:'이벤트 맵',collab:'콜라보 맵',uncanny:'신 레전드 스토리',catamin_stages:'캣츠아이 스테이지',towers:'냥코탑',gauntlets:'강습',collab_gauntlets:'콜라보 강습',behemoth_culling:'초수 토벌',clear_enigma_stages:'수수께끼 스테이지',legend_quest:'레전드 퀘스트',zero_legends:'제로 레전드',dojo_catclaw_championships:'냥코 도장 대회'};
const COLLECTIONS={skills:'특수능력',enigma:'수수께끼 스테이지',endless:'무한 배틀 아이템',storage_skills:'저장고 특수능력',rank_rewards:'유저랭크 보상',talent_orbs:'본능 구슬',scheme_items:'이벤트 해금 항목',event_tickets:'이벤트 티켓',enemy_guide:'적 캐릭터 도감',medals:'메달',missions:'미션',storage:'저장고'};
const EXPEDITION={xp:'가마토토 XP',level:'가마토토 레벨',helpers:'가마토토 대원',engineers:'오토토 대원',shrine_level:'고양이 신사 레벨',shrine_xp:'고양이 신사 XP',shrine_appear:'고양이 신사 표시',shrine_disappear:'고양이 신사 숨기기',cannon_levels:'대포 레벨',cannon_development:'대포 개발'};
const EXTRA={rare_trade:'레어 티켓 교환 준비',hundred_million:'1억 티켓',slots:'편성 슬롯',aku:'악마 스테이지',gold_add:'냥코클럽 골드 추가',gold_remove:'냥코클럽 골드 해제'};
const SIMPLE={fix_gamatoto_crash:'가마토토 오류 복구',fix_ototo_crash:'오토토 오류 복구',fix_time_errors:'시간 오류 복구',fix_officer_pass_crash:'냥코클럽 오류 복구',unlock_equip_menu:'장비 메뉴 해금',restart_pack:'리스타트 팩 설정',reset_gambling_events:'뽑기 이벤트 초기화',reset_golden_cat_cpus:'황금 고양이 CPU 초기화',unlock_aku_realm:'악마 영역 해금',filibuster_reclearing:'필리버스터 재클리어'};
const TYPES={max_all:'모든 아이템 최대',max_account:'계정 최대화',special_skills:'특수능력 최대',clear_to_japan:'일본까지 클리어',playtime:'플레이 시간',gacha_seed:'가챠 시드',score:'점수'};
const ACTIONS={max_items:'모든 아이템 최대',max_cats:'모든 고양이 최대 강화',unlock_cats:'모든 고양이 획득',max_talents:'모든 고양이 본능 최대',true_form_cats:'모든 고양이 3형태',fourth_form_cats:'모든 고양이 4형태',max_special_skills:'특수능력 전체 최대',max_account:'계정 최대화'};

const value=v=>v==='MAX'?'최대':String(v);
// Who a cat edit targets, without names or IDs: "전체", "3마리".
function catTarget(t){if(!t)return '';if(t.mode==='all')return ' (전체)';const n=(t.ids?.length||0)+(t.names?.length||0);return n?` (${n}마리)`:'';}
function editorEdit(e){
  if(!e||typeof e!=='object')return '편집';
  if(e.type==='cat')return `고양이 · ${CAT[e.operation]||e.operation||'작업'}${catTarget(e.target)}`;
  if(STORY[e.type])return `스토리 · ${STORY[e.type]}`;
  if(e.type==='inventory')return `아이템 · ${INVENTORY[e.inventory]||e.inventory||'인벤토리'}`;
  if(e.type==='map'||e.type==='map_batch')return `스테이지 · ${MAPS[e.category]||e.category||'맵'}`;
  if(e.type==='collection')return `수집 · ${COLLECTIONS[e.collection]||e.collection||'항목'}`;
  if(e.type==='expedition')return `가마토토·오토토 · ${EXPEDITION[e.operation]||e.operation||'작업'}`;
  if(e.type==='extra')return `기타 · ${EXTRA[e.operation]||e.operation||'작업'}`;
  if(e.type==='simple')return `복구 · ${SIMPLE[e.action]||SIMPLE[e.operation]||e.action||'작업'}`;
  if(e.type==='item')return `${ITEMS[e.item]||e.item}=${value(e.value)}`;
  return TYPES[e.type]||e.type||'편집';
}
function describeEdit(edit){
  if(!edit||typeof edit!=='object')return '편집';
  if(edit.action==='set_item')return `${ITEMS[edit.item]||edit.item}=${value(edit.value)}`;
  if(edit.action==='editor_action')return editorEdit(edit.edit);
  return ACTIONS[edit.action]||edit.action||'편집';
}
const READ_FIELD={ownership:'보유 여부',level:'레벨',state:'상태',current:'현재 값',pending:'예정된 변경',delta:'변화량'};
const MATH={set:'값 지정',increment:'더하기',decrement:'빼기',multiply:'곱하기',double:'두 배',halve:'절반',max:'최대',min:'최소',current:'현재 값'};
const SIMPLE_OPS={show:'변경 목록 보기',undo:'되돌리기',restore:'다시 실행',clear:'변경 목록 비우기',wait:'대기',apply_request:'저장 요청',remaining:'남은 횟수 확인',capabilities:'할 수 있는 일 안내',feedback:'의견'};
function describeOperation(row){
  if(!row||typeof row!=='object')return '작업';
  if(row.operation==='edit')return describeEdit(row.edit);
  if(row.operation==='read')return `조회 · ${row.kind==='item'?(ITEMS[row.item]||row.item):'고양이'} ${READ_FIELD[row.field]||row.field||''}`.trim();
  if(row.operation==='remove')return '변경 취소';
  if(row.operation==='calculate')return `계산 · ${MATH[row.math]||row.math}${Number.isSafeInteger(row.amount)?` ${row.amount}`:''}`;
  if(row.operation==='filter_edit')return `조건부 고양이 · ${CAT[row.action]||row.action}`;
  if(row.operation==='cat_group')return `고양이 묶음 · ${(row.actions||[]).map(a=>CAT[a]||a).join(', ')}`;
  return SIMPLE_OPS[row.operation]||row.operation||'작업';
}
// One line for the log: proposed edits or handled operations, at most 8 entries.
function describeResult(result){
  if(result?.status==='ready'){const list=(result.edits||[]).map(describeEdit);return '제안한 변경: '+list.slice(0,8).join(', ')+(list.length>8?` 외 ${list.length-8}개`:'');}
  if(result?.status==='conversation'){const list=(result.operations||[]).map(describeOperation);return '처리한 작업: '+list.slice(0,8).join(', ')+(list.length>8?` 외 ${list.length-8}개`:'');}
  return '';
}
module.exports={describeEdit,describeOperation,describeResult,LABELS:{ITEMS,CAT,STORY,INVENTORY,MAPS,COLLECTIONS,EXPEDITION,EXTRA,SIMPLE,TYPES}};

},
"src/feature-policy.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
const MAJOR_FEATURE_DEFAULTS=Object.freeze({
  featureItemsEnabled:true,featureCatsEnabled:true,featureStoryEnabled:true,featureTreasureEnabled:true,
  featureGamatotoEnabled:true,featureGachaEnabled:true,featureAccountEnabled:true,featureFixesEnabled:true,
  featureOtherEnabled:true,featureEditorConfigEnabled:true,featurePresetsEnabled:true,maxAllItemsEnabled:true,
  presetMaxItemsEnabled:true,presetMaxCatsEnabled:true,presetMaxAccountEnabled:true,
  catUnlockEnabled:true,catRemoveEnabled:true,catLevelsEnabled:true,catFormsEnabled:true,catTalentsEnabled:true,
  accountPlaytimeEnabled:true,
  maxAccountResourcesEnabled:true,maxAccountCatsEnabled:true,maxAccountSpecialSkillsEnabled:true,maxAccountExpeditionEnabled:true,
  maxAccountTalentOrbsEnabled:true,maxAccountEnemyGuideEnabled:true,maxAccountStoryEnabled:true,maxAccountTreasureEnabled:true,
  maxAccountOutbreaksEnabled:true,maxAccountTutorialEnabled:true,
});
const MAX_ACCOUNT_COMPONENT_KEYS=Object.freeze({resources:'maxAccountResourcesEnabled',cats:'maxAccountCatsEnabled',specialSkills:'maxAccountSpecialSkillsEnabled',expedition:'maxAccountExpeditionEnabled',talentOrbs:'maxAccountTalentOrbsEnabled',enemyGuide:'maxAccountEnemyGuideEnabled',story:'maxAccountStoryEnabled',treasures:'maxAccountTreasureEnabled',outbreaks:'maxAccountOutbreaksEnabled',tutorial:'maxAccountTutorialEnabled'});

const CATEGORY_KEYS=Object.freeze({
  items:['featureItemsEnabled'],cats_special_skills:['featureCatsEnabled'],levels:['featureStoryEnabled','featureTreasureEnabled'],
  gamototo:['featureGamatotoEnabled'],account:['featureAccountEnabled'],gatya:['featureGachaEnabled'],fixes:['featureFixesEnabled'],
  other:['featureOtherEnabled'],editor:['featureEditorConfigEnabled'],presets:['featurePresetsEnabled'],save_management:[],
});
const SECTION_KEYS=Object.freeze({items:'featureItemsEnabled',cats:'featureCatsEnabled',levels:'featureStoryEnabled',expedition:'featureGamatotoEnabled',gacha:'featureGachaEnabled',fixes:'featureFixesEnabled',account:'featureAccountEnabled',other:'featureOtherEnabled',playtime:'accountPlaytimeEnabled',config:'featureEditorConfigEnabled',presets:'featurePresetsEnabled'});
const CAT_ACTION_KEYS=Object.freeze({unlock:'catUnlockEnabled',remove:'catRemoveEnabled',set_level:'catLevelsEnabled',max_upgrade:'catLevelsEnabled',max_base_plus:'catLevelsEnabled',upgrade_by:'catLevelsEnabled',true_form:'catFormsEnabled',fourth_form:'catFormsEnabled',remove_true_form:'catFormsEnabled',remove_fourth_form:'catFormsEnabled',max_talents:'catTalentsEnabled',remove_talents:'catTalentsEnabled'});

const enabled=(config,key)=>config?.[key]!==false;
function categoryEnabled(config,category){const keys=CATEGORY_KEYS[category];return Array.isArray(keys)&&(!keys.length||keys.some(key=>enabled(config,key)));}
function sectionEnabled(config,section){
  if(section==='levels')return enabled(config,'featureStoryEnabled')||enabled(config,'featureTreasureEnabled');
  const key=SECTION_KEYS[section];return !key||enabled(config,key);
}
function catActionEnabled(config,action){const key=CAT_ACTION_KEYS[action];return !key||enabled(config,key);}
function maxAccountComponents(config){return Object.fromEntries(Object.entries(MAX_ACCOUNT_COMPONENT_KEYS).map(([name,key])=>[name,enabled(config,key)]));}
function maxAccountHasEnabledComponents(config){return Object.values(maxAccountComponents(config)).some(Boolean);}
function editEnabled(config,edit){
  if(!edit||typeof edit!=='object')return false;
  if(edit.type==='max_account')return config?.maxAccountEnabled!==false&&(!edit.components||Object.values(edit.components).some(Boolean)||(edit.mapCategories?.length||0)>0);
  if(edit.type==='max_all')return enabled(config,'featureItemsEnabled')&&enabled(config,'maxAllItemsEnabled');
  if(edit.type==='item'||edit.type==='inventory')return enabled(config,'featureItemsEnabled');
  if(edit.type==='cat')return enabled(config,'featureCatsEnabled')&&catActionEnabled(config,edit.operation);
  if(edit.type==='special_skills')return enabled(config,'featureCatsEnabled')&&enabled(config,'catTalentsEnabled');
  if(['story_clear','outbreaks','timed_scores','map','map_batch','clear_to_japan'].includes(edit.type))return enabled(config,'featureStoryEnabled');
  if(edit.type==='treasures')return enabled(config,'featureTreasureEnabled');
  if(edit.type==='expedition')return enabled(config,'featureGamatotoEnabled');
  if(edit.type==='gacha_seed')return enabled(config,'featureGachaEnabled');
  if(edit.type==='playtime')return enabled(config,'featureAccountEnabled')&&enabled(config,'accountPlaytimeEnabled');
  if(edit.type==='simple'||edit.type==='score')return enabled(config,'featureFixesEnabled');
  if(edit.type==='extra')return enabled(config,'featureOtherEnabled');
  if(edit.type==='collection'){
    if(['storage','storage_skills','skills'].includes(edit.collection))return enabled(config,'featureCatsEnabled');
    if(['enigma'].includes(edit.collection))return enabled(config,'featureStoryEnabled');
    if(['rank_rewards','enemy_guide','medals','missions'].includes(edit.collection))return enabled(config,'featureAccountEnabled');
    return enabled(config,'featureItemsEnabled');
  }
  return true;
}

module.exports={MAJOR_FEATURE_DEFAULTS,MAX_ACCOUNT_COMPONENT_KEYS,CATEGORY_KEYS,SECTION_KEYS,CAT_ACTION_KEYS,enabled,categoryEnabled,sectionEnabled,catActionEnabled,maxAccountComponents,maxAccountHasEnabledComponents,editEnabled};

},
"tools/local/menus.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Detailed edit menus of canbot.js. Every choice is read from the SAVE's own metadata (the same answers the web
// editor gets) and becomes an edit in the web editor's format (src/edit-backend.js normalizeEdit), so the JS engine
// applies it exactly as a Discord or web SAVE would. Features the owner turned off are hidden (src/feature-policy.js).
const metadata=require('../../src/canbot-engine/metadata');
const story=require('../../src/canbot-engine/story');
const items=require('../../src/canbot-engine/items');
const engineSettings=require('../../src/canbot-engine/settings');
const {LABELS}=require('../../src/edit-labels');
const {editEnabled,maxAccountComponents}=require('../../src/feature-policy');

// Typed at a number prompt: the highest value allowed.
const MAX_WORDS=new Set(['max','all','최대','전부','최댓값','最大','全部','すべて']);
const fmt=v=>typeof v==='number'?v.toLocaleString('en-US'):String(v);
const ITEMS=['catfood','xp','normal_tickets','rare_tickets','platinum_tickets','legend_tickets','platinum_shards','np','leadership'];
const EN={catfood:'Cat Food',xp:'XP',normal_tickets:'Cat Tickets',rare_tickets:'Rare Tickets',platinum_tickets:'Platinum Tickets',legend_tickets:'Legend Tickets',platinum_shards:'Platinum Shards',np:'NP',leadership:'Leadership',
  unlock:'Unlock',remove:'Remove',set_level:'Set level',max_upgrade:'Max upgrade',max_base_plus:'Max base and plus',upgrade_by:'Level up by',true_form:'True form',fourth_form:'Ultra form',remove_true_form:'Remove true form',remove_fourth_form:'Remove ultra form',
  max_talents:'Max talents',remove_talents:'Remove talents',cat_guide:'Add to Cat Guide',remove_cat_guide:'Remove from Cat Guide',storage_add:'Add to storage',
  story_clear:'Clear story',treasures:'Treasures',outbreaks:'Zombie outbreaks',timed_scores:'Timed scores',
  catfruit:'Catfruit and seeds',catamins:'Catamins',catseyes:"Catseyes",base_materials:'Base materials',battle_items:'Battle items',treasure_chests:'Treasure chests',labyrinth_medals:'Labyrinth medals',
  sol:'Stories of Legend',event:'Event stages',collab:'Collab stages',uncanny:'Uncanny Legends',catamin_stages:'Catamin stages',towers:'Towers',gauntlets:'Gauntlets',collab_gauntlets:'Collab gauntlets',behemoth_culling:'Behemoth Culling',clear_enigma_stages:'Enigma stages',legend_quest:'Legend Quest',zero_legends:'Zero Legends',dojo_catclaw_championships:'Catclaw Championships',
  skills:'Special skills',enigma:'Enigma stages',endless:'Endless battle items',storage_skills:'Storage special skills',rank_rewards:'User rank rewards',talent_orbs:'Talent orbs',scheme_items:'Event unlocks',event_tickets:'Event tickets',enemy_guide:'Enemy guide',medals:'Medals',missions:'Missions',storage:'Storage',
  level:'Gamatoto level',helpers:'Gamatoto helpers',engineers:'Ototo engineers',shrine_level:'Cat Shrine level',shrine_xp:'Cat Shrine XP',shrine_appear:'Show Cat Shrine',shrine_disappear:'Hide Cat Shrine',cannon_levels:'Cannon levels',cannon_development:'Cannon development',
  rare_trade:'Prepare rare ticket trade',hundred_million:'100 million tickets',slots:'Lineup slots',aku:'Aku stages',gold_add:'Add Gold Pass',gold_remove:'Remove Gold Pass',
  fix_gamatoto_crash:'Fix Gamatoto crash',fix_ototo_crash:'Fix Ototo crash',fix_time_errors:'Fix time errors',fix_officer_pass_crash:'Fix Gold Pass crash',unlock_equip_menu:'Unlock equip menu',restart_pack:'Set restart pack',reset_gambling_events:'Reset gambling events',reset_golden_cat_cpus:'Reset golden Cat CPUs',unlock_aku_realm:'Unlock Aku Realm',filibuster_reclearing:'Filibuster re-clearing',
  max_all:'Max all items',max_account:'Max account',special_skills:'Max special skills',clear_to_japan:'Clear to Japan',playtime:'Play time',gacha_seed:'Gacha seed',score:'Score'};
// Japanese and Traditional Chinese names of the same features (common in-game wording; corrections welcome).
const JA={catfood:'ネコカン',xp:'XP',normal_tickets:'ネコチケット',rare_tickets:'レアチケット',platinum_tickets:'プラチナチケット',legend_tickets:'レジェンドチケット',platinum_shards:'プラチナのかけら',np:'NP',leadership:'リーダーシップ',
  unlock:'入手',remove:'削除',set_level:'レベル設定',max_upgrade:'最大強化',max_base_plus:'基本+プラス最大',upgrade_by:'レベルを上げる',true_form:'第3形態',fourth_form:'第4形態',remove_true_form:'第3形態を解除',remove_fourth_form:'第4形態を解除',
  max_talents:'本能を最大',remove_talents:'本能を解除',cat_guide:'キャラ図鑑に登録',remove_cat_guide:'キャラ図鑑から削除',storage_add:'ネコ部屋(保管庫)に追加',
  story_clear:'ストーリークリア',treasures:'お宝',outbreaks:'ゾンビステージ',timed_scores:'タイムスコア',
  catfruit:'マタタビ・種',catamins:'ネコビタン',catseyes:'ネコの目',base_materials:'城の素材',battle_items:'バトルアイテム',treasure_chests:'宝箱',labyrinth_medals:'迷宮の勲章',
  sol:'レジェンドストーリー',event:'イベントステージ',collab:'コラボステージ',uncanny:'真レジェンドストーリー',catamin_stages:'ネコビタンステージ',towers:'風雲にゃんこ塔など',gauntlets:'強襲ステージ',collab_gauntlets:'コラボ強襲',behemoth_culling:'超獣討伐',clear_enigma_stages:'謎のステージ',legend_quest:'レジェンドクエスト',zero_legends:'ゼロレジェンドストーリー',dojo_catclaw_championships:'にゃんこ道場 大会',
  skills:'特殊能力',enigma:'謎のステージ',endless:'無限バトルアイテム',storage_skills:'保管庫の特殊能力',rank_rewards:'ユーザーランク報酬',talent_orbs:'本能玉',scheme_items:'イベント解放項目',event_tickets:'イベントチケット',enemy_guide:'敵キャラ図鑑',medals:'メダル',missions:'ミッション',storage:'保管庫',
  level:'ガマトトのレベル',helpers:'ガマトト隊員',engineers:'オトートの助手',shrine_level:'ネコ神社のレベル',shrine_xp:'ネコ神社の経験値',shrine_appear:'ネコ神社を表示',shrine_disappear:'ネコ神社を隠す',cannon_levels:'キャノンのレベル',cannon_development:'キャノンの開発',
  rare_trade:'レアチケット交換の準備',hundred_million:'1億チケット',slots:'編成スロット',aku:'悪魔ステージ',gold_add:'にゃんこ会員(ゴールド)を追加',gold_remove:'にゃんこ会員(ゴールド)を解除',
  fix_gamatoto_crash:'ガマトトの不具合修復',fix_ototo_crash:'オトートの不具合修復',fix_time_errors:'時間エラーの修復',fix_officer_pass_crash:'にゃんこ会員の不具合修復',unlock_equip_menu:'装備メニューを解放',restart_pack:'リスタートパックを設定',reset_gambling_events:'ギャンブルイベントを初期化',reset_golden_cat_cpus:'ゴールデンネコCPUを初期化',unlock_aku_realm:'悪魔の領域を解放',filibuster_reclearing:'フィリバスター再クリア',
  max_all:'すべてのアイテムを最大',max_account:'アカウント最大',special_skills:'特殊能力を最大',clear_to_japan:'日本編までクリア',playtime:'プレイ時間',gacha_seed:'ガチャシード',score:'スコア'};
const ZH={catfood:'貓罐頭',xp:'XP',normal_tickets:'貓咪券',rare_tickets:'稀有轉蛋券',platinum_tickets:'白金轉蛋券',legend_tickets:'傳說轉蛋券',platinum_shards:'白金碎片',np:'NP',leadership:'統率力',
  unlock:'取得',remove:'刪除',set_level:'設定等級',max_upgrade:'強化到最大',max_base_plus:'基本+加值最大',upgrade_by:'提升等級',true_form:'第三型態',fourth_form:'第四型態',remove_true_form:'解除第三型態',remove_fourth_form:'解除第四型態',
  max_talents:'本能最大',remove_talents:'解除本能',cat_guide:'登錄角色圖鑑',remove_cat_guide:'從角色圖鑑移除',storage_add:'加入保管庫',
  story_clear:'故事通關',treasures:'寶物',outbreaks:'殭屍關卡',timed_scores:'時間分數',
  catfruit:'木天蓼・種子',catamins:'貓薄荷飲料',catseyes:'貓眼石',base_materials:'城堡素材',battle_items:'戰鬥道具',treasure_chests:'寶箱',labyrinth_medals:'迷宮勳章',
  sol:'傳說故事',event:'活動關卡',collab:'合作關卡',uncanny:'真傳說故事',catamin_stages:'貓薄荷飲料關卡',towers:'貓咪塔',gauntlets:'強襲關卡',collab_gauntlets:'合作強襲',behemoth_culling:'超獸討伐',clear_enigma_stages:'謎之關卡',legend_quest:'傳說任務',zero_legends:'零傳說故事',dojo_catclaw_championships:'貓咪道場大會',
  skills:'特殊能力',enigma:'謎之關卡',endless:'無限戰鬥道具',storage_skills:'保管庫特殊能力',rank_rewards:'用戶等級獎勵',talent_orbs:'本能玉',scheme_items:'活動解鎖項目',event_tickets:'活動券',enemy_guide:'敵人圖鑑',medals:'勳章',missions:'任務',storage:'保管庫',
  level:'喵喵探險隊等級',helpers:'喵喵探險隊隊員',engineers:'弟弟的助手',shrine_level:'貓咪神社等級',shrine_xp:'貓咪神社經驗值',shrine_appear:'顯示貓咪神社',shrine_disappear:'隱藏貓咪神社',cannon_levels:'大砲等級',cannon_development:'大砲開發',
  rare_trade:'準備稀有轉蛋券交換',hundred_million:'1 億轉蛋券',slots:'編成欄位',aku:'惡魔關卡',gold_add:'加入貓咪會員(金)',gold_remove:'解除貓咪會員(金)',
  fix_gamatoto_crash:'修復喵喵探險隊錯誤',fix_ototo_crash:'修復弟弟錯誤',fix_time_errors:'修復時間錯誤',fix_officer_pass_crash:'修復貓咪會員錯誤',unlock_equip_menu:'解鎖裝備選單',restart_pack:'設定重新開始包',reset_gambling_events:'重設賭博活動',reset_golden_cat_cpus:'重設黃金貓 CPU',unlock_aku_realm:'解鎖惡魔領域',filibuster_reclearing:'重新通關阻撓關卡',
  max_all:'所有道具最大',max_account:'帳號最大',special_skills:'特殊能力最大',clear_to_japan:'通關到日本篇',playtime:'遊玩時間',gacha_seed:'轉蛋種子',score:'分數'};
const MAPS=Object.keys(LABELS.MAPS),INVENTORIES=Object.keys(LABELS.INVENTORY),COLLECTIONS=Object.keys(LABELS.COLLECTIONS);
const CAT_OPS=['unlock','true_form','fourth_form','max_upgrade','max_base_plus','set_level','upgrade_by','max_talents','cat_guide','storage_add','remove_true_form','remove_fourth_form','remove_talents','remove_cat_guide','remove'];
const EXPEDITIONS=['xp','level','helpers','engineers','cannon_levels','cannon_development','shrine_level','shrine_xp','shrine_appear','shrine_disappear'];
const EXTRAS=Object.keys(LABELS.EXTRA),SIMPLES=Object.keys(LABELS.SIMPLE);
const ALL_LABELS=Object.assign({},...Object.values(LABELS));

// Comma or space separated numbers and ranges: "1-5, 8 10". Returns null for anything else.
function parseNumbers(text){
  const out=[];for(const part of String(text).split(/[\s,]+/).filter(Boolean)){
    const m=/^(\d+)(?:-(\d+))?$/.exec(part);if(!m)return null;const a=Number(m[1]),b=m[2]===undefined?a:Number(m[2]);
    if(b<a||b-a>10000)return null;for(let i=a;i<=b;i++)out.push(i);
  }
  return out.length?[...new Set(out)]:null;
}

// names: game data of the region that matches the chosen language (or null). Lists are built from the SAVE's own game
// data and only the names are taken from it, by the same id; anything it does not have keeps its original name.
// extended: the member's role may use extended limits and they turned them on (item and clear-count limits become the
// field's integer range, as in the web editor). The owner's caps in `limits` still apply.
function createMenus({ui,save,gd,names=null,policy={},access={},limits={},extended=false}){
  const maxed=run=>extended?engineSettings.use({...engineSettings.get(),disableMaxes:true},run):run();
  // ui.lang(): 'ko', 'en', 'ja' or 'zh'. Metadata notes come in Korean and English only; other languages use English.
  const {say,ask,choose,askNumber,yes,L}=ui,lang=()=>typeof ui.lang==='function'?ui.lang():'ko',en=()=>lang()!=='ko';
  const label=key=>{const l=lang();return (l==='ko'?ALL_LABELS[key]:l==='ja'?JA[key]:l==='zh'?ZH[key]:null)||EN[key]||key;};
  function localize(request,r){
    if(!names||names===gd||!r||r.success===false)return r;
    let other;try{other=metadata.handle(save,names,request);}catch{return r;}if(!other||other.success===false)return r;
    const rename=(mine,theirs)=>{if(!Array.isArray(mine)||!Array.isArray(theirs))return mine;const byId=new Map(theirs.filter(x=>x&&x.id!==undefined).map(x=>[String(x.id),x]));
      return mine.map(x=>{const t=x&&x.id!==undefined?byId.get(String(x.id)):null;if(!t)return x;const out={...x};if(typeof t.name==='string'&&t.name)out.name=t.name;
        if(Array.isArray(x.stages)&&Array.isArray(t.stages)&&t.stages.length===x.stages.length&&t.stages.every(v=>typeof v==='string'))out.stages=t.stages;return out;});};
    const out={...r};for(const key of ['maps','entries','chapters','cannons','banners'])if(Array.isArray(r[key]))out[key]=rename(r[key],other[key]);
    if(Array.isArray(r.rarities)&&Array.isArray(other.rarities)&&r.rarities.length===other.rarities.length)out.rarities=other.rarities;
    return out;
  }
  const meta=request=>{const r=localize(request,maxed(()=>metadata.handle(save,gd,request)));if(!r||r.success===false)throw Object.assign(new Error(L('이 SAVE에서는 쓸 수 없는 기능입니다.','This feature is not available for this SAVE.','このセーブでは使えない機能です。','此存檔無法使用這個功能。')),{code:r?.errorCode||'META'});return r;};
  const allowed=edit=>editEnabled(policy,edit)&&!(['max_all','max_account'].includes(edit.type)&&access.canUseMax===false);
  const ownerCap=(technical,owner)=>Number.isSafeInteger(owner)&&owner>0?Math.min(technical,owner):technical;

  // Pick entries from a list of {id,name}: "all", numbers/ranges of ids, "/word" to search, "l" to list.
  async function pickEntries(title,entries,{max=5000,show=e=>`${e.id}) ${e.name}`}={}){
    const ids=new Set(entries.map(e=>Number(e.id)));
    say('');say(`${title} (${entries.length})`);
    say(L('  all = 전부 · 번호 예: 0-5, 8 · /검색어 · l = 목록 보기','  all = everything · ids like 0-5, 8 · /word to search · l = list','  all = すべて · 番号 例: 0-5, 8 · /単語 で検索 · l = 一覧','  all = 全部 · 編號 例: 0-5, 8 · /關鍵字 搜尋 · l = 列表'));
    for(;;){
      const a=await ask('> ');
      if(a==='l'){entries.slice(0,500).forEach(e=>say('  '+show(e)));if(entries.length>500)say(L(`  ...외 ${entries.length-500}개 (/검색어로 찾으세요)`,`  ...${entries.length-500} more (search with /word)`,`  ...ほか${entries.length-500}件 (/単語 で検索してください)`,`  ...還有 ${entries.length-500} 項（請用 /關鍵字 搜尋）`));continue;}
      if(a.startsWith('/')){const q=a.slice(1).trim().toLowerCase().replace(/\s+/g,'');const hits=entries.filter(e=>String(e.name).toLowerCase().replace(/\s+/g,'').includes(q));hits.slice(0,40).forEach(e=>say('  '+show(e)));say(L(`  ${hits.length}개 찾음`,`  ${hits.length} found`,`  ${hits.length}件見つかりました`,`  找到 ${hits.length} 項`));continue;}
      if(a.toLowerCase()==='all'){if(entries.length>max){say(L(`한 번에 ${max}개까지 고를 수 있습니다.`,`Up to ${max} at a time.`,`一度に${max}件まで選べます。`,`一次最多可選 ${max} 項。`));continue;}return entries.map(e=>Number(e.id));}
      const nums=parseNumbers(a);
      if(nums&&nums.every(n=>ids.has(n))&&nums.length<=max)return nums;
      say(L('목록에 있는 번호를 입력하세요.','Enter ids from the list.','一覧にある番号を入力してください。','請輸入列表中的編號。'));
    }
  }
  // Stage numbers as people count them (1..count), returned 0-based. Enter = whole.
  async function pickStages(count){
    say(L(`스테이지: Enter 또는 all = 전부, 또는 번호 (1~${count}, 예: 1-10, 15)`,`Stages: Enter = all, or numbers (1-${count}, e.g. 1-10, 15)`,`ステージ: Enter = すべて、または番号 (1~${count}、例: 1-10, 15)`,`關卡: Enter = 全部，或輸入編號 (1~${count}，例: 1-10, 15)`));
    for(;;){const a=await ask('> ');if(!a||a.toLowerCase()==='all')return {mode:'whole',stages:[]};const n=parseNumbers(a);if(n&&n.every(x=>x>=1&&x<=count))return {mode:'specific',stages:n.map(x=>x-1)};say(L('범위 안의 번호를 입력하세요.','Enter numbers in range.','範囲内の番号を入力してください。','請輸入範圍內的編號。'));}
  }

  // A cat's name in the chosen language when that region's data has it, else in the SAVE's own data.
  const catName=id=>{for(const data of [names&&names!==gd?names:null,gd]){if(!data)continue;try{const n=data.catNames(save.cc,id)?.find(Boolean);if(n)return n;}catch{}}return `#${id}`;};
  // One condition (the engine's cat selector modes), as a set of cat ids.
  async function catCondition(){
    const modes=['all','unlocked','not_unlocked','obtainable','non_gacha','ids','name','rarity','gacha','game_version'];
    const i=await choose(L('조건','Condition','条件','條件'),[L('전부','All','すべて','全部'),L('보유한 고양이','Owned','所持しているキャラ','已擁有的角色'),L('보유하지 않은 고양이','Not owned','所持していないキャラ','未擁有的角色'),L('획득 가능한 고양이','Obtainable','入手可能なキャラ','可取得的角色'),
      L('가챠 이외 (스테이지·이벤트 보상 등)','Not from gacha (stage and event rewards...)','ガチャ以外 (ステージ・イベント報酬など)','非轉蛋（關卡、活動獎勵等）'),L('번호로 (예: 0-10, 25)','By id (e.g. 0-10, 25)','番号で (例: 0-10, 25)','依編號（例: 0-10, 25）'),L('이름으로 찾기','By name','名前で検索','依名稱搜尋'),
      L('희귀도로 (여러 개 가능)','By rarity (several allowed)','レアリティで (複数可)','依稀有度（可多選）'),L('가챠 배너로','By gacha banner','ガチャのバナーで','依轉蛋橫幅'),L('추가된 게임 버전으로 (예: 15.7, 14.0-15.0)','By the game version that added them (e.g. 15.7, 14.0-15.0)','追加されたゲームバージョンで (例: 15.7, 14.0-15.0)','依加入的遊戲版本（例: 15.7, 14.0-15.0）')]);
    const mode=modes[i];let value='';
    if(mode==='ids')value=await ask(L('고양이 번호: ','Cat ids: ','キャラ番号: ','角色編號: '));
    if(mode==='name')value=await ask(L('이름 (일부만 써도 됩니다): ','Name (part is fine): ','名前 (一部でもOK): ','名稱（輸入部分即可）: '));
    if(mode==='rarity'){
      const info=meta({action:'cat_selector',mode:'selector_info'});say('');info.rarities.forEach((r,k)=>say(`  ${k+1}) ${r}`));
      for(;;){const n=parseNumbers(await ask(L('희귀도 번호 (예: 3 또는 3,4): ','Rarity numbers (e.g. 3 or 3,4): ','レアリティ番号 (例: 3 または 3,4): ','稀有度編號（例: 3 或 3,4）: ')));if(n&&n.every(x=>x>=1&&x<=info.rarities.length)){value=n.map(x=>x-1).join(' ');break;}}
    }
    if(mode==='gacha'){const info=meta({action:'cat_selector',mode:'selector_info'});value=(await pickEntries(L('가챠 배너','Gacha banners','ガチャのバナー','轉蛋橫幅'),info.banners.filter(b=>b.name!=='unknown_banner'),{max:200})).join(' ');}
    if(mode==='game_version'){const info=meta({action:'cat_selector',mode:'selector_info'});if(info.gameVersions?.length)say(L(`  ${info.gameVersions[0]} ~ ${info.gameVersions.at(-1)}`,`  ${info.gameVersions[0]} to ${info.gameVersions.at(-1)}`,`  ${info.gameVersions[0]} ~ ${info.gameVersions.at(-1)}`,`  ${info.gameVersions[0]} ~ ${info.gameVersions.at(-1)}`));value=await ask(L('게임 버전: ','Game version: ','ゲームバージョン: ','遊戲版本: '));}
    const r=meta({action:'cat_selector',mode,value});
    let ids=r.catIds||[];
    // A name search also looks at the names in the chosen language (the same cat ids in that region's data).
    if(mode==='name'&&names&&names!==gd){try{const all=new Set(meta({action:'cat_selector',mode:'all'}).catIds),more=metadata.handle(save,names,{action:'cat_selector',mode:'name',value});
      if(more?.success)ids=[...new Set([...ids,...more.catIds.filter(id=>all.has(id))])];}catch{}}
    return new Set(ids);
  }
  // Conditions can be combined: start with one, then narrow (both), add (either) or drop ids, with a preview each time.
  async function catTargets(){
    let chosen=await catCondition();
    for(;;){
      const ids=[...chosen].sort((a,b)=>a-b);
      say('');say(L(`선택: 고양이 ${ids.length}마리`,`Selected: ${ids.length} cats`,`選択中: キャラ${ids.length}体`,`已選擇: ${ids.length} 隻角色`));
      if(ids.length)say('  '+ids.slice(0,8).map(id=>`${catName(id)} (${id})`).join(', ')+(ids.length>8?L(` 외 ${ids.length-8}마리`,` and ${ids.length-8} more`,` ほか${ids.length-8}体`,` 等另外 ${ids.length-8} 隻`):''));
      const NEXT=['use','narrow','add','drop','list'];
      const next=NEXT[await choose(L('이 선택으로 할까요?','Use this selection?','この選択でよいですか？','使用這個選擇嗎？'),[L('이대로 사용','Use it','このまま使う','直接使用'),L('조건 더해서 좁히기 (둘 다 맞는 고양이만)','Narrow with another condition (cats matching both)','条件を足して絞り込む (両方に合うキャラだけ)','再加條件縮小（只留兩者都符合的）'),
        L('조건 더해서 늘리기 (어느 쪽이든)','Add another condition (cats matching either)','条件を足して広げる (どちらかに合うキャラ)','再加條件擴大（任一符合即可）'),L('번호로 빼기','Remove by id','番号で外す','依編號移除'),L('전체 목록 보기','Show the whole list','一覧をすべて表示','顯示完整列表')])];
      if(next==='use'){if(!ids.length){say(L('해당하는 고양이가 없습니다.','No cats match.','該当するキャラがいません。','沒有符合的角色。'));continue;}return ids;}
      if(next==='list'){ids.forEach(id=>say(`  ${id}) ${catName(id)}`));continue;}
      if(next==='drop'){const n=parseNumbers(await ask(L('뺄 번호 (예: 3, 10-12): ','Ids to remove (e.g. 3, 10-12): ','外す番号 (例: 3, 10-12): ','要移除的編號（例: 3, 10-12）: ')));if(n)for(const id of n)chosen.delete(id);continue;}
      const more=await catCondition();
      chosen=next==='narrow'?new Set(ids.filter(id=>more.has(id))):new Set([...ids,...more]);
    }
  }
  async function cats(){
    const ops=CAT_OPS.filter(op=>allowed({type:'cat',operation:op}));if(!ops.length)throw new Error(L('관리자가 고양이 편집을 꺼 두었습니다.','Cat edits are turned off.','キャラの編集は管理者により無効になっています。','角色編輯已被管理員關閉。'));
    // Several actions for the same cats in one go (e.g. 1,2,5 = unlock, true form, max level), applied in menu order.
    say('');say(L('고양이 작업 (여러 개 가능, 예: 1,2,5)','Cat actions (several allowed, e.g. 1,2,5)','キャラの操作 (複数可、例: 1,2,5)','角色操作（可多選，例: 1,2,5）'));ops.forEach((op,k)=>say(`  ${k+1}) ${label(op)}`));say(`  0) ${L('← 돌아가기','← Back','← 戻る','← 返回')}`);
    let picked;for(;;){const a=await ask('> ');if(a==='0')throw Object.assign(new Error('back'),{code:'BACK'});const n=parseNumbers(a);if(n&&n.length&&n.every(x=>x>=1&&x<=ops.length)){picked=[...new Set(n)].sort((x,y)=>x-y).map(x=>ops[x-1]);break;}say(L('목록에 있는 번호를 입력하세요.','Enter numbers from the list.','一覧にある番号を入力してください。','請輸入列表中的編號。'));}
    const catIds=await catTargets(),out=[];
    for(const op of picked){
      const edit={type:'cat',operation:op,catIds};
      if(op==='set_level'){const m=meta({action:'cat_level_metadata',catIds});const baseMax=ownerCap(m.baseMax,limits.catBase),plusMax=ownerCap(m.plusMax,limits.catPlus);
        edit.base=await askNumber(L('기본 레벨','Base level','基本レベル','基本等級'),1,baseMax);edit.plus=plusMax>0?await askNumber(L('플러스 레벨','Plus level','プラスレベル','加值等級'),0,plusMax):0;}
      if(op==='upgrade_by'||op==='storage_add')edit.amount=await askNumber(op==='upgrade_by'?L('올릴 레벨','Levels to add','上げるレベル','要提升的等級'):L('넣을 개수','Amount','数','數量'),1,Number(limits.catUpgradeAmount)||100000);
      if(op==='remove'&&!(await yes(L(`고양이 ${catIds.length}마리를 삭제합니다. 계속할까요?`,`Remove ${catIds.length} cats?`,`キャラ${catIds.length}体を削除します。続けますか？`,`將刪除 ${catIds.length} 隻角色。要繼續嗎？`))))continue;
      out.push(edit);
    }
    return out.length?out:null;
  }
  // Items this SAVE has, with the current value and the highest value allowed now (game or extended limit, owner cap).
  function itemRows(){
    const values=items.itemValues(save);
    return ITEMS.map(name=>{const game=maxed(()=>items.limit(save,name));return game==null||!(name in values)?null:{name,current:values[name],max:ownerCap(game,limits.items?.[name])};}).filter(Boolean);
  }
  // One item, several (1,3-5) or all; several take one value or max (each its own highest value). Returns edits.
  async function itemsMenu(){
    const rows=itemRows();if(!rows.length)throw new Error(L('이 SAVE에는 바꿀 아이템이 없습니다.','This SAVE has no items to change.','このセーブには変更できるアイテムがありません。','此存檔沒有可變更的道具。'));
    say('');say(L('아이템  [현재 / 최대]','Items  [now / max]','アイテム  [現在 / 最大]','道具  [目前 / 最大]'));
    rows.forEach((r,i)=>say(`  ${i+1}) ${label(r.name)}  [${fmt(r.current)} / ${fmt(r.max)}]`));
    say(`  0) ${L('← 돌아가기','← Back','← 戻る','← 返回')}`);
    say(L('  번호 하나, 여러 개 (예: 1,4-6) 또는 all','  One number, several (e.g. 1,4-6) or all','  番号ひとつ、複数 (例: 1,4-6) または all','  一個編號、多個（例: 1,4-6）或 all'));
    let chosen;
    for(;;){const a=(await ask('> ')).toLowerCase();if(a==='0')throw Object.assign(new Error('back'),{code:'BACK'});if(a==='all'){chosen=rows;break;}
      const n=parseNumbers(a);if(n&&n.every(x=>x>=1&&x<=rows.length)){chosen=[...new Set(n)].map(x=>rows[x-1]);break;}say(L('목록에 있는 번호를 입력하세요.','Enter numbers from the list.','一覧にある番号を入力してください。','請輸入列表中的編號。'));}
    if(chosen.length===1){const r=chosen[0];return [{type:'item',item:r.name,value:await askNumber(label(r.name),0,r.max,{current:r.current})}];}
    say(L(`${chosen.length}개: ${chosen.map(r=>label(r.name)).join(', ')}`,`${chosen.length} items: ${chosen.map(r=>label(r.name)).join(', ')}`,`${chosen.length}件: ${chosen.map(r=>label(r.name)).join('、')}`,`${chosen.length} 項: ${chosen.map(r=>label(r.name)).join('、')}`));
    for(;;){
      const a=(await ask(L('값 (max = 각각 최대): ','Value (max = each to its highest): ','値 (max = それぞれ最大): ','數值（max = 各自最大）: '))).replace(/,/g,'').toLowerCase();
      if(MAX_WORDS.has(a))return chosen.map(r=>({type:'item',item:r.name,value:r.max}));
      const v=Number(a);if(!Number.isSafeInteger(v)||v<0){say(L('숫자 또는 max를 입력하세요.','Enter a number or max.','数字か max を入力してください。','請輸入數字或 max。'));continue;}
      const over=chosen.filter(r=>v>r.max);if(over.length){say(L(`너무 큽니다: ${over.map(r=>`${label(r.name)} 최대 ${fmt(r.max)}`).join(', ')}`,`Too large: ${over.map(r=>`${label(r.name)} max ${fmt(r.max)}`).join(', ')}`,`大きすぎます: ${over.map(r=>`${label(r.name)} 最大 ${fmt(r.max)}`).join('、')}`,`太大: ${over.map(r=>`${label(r.name)} 最大 ${fmt(r.max)}`).join('、')}`));continue;}
      return chosen.map(r=>({type:'item',item:r.name,value:v}));
    }
  }
  async function inventory(){
    const name=INVENTORIES[await choose(L('보관함','Inventory','所持品','持有物品'),INVENTORIES.map(label))],m=meta({action:'inventory_metadata',inventory:name});
    const ids=await pickEntries(label(name),m.entries,{show:e=>`${e.id}) ${e.name}${e.value!==undefined?` [${e.value}]`:''}`});
    return {type:'inventory',inventory:name,ids,value:await askNumber(L('개수','Amount','数','數量'),0,m.maximum)};
  }
  async function storyMenu(){
    const kinds=['story_clear','treasures','outbreaks','timed_scores'].filter(t=>allowed({type:t}));if(!kinds.length)throw new Error(L('관리자가 스토리 편집을 꺼 두었습니다.','Story edits are turned off.','ストーリーの編集は管理者により無効になっています。','故事編輯已被管理員關閉。'));
    const type=kinds[await choose(L('스토리','Story','ストーリー','故事'),kinds.map(label))],m=meta({action:'metadata'});
    const eligible=m.chapters.filter(c=>(type!=='timed_scores'||Number(c.group)===1)&&(type!=='outbreaks'||c.outbreakStages?.length));
    const chapters=await pickEntries(L('챕터','Chapters','章','章節'),eligible);
    const count=Math.min(...eligible.filter(c=>chapters.includes(Number(c.id))).map(c=>c.stages.length));
    const {mode,stages}=type==='outbreaks'?{mode:'whole',stages:[]}:await pickStages(count);
    const edit={type,chapters,mode,stages};
    if(type==='outbreaks')edit.value=await yes(L('클리어로 바꿀까요? (n = 미클리어로)','Mark as cleared? (n = not cleared)','クリア済みにしますか？(n = 未クリアに)','要設為已通關嗎？（n = 設為未通關）'));
    else edit.value=await askNumber(type==='treasures'?L('보물 등급 (0 없음, 1 동, 2 은, 3 금)','Treasure grade (0 none, 1 bronze, 2 silver, 3 gold)','お宝のランク (0 なし、1 銅、2 銀、3 金)','寶物等級（0 無、1 銅、2 銀、3 金）'):type==='timed_scores'?L('점수','Score','スコア','分數'):L('클리어 횟수','Clear count','クリア回数','通關次數'),0,type==='treasures'?m.treasureMax:type==='timed_scores'?m.scoreMax:m.clearMax);
    return edit;
  }
  async function maps(){
    const category=MAPS[await choose(L('스테이지 종류','Stage group','ステージの種類','關卡類型'),MAPS.map(label))],m=meta({action:'map_metadata',category});
    if(!m.maps.length)throw new Error(L('이 SAVE에는 이 종류의 맵이 없습니다.','This SAVE has no maps of this kind.','このセーブにはこの種類のマップがありません。','此存檔沒有這類地圖。'));
    const mapIds=await pickEntries(label(category),m.maps),chosen=m.maps.filter(x=>mapIds.includes(Number(x.id)));
    const crowns=Math.min(...chosen.map(x=>x.stageCounts.length));
    const star=crowns>1?(await askNumber(L('왕관 (별) 단계','Crown','王冠','王冠'),1,crowns))-1:0;
    const {mode,stages}=await pickStages(Math.min(...chosen.map(x=>Number(x.stageCounts[star]))));
    const clear=await yes(L('클리어로 바꿀까요? (n = 미클리어로)','Mark as cleared? (n = not cleared)','クリア済みにしますか？(n = 未クリアに)','要設為已通關嗎？（n = 設為未通關）'));
    const amount=clear?await askNumber(L('클리어 횟수','Clear count','クリア回数','通關次數'),1,m.clearMax):0;
    return {type:mapIds.length===1?'map':'map_batch',category,mapIds,mapId:mapIds[0],mapName:chosen[0]?.name||'',star,mode,stages,clear,amount};
  }
  async function collections(){
    const names=COLLECTIONS.filter(c=>allowed({type:'collection',collection:c}));
    const collection=names[await choose(L('수집 항목','Collection','収集項目','收集項目'),names.map(label))],m=meta({action:'collection_metadata',collection});
    if(!m.entries.length)throw new Error(L('바꿀 항목이 없습니다.','Nothing to change here.','変更できる項目がありません。','沒有可變更的項目。'));
    const ids=await pickEntries(label(collection),m.entries,{show:e=>`${e.id}) ${e.name}${e.value!==undefined?` [${e.value}]`:''}`}),edit={type:'collection',collection,ids};
    if(m.actions){const keys=Object.keys(m.actions);const action=keys[await choose(L('작업','Action','操作','操作'),keys.map(k=>m.actions[k]))];return {...edit,action,actionLabel:m.actions[action]};}
    if(m.fields){const chosen=m.entries.filter(e=>ids.includes(Number(e.id)));const baseMax=Math.min(...chosen.map(e=>Number(e.baseMax))),plusMax=Math.min(...chosen.map(e=>Number(e.plusMax)));
      return {...edit,base:await askNumber(L('기본 레벨','Base level','基本レベル','基本等級'),1,baseMax),plus:plusMax>0?await askNumber(L('플러스 레벨','Plus level','プラスレベル','加值等級'),0,plusMax):0};}
    if(m.duration){say(L('남은 시간(초)을 입력하세요. 무제한은 infinity','Enter seconds left, or infinity','残り秒数を入力してください。無制限は infinity','請輸入剩餘秒數。無限制請輸入 infinity'));for(;;){const a=(await ask('> ')).toLowerCase();if(a==='infinity')return {...edit,value:'infinity'};const n=Number(a);if(Number.isFinite(n)&&n>=0)return {...edit,value:n};}}
    return {...edit,value:await askNumber(L('값','Value','値','數值'),0,Number.isSafeInteger(m.maximum)?m.maximum:2147483647)};
  }
  async function expedition(){
    const operation=EXPEDITIONS[await choose(L('가마토토 · 오토토 · 고양이 신사','Gamatoto, Ototo and Cat Shrine','ガマトト・オトート・ネコ神社','喵喵探險隊・弟弟・貓咪神社'),EXPEDITIONS.map(label))],m=meta({action:'expedition_metadata'}),edit={type:'expedition',operation};
    if(operation==='shrine_appear'||operation==='shrine_disappear')return edit;
    if(operation==='helpers'){const counts=[];let left=m.maxHelpers;for(let i=0;i<m.rarities.length;i++){const n=await askNumber(m.rarities[i],0,Math.min(m.rarityCounts[i],left));counts.push(n);left-=n;}return {...edit,counts};}
    if(operation==='cannon_levels'||operation==='cannon_development'){
      const list=operation==='cannon_development'?m.cannons.filter(c=>Number(c.id)!==0):m.cannons;const cannon=list[await choose(L('대포','Cannon','キャノン','大砲'),list.map(c=>c.name))];edit.cannonId=Number(cannon.id);
      if(operation==='cannon_levels'){edit.levels=[];for(let i=0;i<cannon.maximums.length;i++)edit.levels.push(await askNumber(L(`레벨 ${i+1}`,`Level ${i+1}`,`レベル ${i+1}`,`等級 ${i+1}`),0,cannon.maximums[i]));}
      else edit.value=await askNumber(L('개발 단계','Development stage','開発段階','開發階段'),0,3);
      return edit;
    }
    let max=2147483647,min=0;if(operation==='level'){max=m.maxLevel;min=1;}if(operation==='engineers')max=m.engineerMax;
    if(operation.startsWith('shrine_')){const s=meta({action:'shrine_metadata'});max=operation==='shrine_level'?s.shrineLevelMax:s.shrineXpMax;if(operation==='shrine_level')min=1;}
    edit.value=await askNumber(label(operation),min,max);return edit;
  }
  async function extras(){
    const operation=EXTRAS[await choose(L('기타','Other','その他','其他'),EXTRAS.map(label))],m=meta({action:'extra_metadata',operation}),edit={type:'extra',operation,note:String(m.note||'').slice(0,300)};
    if(m.noteKo||m.note)say(en()?m.note:m.noteKo||m.note);
    for(const f of m.fields||[])edit[f.id]=await askNumber(en()?f.name:f.nameKo||f.name,0,f.max);
    return edit;
  }
  async function account(){
    const opts=[['playtime'],['gacha_seed'],['score'],['clear_to_japan'],['special_skills'],...SIMPLES.map(s=>['simple',s])].filter(([t,s])=>allowed(s?{type:t,operation:s}:{type:t}));
    const [type,operation]=opts[await choose(L('계정 · 복구','Account and fixes','アカウント・修復','帳號・修復'),opts.map(([t,s])=>label(s||t)))];
    if(type==='simple')return {type,operation};
    if(type==='playtime')return {type,hours:await askNumber(L('시간','Hours','時間','小時'),0,19000),minutes:await askNumber(L('분','Minutes','分','分'),0,59),seconds:await askNumber(L('초','Seconds','秒','秒'),0,59)};
    if(type==='gacha_seed'){const seed=['rare','normal','event'][await choose(L('가챠 시드','Gacha seed','ガチャシード','轉蛋種子'),[L('레어 가챠','Rare','レアガチャ','稀有轉蛋'),L('노멀 가챠','Normal','ノーマルガチャ','普通轉蛋'),L('이벤트 가챠','Event','イベントガチャ','活動轉蛋')])];return {type,seed,value:await askNumber(L('시드 값','Seed','シード値','種子值'),0,4294967295)};}
    if(type==='score'){const score=['dojo','challenge'][await choose(L('점수','Score','スコア','分數'),[L('도장 점수','Dojo','道場スコア','道場分數'),L('챌린지 배틀 점수','Challenge battle','チャレンジバトルスコア','挑戰戰分數')])];return {type,score,value:await askNumber(L('점수','Score','スコア','分數'),0,2147483647)};}
    return {type};
  }
  // Every Max Account part the owner allows (the web editor's default selection).
  async function maxAccount(){return {type:'max_account',components:maxAccountComponents(policy),mapCategories:[]};}
  const SECTIONS=[
    [L('아이템 (통조림, XP, 티켓...)','Items (Cat Food, XP, tickets...)','アイテム (ネコカン、XP、チケット...)','道具（貓罐頭、XP、轉蛋券...）'),itemsMenu,{type:'item'}],
    [L('보관함 (캣츠아이, 드링크, 개다래...)','Inventory (Catseyes, Catamins, Catfruit...)','所持品 (ネコの目、ネコビタン、マタタビ...)','持有物品（貓眼石、貓薄荷飲料、木天蓼...）'),inventory,{type:'inventory'}],
    [L('고양이 (선택해서 해금·진화·레벨·본능...)','Cats (pick cats: unlock, forms, levels, talents...)','キャラ (選んで: 入手・進化・レベル・本能...)','角色（選擇後: 取得、進化、等級、本能...）'),cats,{type:'cat',operation:'unlock'}],
    [L('스토리 (클리어·보물·좀비·스코어)','Story (clears, treasures, outbreaks, scores)','ストーリー (クリア・お宝・ゾンビ・スコア)','故事（通關、寶物、殭屍、分數）'),storyMenu,{type:'story_clear'}],
    [L('스테이지 맵 (레전드·이벤트·콜라보...)','Stage maps (Legend, event, collab...)','ステージマップ (レジェンド・イベント・コラボ...)','關卡地圖（傳說、活動、合作...）'),maps,{type:'map'}],
    [L('수집 (특수능력, 메달, 본능 구슬...)','Collections (skills, medals, talent orbs...)','収集 (特殊能力・メダル・本能玉...)','收集（特殊能力、勳章、本能玉...）'),collections,{type:'collection',collection:'talent_orbs'}],
    [L('가마토토 · 오토토 · 고양이 신사','Gamatoto, Ototo, Cat Shrine','ガマトト・オトート・ネコ神社','喵喵探險隊・弟弟・貓咪神社'),expedition,{type:'expedition'}],
    [L('기타 (편성 슬롯, 1억 티켓...)','Other (lineup slots, 100M tickets...)','その他 (編成スロット・1億チケット...)','其他（編成欄位、1 億轉蛋券...）'),extras,{type:'extra'}],
    [L('계정 · 복구 (플레이 시간, 시드, 오류 복구...)','Account and fixes (play time, seed, repairs...)','アカウント・修復 (プレイ時間・シード・不具合修復...)','帳號・修復（遊玩時間、種子、錯誤修復...）'),account,{type:'simple',operation:'fix_time_errors'}],
    [L('전부 최대 (Max All)','Max All','すべて最大 (Max All)','全部最大 (Max All)'),async()=>({type:'max_all'}),{type:'max_all'}],
    [L('계정 최대 (Max Account)','Max Account','アカウント最大 (Max Account)','帳號最大 (Max Account)'),maxAccount,{type:'max_account'}],
  ];
  const sections=()=>SECTIONS.filter(([, ,probe])=>probe.type==='item'||probe.type==='inventory'?allowed(probe):probe.type==='collection'?COLLECTIONS.some(c=>allowed({type:'collection',collection:c})):probe.type==='simple'?true:allowed(probe));
  // One edit chosen through the menus, or null when the person backs out.
  // Backing out inside a section (a BACK error from any prompt) returns to this list; backing out here goes further up.
  async function pick(){
    for(;;){
      const list=sections();const i=await choose(L('무엇을 바꿀까요?','What to change?','何を変更しますか？','要變更什麼？'),list.map(s=>s[0]));
      let edit;
      try{edit=await list[i][1]();}
      catch(err){if(err?.code!=='BACK')throw err;say(L('돌아갑니다. 아무것도 바꾸지 않았습니다.','Back. Nothing was changed.','戻ります。何も変更していません。','返回。沒有做任何變更。'));continue;}
      if(edit&&[].concat(edit).some(e=>!allowed(e)))throw new Error(L('관리자가 이 기능을 꺼 두었습니다.','This feature is turned off by an administrator.','この機能は管理者により無効になっています。','此功能已被管理員關閉。'));
      return edit;
    }
  }
  function describe(e){
    const n=v=>typeof v==='number'?v.toLocaleString():String(v);
    if(e.type==='item'){const before=items.itemValues(save)[e.item];return Number.isFinite(before)&&before!==e.value?`${label(e.item)} ${n(before)} → ${n(e.value)}`:`${label(e.item)} = ${n(e.value)}`;}
    if(e.type==='cat')return `${L('고양이','Cats','キャラ','角色')} ${e.catIds.length}${L('마리','','体','隻')} · ${label(e.operation)}${e.base!==undefined?` Lv${e.base}+${e.plus}`:''}${e.amount!==undefined?` ${n(e.amount)}`:''}`;
    if(e.type==='inventory')return `${label(e.inventory)} ${e.ids.length}${L('종','','種','種')} = ${n(e.value)}`;
    if(['story_clear','treasures','outbreaks','timed_scores'].includes(e.type))return `${label(e.type)} · ${e.chapters.length}${L('챕터',' chapters','章',' 章')} · ${e.mode==='whole'?L('전체 스테이지','all stages','全ステージ','全部關卡'):`${e.stages.length}${L('스테이지',' stages','ステージ',' 個關卡')}`} = ${n(e.value)}`;
    if(e.type==='map'||e.type==='map_batch')return `${label(e.category)} · ${e.mapIds.length===1?e.mapName:`${e.mapIds.length}${L('개 맵',' maps','マップ',' 張地圖')}`} · ${e.clear?`${L('클리어','clear','クリア','通關')} ${n(e.amount)}`:L('미클리어','not cleared','未クリア','未通關')}`;
    if(e.type==='collection')return `${label(e.collection)} ${e.ids.length}${L('개','','個','個')} · ${e.actionLabel||(e.base!==undefined?`Lv${e.base}+${e.plus}`:n(e.value))}`;
    if(e.type==='expedition')return `${label(e.operation)}${e.value!==undefined?` = ${n(e.value)}`:''}`;
    if(e.type==='extra')return label(e.operation)+(e.value!==undefined?` = ${n(e.value)}`:'');
    if(e.type==='simple')return label(e.operation);
    if(e.type==='playtime')return `${label('playtime')} ${e.hours}:${String(e.minutes).padStart(2,'0')}:${String(e.seconds).padStart(2,'0')}`;
    if(e.type==='gacha_seed'||e.type==='score')return `${label(e.type)} ${e.seed||e.score} = ${n(e.value)}`;
    return label(e.type);
  }
  return {pick,describe,allowed,itemRows,label};
}
module.exports={createMenus,parseNumbers,EN,MAX_WORDS};

},
"tools/local/cli.js":function(module,exports,require){
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// canbot.js - CanBot's local editor. Runs on Termux (Android) or any computer with Node.js 18+:
//   pkg install nodejs        (Termux; nothing else is needed)
//   curl -O https://canbot.dev/local/canbot.js && node canbot.js
// It edits SAVEs with CanBot's JS SAVE engine on the member's own device:
//   - transfer codes: download from PONOS, edit, upload, show the new codes (CanBot's own PONOS client, no retry);
//   - SAVE file: a rooted phone or emulator, the game's own SAVE_DATA file (a backup is kept first);
//   - adb: a phone or emulator connected to a computer (root on the device);
//   - restore: any backup in ~/.canbot/backups back to PONOS, a file or a device.
// A token from canbot.dev/local is needed. canbot.dev checks it on every run, provides the game data, and counts the
// SAVE in the same allowance as Discord and the website. No SAVE, transfer code or edit value is sent to canbot.dev.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const readline=require('node:readline/promises');
const engine=require('../../src/canbot-engine/index');
const {GameData}=require('../../src/canbot-engine/gamedata');
const {read:readPack}=require('../../src/canbot-engine/gamedata-pack');
const {applyEdits}=require('../../src/canbot-engine/apply');
const {createPonos}=require('../../src/canbot-engine/ponos');
const {createMenus,MAX_WORDS}=require('./menus');

const CLIENT=1;
const SERVER=(process.env.CANBOT_SERVER||'https://canbot.dev').replace(/\/+$/,'');
const HOME=process.env.CANBOT_HOME||path.join(os.homedir(),'.canbot');
const CONFIG=path.join(HOME,'config.json');
const REGIONS=['kr','en','jp','tw'];
const PACKAGE={kr:'jp.co.ponos.battlecatskr',en:'jp.co.ponos.battlecatsen',jp:'jp.co.ponos.battlecats',tw:'jp.co.ponos.battlecatstw'};
const ITEMS=['catfood','xp','normal_tickets','rare_tickets','platinum_tickets','legend_tickets','platinum_shards','np','leadership'];
const ITEM_NAMES={catfood:['통조림','Cat Food'],xp:['XP','XP'],normal_tickets:['냥코 티켓','Cat Tickets'],rare_tickets:['레어 티켓','Rare Tickets'],platinum_tickets:['플래티넘 티켓','Platinum Tickets'],
  legend_tickets:['레전드 티켓','Legend Tickets'],platinum_shards:['플래티넘 조각','Platinum Shards'],np:['NP','NP'],leadership:['리더십','Leadership']};

let lang='ko',rl=null;
// Korean, English, Japanese, Traditional Chinese (tools/local/translations.txt fills the last two via i18n.js).
const L=(ko,en,ja,zh)=>lang==='ko'?ko:lang==='ja'?(ja??en):lang==='zh'?(zh??en):en;
const say=(...a)=>console.log(...a);
const fail=(code,message)=>Object.assign(new Error(message),{code});

// ---------- small helpers ----------
function loadConfig(){try{return JSON.parse(fs.readFileSync(CONFIG,'utf8'))||{};}catch{return {};}}
function saveConfig(c){fs.mkdirSync(HOME,{recursive:true,mode:0o700});fs.writeFileSync(CONFIG,JSON.stringify(c,null,1),{mode:0o600});}
// Typing one of these at any prompt backs out of the current step without changing anything: a section goes back to
// the list of sections, that list to the pending edits, the pending edits to the SAVE source menu (nothing uploaded),
// and the first menu quits. No prompt runs inside the upload step, so backing out never interrupts an upload.
const BACK_WORDS=new Set(['exit','back','뒤로','취소','戻る','返回']);
const isBack=err=>err?.code==='BACK';
async function ask(q){const a=(await rl.question(q)).trim();if(BACK_WORDS.has(a.toLowerCase()))throw fail('BACK','back');return a;}
const backed=()=>say(L('돌아갑니다. 아무것도 바꾸지 않았습니다.','Back. Nothing was changed.','戻ります。何も変更していません。','返回。沒有做任何變更。'));
// Numbered choices; 0 goes back a step (the same as typing exit).
// backLabel: what 0 says (the first menu: Quit).
async function choose(title,options,backLabel=null){
  say('');say(title);options.forEach((o,i)=>say(`  ${i+1}) ${o}`));say(`  0) ${backLabel||L('← 돌아가기','← Back','← 戻る','← 返回')}`);
  for(;;){const a=await ask('> ');if(a==='0')throw fail('BACK','back');const n=Number(a);if(Number.isInteger(n)&&n>=1&&n<=options.length)return n-1;say(L('번호를 입력하세요.','Enter a number.','番号を入力してください。','請輸入編號。'));}
}
const fmt=v=>Number(v).toLocaleString('en-US');
// A number in min..max; max (or all, 최대...) gives the highest value. current: shown when known.
async function askNumber(q,min,max,{current}={}){
  const now=Number.isFinite(current)?L(`현재 ${fmt(current)} · `,`now ${fmt(current)} · `,`現在 ${fmt(current)} · `,`目前 ${fmt(current)} · `):'';
  for(;;){const a=(await ask(`${q} (${now}${fmt(min)}~${fmt(max)}, max): `)).replace(/,/g,'');if(MAX_WORDS.has(a.toLowerCase()))return max;const n=Number(a);if(Number.isSafeInteger(n)&&n>=min&&n<=max)return n;say(L('범위 안의 숫자 또는 max를 입력하세요.','Enter a number in range, or max.','範囲内の数字か max を入力してください。','請輸入範圍內的數字或 max。'));}
}
async function yes(q){const a=(await ask(`${q} (y/n): `)).toLowerCase();return ['y','yes','ㅛ','예','네','はい','是','好'].includes(a);}
function stamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
// The config file's settings (language, token, presets, backupKeep, extendedLimits), set by main().
let prefs={};
// Backups are named "<time>-<region>-<what>", so names sort oldest first. With a backupKeep setting only the newest
// that many are kept; a "not-confirmed" backup (upload result unknown) is never removed, nor the one just written.
const BACKUP_KEEP=[0,10,30,100];
function pruneBackups(dir,keep,justWritten){
  if(!Number.isSafeInteger(keep)||keep<=0)return 0;
  let files=[];try{files=fs.readdirSync(dir).filter(f=>/^\d{4}-\d\d-\d\dT/.test(f)).sort();}catch{return 0;}
  let removed=0;
  for(const f of files.slice(0,Math.max(0,files.length-keep))){
    if(f.includes('-not-confirmed')||path.join(dir,f)===justWritten)continue;
    try{fs.rmSync(path.join(dir,f),{force:true});removed++;}catch{}
  }
  return removed;
}
function backup(name,bytes){const dir=path.join(HOME,'backups');fs.mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,`${stamp()}-${name}`);fs.writeFileSync(file,bytes,{mode:0o600});pruneBackups(dir,prefs.backupKeep,file);return file;}

// ---------- canbot.dev ----------
async function api(token,method,route,body){
  let res;
  try{res=await fetch(`${SERVER}${route}`,{method,headers:{authorization:`Bearer ${token}`,'x-canbot-lang':lang,'content-type':'application/json','user-agent':`canbot-local/${CLIENT}`},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});}
  catch{throw fail('OFFLINE',L('canbot.dev에 연결할 수 없습니다. 인터넷 연결을 확인하세요.','Cannot reach canbot.dev. Check your internet connection.','canbot.devに接続できません。インターネット接続を確認してください。','無法連線到 canbot.dev。請確認網路連線。'));}
  if(!res.ok){let j={};try{j=await res.json();}catch{}throw fail(j.code||`HTTP_${res.status}`,j.error||`HTTP ${res.status}`);}
  return res;
}
async function login(config){
  for(;;){
    if(!config.token){
      say(L('\n로컬 에디터 토큰이 필요합니다. canbot.dev/local 에서 디스코드로 로그인해 토큰을 받으세요.','\nA local editor token is needed. Sign in with Discord at canbot.dev/local to get one.','\nローカルエディターのトークンが必要です。canbot.dev/local でDiscordにログインして取得してください。','\n需要本機編輯器的權杖。請到 canbot.dev/local 以 Discord 登入取得。'));
      config.token=await ask(L('토큰 붙여넣기: ','Paste token: ','トークンを貼り付け: ','貼上權杖: '));if(!config.token)continue;
    }
    try{const hello=await (await api(config.token,'POST','/api/local/cli/hello',{client:CLIENT})).json();saveConfig(config);return hello;}
    catch(err){
      if(err.code==='LOCAL_TOKEN_INVALID'){say(L('토큰이 올바르지 않거나 회수되었습니다.','This token is not valid or was revoked.','このトークンは無効か、取り消されています。','此權杖無效或已被撤銷。'));config.token='';saveConfig(config);continue;}
      throw err;
    }
  }
}
// Game data stays one packed file per version (~/.canbot/gamedata/<region>/<version>.cbgd.gz) and is read in memory:
// nothing is unpacked, so the first run does not write ten thousand small files.
async function gameData(token,cc,version,hello){
  const file=path.join(HOME,'gamedata',cc,`${version}.cbgd.gz`),open=buf=>new GameData(path.join(HOME,'gamedata',cc,version),readPack(buf));
  if(fs.existsSync(file)){try{return open(fs.readFileSync(file));}catch{fs.rmSync(file,{force:true});}}
  if(!(hello.versions?.[cc]||[]).includes(version))throw fail('NO_GAME_DATA',L(`${cc.toUpperCase()} ${version} 게임 데이터가 아직 없습니다. 깡통봇에 새 버전이 들어오면 사용할 수 있습니다.`,`There is no game data for ${cc.toUpperCase()} ${version} yet. It becomes available when CanBot adds the version.`,`${cc.toUpperCase()} ${version} のゲームデータはまだありません。CanBotがこのバージョンに対応すると使えるようになります。`,`${cc.toUpperCase()} ${version} 的遊戲資料尚未提供。CanBot 支援此版本後即可使用。`));
  say(L(`게임 데이터 받는 중 (${cc.toUpperCase()} ${version})...`,`Downloading game data (${cc.toUpperCase()} ${version})...`,`ゲームデータをダウンロード中 (${cc.toUpperCase()} ${version})...`,`正在下載遊戲資料 (${cc.toUpperCase()} ${version})...`));
  const res=await api(token,'GET',`/api/local/cli/gamedata?cc=${cc}&v=${encodeURIComponent(version)}`);
  const buf=Buffer.from(await res.arrayBuffer());
  let gd;try{gd=open(buf);}catch{throw fail('GAME_DATA',L('게임 데이터가 손상되었습니다. 다시 실행해 주세요.','The game data download was damaged. Run again.','ゲームデータが破損しています。もう一度実行してください。','遊戲資料已損毀。請重新執行。'));}
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(`${file}.tmp`,buf);fs.renameSync(`${file}.tmp`,file);
  return gd;
}

// ---------- SAVE sources ----------
// Each PONOS request is printed with its time while the person waits for one (receiving or uploading a SAVE); the
// credentials fetched in the background while they edit stay quiet.
const steps={on:false};
const STEP_NAMES={RECEIVE:['SAVE 받기','Receive the SAVE','セーブの受け取り','接收存檔'],TOKEN:['인증','Sign-in','認証','驗證'],PASSWORD:['계정 확인','Account check','アカウント確認','帳號確認'],
  SAVE_KEY:['저장 키','Save key','保存キー','儲存金鑰'],UPLOAD:['SAVE 전송','Send the SAVE','セーブの送信','傳送存檔'],MANAGED_ITEMS:['아이템 변경 신고','Report item changes','アイテム変更の報告','回報道具變更'],TRANSFER:['인계 코드 발급','Issue transfer codes','引き継ぎコードの発行','發行引繼碼']};
function showStep({step,ms,status}){
  if(!steps.on)return;const n=STEP_NAMES[step]||[step,step,step,step];
  say(`  - ${L(...n)} ${(ms/1000).toFixed(1)}${L('초','s','秒','秒')}${status&&status<400?'':` (${status||L('응답 없음','no answer','応答なし','無回應')})`}`);
}
const ponos=createPonos({timeoutMs:60000,onStep:showStep});
// PONOS credentials of one account, kept on this device only (~/.canbot/accounts, 0600) and reused while valid.
function accountStore(code){
  const dir=path.join(HOME,'accounts'),file=path.join(dir,`${crypto.createHash('sha256').update(String(code)).digest('hex').slice(0,24)}.json`);
  return {get(){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}},
    set(v){fs.mkdirSync(dir,{recursive:true,mode:0o700});const tmp=`${file}.tmp`;fs.writeFileSync(tmp,JSON.stringify(v),{mode:0o600});fs.renameSync(tmp,file);}};
}
const codeOf=save=>String(save.data.inquiryCode);
async function fromTransferCodes(cc,hello){
  say(L('\n인계 코드는 업로드할 때 새 코드로 바뀝니다. 업로드하기 전에 나가면 같은 코드를 게임에서 그대로 쓸 수 있습니다.','\nThe transfer codes change only when you upload. If you leave before uploading, the same codes still work in the game.','\n引き継ぎコードはアップロードしたときだけ新しくなります。アップロード前に終了すれば、同じコードをゲームでそのまま使えます。','\n引繼碼只會在上傳時更換。在上傳前離開的話，同一組代碼仍可在遊戲中使用。'));
  const code=(await ask(L('인계 코드: ','Transfer code: ','引き継ぎコード: ','引繼碼: '))).replace(/\s+/g,'').toLowerCase();
  const pin=(await ask(L('인증 번호: ','Confirmation code: ','認証番号: ','認證碼: '))).replace(/\s+/g,'');
  if(!/^[0-9a-z]{9}$/.test(code)||!/^\d{4}$/.test(pin))throw fail('CODES',L('인계 코드는 9자리, 인증 번호는 4자리 숫자입니다.','The transfer code has 9 characters and the confirmation code 4 digits.','引き継ぎコードは9文字、認証番号は4桁の数字です。','引繼碼為 9 個字元，認證碼為 4 位數字。'));
  const version=hello.latest?.[cc];if(!version)throw fail('NO_GAME_DATA',L('이 지역은 아직 지원하지 않습니다.','This region is not supported yet.','この地域にはまだ対応していません。','尚未支援此地區。'));
  say(L('PONOS 서버에서 SAVE 받는 중...','Downloading the SAVE from PONOS...','PONOSサーバーからセーブを取得中...','正在從 PONOS 伺服器取得存檔...'));
  // PONOS takes the numeric game version ("15.7.0" -> 150700).
  const [a,b,c]=version.split('.').map(Number);
  let got;steps.on=true;try{got=await ponos.receive(code,pin,cc,a*10000+b*100+c);steps.on=false;}
  catch(err){steps.on=false;if(err.code==='NO_CONNECTION')throw fail('PONOS_OFFLINE',L('PONOS 서버에 연결할 수 없습니다.','Cannot reach the PONOS server.','PONOSサーバーに接続できません。','無法連線到 PONOS 伺服器。'));throw fail('CODES',L('코드가 맞지 않거나 이미 사용된 코드입니다. 게임에서 새 코드를 발급받으세요.','The codes are wrong or already used. Issue new codes in the game.','コードが違うか、すでに使われています。ゲームで新しいコードを発行してください。','代碼錯誤或已被使用。請在遊戲中重新發行代碼。'));}
  const file=backup(`${cc}-received.sav`,got.bytes);
  say(L(`받은 SAVE 백업: ${file}`,`Received SAVE backed up to: ${file}`,`受け取ったセーブのバックアップ: ${file}`,`已備份收到的存檔: ${file}`));
  return {kind:'codes',cc,raw:got.bytes,received:got};
}
const q=s=>`'${String(s).replace(/'/g,"'\\''")}'`;
function readRooted(file){
  try{return fs.readFileSync(file);}catch(err){if(err.code!=='EACCES'&&err.code!=='EPERM')throw err;}
  return execFileSync('su',['-c',`cat ${q(file)}`],{maxBuffer:64*1024*1024});
}
function writeRooted(file,bytes){
  try{fs.writeFileSync(file,bytes);return;}catch(err){if(err.code!=='EACCES'&&err.code!=='EPERM')throw err;}
  // Overwrite in place through su so the file keeps the game's owner and permissions.
  const tmp=path.join(HOME,'tmp');fs.mkdirSync(tmp,{recursive:true,mode:0o700});const t=path.join(tmp,'SAVE_DATA');fs.writeFileSync(t,bytes,{mode:0o644});
  try{execFileSync('su',['-c',`cat ${q(t)} > ${q(file)}`]);}finally{fs.rmSync(t,{force:true});}
}
async function fromFile(cc){
  const guess=`/data/data/${PACKAGE[cc]}/files/SAVE_DATA`;
  say(L(`\nSAVE 파일 경로 (Enter = ${guess})`,`\nSAVE file path (Enter = ${guess})`,`\nセーブファイルのパス (Enter = ${guess})`,`\n存檔檔案路徑 (Enter = ${guess})`));
  const file=(await ask('> '))||guess;
  say(L('게임을 완전히 종료한 상태에서 진행하세요.','Close the game completely before continuing.','ゲームを完全に終了してから続けてください。','請先完全關閉遊戲再繼續。'));
  let raw;try{raw=readRooted(file);}catch{throw fail('FILE',L('파일을 읽을 수 없습니다. 경로와 루트 권한(su)을 확인하세요.','Cannot read the file. Check the path and root (su) access.','ファイルを読めません。パスとroot(su)権限を確認してください。','無法讀取檔案。請確認路徑與 root (su) 權限。'));}
  const saved=backup(`${cc}-SAVE_DATA`,raw);
  say(L(`원본 백업: ${saved}`,`Original backed up to: ${saved}`,`元のセーブのバックアップ: ${saved}`,`已備份原始存檔: ${saved}`));
  return {kind:'file',cc,raw,file};
}
// A phone or emulator connected to this computer with adb (root needed to reach the game's files).
const adb=(serial,args,opts={})=>execFileSync('adb',[...(serial?['-s',serial]:[]),...args],{maxBuffer:64*1024*1024,...opts});
function adbRoot(serial,command){
  try{return adb(serial,['exec-out','su','-c',command]);}catch{return adb(serial,['exec-out','sh','-c',command]);}
}
async function fromAdb(cc){
  let devices;try{devices=adb(null,['devices']).toString().split('\n').slice(1).map(l=>l.trim().split(/\s+/)).filter(p=>p[1]==='device').map(p=>p[0]);}
  catch{throw fail('ADB',L('adb를 찾을 수 없습니다. Android platform-tools를 설치하고 PATH에 추가하세요.','adb was not found. Install Android platform-tools and add it to PATH.','adbが見つかりません。Android platform-toolsをインストールしてPATHに追加してください。','找不到 adb。請安裝 Android platform-tools 並加入 PATH。'));}
  if(!devices.length)throw fail('ADB',L('연결된 기기가 없습니다. USB 디버깅(에뮬레이터는 ADB 연결)을 켜세요.','No device is connected. Turn on USB debugging (ADB on emulators).','接続された端末がありません。USBデバッグ(エミュレーターはADB接続)を有効にしてください。','沒有連接的裝置。請開啟 USB 偵錯（模擬器請開啟 ADB 連線）。'));
  const serial=devices.length===1?devices[0]:devices[await choose(L('기기 선택','Choose a device','端末を選択','選擇裝置'),devices)];
  const pkg=PACKAGE[cc],file=`/data/data/${pkg}/files/SAVE_DATA`;
  if(await yes(L('게임을 종료할까요? (권장)','Close the game now? (recommended)','ゲームを終了しますか？(推奨)','要關閉遊戲嗎？（建議）'))){try{adb(serial,['shell','am','force-stop',pkg]);}catch{}}
  let raw;try{raw=adbRoot(serial,`cat ${q(file)}`);}catch{raw=null;}
  if(!raw||raw.length<1000)throw fail('ADB',L('SAVE를 읽을 수 없습니다. 기기의 루트 권한(su)과 게임 설치를 확인하세요.','Cannot read the SAVE. Check root (su) on the device and that the game is installed.','セーブを読めません。端末のroot(su)権限とゲームのインストールを確認してください。','無法讀取存檔。請確認裝置的 root (su) 權限與遊戲是否已安裝。'));
  const saved=backup(`${cc}-adb-SAVE_DATA`,raw);
  say(L(`원본 백업: ${saved}`,`Original backed up to: ${saved}`,`元のセーブのバックアップ: ${saved}`,`已備份原始存檔: ${saved}`));
  return {kind:'adb',cc,raw,serial,file,pkg};
}
function writeAdb(source,bytes){
  const tmp=path.join(HOME,'tmp');fs.mkdirSync(tmp,{recursive:true,mode:0o700});const t=path.join(tmp,'SAVE_DATA');fs.writeFileSync(t,bytes,{mode:0o600});
  const remote='/data/local/tmp/canbot_SAVE_DATA';
  try{adb(source.serial,['push',t,remote],{stdio:'ignore'});adbRoot(source.serial,`cat ${remote} > ${q(source.file)}; rm -f ${remote}`);}finally{fs.rmSync(t,{force:true});}
  return adbRoot(source.serial,`cat ${q(source.file)}`);
}
// A SAVE from ~/.canbot/backups, written back to a file or device, or uploaded for new codes.
async function fromBackup(cc){
  const dir=path.join(HOME,'backups');let files=[];try{files=fs.readdirSync(dir).filter(f=>f.includes(`-${cc}-`)).sort().reverse().slice(0,20);}catch{}
  if(!files.length)throw fail('BACKUP',L('이 지역의 백업이 없습니다.','There are no backups for this region.','この地域のバックアップはありません。','此地區沒有備份。'));
  const name=files[await choose(L('복원할 백업 (최근 20개)','Backup to restore (newest 20)','復元するバックアップ (新しい順20件)','要還原的備份（最新 20 個）'),files)];
  const raw=fs.readFileSync(path.join(dir,name));
  const to=await choose(L('어디로 복원할까요?','Restore to?','どこに復元しますか？','要還原到哪裡？'),[L('PONOS에 올려 새 인계 코드 받기','Upload to PONOS for new transfer codes','PONOSにアップロードして新しい引き継ぎコードを受け取る','上傳到 PONOS 並取得新的引繼碼'),L('SAVE 파일 (루팅 기기)','SAVE file (rooted device)','セーブファイル (root端末)','存檔檔案（已 root 的裝置）'),L('adb로 연결한 기기','Device over adb','adbで接続した端末','透過 adb 連接的裝置')]);
  if(to===0)return {kind:'codes',cc,raw,restored:true};
  if(to===1){const f=await fromFile(cc);return {...f,raw,restored:true};}
  const a=await fromAdb(cc);return {...a,raw,restored:true};
}

// ---------- edits ----------
// The owner's limits on values a person types (the same rules the CanBot service applies). 0 = no limit.
function ownerLimitCheck(limits,edits){
  const over=(name,max)=>fail('OWNER_LIMIT',L(`${name}은(는) 최대 ${max.toLocaleString()}까지 설정할 수 있습니다.`,`${name} can be set up to ${max.toLocaleString()}.`,`${name}は最大${max.toLocaleString()}まで設定できます。`,`${name}最多可設定為 ${max.toLocaleString()}。`));
  for(const e of edits){
    if(e.type==='item'){const max=Number(limits?.items?.[e.item]||0);if(max&&e.value>max)throw over(ITEM_NAMES[e.item][lang==='en'?1:0],max);}
    if(e.type==='cat'&&e.operation==='set_level'){
      const base=Number(limits?.catBase||0),plus=Number(limits?.catPlus||0);
      if(base&&e.base>base)throw over(L('기본 레벨','Base level','基本レベル','基本等級'),base);if(plus&&e.plus>plus)throw over(L('플러스 레벨','Plus level','プラスレベル','加值等級'),plus);
    }
    if(e.type==='cat'&&['upgrade_by','storage_add'].includes(e.operation)){const max=Number(limits?.catUpgradeAmount||100000);if(e.amount>max)throw over(L('개수','Amount','数','數量'),max);}
  }
}
const PENDING_MAX=100;
// Pending edits: add through the menus (each one is tried on a fresh copy of the SAVE right away, so a problem shows
// before saving), remove one, clear, save or quit.
// kept: edits from an earlier pass (backing out of the final "save?" question returns here with them).
// Extended limits (item and clear-count limits become the field's range) need both the member's role (the server says
// so in hello.access) and the member's own setting. The owner's caps (hello.limits) apply either way.
const extendedOn=hello=>prefs.extendedLimits===true&&hello?.access?.canUseExtendedLimits===true;
const editSettings=extended=>extended?{disable_item_maxes:true}:{};
// Presets: named lists of edits kept in the config file and added to the pending edits in one step. Each edit of a
// preset goes through the same checks as one picked from the menus (feature switches, owner caps, a trial on the SAVE).
const PRESET_MAX=20,PRESET_NAME_MAX=30;
const presets=()=>Array.isArray(prefs.presets)?prefs.presets.filter(p=>p&&typeof p.name==='string'&&Array.isArray(p.edits)):[];
function savePresets(list,config){config.presets=list.slice(0,PRESET_MAX);saveConfig(config);}
// Item names typed directly at the pending edits prompt ("통조림 45000", "xp max", "레어 299 플티 max"), besides the
// menu labels in the chosen language. Spaces, case, "_" and "-" do not matter.
const ITEM_ALIASES={catfood:['통조림','캔','고양이캔','cf','food','catfood','ネコカン','猫缶','貓罐頭'],xp:['xp','exp','경험치','가마토토xp'],
  normal_tickets:['냥코티켓','일반티켓','노멀티켓','nt','normal','normaltickets','cattickets','ネコチケット','貓咪券'],rare_tickets:['레어티켓','레어','rt','rare','raretickets','レアチケット','稀有券'],
  platinum_tickets:['플래티넘티켓','플티','pt','platinum','platinumtickets','プラチナチケット','白金券'],legend_tickets:['레전드티켓','레전드','lt','legend','legendtickets','レジェンドチケット','傳說券'],
  platinum_shards:['플래티넘조각','플조','조각','shards','platinumshards','プラチナのかけら','白金碎片'],np:['np'],leadership:['리더십','ld','leadership','リーダーシップ','統率力']};
const MAX_ALL_WORDS=new Set(['maxall','전부최대','모두최대','すべて最大','全部最大']);
const normName=s=>String(s).toLowerCase().replace(/[\s_\-·]/g,'');
// null: not a direct command. {error}: a direct command with a problem. {edits}: item edits.
function parseDirect(text,rows,label){
  const t=String(text).trim();if(!t)return null;
  if(MAX_ALL_WORDS.has(normName(t)))return {edits:[{type:'max_all'}]};
  const byName=new Map();for(const r of rows)for(const a of [...(ITEM_ALIASES[r.name]||[]),r.name,label(r.name)])byName.set(normName(a),r);
  const re=/([^\d\s,][^\d]*?)\s*(max|all|최대|전부|最大|全部|すべて|\d[\d,]*)(?=\s|$)/gi,found=[];let m;
  while((m=re.exec(t)))found.push(m);
  if(!found.length||t.replace(re,'').trim())return null;
  const edits=[];
  for(const [,name,raw] of found){
    const r=byName.get(normName(name));if(!r)return {error:L(`"${name.trim()}"은(는) 아이템 이름이 아닙니다.`,`"${name.trim()}" is not an item name.`,`「${name.trim()}」はアイテム名ではありません。`,`「${name.trim()}」不是道具名稱。`)};
    const v=MAX_WORDS.has(raw.toLowerCase())?r.max:Number(raw.replace(/,/g,''));
    if(!Number.isSafeInteger(v)||v<0||v>r.max)return {error:L(`${label(r.name)}은(는) 0~${fmt(r.max)}까지입니다.`,`${label(r.name)} goes from 0 to ${fmt(r.max)}.`,`${label(r.name)}は0~${fmt(r.max)}までです。`,`${label(r.name)} 的範圍是 0~${fmt(r.max)}。`)};
    edits.push({type:'item',item:r.name,value:v});
  }
  return {edits};
}
// Engine error codes in the chosen language; anything else keeps its own message.
function explain(err){
  const range=/between (\d+) and (\d+)/.exec(String(err?.message||''));
  const code=String(err?.code||'');
  if(range&&['ITEM_VALUE_OUT_OF_RANGE','INVALID_INPUT'].includes(code))return L(`값은 ${fmt(range[1])}~${fmt(range[2])} 사이여야 합니다.`,`The value must be from ${fmt(range[1])} to ${fmt(range[2])}.`,`値は${fmt(range[1])}~${fmt(range[2])}の範囲で入力してください。`,`數值必須介於 ${fmt(range[1])}~${fmt(range[2])}。`);
  const levels=L('그 레벨까지 올릴 수 없는 고양이가 있습니다.','Some cats cannot reach that level.','そのレベルまで上げられないキャラがいます。','有角色無法提升到該等級。');
  const known={
    ITEM_UNSUPPORTED_VERSION:L('이 게임 버전에는 없는 항목입니다.','This game version does not have this item.','このゲームバージョンにはない項目です。','此遊戲版本沒有這個項目。'),
    STORAGE_CAPACITY:L('보관함 칸이 부족합니다.','There is not enough storage space.','ネコ部屋(保管庫)の空きが足りません。','保管庫空間不足。'),
    CAT_LEVEL_LIMIT:levels,CAT_LEVEL_UNREACHABLE:levels,
    CAT_FORM_UNSUPPORTED:L('그 형태가 없는 고양이가 있습니다.','Some cats do not have that form.','その形態がないキャラがいます。','有角色沒有該型態。'),
    ACCOUNT_REGION_MISMATCH:L('SAVE 지역이 맞지 않습니다.','The SAVE is from another region.','セーブの地域が合いません。','存檔地區不符。'),
  };
  if(known[code])return known[code];
  if(/^STORY_/.test(code))return L('이 SAVE의 스토리 구조에서는 쓸 수 없습니다.','This does not fit the story data of this SAVE.','このセーブのストーリーデータでは使えません。','此存檔的故事資料無法使用。');
  return err?.message||String(err);
}
const HELP_KO=[
  '명령',
  '  Enter          편집 추가 (메뉴에서 고르기, 다 고르면 0)',
  '  통조림 45000    바로 입력. 여러 개도 됨: 레어 299 플티 max',
  '  maxall         전부 최대',
  '  s              저장하기',
  '  p / p+         프리셋 불러오기 / 지금 편집을 프리셋으로 저장',
  '  d 2            2번 편집 지우기 (d만 쓰면 번호를 물어봄)',
  '  c              편집 목록 비우기',
  '  0 또는 q       저장하지 않고 나가기',
  '  숫자를 묻는 곳에서는 max 를 쓰면 최대값이 들어갑니다.'].join('\n');
const HELP_EN=[
  'Commands',
  '  Enter            add an edit (pick from the menus; 0 when done)',
  '  catfood 45000    type it directly; several work too: rare 299 platinum max',
  '  maxall           Max All',
  '  s                save',
  '  p / p+           load a preset / save these edits as a preset',
  '  d 2              remove edit 2 (d alone asks which)',
  '  c                clear all edits',
  '  0 or q           quit without saving',
  '  At any number prompt, max enters the highest value.'].join('\n');
const HELP_JA=[
  'コマンド',
  '  Enter            編集を追加 (メニューから選ぶ。終わったら 0)',
  '  ネコカン 45000    直接入力。複数も可: レア 299 プラチナ max',
  '  maxall           すべて最大',
  '  s                保存',
  '  p / p+           プリセットを読み込む / この編集をプリセットとして保存',
  '  d 2              2番の編集を削除 (d だけなら番号を聞きます)',
  '  c                編集をすべて削除',
  '  0 または q       保存せずに終了',
  '  数字を聞かれたところで max と入力すると最大値になります。'].join('\n');
const HELP_ZH=[
  '指令',
  '  Enter            新增編輯（從選單選擇，完成後輸入 0）',
  '  貓罐頭 45000      直接輸入。也可以一次多個: 稀有券 299 白金券 max',
  '  maxall           全部最大',
  '  s                儲存',
  '  p / p+           載入預設 / 將目前的編輯存為預設',
  '  d 2              刪除第 2 項編輯（只輸入 d 會詢問編號）',
  '  c                清除所有編輯',
  '  0 或 q           不儲存並離開',
  '  在要求輸入數字的地方輸入 max 即為最大值。'].join('\n');
async function editMenu(source,save,gd,hello,names=null,kept=[],config=prefs){
  const extended=extendedOn(hello);
  const menus=createMenus({ui:{say,ask,choose,askNumber,yes,L,lang:()=>lang},save,gd,names,policy:hello.policy||{},access:hello.access||{},limits:hello.limits||{},extended});
  const edits=[...kept];
  // Edits picked together are added together: each is checked, then all of them are tried on the SAVE at once.
  const tryAdd=list=>{
    list=[].concat(list);
    if(edits.length+list.length>PENDING_MAX)throw fail('PENDING_MAX',L(`편집은 한 번에 ${PENDING_MAX}개까지입니다.`,`Up to ${PENDING_MAX} edits at a time.`,`編集は一度に${PENDING_MAX}件までです。`,`一次最多 ${PENDING_MAX} 項編輯。`));
    for(const edit of list)if(!menus.allowed(edit))throw fail('FEATURE_OFF',L('지금은 쓸 수 없는 기능입니다.','This feature is turned off.','現在は使えない機能です。','此功能目前無法使用。'));
    ownerLimitCheck(hello.limits,list);
    const trial=engine.parse(source.raw,source.cc);applyEdits(trial,gd,[...edits,...list],editSettings(extended));
    edits.push(...list);for(const e of list)say(L(`추가: ${menus.describe(e)}`,`Added: ${menus.describe(e)}`,`追加: ${menus.describe(e)}`,`已新增: ${menus.describe(e)}`));
  };
  const notAdded=err=>say(L(`추가하지 않았습니다: ${explain(err)}`,`Not added: ${explain(err)}`,`追加できませんでした: ${explain(err)}`,`未新增: ${explain(err)}`));
  const none=()=>say(L('편집이 없습니다.','There are no edits.','編集がありません。','沒有編輯。'));
  const help=()=>say(L(HELP_KO,HELP_EN,HELP_JA,HELP_ZH));
  let first=true;
  for(;;){
    say('');say(L(`— 대기 중인 편집 (${edits.length}) —`,`— Pending edits (${edits.length}) —`,`— 保留中の編集 (${edits.length}) —`,`— 待處理的編輯 (${edits.length}) —`));
    if(edits.length)say(edits.map((e,i)=>`  ${i+1}. ${menus.describe(e)}`).join('\n'));
    if(extended)say(L('  [확장 한도 켜짐]','  [extended limits on]','  [拡張上限オン]','  [擴充上限已開啟]'));
    if(first){help();first=false;}
    else say(L('Enter 편집 추가 · s 저장 · ? 도움말 · 0 나가기 · 바로 입력: 통조림 45000','Enter add · s save · ? help · 0 quit · or type: catfood 45000','Enter 追加 · s 保存 · ? ヘルプ · 0 終了 · 直接入力: ネコカン 45000','Enter 新增 · s 儲存 · ? 說明 · 0 離開 · 直接輸入: 貓罐頭 45000'));
    let a;try{a=await ask('> ');}catch(err){if(isBack(err)){backed();return null;}throw err;}
    const cmd=a.toLowerCase();
    try{
      if(cmd===''||cmd==='a'||cmd==='+'){
        // Keep picking until the person backs out of the section list.
        for(;;){let edit;try{edit=await menus.pick();}catch(err){if(isBack(err))break;throw err;}if(!edit)continue;
          try{tryAdd(edit);}catch(err){notAdded(err);}}
      }
      else if(cmd==='s'){if(!edits.length){none();continue;}return {edits,describe:menus.describe,extended};}
      else if(cmd==='q'||cmd==='0'){if(edits.length&&!(await yes(L(`편집 ${edits.length}개를 저장하지 않고 나갈까요?`,`Quit without saving ${edits.length} edits?`,`${edits.length}件の編集を保存せずに終了しますか？`,`要放棄 ${edits.length} 項編輯並離開嗎？`))))continue;return null;}
      else if(cmd==='?'||cmd==='h'||cmd==='help')help();
      else if(cmd==='p'){
        const list=presets();if(!list.length){say(L('저장된 프리셋이 없습니다. 편집을 추가한 뒤 p+ 로 만드세요.','There are no presets. Add edits, then use p+.','プリセットがありません。編集を追加してから p+ で作成してください。','沒有預設。請先新增編輯，再用 p+ 建立。'));continue;}
        const p=list[await choose(L('불러올 프리셋','Preset to load','読み込むプリセット','要載入的預設'),list.map(x=>`${x.name} (${x.edits.length})`))];
        let added=0,skipped=0;
        for(const raw of p.edits){
          const edit=JSON.parse(JSON.stringify(raw));
          try{tryAdd(edit);added++;}catch(err){skipped++;say(L(`  건너뜀: ${menus.describe(edit)} (${explain(err)})`,`  Skipped: ${menus.describe(edit)} (${explain(err)})`,`  スキップ: ${menus.describe(edit)} (${explain(err)})`,`  已略過: ${menus.describe(edit)} (${explain(err)})`));}
        }
        say(L(`프리셋 "${p.name}": ${added}개 추가, ${skipped}개 건너뜀`,`Preset "${p.name}": ${added} added, ${skipped} skipped`,`プリセット「${p.name}」: ${added}件追加、${skipped}件スキップ`,`預設「${p.name}」: 已新增 ${added} 項，略過 ${skipped} 項`));
      }
      else if(cmd==='p+'){
        if(!edits.length){none();continue;}
        let name='';for(;;){name=(await ask(L(`프리셋 이름 (${PRESET_NAME_MAX}자까지): `,`Preset name (up to ${PRESET_NAME_MAX} characters): `,`プリセット名 (${PRESET_NAME_MAX}文字まで): `,`預設名稱（最多 ${PRESET_NAME_MAX} 字）: `))).replace(/[\x00-\x1f]/g,'');if(name&&[...name].length<=PRESET_NAME_MAX)break;}
        const list=presets(),at=list.findIndex(x=>x.name===name);
        if(at>=0&&!(await yes(L(`"${name}" 프리셋을 덮어쓸까요?`,`Replace the preset "${name}"?`,`プリセット「${name}」を上書きしますか？`,`要覆寫預設「${name}」嗎？`))))continue;
        if(at<0&&list.length>=PRESET_MAX){say(L(`프리셋은 ${PRESET_MAX}개까지입니다. 설정에서 하나 지우세요.`,`Up to ${PRESET_MAX} presets. Delete one in Settings.`,`プリセットは${PRESET_MAX}件までです。設定でひとつ削除してください。`,`預設最多 ${PRESET_MAX} 個。請在設定中刪除一個。`));continue;}
        const entry={name,cc:source.cc,edits:JSON.parse(JSON.stringify(edits))};
        if(at>=0)list[at]=entry;else list.push(entry);savePresets(list,config);
        say(L(`프리셋 "${name}"을(를) 저장했습니다 (${edits.length}개).`,`Saved the preset "${name}" (${edits.length}).`,`プリセット「${name}」を保存しました (${edits.length}件)。`,`已儲存預設「${name}」（${edits.length} 項）。`));
      }
      else if(/^d\s*\d*$/.test(cmd)){
        if(!edits.length){none();continue;}
        const given=Number(cmd.slice(1).trim()),n=Number.isInteger(given)&&given>=1&&given<=edits.length?given:await askNumber(L('지울 편집 번호','Edit number to remove','削除する編集の番号','要刪除的編輯編號'),1,edits.length);
        const [gone]=edits.splice(n-1,1);say(L(`지움: ${menus.describe(gone)}`,`Removed: ${menus.describe(gone)}`,`削除: ${menus.describe(gone)}`,`已刪除: ${menus.describe(gone)}`));
      }
      else if(cmd==='c'){if(edits.length&&await yes(L(`편집 ${edits.length}개를 모두 지울까요?`,`Clear all ${edits.length} edits?`,`${edits.length}件の編集をすべて削除しますか？`,`要清除全部 ${edits.length} 項編輯嗎？`)))edits.length=0;}
      else{
        const direct=parseDirect(a,menus.itemRows(),menus.label);
        if(!direct)say(L('알 수 없는 명령입니다. ? 를 입력하면 도움말이 나옵니다.','Unknown command. Type ? for help.','不明なコマンドです。? でヘルプを表示します。','未知的指令。輸入 ? 查看說明。'));
        else if(direct.error)say(direct.error);
        else tryAdd(direct.edits);
      }
    }catch(err){if(isBack(err)){backed();continue;}notAdded(err);}
  }
}

// ---------- settings ----------
// Returns 'forgot' when the token was removed (the editor then quits).
async function settingsMenu(config,hello){
  for(;;){
    const keep=Number(config.backupKeep)||0,canExtend=hello?.access?.canUseExtendedLimits===true;
    const keepText=keep?L(`최근 ${keep}개`,`newest ${keep}`,`新しい順に${keep}件`,`最新 ${keep} 個`):L('전부','all','すべて','全部');
    const extText=!canExtend?L('역할 필요','needs a role','ロールが必要','需要身分組'):config.extendedLimits===true?L('켜짐','on','オン','開啟'):L('꺼짐','off','オフ','關閉');
    const SETTINGS=['lang','presets','backups','extended','token','done'];
    const pick=SETTINGS[await choose(L('설정','Settings','設定','設定'),['Language / 언어 / 言語 / 語言',L(`프리셋 관리 (${presets().length}개)`,`Manage presets (${presets().length})`,`プリセット管理 (${presets().length}件)`,`管理預設（${presets().length} 個）`),L(`백업 보관 개수: ${keepText}`,`Backups to keep: ${keepText}`,`バックアップの保存数: ${keepText}`,`備份保留數量: ${keepText}`),L(`확장 한도: ${extText}`,`Extended limits: ${extText}`,`拡張上限: ${extText}`,`擴充上限: ${extText}`),L('토큰 지우기','Forget token','トークンを削除','刪除權杖'),L('돌아가기','Done','戻る','返回')])];
    if(pick==='done')return null;
    // Backing out inside one setting returns to this list; backing out of the list returns to the first menu.
    try{
    if(pick==='lang'){await chooseLanguage(config);continue;}
    if(pick==='token'){if(!(await yes(L('토큰을 지우고 종료할까요?','Forget the token and quit?','トークンを削除して終了しますか？','要刪除權杖並離開嗎？'))))continue;config.token='';saveConfig(config);say(L('토큰을 지웠습니다.','Token removed.','トークンを削除しました。','已刪除權杖。'));return 'forgot';}
    if(pick==='presets'){
      const list=presets();if(!list.length){say(L('저장된 프리셋이 없습니다.','There are no presets.','プリセットがありません。','沒有預設。'));continue;}
      const i=await choose(L('지울 프리셋','Preset to delete','削除するプリセット','要刪除的預設'),list.map(x=>`${x.name} (${(x.cc||'?').toUpperCase()}, ${x.edits.length})`));
      if(!(await yes(L(`"${list[i].name}" 프리셋을 지울까요?`,`Delete the preset "${list[i].name}"?`,`プリセット「${list[i].name}」を削除しますか？`,`要刪除預設「${list[i].name}」嗎？`))))continue;
      list.splice(i,1);savePresets(list,config);say(L('지웠습니다.','Deleted.','削除しました。','已刪除。'));continue;
    }
    if(pick==='backups'){
      const i=await choose(L('백업을 몇 개까지 남길까요? (결과를 확인하지 못한 업로드의 백업은 항상 남깁니다)','How many backups to keep? (backups of uploads with an unknown result are always kept)','バックアップを何件まで残しますか？(結果を確認できなかったアップロードのバックアップは常に残します)','要保留多少個備份？（無法確認結果的上傳備份一律保留）'),BACKUP_KEEP.map(n=>n?L(`최근 ${n}개`,`Newest ${n}`,`新しい順に${n}件`,`最新 ${n} 個`):L('전부 남기기','Keep all','すべて残す','全部保留')));
      config.backupKeep=BACKUP_KEEP[i];saveConfig(config);
      const removed=pruneBackups(path.join(HOME,'backups'),config.backupKeep,null);
      if(removed)say(L(`오래된 백업 ${removed}개를 지웠습니다.`,`Removed ${removed} old backups.`,`古いバックアップを${removed}件削除しました。`,`已刪除 ${removed} 個舊備份。`));continue;
    }
    if(pick==='extended'){
      if(!canExtend){say(L('확장 한도는 이를 허용한 역할(후원 등)이 있어야 쓸 수 있습니다.','Extended limits need a role that allows them (such as a supporter role).','拡張上限は、それを許可されたロール(支援者など)が必要です。','擴充上限需要擁有允許的身分組（例如贊助者）。'));continue;}
      if(config.extendedLimits===true){config.extendedLimits=false;saveConfig(config);say(L('확장 한도를 껐습니다.','Extended limits are off.','拡張上限をオフにしました。','已關閉擴充上限。'));continue;}
      say(L('확장 한도를 켜면 아이템과 클리어 횟수를 게임 권장값보다 크게 넣을 수 있습니다. 값이 지나치게 크면 게임이나 PONOS 서버가 계정을 이상하게 볼 수 있습니다. 운영자가 정한 상한은 그대로 적용됩니다.','Extended limits let items and clear counts go past the game\'s usual values. Very large values can look wrong to the game or to PONOS. The owner\'s caps still apply.','拡張上限をオンにすると、アイテムやクリア回数を通常の値より大きくできます。値が大きすぎるとゲームやPONOSに不自然と判断されることがあります。運営者の上限はそのまま適用されます。','開啟擴充上限後，道具與通關次數可以超過遊戲的一般數值。數值過大可能被遊戲或 PONOS 視為異常。營運者設定的上限仍然適用。'));
      if(await yes(L('켤까요?','Turn them on?','オンにしますか？','要開啟嗎？'))){config.extendedLimits=true;saveConfig(config);say(L('확장 한도를 켰습니다.','Extended limits are on.','拡張上限をオンにしました。','已開啟擴充上限。'));}
    }
    }catch(err){if(isBack(err)){backed();continue;}throw err;}
  }
}

// ---------- save ----------
async function reserve(token,mode,edits,restored){
  const operationId=crypto.randomUUID(),r=await (await api(token,'POST','/api/local/cli/reserve',{operationId,mode:mode==='codes'?'codes':'file',editCount:restored?Math.max(1,edits.length):edits.length})).json();
  if(!r.allowed)throw fail('QUOTA',L('남은 저장 횟수가 없습니다.','You have no SAVEs left.','保存できる回数が残っていません。','已沒有剩餘的儲存次數。'));
  return operationId;
}
async function finish(token,operationId,mode,outcome){
  try{return await (await api(token,'POST','/api/local/cli/finish',{operationId,mode:mode==='codes'?'codes':'file',outcome})).json();}
  catch{say(L('(canbot.dev에 결과를 알리지 못했습니다. 저장 자체에는 영향이 없습니다.)','(Could not report the result to canbot.dev. The SAVE itself is not affected.)','(canbot.devに結果を送れませんでした。セーブ自体には影響ありません。)','（無法將結果回報給 canbot.dev。存檔本身不受影響。）'));return null;}
}
// The PONOS account of a transfer-code SAVE: its credentials are fetched while the member edits (prepare).
function startAccount(source){
  if(source.kind!=='codes')return;
  const base=engine.parse(source.raw,source.cc);if(source.received)ponos.adoptReception(base,source.received);
  const store=accountStore(codeOf(base));
  if(source.received?.password)store.set({...(store.get()||{}),password:source.received.password,token:null,code:codeOf(base)});
  source.account=ponos.account(base,store);source.account.prepare();
}
function fresh(source){const save=engine.parse(source.raw,source.cc);if(source.received)ponos.adoptReception(save,source.received);return save;}
async function saveAndUpload(token,source,edits,gd,extended=false){
  const save=fresh(source);
  if(edits.length)applyEdits(save,gd,edits,editSettings(extended));
  const out=engine.serialize(save);
  // The written SAVE must read back to the same bytes before it leaves this device.
  if(!engine.serialize(engine.parse(out,source.cc)).equals(out))throw fail('VERIFY',L('편집한 SAVE 확인에 실패했습니다. 저장하지 않았습니다.','The edited SAVE did not verify. Nothing was saved.','編集したセーブの確認に失敗しました。何も保存していません。','編輯後的存檔驗證失敗。未儲存任何內容。'));
  if(source.kind==='file'||source.kind==='adb'){
    const operationId=await reserve(token,source.kind,edits,source.restored);
    let back=null;
    try{if(source.kind==='file'){writeRooted(source.file,out);back=readRooted(source.file);}else back=writeAdb(source,out);}
    catch{await finish(token,operationId,source.kind,'uncertain');throw fail('FILE',L('SAVE를 쓰지 못했습니다. 백업에서 복원할 수 있습니다.','Could not write the SAVE. You can restore it from the backup.','セーブを書き込めませんでした。バックアップから復元できます。','無法寫入存檔。可以從備份還原。'));}
    const ok=Buffer.isBuffer(back)&&back.equals(out);
    await finish(token,operationId,source.kind,ok?'committed':'uncertain');
    say(ok?L('\n저장했습니다. 게임을 실행해 확인하세요.','\nSaved. Start the game to check.','\n保存しました。ゲームを起動して確認してください。','\n已儲存。請啟動遊戲確認。'):L('\nSAVE를 썼지만 다시 읽어 확인하지 못했습니다. 게임에서 확인하세요.','\nThe SAVE was written but could not be read back. Check in the game.','\nセーブを書き込みましたが、読み直して確認できませんでした。ゲームで確認してください。','\n已寫入存檔，但無法重新讀取確認。請在遊戲中確認。'));
    return;
  }
  if(!source.account)startAccount(source);
  say(L('PONOS 서버에 업로드 중...','Uploading to PONOS...','PONOSにアップロード中...','正在上傳到 PONOS...'));
  // Credentials and the save key first (nothing is uploaded yet), then the SAVE is counted and sent.
  steps.on=true;
  try{await source.account.ready();}
  catch(err){steps.on=false;source.account=null;throw fail('PONOS_AUTH',L(`PONOS 인증에 실패했습니다 (${err.code||'?'}). 아무것도 업로드하지 않았습니다.`,`PONOS sign-in failed (${err.code||'?'}). Nothing was uploaded.`,`PONOSの認証に失敗しました (${err.code||'?'})。何もアップロードしていません。`,`PONOS 驗證失敗 (${err.code||'?'})。未上傳任何內容。`));}
  const operationId=await reserve(token,'codes',edits,source.restored).catch(err=>{steps.on=false;throw err;});
  const started=Date.now();let codes;
  try{codes=await source.account.upload(save,engine.serialize);}
  catch(err){
    steps.on=false;
    backup(`${source.cc}-not-confirmed.sav`,out);
    await finish(token,operationId,'codes','uncertain');
    if(!err.uploadPossible){source.uploading=false;throw fail('PONOS_UPLOAD',L(`업로드하지 못했습니다 (${err.step}: ${err.code}). PONOS에는 아무것도 바뀌지 않았습니다.`,`Upload failed (${err.step}: ${err.code}). Nothing changed at PONOS.`,`アップロードできませんでした (${err.step}: ${err.code})。PONOS側は何も変わっていません。`,`上傳失敗 (${err.step}: ${err.code})。PONOS 端沒有任何變更。`));}
    say(L('\n업로드 결과를 확인할 수 없습니다. 자동으로 다시 시도하지 않습니다.\n편집된 SAVE는 ~/.canbot/backups 에 있습니다. 깡통봇 디스코드에 문의하세요.','\nThe upload result is unknown. It is not retried automatically.\nThe edited SAVE is in ~/.canbot/backups. Ask in the CanBot Discord.','\nアップロードの結果を確認できません。自動で再試行はしません。\n編集したセーブは ~/.canbot/backups にあります。CanBotのDiscordでお問い合わせください。','\n無法確認上傳結果。不會自動重試。\n編輯後的存檔在 ~/.canbot/backups。請到 CanBot 的 Discord 詢問。'));
    return;
  }
  steps.on=false;
  backup(`${source.cc}-uploaded.sav`,codes.bytes);
  await finish(token,operationId,'codes','committed');
  say('');say('========================================');
  say(L(`  인계 코드: ${codes.transferCode}`,`  Transfer code: ${codes.transferCode}`,`  引き継ぎコード: ${codes.transferCode}`,`  引繼碼: ${codes.transferCode}`));
  say(L(`  인증 번호: ${codes.confirmationCode}`,`  Confirmation code: ${codes.confirmationCode}`,`  認証番号: ${codes.confirmationCode}`,`  認證碼: ${codes.confirmationCode}`));
  say('========================================');
  say(L(`게임의 "기종 변경" 화면에서 위 코드를 입력하세요. (업로드 ${((Date.now()-started)/1000).toFixed(1)}초)`,`Enter these codes in the game's data transfer screen. (upload ${((Date.now()-started)/1000).toFixed(1)}s)`,`ゲームの「機種変更」画面で上のコードを入力してください。(アップロード ${((Date.now()-started)/1000).toFixed(1)}秒)`,`請在遊戲的「引繼資料」畫面輸入上方代碼。（上傳 ${((Date.now()-started)/1000).toFixed(1)} 秒）`));
}

// Names in the chosen language: the newest game data of the region that speaks it (Korean -> KR, English -> global,
// Japanese -> JP, Chinese -> TW). Only for showing names; edits always use the SAVE's own region data.
const NAME_REGION={ko:'kr',en:'en',ja:'jp',zh:'tw'};
async function namesFor(token,cc,hello){
  const region=NAME_REGION[lang],version=hello.latest?.[region];
  if(!region||region===cc||!version)return null;
  try{return await gameData(token,region,version,hello);}catch{return null;}
}

// ---------- main ----------
// Start screen: name and version, the license notice the AGPL asks interactive programs to show, and where to go.
const EDITOR_VERSION='0.1.0';
const LINKS={github:'https://github.com/CatPower-max/canbot-save-editor',web:'https://canbot.dev',discord:'https://discord.gg/canbot'};
function banner(){
  const tty=process.stdout.isTTY&&!process.env.NO_COLOR,c=(code,t)=>tty?`\x1b[${code}m${t}\x1b[0m`:t;
  const width=s=>[...s].reduce((n,ch)=>n+(ch.codePointAt(0)>=0x1100?2:1),0);
  const label=(k,v)=>`${c('36',k+' '.repeat(Math.max(1,10-width(k))))}${v}`;
  say('');
  say(c('1;33',L(`깡통봇 로컬 에디터  v${EDITOR_VERSION}`,`CanBot local editor  v${EDITOR_VERSION}`,`CanBot ローカルエディター  v${EDITOR_VERSION}`,`CanBot 本機編輯器  v${EDITOR_VERSION}`)));
  say('Copyright (C) 2026 CanBot');
  say(L('AGPL-3.0-or-later 라이선스이며, 보증 없이 제공됩니다.','Licensed under AGPL-3.0-or-later and provided without any warranty.','AGPL-3.0-or-later ライセンスで、無保証で提供されます。','以 AGPL-3.0-or-later 授權，不提供任何擔保。'));
  say('');
  say(label('GitHub',LINKS.github));
  say(label(L('웹','Web','ウェブ','網站'),LINKS.web));
  say(label('Discord',LINKS.discord));
  say('');
  say(L('어디서든 exit (또는 뒤로) 를 입력하면 아무것도 바꾸지 않고 이전 단계로 돌아갑니다.','Type exit (or back) at any prompt to go back a step without changing anything.','どこでも exit (または 戻る) と入力すると、何も変更せずに前の段階へ戻ります。','在任何輸入處輸入 exit（或 返回）即可不做任何變更回到上一步。'));
  say(c('32',L('무료 프로그램입니다. 돈을 요구받았다면 사기입니다.','This program is free. If someone asked you to pay for it, it is a scam.','このプログラムは無料です。お金を求められたら詐欺です。','本程式免費。若有人向你收費，那是詐騙。')));
  say(c('36','-'.repeat(48)));
}
const LANGS=[['ko','한국어'],['en','English'],['ja','日本語'],['zh','繁體中文']];
async function chooseLanguage(config){const i=await choose('Language / 언어 / 言語 / 語言',LANGS.map(x=>x[1]));config.lang=LANGS[i][0];lang=config.lang;saveConfig(config);}
// Transfer codes stay valid until something is uploaded, so leaving before the upload only needs a word.
function codesStillValid(source){if(source?.kind==='codes'&&source.received&&!source.uploading)say(L('업로드하지 않았으므로 입력한 인계 코드를 게임에서 그대로 다시 쓸 수 있습니다.','Nothing was uploaded, so the transfer codes you entered still work in the game.','アップロードしていないので、入力した引き継ぎコードはゲームでそのまま使えます。','由於沒有上傳，輸入的引繼碼仍可在遊戲中使用。'));}
async function main(){
  rl=readline.createInterface({input:process.stdin,output:process.stdout});
  const config=loadConfig();prefs=config;
  let hello;
  try{
    if(!LANGS.some(x=>x[0]===config.lang))await chooseLanguage(config);
    lang=config.lang;
    banner();
    hello=await login(config);
  }catch(err){if(isBack(err)){rl.close();return;}throw err;}
  const left=hello.allowance?.unlimited?L('무제한','unlimited','無制限','無限制'):String(hello.allowance?.remaining??'?');
  say(L(`${hello.user?.name||''}님, 반갑습니다. 남은 저장: ${left}`,`Hello ${hello.user?.name||''}. SAVEs left: ${left}`,`${hello.user?.name||''}さん、こんにちは。残りの保存回数: ${left}`,`${hello.user?.name||''} 你好。剩餘儲存次數: ${left}`));
  for(;;){
    let how;try{how=await choose(L('SAVE를 어디서 가져올까요?','Where is the SAVE?','セーブをどこから読み込みますか？','要從哪裡讀取存檔？'),[L('인계 코드 (루팅 불필요)','Transfer codes (no root needed)','引き継ぎコード (root不要)','引繼碼（不需要 root）'),L('SAVE 파일 (루팅된 기기·에뮬레이터)','SAVE file (rooted phone or emulator)','セーブファイル (root端末・エミュレーター)','存檔檔案（已 root 的手機或模擬器）'),
      L('PC에 adb로 연결한 기기','Device connected to this PC with adb','このPCにadbで接続した端末','以 adb 連接到這台電腦的裝置'),L('백업에서 복원','Restore a backup','バックアップから復元','從備份還原'),L('설정 (언어, 프리셋, 백업, 한도, 토큰)','Settings (language, presets, backups, limits, token)','設定 (言語・プリセット・バックアップ・上限・トークン)','設定（語言、預設、備份、上限、權杖）')],L('종료','Quit','終了','離開'));}catch(err){if(isBack(err))break;throw err;}
    if(how===4){let r=null;try{r=await settingsMenu(config,hello);}catch(err){if(!isBack(err))throw err;}if(r==='forgot')break;continue;}
    let source=null;
    try{
      const cc=REGIONS[await choose(L('게임 지역','Game region','ゲームの地域','遊戲地區'),[L('한국판','Korean','韓国版','韓國版'),L('글로벌(영어)판','Global (English)','グローバル(英語)版','國際（英文）版'),L('일본판','Japanese','日本版','日本版'),L('대만판','Taiwanese','台湾版','台灣版')])];
      source=how===0?await fromTransferCodes(cc,hello):how===1?await fromFile(cc):how===2?await fromAdb(cc):await fromBackup(cc);
      const save=engine.parse(source.raw,cc),version=engine.versionText(save.gameVersion);
      say(L(`SAVE 버전 ${version} (${save.cc.toUpperCase()})`,`SAVE version ${version} (${save.cc.toUpperCase()})`,`セーブのバージョン ${version} (${save.cc.toUpperCase()})`,`存檔版本 ${version} (${save.cc.toUpperCase()})`));
      if(save.cc!==cc)throw fail('REGION',L('선택한 지역과 SAVE 지역이 다릅니다.','The SAVE is from another region.','選んだ地域とセーブの地域が違います。','所選地區與存檔地區不同。'));
      if(source.restored){
        if(!(await yes(L('이 백업으로 복원할까요? (저장 1회 사용)','Restore this backup? (uses one SAVE)','このバックアップを復元しますか？(保存1回分を使います)','要還原此備份嗎？（會使用一次儲存次數）'))))continue;
        source.uploading=true;await saveAndUpload(config.token,source,[],null);continue;
      }
      startAccount(source);
      const gd=await gameData(config.token,cc,version,hello);
      const names=await namesFor(config.token,cc,hello);
      let chosen=null,kept=[],confirmed=false;
      for(;;){
        chosen=await editMenu(source,save,gd,hello,names,kept,config);
        if(!chosen)break;
        ownerLimitCheck(hello.limits,chosen.edits);
        say('');chosen.edits.forEach(e=>say(`  - ${chosen.describe(e)}`));
        // Backing out of this question goes back to the pending edits, which are kept.
        try{confirmed=await yes(L('이대로 저장할까요?','Save these changes?','この内容で保存しますか？','要儲存這些變更嗎？'));break;}
        catch(err){if(!isBack(err))throw err;kept=chosen.edits;}
      }
      if(!chosen||!confirmed){codesStillValid(source);continue;}
      source.uploading=true;await saveAndUpload(config.token,source,chosen.edits,gd,chosen.extended);
    }catch(err){
      if(isBack(err)){backed();codesStillValid(source);continue;}
      say(L(`\n오류: ${explain(err)}`,`\nError: ${explain(err)}`,`\nエラー: ${explain(err)}`,`\n錯誤: ${explain(err)}`));
      codesStillValid(source);
    }
  }
  rl.close();
}
if(require.main===module)main().catch(err=>{console.error(L(`오류: ${err.message}`,`Error: ${err.message}`,`エラー: ${err.message}`,`錯誤: ${err.message}`));process.exitCode=1;if(rl)rl.close();});
module.exports={main,ownerLimitCheck,pruneBackups,parseDirect,explain,CLIENT};

}
};
const __cache={},__path=require('node:path').posix;
function __load(id){
  if(__cache[id])return __cache[id].exports;
  const module={exports:{}};__cache[id]=module;
  const dir=__path.dirname(id);
  const req=spec=>{if(spec.startsWith('node:'))return require(spec);let p=__path.normalize(__path.join(dir,spec));if(!p.endsWith('.js'))p+=__files[p+'.js']?'.js':'/index.js';if(!__files[p])throw new Error('canbot.js: missing module '+p);return __load(p);};
  __files[id].call(module.exports,module,module.exports,req);
  return module.exports;
}
const cli=__load('tools/local/cli.js');
if(require.main===module)cli.main().catch(err=>{console.error('Error: '+(err&&err.message||err));process.exitCode=1;});
module.exports=cli;
})();
