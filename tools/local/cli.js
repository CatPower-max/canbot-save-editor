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
const {createMenus,MAX_WORDS}=require('./menus');

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
// Korean, English, Japanese, Traditional Chinese, Spanish, French, German, Italian, Thai (tools/local/i18n.js fills
// the other languages from translations.txt and translations-extra.json). A missing text falls back to English.
const LANG_INDEX={ko:0,en:1,ja:2,zh:3,es:4,fr:5,de:6,it:7,th:8};
const L=(...texts)=>{const i=LANG_INDEX[lang]??1;return i===0?texts[0]:(texts[i]??texts[1]);};
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
const backed=()=>say(L('돌아갑니다. 아무것도 바꾸지 않았습니다.','Back. Nothing was changed.','戻ります。何も変更していません。','返回。沒有做任何變更。','Atrás. No se cambió nada.','Retour. Rien n\'a été modifié.','Zurück. Nichts wurde geändert.','Indietro. Non è cambiato nulla.','ย้อนกลับ ไม่มีอะไรเปลี่ยน'));
// Numbered choices; 0 goes back a step (the same as typing exit).
// backLabel: what 0 says (the first menu: Quit).
async function choose(title,options,backLabel=null){
  say('');say(title);options.forEach((o,i)=>say(`  ${i+1}) ${o}`));say(`  0) ${backLabel||L('← 돌아가기','← Back','← 戻る','← 返回','← Atrás','← Retour','← Zurück','← Indietro','← กลับ')}`);
  for(;;){const a=await ask('> ');if(a==='0')throw fail('BACK','back');const n=Number(a);if(Number.isInteger(n)&&n>=1&&n<=options.length)return n-1;say(L('번호를 입력하세요.','Enter a number.','番号を入力してください。','請輸入編號。','Escribe un número.','Saisis un nombre.','Gib eine Zahl ein.','Inserisci un numero.','ใส่ตัวเลข'));}
}
const fmt=v=>Number(v).toLocaleString('en-US');
// A number in min..max; max (or all, 최대...) gives the highest value. current: shown when known.
async function askNumber(q,min,max,{current}={}){
  const now=Number.isFinite(current)?L(`현재 ${fmt(current)} · `,`now ${fmt(current)} · `,`現在 ${fmt(current)} · `,`目前 ${fmt(current)} · `,`ahora ${fmt(current)} · `,`actuel ${fmt(current)} · `,`jetzt ${fmt(current)} · `,`ora ${fmt(current)} · `,`ตอนนี้ ${fmt(current)} · `):'';
  for(;;){const a=(await ask(`${q} (${now}${fmt(min)}~${fmt(max)}, max): `)).replace(/,/g,'');if(MAX_WORDS.has(a.toLowerCase()))return max;const n=Number(a);if(Number.isSafeInteger(n)&&n>=min&&n<=max)return n;say(L('범위 안의 숫자 또는 max를 입력하세요.','Enter a number in range, or max.','範囲内の数字か max を入力してください。','請輸入範圍內的數字或 max。','Escribe un número dentro del rango, o max.','Saisis un nombre dans la plage, ou max.','Gib eine Zahl im Bereich ein, oder max.','Inserisci un numero nell\'intervallo, oppure max.','ใส่ตัวเลขในช่วง หรือ max'));}
}
async function yes(q){const a=(await ask(`${q} (y/n): `)).toLowerCase();return ['y','yes','ㅛ','예','네','はい','是','好'].includes(a);}
function stamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
// The config file's settings (language, token, presets, backupKeep, extendedLimits), set by main().
let prefs={};
// Backups are named "<time>-<region>-<what>", so names sort oldest first. With a backupKeep setting only the newest
// that many are kept; a "not-confirmed" backup (upload result unknown) is never removed, nor the one just written.
const BACKUP_KEEP=[0,10,30,100];
function pruneBackups(dir,keep,justWritten){
  if(!Number.isSafeInteger(keep)||keep<=0)return 0;
  let files=[];try{files=fs.readdirSync(dir).filter(f=>/^\d{4}-\d\d-\d\dT/.test(f)).sort();}catch{return 0;}
  let removed=0;
  for(const f of files.slice(0,Math.max(0,files.length-keep))){
    if(f.includes('-not-confirmed')||path.join(dir,f)===justWritten)continue;
    try{fs.rmSync(path.join(dir,f),{force:true});removed++;}catch{}
  }
  return removed;
}
function backup(name,bytes){const dir=path.join(HOME,'backups');fs.mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,`${stamp()}-${name}`);fs.writeFileSync(file,bytes,{mode:0o600});pruneBackups(dir,prefs.backupKeep,file);return file;}

// ---------- canbot.dev ----------
async function api(token,method,route,body){
  let res;
  try{res=await fetch(`${SERVER}${route}`,{method,headers:{authorization:`Bearer ${token}`,'x-canbot-lang':lang==='ko'?'ko':'en','content-type':'application/json','user-agent':`canbot-local/${CLIENT}`},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});}
  catch{throw fail('OFFLINE',L('canbot.dev에 연결할 수 없습니다. 인터넷 연결을 확인하세요.','Cannot reach canbot.dev. Check your internet connection.','canbot.devに接続できません。インターネット接続を確認してください。','無法連線到 canbot.dev。請確認網路連線。','No se puede conectar con canbot.dev. Revisa tu conexión a internet.','Impossible de joindre canbot.dev. Vérifie ta connexion internet.','canbot.dev ist nicht erreichbar. Prüfe deine Internetverbindung.','Impossibile raggiungere canbot.dev. Controlla la connessione a internet.','เชื่อมต่อ canbot.dev ไม่ได้ ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต'));}
  if(!res.ok){let j={};try{j=await res.json();}catch{}throw fail(j.code||`HTTP_${res.status}`,j.error||`HTTP ${res.status}`);}
  return res;
}
async function login(config){
  for(;;){
    if(!config.token){
      say(L('\n로컬 에디터 토큰이 필요합니다. canbot.dev/local 에서 디스코드로 로그인해 토큰을 받으세요.','\nA local editor token is needed. Sign in with Discord at canbot.dev/local to get one.','\nローカルエディターのトークンが必要です。canbot.dev/local でDiscordにログインして取得してください。','\n需要本機編輯器的權杖。請到 canbot.dev/local 以 Discord 登入取得。','\nHace falta un token del editor local. Inicia sesión con Discord en canbot.dev/local para obtenerlo.','\nUn jeton de l\'éditeur local est nécessaire. Connecte-toi avec Discord sur canbot.dev/local pour en obtenir un.','\nEin Token für den lokalen Editor wird benötigt. Melde dich auf canbot.dev/local mit Discord an, um eines zu erhalten.','\nServe un token dell\'editor locale. Accedi con Discord su canbot.dev/local per ottenerne uno.','\nต้องใช้โทเค็นของเอดิเตอร์ในเครื่อง เข้าสู่ระบบด้วย Discord ที่ canbot.dev/local เพื่อรับโทเค็น'));
      config.token=await ask(L('토큰 붙여넣기: ','Paste token: ','トークンを貼り付け: ','貼上權杖: ','Pega el token: ','Colle le jeton : ','Token einfügen: ','Incolla il token: ','วางโทเค็น: '));if(!config.token)continue;
    }
    try{const hello=await (await api(config.token,'POST','/api/local/cli/hello',{client:CLIENT})).json();saveConfig(config);return hello;}
    catch(err){
      if(err.code==='LOCAL_TOKEN_INVALID'){say(L('토큰이 올바르지 않거나 회수되었습니다.','This token is not valid or was revoked.','このトークンは無効か、取り消されています。','此權杖無效或已被撤銷。','Este token no es válido o fue revocado.','Ce jeton n\'est pas valide ou a été révoqué.','Dieses Token ist ungültig oder wurde widerrufen.','Questo token non è valido o è stato revocato.','โทเค็นนี้ใช้ไม่ได้หรือถูกยกเลิกแล้ว'));config.token='';saveConfig(config);continue;}
      throw err;
    }
  }
}
// Game data stays one packed file per version (~/.canbot/gamedata/<region>/<version>.cbgd.gz) and is read in memory:
// nothing is unpacked, so the first run does not write ten thousand small files.
async function gameData(token,cc,version,hello){
  const file=path.join(HOME,'gamedata',cc,`${version}.cbgd.gz`),open=buf=>new GameData(path.join(HOME,'gamedata',cc,version),readPack(buf));
  if(fs.existsSync(file)){try{return open(fs.readFileSync(file));}catch{fs.rmSync(file,{force:true});}}
  if(!(hello.versions?.[cc]||[]).includes(version))throw fail('NO_GAME_DATA',L(`${cc.toUpperCase()} ${version} 게임 데이터가 아직 없습니다. 깡통봇에 새 버전이 들어오면 사용할 수 있습니다.`,`There is no game data for ${cc.toUpperCase()} ${version} yet. It becomes available when CanBot adds the version.`,`${cc.toUpperCase()} ${version} のゲームデータはまだありません。CanBotがこのバージョンに対応すると使えるようになります。`,`${cc.toUpperCase()} ${version} 的遊戲資料尚未提供。CanBot 支援此版本後即可使用。`,`Aún no hay datos del juego para ${cc.toUpperCase()} ${version}. Estarán disponibles cuando CanBot añada esa versión.`,`Il n'y a pas encore de données de jeu pour ${cc.toUpperCase()} ${version}. Elles seront disponibles quand CanBot ajoutera cette version.`,`Für ${cc.toUpperCase()} ${version} gibt es noch keine Spieldaten. Sie sind verfügbar, sobald CanBot die Version hinzufügt.`,`Non ci sono ancora dati di gioco per ${cc.toUpperCase()} ${version}. Saranno disponibili quando CanBot aggiungerà la versione.`,`ยังไม่มีข้อมูลเกมของ ${cc.toUpperCase()} ${version} จะใช้ได้เมื่อ CanBot เพิ่มเวอร์ชันนี้`));
  say(L(`게임 데이터 받는 중 (${cc.toUpperCase()} ${version})...`,`Downloading game data (${cc.toUpperCase()} ${version})...`,`ゲームデータをダウンロード中 (${cc.toUpperCase()} ${version})...`,`正在下載遊戲資料 (${cc.toUpperCase()} ${version})...`,`Descargando datos del juego (${cc.toUpperCase()} ${version})...`,`Téléchargement des données de jeu (${cc.toUpperCase()} ${version})...`,`Spieldaten werden heruntergeladen (${cc.toUpperCase()} ${version})...`,`Download dei dati di gioco (${cc.toUpperCase()} ${version})...`,`กำลังดาวน์โหลดข้อมูลเกม (${cc.toUpperCase()} ${version})...`));
  const res=await api(token,'GET',`/api/local/cli/gamedata?cc=${cc}&v=${encodeURIComponent(version)}`);
  const buf=Buffer.from(await res.arrayBuffer());
  let gd;try{gd=open(buf);}catch{throw fail('GAME_DATA',L('게임 데이터가 손상되었습니다. 다시 실행해 주세요.','The game data download was damaged. Run again.','ゲームデータが破損しています。もう一度実行してください。','遊戲資料已損毀。請重新執行。','La descarga de datos del juego llegó dañada. Vuelve a ejecutarlo.','Le téléchargement des données de jeu est corrompu. Relance.','Der Download der Spieldaten ist beschädigt. Starte erneut.','Il download dei dati di gioco è danneggiato. Riprova.','ข้อมูลเกมที่ดาวน์โหลดเสียหาย ลองใหม่อีกครั้ง'));}
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(`${file}.tmp`,buf);fs.renameSync(`${file}.tmp`,file);
  return gd;
}

// ---------- SAVE sources ----------
// Each PONOS request is printed with its time while the person waits for one (receiving or uploading a SAVE); the
// credentials fetched in the background while they edit stay quiet.
const steps={on:false};
const STEP_NAMES={RECEIVE:['SAVE 받기','Receive the SAVE','セーブの受け取り','接收存檔'],TOKEN:['인증','Sign-in','認証','驗證'],PASSWORD:['계정 확인','Account check','アカウント確認','帳號確認'],
  SAVE_KEY:['저장 키','Save key','保存キー','儲存金鑰'],UPLOAD:['SAVE 전송','Send the SAVE','セーブの送信','傳送存檔'],MANAGED_ITEMS:['아이템 변경 신고','Report item changes','アイテム変更の報告','回報道具變更'],TRANSFER:['인계 코드 발급','Issue transfer codes','引き継ぎコードの発行','發行引繼碼']};
