import assert from 'node:assert/strict';

const origin = process.env.RSB_TEST_URL;
if (!origin || !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin) || process.env.RSB_TEST_ALLOW_MUTATIONS !== 'yes')
  throw Error('Use an isolated local test database and set RSB_TEST_URL plus RSB_TEST_ALLOW_MUTATIONS=yes');
const password = process.env.RSB_TEST_ADMIN_PASSWORD;
if (!password) throw Error('Set RSB_TEST_ADMIN_PASSWORD');

async function request(path, { method='GET', token, body, expected=200 }={}) {
  const response = await fetch(`${origin}${path}`, {
    method, headers:{ ...(token ? { authorization:`Bearer ${token}` } : {}), ...(body ? { 'content-type':'application/json' } : {}) },
    body:body ? JSON.stringify(body) : undefined,
  });
  const contentType = response.headers.get('content-type') || '';
  const value = contentType.includes('application/json') ? await response.json() : await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value).slice(0,300)}`);
  return value;
}
const post = (path,body,token,expected=200) => request(path,{ method:'POST', body, token, expected });
const state = () => request('/api/state');
const login = async (ring,pin) => (await post('/api/login',{ ring,pin })).token;
const admin = (await post('/api/login',{ password })).token;
assert.equal((await request('/healthz')).ok,true);

for (const route of ['/','/live','/schedule','/brackets','/results','/awards','/awards/history','/admin','/admin/bouts','/admin/awards','/admin/awards/history','/admin/transfer','/admin/qualifying','/admin/staff-pins','/admin/poomsae-pro']) {
  const html = await request(route);
  assert.match(html,/<html/i,route);
}
console.log('PASS distinct public and admin routes');

let data = await state();
assert.equal(data.athletes.length,1827);
assert.equal(data.bouts.length,1258);
assert.equal(data.poomsae.length,36);
assert.ok(data.bouts.some(b => b.event === 'TEAM SPARRING'));
assert.ok(data.bouts.some(b => b.status === 'WAITING'));
console.log('PASS seeded Day 1, Day 2, Pro, Team Sparring and waiting bouts');

assert.equal((await request('/api/admin/session',{token:admin})).role,'admin');
assert.equal((await request('/api/admin/session',{expected:401})).error,'Sign in to manage bouts');
await post('/api/admin/pin',{ring:'A',pin:'111111'},admin);
await post('/api/admin/pin',{ring:'B',pin:'222222'},admin);
await post('/api/admin/pin',{ring:'AWARDS',pin:'333333'},admin);
const ringA = await login('A','111111');
const ringB = await login('B','222222');
const awardsToken = await login('AWARDS','333333');
assert.equal((await request('/api/admin/session',{token:ringA})).ring,'A');
console.log('PASS staff PINs, roles and authentication');

data = await state();
const boutA = data.bouts.find(b => b.day === 1 && b.assignedRing === 'A' && b.status === 'READY');
const boutB = data.bouts.find(b => b.day === 1 && b.assignedRing === 'B' && b.status === 'READY');
assert.ok(boutA && boutB);
await post('/api/admin/result',{boutId:boutA.id,winnerId:boutA.blueId,method:'PTF'},ringB,403);
await post('/api/admin/result',{boutId:boutA.id,winnerId:boutA.blueId,method:'PTF'},awardsToken,403);
const day2 = data.bouts.find(b => b.day === 2 && b.status === 'READY');
assert.ok(day2);
await post('/api/admin/result',{boutId:day2.id,winnerId:day2.blueId,method:'PTF'},ringA,403);
const beforeConcurrent = data.version;
await Promise.all([
  post('/api/admin/result',{boutId:boutA.id,winnerId:boutA.blueId,method:'PTF'},ringA),
  post('/api/admin/result',{boutId:boutB.id,winnerId:boutB.blueId,method:'PTF'},ringB),
]);
data = await state();
assert.equal(data.version,beforeConcurrent+2);
assert.equal(data.bouts.find(b => b.id === boutA.id).winnerId,boutA.blueId);
assert.equal(data.bouts.find(b => b.id === boutB.id).winnerId,boutB.blueId);
await post('/api/admin/undo',{boutId:boutA.id,reason:'Integration test'},ringA);
await post('/api/admin/undo',{boutId:boutB.id,reason:'Integration test'},ringB);
console.log('PASS concurrent ring results, isolation, Day 2 lock and undo');

data = await state();
const pro = data.poomsae.find(g => g.entrants.length === 1 && !g.finished);
assert.ok(pro);
await post('/api/admin/poomsae-scores',{category:pro.category,scores:[{code:pro.entrants[0].code,score:'10.001'}]},admin,400);
await post('/api/admin/poomsae-scores',{category:pro.category,scores:[{code:pro.entrants[0].code,score:'9.500'}]},admin);
data = await state();
assert.equal(data.poomsae.find(g => g.id === pro.id).entrants[0].rank,1);
const award = data.awards.find(a => a.id === pro.id);
assert.equal(award.status,'CALLED');
assert.equal(award.medals[0].medal,'Gold');
await post('/api/admin/award/call',{awardId:award.id},awardsToken);
await post('/api/admin/award/medal',{awardId:award.id,athleteId:award.medals[0].athleteId,state:'DELIVERED'},awardsToken);
data = await state();
assert.equal(data.awards.find(a => a.id === pro.id).status,'DELIVERED');
console.log('PASS mark validation, automatic ranks, award call and delivery');
await post('/api/admin/poomsae-undo',{version:data.version,code:pro.entrants[0].code},admin);
data = await state();
assert.equal(data.poomsae.find(g => g.id === pro.id).entrants[0].score,null);
assert.equal(data.awards.find(a => a.id === pro.id).status,'NOT_CALLED');
const proAdded = await post('/api/admin/poomsae-entries',{version:data.version,entries:[{category:pro.category,name:'TEST POOMSAE ATHLETE',team:'TEST CLUB'}]},admin);
assert.equal(proAdded.count,1);
data = await state();
assert.ok(data.poomsae.find(g => g.id === pro.id).entrants.some(e => e.code === proAdded.codes[0] && e.name === 'TEST POOMSAE ATHLETE'));
console.log('PASS Poomsae Pro mark revoke and late athlete entry');

const source = data.bouts.find(b => b.day === 1 && b.assignedRing === 'A' && b.code.startsWith('A') && b.status === 'READY');
const destination = data.bouts.find(b => b.day === 1 && b.assignedRing === 'B');
assert.ok(source && destination);
const number = Number(source.code.match(/^A(\d+)/)[1]);
await post('/api/admin/transfer',{version:data.version,day:1,sourceRing:'A',targetRing:'B',codePrefix:'A',from:number,to:number,afterBoutId:destination.id},admin);
data = await state();
assert.equal(data.bouts.find(b => b.id === source.id).assignedRing,'B');
assert.equal(data.bouts.find(b => b.id === source.id).code,source.code);
console.log('PASS bulk transfer preserves bout code and changes assigned ring');

const transferBlock = data.bouts.filter(b => b.day === 1 && b.assignedRing === 'A' && b.code[0] === 'A' &&
  Number(b.code.match(/^A(\d+)/)?.[1]) >= 47 && Number(b.code.match(/^A(\d+)/)?.[1]) <= 57).sort((a,b) => a.scheduleOrder-b.scheduleOrder);
const afterB35 = data.bouts.find(b => b.day === 1 && b.assignedRing === 'B' && b.code === 'B35');
assert.equal(transferBlock.length,11);
assert.ok(afterB35);
await post('/api/admin/transfer',{version:data.version,day:1,sourceRing:'A',targetRing:'B',codePrefix:'A',from:47,to:57,afterBoutId:afterB35.id},admin);
data = await state();
const moved = transferBlock.map(b => data.bouts.find(current => current.id === b.id));
assert.ok(moved.every(b => b.assignedRing === 'B'));
assert.deepEqual(moved.map(b => b.code),transferBlock.map(b => b.code));
assert.deepEqual(moved.map(b => b.scheduleOrder),Array.from({length:11},(_,i) => data.bouts.find(b => b.id === afterB35.id).scheduleOrder+i+1));
const transferredReady = moved.find(b => b.status === 'READY');
assert.ok(transferredReady);
await post('/api/admin/result',{boutId:transferredReady.id,winnerId:transferredReady.blueId,method:'PTF'},ringA,403);
await post('/api/admin/result',{boutId:transferredReady.id,winnerId:transferredReady.blueId,method:'PTF'},ringB);
await post('/api/admin/undo',{boutId:transferredReady.id,reason:'Transfer audit'},ringB);
console.log('PASS A47–A57 transfer after B35, original codes, order and ring permissions');

data = await state();
const candidate = data.bouts.find(b => b.day === 1 && b.status === 'READY' && b.directIds.length && b.scheduleOrder > 0 && b.assignedRing === b.code[0]);
assert.ok(candidate);
const preceding = data.bouts.find(b => b.day === candidate.day && b.assignedRing === candidate.assignedRing && b.scheduleOrder === candidate.scheduleOrder-1);
assert.ok(preceding);
const qualifier = await post('/api/admin/extra-bouts',{version:data.version,entries:[{
  targetBoutId:candidate.id,sourceAthleteId:candidate.directIds[0],name:'TEST QUALIFIER',team:'TEST CLUB',
  assignedRing:candidate.assignedRing,sourceCorner:'B',afterBoutId:preceding.id,
}]},admin);
assert.equal(qualifier.count,1);
data = await state();
const extra = data.bouts.find(b => b.code === qualifier.codes[0]);
assert.ok(extra);
assert.ok(extra.scheduleOrder < data.bouts.find(b => b.id === candidate.id).scheduleOrder);
assert.ok(data.athletes.some(a => a.name === 'TEST QUALIFIER'));
assert.match(await request('/api/export.csv'),/TEST QUALIFIER/);
console.log('PASS qualifying bout insertion, bracket feed and CSV export');

const dualTarget = data.bouts.find(b => b.id !== candidate.id && b.day === 1 && b.status === 'READY' && b.directIds.length === 2 &&
  b.scheduleOrder > 0 && b.assignedRing === b.code[0]);
assert.ok(dualTarget);
const dualAnchor = data.bouts.find(b => b.day === dualTarget.day && b.assignedRing === dualTarget.assignedRing && b.scheduleOrder === dualTarget.scheduleOrder-1);
assert.ok(dualAnchor);
const dual = await post('/api/admin/extra-bouts',{version:data.version,entries:dualTarget.directIds.map((sourceAthleteId,i) => ({
  targetBoutId:dualTarget.id,sourceAthleteId,name:`TEST QUALIFIER ${i+2}`,team:'TEST CLUB',
  assignedRing:dualTarget.assignedRing,sourceCorner:'B',afterBoutId:dualAnchor.id,
}))},admin);
assert.equal(dual.count,2);
assert.equal(new Set(dual.codes).size,2);
data = await state();
const dualBouts = dual.codes.map(code => data.bouts.find(b => b.code === code && b.day === dualTarget.day && b.event === dualTarget.event));
assert.ok(dualBouts.every(Boolean));
assert.deepEqual(dualBouts.map(b => b.scheduleOrder),[dualAnchor.scheduleOrder+1,dualAnchor.scheduleOrder+2]);
assert.equal(data.bouts.find(b => b.id === dualTarget.id).status,'WAITING');
for (const added of dualBouts) await post('/api/admin/result',{boutId:added.id,winnerId:added.blueId,method:'PTF'},admin);
data = await state();
assert.equal(data.bouts.find(b => b.id === dualTarget.id).status,'READY');
console.log('PASS staged qualifiers save together, stay ordered and feed their destination match');

data = await state();
const medalBout = data.bouts.find(b => b.stage === 0 && b.status === 'READY' && b.event.includes('KYORUGI') &&
  data.bouts.filter(other => other.day === b.day && other.event === b.event && other.category === b.category && other.code[0] === b.code[0]).length === 1);
assert.ok(medalBout);
await post('/api/admin/result',{boutId:medalBout.id,winnerId:medalBout.blueId,method:'PTF'},admin);
data = await state();
let medalAward = data.awards.find(a => a.finalCode === medalBout.code && a.event === medalBout.event && a.category === medalBout.category);
assert.ok(medalAward && medalAward.medals.length);
for (const medal of medalAward.medals)
  await post('/api/admin/award/medal',{awardId:medalAward.id,athleteId:medal.athleteId,state:'DELIVERED'},awardsToken);
data = await state();
assert.equal(data.awards.find(a => a.id === medalAward.id).status,'DELIVERED');
await post('/api/admin/undo',{boutId:medalBout.id,reason:'Correct result'},admin);
await post('/api/admin/result',{boutId:medalBout.id,winnerId:medalBout.blueId,method:'PTF'},admin);
data = await state();
medalAward = data.awards.find(a => a.id === medalAward.id);
assert.equal(medalAward.status,'CALLED');
assert.ok(medalAward.medals.every(m => m.state === 'PENDING'));
console.log('PASS revoked Kyorugi result clears old medal delivery before replay');

assert.ok((await request('/api/admin/audit',{token:admin})).length > 0);
console.log(`PASS complete integration suite, final database version ${data.version}`);
