import {test} from 'node:test';import assert from 'node:assert/strict';import {createTimeline,Score} from '../js/timeline.js';
test('1000 parties : pool, phases, pré-signaux, groupes équitables',()=>{for(let k=0;k<1000;k++){const t=createTimeline();assert.equal(t.length,80);for(const [type,n] of [['white',60],['gold',8],['red',12]])assert.equal(t.filter(e=>e.type===type).length,n);assert.ok(t.filter(e=>e.at>=45&&e.type==='gold').length>=3);assert.ok(t.every(e=>e.at>=.5&&e.at+1<60));assert.deepEqual([0,15,30,45].map(a=>t.filter(e=>e.at>=a&&e.at<a+15).length),[12,17,21,30]);for(const e of t)for(const other of t){if(e.id!==other.id&&Math.abs(e.at-other.at)<1)assert.ok(Math.abs(e.x-other.x)>.18);}}});
test('combo, score plancher à zéro et étoiles ratées',()=>{
 const zero=new Score();
 assert.equal(zero.catch('red').delta,-1);
 assert.equal(zero.value,0);
 const s=new Score();
 assert.equal(s.catch('white').delta,1);
 assert.equal(s.catch('red').delta,-1);
 assert.equal(s.value,0);
 assert.equal(s.catch('white').delta,1);
 assert.equal(s.catch('gold').delta,3);
 assert.equal(s.catch('white').activated,true);
 assert.equal(s.catch('gold').delta,6);
 assert.equal(s.catch('white').delta,2);
 assert.equal(s.miss('red'),false);
 assert.equal(s.combo,true);
 assert.equal(s.catch('red').delta,-1);
 assert.equal(s.combo,false);
 assert.equal(s.streak,0);
 s.catch('white');s.catch('white');s.catch('white');
 assert.equal(s.miss('gold'),true);
 assert.equal(s.combo,false);
 assert.equal(s.value,15);
});
test('replay randomise les séquences',()=>{assert.notDeepEqual(createTimeline(),createTimeline());});

test('tous les chemins correspondent aux fichiers réels', async()=>{
 const {IMAGES,SOUNDS,VIDEO}=await import('../js/assets.js');
 const {access}=await import('node:fs/promises');
 assert.equal(Object.keys(IMAGES).length,18);
 assert.equal(Object.keys(SOUNDS).length,19);
 await Promise.all([...Object.values(IMAGES).map(a=>a.src),...Object.values(SOUNDS),VIDEO].map(path=>access(new URL('../'+path,import.meta.url))));
});

test('départs décalés avant 45 s, pluie finale et rotations lentes',()=>{
 for(let run=0;run<1000;run++){
  const timeline=createTimeline();
  const normal=timeline.filter(e=>e.at<45);
  const gaps=normal.slice(1).map((e,i)=>e.at-normal[i].at);
  assert.ok(gaps.every(gap=>gap>=.5));
  assert.ok(gaps.filter(gap=>gap>=.5&&gap<=.7).length>=18);
  assert.ok(timeline.some((e,i)=>i>0&&e.at>=45&&e.at===timeline[i-1].at));
  assert.ok(timeline.every(e=>Number.isFinite(e.x)&&Math.abs(e.rotation)>=60&&Math.abs(e.rotation)<=120));
 }
});

test('pluie finale jouable après HURRY UP',()=>{
 for(let run=0;run<5000;run++){
  const timeline=createTimeline();
  const final=timeline.filter(event=>event.at>=45);
  assert.equal(final.length,30);
  assert.ok(final[0].at>=45.6);
  assert.ok(final.at(-1).at+1<60);
  for(const event of final){
   const visible=final.filter(other=>other.at<=event.at&&event.at-other.at<1);
   assert.ok(visible.length<=4);
  }
  for(const at of new Set(final.map(event=>event.at))){
   const group=final.filter(event=>event.at===at);
   const positives=group.filter(event=>event.type!=='red');
   assert.ok(positives.length<=2);
   if(positives.length===2){
    const next=final.find(event=>event.at>at&&event.type!=='red');
    assert.ok(!next||next.at-at>=.4);
   }
  }
 }
});
