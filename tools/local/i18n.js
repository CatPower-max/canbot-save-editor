// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Adds the Japanese and Traditional Chinese text from tools/local/translations.txt to every L(ko,en) call in
// tools/local/cli.js and menus.js, making them L(ko,en,ja,zh). Calls that already have four arguments are left as
// they are, so it can run again after new two-language calls are added. Fails on any call without a translation.
// Usage: node tools/local/i18n.js [--check]   (--check fails if a call still has only two languages)
const fs=require('node:fs'),path=require('node:path');
const HERE=__dirname,FILES=['cli.js','menus.js'].map(f=>path.join(HERE,f));

function literal(src,i){
  const q=src[i];if(q!=="'"&&q!=='`'&&q!=='"')return null;
  let j=i+1,depth=0;
  for(;j<src.length;j++){const c=src[j];if(c==='\\'){j++;continue;}if(q==='`'&&c==='$'&&src[j+1]==='{'){depth++;j++;continue;}if(depth&&c==='}'){depth--;continue;}if(!depth&&c===q)break;}
  return j<src.length?[src.slice(i,j+1),j+1]:null;
}
// The literal arguments of the call starting at `start` (just after "L("), and where the argument list ends.
function callArgs(src,start){
  let i=start;const out=[];
  for(;;){while(/\s/.test(src[i]))i++;const lit=literal(src,i);if(!lit)return null;out.push(lit[0]);i=lit[1];while(/\s/.test(src[i]))i++;if(src[i]===',' ){i++;continue;}if(src[i]===')')return {args:out,end:i};return null;}
}
function table(){
  const map=new Map(),blocks=fs.readFileSync(path.join(HERE,'translations.txt'),'utf8').replace(/\r\n/g,'\n').split(/\n\s*\n/);
  for(const b of blocks){const lines=b.split('\n').filter(l=>l&&!l.startsWith('#'));if(!lines.length)continue;if(lines.length!==3)throw Error(`translations.txt: block needs 3 lines:\n${b}`);map.set(lines[0],[lines[1],lines[2]]);}
  return map;
}
const check=process.argv.includes('--check'),map=table(),missing=[];let added=0,twoLeft=0;
for(const file of FILES){
  const src=fs.readFileSync(file,'utf8');let out='',last=0;
  for(const m of src.matchAll(/\bL\(/g)){
    const call=callArgs(src,m.index+2);if(!call||call.args.length!==2)continue;
    twoLeft++;const [ko,en]=call.args,key=en==="''"?`ko:${ko}`:en,t=map.get(key);
    if(!t){missing.push(`${path.basename(file)}: ${key}`);continue;}
    out+=src.slice(last,call.end)+`,${t[0]},${t[1]}`;last=call.end;added++;
  }
  out+=src.slice(last);
  if(!check)fs.writeFileSync(file,out);
}
if(missing.length){console.error('No translation for:\n'+missing.join('\n'));process.exit(1);}
if(check){if(twoLeft){console.error(`${twoLeft} L() calls have only two languages: run node tools/local/i18n.js`);process.exit(1);}console.log('all L() calls have four languages');}
else console.log(`added Japanese and Chinese to ${added} calls`);
