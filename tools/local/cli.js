// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// canbot.js - CanBot's local editor. Runs on Termux (Android) or any computer with Node.js 18+:
//   pkg install nodejs        (Termux; nothing else is needed)
//   curl -O https://canbot.dev/local/canbot.js && node canbot.js
// It edits SAVEs with CanBot's JS SAVE engine on the member's own device:
//   - transfer codes: download from PONOS, edit, upload, show the new codes (CanBot's own PONOS client, no retry);
//   - SAVE file: a rooted phone or emulator, the game's own SAVE_DATA file (a backup is kept first);
//   - adb: a phone or emulator connected to a computer (root on the device);
//   - restore: any backup in ~/.canbot/backups back to PONOS, a file or a device.
// A token from canbot.dev/local is needed. canbot.dev checks it on every run, provides the game data, and counts the
// SAVE in the same allowance as Discord and the website. No SAVE, transfer code or edit value is sent to canbot.dev.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const readline=require('node:readline/promises');
const engine=require('../../src/canbot-engine/index');
const {GameData}=require('../../src/canbot-engine/gamedata');
const {read:readPack}=require('../../src/canbot-engine/gamedata-pack');
const {applyEdits}=require('../../src/canbot-engine/apply');
const {createPonos}=require('../../src/canbot-engine/ponos');
const {createMenus}=require('./menus');

const CLIENT=1;
const SERVER=(process.env.CANBOT_SERVER||'https://canbot.dev').replace(/\/+$/,'');
const HOME=process.env.CANBOT_HOME||path.join(os.homedir(),'.canbot');
const CONFIG=path.join(HOME,'config.json');
const REGIONS=['kr','en','jp','tw'];
const PACKAGE={kr:'jp.co.ponos.battlecatskr',en:'jp.co.ponos.battlecatsen',jp:'jp.co.ponos.battlecats',tw:'jp.co.ponos.battlecatstw'};
const ITEMS=['catfood','xp','normal_tickets','rare_tickets','platinum_tickets','legend_tickets','platinum_shards','np','leadership'];
const ITEM_NAMES={catfood:['통조림','Cat Food'],xp:['XP','XP'],normal_tickets:['냥코 티켓','Cat Tickets'],rare_tickets:['레어 티켓','Rare Tickets'],platinum_tickets:['플래티넘 티켓','Platinum Tickets'],
  legend_tickets:['레전드 티켓','Legend Tickets'],platinum_shards:['플래티넘 조각','Platinum Shards'],np:['NP','NP'],leadership:['리더십','Leadership']};

let lang='ko',rl=null;
// Korean, English, Japanese, Traditional Chinese (tools/local/translations.txt fills the last two via i18n.js).
const L=(ko,en,ja,zh)=>lang==='ko'?ko:lang==='ja'?(ja??en):lang==='zh'?(zh??en):en;
const say=(...a)=>console.log(...a);
const fail=(code,message)=>Object.assign(new Error(message),{code});

// ---------- small helpers ----------
function loadConfig(){try{return JSON.parse(fs.readFileSync(CONFIG,'utf8'))||{};}catch{return {};}}
function saveConfig(c){fs.mkdirSync(HOME,{recursive:true,mode:0o700});fs.writeFileSync(CONFIG,JSON.stringify(c,null,1),{mode:0o600});}
// Typing one of these at any prompt backs out of the current step without changing anything: a section goes back to
// the list of sections, that list to the pending edits, the pending edits to the SAVE source menu (nothing uploaded),
// and the first menu quits. No prompt runs inside the upload step, so backing out never interrupts an upload.
const BACK_WORDS=new Set(['exit','back','뒤로','취소','戻る','返回']);
const isBack=err=>err?.code==='BACK';
async function ask(q){const a=(await rl.question(q)).trim();if(BACK_WORDS.has(a.toLowerCase()))throw fail('BACK','back');return a;}
const backed=()=>say(L('돌아갑니다. 아무것도 바꾸지 않았습니다.','Back. Nothing was changed.','戻ります。何も変更していません。','返回。沒有做任何變更。'));
async function choose(title,options){
  say('');say(title);options.forEach((o,i)=>say(`  ${i+1}) ${o}`));
  for(;;){const a=await ask('> ');const n=Number(a);if(Number.isInteger(n)&&n>=1&&n<=options.length)return n-1;say(L('번호를 입력하세요.','Enter a number.','番号を入力してください。','請輸入編號。'));}
}
async function askNumber(q,min,max){
  for(;;){const a=(await ask(`${q} (${min}~${max}): `)).replace(/,/g,'');const n=Number(a);if(Number.isSafeInteger(n)&&n>=min&&n<=max)return n;say(L('범위 안의 숫자를 입력하세요.','Enter a number in range.','範囲内の数字を入力してください。','請輸入範圍內的數字。'));}
}
async function yes(q){const a=(await ask(`${q} (y/n): `)).toLowerCase();return ['y','yes','ㅛ','예','네','はい','是','好'].includes(a);}
function stamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
function backup(name,bytes){const dir=path.join(HOME,'backups');fs.mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,`${stamp()}-${name}`);fs.writeFileSync(file,bytes,{mode:0o600});return file;}

