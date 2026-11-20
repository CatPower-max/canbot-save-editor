// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Read-only answers the editors ask for (metadata actions): names, limits, current values and the editor's own
// explanations, as JSON.
const story=require('./story'),maps=require('./maps'),expedition=require('./expedition'),extra=require('./extra');
const items=require('./items'),settings=require('./settings'),misc=require('./misc'),collections=require('./collections'),talents=require('./talents');
const e={versionText:gv=>{const s=String(gv).padStart(6,'0');return `${Number(s.slice(0,2))}.${Number(s.slice(2,4))}.${Number(s.slice(4,6))}`;}};
const fail=(code,message)=>Object.assign(new Error(message),{code});
const MAX={treasureLevel:9999,itfTimedScore:9999,stageClear:9999,platinumTickets:9};
const ITEM_NAMES=['catfood','xp','normal_tickets','rare_tickets','platinum_tickets','legend_tickets','platinum_shards','np','leadership'];
const INVENTORY_CATEGORY={catamins:6,catseyes:5,labyrinth_medals:11,treasure_chests:12,base_materials:7,battle_items:3};

function storyMeta(save,gd){
  const d=save.data,loc=gd.localizable(),names=[];
  const base=story.layout(save),{chapters}=misc.storyMetadata(save,gd);
  for(let id=0;id<base;id++){const [key,n]=id<3?['everyplay_mapname_J',id+1]:id<6?['everyplay_mapname_W',id-2]:['everyplay_mapname_P',id-5];names.push(loc.get(key).replace('%d',String(n)));}
  return {chapters:chapters.map(c=>{const raw=c.id<3?c.id:c.id+1,ob=d.outbreaks.find(p=>p[0]===raw);
      return {id:c.id,group:story.chapterType(c.id),name:names[c.id],stages:c.stages,outbreakStages:ob?ob[1].map(p=>p[0]).sort((a,b)=>a-b):[]};}),
    treasureMax:3,treasureCustomMax:MAX.treasureLevel,scoreMax:MAX.itfTimedScore,clearMax:settings.cap(MAX.stageClear,15)};
}
function itemMeta(save){
  const d=save.data,shards='platinumShards' in d,current={};
  for(const n of ITEM_NAMES){const v=d[items.FIELD[n]];if(Number.isInteger(v))current[n]=v;}
  const limits=disable=>settings.use({...settings.get(),disableMaxes:disable},()=>Object.fromEntries(ITEM_NAMES.map(n=>[n,n==='platinum_shards'&&!shards?null:items.limit(save,n)])));
  const recommended=limits(false);
  return {limits:recommended,recommendedLimits:recommended,extendedLimits:limits(true),currentValues:current,
    storage:{emptySlots:d.storageTypes.filter(t=>t===0).length,occupiedSlots:d.storageTypes.map((t,i)=>t?i:-1).filter(i=>i>=0)},
    dependencies:{platinum_shards:{item:'platinum_tickets',maximum:MAX.platinumTickets,multiplier:10,remainder:9}}};
}
function inventoryMeta(save,gd,name){
  if(!['catamins','catseyes','labyrinth_medals','treasure_chests','base_materials','battle_items','catfruit'].includes(name))throw fail('INVALID_INPUT','Unsupported inventory.');
  if(name==='catfruit')return catfruitMeta(save,gd);
  const list=gd.gatyaByCategory(INVENTORY_CATEGORY[name]);if(!list)throw fail('INVALID_INPUT','Item metadata is unavailable.');
  const values=story.inventoryValues(save,name);
  if(list.length<values.length)throw fail('INVALID_INPUT','Item metadata is incomplete.');
  return {entries:list.slice(0,values.length).map((it,i)=>({id:i,name:gd.gatyaName(save.cc,it.id)||`Item ${i}`,value:values[i]})),maximum:story.inventoryLimit(save,name)};
}
function expeditionMeta(save,gd){
  const d=save.data,base=expedition.metadata(save,gd),descriptions=gd.cannonDescriptions(save.cc),recipes=gd.recipeUnlocks();
  const cannons=d.ototoCannons.map(([id,c])=>({id,name:descriptions.find(x=>x.cannonId===id).name,maximums:c.levels.map((_,p)=>expedition.maxPartLevel(recipes,p)),current:[...c.levels]}));
  const levels=gd.gamatotoLevels(),limit=gd.gamatotoLimit(),current={};
  try{
    const xp=d.gamatoto.xp,max=limit.maxLevel;let row=null;
    for(const l of levels){if(l.level>=max)break;if(l.xpNeeded===-1)continue;if(xp<l.xpNeeded){row=l;break;}}
    if(!row)row=max>=levels.length?levels[levels.length-1]:levels[max-1];
    if(xp>=0&&levels.length&&max){
      const level=Math.min(row.level,max),floor=level<=1?0:levels[level-2].xpNeeded,ceiling=level<max&&level-1<levels.length?levels[level-1].xpNeeded:null;
      current.gamatoto=floor<0||ceiling!==null&&ceiling<=floor?{level,maxLevel:max,xp}:{level,maxLevel:max,xp,levelXp:floor,nextLevelXp:ceiling,toNext:ceiling!==null?Math.max(0,ceiling-xp):0};
    }
  }catch{}
  const rarityOf=new Map(base.members.map(m=>[m.id,m.rarity])),counts=base.rarities.map(()=>0);
  for(const h of d.gamatotoHelpers){const r=rarityOf.get(h);if(r!==undefined)counts[r]++;}
  current.helpers={total:d.gamatotoHelpers.filter(h=>h>=0).length,byRarity:counts};
  if(d.ototoEngineers>=0)current.engineers=d.ototoEngineers;
  try{
    const b=gd.shrineBoundaries(save.cc),xp=Number(d.catShrine.xpOffering);
    if(b&&b.length&&xp>=0){
      let level=b.length;for(let i=0;i<b.length;i++)if(xp<b[i]){level=i+1;break;}
      const ceiling=level<b.length?b[level-1]:null;
      current.shrine={level,maxLevel:b.length,xp,levelXp:level<=1?0:b[level-2],nextLevelXp:ceiling,toNext:ceiling!==null?Math.max(0,ceiling-xp):0,visible:!d.catShrine.gone};
    }
  }catch{}
  return {maxLevel:base.maxLevel,maxHelpers:base.maxHelpers,rarities:base.rarities,rarityCounts:base.rarityCounts,engineerMax:base.engineerMax,cannons,current};
}
function shrineMeta(save,gd){const {max,maxXp}=expedition.shrineLimits(gd,save.cc);if(!max)throw fail('INVALID_INPUT','Cat Shrine data unavailable.');return {shrineLevelMax:max,shrineXpMax:maxXp};}
// The editor's field names and explanations for the extra operations.
const EXTRA_TEXT={
  rare_trade:{name:'Tickets to prepare for trade',nameKo:'교환할 레어 티켓 수량',note:'Prepares trade progress and one special-skill storage slot. Tickets are obtained by trading in game; the ticket balance is not changed here.',noteKo:'특수 능력 저장고에 교환에 필요한 항목을 준비합니다. 레어 티켓은 게임에서 교환을 완료해야 받을 수 있습니다.'},
  hundred_million:{name:'100 Million Tickets',nameKo:'1억 다운로드 기념 티켓 수량',note:'This is the legacy 100-million-download ticket field; availability depends on the game event.',noteKo:'1억 다운로드 기념 티켓 수량을 바꿉니다. 게임 내 사용 가능 여부는 이벤트에 따라 달라집니다.'},
  slots:{name:'Unlocked Lineups',nameKo:'해금된 편성 슬롯 수'},
  aku:{names:[['First stages to clear','처음부터 클리어 처리할 스테이지 수'],['Clear count','스테이지별 클리어 횟수']],note:'Applies the count to the first N Aku stages and resets every later stage to zero, matching the original progress editor.',noteKo:'처음부터 지정한 수만큼의 마계편 스테이지에 클리어 횟수를 적용합니다. 이후 스테이지의 클리어 횟수는 0이 됩니다.'},
  gold_add:{name:'Officer ID (0 = random)',nameKo:'회원 번호 (0이면 자동 생성)',note:'Applies the upstream Gold Pass state with a 30-day term and renewal. Resets its claimed rewards and login bonus counter.',noteKo:'30일 골드 회원 상태를 등록합니다. 수령한 회원 보상 기록과 로그인 보너스 횟수를 초기화합니다.'},
  gold_remove:{note:'Removes Gold Pass state and resets its claimed rewards and login bonus counter.',noteKo:'골드 회원 상태를 해제하고 수령한 회원 보상 기록과 로그인 보너스 횟수를 초기화합니다.'},
};
function extraMeta(save,op){
  const base=extra.metadata(save,op),t=EXTRA_TEXT[op];
  const fields=base.fields.map((f,i)=>({id:f.id,name:t.names?t.names[i][0]:t.name,nameKo:t.names?t.names[i][1]:t.nameKo,max:f.max}));
  if(op==='slots')fields[0].value=save.data.unlockedLineups;
  return {fields,...(t.note?{note:t.note,noteKo:t.noteKo}:{})};
}
function mapMeta(save,gd,category){return maps.metadata(save,gd,category,{display:true});}

