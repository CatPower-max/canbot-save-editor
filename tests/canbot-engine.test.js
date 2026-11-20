// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// SAVE engine: byte-exact building blocks. No SAVE is stored in the repo; real SAVEs are checked separately for a
// byte-identical rewrite.
const test=require('node:test'),assert=require('node:assert/strict');
const {SaveReader,SaveWriter,SaveVarint,SaveDouble}=require('../src/canbot-engine/binary');
const {T,list,struct,when,dict}=require('../src/canbot-engine/codec');
const engine=require('../src/canbot-engine');

const roundtrip=(codec,bytes,ctx={gv:150700,cc:'kr',jp:false})=>{const r=new SaveReader(Buffer.from(bytes));const v=codec.read(r,ctx);assert.equal(r.p,bytes.length,'reads every byte');const w=new SaveWriter();codec.write(w,v,ctx);return {value:v,out:w.toBuffer()};};

test('primitives write back the exact bytes they were read from',()=>{
  const cases=[[T.int,[0xff,0xff,0xff,0xff]],[T.uint,[1,2,3,4]],[T.short,[0x34,0x12]],[T.ushort,[0xff,0xff]],[T.byte,[0x80]],[T.ubyte,[0xff]],[T.long,[1,2,3,4,5,6,7,0x80]],
    // A bool keeps its raw byte: the game stores 2 in some "bool" tables (JP 16.0.3).
    [T.bool,[2]],
    // A variable-length int stored with a needless leading group keeps its size.
    [T.varint,[0x80,0x05]],[T.varint,[0x81,0x80,0x00]],
    // -0 and a NaN payload survive in doubles.
    [T.double,[0,0,0,0,0,0,0,0x80]],[T.double,[1,0,0,0,0,0,0xf8,0x7f]],
    // A string that is not valid UTF-8 keeps its bytes.
    [T.string,[2,0,0,0,0xff,0xfe]]];
  for(const [codec,bytes] of cases){const {out}=roundtrip(codec,bytes);assert.deepEqual([...out],bytes);}
  assert.equal(roundtrip(T.varint,[0x80,0x05]).value.value,5);
});

test('changed values are written in the normal encoding',()=>{
  const w=new SaveWriter();w.bool(true);w.varint(new SaveVarint(300));w.double(new SaveDouble(1.5));w.string('냥코');
  const r=new SaveReader(w.toBuffer());assert.equal(r.bool(),1);assert.equal(r.varint().value,300);assert.equal(Number(r.double()),1.5);assert.equal(String(r.string()),'냥코');
});

test('lists, conditions and dictionaries keep counts and order',()=>{
  const s=struct([['n',T.byte],['items',list(T.short,(c,o)=>o.n)],when((c,o)=>o.n>1,['extra',T.int]),['map',dict(T.int,T.bool)]]);
  const bytes=[2, 1,0, 2,0, 9,0,0,0, 1,0,0,0, 7,0,0,0, 2];
  const {value,out}=roundtrip(s,bytes);
  assert.deepEqual(value.items,[1,2]);assert.equal(value.extra,9);assert.deepEqual(value.map,[[7,2]]);assert.deepEqual([...out],bytes);
  // A condition that is false reads nothing.
  const {value:one}=roundtrip(s,[1, 5,0, 0,0,0,0]);assert.equal('extra' in one,false);
});

test('a read past the end is refused, and so is an absurd list length',()=>{
  assert.throws(()=>new SaveReader(Buffer.from([1,2])).int(),{code:'SAVE_TRUNCATED'});
  assert.throws(()=>list(T.int).read(new SaveReader(Buffer.from([0xff,0xff,0xff,0x7f])),{}),{code:'SAVE_FORMAT_ERROR'});
});

test('checksum: MD5 hex of "battlecats" + region (none for JP) + body',()=>{
  const body=Buffer.from('body');
  assert.equal(engine.checksum(body,'kr'),require('node:crypto').createHash('md5').update('battlecatskrbody').digest('hex'));
  assert.equal(engine.checksum(body,'jp'),require('node:crypto').createHash('md5').update('battlecatsbody').digest('hex'));
  assert.equal(engine.versionText(150700),'15.7.0');assert.equal(engine.versionText(160003),'16.0.3');
  assert.throws(()=>engine.parse(Buffer.alloc(10),'kr'),{code:'SAVE_TRUNCATED'});
  assert.throws(()=>engine.parse(Buffer.alloc(100),'xx'),{code:'SAVE_REGION'});
});