function showStep({step,ms,status}){
  if(!steps.on)return;const n=STEP_NAMES[step]||[step,step,step,step];
  say(`  - ${L(...n)} ${(ms/1000).toFixed(1)}${L('초','s','秒','秒','s','s','s','s','s')}${status&&status<400?'':` (${status||L('응답 없음','no answer','応答なし','無回應','sin respuesta','pas de réponse','keine Antwort','nessuna risposta','ไม่มีการตอบกลับ')})`}`);
}
const ponos=createPonos({timeoutMs:60000,onStep:showStep});
// PONOS credentials of one account, kept on this device only (~/.canbot/accounts, 0600) and reused while valid.
function accountStore(code){
  const dir=path.join(HOME,'accounts'),file=path.join(dir,`${crypto.createHash('sha256').update(String(code)).digest('hex').slice(0,24)}.json`);
  return {get(){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}},
    set(v){fs.mkdirSync(dir,{recursive:true,mode:0o700});const tmp=`${file}.tmp`;fs.writeFileSync(tmp,JSON.stringify(v),{mode:0o600});fs.renameSync(tmp,file);}};
}
const codeOf=save=>String(save.data.inquiryCode);
async function fromTransferCodes(cc,hello){
  say(L('\n인계 코드는 업로드할 때 새 코드로 바뀝니다. 업로드하기 전에 나가면 같은 코드를 게임에서 그대로 쓸 수 있습니다.','\nThe transfer codes change only when you upload. If you leave before uploading, the same codes still work in the game.','\n引き継ぎコードはアップロードしたときだけ新しくなります。アップロード前に終了すれば、同じコードをゲームでそのまま使えます。','\n引繼碼只會在上傳時更換。在上傳前離開的話，同一組代碼仍可在遊戲中使用。','\nLos códigos de transferencia solo cambian al subir. Si sales antes de subir, los mismos códigos siguen funcionando en el juego.','\nLes codes de transfert ne changent qu\'au moment de l\'envoi. Si tu quittes avant l\'envoi, les mêmes codes fonctionnent toujours dans le jeu.','\nDie Übertragungscodes ändern sich erst beim Hochladen. Wenn du vorher aufhörst, funktionieren dieselben Codes weiter im Spiel.','\nI codici di trasferimento cambiano solo al caricamento. Se esci prima di caricare, gli stessi codici funzionano ancora nel gioco.','\nรหัสโอนข้อมูลจะเปลี่ยนเมื่ออัปโหลดเท่านั้น ถ้าออกก่อนอัปโหลด รหัสเดิมยังใช้ในเกมได้'));
  const code=(await ask(L('인계 코드: ','Transfer code: ','引き継ぎコード: ','引繼碼: ','Código de transferencia: ','Code de transfert : ','Übertragungscode: ','Codice di trasferimento: ','รหัสโอนข้อมูล: '))).replace(/\s+/g,'').toLowerCase();
  const pin=(await ask(L('인증 번호: ','Confirmation code: ','認証番号: ','認證碼: ','Código de confirmación: ','Code de confirmation : ','Bestätigungscode: ','Codice di conferma: ','รหัสยืนยัน: '))).replace(/\s+/g,'');
  if(!/^[0-9a-z]{9}$/.test(code)||!/^\d{4}$/.test(pin))throw fail('CODES',L('인계 코드는 9자리, 인증 번호는 4자리 숫자입니다.','The transfer code has 9 characters and the confirmation code 4 digits.','引き継ぎコードは9文字、認証番号は4桁の数字です。','引繼碼為 9 個字元，認證碼為 4 位數字。','El código de transferencia tiene 9 caracteres y el de confirmación 4 dígitos.','Le code de transfert a 9 caractères et le code de confirmation 4 chiffres.','Der Übertragungscode hat 9 Zeichen, der Bestätigungscode 4 Ziffern.','Il codice di trasferimento ha 9 caratteri e quello di conferma 4 cifre.','รหัสโอนข้อมูลมี 9 ตัว และรหัสยืนยันมี 4 หลัก'));
  const version=hello.latest?.[cc];if(!version)throw fail('NO_GAME_DATA',L('이 지역은 아직 지원하지 않습니다.','This region is not supported yet.','この地域にはまだ対応していません。','尚未支援此地區。','Esta región aún no es compatible.','Cette région n\'est pas encore prise en charge.','Diese Region wird noch nicht unterstützt.','Questa regione non è ancora supportata.','ยังไม่รองรับภูมิภาคนี้'));
  say(L('PONOS 서버에서 SAVE 받는 중...','Downloading the SAVE from PONOS...','PONOSサーバーからセーブを取得中...','正在從 PONOS 伺服器取得存檔...','Descargando la partida desde PONOS...','Téléchargement de la sauvegarde depuis PONOS...','Spielstand wird von PONOS heruntergeladen...','Download del salvataggio da PONOS...','กำลังดาวน์โหลดเซฟจาก PONOS...'));
  // PONOS takes the numeric game version ("15.7.0" -> 150700).
  const [a,b,c]=version.split('.').map(Number);
  let got;steps.on=true;try{got=await ponos.receive(code,pin,cc,a*10000+b*100+c);steps.on=false;}
  catch(err){steps.on=false;if(err.code==='NO_CONNECTION')throw fail('PONOS_OFFLINE',L('PONOS 서버에 연결할 수 없습니다.','Cannot reach the PONOS server.','PONOSサーバーに接続できません。','無法連線到 PONOS 伺服器。','No se puede conectar con el servidor de PONOS.','Impossible de joindre le serveur PONOS.','Der PONOS-Server ist nicht erreichbar.','Impossibile raggiungere il server PONOS.','เชื่อมต่อเซิร์ฟเวอร์ PONOS ไม่ได้'));throw fail('CODES',L('코드가 맞지 않거나 이미 사용된 코드입니다. 게임에서 새 코드를 발급받으세요.','The codes are wrong or already used. Issue new codes in the game.','コードが違うか、すでに使われています。ゲームで新しいコードを発行してください。','代碼錯誤或已被使用。請在遊戲中重新發行代碼。','Los códigos son incorrectos o ya se usaron. Genera códigos nuevos en el juego.','Les codes sont faux ou déjà utilisés. Crée de nouveaux codes dans le jeu.','Die Codes sind falsch oder schon benutzt. Erstelle im Spiel neue Codes.','I codici sono errati o già usati. Generane di nuovi nel gioco.','รหัสไม่ถูกต้องหรือใช้ไปแล้ว ออกรหัสใหม่ในเกม'));}
  const file=backup(`${cc}-received.sav`,got.bytes);
  say(L(`받은 SAVE 백업: ${file}`,`Received SAVE backed up to: ${file}`,`受け取ったセーブのバックアップ: ${file}`,`已備份收到的存檔: ${file}`,`Partida recibida guardada como copia en: ${file}`,`Sauvegarde reçue copiée dans : ${file}`,`Empfangener Spielstand gesichert in: ${file}`,`Salvataggio ricevuto copiato in: ${file}`,`สำรองเซฟที่ได้รับไว้ที่: ${file}`));
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
  say(L(`\nSAVE 파일 경로 (Enter = ${guess})`,`\nSAVE file path (Enter = ${guess})`,`\nセーブファイルのパス (Enter = ${guess})`,`\n存檔檔案路徑 (Enter = ${guess})`,`\nRuta del archivo de partida (Enter = ${guess})`,`\nChemin du fichier de sauvegarde (Entrée = ${guess})`,`\nPfad der Spielstanddatei (Enter = ${guess})`,`\nPercorso del file di salvataggio (Invio = ${guess})`,`\nพาธไฟล์เซฟ (Enter = ${guess})`));
  const file=(await ask('> '))||guess;
  say(L('게임을 완전히 종료한 상태에서 진행하세요.','Close the game completely before continuing.','ゲームを完全に終了してから続けてください。','請先完全關閉遊戲再繼續。','Cierra el juego por completo antes de continuar.','Ferme complètement le jeu avant de continuer.','Beende das Spiel vollständig, bevor du fortfährst.','Chiudi completamente il gioco prima di continuare.','ปิดเกมให้สนิทก่อนทำต่อ'));
  let raw;try{raw=readRooted(file);}catch{throw fail('FILE',L('파일을 읽을 수 없습니다. 경로와 루트 권한(su)을 확인하세요.','Cannot read the file. Check the path and root (su) access.','ファイルを読めません。パスとroot(su)権限を確認してください。','無法讀取檔案。請確認路徑與 root (su) 權限。','No se puede leer el archivo. Revisa la ruta y el acceso root (su).','Impossible de lire le fichier. Vérifie le chemin et l\'accès root (su).','Die Datei kann nicht gelesen werden. Prüfe den Pfad und den Root-Zugriff (su).','Impossibile leggere il file. Controlla il percorso e l\'accesso root (su).','อ่านไฟล์ไม่ได้ ตรวจสอบพาธและสิทธิ์ root (su)'));}
  const saved=backup(`${cc}-SAVE_DATA`,raw);
  say(L(`원본 백업: ${saved}`,`Original backed up to: ${saved}`,`元のセーブのバックアップ: ${saved}`,`已備份原始存檔: ${saved}`,`Original guardado como copia en: ${saved}`,`Original copié dans : ${saved}`,`Original gesichert in: ${saved}`,`Originale copiato in: ${saved}`,`สำรองไฟล์ต้นฉบับไว้ที่: ${saved}`));
  return {kind:'file',cc,raw,file};
}
// A phone or emulator connected to this computer with adb (root needed to reach the game's files).
const adb=(serial,args,opts={})=>execFileSync('adb',[...(serial?['-s',serial]:[]),...args],{maxBuffer:64*1024*1024,...opts});
function adbRoot(serial,command){
  try{return adb(serial,['exec-out','su','-c',command]);}catch{return adb(serial,['exec-out','sh','-c',command]);}
}
async function fromAdb(cc){
  let devices;try{devices=adb(null,['devices']).toString().split('\n').slice(1).map(l=>l.trim().split(/\s+/)).filter(p=>p[1]==='device').map(p=>p[0]);}
  catch{throw fail('ADB',L('adb를 찾을 수 없습니다. Android platform-tools를 설치하고 PATH에 추가하세요.','adb was not found. Install Android platform-tools and add it to PATH.','adbが見つかりません。Android platform-toolsをインストールしてPATHに追加してください。','找不到 adb。請安裝 Android platform-tools 並加入 PATH。','No se encontró adb. Instala Android platform-tools y añádelo al PATH.','adb est introuvable. Installe Android platform-tools et ajoute-le au PATH.','adb wurde nicht gefunden. Installiere die Android platform-tools und füge sie zum PATH hinzu.','adb non trovato. Installa Android platform-tools e aggiungilo al PATH.','ไม่พบ adb ติดตั้ง Android platform-tools แล้วเพิ่มลงใน PATH'));}
  if(!devices.length)throw fail('ADB',L('연결된 기기가 없습니다. USB 디버깅(에뮬레이터는 ADB 연결)을 켜세요.','No device is connected. Turn on USB debugging (ADB on emulators).','接続された端末がありません。USBデバッグ(エミュレーターはADB接続)を有効にしてください。','沒有連接的裝置。請開啟 USB 偵錯（模擬器請開啟 ADB 連線）。','No hay ningún dispositivo conectado. Activa la depuración USB (ADB en emuladores).','Aucun appareil connecté. Active le débogage USB (ADB sur les émulateurs).','Kein Gerät verbunden. Schalte USB-Debugging ein (ADB bei Emulatoren).','Nessun dispositivo collegato. Attiva il debug USB (ADB negli emulatori).','ไม่มีอุปกรณ์ที่เชื่อมต่อ เปิด USB debugging (ADB สำหรับอีมูเลเตอร์)'));
  const serial=devices.length===1?devices[0]:devices[await choose(L('기기 선택','Choose a device','端末を選択','選擇裝置','Elige un dispositivo','Choisis un appareil','Gerät wählen','Scegli un dispositivo','เลือกอุปกรณ์'),devices)];
  const pkg=PACKAGE[cc],file=`/data/data/${pkg}/files/SAVE_DATA`;
  if(await yes(L('게임을 종료할까요? (권장)','Close the game now? (recommended)','ゲームを終了しますか？(推奨)','要關閉遊戲嗎？（建議）','¿Cerrar el juego ahora? (recomendado)','Fermer le jeu maintenant ? (recommandé)','Spiel jetzt beenden? (empfohlen)','Chiudere il gioco ora? (consigliato)','ปิดเกมตอนนี้เลยไหม (แนะนำ)'))){try{adb(serial,['shell','am','force-stop',pkg]);}catch{}}
  let raw;try{raw=adbRoot(serial,`cat ${q(file)}`);}catch{raw=null;}
  if(!raw||raw.length<1000)throw fail('ADB',L('SAVE를 읽을 수 없습니다. 기기의 루트 권한(su)과 게임 설치를 확인하세요.','Cannot read the SAVE. Check root (su) on the device and that the game is installed.','セーブを読めません。端末のroot(su)権限とゲームのインストールを確認してください。','無法讀取存檔。請確認裝置的 root (su) 權限與遊戲是否已安裝。','No se puede leer la partida. Revisa el root (su) del dispositivo y que el juego esté instalado.','Impossible de lire la sauvegarde. Vérifie le root (su) de l\'appareil et que le jeu est installé.','Der Spielstand kann nicht gelesen werden. Prüfe Root (su) auf dem Gerät und ob das Spiel installiert ist.','Impossibile leggere il salvataggio. Controlla il root (su) del dispositivo e che il gioco sia installato.','อ่านเซฟไม่ได้ ตรวจสอบ root (su) บนอุปกรณ์และว่าติดตั้งเกมไว้แล้ว'));
  const saved=backup(`${cc}-adb-SAVE_DATA`,raw);
  say(L(`원본 백업: ${saved}`,`Original backed up to: ${saved}`,`元のセーブのバックアップ: ${saved}`,`已備份原始存檔: ${saved}`,`Original guardado como copia en: ${saved}`,`Original copié dans : ${saved}`,`Original gesichert in: ${saved}`,`Originale copiato in: ${saved}`,`สำรองไฟล์ต้นฉบับไว้ที่: ${saved}`));
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
  if(!files.length)throw fail('BACKUP',L('이 지역의 백업이 없습니다.','There are no backups for this region.','この地域のバックアップはありません。','此地區沒有備份。','No hay copias de seguridad para esta región.','Il n\'y a aucune sauvegarde de secours pour cette région.','Für diese Region gibt es keine Sicherungen.','Non ci sono backup per questa regione.','ไม่มีไฟล์สำรองของภูมิภาคนี้'));
  const name=files[await choose(L('복원할 백업 (최근 20개)','Backup to restore (newest 20)','復元するバックアップ (新しい順20件)','要還原的備份（最新 20 個）','Copia a restaurar (las 20 más recientes)','Sauvegarde à restaurer (20 plus récentes)','Wiederherzustellende Sicherung (die 20 neuesten)','Backup da ripristinare (i 20 più recenti)','ไฟล์สำรองที่จะกู้คืน (ใหม่สุด 20 ไฟล์)'),files)];
  const raw=fs.readFileSync(path.join(dir,name));
  const to=await choose(L('어디로 복원할까요?','Restore to?','どこに復元しますか？','要還原到哪裡？','¿Restaurar en?','Restaurer vers ?','Wiederherstellen nach?','Ripristinare dove?','กู้คืนไปที่ไหน'),[L('PONOS에 올려 새 인계 코드 받기','Upload to PONOS for new transfer codes','PONOSにアップロードして新しい引き継ぎコードを受け取る','上傳到 PONOS 並取得新的引繼碼','Subir a PONOS para obtener códigos nuevos','Envoyer à PONOS pour de nouveaux codes de transfert','Zu PONOS hochladen für neue Übertragungscodes','Caricare su PONOS per nuovi codici di trasferimento','อัปโหลดไปที่ PONOS เพื่อรับรหัสโอนข้อมูลใหม่'),L('SAVE 파일 (루팅 기기)','SAVE file (rooted device)','セーブファイル (root端末)','存檔檔案（已 root 的裝置）','Archivo de partida (dispositivo con root)','Fichier de sauvegarde (appareil rooté)','Spielstanddatei (gerootetes Gerät)','File di salvataggio (dispositivo con root)','ไฟล์เซฟ (อุปกรณ์ที่ root แล้ว)'),L('adb로 연결한 기기','Device over adb','adbで接続した端末','透過 adb 連接的裝置','Dispositivo por adb','Appareil via adb','Gerät über adb','Dispositivo tramite adb','อุปกรณ์ผ่าน adb')]);
  if(to===0)return {kind:'codes',cc,raw,restored:true};
  if(to===1){const f=await fromFile(cc);return {...f,raw,restored:true};}
  const a=await fromAdb(cc);return {...a,raw,restored:true};
}

