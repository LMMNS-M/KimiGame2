// All writes target a disposable SQLite database. Production is never contacted.
import {chromium,webkit,devices} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const dir=await mkdtemp(join(tmpdir(),'kimi-world-')),url='http://127.0.0.1:8085';
const server=spawn('.venv/bin/python',['-c',"from server import create_app; create_app({'MIN_RUN_SECONDS':0}).run(port=8085)"],{env:{...process.env,KIMI_DATABASE:join(dir,'scores.sqlite3')},stdio:'ignore'});
const post=async(path,data)=>(await fetch(url+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})).json();
const settle=async p=>p.waitForFunction(()=>window.kimiGame?.snapshot().state==='ready');
const best=async(p,n)=>p.waitForFunction(n=>Number(document.querySelector('#best-value').textContent)===n,n);
let browser;
try{
 for(let i=0;i<50;i++){try{if((await fetch(url+'/api/health')).ok)break;}catch{}await delay(100);}
 const run=await post('runs',{});await post('scores',{token:run.token,score:40,name:'isolated seed'});
 for(const [index,engine] of [chromium,webkit].entries()){
  const baseline=index?80:40,record=index?120:80;
  browser=await engine.launch(engine===chromium?{executablePath:'/usr/bin/google-chrome'}:{});
  const contexts=await Promise.all([browser.newContext({...devices['iPhone 13']}),browser.newContext({...devices['iPhone 13']})]);
  for(const [i,c] of contexts.entries()){
   await c.addInitScript(n=>{localStorage.setItem('kimi-wishes-best',String(n));localStorage.setItem('kimi-statistics-v1',JSON.stringify({allow:true,visitor:crypto.randomUUID(),secret:crypto.randomUUID()}));},i?1:999);
   await c.route('**/api/statistics**',r=>r.abort());
  }
  const [p,q]=await Promise.all(contexts.map(c=>c.newPage()));const errors=[];
  for(const page of [p,q])page.on('pageerror',e=>errors.push(e.message));
  // A 5-second mobile response must survive the previous 4-second timeout.
  await p.route('**/api/leaderboard',async r=>{await delay(5000);await r.continue();},{times:1});
  await Promise.all([p.goto(url),q.goto(url)]);await Promise.all([settle(p),settle(q)]);
  assert(await p.locator('#start').isVisible());assert(await p.locator('#privacy-dialog').isHidden());
  await Promise.all([best(p,baseline),best(q,baseline)]);
  // A registered game loses connectivity before its final score is sent.
  await p.evaluate(async()=>{const l=await import('./js/leaderboard.js');l.resetLeaderboard();l.beginLeaderboardRun();});
  await delay(300);await contexts[0].setOffline(true);
  await p.evaluate(async value=>{const l=await import('./js/leaderboard.js');l.showLeaderboard(value);},record);
  await p.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('Connection unavailable'));
  await best(p,baseline);assert(await p.locator('#replay').isEnabled());
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('kimi-wishes-best'))),999);
  await contexts[0].setOffline(false);
  await p.evaluate(()=>window.dispatchEvent(new Event('online')));
  await p.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('saved as —'));
  await best(p,record);
  await q.evaluate(()=>window.dispatchEvent(new Event('online')));await best(q,record);
  const result=await(await fetch(url+'/api/leaderboard')).json();assert.equal(result.leaderboard[0].score,record);assert.equal(result.leaderboard[0].name,'');
  // The name updates that entry, not a duplicate.
  await p.evaluate(async()=>{document.querySelector('#player-name').value='isolated owner';document.querySelector('#score-form').dispatchEvent(new Event('submit',{cancelable:true}));});
  await p.waitForFunction(()=>document.querySelector('#score-status').textContent.startsWith('Score saved!'));
  const named=await(await fetch(url+'/api/leaderboard')).json();assert.equal(named.leaderboard.length,result.leaderboard.length);assert.equal(named.leaderboard[0].name,'isolated owner');
  // Server down: cached world score only. Missing analytics module cannot block START.
  await p.route('**/api/**',r=>r.abort());await p.route('**/js/statistics.js',r=>r.abort());
  await p.reload();await settle(p);await best(p,record);
  await p.locator('#start').click();await p.waitForFunction(()=>['countdown','playing'].includes(window.kimiGame.snapshot().state));await best(p,record);
  // Fresh isolated context with no cache and unavailable server displays 0.
  const fresh=await browser.newContext({...devices['iPhone 13']});await fresh.route('**/api/**',r=>r.abort());
  await fresh.addInitScript(()=>{localStorage.setItem('kimi-wishes-best','999');Object.defineProperty(window,'localStorage',{get(){throw new Error('Storage unavailable')}})});
  const f=await fresh.newPage();f.on('pageerror',e=>errors.push(e.message));await f.goto(url);await settle(f);await best(f,0);assert(await f.locator('#privacy-dialog').isHidden());
  await f.locator('#start').click();await f.waitForFunction(()=>['countdown','playing'].includes(window.kimiGame.snapshot().state));
  assert.deepEqual(errors,[]);
  console.log(engine.name()+': two stores, global TOP1, 5s response, anonymous save/name, reconnect, cached world best, stats failures/missing module, unavailable storage/backend and START passed');
  await browser.close();browser=null;
 }
}finally{await browser?.close();server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));await rm(dir,{recursive:true,force:true});}
