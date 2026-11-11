import {CONFIG as C} from './config.js';
import {IMAGES, VIDEO} from './assets.js';
import {createTimeline,Score} from './timeline.js';
import {AudioManager} from './audio.js';
import {loadWithin,optional,seekVideo,prepareVideo,waitForPlayback} from './loading.js';
import {resetLeaderboard,beginLeaderboardRun,showLeaderboard,canReplay} from './leaderboard.js';
import {initializeStatistics,gameStarted,gameComplete,track} from './statistics.js';
const $=id=>document.getElementById(id);
const STORAGE_KEY=new URLSearchParams(location.search).has('test')?'kimi-wishes-test-best':'kimi-wishes-best';
export function art(name){
 const a=IMAGES[name],el=document.createElement('div');el.className='art';const [x,y,r,b]=a.box,w=r-x,h=b-y;
 el.style.aspectRatio=`${w}/${h}`;const img=new Image();img.src=a.src;img.alt='';img.draggable=false;
 Object.assign(img.style,{width:`${a.width/w*100}%`,height:`${a.height/h*100}%`,left:`${-x/w*100}%`,top:`${-y/h*100}%`});el.append(img);return el;
}
for(const el of document.querySelectorAll('[data-art]'))el.append(art(el.dataset.art));
$('game').style.setProperty('--play-area',`${C.PLAY_AREA_RATIO*100}%`);
$('game').style.setProperty('--hitbox-size',`${11*C.HITBOX_SCALE}cqw`);
// The PNG is 15% smaller than its current 87.5% rendering. The hitbox is
// independently based on 161% of the original 11cqw visual reference.
$('game').style.setProperty('--visual-ratio',`${87.5*.85/C.HITBOX_SCALE}%`);
const video=$('background'),audio=new AudioManager();video.src=VIDEO;video.volume=.8;
const stopPreview=prepareVideo(video);
let lastRedFlash=-Infinity;
function flashRed(now){
 // One soft pulse per catch, with a short cooldown for near-simultaneous reds.
 if(now-lastRedFlash<400)return;
 lastRedFlash=now;
 const overlay=$('red-flash');overlay.classList.remove('hit');void overlay.offsetWidth;overlay.classList.add('hit');
}
let state='loading',score=new Score(),timeline=[],cursor=0,active=new Map(),effects=[],epoch=0,goAt=0,endAt=0,lastCount=-1,hurry=false,newRecord=false,recordShown=false,best=0,priorBest=0,run=0,width=0,height=0;
try{best=Math.max(0,Math.trunc(Number(localStorage.getItem(STORAGE_KEY)))||0);}catch{}
$('best-value').textContent=best;
new ResizeObserver(()=>{width=$('game').clientWidth;height=$('playfield').clientHeight;}).observe($('game'));
function bindButton(id,normal,pressed,sound,action){
 const button=$(id),n=art(normal),p=art(pressed);n.classList.add('normal-art');p.classList.add('pressed-art');button.append(n,p);
 button.addEventListener('pointerdown',()=>{if(!button.disabled)button.classList.add('pressed');});
 for(const event of ['pointerup','pointercancel','pointerleave'])button.addEventListener(event,()=>button.classList.remove('pressed'));
 button.addEventListener('click',async()=>{if(button.disabled)return;button.disabled=true;button.classList.add('pressed');try{await action(sound);}finally{button.disabled=false;button.classList.remove('pressed');}});
}
function syncScore(){$('score').textContent=score.value;$('best-value').textContent=Math.max(best,score.value);}
function comboBreak(){audio.play('combo-break');$('combo').className='leave';effects.push({until:performance.now()+180,done:()=>{$('combo').hidden=!score.combo;}});}
function reset(){
 $('red-flash').classList.remove('hit');lastRedFlash=-Infinity;
 resetLeaderboard();
 audio.stop();active.clear();effects=[];$('playfield').replaceChildren();score=new Score();timeline=createTimeline();cursor=0;hurry=false;lastCount=-1;recordShown=false;priorBest=best;newRecord=false;
 for(const id of ['end-screen','record','announcement','countdown','combo','resume'])$(id).hidden=true;
 $('combo').className='';$('timer').classList.remove('urgent');$('time-fill').style.transform='scaleX(1)';$('next-message').textContent='';syncScore();
}
async function start(sound){
 if(!canReplay())return;
 reset();run++;state='starting';$('game').dataset.scene='start';$('start-screen').hidden=false;$('loading').textContent='Loading the stars…';
 // Both media activation calls originate in the button gesture, before awaiting anything.
 stopPreview();optional(()=>audio.unlock());seekVideo(video,0);video.muted=audio.muted;
 const ready=waitForPlayback(video);
 optional(()=>video.play(),()=>video.dispatchEvent(new Event('error')));
 try{await ready;}catch{
  video.pause();state='ready';$('loading').textContent='Video unavailable. Tap START to try again.';return;
 }
 $('loading').textContent='';$('game').dataset.scene='playing';
 beginLeaderboardRun();audio.play(sound);epoch=performance.now();goAt=epoch+3000;state='countdown';$('start-screen').hidden=true;$('veil').classList.add('clear');$('hud').hidden=false;$('timer').hidden=false;$('sound').hidden=false;
 gameStarted();
}
bindButton('start','start-game-normal','start-game-pressed','button-start',start);
function returnToStart(sound){
 if(!canReplay())return;
 track('replay_clicked');
 reset();state='ready';epoch=goAt=endAt=0;
 video.pause();seekVideo(video,0);
 $('game').dataset.scene='start';$('start-screen').hidden=false;
 $('veil').classList.remove('clear');
 for(const id of ['hud','timer','sound'])$(id).hidden=true;
 $('timer').setAttribute('aria-valuenow',String(C.GAME_DURATION));
 $('loading').textContent='';$('start').disabled=false;
 optional(()=>audio.unlock());audio.play(sound);
}
bindButton('replay','replay-normal','replay-pressed','button-replay',returnToStart);
bindButton('next','continue-normal','continue-pressed','button-continue',async sound=>{await audio.unlock();audio.play(sound);onNext();});
export function onNext(){
 // Set NEXT_URL in config.js, or listen for this event in the host project.
 const result={score:score.value,best,attempts:run,replays:Math.max(0,run-1)};
 if(typeof window.onStarsGameComplete==='function')window.onStarsGameComplete(result);
 window.dispatchEvent(new CustomEvent('stars-game-complete',{detail:result}));
 const event=new CustomEvent('kimi:next',{detail:result,cancelable:true});
 if(!window.dispatchEvent(event))return;
 if(C.NEXT_URL)window.location.assign(C.NEXT_URL);
 else $('next-message').textContent='More to come… ✨ Play again to collect even more wishes.';
}
$('sound').addEventListener('click',()=>{audio.mute(!audio.muted);video.muted=audio.muted;$('sound').textContent=audio.muted?'♪̸':'♪';$('sound').setAttribute('aria-label',audio.muted?'Unmute sound':'Mute sound');});
function count(n){$('countdown').hidden=false;$('countdown').textContent=n===3?'GO!':String(3-n);$('countdown').className='';void $('countdown').offsetWidth;$('countdown').className='pop';audio.play(n===3?'countown-go':'countdown-beep');}
function warning(event){const node=document.createElement('div');node.className='warning';node.style.left=`${event.x*100}%`;$('playfield').append(node);active.set(event.id,{event,node,falling:false});}
function fall(item){item.node.remove();const node=document.createElement('div');node.className=`star ${item.event.type}`;node.dataset.id=item.event.id;node.append(art(`${item.event.type}-star`));$('playfield').append(node);item.node=node;item.falling=true;audio.shooting();}
function expire(item){item.node.remove();active.delete(item.event.id);audio.play('star-ground-hit');if(score.miss(item.event.type))comboBreak();}
function catchStar(item,now){
 if(state!=='playing'||now>=goAt+C.GAME_DURATION*1000||!item.falling||!active.has(item.event.id))return;
 const elapsed=(now-goAt)/1000;if(elapsed<item.event.at||elapsed>=item.event.at+C.STAR_FALL_DURATION)return;
 active.delete(item.event.id);item.node.remove();const result=score.catch(item.event.type);syncScore();
 if(item.event.type==='red')flashRed(now);
 audio.play(item.event.type==='red'?'red-star-cach':`${item.event.type}-star-catch`);
 if(result.bonus)audio.play('combo-bonus');if(result.broken)comboBreak();
 if(result.activated){audio.play('combo-activate');$('combo').hidden=false;$('combo').className='enter';}
 const text=document.createElement('div');text.className=`feedback ${item.event.type}`;text.textContent=`${result.delta>0?'+':''}${result.delta}`;text.style.left=`${item.event.x*100}%`;text.style.top=`${item.y}px`;$('playfield').append(text);effects.push({until:now+500,done:()=>text.remove()});
}
$('playfield').addEventListener('pointerdown',event=>{
 event.preventDefault();const bounds=$('playfield').getBoundingClientRect();if(event.clientY<bounds.top||event.clientY>=bounds.bottom)return;
 const node=event.target.closest('.star');if(!node)return;const item=active.get(Number(node.dataset.id));if(item)catchStar(item,performance.now());
});
function announce(kind){$('announcement').replaceChildren(art(kind==='hurry'?'hurry-up':'time-up'));$('announcement').className='';$('announcement').setAttribute('aria-label',kind==='hurry'?'HURRY UP!':'TIME UP!');$('announcement').hidden=false;}
function finish(){state='ending';gameComplete(score.value,Math.max(best,score.value));showLeaderboard(score.value);endAt=goAt+C.GAME_DURATION*1000;for(const item of active.values())item.node.remove();active.clear();$('countdown').hidden=true;$('time-fill').style.transform='scaleX(0)';announce('time');audio.play('time-up');newRecord=score.value>priorBest;if(newRecord){best=score.value;try{localStorage.setItem(STORAGE_KEY,String(best));}catch{}}}
function showResult(){state='result';$('game').dataset.scene='result';$('hud').hidden=true;$('timer').hidden=true;$('announcement').hidden=true;$('final-score').textContent=score.value;$('end-screen').hidden=false;audio.play('end-screen');}
function tick(now){
 effects=effects.filter(e=>{if(now>=e.until){e.done();return false;}return true;});
 if(state==='countdown'){
  const n=Math.min(3,Math.floor((now-epoch)/1000));if(n!==lastCount){lastCount=n;count(n);}if(now>=goAt)state='playing';
 }
 if(state==='playing'){
  const elapsed=(now-goAt)/1000;
  if(elapsed>=C.GAME_DURATION)finish();else{
   if(elapsed>.7)$('countdown').hidden=true;
   $('time-fill').style.transform=`scaleX(${1-elapsed/C.GAME_DURATION})`;$('timer').setAttribute('aria-valuenow',String(Math.ceil(C.GAME_DURATION-elapsed)));
   if(elapsed>=C.HURRY_UP_AT&&!hurry){hurry=true;track('hurry_up');announce('hurry');audio.play('hurry-up');$('timer').classList.add('urgent');}
   if(hurry&&elapsed>=C.HURRY_UP_AT+1.4)$('announcement').hidden=true;
   while(cursor<timeline.length&&elapsed>=timeline[cursor].at-C.WARNING_DURATION)warning(timeline[cursor++]);
   for(const item of active.values()){
    const age=elapsed-item.event.at;
    if(age>=C.STAR_FALL_DURATION){expire(item);continue;}
    if(age>=0){if(!item.falling)fall(item);const p=age/C.STAR_FALL_DURATION,size=width*.11*C.HITBOX_SCALE;item.y=height*.05+(height-height*.05-size*.42)*p;item.node.style.transform=`translate(${item.event.x*width-size/2}px,${item.y-size/2}px) scale(${1-.17*p})`;item.node.firstChild.style.transform=`rotate(${item.event.rotation*p}deg)`;}
   }
  }
 }
 if(state==='ending'&&now>=endAt+1250)showResult();
 if(state==='result'&&newRecord&&!recordShown&&now>=endAt+1850){recordShown=true;$('record').hidden=false;audio.play('new-best-score');}
 requestAnimationFrame(tick);
}
// A backgrounded tab consumes real time, avoiding a paused-clock exploit. Audio is silenced while hidden.
document.addEventListener('visibilitychange',()=>{if(document.hidden){optional(()=>audio.context?.suspend());video.pause();}else if(['countdown','playing','ending','result'].includes(state)){
 const target=Math.min((performance.now()-epoch)/1000,Number.isFinite(video.duration)?video.duration:Infinity);seekVideo(video,target);
 if(!Number.isFinite(video.duration)||target<video.duration)optional(()=>video.play(),()=>{$('resume').hidden=false;});optional(()=>audio.context?.resume(),()=>{$('resume').hidden=false;});
}});
$('resume').addEventListener('click',()=>{optional(()=>audio.unlock());optional(()=>Promise.resolve(video.play()).then(()=>{$('resume').hidden=true;}));});
async function init(){
 // Reuse TarnStarGame's iPhone-tested loading: media may preload metadata only.
 await Promise.all(['start','result'].map(name=>{const img=new Image();img.src=`assets/images/backgrounds/${name}.webp`;return img.decode().catch(()=>{});}));
 await loadWithin([
  ()=>audio.preload(),
  ...Object.values(IMAGES).map(a=>()=>new Promise(resolve=>{const img=new Image();img.onload=img.onerror=resolve;img.src=a.src;}))
 ]);
 if(state==='loading'){
  state='ready';$('loading').textContent='';$('start').disabled=false;
 }
}
requestAnimationFrame(tick);init();
// Read-only diagnostics for integration checks, with no way to alter game time or score.
export async function startStarsGame(){
 if(state==='loading'||state==='starting'||state==='countdown'||state==='playing')return false;
 await start('button-start');
 return state==='countdown';
}
window.startStarsGame=startStarsGame;
window.kimiGame={
 start:startStarsGame,
 snapshot:()=>({state,score:score.value,combo:score.combo,best,run,planned:timeline.map(e=>({...e})),active:active.size,elapsed:goAt?(performance.now()-goAt)/1000:0})
};
initializeStatistics(window.kimiGame.snapshot);
