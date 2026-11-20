// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Game data files (DataLocal/*.csv of one game version) for SAVE edits. CanBot's table reading:
// lines split on commas, anything after "//" dropped, cells trimmed, and EMPTY CELLS AND EMPTY LINES REMOVED (later
// columns shift left). A number that is not a plain integer reads as 0.
const fs=require('node:fs'),path=require('node:path');

// Quote removal in one pass: a quote at the start of a field opens a quoted run, "" inside it is one quote and the
// next lone quote closes it; the quotes themselves are dropped. Delimiters inside a quoted run stay as plain
// characters (so they still split cells afterwards).
function unquote(line,delim){
  let out='',quoted=false,fieldStart=true;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(quoted){
      if(ch!=='"')out+=ch;
      else if(line[i+1]==='"'){out+='"';i++;}
      else quoted=false;
      continue;
    }
    if(ch==='"'&&fieldStart){quoted=true;fieldStart=false;continue;}
    out+=ch;fieldStart=ch===delim;
  }
  return out;
}
// Line breaks: CRLF and every single-character break (LF, CR, VT, FF, FS, GS, RS, NEL, LS, PS).
const LINE_BREAKS=new RegExp(String.raw`\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]`);
// Rows of cells: quotes removed, "//" comments cut, split on the delimiter, cells trimmed, empty cells and empty lines
// dropped. keepEmpty keeps them (an empty line is then a row with one empty cell).
function parseCsv(text,delim=',',keepEmpty=false){
  const rows=[],lines=String(text).split(LINE_BREAKS);
  if(lines.length&&lines[lines.length-1]==='')lines.pop();
  for(const line of lines){
    const cells=unquote(line,delim).split('//')[0].split(delim).map(c=>c.trim()).filter(c=>keepEmpty||c!=='');
    if(cells.length||keepEmpty)rows.push(cells);
  }
  return rows;
}
const toInt=v=>{const s=String(v??'').trim();return /^[+-]?\d+(?:_\d+)*$/.test(s)?Number(s.replace(/_/g,'')):0;};