test('tail after the 14.3 block: split at version markers; a section that does not fit its layout stays raw',()=>{
  const {tail}=require('../src/canbot-engine/format');
  const int=v=>{const b=Buffer.alloc(4);b.writeInt32LE(v);return [...b];};
  const ctx={gv:150000,cc:'kr',jp:false};
  // 140500 section: 10 bytes fit; 140700 section: 5 bytes do not fit (19 expected) -> raw; 150000: one int; then rest.
  const bytes=[...Array(10).fill(0),...int(140500),1,2,3,4,5,...int(140700),...int(7),...int(150000),9,9];
  const {value,out}=roundtrip(tail,bytes,ctx);
  assert.deepEqual(value.sections.map(s=>[s.marker,Boolean(s.fields)]),[[140500,true],[140700,false],[150000,true]]);
  assert.deepEqual([...value.sections[1].raw],[1,2,3,4,5]);assert.equal(value.sections[2].fields.value,7);assert.deepEqual([...value.rest],[9,9]);
  assert.deepEqual([...out],bytes,'byte-exact either way');
  // A version older than a marker does not look for that section.
  assert.deepEqual(roundtrip(tail,[1,2,3],{gv:140300,cc:'kr',jp:false}).value.sections,[]);
});

test('set(): checks kind and range, keeps exact bytes types, refuses counts, markers and identity fields',()=>{
  const {SaveString:Str,SaveDouble:Dbl}=require('../src/canbot-engine/binary');
  const save={cc:'kr',data:{catfood:5,flag0:1,timestamp:new Dbl(1,Buffer.alloc(8)),lineupCount:1,lineups:[[1,2,3,4,5,6,7,8,9,10]],marker44:44,transferCode:new Str(Buffer.from('secret')),catsUnlocked:[0,0],catsUpgradeCount:2}};
  engine.set(save,'catfood',45000);assert.equal(save.data.catfood,45000);
  engine.set(save,'flag0',true);assert.equal(save.data.flag0,1);
  engine.set(save,'timestamp',2.5);assert.equal(save.data.timestamp.value,2.5);
  engine.set(save,'lineups.0.3',99);assert.equal(save.data.lineups[0][3],99);
  engine.set(save,['catsUnlocked',1],1);assert.deepEqual(save.data.catsUnlocked,[0,1]);
  assert.throws(()=>engine.set(save,'catfood',2**31),{code:'SAVE_EDIT_VALUE'});
  assert.throws(()=>engine.set(save,'catfood',1.5),{code:'SAVE_EDIT_VALUE'});
  assert.throws(()=>engine.set(save,'lineupCount',5),{code:'SAVE_EDIT_REFUSED'});
  assert.throws(()=>engine.set(save,'marker44',1),{code:'SAVE_EDIT_REFUSED'});
  assert.throws(()=>engine.set(save,'catsUpgradeCount',1),{code:'SAVE_EDIT_REFUSED'});
  assert.throws(()=>engine.set(save,'transferCode','x'),{code:'SAVE_EDIT_REFUSED'});
  assert.throws(()=>engine.set(save,'lineups',[]),{code:'SAVE_EDIT_REFUSED'});
  assert.throws(()=>engine.set(save,'lineups.5.0',1),{code:'SAVE_EDIT_PATH'});
  assert.throws(()=>engine.set(save,'noSuchField',1),{code:'SAVE_EDIT_PATH'});
});

test('diff(): lists changed fields with before and after, identity values hidden',()=>{
  const {SaveString:Str}=require('../src/canbot-engine/binary');
  const a={data:{catfood:5,list:[1,2],transferCode:new Str(Buffer.from('aaa')),same:7}};
  const b={data:{catfood:6,list:[1,3,4],transferCode:new Str(Buffer.from('bbb')),same:7}};
  const {changes}=engine.diff(a,b);
  assert.deepEqual(changes,[{path:'catfood',before:5,after:6},{path:'list',before:'2 items',after:'3 items'},{path:'list.1',before:2,after:3},{path:'list.2',before:null,after:4},{path:'transferCode',before:'[hidden]',after:'[hidden]'}]);
});

test('set(): dates stay real calendar dates',()=>{
  const save={cc:'kr',data:{savedYear:2026,savedMonth:2,savedDay:28,hour:10,minute:0,second:0,date2:{year:2024,month:2,day:29,hour:0,minute:0,second:0}}};
  assert.throws(()=>engine.set(save,'savedMonth',0),{code:'SAVE_EDIT_VALUE'});
  assert.throws(()=>engine.set(save,'savedDay',29),{code:'SAVE_EDIT_VALUE'},'2026-02-29 does not exist');
  assert.throws(()=>engine.set(save,'hour',24),{code:'SAVE_EDIT_VALUE'});
  engine.set(save,'savedMonth',3);engine.set(save,'savedDay',31);assert.equal(save.data.savedDay,31);
  assert.throws(()=>engine.set(save,'date2.year',2023),{code:'SAVE_EDIT_VALUE'},'2023-02-29 does not exist');
  engine.set(save,'date2.year',2028);assert.equal(save.data.date2.year,2028);
});
