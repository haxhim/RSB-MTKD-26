import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseCsv, buildPoomsaeState } from '../server.mjs';

const entries = parseCsv(fs.readFileSync(new URL('../csv/rsb_poomsae_pro.csv', import.meta.url),'utf8'));

test('Poomsae Pro roster has 133 entries in 36 Ring D categories', () => {
  const groups = buildPoomsaeState(entries);
  assert.equal(groups.length,36);
  assert.equal(groups.reduce((n,g) => n + g.entrants.length,0),133);
  assert.ok(groups.every(g => !g.finished && g.entrants.every(e => e.rank === null)));
});

test('single round marks calculate ranks and share equal rank on ties', () => {
  const group = buildPoomsaeState(entries).find(g => g.entrants.length === 4);
  const saved = Object.fromEntries(group.entrants.map((e,i) => [e.code,{score:[9.8,9.4,9.4,8.2][i],recordedAt:'2026-10-03T10:00:00Z'}]));
  const updated = buildPoomsaeState(entries,saved).find(g => g.category === group.category);
  assert.equal(updated.finished,true);
  assert.deepEqual(updated.entrants.map(e => e.rank),[1,2,2,4]);
});