class GameData{
  // dir: the game data folder of one version, e.g. <game data>/kr/15.7.0
  // files: optional Map of "DataLocal/x.csv" -> Buffer (a game data pack read into memory) used instead of the folder.
  constructor(dir,files=null){this.dir=dir;this.files=files;this.cache=new Map();}
  // Name files are comma separated in the Japanese game and '|' separated elsewhere. The data's own region (its
  // folder, <region>/<version>) decides; the SAVE's region is only the fallback. They differ only when names are read
  // from another region's data for display (canbot.js in another language).
  region(){const r=path.basename(path.dirname(this.dir));return ['kr','en','jp','tw'].includes(r)?r:null;}
  delim(cc){return (this.region()||cc)==='jp'?',':'|';}
  _read(rel,encoding){if(this.files){const b=this.files.get(rel);if(!b)throw Object.assign(new Error('missing '+rel),{code:'ENOENT'});return encoding?b.toString(encoding):b;}return fs.readFileSync(path.join(this.dir,...rel.split('/')),encoding);}
  csv(file,folder='DataLocal',delim=',',keepEmpty=false){const key=`${folder}/${file}/${keepEmpty}`;if(!this.cache.has(key)){let text=null;try{text=this._read(`${folder}/${file}`,'utf8');}catch{}this.cache.set(key,text===null?null:parseCsv(text,delim,keepEmpty));}return this.cache.get(key);}
  // Gamatoto: levels (row i = level i+1, column 0 = cumulative XP needed) and the limit row (max level, stages, helpers).
  gamatotoLevels(){const rows=this.csv('GamatotoExpedition.csv');return rows&&rows.map((r,i)=>({level:i+1,xpNeeded:toInt(r[0])}));}
  gamatotoLimit(){const rows=this.csv('GamatotoExpedition_Limit.csv');return rows&&rows.length?{maxLevel:toInt(rows[0][0]),totalStages:toInt(rows[0][1]),totalHelpers:toInt(rows[0][2])}:null;}
  // Gamatoto members (header skipped, id -1 skipped; empty cells kept): id, rarity, bonus, name, rarity name.
  gamatotoMembers(cc){const rows=this.csv(`GamatotoExpedition_Members_name_${this.lang()}.csv`,'resLocal',this.delim(cc),true);return rows&&rows.slice(1).filter(r=>toInt(r[0])!==-1).map(r=>({id:toInt(r[0]),rarity:toInt(r[1]),rarityName:String(r[4]??'')}));}
  // Cat Shrine: cumulative XP boundaries from jinja_level.
  shrineBoundaries(cc){const rows=this.csv('jinja_level.csv','resLocal',this.delim(cc));if(!rows)return null;let sum=0;return rows.map(r=>(sum+=toInt(r[0])));}
  // Ototo: recipe unlocks (cannon, part, ?, ?, level), cannon descriptions (empty cells kept) and the engineer limit.
  recipeUnlocks(){const rows=this.csv('CastleRecipeUnlock.csv');return rows&&rows.map((r,i)=>({index:i,cannon:toInt(r[0]),part:toInt(r[1]),level:toInt(r[4])}));}
  cannonDescriptions(cc){const rows=this.csv('CastleRecipeDescriptions.csv','resLocal',this.delim(cc),true);return rows&&rows.map(r=>({cannonId:toInt(r[0]),name:String(r[6]??'')}));}
  maxEngineers(){const rows=this.csv('CastleCustomLimit.csv');return rows?toInt(rows[0]?.[0]):5;}
  // Talents: SkillAcquisition (header skipped; cat id, type, then 14 numbers per skill), SkillLevel must exist, and
  // the talent names (resLocal SkillDescriptions; "|"-separated outside JP) - a talent without a name is skipped.
  talentData(cc){
    if(this._td!==undefined)return this._td;
    const acq=this.csv('SkillAcquisition.csv'),levels=this.csv('SkillLevel.csv'),names=this.csv('SkillDescriptions.csv','resLocal',this.delim(cc));
    if(!acq||!levels||!names){this._td=null;return null;}
    const cats=new Map();
    for(const r of acq.slice(1)){const at=i=>toInt(r[i]);const skills=[];for(let i=2;i<r.length;i+=14)skills.push({abilityId:at(i),maxLv:at(i+1),textId:at(i+10)});cats.set(at(0),{catId:at(0),typeId:at(1),skills});}
    const nameIds=new Set(names.slice(1).map(r=>toInt(r[0])));
    this._td={cats,nameIds};return this._td;
  }
  // Cat picture book: one line per cat id (line index); column 2 is the number of forms.
  pictureBook(){const rows=this.csv('nyankoPictureBookData.csv');return rows&&rows.map((r,i)=>({catId:i,displayed:toInt(r[0])!==0,limited:toInt(r[1])!==0,totalForms:toInt(r[2])}));}
  // Drop characters: header line skipped; stage id, the unitDrops index, cat id.
  drops(){if(this._drops===undefined){const rows=this.csv('drop_chara.csv');this._drops=rows&&rows.slice(1).map(r=>({stageId:toInt(r[0]),saveId:toInt(r[1]),catId:toInt(r[2])}));}return this._drops;}
  // Drop entries of one cat, in file order.
  dropsOf(catId){if(this._dropsByCat===undefined){const all=this.drops();this._dropsByCat=all&&new Map();for(const d of all||[]){if(!this._dropsByCat.has(d.catId))this._dropsByCat.set(d.catId,[]);this._dropsByCat.get(d.catId).push(d);}}return this._dropsByCat?(this._dropsByCat.get(catId)||[]):null;}
  // Unit purchase/upgrade table, one line per cat id. A missing cell reads as 0.
  unitBuy(){if(!this._ub){const rows=this.csv('unitbuy.csv');this._ub=rows&&rows.map((r,i)=>({id:i,rarity:toInt(r[13]),originalMax:[toInt(r[18]),toInt(r[19])],unlockSource:toInt(r[12]),unknown22:toInt(r[22]),maxNoCatseye:toInt(r[49]),maxCatseye:toInt(r[50]),maxPlus:toInt(r[51]),gameVersion:toInt(r[57])}));}return this._ub;}
  // Language code of the game data (resLocal/localizable.tsv "lang"); "en" when it is missing.
  lang(){const rows=this.csv('localizable.tsv','resLocal','\t');const row=rows?.find(r=>r[0]==='lang');return row?.[1]||'en';}
  // Map names: StageName_[R]<code>_<lang> rows (row index = map index) and Map_Name ids from base. A map listed in
  // Map_Name gets a name (or null); the header row is read too (its id parses as 0).
  mapNames(cc,code,base,noR=false){
    const delim=this.delim(cc),stageRows=this.csv(`StageName_${noR?'':'R'}${code}_${this.lang()}.csv`,'resLocal',delim);if(!stageRows)return null;
    const stageNames=new Map(stageRows.map((r,i)=>[i,r]));
    const nameRows=this.csv('Map_Name.csv','resLocal',delim);if(!nameRows)return null;
    const names=new Map(),total=stageNames.size;
    for(const r of nameRows){const id=toInt(r[0]),name=String(r[1]??'').trim();for(let i=0;i<total;i++)if(id===i+base){names.set(i,name||null);break;}}
    return {names,stageNames};
  }
  // Map_option: header skipped; map id, crown count, ...
  mapOptions(){const rows=this.csv('Map_option.csv');return rows&&new Map(rows.slice(1).map(r=>[toInt(r[0]),{crowns:toInt(r[1])}]));}
  // Special skills: one line per skill (no header): sell price, rarity, max base level, max plus level, ...
  abilityData(){const rows=this.csv('AbilityData.csv');return rows&&rows.map(r=>({maxBase:toInt(r[2]),maxPlus:toInt(r[3])}));}
  // Unit level limits: the reward ids that raise each cat's cap.
  unitLimit(){if(!this._ul){const rows=this.csv('unitlimit.csv');this._ul=rows&&rows.map(r=>r.map(toInt));}return this._ul;}
  // User-rank gifts: threshold, then (reward id, amount) pairs until -1.
  rankGifts(){if(!this._rg){const rows=this.csv('rankGift.csv');this._rg=rows&&rows.map((r,i)=>{const rewards=[];for(let c=1;c<r.length;c+=2){const v=toInt(r[c]);if(v===-1)break;rewards.push([v,toInt(r[c+1])]);}return {index:i,threshold:toInt(r[0]),rewards};});}return this._rg;}
  // Item table (header skipped; item id = row index after the header). Category and index pick a SAVE slot.
  gatyaItemBuy(){if(!this._gb){const rows=this.csv('Gatyaitembuy.csv');this._gb=rows&&rows.slice(1).map((r,i)=>({id:i,rarity:toInt(r[0]),price:toInt(r[2]),quantity:toInt(r[4]),serverId:toInt(r[5]),category:toInt(r[6]),index:toInt(r[7])}));}return this._gb;}
  // Items of one category, stably sorted by their index column.
  gatyaByCategory(category){const buy=this.gatyaItemBuy();return buy&&buy.filter(x=>x.category===category).sort((a,b)=>a.index-b.index);}
  gatyaItemNames(cc){const rows=this.csv('GatyaitemName.csv','resLocal',this.delim(cc));return rows&&rows.map(r=>String(r[0]??''));}
  medalNames(){return this.csv('medalname.tsv','resLocal','\t');}
  missionNames(cc){const rows=this.csv('Mission_Name.csv','resLocal',this.delim(cc));return rows&&new Map(rows.map(r=>[toInt(r[0]),String(r[1]??'')]));}
  // Mission conditions. Files with a shortcut_id column are read with the progress count in column 4 (the older
  // layout); otherwise column 3.
  missionConditions(){
    const rows=this.csv('Mission_Condition.csv');if(!rows)return null;
    const legacy=['id','mission_type','conditions_type','shortcut_id','progress_count','conditions_value'].every((h,i)=>rows[0]?.[i]===h);
    return new Map((legacy?rows.slice(1):rows).map(r=>[toInt(r[0]),{missionType:toInt(r[1]),conditionsType:toInt(r[2]),progressCount:toInt(r[legacy?4:3]),values:r.slice(legacy?5:4).map(toInt)}]));
  }
  // Main story stage names of one chapter group (0 EoC, 1 ItF, 2 CotC): first cell per row, at most 48.
  storyStageNames(cc,group){const rows=this.csv(`StageName${group}_${this.lang()}.csv`,'resLocal',this.delim(cc));return rows&&rows.map(r=>String(r[0]??'')).slice(0,48);}
  // Gacha item name: an id past the list gives the untranslated key.
  gatyaName(cc,id){const names=this.gatyaItemNames(cc);if(!names)return null;return id<names.length?names[id]:'gatya_item_unknown_name';}
  // Enemyname.tsv (empty lines kept): first cell per line.
  enemyNames(){const rows=this.csv('Enemyname.tsv','resLocal','	',true);return rows&&rows.map(r=>String(r[0]??''));}
  // Unit_Explanation<id+1>_<lang>.csv: one line per form, the name first.
  catNames(cc,id){const rows=this.csv(`Unit_Explanation${id+1}_${this.lang()}.csv`,'resLocal',this.delim(cc),true);return rows&&rows.map(r=>String(r[0]??''));}
  // Matatabi.tsv (header skipped): catfruit gacha item ids in SAVE order.
  catfruitIds(){const rows=this.csv('Matatabi.tsv','DataLocal','	');return rows&&rows.slice(1).map(r=>toInt(r[0]));}
  // Talent orb name tables: grade (column 3), attribute (column 0), effect (column 0).
  orbNames(){if(this._orbNames===undefined){const g=this.csv('equipmentgrade.csv'),a=this.csv('attribute_explonation.tsv','resLocal','	'),e=this.csv('equipment_explonation.tsv','resLocal','	');this._orbNames=g&&a&&e?{grade:i=>String(g[i]?.[3]??''),attribute:i=>String(a[i]?.[0]??''),effect:i=>String(e[i]?.[0]??'')}:null;}return this._orbNames;}
  // GatyaDataSetR1.csv: the cat ids of each rare gacha set (-1 dropped).
  gatyaDataSet(){const rows=this.csv('GatyaDataSetR1.csv');return rows&&rows.map(r=>r.map(toInt).filter(x=>x!==-1));}
  // Banner title from the cached event page in the game data store (other_game_data/<cc>/gatya_info/R###.html): the
  // <h2> text without its <span>.
  bannerName(cc,id){
    try{const file=path.join(this.dir,'..','..','..','other_game_data',cc,'gatya_info',`R${String(id).padStart(3,'0')}.html`),b=fs.readFileSync(file);
      const h2=b.indexOf('<h2>');if(h2<0)return null;const end=b.indexOf('</h2>',h2);if(end<0)return null;
      const text=b.subarray(h2+4,end).toString('utf8'),span=text.indexOf('<span');if(span<0)return text;const spanEnd=text.indexOf('</span>',span);if(spanEnd<0)return text;return text.slice(0,span)+text.slice(spanEnd+7);
    }catch{return null;}
  }
  version(){return path.basename(this.dir);}
  rankGiftDescriptions(){const rows=this.csv('user_info.tsv','resLocal','\t');return rows&&rows.map(r=>({threshold:toInt(r[0]),text:String(r[1]??'')}));}
  localizable(){if(this._loc===undefined){const rows=this.csv('localizable.tsv','resLocal','\t');this._loc=rows&&new Map(rows.map(r=>[String(r[0]??''),String(r[1]??'')]));}return this._loc;}
  schemeItems(){const rows=this.csv('schemeItemData.tsv','DataLocal','\t');return rows&&rows.slice(1).map(r=>({id:toInt(r[0]),type:toInt(r[2]),itemId:toInt(r[3]),amount:toInt(r[4])}));}
  // Talent orbs: equipmentlist.json "ID" entries (orb id = position); the name tables must also exist.
  orbList(){
    if(this._orbs===undefined){
      this._orbs=null;
      try{
        for(const f of ['DataLocal/equipmentgrade.csv','resLocal/attribute_explonation.tsv','resLocal/equipment_explonation.tsv'])this._read(f);
        const data=JSON.parse(this._read('DataLocal/equipmentlist.json','utf8'));
        this._orbs=data.ID.map((o,id)=>({id,rank:o.gradeID,effect:o.content,target:o.attribute??null}));
      }catch{}
    }
    return this._orbs;
  }
}

module.exports={GameData,parseCsv,toInt};
