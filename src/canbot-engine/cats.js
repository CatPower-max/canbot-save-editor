// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Cat edits on a parsed SAVE, under the session settings (settings.js: reset cat data on removal, set the current
// form, unlock a cat when it is edited). Cats are addressed by id; the
// per-cat columns of the SAVE are indexed by the cat's position (= its id).
const fail=(code,message)=>Object.assign(new Error(message),{code});

function catIndex(save,id){if(!Number.isSafeInteger(id)||id<0||id>=save.data.catsUnlocked.length)throw fail('INVALID_INPUT',`Cat ID ${id} was not found.`);return id;}
const setAt=(list,i,v)=>{if(Array.isArray(list)&&i>=0&&i<list.length)list[i]=v;};
// The cat's talents entry (catId, talents) or undefined.
const talentsOf=(save,id)=>save.data.talents.find(t=>t.catId===id);
// chara_new_flags is a dictionary kept as [key, value] pairs; a new key goes to the end (insertion order).
function setNewFlag(save,id,value){const row=save.data.catsNewFlags.find(p=>p[0]===id);if(row)row[1]=value;else save.data.catsNewFlags.push([id,value]);}

function setDrops(save,gd,id,value){const drops=gd.dropsOf(id);if(!drops)return;for(const d of drops)setAt(save.data.unitDrops,d.saveId,value);}

function unlock(save,gd,id){
  const i=catIndex(save,id);
  save.data.catsUnlocked[i]=1;
  save.data.catsSeen[i]=1;
  setDrops(save,gd,id,1);
  // The equipment menu (menuUnlocks[2]) opens with the first cat.
  save.data.menuUnlocks[2]=Math.max(save.data.menuUnlocks[2],1);
}
function remove(save,gd,id){
  const i=catIndex(save,id),d=save.data;
  d.catsUnlocked[i]=0;
  if(!cfg().resetCatData)return;
  // reset_cat_data: everything about the cat goes back to zero.
  d.catsForm[i]=0;d.catsUnlockedForms[i]=0;d.catsSeen[i]=0;d.catGuideCollected[i]=0;
  setAt(d.catsFourthForm,i,0);setAt(d.catsCatseyesUsed,i,0);
  d.catsUpgrade[i].plus=0;d.catsUpgrade[i].base=0;
  for(const t of talentsOf(save,id)?.talents||[])t.level=0;
  setNewFlag(save,id,0);
  setDrops(save,gd,id,0);
}
const cfg=()=>require('./settings').get();
const editUnlock=(save,gd,id)=>{if(cfg().unlockOnEdit)unlock(save,gd,id);};
function setForm(save,gd,id,form){editUnlock(save,gd,id);const i=catIndex(save,id);save.data.catsUnlockedForms[i]=form+1;if(cfg().setCurrentForms)save.data.catsForm[i]=form;}
function unlockFourth(save,gd,id){const i=catIndex(save,id);if(cfg().setCurrentForms)save.data.catsForm[i]=3;save.data.catsUnlockedForms[i]=3;editUnlock(save,gd,id);setAt(save.data.catsFourthForm,i,2);}
function setFormTrue(save,gd,id,totalForms,fourth){
  const i=catIndex(save,id);
  if(totalForms===4&&fourth)unlockFourth(save,gd,id);
  else if(totalForms>=3)setForm(save,gd,id,2);
  else if(totalForms===2){save.data.catsUnlockedForms[i]=0;save.data.catsForm[i]=1;}
  else{save.data.catsUnlockedForms[i]=0;save.data.catsForm[i]=0;}
}
function forms(save,gd,ids,{fourth=false,force=false}={}){
  const book=gd.pictureBook();
  for(const id of ids){
    if(force){fourth?unlockFourth(save,gd,id):setForm(save,gd,id,2);continue;}
    const entry=book?.find(c=>c.catId===id);if(entry)setFormTrue(save,gd,id,entry.totalForms,fourth);
  }
}
function removeTrueForm(save,id){const i=catIndex(save,id),d=save.data;d.catsUnlockedForms[i]=0;d.catsForm[i]=Math.min(d.catsForm[i],1);setAt(d.catsFourthForm,i,0);}
function removeFourthForm(save,id){const i=catIndex(save,id),d=save.data;d.catsForm[i]=Math.min(d.catsForm[i],2);setAt(d.catsFourthForm,i,0);}
function catGuide(save,gd,id,on){if(on)editUnlock(save,gd,id);save.data.catGuideCollected[catIndex(save,id)]=on?1:0;}
function removeTalents(save,id){for(const t of talentsOf(save,id)?.talents||[])t.level=0;}
const setRankUpSale=save=>{save.data.rankUpSaleValue=0x7fffffff;};

// One operation on a list of cat ids (ids de-duplicated, in order),
// followed by the rank-up sale flag. Level and talent operations are not here yet.
const OPERATIONS=['unlock','remove','cat_guide','remove_cat_guide','true_form','force_true_form','remove_true_form','fourth_form','force_fourth_form','remove_fourth_form','remove_talents'];
function applyCatOperation(save,gd,operation,ids){
  if(!OPERATIONS.includes(operation))throw fail('INVALID_INPUT',`Unsupported cat operation: ${operation}`);
  const unique=[...new Set(ids)];if(!unique.length)throw fail('INVALID_INPUT','catIds must contain at least one Cat ID.');
  unique.forEach(id=>catIndex(save,id));
  if(operation==='true_form'||operation==='fourth_form'){
    const book=gd.pictureBook(),minimum=operation==='true_form'?3:4;
    const ok=unique.filter(id=>(book?.find(c=>c.catId===id)?.totalForms??0)>=minimum);
    if(!ok.length)throw fail('CAT_FORM_UNSUPPORTED','No selected cat has that form.');
    forms(save,gd,ok,{fourth:operation==='fourth_form'});
  }
  else if(operation==='force_true_form')forms(save,gd,unique,{force:true});
  else if(operation==='force_fourth_form')forms(save,gd,unique,{force:true,fourth:true});
  else for(const id of unique){
    if(operation==='unlock')unlock(save,gd,id);
    else if(operation==='remove')remove(save,gd,id);
    else if(operation==='cat_guide')catGuide(save,gd,id,true);
    else if(operation==='remove_cat_guide')catGuide(save,gd,id,false);
    else if(operation==='remove_true_form')removeTrueForm(save,id);
    else if(operation==='remove_fourth_form')removeFourthForm(save,id);
    else if(operation==='remove_talents')removeTalents(save,id);
  }
  setRankUpSale(save);
}

module.exports={applyCatOperation,OPERATIONS,unlock,editUnlock,remove,forms,catGuide};
