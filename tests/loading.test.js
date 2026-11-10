import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWithin,optional,prepareVideo} from '../js/loading.js';
const never=new Promise(()=>{});
test('ready resources release immediately; failures are optional',async()=>{
 const start=performance.now();
 await loadWithin([()=>Promise.resolve(),()=>Promise.reject(Error()),()=>{throw Error();}]);
 assert.ok(performance.now()-start<300);
});
test('hung resources release at the five second fallback',async()=>{
 const start=performance.now();await loadWithin([()=>never]);
 assert.ok(performance.now()-start>=4900);assert.ok(performance.now()-start<5200);
});
test('play and unlock failures are consumed without awaiting hung playback',async()=>{
 await optional(()=>Promise.reject(Error('NotAllowedError')));
 await optional(()=>{throw Error('NotSupportedError');});
 optional(()=>never);
});
test('metadata preview does not seek after START',()=>{
 const video=new EventTarget();Object.assign(video,{paused:true,readyState:0,currentTime:0});
 const stop=prepareVideo(video);video.readyState=1;video.dispatchEvent(new Event('loadedmetadata'));
 assert.equal(video.currentTime,.001);stop();video.currentTime=8;video.dispatchEvent(new Event('loadedmetadata'));assert.equal(video.currentTime,8);
});

test('playback waits for the first frame and the end of an iPhone seek',async()=>{
 const {waitForPlayback}=await import('../js/loading.js');
 const video=new EventTarget();Object.assign(video,{paused:false,seeking:true,readyState:4});
 let ready=false;const pending=waitForPlayback(video,1000).then(()=>{ready=true;});
 video.dispatchEvent(new Event('playing'));await Promise.resolve();assert.equal(ready,false);
 video.seeking=false;video.dispatchEvent(new Event('seeked'));await pending;assert.equal(ready,true);
});
test('unavailable video rejects instead of starting the countdown',async()=>{
 const {waitForPlayback}=await import('../js/loading.js');
 const video=new EventTarget();
 await assert.rejects(waitForPlayback(video,10),/Video unavailable/);
});
