import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const origins=[process.env.RSB_TEST_URL,process.env.RSB_TEST_URL_2];
if(origins.some(url=>!url||!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(url))||new Set(origins).size!==2||process.env.RSB_TEST_ALLOW_MUTATIONS!=='yes')
  throw Error('This test requires two distinct isolated local instances and RSB_TEST_ALLOW_MUTATIONS=yes');
if(!process.env.RSB_TEST_ADMIN_PASSWORD)throw Error('Set RSB_TEST_ADMIN_PASSWORD');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const metrics=[];
async function call(i,path,body,token){
  const start=performance.now();
  const response=await fetch(origins[i]+path,{method:body?'POST':'GET',headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const value=await response.json();
  metrics.push(performance.now()-start);
  assert.equal(response.status,200,`${path}: ${response.status} ${JSON.stringify(value).slice(0,300)}`);
  return value;
}
const token=(await call(0,'/api/login',{ring:'AWARDS',pin:'333333'})).token;
let stop=false,views=0;
const viewers=Array.from({length:12},(_,i)=>(async()=>{
  while(!stop){await call(i%2,'/api/state');views++;await sleep(500+i*40);}
})());
let categories=0,medals=0;
try{
  const deadline=Date.now()+5*60*1000;
  while(Date.now()<deadline){
    const state=await call(categories%2,'/api/state');
    const pending=state.awards.filter(a=>a.finished&&!a.autoRing&&a.status!=='DELIVERED');
    if(!pending.length)break;
    const award=pending[0];
    await call(categories%2,'/api/admin/award/call',{awardId:award.id},token);
    for(const medal of award.medals.filter(m=>m.state!=='DELIVERED'&&m.state!=='ABSENT')){
      await call(medals%2,'/api/admin/award/medal',{awardId:award.id,athleteId:medal.athleteId,state:'DELIVERED'},token);
      medals++;
    }
    categories++;
  }
  const left=(await call(1,'/api/state')).awards.filter(a=>a.finished&&!a.autoRing&&a.status!=='DELIVERED');
  assert.equal(left.length,0,`${left.length} podium categories unresolved`);
  console.log(`PASS remaining ${categories} podium categories, ${medals} medals, with ${views} concurrent viewer reads`);
}finally{stop=true;await Promise.all(viewers);}
const ordered=metrics.sort((a,b)=>a-b);
console.log(`Request latency p95=${ordered[Math.ceil(ordered.length*.95)-1]?.toFixed(0)}ms max=${ordered.at(-1)?.toFixed(0)}ms`);
