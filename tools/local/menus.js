// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Detailed edit menus of canbot.js. Every choice is read from the SAVE's own metadata (the same answers the web
// editor gets) and becomes an edit in the web editor's format (src/edit-backend.js normalizeEdit), so the JS engine
// applies it exactly as a Discord or web SAVE would. Features the owner turned off are hidden (src/feature-policy.js).
const metadata=require('../../src/canbot-engine/metadata');
const story=require('../../src/canbot-engine/story');
const items=require('../../src/canbot-engine/items');
const {LABELS}=require('../../src/edit-labels');
const {editEnabled,maxAccountComponents}=require('../../src/feature-policy');

const ITEMS=['catfood','xp','normal_tickets','rare_tickets','platinum_tickets','legend_tickets','platinum_shards','np','leadership'];
const EN={catfood:'Cat Food',xp:'XP',normal_tickets:'Cat Tickets',rare_tickets:'Rare Tickets',platinum_tickets:'Platinum Tickets',legend_tickets:'Legend Tickets',platinum_shards:'Platinum Shards',np:'NP',leadership:'Leadership',
  unlock:'Unlock',remove:'Remove',set_level:'Set level',max_upgrade:'Max upgrade',max_base_plus:'Max base and plus',upgrade_by:'Level up by',true_form:'True form',fourth_form:'Ultra form',remove_true_form:'Remove true form',remove_fourth_form:'Remove ultra form',
  max_talents:'Max talents',remove_talents:'Remove talents',cat_guide:'Add to Cat Guide',remove_cat_guide:'Remove from Cat Guide',storage_add:'Add to storage',
  story_clear:'Clear story',treasures:'Treasures',outbreaks:'Zombie outbreaks',timed_scores:'Timed scores',
  catfruit:'Catfruit and seeds',catamins:'Catamins',catseyes:"Catseyes",base_materials:'Base materials',battle_items:'Battle items',treasure_chests:'Treasure chests',labyrinth_medals:'Labyrinth medals',
  sol:'Stories of Legend',event:'Event stages',collab:'Collab stages',uncanny:'Uncanny Legends',catamin_stages:'Catamin stages',towers:'Towers',gauntlets:'Gauntlets',collab_gauntlets:'Collab gauntlets',behemoth_culling:'Behemoth Culling',clear_enigma_stages:'Enigma stages',legend_quest:'Legend Quest',zero_legends:'Zero Legends',dojo_catclaw_championships:'Catclaw Championships',
  skills:'Special skills',enigma:'Enigma stages',endless:'Endless battle items',storage_skills:'Storage special skills',rank_rewards:'User rank rewards',talent_orbs:'Talent orbs',scheme_items:'Event unlocks',event_tickets:'Event tickets',enemy_guide:'Enemy guide',medals:'Medals',missions:'Missions',storage:'Storage',
  level:'Gamatoto level',helpers:'Gamatoto helpers',engineers:'Ototo engineers',shrine_level:'Cat Shrine level',shrine_xp:'Cat Shrine XP',shrine_appear:'Show Cat Shrine',shrine_disappear:'Hide Cat Shrine',cannon_levels:'Cannon levels',cannon_development:'Cannon development',
  rare_trade:'Prepare rare ticket trade',hundred_million:'100 million tickets',slots:'Lineup slots',aku:'Aku stages',gold_add:'Add Gold Pass',gold_remove:'Remove Gold Pass',
  fix_gamatoto_crash:'Fix Gamatoto crash',fix_ototo_crash:'Fix Ototo crash',fix_time_errors:'Fix time errors',fix_officer_pass_crash:'Fix Gold Pass crash',unlock_equip_menu:'Unlock equip menu',restart_pack:'Set restart pack',reset_gambling_events:'Reset gambling events',reset_golden_cat_cpus:'Reset golden Cat CPUs',unlock_aku_realm:'Unlock Aku Realm',filibuster_reclearing:'Filibuster re-clearing',
  max_all:'Max all items',max_account:'Max account',special_skills:'Max special skills',clear_to_japan:'Clear to Japan',playtime:'Play time',gacha_seed:'Gacha seed',score:'Score'};
