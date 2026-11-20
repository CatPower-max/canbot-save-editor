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
