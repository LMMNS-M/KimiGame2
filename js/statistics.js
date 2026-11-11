import {API_BASE_URL} from './server-config.js';
const $ = id => document.getElementById(id);
const disabled = new URLSearchParams(location.search).has('test');
const KEY = 'kimi-statistics-v1', QUEUE = 'kimi-statistics-queue-v1';
const uid = () => crypto.randomUUID();
const read = (key, fallback) => {try{return JSON.parse(localStorage.getItem(key)) ?? fallback;}catch{return fallback;}};
const write = (key, value) => {try{localStorage.setItem(key, JSON.stringify(value));}catch{}};
let preference = read(KEY, null), queue = read(QUEUE, []), visit = uid(), game = null;
let busy = false, retries = 0, retryTimer, pageRecorded = false, active = 0, visitActive = 0, lastTick = performance.now();
let elapsed = 0, score = null, best = null, gameRunning = false, getSnapshot;
let wasVisible = !document.hidden;
const categories = ['visits','gameplay','scores','device','geo'];
if (!disabled) {
  if (!preference || typeof preference !== 'object') {
    preference = {allow:true,visits:true,gameplay:true,scores:true,device:true,geo:true,visitor:uid(),secret:uid(),source:'default'};
  } else {
    // A previously expressed refusal or location choice is never overwritten.
    for (const key of categories) if (typeof preference[key] !== 'boolean') preference[key] = key !== 'geo';
    if (preference.allow) {preference.visitor ||= uid();preference.secret ||= uid();}
  }
  write(KEY,preference);
}
let activeRequest;
function filtered(event) {
  if (!allowed()) return null;
  const gameEvent = ['game_start','hurry_up','game_complete','game_interrupted','game_abandoned','progress','replay_clicked'].includes(event.kind);
  const scoreEvent = ['score_qualified','score_saved'].includes(event.kind);
  if ((gameEvent && !preference.gameplay) || (scoreEvent && !preference.scores) || (!gameEvent && !scoreEvent && !preference.visits)) return null;
  const e = {...event,geo_consent:!!preference.geo};
  if (!preference.device) Object.assign(e,{device:'unknown',os:'unknown',browser:'unknown'});
  if (!preference.scores) Object.assign(e,{score:null,best:null,name:null,score_id:null});
  if (!preference.gameplay) Object.assign(e,{elapsed:0,active:0});
  if (!preference.gameplay && !preference.scores) e.game_id = null;
  if (!preference.visits) e.visit_active = 0;
  return e;
}
const ua = navigator.userAgent;
const info = {
  device: /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints>1) ? 'tablet' : /Mobi|iPhone|Android/.test(ua) ? 'smartphone' : 'computer',
  os: /iPad|iPhone/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints>1) ? 'iOS' : /Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Mac/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'unknown',
  browser: /Edg/.test(ua)?'Edge':/Firefox|FxiOS/.test(ua)?'Firefox':/Chrome|CriOS/.test(ua)?'Chrome':/Safari/.test(ua)?'Safari':'unknown'
};
function allowed(){return !disabled && preference?.allow === true;}
export function scoreContext(){
  if(!allowed()||!preference.scores||!game)return null;
  return {visitor:preference.visitor,visit_id:visit,game_id:game,
    elapsed:preference.gameplay?elapsed:0,active:preference.gameplay?active:0,
    visit_active:preference.visits?visitActive:0,best,
    ...(preference.device?info:{device:'unknown',os:'unknown',browser:'unknown'})};
}
export function scoreConfirmed(kind,entry,context){
  if(!allowed()||!context||context.visitor!==preference.visitor)return;
  const {visitor,...fields}=context;
  const event={...fields,event_id:`${kind}-${entry.id}-${context.game_id}`,kind,occurred:Date.now()/1000,
    elapsed:60,active:Math.min(60,fields.active),score:entry.score,name:entry.name||null,score_id:entry.id,
    visible:!document.hidden,geo_consent:!!preference.geo};
  queue.push({visitor_id:preference.visitor,secret:preference.secret,consent:true,event});trimQueue();flush();
}
function trimQueue(){
  if (!Array.isArray(queue)) queue=[];
  queue=queue.filter(item=>item?.event?.occurred>Date.now()/1000-7*86400).map(item=>({...item,event:filtered(item.event)})).filter(item=>item.event).slice(-400);
  write(QUEUE,queue);
}
async function send(path, body){
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),3000);
  if (!path) activeRequest = controller;
  try{
    const response=await fetch(`${API_BASE_URL}/api/statistics${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal,keepalive:true});
    if(!response.ok){const error=new Error('Not confirmed by the server. Please try again.');error.status=response.status;throw error;}
    return await response.json();
  }finally{clearTimeout(timeout);if(activeRequest===controller)activeRequest=null;}
}
async function flush(){
  if(!allowed()||busy||retries>=8)return;
  busy=true;trimQueue();
  try{
    while(queue.length && allowed()){
      const item=queue[0];
      try{await send('',item);}catch(error){
        if([400,403].includes(error.status)){queue=queue.filter(p=>p.event.event_id!==item.event.event_id);trimQueue();continue;}
        throw error;
      }
      queue=queue.filter(p=>p.event.event_id!==item.event.event_id);trimQueue();
    }
    retries=0;
  }catch{retryTimer=setTimeout(flush,Math.min(300000,2000*2**retries++));}
  finally{busy=false;}
}
function measure(){
  const now=performance.now(),delta=Math.min(15,(now-lastTick)/1000);lastTick=now;
  const s=getSnapshot?.();
  if(wasVisible){visitActive+=delta;if(gameRunning && s?.state==='playing')active+=delta;}
  wasVisible = !document.hidden;
  if(gameRunning&&s){elapsed=Math.max(elapsed,Math.min(60,Math.max(0,s.elapsed)));score=s.score;best=Math.min(165,s.best);}
  active=Math.min(active,elapsed);
}
export function track(kind,extra={}){
  if(!allowed())return;
  measure();
  queue.push({visitor_id:preference.visitor,secret:preference.secret,consent:true,event:{
    event_id:uid(),visit_id:visit,game_id:game,kind,occurred:Date.now()/1000,
    elapsed,active,visit_active:visitActive,score,best,visible:!document.hidden,
    geo_consent:!!preference.geo,...info,...extra
  }});
  trimQueue();flush();
}
function pageView(){
  if(!allowed()||pageRecorded)return;
  pageRecorded=true;track('page_view');
  if(performance.getEntriesByType('navigation')[0]?.type==='reload'){
    track('page_reload');
    // A previous in-progress game in this same tab is evidence of interruption.
    let previous;try{previous=JSON.parse(sessionStorage.getItem('kimi-active-game'));}catch{}
    if(previous?.visitor===preference.visitor && previous.running && Date.now()-previous.at<7*86400000){
      queue.push({visitor_id:preference.visitor,secret:preference.secret,consent:true,event:{...previous.event,event_id:uid(),kind:'game_interrupted',occurred:Date.now()/1000}});
      trimQueue();flush();
    }
  }
  try{sessionStorage.removeItem('kimi-active-game');}catch{}
}
export function gameStarted(){
  game=uid();elapsed=active=0;score=0;gameRunning=true;lastTick=performance.now();
  track('game_start');
}
export function gameComplete(value,record){
  measure();elapsed=60;score=value;best=Math.min(165,record);track('game_complete');gameRunning=false;
  try{sessionStorage.removeItem('kimi-active-game');}catch{}
}
function checkpoint(){
  if(!allowed())return;
  track(gameRunning?'progress':'visibility');
  if(gameRunning && preference.gameplay){
    const event=filtered({visit_id:visit,game_id:game,elapsed,active,visit_active:visitActive,score,best,visible:!document.hidden,geo_consent:!!preference.geo,...info,kind:'progress'});
    try{sessionStorage.setItem('kimi-active-game',JSON.stringify({visitor:preference.visitor,running:true,at:Date.now(),event}));}catch{}
  }
}
export function initializeStatistics(snapshot){
  getSnapshot=snapshot;
  if(disabled)return;
  trimQueue();pageView();flush();
  setInterval(()=>{if(gameRunning||!document.hidden)checkpoint();},10000);
}
function updateControls() {
  $('privacy-enabled').checked = !!preference?.allow;
  for (const key of categories) {
    $('privacy-'+key).checked = !!preference?.[key];
    $('privacy-'+key).disabled = !preference?.allow;
  }
}
function saveChoices() {
  activeRequest?.abort();
  preference = {...preference,allow:$('privacy-enabled').checked,source:'choice',updated_at:Date.now()};
  for (const key of categories) preference[key] = $('privacy-'+key).checked;
  if (preference.allow) {preference.visitor ||= uid();preference.secret ||= uid();}
  write(KEY,preference);trimQueue();clearTimeout(retryTimer);retries=0;
  if (!preference.allow || !preference.gameplay) {try{sessionStorage.removeItem('kimi-active-game');}catch{}}
  updateControls();$('privacy-status').textContent='Preferences saved.';
  pageView();flush();
}
$('privacy-open').addEventListener('click',()=>{
  $('privacy-info').hidden = !$('privacy-info').hidden;
  $('privacy-open').setAttribute('aria-expanded',String(!$('privacy-info').hidden));
});
$('privacy-info').addEventListener('click',()=>{
  updateControls();$('privacy-info').hidden=true;$('privacy-open').setAttribute('aria-expanded','false');
  $('privacy-status').textContent='';$('privacy-dialog').showModal();
});
$('privacy-close').addEventListener('click',()=>$('privacy-dialog').close());
$('privacy-enabled').addEventListener('change',()=>{
  if ($('privacy-enabled').checked) for (const key of categories) $('privacy-'+key).checked=true;
  saveChoices();
});
for (const key of categories) $('privacy-'+key).addEventListener('change',saveChoices);
$('privacy-delete').addEventListener('click',async()=>{
  const previous=preference;preference={...preference,allow:false,geo:false};write(KEY,preference);queue=[];trimQueue();clearTimeout(retryTimer);activeRequest?.abort();updateControls();
  if(!previous?.visitor){$('privacy-status').textContent='No statistics identifier is stored.';return;}
  try{while(busy)await new Promise(resolve=>setTimeout(resolve,50));await send('/delete',{visitor_id:previous.visitor,secret:previous.secret});preference={allow:false};write(KEY,preference);$('privacy-status').textContent='Your statistics have been deleted. Public scores are unchanged.';}
  catch{$('privacy-status').textContent='Deletion is not confirmed. Try again when connected.';}
});
window.addEventListener('online',()=>{retries=0;clearTimeout(retryTimer);flush();});
document.addEventListener('visibilitychange',checkpoint);
window.addEventListener('pagehide',()=>{checkpoint();track('visit_end');});
