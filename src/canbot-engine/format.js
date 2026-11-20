// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Battle Cats SAVE layout, in file order. Written for CanBot from the observed read order of SAVE files (field order,
// sizes and version conditions); the parts not described yet are kept as raw bytes in `rest`. Field names are ours.
const {T,list,struct,when}=require('./codec');
const {SaveReader,SaveWriter}=require('./binary');

const notJp=ctx=>!ctx.jp;
// A daylight-saving flag the game writes after some dates, outside JP from version 49 on.
const dst=name=>when(ctx=>!ctx.jp&&ctx.gv>=49,[name,T.bool]);

const header=[
  ['gameVersion',T.int],
  when(ctx=>ctx.gv>=10||notJp(ctx),['flag0',T.bool]),
  ['muteMusic',T.bool],
  ['muteSound',T.bool],
  ['catfood',T.int],
  ['energy',T.int],
  // The last-played date is stored twice per part (year, year, month, month, day, day).
  ['savedYear',T.int],['year',T.int],
  ['savedMonth',T.int],['month',T.int],
  ['savedDay',T.int],['day',T.int],
  ['timestamp',T.double],
  ['hour',T.int],['minute',T.int],['second',T.int],
  dst('dst0'),
  ['unknown1',T.int],
  ['stampValue',T.int],
  ['unknown2',T.int],
  ['upgradeState',T.int],
  ['xp',T.int],
  ['tutorialState',T.int],
  ['unknown3',T.int],
  ['koreaSuperiorTreasureState',T.int],
  ['unlockPopups11',list(T.int,3)],
  ['unknown5',T.int],
  ['enemyGuideUnlocked',T.int],
  ['unknown6',T.int],
  ['flag1',T.bool],
  ['unknown7',T.int],
  ['clearedEoc1',T.int],
  ['unknown8',T.int],
  ['endingUnlocked',T.int],
];

const upgrade=struct([['plus',T.ushort],['base',T.ushort]]);
const date=struct([['year',T.int],['month',T.int],['day',T.int],['hour',T.int],['minute',T.int],['second',T.int]]);
// Per-cat columns: each section stores its own count, but the number of entries always follows the unlocked list.
const catCount=(ctx,o)=>o.catsUnlocked.length;
const varintDict=(value)=>struct([['count',T.varint],['entries',list(struct([['key',T.varint],['value',value]]),(ctx,o)=>Number(o.count))]]);

const early=[
  // Lineups: a count byte, then 10 cat slots each.
  ['lineupCount',T.byte],
  ['lineups',list(list(T.int,10),(ctx,o)=>o.lineupCount)],
  ['stampCurrent',T.int],['stampCollected',list(T.int,30)],['stampUnknown',T.int],['stampDailyReward',T.int],
  // Story: 10 chapters; selected stage, progress, then 51 clear counts and 49 treasure levels per chapter.
  ['storySelected',list(T.int,10)],
  ['storyProgress',list(T.int,10)],
  ['storyClearTimes',list(list(T.int,51),10)],
  ['storyTreasure',list(list(T.int,49),10)],
  ['enemyGuide',list(T.int)],
  ['catsUnlocked',list(T.int)],
  ['catsUpgradeCount',T.int],['catsUpgrade',list(upgrade,catCount)],
  ['catsFormCount',T.int],['catsForm',list(T.int,catCount)],
  ['specialSkills',list(upgrade,11)],
  ['menuUnlocks',list(T.int)],
  ['unlockPopups0',list(T.int)],
  ['battleItems',list(T.int,6)],
  ['newDialogs2',list(T.int)],
  ['unknownList1',list(T.int,20)],
  ['monekoBonus',list(T.int,1)],
  ['dailyRewardInitialized',list(T.int,1)],
  ['battleItemsLockAll',T.bool],['battleItemsLocked',list(T.bool,6)],
  dst('dst1'),
  ['date2',date],
  // Treasure festival, 10 chapters each.
  ['treasureChanceTimeLeft',list(T.int,10)],['treasureChanceDuration',list(T.int,10)],['treasureChanceValue',list(T.int,10)],['treasureChanceStage',list(T.int,10)],['treasureFestivalType',list(T.int,10)],
  dst('dst2'),
  ['date3',date],
  ['stageUnlockCatValue',T.int],
  ['showEndingValue',T.int],
  ['chapterClearCatUnlock',T.int],
  ['unknown9',T.int],
  ['iosAndroidMonth',T.int],
  ['unknown10',T.int],
  ['saveDataHash4',T.string],
  ['mySaleBonus',varintDict(T.varint)],
  ['mySaleFlags',varintDict(T.bool)],
  ['charaFlags',list(T.int,2)],
  ['charaFlags2',list(T.int,2)],
  ['normalTickets',T.int],
  ['rareTickets',T.int],
  ['catsSeenCount',T.int],['catsSeen',list(T.int,catCount)],
  ['specialSkillsSeen',list(T.int,10)],
  // Cat storage: a count, then the item ids, then the item types.
  ['storageCount',T.short],['storageIds',list(T.int,(ctx,o)=>o.storageCount)],['storageTypes',list(T.int,(ctx,o)=>o.storageCount)],
];