// ---------- edits ----------
// The owner's limits on values a person types (the same rules the CanBot service applies). 0 = no limit.
function ownerLimitCheck(limits,edits){
  const over=(name,max)=>fail('OWNER_LIMIT',L(`${name}은(는) 최대 ${max.toLocaleString()}까지 설정할 수 있습니다.`,`${name} can be set up to ${max.toLocaleString()}.`,`${name}は最大${max.toLocaleString()}まで設定できます。`,`${name}最多可設定為 ${max.toLocaleString()}。`,`${name} se puede poner hasta ${max.toLocaleString()}.`,`${name} peut aller jusqu'à ${max.toLocaleString()}.`,`${name} kann bis ${max.toLocaleString()} gesetzt werden.`,`${name} può arrivare fino a ${max.toLocaleString()}.`,`${name} ตั้งได้สูงสุด ${max.toLocaleString()}`));
  for(const e of edits){
    if(e.type==='item'){const max=Number(limits?.items?.[e.item]||0);if(max&&e.value>max)throw over(ITEM_NAMES[e.item][lang==='ko'?0:1],max);}
    if(e.type==='cat'&&e.operation==='set_level'){
      const base=Number(limits?.catBase||0),plus=Number(limits?.catPlus||0);
      if(base&&e.base>base)throw over(L('기본 레벨','Base level','基本レベル','基本等級','Nivel base','Niveau de base','Grundstufe','Livello base','เลเวลพื้นฐาน'),base);if(plus&&e.plus>plus)throw over(L('플러스 레벨','Plus level','プラスレベル','加值等級','Nivel plus','Niveau plus','Plus-Stufe','Livello plus','เลเวลพลัส'),plus);
    }
    if(e.type==='cat'&&['upgrade_by','storage_add'].includes(e.operation)){const max=Number(limits?.catUpgradeAmount||100000);if(e.amount>max)throw over(L('개수','Amount','数','數量','Cantidad','Quantité','Menge','Quantità','จำนวน'),max);}
  }
}
const PENDING_MAX=100;
// Pending edits: add through the menus (each one is tried on a fresh copy of the SAVE right away, so a problem shows
// before saving), remove one, clear, save or quit.
// kept: edits from an earlier pass (backing out of the final "save?" question returns here with them).
// Extended limits (item and clear-count limits become the field's range) need both the member's role (the server says
// so in hello.access) and the member's own setting. The owner's caps (hello.limits) apply either way.
const extendedOn=hello=>prefs.extendedLimits===true&&hello?.access?.canUseExtendedLimits===true;
const editSettings=extended=>extended?{disable_item_maxes:true}:{};
// Presets: named lists of edits kept in the config file and added to the pending edits in one step. Each edit of a
// preset goes through the same checks as one picked from the menus (feature switches, owner caps, a trial on the SAVE).
const PRESET_MAX=20,PRESET_NAME_MAX=30;
const presets=()=>Array.isArray(prefs.presets)?prefs.presets.filter(p=>p&&typeof p.name==='string'&&Array.isArray(p.edits)):[];
function savePresets(list,config){config.presets=list.slice(0,PRESET_MAX);saveConfig(config);}
// Item names typed directly at the pending edits prompt ("통조림 45000", "xp max", "레어 299 플티 max"), besides the
// menu labels in the chosen language. Spaces, case, "_" and "-" do not matter.
const ITEM_ALIASES={catfood:['통조림','캔','고양이캔','cf','food','catfood','ネコカン','猫缶','貓罐頭'],xp:['xp','exp','경험치','가마토토xp'],
  normal_tickets:['냥코티켓','일반티켓','노멀티켓','nt','normal','normaltickets','cattickets','ネコチケット','貓咪券'],rare_tickets:['레어티켓','레어','rt','rare','raretickets','レアチケット','稀有券'],
  platinum_tickets:['플래티넘티켓','플티','pt','platinum','platinumtickets','プラチナチケット','白金券'],legend_tickets:['레전드티켓','레전드','lt','legend','legendtickets','レジェンドチケット','傳說券'],
  platinum_shards:['플래티넘조각','플조','조각','shards','platinumshards','プラチナのかけら','白金碎片'],np:['np'],leadership:['리더십','ld','leadership','リーダーシップ','統率力']};
const MAX_ALL_WORDS=new Set(['maxall','전부최대','모두최대','すべて最大','全部最大']);
const normName=s=>String(s).toLowerCase().replace(/[\s_\-·]/g,'');
// null: not a direct command. {error}: a direct command with a problem. {edits}: item edits.
function parseDirect(text,rows,label){
  const t=String(text).trim();if(!t)return null;
  if(MAX_ALL_WORDS.has(normName(t)))return {edits:[{type:'max_all'}]};
  const byName=new Map();for(const r of rows)for(const a of [...(ITEM_ALIASES[r.name]||[]),r.name,label(r.name)])byName.set(normName(a),r);
  const re=/([^\d\s,][^\d]*?)\s*(max|all|최대|전부|最大|全部|すべて|\d[\d,]*)(?=\s|$)/gi,found=[];let m;
  while((m=re.exec(t)))found.push(m);
  if(!found.length||t.replace(re,'').trim())return null;
  const edits=[];
  for(const [,name,raw] of found){
    const r=byName.get(normName(name));if(!r)return {error:L(`"${name.trim()}"은(는) 아이템 이름이 아닙니다.`,`"${name.trim()}" is not an item name.`,`「${name.trim()}」はアイテム名ではありません。`,`「${name.trim()}」不是道具名稱。`,`"${name.trim()}" no es un nombre de objeto.`,`"${name.trim()}" n'est pas un nom d'objet.`,`"${name.trim()}" ist kein Gegenstandsname.`,`"${name.trim()}" non è il nome di un oggetto.`,`"${name.trim()}" ไม่ใช่ชื่อไอเทม`)};
    const v=MAX_WORDS.has(raw.toLowerCase())?r.max:Number(raw.replace(/,/g,''));
    if(!Number.isSafeInteger(v)||v<0||v>r.max)return {error:L(`${label(r.name)}은(는) 0~${fmt(r.max)}까지입니다.`,`${label(r.name)} goes from 0 to ${fmt(r.max)}.`,`${label(r.name)}は0~${fmt(r.max)}までです。`,`${label(r.name)} 的範圍是 0~${fmt(r.max)}。`,`${label(r.name)} va de 0 a ${fmt(r.max)}.`,`${label(r.name)} va de 0 à ${fmt(r.max)}.`,`${label(r.name)} geht von 0 bis ${fmt(r.max)}.`,`${label(r.name)} va da 0 a ${fmt(r.max)}.`,`${label(r.name)} ตั้งได้ตั้งแต่ 0 ถึง ${fmt(r.max)}`)};
    edits.push({type:'item',item:r.name,value:v});
  }
  return {edits};
}
// Engine error codes in the chosen language; anything else keeps its own message.
function explain(err){
  const range=/between (\d+) and (\d+)/.exec(String(err?.message||''));
  const code=String(err?.code||'');
  if(range&&['ITEM_VALUE_OUT_OF_RANGE','INVALID_INPUT'].includes(code))return L(`값은 ${fmt(range[1])}~${fmt(range[2])} 사이여야 합니다.`,`The value must be from ${fmt(range[1])} to ${fmt(range[2])}.`,`値は${fmt(range[1])}~${fmt(range[2])}の範囲で入力してください。`,`數值必須介於 ${fmt(range[1])}~${fmt(range[2])}。`,`El valor debe estar entre ${fmt(range[1])} y ${fmt(range[2])}.`,`La valeur doit aller de ${fmt(range[1])} à ${fmt(range[2])}.`,`Der Wert muss zwischen ${fmt(range[1])} und ${fmt(range[2])} liegen.`,`Il valore deve essere tra ${fmt(range[1])} e ${fmt(range[2])}.`,`ค่าต้องอยู่ระหว่าง ${fmt(range[1])} ถึง ${fmt(range[2])}`);
  const levels=L('그 레벨까지 올릴 수 없는 고양이가 있습니다.','Some cats cannot reach that level.','そのレベルまで上げられないキャラがいます。','有角色無法提升到該等級。','Algunos gatos no pueden llegar a ese nivel.','Certains chats ne peuvent pas atteindre ce niveau.','Manche Katzen können diese Stufe nicht erreichen.','Alcuni gatti non possono raggiungere quel livello.','แมวบางตัวไปถึงเลเวลนั้นไม่ได้');
  const known={
    ITEM_UNSUPPORTED_VERSION:L('이 게임 버전에는 없는 항목입니다.','This game version does not have this item.','このゲームバージョンにはない項目です。','此遊戲版本沒有這個項目。','Esta versión del juego no tiene este objeto.','Cette version du jeu n\'a pas cet objet.','Diese Spielversion hat diesen Gegenstand nicht.','Questa versione del gioco non ha questo oggetto.','เกมเวอร์ชันนี้ไม่มีไอเทมนี้'),
    STORAGE_CAPACITY:L('보관함 칸이 부족합니다.','There is not enough storage space.','ネコ部屋(保管庫)の空きが足りません。','保管庫空間不足。','No hay suficiente espacio en el almacén.','Il n\'y a pas assez de place dans le stockage.','Im Lager ist nicht genug Platz.','Non c\'è abbastanza spazio nel deposito.','พื้นที่คลังไม่พอ'),
    CAT_LEVEL_LIMIT:levels,CAT_LEVEL_UNREACHABLE:levels,
    CAT_FORM_UNSUPPORTED:L('그 형태가 없는 고양이가 있습니다.','Some cats do not have that form.','その形態がないキャラがいます。','有角色沒有該型態。','Algunos gatos no tienen esa forma.','Certains chats n\'ont pas cette forme.','Manche Katzen haben diese Form nicht.','Alcuni gatti non hanno quella forma.','แมวบางตัวไม่มีร่างนั้น'),
    ACCOUNT_REGION_MISMATCH:L('SAVE 지역이 맞지 않습니다.','The SAVE is from another region.','セーブの地域が合いません。','存檔地區不符。','La partida es de otra región.','La sauvegarde vient d\'une autre région.','Der Spielstand stammt aus einer anderen Region.','Il salvataggio è di un\'altra regione.','เซฟนี้มาจากภูมิภาคอื่น'),
  };
  if(/^CAT_TALENT_/.test(code)||/^CAT_TALENT_/.test(String(err?.message||'')))return L('본능이 없거나 이 게임 버전에서 본능을 바꿀 수 없는 고양이가 있습니다.','Some cats have no talents, or their talents cannot be changed in this game version.','本能がない、またはこのゲームバージョンでは本能を変更できないキャラがいます。','有角色沒有本能，或在此遊戲版本中無法變更本能。','Algunos gatos no tienen talentos, o no se pueden cambiar en esta versión del juego.','Certains chats n\'ont pas de talents, ou ils ne peuvent pas être modifiés dans cette version du jeu.','Manche Katzen haben keine Talente, oder sie lassen sich in dieser Spielversion nicht ändern.','Alcuni gatti non hanno talenti, oppure non si possono cambiare in questa versione del gioco.','แมวบางตัวไม่มีทาเลนต์ หรือเปลี่ยนทาเลนต์ในเกมเวอร์ชันนี้ไม่ได้');
  if(known[code])return known[code];
  if(/^STORY_/.test(code))return L('이 SAVE의 스토리 구조에서는 쓸 수 없습니다.','This does not fit the story data of this SAVE.','このセーブのストーリーデータでは使えません。','此存檔的故事資料無法使用。','Esto no encaja con los datos de historia de esta partida.','Cela ne correspond pas aux données d\'histoire de cette sauvegarde.','Das passt nicht zu den Story-Daten dieses Spielstands.','Questo non corrisponde ai dati della storia di questo salvataggio.','ไม่ตรงกับข้อมูลเนื้อเรื่องของเซฟนี้');
  // A bare engine code: say that this SAVE cannot take the edit, with the code for support.
  const raw=String(err?.message||err||'');
  if(/^[A-Z][A-Z0-9_]{2,63}$/.test(raw))return L(`이 SAVE에서는 할 수 없는 편집입니다 (${raw}).`,`This SAVE cannot take this edit (${raw}).`,`このセーブではできない編集です (${raw})。`,`此存檔無法進行這項編輯 (${raw})。`,`Esta partida no admite esta edición (${raw}).`,`Cette sauvegarde n'accepte pas cette modification (${raw}).`,`Dieser Spielstand verträgt diese Änderung nicht (${raw}).`,`Questo salvataggio non accetta questa modifica (${raw}).`,`เซฟนี้ใช้การแก้ไขนี้ไม่ได้ (${raw})`);
  return raw;
}
const HELP_KO=[
  '명령',
  '  Enter          편집 추가 (메뉴에서 고르기, 다 고르면 0)',
  '  통조림 45000    바로 입력. 여러 개도 됨: 레어 299 플티 max',
  '  /본능          기능 찾기 (어느 언어로 써도 됨. / 없이 써도 찾아봄)',
  '  maxall         전부 최대',
  '  s              저장하기',
  '  p / p+         프리셋 불러오기 / 지금 편집을 프리셋으로 저장',
  '  d 2            2번 편집 지우기 (d만 쓰면 번호를 물어봄)',
  '  c              편집 목록 비우기',
  '  0 또는 q       저장하지 않고 나가기',
  '  숫자를 묻는 곳에서는 max 를 쓰면 최대값이 들어갑니다.'].join('\n');
