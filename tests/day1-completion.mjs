import assert from 'node:assert/strict';

const origin = process.env.RSB_TEST_URL;
if (!origin || !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin) || process.env.RSB_TEST_ALLOW_MUTATIONS !== 'yes')
  throw Error('Use a disposable local database and set RSB_TEST_URL plus RSB_TEST_ALLOW_MUTATIONS=yes');
const password = process.env.RSB_TEST_ADMIN_PASSWORD;
if (!password) throw Error('Set RSB_TEST_ADMIN_PASSWORD');

async function request(path, { method='GET', token, body, expected=200 }={}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers:{ ...(token ? { authorization:`Bearer ${token}` } : {}), ...(body ? { 'content-type':'application/json' } : {}) },
    body:body ? JSON.stringify(body) : undefined,
  });
  const type = response.headers.get('content-type') || '';
  const value = type.includes('application/json') ? await response.json() : await response.text();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(value).slice(0,350)}`);
  return value;
}
const post = (path,body,token,expected=200) => request(path,{ method:'POST', body, token, expected });
const state = () => request('/api/state');
const admin = (await post('/api/login',{ password })).token;
let data = await state();
assert.equal(data.athletes.length,1827);
assert.equal(data.bouts.length,1258);
assert.equal(data.summary.complete,0);

await post('/api/admin/pin',{ring:'A',pin:'111111'},admin);
await post('/api/admin/pin',{ring:'B',pin:'222222'},admin);
await post('/api/admin/pin',{ring:'AWARDS',pin:'333333'},admin);
const ringA = (await post('/api/login',{ring:'A',pin:'111111'})).token;
const ringB = (await post('/api/login',{ring:'B',pin:'222222'})).token;
const awardsToken = (await post('/api/login',{ring:'AWARDS',pin:'333333'})).token;

data = await state();
const block = data.bouts.filter(b => b.day === 1 && b.assignedRing === 'A' && b.code[0] === 'A' &&
  Number(b.code.match(/^A(\d+)/)?.[1]) >= 47 && Number(b.code.match(/^A(\d+)/)?.[1]) <= 57).sort((a,b) => a.scheduleOrder-b.scheduleOrder);
const afterB35 = data.bouts.find(b => b.day === 1 && b.assignedRing === 'B' && b.code === 'B35');
assert.equal(block.length,11);
assert.ok(afterB35);
const transfer = await post('/api/admin/transfer',{version:data.version,day:1,sourceRing:'A',targetRing:'B',codePrefix:'A',from:47,to:57,afterBoutId:afterB35.id},admin);
assert.equal(transfer.count,11);
data = await state();
const moved = block.map(b => data.bouts.find(current => current.id === b.id));
assert.ok(moved.every(b => b.assignedRing === 'B'));
assert.deepEqual(moved.map(b => b.code),block.map(b => b.code));
assert.deepEqual(moved.map(b => b.scheduleOrder),Array.from({length:11},(_,i) => data.bouts.find(b => b.id === afterB35.id).scheduleOrder+i+1));
const movedReady = moved.find(b => b.status === 'READY');
assert.ok(movedReady);
await post('/api/admin/result',{boutId:movedReady.id,winnerId:movedReady.blueId,method:'PTF'},ringA,403);
await post('/api/admin/result',{boutId:movedReady.id,winnerId:movedReady.blueId,method:'PTF'},ringB);
console.log('PASS 11-bout transfer, insertion order, original codes and Ring B result access');

data = await state();
const qualifiers = ['A','B','C'].map(ring => {
  const target = data.bouts.find(b => b.day === 1 && b.assignedRing === ring && b.code[0] === ring &&
    b.status === 'READY' && b.directIds.length === 2 && b.scheduleOrder > 0);
  assert.ok(target,`No qualifying target on Ring ${ring}`);
  const previous = data.bouts.find(b => b.day === 1 && b.assignedRing === ring && b.scheduleOrder === target.scheduleOrder-1);
  assert.ok(previous);
  return { targetBoutId:target.id,sourceAthleteId:target.directIds[0],name:`DAY 1 AUDIT ATHLETE ${ring}`,
    team:`AUDIT CLUB ${ring}`,assignedRing:ring,sourceCorner:'B',afterBoutId:previous.id };
});
const extra = await post('/api/admin/extra-bouts',{version:data.version,entries:qualifiers},admin);
assert.equal(extra.count,3);
data = await state();
assert.equal(data.athletes.length,1830);
assert.equal(data.bouts.length,1261);
assert.ok(extra.codes.every(code => data.bouts.some(b => b.code === code && b.extra)));
assert.ok(qualifiers.every(entry => data.bouts.find(b => b.id === entry.targetBoutId).status === 'WAITING'));
console.log(`PASS three athlete names and qualifying bouts saved together: ${extra.codes.join(', ')}`);

const proCategories = data.poomsae.slice(0,3).map(g => g.category);
const proEntries = proCategories.map((category,i) => ({ category,name:`DAY 1 AUDIT POOMSAE ${i+1}`,team:'AUDIT PRO CLUB' }));
const addedPro = await post('/api/admin/poomsae-entries',{version:data.version,entries:proEntries},admin);
assert.equal(addedPro.count,3);
data = await state();
assert.equal(data.athletes.length,1833);
assert.ok(addedPro.codes.every(code => data.poomsae.some(g => g.entrants.some(e => e.code === code))));
console.log(`PASS three Poomsae Pro names saved together: ${addedPro.codes.join(', ')}`);

const day2 = data.bouts.find(b => b.day === 2 && b.status === 'READY' && b.assignedRing === 'A');
assert.ok(day2);
await post('/api/admin/result',{boutId:day2.id,winnerId:day2.blueId,method:'PTF'},ringA,403);

for (const group of data.poomsae) {
  const scores = group.entrants.map((entrant,i) => ({ code:entrant.code,score:(9.500-i*0.017).toFixed(3) }));
  await post('/api/admin/poomsae-scores',{category:group.category,scores},admin);
}
data = await state();
assert.ok(data.poomsae.every(g => g.finished && g.entrants.every(e => e.rank !== null)));
console.log(`PASS all ${data.poomsae.length} Poomsae Pro categories scored`);

let recorded = 1;
for (let wave = 1; wave <= 8; wave++) {
  data = await state();
  const pending = data.bouts.filter(b => b.day === 1 && !['COMPLETE','BYE'].includes(b.status));
  if (!pending.length) break;
  const ready = pending.filter(b => b.status === 'READY');
  assert.ok(ready.length,`Day 1 stalled after wave ${wave}: ${pending.slice(0,12).map(b => `${b.code}:${b.status}`).join(', ')}`);
  for (const bout of ready) {
    assert.ok(bout.blueId || bout.redId,`Ready bout ${bout.code} has no athlete`);
    await post('/api/admin/result',{boutId:bout.id,winnerId:bout.blueId || bout.redId,method:'PTF'},admin);
  }
  recorded += ready.length;
  console.log(`Wave ${wave}: recorded ${ready.length} bouts; ${pending.length-ready.length} were awaiting progression`);
}
data = await state();
const day1 = data.bouts.filter(b => b.day === 1);
assert.ok(day1.every(b => ['COMPLETE','BYE'].includes(b.status)),`Unfinished: ${day1.filter(b => !['COMPLETE','BYE'].includes(b.status)).slice(0,12).map(b => `${b.code}:${b.status}`).join(', ')}`);
assert.ok(data.poomsae.every(g => g.finished));
assert.ok(data.awards.filter(a => a.day === 1).every(a => a.finished));
assert.ok(data.awards.filter(a => a.day === 1 && a.autoRing).every(a => a.status === 'DELIVERED_IN_RING'));
console.log(`PASS all ${day1.length} Day 1 bouts completed or automatic bye (${recorded} recorded results)`);

await post('/api/admin/result',{boutId:day2.id,winnerId:day2.blueId,method:'PTF'},ringA);
await post('/api/admin/undo',{boutId:day2.id,reason:'Day 2 unlock check'},ringA);
console.log('PASS Day 2 coordinator results unlock only after all Day 1 rings and Poomsae Pro finish');

data = await state();
const podium = data.awards.filter(a => a.day === 1 && !a.autoRing);
assert.ok(podium.length);
await post('/api/admin/award/call',{awardId:podium[0].id},awardsToken);
let absentCount = 0, deliveredCount = 0;
for (const award of podium) {
  for (const medal of award.medals) {
    const state = !absentCount && medal.medal === 'Bronze' ? 'ABSENT' : 'DELIVERED';
    if (state === 'ABSENT') absentCount++;
    else deliveredCount++;
    await post('/api/admin/award/medal',{awardId:award.id,athleteId:medal.athleteId,state},awardsToken);
  }
}
data = await state();
assert.equal(absentCount,1);
assert.ok(data.awards.filter(a => a.day === 1 && !a.autoRing).every(a => a.status === 'DELIVERED' && a.deliveredAt));
assert.ok(data.awards.some(a => a.medals.some(m => m.state === 'ABSENT')));
assert.ok(data.awards.filter(a => a.day === 1 && a.autoRing).every(a => a.status === 'DELIVERED_IN_RING'));
console.log(`PASS awards desk resolved ${deliveredCount} medals and one absent athlete; timestamps present`);
console.log(`PASS FULL DAY 1: ${day1.length} bouts, ${data.poomsae.length} Pro categories, ${data.awards.filter(a => a.day === 1).length} award categories, final version ${data.version}`);
