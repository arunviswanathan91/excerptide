import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {build} from 'esbuild';
import {Client,SessionExpiredError} from '../shared/client.js';
async function worker(overrides={}){const output=await build({entryPoints:['browser/background.js'],bundle:true,write:false,format:'iife'});const store={settings:{session:{expires_at:Date.now()/1000+3600,access_token:'test',user:{id:'owner'}}}};const handlers={};const event=name=>({addListener:fn=>handlers[name]=fn});const chrome={storage:{local:{setAccessLevel:async()=>{},get:async key=>({[key]:structuredClone(store[key])}),set:async data=>Object.assign(store,structuredClone(data))}},runtime:{onInstalled:event('install'),onMessage:event('message'),getURL:()=> 'chrome-extension://test/'},contextMenus:{onClicked:event('click'),create:()=>{}},alarms:{onAlarm:event('alarm'),create:()=>{}},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},tabs:{sendMessage:async()=>({ok:true})},scripting:{executeScript:async()=>{},insertCSS:async()=>{}}};Object.assign(chrome,overrides.chrome||{});vm.runInNewContext(output.outputFiles[0].text,{chrome,crypto:{randomUUID:()=> 'clip-id'},URL,AbortSignal,fetch:overrides.fetch||(async()=>({ok:true,status:201,json:async()=>[]})),console});return {store,handlers,chrome};}
const DEAD='{"code":400,"error_code":"refresh_token_not_found","msg":"Invalid Refresh Token: Refresh Token Not Found"}';
const fresh=()=>({url:'https://example.supabase.co',key:'public',session:{expires_at:0,refresh_token:'old',access_token:'a',user:{id:'owner',email:'me@example.org'}}});
function client(state,responses){const calls=[];const c=new Client(async()=>state.v,async v=>state.v=v,async(url,init)=>{calls.push({url,init});return responses(url,init,calls.length);});return {c,calls};}
const bad=(status,body)=>({ok:false,status,text:async()=>body});

test('a dead refresh token clears the login once, keeps who it was, and is not retried',async()=>{
 const state={v:fresh()};const {c,calls}=client(state,()=>bad(400,DEAD));
 await assert.rejects(()=>c.token(),e=>e instanceof SessionExpiredError&&e.code==='session_expired');
 assert.equal(state.v.session,undefined);assert.equal(state.v.expired.userId,'owner');assert.equal(state.v.expired.email,'me@example.org');
 assert.equal(calls.length,1);
 await assert.rejects(()=>c.token(),/sign-in has expired/);assert.equal(calls.length,1,'no further network calls once the login is gone');
});
test('temporary failures keep the login and retry later',async()=>{
 for(const status of [429,500,503]){const state={v:fresh()};const {c}=client(state,()=>bad(status,'try later'));
  await assert.rejects(()=>c.token(),new RegExp(String(status)));assert.ok(state.v.session,'login kept after '+status);assert.equal(state.v.expired,undefined);}
 const state={v:fresh()};const c=new Client(async()=>state.v,async v=>state.v=v,async()=>{throw Error('offline');});
 await assert.rejects(()=>c.token(),/offline/);assert.ok(state.v.session);
});
test('a login another part of the extension already renewed is used instead of failing',async()=>{
 const state={v:fresh()};
 const {c}=client(state,()=>{state.v={...state.v,session:{expires_at:Date.now()/1000+3600,refresh_token:'rotated',access_token:'new',user:{id:'owner'}}};return bad(400,DEAD);});
 assert.equal(await c.token(),'new');assert.ok(state.v.session);assert.equal(state.v.expired,undefined);
});
test('signing in again clears the expired marker and the queue owner is unchanged',async()=>{
 const state={v:{url:'https://example.supabase.co',key:'public',expired:{userId:'owner',email:'me@example.org'}}};
 const {c}=client(state,()=>({ok:true,status:200,json:async()=>({access_token:'t',refresh_token:'r',expires_in:3600,user:{id:'owner',email:'me@example.org'}})}));
 await c.login('me@example.org','pw');assert.equal(state.v.session.user.id,'owner');assert.equal(state.v.expired,undefined);
});
test('sign out ends only this browser and works even when the login is already dead',async()=>{
 const live={v:{...fresh(),session:{...fresh().session,expires_at:Date.now()/1000+3600}}};const a=client(live,()=>({ok:true,status:204,text:async()=>''}));
 await a.c.logout();assert.match(a.calls[0].url,/\/auth\/v1\/logout\?scope=local$/);assert.equal(live.v.session,undefined);
 const dead={v:fresh()};const b=client(dead,()=>bad(400,DEAD));await b.c.logout();assert.equal(dead.v.session,undefined);assert.equal(dead.v.expired,undefined);
 const offline={v:{...fresh(),session:{...fresh().session,expires_at:Date.now()/1000+3600}}};
 await new Client(async()=>offline.v,async v=>offline.v=v,async()=>{throw Error('offline');}).logout();assert.equal(offline.v.session,undefined);
});

