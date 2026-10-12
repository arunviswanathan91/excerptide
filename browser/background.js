import {Client,pageKey,zoteroMatch} from '../shared/client.js';
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
const read=async()=>(await chrome.storage.local.get('settings')).settings||{};
const write=settings=>chrome.storage.local.set({settings});
const client=new Client(read,write);
chrome.runtime.onInstalled.addListener(()=>{chrome.contextMenus.create({id:'highlight',title:'Highlight with Excerptide',contexts:['selection']});chrome.alarms.create('sync',{periodInMinutes:1});});
chrome.contextMenus.onClicked.addListener((info,tab)=>{if(info.menuItemId==='highlight'&&tab?.id)chrome.tabs.sendMessage(tab.id,{type:'capture'}).catch(()=>{});});
let serial=Promise.resolve();function locked(fn){const p=serial.then(fn);serial=p.catch(()=>{});return p;}
async function sync(){const s=await read();if(!s.session)return;const key='queue:'+s.session.user.id;let queue=(await chrome.storage.local.get(key))[key]||[];for(const c of [...queue]){try{await client.save(c);queue=queue.filter(x=>x.id!==c.id);await chrome.storage.local.set({[key]:queue});}catch{break;}}}
chrome.alarms.onAlarm.addListener(()=>locked(sync));
chrome.runtime.onMessage.addListener((m,sender,respond)=>{(async()=>{
 const trusted=sender.url?.startsWith(chrome.runtime.getURL(''));
 if(m.type==='login'&&trusted){await locked(()=>client.login(m.email,m.password));return {ok:true};}
 if(m.type==='logout'&&trusted){await locked(()=>client.logout());return {ok:true};}
 if(m.type==='sync'&&trusted){await locked(sync);return {ok:true};}
 if(m.type==='list'){const url=(sender.tab?sender.url:null)||m.url;if(!url)throw Error('No webpage');const s=await read();if(!s.session)return {clips:[]};const p=pageKey(url);const queue=(await chrome.storage.local.get('queue:'+s.session.user.id))['queue:'+s.session.user.id]||[];let clips=[];try{clips=await client.list(p);await chrome.storage.local.set({['cache:'+s.session.user.id+':'+p]:clips});}catch(e){clips=(await chrome.storage.local.get('cache:'+s.session.user.id+':'+p))['cache:'+s.session.user.id+':'+p]||[];}return {clips:[...new Map([...clips,...queue.filter(c=>c.page_key===p)].map(c=>[c.id,c])).values()]};}
 if(m.type==='save'&&sender.tab){return locked(async()=>{const s=await read();if(!s.session)throw Error('Open Excerptide and sign in first');const c=m.clip;if(!c?.anchor?.exact||c.anchor.exact.length>100000)throw Error('Invalid or excessively long selection');if(pageKey(c.original_url)!==pageKey(sender.url))throw Error('Page changed; select the passage again');c.id=crypto.randomUUID();c.page_key=pageKey(c.original_url);c.created_at=new Date().toISOString();c.user_id=s.session.user.id;const key='queue:'+s.session.user.id;const q=(await chrome.storage.local.get(key))[key]||[];q.push(c);await chrome.storage.local.set({[key]:q});await sync();const remaining=(await chrome.storage.local.get(key))[key]||[];return {clip:c,pending:remaining.some(x=>x.id===c.id)};});}
 if(m.type==='zotero'&&trusted){const clips=await client.list(m.page);let count=0;for(const c of clips){const z=await zoteroMatch(c,await read());if(z){await client.update(c.id,{zotero:z});if(z.status==='matched')count++;}}return {count};}
 throw Error('Unsupported action');
 })().then(respond).catch(e=>respond({error:e.message}));return true;});
