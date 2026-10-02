import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const origins = [process.env.RSB_TEST_URL, process.env.RSB_TEST_URL_2];
if (origins.some(url => !url || !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(url)) ||
    new Set(origins).size !== 2 || process.env.RSB_TEST_ALLOW_MUTATIONS !== 'yes')
  throw Error('Use two isolated local app instances and set RSB_TEST_URL, RSB_TEST_URL_2 and RSB_TEST_ALLOW_MUTATIONS=yes');
const password = process.env.RSB_TEST_ADMIN_PASSWORD;
if (!password) throw Error('Set RSB_TEST_ADMIN_PASSWORD');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const durations = { state:[], page:[], mutation:[] };
const accepted = new Set();
let expectedConflicts = 0;
async function request(origin,path,{method='GET',body,token,allowed=[200],kind}={}) {
  const start = performance.now();
  const response = await fetch(`${origin}${path}`,{
    method,
    headers:{ ...(token ? { authorization:`Bearer ${token}` } : {}), ...(body ? { 'content-type':'application/json' } : {}) },
    body:body ? JSON.stringify(body) : undefined,
    signal:AbortSignal.timeout(20000),
  });
  const type = response.headers.get('content-type') || '';
  const value = type.includes('application/json') ? await response.json() : await response.text();
  durations[kind || (method === 'POST' ? 'mutation' : path === '/api/state' ? 'state' : 'page')].push(performance.now()-start);
  assert.ok(allowed.includes(response.status),`${method} ${origin}${path}: ${response.status} ${JSON.stringify(value).slice(0,300)}`);
  return { status:response.status, value };
}
const getState = async index => (await request(origins[index],'/api/state')).value;
const post = async (index,path,body,token,allowed=[200]) => request(origins[index],path,{method:'POST',body,token,allowed});
const admin = (await post(0,'/api/login',{password})).value.token;
let state = await getState(0);
assert.equal(state.athletes.length,1827);
assert.equal(state.bouts.length,1258);
assert.equal(state.summary.complete,0);

const rings = ['A','B','C','E','F','G','H','I','J'];
const tokens = {};
for (let i=0;i<rings.length;i++) {
  const ring = rings[i], pin = String(111111+i);
  await post(0,'/api/admin/pin',{ring,pin},admin);
  tokens[ring] = (await post(i%2,'/api/login',{ring,pin})).value.token;
}
await post(0,'/api/admin/pin',{ring:'AWARDS',pin:'333333'},admin);
const awardsToken = (await post(1,'/api/login',{ring:'AWARDS',pin:'333333'})).value.token;

state = await getState(0);
const afterB35 = state.bouts.find(b=>b.day===1&&b.assignedRing==='B'&&b.code==='B35');
assert.ok(afterB35);
assert.equal((await post(1,'/api/admin/transfer',{version:state.version,day:1,sourceRing:'A',targetRing:'B',codePrefix:'A',from:47,to:57,afterBoutId:afterB35.id},admin)).value.count,11);
state = await getState(1);
assert.equal(state.bouts.filter(b=>b.day===1&&b.code[0]==='A'&&Number(b.code.match(/^A(\d+)/)?.[1])>=47&&Number(b.code.match(/^A(\d+)/)?.[1])<=57&&b.assignedRing==='B').length,11);
console.log('PASS cross-instance 11-bout transfer');

const raceBout = state.bouts.find(b=>b.day===1&&b.assignedRing==='E'&&b.status==='READY');
assert.ok(raceBout);
const race = await Promise.all([
  post(0,'/api/admin/result',{boutId:raceBout.id,winnerId:raceBout.blueId,method:'PTF'},tokens.E,[200,409]),
  post(1,'/api/admin/result',{boutId:raceBout.id,winnerId:raceBout.blueId,method:'PTF'},tokens.E,[200,409]),
]);
assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
accepted.add(raceBout.id);
expectedConflicts++;
console.log('PASS duplicate result race across two instances accepts exactly one winner');

const errors = [];
const viewerCount = 24, readsPerViewer = 35;
async function viewer(id) {
  let lastVersion = 0, lastComplete = 0;
  for (let n=0;n<readsPerViewer;n++) {
    try {
      const instance = (id+n)%2;
      if (n%5 === 0) {
        const route = ['/live?day=1','/schedule?day=1','/brackets?day=1','/results?day=1','/awards?day=1'][n/5%5|0];
        const html = (await request(origins[instance],route)).value;
        assert.match(html,/<html/i);
      } else {
        const value = await getState(instance);
        assert.ok(value.version >= lastVersion,`Viewer ${id} saw state version ${value.version} after ${lastVersion}`);
        assert.ok(value.summary.complete >= lastComplete,`Viewer ${id} saw completed count go backwards`);
        assert.equal(new Set(value.bouts.map(b=>b.id)).size,value.bouts.length);
        lastVersion = value.version;
        lastComplete = value.summary.complete;
      }
    } catch (error) { errors.push(`viewer ${id}/${n}: ${error.message}`); }
    await sleep(15+(id*13+n*7)%60);
  }
}

