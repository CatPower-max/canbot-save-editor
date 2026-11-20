// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Korean names of editor features for the admin AI log ("AI가 이해한 것"): the actual feature each proposed or applied
// edit uses, instead of internal names such as "edit" or "cat:unlock". Same wording as the web editor.
const ITEMS={catfood:'통조림',xp:'XP',normal_tickets:'냥코 티켓',rare_tickets:'레어 티켓',platinum_tickets:'플래티넘 티켓',legend_tickets:'레전드 티켓',platinum_shards:'플래티넘 조각',np:'NP',leadership:'리더십'};
const CAT={unlock:'획득',remove:'삭제',set_level:'레벨 설정',max_upgrade:'최대 강화',max_base_plus:'기본+플러스 최대',upgrade_by:'레벨 올리기',true_form:'3형태',fourth_form:'4형태',remove_true_form:'3형태 해제',remove_fourth_form:'4형태 해제',max_talents:'본능 최대',remove_talents:'본능 제거',cat_guide:'도감 등록',remove_cat_guide:'도감 제거',storage_add:'저장고 추가'};
const STORY={story_clear:'스토리 클리어',treasures:'보물',outbreaks:'좀비 스테이지',timed_scores:'타임 스코어'};
const INVENTORY={catfruit:'개다래 열매·씨앗',catamins:'고양이 드링크',catseyes:'캣츠아이',base_materials:'성 재료',battle_items:'배틀 아이템',treasure_chests:'보물상자',labyrinth_medals:'미궁 훈장'};
const MAPS={sol:'레전드 스토리',event:'이벤트 맵',collab:'콜라보 맵',uncanny:'신 레전드 스토리',catamin_stages:'캣츠아이 스테이지',towers:'냥코탑',gauntlets:'강습',collab_gauntlets:'콜라보 강습',behemoth_culling:'초수 토벌',clear_enigma_stages:'수수께끼 스테이지',legend_quest:'레전드 퀘스트',zero_legends:'제로 레전드',dojo_catclaw_championships:'냥코 도장 대회'};
const COLLECTIONS={skills:'특수능력',enigma:'수수께끼 스테이지',endless:'무한 배틀 아이템',storage_skills:'저장고 특수능력',rank_rewards:'유저랭크 보상',talent_orbs:'본능 구슬',scheme_items:'이벤트 해금 항목',event_tickets:'이벤트 티켓',enemy_guide:'적 캐릭터 도감',medals:'메달',missions:'미션',storage:'저장고'};
const EXPEDITION={xp:'가마토토 XP',level:'가마토토 레벨',helpers:'가마토토 대원',engineers:'오토토 대원',shrine_level:'고양이 신사 레벨',shrine_xp:'고양이 신사 XP',shrine_appear:'고양이 신사 표시',shrine_disappear:'고양이 신사 숨기기',cannon_levels:'대포 레벨',cannon_development:'대포 개발'};
const EXTRA={rare_trade:'레어 티켓 교환 준비',hundred_million:'1억 티켓',slots:'편성 슬롯',aku:'악마 스테이지',gold_add:'냥코클럽 골드 추가',gold_remove:'냥코클럽 골드 해제'};
const SIMPLE={fix_gamatoto_crash:'가마토토 오류 복구',fix_ototo_crash:'오토토 오류 복구',fix_time_errors:'시간 오류 복구',fix_officer_pass_crash:'냥코클럽 오류 복구',unlock_equip_menu:'장비 메뉴 해금',restart_pack:'리스타트 팩 설정',reset_gambling_events:'뽑기 이벤트 초기화',reset_golden_cat_cpus:'황금 고양이 CPU 초기화',unlock_aku_realm:'악마 영역 해금',filibuster_reclearing:'필리버스터 재클리어'};
const TYPES={max_all:'모든 아이템 최대',max_account:'계정 최대화',special_skills:'특수능력 최대',clear_to_japan:'일본까지 클리어',playtime:'플레이 시간',gacha_seed:'가챠 시드',score:'점수'};
const ACTIONS={max_items:'모든 아이템 최대',max_cats:'모든 고양이 최대 강화',unlock_cats:'모든 고양이 획득',max_talents:'모든 고양이 본능 최대',true_form_cats:'모든 고양이 3형태',fourth_form_cats:'모든 고양이 4형태',max_special_skills:'특수능력 전체 최대',max_account:'계정 최대화'};

