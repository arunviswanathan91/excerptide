// Detect a selected HTML table and keep it as structured cells (never as raw HTML).
const MAX_ROWS=300,MAX_COLS=40,MAX_JSON=80000;
const clean=s=>s.replace(/\s+/g,' ').trim();
function cellText(cell){const copy=cell.cloneNode(true);copy.querySelectorAll('script,style,[data-excerptide-ui]').forEach(n=>n.remove());copy.querySelectorAll('br').forEach(n=>n.replaceWith(' '));return clean(copy.textContent);}
// Returns the table the user meant to highlight, or null for ordinary text selections.
// A selection inside one cell stays a text highlight; spanning cells, or covering a whole table, is a table.
export function selectedTable(range){
 let node=range.commonAncestorContainer;if(node.nodeType===3)node=node.parentElement;if(!node)return null;
 let table=node.closest?.('table');
 if(table){if([...table.querySelectorAll('td,th')].filter(c=>range.intersectsNode(c)).length<2)return null;}
 else{
  table=[...node.querySelectorAll?.('table')||[]].find(t=>!t.parentElement?.closest('table')&&range.intersectsNode(t));
  if(!table||range.toString().length>(table.textContent||'').length+5)return null;
 }
 return table.querySelector('table')?null:table; // nested tables are layout, not data
}
export function serializeTable(table){
 const rows=[...table.rows];if(!rows.length||rows.length>MAX_ROWS)return null;
 const data={caption:clean(table.caption?.textContent||''),rows:rows.map(r=>[...r.cells].map(c=>{const o={t:cellText(c)};if(c.tagName==='TH')o.h=1;if(c.colSpan>1)o.cs=Math.min(c.colSpan,MAX_COLS);if(c.rowSpan>1)o.rs=Math.min(c.rowSpan,MAX_ROWS);return o;}))};
 if(!data.rows.some(r=>r.length)||data.rows.some(r=>r.reduce((n,c)=>n+(c.cs||1),0)>MAX_COLS)||JSON.stringify(data).length>MAX_JSON)return null;
 return data;
}
// Expand spans into a rectangular grid of strings (used for Markdown).
export function tableGrid(t){
 const grid=[];t.rows.forEach((row,r)=>{grid[r]??=[];let c=0;for(const cell of row){while(grid[r][c]!==undefined)c++;for(let i=0;i<(cell.rs||1);i++)for(let j=0;j<(cell.cs||1);j++){grid[r+i]??=[];grid[r+i][c+j]=i===0&&j===0?cell.t:'';}c+=cell.cs||1;}});
 const width=Math.max(0,...grid.map(r=>r.length));return grid.map(r=>Array.from({length:width},(_,i)=>r[i]??''));
}
