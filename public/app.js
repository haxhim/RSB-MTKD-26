const root = document.querySelector('#app');
const isAdminPage = /^\/admin(?:\.html|\/(?:bouts|awards(?:\/history)?|transfer|qualifying|staff-pins|poomsae-pro))?\/?$/.test(location.pathname);
const publicPage = { '/':'live', '/live':'live', '/live.html':'live', '/schedule':'schedule', '/schedule.html':'schedule', '/brackets':'brackets', '/brackets.html':'brackets', '/teams':'teams', '/teams.html':'teams', '/results':'results', '/results.html':'results', '/awards':'awards', '/awards.html':'awards', '/awards/history':'awardsHistory', '/awards-history.html':'awardsHistory' };
const adminRoutes = { '/admin':'dashboard', '/admin.html':'dashboard', '/admin/bouts':'bouts', '/admin/awards':'awards', '/admin/awards/history':'awardsHistory', '/admin/transfer':'transfer', '/admin/qualifying':'qualifying', '/admin/staff-pins':'coordinators', '/admin/poomsae-pro':'poomsae' };
const publicHref = { live:'/live', schedule:'/schedule', brackets:'/brackets', teams:'/teams', results:'/results', awards:'/awards' };
const adminHref = section => ({ dashboard:'/admin', bouts:'/admin/bouts', awards:'/admin/awards', awardsHistory:'/admin/awards/history', transfer:'/admin/transfer', qualifying:'/admin/qualifying', coordinators:'/admin/staff-pins', poomsae:'/admin/poomsae-pro' })[section] || '/admin';
const initialParams = new URLSearchParams(location.search);
const track = { 'POOMSAE CARNIVAL': 'Poomsae Carnival', 'POOMSAE PRO': 'Poomsae Pro', 'KYORUGI CLASS B': 'Kyorugi · Class B Body Kick', 'VIRTUAL DAY 1': 'Virtual', 'RSB CLASS A': 'Kyorugi · Class A', 'VIRTUAL DAY 2': 'Virtual · Day 2', 'TEAM SPARRING': 'Team Sparring' };
const day1Plan = 'ABCDEFGHIJ'.split('').map(ring => ({ ring, event: 'ABC'.includes(ring) ? 'POOMSAE CARNIVAL' : ring === 'D' ? 'POOMSAE PRO' : 'EFGH'.includes(ring) ? 'KYORUGI CLASS B' : 'VIRTUAL DAY 1' }));
const day2Plan = 'ABCDEFGHIJ'.split('').map(ring => ({ ring, event: 'ABCDEFG'.includes(ring) ? 'RSB CLASS A' : ring === 'H' ? 'TEAM SPARRING' : 'VIRTUAL DAY 2', label: ring === 'H' ? 'Team Kyorugi' : ring === 'I' || ring === 'J' ? 'VR' : 'Individual Kyorugi' }));
let data = null, view = publicPage[location.pathname] || 'live', day = initialParams.get('day') === '1' ? 1 : 2, event = initialParams.get('day') === '1' ? 'POOMSAE CARNIVAL' : 'RSB CLASS A', ring = initialParams.get('ring') || (isAdminPage ? 'ALL' : 'A'), query = '', token = sessionStorage.getItem('rsb-token') || '', role = sessionStorage.getItem('rsb-role') || '', coordinatorRing = sessionStorage.getItem('rsb-ring') || '', notice = '';
if (!isAdminPage && initialParams.has('ring')) event = (day === 1 ? day1Plan : day2Plan).find(item => item.ring === ring)?.event || event;
let adminStatus = initialParams.get('status') || 'ALL', targetRing = 'B', extraTargetId = '';
let adminSection = adminRoutes[location.pathname] || 'dashboard', adminPage = 0;
let transferSourceRing = 'A', transferTargetRing = 'B', transferPrefix = 'A', transferStart = null, transferEnd = null, transferAfterId = '', transferQuery = '';
let qualifyingRing = 'ALL', qualifyingCategory = 'ALL', qualifyingQuery = '', qualifyingPage = 0, qualifyingSelectedId = '', qualifyingDraft = [];
let proEntryDraft = [];
let teamClub = 'ALL', teamQuery = '', teamPage = 0;
let tallyEvent = day === 2 ? 'VIRTUAL DAY 2' : 'POOMSAE CARNIVAL', tallyScope = 'ALL', tallyAge = 'ALL';
let poomsaeQuery = '', poomsaeCategory = '';
let awardQuery = '', awardPublicStatus = 'ALL', awardPublicPage = 0, awardAdminQuery = '', awardAdminStatus = 'ALL', awardAdminRing = 'ALL', awardAdminPage = 0;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const athlete = id => data?.athletes.find(item => item.id === id);
const label = id => athlete(id)?.name || 'Awaiting winner';
const statusText = { READY: 'Ready', COMPLETE: 'Completed', WAITING: 'Waiting', BYE: 'Bye' };
const awardStatusText = { NOT_CALLED:'Not called', CALLED:'Called', DELIVERED:'Delivered', DELIVERED_IN_RING:'Delivered in Ring' };
const medalStateText = { PENDING:'Awaiting medal', DELIVERED:'Medal delivered', ABSENT:'Athlete absent', DELIVERED_IN_RING:'Delivered in Ring' };
const archivedAward = a => ['DELIVERED','DELIVERED_IN_RING'].includes(a.status);
const malaysiaTime = value => value ? new Intl.DateTimeFormat('en-MY',{ timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true }).format(new Date(value)) + ' MYT' : 'Time unavailable';
const stageText = ['Final', 'Semifinal', 'Quarterfinal', 'Round of 16', 'Round of 32'];
const formattedEvent = name => track[name] || name;
const boutNo = code => String(code).replace(/^[A-Z]/, '');
const liveBoutNo = code => String(code).replace(/^([A-Z])(\d+)/, (_, ringLetter, number) => `${ringLetter}${number.padStart(3, '0')}`);
const escapeAttr = escapeHtml;
const day2Phase = b => /TEAM\s*(?:KYORUGI|SPARRING)|(?:KYORUGI|SPARRING)\s*TEAM/i.test(`${b.event} ${b.category}`) ? 'team' : /VIRTUAL|\bVR\b/i.test(b.event) ? 'virtual' : 'individual';
const day2Order = bouts => day === 2 ? [...bouts].sort((a, b) => {
  const rank = { individual: 0, virtual: 1, team: 2 };
  return rank[day2Phase(a)] - rank[day2Phase(b)] || a.code.localeCompare(b.code, undefined, { numeric: true });
}) : bouts;
const day2Pending = () => data.bouts.some(b => b.day === 1 && !['COMPLETE','BYE'].includes(b.status)) || data.poomsae.some(g => !g.finished);
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Request failed');
  return result;
}
async function refresh(silent = false) {
  try {
    const next = await api('/api/state');
    let sessionExpired = false;
    if (isAdminPage && token) {
      try { const session = await api('/api/admin/session'); role = session.role; coordinatorRing = session.ring || ''; if (role === 'coordinator') { ring = coordinatorRing; if (!['dashboard','bouts',...(coordinatorRing === 'D' ? ['poomsae'] : [])].includes(adminSection)) adminSection = 'dashboard'; } if (role === 'awards' && !['awards','awardsHistory'].includes(adminSection)) adminSection = 'awards'; }
      catch { token = ''; role = ''; coordinatorRing = ''; ['rsb-token','rsb-role','rsb-ring'].forEach(key => sessionStorage.removeItem(key)); notice = 'Session expired. Sign in again.'; sessionExpired = true; }
    }
    if (silent && !sessionExpired && (next.version === data?.version || document.querySelector('.modal-backdrop'))) return;
    data = next;
    if (isAdminPage && day === 2 && coordinatorDay2Locked()) day = 1;
    render();
  } catch (error) { if (!silent) root.innerHTML = `<div class="error-page"><h1>Could not load the competition</h1><p>${escapeHtml(error.message)}</p><button onclick="location.reload()">Retry</button></div>`; }
}
const assignedRing = b => b.assignedRing || b.code[0];
const scheduleSort = (a,b) => a.day - b.day || assignedRing(a).localeCompare(assignedRing(b)) || a.scheduleOrder - b.scheduleOrder;
const filtered = () => data.bouts.filter(b => b.day === day && (isAdminPage || event === 'ALL' || b.event === event) && (ring === 'ALL' || assignedRing(b) === ring) &&
  (!query || `${b.code} ${b.category} ${b.event} ${label(b.redId)} ${label(b.blueId)}`.toLowerCase().includes(query.toLowerCase())));
