import {Plugin,PluginSettingTab,Setting,Notice,requestUrl,normalizePath} from 'obsidian';
import {Client,defaults,highlightLink} from '../shared/client.js';
import {noteBody,noteName} from '../shared/markdown.js';
async function transport(url,init={}){const r=await requestUrl({url,method:init.method||'GET',headers:init.headers,body:init.body,throw:false});return {ok:r.status>=200&&r.status<300,status:r.status,json:async()=>r.json,text:async()=>r.text};}
export default class Excerptide extends Plugin {
 async onload(){this.settings={...defaults,folder:'Excerptide',...await this.loadData()};this.client=new Client(async()=>this.settings,async s=>{this.settings=s;await this.saveData(s);},transport);this.addSettingTab(new Settings(this.app,this));this.addCommand({id:'sync',name:'Sync clippings',callback:()=>this.sync()});this.addRibbonIcon('highlighter','Sync Excerptide clippings',()=>this.sync());this.registerInterval(window.setInterval(()=>{if(this.settings.session)void this.sync(false);},60000));}
 async sync(notify=true){
  if(this.syncing)return;this.syncing=true;
  try{
   const clips=await this.client.list();const base=this.settings.folder||'Excerptide';
   if(base.split(/[\\/]/).some(x=>x==='..')||base.startsWith('/'))throw Error('Choose a relative vault folder');
   const folder=normalizePath(base),owner=this.settings.session.user.id;
   let path='';for(const part of folder.split('/')){path=path?path+'/'+part:part;if(!this.app.vault.getAbstractFileByPath(path))await this.app.vault.createFolder(path);}
   this.settings.noteIndex??={};const indexKey=(this.settings.url||defaults.url)+'|'+owner;
   const index=this.settings.noteIndex[indexKey]??={};let count=0,skipped=0;
   for(const c of clips){
    const previous=index[c.id];const legacy=normalizePath(folder+'/'+owner+'/'+c.id+'.md');
    let existing=previous?this.app.vault.getAbstractFileByPath(previous.path):null;
    if(!existing)existing=this.app.vault.getAbstractFileByPath(legacy);
    const content=noteBody(c,highlightLink(c));let next=content+'\n\n## My notes\n\n';
    if(existing){
     const old=await this.app.vault.read(existing);const start='<!-- excerptide:start -->',end='<!-- excerptide:end -->';const a=old.indexOf(start),b=old.indexOf(end);
     if(a>=0&&b>a)next=old.slice(0,a)+content+old.slice(b+end.length);
     else if(previous?.content&&old.startsWith(previous.content))next=content+old.slice(previous.content.length);
     else {skipped++;continue;}
    }
    const stem=noteName(c.title);let target=normalizePath(folder+'/'+stem+'.md'),number=2;
    while(this.app.vault.getAbstractFileByPath(target)&&this.app.vault.getAbstractFileByPath(target)?.path!==existing?.path)target=normalizePath(folder+'/'+stem+' ('+(number++)+').md');
    if(existing){
     if(await this.app.vault.read(existing)!==next)await this.app.vault.modify(existing,next);
     if(existing.path!==target)await this.app.fileManager.renameFile(existing,target);
    }else await this.app.vault.create(target,next);
    index[c.id]={path:target,content};await this.saveData(this.settings);count++;
   }
   const oldFolder=this.app.vault.getAbstractFileByPath(normalizePath(folder+'/'+owner));
   if(oldFolder&&Array.isArray(oldFolder.children)&&oldFolder.children.length===0)await this.app.vault.delete(oldFolder);
   if(notify)new Notice(`Excerptide: ${count} clippings synced.${skipped?' '+skipped+' locally edited notes preserved without overwriting.':' Your notes were preserved.'}`);
  }catch(e){if(notify)new Notice(e.message);console.warn('Excerptide sync failed');}finally{this.syncing=false;}
 }

}
class Settings extends PluginSettingTab {
 constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
 display(){const p=this.plugin;const {containerEl:el}=this;el.empty();el.createEl('h2',{text:'Excerptide Sync'});el.createEl('p',{text:'Sign in using your dashboard account. Sync imports clippings every minute while Obsidian is open. Paper titles are used as filenames. Write below “My notes”; if you edit the imported excerpt itself, sync preserves that file rather than overwriting it. Local notes are never deleted by sync.'});el.createEl('p',{text:'Session tokens are stored in this plugin’s local data.json. Do not publish or share that file. Use a publishable Supabase key only.'});
 for(const [key,label] of [['url','Supabase URL'],['key','Publishable key'],['folder','Vault folder']])new Setting(el).setName(label).addText(t=>t.setValue(p.settings[key]).onChange(async v=>{if(key!=='folder')delete p.settings.session;p.settings[key]=v.trim();await p.saveData(p.settings);}));
 let email='',password='';new Setting(el).setName('Email').addText(t=>{t.inputEl.type='email';t.setPlaceholder('Dashboard email').onChange(v=>email=v);});
 new Setting(el).setName('Password').addText(t=>{t.inputEl.type='password';t.onChange(v=>password=v);});
 new Setting(el).setName(p.settings.session?'Signed in':'Sign in').addButton(b=>b.setButtonText('Sign in').onClick(async()=>{try{await p.client.login(email,password);password='';this.display();new Notice('Excerptide signed in');}catch(e){new Notice(e.message);}})).addButton(b=>b.setButtonText('Sign out').onClick(async()=>{try{await p.client.logout();this.display();}catch(e){new Notice(e.message);}}));new Setting(el).setName('Sync').addButton(b=>b.setButtonText('Sync now').onClick(()=>p.sync()));
 }
}
