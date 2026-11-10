// Media is optional: neither a missing event nor a pending promise owns the game clock.
export function optional(task,onError=()=>{}){
 try{return Promise.resolve(task()).catch(onError);}catch(error){onError(error);return Promise.resolve();}
}
export function loadWithin(tasks,timeout=5000){
 return new Promise(resolve=>{
  const timer=setTimeout(resolve,timeout);
  Promise.allSettled(tasks.map(task=>optional(task))).then(()=>{clearTimeout(timer);resolve();});
 });
}
export function seekVideo(video,time){try{video.currentTime=time;}catch{}}
export function prepareVideo(video){
 // A tiny seek can request a decoded frame in WebViews which only preload metadata.
 // No autoplay, no dependency on this frame, and no late seek after START.
 let preview=true;
 const showFrame=()=>{if(preview&&video.paused&&video.readyState>=1)seekVideo(video,.001);};
 video.addEventListener('loadedmetadata',showFrame);
 showFrame();
 return ()=>{preview=false;video.removeEventListener('loadedmetadata',showFrame);};
}

// Subscribe before play() so mobile playback events cannot be missed.
export function waitForPlayback(video, timeout=15000){
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);video.removeEventListener('playing',ready);video.removeEventListener('seeked',ready);video.removeEventListener('error',failed);};
  const ready=()=>{if(video.readyState>=2&&!video.seeking&&!video.paused){cleanup();resolve();}};
  const failed=()=>{cleanup();reject(new Error('Video unavailable'));};
  const timer=setTimeout(failed,timeout);
  video.addEventListener('playing',ready);
  video.addEventListener('seeked',ready);
  video.addEventListener('error',failed);
 });
}