async function coordinator(ring,instance,quota,pace) {
  let done=0, attempts=0;
  while (done<quota && attempts<quota*6) {
    attempts++;
    try {
      const value = await getState((instance+attempts)%2);
      const bout = value.bouts.filter(b=>b.day===1&&b.assignedRing===ring&&b.status==='READY')
        .sort((a,b)=>a.scheduleOrder-b.scheduleOrder)[0];
      if (!bout) break;
      const response = await post(instance,'/api/admin/result',{boutId:bout.id,winnerId:bout.blueId||bout.redId,method:'PTF'},tokens[ring],[200,409]);
      if (response.status===200) { accepted.add(bout.id); done++; }
      else expectedConflicts++;
    } catch (error) { errors.push(`coordinator ${ring}: ${error.message}`); break; }
    await sleep(pace);
  }
  return {ring,done,attempts};
}

async function adminChanges() {
  await sleep(250);
  for (let attempt=0;attempt<100;attempt++) {
    const current = await getState(attempt%2);
    const entries = ['A','C'].map(ring=>{
      const target=current.bouts.find(b=>b.day===1&&b.assignedRing===ring&&b.code[0]===ring&&b.status==='READY'&&b.directIds.length===2&&b.scheduleOrder>55);
      assert.ok(target,`No late target on Ring ${ring}`);
      const previous=current.bouts.find(b=>b.day===1&&b.assignedRing===ring&&b.scheduleOrder===target.scheduleOrder-1);
      assert.ok(previous);
      return {targetBoutId:target.id,sourceAthleteId:target.directIds[0],name:`STRESS ATHLETE ${ring}`,team:'STRESS CLUB',assignedRing:ring,sourceCorner:'B',afterBoutId:previous.id};
    });
    const response=await post(attempt%2,'/api/admin/extra-bouts',{version:current.version,entries},admin,[200,409]);
    if (response.status===200) { assert.equal(response.value.count,2); return response.value.codes; }
    expectedConflicts++;
    await sleep(25);
  }
  throw Error('Admin qualifying batch could not commit during concurrent results');
}

async function awardsWork() {
  await sleep(150);
  const value=await getState(0);
  const group=value.poomsae.find(g=>g.entrants.length===1&&!g.finished);
  assert.ok(group);
  await post(1,'/api/admin/poomsae-scores',{category:group.category,scores:[{code:group.entrants[0].code,score:'9.125'}]},admin);
  const updated=await getState(0);
  const award=updated.awards.find(a=>a.id===group.id);
  assert.equal(award.status,'CALLED');
  await post(1,'/api/admin/award/call',{awardId:award.id},awardsToken);
  await post(0,'/api/admin/award/medal',{awardId:award.id,athleteId:award.medals[0].athleteId,state:'DELIVERED'},awardsToken);
  return award.id;
}

const viewerTasks=Array.from({length:viewerCount},(_,i)=>viewer(i));
const workerTasks=rings.map((ring,i)=>coordinator(ring,i%2,12,20+i*13));
workerTasks.push(coordinator('A',1,8,33));
const [workers,qualifierCodes,awardId]=await Promise.all([
  Promise.all(workerTasks),adminChanges(),awardsWork(),
]);
await Promise.all(viewerTasks);
assert.deepEqual(errors,[]);
state=await getState(0);
const other=await getState(1);
assert.equal(state.version,other.version);
assert.equal(state.summary.complete,other.summary.complete);
assert.ok([...accepted].every(id=>state.bouts.find(b=>b.id===id)?.status==='COMPLETE'));
assert.ok(qualifierCodes.every(code=>state.bouts.some(b=>b.code===code&&b.extra)));
assert.equal(state.awards.find(a=>a.id===awardId).status,'DELIVERED');
assert.equal(state.bouts.filter(b=>b.day===1&&b.code[0]==='A'&&Number(b.code.match(/^A(\d+)/)?.[1])>=47&&Number(b.code.match(/^A(\d+)/)?.[1])<=57&&b.assignedRing==='B').length,11);
assert.equal(state.bouts.length,1260);

const percentile=(values,p)=>values.slice().sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]?.toFixed(0) ?? 'n/a';
console.log(`PASS ${workers.reduce((n,w)=>n+w.done,0)} coordinator results, ${expectedConflicts} expected version/result conflicts, 2 extra athletes, awards updates`);
console.log(`PASS ${viewerCount*readsPerViewer} viewer requests across two instances, no stale or failed views`);
console.log(`Latency ms: state p50=${percentile(durations.state,.5)} p95=${percentile(durations.state,.95)} max=${percentile(durations.state,1)}; mutation p95=${percentile(durations.mutation,.95)} max=${percentile(durations.mutation,1)}`);
console.log(`PASS shared database version ${state.version}, completed ${state.summary.complete}, total bouts ${state.bouts.length}`);