// ---------- canbot.dev ----------
async function api(token,method,route,body){
  let res;
  try{res=await fetch(`${SERVER}${route}`,{method,headers:{authorization:`Bearer ${token}`,'x-canbot-lang':lang,'content-type':'application/json','user-agent':`canbot-local/${CLIENT}`},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});}
  catch{throw fail('OFFLINE',L('canbot.dev에 연결할 수 없습니다. 인터넷 연결을 확인하세요.','Cannot reach canbot.dev. Check your internet connection.','canbot.devに接続できません。インターネット接続を確認してください。','無法連線到 canbot.dev。請確認網路連線。'));}
  if(!res.ok){let j={};try{j=await res.json();}catch{}throw fail(j.code||`HTTP_${res.status}`,j.error||`HTTP ${res.status}`);}
  return res;
}
async function login(config){
  for(;;){
    if(!config.token){
      say(L('\n로컬 에디터 토큰이 필요합니다. canbot.dev/local 에서 디스코드로 로그인해 토큰을 받으세요.','\nA local editor token is needed. Sign in with Discord at canbot.dev/local to get one.','\nローカルエディターのトークンが必要です。canbot.dev/local でDiscordにログインして取得してください。','\n需要本機編輯器的權杖。請到 canbot.dev/local 以 Discord 登入取得。'));
      config.token=await ask(L('토큰 붙여넣기: ','Paste token: ','トークンを貼り付け: ','貼上權杖: '));if(!config.token)continue;
    }
    try{const hello=await (await api(config.token,'POST','/api/local/cli/hello',{client:CLIENT})).json();saveConfig(config);return hello;}
    catch(err){
      if(err.code==='LOCAL_TOKEN_INVALID'){say(L('토큰이 올바르지 않거나 회수되었습니다.','This token is not valid or was revoked.','このトークンは無効か、取り消されています。','此權杖無效或已被撤銷。'));config.token='';saveConfig(config);continue;}
      throw err;
    }
  }
}
// Game data stays one packed file per version (~/.canbot/gamedata/<region>/<version>.cbgd.gz) and is read in memory:
// nothing is unpacked, so the first run does not write ten thousand small files.
async function gameData(token,cc,version,hello){
  const file=path.join(HOME,'gamedata',cc,`${version}.cbgd.gz`),open=buf=>new GameData(path.join(HOME,'gamedata',cc,version),readPack(buf));
  if(fs.existsSync(file)){try{return open(fs.readFileSync(file));}catch{fs.rmSync(file,{force:true});}}
  if(!(hello.versions?.[cc]||[]).includes(version))throw fail('NO_GAME_DATA',L(`${cc.toUpperCase()} ${version} 게임 데이터가 아직 없습니다. 깡통봇에 새 버전이 들어오면 사용할 수 있습니다.`,`There is no game data for ${cc.toUpperCase()} ${version} yet. It becomes available when CanBot adds the version.`,`${cc.toUpperCase()} ${version} のゲームデータはまだありません。CanBotがこのバージョンに対応すると使えるようになります。`,`${cc.toUpperCase()} ${version} 的遊戲資料尚未提供。CanBot 支援此版本後即可使用。`));
  say(L(`게임 데이터 받는 중 (${cc.toUpperCase()} ${version})...`,`Downloading game data (${cc.toUpperCase()} ${version})...`,`ゲームデータをダウンロード中 (${cc.toUpperCase()} ${version})...`,`正在下載遊戲資料 (${cc.toUpperCase()} ${version})...`));
  const res=await api(token,'GET',`/api/local/cli/gamedata?cc=${cc}&v=${encodeURIComponent(version)}`);
  const buf=Buffer.from(await res.arrayBuffer());
  let gd;try{gd=open(buf);}catch{throw fail('GAME_DATA',L('게임 데이터가 손상되었습니다. 다시 실행해 주세요.','The game data download was damaged. Run again.','ゲームデータが破損しています。もう一度実行してください。','遊戲資料已損毀。請重新執行。'));}
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(`${file}.tmp`,buf);fs.renameSync(`${file}.tmp`,file);
  return gd;
}