// Event stages (game version 8.1 and later): four sizes, then four blocks indexed [type][subchapter][star]:
// selected stage, clear progress, the clear count of each stage, and the unlock state.
// Stage clears are stored stage-major: [type][subchapter][stage][star] (every star of stage 0, then 1, ...).
const grid=(item,last)=>list(list(last?list(list(item,(c,o)=>o.stars),(c,o)=>o.stagesPer):list(item,(c,o)=>o.stars),(c,o)=>o.subchapters),(c,o)=>o.types);
const eventStages=struct([
  ['types',T.byte],['subchapters',T.short],['stars',T.byte],['stagesPer',T.byte],
  ['selected',grid(T.byte)],
  ['progress',grid(T.byte)],
  ['clears',grid(T.short,true)],
  ['unlock',grid(T.byte)],
]);

const middle=[
  ['eventStages',eventStages],
  ['itfEnding',T.int],
  ['continueFlag',T.int],
  ['unlockPopups8',list(T.int,36)],
  ['unitDrops',list(T.int)],
  ['rareSeed',T.uint],['normalSeed',T.uint],
];

// Account identity strings (transfer code, confirmation code, inquiry code, player id) live in this part. The engine
// keeps them like any other field; nothing in CanBot may log or print them.
const jpOnly=ctx=>ctx.jp;
const account=[
  ['getEventData',T.bool],
  ['achievements',list(T.bool,7)],
  ['osValue',T.int],
  dst('dst3'),
  ['date4',date],
  ['gachaFlags',struct([['a',T.int],['b',T.int],['c',T.int],['d',T.int],['e',T.int],['f',T.bool],['g',T.bool],['h',T.bool]])],
  when(notJp,['playerId',T.string]),
  ['orderIds',list(T.string)],
  when(notJp,['gTimestamp',T.double]),
  when(notJp,['gServerTimestamp',T.double]),
  when(notJp,['mGetTimeSave',T.double]),
  when(notJp,['unknownStrings1',list(T.string)]),
  when(notJp,['energyNotification',T.bool]),
  when(notJp,['fullGameVersion',T.int]),
  ['selectedLineup',T.int],
  ['unlockedLineups',T.byte],
  // Legend restrictions: two stored sizes, but one value per event [type][subchapter] read above.
  ['legendRestrictionTypes',T.int],['legendRestrictionSubchapters',T.int],
  ['legendRestrictions',list(list(T.int,(c,o)=>o.eventStages.subchapters),(c,o)=>o.eventStages.types)],
  ['gTimestamp2',T.double],['gServerTimestamp2',T.double],['mGetTimeSave2',T.double],['unknownTimestamp',T.double],
  ['gachaTradeProgress',T.int],
  when(notJp,['mGetTimeSave2b',T.double]),
  when(jpOnly,['unknown11',T.int]),
  ['catsMaxUpgradeCount',T.int],['catsMaxUpgrade',list(upgrade,catCount)],
  ['specialSkillsMaxUpgrade',list(upgrade,11)],
  ['userRankRewards',list(T.bool)],
  when(jpOnly,['mGetTimeSave2b',T.double]),
  ['catsUnlockedFormsCount',T.int],['catsUnlockedForms',list(T.int,catCount)],
  ['transferCode',T.string],
  ['confirmationCode',T.string],
  ['transferFlag',T.bool],
  // Item reward stages [subchapter][star][stage] and timed scores, each with three stored sizes.
  ['itemRewardSubchapters',T.int],['itemRewardStages',T.int],['itemRewardStars',T.int],
  ['itemReward',list(list(list(T.bool,(c,o)=>o.itemRewardStages),(c,o)=>o.itemRewardStars),(c,o)=>o.itemRewardSubchapters)],
  ['timedScoreSubchapters',T.int],['timedScoreStages',T.int],['timedScoreStars',T.int],
  ['timedScore',list(list(list(T.int,(c,o)=>o.timedScoreStages),(c,o)=>o.timedScoreStars),(c,o)=>o.timedScoreSubchapters)],
  ['inquiryCode',T.string],
  ['officerPassPlayTime',T.int],
  ['hasAccount',T.byte],
  ['backupState',T.int],
  when(notJp,['flag2',T.bool]),
  ['marker44',T.int],
  ['itf1Complete',T.int],
  ['itfTimedScores',list(T.int,153)],
  ['titleChapterBg',T.int],
  ['comboUnlocks',list(T.int)],
  ['comboUnlocked10kUr',T.bool],
  ['marker45',T.int],
  ['marker46',T.int],
  ['eventSeed',T.uint],
  ['eventCapsules',list(T.int)],
  ['eventCapsulesCounter',list(T.int)],
  ['marker47',T.int],
  ['marker48',T.int],
  when(jpOnly,['energyNotification',T.bool]),
  ['mGetTimeSave3',T.double],
  ['gachaSeenLuckyDrops',list(T.int)],
  ['showBanMessage',T.bool],
  ['catfoodBeginnerPurchased',list(T.bool,3)],
  ['nextWeekTimestamp',T.double],
  ['catfoodBeginnerExpired',list(T.bool,3)],
  ['rankUpSaleValue',T.int],
  ['marker49',T.int],
  ['marker50',T.int],
  ['marker51',T.int],
  ['catGuideCollectedCount',T.int],['catGuideCollected',list(T.bool,catCount)],
  ['marker52',T.int],
];