function catfruitMeta(save,gd){
  const ids=gd.catfruitIds();if(!ids)throw fail('INVALID_INPUT','Catfruit metadata unavailable.');
  const names=ids.map(id=>gd.gatyaName(save.cc,id)),values=save.data.catfruit;
  return {entries:values.map((v,i)=>({id:i,name:i<names.length&&names[i]?names[i]:`Catfruit ${i}`,value:v})),maximum:story.inventoryLimit(save,'catfruit')};
}

// Collections: the catalog (collections.js) decides the entries; this adds names and labels.
const COLLECTION_ACTIONS={enigma:{append:'Add to Existing Enigmas',replace:'Replace Existing Enigmas'},rank_rewards:{claimed:'Mark Claimed',unclaimed:'Mark Unclaimed'},
  enemy_guide:{add:'Unlock',remove:'Remove'},medals:{add:'Add',remove:'Remove'},missions:{reward:'Complete — Reward Available',claimed:'Complete — Reward Claimed',remove:'Uncomplete'},
  scheme_items:{add:'Make Available',remove:'Remove'},storage:{remove:'Remove from Storage'}};
function collectionMeta(save,gd,kind){
  const d=save.data,meta=collections.catalog(save,gd,kind),actions=COLLECTION_ACTIONS[kind];
  const gname=id=>gd.gatyaName(save.cc,id);
  let entries;
  if(kind==='skills'){
    const list=gd.gatyaByCategory(2),valid=d.specialSkills.filter((_,i)=>i!==1);
    entries=meta.entries.map(e=>({id:e.id,name:gname(list[e.id].id)||String(list[e.id].id),baseMax:e.baseMax,plusMax:e.plusMax,base:valid[e.id].base+1,plus:valid[e.id].plus}));
    return {entries,fields:[{id:'base',name:'Base level (minimum 1)',nameKo:'기본 레벨 (최소 1)',max:Math.max(...entries.map(e=>e.baseMax))},{id:'plus',name:'Plus level',nameKo:'플러스 레벨',max:Math.max(...entries.map(e=>e.plusMax))}]};
  }
  if(kind==='enigma'){const names=gd.mapNames(save.cc,'H',25000).names;entries=meta.entries.map(e=>({id:e.id,name:names.get(e.id)||`Enigma ${e.id}`}));}
  else if(kind==='endless'){const names=gd.gatyaItemNames(save.cc),list=gd.gatyaByCategory(3);return {entries:meta.entries.map(e=>({id:e.id,name:names[list[e.id].id]})),duration:true};}
  else if(kind==='storage_skills'){const list=gd.gatyaByCategory(2);return {entries:meta.entries.map(e=>({id:e.id,name:gname(list[e.id].id)||String(list[e.id].id)})),maximum:meta.maximum};}
  else if(kind==='rank_rewards'){const desc=gd.rankGiftDescriptions();entries=meta.entries.map(e=>{const text=desc.find(x=>x.threshold===e.threshold).text;return {id:e.id,name:`${e.threshold} · `+text.replace(/<br>/g,' ').replace(/<[^>]*>/g,'')};});}
  else if(kind==='enemy_guide'){const names=gd.enemyNames();entries=meta.entries.map(e=>{let name=null;if(names){name=e.id<names.length?(names[e.id]||'enemy_not_in_name_list'):'enemy_unknown_name';}return {id:e.id,name:name||`Enemy ${e.id}`,owned:Boolean(d.enemyGuide[e.id])};});}
  else if(kind==='medals'){const names=gd.medalNames();entries=meta.entries.map(e=>({id:e.id,name:names[e.id][0]}));}
  else if(kind==='missions'){
    const names=gd.missionNames(save.cc),conditions=gd.missionConditions();
    entries=meta.entries.map(e=>{const c=conditions.get(e.id);let name=names.get(e.id).split('<br>')[0].split('%d').join(String(c.progressCount));if(c.values.length>2)name=name.split('%@').join(String(c.values[2]));return {id:e.id,name};});
  }
  else if(kind==='talent_orbs'){
    const orbs=gd.orbList(),t=gd.orbNames(),owned=new Map(d.talentOrbs.items.map(o=>[o.id,o.value]));
    return {entries:orbs.map(o=>({id:o.id,name:t.effect(o.effect).replace('%@',t.grade(o.rank)).replace('%@',o.target===null?'':t.attribute(o.target)),value:owned.get(o.id)??0})),maximum:meta.maximum};
  }
  else if(kind==='scheme_items'){
    const loc=gd.localizable();
    entries=gd.schemeItems().map(r=>{
      let name=loc.get(`scheme_popup_${r.id}`),item;
      if(r.type===1){const n=gd.catNames(save.cc,r.itemId);item=n&&n.length?n[0]:String(r.itemId);}else item=gname(r.itemId)||String(r.itemId);
      name=name.split('<flash>,').join('').split('<flash>').join('').split('<br>').join(' ');
      if(r.type===1)name=name.split('%@').join(item);
      else{const first=name.indexOf('%@'),second=first>=0?name.indexOf('%@',first+2):-1;if(first>=0&&second>=0)name=name.slice(0,first)+`${r.amount} ${item}`+name.slice(second+2);}
      return {id:r.id,name};
    });
  }
  else if(kind==='storage'){const label={1:'cat',2:'special_skill',3:'item'};entries=meta.entries.map(e=>({id:e.id,name:label[d.storageTypes[e.id]]||'unrecognised_storage_item'}));}
  else if(kind==='event_tickets'){
    return {entries:meta.entries.map(e=>({id:e.id,name:e.name,value:e.value})),maximum:meta.maximum,
      note:'Stored tickets for this exact game version. Event availability in game can differ.',noteKo:'이 지역·버전의 저장 데이터에 있는 티켓입니다. 게임에서 사용 가능 여부는 이벤트에 따라 달라집니다.'};
  }
  else throw fail('INVALID_INPUT','Unsupported collection.');
  return {entries,...(actions?{actions}:{})};
}

