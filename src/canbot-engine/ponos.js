// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// CanBot's PONOS account client for the local editor (canbot.js). It speaks the game's own account protocol
// (signed requests, password -> token -> save key -> S3 upload -> transfer codes) with CanBot's design:
//   - Credentials live outside the SAVE, in a store the caller provides (canbot.js keeps one private file per
//     account), and are reused while valid. Nothing of ours is written into the uploaded SAVE; editor records
//     (records.js) are taken out of the upload, so no password or token ever travels inside a SAVE.
//   - One attempt per step, never a hidden retry and never a silent new account. Every failure says which step
//     failed and whether the SAVE may already have reached PONOS (uploadPossible).
//   - Faster: credentials and the save key are fetched while the member is still editing (prepare), so a SAVE
//     only waits for the upload itself and the transfer; a valid token is reused across runs. (Measured: the upload
//     goes to the storage host named in the save key, so no connection is opened ahead to a guessed host.)
// Network, clock and randomness are injectable for tests: {fetch, now (ms), randomHex(n), uuid()}.
const crypto=require('node:crypto');
const {SaveString,SaveDouble}=require('./binary');
const collections=require('./collections');
const records=require('./records');

const HOST={auth:'https://nyanko-auth.ponosgames.com',save:'https://nyanko-save.ponosgames.com',managed:'https://nyanko-managed-item.ponosgames.com',s3:'https://nyanko-service-data-prd.s3.amazonaws.com'};
const AGENT='Dalvik/2.1.0 (Linux; U; Android 9; SM-G955F Build/N2G48B)';
const TOKEN_MARGIN_MS=120000,KEY_MARGIN_MS=60000;

