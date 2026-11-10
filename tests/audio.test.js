import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioManager} from '../js/audio.js';
import {optional} from '../js/loading.js';
test('late audio is decoded after unlock; rejected resume is handled',async()=>{
 const oldWindow=globalThis.window,oldFetch=globalThis.fetch;
 let release;const gate=new Promise(resolve=>{release=resolve;});
 globalThis.window={AudioContext:class{
  createGain(){return {gain:{},connect(){}};}
  resume(){return Promise.reject(Error('NotAllowedError'));}
  decodeAudioData(data,done){done({decoded:true});}
 }};
 globalThis.fetch=async()=>{await gate;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};};
 try{
  const audio=new AudioManager(),loading=audio.preload();await audio.unlock();assert.equal(audio.buffers.size,0);
  release();await loading;assert.ok(audio.buffers.size>0);
 }finally{globalThis.window=oldWindow;globalThis.fetch=oldFetch;}
});
test('unsupported AudioContext is optional',async()=>{
 const previous=globalThis.window;globalThis.window={};
 try{await optional(()=>new AudioManager().unlock());}finally{globalThis.window=previous;}
});
test('a cue queued during decoding plays once without recursive play calls',async()=>{
 const previous=globalThis.window;let complete,played=0;
 globalThis.window={AudioContext:class{
  createGain(){return {gain:{},connect(){}};}
  resume(){return Promise.resolve();}
  decodeAudioData(data,done){complete=done;}
  createBufferSource(){return {connect(){},start(){played++;}};}
 }};
 try{
  const audio=new AudioManager();audio.data.set('cue',new ArrayBuffer(1));const unlocked=audio.unlock();
  audio.play('cue');complete({});await unlocked;await Promise.resolve();assert.equal(played,1);
 }finally{globalThis.window=previous;}
});