const {dict}=require('./codec');
const intInt=dict(T.int,T.int),intBool=dict(T.int,T.bool),intDouble=dict(T.int,T.double);
// Shared "chapters" block (tower, challenge, ...): four blocks, each with its own stored sizes; the loops follow the
// first sizes, and the stage block uses the stage count of the third. Stage clears are stored [chapter][stage][star].
const chapters=struct([
  ['chapters1',T.int],['stars1',T.int],
  ['selected',list(list(T.int,(c,o)=>o.stars1),(c,o)=>o.chapters1)],
  ['chapters2',T.int],['stars2',T.int],
  ['progress',list(list(T.int,(c,o)=>o.stars1),(c,o)=>o.chapters1)],
  ['chapters3',T.int],['stages3',T.int],['stars3',T.int],
  ['clears',list(list(list(T.int,(c,o)=>o.stars1),(c,o)=>o.stages3),(c,o)=>o.chapters1)],
  ['chapters4',T.int],['stars4',T.int],
  ['unlock',list(list(T.int,(c,o)=>o.stars1),(c,o)=>o.chapters1)],
]);
// Ototo cannons: per cannon a level count n, the development stage, then n - 1 levels.
const cannon=struct([['levelCount',T.int],['development',T.int],['levels',list(T.int,(c,o)=>Math.max(0,o.levelCount-1))]]);
const outbreakChapters=dict(T.int,dict(T.int,T.bool));

const progress=[
  ['timeSinceCheckCumulative',T.double],
  ['serverTimestamp',T.double],
  ['lastEnergyRecoveryCheck',T.double],
  ['timeSinceCheck',T.double],
  ['lastExpeditionCheck',T.double],
  ['catfruit',list(T.int)],
  ['catsFourthForm',list(T.int)],
  ['catsCatseyesUsed',list(T.int)],
  ['catseyes',list(T.int)],
  ['catamins',list(T.int)],
  ['gamatoto',struct([['remainingSeconds',T.double],['returnFlag',T.bool],['xp',T.int],['destination',T.int],['reconLength',T.int],['unknown',T.int],['notifyValue',T.int]])],
  ['unlockPopups6',list(T.bool)],
  ['exStages',list(list(T.int,12))],
  ['marker53',T.int],
  ['gamatotoHelpers',list(T.int)],
  ['gamatotoAdPresent',T.bool],
  ['marker54a',T.int],
  ['itemPackPurchases',dict(T.int,dict(T.string,T.bool))],
  ['marker54b',T.int],
  ['gamatotoSkin',T.int],
  ['platinumTickets',T.int],
  ['logins',intInt],
  ['rewardRemainingTime',T.double],
  ['lastRewardCheck',T.double],
  ['announcements',list(struct([['a',T.int],['b',T.int]]),16)],
  ['backupCounter',T.int],
  ['unknown12',T.int],['unknown13',T.int],['unknown14',T.int],
  ['marker55',T.int],
  ['flag3',T.bool],
  ['itemObtains',dict(T.int,intBool)],
  ['unobtainedItems',intBool],
  ['stepUpStages',intInt],
  ['stepUpDurations',intDouble],
  ['backupFrame',T.int],
  ['marker56',T.int],
  ['flag4',T.bool],
  ['catsFavorites',intBool],
  ['marker57',T.int],
  ['dojoChapters',dict(T.int,intInt)],
  ['dojoItemLockAll',T.bool],['dojoItemLocks',list(T.bool,6)],
  ['marker58',T.int],
  ['lastZombieCheck',T.double],
  ['outbreaks',outbreakChapters],
  ['zombieEventRemaining',T.double],
  ['schemeToObtain',list(T.int)],['schemeReceived',list(T.int)],
  ['currentOutbreaks',outbreakChapters],
  ['firstLocks',intBool],
  ['energyPenaltyTimestamp',T.double],
  ['marker60',T.int],
  ['catsNewFlags',intInt],
  ['shownMaxCollabMessage',T.bool],
  ['itemPackDisplayed',intBool],
  ['marker61',T.int],
  ['unlockPopups',intBool],
  ['marker63',T.int],
  ['ototoMaterials',list(T.int)],
  ['ototoRemainingSeconds',T.double],['ototoReturnFlag',T.bool],['ototoImproveId',T.int],['ototoEngineers',T.int],
  ['ototoCannons',dict(T.int,cannon)],
  ['ototoSelectedPartsCount',T.byte],['ototoSelectedParts',list(list(T.byte,3),(c,o)=>o.ototoSelectedPartsCount)],
  ['lastCastleCheck',T.double],
  ['marker64',T.int],
  ['beaconInts',intInt],['beaconStrings',dict(T.int,list(T.string))],['beaconBools',intBool],
  ['marker65',T.int],
  ['tower',chapters],
  ['missions',struct([['clearStates',intInt],['requirements',intInt],['progressTypes',intInt],['gamatotoValues',intInt],['nyancomboValues',intInt],['userRankValues',intInt],['expiryValues',intInt],['preparingValues',intInt]])],
  ['towerItemObtainStars',T.int],['towerItemObtainStages',T.int],
  ['towerItemObtain',list(list(T.bool,(c,o)=>o.towerItemObtainStages),(c,o)=>o.towerItemObtainStars)],
  ['marker66',T.int],
  ['dojoRanking',struct([['score',T.int],['ranking',T.int],['submitted',T.bool],['completed',T.bool],['seenResults',T.bool],['startDate',T.int],['endDate',T.int],['eventNumber',T.int],['showRankDescription',T.bool],['showStartMessage',T.bool],['submitError',T.bool],when(ctx=>ctx.gv>=140500,['other',T.string])])],
  ['itemPackThreeDaysStarted',T.bool],['itemPackThreeDaysEnd',T.double],
  ['challenge',chapters],
  ['challengeScores',list(T.int)],
  ['challengePopupShown',T.bool],
  ['marker67',T.int],
  ['weeklyMissions',intBool],
  ['dojoDidWinRewards',T.bool],
  ['eventUpdateFlags',T.bool],
  ['marker68',T.int],
  ['eventCompletionCount',intInt],['eventClearedLimitText',intBool],['eventStartDates',intInt],['eventRewardClaimed',list(T.int)],
  ['cotc1Complete',T.int],
  ['marker69',T.int],
  ['gamatotoCollabFlags',intBool],['gamatotoCollabDurations',intDouble],
];