const HELP_EN=[
  'Commands',
  '  Enter            add an edit (pick from the menus; 0 when done)',
  '  catfood 45000    type it directly; several work too: rare 299 platinum max',
  '  /talent          find a feature (any language; works without / too)',
  '  maxall           Max All',
  '  s                save',
  '  p / p+           load a preset / save these edits as a preset',
  '  d 2              remove edit 2 (d alone asks which)',
  '  c                clear all edits',
  '  0 or q           quit without saving',
  '  At any number prompt, max enters the highest value.'].join('\n');
const HELP_JA=[
  'コマンド',
  '  Enter            編集を追加 (メニューから選ぶ。終わったら 0)',
  '  ネコカン 45000    直接入力。複数も可: レア 299 プラチナ max',
  '  /本能            機能を探す (どの言語でも可。/ なしでも検索します)',
  '  maxall           すべて最大',
  '  s                保存',
  '  p / p+           プリセットを読み込む / この編集をプリセットとして保存',
  '  d 2              2番の編集を削除 (d だけなら番号を聞きます)',
  '  c                編集をすべて削除',
  '  0 または q       保存せずに終了',
  '  数字を聞かれたところで max と入力すると最大値になります。'].join('\n');
const HELP_ZH=[
  '指令',
  '  Enter            新增編輯（從選單選擇，完成後輸入 0）',
  '  貓罐頭 45000      直接輸入。也可以一次多個: 稀有券 299 白金券 max',
  '  /本能            搜尋功能（任何語言皆可，不加 / 也會搜尋）',
  '  maxall           全部最大',
  '  s                儲存',
  '  p / p+           載入預設 / 將目前的編輯存為預設',
  '  d 2              刪除第 2 項編輯（只輸入 d 會詢問編號）',
  '  c                清除所有編輯',
  '  0 或 q           不儲存並離開',
  '  在要求輸入數字的地方輸入 max 即為最大值。'].join('\n');
// Help in Spanish, French, German, Italian and Thai (same commands; the typed words stay as they are).
const HELP_MORE=[
  ['Comandos','añadir una edición (elige en los menús; 0 al terminar)','escríbelo directamente; también varios: rare 299 platinum max','buscar una función (cualquier idioma; también sin /)','todo al máximo','guardar','cargar un ajuste guardado / guardar estas ediciones como ajuste','quitar la edición 2 (d sola pregunta cuál)','borrar todas las ediciones','salir sin guardar','  En cualquier número, max pone el valor más alto.'],
  ['Commandes','ajouter une modification (choisis dans les menus ; 0 pour finir)','tape-le directement ; plusieurs aussi : rare 299 platinum max','chercher une fonction (toute langue ; marche aussi sans /)','tout au maximum','enregistrer','charger un préréglage / enregistrer ces modifications comme préréglage','retirer la modification 2 (d seul demande laquelle)','effacer toutes les modifications','quitter sans enregistrer','  À chaque demande de nombre, max met la valeur la plus haute.'],
  ['Befehle','Änderung hinzufügen (in den Menüs wählen; 0 wenn fertig)','direkt eintippen; mehrere gehen auch: rare 299 platinum max','Funktion suchen (jede Sprache; auch ohne /)','alles maximal','speichern','Vorlage laden / diese Änderungen als Vorlage speichern','Änderung 2 entfernen (d allein fragt nach)','alle Änderungen löschen','beenden ohne Speichern','  Bei jeder Zahlenabfrage setzt max den höchsten Wert.'],
  ['Comandi','aggiungi una modifica (scegli dai menu; 0 per finire)','scrivilo direttamente; anche più di uno: rare 299 platinum max','cerca una funzione (qualsiasi lingua; anche senza /)','tutto al massimo','salva','carica un preset / salva queste modifiche come preset','rimuovi la modifica 2 (d da sola chiede quale)','cancella tutte le modifiche','esci senza salvare','  A ogni richiesta di numero, max inserisce il valore più alto.'],
  ['คำสั่ง','เพิ่มการแก้ไข (เลือกจากเมนู เสร็จแล้วกด 0)','พิมพ์ตรงๆ ได้ หลายรายการก็ได้: rare 299 platinum max','ค้นหาฟีเจอร์ (ภาษาใดก็ได้ ไม่ใส่ / ก็ได้)','สูงสุดทั้งหมด','บันทึก','โหลดพรีเซ็ต / บันทึกการแก้ไขนี้เป็นพรีเซ็ต','ลบการแก้ไขข้อ 2 (พิมพ์ d อย่างเดียวจะถามหมายเลข)','ล้างการแก้ไขทั้งหมด','ออกโดยไม่บันทึก','  ทุกที่ที่ถามตัวเลข พิมพ์ max เพื่อใส่ค่าสูงสุด']
].map(([title,add,direct,find,maxall,save,preset,remove,clear,quit,max])=>[title,
  `  Enter            ${add}`,`  catfood 45000    ${direct}`,`  /talent          ${find}`,`  maxall           ${maxall}`,`  s                ${save}`,
  `  p / p+           ${preset}`,`  d 2              ${remove}`,`  c                ${clear}`,`  0 / q            ${quit}`,max].join('\n'));
