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
