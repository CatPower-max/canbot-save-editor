// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
const MAJOR_FEATURE_DEFAULTS=Object.freeze({
  featureItemsEnabled:true,featureCatsEnabled:true,featureStoryEnabled:true,featureTreasureEnabled:true,
  featureGamatotoEnabled:true,featureGachaEnabled:true,featureAccountEnabled:true,featureFixesEnabled:true,
  featureOtherEnabled:true,featureEditorConfigEnabled:true,featurePresetsEnabled:true,maxAllItemsEnabled:true,
  presetMaxItemsEnabled:true,presetMaxCatsEnabled:true,presetMaxAccountEnabled:true,
  catUnlockEnabled:true,catRemoveEnabled:true,catLevelsEnabled:true,catFormsEnabled:true,catTalentsEnabled:true,
  accountPlaytimeEnabled:true,
  maxAccountResourcesEnabled:true,maxAccountCatsEnabled:true,maxAccountSpecialSkillsEnabled:true,maxAccountExpeditionEnabled:true,
  maxAccountTalentOrbsEnabled:true,maxAccountEnemyGuideEnabled:true,maxAccountStoryEnabled:true,maxAccountTreasureEnabled:true,
  maxAccountOutbreaksEnabled:true,maxAccountTutorialEnabled:true,
});
const MAX_ACCOUNT_COMPONENT_KEYS=Object.freeze({resources:'maxAccountResourcesEnabled',cats:'maxAccountCatsEnabled',specialSkills:'maxAccountSpecialSkillsEnabled',expedition:'maxAccountExpeditionEnabled',talentOrbs:'maxAccountTalentOrbsEnabled',enemyGuide:'maxAccountEnemyGuideEnabled',story:'maxAccountStoryEnabled',treasures:'maxAccountTreasureEnabled',outbreaks:'maxAccountOutbreaksEnabled',tutorial:'maxAccountTutorialEnabled'});

const CATEGORY_KEYS=Object.freeze({
  items:['featureItemsEnabled'],cats_special_skills:['featureCatsEnabled'],levels:['featureStoryEnabled','featureTreasureEnabled'],
  gamototo:['featureGamatotoEnabled'],account:['featureAccountEnabled'],gatya:['featureGachaEnabled'],fixes:['featureFixesEnabled'],
  other:['featureOtherEnabled'],editor:['featureEditorConfigEnabled'],presets:['featurePresetsEnabled'],save_management:[],
});
const SECTION_KEYS=Object.freeze({items:'featureItemsEnabled',cats:'featureCatsEnabled',levels:'featureStoryEnabled',expedition:'featureGamatotoEnabled',gacha:'featureGachaEnabled',fixes:'featureFixesEnabled',account:'featureAccountEnabled',other:'featureOtherEnabled',playtime:'accountPlaytimeEnabled',config:'featureEditorConfigEnabled',presets:'featurePresetsEnabled'});
const CAT_ACTION_KEYS=Object.freeze({unlock:'catUnlockEnabled',remove:'catRemoveEnabled',set_level:'catLevelsEnabled',max_upgrade:'catLevelsEnabled',max_base_plus:'catLevelsEnabled',upgrade_by:'catLevelsEnabled',true_form:'catFormsEnabled',fourth_form:'catFormsEnabled',remove_true_form:'catFormsEnabled',remove_fourth_form:'catFormsEnabled',max_talents:'catTalentsEnabled',remove_talents:'catTalentsEnabled'});

const enabled=(config,key)=>config?.[key]!==false;
function categoryEnabled(config,category){const keys=CATEGORY_KEYS[category];return Array.isArray(keys)&&(!keys.length||keys.some(key=>enabled(config,key)));}
function sectionEnabled(config,section){
  if(section==='levels')return enabled(config,'featureStoryEnabled')||enabled(config,'featureTreasureEnabled');
  const key=SECTION_KEYS[section];return !key||enabled(config,key);
}
function catActionEnabled(config,action){const key=CAT_ACTION_KEYS[action];return !key||enabled(config,key);}
function maxAccountComponents(config){return Object.fromEntries(Object.entries(MAX_ACCOUNT_COMPONENT_KEYS).map(([name,key])=>[name,enabled(config,key)]));}
function maxAccountHasEnabledComponents(config){return Object.values(maxAccountComponents(config)).some(Boolean);}
function editEnabled(config,edit){
  if(!edit||typeof edit!=='object')return false;
  if(edit.type==='max_account')return config?.maxAccountEnabled!==false&&(!edit.components||Object.values(edit.components).some(Boolean)||(edit.mapCategories?.length||0)>0);
  if(edit.type==='max_all')return enabled(config,'featureItemsEnabled')&&enabled(config,'maxAllItemsEnabled');
  if(edit.type==='item'||edit.type==='inventory')return enabled(config,'featureItemsEnabled');
  if(edit.type==='cat')return enabled(config,'featureCatsEnabled')&&catActionEnabled(config,edit.operation);
  if(edit.type==='special_skills')return enabled(config,'featureCatsEnabled')&&enabled(config,'catTalentsEnabled');
  if(['story_clear','outbreaks','timed_scores','map','map_batch','clear_to_japan'].includes(edit.type))return enabled(config,'featureStoryEnabled');
  if(edit.type==='treasures')return enabled(config,'featureTreasureEnabled');
  if(edit.type==='expedition')return enabled(config,'featureGamatotoEnabled');
  if(edit.type==='gacha_seed')return enabled(config,'featureGachaEnabled');
  if(edit.type==='playtime')return enabled(config,'featureAccountEnabled')&&enabled(config,'accountPlaytimeEnabled');
  if(edit.type==='simple'||edit.type==='score')return enabled(config,'featureFixesEnabled');
  if(edit.type==='extra')return enabled(config,'featureOtherEnabled');
  if(edit.type==='collection'){
    if(['storage','storage_skills','skills'].includes(edit.collection))return enabled(config,'featureCatsEnabled');
    if(['enigma'].includes(edit.collection))return enabled(config,'featureStoryEnabled');
    if(['rank_rewards','enemy_guide','medals','missions'].includes(edit.collection))return enabled(config,'featureAccountEnabled');
    return enabled(config,'featureItemsEnabled');
  }
  return true;
}

module.exports={MAJOR_FEATURE_DEFAULTS,MAX_ACCOUNT_COMPONENT_KEYS,CATEGORY_KEYS,SECTION_KEYS,CAT_ACTION_KEYS,enabled,categoryEnabled,sectionEnabled,catActionEnabled,maxAccountComponents,maxAccountHasEnabledComponents,editEnabled};
