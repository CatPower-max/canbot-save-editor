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
