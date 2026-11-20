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
