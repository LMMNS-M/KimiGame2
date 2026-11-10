import { SOUNDS } from './assets.js';
export class AudioManager {
 constructor(){this.context=null;this.buffers=new Map();this.sources=new Set();this.muted=false;this.lastShot=-1;this.data=new Map();this.decoding=new Map();this.generation=0;}
 async preload(){await Promise.all(Object.entries(SOUNDS).map(async([name,url])=>{try{const r=await fetch(url);if(!r.ok)throw Error(url);this.data.set(name,await r.arrayBuffer());if(this.context)await this.decode(name);}catch(e){console.warn('Audio unavailable',name,e);}}));}
 unlock(){
  if(!this.context){this.context=new (window.AudioContext||window.webkitAudioContext)();this.gain=this.context.createGain();this.gain.gain.value=this.muted?0:.65;this.gain.connect(this.context.destination);}
  const resumed=this.context.resume();
  // A rejected resume must be observed even when the browser keeps audio suspended.
  return Promise.allSettled([resumed,...[...this.data.keys()].map(name=>this.decode(name))]);
 }
 decode(name){
  if(!this.decoding.has(name))this.decoding.set(name,new Promise(resolve=>{
   const done=buffer=>{if(buffer)this.buffers.set(name,buffer);resolve();};
   try{
    // Callbacks also support older WebKit implementations without a returned promise.
    const pending=this.context.decodeAudioData(this.data.get(name).slice(0),done,()=>resolve());
    pending?.then(done,()=>resolve());
   }catch{resolve();}
  }));
  return this.decoding.get(name);
 }
 play(name){
  const b=this.buffers.get(name);if(!this.context)return;
  if(!b){
   // Preserve initial button/countdown sounds during quick decoding, never replay stale cues.
   const at=performance.now(),generation=this.generation;
   this.decoding.get(name)?.then(()=>{if(this.buffers.has(name)&&generation===this.generation&&performance.now()-at<150)this.playBuffer(this.buffers.get(name));});
   return;
  }
  this.playBuffer(b);
 }
 playBuffer(b){
  try{const source=this.context.createBufferSource();source.buffer=b;source.connect(this.gain);this.sources.add(source);source.onended=()=>this.sources.delete(source);source.start();}catch{}
 }
 shooting(){let n;do{n=Math.floor(Math.random()*3);}while(n===this.lastShot);this.lastShot=n;this.play(`shooting-star-${n+1}`);}
 stop(){this.generation++;for(const s of this.sources){try{s.stop();}catch{}}this.sources.clear();}
 mute(value){this.muted=value;if(this.gain)this.gain.gain.value=value?0:.65;}
}
