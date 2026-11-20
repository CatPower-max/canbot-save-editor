// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Gamatoto, Cat Shrine and Ototo edits.
const {SaveDouble}=require('./binary');
const fail=(code,message)=>Object.assign(new Error(message),{code});
function integer(v,max,name='Value'){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw fail('INVALID_INPUT',`${name} must be an integer between 0 and ${max}.`);return v;}

// Gamatoto level -> XP: level 1 is 0, else the xp of row level-2.
function xpFromLevel(levels,level){if(!levels)return null;level-=1;if(level<1)return 0;return levels[level-1]?.xpNeeded??null;}
// Shrine XP -> level and level -> XP over the cumulative boundaries.
function shrineLevel(b,xp){if(!b)return null;for(let i=0;i<b.length;i++)if(xp<b[i])return i+1;return b.length;}
function shrineXp(b,level){if(!b)return null;if(level<1)return 0;if(level>b.length)return Math.max(...b);return b[level-2];}

function rarityNames(members){if(!members)return null;const names=new Map();for(const m of members)names.set(m.rarity,m.rarityName);const out=[];for(let i=0;i<names.size;i++){if(!names.has(i))throw fail('INVALID_INPUT','Gamatoto game data is unavailable.');out.push(names.get(i));}return out;}
const maxPartLevel=(recipes,part)=>recipes?recipes.reduce((m,r)=>r.part===part&&r.level>m?r.level:m,0):null;
const maxLevel=(recipes,cannon,part)=>recipes?recipes.reduce((m,r)=>r.cannon===cannon&&r.part===part&&r.level>m?r.level:m,0):null;

function metadata(save,gd){
  const limit=gd.gamatotoLimit(),members=gd.gamatotoMembers(save.cc),rarities=rarityNames(members);
  if(!limit||rarities===null)throw fail('INVALID_INPUT','Gamatoto game data is unavailable.');
  const descriptions=gd.cannonDescriptions(save.cc),recipes=gd.recipeUnlocks();
  for(const [id,cannon] of save.data.ototoCannons){
    if(!descriptions?.some(d=>d.cannonId===id))throw fail('INVALID_INPUT','Cannon game data is unavailable.');
    for(let p=0;p<cannon.levels.length;p++)if(maxPartLevel(recipes,p)===null)throw fail('INVALID_INPUT','Cannon game data is unavailable.');
  }
  return {maxLevel:limit.maxLevel,maxHelpers:limit.totalHelpers,rarities,rarityCounts:rarities.map((_,i)=>members.filter(m=>m.rarity===i).length),engineerMax:gd.maxEngineers(),members};
}
function shrineLimits(gd,cc){const b=gd.shrineBoundaries(cc);if(!b)throw fail('INVALID_INPUT','Cat Shrine data unavailable.');return {b,max:b.length,maxXp:b.length?Math.max(...b):undefined};}
const setShrineDialogs=(save,v)=>{if('shrineDialogs' in save.data)save.data.shrineDialogs=v;};

function maxAccount(save,gd){
  const data=metadata(save,gd),levels=gd.gamatotoLevels(),xp=xpFromLevel(levels,data.maxLevel);
  if(xp===null)throw fail('INVALID_INPUT','Gamatoto level data unavailable.');
  const highest=data.members.filter(m=>m.rarity===data.rarities.length-1);
  if(highest.length<data.maxHelpers)throw fail('INVALID_INPUT','Highest-rarity helper data unavailable.');
  const {b,max}=shrineLimits(gd,save.cc),sxp=shrineXp(b,max);if(sxp===null||sxp===undefined)throw fail('INVALID_INPUT','Cat Shrine level data unavailable.');
  const cannons=save.data.ototoCannons;if(!cannons.length)throw fail('INVALID_INPUT','Ototo cannon data unavailable.');
  const recipes=gd.recipeUnlocks(),plans=cannons.map(([id,c])=>[c,c.levels.map((_,p)=>{const m=maxLevel(recipes,id,p);if(m===null)throw fail('INVALID_INPUT','Ototo cannon limits unavailable.');return p===0?m-1:m;})]);
  save.data.gamatoto.xp=xp;
  save.data.gamatotoHelpers=highest.slice(0,data.maxHelpers).map(m=>m.id);
  save.data.catShrine.xpOffering=BigInt(sxp);setShrineDialogs(save,max-1);
  save.data.ototoEngineers=data.engineerMax;
  for(const [c,values] of plans){c.development=Math.max(c.development,3);c.levels=values;}
}