function catLevelMeta(save,gd,ids){
  if(!Array.isArray(ids)||!ids.length)throw fail('INVALID_INPUT','Select cats first.');
  const rows=gd.unitBuy(),entries=[];
  for(const id of [...new Set(ids)]){
    if(typeof id!=='number'||!Number.isSafeInteger(id)||id<0||id>=save.data.catsUnlocked.length)throw fail('INVALID_INPUT',`Cat ID ${id} was not found.`);
    const r=rows?.[id];if(!r)throw fail('CAT_LEVEL_METADATA','Level data is unavailable.');
    entries.push({baseMax:r.maxCatseye,plusMax:r.maxPlus});
  }
  return {baseMax:Math.min(...entries.map(e=>e.baseMax)),plusMax:Math.min(...entries.map(e=>e.plusMax))};
}
function talentMeta(save,gd,ids){
  const versions={saveGameVersion:e.versionText(save.gameVersion),catalogGameVersion:gd.version()};
  if(!Array.isArray(ids)||!ids.length)throw fail('CAT_TALENT_INVALID_TARGET','TARGET_CHECK');
  for(const id of ids)if(typeof id!=='number'||!Number.isSafeInteger(id)||id<0||id>=save.data.catsUnlocked.length)throw fail('CAT_TALENT_INVALID_TARGET','TARGET_CHECK');
  const td=gd.talentData(save.cc);if(!td)throw Object.assign(fail('CAT_TALENT_METADATA_UNAVAILABLE','METADATA_READ'),{versions});
  return {members:[...new Set(ids)].map(id=>talents.classify(td,save,id)[0]),versions};
}