// ---------- SAVE sources ----------
const ponos=createPonos({timeoutMs:60000});
// PONOS credentials of one account, kept on this device only (~/.canbot/accounts, 0600) and reused while valid.
function accountStore(code){
  const dir=path.join(HOME,'accounts'),file=path.join(dir,`${crypto.createHash('sha256').update(String(code)).digest('hex').slice(0,24)}.json`);
  return {get(){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}},
    set(v){fs.mkdirSync(dir,{recursive:true,mode:0o700});const tmp=`${file}.tmp`;fs.writeFileSync(tmp,JSON.stringify(v),{mode:0o600});fs.renameSync(tmp,file);}};
}
const codeOf=save=>String(save.data.inquiryCode);
async function fromTransferCodes(cc,hello){
  say(L('\n인계 코드는 업로드할 때 새 코드로 바뀝니다. 업로드하기 전에 나가면 같은 코드를 게임에서 그대로 쓸 수 있습니다.','\nThe transfer codes change only when you upload. If you leave before uploading, the same codes still work in the game.','\n引き継ぎコードはアップロードしたときだけ新しくなります。アップロード前に終了すれば、同じコードをゲームでそのまま使えます。','\n引繼碼只會在上傳時更換。在上傳前離開的話，同一組代碼仍可在遊戲中使用。'));
  const code=(await ask(L('인계 코드: ','Transfer code: ','引き継ぎコード: ','引繼碼: '))).replace(/\s+/g,'').toLowerCase();
  const pin=(await ask(L('인증 번호: ','Confirmation code: ','認証番号: ','認證碼: '))).replace(/\s+/g,'');
  if(!/^[0-9a-z]{9}$/.test(code)||!/^\d{4}$/.test(pin))throw fail('CODES',L('인계 코드는 9자리, 인증 번호는 4자리 숫자입니다.','The transfer code has 9 characters and the confirmation code 4 digits.','引き継ぎコードは9文字、認証番号は4桁の数字です。','引繼碼為 9 個字元，認證碼為 4 位數字。'));
  const version=hello.latest?.[cc];if(!version)throw fail('NO_GAME_DATA',L('이 지역은 아직 지원하지 않습니다.','This region is not supported yet.','この地域にはまだ対応していません。','尚未支援此地區。'));
  say(L('PONOS 서버에서 SAVE 받는 중...','Downloading the SAVE from PONOS...','PONOSサーバーからセーブを取得中...','正在從 PONOS 伺服器取得存檔...'));
  // PONOS takes the numeric game version ("15.7.0" -> 150700).
  const [a,b,c]=version.split('.').map(Number);
  let got;try{got=await ponos.receive(code,pin,cc,a*10000+b*100+c);}
  catch(err){if(err.code==='NO_CONNECTION')throw fail('PONOS_OFFLINE',L('PONOS 서버에 연결할 수 없습니다.','Cannot reach the PONOS server.','PONOSサーバーに接続できません。','無法連線到 PONOS 伺服器。'));throw fail('CODES',L('코드가 맞지 않거나 이미 사용된 코드입니다. 게임에서 새 코드를 발급받으세요.','The codes are wrong or already used. Issue new codes in the game.','コードが違うか、すでに使われています。ゲームで新しいコードを発行してください。','代碼錯誤或已被使用。請在遊戲中重新發行代碼。'));}
  const file=backup(`${cc}-received.sav`,got.bytes);
  say(L(`받은 SAVE 백업: ${file}`,`Received SAVE backed up to: ${file}`,`受け取ったセーブのバックアップ: ${file}`,`已備份收到的存檔: ${file}`));
  return {kind:'codes',cc,raw:got.bytes,received:got};
}
const q=s=>`'${String(s).replace(/'/g,"'\\''")}'`;
function readRooted(file){
  try{return fs.readFileSync(file);}catch(err){if(err.code!=='EACCES'&&err.code!=='EPERM')throw err;}
  return execFileSync('su',['-c',`cat ${q(file)}`],{maxBuffer:64*1024*1024});
}
function writeRooted(file,bytes){
  try{fs.writeFileSync(file,bytes);return;}catch(err){if(err.code!=='EACCES'&&err.code!=='EPERM')throw err;}
  // Overwrite in place through su so the file keeps the game's owner and permissions.
  const tmp=path.join(HOME,'tmp');fs.mkdirSync(tmp,{recursive:true,mode:0o700});const t=path.join(tmp,'SAVE_DATA');fs.writeFileSync(t,bytes,{mode:0o644});
  try{execFileSync('su',['-c',`cat ${q(t)} > ${q(file)}`]);}finally{fs.rmSync(t,{force:true});}
}
async function fromFile(cc){
  const guess=`/data/data/${PACKAGE[cc]}/files/SAVE_DATA`;
  say(L(`\nSAVE 파일 경로 (Enter = ${guess})`,`\nSAVE file path (Enter = ${guess})`,`\nセーブファイルのパス (Enter = ${guess})`,`\n存檔檔案路徑 (Enter = ${guess})`));
  const file=(await ask('> '))||guess;
  say(L('게임을 완전히 종료한 상태에서 진행하세요.','Close the game completely before continuing.','ゲームを完全に終了してから続けてください。','請先完全關閉遊戲再繼續。'));
  let raw;try{raw=readRooted(file);}catch{throw fail('FILE',L('파일을 읽을 수 없습니다. 경로와 루트 권한(su)을 확인하세요.','Cannot read the file. Check the path and root (su) access.','ファイルを読めません。パスとroot(su)権限を確認してください。','無法讀取檔案。請確認路徑與 root (su) 權限。'));}
  const saved=backup(`${cc}-SAVE_DATA`,raw);
  say(L(`원본 백업: ${saved}`,`Original backed up to: ${saved}`,`元のセーブのバックアップ: ${saved}`,`已備份原始存檔: ${saved}`));
  return {kind:'file',cc,raw,file};
}
// A phone or emulator connected to this computer with adb (root needed to reach the game's files).
const adb=(serial,args,opts={})=>execFileSync('adb',[...(serial?['-s',serial]:[]),...args],{maxBuffer:64*1024*1024,...opts});
function adbRoot(serial,command){
  try{return adb(serial,['exec-out','su','-c',command]);}catch{return adb(serial,['exec-out','sh','-c',command]);}
}
async function fromAdb(cc){
  let devices;try{devices=adb(null,['devices']).toString().split('\n').slice(1).map(l=>l.trim().split(/\s+/)).filter(p=>p[1]==='device').map(p=>p[0]);}
  catch{throw fail('ADB',L('adb를 찾을 수 없습니다. Android platform-tools를 설치하고 PATH에 추가하세요.','adb was not found. Install Android platform-tools and add it to PATH.','adbが見つかりません。Android platform-toolsをインストールしてPATHに追加してください。','找不到 adb。請安裝 Android platform-tools 並加入 PATH。'));}
  if(!devices.length)throw fail('ADB',L('연결된 기기가 없습니다. USB 디버깅(에뮬레이터는 ADB 연결)을 켜세요.','No device is connected. Turn on USB debugging (ADB on emulators).','接続された端末がありません。USBデバッグ(エミュレーターはADB接続)を有効にしてください。','沒有連接的裝置。請開啟 USB 偵錯（模擬器請開啟 ADB 連線）。'));
  const serial=devices.length===1?devices[0]:devices[await choose(L('기기 선택','Choose a device','端末を選択','選擇裝置'),devices)];
  const pkg=PACKAGE[cc],file=`/data/data/${pkg}/files/SAVE_DATA`;
  if(await yes(L('게임을 종료할까요? (권장)','Close the game now? (recommended)','ゲームを終了しますか？(推奨)','要關閉遊戲嗎？（建議）'))){try{adb(serial,['shell','am','force-stop',pkg]);}catch{}}
  let raw;try{raw=adbRoot(serial,`cat ${q(file)}`);}catch{raw=null;}
  if(!raw||raw.length<1000)throw fail('ADB',L('SAVE를 읽을 수 없습니다. 기기의 루트 권한(su)과 게임 설치를 확인하세요.','Cannot read the SAVE. Check root (su) on the device and that the game is installed.','セーブを読めません。端末のroot(su)権限とゲームのインストールを確認してください。','無法讀取存檔。請確認裝置的 root (su) 權限與遊戲是否已安裝。'));
  const saved=backup(`${cc}-adb-SAVE_DATA`,raw);
  say(L(`원본 백업: ${saved}`,`Original backed up to: ${saved}`,`元のセーブのバックアップ: ${saved}`,`已備份原始存檔: ${saved}`));
  return {kind:'adb',cc,raw,serial,file,pkg};
}
function writeAdb(source,bytes){
  const tmp=path.join(HOME,'tmp');fs.mkdirSync(tmp,{recursive:true,mode:0o700});const t=path.join(tmp,'SAVE_DATA');fs.writeFileSync(t,bytes,{mode:0o600});
  const remote='/data/local/tmp/canbot_SAVE_DATA';
  try{adb(source.serial,['push',t,remote],{stdio:'ignore'});adbRoot(source.serial,`cat ${remote} > ${q(source.file)}; rm -f ${remote}`);}finally{fs.rmSync(t,{force:true});}
  return adbRoot(source.serial,`cat ${q(source.file)}`);
}
// A SAVE from ~/.canbot/backups, written back to a file or device, or uploaded for new codes.
async function fromBackup(cc){
  const dir=path.join(HOME,'backups');let files=[];try{files=fs.readdirSync(dir).filter(f=>f.includes(`-${cc}-`)).sort().reverse().slice(0,20);}catch{}
  if(!files.length)throw fail('BACKUP',L('이 지역의 백업이 없습니다.','There are no backups for this region.','この地域のバックアップはありません。','此地區沒有備份。'));
  const name=files[await choose(L('복원할 백업 (최근 20개)','Backup to restore (newest 20)','復元するバックアップ (新しい順20件)','要還原的備份（最新 20 個）'),files)];
  const raw=fs.readFileSync(path.join(dir,name));
  const to=await choose(L('어디로 복원할까요?','Restore to?','どこに復元しますか？','要還原到哪裡？'),[L('PONOS에 올려 새 인계 코드 받기','Upload to PONOS for new transfer codes','PONOSにアップロードして新しい引き継ぎコードを受け取る','上傳到 PONOS 並取得新的引繼碼'),L('SAVE 파일 (루팅 기기)','SAVE file (rooted device)','セーブファイル (root端末)','存檔檔案（已 root 的裝置）'),L('adb로 연결한 기기','Device over adb','adbで接続した端末','透過 adb 連接的裝置')]);
  if(to===0)return {kind:'codes',cc,raw,restored:true};
  if(to===1){const f=await fromFile(cc);return {...f,raw,restored:true};}
  const a=await fromAdb(cc);return {...a,raw,restored:true};
}

