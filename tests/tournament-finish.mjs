import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const origins=[process.env.RSB_TEST_URL,process.env.RSB_TEST_URL_2];
if (origins.some(url=>!url||!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(url))||
    new Set(origins).size!==2||process.env.RSB_TEST_ALLOW_MUTATIONS!=='yes')
  throw Error('Use two isolated local app instances and set RSB_TEST_URL, RSB_TEST_URL_2 and RSB_TEST_ALLOW_MUTATIONS=yes');
const password=process.env.RSB_TEST_ADMIN_PASSWORD;
if(!password)throw Error('Set RSB_TEST_ADMIN_PASSWORD');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const timings={read:[],write:[]};
async function request(instance,path,{method='GET',body,token,allowed=[200]}={}){
  const start=performance.now();
  const response=await fetch(origins[instance]+path,{method,
    headers:{...(token?{authorization:`Bearer ${token}`}:{}) ,...(body?{'content-type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  const type=response.headers.get('content-type')||'';
  const value=type.includes('application/json')?await response.json():await response.text();
  timings[method==='POST'?'write':'read'].push(performance.now()-start);
  assert.ok(allowed.includes(response.status),`${method} ${path}: ${response.status} ${JSON.stringify(value).slice(0,300)}`);
  return {status:response.status,value};
}
const state=async (i=0)=>(await request(i,'/api/state')).value;
const post=(i,path,body,token,allowed)=>(request(i,path,{method:'POST',body,token,allowed}));
const admin=(await post(0,'/api/login',{password})).value.token;
let data=await state();
assert.equal(data.bouts.length,1260);
assert.ok(data.summary.complete>=100&&data.summary.complete<500);
const tokens={};
const ringList=['A','B','C','D','E','F','G','H','I','J'];
for(let n=0;n<ringList.length;n++){
  const ring=ringList[n],pin=ring==='D'?'555555':String(111111+[...['A','B','C','E','F','G','H','I','J']].indexOf(ring));
  if(ring==='D')await post(0,'/api/admin/pin',{ring,pin},admin);
  tokens[ring]=(await post(n%2,'/api/login',{ring,pin})).value.token;
}
const awardsToken=(await post(1,'/api/login',{ring:'AWARDS',pin:'333333'})).value.token;

const day2Ready=data.bouts.find(b=>b.day===2&&b.status==='READY'&&b.assignedRing==='A');
assert.ok(day2Ready);
await post(0,'/api/admin/result',{boutId:day2Ready.id,winnerId:day2Ready.blueId,method:'PTF'},tokens.A,[403]);

const proWorker=(async()=>{
  let count=0;
  const initial=await state(1);
  for(const group of initial.poomsae.filter(g=>!g.finished)){
    const scores=group.entrants.map((e,i)=>({code:e.code,score:(9.600-i*0.019).toFixed(3)}));
    await post(count%2,'/api/admin/poomsae-scores',{category:group.category,scores},tokens.D);
    count++;
    await sleep(35);
  }
  return count;
})();

let stopViewers=false;
const viewerStats={reads:0,errors:[]};
const viewers=Array.from({length:12},(_,id)=>(async()=>{
  let lastVersion=0;
  while(!stopViewers){
    try{
      const current=await state((id+viewerStats.reads)%2);
      assert.ok(current.version>=lastVersion,`Viewer ${id} saw version rollback`);
      lastVersion=current.version;
      viewerStats.reads++;
    }catch(error){viewerStats.errors.push(`Viewer ${id}: ${error.message}`);}
    await sleep(700+id*50);
  }
})());

const awardStats={categories:0,medals:0,errors:[]};
let stopAwards=false;
const awardsWorker=(async()=>{
  const handled=new Set();
  while(!stopAwards){
    try{
      const current=await state(1);
      const batch=current.awards.filter(a=>a.finished&&!a.autoRing&&a.status!=='DELIVERED'&&!handled.has(a.id)).slice(0,12);
      for(const award of batch){
        await post(awardStats.categories%2,'/api/admin/award/call',{awardId:award.id},awardsToken);
        for(const medal of award.medals){
          await post(awardStats.medals%2,'/api/admin/award/medal',{awardId:award.id,athleteId:medal.athleteId,state:'DELIVERED'},awardsToken);
          awardStats.medals++;
        }
        handled.add(award.id);
        awardStats.categories++;
      }
    }catch(error){awardStats.errors.push(error.message);break;}
    await sleep(200);
  }
})();

async function finishRing(day,ring,instance,pace){
  let saved=0,conflicts=0,idle=0;
  const deadline=Date.now()+8*60*1000;
  while(Date.now()<deadline){
    const current=await state((instance+saved+idle)%2);
    const all=current.bouts.filter(b=>b.day===day&&b.assignedRing===ring);
    const pending=all.filter(b=>!['COMPLETE','BYE'].includes(b.status));
    if(!pending.length)return {ring,day,saved,conflicts};
    const next=pending.filter(b=>b.status==='READY').sort((a,b)=>a.scheduleOrder-b.scheduleOrder)[0];
    if(!next){idle++;await sleep(75+pace);continue;}
    const result=await post(instance,'/api/admin/result',{boutId:next.id,winnerId:next.blueId||next.redId,method:'PTF'},tokens[ring],[200,409]);
    if(result.status===200)saved++;
    else conflicts++;
    await sleep(pace);
  }
  throw Error(`Ring ${ring} Day ${day} did not finish before timeout`);
}

async function finishDay(day){
  const rings=day===1?ringList.filter(r=>r!=='D'):ringList;
  const results=await Promise.all(rings.map((ring,i)=>finishRing(day,ring,i%2,10+i*8)));
  const current=await state(0);
  assert.ok(current.bouts.filter(b=>b.day===day).every(b=>['COMPLETE','BYE'].includes(b.status)));
  console.log(`PASS concurrent Day ${day} rings: ${results.reduce((n,r)=>n+r.saved,0)} results, ${results.reduce((n,r)=>n+r.conflicts,0)} expected conflicts`);
  return results;
}

try{
  await finishDay(1);
  const proCount=await proWorker;
  data=await state(1);
  assert.ok(data.poomsae.every(g=>g.finished));
  console.log(`PASS Ring D coordinator scored ${proCount} remaining Poomsae Pro categories`);
  await post(0,'/api/admin/result',{boutId:day2Ready.id,winnerId:day2Ready.blueId,method:'PTF'},tokens.A);
  await finishDay(2);
  let unresolved=1;
  for(let i=0;i<1200&&unresolved&&!awardStats.errors.length;i++){
    data=await state(i%2);
    unresolved=data.awards.filter(a=>a.finished&&!a.autoRing&&a.status!=='DELIVERED').length;
    if(unresolved)await sleep(250);
  }
  assert.deepEqual(awardStats.errors,[]);
  assert.equal(unresolved,0,'Awards desk did not resolve every finished podium category');
  data=await state(0);
  const other=await state(1);
  assert.equal(data.version,other.version);
  assert.ok(data.bouts.every(b=>['COMPLETE','BYE'].includes(b.status)));
  assert.ok(data.awards.every(a=>a.finished&&['DELIVERED','DELIVERED_IN_RING'].includes(a.status)));
  console.log(`PASS all ${data.bouts.length} bouts and ${data.awards.length} award categories resolved across both instances`);
  console.log(`PASS ${awardStats.categories} podium calls, ${awardStats.medals} medals recorded by awards worker`);
}finally{
  stopViewers=true;
  stopAwards=true;
  await Promise.all(viewers);
  await awardsWorker;
}
assert.deepEqual(viewerStats.errors,[]);
const percentile=(values,p)=>values.slice().sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]?.toFixed(0)??'n/a';
console.log(`PASS ${viewerStats.reads} live viewer polls with no stale or failed state`);
console.log(`Latency ms: reads p95=${percentile(timings.read,.95)} max=${percentile(timings.read,1)}; writes p95=${percentile(timings.write,.95)} max=${percentile(timings.write,1)}`);
