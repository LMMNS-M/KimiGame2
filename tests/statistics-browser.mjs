import {chromium,webkit,devices} from 'playwright';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const dir=await mkdtemp(join(tmpdir(),'kimi-stats-browser-')),database=join(dir,'scores.sqlite3'),url='http://127.0.0.1:8084';
const server=spawn('.venv/bin/python',['-c',"from server import create_app; create_app({'MIN_RUN_SECONDS':0}).run(port=8084)"],{env:{...process.env,KIMI_DATABASE:database},stdio:'ignore'});
const rows=()=>JSON.parse(execFileSync('.venv/bin/python',['-c',"import sqlite3,json,sys;d=sqlite3.connect(sys.argv[1]);d.row_factory=sqlite3.Row;print(json.dumps([dict(r) for r in d.execute('SELECT * FROM stats_events')]))",database],{encoding:'utf8'}));
let browser;
try{
  for(let i=0;i<50;i++){try{if((await fetch(url+'/api/health')).ok)break;}catch{}await delay(100);}
  for(const engine of ['chrome','webkit']){
    browser=await(engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());
    const page=await browser.newPage({...devices['iPhone 13']});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.waitForFunction(()=>window.kimiGame?.snapshot().state==='ready');
    const before=rows().length;assert(await page.locator('#privacy-dialog').isVisible());
    assert.equal(await page.evaluate(()=>localStorage.getItem('kimi-statistics-v1')),null);
    await page.locator('#privacy-refuse').click();await delay(300);assert.equal(rows().length,before);
    await page.locator('#privacy-open').click();await page.locator('#privacy-allow').click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('kimi-statistics-queue-v1')).length===0);
    const visitor=await page.evaluate(()=>JSON.parse(localStorage.getItem('kimi-statistics-v1')).visitor);
    assert(rows().some(e=>e.visitor_id===visitor&&e.kind==='page_view'));
    await page.reload();await page.waitForFunction(()=>window.kimiGame?.snapshot().state==='ready');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('kimi-statistics-queue-v1')).length===0);
    const mine=rows().filter(e=>e.visitor_id===visitor);assert.equal(new Set(mine.map(e=>e.visit_id)).size,2);assert(mine.some(e=>e.kind==='page_reload'));
    await page.route('**/api/statistics',route=>route.abort());
    await page.evaluate(async()=>{const s=await import('./js/statistics.js');s.gameStarted();s.track('hurry_up',{elapsed:45});s.gameComplete(50,50);});
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('kimi-statistics-queue-v1')).length>=3);
    assert(await page.locator('#start').isEnabled());
    await page.unroute('**/api/statistics');await page.evaluate(()=>dispatchEvent(new Event('online')));
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('kimi-statistics-queue-v1')).length===0);
    const complete=rows().filter(e=>e.visitor_id===visitor&&e.kind==='game_complete');assert.equal(complete.length,1);assert.equal(complete[0].elapsed,60);
    await page.evaluate(()=>dispatchEvent(new Event('online')));await delay(200);
    assert.equal(rows().filter(e=>e.visitor_id===visitor&&e.kind==='game_complete').length,1);
    // Actual START remains independent of both APIs, and reloading an active game returns home.
    await page.route('**/api/**',route=>route.abort());await page.locator('#start').tap();
    await page.waitForFunction(()=>window.kimiGame.snapshot().state==='playing');
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await page.reload();await page.waitForFunction(()=>window.kimiGame.snapshot().state==='ready');
    assert(await page.locator('#end-screen').isHidden());assert(await page.locator('#start').isEnabled());
    await page.unroute('**/api/**');await page.evaluate(()=>dispatchEvent(new Event('online')));
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('kimi-statistics-queue-v1')).length===0);
    assert(rows().some(e=>e.visitor_id===visitor&&e.kind==='game_interrupted'));
    await page.locator('#privacy-open').click();await page.screenshot({path:`/tmp/kimi-privacy-${engine}.png`});
    await page.locator('#privacy-delete').click();await page.waitForFunction(()=>document.querySelector('#privacy-status').textContent.includes('have been deleted'));
    assert.equal(rows().filter(e=>e.visitor_id===visitor).length,0);assert.deepEqual(errors,[]);
    await browser.close();browser=null;console.log(engine+': consent, repeat visits, offline queue, deduplication, interruption, deletion and mobile UI passed');
  }
}finally{if(browser)await browser.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));await rm(dir,{recursive:true,force:true});}
