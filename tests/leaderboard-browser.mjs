// Persistent leaderboard flows against a disposable server/database, never production.
import {chromium, webkit, devices} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const dir = await mkdtemp(join(tmpdir(), 'kimi-pending-'));
const port = 8083, url = `http://127.0.0.1:${port}`;
const server = spawn('.venv/bin/python', ['-c',
  `from server import create_app; create_app({'MIN_RUN_SECONDS':0}).run(host='127.0.0.1',port=${port})`],
  {env:{...process.env,KIMI_DATABASE:join(dir,'scores.sqlite3')},stdio:'ignore'});
const browsers=[];
async function rows(){return (await (await fetch(url+'/api/leaderboard')).json()).leaderboard;}
async function finish(page, score){
  await page.evaluate(async score=>{
    const l=await import('./js/leaderboard.js');
    l.resetLeaderboard();l.beginLeaderboardRun();
    document.querySelector('#start-screen').hidden=true;
    document.querySelector('#end-screen').hidden=false;
    document.querySelector('#game').dataset.scene='result';
    document.querySelector('#final-score').textContent=score;
    // Initiate without awaiting: assertions also cover the in-flight state.
    l.showLeaderboard(score);
  },score);
}
async function saved(page){
  await page.waitForFunction(()=>document.querySelector('#score-status').textContent.startsWith('Score saved!'));
}
try{
  for(let i=0;i<50;i++){
    try{if((await fetch(url+'/api/health')).ok)break;}catch{}
    await delay(100);
  }
  for(const engine of ['chrome','webkit']){
    const browser=await (engine==='chrome'?chromium.launch({executablePath:'/usr/bin/google-chrome'}):webkit.launch());
    browsers.push(browser);
    const context=await browser.newContext({...devices['iPhone 13']});
    const page=await context.newPage();
    await page.goto(url);await page.waitForFunction(()=>window.kimiGame?.snapshot().state==='ready');
    const baseline=(await rows()).length;
    await finish(page,165);
    await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('saved as —'));
    assert(await page.locator('#replay').isDisabled());
    assert(await page.locator('#save-score').isEnabled());
    assert((await page.locator('#leaderboard-rows').textContent()).includes('—'));
    const owned=(await rows()).find(r=>r.name==='');
    assert(owned);assert.equal((await rows()).length,baseline+1);
    // Reload before typing a name: restore the private token and the same anonymous row.
    await page.reload();
    await page.waitForFunction(()=>window.kimiGame?.snapshot().state==='result');
    await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('saved as —'));
    assert(await page.locator('#replay').isDisabled());
    assert.equal((await rows()).find(r=>r.name==='').id,owned.id);
    // A fresh browser session does not acquire the pending score.
    const stranger=await browser.newContext({...devices['iPhone 13']});
    const other=await stranger.newPage();await other.goto(url);
    await other.waitForFunction(()=>window.kimiGame?.snapshot().state==='ready');
    assert(await other.locator('#end-screen').isHidden());
    await stranger.close();
    // Network failure on name submission must not unlock REPLAY or claim success.
    await page.route('**/api/scores',r=>r.abort());
    await page.locator('#player-name').fill(engine+' player');
    await page.locator('#save-score').tap();
    await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('not confirmed'));
    assert(await page.locator('#replay').isDisabled());
    assert.equal((await rows()).find(r=>r.id===owned.id).name,'');
    await page.unroute('**/api/scores');
    // Server commits the name but its response is lost. Retry must recover that same row.
    await page.route('**/api/scores',async route=>{await route.fetch();await route.abort();});
    await page.locator('#save-score').tap();
    await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('not confirmed'));
    assert(await page.locator('#replay').isDisabled());
    assert.equal((await rows()).find(r=>r.id===owned.id).name,engine+' player');
    await page.unroute('**/api/scores');
    await page.reload();await saved(page);
    assert(await page.locator('#replay').isEnabled());
    assert.equal((await rows()).length,baseline+1);
    assert.equal(await page.evaluate(()=>localStorage.getItem('kimi-pending-score-v1')),null);
    // Offline automatic save remains pending; reload and retry persist exactly once.
    await page.route('**/api/scores',r=>r.abort());
    await finish(page,164);
    await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('not confirmed'));
    assert(await page.locator('#replay').isDisabled());
    assert.equal((await rows()).length,baseline+1);
    await page.unroute('**/api/scores');
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('saved as —'));
    assert.equal((await rows()).length,baseline+2);
    await page.locator('#player-name').fill(engine+' recovered');
    await page.locator('#save-score').tap();await saved(page);
    assert(await page.locator('#replay').isEnabled());
    // Server confirmation, not the click, controls unlocking.
    await finish(page,165);
    await page.waitForFunction(()=>document.querySelector('#score-status').textContent.includes('saved as —'));
    await page.route('**/api/scores',async r=>{await delay(500);await r.continue();});
    await page.locator('#player-name').fill(engine+' confirmed');
    await page.locator('#save-score').tap();
    assert(await page.locator('#replay').isDisabled());
    await saved(page);assert(await page.locator('#replay').isEnabled());
    await page.unroute('**/api/scores');
    await page.screenshot({path:`/tmp/kimi-pending-${engine}.png`});
    await context.close();
    console.log(engine+': anonymous persistence, reload ownership, network failures, lost responses, name confirmation and no duplicates passed');
  }
  // Fill TOP 5 and check a non-qualifying result leaves REPLAY available.
  const browser=browsers[0], page=await browser.newPage();
  await page.goto(url);await page.waitForFunction(()=>window.kimiGame?.snapshot().state==='ready');
  const before=(await rows()).length;
  await finish(page,0);
  await page.waitForFunction(()=>document.querySelector('#score-status').textContent==='Enter your name to share your score.');
  assert(await page.locator('#replay').isEnabled());
  assert.equal((await rows()).length,before);
  console.log('Non-qualifying score: no automatic insertion and REPLAY enabled.');
}finally{
  await Promise.all(browsers.map(b=>b.close()));
  server.kill('SIGTERM');
  await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));
  await rm(dir,{recursive:true,force:true});
}
