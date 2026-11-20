// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// The remaining single edits: Clear to Japan, the fixes and small unlocks (simple actions: fixes, basic items,
// gambling events, aku realm), scores and adding cats to storage.
const {SaveDouble}=require('./binary');
const story=require('./story'),{removeGoldPass}=require('./extra');
const fail=(code,message)=>Object.assign(new Error(message),{code});
function integer(v,max,name='Value'){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>max)throw fail('INVALID_INPUT',`${name} must be an integer between 0 and ${max}.`);return v;}
const convertStage=i=>i===46||i===47?i:45-i;

// Story metadata: every chapter needs its name keys and 48 stage names; returns stage names per chapter.
function storyMetadata(save,gd){
  const real=story.layout(save),loc=gd.localizable();
  if(!loc||!['everyplay_mapname_J','everyplay_mapname_W','everyplay_mapname_P'].every(k=>loc.has(k)))throw fail('STORY_METADATA_UNAVAILABLE','Story chapter names are unavailable.');
  const chapters=[];
  for(let index=0;index<real;index++){
    const raw=gd.storyStageNames(save.cc,story.chapterType(index));
    if(!raw||raw.length<48)throw fail('STORY_METADATA_UNAVAILABLE','Story stage names are unavailable.');
    chapters.push({id:index,stages:Array.from({length:48},(_,i)=>raw[convertStage(i)])});
  }
  return {chapters};
}

function clearToJapan(save,gd){
  const chapter=storyMetadata(save,gd).chapters[0];let found;
  if(save.cc==='jp'){
    // Mission 8 references 300006 (the first chapter's seventh stage, Fukuoka) in all regions.
    const gate=gd.missionConditions()?.get(8);
    found=gate&&gate.missionType===0&&gate.conditionsType===1&&gate.progressCount===1&&gate.values.length===1&&gate.values[0]===300006&&chapter.stages.length>6?[6]:[];
  }else found=chapter.stages.map((n,i)=>['japan','日本','일본'].includes(n.trim().toLowerCase())?i:-1).filter(i=>i>=0);
  if(found.length!==1)throw fail('STORY_JAPAN_STAGE_UNAVAILABLE','The Japan or Fukuoka milestone could not be verified for this SAVE. No edits were applied.');
  story.clearTutorial(save);
  story.applyStory(save,{type:'story_clear',chapters:[0],mode:'specific',stages:Array.from({length:found[0]+1},(_,i)=>i)});
}

// Event map clear that keeps existing clear counts (an uncleared stage becomes 1), then opens the next crown and map.
function clearEventMap(save,type,map,star){
  const e=save.data.eventStages,stages=e.stagesPer;
  if(!e.progress[type]?.[map])throw fail('EVENT_MAP_UNAVAILABLE','Event map not stored.');
  e.progress[type][map][star]=stages;e.unlock[type][map][star]=3;
  for(let i=0;i<stages;i++)e.clears[type][map][i][star]=e.clears[type][map][i][star]||1;
  if(star+1<e.stars)e.unlock[type][map][star+1]=1;
  if(map+1<e.subchapters)e.unlock[type][map+1][0]=1;
}
const emptyCounted=()=>({n:0,items:[]});
// opts.now(): seconds (float); opts.random(): [0,1).
const SIMPLE={
  fix_gamatoto_crash:save=>{save.data.gamatotoSkin=2;},
  fix_ototo_crash:save=>{const d=save.data,gv=save.gameVersion;d.ototoCannons=[];const parts=gv<80200?1:gv>90699?0:10;d.ototoSelectedParts=Array.from({length:parts},()=>[0,0,0]);if('ototoSelectedPartsCount' in d)d.ototoSelectedPartsCount=parts;},
  fix_time_errors:(save,o)=>{const t=o.now(),dt=new Date(t*1000),d=save.data;
    d.date3={year:dt.getFullYear(),month:dt.getMonth()+1,day:dt.getDate(),hour:dt.getHours(),minute:dt.getMinutes(),second:dt.getSeconds()};
    d.timestamp=new SaveDouble(t);if('energyPenaltyTimestamp' in d)d.energyPenaltyTimestamp=new SaveDouble(t);},
  fix_officer_pass_crash:save=>{const d=save.data;d.officerCatId=0;d.officerCatForm=0;d.officerPassPlayTime=0;if(d.goldPass)removeGoldPass(save);},
  unlock_equip_menu:save=>{const m=save.data.menuUnlocks;m[2]=Math.max(m[2],1);},
  restart_pack:save=>{save.data.restartPack=1;},
  reset_gambling_events:save=>{const d=save.data;for(const k of ['wildcatCompleted','wildcatValues','wildcatStartTimes','catScratcherCompleted','catScratcherValues','catScratcherStartTimes'])if(k in d)d[k]=emptyCounted();},
  reset_golden_cat_cpus:save=>{if('goldenCpuCount' in save.data)save.data.goldenCpuCount=0;},
  unlock_aku_realm:save=>{for(const id of [255,256,257,258,265,266,268])clearEventMap(save,1,id,0);},
  filibuster_reclearing:(save,o)=>{save.data.filibusterEnabled=true;save.data.filibusterStage=Math.floor(o.random()*48);},
};
function simpleAction(save,edit,{now=()=>Date.now()/1000,random=Math.random}={}){
  const run=SIMPLE[edit.operation];if(!run)throw fail('INVALID_INPUT','Unsupported action.');run(save,{now,random});
}

function dictSet(pairs,k,v){const p=pairs.find(x=>x[0]===k);if(p)p[1]=v;else pairs.push([k,v]);}
function setScore(save,edit){
  const value=integer(edit.value,2**31-1),d=save.data;
  if(edit.score==='dojo'){let ch=d.dojoChapters.find(p=>p[0]===0);if(!ch){ch=[0,[]];d.dojoChapters.push(ch);}dictSet(ch[1],0,value);return;}
  if(edit.score==='challenge'){
    const c=d.challenge;if(!c||!c.chapters1||!c.stars1||!c.stages3)throw fail('CHALLENGE_STAGE_UNAVAILABLE','Challenge stage unavailable.');
    if(!d.challengeScores.length)d.challengeScores=[0];d.challengeScores[0]=value;d.challengePopupShown=true;
    // Chapters.clear_stage(0, 0, 0, False): progress, unlock state 3, clear count False (0).
    c.progress[0][0]=Math.max(c.progress[0][0],1);c.unlock[0][0]=3;c.clears[0][0][0]=0;return;
  }
  throw fail('INVALID_INPUT','Unsupported score.');
}

// Cats to storage (item type 1), quantity per cat, into free slots.
function storageAdd(save,ids,amount){
  const d=save.data;
  if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<0)throw fail('INVALID_INPUT','amount must be an integer >= 0.');
  if(amount<1)throw fail('INVALID_INPUT','Amount must be positive.');
  const space=d.storageTypes.filter(t=>t===0).length;if(amount*ids.length>space)throw fail('STORAGE_CAPACITY','Not enough storage space.');
  for(const id of ids)for(let k=0;k<amount;k++){const slot=d.storageTypes.indexOf(0);if(slot<0)break;d.storageTypes[slot]=1;d.storageIds[slot]=id;}
}
module.exports={clearToJapan,simpleAction,setScore,storageAdd,storyMetadata,SIMPLE_ACTIONS:Object.keys(SIMPLE)};
