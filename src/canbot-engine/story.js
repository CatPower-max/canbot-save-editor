// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Story, treasure, outbreak and other single-area edits. Main story:
// 10 chapter slots of 51 stages, slot 3 unused; the 9 real chapters have 48 playable stages. Treasures are stored in
// a different stage order (convert below).
const fail=(code,message)=>Object.assign(new Error(message),{code});
const LIMIT={stageClear:9999,treasure:9999,timedScore:9999,catamins:9999,catseyes:9999,labyrinth_medals:9999,treasure_chests:9999,base_materials:9999,battle_items:9999,catfruit_old:128,catfruit_new:998};
const FPS=30;

function integer(v,max,name='Value'){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw fail('INVALID_INPUT',`${name} must be an integer between 0 and ${max}.`);return v;}
const rawChapter=cid=>cid<3?cid:cid+1;
const chapterType=index=>index<3?0:index<6?1:2;
const treasureIndex=i=>i===46||i===47?i:45-i;

function layout(save){
  const d=save.data;
  if(d.storyClearTimes.length!==10||d.storyClearTimes.some(c=>c.length!==51))throw fail('STORY_LAYOUT_UNSUPPORTED','This SAVE has a story layout CanBot does not know; nothing was changed.');
  return 9;
}
const getPair=(dict,key)=>dict.find(p=>p[0]===key);
// Outbreak chapters are [chapterId, [[stageId, cleared]...]] in file order; real chapter ids skip slot 3.
const outbreakChapter=(dict,cid)=>getPair(dict,rawChapter(cid));

function clearStage(save,raw,stage,amount){const d=save.data;d.storyProgress[raw]=Math.max(d.storyProgress[raw],stage+1);d.storyClearTimes[raw][stage]=amount;}

function applyStory(save,edit,{random=Math.random}={}){
  const kind=edit.type,real=layout(save),d=save.data;
  const chapters=edit.chapters;if(!Array.isArray(chapters)||!chapters.length)throw fail('INVALID_INPUT','Select at least one chapter.');
  const selections=[];
  for(const cid of chapters){
    if(!Number.isInteger(cid)||cid<0||cid>=real)throw fail('STORY_CHAPTER_NOT_FOUND','That story chapter does not exist.');
    const count=48;
    if(kind==='timed_scores'&&chapterType(cid)!==1)throw fail('INVALID_INPUT','Timed scores require Into the Future.');
    const ob=outbreakChapter(d.outbreaks,cid);
    const valid=kind==='outbreaks'&&ob?ob[1].map(p=>p[0]).sort((a,b)=>a-b):Array.from({length:count},(_,i)=>i);
    if(kind==='outbreaks'&&!ob)throw fail('INVALID_INPUT','This chapter has no outbreak data.');
    if(edit.mode!=='whole'&&edit.mode!=='specific')throw fail('INVALID_INPUT','Invalid stage selection mode.');
    const stages=edit.mode==='whole'?valid:edit.stages;
    if(!Array.isArray(stages)||!stages.length)throw fail('INVALID_INPUT','Select at least one stage.');
    for(const s of stages){if(!Number.isInteger(s)||s<0||s>=count)throw fail('STORY_STAGE_NOT_FOUND','That story stage does not exist.');if(!valid.includes(s))throw fail('INVALID_INPUT','Selected outbreak stage is unavailable.');}
    selections.push([cid,[...new Set(stages)].sort((a,b)=>a-b)]);
  }
  let value=edit.value;
  if(kind==='story_clear')value=integer(edit.value??1,require('./settings').cap(LIMIT.stageClear,15));
  if(kind==='treasures')integer(value,LIMIT.treasure);
  const range=edit.scoreRange;
  if(kind==='timed_scores'){if(range==null)integer(value,LIMIT.timedScore);else{if(!Array.isArray(range)||range.length!==2)throw fail('INVALID_INPUT','Invalid score range.');range.forEach(x=>integer(x,LIMIT.timedScore));if(range[0]>range[1])throw fail('INVALID_INPUT','Invalid score range.');}}
  if(kind==='outbreaks'&&typeof value!=='boolean')throw fail('INVALID_INPUT','Clear must be a boolean.');
  if(!['story_clear','treasures','timed_scores','outbreaks'].includes(kind))throw fail('INVALID_INPUT','Unsupported story edit.');
  for(const [cid,stages] of selections){
    const raw=rawChapter(cid);
    for(const s of stages){
      if(kind==='story_clear')clearStage(save,raw,s,value);
      else if(kind==='treasures')d.storyTreasure[raw][treasureIndex(s)]=value;
      else if(kind==='timed_scores')d.itfTimedScores[(raw-4)*51+s]=range==null?value:range[0]+Math.floor(random()*(range[1]-range[0]+1));
      else if(kind==='outbreaks'){
        const ch=outbreakChapter(d.outbreaks,cid),st=ch&&getPair(ch[1],s);if(st)st[1]=value?1:0;
        if(value){const cur=outbreakChapter(d.currentOutbreaks,cid),cs=cur&&getPair(cur[1],s);if(cs)cs[1]=0;}
      }
    }
  }
}

