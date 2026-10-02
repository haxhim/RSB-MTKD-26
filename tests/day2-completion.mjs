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
assert.ok(data.bouts.filter(b => b.day === 1).every(b => ['COMPLETE','BYE'].includes(b.status)));
assert.ok(data.poomsae.every(g => g.finished));
assert.equal(data.bouts.filter(b => b.day === 2 && b.status === 'COMPLETE').length,0);
assert.equal(data.bouts.filter(b => b.day === 2).length,394);

await post('/api/admin/pin',{ring:'H',pin:'444444'},admin);
const ringH = (await post('/api/login',{ring:'H',pin:'444444'})).token;
const awardsToken = (await post('/api/login',{ring:'AWARDS',pin:'333333'})).token;
data = await state();
const teamFirst = data.bouts.find(b => b.day === 2 && b.event === 'TEAM SPARRING' && b.code === 'H01');
assert.equal(teamFirst.status,'WAITING');
assert.equal(teamFirst.scheduleHold,'After individual Kyorugi');
await post('/api/admin/result',{boutId:teamFirst.id,winnerId:teamFirst.blueId,method:'PTF'},ringH,409);
console.log('PASS Team Sparring locked while individual Kyorugi is unfinished');

const block = data.bouts.filter(b => b.day === 2 && b.assignedRing === 'A' && b.code[0] === 'A' &&
  Number(b.code.match(/^A(\d+)/)?.[1]) >= 20 && Number(b.code.match(/^A(\d+)/)?.[1]) <= 25).sort((a,b) => a.scheduleOrder-b.scheduleOrder);
const afterB15 = data.bouts.find(b => b.day === 2 && b.assignedRing === 'B' && b.code === 'B15');
assert.equal(block.length,6);
assert.ok(afterB15);
const transfer = await post('/api/admin/transfer',{version:data.version,day:2,sourceRing:'A',targetRing:'B',codePrefix:'A',from:20,to:25,afterBoutId:afterB15.id},admin);
assert.equal(transfer.count,6);
data = await state();
const moved = block.map(b => data.bouts.find(current => current.id === b.id));
assert.ok(moved.every(b => b.assignedRing === 'B'));
assert.deepEqual(moved.map(b => b.code),block.map(b => b.code));
assert.deepEqual(moved.map(b => b.scheduleOrder),Array.from({length:6},(_,i) => data.bouts.find(b => b.id === afterB15.id).scheduleOrder+i+1));
console.log('PASS Day 2 A20–A25 transfer after B15 preserves codes and order');

const qualifiers = ['A','B'].map(ring => {
  const target = data.bouts.find(b => b.day === 2 && b.assignedRing === ring && b.code[0] === ring &&
    b.status === 'READY' && b.directIds.length === 2 && b.scheduleOrder > 0);
  assert.ok(target,`No ready qualifying target on Ring ${ring}`);
  const previous = data.bouts.find(b => b.day === 2 && b.assignedRing === ring && b.scheduleOrder === target.scheduleOrder-1);
  assert.ok(previous);
  return { targetBoutId:target.id,sourceAthleteId:target.directIds[0],name:`DAY 2 AUDIT ATHLETE ${ring}`,
    team:`AUDIT CLUB ${ring}`,assignedRing:ring,sourceCorner:'B',afterBoutId:previous.id };
});
const extra = await post('/api/admin/extra-bouts',{version:data.version,entries:qualifiers},admin);
assert.equal(extra.count,2);
data = await state();
assert.equal(data.bouts.filter(b => b.day === 2).length,396);
assert.ok(extra.codes.every(code => data.bouts.some(b => b.day === 2 && b.code === code && b.extra)));
assert.ok(qualifiers.every(entry => data.bouts.find(b => b.id === entry.targetBoutId).status === 'WAITING'));
console.log(`PASS two Day 2 athlete names and qualifying bouts saved together: ${extra.codes.join(', ')}`);