// Japanese and Traditional Chinese names of the same features (common in-game wording; corrections welcome).
const JA={catfood:'ネコカン',xp:'XP',normal_tickets:'ネコチケット',rare_tickets:'レアチケット',platinum_tickets:'プラチナチケット',legend_tickets:'レジェンドチケット',platinum_shards:'プラチナのかけら',np:'NP',leadership:'リーダーシップ',
  unlock:'入手',remove:'削除',set_level:'レベル設定',max_upgrade:'最大強化',max_base_plus:'基本+プラス最大',upgrade_by:'レベルを上げる',true_form:'第3形態',fourth_form:'第4形態',remove_true_form:'第3形態を解除',remove_fourth_form:'第4形態を解除',
  max_talents:'本能を最大',remove_talents:'本能を解除',cat_guide:'キャラ図鑑に登録',remove_cat_guide:'キャラ図鑑から削除',storage_add:'ネコ部屋(保管庫)に追加',
  story_clear:'ストーリークリア',treasures:'お宝',outbreaks:'ゾンビステージ',timed_scores:'タイムスコア',
  catfruit:'マタタビ・種',catamins:'ネコビタン',catseyes:'ネコの目',base_materials:'城の素材',battle_items:'バトルアイテム',treasure_chests:'宝箱',labyrinth_medals:'迷宮の勲章',
  sol:'レジェンドストーリー',event:'イベントステージ',collab:'コラボステージ',uncanny:'真レジェンドストーリー',catamin_stages:'ネコビタンステージ',towers:'風雲にゃんこ塔など',gauntlets:'強襲ステージ',collab_gauntlets:'コラボ強襲',behemoth_culling:'超獣討伐',clear_enigma_stages:'謎のステージ',legend_quest:'レジェンドクエスト',zero_legends:'ゼロレジェンドストーリー',dojo_catclaw_championships:'にゃんこ道場 大会',
  skills:'特殊能力',enigma:'謎のステージ',endless:'無限バトルアイテム',storage_skills:'保管庫の特殊能力',rank_rewards:'ユーザーランク報酬',talent_orbs:'本能玉',scheme_items:'イベント解放項目',event_tickets:'イベントチケット',enemy_guide:'敵キャラ図鑑',medals:'メダル',missions:'ミッション',storage:'保管庫',
  level:'ガマトトのレベル',helpers:'ガマトト隊員',engineers:'オトートの助手',shrine_level:'ネコ神社のレベル',shrine_xp:'ネコ神社の経験値',shrine_appear:'ネコ神社を表示',shrine_disappear:'ネコ神社を隠す',cannon_levels:'キャノンのレベル',cannon_development:'キャノンの開発',
  rare_trade:'レアチケット交換の準備',hundred_million:'1億チケット',slots:'編成スロット',aku:'悪魔ステージ',gold_add:'にゃんこ会員(ゴールド)を追加',gold_remove:'にゃんこ会員(ゴールド)を解除',
  fix_gamatoto_crash:'ガマトトの不具合修復',fix_ototo_crash:'オトートの不具合修復',fix_time_errors:'時間エラーの修復',fix_officer_pass_crash:'にゃんこ会員の不具合修復',unlock_equip_menu:'装備メニューを解放',restart_pack:'リスタートパックを設定',reset_gambling_events:'ギャンブルイベントを初期化',reset_golden_cat_cpus:'ゴールデンネコCPUを初期化',unlock_aku_realm:'悪魔の領域を解放',filibuster_reclearing:'フィリバスター再クリア',
  max_all:'すべてのアイテムを最大',max_account:'アカウント最大',special_skills:'特殊能力を最大',clear_to_japan:'日本編までクリア',playtime:'プレイ時間',gacha_seed:'ガチャシード',score:'スコア'};
const ZH={catfood:'貓罐頭',xp:'XP',normal_tickets:'貓咪券',rare_tickets:'稀有轉蛋券',platinum_tickets:'白金轉蛋券',legend_tickets:'傳說轉蛋券',platinum_shards:'白金碎片',np:'NP',leadership:'統率力',
  unlock:'取得',remove:'刪除',set_level:'設定等級',max_upgrade:'強化到最大',max_base_plus:'基本+加值最大',upgrade_by:'提升等級',true_form:'第三型態',fourth_form:'第四型態',remove_true_form:'解除第三型態',remove_fourth_form:'解除第四型態',
  max_talents:'本能最大',remove_talents:'解除本能',cat_guide:'登錄角色圖鑑',remove_cat_guide:'從角色圖鑑移除',storage_add:'加入保管庫',
  story_clear:'故事通關',treasures:'寶物',outbreaks:'殭屍關卡',timed_scores:'時間分數',
  catfruit:'木天蓼・種子',catamins:'貓薄荷飲料',catseyes:'貓眼石',base_materials:'城堡素材',battle_items:'戰鬥道具',treasure_chests:'寶箱',labyrinth_medals:'迷宮勳章',
  sol:'傳說故事',event:'活動關卡',collab:'合作關卡',uncanny:'真傳說故事',catamin_stages:'貓薄荷飲料關卡',towers:'貓咪塔',gauntlets:'強襲關卡',collab_gauntlets:'合作強襲',behemoth_culling:'超獸討伐',clear_enigma_stages:'謎之關卡',legend_quest:'傳說任務',zero_legends:'零傳說故事',dojo_catclaw_championships:'貓咪道場大會',
  skills:'特殊能力',enigma:'謎之關卡',endless:'無限戰鬥道具',storage_skills:'保管庫特殊能力',rank_rewards:'用戶等級獎勵',talent_orbs:'本能玉',scheme_items:'活動解鎖項目',event_tickets:'活動券',enemy_guide:'敵人圖鑑',medals:'勳章',missions:'任務',storage:'保管庫',
  level:'喵喵探險隊等級',helpers:'喵喵探險隊隊員',engineers:'弟弟的助手',shrine_level:'貓咪神社等級',shrine_xp:'貓咪神社經驗值',shrine_appear:'顯示貓咪神社',shrine_disappear:'隱藏貓咪神社',cannon_levels:'大砲等級',cannon_development:'大砲開發',
  rare_trade:'準備稀有轉蛋券交換',hundred_million:'1 億轉蛋券',slots:'編成欄位',aku:'惡魔關卡',gold_add:'加入貓咪會員(金)',gold_remove:'解除貓咪會員(金)',
  fix_gamatoto_crash:'修復喵喵探險隊錯誤',fix_ototo_crash:'修復弟弟錯誤',fix_time_errors:'修復時間錯誤',fix_officer_pass_crash:'修復貓咪會員錯誤',unlock_equip_menu:'解鎖裝備選單',restart_pack:'設定重新開始包',reset_gambling_events:'重設賭博活動',reset_golden_cat_cpus:'重設黃金貓 CPU',unlock_aku_realm:'解鎖惡魔領域',filibuster_reclearing:'重新通關阻撓關卡',
  max_all:'所有道具最大',max_account:'帳號最大',special_skills:'特殊能力最大',clear_to_japan:'通關到日本篇',playtime:'遊玩時間',gacha_seed:'轉蛋種子',score:'分數'};
