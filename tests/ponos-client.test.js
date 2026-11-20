// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// CanBot's PONOS client (src/canbot-engine/ponos.js) against a fake PONOS that checks every signature the way the
// real servers do. No network.
const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {SaveString,SaveDouble}=require('../src/canbot-engine/binary');
const {createPonos,managedChanges}=require('../src/canbot-engine/ponos');

const s=t=>new SaveString(Buffer.from(t,'utf8'));
const CODE='ab12cd34ef56';
function fakeSave(orderIds=[]){
  return {cc:'kr',gameVersion:150700,data:{inquiryCode:s(CODE),passwordRefreshToken:s('refresh-1'),energyPenaltyTimestamp:new SaveDouble(1700000000),officerPassPlayTime:77,
    catfood:100,legendTickets:1,platinumTickets:2,rareTickets:3,showBanMessage:true,orderIds:orderIds.map(s),
    catsUnlocked:[1,0,1],catsUpgrade:[{base:9,plus:0},{base:0,plus:0},{base:19,plus:5}],specialSkills:[{base:1,plus:0},{base:5,plus:0},{base:0,plus:0}]}};
}
const jwt=(claims)=>`x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
const NOW=Date.parse('2026-11-19T00:00:00Z');

// A fake PONOS: answers by URL, checks HMAC signatures with the account code, records every request.
function fakePonos({failAt=null,passwordStatus=1,moved=null}={}){
  const calls=[];let code=CODE;
  async function fetch(url,init={}){
    const u=new URL(url),method=init.method||'GET',body=init.body,headers=init.headers||{};
    const name=`${method} ${u.hostname.split('.')[0]}${u.pathname}`;calls.push({name,headers,body});
    const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json'}});
    if(method==='HEAD')return new Response(null,{status:403});
    if(headers['nyanko-signature']){
      const sig=headers['nyanko-signature'],salt=sig.slice(0,64),want=crypto.createHmac('sha256',code+salt).update(body).digest('hex');
      if(sig.slice(64)!==want)return json({statusCode:-1,error:'bad signature'});
    }
    if(failAt===name)return json({statusCode:-3});
    if(name==='POST nyanko-auth/v1/user/password'){if(passwordStatus!==1)return json({statusCode:passwordStatus});const p={password:'pw-1',passwordRefreshToken:'refresh-2'};if(moved){p.accountCode=moved;code=moved;}return json({statusCode:1,timestamp:1700000123,payload:p});}
    if(name==='POST nyanko-auth/v1/users')return json({statusCode:-9});
    if(name==='POST nyanko-auth/v1/tokens'){const b=JSON.parse(body);assert.equal(b.accountCode,code);assert.equal(b.clientInfo.client.countryCode,'kr');return json({statusCode:1,payload:{token:jwt({exp:Math.floor(NOW/1000)+3600,accountCode:code})}});}
    if(name==='POST nyanko-managed-item/v1/managed-items')return json({statusCode:1});
    if(name==='GET nyanko-save/v2/save/key'){assert.match(headers.authorization,/^Bearer /);return json({statusCode:1,payload:{key:'save-key-1',url:'https://nyanko-service-data-prd.s3.amazonaws.com/',policy:Buffer.from(JSON.stringify({expiration:new Date(NOW+3600e3).toISOString()})).toString('base64'),'x-amz-signature':'sig'}});}
    if(name==='POST nyanko-service-data-prd/'){return new Response(null,{status:204});}
    if(name==='POST nyanko-save/v2/transfers'){
      const b=JSON.parse(body),salt=b.signature_v1.slice(0,40),items=JSON.stringify(b.managedItemDetails);
      assert.equal(b.signature_v1.slice(40),crypto.createHmac('sha1',code+salt).update(items+items).digest('hex'),'managed item signature');
      assert.equal(b.saveKey,'save-key-1');return json({statusCode:1,payload:{transferCode:'newcode99',pin:'4321'}});
    }
    if(/reception$/.test(u.pathname))return new Response(Buffer.from('SAVEBYTES'),{status:200,headers:{'content-type':'application/octet-stream','nyanko-password':'pw-0','nyanko-password-refresh-token':'refresh-0'}});
    return json({statusCode:0},404);
  }
  return {fetch,calls,names:()=>calls.filter(c=>!c.name.startsWith('HEAD')).map(c=>c.name)};
}
const memoryStore=(initial=null)=>{let v=initial;return {get:()=>v,set:x=>{v=x;},peek:()=>v};};
const serialize=save=>Buffer.from(JSON.stringify(save.data.orderIds.map(String)));

test('a first upload: refresh password, token, save key, S3, transfer; nothing of ours inside the SAVE',async()=>{
  const p=fakePonos(),ponos=createPonos({fetch:p.fetch,now:()=>NOW});
  const save=fakeSave(['order-1','_bcsfe:password:old','_canbot:managed_items:3_1700000001_rareTicket_get','_bcsfe:managed_items:500_1700000000_catfood_get','_bcsfe:auth_token:zzz']),store=memoryStore();
  const out=await ponos.account(save,store).upload(serialize);
  assert.deepEqual({t:out.transferCode,c:out.confirmationCode},{t:'newcode99',c:'4321'});
  assert.deepEqual(p.names(),['POST nyanko-auth/v1/user/password','POST nyanko-auth/v1/tokens','GET nyanko-save/v2/save/key','POST nyanko-service-data-prd/','POST nyanko-save/v2/transfers']);
  assert.deepEqual(JSON.parse(out.bytes),['order-1'],'the uploaded SAVE has no editor entries (no password, token or item records)');
  const upload=p.calls.find(c=>c.name==='POST nyanko-service-data-prd/').body.toString('latin1');
  assert.ok(!upload.includes('_bcsfe:')&&!upload.includes('_canbot:')&&upload.includes('name="key"')&&upload.includes('filename="file.sav"')&&!upload.includes('name="url"'));
  const meta=JSON.parse(p.calls.find(c=>c.name==='POST nyanko-save/v2/transfers').body);
  assert.deepEqual(meta.managedItemDetails.map(m=>[m.amount,m.managedItemType,m.detailType,m.detailCreatedAt]),[[3,'rareTicket','get',1700000001],[500,'catfood','get',1700000000]],'records under both keys, in SAVE order');
  assert.equal(meta.rank,(9+1+0)+(19+1+5)+(1+1)+(0+1),'user rank from cats and skills (skill 1 skipped)');assert.equal(meta.playTime,77);
  assert.equal(String(save.data.passwordRefreshToken),'refresh-2','the new refresh token goes into the SAVE');
  assert.equal(save.data.showBanMessage,false);
  assert.ok(!save.data.orderIds.some(x=>/^_(bcsfe|canbot):managed_items/.test(String(x))),'item records are cleared after a successful transfer');
  assert.equal(store.peek().password,'pw-1');assert.ok(store.peek().token);assert.equal(store.peek().code,CODE);
  assert.ok(!p.calls.some(c=>c.name.startsWith('HEAD')),'no extra requests');
});

test('a stored valid token skips the password and token requests; prepare() fetches the key ahead',async()=>{
  const p=fakePonos(),ponos=createPonos({fetch:p.fetch,now:()=>NOW});
  const store=memoryStore({password:'pw-1',token:jwt({exp:Math.floor(NOW/1000)+3600,accountCode:CODE}),code:CODE});
  const acc=ponos.account(fakeSave(),store);
  await acc.prepare();assert.deepEqual(p.names(),['GET nyanko-save/v2/save/key']);
  await acc.upload(serialize);
  assert.deepEqual(p.names(),['GET nyanko-save/v2/save/key','POST nyanko-service-data-prd/','POST nyanko-save/v2/transfers'],'the prepared key is used, no second key request');
});

test('one attempt per step, and the error says whether the SAVE may have reached PONOS',async()=>{
  for(const [failAt,step,possible] of [['GET nyanko-save/v2/save/key','SAVE_KEY',false],['POST nyanko-save/v2/transfers','TRANSFER',true]]){
    const p=fakePonos({failAt}),ponos=createPonos({fetch:p.fetch,now:()=>NOW});
    await assert.rejects(ponos.account(fakeSave(),memoryStore()).upload(serialize),err=>err.step===step&&err.uploadPossible===possible);
    assert.equal(p.names().filter(n=>n===failAt).length,1,'no retry');
  }
  const s3=fakePonos({failAt:'POST nyanko-service-data-prd/'}),ponos=createPonos({fetch:s3.fetch,now:()=>NOW});
  await assert.rejects(ponos.account(fakeSave(),memoryStore()).upload(serialize),err=>err.step==='UPLOAD');
  assert.ok(!s3.names().includes('POST nyanko-save/v2/transfers'));
  const offline=createPonos({fetch:async()=>{throw new Error('offline');},now:()=>NOW});
  await assert.rejects(offline.account(fakeSave(),memoryStore()).upload(serialize),err=>err.code==='NO_CONNECTION'&&err.uploadPossible===false);
});

test('no password means a clear error, never a new account',async()=>{
  const p=fakePonos({passwordStatus:-5}),ponos=createPonos({fetch:p.fetch,now:()=>NOW});
  await assert.rejects(ponos.account(fakeSave(),memoryStore()).upload(serialize),err=>err.step==='PASSWORD'&&!err.uploadPossible);
  assert.deepEqual(p.names(),['POST nyanko-auth/v1/user/password','POST nyanko-auth/v1/users']);
  assert.ok(!p.calls.some(c=>c.name.includes('backups')),'no account creation');
});

test('a moved account: the SAVE follows the new code and item amounts are reported for it',async()=>{
  const p=fakePonos({moved:'zz99yy88xx77'}),ponos=createPonos({fetch:p.fetch,now:()=>NOW}),save=fakeSave();
  await ponos.account(save,memoryStore()).upload(serialize);
  assert.equal(String(save.data.inquiryCode),'zz99yy88xx77');assert.equal(Number(save.data.energyPenaltyTimestamp),1700000123);
  assert.ok(p.names().includes('POST nyanko-managed-item/v1/managed-items'));
  assert.equal(p.names().filter(n=>n==='POST nyanko-auth/v1/tokens').length,1,'one token request');
});

test('reception returns the SAVE and the credentials from the headers',async()=>{
  const p=fakePonos(),ponos=createPonos({fetch:p.fetch,now:()=>NOW});
  const r=await ponos.receive('abc123def','1234','kr',150700);
  assert.equal(r.bytes.toString(),'SAVEBYTES');assert.equal(r.password,'pw-0');assert.equal(r.refreshToken,'refresh-0');
  const save=fakeSave();ponos.adoptReception(save,r);assert.equal(String(save.data.passwordRefreshToken),'refresh-0');
  const bad=createPonos({fetch:async()=>new Response('{}',{status:400,headers:{'content-type':'application/json'}})});
  await assert.rejects(bad.receive('abc123def','0000','kr',150700),err=>err.code==='CODES_REJECTED');
  assert.deepEqual(managedChanges(fakeSave(['_bcsfe:managed_items:0_1_catfood_get','_canbot:managed_items:-5_9_rareTicket_use'])).map(m=>m.amount),[-5]);
});

test('item records use the _canbot: key; legacy compatibility reads and writes only _bcsfe:',()=>{
  const items=require('../src/canbot-engine/items'),compat=require('../src/canbot-engine/compat');
  const save=fakeSave(['order-1','_bcsfe:managed_items:7_1_catfood_get']);
  items.setManagedItems(save,[...items.managedItems(save),{amount:2,at:5,type:'rareTicket',detail:'use'}]);
  assert.deepEqual(save.data.orderIds.map(String),['order-1','_canbot:managed_items:7_1_catfood_get','_canbot:managed_items:2_5_rareTicket_use']);
  compat.use('legacy');
  try{
    const old=fakeSave(['_canbot:managed_items:1_1_catfood_get','_bcsfe:managed_items:4_2_catfood_get']);
    assert.deepEqual(items.managedItems(old).map(m=>m.amount),[4]);
    items.setManagedItems(old,[{amount:9,at:3,type:'catfood',detail:'get'}]);
    assert.deepEqual(old.data.orderIds.map(String),['_canbot:managed_items:1_1_catfood_get','_bcsfe:managed_items:9_3_catfood_get']);
  }finally{compat.use('own');}
});

test('the early sign-in never changes the account; the full one happens at save time and lands in the uploaded SAVE',async()=>{
  const p=fakePonos({moved:'mm11nn22oo33'}),ponos=createPonos({fetch:p.fetch,now:()=>NOW});
  const base=fakeSave(),acc=ponos.account(base,memoryStore());
  await assert.rejects(acc.prepare(),err=>err.code==='NEEDS_SIGN_IN');
  assert.deepEqual(p.names(),[],'no password refresh or registration while editing');
  const withPassword=fakePonos(),acc2=createPonos({fetch:withPassword.fetch,now:()=>NOW}).account(fakeSave(),memoryStore({password:'pw-1',code:CODE}));
  await acc2.prepare();assert.deepEqual(withPassword.names(),['POST nyanko-auth/v1/tokens','GET nyanko-save/v2/save/key'],'a known password only gets a token and a key');
  await assert.rejects(createPonos({fetch:fakePonos({failAt:'POST nyanko-auth/v1/tokens'}).fetch,now:()=>NOW}).account(fakeSave(),memoryStore({password:'old',code:CODE})).prepare(),err=>err.step==='TOKEN');
  const edited=fakeSave(['order-9']);edited.data.catfood=999;
  await acc.upload(edited,serialize);
  assert.equal(String(edited.data.inquiryCode),'mm11nn22oo33');assert.equal(String(edited.data.passwordRefreshToken),'refresh-2');
  assert.equal(String(base.data.inquiryCode),CODE,'the SAVE given at the start is not changed');
});