test('while the sign-in has expired a highlight is still saved on this computer and the user is told',async()=>{
 let fetched=0;const w=await worker({fetch:async()=>{fetched++;return {ok:true,status:201,json:async()=>[]};}});
 w.store.settings={expired:{userId:'owner',email:'me@example.org'}};
 const r=await new Promise(res=>w.handlers.message({type:'save',clip:{original_url:'https://example.org/a',anchor:{exact:'Kept'},title:'T'}},{tab:{id:1},url:'https://example.org/a'},res));
 assert.equal(r.pending,true);assert.equal(w.store['queue:owner'].length,1);assert.equal(w.store['queue:owner'][0].user_id,'owner');
 await new Promise(r=>setTimeout(r,20));assert.match(w.store.lastAction.message,/sign-in expired/);assert.equal(w.store.lastAction.error,true);assert.equal(fetched,0,'nothing is sent without a login');
});
test('while expired the page list comes from the cache and queue, with no network and no retry loop',async()=>{
 let fetched=0;const w=await worker({fetch:async()=>{fetched++;return {ok:true,status:200,json:async()=>[]};}});
 const page='https://example.org/a';w.store.settings={expired:{userId:'owner'}};
 w.store['cache:owner:'+page]=[{id:'c1',page_key:page,anchor:{exact:'Cached'}}];w.store['queue:owner']=[{id:'q1',page_key:page,anchor:{exact:'Queued'}}];
 const r=await new Promise(res=>w.handlers.message({type:'list',url:page},{tab:{id:1},url:page},res));
 assert.equal(JSON.stringify(r.clips.map(c=>c.id).sort()),'["c1","q1"]');
 w.handlers.alarm();await new Promise(r=>setTimeout(r,20));assert.equal(fetched,0);
});
test('a dead login found during sync is cleared, reported once, and the clipping stays queued',async()=>{
 const w=await worker({fetch:async()=>bad(400,DEAD)});
 w.store.settings={session:{expires_at:0,refresh_token:'old',access_token:'a',user:{id:'owner',email:'me@example.org'}}};
 w.store['queue:owner']=[{id:'q1',page_key:'p',user_id:'owner'}];
 w.handlers.alarm();await new Promise(r=>setTimeout(r,30));
 assert.equal(w.store.settings.session,undefined);assert.equal(w.store.settings.expired.userId,'owner');assert.equal(w.store['queue:owner'].length,1);
 assert.match(w.store.lastAction.message,/sign-in has expired.*1 clipping/s);assert.equal(w.store.lastAction.error,true);
});
test('signing in again uploads the waiting clippings straight away',async()=>{
 const sent=[];const w=await worker({fetch:async(url,init)=>{
  if(url.includes('grant_type=password'))return {ok:true,status:200,json:async()=>({access_token:'t',refresh_token:'r',expires_in:3600,user:{id:'owner',email:'me@example.org'}})};
  sent.push(JSON.parse(init.body));return {ok:true,status:201,json:async()=>[]};}});
 w.store.settings={expired:{userId:'owner',email:'me@example.org'}};w.store['queue:owner']=[{id:'q1',page_key:'p',user_id:'owner',anchor:{exact:'x'}}];
 const r=await new Promise(res=>w.handlers.message({type:'login',email:'me@example.org',password:'pw'},{url:'chrome-extension://test/popup.html'},res));
 assert.equal(r.ok,true);await new Promise(r=>setTimeout(r,40));
 assert.equal(w.store['queue:owner'].length,0);assert.equal(sent.length,1);assert.equal(sent[0].id,'q1');assert.equal(w.store.settings.expired,undefined);
});