const value=v=>v==='MAX'?'최대':String(v);
// Who a cat edit targets, without names or IDs: "전체", "3마리".
function catTarget(t){if(!t)return '';if(t.mode==='all')return ' (전체)';const n=(t.ids?.length||0)+(t.names?.length||0);return n?` (${n}마리)`:'';}
function editorEdit(e){
  if(!e||typeof e!=='object')return '편집';
  if(e.type==='cat')return `고양이 · ${CAT[e.operation]||e.operation||'작업'}${catTarget(e.target)}`;
  if(STORY[e.type])return `스토리 · ${STORY[e.type]}`;
  if(e.type==='inventory')return `아이템 · ${INVENTORY[e.inventory]||e.inventory||'인벤토리'}`;
  if(e.type==='map'||e.type==='map_batch')return `스테이지 · ${MAPS[e.category]||e.category||'맵'}`;
  if(e.type==='collection')return `수집 · ${COLLECTIONS[e.collection]||e.collection||'항목'}`;
  if(e.type==='expedition')return `가마토토·오토토 · ${EXPEDITION[e.operation]||e.operation||'작업'}`;
  if(e.type==='extra')return `기타 · ${EXTRA[e.operation]||e.operation||'작업'}`;
  if(e.type==='simple')return `복구 · ${SIMPLE[e.action]||SIMPLE[e.operation]||e.action||'작업'}`;
  if(e.type==='item')return `${ITEMS[e.item]||e.item}=${value(e.value)}`;
  return TYPES[e.type]||e.type||'편집';
}
function describeEdit(edit){
  if(!edit||typeof edit!=='object')return '편집';
  if(edit.action==='set_item')return `${ITEMS[edit.item]||edit.item}=${value(edit.value)}`;
  if(edit.action==='editor_action')return editorEdit(edit.edit);
  return ACTIONS[edit.action]||edit.action||'편집';
}
const READ_FIELD={ownership:'보유 여부',level:'레벨',state:'상태',current:'현재 값',pending:'예정된 변경',delta:'변화량'};
const MATH={set:'값 지정',increment:'더하기',decrement:'빼기',multiply:'곱하기',double:'두 배',halve:'절반',max:'최대',min:'최소',current:'현재 값'};
const SIMPLE_OPS={show:'변경 목록 보기',undo:'되돌리기',restore:'다시 실행',clear:'변경 목록 비우기',wait:'대기',apply_request:'저장 요청',remaining:'남은 횟수 확인',capabilities:'할 수 있는 일 안내',feedback:'의견'};
function describeOperation(row){
  if(!row||typeof row!=='object')return '작업';
  if(row.operation==='edit')return describeEdit(row.edit);
  if(row.operation==='read')return `조회 · ${row.kind==='item'?(ITEMS[row.item]||row.item):'고양이'} ${READ_FIELD[row.field]||row.field||''}`.trim();
  if(row.operation==='remove')return '변경 취소';
  if(row.operation==='calculate')return `계산 · ${MATH[row.math]||row.math}${Number.isSafeInteger(row.amount)?` ${row.amount}`:''}`;
  if(row.operation==='filter_edit')return `조건부 고양이 · ${CAT[row.action]||row.action}`;
  if(row.operation==='cat_group')return `고양이 묶음 · ${(row.actions||[]).map(a=>CAT[a]||a).join(', ')}`;
  return SIMPLE_OPS[row.operation]||row.operation||'작업';
}
// One line for the log: proposed edits or handled operations, at most 8 entries.
function describeResult(result){
  if(result?.status==='ready'){const list=(result.edits||[]).map(describeEdit);return '제안한 변경: '+list.slice(0,8).join(', ')+(list.length>8?` 외 ${list.length-8}개`:'');}
  if(result?.status==='conversation'){const list=(result.operations||[]).map(describeOperation);return '처리한 작업: '+list.slice(0,8).join(', ')+(list.length>8?` 외 ${list.length-8}개`:'');}
  return '';
}
module.exports={describeEdit,describeOperation,describeResult,LABELS:{ITEMS,CAT,STORY,INVENTORY,MAPS,COLLECTIONS,EXPEDITION,EXTRA,SIMPLE,TYPES}};