class PonosError extends Error{
  constructor(code,step,{uploadPossible=false,status=null}={}){super(`${step}: ${code}`);this.code=code;this.step=step;this.uploadPossible=uploadPossible;this.status=status;}
}
// The JSON the game sends: compact, non-ASCII as \u escapes.
const body=value=>JSON.stringify(value).replace(/[\u007f-￿]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const defaultHex=n=>crypto.randomBytes(Math.ceil(n/2)).toString('hex').slice(0,n);
const regionCode=cc=>cc==='jp'?'ja':cc;
const text=s=>s instanceof SaveString?s.text:String(s??'');
// Seconds until a JWT expires, from its own claims (not verified: PONOS checks it, this only avoids a stale reuse).
function tokenExpiry(token){try{return Number(JSON.parse(Buffer.from(String(token).split('.')[1],'base64url').toString('utf8')).exp)*1000||0;}catch{return 0;}}
function keyExpiry(key){try{return Date.parse(JSON.parse(Buffer.from(String(key.policy),'base64').toString('utf8')).expiration)||0;}catch{return 0;}}

// Item changes the editor recorded in the SAVE (records.js kind "managed_items", "<amount>_<at>_<type>_<detail>"),
// which PONOS receives with the transfer as managedItemDetails.
function managedChanges(save){
  return save.data.orderIds.map(entry=>records.payload(entry,'managed_items')).filter(p=>p!==null).map(p=>p.split(':')[0])
    .map(s=>{const [amount,at,type,detail]=s.split('_');return {amount:Number(amount),at:Number(at),type,detail};}).filter(m=>m.amount&&m.type&&m.detail);
}
// The SAVE as it is uploaded: without editor bookkeeping entries.
function withoutEditorEntries(save){const before=save.data.orderIds;save.data.orderIds=before.filter(entry=>!records.isRecord(entry));return ()=>{save.data.orderIds=before;};}

// onStep({step, ms, status}): called after each PONOS request (status 0 = no answer), for progress display only.
function createPonos({fetch=globalThis.fetch,now=Date.now,randomHex=defaultHex,uuid=()=>crypto.randomUUID(),timeoutMs=60000,onStep=null}={}){
  const report=(step,started,status)=>{if(onStep)try{onStep({step,ms:Date.now()-started,status});}catch{}};
  async function http(step,method,url,headers,payload,{json=true}={}){
    let res;const started=Date.now();
    try{res=await fetch(url,{method,headers,body:payload,signal:AbortSignal.timeout(timeoutMs)});}
    catch{report(step,started,0);throw new PonosError('NO_CONNECTION',step);}
    report(step,started,res.status);
    const buf=Buffer.from(await res.arrayBuffer());
    if(!json)return {status:res.status,headers:res.headers,body:buf};
    let data;try{data=JSON.parse(buf.toString('utf8'));}catch{throw new PonosError('BAD_RESPONSE',step,{status:res.status});}
    return {status:res.status,headers:res.headers,data};
  }
  // A request PONOS checks by HMAC-SHA256 keyed with the account code.
  function signed(account,payload){
    const salt=randomHex(64),signature=salt+crypto.createHmac('sha256',account.code+salt).update(payload).digest('hex');
    return {'accept-encoding':'gzip',connection:'keep-alive','content-type':'application/json','nyanko-signature':signature,'nyanko-timestamp':String(Math.floor(now()/1000)),
      'nyanko-signature-version':'1','nyanko-signature-algorithm':'HMACSHA256','user-agent':AGENT};
  }
  async function post(step,account,url,obj,token){
    const payload=body(obj),headers=signed(account,payload);if(token)headers.authorization='Bearer '+token;
    const r=await http(step,'POST',url,headers,payload);
    if(r.data?.statusCode!==1)throw new PonosError(`STATUS_${r.data?.statusCode??r.status}`,step,{status:r.status});
    return {payload:r.data.payload||{},timestamp:r.data.timestamp??null};
  }

  // Transfer code reception. Returns {save bytes, refreshToken, password} or throws.
  async function receive(transferCode,pin,cc,gameVersion){
    const payload=body({clientInfo:{client:{countryCode:regionCode(cc),version:gameVersion},device:{model:'SM-G955F'},os:{type:'android',version:'9'}},nonce:randomHex(32),pin});
    const r=await http('RECEIVE','POST',`${HOST.save}/v2/transfers/${encodeURIComponent(transferCode)}/reception`,{'content-type':'application/json','accept-encoding':'gzip',connection:'keep-alive','user-agent':AGENT},payload,{json:false});
    if((r.headers.get('content-type')||'')!=='application/octet-stream')throw new PonosError('CODES_REJECTED','RECEIVE',{status:r.status});
    return {bytes:r.body,refreshToken:r.headers.get('nyanko-password-refresh-token'),password:r.headers.get('nyanko-password')};
  }

  // One account (the SAVE being uploaded). store: {get():object|null, set(object)} for {password, token} of this
  // account; changes to the SAVE's own account fields are written into `save` before anything is uploaded.
  function account(save,store={get:()=>null,set:()=>{}}){
    // The account's identity is kept here and written into whichever SAVE is uploaded, so credentials fetched early
    // (prepare) still land in the SAVE that is finally edited and sent.
    const d=save.data,ident={code:text(d.inquiryCode),refresh:text(d.passwordRefreshToken),createdAt:Math.trunc(Number(d.energyPenaltyTimestamp)),penalty:null};
    const acc={get code(){return ident.code;}};
    let creds={...(store.get()||{})},key=null,keyTask=null;
    const keep=()=>store.set({password:creds.password||null,token:creds.token||null,code:acc.code});
    const clientInfo=()=>({clientInfo:{client:{countryCode:regionCode(save.cc),version:save.gameVersion},device:{model:'SM-G955F'},os:{type:'android',version:'9'}},nonce:randomHex(32)});
    // A password answer can carry a new account code (PONOS moved the account): the SAVE follows it, and the item
    // amounts are reported for the new code, as the game does.
    async function adoptPassword(result){
      const {password,passwordRefreshToken,accountCode}=result.payload;
      if(!password||!passwordRefreshToken)throw new PonosError('NO_PASSWORD','PASSWORD');
      ident.refresh=String(passwordRefreshToken);creds={password};
      if(accountCode&&accountCode!==acc.code){
        ident.code=String(accountCode);
        if(result.timestamp!=null)ident.penalty=Math.trunc(Number(result.timestamp));
        keep();const token=await tokenFor(password);
        await post('MANAGED_ITEMS',acc,`${HOST.managed}/v1/managed-items`,{catfoodAmount:d.catfood,isPaid:true,legendTicketAmount:d.legendTickets,nonce:randomHex(32),platinumTicketAmount:d.platinumTickets,rareTicketAmount:d.rareTickets},token);
      }
      keep();return password;
    }
    async function tokenFor(password){
      const r=await post('TOKEN',acc,`${HOST.auth}/v1/tokens`,{...clientInfo(),password,accountCode:acc.code});
      if(!r.payload.token)throw new PonosError('NO_TOKEN','TOKEN');
      creds={...creds,password,token:r.payload.token};keep();return creds.token;
    }
    // A valid token: the cached one, else from the cached password, else from a refreshed password, else from a
    // password registered for this account (accounts that never had one). No new account is ever made here.
    // safe: only what never changes the account (a cached token, or a token from the cached password). Refreshing
    // or registering a password changes the account at PONOS, so it waits until the member actually saves.
    async function token({safe=false}={}){
      const sameAccount=creds.code===undefined||creds.code===acc.code;
      if(creds.token&&sameAccount&&tokenExpiry(creds.token)-TOKEN_MARGIN_MS>now())return creds.token;
      if(!sameAccount)creds={};
      if(creds.password){try{return await tokenFor(creds.password);}catch(err){if(err.code==='NO_CONNECTION'||safe)throw err;creds={};}}
      if(safe)throw new PonosError('NEEDS_SIGN_IN','PREPARE');
      let password;
      try{password=await adoptPassword(await post('PASSWORD',acc,`${HOST.auth}/v1/user/password`,{accountCode:acc.code,passwordRefreshToken:ident.refresh,nonce:randomHex(32)}));}
      catch(err){if(err.code==='NO_CONNECTION')throw err;password=await adoptPassword(await post('PASSWORD',acc,`${HOST.auth}/v1/users`,{accountCode:acc.code,accountCreatedAt:ident.createdAt,nonce:randomHex(32)}));}
      // A moved account already got its token while reporting item amounts.
      return creds.token&&creds.password===password?creds.token:tokenFor(password);
    }
    async function saveKey(opts){
      const t=await token(opts);
      const r=await http('SAVE_KEY','GET',`${HOST.save}/v2/save/key?nonce=${randomHex(32)}`,{'accept-encoding':'gzip',connection:'keep-alive',authorization:'Bearer '+t,'nyanko-timestamp':String(Math.floor(now()/1000)),'user-agent':AGENT});
      if(r.data?.statusCode!==1||!r.data.payload?.key)throw new PonosError(`STATUS_${r.data?.statusCode??r.status}`,'SAVE_KEY',{status:r.status});
      key=r.data.payload;return key;
    }
    const keyFresh=()=>key&&(keyExpiry(key)===0||keyExpiry(key)-KEY_MARGIN_MS>now());
    // Credentials and a save key ahead of the upload (safe to call while the member edits; errors surface on upload).
    // While the member edits: a token and a save key if that is possible without changing the account.
    function prepare(){if(!keyTask)keyTask=saveKey({safe:true}).catch(err=>{keyTask=null;throw err;});keyTask.catch(()=>{});return keyTask;}
    // When the member saves: everything needed for the upload (may refresh the password).
    async function ready(){if(keyTask){try{await keyTask;}catch{}}if(!keyFresh()){key=null;keyTask=null;await saveKey();}return key;}
    // Uploads the SAVE and returns {transferCode, confirmationCode}. serialize(save) -> bytes is called after the
    // account fields are final. On success the editor's item records are cleared from `save`.
    // Writes the current identity into a SAVE (the one being uploaded).
    function stamp(target){
      const t=target.data;
      if(text(t.inquiryCode)!==ident.code)t.inquiryCode=new SaveString(Buffer.from(ident.code,'utf8'));
      if(text(t.passwordRefreshToken)!==ident.refresh)t.passwordRefreshToken=new SaveString(Buffer.from(ident.refresh,'utf8'));
      if(ident.penalty!==null)t.energyPenaltyTimestamp=new SaveDouble(ident.penalty);
    }
    // upload(target, serialize) or upload(serialize) for the SAVE given to account().
    async function upload(target,serialize){
      if(typeof target==='function'){serialize=target;target=save;}
      target.data.showBanMessage=false;
      await ready();
      const k=key;stamp(target);const changes=managedChanges(target);
      const restore=withoutEditorEntries(target);let bytes;try{bytes=serialize(target);}finally{restore();}
      const boundary=crypto.randomBytes(16).toString('hex'),parts=[];
      for(const [name,value] of Object.entries(k))if(name!=='url')parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\nContent-Type: text/plain\r\n\r\n${value}\r\n`,'utf8'));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="file.sav"\r\nContent-Type: application/octet-stream\r\n\r\n`,'utf8'),bytes,Buffer.from(`\r\n--${boundary}--\r\n`,'utf8'));
      let s3;try{s3=await http('UPLOAD','POST',k.url||`${HOST.s3}/`,{'accept-encoding':'gzip',connection:'keep-alive','user-agent':AGENT,'content-type':`multipart/form-data; boundary=${boundary}`},Buffer.concat(parts),{json:false});}
      catch(err){throw new PonosError(err.code||'NO_CONNECTION','UPLOAD',{uploadPossible:true});}
      if(s3.status!==204)throw new PonosError(`HTTP_${s3.status}`,'UPLOAD',{uploadPossible:s3.status>=500,status:s3.status});
      key=null;keyTask=null;
      const items=changes.map(m=>({amount:m.amount,detailCode:uuid(),detailCreatedAt:m.at,detailType:m.detail,managedItemType:m.type}));
      const salt=randomHex(40),itemsJson=body(items);
      const meta={managedItemDetails:items,nonce:randomHex(32),playTime:target.data.officerPassPlayTime,rank:collections.userRank(target),receiptLogIds:[],
        signature_v1:salt+crypto.createHmac('sha1',acc.code+salt).update(itemsJson+itemsJson).digest('hex'),saveKey:k.key};
      let r;try{r=await post('TRANSFER',acc,`${HOST.save}/v2/transfers`,meta,creds.token);}
      catch(err){err.uploadPossible=true;if(/^STATUS_/.test(err.code)){creds={...creds,token:null};keep();}throw err;}
      const {transferCode,pin}=r.payload;if(!transferCode||!pin)throw new PonosError('NO_CODES','TRANSFER',{uploadPossible:true});
      target.data.orderIds=target.data.orderIds.filter(entry=>!records.isKind(entry,'managed_items'));
      return {transferCode:String(transferCode),confirmationCode:String(pin),bytes};
    }
    return {prepare,ready,upload,stamp,get code(){return acc.code;}};
  }
  // After reception: the refresh token the server sent goes into the SAVE (the game's own field).
  function adoptReception(save,received){if(received.refreshToken)save.data.passwordRefreshToken=new SaveString(Buffer.from(String(received.refreshToken),'utf8'));}
  return {receive,account,adoptReception};
}
module.exports={createPonos,PonosError,managedChanges,HOST};
