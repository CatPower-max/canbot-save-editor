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
