import {capture,restore} from '../shared/anchor.js';
if(!globalThis.__excerptideLoaded){
globalThis.__excerptideLoaded=true;
let clips=[],timer,selectionRange;

function notice(text){const el=document.createElement('div');el.dataset.excerptideUi='true';el.textContent=text;Object.assign(el.style,{position:'fixed',bottom:'24px',right:'24px',background:'#172e31',color:'white',padding:'14px 20px',zIndex:'2147483647',borderRadius:'12px',font:'14px system-ui',maxWidth:'360px'});document.body.append(el);setTimeout(()=>el.remove(),5000);}
function paint(scroll=false){if(!globalThis.Highlight||!CSS.highlights)return;const ranges=[];const target=new URLSearchParams(location.hash.slice(1)).get('excerptide');for(const c of clips){const r=restore(c.anchor,document);if(r){ranges.push(r);if(scroll&&c.id===target)r.startContainer.parentElement.scrollIntoView({behavior:'smooth',block:'center'});}}CSS.highlights.set('excerptide',new Highlight(...ranges));}
async function load(){try{const r=await chrome.runtime.sendMessage({type:'list'});if(r.clips){clips=r.clips;paint(true);}}catch{}}
function meta(...names){for(const name of names){const el=document.querySelector(`meta[name="${name}"],meta[property="${name}"]`);if(el?.content)return el.content;}return null;}
async function save(){try{const sel=getSelection();const range=sel?.rangeCount&&!sel.isCollapsed?sel.getRangeAt(0):selectionRange;if(!range)throw Error('Select a passage first');const anchor=capture(range,document);const original_url=location.href;const pmid=meta('citation_pmid')||(location.hostname==='pubmed.ncbi.nlm.nih.gov'?location.pathname.match(/^\/(\d+)/)?.[1]:null);const pmcid=meta('citation_pmcid')||location.pathname.match(/\bPMC\d+\b/)?.[0]||null;const clip={original_url,title:meta('citation_title','og:title')||document.title,anchor,doi:meta('citation_doi','DC.Identifier.DOI'),pmid,pmcid,notes:'',tags:[],color:'yellow'};const r=await chrome.runtime.sendMessage({type:'save',clip});if(r.error)throw Error(r.error);clips.push(r.clip);paint();getSelection()?.removeAllRanges();notice(r.pending?'Highlighted • queued locally; will retry syncing':'Highlighted • saved to your dashboard');return {ok:true};}catch(e){notice(e.message);return {error:e.message};}}
document.addEventListener('selectionchange',()=>{const s=getSelection();if(s?.rangeCount&&!s.isCollapsed)selectionRange=s.getRangeAt(0).cloneRange();});
document.addEventListener('contextmenu',()=>{const s=getSelection();if(s?.rangeCount&&!s.isCollapsed)selectionRange=s.getRangeAt(0).cloneRange();},true);
chrome.runtime.onMessage.addListener((m,_sender,respond)=>{if(m.type==='ping'){respond({ok:true});return;}if(m.type==='capture'){save().then(respond);return true;}});
document.addEventListener('keydown',e=>{if(e.altKey&&e.shiftKey&&e.code==='KeyH'){e.preventDefault();void save();}});
new MutationObserver(records=>{if(records.every(r=>r.target.parentElement?.closest('[data-excerptide-ui]')||r.type==='childList'&&[...r.addedNodes,...r.removedNodes].every(n=>n.nodeType===1&&n.hasAttribute('data-excerptide-ui'))))return;clearTimeout(timer);timer=setTimeout(()=>paint(),400);}).observe(document.body,{subtree:true,childList:true,characterData:true});
window.addEventListener('hashchange',()=>paint(true));document.addEventListener('visibilitychange',()=>{if(!document.hidden)void load();});void load();

setInterval(()=>{if(!document.hidden)void load();},60000);

}