// ---------- edits ----------
// The owner's limits on values a person types (the same rules the CanBot service applies). 0 = no limit.
function ownerLimitCheck(limits,edits){
  const over=(name,max)=>fail('OWNER_LIMIT',L(`${name}은(는) 최대 ${max.toLocaleString()}까지 설정할 수 있습니다.`,`${name} can be set up to ${max.toLocaleString()}.`,`${name}は最大${max.toLocaleString()}まで設定できます。`,`${name}最多可設定為 ${max.toLocaleString()}。`));
  for(const e of edits){
    if(e.type==='item'){const max=Number(limits?.items?.[e.item]||0);if(max&&e.value>max)throw over(ITEM_NAMES[e.item][lang==='en'?1:0],max);}
    if(e.type==='cat'&&e.operation==='set_level'){
      const base=Number(limits?.catBase||0),plus=Number(limits?.catPlus||0);
      if(base&&e.base>base)throw over(L('기본 레벨','Base level','基本レベル','基本等級'),base);if(plus&&e.plus>plus)throw over(L('플러스 레벨','Plus level','プラスレベル','加值等級'),plus);
    }
    if(e.type==='cat'&&['upgrade_by','storage_add'].includes(e.operation)){const max=Number(limits?.catUpgradeAmount||100000);if(e.amount>max)throw over(L('개수','Amount','数','數量'),max);}
  }
}
const PENDING_MAX=100;
// Pending edits: add through the menus (each one is tried on a fresh copy of the SAVE right away, so a problem shows
// before saving), remove one, clear, save or quit.
// kept: edits from an earlier pass (backing out of the final "save?" question returns here with them).
async function editMenu(source,save,gd,hello,names=null,kept=[]){
  const menus=createMenus({ui:{say,ask,choose,askNumber,yes,L,lang:()=>lang},save,gd,names,policy:hello.policy||{},access:hello.access||{},limits:hello.limits||{}});
  const edits=[...kept];
  for(;;){
    say('');say(L('— 대기 중인 편집 —','— Pending edits —','— 保留中の編集 —','— 待處理的編輯 —'));say(edits.length?edits.map((e,i)=>`  ${i+1}. ${menus.describe(e)}`).join('\n'):L('  (없음)','  (none)','  (なし)','  （無）'));
    let pick;try{pick=await choose(L('무엇을 할까요?','What next?','次はどうしますか？','接下來要做什麼？'),[L('편집 추가','Add an edit','編集を追加','新增編輯'),L('편집 하나 지우기','Remove one edit','編集をひとつ削除','刪除一項編輯'),L('편집 목록 비우기','Clear all edits','編集をすべて削除','清除所有編輯'),L('저장하기','Save','保存','儲存'),L('저장하지 않고 나가기','Quit without saving','保存せずに終了','不儲存並離開')]);}catch(err){if(isBack(err)){backed();return null;}throw err;}
    try{
      if(pick===0){
        if(edits.length>=PENDING_MAX){say(L(`편집은 한 번에 ${PENDING_MAX}개까지입니다.`,`Up to ${PENDING_MAX} edits at a time.`,`編集は一度に${PENDING_MAX}件までです。`,`一次最多 ${PENDING_MAX} 項編輯。`));continue;}
        const edit=await menus.pick();if(!edit)continue;
        ownerLimitCheck(hello.limits,[edit]);
        const trial=engine.parse(source.raw,source.cc);applyEdits(trial,gd,[...edits,edit],{});
        edits.push(edit);say(L(`추가: ${menus.describe(edit)}`,`Added: ${menus.describe(edit)}`,`追加: ${menus.describe(edit)}`,`已新增: ${menus.describe(edit)}`));
      }
      else if(pick===1){if(!edits.length)continue;const n=await askNumber(L('지울 편집 번호','Edit number to remove','削除する編集の番号','要刪除的編輯編號'),1,edits.length);const [gone]=edits.splice(n-1,1);say(L(`지움: ${menus.describe(gone)}`,`Removed: ${menus.describe(gone)}`,`削除: ${menus.describe(gone)}`,`已刪除: ${menus.describe(gone)}`));}
      else if(pick===2)edits.length=0;
      else if(pick===3){if(!edits.length){say(L('편집이 없습니다.','There are no edits.','編集がありません。','沒有編輯。'));continue;}return {edits,describe:menus.describe};}
      else return null;
    }catch(err){if(isBack(err)){backed();continue;}say(L(`추가하지 않았습니다: ${err.message}`,`Not added: ${err.message}`,`追加できませんでした: ${err.message}`,`未新增: ${err.message}`));}
  }
}