// Every real chapter's 48 outbreaks cleared (missing entries created), and every current outbreak not cleared.
function completeAllOutbreaks(save){
  layout(save);const d=save.data;
  for(let cid=0;cid<9;cid++){
    const id=rawChapter(cid),existing=getPair(d.outbreaks,id);
    if(!existing)d.outbreaks.push([id,Array.from({length:48},(_,s)=>[s,1])]);
    else for(let s=0;s<48;s++){const st=getPair(existing[1],s);if(st)st[1]=1;else existing[1].push([s,1]);}
  }
  for(const [,stages] of d.currentOutbreaks)for(const st of stages)st[1]=0;
}

function clearTutorial(save){
  const d=save.data;
  d.tutorialState=Math.max(d.tutorialState,1);
  d.koreaSuperiorTreasureState=Math.max(d.koreaSuperiorTreasureState,2);
  d.unknown6=Math.max(d.unknown6,1);
  while(d.newDialogs2.length<6)d.newDialogs2.push(0);
  d.newDialogs2[1]=Math.max(d.newDialogs2[1],2);
  d.newDialogs2[5]=Math.max(d.newDialogs2[5],2);
  if(d.storyClearTimes[0][0]===0)clearStage(save,0,0,0);
}

function setPlaytime(save,edit){
  const h=integer(edit.hours,2**31-1,'Hours'),m=integer(edit.minutes,59,'Minutes'),s=integer(edit.seconds,59,'Seconds');
  const frames=(h*3600+m*60+s)*FPS;integer(frames,2**31-1,'Playtime frames');save.data.officerPassPlayTime=frames;
}
function setSeed(save,edit){const field={rare:'rareSeed',normal:'normalSeed',event:'eventSeed'}[edit.seed];if(!field)throw fail('INVALID_INPUT','Invalid gacha seed.');save.data[field]=integer(edit.value,2**32-1);}
// Special skills (AbilityData rows): every valid skill (all but slot 1) to its maximum; slot 0 (cannon power) is
// mirrored to the hidden slot 1. Then the rank-up sale flag.
function setSkills(save,gd){
  const rows=gd.abilityData(),skills=save.data.specialSkills,valid=skills.length-1;
  if(!rows||rows.length<valid)throw fail('INVALID_INPUT','Skill data is unavailable.');
  for(let i=0;i<valid;i++){
    const maxBase=rows[i].maxBase-1,maxPlus=rows[i].maxPlus,base=Math.min(maxBase,maxBase),plus=Math.min(maxPlus,maxPlus);
    const target=skills[i===0?0:i+1];if(base!==-1)target.base=base;if(plus!==-1)target.plus=plus;
    if(i===0){if(base!==-1)skills[1].base=base;if(plus!==-1)skills[1].plus=plus;}
  }
  save.data.rankUpSaleValue=0x7fffffff;
}

// Inventories: one value set on the selected entries.
const INVENTORIES=['catamins','catseyes','labyrinth_medals','treasure_chests','base_materials','battle_items','catfruit'];
function inventoryLimit(save,name){return name==='catfruit'?(save.gameVersion<110400?LIMIT.catfruit_old:LIMIT.catfruit_new):LIMIT[name];}
function inventoryValues(save,name){const d=save.data;return {catamins:d.catamins,catseyes:d.catseyes,labyrinth_medals:d.labyrinth?.medals?.items,treasure_chests:d.treasureChests?.items,base_materials:d.ototoMaterials,battle_items:d.battleItems,catfruit:d.catfruit}[name];}
function setInventory(save,edit){
  const name=edit.inventory;if(!INVENTORIES.includes(name))throw fail('INVALID_INPUT','Unsupported inventory.');
  const values=inventoryValues(save,name);if(!values)throw fail('INVALID_INPUT','Unsupported inventory.');
  const ids=edit.ids;if(!Array.isArray(ids)||!ids.length)throw fail('INVALID_INPUT','Select inventory entries.');
  const amount=integer(edit.value,inventoryLimit(save,name));for(const i of ids)integer(i,values.length-1,'Item ID');
  const updated=[...values];for(const i of ids)updated[i]=amount;
  if(name==='catfruit'&&save.gameVersion<110400&&updated.reduce((a,b)=>a+b,0)>inventoryLimit(save,name))throw fail('INVALID_INPUT','This save version has a cumulative catfruit limit.');
  for(const i of ids)values[i]=amount;
}

module.exports={applyStory,completeAllOutbreaks,clearTutorial,setPlaytime,setSeed,setSkills,setInventory,layout,chapterType,treasureIndex,inventoryValues,inventoryLimit};