async function editMenu(source,save,gd,hello,names=null,kept=[],config=prefs){
  const extended=extendedOn(hello);
  const menus=createMenus({ui:{say,ask,choose,askNumber,yes,L,lang:()=>lang},save,gd,names,policy:hello.policy||{},access:hello.access||{},limits:hello.limits||{},extended});
  const edits=[...kept];
  // Edits picked together are added together: each is checked, then all of them are tried on the SAVE at once.
  const tryAdd=list=>{
    list=[].concat(list);
    if(edits.length+list.length>PENDING_MAX)throw fail('PENDING_MAX',L(`편집은 한 번에 ${PENDING_MAX}개까지입니다.`,`Up to ${PENDING_MAX} edits at a time.`,`編集は一度に${PENDING_MAX}件までです。`,`一次最多 ${PENDING_MAX} 項編輯。`,`Hasta ${PENDING_MAX} ediciones a la vez.`,`Jusqu'à ${PENDING_MAX} modifications à la fois.`,`Bis zu ${PENDING_MAX} Änderungen auf einmal.`,`Fino a ${PENDING_MAX} modifiche alla volta.`,`แก้ไขได้ครั้งละไม่เกิน ${PENDING_MAX} รายการ`));
    for(const edit of list)if(!menus.allowed(edit))throw fail('FEATURE_OFF',L('지금은 쓸 수 없는 기능입니다.','This feature is turned off.','現在は使えない機能です。','此功能目前無法使用。','Esta función está desactivada.','Cette fonction est désactivée.','Diese Funktion ist ausgeschaltet.','Questa funzione è disattivata.','ฟีเจอร์นี้ปิดอยู่'));
    ownerLimitCheck(hello.limits,list);
    const trial=engine.parse(source.raw,source.cc);applyEdits(trial,gd,[...edits,...list],editSettings(extended));
    edits.push(...list);for(const e of list)say(L(`추가: ${menus.describe(e)}`,`Added: ${menus.describe(e)}`,`追加: ${menus.describe(e)}`,`已新增: ${menus.describe(e)}`,`Añadido: ${menus.describe(e)}`,`Ajouté : ${menus.describe(e)}`,`Hinzugefügt: ${menus.describe(e)}`,`Aggiunto: ${menus.describe(e)}`,`เพิ่มแล้ว: ${menus.describe(e)}`));
  };
  const notAdded=err=>say(L(`추가하지 않았습니다: ${explain(err)}`,`Not added: ${explain(err)}`,`追加できませんでした: ${explain(err)}`,`未新增: ${explain(err)}`,`No añadido: ${explain(err)}`,`Non ajouté : ${explain(err)}`,`Nicht hinzugefügt: ${explain(err)}`,`Non aggiunto: ${explain(err)}`,`เพิ่มไม่ได้: ${explain(err)}`));
  const none=()=>say(L('편집이 없습니다.','There are no edits.','編集がありません。','沒有編輯。','No hay ediciones.','Il n\'y a aucune modification.','Es gibt keine Änderungen.','Non ci sono modifiche.','ไม่มีรายการแก้ไข'));
  const help=()=>say(L(HELP_KO,HELP_EN,HELP_JA,HELP_ZH,...HELP_MORE));
  let first=true;
  for(;;){
    say('');say(L(`— 대기 중인 편집 (${edits.length}) —`,`— Pending edits (${edits.length}) —`,`— 保留中の編集 (${edits.length}) —`,`— 待處理的編輯 (${edits.length}) —`,`— Ediciones pendientes (${edits.length}) —`,`— Modifications en attente (${edits.length}) —`,`— Ausstehende Änderungen (${edits.length}) —`,`— Modifiche in attesa (${edits.length}) —`,`— รายการแก้ไขที่รอบันทึก (${edits.length}) —`));
    if(edits.length)say(edits.map((e,i)=>`  ${i+1}. ${menus.describe(e)}`).join('\n'));
    if(extended)say(L('  [확장 한도 켜짐]','  [extended limits on]','  [拡張上限オン]','  [擴充上限已開啟]','  [límites ampliados activados]','  [limites étendues activées]','  [erweiterte Grenzen an]','  [limiti estesi attivi]','  [เปิดขีดจำกัดแบบขยาย]'));
    if(first){help();first=false;}
    else say(L('Enter 편집 추가 · s 저장 · ? 도움말 · 0 나가기 · 통조림 45000 · /기능 찾기','Enter add · s save · ? help · 0 quit · catfood 45000 · /find a feature','Enter 追加 · s 保存 · ? ヘルプ · 0 終了 · ネコカン 45000 · /機能を探す','Enter 新增 · s 儲存 · ? 說明 · 0 離開 · 貓罐頭 45000 · /搜尋功能','Enter añadir · s guardar · ? ayuda · 0 salir · catfood 45000 · /buscar una función','Entrée ajouter · s enregistrer · ? aide · 0 quitter · catfood 45000 · /chercher une fonction','Enter hinzufügen · s speichern · ? Hilfe · 0 beenden · catfood 45000 · /Funktion suchen','Invio aggiungi · s salva · ? aiuto · 0 esci · catfood 45000 · /cerca una funzione','Enter เพิ่ม · s บันทึก · ? ช่วยเหลือ · 0 ออก · catfood 45000 · /ค้นหาฟีเจอร์'));
    let a;try{a=await ask('> ');}catch(err){if(isBack(err)){backed();return null;}throw err;}
    const cmd=a.toLowerCase();
    try{
      if(cmd===''||cmd==='a'||cmd==='+'){
        // Keep picking until the person backs out of the section list.
        for(;;){let edit;try{edit=await menus.pick();}catch(err){if(isBack(err))break;throw err;}if(!edit)continue;
          try{tryAdd(edit);}catch(err){notAdded(err);}}
      }
      else if(cmd==='s'){if(!edits.length){none();continue;}return {edits,describe:menus.describe,extended};}
      else if(cmd==='q'||cmd==='0'){if(edits.length&&!(await yes(L(`편집 ${edits.length}개를 저장하지 않고 나갈까요?`,`Quit without saving ${edits.length} edits?`,`${edits.length}件の編集を保存せずに終了しますか？`,`要放棄 ${edits.length} 項編輯並離開嗎？`,`¿Salir sin guardar ${edits.length} ediciones?`,`Quitter sans enregistrer ${edits.length} modifications ?`,`Beenden, ohne ${edits.length} Änderungen zu speichern?`,`Uscire senza salvare ${edits.length} modifiche?`,`ออกโดยไม่บันทึกการแก้ไข ${edits.length} รายการไหม`))))continue;return null;}
      else if(cmd==='?'||cmd==='h'||cmd==='help')help();
      else if(cmd==='p'){
        const list=presets();if(!list.length){say(L('저장된 프리셋이 없습니다. 편집을 추가한 뒤 p+ 로 만드세요.','There are no presets. Add edits, then use p+.','プリセットがありません。編集を追加してから p+ で作成してください。','沒有預設。請先新增編輯，再用 p+ 建立。','No hay ajustes guardados. Añade ediciones y usa p+.','Il n\'y a aucun préréglage. Ajoute des modifications, puis utilise p+.','Es gibt keine Vorlagen. Füge Änderungen hinzu und nutze dann p+.','Non ci sono preset. Aggiungi modifiche, poi usa p+.','ยังไม่มีพรีเซ็ต เพิ่มการแก้ไขแล้วใช้ p+'));continue;}
        const p=list[await choose(L('불러올 프리셋','Preset to load','読み込むプリセット','要載入的預設','Ajuste guardado a cargar','Préréglage à charger','Zu ladende Vorlage','Preset da caricare','พรีเซ็ตที่จะโหลด'),list.map(x=>`${x.name} (${x.edits.length})`))];
        let added=0,skipped=0;
        for(const raw of p.edits){
          const edit=JSON.parse(JSON.stringify(raw));
          try{tryAdd(edit);added++;}catch(err){skipped++;say(L(`  건너뜀: ${menus.describe(edit)} (${explain(err)})`,`  Skipped: ${menus.describe(edit)} (${explain(err)})`,`  スキップ: ${menus.describe(edit)} (${explain(err)})`,`  已略過: ${menus.describe(edit)} (${explain(err)})`,`  Omitido: ${menus.describe(edit)} (${explain(err)})`,`  Ignoré : ${menus.describe(edit)} (${explain(err)})`,`  Übersprungen: ${menus.describe(edit)} (${explain(err)})`,`  Saltato: ${menus.describe(edit)} (${explain(err)})`,`  ข้าม: ${menus.describe(edit)} (${explain(err)})`));}
        }
        say(L(`프리셋 "${p.name}": ${added}개 추가, ${skipped}개 건너뜀`,`Preset "${p.name}": ${added} added, ${skipped} skipped`,`プリセット「${p.name}」: ${added}件追加、${skipped}件スキップ`,`預設「${p.name}」: 已新增 ${added} 項，略過 ${skipped} 項`,`Ajuste "${p.name}": ${added} añadidos, ${skipped} omitidos`,`Préréglage "${p.name}" : ${added} ajoutés, ${skipped} ignorés`,`Vorlage "${p.name}": ${added} hinzugefügt, ${skipped} übersprungen`,`Preset "${p.name}": ${added} aggiunti, ${skipped} saltati`,`พรีเซ็ต "${p.name}": เพิ่ม ${added} ข้าม ${skipped}`));
      }
      else if(cmd==='p+'){
        if(!edits.length){none();continue;}
        let name='';for(;;){name=(await ask(L(`프리셋 이름 (${PRESET_NAME_MAX}자까지): `,`Preset name (up to ${PRESET_NAME_MAX} characters): `,`プリセット名 (${PRESET_NAME_MAX}文字まで): `,`預設名稱（最多 ${PRESET_NAME_MAX} 字）: `,`Nombre del ajuste (hasta ${PRESET_NAME_MAX} caracteres): `,`Nom du préréglage (jusqu'à ${PRESET_NAME_MAX} caractères) : `,`Name der Vorlage (bis ${PRESET_NAME_MAX} Zeichen): `,`Nome del preset (fino a ${PRESET_NAME_MAX} caratteri): `,`ชื่อพรีเซ็ต (ไม่เกิน ${PRESET_NAME_MAX} ตัวอักษร): `))).replace(/[\x00-\x1f]/g,'');if(name&&[...name].length<=PRESET_NAME_MAX)break;}
        const list=presets(),at=list.findIndex(x=>x.name===name);
        if(at>=0&&!(await yes(L(`"${name}" 프리셋을 덮어쓸까요?`,`Replace the preset "${name}"?`,`プリセット「${name}」を上書きしますか？`,`要覆寫預設「${name}」嗎？`,`¿Reemplazar el ajuste "${name}"?`,`Remplacer le préréglage "${name}" ?`,`Vorlage "${name}" ersetzen?`,`Sostituire il preset "${name}"?`,`แทนที่พรีเซ็ต "${name}" ไหม`))))continue;
        if(at<0&&list.length>=PRESET_MAX){say(L(`프리셋은 ${PRESET_MAX}개까지입니다. 설정에서 하나 지우세요.`,`Up to ${PRESET_MAX} presets. Delete one in Settings.`,`プリセットは${PRESET_MAX}件までです。設定でひとつ削除してください。`,`預設最多 ${PRESET_MAX} 個。請在設定中刪除一個。`,`Hasta ${PRESET_MAX} ajustes. Borra uno en Configuración.`,`Jusqu'à ${PRESET_MAX} préréglages. Supprimes-en un dans les Paramètres.`,`Bis zu ${PRESET_MAX} Vorlagen. Lösche eine in den Einstellungen.`,`Fino a ${PRESET_MAX} preset. Eliminane uno nelle Impostazioni.`,`พรีเซ็ตได้ไม่เกิน ${PRESET_MAX} อัน ลบได้ในการตั้งค่า`));continue;}
        const entry={name,cc:source.cc,edits:JSON.parse(JSON.stringify(edits))};
        if(at>=0)list[at]=entry;else list.push(entry);savePresets(list,config);
        say(L(`프리셋 "${name}"을(를) 저장했습니다 (${edits.length}개).`,`Saved the preset "${name}" (${edits.length}).`,`プリセット「${name}」を保存しました (${edits.length}件)。`,`已儲存預設「${name}」（${edits.length} 項）。`,`Ajuste "${name}" guardado (${edits.length}).`,`Préréglage "${name}" enregistré (${edits.length}).`,`Vorlage "${name}" gespeichert (${edits.length}).`,`Preset "${name}" salvato (${edits.length}).`,`บันทึกพรีเซ็ต "${name}" แล้ว (${edits.length})`));
      }
      else if(/^d\s*\d*$/.test(cmd)){
        if(!edits.length){none();continue;}
        const given=Number(cmd.slice(1).trim()),n=Number.isInteger(given)&&given>=1&&given<=edits.length?given:await askNumber(L('지울 편집 번호','Edit number to remove','削除する編集の番号','要刪除的編輯編號','Número de la edición a quitar','Numéro de la modification à retirer','Nummer der zu entfernenden Änderung','Numero della modifica da rimuovere','หมายเลขรายการที่จะลบ'),1,edits.length);
        const [gone]=edits.splice(n-1,1);say(L(`지움: ${menus.describe(gone)}`,`Removed: ${menus.describe(gone)}`,`削除: ${menus.describe(gone)}`,`已刪除: ${menus.describe(gone)}`,`Quitado: ${menus.describe(gone)}`,`Retiré : ${menus.describe(gone)}`,`Entfernt: ${menus.describe(gone)}`,`Rimosso: ${menus.describe(gone)}`,`ลบแล้ว: ${menus.describe(gone)}`));
      }
      else if(cmd==='c'){if(edits.length&&await yes(L(`편집 ${edits.length}개를 모두 지울까요?`,`Clear all ${edits.length} edits?`,`${edits.length}件の編集をすべて削除しますか？`,`要清除全部 ${edits.length} 項編輯嗎？`,`¿Borrar las ${edits.length} ediciones?`,`Effacer les ${edits.length} modifications ?`,`Alle ${edits.length} Änderungen löschen?`,`Cancellare tutte le ${edits.length} modifiche?`,`ล้างการแก้ไขทั้ง ${edits.length} รายการไหม`)))edits.length=0;}
      else{
        // "/word" searches the features; other text is an item typed directly, else also a feature search.
        const direct=a.startsWith('/')?null:parseDirect(a,menus.itemRows(),menus.label);
        if(direct?.error)say(direct.error);
        else if(direct)tryAdd(direct.edits);
        else{
          const found=await menus.find(a.startsWith('/')?a.slice(1):a);
          if(found.none)say(L('그런 기능이나 명령이 없습니다. ? 를 입력하면 도움말이 나옵니다.','No such feature or command. Type ? for help.','そのような機能やコマンドはありません。? でヘルプを表示します。','沒有這個功能或指令。輸入 ? 查看說明。','No existe esa función o comando. Escribe ? para ver la ayuda.','Fonction ou commande inconnue. Tape ? pour l\'aide.','Diese Funktion oder diesen Befehl gibt es nicht. Tippe ? für Hilfe.','Funzione o comando inesistente. Scrivi ? per l\'aiuto.','ไม่มีฟีเจอร์หรือคำสั่งนี้ พิมพ์ ? เพื่อดูวิธีใช้'));
          else if(found.edit)tryAdd(found.edit);
        }
      }
    }catch(err){if(isBack(err)){backed();continue;}notAdded(err);}
  }
}