// ---------- save ----------
async function reserve(token,mode,edits,restored){
  const operationId=crypto.randomUUID(),r=await (await api(token,'POST','/api/local/cli/reserve',{operationId,mode:mode==='codes'?'codes':'file',editCount:restored?Math.max(1,edits.length):edits.length})).json();
  if(!r.allowed)throw fail('QUOTA',L('남은 저장 횟수가 없습니다.','You have no SAVEs left.','保存できる回数が残っていません。','已沒有剩餘的儲存次數。'));
  return operationId;
}
async function finish(token,operationId,mode,outcome){
  try{return await (await api(token,'POST','/api/local/cli/finish',{operationId,mode:mode==='codes'?'codes':'file',outcome})).json();}
  catch{say(L('(canbot.dev에 결과를 알리지 못했습니다. 저장 자체에는 영향이 없습니다.)','(Could not report the result to canbot.dev. The SAVE itself is not affected.)','(canbot.devに結果を送れませんでした。セーブ自体には影響ありません。)','（無法將結果回報給 canbot.dev。存檔本身不受影響。）'));return null;}
}
// The PONOS account of a transfer-code SAVE: its credentials are fetched while the member edits (prepare).
function startAccount(source){
  if(source.kind!=='codes')return;
  const base=engine.parse(source.raw,source.cc);if(source.received)ponos.adoptReception(base,source.received);
  const store=accountStore(codeOf(base));
  if(source.received?.password)store.set({...(store.get()||{}),password:source.received.password,token:null,code:codeOf(base)});
  source.account=ponos.account(base,store);source.account.prepare();
}
function fresh(source){const save=engine.parse(source.raw,source.cc);if(source.received)ponos.adoptReception(save,source.received);return save;}
async function saveAndUpload(token,source,edits,gd){
  const save=fresh(source);
  if(edits.length)applyEdits(save,gd,edits,{});
  const out=engine.serialize(save);
  // The written SAVE must read back to the same bytes before it leaves this device.
  if(!engine.serialize(engine.parse(out,source.cc)).equals(out))throw fail('VERIFY',L('편집한 SAVE 확인에 실패했습니다. 저장하지 않았습니다.','The edited SAVE did not verify. Nothing was saved.','編集したセーブの確認に失敗しました。何も保存していません。','編輯後的存檔驗證失敗。未儲存任何內容。'));
  if(source.kind==='file'||source.kind==='adb'){
    const operationId=await reserve(token,source.kind,edits,source.restored);
    let back=null;
    try{if(source.kind==='file'){writeRooted(source.file,out);back=readRooted(source.file);}else back=writeAdb(source,out);}
    catch{await finish(token,operationId,source.kind,'uncertain');throw fail('FILE',L('SAVE를 쓰지 못했습니다. 백업에서 복원할 수 있습니다.','Could not write the SAVE. You can restore it from the backup.','セーブを書き込めませんでした。バックアップから復元できます。','無法寫入存檔。可以從備份還原。'));}
    const ok=Buffer.isBuffer(back)&&back.equals(out);
    await finish(token,operationId,source.kind,ok?'committed':'uncertain');
    say(ok?L('\n저장했습니다. 게임을 실행해 확인하세요.','\nSaved. Start the game to check.','\n保存しました。ゲームを起動して確認してください。','\n已儲存。請啟動遊戲確認。'):L('\nSAVE를 썼지만 다시 읽어 확인하지 못했습니다. 게임에서 확인하세요.','\nThe SAVE was written but could not be read back. Check in the game.','\nセーブを書き込みましたが、読み直して確認できませんでした。ゲームで確認してください。','\n已寫入存檔，但無法重新讀取確認。請在遊戲中確認。'));
    return;
  }
  if(!source.account)startAccount(source);
  say(L('PONOS 서버에 업로드 중...','Uploading to PONOS...','PONOSにアップロード中...','正在上傳到 PONOS...'));
  // Credentials and the save key first (nothing is uploaded yet), then the SAVE is counted and sent.
  try{await source.account.ready();}
  catch(err){source.account=null;throw fail('PONOS_AUTH',L(`PONOS 인증에 실패했습니다 (${err.code||'?'}). 아무것도 업로드하지 않았습니다.`,`PONOS sign-in failed (${err.code||'?'}). Nothing was uploaded.`,`PONOSの認証に失敗しました (${err.code||'?'})。何もアップロードしていません。`,`PONOS 驗證失敗 (${err.code||'?'})。未上傳任何內容。`));}
  const operationId=await reserve(token,'codes',edits,source.restored);
  const started=Date.now();let codes;
  try{codes=await source.account.upload(save,engine.serialize);}
  catch(err){
    backup(`${source.cc}-not-confirmed.sav`,out);
    await finish(token,operationId,'codes','uncertain');
    if(!err.uploadPossible){source.uploading=false;throw fail('PONOS_UPLOAD',L(`업로드하지 못했습니다 (${err.step}: ${err.code}). PONOS에는 아무것도 바뀌지 않았습니다.`,`Upload failed (${err.step}: ${err.code}). Nothing changed at PONOS.`,`アップロードできませんでした (${err.step}: ${err.code})。PONOS側は何も変わっていません。`,`上傳失敗 (${err.step}: ${err.code})。PONOS 端沒有任何變更。`));}
    say(L('\n업로드 결과를 확인할 수 없습니다. 자동으로 다시 시도하지 않습니다.\n편집된 SAVE는 ~/.canbot/backups 에 있습니다. 깡통봇 디스코드에 문의하세요.','\nThe upload result is unknown. It is not retried automatically.\nThe edited SAVE is in ~/.canbot/backups. Ask in the CanBot Discord.','\nアップロードの結果を確認できません。自動で再試行はしません。\n編集したセーブは ~/.canbot/backups にあります。CanBotのDiscordでお問い合わせください。','\n無法確認上傳結果。不會自動重試。\n編輯後的存檔在 ~/.canbot/backups。請到 CanBot 的 Discord 詢問。'));
    return;
  }
  backup(`${source.cc}-uploaded.sav`,codes.bytes);
  await finish(token,operationId,'codes','committed');
  say('');say('========================================');
  say(L(`  인계 코드: ${codes.transferCode}`,`  Transfer code: ${codes.transferCode}`,`  引き継ぎコード: ${codes.transferCode}`,`  引繼碼: ${codes.transferCode}`));
  say(L(`  인증 번호: ${codes.confirmationCode}`,`  Confirmation code: ${codes.confirmationCode}`,`  認証番号: ${codes.confirmationCode}`,`  認證碼: ${codes.confirmationCode}`));
  say('========================================');
  say(L(`게임의 "기종 변경" 화면에서 위 코드를 입력하세요. (업로드 ${((Date.now()-started)/1000).toFixed(1)}초)`,`Enter these codes in the game's data transfer screen. (upload ${((Date.now()-started)/1000).toFixed(1)}s)`,`ゲームの「機種変更」画面で上のコードを入力してください。(アップロード ${((Date.now()-started)/1000).toFixed(1)}秒)`,`請在遊戲的「引繼資料」畫面輸入上方代碼。（上傳 ${((Date.now()-started)/1000).toFixed(1)} 秒）`));
}

