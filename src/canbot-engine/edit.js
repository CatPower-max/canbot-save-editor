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
