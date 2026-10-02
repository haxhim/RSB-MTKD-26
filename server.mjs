import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12))
  throw Error('ADMIN_PASSWORD must be at least 12 characters in production');
const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
const tokenSecret = crypto.createHash('sha256').update(`rsb-session-v1:${process.env.SESSION_SECRET || adminPassword}`).digest();
const tokenLifetimeMs = 12 * 60 * 60 * 1000;
const failedLogins = new Map();
const database = new pg.Pool({
  ...(process.env.DATABASE_URL ? { connectionString:process.env.DATABASE_URL } : {
    host:process.env.PGHOST, port:Number(process.env.PGPORT || 5432),
    user:process.env.PGUSER, password:process.env.PGPASSWORD, database:process.env.PGDATABASE,
  }),
  max:10,
});
database.on('error', err => console.error(`PostgreSQL connection lost: ${err.message}`));
let activeDbClient = null;
let transactionOpen = false;
async function initializeDatabase() {
  if (!process.env.DATABASE_URL && !process.env.PGHOST) throw Error('Set DATABASE_URL or PGHOST to a PostgreSQL server');
  await database.query(`CREATE TABLE IF NOT EXISTS competition_state (
    id integer PRIMARY KEY CHECK (id = 1),
    version integer NOT NULL,
    state jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await database.query(fs.readFileSync(path.join(root, 'seed', 'initial-state.sql'), 'utf8'));
}

export function parseCsv(text) {
  const lines = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted && ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(Boolean)) lines.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); lines.push(row); }
  const [header, ...data] = lines;
  return data.map(cells => Object.fromEntries(header.map((key, i) => [key.replace(/^\uFEFF/, ''), cells[i] || ''])));
}

export function buildCompetition(rows) {
  const athletes = [], map = new Map();
  for (const row of rows) {
    const id = `${row.day}:${row.event}:${row.competitor_no}`;
    if (map.has(id)) throw Error(`Duplicate competitor ${id}`);
    const route = [];
    for (let i = 1; i <= 5; i++) {
      const code = i === 1 ? row.first_bout : row[`bout_${i}`];
      const corner = i === 1 ? row.first_corner : row[`corner_${i}`];
      if (code) route.push({ code, corner, stage: i - 1 });
    }
    const athlete = { id, day: Number(row.day), event: row.event, number: row.competitor_no, name: row.name,
      truncated: row.name_truncated_in_pdf === 'yes', team: row.team, category: row.category, route };
    athletes.push(athlete); map.set(id, athlete);
  }
  const bouts = new Map();
  for (const athlete of athletes) {
    athlete.route.forEach((step, index) => {
      const id = `${athlete.day}:${athlete.event}:${step.code}`;
      if (!bouts.has(id)) bouts.set(id, { id, day: athlete.day, event: athlete.event, code: step.code,
        category: athlete.category, stage: step.stage, entrants: [], childIds: [], directIds: [], corners: {} });
      const bout = bouts.get(id);
      if (bout.category !== athlete.category || bout.stage !== step.stage) throw Error(`Conflicting bout ${id}`);
      if (!bout.entrants.includes(athlete.id)) bout.entrants.push(athlete.id);
      if (index === athlete.route.length - 1) {
        bout.directIds.push(athlete.id);
        bout.corners[athlete.id] = step.corner;
      }
      else {
        const childId = `${athlete.day}:${athlete.event}:${athlete.route[index + 1].code}`;
        if (!bout.childIds.includes(childId)) bout.childIds.push(childId);
        if (bout.corners[childId] && bout.corners[childId] !== step.corner) throw Error(`Conflicting corner in ${id}`);
        bout.corners[childId] = step.corner;
      }
    });
  }
  for (const bout of bouts.values()) {
    if (bout.childIds.length + bout.directIds.length > 2) throw Error(`More than two inputs in ${bout.id}`);
    if (bout.entrants.length > 2 && bout.stage === 4) throw Error(`Invalid first round ${bout.id}`);
    if (bout.childIds.length + bout.directIds.length === 2 &&
        new Set([...bout.childIds, ...bout.directIds].map(id => bout.corners[id])).size !== 2) throw Error(`Invalid corners in ${bout.id}`);
  }
  return { athletes, bouts: [...bouts.values()] };
}

const rows = [1, 2].flatMap(day => parseCsv(fs.readFileSync(path.join(root, 'csv', `rsb_day_${day}.csv`), 'utf8')))
  .concat(parseCsv(fs.readFileSync(path.join(root, 'csv', 'rsb_team_sparring.csv'), 'utf8')));
const poomsaeRows = parseCsv(fs.readFileSync(path.join(root, 'csv', 'rsb_poomsae_pro.csv'), 'utf8'));
const allPoomsaeRows = () => poomsaeRows.concat(results.extraPoomsaeEntries || []);
const competition = buildCompetition(rows);
let athletesById, boutsById;
let results = { version: 1, bouts: {}, audit: [], extraBouts:[], extraAthletes:[], extraPoomsaeEntries:[], schedule:{}, pins:{}, awards:{}, poomsae:{} };
function loadResults(state) {
  results = state;
  results.extraBouts ||= [];
  results.extraAthletes ||= [];
  results.extraPoomsaeEntries ||= [];
  results.schedule ||= {};
  results.pins ||= {};
  results.awards ||= {};
  results.poomsae ||= {};
  rebuildMaps(activeCompetition());
}
function activeCompetition() {
  const bouts = competition.bouts.map(b => ({ ...b, directIds: [...b.directIds], childIds: [...b.childIds], corners: { ...b.corners } }));
  for (const extra of results.extraBouts) {
    const target = bouts.find(b => b.id === extra.targetBoutId);
    if (!target) continue;
    const source = extra.sourceId;
    target.directIds = target.directIds.filter(id => id !== source);
    target.childIds = target.childIds.filter(id => id !== source);
    target.childIds.push(extra.id);
    target.corners[extra.id] = target.corners[source];
    delete target.corners[source];
    bouts.push({ id: extra.id, day: target.day, event: target.event, code: extra.code, category: target.category,
      stage: target.stage + 1, entrants: [], directIds: extra.sourceType === 'direct' ? [source, extra.challengerId] : [extra.challengerId],
      childIds: extra.sourceType === 'child' ? [source] : [], corners: { [source]: extra.sourceCorner, [extra.challengerId]: extra.challengerCorner }, extra: true });
  }
  return { athletes: [...competition.athletes, ...results.extraAthletes], bouts };
}
function scheduleFor(comp) {
  const groups = {};
  for (const b of comp.bouts) {
    const key = `${b.day}:${b.code[0]}`;
    (groups[key] ||= []).push(b.id);
  }
  for (const ids of Object.values(groups)) ids.sort((a,b) => comp.bouts.find(x => x.id === a).code.localeCompare(comp.bouts.find(x => x.id === b).code, undefined, { numeric: true }));
  const assigned = new Set();
  for (const [key, saved] of Object.entries(results.schedule)) {
    groups[key] ||= [];
    groups[key] = saved.filter(id => comp.bouts.some(b => b.id === id));
    groups[key].forEach(id => assigned.add(id));
  }
  for (const [key, ids] of Object.entries(groups)) groups[key] = ids.filter(id => !assigned.has(id) || results.schedule[key]?.includes(id));
  for (const b of comp.bouts) if (!Object.values(groups).some(ids => ids.includes(b.id))) (groups[`${b.day}:${b.code[0]}`] ||= []).push(b.id);
  return groups;
}
function rebuildMaps(comp) { athletesById = new Map(comp.athletes.map(a => [a.id,a])); boutsById = new Map(comp.bouts.map(b => [b.id,b])); }
rebuildMaps(activeCompetition());
async function save() {
  if (!activeDbClient || !transactionOpen) throw Error('Competition change requires a database transaction');
  await activeDbClient.query('UPDATE competition_state SET version = $1, state = $2::jsonb, updated_at = now() WHERE id = 1',
    [results.version, JSON.stringify(results)]);
  await activeDbClient.query('COMMIT');
  transactionOpen = false;
}

export function projectCompetition(competition, stored) {
  const byId = new Map(competition.bouts.map(b => [b.id, b]));
  const cache = new Map();
  function resolve(id, trail = new Set()) {
    if (cache.has(id)) return cache.get(id);
    if (trail.has(id)) throw Error(`Circular bracket ${id}`);
    trail.add(id);
    const bout = byId.get(id);
    const inputs = [...bout.directIds.map(athleteId => ({ athleteId, source: athleteId, corner: bout.corners[athleteId] })),
      ...bout.childIds.map(childId => ({ athleteId: resolve(childId, trail).winnerId, source: childId, corner: bout.corners[childId] }))];
    trail.delete(id);
    const pending = bout.childIds.some(childId => !resolve(childId).winnerId);
    const participants = inputs.map(input => input.athleteId).filter(Boolean);
    const redId = inputs.find(input => input.corner === 'R')?.athleteId || null;
    const blueId = inputs.find(input => input.corner === 'B')?.athleteId || null;
    const saved = stored.bouts[id];
    const autoBye = !pending && participants.length === 1;
    const validResult = saved && !pending && participants.length === 2 && participants.includes(saved.winnerId);
    const winnerId = autoBye ? participants[0] : validResult ? saved.winnerId : null;
    const state = { ...bout, redId, blueId,
      winnerId, method: autoBye ? 'BYE' : validResult ? saved.method : null,
      status: autoBye ? 'BYE' : validResult ? 'COMPLETE' : !pending && participants.length === 2 ? 'READY' : 'WAITING',
      result: validResult ? saved : null };
    cache.set(id, state);
    return state;
  }
  const projected = competition.bouts.map(b => resolve(b.id));
  const isTeamKyorugi = b => /TEAM\s*(?:KYORUGI|SPARRING)|(?:KYORUGI|SPARRING)\s*TEAM/i.test(`${b.event} ${b.category}`);
  const isVirtual = b => /VIRTUAL|\bVR\b/i.test(b.event);
  const individualKyorugiPending = projected.some(b => b.day === 2 && !isTeamKyorugi(b) && !isVirtual(b) && !['COMPLETE', 'BYE'].includes(b.status));
  if (individualKyorugiPending) for (const bout of projected) {
    if (bout.day === 2 && isTeamKyorugi(bout) && bout.status === 'READY') {
      bout.status = 'WAITING';
      bout.scheduleHold = 'After individual Kyorugi';
    }
  }
  return projected.sort((a, b) => a.day - b.day || a.event.localeCompare(b.event) ||
    a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export function buildAwardState(bouts, stored = {}) {
  const groups = new Map();
  for (const bout of bouts) {
    const id = JSON.stringify([bout.day,bout.event,bout.code[0],bout.category]);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(bout);
  }
  const awards = [];
  for (const [id, group] of groups) {
    const final = group.find(b => b.stage === 0);
    if (!final) continue;
    const finished = group.every(b => ['COMPLETE','BYE'].includes(b.status));
    const autoRing = final.event === 'POOMSAE CARNIVAL' || /VIRTUAL|\bVR\b/i.test(final.event);
    const saved = stored[id] || {}, medals = [];
    if (finished && final.winnerId) {
      medals.push({ athleteId:final.winnerId, medal:'Gold' });
      const silverId = final.redId === final.winnerId ? final.blueId : final.redId;
      if (silverId) medals.push({ athleteId:silverId, medal:'Silver' });
      for (const semi of group.filter(b => b.stage === 1 && b.status === 'COMPLETE')) {
        const loserId = semi.redId === semi.winnerId ? semi.blueId : semi.redId;
        if (loserId) medals.push({ athleteId:loserId, medal:'Bronze' });
      }
    }
    const distinct = [...new Map(medals.map(m => [m.athleteId,m])).values()].map(m => ({ ...m,
      state:autoRing ? 'DELIVERED_IN_RING' : saved.medalists?.[m.athleteId]?.state || 'PENDING',
      updatedAt:saved.medalists?.[m.athleteId]?.updatedAt || null }));
    const resolved = distinct.length > 0 && distinct.every(m => ['DELIVERED','ABSENT','DELIVERED_IN_RING'].includes(m.state));
    const status = !finished ? 'NOT_CALLED' : autoRing ? 'DELIVERED_IN_RING' : resolved ? 'DELIVERED' : 'CALLED';
    const finishedAt = group.map(b => b.result?.recordedAt).filter(Boolean).sort().at(-1) || null;
    const deliveredAt = autoRing && finished ? finishedAt : resolved ? saved.deliveredAt || distinct.map(m => m.updatedAt).filter(Boolean).sort().at(-1) || null : null;
    awards.push({ id, day:final.day, event:final.event, category:final.category,
      sourceRing:final.code[0], ring:final.assignedRing || final.code[0], finalCode:final.code,
      status, finished, autoRing, finishedAt, deliveredAt, calledAt:saved.calledAt || (finished ? finishedAt : null),
      callCount:saved.callCount || 0, medals:distinct, totalBouts:group.length });
  }
  return awards.sort((a,b) => a.day-b.day || a.ring.localeCompare(b.ring) || a.category.localeCompare(b.category));
}

export function buildPoomsaeState(entries, saved = {}) {
  const groups = new Map();
  for (const row of entries) {
    if (!groups.has(row.category)) groups.set(row.category, []);
    const result = saved[row.competitor_no];
    groups.get(row.category).push({
      id:`1:POOMSAE PRO:${row.competitor_no}`, code:row.competitor_no,
      name:row.name, team:row.team, score:result?.score ?? null,
      recordedAt:result?.recordedAt || null, rank:null,
    });
  }
  return [...groups].map(([category, entrants]) => {
    const sorted = [...entrants].sort((a,b) => (b.score ?? -1) - (a.score ?? -1) || a.code.localeCompare(b.code, undefined, { numeric:true }));
    sorted.forEach((entrant,index) => {
      if (entrant.score !== null) entrant.rank = 1 + sorted.filter(other => other.score !== null && other.score > entrant.score).length;
    });
    return { id:JSON.stringify([1,'POOMSAE PRO','D',category]), day:1, event:'POOMSAE PRO',
      ring:'D', category, entrants:sorted, finished:entrants.every(e => e.score !== null),
      finishedAt:entrants.every(e => e.score !== null) ? entrants.map(e => e.recordedAt).sort().at(-1) : null };
  });
}

function buildPoomsaeAwards(groups, stored = {}) {
  return groups.map(group => {
    const saved = stored[group.id] || {};
    const medals = group.finished ? group.entrants.filter(e => e.rank <= 3).map(e => ({
      athleteId:e.id, medal:e.rank === 1 ? 'Gold' : e.rank === 2 ? 'Silver' : 'Bronze',
      state:saved.medalists?.[e.id]?.state || 'PENDING',
      updatedAt:saved.medalists?.[e.id]?.updatedAt || null,
    })) : [];
    const resolved = medals.length > 0 && medals.every(m => ['DELIVERED','ABSENT'].includes(m.state));
    const deliveredAt = resolved ? saved.deliveredAt || medals.map(m => m.updatedAt).filter(Boolean).sort().at(-1) || null : null;
    return { id:group.id, day:1, event:'POOMSAE PRO', category:group.category, sourceRing:'D', ring:'D',
      finalCode:group.entrants.at(-1)?.code || '', status:!group.finished ? 'NOT_CALLED' : resolved ? 'DELIVERED' : 'CALLED',
      finished:group.finished, autoRing:false, finishedAt:group.finishedAt, deliveredAt,
      calledAt:saved.calledAt || group.finishedAt, callCount:saved.callCount || 0,
      medals, totalBouts:1 };
  });
}

function json(res, status, value) { const body = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); }
function error(res, status, message) { json(res, status, { error: message }); }
function token(role = 'admin', ring = '') { const nonce = `${['coordinator','awards'].includes(role) ? results.pins[ring]?.hash.slice(0,12) || '' : ''}${crypto.randomBytes(20).toString('hex')}`; const payload = `${Date.now()}.${role}.${ring || '-'}.${nonce}`; return `${payload}.${crypto.createHmac('sha256', tokenSecret).update(payload).digest('hex')}`; }
function authorization(req) {
  const value = req.headers.authorization?.replace(/^Bearer /, '') || '';
  const parts = value.split('.');
  const issuedAt = Number(parts[0]);
  if (parts.length !== 5 || !Number.isSafeInteger(issuedAt) || issuedAt > Date.now() + 5 * 60 * 1000 || Date.now() - issuedAt > tokenLifetimeMs || !['admin','coordinator','awards'].includes(parts[1])) return null;
  const payload = parts.slice(0,4).join('.');
  const expected = crypto.createHmac('sha256', tokenSecret).update(payload).digest('hex');
  if (parts[4].length !== expected.length || !crypto.timingSafeEqual(Buffer.from(parts[4]), Buffer.from(expected))) return null;
  if (['coordinator','awards'].includes(parts[1]) && (!results.pins[parts[2]] || !parts[3].startsWith(results.pins[parts[2]].hash.slice(0,12)))) return null;
  return { role: parts[1], ring: parts[2] === '-' ? '' : parts[2] };
}
async function readBody(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 100000) throw Error('Request too large'); }
  return JSON.parse(text || '{}');
}
function publicData() {
  const comp = activeCompetition();
  rebuildMaps(comp);
  const schedule = scheduleFor(comp);
  const positions = new Map(Object.entries(schedule).flatMap(([key,ids]) => ids.map((id,index) => [id,{ assignedRing:key.split(':')[1], scheduleOrder:index }])))
  const bouts = projectCompetition(comp, results).map(b => ({ ...b, ...(positions.get(b.id) || { assignedRing:b.code[0], scheduleOrder:0 }) }));
  const poomsae = buildPoomsaeState(allPoomsaeRows(), results.poomsae);
  const awards = buildAwardState(bouts, results.awards).concat(buildPoomsaeAwards(poomsae, results.awards));
  const poomsaeAthletes = poomsae.flatMap(group => group.entrants.map(e => ({
    id:e.id, day:1, event:'POOMSAE PRO', name:e.name, team:e.team, category:group.category,
  })));
  return { event: { name: 'RSB Taekwondo Championship 2026', dates: ['3 October 2026', '4 October 2026'] },
    version: results.version, athletes:comp.athletes.concat(poomsaeAthletes), bouts, poomsae, awards,
    summary: { athletes:comp.athletes.length + poomsaeAthletes.length, bouts: bouts.length,
      ready: bouts.filter(b => b.status === 'READY').length, complete: bouts.filter(b => b.status === 'COMPLETE').length } };
}
let cachedPublicVersion = null, cachedPublicBody = null, cachedPublicGzip = null;
function sendPublicState(req, res) {
  if (cachedPublicVersion !== results.version) {
    cachedPublicBody = Buffer.from(JSON.stringify(publicData()));
    cachedPublicGzip = zlib.gzipSync(cachedPublicBody);
    cachedPublicVersion = results.version;
  }
  const compressed = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = compressed ? cachedPublicGzip : cachedPublicBody;
  res.writeHead(200, {
    'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'Vary':'Accept-Encoding', 'Content-Length':body.length,
    ...(compressed ? { 'Content-Encoding':'gzip' } : {}),
  });
  res.end(body);
}
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png':'image/png' };
async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/healthz') {
      await database.query('SELECT 1');
      return json(res, 200, { ok:true });
    }
    if (url.pathname.startsWith('/api/')) {
      activeDbClient = await database.connect();
      if (req.method === 'POST' && url.pathname.startsWith('/api/admin/')) {
        await activeDbClient.query('BEGIN');
        transactionOpen = true;
      }
      const state = await activeDbClient.query(`SELECT state FROM competition_state WHERE id = 1${transactionOpen ? ' FOR UPDATE' : ''}`);
      if (!state.rows.length) throw Error('Competition state has not been seeded');
      loadResults(state.rows[0].state);
    }
    if (req.method === 'GET' && url.pathname === '/api/state') return sendPublicState(req, res);
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readBody(req);
      const loginKey = `${req.socket.remoteAddress}:${String(body.ring || 'admin').toUpperCase()}`;
      const attempts = (failedLogins.get(loginKey) || []).filter(time => Date.now() - time < 10 * 60 * 1000);
      if (attempts.length >= 10) return error(res, 429, 'Too many attempts. Try again later.');
      const failed = () => { attempts.push(Date.now()); failedLogins.set(loginKey, attempts); return error(res, 401, 'Incorrect PIN or password'); };
      const supplied = Buffer.from(String(body.password || body.pin || ''));
      const expected = Buffer.from(adminPassword);
      if (supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) { failedLogins.delete(loginKey); return json(res, 200, { token: token(), role: 'admin' }); }
      const ring = String(body.ring || '').toUpperCase();
      const configured = results.pins[ring];
      if (!/^(?:[A-J]|AWARDS)$/.test(ring) || !/^\d{6}$/.test(String(body.pin || '')) || !configured) return failed();
      const hash = crypto.scryptSync(String(body.pin), configured.salt, 32);
      const saved = Buffer.from(configured.hash, 'hex');
      if (!crypto.timingSafeEqual(hash, saved)) return failed();
      failedLogins.delete(loginKey);
      const loginRole = ring === 'AWARDS' ? 'awards' : 'coordinator';
      return json(res, 200, { token: token(loginRole, ring), role: loginRole, ring });
    }
    if (url.pathname.startsWith('/api/admin/')) {
      const auth = authorization(req);
      if (!auth) return error(res, 401, 'Sign in to manage bouts');
      if (req.method === 'GET' && url.pathname === '/api/admin/session') return json(res, 200, auth);
      if (req.method === 'GET' && url.pathname === '/api/admin/audit') return json(res, 200, results.audit.slice(-100).reverse());
      if (req.method === 'POST' && url.pathname === '/api/admin/pin') {
        if (auth.role !== 'admin') return error(res, 403, 'Admin access required');
        const body = await readBody(req), ring = String(body.ring || '').toUpperCase(), pin = String(body.pin || '');
        if (!/^(?:[A-J]|AWARDS)$/.test(ring) || !/^\d{6}$/.test(pin)) return error(res, 400, 'Choose ring A–J or Awards and a six-digit PIN');
        const salt = crypto.randomBytes(16).toString('hex');
        results.pins[ring] = { salt, hash: crypto.scryptSync(pin, salt, 32).toString('hex') };
        results.audit.push({ action:'PIN_SET', ring, recordedAt:new Date().toISOString() });
        results.version++; await save();
        return json(res, 200, { ok:true, version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/poomsae-scores') {
        if (auth.role !== 'admin' && !(auth.role === 'coordinator' && auth.ring === 'D')) return error(res, 403, 'Ring D scoring access required');
        const body = await readBody(req);
        const group = buildPoomsaeState(allPoomsaeRows(), results.poomsae).find(g => g.category === body.category);
        if (!group) return error(res, 404, 'Poomsae Pro category not found');
        if (!Array.isArray(body.scores) || body.scores.length !== group.entrants.length ||
            new Set(body.scores.map(item => item.code)).size !== group.entrants.length ||
            body.scores.some(item => !group.entrants.some(e => e.code === item.code))) return error(res, 400, 'Submit one mark for every entrant in the category');
        const updates = [];
        for (const item of body.scores) {
          const value = String(item.score ?? '').trim();
          if (value && !/^(?:10(?:\.0{1,3})?|[0-9](?:\.\d{1,3})?)$/.test(value)) return error(res, 400, 'Marks must be 0.000–10.000 with up to three decimals');
          updates.push([item.code,value ? Number(value) : null]);
        }
        if (updates.every(([code,score]) => (results.poomsae[code]?.score ?? null) === score))
          return json(res, 200, { ok:true, unchanged:true, version:results.version });
        const recordedAt = new Date().toISOString();
        for (const [code,score] of updates) {
          if (score === null) delete results.poomsae[code];
          else results.poomsae[code] = { score, recordedAt };
        }
        delete results.awards[group.id];
        results.audit.push({ action:'POOMSAE_SCORES', category:group.category, scores:updates, recordedAt });
        results.version++; await save();
        return json(res, 200, { ok:true, version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/poomsae-undo') {
        if (auth.role !== 'admin' && !(auth.role === 'coordinator' && auth.ring === 'D')) return error(res, 403, 'Ring D scoring access required');
        const body = await readBody(req), code = String(body.code || '');
        if (Number(body.version) !== results.version) return error(res, 409, 'Competition changed. Refresh and try again.');
        const group = buildPoomsaeState(allPoomsaeRows(), results.poomsae).find(g => g.entrants.some(e => e.code === code));
        if (!group) return error(res, 404, 'Poomsae Pro entry not found');
        if (group.entrants.find(e => e.code === code).score === null) return error(res, 409, 'This mark has already been revoked');
        const previous = results.poomsae[code];
        delete results.poomsae[code];
        delete results.awards[group.id];
        const recordedAt = new Date().toISOString();
        results.audit.push({ action:'POOMSAE_MARK_REVOKED', code, category:group.category, previous, recordedAt });
        results.version++; await save();
        return json(res, 200, { ok:true, code, version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/poomsae-entries') {
        if (auth.role !== 'admin') return error(res, 403, 'Lead admin access required');
        const body = await readBody(req);
        if (Number(body.version) !== results.version) return error(res, 409, 'Competition changed. Refresh and try again.');
        if (!Array.isArray(body.entries) || body.entries.length < 1 || body.entries.length > 30)
          return error(res, 400, 'Stage 1 to 30 Poomsae Pro entries');
        const existing = allPoomsaeRows(), seen = new Set(existing.map(e => `${e.category.toLowerCase()}|${e.name.toLowerCase()}|${e.team.toLowerCase()}`));
        const staged = [];
        for (const item of body.entries) {
          const category = String(item.category || '').trim(), name = String(item.name || '').trim(), team = String(item.team || '').trim();
          if (!category || !name || !team || category.length > 120 || name.length > 120 || team.length > 120)
            return error(res, 400, 'Enter a category, athlete name and club for every entry');
          const key = `${category.toLowerCase()}|${name.toLowerCase()}|${team.toLowerCase()}`;
          if (seen.has(key)) return error(res, 409, `Duplicate Poomsae Pro entry: ${name}`);
          seen.add(key);
          staged.push({ category, name, team });
        }
        let number = Math.max(0,...existing.map(e => Number(String(e.competitor_no).match(/^D(\d+)$/)?.[1] || 0)));
        const recordedAt = new Date().toISOString(), codes = [];
        for (const item of staged) {
          const code = `D${String(++number).padStart(3,'0')}`;
          codes.push(code);
          results.extraPoomsaeEntries.push({ day:'1', event:'POOMSAE PRO', source_pdf:'', source_page:'', team:item.team,
            competitor_no:code, name:item.name, name_truncated_in_pdf:'no', category:item.category });
          delete results.awards[JSON.stringify([1,'POOMSAE PRO','D',item.category])];
        }
        results.audit.push({ action:'POOMSAE_ENTRIES_ADDED', codes, entries:staged, recordedAt });
        results.version++; await save();
        return json(res, 200, { ok:true, count:staged.length, codes, version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/award/call') {
        if (!['admin','awards'].includes(auth.role)) return error(res, 403, 'Awards access required');
        const body = await readBody(req);
        const award = publicData().awards.find(a => a.id === body.awardId);
        if (!award) return error(res, 404, 'Category not found');
        if (!award.finished || award.autoRing) return error(res, 409, 'This category is not handled at the podium');
        const record = results.awards[award.id] ||= { medalists:{} };
        record.calledAt = new Date().toISOString();
        record.callCount = (record.callCount || 0) + 1;
        results.audit.push({ action:'AWARD_CALL', awardId:award.id, calledAt:record.calledAt, recordedAt:record.calledAt });
        results.version++; await save();
        return json(res, 200, { ok:true, version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/award/medal') {
        if (!['admin','awards'].includes(auth.role)) return error(res, 403, 'Awards access required');
        const body = await readBody(req);
        const award = publicData().awards.find(a => a.id === body.awardId);
        if (!award) return error(res, 404, 'Category not found');
        if (!award.finished || award.autoRing) return error(res, 409, 'This category is not handled at the podium');
        if (!award.medals.some(m => m.athleteId === body.athleteId)) return error(res, 400, 'Athlete is not a medalist in this category');
        const state = String(body.state || '').toUpperCase();
        if (!['PENDING','DELIVERED','ABSENT'].includes(state)) return error(res, 400, 'Invalid medal status');
        const record = results.awards[award.id] ||= { medalists:{} };
        record.medalists ||= {};
        const updatedAt = new Date().toISOString();
        record.medalists[body.athleteId] = { state, updatedAt, note:String(body.note || '').slice(0,200) };
        const everyResolved = award.medals.every(m => ['DELIVERED','ABSENT'].includes(record.medalists[m.athleteId]?.state));
        if (everyResolved && !record.deliveredAt) record.deliveredAt = updatedAt;
        if (!everyResolved) delete record.deliveredAt;
        results.audit.push({ action:'AWARD_MEDAL', awardId:award.id, athleteId:body.athleteId, state, updatedAt, recordedAt:updatedAt });
        results.version++; await save();
        return json(res, 200, { ok:true, version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/transfer') {
        if (auth.role !== 'admin') return error(res, 403, 'Admin access required');
        const body = await readBody(req);
        if (Number(body.version) !== results.version) return error(res, 409, 'Schedule changed. Refresh and try again.');
        const day = Number(body.day), source = String(body.sourceRing || '').toUpperCase(), target = String(body.targetRing || '').toUpperCase(), prefix = String(body.codePrefix || source).toUpperCase();
        const first = Number(body.from), last = Number(body.to);
        if (![1,2].includes(day) || !/^[A-J]$/.test(source) || !/^[A-J]$/.test(target) || !/^[A-J]$/.test(prefix) || !Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first) return error(res, 400, 'Invalid transfer range');
        const comp = activeCompetition(), schedule = scheduleFor(comp), sourceKey = `${day}:${source}`, targetKey = `${day}:${target}`;
        const selected = (schedule[sourceKey] || []).filter(id => { const b = comp.bouts.find(x => x.id === id); const number = Number(b?.code.match(/^[A-Z](\d+)/)?.[1]); return b && b.code[0] === prefix && number >= first && number <= last; });
        if (!selected.length) return error(res, 400, 'No bouts in that range on the source ring');
        const afterId = String(body.afterBoutId || '');
        if (afterId && !(schedule[targetKey] || []).includes(afterId)) return error(res, 400, 'Insertion point is not on the target ring');
        if (selected.includes(afterId)) return error(res, 400, 'Choose an insertion point outside the selected range');
        schedule[sourceKey] = schedule[sourceKey].filter(id => !selected.includes(id));
        if (sourceKey === targetKey) schedule[targetKey] = schedule[sourceKey];
        const targetList = schedule[targetKey] ||= [];
        targetList.splice(afterId ? targetList.indexOf(afterId) + 1 : 0, 0, ...selected);
        results.schedule = schedule;
        results.audit.push({ action:'TRANSFER', day, source, target, prefix, from:first, to:last, afterBoutId:afterId, count:selected.length, recordedAt:new Date().toISOString() });
        results.version++; await save();
        return json(res, 200, { ok:true, count:selected.length, version:results.version });
      }
      if (req.method === 'POST' && ['/api/admin/extra-bout','/api/admin/extra-bouts'].includes(url.pathname)) {
        if (auth.role !== 'admin') return error(res, 403, 'Admin access required');
        const body = await readBody(req);
        if (Number(body.version) !== results.version) return error(res, 409, 'Competition changed. Refresh and try again.');
        const entries = url.pathname.endsWith('/extra-bouts') ? body.entries : [body];
        if (!Array.isArray(entries) || !entries.length || entries.length > 30) return error(res, 400, 'Stage 1 to 30 qualifying bouts');
        const comp = activeCompetition(), schedule = scheduleFor(comp), newBouts = [], newAthletes = [], newAudit = [], usedSlots = new Set();
        const usedCodes = new Set(comp.bouts.map(b => `${b.day}:${b.event}:${b.code}`));
        const tailByAnchor = new Map();
        for (const entry of entries) {
          const target = comp.bouts.find(b => b.id === entry.targetBoutId);
          if (!target || !target.directIds.includes(entry.sourceAthleteId)) return error(res, 400, 'Choose an existing athlete slot in each destination bout');
          if (usedSlots.has(`${target.id}:${entry.sourceAthleteId}`)) return error(res, 400, 'The same athlete slot cannot be qualified twice');
          if (results.bouts[target.id]) return error(res, 409, 'Undo the destination result before adding a qualifying bout');
          const name = String(entry.name || '').trim(), team = String(entry.team || '').trim();
          if (!name || !team || name.length > 120 || team.length > 120) return error(res, 400, 'Enter each new athlete and club');
          const ring = String(entry.assignedRing || target.code[0]).toUpperCase(), key = `${target.day}:${ring}`;
          if (!/^[A-J]$/.test(ring)) return error(res, 400, 'Choose a valid assigned ring');
          const afterId = String(entry.afterBoutId || ''), list = schedule[key] ||= [];
          if (afterId && !list.includes(afterId)) return error(res, 400, 'Insertion point is not on the assigned ring');
          const targetPosition = list.indexOf(target.id);
          if (targetPosition >= 0 && afterId && list.indexOf(afterId) >= targetPosition) return error(res, 400, 'Insert each qualifier before its destination match');
          const anchor = comp.bouts.find(b => b.id === afterId) || newBouts.find(b => b.id === afterId) || target;
          const base = `${ring}${String(Number(anchor.code.match(/^[A-Z](\d+)/)?.[1] || 0)).padStart(3,'0')}`;
          let suffixIndex = 0, code;
          do {
            let n = suffixIndex++, suffix = '';
            do { suffix = String.fromCharCode(65 + n % 26) + suffix; n = Math.floor(n / 26) - 1; } while (n >= 0);
            code = base + suffix;
          } while (usedCodes.has(`${target.day}:${target.event}:${code}`));
          usedCodes.add(`${target.day}:${target.event}:${code}`);
          const uuid = crypto.randomUUID(), challengerId = `extra:${uuid}`, id = `${target.day}:${target.event}:extra:${uuid}`;
          const sourceCorner = entry.sourceCorner === 'R' ? 'R' : 'B';
          newAthletes.push({ id:challengerId, day:target.day, event:target.event, number:'EXTRA', name, team, category:target.category, route:[] });
          newBouts.push({ id, code, targetBoutId:target.id, sourceId:entry.sourceAthleteId, sourceType:'direct', sourceCorner, challengerCorner:sourceCorner === 'B' ? 'R' : 'B', challengerId });
          const insertAfter = tailByAnchor.get(`${key}:${afterId}`) || afterId;
          list.splice(insertAfter ? list.indexOf(insertAfter) + 1 : 0, 0, id);
          tailByAnchor.set(`${key}:${afterId}`, id);
          usedSlots.add(`${target.id}:${entry.sourceAthleteId}`);
          newAudit.push({ action:'EXTRA_BOUT', boutId:id, code, targetBoutId:target.id, sourceAthleteId:entry.sourceAthleteId, challengerId, ring, afterBoutId:afterId, recordedAt:new Date().toISOString() });
        }
        results.extraAthletes.push(...newAthletes);
        results.extraBouts.push(...newBouts);
        results.audit.push(...newAudit);
        results.schedule = schedule;
        results.version++; await save(); rebuildMaps(activeCompetition());
        return json(res, 200, { ok:true, count:newBouts.length, codes:newBouts.map(b => b.code), version:results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/result') {
        if (!['admin','coordinator'].includes(auth.role)) return error(res, 403, 'Result access required');
        const body = await readBody(req);
        const bout = boutsById.get(body.boutId);
        if (!bout) return error(res, 404, 'Bout not found');
        const snapshot = publicData();
        const projected = snapshot.bouts.find(b => b.id === bout.id);
        if (auth.role === 'coordinator' && projected.assignedRing !== auth.ring) return error(res, 403, 'This bout is assigned to another ring');
        if (auth.role === 'coordinator' && projected.day === 2 && (snapshot.bouts.some(b => b.day === 1 && !['COMPLETE','BYE'].includes(b.status)) || snapshot.poomsae.some(g => !g.finished))) return error(res, 403, 'Day 2 opens after all Day 1 rings finish');
        if (projected.status !== 'READY') return error(res, 409, 'This bout is not ready');
        if (![projected.redId, projected.blueId].includes(body.winnerId)) return error(res, 400, 'Winner must be in this bout');
        const method = String(body.method || 'PTF').toUpperCase();
        if (!['PTF', 'PTG', 'GDP', 'RSC', 'SUP', 'WDR', 'DSQ', 'PUN', 'DQB', 'POINTS'].includes(method)) return error(res, 400, 'Invalid result method');
        const record = { winnerId: body.winnerId, method, note: String(body.note || '').slice(0, 500), recordedAt: new Date().toISOString() };
        results.bouts[bout.id] = record;
        results.audit.push({ action: 'RESULT', boutId: bout.id, ...record });
        results.version++;
        await save();
        return json(res, 200, { ok: true, version: results.version });
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/undo') {
        if (!['admin','coordinator'].includes(auth.role)) return error(res, 403, 'Result access required');
        const body = await readBody(req);
        const bout = boutsById.get(body.boutId);
        if (!bout || !results.bouts[bout.id]) return error(res, 404, 'Recorded result not found');
        const snapshot = publicData();
        if (auth.role === 'coordinator' && snapshot.bouts.find(b => b.id === bout.id)?.assignedRing !== auth.ring) return error(res, 403, 'This bout is assigned to another ring');
        if (auth.role === 'coordinator' && bout.day === 2 && (snapshot.bouts.some(b => b.day === 1 && !['COMPLETE','BYE'].includes(b.status)) || snapshot.poomsae.some(g => !g.finished))) return error(res, 403, 'Day 2 opens after all Day 1 rings finish');
        const allBouts = activeCompetition().bouts;
        const later = new Set(), pending = [bout.id];
        while (pending.length) {
          const childId = pending.pop();
          for (const item of allBouts.filter(b => b.childIds.includes(childId))) if (!later.has(item.id)) { later.add(item.id); pending.push(item.id); }
        }
        if ([...later].some(id => results.bouts[id])) return error(res, 409, 'Undo later results in this bracket first');
        delete results.bouts[bout.id];
        delete results.awards[JSON.stringify([bout.day, bout.event, bout.code[0], bout.category])];
        results.audit.push({ action: 'UNDO', boutId: bout.id, note: String(body.reason || '').slice(0, 500), recordedAt: new Date().toISOString() });
        results.version++;
        await save();
        return json(res, 200, { ok: true, version: results.version });
      }
      return error(res, 404, 'Not found');
    }
    if (req.method === 'GET' && url.pathname === '/api/export.csv') {
      const data = publicData();
      const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
      const lines = [['day','event','bout','assigned_ring','schedule_order','category','red','blue','winner','method','status'], ...data.bouts.map(b =>
        [b.day,b.event,b.code,b.assignedRing,b.scheduleOrder,b.category,athletesById.get(b.redId)?.name,athletesById.get(b.blueId)?.name,athletesById.get(b.winnerId)?.name,b.method,b.status])];
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="rsb-results.csv"' });
      return res.end('\uFEFF' + lines.map(line => line.map(quote).join(',')).join('\r\n'));
    }
    if (req.method !== 'GET') return error(res, 404, 'Not found');
    const publicPages = new Set(['/live','/schedule','/brackets','/teams','/results','/awards']);
    const adminPages = new Set(['/admin/bouts','/admin/awards','/admin/transfer','/admin/qualifying','/admin/staff-pins','/admin/poomsae-pro']);
    const requested = url.pathname === '/' ? '/index.html' : url.pathname === '/awards/history' ? '/awards-history.html' : url.pathname === '/admin/awards/history' ? '/admin-awards-history.html' : publicPages.has(url.pathname) ? `${url.pathname}.html` :
      url.pathname === '/admin' ? '/admin.html' : adminPages.has(url.pathname) ? `/admin-${url.pathname.split('/').at(-1)}.html` : url.pathname;
    const file = path.resolve(root, 'public', `.${requested}`);
    if (!file.startsWith(path.join(root, 'public') + path.sep)) return error(res, 403, 'Forbidden');
    const content = await fsp.readFile(file);
    res.writeHead(200, { 'Content-Type': `${mime[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-cache' });
    res.end(content);
  } catch (err) {
    error(res, err.code === 'ENOENT' ? 404 : 500, err.code === 'ENOENT' ? 'Not found' : err.message);
  } finally {
    if (transactionOpen) {
      await activeDbClient.query('ROLLBACK').catch(() => {});
      transactionOpen = false;
    }
    if (activeDbClient) {
      activeDbClient.release();
      activeDbClient = null;
    }
  }
}

// The shared state object belongs to one request at a time. PostgreSQL row locks
// serialize writes across app instances, while this queue serializes local reads.
let requestQueue = Promise.resolve();
const server = http.createServer((req, res) => {
  const current = requestQueue.then(() => handleRequest(req, res));
  requestQueue = current.catch(err => {
    if (!res.headersSent) error(res, 500, err.message);
  });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  initializeDatabase().then(() => server.listen(port, host, () =>
    console.log(`RSB system: http://${host}:${port} | admin password: ${process.env.ADMIN_PASSWORD ? 'set by ADMIN_PASSWORD' : adminPassword}`)
  )).catch(err => { console.error(`Database startup failed: ${err.message}`); process.exitCode = 1; database.end(); });
}
