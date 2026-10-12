import {build} from 'esbuild';import {mkdir,copyFile,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist/browser',{recursive:true});await mkdir('dist/obsidian/excerptide',{recursive:true});
for(const file of ['manifest.json','popup.html','options.html','ui.css'])await copyFile('browser/'+file,'dist/browser/'+file);
await build({entryPoints:['browser/background.js','browser/popup.js','browser/options.js'],bundle:true,outdir:'dist/browser',format:'esm',target:'chrome105'});
await build({entryPoints:['browser/content.js'],bundle:true,outdir:'dist/browser',format:'iife',target:'chrome105'});
await build({entryPoints:['obsidian/main.js'],bundle:true,outfile:'dist/obsidian/excerptide/main.js',format:'cjs',platform:'browser',external:['obsidian'],target:'es2020'});
await copyFile('obsidian/manifest.json','dist/obsidian/excerptide/manifest.json');
