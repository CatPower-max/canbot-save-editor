// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Cat level edits. Stored base levels are zero-based (level 1 = base 0).
//
// A cat climbs one level at a time. Under its cap it takes a normal level-up; at the cap, a cat of rarity above
// Normal whose level is in its catseye range climbs with a catseye (counted in catsCatseyesUsed and in the cap record)
// up to its catseye maximum. The cap is the unit's original maximum plus the cat's cap record (catsMaxUpgrade.base),
// which is rebuilt from the user-rank gifts that raise this unit's limit.
//
// Strict upgrade (session setting) follows the SAVE more closely: only claimed rank gifts count, a cat held at its
// special level needs upgrade state 2 for a normal level-up, and catseye levels need user rank 1600 (re-read at every
// step, since levelling raises the rank). Without strict upgrade none of these restrict anything.
const {unlock}=require('./cats');
const settings=require('./settings');
const fail=(code,message,extra={})=>Object.assign(new Error(message),{code,...extra});
const setAt=(list,i,v)=>{if(Array.isArray(list)&&i>=0&&i<list.length)list[i]=v;};
const CATSEYE_RANK=1600;

// Rebuilds the cap record from the rank gifts whose rewards are this unit's limit ids (1000-1599 raise the base cap,
// 4000-4599 the plus cap). Units without limit data keep their record. Returns the base bonus for this edit.
function rebuildCapRecord(save,gd,id,strict){
  const record=save.data.catsMaxUpgrade[id],limitIds=gd.unitLimit()?.[id]??null;
  if(!limitIds)return record.base;
  record.base=0;record.plus=0;
  const gifts=gd.rankGifts(),claimed=save.data.userRankRewards;
  for(let r=0;r<claimed.length;r++){
    const gift=gifts&&r<gifts.length?gifts[r]:null;
    if(!gift||(strict&&!claimed[r]))continue;
    for(const [reward,amount] of gift.rewards){
      const hits=limitIds.filter(l=>l===reward).length;if(!hits)continue;
      if(reward>=1000&&reward<=1599)record.base+=amount*hits;
      else if(reward>=4000&&reward<=4599)record.plus+=amount*hits;
    }
  }
  return record.base;
}

// One cat's levelling for this edit. Creating it rebuilds the cap record.
function climber(save,gd,id){
  const cfg=settings.get(),strict=cfg.strictUpgrade;
  const unit=gd.unitBuy()?.[id]??null,record=save.data.catsMaxUpgrade[id],bonus=rebuildCapRecord(save,gd,id,strict);
  const up=save.data.catsUpgrade[id];
  const touch=()=>{if(cfg.unlockOnEdit)unlock(save,gd,id);};
  const inCatseyeRange=lv=>unit.rarity!==0&&lv>=unit.maxNoCatseye&&lv<unit.maxCatseye;

  // 'normal', 'catseye' or null for a cat at level lv (1-based) under the cap.
  function nextStep(lv,cap){
    if(lv<cap){
      const held=strict&&lv===unit.unknown22&&save.data.upgradeState<2;
      if(!held||inCatseyeRange(lv))return 'normal';
    }
    const rankOk=!strict||require('./collections').userRank(save)>=CATSEYE_RANK;
    if(unit.maxNoCatseye!==-1&&unit.maxNoCatseye<=cap&&inCatseyeRange(lv)&&rankOk)return 'catseye';
    return null;
  }
  function step(){
    if(!unit)return false;
    const kind=nextStep(up.base+1,Math.min(unit.originalMax[0]+bonus,unit.maxCatseye));
    if(!kind)return false;
    touch();up.base+=1;
    if(kind==='catseye'){setAt(save.data.catsCatseyesUsed,id,(save.data.catsCatseyesUsed[id]??0)+1);record.base+=1;}
    return true;
  }
  return {
    unit,
    climbAll(){while(step());},
    climb(n){for(let i=0;i<n&&step();i++);},
    reset(){up.base=0;setAt(save.data.catsCatseyesUsed,id,0);},
    setPlus(plus){touch();up.plus=plus;},
    maxBase:()=>unit?unit.maxCatseye:90,
    maxPlus:()=>unit?unit.maxPlus:90,
  };
}

