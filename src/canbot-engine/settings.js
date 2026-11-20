// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Session editor settings, set for each edit:
//   resetCatData     removing a cat clears its forms, levels, talents and guide entry (else only "unlocked")
//   setCurrentForms  evolving a cat also switches it to the new form
//   strictUpgrade    level-ups follow the SAVE's upgrade state, user rank and only claimed user-rank rewards
//   unlockOnEdit     editing a cat's forms, levels, talents or guide entry also unlocks it
//   disableMaxes     item and clear-count limits become the field's integer range
// The current values are module state for the edit being applied (single-threaded, set per edit).
const DEFAULTS=Object.freeze({resetCatData:true,setCurrentForms:true,strictUpgrade:false,unlockOnEdit:true,disableMaxes:false});
const FROM_SESSION={reset_cat_data:'resetCatData',set_cat_current_forms:'setCurrentForms',strict_upgrade:'strictUpgrade',unlock_cat_on_edit:'unlockOnEdit',disable_item_maxes:'disableMaxes'};
let current={...DEFAULTS};
const get=()=>current;
// session: CanBot session settings (snake_case booleans); missing keys use the defaults.
function fromSession(session={}){const out={...DEFAULTS};for(const [k,name] of Object.entries(FROM_SESSION))if(typeof session[k]==='boolean')out[name]=session[k];return out;}
function use(values,run){const before=current;current={...DEFAULTS,...values};try{return run();}finally{current=before;}}
// A limit, or with maxes disabled the signed range of the field (i16 32767, i32 2147483647).
const cap=(limit,bits=31)=>current.disableMaxes?2**bits-1:limit;
module.exports={DEFAULTS,get,fromSession,use,cap};
