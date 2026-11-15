import {chromium,webkit,devices} from 'playwright';
import assert from 'node:assert/strict';
for(const engine of [chromium,webkit]){
 const browser=await engine.launch(engine===chromium?{executablePath:'/usr/bin/google-chrome'}:{});
 try{
 const page=await browser.newPage({...devices['iPhone 13'],viewport:{width:360,height:640}});
 await page.route('**/api/**',r=>r.abort());
 await page.addInitScript(()=>localStorage.setItem('kimi-statistics-v1',JSON.stringify({allow:false})));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8080/');
 await page.waitForFunction(()=>window.kimiGame?.snapshot().state==='ready');
 assert(await page.locator('#info-panel').isHidden());
 await page.locator('#privacy-open').click();
 assert.equal(await page.locator('.star-rules img').count(),3);
 assert(await page.locator('.star-rules img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0)));
 assert.deepEqual(await page.locator('.star-rules strong').allTextContents(),['+1 point','+3 points','−1 point']);
 const panel=await page.locator('#info-panel').boundingBox(),start=await page.locator('#start').boundingBox();
 assert(panel.x>=0&&panel.y>=0&&panel.x+panel.width<=360&&panel.y+panel.height<=640);
 assert(panel.y>=start.y+start.height,'Help must stay below START');
 await page.screenshot({path:`/tmp/kimi-help-${engine.name()}.png`});
 await page.locator('#privacy-open').click();assert(await page.locator('#info-panel').isHidden());
 await page.locator('#privacy-open').click();await page.locator('#privacy-info').click();
 assert(await page.locator('#privacy-dialog').isVisible());assert(await page.locator('#info-panel').isHidden());
 await page.locator('#privacy-close').click();
 await page.locator('#start').click();
 await page.waitForFunction(()=>!document.getElementById('catch-hint').hidden,{},{timeout:18000});
 await page.screenshot({path:`/tmp/kimi-hint-${engine.name()}.png`});
 await page.waitForFunction(()=>document.getElementById('catch-hint').hidden,{},{timeout:7000});
 await page.reload();await page.waitForFunction(()=>window.kimiGame?.snapshot().state==='ready');
 await page.locator('#start').click();
 await page.waitForSelector('.star[data-id="0"]');await page.locator('.star[data-id="0"]').dispatchEvent('pointerdown');
 await page.waitForTimeout(10500);
 assert(await page.locator('#catch-hint').isHidden(),'No reminder when one of first three caught');
 assert.deepEqual(errors,[]);
 console.log(engine.name()+': rules, PNGs, mobile bounds, toggle, privacy, three misses and first catch OK');
 }finally{await browser.close();}
}
