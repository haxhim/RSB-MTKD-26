import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAwardState } from '../server.mjs';

const base = (event = 'RSB CLASS A') => [
  { id:'semi1', day:2, event, category:'9 - 11 MFLY', code:'A01', stage:1, status:'COMPLETE', blueId:'ali', redId:'abu', winnerId:'ali', result:{recordedAt:'2026-10-04T09:00:00Z'} },
  { id:'semi2', day:2, event, category:'9 - 11 MFLY', code:'A02', stage:1, status:'COMPLETE', blueId:'jojo', redId:'zaki', winnerId:'jojo', result:{recordedAt:'2026-10-04T09:10:00Z'} },
  { id:'final', day:2, event, category:'9 - 11 MFLY', code:'A03', stage:0, status:'COMPLETE', blueId:'ali', redId:'jojo', winnerId:'ali', result:{recordedAt:'2026-10-04T09:30:00Z'} }
];

test('a completed category calls gold, silver and both bronze medalists', () => {
  const [award] = buildAwardState(base());
  assert.equal(award.status, 'CALLED');
  assert.deepEqual(award.medals.map(m => [m.athleteId,m.medal]), [['ali','Gold'],['jojo','Silver'],['abu','Bronze'],['zaki','Bronze']]);
  const stored = { [award.id]: { medalists:Object.fromEntries(award.medals.map(m => [m.athleteId,{state:m.athleteId === 'zaki' ? 'ABSENT' : 'DELIVERED'}])) } };
  const [updated] = buildAwardState(base(),stored);
  assert.equal(updated.status,'DELIVERED');
  assert.equal(updated.medals.at(-1).state,'ABSENT');
  assert.equal(updated.deliveredAt, null);
  stored[award.id].deliveredAt = '2026-10-04T10:00:00Z';
  assert.equal(buildAwardState(base(),stored)[0].deliveredAt, '2026-10-04T10:00:00Z');
});

test('Poomsae Carnival and Virtual are delivered in ring; unfinished category is not called', () => {
  for (const event of ['POOMSAE CARNIVAL','VIRTUAL DAY 1']) {
    const [award] = buildAwardState(base(event));
    assert.equal(award.status,'DELIVERED_IN_RING');
    assert.ok(award.medals.every(m => m.state === 'DELIVERED_IN_RING'));
    assert.equal(award.deliveredAt, '2026-10-04T09:30:00Z');
  }
  const bouts = base(); bouts[2] = { ...bouts[2], status:'WAITING', winnerId:null };
  const [award] = buildAwardState(bouts);
  assert.equal(award.status,'NOT_CALLED');
  assert.deepEqual(award.medals,[]);
});