// ---------- settings ----------
// Returns 'forgot' when the token was removed (the editor then quits).
async function settingsMenu(config,hello){
  for(;;){
    const keep=Number(config.backupKeep)||0,canExtend=hello?.access?.canUseExtendedLimits===true;
    const keepText=keep?L(`최근 ${keep}개`,`newest ${keep}`,`新しい順に${keep}件`,`最新 ${keep} 個`,`los ${keep} más recientes`,`les ${keep} plus récentes`,`die ${keep} neuesten`,`i ${keep} più recenti`,`ใหม่สุด ${keep}`):L('전부','all','すべて','全部','todas','toutes','alle','tutti','ทั้งหมด');
    const extText=!canExtend?L('역할 필요','needs a role','ロールが必要','需要身分組','requiere un rol','nécessite un rôle','Rolle nötig','serve un ruolo','ต้องมีบทบาท'):config.extendedLimits===true?L('켜짐','on','オン','開啟','activado','activé','an','attivo','เปิด'):L('꺼짐','off','オフ','關閉','desactivado','désactivé','aus','disattivo','ปิด');
    const SETTINGS=['lang','presets','backups','extended','token','done'];
    const pick=SETTINGS[await choose(L('설정','Settings','設定','設定','Configuración','Paramètres','Einstellungen','Impostazioni','การตั้งค่า'),['Language / 언어 / 言語 / 語言',L(`프리셋 관리 (${presets().length}개)`,`Manage presets (${presets().length})`,`プリセット管理 (${presets().length}件)`,`管理預設（${presets().length} 個）`,`Gestionar ajustes guardados (${presets().length})`,`Gérer les préréglages (${presets().length})`,`Vorlagen verwalten (${presets().length})`,`Gestisci preset (${presets().length})`,`จัดการพรีเซ็ต (${presets().length})`),L(`백업 보관 개수: ${keepText}`,`Backups to keep: ${keepText}`,`バックアップの保存数: ${keepText}`,`備份保留數量: ${keepText}`,`Copias a conservar: ${keepText}`,`Sauvegardes à garder : ${keepText}`,`Zu behaltende Sicherungen: ${keepText}`,`Backup da tenere: ${keepText}`,`จำนวนไฟล์สำรองที่เก็บ: ${keepText}`),L(`확장 한도: ${extText}`,`Extended limits: ${extText}`,`拡張上限: ${extText}`,`擴充上限: ${extText}`,`Límites ampliados: ${extText}`,`Limites étendues : ${extText}`,`Erweiterte Grenzen: ${extText}`,`Limiti estesi: ${extText}`,`ขีดจำกัดแบบขยาย: ${extText}`),L('토큰 지우기','Forget token','トークンを削除','刪除權杖','Olvidar el token','Oublier le jeton','Token vergessen','Dimentica il token','ลืมโทเค็น'),L('돌아가기','Done','戻る','返回','Listo','Terminé','Fertig','Fatto','เสร็จ')])];
    if(pick==='done')return null;
    // Backing out inside one setting returns to this list; backing out of the list returns to the first menu.
    try{
    if(pick==='lang'){await chooseLanguage(config);continue;}
    if(pick==='token'){if(!(await yes(L('토큰을 지우고 종료할까요?','Forget the token and quit?','トークンを削除して終了しますか？','要刪除權杖並離開嗎？','¿Olvidar el token y salir?','Oublier le jeton et quitter ?','Token vergessen und beenden?','Dimenticare il token e uscire?','ลืมโทเค็นแล้วออกไหม'))))continue;config.token='';saveConfig(config);say(L('토큰을 지웠습니다.','Token removed.','トークンを削除しました。','已刪除權杖。','Token eliminado.','Jeton supprimé.','Token entfernt.','Token rimosso.','ลบโทเค็นแล้ว'));return 'forgot';}
    if(pick==='presets'){
      const list=presets();if(!list.length){say(L('저장된 프리셋이 없습니다.','There are no presets.','プリセットがありません。','沒有預設。','No hay ajustes guardados.','Il n\'y a aucun préréglage.','Es gibt keine Vorlagen.','Non ci sono preset.','ยังไม่มีพรีเซ็ต'));continue;}
      const i=await choose(L('지울 프리셋','Preset to delete','削除するプリセット','要刪除的預設','Ajuste a borrar','Préréglage à supprimer','Zu löschende Vorlage','Preset da eliminare','พรีเซ็ตที่จะลบ'),list.map(x=>`${x.name} (${(x.cc||'?').toUpperCase()}, ${x.edits.length})`));
      if(!(await yes(L(`"${list[i].name}" 프리셋을 지울까요?`,`Delete the preset "${list[i].name}"?`,`プリセット「${list[i].name}」を削除しますか？`,`要刪除預設「${list[i].name}」嗎？`,`¿Borrar el ajuste "${list[i].name}"?`,`Supprimer le préréglage "${list[i].name}" ?`,`Vorlage "${list[i].name}" löschen?`,`Eliminare il preset "${list[i].name}"?`,`ลบพรีเซ็ต "${list[i].name}" ไหม`))))continue;
      list.splice(i,1);savePresets(list,config);say(L('지웠습니다.','Deleted.','削除しました。','已刪除。','Borrado.','Supprimé.','Gelöscht.','Eliminato.','ลบแล้ว'));continue;
    }
    if(pick==='backups'){
      const i=await choose(L('백업을 몇 개까지 남길까요? (결과를 확인하지 못한 업로드의 백업은 항상 남깁니다)','How many backups to keep? (backups of uploads with an unknown result are always kept)','バックアップを何件まで残しますか？(結果を確認できなかったアップロードのバックアップは常に残します)','要保留多少個備份？（無法確認結果的上傳備份一律保留）','¿Cuántas copias conservar? (las copias de subidas con resultado desconocido se conservan siempre)','Combien de sauvegardes garder ? (celles des envois au résultat inconnu sont toujours gardées)','Wie viele Sicherungen behalten? (Sicherungen von Uploads mit unbekanntem Ergebnis bleiben immer)','Quanti backup tenere? (i backup dei caricamenti con esito sconosciuto restano sempre)','จะเก็บไฟล์สำรองกี่ไฟล์ (ไฟล์สำรองของการอัปโหลดที่ไม่ทราบผลจะเก็บไว้เสมอ)'),BACKUP_KEEP.map(n=>n?L(`최근 ${n}개`,`Newest ${n}`,`新しい順に${n}件`,`最新 ${n} 個`,`Las ${n} más recientes`,`Les ${n} plus récentes`,`Die ${n} neuesten`,`I ${n} più recenti`,`ใหม่สุด ${n}`):L('전부 남기기','Keep all','すべて残す','全部保留','Conservar todas','Tout garder','Alle behalten','Tienili tutti','เก็บทั้งหมด')));
      config.backupKeep=BACKUP_KEEP[i];saveConfig(config);
      const removed=pruneBackups(path.join(HOME,'backups'),config.backupKeep,null);
      if(removed)say(L(`오래된 백업 ${removed}개를 지웠습니다.`,`Removed ${removed} old backups.`,`古いバックアップを${removed}件削除しました。`,`已刪除 ${removed} 個舊備份。`,`Se borraron ${removed} copias antiguas.`,`${removed} anciennes sauvegardes supprimées.`,`${removed} alte Sicherungen entfernt.`,`Rimossi ${removed} vecchi backup.`,`ลบไฟล์สำรองเก่า ${removed} ไฟล์แล้ว`));continue;
    }
    if(pick==='extended'){
      if(!canExtend){say(L('확장 한도는 이를 허용한 역할(후원 등)이 있어야 쓸 수 있습니다.','Extended limits need a role that allows them (such as a supporter role).','拡張上限は、それを許可されたロール(支援者など)が必要です。','擴充上限需要擁有允許的身分組（例如贊助者）。','Los límites ampliados requieren un rol que los permita (como un rol de supporter).','Les limites étendues nécessitent un rôle qui les autorise (par exemple supporter).','Erweiterte Grenzen brauchen eine Rolle, die sie erlaubt (z. B. Supporter).','I limiti estesi richiedono un ruolo che li consenta (ad esempio supporter).','ขีดจำกัดแบบขยายต้องมีบทบาทที่อนุญาต (เช่น ผู้สนับสนุน)'));continue;}
      if(config.extendedLimits===true){config.extendedLimits=false;saveConfig(config);say(L('확장 한도를 껐습니다.','Extended limits are off.','拡張上限をオフにしました。','已關閉擴充上限。','Los límites ampliados están desactivados.','Les limites étendues sont désactivées.','Erweiterte Grenzen sind aus.','I limiti estesi sono disattivati.','ปิดขีดจำกัดแบบขยายแล้ว'));continue;}
      say(L('확장 한도를 켜면 아이템과 클리어 횟수를 게임 권장값보다 크게 넣을 수 있습니다. 값이 지나치게 크면 게임이나 PONOS 서버가 계정을 이상하게 볼 수 있습니다. 운영자가 정한 상한은 그대로 적용됩니다.','Extended limits let items and clear counts go past the game\'s usual values. Very large values can look wrong to the game or to PONOS. The owner\'s caps still apply.','拡張上限をオンにすると、アイテムやクリア回数を通常の値より大きくできます。値が大きすぎるとゲームやPONOSに不自然と判断されることがあります。運営者の上限はそのまま適用されます。','開啟擴充上限後，道具與通關次數可以超過遊戲的一般數值。數值過大可能被遊戲或 PONOS 視為異常。營運者設定的上限仍然適用。','Los límites ampliados permiten que objetos y veces superadas pasen de los valores habituales del juego. Valores muy grandes pueden parecer extraños al juego o a PONOS. Los topes del administrador siguen aplicándose.','Les limites étendues permettent aux objets et aux victoires de dépasser les valeurs habituelles du jeu. Des valeurs très grandes peuvent sembler anormales au jeu ou à PONOS. Les plafonds du propriétaire restent appliqués.','Erweiterte Grenzen lassen Gegenstände und Abschlüsse über die üblichen Spielwerte gehen. Sehr große Werte können für das Spiel oder PONOS falsch aussehen. Die Obergrenzen des Betreibers gelten weiter.','I limiti estesi permettono a oggetti e completamenti di superare i valori normali del gioco. Valori molto grandi possono sembrare anomali al gioco o a PONOS. I limiti del proprietario restano validi.','ขีดจำกัดแบบขยายให้ไอเทมและจำนวนครั้งที่ผ่านเกินค่าปกติของเกมได้ ค่าที่สูงมากอาจดูผิดปกติสำหรับเกมหรือ PONOS เพดานของเจ้าของยังมีผลอยู่'));
      if(await yes(L('켤까요?','Turn them on?','オンにしますか？','要開啟嗎？','¿Activarlos?','Les activer ?','Einschalten?','Attivarli?','เปิดไหม'))){config.extendedLimits=true;saveConfig(config);say(L('확장 한도를 켰습니다.','Extended limits are on.','拡張上限をオンにしました。','已開啟擴充上限。','Los límites ampliados están activados.','Les limites étendues sont activées.','Erweiterte Grenzen sind an.','I limiti estesi sono attivi.','เปิดขีดจำกัดแบบขยายแล้ว'));}
    }
    }catch(err){if(isBack(err)){backed();continue;}throw err;}
  }
}

