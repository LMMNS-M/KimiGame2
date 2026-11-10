// End-to-end checks use a disposable SQLite database, never the live leaderboard.
import {chromium, webkit, devices} from 'playwright';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'kimi-browser-'));
const port = process.env.KIMI_TEST_PORT || '8082';
const url = `http://127.0.0.1:${port}`;
const server = spawn('.venv/bin/gunicorn', ['--bind', `127.0.0.1:${port}`, '--workers', '1', '--threads', '4', 'server:create_app()'], {
  env: {...process.env, KIMI_DATABASE: join(directory, 'test.sqlite3')}, stdio: ['ignore', 'ignore', 'pipe'],
});
let serverLog = '';
server.stderr.on('data', data => { serverLog += data; });
const browsers = [];
try {
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null) throw Error(serverLog);
    try { ready = (await fetch(`${url}/api/health`)).ok; } catch {}
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, 'Test server started');
  const chrome = await chromium.launch({executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', headless: true});
  browsers.push(chrome);
  const safari = await webkit.launch({headless: true});
  browsers.push(safari);
  await Promise.all([
    (async () => {
      const page = await chrome.newPage({viewport: {width: 390, height: 844}, hasTouch: true});
      const errors = []; page.on('pageerror', e => errors.push(String(e)));
      await page.goto(`${url}/?test`);
      await page.waitForFunction(() => window.kimiGame?.snapshot().state === 'ready');
      await page.locator('#start').click();
      await page.waitForFunction(() => document.querySelector('#background').videoWidth > 0);
      await page.waitForFunction(() => document.querySelector('#test-report')?.dataset.complete === 'true', {}, {timeout: 150000});
      const report = await page.evaluate(() => window.browserTestReport.checks);
      assert.deepEqual(report.filter(c => !c.ok), []);
      assert.deepEqual(errors, []);
      console.log(`Chrome: ${report.length} checks passed across two full games.`);
    })(),
    (async () => {
      const page = await safari.newPage({...devices['iPhone 13']});
      const errors = []; page.on('pageerror', e => errors.push(String(e)));
      await page.goto(url);
      await page.waitForFunction(() => window.kimiGame?.snapshot().state === 'ready');
      await page.locator('#start').tap();
      await page.waitForFunction(() => document.querySelector('video').videoWidth === 1080);
      await page.evaluate(() => {
        function collect() {
          if (window.kimiGame.snapshot().state === 'result') return;
          for (const node of document.querySelectorAll('.star:not(.red)')) {
            const r = node.getBoundingClientRect();
            node.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerType: 'touch', pointerId: 1, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2}));
          }
          requestAnimationFrame(collect);
        }
        collect();
      });
      await page.waitForFunction(() => window.kimiGame.snapshot().state === 'result', {}, {timeout: 75000});
      await page.locator('#player-name').fill('Étoile iPhone');
      await page.locator('#save-score').tap();
      await page.waitForFunction(() => document.querySelector('#score-status').textContent.includes('Score enregistré'));
      const score = await page.evaluate(() => window.kimiGame.snapshot().score);
      const entries = (await (await fetch(`${url}/api/leaderboard`)).json()).leaderboard;
      assert.equal(entries.length, 1, 'Test mode did not publish scores');
      assert.equal(entries[0].name, 'Étoile iPhone');
      assert.equal(entries[0].score, score);
      assert.ok(score > 0);
      assert.equal(await page.locator('#next').isVisible(), false);
      await page.screenshot({path: '/tmp/kimi-iphone-result.png'});
      for (const viewport of [{width: 320, height: 568}, {width: 390, height: 664}]) {
        await page.setViewportSize(viewport);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.locator('#replay').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#replay').isVisible(), true);
      }
      await page.locator('#replay').tap();
      await page.waitForFunction(() => window.kimiGame.snapshot().state === 'countdown');
      assert.equal(await page.evaluate(() => window.kimiGame.snapshot().score), 0);
      assert.deepEqual(errors, []);
      console.log(`WebKit/iPhone: video, full game (${score} points), save to SQLite, responsive result and replay passed.`);
      // Safari restrictions: missing metadata, pending play(), unavailable AudioContext.
      const fallback = await safari.newPage({...devices['iPhone 13']});
      await fallback.route('**/assets/video/**', route => route.abort());
      await fallback.addInitScript(() => {
        HTMLMediaElement.prototype.play = function () { return new Promise(() => {}); };
        window.AudioContext = undefined; window.webkitAudioContext = undefined;
      });
      await fallback.goto(url);
      await fallback.waitForFunction(() => window.kimiGame?.snapshot().state === 'ready', {}, {timeout: 10000});
      await fallback.locator('#start').tap();
      await fallback.waitForFunction(() => window.kimiGame.snapshot().state === 'playing', {}, {timeout: 5000});
      console.log('WebKit: game starts despite unavailable video and audio.');
    })(),
  ]);
} finally {
  await Promise.all(browsers.map(browser => browser.close()));
  server.kill('SIGTERM');
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
  await rm(directory, {recursive: true, force: true});
}
