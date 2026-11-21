// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Adds the other languages to every L(ko,en) call in tools/local/cli.js and menus.js:
//   Japanese and Traditional Chinese from tools/local/translations.txt (L(ko,en) -> L(ko,en,ja,zh)), then
//   Spanish, French, German, Italian and Thai from tools/local/translations-extra.json (-> L(ko,en,ja,zh,es,fr,de,it,th)).
// Calls that already have all nine arguments are left as they are, so it can run again after new two-language calls
// are added. Fails on any call without a translation.
// Usage: node tools/local/i18n.js [--check]   (--check fails if a call does not have all nine languages)
const fs=require('node:fs'),path=require('node:path');
const HERE=__dirname,FILES=['cli.js','menus.js'].map(f=>path.join(HERE,f));
const ALL=9;

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
const EXTRA=JSON.parse(fs.readFileSync(path.join(HERE,'translations-extra.json'),'utf8')).t;
// The extra languages for a call, keyed by the English text inside its quotes (or ko:<Korean literal> when the
// English is empty), written with the English literal's own quote.
function extra(ko,en){
  if(en==="''")return EXTRA[`ko:${ko}`]?['\'\'','\'\'','\'\'','\'\'','\'\'']:null;
  const q=en[0],texts=EXTRA[en.slice(1,-1)];if(!texts)return null;
  return texts.map(t=>q+escapeQuote(t,q)+q);
}
// The literal's own quote is escaped in the text, except inside ${...} of a template literal (nested templates).
function escapeQuote(t,q){
  let out='',depth=0;
  for(let i=0;i<t.length;i++){const c=t[i];
    if(c==='\\'){out+=c+(t[i+1]??'');i++;continue;}
    if(q==='`'&&c==='$'&&t[i+1]==='{'){depth++;out+='${';i++;continue;}
    if(depth&&c==='{')depth++;else if(depth&&c==='}')depth--;
    out+=!depth&&c===q?'\\'+c:c;}
  return out;
}
const check=process.argv.includes('--check'),map=table(),missing=[];let added=0,short=0;
for(const file of FILES){
  const src=fs.readFileSync(file,'utf8');let out='',last=0;
  for(const m of src.matchAll(/\bL\(/g)){
    const call=callArgs(src,m.index+2);if(!call||![2,4].includes(call.args.length))continue;
    short++;const [ko,en]=call.args,more=[];
    if(call.args.length===2){const key=en==="''"?`ko:${ko}`:en,t=map.get(key);if(!t){missing.push(`${path.basename(file)}: ${key}`);continue;}more.push(t[0],t[1]);}
    const x=extra(ko,en);if(!x){missing.push(`${path.basename(file)} (es/fr/de/it/th): ${en==="''"?`ko:${ko}`:en}`);continue;}
    more.push(...x);
    out+=src.slice(last,call.end)+','+more.join(',');last=call.end;added++;
  }
  out+=src.slice(last);
  if(!check)fs.writeFileSync(file,out);
}
if(missing.length){console.error('No translation for:\n'+missing.join('\n'));process.exit(1);}
if(check){if(short){console.error(`${short} L() calls do not have all ${ALL} languages: run node tools/local/i18n.js`);process.exit(1);}console.log(`all L() calls have ${ALL} languages`);}
else console.log(`added languages to ${added} calls`);
