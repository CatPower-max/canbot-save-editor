// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 CanBot
'use strict';
// canbot.dev/local: shows the member's local editor token status and issues or revokes a token (src/local-api.js).
(function(){
  const $=id=>document.getElementById(id);
  let csrf='';
  const when=t=>t?new Date(t).toLocaleString():'—';
  function error(text){const e=$('error');e.textContent=text||'';e.hidden=!text;}
  async function call(method,url){
    const res=await fetch(url,{method,credentials:'same-origin',headers:method==='GET'?{}:{'x-csrf-token':csrf,'content-type':'application/json'},body:method==='GET'?undefined:'{}'});
    let data={};try{data=await res.json();}catch{}
    if(!res.ok)throw Object.assign(new Error(data.error||`HTTP ${res.status}`),{status:res.status});
    return data;
  }
  function show(info){
    $('status').textContent=info?`토큰 있음 · 발급 ${when(info.createdAt)} · 마지막 사용 ${when(info.lastUsedAt)} (Token active)`:'아직 토큰이 없습니다. (No token yet)';
    $('revoke').hidden=!info;
  }
  async function start(){
    try{const me=await call('GET','/api/me');csrf=me.csrf||'';}
    catch(e){if(e.status===401){$('signed-out').hidden=false;return;}error(e.message);return;}
    $('signed-in').hidden=false;
    try{show((await call('GET','/api/local/token')).token);}catch(e){error(e.message);}
  }
  $('issue').addEventListener('click',async()=>{
    if($('revoke').hidden===false&&!confirm('새 토큰을 받으면 이전 토큰은 더 이상 쓸 수 없습니다. 계속할까요?'))return;
    error('');
    try{const r=await call('POST','/api/local/token');$('token').textContent=r.token;$('token-box').hidden=false;show(r.info);}catch(e){error(e.message);}
  });
  $('revoke').addEventListener('click',async()=>{
    if(!confirm('토큰을 회수할까요? 이 토큰을 쓰는 canbot.js는 더 이상 작동하지 않습니다.'))return;
    error('');
    try{await call('DELETE','/api/local/token');$('token-box').hidden=true;show(null);}catch(e){error(e.message);}
  });
  $('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('token').textContent);$('copy').textContent='복사됨 / Copied';}catch{}});
  start();
})();