const MAPS=Object.keys(LABELS.MAPS),INVENTORIES=Object.keys(LABELS.INVENTORY),COLLECTIONS=Object.keys(LABELS.COLLECTIONS);
const CAT_OPS=['unlock','true_form','fourth_form','max_upgrade','max_base_plus','set_level','upgrade_by','max_talents','cat_guide','storage_add','remove_true_form','remove_fourth_form','remove_talents','remove_cat_guide','remove'];
const EXPEDITIONS=['xp','level','helpers','engineers','cannon_levels','cannon_development','shrine_level','shrine_xp','shrine_appear','shrine_disappear'];
const EXTRAS=Object.keys(LABELS.EXTRA),SIMPLES=Object.keys(LABELS.SIMPLE);
const ALL_LABELS=Object.assign({},...Object.values(LABELS));

// Comma or space separated numbers and ranges: "1-5, 8 10". Returns null for anything else.
function parseNumbers(text){
  const out=[];for(const part of String(text).split(/[\s,]+/).filter(Boolean)){
    const m=/^(\d+)(?:-(\d+))?$/.exec(part);if(!m)return null;const a=Number(m[1]),b=m[2]===undefined?a:Number(m[2]);
    if(b<a||b-a>10000)return null;for(let i=a;i<=b;i++)out.push(i);
  }
  return out.length?[...new Set(out)]:null;
}