function selectorIds(save,gd,mode,value){
  const d=save.data,all=d.catsUnlocked.map((_,i)=>i),rows=gd.unitBuy();
  const shown=()=>{const book=gd.pictureBook();if(!book)return null;return new Set(book.filter(c=>c.displayed).map(c=>c.catId));};
  if(mode==='all')return all;
  if(mode==='unlocked')return all.filter(i=>d.catsUnlocked[i]);
  if(mode==='not_unlocked')return all.filter(i=>!d.catsUnlocked[i]);
  if(mode==='obtainable'){const s=shown();return s?all.filter(i=>s.has(i)):null;}
  if(mode==='unobtainable'){const s=shown();return s?all.filter(i=>!s.has(i)):null;}
  if(mode==='non_gacha')return all.filter(i=>rows?.[i]&&rows[i].unlockSource!==2);
  const words=String(value??'').trim().replace(/,/g,' ').split(/\s+/).filter(Boolean);
  if(mode==='ids'){
    const max=all.length-1,ids=[];
    for(const w of words){if(w.includes('-')){const [a,b]=w.split('-',2).map(Number);if(!(Number.isInteger(a)&&Number.isInteger(b)&&0<=a&&a<=b&&b<=max))throw fail('INVALID_INPUT','Invalid cat ID range.');for(let i=a;i<=b;i++)ids.push(i);}else{const n=Number(w);if(!Number.isInteger(n))throw fail('INVALID_INPUT','Invalid cat ID.');ids.push(n);}}
    return all.filter(i=>ids.includes(i));
  }
  if(mode==='rarity'){const wanted=words.map(Number);return all.filter(i=>rows?.[i]&&wanted.includes(rows[i].rarity));}
  if(mode==='gacha'){const set=gd.gatyaDataSet()||[],ids=new Set();for(const w of words){const row=set[Number(w)];if(row)for(const id of row)ids.add(id);}return all.filter(i=>ids.has(i));}
  if(mode==='game_version'){
    const parse=t=>{const p=t.split('.').map(Number);return p[0]*10000+(p[1]||0)*100+(p[2]||0);};
    const wanted=words.map(w=>{if(w.includes('-')){const [a,b]=w.split('-',2).map(parse);return [Math.min(a,b),Math.max(a,b)];}const v=parse(w);return [v,v];});
    return rows?all.filter(i=>rows[i]&&wanted.some(([a,b])=>a<=rows[i].gameVersion&&rows[i].gameVersion<=b)):[];
  }
  // Name search: the text inside any form name, ignoring case.
  if(mode==='name'){const q=String(value??'').trim().toLowerCase();return all.filter(i=>{const n=gd.catNames(save.cc,i);return Boolean(n)&&n.some(x=>x.toLowerCase().includes(q));});}
  throw fail('NOT_PORTED',`cat selector mode ${mode}`);
}
const zfillVersion=v=>{const s=String(v).padStart(6,'0');return `${s.slice(0,2)}.${s.slice(2,4)}.${s.slice(4,6)}`;};
function selectorInfo(save,gd){
  const set=gd.gatyaDataSet(),rows=gd.unitBuy(),loc=gd.localizable(),rarities=[];
  for(let i=1;loc&&loc.has(`rarity_name_${i}`);i++)rarities.push(loc.get(`rarity_name_${i}`));
  const versions=rows?[...new Set(rows.map(r=>r.gameVersion).filter(v=>v!==-1))].sort((a,b)=>a-b):[];
  return {success:true,maxCatId:Math.max(0,save.data.catsUnlocked.length-1),gachaBannerMaxId:set?Math.max(0,set.length-1):null,
    gameVersions:versions.map(zfillVersion),rarities,banners:set?set.map((_,i)=>({id:i,name:gd.bannerName(save.cc,i)||'unknown_banner'})):[]};
}
function catSelector(save,gd,request){
  try{
    if(request.mode==='selector_info')return selectorInfo(save,gd);
    const ids=selectorIds(save,gd,String(request.mode??''),request.value);
    if(ids===null)throw fail('INVALID_INPUT','Cat metadata is unavailable.');
    return {success:true,catIds:[...new Set(ids)].sort((a,b)=>a-b)};
  }catch(err){if(err.code==='NOT_PORTED')throw err;return {success:false,error:'CAT_SELECTOR_STAGE: '+String(err.message).slice(0,200)};}
}