const cornerName = corner => corner === 'B' ? 'Chung' : 'Hong';
const person = (id, corner, winnerId) => `<div class="person ${winnerId === id ? 'winner' : ''}"><span class="corner ${corner.toLowerCase()}">${cornerName(corner)}</span><div><strong>${escapeHtml(label(id))}</strong><small>${id ? escapeHtml(athlete(id)?.team) : 'To be determined'}</small></div>${winnerId === id ? '<span class="winner-mark">Winner</span>' : ''}</div>`;
const upcomingRow = b => `<div class="upcoming-row"><strong>${escapeHtml(liveBoutNo(b.code))}</strong><span><i class="corner b">Chung</i><b>${escapeHtml(label(b.blueId))}</b></span><span><i class="corner r">Hong</i><b>${escapeHtml(label(b.redId))}</b></span><small>${statusText[b.status]}</small></div>`;
function card(b, actions = false, current = false, upcoming = []) {
  return `<article class="bout-card ${b.status.toLowerCase()} ${current ? 'live-current' : ''}"><header><div><span class="bout-code">${current || isAdminPage ? '' : 'Bout '}${escapeHtml(current ? liveBoutNo(b.code) : isAdminPage ? b.code : boutNo(b.code))}</span><span class="event-tag">${escapeHtml(formattedEvent(b.event))}</span></div><span class="status ${current ? 'current' : b.status.toLowerCase()}">${current ? 'Current' : statusText[b.status]}</span></header>
    <div class="bout-meta">Assigned ring ${escapeHtml(assignedRing(b))} <span>·</span> ${escapeHtml(b.category)} <span>·</span> ${stageText[b.stage] || 'Qualifier'}</div>
    <div class="contestants">${person(b.blueId, 'B', b.winnerId)}${person(b.redId, 'R', b.winnerId)}</div>
    ${current ? `<div class="upcoming"><div class="upcoming-title">Upcoming on Ring ${escapeHtml(assignedRing(b))}</div>${upcoming.length ? upcoming.map(upcomingRow).join('') : '<div class="upcoming-empty">No further bouts scheduled</div>'}</div>` : ''}
    ${b.method ? `<div class="bout-footer">${b.method === 'BYE' ? 'Automatic advance' : `Result: ${escapeHtml(b.method)}`}</div>` : ''}
    ${actions && b.status === 'READY' ? `<button class="primary record" data-bout="${escapeAttr(b.id)}">Record winner</button>` : ''}
    ${actions && b.status === 'COMPLETE' ? `<button class="text-button undo" data-bout="${escapeAttr(b.id)}">Undo result</button>` : ''}</article>`;
}
function tabs() { return `<nav class="tabs" aria-label="Main navigation">${[['live','Live'],['schedule','Schedule'],['brackets','Brackets'],['teams','Teams'],['results','Results'],['awards','Awards']].map(([id,name]) => `<a class="tab ${view === id ? 'active' : ''}" href="${publicHref[id]}?day=${day}" ${view === id ? 'aria-current="page"' : ''}>${name}</a>`).join('')}</nav>`; }
function filters(showSearch = true) {
  return `<div class="filters"><div class="day-toggle"><button data-day="2" class="${day === 2 ? 'selected' : ''}">Day 2 <small>4 Oct</small></button><button data-day="1" class="${day === 1 ? 'selected' : ''}">Day 1 <small>3 Oct</small></button></div>
  ${showSearch ? `<label class="filter-search">Search<input id="search" placeholder="Bout, category or athlete" value="${escapeAttr(query)}"></label>` : ''}</div>`;
}
function ringPlan() {
  const plan = day === 1 ? day1Plan : day2Plan;
  return `<section class="ring-plan" aria-label="Day ${day} ring assignments"><div class="ring-plan-title"><p class="eyebrow">Day ${day} layout</p><h2>Choose ring A–J</h2></div><div class="ring-plan-grid">${plan.map(item => `<button class="ring-plan-item ${ring === item.ring ? 'selected' : ''}" data-plan-ring="${item.ring}" aria-pressed="${ring === item.ring}"><strong>${item.ring}</strong><span>${escapeHtml(item.label || formattedEvent(item.event))}</span>${item.note ? `<small>${escapeHtml(item.note)}</small>` : ''}</button>`).join('')}</div></section>`;
}
const emptyMessage = () => 'No bouts match this selection.';
function overview(allRings = false, currentCount = null) {
  if (!allRings && day === 1 && ring === 'D') {
    const groups = data.poomsae, entries = groups.flatMap(g => g.entrants);
    return `<div class="metrics"><div><span>Poomsae Pro categories</span><strong>${groups.length}</strong></div><div><span>Entries</span><strong>${entries.length}</strong></div><div><span>Marks recorded</span><strong>${entries.filter(e => e.score !== null).length}</strong></div><div><span>Categories finished</span><strong>${groups.filter(g => g.finished).length}</strong></div></div>`;
  }
  const dayBouts = data.bouts.filter(b => b.day === day && (allRings || ((event === 'ALL' || b.event === event) && (ring === 'ALL' || assignedRing(b) === ring))));
  return `<div class="metrics"><div><span>Scheduled bouts</span><strong>${dayBouts.length}</strong></div><div><span>${currentCount === null ? 'Ready now' : 'Current ring bouts'}</span><strong>${currentCount ?? dayBouts.filter(b => b.status === 'READY').length}</strong></div><div><span>Completed</span><strong>${dayBouts.filter(b => b.status === 'COMPLETE').length}</strong></div><div><span>Automatic byes</span><strong>${dayBouts.filter(b => b.status === 'BYE').length}</strong></div></div>`;
}
function live() {
  const ready = day === 2 && day2Pending() ? [] : data.bouts.filter(b => b.day === day && b.status === 'READY').sort(scheduleSort);
  const byRing = new Map();
  for (const bout of ready) if (!byRing.has(assignedRing(bout))) byRing.set(assignedRing(bout), bout);
  const current = [...byRing.values()].filter(b => !query || `${b.code} ${liveBoutNo(b.code)} ${b.category} ${b.event} ${label(b.redId)} ${label(b.blueId)} ${athlete(b.redId)?.team || ''} ${athlete(b.blueId)?.team || ''}`.toLowerCase().includes(query.toLowerCase()));
  const nextThree = b => data.bouts.filter(other => other.day === day && assignedRing(other) === assignedRing(b) && other.scheduleOrder > b.scheduleOrder && !['COMPLETE', 'BYE'].includes(other.status))
    .sort(scheduleSort).slice(0, 3);
  const proEntries = day === 1 ? data.poomsae.flatMap(g => g.entrants.map(e => ({ ...e, category:g.category })))
    .filter(e => e.score === null).sort((a,b) => a.code.localeCompare(b.code, undefined, { numeric:true })) : [];
  const proCurrent = proEntries[0], proUpcoming = proEntries.slice(1,4);
  const proMatches = proCurrent && (!query || [proCurrent,...proUpcoming].some(e => `${e.code} ${e.name} ${e.team} ${e.category}`.toLowerCase().includes(query.toLowerCase())));
  const proCard = proMatches ? `<article class="bout-card live-current pro-live"><header><div><span class="bout-code">${escapeHtml(proCurrent.code)}</span><span class="event-tag">Poomsae Pro</span></div><span class="status current">Current</span></header><div class="bout-meta">Ring D · ${escapeHtml(proCurrent.category)} · Single round</div><div class="pro-live-current"><strong>${escapeHtml(proCurrent.name)}</strong><small>${escapeHtml(proCurrent.team)}</small></div><div class="upcoming"><div class="upcoming-title">Next 3 on Ring D</div><table class="pro-live-table"><thead><tr><th>Entry</th><th>Player / category</th></tr></thead><tbody>${proUpcoming.map(e => `<tr><td>${escapeHtml(e.code)}</td><td><strong>${escapeHtml(e.name)}</strong><small>${escapeHtml(e.team)} · ${escapeHtml(e.category)}</small></td></tr>`).join('') || '<tr><td colspan="2">No further entries</td></tr>'}</tbody></table></div><a class="pro-live-link" href="/schedule?day=1&ring=D">View Ring D scores ↗</a></article>` : '';
  const cards = current.map(b => ({ ring:assignedRing(b), html:card(b, false, true, nextThree(b)) }));
  if (proCard) cards.push({ ring:'D', html:proCard });
  cards.sort((a,b) => a.ring.localeCompare(b.ring));
  return `${filters()}${overview(true, byRing.size + (proCurrent ? 1 : 0))}<section class="section-heading"><div><p class="eyebrow">On now</p><h2>Current bout by ring</h2></div><span>${cards.length} rings shown</span></section>
    ${cards.length ? `<div class="card-grid">${cards.map(item => item.html).join('')}</div>` : `<div class="empty">${day === 2 && day2Pending() ? 'Day 2 live bouts begin after every Day 1 ring and Poomsae Pro scoring finish.' : 'No current bouts match this day and search.'}</div>`}`;
}
function poomsaePublicView(mode) {
  const groups = data.poomsae.filter(g => !query || `${g.category} ${g.entrants.map(e => `${e.name} ${e.team}`).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const preparation = new Map();
  if (mode === 'schedule') {
    const pending = data.poomsae.flatMap(g => g.entrants).filter(e => e.score === null).sort((a,b) => a.code.localeCompare(b.code, undefined, { numeric:true }));
    if (pending[0]) preparation.set(pending[0].code, 'current');
    for (const entry of pending.slice(1,6)) preparation.set(entry.code, 'prepare');
  }
  return `${ringPlan()}${filters()}${overview()}<div class="section-heading"><div><p class="eyebrow">Ring D · single round</p><h2>${mode === 'results' ? 'Poomsae Pro results' : 'Poomsae Pro score sheets'}</h2></div><span>${groups.length} categories</span></div>
  <div class="pro-public-list">${groups.map(g => `<section class="pro-public-card"><header><div><small>Ring D · Poomsae Pro</small><h3>${escapeHtml(g.category)}</h3></div><span class="status ${g.finished ? 'complete' : 'waiting'}">${g.finished ? 'Finished' : 'Awaiting marks'}</span></header><div class="pro-public-head"><span>Entry / athlete</span><span>Club</span><span>Mark</span><span>Rank</span></div>${g.entrants.map(e => `<div class="pro-public-row"><span><b>${escapeHtml(e.code)}</b><strong>${escapeHtml(e.name)}</strong>${preparation.has(e.code) ? `<small class="pro-schedule-callout ${preparation.get(e.code)}">${preparation.get(e.code) === 'current' ? 'Current' : 'Please be prepared at your ring'}</small>` : ''}</span><span>${escapeHtml(e.team)}</span><strong>${e.score === null ? '—' : e.score.toFixed(3)}</strong><strong>${e.rank ?? '—'}</strong></div>`).join('')}</section>`).join('') || '<div class="empty">No Poomsae Pro categories match this search.</div>'}</div>`;
}
const schedulePlayer = (id, corner) => `<span><i class="corner ${corner.toLowerCase()}">${cornerName(corner)}</i><span class="schedule-athlete"><b>${escapeHtml(label(id))}</b><small>${escapeHtml(id ? athlete(id)?.team || 'Club not listed' : 'To be determined')}</small></span></span>`;
function preparationStatus() {
  const labels = new Map(), byRing = new Map();
  if (day === 2 && day2Pending()) return labels;
  for (const bout of data.bouts.filter(b => b.day === day && !['COMPLETE','BYE'].includes(b.status))) {
    const key = assignedRing(bout);
    if (!byRing.has(key)) byRing.set(key, []);
    byRing.get(key).push(bout);
  }
  for (const bouts of byRing.values()) {
    bouts.sort(scheduleSort);
    const currentIndex = bouts.findIndex(b => b.status === 'READY');
    if (currentIndex < 0) continue;
    labels.set(bouts[currentIndex].id, 'current');
    for (const bout of bouts.slice(currentIndex + 1,currentIndex + 6)) labels.set(bout.id, 'prepare');
  }
  return labels;
}
const scheduleRow = (b, callout) => `<div class="schedule-row bout-schedule-row"><span class="list-code">${escapeHtml(liveBoutNo(b.code))}</span><div class="schedule-content"><strong>${escapeHtml(b.category)}</strong><small>Assigned ring ${escapeHtml(assignedRing(b))} · ${formattedEvent(b.event)} · ${stageText[b.stage] || 'Qualifier'}</small><div class="schedule-players">${schedulePlayer(b.blueId, 'B')}${schedulePlayer(b.redId, 'R')}</div></div><span class="status ${callout || b.status.toLowerCase()}">${callout === 'current' ? 'Current' : callout === 'prepare' ? 'Please be prepared at your ring' : statusText[b.status]}</span></div>`;
function schedule() {
  if (day === 1 && ring === 'D') return poomsaePublicView('schedule');
  const selected = filtered().sort(scheduleSort);
  const labels = preparationStatus();
  return `${ringPlan()}${filters()}${overview()}<div class="section-heading"><div><p class="eyebrow">Competition order</p><h2>Ring ${ring} bouts</h2></div><span>${selected.length} shown</span></div>
    ${selected.length ? `<div class="schedule-list">${selected.map(b => scheduleRow(b, labels.get(b.id))).join('')}</div>` : `<div class="empty">${emptyMessage()}</div>`}`;
}
function bracketDiagram(group) {
  const nodes = new Map(group.map(b => [b.id, b]));
  const roots = group.filter(b => b.stage === 0);
  const positions = new Map();
  const byeSlots = [];
  const maxStage = Math.max(...group.map(b => b.stage));
  let nextLeaf = 0;
  function place(b) {
    if (positions.has(b.id)) return positions.get(b.id);
    const children = b.childIds.map(id => nodes.get(id)).filter(Boolean).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    let y;
    if (!children.length && b.directIds.length === 2 && b.stage < maxStage) {
      const values = [...b.directIds].sort((a, c) => (b.corners[a] === 'B' ? 0 : 1) - (b.corners[c] === 'B' ? 0 : 1)).map(athleteId => {
        const leaf = nextLeaf++;
        byeSlots.push({ parent: b, athleteId, y: leaf });
        return leaf;
      });
      y = values.reduce((a, v) => a + v, 0) / values.length;
    } else if (!children.length) y = nextLeaf++;
    else {
      const values = children.map(place);
      for (const athleteId of b.directIds) {
        const leaf = nextLeaf++;
        values.push(leaf);
        if (b.stage < maxStage) byeSlots.push({ parent: b, athleteId, y: leaf });
      }
      y = values.reduce((a, v) => a + v, 0) / values.length;
    }
    positions.set(b.id, y);
    return y;
  }
  roots.forEach(place);
  group.filter(b => !positions.has(b.id)).forEach(place);
  const columnWidth = 280, gap = 40, rowHeight = 130, cardHeight = 102;
  const width = (maxStage + 1) * columnWidth + maxStage * gap;
  const height = Math.max(190, nextLeaf * rowHeight);
  const x = stage => (maxStage - stage) * (columnWidth + gap);
  const cy = b => (positions.get(b.id) + .5) * rowHeight;
  const lines = group.flatMap(b => b.childIds.map(id => {
    const child = nodes.get(id);
    if (!child) return '';
    const x1 = x(child.stage) + columnWidth - 10, x2 = x(b.stage) + 10, y1 = cy(child), y2 = cy(b), mid = (x1 + x2) / 2;
    return `<path d="M ${x1} ${y1} H ${mid} V ${y2} H ${x2}" />`;
  })).join('') + byeSlots.map(slot => {
    const x1 = x(slot.parent.stage + 1) + columnWidth - 10, x2 = x(slot.parent.stage) + 10;
    const y1 = (slot.y + .5) * rowHeight, y2 = cy(slot.parent), mid = (x1 + x2) / 2;
    return `<path d="M ${x1} ${y1} H ${mid} V ${y2} H ${x2}" />`;
  }).join('');
  const headings = Array.from({ length: maxStage + 1 }, (_, index) => {
    const stage = maxStage - index;
    return `<div class="bracket-round-heading" style="left:${x(stage)}px">${stageText[stage]}</div>`;
  }).join('');
  const byePerson = corner => `<div class="person bye-entrant"><span class="corner ${corner.toLowerCase()}">${cornerName(corner)}</span><div><strong>BYE</strong><small>Empty slot</small></div></div>`;
  const cards = group.map(b => `<div class="bracket-match ${b.status.toLowerCase()}" style="left:${x(b.stage)}px;top:${cy(b) - cardHeight / 2}px"><div class="bracket-match-head"><strong>${escapeHtml(b.code)}</strong><small>${statusText[b.status]}</small></div><div class="bracket-match-players">${b.blueId ? person(b.blueId, 'B', b.winnerId) : b.status === 'BYE' ? byePerson('B') : person(null, 'B', b.winnerId)}${b.redId ? person(b.redId, 'R', b.winnerId) : b.status === 'BYE' ? byePerson('R') : person(null, 'R', b.winnerId)}</div></div>`).join('') + byeSlots.map(slot => {
    const corner = slot.parent.corners[slot.athleteId];
    return `<div class="bracket-match bye-slot" style="left:${x(slot.parent.stage + 1)}px;top:${(slot.y + .5) * rowHeight - cardHeight / 2}px"><div class="bracket-match-head"><strong>BYE</strong><small>Automatic advance</small></div><div class="bracket-match-players">${corner === 'B' ? person(slot.athleteId, 'B', slot.athleteId) : byePerson('B')}${corner === 'R' ? person(slot.athleteId, 'R', slot.athleteId) : byePerson('R')}</div></div>`;
  }).join('');
  return `<div class="bracket-tools"><span>Drag to explore · pinch or use controls to zoom</span><div><button type="button" data-bracket-action="out" aria-label="Zoom out bracket">−</button><button type="button" data-bracket-action="fit">Fit</button><button type="button" data-bracket-action="in" aria-label="Zoom in bracket">+</button></div></div><div class="bracket-scroll" data-bracket-viewport><div class="bracket-zoom-frame"><div class="bracket-canvas" style="width:${width}px;height:${height + 48}px">${headings}<svg class="bracket-lines" width="${width}" height="${height}" style="top:48px">${lines}</svg><div class="bracket-nodes" style="top:48px">${cards}</div></div></div></div>`;
}
function initBracketZoom() {
  document.querySelectorAll('[data-bracket-viewport]').forEach(viewport => {
    const frame = viewport.querySelector('.bracket-zoom-frame'), canvas = viewport.querySelector('.bracket-canvas');
    const tools = viewport.previousElementSibling;
    const width = parseFloat(canvas.style.width), height = parseFloat(canvas.style.height);
    let scale = 1, fitted = true, pinchDistance = 0, pinchScale = 1;
    const fitScale = () => Math.min(1, Math.max(.2, (viewport.clientWidth - 24) / width));
    const apply = (next, point) => {
      const old = scale;
      scale = Math.min(2, Math.max(.2, next));
      frame.style.width = `${width * scale}px`;
      frame.style.height = `${height * scale}px`;
      canvas.style.transform = `scale(${scale})`;
      if (point) {
        const rect = viewport.getBoundingClientRect(), x = point.x - rect.left, y = point.y - rect.top;
        viewport.scrollLeft = (viewport.scrollLeft + x) * scale / old - x;
        viewport.scrollTop = (viewport.scrollTop + y) * scale / old - y;
      }
    };
    const fit = () => { fitted = true; apply(fitScale()); viewport.scrollTo(0, 0); };
    tools.querySelectorAll('[data-bracket-action]').forEach(button => button.addEventListener('click', () => {
      if (button.dataset.bracketAction === 'fit') return fit();
      fitted = false;
      apply(scale * (button.dataset.bracketAction === 'in' ? 1.3 : 1 / 1.3), { x:viewport.getBoundingClientRect().left + viewport.clientWidth / 2, y:viewport.getBoundingClientRect().top + Math.min(viewport.clientHeight, 300) / 2 });
    }));
    const distance = touches => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    viewport.addEventListener('touchstart', e => { if (e.touches.length === 2) { pinchDistance = distance(e.touches); pinchScale = scale; } }, { passive:true });
    viewport.addEventListener('touchmove', e => { if (e.touches.length !== 2 || !pinchDistance) return; e.preventDefault(); fitted = false; apply(pinchScale * distance(e.touches) / pinchDistance, { x:(e.touches[0].clientX + e.touches[1].clientX) / 2, y:(e.touches[0].clientY + e.touches[1].clientY) / 2 }); }, { passive:false });
    viewport.addEventListener('touchend', e => { if (e.touches.length < 2) pinchDistance = 0; });
    let drag = null;
    viewport.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) { drag = { x:e.clientX, y:e.clientY, left:viewport.scrollLeft, top:viewport.scrollTop }; viewport.setPointerCapture(e.pointerId); viewport.classList.add('dragging'); } });
    viewport.addEventListener('pointermove', e => { if (drag) { viewport.scrollLeft = drag.left - (e.clientX - drag.x); viewport.scrollTop = drag.top - (e.clientY - drag.y); } });
    const endDrag = () => { drag = null; viewport.classList.remove('dragging'); };
    viewport.addEventListener('pointerup', endDrag); viewport.addEventListener('pointercancel', endDrag);
    new ResizeObserver(() => { if (fitted) fit(); }).observe(viewport);
    fit();
  });
}
function brackets() {
  if (day === 1 && ring === 'D') return poomsaePublicView('brackets');
  const selected = filtered();
  const categories = [...new Set(selected.map(b => `${b.code[0]}|${b.event}|${b.category}`))];
  return `${ringPlan()}${filters()}<div class="section-heading"><div><p class="eyebrow">Competition paths</p><h2>Brackets</h2></div><span>${categories.length} categories</span></div>
    ${categories.length ? `<div class="bracket-list">${categories.map(key => { const [bracketRing, evt, cat] = key.split('|'); const group = data.bouts.filter(b => b.day === day && b.event === evt && b.category === cat && b.code[0] === bracketRing); return `<section class="bracket-panel"><header><div><small>Ring ${escapeHtml(bracketRing)} · ${formattedEvent(evt)}</small><h3>${escapeHtml(cat)}</h3></div><span>${group.length} bouts</span></header>${bracketDiagram(group)}</section>`; }).join('')}</div>` : `<div class="empty">${emptyMessage()}</div>`}`;
}
function teams() {
  const clubs = [...new Set(data.athletes.filter(a => a.day === day && a.team).map(a => a.team))].sort((a,b) => a.localeCompare(b));
  const search = teamQuery.trim().toLocaleLowerCase();
  const athleteMatches = a => (teamClub === 'ALL' || a.team === teamClub) && (!search || a.name.toLocaleLowerCase().includes(search));
  const selected = [];
  if (teamClub !== 'ALL' || search) {
    const groups = new Map();
    for (const bout of data.bouts.filter(b => b.day === day)) {
      const key = `${bout.code[0]}|${bout.event}|${bout.category}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(bout);
    }
    for (const [key, bouts] of groups) {
      const entrants = [...new Set(bouts.flatMap(b => [...(b.directIds || []), b.blueId, b.redId].filter(Boolean)))].map(athlete).filter(Boolean);
      const matching = entrants.filter(athleteMatches);
      if (matching.length) selected.push({ type:'bracket', key, bouts, matching, ring:bouts[0].code[0], event:bouts[0].event, category:bouts[0].category });
    }
    if (day === 1) for (const group of data.poomsae) {
      const matching = group.entrants.filter(athleteMatches);
      if (matching.length) selected.push({ type:'poomsae', key:`D|POOMSAE PRO|${group.category}`, group, matching, ring:'D', event:'POOMSAE PRO', category:group.category });
    }
    selected.sort((a,b) => a.ring.localeCompare(b.ring) || a.category.localeCompare(b.category, undefined, { numeric:true }));
  }
  const pageSize = 6, pages = Math.max(1, Math.ceil(selected.length / pageSize));
  teamPage = Math.min(teamPage, pages - 1);
  const shown = selected.slice(teamPage * pageSize, (teamPage + 1) * pageSize);
  const matchingAthletes = new Set(selected.flatMap(item => item.matching.map(a => `${a.team.toLocaleLowerCase()}|${a.name.toLocaleLowerCase()}`))).size;
  return `${filters(false)}<section class="team-finder"><div><p class="eyebrow">Club pathways</p><h2>Find your team's brackets</h2><p>Choose a club or search a player to see every category they entered.</p></div><div class="team-finder-fields"><label>Club<select id="team-club"><option value="ALL">All clubs</option>${clubs.map(club => `<option value="${escapeAttr(club)}" ${teamClub === club ? 'selected' : ''}>${escapeHtml(club)}</option>`).join('')}</select></label><label>Search player by name<input id="team-player-search" type="search" placeholder="Enter player name" value="${escapeAttr(teamQuery)}" autocomplete="off"></label></div></section>
  <div class="section-heading team-results-heading"><div><p class="eyebrow">Day ${day} · team directory</p><h2>Competition paths</h2></div><span>${selected.length} ${selected.length === 1 ? 'category' : 'categories'} · ${matchingAthletes} ${matchingAthletes === 1 ? 'player' : 'players'}</span></div>
  ${shown.length ? `<div class="bracket-list team-bracket-list">${shown.map(item => `<section class="bracket-panel team-bracket-panel"><header><div><small>Ring ${escapeHtml(item.ring)} · ${escapeHtml(formattedEvent(item.event))}</small><h3>${escapeHtml(item.category)}</h3></div><span>${item.type === 'poomsae' ? 'Single round' : `${item.bouts.length} bouts`}</span></header><div class="team-entrants"><strong>${item.matching.length} ${item.matching.length === 1 ? 'player' : 'players'} from this search</strong><div>${item.matching.map(a => `<span>${escapeHtml(a.name)}<small>${escapeHtml(a.team)}</small></span>`).join('')}</div></div>${item.type === 'bracket' ? bracketDiagram(item.bouts) : `<div class="team-pro-table"><div class="team-pro-head"><span>Entry / player</span><span>Club</span><span>Mark</span><span>Rank</span></div>${item.group.entrants.map(e => `<div class="team-pro-row ${item.matching.some(a => a.id === e.id) ? 'team-pro-match' : ''}"><span><b>${escapeHtml(e.code)}</b>${escapeHtml(e.name)}</span><span>${escapeHtml(e.team)}</span><strong>${e.score === null ? '—' : e.score.toFixed(3)}</strong><strong>${e.rank ?? '—'}</strong></div>`).join('')}</div>`}</section>`).join('')}</div>` : `<div class="empty">${teamClub === 'ALL' && !search ? 'Select a club or search a player to view their brackets.' : 'No players or brackets match this search on Day ' + day + '.'}</div>`}
  ${pages > 1 ? `<div class="team-pagination"><span>Page ${teamPage + 1} of ${pages}</span><div><button data-team-page="prev" ${teamPage === 0 ? 'disabled' : ''}>Previous</button><button data-team-page="next" ${teamPage === pages - 1 ? 'disabled' : ''}>Next</button></div></div>` : ''}`;
}
function resultView() {
  const pro = tallyEvent === 'POOMSAE PRO';
  const day2 = day === 2;
  const events = day2 ? [['VIRTUAL DAY 2','Virtual'],['RSB CLASS A','Kyorugi Class A']]
    : [['POOMSAE CARNIVAL','Poomsae Carnival'],['KYORUGI CLASS B','Kyorugi Body Kick'],['POOMSAE PRO','Poomsae Pro']];
  const scopes = pro ? [['9 - 11','9–11'],['12 - 14','12–14'],['15 - 17','15–17'],['18 ABOVE','18 above'],['ALL','Overall']]
    : [['ALL',day2 ? 'All teams' : 'Combine all'],...Array.from({length:day2 ? 3 : 5},(_,i) => [String(i+1),String(i+1)])];
  const ages = tallyEvent === 'VIRTUAL DAY 2' ? [['8 - 9','8–9'],['10 - 11','10–11'],['12 - 14','12–14'],['15 - 17','15–17'],['18 ABOVE','18 above'],['ALL','Grand overall combine']]
    : [['9 - 11','9–11'],['12 - 14','12–14'],['15 - 17','15–17'],['17 ABOVE','17 and above'],['ALL','Grand overall combine']];
  const ageMatches = category => tallyAge === 'ALL' || (tallyAge === '18 ABOVE' ? /^(?:18\s*-\s*\d+|ABOVE\s*\d+)/i.test(category)
    : tallyAge === '17 ABOVE' ? /^ABOVE\s*17\b/i.test(category) : category.startsWith(tallyAge));
  const combinedVirtual = day2 && tallyEvent === 'VIRTUAL DAY 2';
  const eligible = data.awards.filter(a => (combinedVirtual ? (a.event === 'VIRTUAL DAY 1' || a.event === 'VIRTUAL DAY 2') : a.day === day && a.event === tallyEvent) && a.finished && a.medals.length &&
    (!pro || (data.poomsae.find(g => g.id === a.id)?.entrants.length || 0) >= 3) &&
    (pro ? tallyScope === 'ALL' || (tallyScope === '18 ABOVE' ? /(?:^|\/)\s*(?:18\s*-\s*30|31\s*-\s*40|41\s*-\s*50|ABOVE\s*51)\s*(?:\/|$)/i.test(a.category) : a.category.includes(tallyScope)) : !day2 || ageMatches(a.category)));
  const rows = new Map();
  for (const award of eligible) for (const medal of award.medals) {
    const team = athlete(medal.athleteId)?.team;
    if (!team) continue;
    const row = rows.get(team) || { team, gold:0, silver:0, bronze:0 };
    row[medal.medal.toLowerCase()]++;
    rows.set(team,row);
  }
  const ranked = [...rows.values()].sort((a,b) => b.gold-a.gold || b.silver-a.silver || b.bronze-a.bronze || a.team.localeCompare(b.team));
  const standings = !pro && tallyScope !== 'ALL' ? ranked.slice(0,Number(tallyScope)) : ranked;
  return `<section class="tally-panel"><div class="tally-intro"><div><p class="eyebrow">Official standings</p><h2>Team medal tally</h2><p>Medals update when each category is complete.</p></div><a class="tally-export" href="/api/medal-results.csv">Export all results CSV</a></div>
    <div class="tally-day"><div class="day-toggle" role="group" aria-label="Competition day"><button data-day="2" class="${day === 2 ? 'selected' : ''}">Day 2 <small>4 Oct</small></button><button data-day="1" class="${day === 1 ? 'selected' : ''}">Day 1 <small>3 Oct</small></button></div></div>
    <div class="tally-events" role="group" aria-label="Competition category">${events.map(([id,name]) => `<button type="button" data-tally-event="${id}" class="${tallyEvent === id ? 'selected' : ''}" aria-pressed="${tallyEvent === id}">${name}</button>`).join('')}</div>
    ${day2 ? `<div class="tally-scopes" role="group" aria-label="Age group">${ages.map(([id,name]) => `<button type="button" data-tally-age="${escapeAttr(id)}" class="${tallyAge === id ? 'selected' : ''}" aria-pressed="${tallyAge === id}">${name}</button>`).join('')}</div>` : ''}
    <div class="tally-scopes" role="group" aria-label="Team ranking">${scopes.map(([id,name]) => `<button type="button" data-tally-scope="${escapeAttr(id)}" class="${tallyScope === id ? 'selected' : ''}" aria-pressed="${tallyScope === id}">${name}</button>`).join('')}</div>
    ${pro ? '<p class="tally-note">Poomsae Pro medals count only when a category has at least 3 participants.</p>' : combinedVirtual ? '<p class="tally-note">Virtual standings combine completed categories from Day 1 and Day 2.</p>' : ''}
    <div class="tally-table-wrap"><table class="tally-table"><thead><tr><th scope="col">Rank</th><th scope="col">Team</th><th scope="col">Gold</th><th scope="col">Silver</th><th scope="col">Bronze</th><th scope="col">Total</th></tr></thead><tbody>${standings.map((row,i) => `<tr><td><span class="tally-rank">${i+1}</span></td><th scope="row">${escapeHtml(row.team)}</th><td>${row.gold}</td><td>${row.silver}</td><td>${row.bronze}</td><td><strong>${row.gold+row.silver+row.bronze}</strong></td></tr>`).join('') || '<tr><td colspan="6" class="tally-empty">No completed categories in this selection yet.</td></tr>'}</tbody></table></div>
  </section>`;
}
function awardMedalRow(m) {
  return `<div class="award-medalist ${m.medal.toLowerCase()}"><span class="award-medal ${m.medal.toLowerCase()}">${escapeHtml(m.medal)}</span><div><strong>${escapeHtml(label(m.athleteId))}</strong><small>${escapeHtml(athlete(m.athleteId)?.team || 'Club not listed')}</small></div><span class="award-person-state ${m.state.toLowerCase()}">${medalStateText[m.state]}</span></div>`;
}
function awardsView() {
  const all = data.awards.filter(a => a.day === day && a.finished);
  const called = all.filter(a => a.status === 'CALLED').sort((a,b) => String(b.calledAt || b.finishedAt || '').localeCompare(String(a.calledAt || a.finishedAt || '')));
  const selected = all.filter(a => !archivedAward(a) && (awardPublicStatus === 'ALL' || a.status === awardPublicStatus) && (!awardQuery || `${a.ring} ${a.category} ${a.event} ${a.medals.map(m => `${label(m.athleteId)} ${athlete(m.athleteId)?.team || ''}`).join(' ')}`.toLowerCase().includes(awardQuery.toLowerCase())))
    .sort((a,b) => ({ CALLED:0, DELIVERED:1, DELIVERED_IN_RING:2, NOT_CALLED:3 })[a.status] - ({ CALLED:0, DELIVERED:1, DELIVERED_IN_RING:2, NOT_CALLED:3 })[b.status] || a.ring.localeCompare(b.ring) || a.category.localeCompare(b.category));
  const pageSize = 24, pages = Math.max(1,Math.ceil(selected.length/pageSize));
  awardPublicPage = Math.min(awardPublicPage,pages-1);
  return `<div class="awards-page">${filters(false)}<div class="awards-hero"><div><p class="eyebrow">Medal presentation</p><h2>Podium call</h2><p>Completed categories appear here automatically. Athlete attendance and medal delivery update live.</p></div><div class="awards-hero-count"><strong>${called.length}</strong><span>categories called</span></div></div>
  ${called.length ? `<section class="awards-calling"><div class="section-heading"><div><p class="eyebrow">Please report to podium</p><h2>Now calling</h2></div><span>${called.length} categories</span></div><div class="awards-calling-grid">${called.slice(0,6).map(a => `<article class="award-call-card"><div><span class="award-ring">Ring ${escapeHtml(a.ring)}</span><span class="award-state called">Called</span></div><h3>${escapeHtml(a.category)}</h3><small>${escapeHtml(formattedEvent(a.event))}</small><div class="award-call-names">${a.medals.map(m => `<div><b>${escapeHtml(m.medal)}</b><span>${escapeHtml(label(m.athleteId))}${m.state === 'ABSENT' ? ' · Absent' : m.state === 'DELIVERED' ? ' · Medal delivered' : ''}</span></div>`).join('')}</div></article>`).join('')}</div></section>` : '<div class="awards-no-call">No categories are currently being called to the podium.</div>'}
  <section class="awards-directory"><div class="section-heading"><div><p class="eyebrow">Finished categories</p><h2>Awards tracker</h2></div><a class="secondary-link" href="/awards/history?day=${day}">Delivered history ↗</a></div><div class="award-filters"><label>Search category or athlete<input id="award-search" placeholder="Category, athlete, club or ring" value="${escapeAttr(awardQuery)}"></label><label>Status<select id="award-public-status">${[['ALL','All statuses'],['CALLED','Called']].map(([value,name]) => `<option value="${value}" ${awardPublicStatus === value ? 'selected' : ''}>${name}</option>`).join('')}</select></label></div>
  <div class="award-category-list">${selected.slice(awardPublicPage*pageSize,(awardPublicPage+1)*pageSize).map(a => `<details class="award-category"><summary><span class="award-summary-main"><strong>${escapeHtml(a.category)}</strong><small>Ring ${escapeHtml(a.ring)} · ${escapeHtml(formattedEvent(a.event))}</small></span><span class="award-state ${a.status.toLowerCase()}">${awardStatusText[a.status]}</span><span class="award-expand">⌄</span></summary><div class="award-medalists">${a.medals.map(awardMedalRow).join('')}</div></details>`).join('') || `<div class="empty">${all.length ? 'No categories are awaiting presentation.' : 'Finished categories will appear here automatically.'}</div>`}</div>${pages > 1 ? `<div class="award-pagination"><span>Page ${awardPublicPage+1} of ${pages}</span><div><button data-award-page="prev" ${awardPublicPage === 0 ? 'disabled' : ''}>Previous</button><button data-award-page="next" ${awardPublicPage === pages-1 ? 'disabled' : ''}>Next</button></div></div>` : ''}</section></div>`;
}
function awardsHistoryView() {
  const selected = data.awards.filter(a => a.day === day && a.finished && archivedAward(a) && (!awardQuery || `${a.ring} ${a.category} ${a.event} ${a.medals.map(m => `${label(m.athleteId)} ${athlete(m.athleteId)?.team || ''}`).join(' ')}`.toLowerCase().includes(awardQuery.toLowerCase())))
    .sort((a,b) => String(b.deliveredAt || '').localeCompare(String(a.deliveredAt || '')));
  const pageSize = 24, pages = Math.max(1,Math.ceil(selected.length/pageSize));
  awardPublicPage = Math.min(awardPublicPage,pages-1);
  return `<div class="awards-page">${filters(false)}<div class="section-heading"><div><p class="eyebrow">Medal presentation</p><h2>Delivered history</h2><p>Completion times are shown in Malaysia time (MYT).</p></div><a class="secondary-link" href="/awards?day=${day}">← Awards tracker</a></div><div class="award-filters"><label>Search category or athlete<input id="award-search" placeholder="Category, athlete, club or ring" value="${escapeAttr(awardQuery)}"></label></div><div class="award-category-list">${selected.slice(awardPublicPage*pageSize,(awardPublicPage+1)*pageSize).map(a => `<details class="award-category"><summary><span class="award-summary-main"><strong>${escapeHtml(a.category)}</strong><small>Ring ${escapeHtml(a.ring)} · ${escapeHtml(formattedEvent(a.event))} · ${escapeHtml(malaysiaTime(a.deliveredAt))}</small></span><span class="award-state ${a.status.toLowerCase()}">${awardStatusText[a.status]}</span><span class="award-expand">⌄</span></summary><div class="award-medalists">${a.medals.map(awardMedalRow).join('')}</div></details>`).join('') || '<div class="empty">No delivered categories match this search.</div>'}</div>${pages > 1 ? `<div class="award-pagination"><span>Page ${awardPublicPage+1} of ${pages}</span><div><button data-award-page="prev" ${awardPublicPage === 0 ? 'disabled' : ''}>Previous</button><button data-award-page="next" ${awardPublicPage === pages-1 ? 'disabled' : ''}>Next</button></div></div>` : ''}</div>`;
}
const ringLetters = 'ABCDEFGHIJ'.split('');
const ringSelectOptions = selected => ringLetters.map(value => `<option value="${value}" ${value === selected ? 'selected' : ''}>Ring ${value}</option>`).join('');
const awardPinOption = '<option value="AWARDS">Awards desk</option>';
const adminScope = () => data.bouts.filter(b => b.day === day && (role === 'admin' ? ring === 'ALL' || assignedRing(b) === ring : assignedRing(b) === coordinatorRing));
const coordinatorDay2Locked = () => role === 'coordinator' && day2Pending();
const adminSearchMatch = b => !query || `${b.code} ${b.category} ${b.event} ${label(b.redId)} ${label(b.blueId)} ${athlete(b.redId)?.team || ''} ${athlete(b.blueId)?.team || ''}`.toLowerCase().includes(query.toLowerCase());
function adminDashboardContent() {
  const scoped = adminScope(), complete = scoped.filter(b => b.status === 'COMPLETE').length;
  const ready = scoped.filter(b => b.status === 'READY').length, waiting = scoped.filter(b => b.status === 'WAITING').length;
  const percent = scoped.length ? Math.round(complete / scoped.length * 100) : 0;
  const rings = role === 'admin' ? ringLetters : [coordinatorRing];
  const ringRows = rings.map(letter => {
    if (day === 1 && letter === 'D') {
      const done = data.poomsae.filter(g => g.finished).length, total = data.poomsae.length;
      const current = data.poomsae.find(g => !g.finished);
      return `<button class="ad-ring-row" data-open-pro><span class="ad-ring-letter">D</span><span class="ad-ring-name"><strong>Ring D</strong><small>Poomsae Pro</small></span><span class="ad-ring-current"><b>${escapeHtml(current?.category || 'All scored')}</b><small>Next category</small></span><span class="ad-ring-progress"><b>${done} / ${total}</b><i><em style="width:${total ? Math.round(done / total * 100) : 0}%"></em></i></span><span class="ad-ring-chevron">›</span></button>`;
    }
    const bouts = data.bouts.filter(b => b.day === day && assignedRing(b) === letter).sort(scheduleSort);
    const done = bouts.filter(b => b.status === 'COMPLETE').length;
    const current = bouts.find(b => b.status === 'READY');
    const ratio = bouts.length ? Math.round(done / bouts.length * 100) : 0;
    return `<button class="ad-ring-row" data-open-ring="${letter}"><span class="ad-ring-letter">${letter}</span><span class="ad-ring-name"><strong>Ring ${letter}</strong><small>${escapeHtml((day === 1 ? day1Plan : day2Plan).find(p => p.ring === letter)?.label || formattedEvent((day === 1 ? day1Plan : day2Plan).find(p => p.ring === letter)?.event))}</small></span><span class="ad-ring-current">${current ? `<b>${escapeHtml(current.code)}</b><small>Next ready bout</small>` : `<b>${bouts.length ? 'No ready bout' : 'No bouts loaded'}</b>`}</span><span class="ad-ring-progress"><b>${done} / ${bouts.length}</b><i><em style="width:${ratio}%"></em></i></span><span class="ad-ring-chevron">›</span></button>`;
  }).join('');
  const recent = scoped.filter(b => b.status === 'COMPLETE').sort((a,b) => String(b.result?.recordedAt || '').localeCompare(String(a.result?.recordedAt || ''))).slice(0,6);
  return `<div class="ad-page-head"><div><p class="ad-kicker">Competition overview</p><h1>${role === 'admin' ? `Day ${day} dashboard` : `Ring ${coordinatorRing} dashboard`}</h1><p>Live operations and progress for ${day === 1 ? '3' : '4'} October 2026.</p></div><button class="ad-primary" data-admin-section="bouts">Open bout queue <span>→</span></button></div>
  <section class="ad-stats" aria-label="Competition analytics"><div class="ad-stat ad-stat-primary"><span>Total bouts</span><strong>${scoped.length.toLocaleString()}</strong><small>Day ${day}${ring !== 'ALL' ? ` · Ring ${ring}` : ''}</small></div><div class="ad-stat"><span>Ready to run</span><strong>${ready.toLocaleString()}</strong><small>Awaiting result entry</small></div><div class="ad-stat"><span>Completed</span><strong>${complete.toLocaleString()}</strong><small>${percent}% of scheduled bouts</small></div><div class="ad-stat"><span>Awaiting progression</span><strong>${waiting.toLocaleString()}</strong><small>Waiting for earlier results</small></div></section>
  <section class="ad-progress-panel"><div><span>Competition progress</span><strong>${percent}% complete</strong></div><div class="ad-progress-track"><span style="width:${percent}%"></span></div><small>Based on recorded results in this view</small></section>
  <div class="ad-dashboard-grid"><section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Ring operations</p><h2>Ring activity</h2></div><span>${rings.length} rings</span></div><div class="ad-ring-list">${ringRows}</div></section><section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Official record</p><h2>Recent results</h2></div><button class="ad-text-action" data-admin-section="bouts" data-status="COMPLETE">View all</button></div>${recent.length ? `<div class="ad-recent-list">${recent.map(b => `<div class="ad-recent-row"><span class="ad-recent-code">${escapeHtml(b.code)}</span><span><strong>${escapeHtml(label(b.winnerId))}</strong><small>Ring ${assignedRing(b)} · ${escapeHtml(b.category)}</small></span><b>${escapeHtml(b.method)}</b></div>`).join('')}</div>` : '<div class="ad-panel-empty">No results recorded for this selection yet.</div>'}</section></div>`;
}
function adminBoutsContent() {
  const scoped = adminScope().filter(adminSearchMatch).sort(scheduleSort);
  const selected = scoped.filter(b => adminStatus === 'ALL' || b.status === adminStatus);
  const pageSize = 30, pages = Math.max(1,Math.ceil(selected.length / pageSize));
  adminPage = Math.min(adminPage,pages-1);
  const shown = selected.slice(adminPage*pageSize,(adminPage+1)*pageSize);
  return `<div class="ad-page-head"><div><p class="ad-kicker">Match operations</p><h1>Bout queue</h1><p>Find bouts and record results for the assigned ring.</p></div><a class="ad-outline" href="/api/export.csv">Download results CSV</a></div>
  <div class="ad-filter-panel"><label>Ring<select id="admin-ring-select" ${role === 'coordinator' ? 'disabled' : ''}><option value="ALL" ${ring === 'ALL' ? 'selected' : ''}>All rings</option>${ringSelectOptions(ring)}</select></label><label>Status<select id="admin-status">${[['READY','Ready'],['WAITING','Waiting'],['COMPLETE','Completed'],['BYE','Bye'],['ALL','All statuses']].map(([v,n]) => `<option value="${v}" ${v === adminStatus ? 'selected' : ''}>${n}</option>`).join('')}</select></label><label class="ad-search">Search bouts<input id="search" placeholder="Code, athlete, club or category" value="${escapeAttr(query)}"></label></div>
  <div class="ad-queue-summary"><strong>${selected.length.toLocaleString()} bouts</strong><span>${scoped.filter(b => b.status === 'READY').length} ready</span><span>${scoped.filter(b => b.status === 'COMPLETE').length} completed</span></div>
  <section class="ad-panel ad-queue-panel"><div class="ad-table-head"><span>Bout / category</span><span>Chung · Blue</span><span>Hong · Red</span><span>Status</span><span>Action</span></div>${shown.length ? shown.map(b => `<div class="ad-bout-row"><div class="ad-bout-id"><strong>${escapeHtml(b.code)}</strong><span>${escapeHtml(b.category)}</span><em class="ad-round-badge">${escapeHtml(stageText[b.stage] || 'Qualifier')}</em><small>Ring ${assignedRing(b)} · ${escapeHtml(formattedEvent(b.event))}</small></div><div class="ad-athlete"><span class="ad-dot blue"></span><span><i class="ad-corner-name">Chung</i><strong>${escapeHtml(label(b.blueId))}</strong><small>${escapeHtml(athlete(b.blueId)?.team || 'To be determined')}</small></span></div><div class="ad-athlete"><span class="ad-dot red"></span><span><i class="ad-corner-name">Hong</i><strong>${escapeHtml(label(b.redId))}</strong><small>${escapeHtml(athlete(b.redId)?.team || 'To be determined')}</small></span></div><span class="status ${b.status.toLowerCase()}">${statusText[b.status]}</span><div class="ad-row-action">${b.status === 'READY' ? `<button class="record" data-bout="${escapeAttr(b.id)}">Record result</button>` : b.status === 'COMPLETE' ? `<button class="undo" data-bout="${escapeAttr(b.id)}">Correct result</button>` : b.status === 'WAITING' ? '<span class="ad-waiting-action">Awaiting earlier bout</span>' : '<span>Automatic bye</span>'}</div></div>`).join('') : '<div class="ad-panel-empty">No bouts match the selected filters.</div>'}</section>
  ${pages > 1 ? `<div class="ad-pagination"><span>Page ${adminPage+1} of ${pages}</span><div><button data-admin-page="prev" ${adminPage === 0 ? 'disabled' : ''}>Previous</button><button data-admin-page="next" ${adminPage === pages-1 ? 'disabled' : ''}>Next</button></div></div>` : ''}`;
}
const numericCode = code => Number(String(code).match(/^[A-Z](\d+)/)?.[1] || 0);
function adminTransferContent() {
  const sourceAll = data.bouts.filter(b => b.day === day && assignedRing(b) === transferSourceRing && b.code[0] === transferPrefix).sort(scheduleSort);
  const source = sourceAll.filter(b => !transferQuery || `${b.code} ${b.category} ${label(b.blueId)} ${label(b.redId)}`.toLowerCase().includes(transferQuery.toLowerCase()));
  const destinationAll = data.bouts.filter(b => b.day === day && assignedRing(b) === transferTargetRing).sort(scheduleSort);
  const destination = destinationAll.filter(b => !transferDestinationQuery || `${b.code} ${b.category}`.toLowerCase().includes(transferDestinationQuery.toLowerCase()));
  const boundsReady = Number.isInteger(transferStart) && Number.isInteger(transferEnd);
  const from = boundsReady ? Math.min(transferStart,transferEnd) : null, to = boundsReady ? Math.max(transferStart,transferEnd) : null;
  const picked = boundsReady ? sourceAll.filter(b => numericCode(b.code) >= from && numericCode(b.code) <= to) : [];
  const anchor = data.bouts.find(b => b.id === transferAfterId);
  const prefixes = [...new Set(data.bouts.filter(b => b.day === day && assignedRing(b) === transferSourceRing).map(b => b.code[0]))].sort();
  return `<div class="ad-page-head"><div><p class="ad-kicker">Schedule operations</p><h1>Bulk transfer</h1><p>Pick the first and last source bout, then choose the destination position.</p></div></div><div class="ad-transfer-layout"><section class="ad-panel ad-transfer-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 1</p><h2>Choose source bouts</h2></div><span>${sourceAll.length} on ring</span></div><div class="ad-transfer-controls"><span>Current ring</span><div class="ad-chip-list">${ringLetters.map(letter => `<button data-transfer-source="${letter}" class="${transferSourceRing === letter ? 'active' : ''}">${letter}</button>`).join('')}</div><span>Original code prefix</span><div class="ad-chip-list">${prefixes.map(letter => `<button data-transfer-prefix="${letter}" class="${transferPrefix === letter ? 'active' : ''}">${letter}</button>`).join('') || '<small>No bouts</small>'}</div><label>Find source bout<input id="transfer-search" placeholder="A47, category or athlete" value="${escapeAttr(transferQuery)}"></label></div><div class="ad-pick-head"><span>Bout / category</span><span>Range</span></div><div class="ad-pick-list" id="transfer-source-list">${source.map(b => { const n = numericCode(b.code); const selected = boundsReady && n >= from && n <= to; return `<div class="ad-pick-row ${selected ? 'selected' : ''}"><span><strong>${escapeHtml(b.code)}</strong><small>${escapeHtml(b.category)} · ${statusText[b.status]}</small></span><span class="ad-boundary"><button data-transfer-boundary="start" data-number="${n}" class="${transferStart === n ? 'active' : ''}">First</button><button data-transfer-boundary="end" data-number="${n}" class="${transferEnd === n ? 'active' : ''}">Last</button></span></div>`; }).join('') || '<div class="ad-panel-empty">No source bouts match.</div>'}</div></section><section class="ad-panel ad-transfer-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 2</p><h2>Place on destination ring</h2></div><span>${destinationAll.length} bouts</span></div><div class="ad-transfer-controls"><span>Destination ring</span><div class="ad-chip-list">${ringLetters.map(letter => `<button data-transfer-target="${letter}" class="${transferTargetRing === letter ? 'active' : ''}">${letter}</button>`).join('')}</div><label>Find insertion point<input id="transfer-destination-search" placeholder="B35 or category" value="${escapeAttr(transferDestinationQuery)}"></label></div><div class="ad-pick-head"><span>Existing bout</span><span>Position</span></div><div class="ad-pick-list" id="transfer-target-list"><div class="ad-pick-row ${!transferAfterId ? 'selected' : ''}"><span><strong>Start of ring ${transferTargetRing}</strong><small>Before the first scheduled bout</small></span><button class="ad-after-button ${!transferAfterId ? 'active' : ''}" data-transfer-after="">Choose</button></div>${destination.map(b => `<div class="ad-pick-row ${transferAfterId === b.id ? 'selected' : ''}"><span><strong>${escapeHtml(b.code)}</strong><small>${escapeHtml(b.category)} · ${statusText[b.status]}</small></span><button class="ad-after-button ${transferAfterId === b.id ? 'active' : ''}" data-transfer-after="${escapeAttr(b.id)}">After</button></div>`).join('')}</div></section></div><form id="transfer-table-form" class="ad-transfer-confirm"><div><strong>${picked.length ? `${picked.length} bouts · ${transferPrefix}${from}–${transferPrefix}${to}` : 'Select first and last bouts'}</strong><p>${picked.length ? `Move from Ring ${transferSourceRing} to Ring ${transferTargetRing}, ${anchor ? `after ${anchor.code}` : 'at the start'}. Original codes stay unchanged.` : 'The selected range and destination will appear here.'}</p></div><button class="ad-primary" ${!picked.length ? 'disabled' : ''}>Transfer ${picked.length || ''} bouts</button><p class="form-error" role="alert"></p></form>`;
}
let transferDestinationQuery = '', transferSourceScroll = 0, transferTargetScroll = 0;
function adminQualifyingContent() {
  if (day === 1 && qualifyingRing === 'D') return adminPoomsaeEntryContent();
  const dayBouts = data.bouts.filter(b => b.day === day && b.directIds.length && b.status !== 'COMPLETE');
  const categories = [...new Set(dayBouts.filter(b => qualifyingRing === 'ALL' || assignedRing(b) === qualifyingRing).map(b => b.category))].sort();
  const selected = dayBouts.filter(b => (qualifyingRing === 'ALL' || assignedRing(b) === qualifyingRing) && (qualifyingCategory === 'ALL' || b.category === qualifyingCategory) && (!qualifyingQuery || `${b.code} ${b.category} ${label(b.blueId)} ${label(b.redId)}`.toLowerCase().includes(qualifyingQuery.toLowerCase()))).sort(scheduleSort);
  const pageSize = 30, pages = Math.max(1,Math.ceil(selected.length/pageSize));
  qualifyingPage = Math.min(qualifyingPage,pages-1);
  const shown = selected.slice(qualifyingPage*pageSize,(qualifyingPage+1)*pageSize);
  const target = data.bouts.find(b => b.id === qualifyingSelectedId && b.day === day && b.directIds.length && b.status !== 'COMPLETE');
  const targetRing = target ? assignedRing(target) : qualifyingRing === 'ALL' ? 'A' : qualifyingRing;
  const ringSchedule = data.bouts.filter(b => b.day === day && assignedRing(b) === targetRing).sort(scheduleSort);
  const targetPosition = target ? ringSchedule.findIndex(b => b.id === target.id) : -1;
  const defaultAfter = targetPosition > 0 ? ringSchedule[targetPosition-1].id : '';
  return `<div class="ad-page-head"><div><p class="ad-kicker">Bracket changes</p><h1>Add qualifying bouts</h1><p>Find an existing match, stage new qualifiers, then save them together.</p></div></div><div class="ad-qualifying-layout"><section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 1</p><h2>Find destination match</h2></div><span>${selected.length} matches</span></div><div class="ad-qualifying-filters"><label>Ring<select id="qualifying-ring"><option value="ALL" ${qualifyingRing === 'ALL' ? 'selected' : ''}>All rings</option>${ringSelectOptions(qualifyingRing)}</select></label><label>Category<select id="qualifying-category"><option value="ALL">All categories</option>${categories.map(cat => `<option value="${escapeAttr(cat)}" ${cat === qualifyingCategory ? 'selected' : ''}>${escapeHtml(cat)}</option>`).join('')}</select></label><label class="wide">Search<input id="qualifying-search" placeholder="Bout, category or athlete" value="${escapeAttr(qualifyingQuery)}"></label></div><div class="ad-match-list">${shown.map(b => `<button class="ad-match-row ${qualifyingSelectedId === b.id ? 'selected' : ''}" data-qualifying-target="${escapeAttr(b.id)}"><span><strong>${escapeHtml(b.code)}</strong><small>Ring ${assignedRing(b)} · ${escapeHtml(b.category)}</small><small>${b.directIds.map(id => escapeHtml(label(id))).join(' / ')}</small></span><em>${qualifyingDraft.filter(item => item.targetBoutId === b.id).length ? 'Staged' : 'Select'}</em></button>`).join('') || '<div class="ad-panel-empty">No matches found. Try another ring or category.</div>'}</div>${pages > 1 ? `<div class="ad-pagination ad-qualifying-pages"><span>Page ${qualifyingPage+1} of ${pages}</span><div><button data-qualifying-page="prev" ${qualifyingPage === 0 ? 'disabled' : ''}>Previous</button><button data-qualifying-page="next" ${qualifyingPage === pages-1 ? 'disabled' : ''}>Next</button></div></div>` : ''}</section><div class="ad-qualifying-side"><section class="ad-panel ad-stage-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 2</p><h2>Stage a qualifier</h2></div></div>${target ? `<form id="qualifying-stage-form" class="ad-stage-form"><div class="ad-selected-target"><strong>${escapeHtml(target.code)} · ${escapeHtml(target.category)}</strong><small>The qualifier winner takes one athlete’s place in this match.</small></div><label>Existing athlete to qualify<select name="sourceAthleteId">${target.directIds.map(id => `<option value="${escapeAttr(id)}">${escapeHtml(label(id))} · ${escapeHtml(athlete(id)?.team)}</option>`).join('')}</select></label><div class="form-grid"><label>New athlete<input name="name" required maxlength="120"></label><label>Club<input name="team" required maxlength="120"></label><label>Assigned ring<select name="assignedRing" id="qualifying-assigned-ring">${ringSelectOptions(targetRing)}</select></label><label>Existing athlete corner<select name="sourceCorner"><option value="B">Chung</option><option value="R">Hong</option></select></label><label class="wide">Insert after<select name="afterBoutId" id="qualifying-after"><option value="">Start of ring</option>${ringSchedule.map(b => `<option value="${escapeAttr(b.id)}" ${b.id === defaultAfter ? 'selected' : ''}>${escapeHtml(b.code)} · ${escapeHtml(b.category)}</option>`).join('')}</select></label></div><button class="ad-primary">Add to draft</button><p class="form-error" role="alert"></p></form>` : '<div class="ad-panel-empty">Select a match from the filtered list to stage a qualifier.</div>'}</section><section class="ad-panel ad-draft-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 3</p><h2>Draft qualifiers</h2></div><span>${qualifyingDraft.length} staged</span></div>${qualifyingDraft.length ? `<div class="ad-draft-list">${qualifyingDraft.map((item,index) => { const b = data.bouts.find(x => x.id === item.targetBoutId); return `<div class="ad-draft-row"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.team)} · feeds ${escapeHtml(b?.code)}</small></span><button data-remove-draft="${index}" aria-label="Remove ${escapeAttr(item.name)}">×</button></div>`; }).join('')}</div><div class="ad-draft-save"><button class="ad-primary" id="save-qualifying-draft">Save ${qualifyingDraft.length} qualifying bouts</button><p class="form-error" role="alert"></p></div>` : '<div class="ad-panel-empty">Staged bouts will appear here before saving.</div>'}</section></div></div>`;
}
function adminPoomsaeEntryContent() {
  const groups = data.poomsae.filter(g => (qualifyingCategory === 'ALL' || g.category === qualifyingCategory) && (!qualifyingQuery || `${g.category} ${g.entrants.map(e => `${e.name} ${e.team} ${e.code}`).join(' ')}`.toLowerCase().includes(qualifyingQuery.toLowerCase())));
  const categories = data.poomsae.map(g => g.category).sort();
  return `<div class="ad-page-head"><div><p class="ad-kicker">Poomsae Pro entries</p><h1>Add Poomsae Pro athletes</h1><p>Stage athletes for Ring D single-round scoring, then save them together. New entries receive the next D codes.</p></div></div><div class="ad-qualifying-layout"><section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 1</p><h2>Choose category</h2></div><span>${groups.length} categories</span></div><div class="ad-qualifying-filters"><label>Ring<select id="qualifying-ring"><option value="D" selected>Ring D · Poomsae Pro</option><option value="ALL">All rings</option>${ringLetters.filter(r => r !== 'D').map(r => `<option value="${r}">Ring ${r}</option>`).join('')}</select></label><label>Category<select id="qualifying-category"><option value="ALL">All categories</option>${categories.map(cat => `<option value="${escapeAttr(cat)}" ${cat === qualifyingCategory ? 'selected' : ''}>${escapeHtml(cat)}</option>`).join('')}</select></label><label class="wide">Search<input id="qualifying-search" placeholder="Category or athlete" value="${escapeAttr(qualifyingQuery)}"></label></div><div class="ad-match-list">${groups.map(g => `<button class="ad-match-row ${qualifyingSelectedId === g.id ? 'selected' : ''}" data-qualifying-pro-category="${escapeAttr(g.category)}"><span><strong>${escapeHtml(g.category)}</strong><small>${g.entrants.length} athletes · ${g.entrants.filter(e => e.score !== null).length} scored</small></span><em>${qualifyingSelectedId === g.id ? 'Selected' : 'Select'}</em></button>`).join('') || '<div class="ad-panel-empty">No categories match this filter. You can enter a new category in Step 2.</div>'}</div></section><div class="ad-qualifying-side"><section class="ad-panel ad-stage-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 2</p><h2>Stage an athlete</h2></div></div><form id="pro-entry-stage-form" class="ad-stage-form"><label>Category<input name="category" list="pro-categories" value="${escapeAttr(data.poomsae.find(g => g.id === qualifyingSelectedId)?.category || (qualifyingCategory !== 'ALL' ? qualifyingCategory : ''))}" placeholder="Choose existing or type new category" maxlength="120" required><datalist id="pro-categories">${categories.map(cat => `<option value="${escapeAttr(cat)}">`).join('')}</datalist></label><div class="form-grid"><label>Athlete name<input name="name" maxlength="120" required></label><label>Club<input name="team" maxlength="120" required></label></div><button class="ad-primary">Add to draft</button><p class="form-error" role="alert"></p></form></section><section class="ad-panel ad-draft-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Step 3</p><h2>Draft athletes</h2></div><span>${proEntryDraft.length} staged</span></div>${proEntryDraft.length ? `<div class="ad-draft-list">${proEntryDraft.map((item,index) => `<div class="ad-draft-row"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.team)} · ${escapeHtml(item.category)}</small></span><button data-remove-pro-draft="${index}" aria-label="Remove ${escapeAttr(item.name)}">×</button></div>`).join('')}</div><div class="ad-draft-save"><button class="ad-primary" id="save-pro-entry-draft">Save ${proEntryDraft.length} Poomsae Pro entries</button><p class="form-error" role="alert"></p></div>` : '<div class="ad-panel-empty">Staged athletes will appear here before saving.</div>'}</section></div></div>`;
}
function adminCoordinatorContent() {
  return `<div class="ad-page-head"><div><p class="ad-kicker">Access management</p><h1>Staff PINs</h1><p>Assign a six-digit PIN to each ring or the awards desk. A new PIN replaces its previous PIN.</p></div></div><div class="ad-coordinator-layout"><form id="pin-form" class="ad-tool-card admin-form"><div class="ad-tool-icon">◈</div><h2>Set staff PIN</h2><p>Give the PIN to the assigned coordinator or awards team.</p><label>Role<select name="ring">${ringSelectOptions(ring === 'ALL' ? 'A' : ring)}${awardPinOption}</select></label><label>Six-digit PIN<input name="pin" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="new-password"></label><button class="ad-primary">Save PIN</button><p class="form-error" role="alert"></p></form><section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Access scope</p><h2>Staff permissions</h2></div></div><div class="ad-permission-list"><div><strong>Ring coordinators</strong><p>See and manage only bouts assigned to their ring.</p></div><div><strong>Awards desk</strong><p>Call medalists, record medal delivery, and mark absent athletes. No bout result access.</p></div><div><strong>Lead admin</strong><p>Can manage results, schedule changes, staff PINs, and awards.</p></div></div></section></div>`;
}
function adminPoomsaeContent() {
  const all = data.poomsae;
  const filteredGroups = all.filter(g => !poomsaeQuery || `${g.category} ${g.entrants.map(e => `${e.name} ${e.team}`).join(' ')}`.toLowerCase().includes(poomsaeQuery.toLowerCase()));
  const group = all.find(g => g.category === poomsaeCategory) || filteredGroups[0] || all[0];
  poomsaeCategory = group?.category || '';
  const recorded = all.reduce((sum,g) => sum + g.entrants.filter(e => e.score !== null).length,0);
  return `<div class="ad-page-head"><div><p class="ad-kicker">Ring D · single round</p><h1>Poomsae Pro scoring</h1><p>Enter one mark from 0.000 to 10.000 for each entry. Rankings update automatically by score.</p></div></div>
  <div class="ad-award-stats"><div><strong>${all.length}</strong><span>Categories</span></div><div><strong>${all.reduce((sum,g) => sum + g.entrants.length,0)}</strong><span>Entries</span></div><div><strong>${recorded}</strong><span>Marks recorded</span></div><div><strong>${all.filter(g => g.finished).length}</strong><span>Categories finished</span></div></div>
  <div class="ad-pro-layout"><section class="ad-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Categories</p><h2>Choose category</h2></div><span>${filteredGroups.length} shown</span></div><div class="ad-pro-search"><label>Search category or athlete<input id="poomsae-search" value="${escapeAttr(poomsaeQuery)}" placeholder="Category, athlete or club"></label></div><div class="ad-pro-categories">${filteredGroups.map(g => `<button data-poomsae-category="${escapeAttr(g.category)}" class="${g.category === poomsaeCategory ? 'active' : ''}"><span><strong>${escapeHtml(g.category)}</strong><small>${g.entrants.length} entries · ${g.entrants.filter(e => e.score !== null).length} scored</small></span><span class="award-state ${g.finished ? 'delivered' : ''}">${g.finished ? 'Finished' : 'Open'}</span></button>`).join('') || '<div class="ad-panel-empty">No categories match this search.</div>'}</div></section>
  <section class="ad-panel ad-pro-scoring"><div class="ad-panel-title"><div><p class="ad-kicker">Score sheet</p><h2>${escapeHtml(group?.category || 'Select a category')}</h2></div><span>Single round</span></div>${group ? `<form id="poomsae-form"><div class="ad-pro-table-head"><span>Entry / athlete</span><span>Club</span><span>Mark</span><span>Rank</span><span>Action</span></div><div class="ad-pro-rows">${group.entrants.map(e => `<div class="ad-pro-row"><div><b>${escapeHtml(e.code)}</b><strong>${escapeHtml(e.name)}</strong></div><span class="ad-pro-club">${escapeHtml(e.team)}</span><label><span class="sr-only">Mark for ${escapeAttr(e.name)}</span><input data-poomsae-score="${escapeAttr(e.code)}" inputmode="decimal" value="${e.score === null ? '' : e.score.toFixed(3)}" placeholder="0.000" aria-label="Mark for ${escapeAttr(e.name)}"></label><strong class="ad-pro-rank" data-poomsae-rank="${escapeAttr(e.code)}">${e.rank === null ? '—' : e.rank}</strong><span class="ad-pro-row-action">${e.score !== null ? `<button type="button" data-poomsae-undo="${escapeAttr(e.code)}" aria-label="Revoke mark for ${escapeAttr(e.name)}">Revoke mark</button>` : '—'}</span></div>`).join('')}</div><div class="ad-pro-actions"><span>${group.finished ? 'All marks recorded. Public results and awards are live.' : 'This category appears on the awards page after all marks are recorded.'}</span><button class="ad-primary" type="submit">Save marks</button><p class="form-error" role="alert"></p></div></form>` : ''}</section></div>`;
}
function adminAwardsContent() {
  const all = data.awards.filter(a => a.day === day);
  const queue = all.filter(a => !a.autoRing);
  const counts = { FINISHED: queue.filter(a => a.finished).length, CALLED: queue.filter(a => a.status === 'CALLED').length, DELIVERED: queue.filter(a => a.status === 'DELIVERED').length };
  const selected = all.filter(a => a.finished && !archivedAward(a) && (awardAdminRing === 'ALL' || a.ring === awardAdminRing) && (awardAdminStatus === 'ALL' || a.status === awardAdminStatus) && (!awardAdminQuery || `${a.ring} ${a.category} ${a.event} ${a.medals.map(m => `${label(m.athleteId)} ${athlete(m.athleteId)?.team || ''}`).join(' ')}`.toLowerCase().includes(awardAdminQuery.toLowerCase())))
    .sort((a,b) => ({ CALLED:0, NOT_CALLED:1, DELIVERED:2, DELIVERED_IN_RING:3 })[a.status] - ({ CALLED:0, NOT_CALLED:1, DELIVERED:2, DELIVERED_IN_RING:3 })[b.status] || a.ring.localeCompare(b.ring) || a.category.localeCompare(b.category));
  const pageSize = 15, pages = Math.max(1,Math.ceil(selected.length/pageSize));
  awardAdminPage = Math.min(awardAdminPage,pages-1);
  return `<div class="ad-page-head"><div><p class="ad-kicker">Medal operations</p><h1>Awards desk</h1><p>Finished categories appear automatically. Call athletes to the podium, then record delivery or absence.</p></div><a class="ad-public-link" href="/awards" target="_blank">Open public awards ↗</a></div>
  <div class="ad-award-stats"><div><strong>${counts.CALLED}</strong><span>Called to podium</span></div><div><strong>${counts.DELIVERED}</strong><span>Delivered</span></div><div><strong>${counts.FINISHED}</strong><span>Finished podium categories</span></div><div><strong>${all.filter(a => a.autoRing && a.status === 'DELIVERED_IN_RING').length}</strong><span>Delivered in Ring</span></div></div>
  <section class="ad-panel ad-awards-panel"><div class="ad-panel-title"><div><p class="ad-kicker">Category tracker</p><h2>Medal presentations</h2></div><a class="ad-public-link" href="/admin/awards/history?day=${day}">Delivered history ↗</a></div>
  <div class="ad-award-filters"><label>Search<input id="award-admin-search" placeholder="Category, athlete, club or ring" value="${escapeAttr(awardAdminQuery)}"></label><label>Ring<select id="award-admin-ring"><option value="ALL">All rings</option>${ringSelectOptions(awardAdminRing)}</select></label><label>Status<select id="award-admin-status">${[['ALL','All statuses'],['CALLED','Called']].map(([value,name]) => `<option value="${value}" ${awardAdminStatus === value ? 'selected' : ''}>${name}</option>`).join('')}</select></label></div>
  <div class="ad-award-list">${selected.slice(awardAdminPage*pageSize,(awardAdminPage+1)*pageSize).map(a => `<article class="ad-award-row"><div class="ad-award-row-head"><div><strong>${escapeHtml(a.category)}</strong><small>Ring ${escapeHtml(a.ring)} · ${escapeHtml(formattedEvent(a.event))} · ${a.event === 'POOMSAE PRO' ? 'Single-round marks' : `Final ${escapeHtml(a.finalCode)}`}</small></div><span class="award-state ${a.status.toLowerCase()}">${awardStatusText[a.status]}</span></div>${a.medals.length ? `<div class="ad-award-people">${a.medals.map(m => `<div class="ad-award-person ${m.medal.toLowerCase()}"><span class="award-medal ${m.medal.toLowerCase()}">${escapeHtml(m.medal)}</span><div><strong>${escapeHtml(label(m.athleteId))}</strong><small>${escapeHtml(athlete(m.athleteId)?.team || 'Club not listed')}</small></div><span class="award-person-state ${m.state.toLowerCase()}">${medalStateText[m.state]}</span>${!a.autoRing ? `<div class="ad-award-person-actions"><button data-award-medal="${escapeAttr(a.id)}" data-award-athlete="${escapeAttr(m.athleteId)}" data-award-state="DELIVERED" ${a.status === 'NOT_CALLED' || m.state === 'DELIVERED' ? 'disabled' : ''}>Delivered</button><button data-award-medal="${escapeAttr(a.id)}" data-award-athlete="${escapeAttr(m.athleteId)}" data-award-state="ABSENT" ${a.status === 'NOT_CALLED' || m.state === 'ABSENT' ? 'disabled' : ''}>Absent</button>${m.state !== 'PENDING' ? `<button data-award-medal="${escapeAttr(a.id)}" data-award-athlete="${escapeAttr(m.athleteId)}" data-award-state="PENDING">Reset</button>` : ''}</div>` : ''}</div>`).join('')}</div>` : '<div class="ad-award-pending">Waiting for category to finish.</div>'}<div class="ad-award-row-foot">${a.autoRing ? '<span>Medals are delivered at the ring when this category finishes.</span>' : a.status === 'NOT_CALLED' ? '<span>Podium call becomes available when all bouts finish.</span>' : `<button data-award-call="${escapeAttr(a.id)}">${a.callCount ? 'Call names again' : 'Call names'}</button>`}</div></article>`).join('') || `<div class="ad-panel-empty">${all.some(a => a.finished) ? 'No categories are awaiting presentation.' : 'Finished categories will appear here automatically.'}</div>`}</div>
  ${pages > 1 ? `<div class="ad-pagination"><span>Page ${awardAdminPage+1} of ${pages}</span><div><button data-award-admin-page="prev" ${awardAdminPage === 0 ? 'disabled' : ''}>Previous</button><button data-award-admin-page="next" ${awardAdminPage === pages-1 ? 'disabled' : ''}>Next</button></div></div>` : ''}</section>`;
}
function adminAwardsHistoryContent() {
  const selected = data.awards.filter(a => a.day === day && a.finished && archivedAward(a) && (awardAdminRing === 'ALL' || a.ring === awardAdminRing) && (!awardAdminQuery || `${a.ring} ${a.category} ${a.event} ${a.medals.map(m => `${label(m.athleteId)} ${athlete(m.athleteId)?.team || ''}`).join(' ')}`.toLowerCase().includes(awardAdminQuery.toLowerCase())))
    .sort((a,b) => String(b.deliveredAt || '').localeCompare(String(a.deliveredAt || '')));
  const pageSize = 15, pages = Math.max(1,Math.ceil(selected.length/pageSize));
  awardAdminPage = Math.min(awardAdminPage,pages-1);
  return `<div class="ad-page-head"><div><p class="ad-kicker">Medal operations</p><h1>Delivered history</h1><p>Completed presentations with timestamps in Malaysia time (MYT).</p></div><a class="ad-public-link" href="/admin/awards?day=${day}">← Awards desk</a></div><section class="ad-panel ad-awards-panel"><div class="ad-panel-title"><h2>Completed categories</h2><span>${selected.length} shown</span></div><div class="ad-award-filters"><label>Search<input id="award-admin-search" placeholder="Category, athlete, club or ring" value="${escapeAttr(awardAdminQuery)}"></label><label>Ring<select id="award-admin-ring"><option value="ALL">All rings</option>${ringSelectOptions(awardAdminRing)}</select></label></div><div class="ad-award-list">${selected.slice(awardAdminPage*pageSize,(awardAdminPage+1)*pageSize).map(a => `<article class="ad-award-row"><div class="ad-award-row-head"><div><strong>${escapeHtml(a.category)}</strong><small>Ring ${escapeHtml(a.ring)} · ${escapeHtml(formattedEvent(a.event))} · ${escapeHtml(malaysiaTime(a.deliveredAt))}</small></div><span class="award-state ${a.status.toLowerCase()}">${awardStatusText[a.status]}</span></div><div class="ad-award-people">${a.medals.map(m => `<div class="ad-award-person ${m.medal.toLowerCase()}"><span class="award-medal ${m.medal.toLowerCase()}">${escapeHtml(m.medal)}</span><div><strong>${escapeHtml(label(m.athleteId))}</strong><small>${escapeHtml(athlete(m.athleteId)?.team || 'Club not listed')}</small></div><span class="award-person-state ${m.state.toLowerCase()}">${medalStateText[m.state]}</span>${!a.autoRing ? `<div class="ad-award-person-actions"><button data-award-medal="${escapeAttr(a.id)}" data-award-athlete="${escapeAttr(m.athleteId)}" data-award-state="PENDING">Reset</button></div>` : ''}</div>`).join('')}</div></article>`).join('') || '<div class="ad-panel-empty">No completed presentations match these filters.</div>'}</div>${pages > 1 ? `<div class="ad-pagination"><span>Page ${awardAdminPage+1} of ${pages}</span><div><button data-award-admin-page="prev" ${awardAdminPage === 0 ? 'disabled' : ''}>Previous</button><button data-award-admin-page="next" ${awardAdminPage === pages-1 ? 'disabled' : ''}>Next</button></div></div>` : ''}</section>`;
}
function adminLayout() {
  if (!token) return `<div class="ad-login-shell"><div class="ad-login-brand"><span><img src="/mtkd-logo.png" alt="MTKD logo"></span><strong>Championship operations</strong></div>${notice ? `<div class="notice" role="status">${escapeHtml(notice)}<button id="dismiss">×</button></div>` : ''}<div class="login-panel"><p class="eyebrow">Officials only</p><h1>Sign in to control room</h1><p>Use your six-digit staff PIN or the lead admin password.</p><form id="login"><label>Staff role<select id="login-ring">${ringSelectOptions(ring === 'ALL' ? 'A' : ring)}${awardPinOption}</select></label><label>PIN or admin password<input type="password" id="password" autocomplete="current-password" required></label><button class="ad-primary">Sign in</button></form><a href="/">← Return to public view</a></div></div>`;
  const nav = role === 'awards' ? [['awards','Awards desk'],['awardsHistory','Delivered history']] : [['dashboard','Overview'],['bouts','Bout queue'],...(role === 'admin' || coordinatorRing === 'D' ? [['poomsae','Poomsae Pro']] : []),...(role === 'admin' ? [['awards','Awards desk'],['awardsHistory','Delivered history'],['transfer','Bulk transfer'],['qualifying','Add qualifying'],['coordinators','Staff PINs']] : [])];
  const content = ({dashboard:adminDashboardContent,bouts:adminBoutsContent,poomsae:adminPoomsaeContent,awards:adminAwardsContent,awardsHistory:adminAwardsHistoryContent,transfer:adminTransferContent,qualifying:adminQualifyingContent,coordinators:adminCoordinatorContent})[adminSection]?.() || (role === 'awards' ? adminAwardsContent() : adminDashboardContent());
  return `<div class="ad-app"><aside class="ad-sidebar"><div class="ad-side-brand"><span><img src="/mtkd-logo.png" alt="MTKD logo"></span><div><strong>RSB 2026</strong><small>CONTROL CENTER</small></div></div><div class="ad-side-caption">WORKSPACE</div><nav aria-label="Admin menu">${nav.map(([id,name]) => `<a href="${adminHref(id)}?day=${day}" class="${adminSection === id ? 'active' : ''}" ${adminSection === id ? 'aria-current="page"' : ''}><span>${name}</span>${id === 'bouts' ? `<em>${data.bouts.filter(b => b.day === day && (role === 'admin' || assignedRing(b) === coordinatorRing) && b.status === 'READY').length}</em>` : ''}</a>`).join('')}</nav><div class="ad-sidebar-bottom"><span>${role === 'admin' ? 'Lead administrator' : role === 'awards' ? 'Awards staff' : `Ring ${coordinatorRing} coordinator`}</span><a href="/">Public site ↗</a><button id="logout">Sign out</button></div></aside><div class="ad-workspace"><header class="ad-topbar"><div class="ad-mobile-brand"><img src="/mtkd-logo.png" alt="MTKD logo"> <strong>RSB Control center</strong></div><div class="ad-topbar-label"><span class="ad-live-indicator"></span> Competition operations <small>3–4 Oct 2026</small></div><div class="ad-topbar-actions"><div class="day-toggle"><button data-day="2" class="${day === 2 ? 'selected' : ''}" ${coordinatorDay2Locked() ? 'disabled title="Day 2 opens after all Day 1 rings finish"' : ''}>Day 2${coordinatorDay2Locked() ? ' 🔒' : ''}</button><button data-day="1" class="${day === 1 ? 'selected' : ''}">Day 1</button></div><span class="ad-user-badge">${role === 'admin' ? 'Lead admin' : role === 'awards' ? 'Awards desk' : `Ring ${coordinatorRing}`}</span><a class="ad-mobile-public" href="/" aria-label="Public site">↗</a><button class="ad-mobile-logout" type="button">Sign out</button></div></header><div class="ad-mobile-nav">${nav.map(([id,name]) => `<a href="${adminHref(id)}?day=${day}" class="${adminSection === id ? 'active' : ''}" ${adminSection === id ? 'aria-current="page"' : ''}>${name}</a>`).join('')}</div><main class="ad-main">${notice ? `<div class="notice" role="status">${escapeHtml(notice)}<button id="dismiss">×</button></div>` : ''}${coordinatorDay2Locked() ? '<div class="ad-lock-notice">Day 2 opens after every ring finishes Day 1.</div>' : ''}${content}</main></div><div id="modal-root"></div></div>`;
}
function render() {
  if (!data) return;
  if (isAdminPage) { root.innerHTML = adminLayout(); attach(); return; }
  root.innerHTML = `<header class="masthead"><div class="mast-inner"><div class="brand"><div class="brand-mark"><img src="/mtkd-logo.png" alt="MTKD logo"></div><div><span>TAEKWONDO CHAMPIONSHIP</span><strong>RSB 2026</strong></div></div><div class="mast-meta"><span class="live-dot"></span> Competition operations <small>3–4 October 2026</small></div></div></header>
    <main><div class="title-row"><div><p class="eyebrow">RSB Taekwondo Championship 2026</p><h1>${isAdminPage ? 'Admin control room' : ({live:'Live competition',schedule:'Match schedule',brackets:'Competition brackets',teams:'Teams',results:'Results',awards:'Awards',awardsHistory:'Delivered awards'})[view]}</h1><p class="subtitle">${view === 'teams' ? 'Find every competition path for your club and players.' : view === 'results' ? 'Team medal standings by competition category.' : isAdminPage ? 'Manage bouts and official results.' : 'Preassigned competitor paths from the RSB team lists.'}</p></div><div class="data-note">${data.athletes.length.toLocaleString()} entries · ${data.bouts.length.toLocaleString()} bouts</div></div>
    ${isAdminPage ? '<div class="admin-nav"><a href="/">← Public view</a></div>' : tabs()}${notice ? `<div class="notice" role="status">${escapeHtml(notice)}<button id="dismiss">×</button></div>` : ''}
    ${( { live, schedule, brackets, teams, results: resultView, awards: awardsView, awardsHistory: awardsHistoryView })[view]()}</main><footer class="site-footer"><div class="site-footer-inner"><div class="site-footer-identity"><small>RSB 2026</small><strong>Taekwondo Championship</strong><span>3–4 October 2026</span></div><div class="site-footer-credit"><span>Powered by</span><img src="/mtkd-logo.png" alt="MTKD logo"></div></div></footer><div id="modal-root"></div>`;
  attach();
}
function attach() {
  initBracketZoom();
  document.querySelectorAll('[data-admin-section]').forEach(el => el.onclick = () => { const params = new URLSearchParams({ day:String(day) }); if (el.dataset.status) params.set('status',el.dataset.status); location.href = `${adminHref(el.dataset.adminSection)}?${params}`; });
  document.querySelectorAll('[data-open-ring]').forEach(el => el.onclick = () => { location.href = `${adminHref('bouts')}?day=${day}&ring=${el.dataset.openRing}`; });
  document.querySelectorAll('[data-open-pro]').forEach(el => el.onclick = () => { location.href = '/admin/poomsae-pro?day=1'; });
  document.querySelectorAll('[data-admin-page]').forEach(el => el.onclick = () => { adminPage += el.dataset.adminPage === 'next' ? 1 : -1; render(); document.querySelector('.ad-queue-panel')?.scrollIntoView({block:'start'}); });
  document.querySelector('#admin-ring-select')?.addEventListener('change', e => { ring = e.target.value; adminPage = 0; render(); });
  document.querySelectorAll('[data-view]').forEach(el => el.onclick = () => { location.href = `${publicHref[el.dataset.view]}?day=${day}`; });
  document.querySelectorAll('[data-day]').forEach(el => el.onclick = () => { location.href = `${location.pathname}?day=${el.dataset.day}`; });
  document.querySelector('#team-club')?.addEventListener('change', e => { teamClub = e.target.value; teamPage = 0; render(); });
  document.querySelector('#team-player-search')?.addEventListener('input', e => { teamQuery = e.target.value; teamPage = 0; const pos = e.target.selectionStart; render(); const input = document.querySelector('#team-player-search'); input?.focus(); input?.setSelectionRange(pos, pos); });
  document.querySelectorAll('[data-team-page]').forEach(el => el.onclick = () => { teamPage += el.dataset.teamPage === 'next' ? 1 : -1; render(); document.querySelector('.team-results-heading')?.scrollIntoView({ block:'start' }); });
  document.querySelectorAll('[data-tally-event]').forEach(el => el.onclick = () => { tallyEvent = el.dataset.tallyEvent; tallyScope = 'ALL'; tallyAge = 'ALL'; render(); });
  document.querySelectorAll('[data-tally-age]').forEach(el => el.onclick = () => { tallyAge = el.dataset.tallyAge; tallyScope = 'ALL'; render(); });
  document.querySelectorAll('[data-tally-scope]').forEach(el => el.onclick = () => { tallyScope = el.dataset.tallyScope; render(); });
  document.querySelectorAll('[data-admin-ring]').forEach(el => el.onclick = () => { ring = el.dataset.adminRing; query = ''; render(); });
  document.querySelector('#admin-status')?.addEventListener('change', e => { adminStatus = e.target.value; adminPage = 0; render(); });
  document.querySelectorAll('[data-plan-ring]').forEach(el => el.onclick = () => { ring = el.dataset.planRing; event = (day === 1 ? day1Plan : day2Plan).find(item => item.ring === ring).event; query = ''; render(); });
  document.querySelector('#search')?.addEventListener('input', e => { query = e.target.value; adminPage = 0; const pos = e.target.selectionStart; render(); const input = document.querySelector('#search'); input.focus(); input.setSelectionRange(pos,pos); });
  document.querySelector('#dismiss')?.addEventListener('click', () => { notice = ''; render(); });
  document.querySelectorAll('#logout,.ad-mobile-logout').forEach(el => el.addEventListener('click', () => { token = ''; role = ''; coordinatorRing = ''; ['rsb-token','rsb-role','rsb-ring'].forEach(key => sessionStorage.removeItem(key)); notice = 'Signed out'; render(); }));
  document.querySelector('#login')?.addEventListener('submit', async e => { e.preventDefault(); try { const value = document.querySelector('#password').value, loginRing = document.querySelector('#login-ring').value; const answer = await api('/api/login',{method:'POST',body:JSON.stringify({password:value,pin:value,ring:loginRing})}); token = answer.token; role = answer.role; coordinatorRing = answer.ring || ''; ring = role === 'coordinator' ? coordinatorRing : 'ALL'; adminSection = role === 'awards' ? 'awards' : adminSection; day = coordinatorDay2Locked() ? 1 : 2; sessionStorage.setItem('rsb-token',token); sessionStorage.setItem('rsb-role',role); sessionStorage.setItem('rsb-ring',coordinatorRing); notice = 'Signed in'; render(); } catch (error) { notice = error.message; render(); } });
  const restoreTransferScroll = () => { const source = document.querySelector('#transfer-source-list'), target = document.querySelector('#transfer-target-list'); if (source) source.scrollTop = transferSourceScroll; if (target) target.scrollTop = transferTargetScroll; };
  const rememberTransferScroll = () => { transferSourceScroll = document.querySelector('#transfer-source-list')?.scrollTop || 0; transferTargetScroll = document.querySelector('#transfer-target-list')?.scrollTop || 0; };
  restoreTransferScroll();
  document.querySelector('#transfer-source-list')?.addEventListener('scroll', e => { transferSourceScroll = e.target.scrollTop; });
  document.querySelector('#transfer-target-list')?.addEventListener('scroll', e => { transferTargetScroll = e.target.scrollTop; });
  document.querySelectorAll('[data-transfer-source]').forEach(el => el.onclick = () => { transferSourceRing = el.dataset.transferSource; transferPrefix = [...new Set(data.bouts.filter(b => b.day === day && assignedRing(b) === transferSourceRing).map(b => b.code[0]))].sort()[0] || transferSourceRing; transferStart = transferEnd = null; transferSourceScroll = 0; render(); });
  document.querySelectorAll('[data-transfer-prefix]').forEach(el => el.onclick = () => { transferPrefix = el.dataset.transferPrefix; transferStart = transferEnd = null; transferSourceScroll = 0; render(); });
  document.querySelectorAll('[data-transfer-target]').forEach(el => el.onclick = () => { transferTargetRing = el.dataset.transferTarget; transferAfterId = ''; transferTargetScroll = 0; render(); });
  document.querySelectorAll('[data-transfer-boundary]').forEach(el => el.onclick = () => { rememberTransferScroll(); if (el.dataset.transferBoundary === 'start') transferStart = Number(el.dataset.number); else transferEnd = Number(el.dataset.number); render(); });
  document.querySelectorAll('[data-transfer-after]').forEach(el => el.onclick = () => { rememberTransferScroll(); transferAfterId = el.dataset.transferAfter; render(); });
  const transferSearch = (selector,key) => document.querySelector(selector)?.addEventListener('input', e => { if (key === 'source') transferQuery = e.target.value; else transferDestinationQuery = e.target.value; const pos = e.target.selectionStart; render(); const input = document.querySelector(selector); input.focus(); input.setSelectionRange(pos,pos); });
  transferSearch('#transfer-search','source'); transferSearch('#transfer-destination-search','destination');
  document.querySelector('#transfer-table-form')?.addEventListener('submit', async e => { e.preventDefault(); const form = e.target; try { const answer = await api('/api/admin/transfer',{method:'POST',body:JSON.stringify({version:data.version,day,sourceRing:transferSourceRing,codePrefix:transferPrefix,targetRing:transferTargetRing,from:Math.min(transferStart,transferEnd),to:Math.max(transferStart,transferEnd),afterBoutId:transferAfterId})}); notice = `${answer.count} bouts transferred to Ring ${transferTargetRing}`; transferStart = transferEnd = null; transferAfterId = ''; transferSourceScroll = transferTargetScroll = 0; await refresh(); } catch (error) { form.querySelector('.form-error').textContent = error.message; } });
  document.querySelector('#qualifying-ring')?.addEventListener('change', e => { qualifyingRing = e.target.value; qualifyingCategory = 'ALL'; qualifyingPage = 0; render(); });
  document.querySelector('#qualifying-category')?.addEventListener('change', e => { qualifyingCategory = e.target.value; qualifyingPage = 0; render(); });
  document.querySelector('#qualifying-search')?.addEventListener('input', e => { qualifyingQuery = e.target.value; qualifyingPage = 0; const pos = e.target.selectionStart; render(); const input = document.querySelector('#qualifying-search'); input.focus(); input.setSelectionRange(pos,pos); });
  document.querySelectorAll('[data-qualifying-pro-category]').forEach(el => el.onclick = () => { const group = data.poomsae.find(g => g.category === el.dataset.qualifyingProCategory); qualifyingSelectedId = group?.id || ''; render(); document.querySelector('#pro-entry-stage-form')?.scrollIntoView({block:'nearest'}); });
  document.querySelector('#pro-entry-stage-form')?.addEventListener('submit', e => { e.preventDefault(); const form = e.target, item = Object.fromEntries(new FormData(form)); item.category = item.category.trim(); item.name = item.name.trim(); item.team = item.team.trim(); if (!item.category || !item.name || !item.team) { form.querySelector('.form-error').textContent = 'Enter the category, athlete and club.'; return; } if (proEntryDraft.some(d => d.category.toLowerCase() === item.category.toLowerCase() && d.name.toLowerCase() === item.name.toLowerCase() && d.team.toLowerCase() === item.team.toLowerCase())) { form.querySelector('.form-error').textContent = 'This athlete is already staged.'; return; } proEntryDraft.push(item); notice = `${proEntryDraft.length} Poomsae Pro athlete${proEntryDraft.length === 1 ? '' : 's'} staged`; render(); });
  document.querySelectorAll('[data-remove-pro-draft]').forEach(el => el.onclick = () => { proEntryDraft.splice(Number(el.dataset.removeProDraft),1); render(); });
  document.querySelector('#save-pro-entry-draft')?.addEventListener('click', async () => { const button = document.querySelector('#save-pro-entry-draft'); button.disabled = true; try { const answer = await api('/api/admin/poomsae-entries',{method:'POST',body:JSON.stringify({version:data.version,entries:proEntryDraft})}); notice = `${answer.count} Poomsae Pro athletes saved: ${answer.codes.join(', ')}`; proEntryDraft = []; await refresh(); } catch (error) { const message = document.querySelector('.ad-draft-save .form-error'); if (message) message.textContent = error.message; button.disabled = false; } });
  document.querySelectorAll('[data-qualifying-page]').forEach(el => el.onclick = () => { qualifyingPage += el.dataset.qualifyingPage === 'next' ? 1 : -1; render(); document.querySelector('.ad-match-list')?.scrollIntoView({block:'start'}); });
  document.querySelectorAll('[data-qualifying-target]').forEach(el => el.onclick = () => { qualifyingSelectedId = el.dataset.qualifyingTarget; render(); document.querySelector('.ad-stage-panel')?.scrollIntoView({block:'nearest'}); });
  document.querySelector('#qualifying-assigned-ring')?.addEventListener('change', e => { const selectedRing = e.target.value, select = document.querySelector('#qualifying-after'); select.innerHTML = '<option value="">Start of ring</option>' + data.bouts.filter(b => b.day === day && assignedRing(b) === selectedRing).sort(scheduleSort).map(b => `<option value="${escapeAttr(b.id)}">${escapeHtml(b.code)} · ${escapeHtml(b.category)}</option>`).join(''); });
  document.querySelector('#qualifying-stage-form')?.addEventListener('submit', e => { e.preventDefault(); const form = e.target, targetBoutId = qualifyingSelectedId, entry = { ...Object.fromEntries(new FormData(form)),targetBoutId }; if (qualifyingDraft.some(item => item.targetBoutId === targetBoutId && item.sourceAthleteId === entry.sourceAthleteId)) { form.querySelector('.form-error').textContent = 'This athlete slot is already staged.'; return; } qualifyingDraft.push(entry); notice = `${qualifyingDraft.length} qualifying bout${qualifyingDraft.length === 1 ? '' : 's'} staged`; render(); });
  document.querySelectorAll('[data-remove-draft]').forEach(el => el.onclick = () => { qualifyingDraft.splice(Number(el.dataset.removeDraft),1); render(); });
  document.querySelector('#save-qualifying-draft')?.addEventListener('click', async () => { const button = document.querySelector('#save-qualifying-draft'); button.disabled = true; try { const answer = await api('/api/admin/extra-bouts',{method:'POST',body:JSON.stringify({version:data.version,entries:qualifyingDraft})}); notice = `${answer.count} qualifying bouts saved: ${answer.codes.join(', ')}`; qualifyingDraft = []; qualifyingSelectedId = ''; await refresh(); } catch (error) { const message = document.querySelector('.ad-draft-save .form-error'); if (message) message.textContent = error.message; button.disabled = false; } });
  document.querySelector('#pin-form')?.addEventListener('submit', async e => { e.preventDefault(); const form = e.target; try { await api('/api/admin/pin',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))}); notice = 'Staff PIN saved'; await refresh(); } catch (error) { form.querySelector('.form-error').textContent = error.message; } });
  document.querySelector('#poomsae-search')?.addEventListener('input', e => { poomsaeQuery = e.target.value; const pos = e.target.selectionStart; render(); const input = document.querySelector('#poomsae-search'); input?.focus(); input?.setSelectionRange(pos,pos); });
  document.querySelectorAll('[data-poomsae-category]').forEach(el => el.onclick = () => { poomsaeCategory = el.dataset.poomsaeCategory; render(); });
  const updatePoomsaeRanks = () => {
    const inputs = [...document.querySelectorAll('[data-poomsae-score]')];
    const scores = inputs.map(input => ({ code:input.dataset.poomsaeScore, score:/^(?:10(?:\.0{1,3})?|[0-9](?:\.\d{1,3})?)$/.test(input.value.trim()) ? Number(input.value.trim()) : null }));
    for (const item of scores) {
      const node = document.querySelector(`[data-poomsae-rank="${item.code}"]`);
      if (node) node.textContent = item.score === null ? '—' : String(1 + scores.filter(other => other.score !== null && other.score > item.score).length);
    }
  };
  document.querySelectorAll('[data-poomsae-score]').forEach(el => el.addEventListener('input', updatePoomsaeRanks));
  document.querySelectorAll('[data-poomsae-undo]').forEach(el => el.addEventListener('click', async () => {
    const code = el.dataset.poomsaeUndo, entry = data.poomsae.flatMap(g => g.entrants).find(e => e.code === code);
    if (!entry || !window.confirm(`Revoke the saved mark for ${entry.name} (${code})? This will recalculate rankings and remove any recorded awards for the category.`)) return;
    el.disabled = true;
    try { await api('/api/admin/poomsae-undo',{method:'POST',body:JSON.stringify({version:data.version,code})}); notice = `${code} mark revoked`; await refresh(); }
    catch (error) { notice = error.message; render(); }
  }));
  document.querySelector('#poomsae-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target, scores = [...form.querySelectorAll('[data-poomsae-score]')].map(input => ({ code:input.dataset.poomsaeScore, score:input.value.trim() }));
    try { await api('/api/admin/poomsae-scores',{method:'POST',body:JSON.stringify({category:poomsaeCategory,scores})}); notice = `Marks saved for ${poomsaeCategory}`; await refresh(); }
    catch (error) { form.querySelector('.form-error').textContent = error.message; }
  });
  const awardSearch = (selector,key) => document.querySelector(selector)?.addEventListener('input', e => { if (key === 'admin') { awardAdminQuery = e.target.value; awardAdminPage = 0; } else { awardQuery = e.target.value; awardPublicPage = 0; } const pos = e.target.selectionStart; render(); const input = document.querySelector(selector); input?.focus(); input?.setSelectionRange(pos,pos); });
  awardSearch('#award-search','public'); awardSearch('#award-admin-search','admin');
  document.querySelector('#award-public-status')?.addEventListener('change', e => { awardPublicStatus = e.target.value; awardPublicPage = 0; render(); });
  document.querySelector('#award-admin-status')?.addEventListener('change', e => { awardAdminStatus = e.target.value; awardAdminPage = 0; render(); });
  document.querySelector('#award-admin-ring')?.addEventListener('change', e => { awardAdminRing = e.target.value; awardAdminPage = 0; render(); });
  document.querySelectorAll('[data-award-page]').forEach(el => el.onclick = () => { awardPublicPage += el.dataset.awardPage === 'next' ? 1 : -1; render(); document.querySelector('.awards-directory')?.scrollIntoView({block:'start'}); });
  document.querySelectorAll('[data-award-admin-page]').forEach(el => el.onclick = () => { awardAdminPage += el.dataset.awardAdminPage === 'next' ? 1 : -1; render(); document.querySelector('.ad-awards-panel')?.scrollIntoView({block:'start'}); });
  document.querySelectorAll('[data-award-call]').forEach(el => el.onclick = async () => { el.disabled = true; try { await api('/api/admin/award/call',{method:'POST',body:JSON.stringify({awardId:el.dataset.awardCall})}); notice = 'Podium call recorded'; await refresh(); } catch (error) { notice = error.message; render(); } });
  document.querySelectorAll('[data-award-medal]').forEach(el => el.onclick = async () => { el.disabled = true; try { await api('/api/admin/award/medal',{method:'POST',body:JSON.stringify({awardId:el.dataset.awardMedal,athleteId:el.dataset.awardAthlete,state:el.dataset.awardState})}); notice = el.dataset.awardState === 'ABSENT' ? 'Athlete marked absent' : el.dataset.awardState === 'DELIVERED' ? 'Medal delivery recorded' : 'Medal status reset'; await refresh(); } catch (error) { notice = error.message; render(); } });
  document.querySelectorAll('.record').forEach(el => el.onclick = () => resultModal(el.dataset.bout));
  document.querySelectorAll('.undo').forEach(el => el.onclick = () => undoModal(el.dataset.bout));
}
function modal(inner) { const target = document.querySelector('#modal-root'); target.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${inner}</div></div>`; target.querySelector('.modal-backdrop').onclick = e => { if (e.target.classList.contains('modal-backdrop')) target.innerHTML = ''; }; target.querySelector('.close').onclick = () => target.innerHTML = ''; }
function resultModal(id) {
  const b = data.bouts.find(item => item.id === id);
  modal(`<button class="close" aria-label="Close">×</button><p class="eyebrow">Record result</p><h2>Ring ${escapeHtml(assignedRing(b))} · ${escapeHtml(b.code)}</h2><p class="modal-sub">${formattedEvent(b.event)} · ${escapeHtml(b.category)} · ${stageText[b.stage] || 'Qualifier'}</p><form id="result-form"><fieldset><legend>Winner</legend><div class="winner-options"><label class="choice"><input type="radio" name="winner" value="${escapeAttr(b.blueId)}" required><span class="corner b">Chung</span>${escapeHtml(label(b.blueId))}</label><label class="choice"><input type="radio" name="winner" value="${escapeAttr(b.redId)}" required><span class="corner r">Hong</span>${escapeHtml(label(b.redId))}</label></div></fieldset><label>Result method<select name="method"><option>PTF</option><option>PTG</option><option>GDP</option><option>RSC</option><option>SUP</option><option>WDR</option><option>DSQ</option><option>PUN</option><option>DQB</option><option>POINTS</option></select></label><label>Note (optional)<textarea name="note" rows="2"></textarea></label><button class="primary" type="submit">Save result</button><p class="form-error" role="alert"></p></form>`);
  document.querySelector('#result-form').onsubmit = async e => { e.preventDefault(); const form = new FormData(e.target); try { await api('/api/admin/result',{method:'POST',body:JSON.stringify({boutId:id,winnerId:form.get('winner'),method:form.get('method'),note:form.get('note'),version:data.version})}); notice = `Result saved for Ring ${assignedRing(b)} · ${b.code}`; await refresh(); } catch (error) { const message = document.querySelector('.form-error'); if (message) message.textContent = error.message; else { notice = error.message; render(); } } };
}
function undoModal(id) {
  const b = data.bouts.find(item => item.id === id);
  modal(`<button class="close" aria-label="Close">×</button><p class="eyebrow">Correct result</p><h2>Undo Ring ${escapeHtml(assignedRing(b))} · ${escapeHtml(b.code)}?</h2><p>The bout will return to ready status. Later results in the same bracket must be undone first.</p><form id="undo-form"><label>Reason for correction<input name="reason" required minlength="3"></label><button class="danger" type="submit">Undo result</button><p class="form-error" role="alert"></p></form>`);
  document.querySelector('#undo-form').onsubmit = async e => { e.preventDefault(); const form = new FormData(e.target); try { await api('/api/admin/undo',{method:'POST',body:JSON.stringify({boutId:id,reason:form.get('reason'),version:data.version})}); notice = `Result undone for Ring ${assignedRing(b)} · ${b.code}`; await refresh(); } catch (error) { const message = document.querySelector('.form-error'); if (message) message.textContent = error.message; else { notice = error.message; render(); } } };
}
refresh();
setInterval(() => refresh(true), 10000);
