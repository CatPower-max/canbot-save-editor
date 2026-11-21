'use strict';
// Builds web/local/canbot.js: the local editor (tools/local/cli.js, menus.js), the JS SAVE engine (src/canbot-engine)
// and the shared edit labels and feature switches (src/edit-labels.js, src/feature-policy.js) in one
// file that runs with plain Node.js (Termux: pkg install nodejs). Each module keeps its own scope; require() between
// them is resolved from this table, and node: built-ins come from Node itself. canbot.js talks to
// PONOS through src/canbot-engine/ponos.js.
// Usage: node tools/local/build.js [--check]   (--check fails when the built file is out of date)
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.join(__dirname,'..','..'),OUT=path.join(ROOT,'web','local','canbot.js');
const files=[...fs.readdirSync(path.join(ROOT,'src','canbot-engine')).filter(f=>f.endsWith('.js')&&!['server.js','json-diff.js','authority.js','quota.js','summaries.js'].includes(f)).sort().map(f=>`src/canbot-engine/${f}`),'src/edit-labels.js','src/feature-policy.js','tools/local/labels-extra.js','tools/local/menus.js','tools/local/cli.js'];

function build(){
  const mods=files.map(f=>{
    const src=fs.readFileSync(path.join(ROOT,f),'utf8').replace(/\r\n/g,'\n');
    for(const m of src.matchAll(/require\((['"])([^'"]+)\1\)/g)){const id=m[2];if(!id.startsWith('node:')&&!id.startsWith('.'))throw Error(`${f}: external require ${id}`);}
    return `${JSON.stringify(f)}:function(module,exports,require){\n${src}\n}`;
  });
  return `#!/usr/bin/env node
// canbot.js - CanBot local editor (built ${'by tools/local/build.js'}; do not edit by hand).
// SPDX-License-Identifier: AGPL-3.0-or-later  Copyright (C) 2026 CanBot  https://www.gnu.org/licenses/agpl-3.0.html
// Termux: pkg install nodejs   then   node canbot.js
'use strict';
(function(){
const __files={
${mods.join(',\n')}
};
const __cache={},__path=require('node:path').posix;
function __load(id){
  if(__cache[id])return __cache[id].exports;
  const module={exports:{}};__cache[id]=module;
  const dir=__path.dirname(id);
  const req=spec=>{if(spec.startsWith('node:'))return require(spec);let p=__path.normalize(__path.join(dir,spec));if(!p.endsWith('.js'))p+=__files[p+'.js']?'.js':'/index.js';if(!__files[p])throw new Error('canbot.js: missing module '+p);return __load(p);};
  __files[id].call(module.exports,module,module.exports,req);
  return module.exports;
}
const cli=__load('tools/local/cli.js');
if(require.main===module)cli.main().catch(err=>{console.error('Error: '+(err&&err.message||err));process.exitCode=1;});
module.exports=cli;
})();
`;
}
const text=build();
if(process.argv.includes('--check')){const current=fs.existsSync(OUT)?fs.readFileSync(OUT,'utf8').replace(/\r\n/g,'\n'):'';if(current!==text){console.error('web/local/canbot.js is out of date: run node tools/local/build.js');process.exit(1);}console.log('web/local/canbot.js is up to date');}
else{fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,text);console.log(`wrote ${path.relative(ROOT,OUT)} (${(text.length/1024).toFixed(0)} KB, ${files.length} modules)`);}