// Chapters with their sizes stored once (Uncanny, Catamin stages), followed by one extra int per chapter.
const chaptersOnce=struct([
  ['chapters',T.int],['stages',T.int],['stars',T.int],
  ['selected',list(list(T.int,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['progress',list(list(T.int,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['clears',list(list(list(T.int,(c,o)=>o.stars),(c,o)=>o.stages),(c,o)=>o.chapters)],
  ['unlock',list(list(T.int,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['extra',list(T.int,(c,o)=>o.chapters)],
]);
// Legend Quest: byte sizes; clears then tries, each [chapter][stage][star] as shorts.
const legendQuest=struct([
  ['chapters',T.byte],['stages',T.byte],['stars',T.byte],
  ['selected',list(list(T.byte,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['progress',list(list(T.byte,(c,o)=>o.stars),(c,o)=>o.chapters)],
  // Per chapter: all clears, then all tries. The sizes come from the Legend Quest object (the list passes it on).
  ['stagesData',list({
    read(r,ctx,lq){const grid=()=>list(list(T.short,lq.stars),lq.stages).read(r,ctx,lq);return {clears:grid(),tries:grid()};},
    write(w,v,ctx,lq){const g=list(list(T.short,lq.stars),lq.stages);g.write(w,v.clears,ctx,lq);g.write(w,v.tries,ctx,lq);},
  },(c,o)=>o.chapters)],
  ['unlock',list(list(T.byte,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['unknown',list(T.byte,(c,o)=>o.chapters)],
  ['ids',list(T.int,(c,o)=>o.stages)],
]);
// Lists whose count is a short or a byte; the count is kept as read ({n, items}).
const counted=kind=>(item)=>({item,countKind:kind,read(r,ctx,p){const n=r[kind]();const out=new Array(Math.max(0,n));for(let i=0;i<n;i++)out[i]=item.read(r,ctx,p);return {n,items:out};},write(w,v,ctx,p){w[kind](v.n);for(const x of v.items)item.write(w,x,ctx,p);}});
const shortCount=counted('short'),byteCount=counted('byte');
// Gauntlet-style chapters: short/byte/byte sizes stored once; byte selected/progress/unlock, short clears
// [chapter][stage][star], then one byte per chapter.
const gauntlet=()=>struct([
  ['chapters',T.short],['stages',T.byte],['stars',T.byte],
  ['selected',list(list(T.byte,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['progress',list(list(T.byte,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['clears',list(list(list(T.short,(c,o)=>o.stars),(c,o)=>o.stages),(c,o)=>o.chapters)],
  ['unlock',list(list(T.byte,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['unknown',list(T.byte,(c,o)=>o.chapters)],
]);
const enigmaStage=struct([['level',T.int],['stageId',T.int],['decoding',T.byte],['startTime',T.double]]);

const later=[
  ['marker71',T.int],
  ['uncanny',chaptersOnce],
  ['marker76',T.int],
  ['cataminStages',chaptersOnce],
  ['luckyTickets',list(T.int)],
  ['flag5',T.bool],
  ['marker77',T.int],
  ['goldPass',struct([['officerId',T.int],['renewals',T.int],['startNow',T.double],['endNow',T.double],['startNext',T.double],['endNext',T.double],['startTotal',T.double],['endTotal',T.double],['timeErrorEnd',T.double],['stateUpdates',T.int],['loginBonusDate',T.double],['claimedRewards',intInt],['remainingDaysPopup',T.double],['firstPopup',T.bool],when(ctx=>ctx.gv>=80100,['badge',T.bool])])],
  ['talents',list(struct([['catId',T.int],['talents',list(struct([['id',T.int],['level',T.int]]))]]))],
  ['np',T.int],
  ['flag6',T.bool],
  ['marker80000',T.int],
  ['flag7',T.bool],
  ['leadership',T.short],
  ['officerCatId',T.short],['officerCatForm',T.short],
  ['marker80200',T.int],
  ['filibusterStage',T.byte],['filibusterEnabled',T.bool],
  ['marker80300',T.int],
  ['stageIds10s',list(T.int)],
  ['marker80500',T.int],
  ['unknownList6',shortCount(T.int)],
  ['legendQuest',legendQuest],
  ['unknownShort1',T.short],
  ['unknownByte1',T.byte],
  ['marker80600',T.int],
  ['unknownIntLists',dict(T.int,list(T.int))],
  ['marker80700',T.int],
  when(ctx=>ctx.gv>=100600&&ctx.cc==='en',['enByte',T.byte]),
  when(ctx=>ctx.gv>=100600&&ctx.cc==='en',['marker100600',T.int]),
  ['restartPack',T.byte],
  ['marker81000',T.int],
  ['medals',struct([['u1',T.int],['u2',T.int],['u3',T.int],['list1',shortCount(T.short)],['list2',shortCount(struct([['key',T.short],['value',T.byte]]))],['flag',T.bool]])],
  ['wildcatCompleted',shortCount(struct([['key',T.short],['value',T.bool]]))],
  ['wildcatValues',shortCount(struct([['key',T.short],['values',shortCount(struct([['key',T.short],['value',T.short]]))]]))],
  ['wildcatStartTimes',shortCount(struct([['key',T.short],['value',T.int]]))],
  ['marker90000',T.int],
  ['unknownShort2',T.short],['unknownShort3',T.short],['unknown15',T.int],['unknownDouble1',T.double],
  ['marker90100',T.int],
  ['unknownTuples',shortCount(struct([['a',T.int],['b',T.int],['c',T.short],['d',T.int],['e',T.int],['f',T.int],['g',T.short]]))],
  ['unknownIntDoubles',shortCount(struct([['key',T.int],['value',T.double]]))],
  ['gauntlets',gauntlet()],
  ['marker90300',T.int],
  ['enigmaClears',gauntlet()],
  ['enigma',struct([['energySince1',T.int],['energySince2',T.int],['level',T.byte],['unknown1',T.byte],['unknown2',T.bool],['stages',byteCount(enigmaStage)],when(ctx=>ctx.gv>=140500,['hasExtra',T.bool]),when((ctx,o)=>ctx.gv>=140500&&o.hasExtra,['extra',enigmaStage])])],
  // Cleared lineups per stage; the last table's values are kept as raw bytes (JP 16.0.3 stores 2 there).
  ['clearedSlotsCats',shortCount(struct([['index',T.short],['cats',list(struct([['catId',T.short],['form',T.byte]]),10)],['u1',T.byte],['u2',T.byte],['u3',T.byte]]))],
  ['clearedStageSlots',shortCount(struct([['index',T.short],['stages',shortCount(T.int)]]))],
  ['clearedSlotsUnknown',shortCount(struct([['key',T.short],['value',T.bool]]))],
  ['marker90400',T.int],
  ['collabGauntlets',gauntlet()],
  ['flag8',T.bool],['unknownDouble2',T.double],['unknownDouble3',T.double],['unknown16',T.int],
  when(ctx=>ctx.gv>=100300,['unknownByte3',T.byte]),when(ctx=>ctx.gv>=100300,['flag9',T.bool]),when(ctx=>ctx.gv>=100300,['unknownDouble4',T.double]),when(ctx=>ctx.gv>=100300,['unknownDouble5',T.double]),
  when(ctx=>ctx.gv>=130700,['unknownIntBytes',shortCount(struct([['key',T.int],['value',T.byte]]))]),
  when(ctx=>ctx.gv>=130700,['unknownIntDoubles2',shortCount(struct([['key',T.int],['value',T.double]]))]),
  when(ctx=>ctx.gv>=140100,['unknownIntDoubles3',shortCount(struct([['key',T.int],['value',T.double]]))]),
  ['marker90500',T.int],
  ['talentOrbs',shortCount(struct([['id',T.short],['value',{read:(r,ctx)=>ctx.gv<110400?r.byte():r.short(),write:(w,v,ctx)=>ctx.gv<110400?w.byte(v):w.short(v)}]]))],
  ['unknownNested',shortCount(struct([['key',T.short],['values',byteCount(struct([['key',T.byte],['value',T.short]]))]]))],
  ['flag10',T.bool],
  ['marker90700',T.int],
  ['unknownList7',shortCount(T.int)],
  ['unknownBools2',list(T.bool,10)],
  ['marker90800',T.int],
  ['catShrine',struct([['unknown',T.bool],['stamp1',T.double],['stamp2',T.double],['gone',T.bool],['flags',byteCount(T.byte)],['xpOffering',T.long]])],
  ['unknownDouble6',T.double],['unknownDouble7',T.double],
  ['marker90900',T.int],
  // Lineup names (byte count from 11.6 on, 15 before).
  ['lineupNames',{read:(r,ctx)=>{const n=ctx.gv>=110600?r.byte():15;const items=[];for(let i=0;i<n;i++)items.push(r.string());return {n,items};},write:(w,v,ctx)=>{if(ctx.gv>=110600)w.byte(v.n);for(const s of v.items)w.string(s);}}],
  ['marker91000',T.int],
  ['legendTickets',T.int],
  ['unknownBytePairs',byteCount(struct([['a',T.byte],['b',T.int]]))],
  ['flag11',T.bool],['flag12',T.bool],
  // The account's password refresh token: kept like any field, never logged.
  ['passwordRefreshToken',T.string],
  ['flag13',T.bool],['unknownByte4',T.byte],['unknownByte5',T.byte],['unknownDouble8',T.double],['unknownDouble9',T.double],
  ['marker100000',T.int],
];

const gv=n=>ctx=>ctx.gv>=n;
// Aku realm: short/byte/byte sizes; current stage bytes [chapter][star]; clears shorts [chapter][star][stage].
const aku=struct([
  ['chapters',T.short],['stages',T.byte],['stars',T.byte],
  ['current',list(list(T.byte,(c,o)=>o.stars),(c,o)=>o.chapters)],
  ['clears',list(list(list(T.short,(c,o)=>o.stages),(c,o)=>o.stars),(c,o)=>o.chapters)],
]);
// Zero Legends (and the 14.0 dojo chapters): per chapter an unknown byte and a byte star count; per star selected,
// progress and unlock bytes plus a short count of stage clears.
const zeroLegends=shortCount(struct([['unknown',T.byte],['stars',byteCount(struct([['selected',T.byte],['progress',T.byte],['unlock',T.byte],['clears',shortCount(T.short)]]))]]));

const recent=[
  when(gv(100100),['dateInt',T.int]),when(gv(100100),['marker100100',T.int]),
  when(gv(100300),['endlessItems',list(struct([['a',T.bool],['b',T.bool],['c',T.byte],['d',T.double],['e',T.double]]),6)]),when(gv(100300),['marker100300',T.int]),
  when(gv(100400),['eventCapsules2',byteCount(T.int)]),when(gv(100400),['twoBattleLines',T.bool]),when(gv(100400),['marker100400',T.int]),
  when(gv(100600),['unknownDouble10',T.double]),when(gv(100600),['platinumShards',T.int]),when(gv(100600),['flag15',T.bool]),when(gv(100600),['marker100600b',T.int]),
  when(gv(100700),['catScratcherCompleted',shortCount(struct([['key',T.short],['value',T.bool]]))]),
  when(gv(100700),['catScratcherValues',shortCount(struct([['key',T.short],['values',shortCount(struct([['key',T.short],['value',T.short]]))]]))]),
  when(gv(100700),['catScratcherStartTimes',shortCount(struct([['key',T.short],['value',T.int]]))]),
  when(gv(100700),['marker100700',T.int]),
  when(gv(100900),['aku',aku]),when(gv(100900),['flag16',T.bool]),when(gv(100900),['flag17',T.bool]),
  when(gv(100900),['unknownShortLists',shortCount(struct([['key',T.short],['values',shortCount(T.short)]]))]),
  when(gv(100900),['unknownShortDoubles',shortCount(struct([['key',T.short],['value',T.double]]))]),
  when(gv(100900),['unknownShortDoubles2',shortCount(struct([['key',T.short],['value',T.double]]))]),
  when(gv(100900),['flag18',T.bool]),when(gv(100900),['marker100900',T.int]),
  when(gv(101000),['unknownByte6',T.byte]),when(gv(101000),['marker101000',T.int]),
  when(gv(110000),['unknownIntBytePairs',shortCount(struct([['key',T.int],['a',T.byte],['b',T.byte]]))]),when(gv(110000),['marker110000',T.int]),
  when(gv(110500),['behemothCulling',gauntlet()]),when(gv(110500),['flag19',T.bool]),when(gv(110500),['marker110500',T.int]),
  when(gv(110600),['flag20',T.bool]),when(gv(110600),['marker110600',T.int]),
  when(gv(110700),['unknownIntDoublePairs',list(struct([['key',T.int],['a',T.double],['b',T.double]]))]),
  when(ctx=>ctx.gv>=110700&&!ctx.jp,['flag20b',T.bool]),
  when(gv(110700),['marker110700',T.int]),
  when(gv(110800),['shrineDialogs',T.int]),when(gv(110800),['flag21',T.bool]),when(gv(110800),['dojo3xSpeed',T.bool]),when(gv(110800),['flag22',T.bool]),when(gv(110800),['flag23',T.bool]),when(gv(110800),['marker110800',T.int]),
  when(gv(111000),['labyrinth',struct([
    ['ui17',T.int],['ush4',T.short],['uby7',T.byte],['uby8',T.byte],['ub24',T.bool],['uby9',T.byte],
    ['shorts1',byteCount(T.short)],['shorts2',shortCount(T.short)],['shorts3',shortCount(T.short)],
    ['ui18',T.int],['ui19',T.int],['ui20',T.int],['ush5',T.short],['ush6',T.short],['ush7',T.short],['ush8',T.short],
    ['uby10',T.byte],['ub25',T.bool],['ub26',T.bool],['ub27',T.bool],['ub28',T.bool],['ub29',T.bool],['ub30',T.bool],['uby11',T.byte],
    ['shorts4',shortCount(T.short)],['bools3',list(T.bool,14)],['medals',byteCount(T.short)],
  ])]),
  when(gv(111000),['marker111000',T.int]),
  when(gv(120000),['zeroLegends',zeroLegends]),when(gv(120000),['unknownByte12',T.byte]),when(gv(120000),['marker120000',T.int]),
  when(gv(120100),['shorts6',shortCount(T.short)]),when(gv(120100),['marker120100',T.int]),
  when(gv(120200),['flag31',T.bool]),when(gv(120200),['unknownShort9',T.short]),when(gv(120200),['unknownShortShorts',byteCount(struct([['key',T.short],['value',T.short]]))]),when(gv(120200),['marker120200',T.int]),
  when(gv(120400),['unknownDouble11',T.double]),when(gv(120400),['unknownDouble12',T.double]),when(gv(120400),['marker120400',T.int]),
  when(gv(120500),['flag32',T.bool]),when(gv(120500),['flag33',T.bool]),when(gv(120500),['flag34',T.bool]),when(gv(120500),['unknown21',T.int]),when(gv(120500),['goldenCpuCount',T.byte]),when(gv(120500),['marker120500',T.int]),
  when(gv(120600),['soundEffectsVolume',T.byte]),when(gv(120600),['musicVolume',T.byte]),when(gv(120600),['marker120600',T.int]),
  when(ctx=>(!ctx.jp&&ctx.gv>=120700)||(ctx.jp&&ctx.gv>=130000),['stringPairs',byteCount(struct([['a',T.string],['b',T.string]]))]),
  when(ctx=>(!ctx.jp&&ctx.gv>=120700)||(ctx.jp&&ctx.gv>=130000),['marker120700',T.int]),
  when(gv(130100),['intLongs',list(struct([['a',T.int],['b',T.long]]))]),when(gv(130100),['marker130100',T.int]),
  when(gv(130301),['stringIntDoubles',list(struct([['key',T.string],['a',T.int],['b',T.double]]))]),when(gv(130301),['marker130301',T.int]),
  when(gv(130400),['unknownDouble13',T.double]),when(gv(130400),['unknownDouble14',T.double]),when(gv(130400),['marker130400',T.int]),
  when(gv(130500),['nested130500',shortCount(struct([['id',T.byte],['entries',byteCount(struct([['a',T.byte],['b',T.byte],['c',T.byte],['values',shortCount(T.short)]]))]]))]),when(gv(130500),['marker130500',T.int]),
  when(gv(130600),['unknownByte14',T.byte]),when(ctx=>ctx.gv>=130600&&!ctx.jp,['unknownShort12',T.short]),when(gv(130600),['marker130600',T.int]),
  when(ctx=>ctx.gv>=130700&&ctx.jp,['unknownShort12',T.short]),
  when(gv(130700),['block130700',struct([['ud15',T.double],['uby15',T.byte],['uby16',T.byte],['ush11',T.short],['uby17',T.byte],['uby18',T.byte],['uby19',T.byte],['ud16',T.double],
    ['entries',shortCount(struct([['key',T.short],['value',T.short],['value2',T.int],['map',shortCount(struct([['key',T.short],['value',T.short]]))]]))]])]),
  when(gv(130700),['marker130700',T.int]),
  when(gv(140000),['block140000',struct([['ui22',T.int],['ud17',T.double],['uby20',T.byte],
    ['byteLists',byteCount(struct([['key',T.int],['values',byteCount(T.byte)]]))],
    ['dojoChapters',zeroLegends],['ints9',shortCount(T.int)],['ub35',T.bool],['ud18',T.double],
    ['shortBytes',shortCount(struct([['key',T.short],['value',T.byte]]))]])]),
  when(gv(140000),['marker140000',T.int]),
  when(ctx=>ctx.gv>=140100&&ctx.gv<140500,['unknownByte21',T.byte]),when(ctx=>ctx.gv>=140100&&ctx.gv<140500,['marker140100',T.int]),
  when(gv(140200),['entries140200',byteCount(struct([['v1',T.int],['v2',T.int],['v3',T.bool],['v4',T.bool],['v5',T.bool],['v6',T.int],['v7',T.int],['v8',T.int],['v9',T.bool],['v10',T.bool],['v11',T.bool],when(gv(140500),['v12',T.string]),['v13',T.bool]]))]),
  when(gv(140200),['intDoubles140200',byteCount(struct([['key',T.int],['value',T.double]]))]),
  when(gv(140200),['hundredMillionTicket',T.int]),when(gv(140200),['marker140200',T.int]),
  when(gv(140300),['bytes11',byteCount(T.byte)]),
  when(gv(150300),['ui24',T.int]),when(gv(150300),['ub38',T.bool]),
  when(gv(150500),['ub39',T.bool]),
  when(gv(140300),['ub36',T.bool]),
  when(gv(140300),['treasureChests',byteCount(T.int)]),
  when(gv(140300),['ui23',T.int]),
  when(gv(140300),['ints13',shortCount(T.int)]),
  when(gv(140300),['ub37',T.bool]),
  when(gv(140300),['marker140300',T.int]),
];

// ---- After the 14.3 block (the rest is kept as raw bytes) --------------------------------------------------
// Worked out by CanBot from SAVE data alone. Each later game version closed its new data with its version number as
// an int (140500, 140700, 150000 ... 150700), so the tail is split at those markers first; a section is then decoded
// with the layout below only when the layout uses exactly the bytes up to its marker, otherwise it stays raw. Writing
// is byte-exact either way. Fields whose meaning is not known yet are fixed-size `unknown` byte runs.
const bytesN=n=>({read:r=>r.bytes(n),write:(w,v)=>{if(v.length!==n)throw Object.assign(new Error(`Needs ${n} bytes`),{code:'SAVE_FORMAT_ERROR'});w.bytes(v);}});
const TAIL=[
  [140500,struct([['unknown',bytesN(10)]])],
  [140700,struct([['unknown',bytesN(19)]])],
  [150000,struct([['value',T.int]])],
  // A short count of 16-byte entries: an id (1128, 1158 ... seen), a value, then 8 bytes; then 14 bytes.
  [150100,struct([['entries',shortCount(struct([['id',T.int],['value',T.int],['extra',T.double]]))],['a',T.int],['b',T.int],['c',T.int],['d',T.byte],['e',T.byte]])],
  [150200,struct([['a',T.int],['b',T.int],['unknown',bytesN(14)]])],
  [150300,struct([['flag',T.bool]])],
  // Two flags, three unknown bytes, a timestamp in seconds, a flag.
  [150400,struct([['flag1',T.bool],['flag2',T.bool],['unknown',bytesN(3)],['timestamp',T.double],['flag3',T.bool]])],
  // A double, a flag, two bytes, then a counted list of groups (12 shorts and a byte each seen), then 18 bytes.
  [150600,struct([['a',T.double],['flag',T.bool],['unknown1',bytesN(2)],['groups',list(struct([['values',list(T.short)],['flag',T.byte]]))],['unknown2',bytesN(18)]])],
  [150700,struct([['a',T.int],['b',T.int],['c',T.double],when(ctx=>ctx.jp,['jpUnknown',bytesN(5)])])],
];
function findMarker(r,value){for(let i=r.p;i+4<=r.end;i++)if(r.b.readInt32LE(i)===value)return i;return -1;}
const tail={
  read(r,ctx){
    const sections=[];
    for(const [marker,layout] of TAIL){
      if(ctx.gv<marker)break;const at=findMarker(r,marker);if(at<0)break;
      const raw=r.bytes(at-r.p);r.int();
      let fields=null;try{const sub=new SaveReader(raw);const v=layout.read(sub,ctx);if(sub.p===raw.length)fields=v;}catch{}
      sections.push(fields?{marker,fields}:{marker,raw});
    }
    return {sections,rest:r.bytes(r.remaining)};
  },
  write(w,v,ctx){
    for(const s of v.sections){
      if(s.fields){const sub=new SaveWriter();TAIL.find(([m])=>m===s.marker)[1].write(sub,s.fields,ctx);w.bytes(sub.toBuffer());}else w.bytes(s.raw);
      w.int(s.marker);
    }
    w.bytes(v.rest);
  },
};

const save=struct([...header,...early,...middle,...account,...progress,...later,...recent,['tail',tail]]);
module.exports={save,sections:{header,early,middle,account,progress,later,recent},TAIL,tail};
