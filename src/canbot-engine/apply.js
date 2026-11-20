// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// A whole SAVE request's edit list: Max Account / Max All first, then the other edits in order; user-rank rewards
// claimed around each edit when the session asks for it; managed-item records reconciled to one net change at the end.
const items=require('./items'),cats=require('./cats'),levels=require('./levels'),talents=require('./talents'),story=require('./story');
const maps=require('./maps'),expedition=require('./expedition'),collections=require('./collections'),extra=require('./extra');
const {maxAccount,maxResources}=require('./maxaccount');
const misc=require('./misc'),settingsModule=require('./settings');
const fail=(code,message)=>Object.assign(new Error(message),{code});
const MANAGED=Object.keys(items.MANAGED);
const BROAD=new Set(['max_account','max_all']);
const SUPPORTED_TYPES=new Set(['item','cat','max_all','max_account','story_clear','treasures','timed_scores','outbreaks','playtime','inventory','gacha_seed','special_skills','map','map_batch','expedition','collection','extra','clear_to_japan','simple','score']);
const CAT_LEVEL=new Set(['max_upgrade','upgrade_by','set_level','max_base_plus','max_talents','storage_add']);

function unsupportedReason(edits,settings){
  for(const e of edits){
    if(!SUPPORTED_TYPES.has(e?.type))return `type:${String(e?.type).slice(0,30)}`;
    if(e.type==='cat'&&!cats.OPERATIONS.includes(e.operation)&&!CAT_LEVEL.has(e.operation))return `cat:${String(e.operation).slice(0,30)}`;
  }
  return '';
}
function claimRankRewards(save,gd){
  const gifts=gd.rankGifts();if(!gifts)throw fail('RANK_REWARDS_UNAVAILABLE','User-rank reward metadata unavailable.');
  const rank=collections.userRank(save),rewards=save.data.userRankRewards;
  for(const g of gifts)if(g.threshold<=rank){if(!(g.index>=0&&g.index<rewards.length))throw fail('RANK_REWARDS_UNAVAILABLE','User-rank reward data is incomplete.');rewards[g.index]=true;}
}
function catIds(edit){
  const ids=edit.catIds??[edit.catId];if(!Array.isArray(ids)||!ids.length)throw fail('INVALID_INPUT','catIds must contain at least one Cat ID.');
  for(const v of ids)if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw fail('INVALID_INPUT','catId must be an integer >= 0.');
  return [...new Set(ids)];
}
function applyOne(save,gd,edit,opts){
  const t=edit.type,d=save.data;
  if(t==='item')return items.setItem(save,edit.item,edit.value,{now:()=>Math.floor(opts.now())});
  if(t==='max_all')return maxResources(save,{now:opts.now});
  if(t==='max_account')return maxAccount(save,gd,edit,{now:opts.now});
  if(t==='cat'){
    const ids=catIds(edit),op=edit.operation;
    if(op==='storage_add')return misc.storageAdd(save,ids,edit.amount);
    if(op==='max_talents')return talents.maxTalents(save,gd,ids);
    if(op==='max_base_plus'){levels.maxBasePlus(save,gd,ids);d.rankUpSaleValue=0x7fffffff;return;}
    if(op==='set_level'){levels.setLevel(save,gd,ids,edit.base,edit.plus);d.rankUpSaleValue=0x7fffffff;return;}
    if(op==='max_upgrade'){levels.maxUpgrade(save,gd,ids);d.rankUpSaleValue=0x7fffffff;return;}
    if(op==='upgrade_by'){levels.upgradeBy(save,gd,ids,edit.amount);d.rankUpSaleValue=0x7fffffff;return;}
    return cats.applyCatOperation(save,gd,op,ids);
  }
  if(['story_clear','treasures','timed_scores','outbreaks'].includes(t))return story.applyStory(save,edit,{random:opts.random});
  if(t==='playtime')return story.setPlaytime(save,edit);
  if(t==='inventory')return story.setInventory(save,edit);
  if(t==='gacha_seed')return story.setSeed(save,edit);
  if(t==='special_skills')return story.setSkills(save,gd);
  if(t==='map')return maps.applyMap(save,gd,edit);
  if(t==='map_batch')return maps.applyMapBatch(save,gd,edit);
  if(t==='expedition')return expedition.apply(save,gd,edit);
  if(t==='collection')return collections.apply(save,gd,edit,{now:opts.now});
  if(t==='extra')return extra.apply(save,edit,{now:()=>Math.floor(opts.now()),random:opts.random});
  if(t==='clear_to_japan')return misc.clearToJapan(save,gd);
  if(t==='simple')return misc.simpleAction(save,edit,{now:opts.now,random:opts.random});
  if(t==='score')return misc.setScore(save,edit);
  throw fail('UNSUPPORTED_EDIT',`Unsupported edit type: ${t}`);
}
// opts: {now: () => seconds, random: () => [0,1)}.
function applyEdits(save,gd,edits,settings={},opts={}){
  const o={now:opts.now||(()=>Date.now()/1000),random:opts.random||Math.random};
  const touched=new Set();for(const e of edits){if(BROAD.has(e.type))MANAGED.forEach(n=>touched.add(n));else if(e.type==='item'&&MANAGED.includes(e.item))touched.add(e.item);}
  const original={};for(const n of touched){const v=save.data[items.FIELD[n]];if(Number.isSafeInteger(v))original[n]=v;}
  const plan=[...edits.filter(e=>BROAD.has(e.type)),...edits.filter(e=>!BROAD.has(e.type))];
  for(const e of plan){
    const claim=(e.settings||settings).claim_user_rank_rewards===true;
    // Settings: the edit's own or the request's, one edit at a time.
    settingsModule.use(settingsModule.fromSession(e.settings||settings),()=>{
      if(claim)claimRankRewards(save,gd);
      applyOne(save,gd,e,o);
      if(claim)claimRankRewards(save,gd);
    });
  }
  items.reconcileManaged(save,original,[...touched].filter(n=>n in original),{now:()=>Math.floor(o.now())});
}
module.exports={applyEdits,unsupportedReason,SUPPORTED_TYPES};
