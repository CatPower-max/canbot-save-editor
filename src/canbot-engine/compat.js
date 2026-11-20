// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// Compatibility with earlier CanBot builds. By default the engine uses CanBot's own names: the "_canbot:" record key
// (records.js) and the METADATA_FAILED error code. Services that must answer exactly like the earlier editor switch
// to its names with use('legacy') or CANBOT_COMPAT=legacy: records then use only the "_bcsfe:" key and the metadata
// error code is BCSFE_METADATA_FAILED.
let legacy=typeof process!=='undefined'&&process.env?.CANBOT_COMPAT==='legacy';

function use(mode){
  if(mode!=='own'&&mode!=='legacy')throw new Error(`Unknown compatibility mode: ${mode}`);
  legacy=mode==='legacy';
}
const isLegacy=()=>legacy;

module.exports={use,isLegacy};