let individualRecorded = 0;
for (let wave = 1; wave <= 8; wave++) {
  data = await state();
  const pending = data.bouts.filter(b => b.day === 2 && b.event !== 'TEAM SPARRING' && !['COMPLETE','BYE'].includes(b.status));
  if (!pending.length) break;
  const individualPending = pending.some(b => b.event !== 'VIRTUAL DAY 2');
  if (individualPending) assert.ok(data.bouts.filter(b => b.day === 2 && b.event === 'TEAM SPARRING').every(b => b.status !== 'READY'),
    `Team Sparring unlocked in wave ${wave} before individual Kyorugi finished`);
  const ready = pending.filter(b => b.status === 'READY');
  assert.ok(ready.length,`Day 2 individual/virtual rounds stalled: ${pending.slice(0,12).map(b => `${b.code}:${b.status}`).join(', ')}`);
  for (const bout of ready) {
    assert.ok(bout.blueId || bout.redId,`Ready bout ${bout.code} has no athlete`);
    await post('/api/admin/result',{boutId:bout.id,winnerId:bout.blueId || bout.redId,method:'PTF'},admin);
  }
  individualRecorded += ready.length;
  console.log(`Individual/virtual wave ${wave}: recorded ${ready.length}; ${pending.length-ready.length} awaiting progression`);
}
data = await state();
assert.ok(data.bouts.filter(b => b.day === 2 && b.event !== 'TEAM SPARRING').every(b => ['COMPLETE','BYE'].includes(b.status)));
const teamNow = data.bouts.find(b => b.id === teamFirst.id);
assert.equal(teamNow.status,'READY');
assert.equal(teamNow.scheduleHold,undefined);
await post('/api/admin/result',{boutId:teamNow.id,winnerId:teamNow.blueId,method:'PTF'},ringH);
console.log(`PASS ${individualRecorded} individual/virtual results release Team Sparring; Ring H coordinator can record`);

let teamRecorded = 1;
for (let wave = 1; wave <= 6; wave++) {
  data = await state();
  const pending = data.bouts.filter(b => b.day === 2 && b.event === 'TEAM SPARRING' && !['COMPLETE','BYE'].includes(b.status));
  if (!pending.length) break;
  const ready = pending.filter(b => b.status === 'READY');
  assert.ok(ready.length,`Team Sparring stalled: ${pending.map(b => `${b.code}:${b.status}`).join(', ')}`);
  for (const bout of ready) await post('/api/admin/result',{boutId:bout.id,winnerId:bout.blueId || bout.redId,method:'PTF'},ringH);
  teamRecorded += ready.length;
  console.log(`Team wave ${wave}: recorded ${ready.length}`);
}
data = await state();
const day2 = data.bouts.filter(b => b.day === 2);
assert.ok(day2.every(b => ['COMPLETE','BYE'].includes(b.status)));
assert.ok(data.awards.filter(a => a.day === 2).every(a => a.finished));
assert.ok(data.awards.filter(a => a.day === 2 && a.autoRing).every(a => a.status === 'DELIVERED_IN_RING'));
console.log(`PASS all ${day2.length} Day 2 bouts completed or automatic bye (${teamRecorded} Team Sparring results)`);

const podium = data.awards.filter(a => a.day === 2 && !a.autoRing);
assert.ok(podium.length);
await post('/api/admin/award/call',{awardId:podium[0].id},awardsToken);
let delivered = 0, absent = 0;
for (const award of podium) {
  for (const medal of award.medals) {
    const medalState = !absent && medal.medal === 'Bronze' ? 'ABSENT' : 'DELIVERED';
    if (medalState === 'ABSENT') absent++;
    else delivered++;
    await post('/api/admin/award/medal',{awardId:award.id,athleteId:medal.athleteId,state:medalState},awardsToken);
  }
}
data = await state();
assert.equal(absent,1);
assert.ok(data.awards.filter(a => a.day === 2 && !a.autoRing).every(a => a.status === 'DELIVERED' && a.deliveredAt));
assert.ok(data.awards.filter(a => a.day === 2 && a.autoRing).every(a => a.status === 'DELIVERED_IN_RING'));
assert.equal(data.awards.filter(a => a.day === 2).flatMap(a => a.medals).filter(m => m.state === 'ABSENT').length,1);
console.log(`PASS Day 2 awards resolved ${delivered} medals and one absent athlete`);
console.log(`PASS FULL DAY 2: ${day2.length} bouts, ${data.awards.filter(a => a.day === 2).length} award categories, final version ${data.version}`);
