import {AudioManager} from '../js/audio.js';
const panel=document.createElement('pre');panel.id='test-report';Object.assign(panel.style,{position:'fixed',top:'0',left:'0',fontSize:'11px',background:'#000d',color:'#bfffc8',zIndex:100,pointerEvents:'none',maxWidth:'240px',whiteSpace:'pre-wrap'});document.body.append(panel);
const checks=[],sounds=[],errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
let completionCallback=null,completionEvent=null;
window.onStarsGameComplete=result=>{completionCallback=result;};
window.addEventListener('stars-game-complete',event=>{completionEvent=event.detail;});
const original=AudioManager.prototype.play;AudioManager.prototype.play=function(name){sounds.push({name,at:performance.now()});return original.call(this,name);};
const check=(name,ok)=>{checks.push({name,ok:!!ok});panel.textContent=checks.map(c=>`${c.ok?'✓':'✗'} ${c.name}`).join('\n');};
let round=0,previousState='',firstPlan='',firstScore=0,firstBest=0,startingBest=0,seen=new Set(),doubleChecked=false,singleChecked=false,freezeScore=0,finished=false;
function tap(node,id){const r=node.getBoundingClientRect();node.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:id,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));}
function loop(){
 if(finished)return;
 const s=window.kimiGame?.snapshot();if(!s){requestAnimationFrame(loop);return;}
 if(s.state==='countdown'&&previousState!==s.state){
  round++;startingBest=s.best;seen=new Set();check(`Partie ${round} : remise à zéro`,s.score===0&&!s.combo&&s.active===0);
  if(round===1)firstPlan=JSON.stringify(s.planned);else {check('Replay conserve le record',s.best===firstBest);check('Replay randomise',JSON.stringify(s.planned)!==firstPlan);}
  check(`Partie ${round} : pool 60/8/12`,s.planned.length===80&&s.planned.filter(e=>e.type==='white').length===60&&s.planned.filter(e=>e.type==='gold').length===8&&s.planned.filter(e=>e.type==='red').length===12);
  check('Interface de lancement exposée',typeof window.startStarsGame==='function'&&window.kimiGame.start===window.startStarsGame);
  const final=s.planned.filter(e=>e.at>=45);
  const starts=[...new Set(final.map(e=>e.at))];
  const rainOk=final[0].at>=45.6&&final.every(e=>final.filter(x=>x.at<=e.at&&e.at-x.at<1).length<=4)&&starts.every(at=>{const positives=final.filter(e=>e.at===at&&e.type!=='red');if(positives.length>2)return false;if(positives.length<2)return true;const next=final.find(e=>e.at>at&&e.type!=='red');return !next||next.at-at>=.4;});
  check(`Partie ${round} : pluie finale contrainte`,rainOk);
 }
 if(s.state==='playing'){
  const visible=[...document.querySelectorAll('.star')].filter(n=>!n.classList.contains('red'));
  const nodes=visible.filter(n=>s.elapsed-s.planned.find(e=>e.id===Number(n.dataset.id)).at>=.72);
  if(!seen.has('geometry')&&visible.length){
   seen.add('geometry');const star=visible[0],png=star.firstChild,w=document.querySelector('#game').clientWidth;
   check('Hitbox 161 %, PNG −15 %',Math.abs(parseFloat(getComputedStyle(star).width)/w-.1771)<.001&&Math.abs(parseFloat(getComputedStyle(png).width)/parseFloat(getComputedStyle(star).width)-.875*.85/1.61)<.002);
   check('Traînée légèrement allongée',Math.abs(parseFloat(getComputedStyle(star,'::before').height)/w-.42)<.001&&getComputedStyle(star,'::before').opacity==='0.58');
   check('Compteurs −25 %',Math.abs(document.querySelector('#wishes').offsetWidth/w-.24)<.003&&Math.abs(document.querySelector('#best').offsetWidth/w-.21)<.003);
  }
  if(s.combo&&!seen.has('combo-animation')){
   seen.add('combo-animation');const el=document.querySelector('#combo');
   check('Combo final −50 %, animation 0,9 s',Math.abs(el.offsetWidth/document.querySelector('#game').clientWidth-.1472)<.003&&getComputedStyle(el).animationDuration==='0.9s');
  }
  // Capture two different pointer IDs in the same task; repeated pointer must not score twice.
  if(visible.length>=2&&!doubleChecked){const before=s.score;tap(visible[0],11);const one=window.kimiGame.snapshot().score;tap(visible[1],12);const two=window.kimiGame.snapshot().score;check('Deux pointeurs simultanés',one>before&&two>one);doubleChecked=true;}
  for(const node of nodes){if(!node.isConnected)continue;tap(node,21);if(!singleChecked){const value=window.kimiGame.snapshot().score;tap(node,21);check('Capture non comptée deux fois',window.kimiGame.snapshot().score===value);singleChecked=true;}}
  // Observe the timer committed by the game frame, not a later performance.now() sample.
  if(Number(document.querySelector('#timer').getAttribute('aria-valuenow'))<=15&&!seen.has('hurry')){seen.add('hurry');check(`Partie ${round} : Hurry à 45 s`,document.querySelector('#announcement').getAttribute('aria-label')==='HURRY UP!'&&document.querySelector('#announcement img')?.getAttribute('src')==='assets/images/hud/hurry-up.png');}
  if(s.score<0&&!seen.has('negative')){seen.add('negative');check('Score toujours positif',false);}
 }
 if(s.state==='ending'&&previousState!==s.state){freezeScore=s.score;check(`Partie ${round} : fin à 60 s`,s.elapsed>=60&&s.elapsed<60.2);check('Étoiles supprimées',s.active===0&&document.querySelectorAll('.star').length===0);const v=document.querySelector('video');check('Vidéo continue après TIME UP',!v.paused&&!v.ended);}
 if(s.state==='result'&&s.elapsed>62&&previousState!=='checked-result'){
  check(`Partie ${round} : score figé`,s.score===freezeScore);check('Score final affiché',Number(document.querySelector('#final-score').textContent)===s.score);
  const beeps=sounds.filter(x=>x.name==='countdown-beep');check(`Partie ${round} : trois bips`,beeps.length===round*3);const b=beeps.slice(-3);check('Espacement des bips ≈ 1 s',b.length===3&&b.slice(1).every((v,i)=>Math.abs(v.at-b[i].at-1000)<100));check('GO une seule fois',sounds.filter(x=>x.name==='countown-go').length===round);check('Bonus audio superposé',sounds.some((v,i)=>v.name==='combo-bonus'&&v.at-sounds[i-1].at<20));
  check('Record conditionnel',document.querySelector('#record').hidden===(s.score<=startingBest));
  if(round===1){firstScore=s.score;firstBest=s.best;previousState='checked-result';document.querySelector('#replay').click();
   const home=window.kimiGame.snapshot();
   check('Replay revient à START sans compte à rebours',home.state==='ready'&&home.score===0&&home.active===0&&!home.combo&&home.elapsed===0&&!document.querySelector('#start-screen').hidden&&document.querySelector('#countdown').hidden);
   check('Replay remet la vidéo en pause',document.querySelector('video').paused);
   setTimeout(()=>document.querySelector('#start').click(),300);
   requestAnimationFrame(loop);return;}
  check('Aucune erreur JavaScript',errors.length===0);document.querySelector('#next').click();
  setTimeout(()=>{
   check('Résultat d’intégration complet',completionCallback?.score===s.score&&completionCallback?.best===s.best&&completionCallback?.attempts===2&&completionCallback?.replays===1&&completionEvent?.attempts===2);
   check('Deux parties complètes',round===2);finished=true;panel.dataset.complete='true';panel.dataset.passed=String(checks.every(c=>c.ok));window.browserTestReport={checks,errors,sounds,final:s,completionCallback,completionEvent};
  },0);return;
 }
 previousState=s.state;requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
