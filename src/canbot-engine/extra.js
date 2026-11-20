// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Additional single operations (rare ticket trade, gold pass, slots, aku realm, ...).
const {SaveDouble}=require('./binary');
const fail=(code,message)=>Object.assign(new Error(message),{code});
function integer(v,max,name='Value'){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw fail('INVALID_INPUT',`${name} must be an integer between 0 and ${max}.`);return v;}
const LIMITS={rareTickets:299,hundredMillion:9999,stageClear:9999};
const MIN_VERSION={gold_add:80000,gold_remove:80000,aku:100900,hundred_million:140200};

function metadata(save,op){
  const min=MIN_VERSION[op];if(min!==undefined&&save.gameVersion<min)throw fail('EXTRA_UNSUPPORTED_VERSION','Not stored by this game version.');
  const d=save.data;
  if(op==='rare_trade')return {fields:[{id:'value',max:Math.min(Math.max(LIMITS.rareTickets-d.rareTickets,0),Math.floor(2147483647/5))}]};
  if(op==='hundred_million')return {fields:[{id:'value',max:require('./settings').cap(LIMITS.hundredMillion)}]};
  if(op==='slots'){let cap=Math.min(d.lineups.length,save.gameVersion<90700?10:127);if(save.gameVersion>=91000)cap=Math.min(cap,d.lineupNames.n);if(cap<=0)throw fail('LINEUP_LAYOUT_UNAVAILABLE','Lineups are unavailable.');return {fields:[{id:'value',max:cap}]};}
  if(op==='aku'){const st=d.aku?.clears?.[0]?.[0];if(!st||!st.length)throw fail('AKU_LAYOUT_UNAVAILABLE','Aku stages are unavailable.');return {fields:[{id:'progress',max:st.length},{id:'count',max:require('./settings').cap(LIMITS.stageClear,15)}]};}
  if(op==='gold_add')return {fields:[{id:'value',max:2147483647}]};
  if(op==='gold_remove')return {fields:[]};
  throw fail('INVALID_INPUT','Unsupported operation.');
}
const dbl=v=>new SaveDouble(v);
function resetLogin(save){const row=save.data.logins.find(p=>p[0]===5100);if(row)row[1]=0;}

function apply(save,edit,{now=()=>Math.floor(Date.now()/1000),random=Math.random}={}){
  const op=edit.operation,meta=metadata(save,op),v=Object.fromEntries(meta.fields.map(f=>[f.id,integer(edit[f.id],f.max)])),d=save.data;
  if(op==='rare_trade'){
    const i=d.storageTypes.findIndex((t,k)=>t===0||(t===2&&d.storageIds[k]===1));
    if(meta.fields[0].max===0||i<0)throw fail('INVALID_INPUT','No ticket capacity or storage space.');
    d.storageTypes[i]=2;d.storageIds[i]=1;d.gachaTradeProgress=v.value*5;
  }
  else if(op==='hundred_million')d.hundredMillionTicket=v.value;
  else if(op==='slots')d.unlockedLineups=v.value;
  else if(op==='aku'){const st=d.aku.clears[0][0];st.forEach((_,i)=>{st[i]=i<v.progress?v.count:0;});}
  else if(op==='gold_add'){
    const g=d.goldPass,id=v.value||(1+Math.floor(random()*(2**16-1))),start=now(),end=start+30*86400,endTotal=start+60*86400;
    g.officerId=id;g.renewals=2;g.startNow=dbl(start);g.endNow=dbl(end);g.startNext=dbl(end);g.endNext=dbl(endTotal);g.startTotal=dbl(start);g.endTotal=dbl(endTotal);
    g.timeErrorEnd=dbl(start);g.stateUpdates=2;g.loginBonusDate=dbl(end);g.remainingDaysPopup=dbl(0);g.firstPopup=1;if('badge' in g)g.badge=0;
    resetLogin(save);g.claimedRewards=[];
  }
  else if(op==='gold_remove')removeGoldPass(save);
}
// Removes the Gold Pass (also used by the Officer Pass fix).
function removeGoldPass(save){
  const g=save.data.goldPass;g.officerId=-1;g.renewals=0;for(const k of ['startNow','endNow','startNext','endNext','startTotal','endTotal','timeErrorEnd','loginBonusDate','remainingDaysPopup'])g[k]=dbl(0);
  g.stateUpdates=0;g.firstPopup=0;if('badge' in g)g.badge=0;resetLogin(save);g.claimedRewards=[];
}

module.exports={apply,metadata,removeGoldPass};