// names: game data of the region that matches the chosen language (or null). Lists are built from the SAVE's own game
// data and only the names are taken from it, by the same id; anything it does not have keeps its original name.
function createMenus({ui,save,gd,names=null,policy={},access={},limits={}}){
  // ui.lang(): 'ko', 'en', 'ja' or 'zh'. Metadata notes come in Korean and English only; other languages use English.
  const {say,ask,choose,askNumber,yes,L}=ui,lang=()=>typeof ui.lang==='function'?ui.lang():'ko',en=()=>lang()!=='ko';
  const label=key=>{const l=lang();return (l==='ko'?ALL_LABELS[key]:l==='ja'?JA[key]:l==='zh'?ZH[key]:null)||EN[key]||key;};
  function localize(request,r){
    if(!names||names===gd||!r||r.success===false)return r;
    let other;try{other=metadata.handle(save,names,request);}catch{return r;}if(!other||other.success===false)return r;
    const rename=(mine,theirs)=>{if(!Array.isArray(mine)||!Array.isArray(theirs))return mine;const byId=new Map(theirs.filter(x=>x&&x.id!==undefined).map(x=>[String(x.id),x]));
      return mine.map(x=>{const t=x&&x.id!==undefined?byId.get(String(x.id)):null;if(!t)return x;const out={...x};if(typeof t.name==='string'&&t.name)out.name=t.name;
        if(Array.isArray(x.stages)&&Array.isArray(t.stages)&&t.stages.length===x.stages.length&&t.stages.every(v=>typeof v==='string'))out.stages=t.stages;return out;});};
    const out={...r};for(const key of ['maps','entries','chapters','cannons','banners'])if(Array.isArray(r[key]))out[key]=rename(r[key],other[key]);
    if(Array.isArray(r.rarities)&&Array.isArray(other.rarities)&&r.rarities.length===other.rarities.length)out.rarities=other.rarities;
    return out;
  }
  const meta=request=>{const r=localize(request,metadata.handle(save,gd,request));if(!r||r.success===false)throw Object.assign(new Error(L('이 SAVE에서는 쓸 수 없는 기능입니다.','This feature is not available for this SAVE.','このセーブでは使えない機能です。','此存檔無法使用這個功能。')),{code:r?.errorCode||'META'});return r;};
  const allowed=edit=>editEnabled(policy,edit)&&!(['max_all','max_account'].includes(edit.type)&&access.canUseMax===false);
  const ownerCap=(technical,owner)=>Number.isSafeInteger(owner)&&owner>0?Math.min(technical,owner):technical;

  // Pick entries from a list of {id,name}: "all", numbers/ranges of ids, "/word" to search, "l" to list.
  async function pickEntries(title,entries,{max=5000,show=e=>`${e.id}) ${e.name}`}={}){
    const ids=new Set(entries.map(e=>Number(e.id)));
    say('');say(`${title} (${entries.length})`);
    say(L('  all = 전부 · 번호 예: 0-5, 8 · /검색어 · l = 목록 보기','  all = everything · ids like 0-5, 8 · /word to search · l = list','  all = すべて · 番号 例: 0-5, 8 · /単語 で検索 · l = 一覧','  all = 全部 · 編號 例: 0-5, 8 · /關鍵字 搜尋 · l = 列表'));
    for(;;){
      const a=await ask('> ');
      if(a==='l'){entries.slice(0,500).forEach(e=>say('  '+show(e)));if(entries.length>500)say(L(`  ...외 ${entries.length-500}개 (/검색어로 찾으세요)`,`  ...${entries.length-500} more (search with /word)`,`  ...ほか${entries.length-500}件 (/単語 で検索してください)`,`  ...還有 ${entries.length-500} 項（請用 /關鍵字 搜尋）`));continue;}
      if(a.startsWith('/')){const q=a.slice(1).trim().toLowerCase().replace(/\s+/g,'');const hits=entries.filter(e=>String(e.name).toLowerCase().replace(/\s+/g,'').includes(q));hits.slice(0,40).forEach(e=>say('  '+show(e)));say(L(`  ${hits.length}개 찾음`,`  ${hits.length} found`,`  ${hits.length}件見つかりました`,`  找到 ${hits.length} 項`));continue;}
      if(a.toLowerCase()==='all'){if(entries.length>max){say(L(`한 번에 ${max}개까지 고를 수 있습니다.`,`Up to ${max} at a time.`,`一度に${max}件まで選べます。`,`一次最多可選 ${max} 項。`));continue;}return entries.map(e=>Number(e.id));}
      const nums=parseNumbers(a);
      if(nums&&nums.every(n=>ids.has(n))&&nums.length<=max)return nums;
      say(L('목록에 있는 번호를 입력하세요.','Enter ids from the list.','一覧にある番号を入力してください。','請輸入列表中的編號。'));
    }
  }
  // Stage numbers as people count them (1..count), returned 0-based. Enter = whole.
  async function pickStages(count){
    say(L(`스테이지: Enter = 전부, 또는 번호 (1~${count}, 예: 1-10, 15)`,`Stages: Enter = all, or numbers (1-${count}, e.g. 1-10, 15)`,`ステージ: Enter = すべて、または番号 (1~${count}、例: 1-10, 15)`,`關卡: Enter = 全部，或輸入編號 (1~${count}，例: 1-10, 15)`));
    for(;;){const a=await ask('> ');if(!a)return {mode:'whole',stages:[]};const n=parseNumbers(a);if(n&&n.every(x=>x>=1&&x<=count))return {mode:'specific',stages:n.map(x=>x-1)};say(L('범위 안의 번호를 입력하세요.','Enter numbers in range.','範囲内の番号を入力してください。','請輸入範圍內的編號。'));}
  }

  async function catTargets(){
    const modes=['all','unlocked','not_unlocked','obtainable','ids','name','rarity'];
    const i=await choose(L('어떤 고양이?','Which cats?','どのキャラ？','哪些角色？'),[L('전부','All','すべて','全部'),L('보유한 고양이','Owned','所持しているキャラ','已擁有的角色'),L('보유하지 않은 고양이','Not owned','所持していないキャラ','未擁有的角色'),L('획득 가능한 고양이','Obtainable','入手可能なキャラ','可取得的角色'),L('번호로 (예: 0-10, 25)','By id (e.g. 0-10, 25)','番号で (例: 0-10, 25)','依編號（例: 0-10, 25）'),L('이름으로 찾기','By name','名前で検索','依名稱搜尋'),L('희귀도로','By rarity','レアリティで','依稀有度')]);
    let value='';
    if(modes[i]==='ids')value=await ask(L('고양이 번호: ','Cat ids: ','キャラ番号: ','角色編號: '));
    if(modes[i]==='name')value=await ask(L('이름 (일부만 써도 됩니다): ','Name (part is fine): ','名前 (一部でもOK): ','名稱（輸入部分即可）: '));
    if(modes[i]==='rarity'){const info=meta({action:'cat_selector',mode:'selector_info'});const r=await choose(L('희귀도','Rarity','レアリティ','稀有度'),info.rarities);value=String(r);}
    const r=meta({action:'cat_selector',mode:modes[i],value});
    // A name search also looks at the names in the chosen language (the same cat ids in that region's data).
    if(modes[i]==='name'&&names&&names!==gd){try{const all=new Set(meta({action:'cat_selector',mode:'all'}).catIds),more=metadata.handle(save,names,{action:'cat_selector',mode:'name',value});
      if(more?.success)r.catIds=[...new Set([...(r.catIds||[]),...more.catIds.filter(id=>all.has(id))])].sort((a,b)=>a-b);}catch{}}
    if(!r.catIds?.length)throw new Error(L('해당하는 고양이가 없습니다.','No cats match.','該当するキャラがいません。','沒有符合的角色。'));
    say(L(`고양이 ${r.catIds.length}마리 선택`,`${r.catIds.length} cats selected`,`キャラ${r.catIds.length}体を選択`,`已選擇 ${r.catIds.length} 隻角色`));
    return r.catIds;
  }
  async function cats(){
    const ops=CAT_OPS.filter(op=>allowed({type:'cat',operation:op}));if(!ops.length)throw new Error(L('관리자가 고양이 편집을 꺼 두었습니다.','Cat edits are turned off.','キャラの編集は管理者により無効になっています。','角色編輯已被管理員關閉。'));
    const op=ops[await choose(L('고양이 작업','Cat action','キャラの操作','角色操作'),ops.map(label))];
    const catIds=await catTargets(),edit={type:'cat',operation:op,catIds};
    if(op==='set_level'){const m=meta({action:'cat_level_metadata',catIds});const baseMax=ownerCap(m.baseMax,limits.catBase),plusMax=ownerCap(m.plusMax,limits.catPlus);
      edit.base=await askNumber(L('기본 레벨','Base level','基本レベル','基本等級'),1,baseMax);edit.plus=plusMax>0?await askNumber(L('플러스 레벨','Plus level','プラスレベル','加值等級'),0,plusMax):0;}
    if(op==='upgrade_by'||op==='storage_add')edit.amount=await askNumber(op==='upgrade_by'?L('올릴 레벨','Levels to add','上げるレベル','要提升的等級'):L('넣을 개수','Amount','数','數量'),1,Number(limits.catUpgradeAmount)||100000);
    if(op==='remove'&&!(await yes(L(`고양이 ${catIds.length}마리를 삭제합니다. 계속할까요?`,`Remove ${catIds.length} cats?`,`キャラ${catIds.length}体を削除します。続けますか？`,`將刪除 ${catIds.length} 隻角色。要繼續嗎？`))))return null;
    return edit;
  }
  async function itemsMenu(){
    const name=ITEMS[await choose(L('아이템','Item','アイテム','道具'),ITEMS.map(label))];
    const game=items.limit(save,name);if(game==null)throw new Error(L('이 SAVE에는 없는 항목입니다.','This SAVE does not have this item.','このセーブにはない項目です。','此存檔沒有這個項目。'));
    return {type:'item',item:name,value:await askNumber(label(name),0,ownerCap(game,limits.items?.[name]))};
  }
  async function inventory(){
    const name=INVENTORIES[await choose(L('보관함','Inventory','所持品','持有物品'),INVENTORIES.map(label))],m=meta({action:'inventory_metadata',inventory:name});
    const ids=await pickEntries(label(name),m.entries,{show:e=>`${e.id}) ${e.name}${e.value!==undefined?` [${e.value}]`:''}`});
    return {type:'inventory',inventory:name,ids,value:await askNumber(L('개수','Amount','数','數量'),0,m.maximum)};
  }
  async function storyMenu(){
    const kinds=['story_clear','treasures','outbreaks','timed_scores'].filter(t=>allowed({type:t}));if(!kinds.length)throw new Error(L('관리자가 스토리 편집을 꺼 두었습니다.','Story edits are turned off.','ストーリーの編集は管理者により無効になっています。','故事編輯已被管理員關閉。'));
    const type=kinds[await choose(L('스토리','Story','ストーリー','故事'),kinds.map(label))],m=meta({action:'metadata'});
    const eligible=m.chapters.filter(c=>(type!=='timed_scores'||Number(c.group)===1)&&(type!=='outbreaks'||c.outbreakStages?.length));
    const chapters=await pickEntries(L('챕터','Chapters','章','章節'),eligible);
    const count=Math.min(...eligible.filter(c=>chapters.includes(Number(c.id))).map(c=>c.stages.length));
    const {mode,stages}=type==='outbreaks'?{mode:'whole',stages:[]}:await pickStages(count);
    const edit={type,chapters,mode,stages};
    if(type==='outbreaks')edit.value=await yes(L('클리어로 바꿀까요? (n = 미클리어로)','Mark as cleared? (n = not cleared)','クリア済みにしますか？(n = 未クリアに)','要設為已通關嗎？（n = 設為未通關）'));
    else edit.value=await askNumber(type==='treasures'?L('보물 등급 (0 없음, 1 동, 2 은, 3 금)','Treasure grade (0 none, 1 bronze, 2 silver, 3 gold)','お宝のランク (0 なし、1 銅、2 銀、3 金)','寶物等級（0 無、1 銅、2 銀、3 金）'):type==='timed_scores'?L('점수','Score','スコア','分數'):L('클리어 횟수','Clear count','クリア回数','通關次數'),0,type==='treasures'?m.treasureMax:type==='timed_scores'?m.scoreMax:m.clearMax);
    return edit;
  }
  async function maps(){
    const category=MAPS[await choose(L('스테이지 종류','Stage group','ステージの種類','關卡類型'),MAPS.map(label))],m=meta({action:'map_metadata',category});
    if(!m.maps.length)throw new Error(L('이 SAVE에는 이 종류의 맵이 없습니다.','This SAVE has no maps of this kind.','このセーブにはこの種類のマップがありません。','此存檔沒有這類地圖。'));
    const mapIds=await pickEntries(label(category),m.maps),chosen=m.maps.filter(x=>mapIds.includes(Number(x.id)));
    const crowns=Math.min(...chosen.map(x=>x.stageCounts.length));
    const star=crowns>1?(await askNumber(L('왕관 (별) 단계','Crown','王冠','王冠'),1,crowns))-1:0;
    const {mode,stages}=await pickStages(Math.min(...chosen.map(x=>Number(x.stageCounts[star]))));
    const clear=await yes(L('클리어로 바꿀까요? (n = 미클리어로)','Mark as cleared? (n = not cleared)','クリア済みにしますか？(n = 未クリアに)','要設為已通關嗎？（n = 設為未通關）'));
    const amount=clear?await askNumber(L('클리어 횟수','Clear count','クリア回数','通關次數'),1,m.clearMax):0;
    return {type:mapIds.length===1?'map':'map_batch',category,mapIds,mapId:mapIds[0],mapName:chosen[0]?.name||'',star,mode,stages,clear,amount};
  }
  async function collections(){
    const names=COLLECTIONS.filter(c=>allowed({type:'collection',collection:c}));
    const collection=names[await choose(L('수집 항목','Collection','収集項目','收集項目'),names.map(label))],m=meta({action:'collection_metadata',collection});
    if(!m.entries.length)throw new Error(L('바꿀 항목이 없습니다.','Nothing to change here.','変更できる項目がありません。','沒有可變更的項目。'));
    const ids=await pickEntries(label(collection),m.entries,{show:e=>`${e.id}) ${e.name}${e.value!==undefined?` [${e.value}]`:''}`}),edit={type:'collection',collection,ids};
    if(m.actions){const keys=Object.keys(m.actions);const action=keys[await choose(L('작업','Action','操作','操作'),keys.map(k=>m.actions[k]))];return {...edit,action,actionLabel:m.actions[action]};}
    if(m.fields){const chosen=m.entries.filter(e=>ids.includes(Number(e.id)));const baseMax=Math.min(...chosen.map(e=>Number(e.baseMax))),plusMax=Math.min(...chosen.map(e=>Number(e.plusMax)));
      return {...edit,base:await askNumber(L('기본 레벨','Base level','基本レベル','基本等級'),1,baseMax),plus:plusMax>0?await askNumber(L('플러스 레벨','Plus level','プラスレベル','加值等級'),0,plusMax):0};}
    if(m.duration){say(L('남은 시간(초)을 입력하세요. 무제한은 infinity','Enter seconds left, or infinity','残り秒数を入力してください。無制限は infinity','請輸入剩餘秒數。無限制請輸入 infinity'));for(;;){const a=(await ask('> ')).toLowerCase();if(a==='infinity')return {...edit,value:'infinity'};const n=Number(a);if(Number.isFinite(n)&&n>=0)return {...edit,value:n};}}
    return {...edit,value:await askNumber(L('값','Value','値','數值'),0,Number.isSafeInteger(m.maximum)?m.maximum:2147483647)};
  }
  async function expedition(){
    const operation=EXPEDITIONS[await choose(L('가마토토 · 오토토 · 고양이 신사','Gamatoto, Ototo and Cat Shrine','ガマトト・オトート・ネコ神社','喵喵探險隊・弟弟・貓咪神社'),EXPEDITIONS.map(label))],m=meta({action:'expedition_metadata'}),edit={type:'expedition',operation};
    if(operation==='shrine_appear'||operation==='shrine_disappear')return edit;
    if(operation==='helpers'){const counts=[];let left=m.maxHelpers;for(let i=0;i<m.rarities.length;i++){const n=await askNumber(m.rarities[i],0,Math.min(m.rarityCounts[i],left));counts.push(n);left-=n;}return {...edit,counts};}
    if(operation==='cannon_levels'||operation==='cannon_development'){
      const list=operation==='cannon_development'?m.cannons.filter(c=>Number(c.id)!==0):m.cannons;const cannon=list[await choose(L('대포','Cannon','キャノン','大砲'),list.map(c=>c.name))];edit.cannonId=Number(cannon.id);
      if(operation==='cannon_levels'){edit.levels=[];for(let i=0;i<cannon.maximums.length;i++)edit.levels.push(await askNumber(L(`레벨 ${i+1}`,`Level ${i+1}`,`レベル ${i+1}`,`等級 ${i+1}`),0,cannon.maximums[i]));}
      else edit.value=await askNumber(L('개발 단계','Development stage','開発段階','開發階段'),0,3);
      return edit;
    }
    let max=2147483647,min=0;if(operation==='level'){max=m.maxLevel;min=1;}if(operation==='engineers')max=m.engineerMax;
    if(operation.startsWith('shrine_')){const s=meta({action:'shrine_metadata'});max=operation==='shrine_level'?s.shrineLevelMax:s.shrineXpMax;if(operation==='shrine_level')min=1;}
    edit.value=await askNumber(label(operation),min,max);return edit;
  }
  async function extras(){
    const operation=EXTRAS[await choose(L('기타','Other','その他','其他'),EXTRAS.map(label))],m=meta({action:'extra_metadata',operation}),edit={type:'extra',operation,note:String(m.note||'').slice(0,300)};
    if(m.noteKo||m.note)say(en()?m.note:m.noteKo||m.note);
    for(const f of m.fields||[])edit[f.id]=await askNumber(en()?f.name:f.nameKo||f.name,0,f.max);
    return edit;
  }
  async function account(){
    const opts=[['playtime'],['gacha_seed'],['score'],['clear_to_japan'],['special_skills'],...SIMPLES.map(s=>['simple',s])].filter(([t,s])=>allowed(s?{type:t,operation:s}:{type:t}));
    const [type,operation]=opts[await choose(L('계정 · 복구','Account and fixes','アカウント・修復','帳號・修復'),opts.map(([t,s])=>label(s||t)))];
    if(type==='simple')return {type,operation};
    if(type==='playtime')return {type,hours:await askNumber(L('시간','Hours','時間','小時'),0,19000),minutes:await askNumber(L('분','Minutes','分','分'),0,59),seconds:await askNumber(L('초','Seconds','秒','秒'),0,59)};
    if(type==='gacha_seed'){const seed=['rare','normal','event'][await choose(L('가챠 시드','Gacha seed','ガチャシード','轉蛋種子'),[L('레어 가챠','Rare','レアガチャ','稀有轉蛋'),L('노멀 가챠','Normal','ノーマルガチャ','普通轉蛋'),L('이벤트 가챠','Event','イベントガチャ','活動轉蛋')])];return {type,seed,value:await askNumber(L('시드 값','Seed','シード値','種子值'),0,4294967295)};}
    if(type==='score'){const score=['dojo','challenge'][await choose(L('점수','Score','スコア','分數'),[L('도장 점수','Dojo','道場スコア','道場分數'),L('챌린지 배틀 점수','Challenge battle','チャレンジバトルスコア','挑戰戰分數')])];return {type,score,value:await askNumber(L('점수','Score','スコア','分數'),0,2147483647)};}
    return {type};
  }
  // Every Max Account part the owner allows (the web editor's default selection).
  async function maxAccount(){return {type:'max_account',components:maxAccountComponents(policy),mapCategories:[]};}
  const SECTIONS=[
    [L('아이템 (통조림, XP, 티켓...)','Items (Cat Food, XP, tickets...)','アイテム (ネコカン、XP、チケット...)','道具（貓罐頭、XP、轉蛋券...）'),itemsMenu,{type:'item'}],
    [L('보관함 (캣츠아이, 드링크, 개다래...)','Inventory (Catseyes, Catamins, Catfruit...)','所持品 (ネコの目、ネコビタン、マタタビ...)','持有物品（貓眼石、貓薄荷飲料、木天蓼...）'),inventory,{type:'inventory'}],
    [L('고양이 (선택해서 해금·진화·레벨·본능...)','Cats (pick cats: unlock, forms, levels, talents...)','キャラ (選んで: 入手・進化・レベル・本能...)','角色（選擇後: 取得、進化、等級、本能...）'),cats,{type:'cat',operation:'unlock'}],
    [L('스토리 (클리어·보물·좀비·스코어)','Story (clears, treasures, outbreaks, scores)','ストーリー (クリア・お宝・ゾンビ・スコア)','故事（通關、寶物、殭屍、分數）'),storyMenu,{type:'story_clear'}],
    [L('스테이지 맵 (레전드·이벤트·콜라보...)','Stage maps (Legend, event, collab...)','ステージマップ (レジェンド・イベント・コラボ...)','關卡地圖（傳說、活動、合作...）'),maps,{type:'map'}],
    [L('수집 (특수능력, 메달, 본능 구슬...)','Collections (skills, medals, talent orbs...)','収集 (特殊能力・メダル・本能玉...)','收集（特殊能力、勳章、本能玉...）'),collections,{type:'collection',collection:'talent_orbs'}],
    [L('가마토토 · 오토토 · 고양이 신사','Gamatoto, Ototo, Cat Shrine','ガマトト・オトート・ネコ神社','喵喵探險隊・弟弟・貓咪神社'),expedition,{type:'expedition'}],
    [L('기타 (편성 슬롯, 1억 티켓...)','Other (lineup slots, 100M tickets...)','その他 (編成スロット・1億チケット...)','其他（編成欄位、1 億轉蛋券...）'),extras,{type:'extra'}],
    [L('계정 · 복구 (플레이 시간, 시드, 오류 복구...)','Account and fixes (play time, seed, repairs...)','アカウント・修復 (プレイ時間・シード・不具合修復...)','帳號・修復（遊玩時間、種子、錯誤修復...）'),account,{type:'simple',operation:'fix_time_errors'}],
    [L('전부 최대 (Max All)','Max All','すべて最大 (Max All)','全部最大 (Max All)'),async()=>({type:'max_all'}),{type:'max_all'}],
    [L('계정 최대 (Max Account)','Max Account','アカウント最大 (Max Account)','帳號最大 (Max Account)'),maxAccount,{type:'max_account'}],
  ];
  const sections=()=>SECTIONS.filter(([, ,probe])=>probe.type==='item'||probe.type==='inventory'?allowed(probe):probe.type==='collection'?COLLECTIONS.some(c=>allowed({type:'collection',collection:c})):probe.type==='simple'?true:allowed(probe));
  // One edit chosen through the menus, or null when the person backs out.
  // Backing out inside a section (a BACK error from any prompt) returns to this list; backing out here goes further up.
  async function pick(){
    for(;;){
      const list=sections();const i=await choose(L('무엇을 바꿀까요?','What to change?','何を変更しますか？','要變更什麼？'),[...list.map(s=>s[0]),L('← 돌아가기','← Back','← 戻る','← 返回')]);
      if(i===list.length)return null;
      let edit;
      try{edit=await list[i][1]();}
      catch(err){if(err?.code!=='BACK')throw err;say(L('돌아갑니다. 아무것도 바꾸지 않았습니다.','Back. Nothing was changed.','戻ります。何も変更していません。','返回。沒有做任何變更。'));continue;}
      if(edit&&!allowed(edit))throw new Error(L('관리자가 이 기능을 꺼 두었습니다.','This feature is turned off by an administrator.','この機能は管理者により無効になっています。','此功能已被管理員關閉。'));
      return edit;
    }
  }
  function describe(e){
    const n=v=>typeof v==='number'?v.toLocaleString():String(v);
    if(e.type==='item')return `${label(e.item)} = ${n(e.value)}`;
    if(e.type==='cat')return `${L('고양이','Cats','キャラ','角色')} ${e.catIds.length}${L('마리','','体','隻')} · ${label(e.operation)}${e.base!==undefined?` Lv${e.base}+${e.plus}`:''}${e.amount!==undefined?` ${n(e.amount)}`:''}`;
    if(e.type==='inventory')return `${label(e.inventory)} ${e.ids.length}${L('종','','種','種')} = ${n(e.value)}`;
    if(['story_clear','treasures','outbreaks','timed_scores'].includes(e.type))return `${label(e.type)} · ${e.chapters.length}${L('챕터',' chapters','章',' 章')} · ${e.mode==='whole'?L('전체 스테이지','all stages','全ステージ','全部關卡'):`${e.stages.length}${L('스테이지',' stages','ステージ',' 個關卡')}`} = ${n(e.value)}`;
    if(e.type==='map'||e.type==='map_batch')return `${label(e.category)} · ${e.mapIds.length===1?e.mapName:`${e.mapIds.length}${L('개 맵',' maps','マップ',' 張地圖')}`} · ${e.clear?`${L('클리어','clear','クリア','通關')} ${n(e.amount)}`:L('미클리어','not cleared','未クリア','未通關')}`;
    if(e.type==='collection')return `${label(e.collection)} ${e.ids.length}${L('개','','個','個')} · ${e.actionLabel||(e.base!==undefined?`Lv${e.base}+${e.plus}`:n(e.value))}`;
    if(e.type==='expedition')return `${label(e.operation)}${e.value!==undefined?` = ${n(e.value)}`:''}`;
    if(e.type==='extra')return label(e.operation)+(e.value!==undefined?` = ${n(e.value)}`:'');
    if(e.type==='simple')return label(e.operation);
    if(e.type==='playtime')return `${label('playtime')} ${e.hours}:${String(e.minutes).padStart(2,'0')}:${String(e.seconds).padStart(2,'0')}`;
    if(e.type==='gacha_seed'||e.type==='score')return `${label(e.type)} ${e.seed||e.score} = ${n(e.value)}`;
    return label(e.type);
  }
  return {pick,describe,allowed};
}
module.exports={createMenus,parseNumbers,EN};