// ---------- save ----------
async function reserve(token,mode,edits,restored){
  const operationId=crypto.randomUUID(),r=await (await api(token,'POST','/api/local/cli/reserve',{operationId,mode:mode==='codes'?'codes':'file',editCount:restored?Math.max(1,edits.length):edits.length})).json();
  if(!r.allowed)throw fail('QUOTA',L('남은 저장 횟수가 없습니다.','You have no SAVEs left.','保存できる回数が残っていません。','已沒有剩餘的儲存次數。','No te quedan guardados.','Il ne te reste plus de sauvegardes.','Du hast keine Speichervorgänge mehr übrig.','Non ti restano salvataggi.','คุณไม่เหลือจำนวนครั้งบันทึกแล้ว'));
  return operationId;
}
async function finish(token,operationId,mode,outcome){
  try{return await (await api(token,'POST','/api/local/cli/finish',{operationId,mode:mode==='codes'?'codes':'file',outcome})).json();}
  catch{say(L('(canbot.dev에 결과를 알리지 못했습니다. 저장 자체에는 영향이 없습니다.)','(Could not report the result to canbot.dev. The SAVE itself is not affected.)','(canbot.devに結果を送れませんでした。セーブ自体には影響ありません。)','（無法將結果回報給 canbot.dev。存檔本身不受影響。）','(No se pudo informar el resultado a canbot.dev. La partida no se ve afectada.)','(Impossible d\'envoyer le résultat à canbot.dev. La sauvegarde elle-même n\'est pas touchée.)','(Das Ergebnis konnte nicht an canbot.dev gemeldet werden. Der Spielstand selbst ist nicht betroffen.)','(Impossibile inviare il risultato a canbot.dev. Il salvataggio non è interessato.)','(ส่งผลลัพธ์ไปที่ canbot.dev ไม่ได้ ตัวเซฟไม่ได้รับผลกระทบ)'));return null;}
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
async function saveAndUpload(token,source,edits,gd,extended=false){
  const save=fresh(source);
  if(edits.length)applyEdits(save,gd,edits,editSettings(extended));
  const out=engine.serialize(save);
  // The written SAVE must read back to the same bytes before it leaves this device.
  if(!engine.serialize(engine.parse(out,source.cc)).equals(out))throw fail('VERIFY',L('편집한 SAVE 확인에 실패했습니다. 저장하지 않았습니다.','The edited SAVE did not verify. Nothing was saved.','編集したセーブの確認に失敗しました。何も保存していません。','編輯後的存檔驗證失敗。未儲存任何內容。','La partida editada no pasó la verificación. No se guardó nada.','La sauvegarde modifiée n\'a pas passé la vérification. Rien n\'a été enregistré.','Der geänderte Spielstand hat die Prüfung nicht bestanden. Nichts wurde gespeichert.','Il salvataggio modificato non ha superato la verifica. Non è stato salvato nulla.','เซฟที่แก้ไขตรวจสอบไม่ผ่าน ไม่ได้บันทึกอะไร'));
  if(source.kind==='file'||source.kind==='adb'){
    const operationId=await reserve(token,source.kind,edits,source.restored);
    let back=null;
    try{if(source.kind==='file'){writeRooted(source.file,out);back=readRooted(source.file);}else back=writeAdb(source,out);}
    catch{await finish(token,operationId,source.kind,'uncertain');throw fail('FILE',L('SAVE를 쓰지 못했습니다. 백업에서 복원할 수 있습니다.','Could not write the SAVE. You can restore it from the backup.','セーブを書き込めませんでした。バックアップから復元できます。','無法寫入存檔。可以從備份還原。','No se pudo escribir la partida. Puedes restaurarla desde la copia.','Impossible d\'écrire la sauvegarde. Tu peux la restaurer depuis la copie.','Der Spielstand konnte nicht geschrieben werden. Du kannst ihn aus der Sicherung wiederherstellen.','Impossibile scrivere il salvataggio. Puoi ripristinarlo dal backup.','เขียนเซฟไม่ได้ กู้คืนจากไฟล์สำรองได้'));}
    const ok=Buffer.isBuffer(back)&&back.equals(out);
    await finish(token,operationId,source.kind,ok?'committed':'uncertain');
    say(ok?L('\n저장했습니다. 게임을 실행해 확인하세요.','\nSaved. Start the game to check.','\n保存しました。ゲームを起動して確認してください。','\n已儲存。請啟動遊戲確認。','\nGuardado. Abre el juego para comprobarlo.','\nEnregistré. Lance le jeu pour vérifier.','\nGespeichert. Starte das Spiel zum Prüfen.','\nSalvato. Avvia il gioco per controllare.','\nบันทึกแล้ว เปิดเกมเพื่อตรวจสอบ'):L('\nSAVE를 썼지만 다시 읽어 확인하지 못했습니다. 게임에서 확인하세요.','\nThe SAVE was written but could not be read back. Check in the game.','\nセーブを書き込みましたが、読み直して確認できませんでした。ゲームで確認してください。','\n已寫入存檔，但無法重新讀取確認。請在遊戲中確認。','\nLa partida se escribió pero no se pudo volver a leer. Compruébalo en el juego.','\nLa sauvegarde a été écrite mais n\'a pas pu être relue. Vérifie dans le jeu.','\nDer Spielstand wurde geschrieben, konnte aber nicht zurückgelesen werden. Prüfe im Spiel.','\nIl salvataggio è stato scritto ma non è stato possibile rileggerlo. Controlla nel gioco.','\nเขียนเซฟแล้วแต่อ่านกลับไม่ได้ ตรวจสอบในเกม'));
    return;
  }
  if(!source.account)startAccount(source);
  say(L('PONOS 서버에 업로드 중...','Uploading to PONOS...','PONOSにアップロード中...','正在上傳到 PONOS...','Subiendo a PONOS...','Envoi à PONOS...','Hochladen zu PONOS...','Caricamento su PONOS...','กำลังอัปโหลดไปที่ PONOS...'));
  // Credentials and the save key first (nothing is uploaded yet), then the SAVE is counted and sent.
  steps.on=true;
  try{await source.account.ready();}
  catch(err){steps.on=false;source.account=null;throw fail('PONOS_AUTH',L(`PONOS 인증에 실패했습니다 (${err.code||'?'}). 아무것도 업로드하지 않았습니다.`,`PONOS sign-in failed (${err.code||'?'}). Nothing was uploaded.`,`PONOSの認証に失敗しました (${err.code||'?'})。何もアップロードしていません。`,`PONOS 驗證失敗 (${err.code||'?'})。未上傳任何內容。`,`Falló el inicio de sesión en PONOS (${err.code||'?'}). No se subió nada.`,`La connexion à PONOS a échoué (${err.code||'?'}). Rien n'a été envoyé.`,`Anmeldung bei PONOS fehlgeschlagen (${err.code||'?'}). Nichts wurde hochgeladen.`,`Accesso a PONOS non riuscito (${err.code||'?'}). Non è stato caricato nulla.`,`เข้าสู่ระบบ PONOS ไม่สำเร็จ (${err.code||'?'}) ไม่ได้อัปโหลดอะไร`));}
  const operationId=await reserve(token,'codes',edits,source.restored).catch(err=>{steps.on=false;throw err;});
  const started=Date.now();let codes;
  try{codes=await source.account.upload(save,engine.serialize);}
  catch(err){
    steps.on=false;
    backup(`${source.cc}-not-confirmed.sav`,out);
    await finish(token,operationId,'codes','uncertain');
    if(!err.uploadPossible){source.uploading=false;throw fail('PONOS_UPLOAD',L(`업로드하지 못했습니다 (${err.step}: ${err.code}). PONOS에는 아무것도 바뀌지 않았습니다.`,`Upload failed (${err.step}: ${err.code}). Nothing changed at PONOS.`,`アップロードできませんでした (${err.step}: ${err.code})。PONOS側は何も変わっていません。`,`上傳失敗 (${err.step}: ${err.code})。PONOS 端沒有任何變更。`,`La subida falló (${err.step}: ${err.code}). No cambió nada en PONOS.`,`L'envoi a échoué (${err.step} : ${err.code}). Rien n'a changé chez PONOS.`,`Hochladen fehlgeschlagen (${err.step}: ${err.code}). Bei PONOS hat sich nichts geändert.`,`Caricamento non riuscito (${err.step}: ${err.code}). Nulla è cambiato su PONOS.`,`อัปโหลดไม่สำเร็จ (${err.step}: ${err.code}) ไม่มีอะไรเปลี่ยนที่ PONOS`));}
    say(L('\n업로드 결과를 확인할 수 없습니다. 자동으로 다시 시도하지 않습니다.\n편집된 SAVE는 ~/.canbot/backups 에 있습니다. 깡통봇 디스코드에 문의하세요.','\nThe upload result is unknown. It is not retried automatically.\nThe edited SAVE is in ~/.canbot/backups. Ask in the CanBot Discord.','\nアップロードの結果を確認できません。自動で再試行はしません。\n編集したセーブは ~/.canbot/backups にあります。CanBotのDiscordでお問い合わせください。','\n無法確認上傳結果。不會自動重試。\n編輯後的存檔在 ~/.canbot/backups。請到 CanBot 的 Discord 詢問。','\nNo se sabe el resultado de la subida. No se reintenta automáticamente.\nLa partida editada está en ~/.canbot/backups. Pregunta en el Discord de CanBot.','\nLe résultat de l\'envoi est inconnu. Il n\'est pas relancé automatiquement.\nLa sauvegarde modifiée est dans ~/.canbot/backups. Demande sur le Discord de CanBot.','\nDas Ergebnis des Hochladens ist unbekannt. Es wird nicht automatisch wiederholt.\nDer geänderte Spielstand liegt in ~/.canbot/backups. Frag im CanBot-Discord.','\nL\'esito del caricamento è sconosciuto. Non viene ripetuto automaticamente.\nIl salvataggio modificato è in ~/.canbot/backups. Chiedi nel Discord di CanBot.','\nไม่ทราบผลการอัปโหลด ระบบจะไม่ลองใหม่เอง\nเซฟที่แก้ไขอยู่ใน ~/.canbot/backups สอบถามได้ใน Discord ของ CanBot'));
    return;
  }
  steps.on=false;
  backup(`${source.cc}-uploaded.sav`,codes.bytes);
  await finish(token,operationId,'codes','committed');
  say('');say('========================================');
  say(L(`  인계 코드: ${codes.transferCode}`,`  Transfer code: ${codes.transferCode}`,`  引き継ぎコード: ${codes.transferCode}`,`  引繼碼: ${codes.transferCode}`,`  Código de transferencia: ${codes.transferCode}`,`  Code de transfert : ${codes.transferCode}`,`  Übertragungscode: ${codes.transferCode}`,`  Codice di trasferimento: ${codes.transferCode}`,`  รหัสโอนข้อมูล: ${codes.transferCode}`));
  say(L(`  인증 번호: ${codes.confirmationCode}`,`  Confirmation code: ${codes.confirmationCode}`,`  認証番号: ${codes.confirmationCode}`,`  認證碼: ${codes.confirmationCode}`,`  Código de confirmación: ${codes.confirmationCode}`,`  Code de confirmation : ${codes.confirmationCode}`,`  Bestätigungscode: ${codes.confirmationCode}`,`  Codice di conferma: ${codes.confirmationCode}`,`  รหัสยืนยัน: ${codes.confirmationCode}`));
  say('========================================');
  say(L(`게임의 "기종 변경" 화면에서 위 코드를 입력하세요. (업로드 ${((Date.now()-started)/1000).toFixed(1)}초)`,`Enter these codes in the game's data transfer screen. (upload ${((Date.now()-started)/1000).toFixed(1)}s)`,`ゲームの「機種変更」画面で上のコードを入力してください。(アップロード ${((Date.now()-started)/1000).toFixed(1)}秒)`,`請在遊戲的「引繼資料」畫面輸入上方代碼。（上傳 ${((Date.now()-started)/1000).toFixed(1)} 秒）`,`Introduce estos códigos en la pantalla de transferencia de datos del juego. (subida ${((Date.now()-started)/1000).toFixed(1)} s)`,`Saisis ces codes dans l'écran de transfert de données du jeu. (envoi ${((Date.now()-started)/1000).toFixed(1)} s)`,`Gib diese Codes im Datenübertragungsbildschirm des Spiels ein. (Upload ${((Date.now()-started)/1000).toFixed(1)} s)`,`Inserisci questi codici nella schermata di trasferimento dati del gioco. (caricamento ${((Date.now()-started)/1000).toFixed(1)} s)`,`ใส่รหัสเหล่านี้ในหน้าจอโอนข้อมูลของเกม (อัปโหลด ${((Date.now()-started)/1000).toFixed(1)} วินาที)`));
}

// Names in the chosen language: the newest game data of the region that speaks it (Korean -> KR, English -> global,
// Japanese -> JP, Chinese -> TW). Only for showing names; edits always use the SAVE's own region data.
// Game names in the page language: the global game's English names for Spanish, French, German, Italian and Thai.
const NAME_REGION={ko:'kr',en:'en',ja:'jp',zh:'tw',es:'en',fr:'en',de:'en',it:'en',th:'en'};
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
  say(c('1;33',L(`깡통봇 로컬 에디터  v${EDITOR_VERSION}`,`CanBot local editor  v${EDITOR_VERSION}`,`CanBot ローカルエディター  v${EDITOR_VERSION}`,`CanBot 本機編輯器  v${EDITOR_VERSION}`,`Editor local de CanBot  v${EDITOR_VERSION}`,`Éditeur local CanBot  v${EDITOR_VERSION}`,`Lokaler CanBot-Editor  v${EDITOR_VERSION}`,`Editor locale di CanBot  v${EDITOR_VERSION}`,`เอดิเตอร์ในเครื่องของ CanBot  v${EDITOR_VERSION}`)));
  say('Copyright (C) 2026 CanBot');
  say(L('AGPL-3.0-or-later 라이선스이며, 보증 없이 제공됩니다.','Licensed under AGPL-3.0-or-later and provided without any warranty.','AGPL-3.0-or-later ライセンスで、無保証で提供されます。','以 AGPL-3.0-or-later 授權，不提供任何擔保。','Con licencia AGPL-3.0-or-later y sin ninguna garantía.','Sous licence AGPL-3.0-or-later, fourni sans aucune garantie.','Lizenziert unter AGPL-3.0-or-later, ohne jede Gewährleistung.','Con licenza AGPL-3.0-or-later e senza alcuna garanzia.','ใช้สัญญาอนุญาต AGPL-3.0-or-later และไม่มีการรับประกันใดๆ'));
  say('');
  say(label('GitHub',LINKS.github));
  say(label(L('웹','Web','ウェブ','網站','Web','Web','Web','Web','เว็บ'),LINKS.web));
  say(label('Discord',LINKS.discord));
  say('');
  say(L('어디서든 exit (또는 뒤로) 를 입력하면 아무것도 바꾸지 않고 이전 단계로 돌아갑니다.','Type exit (or back) at any prompt to go back a step without changing anything.','どこでも exit (または 戻る) と入力すると、何も変更せずに前の段階へ戻ります。','在任何輸入處輸入 exit（或 返回）即可不做任何變更回到上一步。','Escribe exit (o back) en cualquier momento para volver un paso sin cambiar nada.','Tape exit (ou back) à tout moment pour revenir d\'une étape sans rien changer.','Tippe jederzeit exit (oder back), um einen Schritt zurückzugehen, ohne etwas zu ändern.','Scrivi exit (o back) in qualsiasi momento per tornare indietro di un passo senza cambiare nulla.','พิมพ์ exit (หรือ back) ได้ทุกเมื่อเพื่อย้อนกลับหนึ่งขั้นโดยไม่เปลี่ยนอะไร'));
  say(c('32',L('무료 프로그램입니다. 돈을 요구받았다면 사기입니다.','This program is free. If someone asked you to pay for it, it is a scam.','このプログラムは無料です。お金を求められたら詐欺です。','本程式免費。若有人向你收費，那是詐騙。','Este programa es gratis. Si alguien te pidió pagar por él, es una estafa.','Ce programme est gratuit. Si quelqu\'un te l\'a fait payer, c\'est une arnaque.','Dieses Programm ist kostenlos. Wenn jemand dafür Geld verlangt hat, ist es Betrug.','Questo programma è gratuito. Se qualcuno ti ha chiesto di pagarlo, è una truffa.','โปรแกรมนี้ใช้ฟรี ถ้ามีคนเรียกเก็บเงิน นั่นคือการหลอกลวง')));
  say(c('36','-'.repeat(48)));
}
const LANGS=[['ko','한국어'],['en','English'],['ja','日本語'],['zh','繁體中文'],['es','Español'],['fr','Français'],['de','Deutsch'],['it','Italiano'],['th','ไทย']];
async function chooseLanguage(config){const i=await choose('Language / 언어 / 言語 / 語言',LANGS.map(x=>x[1]));config.lang=LANGS[i][0];lang=config.lang;saveConfig(config);}
// Transfer codes stay valid until something is uploaded, so leaving before the upload only needs a word.
function codesStillValid(source){if(source?.kind==='codes'&&source.received&&!source.uploading)say(L('업로드하지 않았으므로 입력한 인계 코드를 게임에서 그대로 다시 쓸 수 있습니다.','Nothing was uploaded, so the transfer codes you entered still work in the game.','アップロードしていないので、入力した引き継ぎコードはゲームでそのまま使えます。','由於沒有上傳，輸入的引繼碼仍可在遊戲中使用。','No se subió nada, así que los códigos que escribiste siguen funcionando en el juego.','Rien n\'a été envoyé : les codes saisis fonctionnent toujours dans le jeu.','Es wurde nichts hochgeladen, die eingegebenen Codes funktionieren also weiter im Spiel.','Non è stato caricato nulla, quindi i codici inseriti funzionano ancora nel gioco.','ไม่ได้อัปโหลดอะไร รหัสที่ใส่ไว้จึงยังใช้ในเกมได้'));}
async function main(){
  rl=readline.createInterface({input:process.stdin,output:process.stdout});
  const config=loadConfig();prefs=config;
  let hello;
  try{
    if(!LANGS.some(x=>x[0]===config.lang))await chooseLanguage(config);
    lang=config.lang;
    banner();
    hello=await login(config);
  }catch(err){if(isBack(err)){rl.close();return;}throw err;}
  const left=hello.allowance?.unlimited?L('무제한','unlimited','無制限','無限制','ilimitado','illimité','unbegrenzt','illimitati','ไม่จำกัด'):String(hello.allowance?.remaining??'?');
  say(L(`${hello.user?.name||''}님, 반갑습니다. 남은 저장: ${left}`,`Hello ${hello.user?.name||''}. SAVEs left: ${left}`,`${hello.user?.name||''}さん、こんにちは。残りの保存回数: ${left}`,`${hello.user?.name||''} 你好。剩餘儲存次數: ${left}`,`Hola ${hello.user?.name||''}. Guardados restantes: ${left}`,`Bonjour ${hello.user?.name||''}. Sauvegardes restantes : ${left}`,`Hallo ${hello.user?.name||''}. Verbleibende Speichervorgänge: ${left}`,`Ciao ${hello.user?.name||''}. Salvataggi rimasti: ${left}`,`สวัสดี ${hello.user?.name||''} จำนวนครั้งบันทึกที่เหลือ: ${left}`));
  for(;;){
    let how;try{how=await choose(L('SAVE를 어디서 가져올까요?','Where is the SAVE?','セーブをどこから読み込みますか？','要從哪裡讀取存檔？','¿Dónde está la partida?','Où est la sauvegarde ?','Wo ist der Spielstand?','Dov\'è il salvataggio?','เซฟอยู่ที่ไหน'),[L('인계 코드 (루팅 불필요)','Transfer codes (no root needed)','引き継ぎコード (root不要)','引繼碼（不需要 root）','Códigos de transferencia (sin root)','Codes de transfert (pas besoin de root)','Übertragungscodes (kein Root nötig)','Codici di trasferimento (senza root)','รหัสโอนข้อมูล (ไม่ต้อง root)'),L('SAVE 파일 (루팅된 기기·에뮬레이터)','SAVE file (rooted phone or emulator)','セーブファイル (root端末・エミュレーター)','存檔檔案（已 root 的手機或模擬器）','Archivo de partida (móvil con root o emulador)','Fichier de sauvegarde (téléphone rooté ou émulateur)','Spielstanddatei (gerootetes Handy oder Emulator)','File di salvataggio (telefono con root o emulatore)','ไฟล์เซฟ (มือถือที่ root หรืออีมูเลเตอร์)'),
      L('PC에 adb로 연결한 기기','Device connected to this PC with adb','このPCにadbで接続した端末','以 adb 連接到這台電腦的裝置','Dispositivo conectado a este PC por adb','Appareil relié à ce PC par adb','Mit adb an diesen PC angeschlossenes Gerät','Dispositivo collegato a questo PC con adb','อุปกรณ์ที่ต่อกับพีซีนี้ด้วย adb'),L('백업에서 복원','Restore a backup','バックアップから復元','從備份還原','Restaurar una copia','Restaurer une sauvegarde','Sicherung wiederherstellen','Ripristina un backup','กู้คืนไฟล์สำรอง'),L('설정 (언어, 프리셋, 백업, 한도, 토큰)','Settings (language, presets, backups, limits, token)','設定 (言語・プリセット・バックアップ・上限・トークン)','設定（語言、預設、備份、上限、權杖）','Configuración (idioma, ajustes guardados, copias, límites, token)','Paramètres (langue, préréglages, sauvegardes, limites, jeton)','Einstellungen (Sprache, Vorlagen, Sicherungen, Grenzen, Token)','Impostazioni (lingua, preset, backup, limiti, token)','การตั้งค่า (ภาษา, พรีเซ็ต, ไฟล์สำรอง, ขีดจำกัด, โทเค็น)')],L('종료','Quit','終了','離開','Salir','Quitter','Beenden','Esci','ออก'));}catch(err){if(isBack(err))break;throw err;}
    if(how===4){let r=null;try{r=await settingsMenu(config,hello);}catch(err){if(!isBack(err))throw err;}if(r==='forgot')break;continue;}
    let source=null;
    try{
      const cc=REGIONS[await choose(L('게임 지역','Game region','ゲームの地域','遊戲地區','Región del juego','Région du jeu','Spielregion','Regione del gioco','ภูมิภาคของเกม'),[L('한국판','Korean','韓国版','韓國版','Coreana','Coréenne','Koreanisch','Coreana','เกาหลี'),L('글로벌(영어)판','Global (English)','グローバル(英語)版','國際（英文）版','Global (inglés)','Globale (anglais)','Global (Englisch)','Globale (inglese)','โกลบอล (อังกฤษ)'),L('일본판','Japanese','日本版','日本版','Japonesa','Japonaise','Japanisch','Giapponese','ญี่ปุ่น'),L('대만판','Taiwanese','台湾版','台灣版','Taiwanesa','Taïwanaise','Taiwanisch','Taiwanese','ไต้หวัน')])];
      source=how===0?await fromTransferCodes(cc,hello):how===1?await fromFile(cc):how===2?await fromAdb(cc):await fromBackup(cc);
      const save=engine.parse(source.raw,cc),version=engine.versionText(save.gameVersion);
      say(L(`SAVE 버전 ${version} (${save.cc.toUpperCase()})`,`SAVE version ${version} (${save.cc.toUpperCase()})`,`セーブのバージョン ${version} (${save.cc.toUpperCase()})`,`存檔版本 ${version} (${save.cc.toUpperCase()})`,`Versión de la partida ${version} (${save.cc.toUpperCase()})`,`Version de la sauvegarde ${version} (${save.cc.toUpperCase()})`,`Spielstandversion ${version} (${save.cc.toUpperCase()})`,`Versione del salvataggio ${version} (${save.cc.toUpperCase()})`,`เวอร์ชันเซฟ ${version} (${save.cc.toUpperCase()})`));
      if(save.cc!==cc)throw fail('REGION',L('선택한 지역과 SAVE 지역이 다릅니다.','The SAVE is from another region.','選んだ地域とセーブの地域が違います。','所選地區與存檔地區不同。','La partida es de otra región.','La sauvegarde vient d\'une autre région.','Der Spielstand stammt aus einer anderen Region.','Il salvataggio è di un\'altra regione.','เซฟนี้มาจากภูมิภาคอื่น'));
      if(source.restored){
        if(!(await yes(L('이 백업으로 복원할까요? (저장 1회 사용)','Restore this backup? (uses one SAVE)','このバックアップを復元しますか？(保存1回分を使います)','要還原此備份嗎？（會使用一次儲存次數）','¿Restaurar esta copia? (usa un guardado)','Restaurer cette sauvegarde ? (utilise une sauvegarde)','Diese Sicherung wiederherstellen? (verbraucht einen Speichervorgang)','Ripristinare questo backup? (usa un salvataggio)','กู้คืนไฟล์สำรองนี้ไหม (ใช้การบันทึก 1 ครั้ง)'))))continue;
        source.uploading=true;await saveAndUpload(config.token,source,[],null);continue;
      }
      startAccount(source);
      const gd=await gameData(config.token,cc,version,hello);
      const names=await namesFor(config.token,cc,hello);
      let chosen=null,kept=[],confirmed=false;
      for(;;){
        chosen=await editMenu(source,save,gd,hello,names,kept,config);
        if(!chosen)break;
        ownerLimitCheck(hello.limits,chosen.edits);
        say('');chosen.edits.forEach(e=>say(`  - ${chosen.describe(e)}`));
        // Backing out of this question goes back to the pending edits, which are kept.
        try{confirmed=await yes(L('이대로 저장할까요?','Save these changes?','この内容で保存しますか？','要儲存這些變更嗎？','¿Guardar estos cambios?','Enregistrer ces modifications ?','Diese Änderungen speichern?','Salvare queste modifiche?','บันทึกการเปลี่ยนแปลงเหล่านี้ไหม'));break;}
        catch(err){if(!isBack(err))throw err;kept=chosen.edits;}
      }
      if(!chosen||!confirmed){codesStillValid(source);continue;}
      source.uploading=true;await saveAndUpload(config.token,source,chosen.edits,gd,chosen.extended);
    }catch(err){
      if(isBack(err)){backed();codesStillValid(source);continue;}
      say(L(`\n오류: ${explain(err)}`,`\nError: ${explain(err)}`,`\nエラー: ${explain(err)}`,`\n錯誤: ${explain(err)}`,`\nError: ${explain(err)}`,`\nErreur : ${explain(err)}`,`\nFehler: ${explain(err)}`,`\nErrore: ${explain(err)}`,`\nข้อผิดพลาด: ${explain(err)}`));
      codesStillValid(source);
    }
  }
  rl.close();
}
if(require.main===module)main().catch(err=>{console.error(L(`오류: ${err.message}`,`Error: ${err.message}`,`エラー: ${err.message}`,`錯誤: ${err.message}`,`Error: ${err.message}`,`Erreur : ${err.message}`,`Fehler: ${err.message}`,`Errore: ${err.message}`,`ข้อผิดพลาด: ${err.message}`));process.exitCode=1;if(rl)rl.close();});
module.exports={main,ownerLimitCheck,pruneBackups,parseDirect,explain,CLIENT};
