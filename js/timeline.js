import { CONFIG as C } from './config.js';
export function shuffle(list, random=Math.random) {
 const a=[...list]; for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a;
}
export function createTimeline(random=Math.random) {
 // Four 15-second phases: 12, 17, 21 and 30 stars. Reserve three golds for the finale.
 const pool=shuffle([...Array(C.WHITE_STAR_COUNT).fill('white'),...Array(C.GOLD_STAR_COUNT-3).fill('gold'),...Array(C.RED_STAR_COUNT).fill('red')],random);
 const early=pool.splice(0,50); const late=shuffle([...pool,'gold','gold','gold'],random);
 const colors=[...early,...late];
 const groups=[[1,1,2,1,1,1,2,1,1,1],[1,2,1,2,1,2,1,2,1,2,2],[2,1,2,2,2,2,2,2,2,2,2],[2,3,2,3,2,3,2,3,2,3,2,3]];
 const times=[];
 groups.forEach((sizes,phase)=>{
  const start=phase*15+.65+(random()-.5)*.16;
  const end=phase===3?58.3:phase*15+14.2+(random()-.5)*.16;
  if(phase===3){
   // The final shower starts after HURRY UP and is scheduled independently.
   // A batch may contain at most two positives, while no more than four
   // one-second falls may overlap. The finished schedule is stretched across
   // the remaining time to retain a dense but non-mechanical rhythm.
   const finalColors=colors.slice(50);
   const batches=[];
   let pending=[...finalColors];
   while(pending.length){
    const roll=random();
    const target=roll<.12?3:roll<.47?2:1;
    const batch=[];
    for(let i=0;i<target&&pending.length;i++){
     let pick=Math.floor(random()*pending.length);
     const positives=batch.filter(type=>type!=='red').length;
     if(positives>=2){
      const redIndex=pending.indexOf('red');
      if(redIndex<0)break;
      pick=redIndex;
     }
     batch.push(pending.splice(pick,1)[0]);
    }
    batches.push(batch);
   }
   const raw=[];
   let at=C.HURRY_UP_AT+.6+random()*.12;
   let lastDoublePositive=-Infinity;
   for(const batch of batches){
    const positiveCount=batch.filter(type=>type!=='red').length;
    if(at-lastDoublePositive<.4&&positiveCount)at=lastDoublePositive+.4+random()*.08;
    while(raw.filter(event=>at-event.at<1.1).length+batch.length>4){
     at=raw.find(event=>at-event.at<1.1).at+1.105;
    }
    for(const type of batch)raw.push({type,at});
    if(positiveCount===2)lastDoublePositive=at;
    at+=.28+random()*.24;
   }
   const first=raw[0].at,last=raw.at(-1).at,targetEnd=58.15+random()*.2;
   const stretch=(targetEnd-first)/(last-first);
   for(const event of raw)event.at=first+(event.at-first)*stretch;
   // Replace the final colors too, since batch construction randomized them.
   raw.forEach((event,index)=>{colors[50+index]=event.type;times.push(event.at);});
   return;
  }
  // Stagger each former pair by 0.5–0.7 s. Spread the remaining time
  // between groups, retaining the original 12 / 17 / 21 / 30 distribution.
  const closeGaps=sizes.map(size=>Array.from({length:size-1},()=>.5+random()*.2));
  const closeTotal=closeGaps.flat().reduce((sum,gap)=>sum+gap,0);
  const weights=Array.from({length:sizes.length-1},()=>.9+random()*.2);
  const totalWeight=weights.reduce((sum,weight)=>sum+weight,0);
  const available=end-start-closeTotal;
  let at=start;
  sizes.forEach((size,g)=>{
   times.push(at);
   for(const gap of closeGaps[g]){at+=gap;times.push(at);}
   if(g<weights.length) at+=available*weights[g]/totalWeight;
  });
 });
 const events=[];
 times.sort((a,b)=>a-b).forEach((at,index)=>{
  // Reserve different lanes for all overlapping falls, including phase boundaries.
  const recent=events.filter(e=>at-e.at<1.1).map(e=>e.lane);
  const lane=shuffle([0,1,2,3,4],random).find(l=>!recent.includes(l));
  const rotation=(random()<.5?-1:1)*(60+random()*60);
  events.push({id:index,type:colors[index],at,lane,x:.12+lane*.19,rotation});
 });
 return events.sort((a,b)=>a.at-b.at);
}
export class Score {
 constructor(){this.value=0;this.streak=0;this.combo=false;}
 break(){const active=this.combo;this.streak=0;this.combo=false;return active;}
 catch(type){
  if(type==='red'){const broken=this.break();this.value=Math.max(0,this.value-1);return {delta:-1,broken,bonus:false,activated:false};}
  const bonus=this.combo;const delta=(type==='gold'?3:1)*(bonus?2:1);this.value+=delta;
  this.streak++;const activated=!this.combo&&this.streak>=C.COMBO_REQUIRED;if(activated)this.combo=true;
  return {delta,bonus,activated,broken:false};
 }
 miss(type){return type==='red'?false:this.break();}
}