// CanBot's rule: keep the SAVE's own cap record unless the new level needs more under the cap formula.
function keepCapRecords(save,gd,ids,run){
  const snapshot=ids.map(id=>[id,save.data.catsMaxUpgrade[id].base,save.data.catsMaxUpgrade[id].plus]);
  try{return run();}
  finally{
    for(const [id,base,plus] of snapshot){
      const record=save.data.catsMaxUpgrade[id],row=gd.unitBuy()?.[id];
      if(!row){record.base=base;record.plus=plus;continue;}
      const up=save.data.catsUpgrade[id];
      record.base=up.base+1<=row.originalMax[0]+base?base:Math.max(base,record.base);
      record.plus=up.plus<=row.originalMax[1]+plus?plus:Math.max(plus,record.plus);
    }
  }
}
const unavailable=()=>fail('CAT_LEVEL_METADATA_UNAVAILABLE','Level data is unavailable.');
function climbers(save,gd,ids,{requireAll=false}={}){
  const cs=ids.map(id=>climber(save,gd,id));
  if(requireAll?cs.some(c=>!c.unit):cs.length&&cs.every(c=>!c.unit))throw requireAll?fail('CAT_LEVEL_METADATA','Level data is unavailable.'):unavailable();
  return cs;
}

function maxUpgrade(save,gd,ids){keepCapRecords(save,gd,ids,()=>climbers(save,gd,ids).forEach(c=>c.climbAll()));}
function upgradeBy(save,gd,ids,amount){
  if(!Number.isSafeInteger(amount)||amount<=0)throw fail('INVALID_INPUT','amount must be greater than 0.');
  keepCapRecords(save,gd,ids,()=>climbers(save,gd,ids).forEach(c=>c.climb(amount)));
}
function setLevel(save,gd,ids,base,plus){
  keepCapRecords(save,gd,ids,()=>{
    const cs=climbers(save,gd,ids,{requireAll:true});
    if(!Number.isSafeInteger(base)||!Number.isSafeInteger(plus))throw fail('INVALID_INPUT','base and plus must be integers.');
    if(base<1)throw fail('INVALID_INPUT','Base level must be at least 1.');
    for(const c of cs)if(base>c.maxBase()||plus>c.maxPlus())throw fail('CAT_LEVEL_LIMIT','Level is above the limit.');
    cs.forEach((c,i)=>{
      c.reset();c.climb(base-1);c.setPlus(plus);
      const up=save.data.catsUpgrade[ids[i]];if(up.base!==base-1||up.plus!==plus)throw fail('CAT_LEVEL_UNREACHABLE','That level cannot be reached.');
    });
  });
}
// Max base and plus: every cat must have catalog limits; each climbs as far as it can and takes the catalog plus, and
// the result must be the catalog maximum.
function maxBasePlus(save,gd,ids){
  keepCapRecords(save,gd,ids,()=>{
    const rows=gd.unitBuy();if(!rows)throw unavailable();
    const expected=ids.map(id=>{const row=rows[id];if(!row)throw unavailable();if(row.maxCatseye<1||row.maxPlus<0)throw fail('CAT_LEVEL_UNSUPPORTED','Unsupported level data.');return [row.maxCatseye-1,row.maxPlus];});
    const cs=ids.map(id=>climber(save,gd,id));
    cs.forEach((c,i)=>{c.climbAll();c.setPlus(expected[i][1]);});
    cs.forEach((c,i)=>{const up=save.data.catsUpgrade[ids[i]];if(up.base!==expected[i][0]||up.plus!==expected[i][1])throw fail('CAT_LEVEL_BACKEND_FAILURE','Level did not reach the maximum.');});
  });
}

module.exports={maxUpgrade,upgradeBy,setLevel,maxBasePlus,climber};
