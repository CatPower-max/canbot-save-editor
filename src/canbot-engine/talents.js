// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Talent edits. Stored talents are the authority: only talents the SAVE already holds are raised; a catalog
// talent is never created. A cat's talents live in save.data.talents as {catId, talents:[{id, level}]}; a cat with no
// entry has no talent block.
const {unlock}=require('./cats');
const FULL_MATCH='FULL_MATCH',VALID_SUBSET='VALID_SUBSET',NO_BLOCK='NO_BLOCK',INVALID='INVALID',NO_TALENTS='NO_TALENTS';
const fail=(code,stage,extra={})=>Object.assign(new Error(code),{code,stage,...extra});
const stored=(save,id)=>save.data.talents.find(t=>t.catId===id)?.talents??null;

// The maximum level of each talent the cat stores that the catalog describes with a name (max level 0 reads as 1;
// a talent listed twice takes its last row).
function storedMaxima(td,skill,talents){
  const maxima=new Map();
  for(const s of skill.skills)if(td.nameIds.has(s.textId)&&talents.some(t=>t.id===s.abilityId))maxima.set(s.abilityId,s.maxLv===0?1:s.maxLv);
  return maxima;
}
function outcome(id,talents,status,reason,storedN=0,catalog=0,missing=[]){const m={id,status:status===FULL_MATCH||status===VALID_SUBSET?'SUPPORTED':'EXCLUDED',talentStatus:status,talentBlockPresent:Boolean(talents?.length),talentsStored:storedN,talentsCatalog:catalog,talentsMissing:missing.length,talentMissingIds:[...missing]};if(reason)m.reason=reason;return m;}
function classify(td,save,id){
  const skill=td.cats.get(id),talents=stored(save,id),has=Boolean(talents?.length);
  const refused=(status,reason)=>[outcome(id,talents,status,reason),null];
  if(!skill)return has?refused(INVALID,'CAT_TALENT_METADATA_UNAVAILABLE'):refused(NO_TALENTS,'CAT_TALENT_UNSUPPORTED');
  const semantic=skill.skills.some(s=>s.abilityId>0);
  let catalog=[...new Set(skill.skills.filter(s=>s.abilityId>0).map(s=>s.abilityId))];
  if(!semantic&&has&&talents.some(t=>t.id===0))catalog=[0];
  if(!catalog.length)return (talents||[]).some(t=>t.id!==0)?refused(INVALID,'CAT_TALENT_METADATA_UNAVAILABLE'):refused(NO_TALENTS,'CAT_TALENT_UNSUPPORTED');
  if(!has)return [outcome(id,talents,NO_BLOCK,'CAT_TALENT_NO_BLOCK',0,catalog.length,catalog),null];
  const maxima=storedMaxima(td,skill,talents);
  const entries=talents.filter(t=>!semantic||t.id!==0),ids=entries.map(t=>t.id);
  if(!ids.length||ids.some(x=>!Number.isSafeInteger(x)||x<0)||new Set(ids).size!==ids.length||!ids.every(x=>catalog.includes(x)))return refused(INVALID,'CAT_TALENT_INVALID_STORAGE');
  const levels=[];
  for(const t of entries){const max=maxima.get(t.id);if(max===undefined)return refused(INVALID,'CAT_TALENT_METADATA_UNAVAILABLE');if(!(max>=1&&max<=2147483647)||!(t.level>=0&&t.level<=max))return refused(INVALID,'CAT_TALENT_INVALID_LEVEL');levels.push([t.id,max]);}
  const missing=catalog.filter(x=>!ids.includes(x));
  return [outcome(id,talents,missing.length?VALID_SUBSET:FULL_MATCH,null,ids.length,catalog.length,missing),levels];
}

// composite: Max Account (cats without talents and NO_BLOCK cats are skipped). INVALID always stops.
function maxTalents(save,gd,ids,{composite=false}={}){
  const td=gd.talentData(save.cc);if(!td)throw fail('CAT_TALENT_METADATA_UNAVAILABLE','METADATA_READ');
  const members=[],targets=new Map();
  for(const id of ids){const [m,levels]=classify(td,save,id);members.push(m);if(levels)targets.set(id,levels);}
  let blocking=members.filter(m=>m.talentStatus===INVALID||(m.talentStatus===NO_TALENTS&&!composite));
  const selected=ids.filter(id=>targets.has(id)),skipped=members.filter(m=>m.talentStatus===NO_BLOCK);
  if(!blocking.length&&!selected.length&&skipped.length&&!composite)blocking=skipped;
  if(blocking.length)throw fail(blocking[0].reason,'TARGET_CHECK');
  const result=members.filter(m=>m.talentStatus!==NO_TALENTS);
  if(!selected.length)return result;
  // Raise: each selected cat is unlocked (when edits unlock) and every target talent set to its maximum. Placeholder
  // talents (id 0) of a cat with real talents are not targets and keep their level.
  const shape=new Map(selected.map(id=>[id,stored(save,id).map(t=>t.id)]));
  const unlockOnEdit=require('./settings').get().unlockOnEdit;
  for(const id of selected){
    if(unlockOnEdit)unlock(save,gd,id);
    const talents=stored(save,id);
    for(const [x,max] of targets.get(id))talents.find(t=>t.id===x).level=max;
  }
  // Check: the talent list kept its shape and every target is at its maximum.
  for(const id of selected){
    if(JSON.stringify(stored(save,id).map(t=>t.id))!==JSON.stringify(shape.get(id)))throw fail('CAT_TALENT_BACKEND_FAILURE','VERIFY');
    for(const [x,max] of targets.get(id)){const t=stored(save,id).find(q=>q.id===x);if(!t||t.level!==max)throw fail('CAT_TALENT_BACKEND_FAILURE','VERIFY');}
  }
  return result;
}

module.exports={maxTalents,classify};
