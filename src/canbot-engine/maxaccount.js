// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Max Account: one composite edit, in this order:
// resources, cats (unlock, levels, forms, guide, talents), special skills, Gamatoto/Ototo, talent orbs, enemy guide,
// tutorial, story, treasures, outbreaks, then the selected map categories.
const fail=(code,message,extra={})=>Object.assign(new Error(message),{code},extra);
const cats=require('./cats'),levels=require('./levels'),talents=require('./talents'),story=require('./story');
const maps=require('./maps'),expedition=require('./expedition'),collections=require('./collections'),items=require('./items');

const COMPONENTS=['resources','cats','specialSkills','expedition','talentOrbs','enemyGuide','story','treasures','outbreaks','tutorial'];
const MAX={catfood:45000,xp:99999999,normal:2999,hundredMillion:9999,rare:299,platinum:9,legend:4,np:9999,leadership:9999,battleItems:9999,catamins:9999,catseyes:9999,labyrinth:9999,chests:9999};

// Resources at their maximums. Catfood and the rare/platinum/legend tickets record their change (none for 0).
function maxResources(save,{now}){
  const d=save.data;
  const managed=(field,type,value)=>{const change=value-d[field];d[field]=value;if(change){const list=items.managedItems(save).filter(m=>m.amount!==0);list.push({amount:Math.abs(change),at:Math.floor(now()),type,detail:change>0?'get':'use'});items.setManagedItems(save,list);}};
  managed('catfood','catfood',MAX.catfood);d.xp=MAX.xp;d.normalTickets=MAX.normal;
  managed('rareTickets','rareTicket',MAX.rare);managed('platinumTickets','platinumTicket',MAX.platinum);managed('legendTickets','legendTicket',MAX.legend);
  if('platinumShards' in d)d.platinumShards=10*MAX.platinum;
  d.np=MAX.np;d.leadership=MAX.leadership;d.battleItems.fill(MAX.battleItems);d.catamins.fill(MAX.catamins);d.catseyes.fill(MAX.catseyes);
  d.labyrinth?.medals?.items?.fill(MAX.labyrinth);d.treasureChests?.items?.fill(MAX.chests);
  if('hundredMillionTicket' in d)d.hundredMillionTicket=MAX.hundredMillion;
}
function maxCats(save,gd,at){
  const book=gd.pictureBook(),rows=gd.unitBuy();
  if(!book||!rows)throw fail('CAT_LEVEL_METADATA_UNAVAILABLE','Level data is unavailable.');
  const shown=new Set(book.filter(c=>c.displayed).map(c=>c.catId));
  const obtainable=save.data.catsUnlocked.map((_,id)=>id).filter(id=>shown.has(id));
  const eligible=[];
  for(const id of obtainable){const row=rows[id];if(!row||row.gameVersion===-1)throw fail('CAT_LEVEL_METADATA_UNAVAILABLE','Level data is unavailable.');if(row.gameVersion<=save.gameVersion)eligible.push(id);}
  at('cat_unlock');for(const id of eligible)cats.unlock(save,gd,id);
  at('cat_levels');if(eligible.length)levels.maxBasePlus(save,gd,eligible);
  at('cat_forms');cats.forms(save,gd,eligible,{fourth:false});cats.forms(save,gd,eligible,{fourth:true});
  at('cat_guide');for(const id of eligible){cats.editUnlock(save,gd,id);save.data.catGuideCollected[id]=1;}
  at('cat_talents');const outcome=eligible.length?talents.maxTalents(save,gd,eligible,{composite:true}):null;
  at('cat_rank_sale');save.data.rankUpSaleValue=0x7fffffff;
  return outcome;
}

// edit: {components:{name:bool}, mapCategories:[...]}; now(): seconds, for the managed-item records.
function maxAccount(save,gd,edit={},{now=()=>Date.now()/1000}={}){
  const components=edit.components??{};
  if(typeof components!=='object'||Array.isArray(components)||Object.entries(components).some(([k,v])=>!COMPONENTS.includes(k)||typeof v!=='boolean'))throw fail('INVALID_INPUT','Invalid Max Account component policy.');
  const on=k=>components[k]??true;
  let component='maps_prepare',outcome=null;
  try{
    const plans=maps.prepareCategories(save,gd,edit.mapCategories??[]);
    if(!COMPONENTS.some(on)&&!plans.length)throw fail('INVALID_INPUT','Max Account has no enabled components or selected maps.',{policy:true});
    component='story_metadata';
    const chapters=['story','treasures','outbreaks'].some(on)?[...Array(story.layout(save)).keys()]:[];
    component='resources';if(on('resources'))maxResources(save,{now});
    component='cat_metadata';if(on('cats'))outcome=maxCats(save,gd,c=>{component=c;});
    component='specialSkills';if(on('specialSkills'))story.setSkills(save,gd);
    component='expedition';if(on('expedition'))expedition.maxAccount(save,gd);
    component='talentOrbs';if(on('talentOrbs'))collections.maxHighestTalentOrbs(save,gd);
    component='enemyGuide';if(on('enemyGuide'))collections.unlockAllEnemies(save);
    component='tutorial';if(on('tutorial'))story.clearTutorial(save);
    component='story';if(on('story'))story.applyStory(save,{type:'story_clear',chapters,mode:'whole'});
    component='treasures';if(on('treasures'))story.applyStory(save,{type:'treasures',chapters,mode:'whole',value:3});
    component='outbreaks';if(on('outbreaks'))story.completeAllOutbreaks(save);
    component='maps';for(const [a,def,plan] of plans)maps.execute(a,def,plan);
    return outcome;
  }catch(err){
    if(err.policy)throw err;
    const trusted=/^CAT_(LEVEL|TALENT)_/.test(err.code||'');
    throw fail(trusted?err.code:'MAX_ACCOUNT_COMPONENT_FAILED','Max Account failed.',{component,reason:trusted?err.code:'MAX_ACCOUNT_BACKEND_FAILURE',cause:err});
  }
}

module.exports={maxAccount,maxResources,COMPONENTS};