// request: {action, ...}. Returns the answer ({success: true, ...}).
function handle(save,gd,request){
  return settings.use(settings.fromSession(request.settings||{}),()=>{
    const a=request.action;
    if(a==='metadata'){try{return {success:true,...storyMeta(save,gd)};}catch(err){if(/^STORY_/.test(err.code||''))return {success:false,errorCode:err.code,error:'METADATA_STAGE: StoryError'};throw err;}}
    if(a==='item_metadata')return {success:true,...itemMeta(save)};
    if(a==='inventory_metadata')return {success:true,...inventoryMeta(save,gd,request.inventory)};
    if(a==='expedition_metadata')return {success:true,...expeditionMeta(save,gd)};
    if(a==='shrine_metadata')return {success:true,...shrineMeta(save,gd)};
    if(a==='map_metadata')return {success:true,...mapMeta(save,gd,request.category)};
    if(a==='extra_metadata'){try{return {success:true,...extraMeta(save,request.operation)};}catch(err){if(/^(EXTRA_|LINEUP_|AKU_)/.test(err.code||''))return {success:false,errorCode:err.code};throw err;}}
    if(a==='collection_metadata'){try{return {success:true,...collectionMeta(save,gd,request.collection)};}catch(err){if(/^(COLLECTION_UNSUPPORTED_VERSION|EVENT_TICKET_)/.test(err.code||''))return {success:false,errorCode:err.code};throw err;}}
    if(a==='cat_level_metadata'){
      try{return {success:true,...catLevelMeta(save,gd,request.catIds)};}
      catch(err){const level=/^CAT_LEVEL_/.test(err.code||'');return {success:false,errorCode:level?err.code:(require('./compat').isLegacy()?'BCSFE_METADATA_FAILED':'METADATA_FAILED'),error:`METADATA_STAGE: ${level?'CatLevelError':'ValueError'}`,diagnostics:{stage:'METADATA',exceptionClass:level?'CatLevelError':'ValueError'}};}
    }
    if(a==='cat_talent_metadata'){
      try{return {success:true,...talentMeta(save,gd,request.catIds)};}
      catch(err){return {success:false,errorCode:/^CAT_TALENT_/.test(err.code||'')?err.code:'CAT_TALENT_METADATA_UNAVAILABLE',error:'METADATA_STAGE: CatTalentError',diagnostics:{stage:'METADATA',exceptionClass:'CatTalentError',talentStage:err.message,...(err.versions||{})}};}
    }
    if(a==='cat_selector')return catSelector(save,gd,request);
    throw fail('NOT_PORTED',`${a} is not ported yet`);
  });
}
module.exports={handle};
