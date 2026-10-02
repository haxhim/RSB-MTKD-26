import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCompetition, parseCsv, projectCompetition } from '../server.mjs';

const rows = [1, 2].flatMap(day => parseCsv(fs.readFileSync(new URL(`../csv/rsb_day_${day}.csv`, import.meta.url), 'utf8'))).concat(parseCsv(fs.readFileSync(new URL('../csv/rsb_team_sparring.csv', import.meta.url), 'utf8')));
const competition = buildCompetition(rows);

test('all RSB rows produce unique entrants and valid first contests', () => {
  assert.equal(competition.athletes.length, 1694);
  assert.equal(new Set(competition.athletes.map(a => a.id)).size, 1694);
  const first = competition.bouts.filter(b => b.childIds.length === 0);
  assert.ok(first.length > 500);
  assert.ok(first.every(b => b.directIds.length <= 2));
});

test('preassigned corners and winner progression', () => {
  const stored = { bouts: {} };
  let projected = projectCompetition(competition, stored);
  const initial = projected.find(b => b.status === 'READY' && b.childIds.length === 0);
  assert.ok(initial.redId && initial.blueId);
  const red = competition.athletes.find(a => a.id === initial.redId);
  const blue = competition.athletes.find(a => a.id === initial.blueId);
  assert.equal(red.route.find(step => step.code === initial.code).corner, 'R');
  assert.equal(blue.route.find(step => step.code === initial.code).corner, 'B');
  assert.ok(projected.some(b => b.status === 'WAITING'));
  stored.bouts[initial.id] = { winnerId: initial.redId, method: 'PTF' };
  projected = projectCompetition(competition, stored);
  assert.equal(projected.find(b => b.id === initial.id).winnerId, initial.redId);
  const parent = projected.find(b => b.childIds.includes(initial.id));
  assert.ok(parent);
  assert.ok([parent.redId, parent.blueId].includes(initial.redId));
});

test('Day 2 team Kyorugi waits until individual Kyorugi finishes', () => {
  const make = (event, number, name, category, code, corner) => ({
    day: '2', event, competitor_no: number, name, team: 'Test club', category,
    first_bout: code, first_corner: corner,
  });
  const small = buildCompetition([
    make('RSB CLASS A', '001', 'Individual red', '12 - 14 MFIN', 'A01', 'R'),
    make('RSB CLASS A', '002', 'Individual blue', '12 - 14 MFIN', 'A01', 'B'),
    make('TEAM KYORUGI', '003', 'Team red', 'TEAM MALE', 'A02', 'R'),
    make('TEAM KYORUGI', '004', 'Team blue', 'TEAM MALE', 'A02', 'B'),
  ]);
  const stored = { bouts: {} };
  let projected = projectCompetition(small, stored);
  assert.equal(projected.find(b => b.code === 'A02').status, 'WAITING');
  assert.equal(projected.find(b => b.code === 'A02').scheduleHold, 'After individual Kyorugi');
  stored.bouts['2:RSB CLASS A:A01'] = { winnerId: '2:RSB CLASS A:001', method: 'PTF' };
  projected = projectCompetition(small, stored);
  assert.equal(projected.find(b => b.code === 'A02').status, 'READY');
});

test('Team Sparring PDF paths produce the six Ring H brackets', () => {
  const team = competition.bouts.filter(b => b.event === 'TEAM SPARRING');
  assert.equal(team.length, 10);
  assert.equal(team.filter(b => b.stage === 0).length, 6);
  const projected = projectCompetition(competition, { bouts:{} });
  assert.ok(projected.filter(b => b.event === 'TEAM SPARRING').every(b => b.status === 'WAITING'));
});