// Names in the chosen language: the newest game data of the region that speaks it (Korean -> KR, English -> global,
// Japanese -> JP, Chinese -> TW). Only for showing names; edits always use the SAVE's own region data.
const NAME_REGION={ko:'kr',en:'en',ja:'jp',zh:'tw'};
async function namesFor(token,cc,hello){
  const region=NAME_REGION[lang],version=hello.latest?.[region];
  if(!region||region===cc||!version)return null;
  try{return await gameData(token,region,version,hello);}catch{return null;}
}

// ---------- main ----------
// Start screen: name and version, the license notice the AGPL asks interactive programs to show, and where to go.
const EDITOR_VERSION='0.1.0';
const LINKS={github:'https://github.com/CatPower-max/canbot-save-editor',web:'https://canbot.dev',discord:'https://discord.gg/canbot'};
function banner(){
  const tty=process.stdout.isTTY&&!process.env.NO_COLOR,c=(code,t)=>tty?`\x1b[${code}m${t}\x1b[0m`:t;
  const width=s=>[...s].reduce((n,ch)=>n+(ch.codePointAt(0)>=0x1100?2:1),0);
  const label=(k,v)=>`${c('36',k+' '.repeat(Math.max(1,10-width(k))))}${v}`;
  say('');
  say(c('1;33',L(`깡통봇 로컬 에디터  v${EDITOR_VERSION}`,`CanBot local editor  v${EDITOR_VERSION}`,`CanBot ローカルエディター  v${EDITOR_VERSION}`,`CanBot 本機編輯器  v${EDITOR_VERSION}`)));
  say('Copyright (C) 2026 CanBot');
  say(L('AGPL-3.0-or-later 라이선스이며, 보증 없이 제공됩니다.','Licensed under AGPL-3.0-or-later and provided without any warranty.','AGPL-3.0-or-later ライセンスで、無保証で提供されます。','以 AGPL-3.0-or-later 授權，不提供任何擔保。'));
  say('');
  say(label('GitHub',LINKS.github));
  say(label(L('웹','Web','ウェブ','網站'),LINKS.web));
  say(label('Discord',LINKS.discord));
  say('');
  say(L('어디서든 exit (또는 뒤로) 를 입력하면 아무것도 바꾸지 않고 이전 단계로 돌아갑니다.','Type exit (or back) at any prompt to go back a step without changing anything.','どこでも exit (または 戻る) と入力すると、何も変更せずに前の段階へ戻ります。','在任何輸入處輸入 exit（或 返回）即可不做任何變更回到上一步。'));
  say(c('32',L('무료 프로그램입니다. 돈을 요구받았다면 사기입니다.','This program is free. If someone asked you to pay for it, it is a scam.','このプログラムは無料です。お金を求められたら詐欺です。','本程式免費。若有人向你收費，那是詐騙。')));
  say(c('36','-'.repeat(48)));
}
const LANGS=[['ko','한국어'],['en','English'],['ja','日本語'],['zh','繁體中文']];
async function chooseLanguage(config){const i=await choose('Language / 언어 / 言語 / 語言',LANGS.map(x=>x[1]));config.lang=LANGS[i][0];lang=config.lang;saveConfig(config);}
// Transfer codes stay valid until something is uploaded, so leaving before the upload only needs a word.
function codesStillValid(source){if(source?.kind==='codes'&&source.received&&!source.uploading)say(L('업로드하지 않았으므로 입력한 인계 코드를 게임에서 그대로 다시 쓸 수 있습니다.','Nothing was uploaded, so the transfer codes you entered still work in the game.','アップロードしていないので、入力した引き継ぎコードはゲームでそのまま使えます。','由於沒有上傳，輸入的引繼碼仍可在遊戲中使用。'));}
async function main(){
  rl=readline.createInterface({input:process.stdin,output:process.stdout});
  const config=loadConfig();
  let hello;
  try{
    if(!LANGS.some(x=>x[0]===config.lang))await chooseLanguage(config);
    lang=config.lang;
    banner();
    hello=await login(config);
  }catch(err){if(isBack(err)){rl.close();return;}throw err;}
  const left=hello.allowance?.unlimited?L('무제한','unlimited','無制限','無限制'):String(hello.allowance?.remaining??'?');
  say(L(`${hello.user?.name||''}님, 반갑습니다. 남은 저장: ${left}`,`Hello ${hello.user?.name||''}. SAVEs left: ${left}`,`${hello.user?.name||''}さん、こんにちは。残りの保存回数: ${left}`,`${hello.user?.name||''} 你好。剩餘儲存次數: ${left}`));
  for(;;){
    let how;try{how=await choose(L('SAVE를 어디서 가져올까요?','Where is the SAVE?','セーブをどこから読み込みますか？','要從哪裡讀取存檔？'),[L('인계 코드 (루팅 불필요)','Transfer codes (no root needed)','引き継ぎコード (root不要)','引繼碼（不需要 root）'),L('SAVE 파일 (루팅된 기기·에뮬레이터)','SAVE file (rooted phone or emulator)','セーブファイル (root端末・エミュレーター)','存檔檔案（已 root 的手機或模擬器）'),
      L('PC에 adb로 연결한 기기','Device connected to this PC with adb','このPCにadbで接続した端末','以 adb 連接到這台電腦的裝置'),L('백업에서 복원','Restore a backup','バックアップから復元','從備份還原'),'Language / 언어 / 言語 / 語言',L('토큰 지우기','Forget token','トークンを削除','刪除權杖'),L('종료','Quit','終了','離開')]);}catch(err){if(isBack(err))break;throw err;}
    if(how===6)break;
    if(how===5){config.token='';saveConfig(config);say(L('토큰을 지웠습니다.','Token removed.','トークンを削除しました。','已刪除權杖。'));break;}
    if(how===4){try{await chooseLanguage(config);}catch(err){if(!isBack(err))throw err;}continue;}
    let source=null;
    try{
      const cc=REGIONS[await choose(L('게임 지역','Game region','ゲームの地域','遊戲地區'),[L('한국판','Korean','韓国版','韓國版'),L('글로벌(영어)판','Global (English)','グローバル(英語)版','國際（英文）版'),L('일본판','Japanese','日本版','日本版'),L('대만판','Taiwanese','台湾版','台灣版')])];
      source=how===0?await fromTransferCodes(cc,hello):how===1?await fromFile(cc):how===2?await fromAdb(cc):await fromBackup(cc);
      const save=engine.parse(source.raw,cc),version=engine.versionText(save.gameVersion);
      say(L(`SAVE 버전 ${version} (${save.cc.toUpperCase()})`,`SAVE version ${version} (${save.cc.toUpperCase()})`,`セーブのバージョン ${version} (${save.cc.toUpperCase()})`,`存檔版本 ${version} (${save.cc.toUpperCase()})`));
      if(save.cc!==cc)throw fail('REGION',L('선택한 지역과 SAVE 지역이 다릅니다.','The SAVE is from another region.','選んだ地域とセーブの地域が違います。','所選地區與存檔地區不同。'));
      if(source.restored){
        if(!(await yes(L('이 백업으로 복원할까요? (저장 1회 사용)','Restore this backup? (uses one SAVE)','このバックアップを復元しますか？(保存1回分を使います)','要還原此備份嗎？（會使用一次儲存次數）'))))continue;
        source.uploading=true;await saveAndUpload(config.token,source,[],null);continue;
      }
      startAccount(source);
      const gd=await gameData(config.token,cc,version,hello);
      const names=await namesFor(config.token,cc,hello);
      let chosen=null,kept=[],confirmed=false;
      for(;;){
        chosen=await editMenu(source,save,gd,hello,names,kept);
        if(!chosen)break;
        ownerLimitCheck(hello.limits,chosen.edits);
        say('');chosen.edits.forEach(e=>say(`  - ${chosen.describe(e)}`));
        // Backing out of this question goes back to the pending edits, which are kept.
        try{confirmed=await yes(L('이대로 저장할까요?','Save these changes?','この内容で保存しますか？','要儲存這些變更嗎？'));break;}
        catch(err){if(!isBack(err))throw err;kept=chosen.edits;}
      }
      if(!chosen||!confirmed){codesStillValid(source);continue;}
      source.uploading=true;await saveAndUpload(config.token,source,chosen.edits,gd);
    }catch(err){
      if(isBack(err)){backed();codesStillValid(source);continue;}
      say(L(`\n오류: ${err.message}`,`\nError: ${err.message}`,`\nエラー: ${err.message}`,`\n錯誤: ${err.message}`));
      codesStillValid(source);
    }
  }
  rl.close();
}
if(require.main===module)main().catch(err=>{console.error(L(`오류: ${err.message}`,`Error: ${err.message}`,`エラー: ${err.message}`,`錯誤: ${err.message}`));process.exitCode=1;if(rl)rl.close();});
module.exports={main,ownerLimitCheck,CLIENT};
