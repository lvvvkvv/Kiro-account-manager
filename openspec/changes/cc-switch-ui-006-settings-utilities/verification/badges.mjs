import assert from 'node:assert/strict';import fs from 'node:fs/promises';
export async function verifyBadges({page,navigate,out,setAppearance}){
 const report=[];
 for(const mode of ['light','dark']){
 await setAppearance('en',mode);
 for(const [view,selector] of [['logs','.font-mono span.rounded-full.text-badge'],['kiroSettings','.ui-section-title span.rounded-full'],['about','span.rounded-full.text-badge'],['diagnose','span.rounded-full.text-badge']]){
 await navigate(view);if(view==='diagnose')await page.getByRole('button',{name:'Run Diagnostics',exact:true}).click();
 if(view==='logs'){const padding=await page.getByPlaceholder('Filter by message, category...').evaluate(e=>[getComputedStyle(e).paddingLeft,getComputedStyle(e).paddingRight]);assert.deepEqual(padding,['32px','32px']);}
 const loc=page.locator(selector);assert.ok(await loc.count(),view);for(const m of await loc.evaluateAll(nodes=>nodes.map(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {h:r.height,font:s.fontSize,line:s.lineHeight,pad:s.paddingLeft,radius:s.borderRadius}}))){assert.ok(Math.abs(m.h-20)<0.1);assert.equal(m.font,'11px');assert.equal(m.line,'16px');assert.equal(m.pad,'7px');assert.ok(parseFloat(m.radius)>=99);report.push({view,mode,...m})}
 await page.screenshot({path:`${out}/badges-${view}-${mode}.png`});
 }
 }
 await fs.writeFile(`${out}/badges.json`,JSON.stringify(report,null,2));console.log(`通过：${report.length} 项日志分类／Kiro计数／技术栈／HTTP状态徽标几何`);
}