function apply(save,gd,edit){
  const op=edit.operation,d=save.data;
  if(['shrine_level','shrine_xp','shrine_appear','shrine_disappear'].includes(op)){
    const {b,max,maxXp}=shrineLimits(gd,save.cc);
    if(op==='shrine_level'){const v=integer(edit.value,max);if(v<1)throw fail('INVALID_INPUT','Shrine level must be at least 1.');d.catShrine.xpOffering=BigInt(v===1?0:shrineXp(b,v));}
    else if(op==='shrine_xp')d.catShrine.xpOffering=BigInt(integer(edit.value,maxXp));
    else if(op==='shrine_appear'){d.catShrine.gone=0;d.catShrine.stamp1=new SaveDouble(0);d.catShrine.stamp2=new SaveDouble(0);}
    else d.catShrine.gone=1;
    const level=shrineLevel(b,Number(d.catShrine.xpOffering));if(level===null)throw fail('INVALID_INPUT','Cat Shrine level unavailable.');
    setShrineDialogs(save,level-1);
  }
  else if(op==='xp')d.gamatoto.xp=integer(edit.value,2**31-1);
  else if(op==='level'){const limit=gd.gamatotoLimit();if(!limit)throw fail('INVALID_INPUT','Level data is unavailable.');const v=integer(edit.value,limit.maxLevel);if(v<1)throw fail('INVALID_INPUT','Level must be at least 1.');const xp=xpFromLevel(gd.gamatotoLevels(),v);if(xp===null)throw fail('INVALID_INPUT','Level data is unavailable.');d.gamatoto.xp=xp;}
  else if(op==='engineers')d.ototoEngineers=integer(edit.value,gd.maxEngineers());
  else if(op==='helpers'){
    const data=metadata(save,gd),counts=edit.counts;
    if(!Array.isArray(counts)||counts.length!==data.rarities.length)throw fail('INVALID_INPUT','Invalid helper counts.');
    counts.forEach((c,i)=>integer(c,data.rarityCounts[i]));
    if(counts.reduce((a,c)=>a+c,0)>data.maxHelpers)throw fail('INVALID_INPUT','Too many helpers.');
    d.gamatotoHelpers=counts.flatMap((c,r)=>data.members.filter(m=>m.rarity===r).slice(0,c).map(m=>m.id));
  }
  else if(op==='cannon_levels'||op==='cannon_development'){
    const row=d.ototoCannons.find(p=>p[0]===edit.cannonId);if(typeof edit.cannonId==='boolean'||!row)throw fail('INVALID_INPUT','Invalid cannon.');
    const c=row[1];
    if(op==='cannon_development'){const v=integer(edit.value,3);if(edit.cannonId===0)throw fail('INVALID_INPUT','Normal cannon has no development selector.');c.development=v;}
    else{
      const values=edit.levels;if(!Array.isArray(values)||values.length!==c.levels.length)throw fail('INVALID_INPUT','Invalid cannon levels.');
      const recipes=gd.recipeUnlocks();values.forEach((v,p)=>{const m=maxPartLevel(recipes,p);if(m===null)throw fail('INVALID_INPUT','Cannon limits unavailable.');integer(v,m);});
      c.development=Math.max(c.development,3);c.levels=values.map((v,p)=>p===0?v-1:v);
    }
  }
  else throw fail('INVALID_INPUT','Unsupported expedition edit.');
}

module.exports={apply,maxAccount,metadata,maxPartLevel,shrineLimits,rarityNames};
