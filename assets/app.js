// Interactive programme booklet for one event: schedule, floor plan, partners, personal plan.
import { esc, icon, loadEvent, store, toMin, fmt } from './core.js';
import { renderMapSVG, PanZoom, Router, partnersAtStand, standsOfPartner, standCenter, METERS_PER_UNIT } from './map.js';

const params = new URLSearchParams(location.search);
const EVENT_ID = params.get('e') || 'vv-veenendaal';
const $ = (sel, root = document) => root.querySelector(sel);

const TABS = [
  { id: 'programma', label: 'Programma', icon: 'calendar' },
  { id: 'kaart', label: 'Kaart', icon: 'map', mobileOnly: true },
  { id: 'partners', label: 'Standhouders', icon: 'list' },
  { id: 'mijn', label: 'Mijn dag', icon: 'heart' },
  { id: 'info', label: 'Info', icon: 'info' },
];

let E, V, router, pz;
const state = {
  tab: 'programma',
  mode: store.get('hvz:mode', matchMedia('(min-width: 700px)').matches ? 'blokken' : 'lijst'),
  tags: new Set(),
  q: '',
  partnerQ: '',
  from: 'ingang',
  route: null,
};
let renderedOnce = false;
let mine; // { sessions: [], stands: [], visited: [] }

const saveMine = () => store.set(`hvz-mine:${E.id}`, mine);
const isWide = () => matchMedia('(min-width: 1000px)').matches;

init().catch(err => {
  $('#panel').innerHTML = `<div class="empty"><h2>Programma niet gevonden</h2><p>${esc(err.message)}</p><p><a href="index.html">Terug naar overzicht</a></p></div>`;
  $('#app').removeAttribute('aria-busy');
});

async function init() {
  ({ event: E, venue: V } = await loadEvent(EVENT_ID, { draft: params.has('draft') }));
  mine = Object.assign({ sessions: [], stands: [], visited: [] }, store.get(`hvz-mine:${E.id}`, {}));
  document.title = `${E.name} ${E.city || ''} · Programma`;
  if (E.theme?.primary) document.documentElement.style.setProperty('--primary', E.theme.primary);
  if (E.theme?.accent) document.documentElement.style.setProperty('--accent', E.theme.accent);
  $('#ev-name').textContent = `${E.name}${E.city ? ' ' + E.city : ''}`;
  $('#ev-sub').textContent = [E.date && new Date(E.date + 'T12:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), E.tagline].filter(Boolean).join(' · ');
  if (params.has('draft')) $('#ev-sub').textContent = 'Voorbeeld van concept uit beheer';

  $('#tabs').innerHTML = TABS.map(t => `<button type="button" data-tab="${t.id}" class="${t.mobileOnly ? 'mobile-only' : ''}">${icon(t.icon)}<span>${t.label}</span></button>`).join('');
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });

  setupMap();
  setupSheet();
  window.addEventListener('hashchange', route);
  route();
  updateLive();
  setInterval(updateLive, 30000);
  $('#app').removeAttribute('aria-busy');
}

// ---------------------------------------------------------------- routing
function go(tab, detail) {
  location.hash = detail ? `${tab}/${detail}` : tab;
}

function route() {
  const [tab = 'programma', type, ...rest] = location.hash.slice(1).split('/');
  const id = decodeURIComponent(rest.join('/'));
  let next = TABS.some(t => t.id === tab) ? tab : 'programma';
  if (next === 'kaart' && isWide()) next = 'programma';
  document.body.dataset.tab = next;
  for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-current', b.dataset.tab === next ? 'page' : 'false');
  if (next !== state.tab || !renderedOnce) { state.tab = next; renderedOnce = true; renderPanel(); $('#panel').scrollTop = 0; }
  if (type) openDetail(type, id, { fromRoute: true });
  else closeSheet({ keepHash: true });
}

function renderPanel() {
  const p = $('#panel');
  const views = { programma: viewProgramma, partners: viewPartners, mijn: viewMijn, info: viewInfo, kaart: () => '' };
  p.innerHTML = views[state.tab]();
  bindPanel();
  if (state.tab === 'programma' && state.mode === 'blokken') scrollToNow();
}

// ---------------------------------------------------------------- time
function nowMinutes() {
  const t = params.get('tijd');
  if (t) return toMin(t);
  if (!E.date) return null;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return today === E.date ? d.getHours() * 60 + d.getMinutes() : null;
}

function sessionStatus(s) {
  const n = nowMinutes();
  if (n == null) return '';
  if (n >= toMin(s.end)) return 'past';
  if (n >= toMin(s.start)) return 'now';
  if (toMin(s.start) - n <= 30) return 'soon';
  return '';
}

function updateLive() {
  const n = nowMinutes(), el = $('#live');
  if (n == null) { el.hidden = true; return; }
  const cur = E.rounds.find(r => n >= toMin(r.start) && n < toMin(r.end));
  const next = E.rounds.find(r => toMin(r.start) > n);
  let html = '';
  if (cur) {
    const mineNow = E.sessions.find(s => mine.sessions.includes(s.id) && s.start === cur.start);
    html = `<strong>Nu bezig:</strong> ${esc(cur.name)} (tot ${fmt(cur.end)})${mineNow ? ` · jij zit bij <a href="#programma/sessie/${mineNow.id}">${esc(mineNow.title)}</a>` : ''}`;
  } else if (next) {
    const mins = toMin(next.start) - n;
    const mineNext = E.sessions.find(s => mine.sessions.includes(s.id) && s.start === next.start);
    html = `<strong>${esc(next.name)}</strong> begint ${mins <= 60 ? `over ${mins} min` : `om ${fmt(next.start)}`}`
      + (mineNext ? ` · <a href="#programma/sessie/${mineNext.id}">${esc(mineNext.title)}</a> in ${esc(roomName(mineNext.room))}` : ' · kies alvast je workshop');
  } else html = 'Alle workshoprondes zijn afgelopen. Bedankt voor je komst!';
  el.innerHTML = `${icon('clock', { size: 16 })}<span>${html}</span>`;
  el.hidden = false;
}

// ---------------------------------------------------------------- lookups
const roomName = id => E.rooms.find(r => r.id === id)?.name || id;
const partnerById = id => E.partners.find(p => p.id === id);
const sessionLead = s => [s.speaker, partnerById(s.partner)?.name || s.organisation].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
const tagDots = s => (s.tags || []).map(t => E.tags?.find(x => x.id === t)).filter(Boolean)
  .map(t => `<span class="dot" style="--c:${t.color}" title="${esc(t.name)}"></span>`).join('');

function sessionMatches(s) {
  if (state.tags.size && !(s.tags || []).some(t => state.tags.has(t))) return false;
  if (!state.q) return true;
  const hay = `${s.title} ${s.speaker} ${partnerById(s.partner)?.name || ''} ${s.organisation || ''} ${roomName(s.room)} ${s.description}`.toLowerCase();
  return hay.includes(state.q.toLowerCase());
}

// ---------------------------------------------------------------- programma
function viewProgramma() {
  const tags = E.tags?.length ? `<div class="chips" role="group" aria-label="Filter op opleiding">
      <span class="chips-label">Opleiding:</span>
      ${E.tags.map(t => `<button type="button" class="chip" data-tag="${t.id}" aria-pressed="${state.tags.has(t.id)}" style="--c:${t.color}">${esc(t.name)}</button>`).join('')}
    </div>` : '';
  const body = state.mode === 'blokken' ? blocks() : list();
  return `
    <div class="panel-head">
      <h2>Workshopprogramma</h2>
      <div class="seg" role="group" aria-label="Weergave">
        <button type="button" data-mode="blokken" aria-pressed="${state.mode === 'blokken'}">${icon('grid', { size: 16 })} Blokken</button>
        <button type="button" data-mode="lijst" aria-pressed="${state.mode === 'lijst'}">${icon('list', { size: 16 })} Lijst</button>
      </div>
    </div>
    <label class="search">${icon('search', { size: 18 })}<span class="sr">Zoek in programma</span>
      <input id="prog-q" type="search" placeholder="Zoek workshop, spreker of organisatie" value="${esc(state.q)}"></label>
    ${tags}
    <div id="prog-body">${body}</div>`;
}

function blocks() {
  const start = Math.min(...E.rounds.map(r => toMin(r.start))) - 15;
  const end = Math.max(...E.rounds.map(r => toMin(r.end))) + 15;
  const ppm = 2.6; // pixels per minute
  const x = t => (toMin(t) - start) * ppm;
  const hours = [];
  for (let m = Math.ceil(start / 30) * 30; m <= end; m += 30) hours.push(m);
  const n = nowMinutes();
  const rows = E.rooms.map(room => {
    const cells = E.sessions.filter(s => s.room === room.id).map(s => {
      const on = mine.sessions.includes(s.id);
      return `<button type="button" class="blk ${sessionMatches(s) ? '' : 'dim'} ${on ? 'mine' : ''} ${sessionStatus(s)}" data-session="${s.id}"
        style="left:${x(s.start)}px;width:${x(s.end) - x(s.start) - 6}px">
        <span class="blk-title">${esc(s.title)}</span>
        <span class="blk-lead">${esc(sessionLead(s))}</span>
        ${s.tags ? `<span class="blk-tags">${tagDots(s)}</span>` : ''}
        ${on ? `<span class="blk-star">${icon('star', { size: 14 })}</span>` : ''}
      </button>`;
    }).join('');
    return `<div class="tl-row"><div class="tl-room"><button type="button" data-room="${room.id}">${esc(room.name)}</button></div><div class="tl-track">${cells}</div></div>`;
  }).join('');
  const width = (end - start) * ppm;
  return `<div class="timeline" id="timeline"><div class="tl-inner" style="--w:${width}px">
      <div class="tl-row tl-axis"><div class="tl-room"></div><div class="tl-track">
        ${E.rounds.map(r => `<div class="tl-round" style="left:${x(r.start)}px;width:${x(r.end) - x(r.start) - 6}px">${esc(r.name.replace('Workshopronde', 'Ronde'))}</div>`).join('')}
        ${hours.map(m => `<span class="tl-hour ${m % 60 ? 'half' : ''}" style="left:${(m - start) * ppm}px">${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}</span>`).join('')}
      </div></div>
      ${rows}
      ${n != null && n >= start && n <= end ? `<div class="tl-now" style="left:calc(var(--room-w) + ${(n - start) * ppm}px)"><span>nu</span></div>` : ''}
    </div></div>`;
}

function scrollToNow() {
  const n = nowMinutes(), tl = $('#timeline'), now = $('.tl-now');
  if (n != null && tl && now) tl.scrollLeft = Math.max(0, now.offsetLeft - tl.clientWidth / 2);
}

function list() {
  const out = E.rounds.map(r => {
    const items = E.sessions.filter(s => s.start === r.start && sessionMatches(s))
      .sort((a, b) => E.rooms.findIndex(x => x.id === a.room) - E.rooms.findIndex(x => x.id === b.room));
    if (!items.length) return '';
    const st = sessionStatus({ start: r.start, end: r.end });
    return `<section class="round ${st}">
      <h3><span>${esc(r.name)}</span><time>${fmt(r.start)} – ${fmt(r.end)}</time>${st === 'now' ? '<em class="badge live-badge">Nu</em>' : ''}</h3>
      <ul class="cards">${items.map(sessionCard).join('')}</ul></section>`;
  }).join('');
  return out || `<p class="empty">Geen workshops gevonden.</p>`;
}

function sessionCard(s) {
  const on = mine.sessions.includes(s.id);
  return `<li><button type="button" class="card ${on ? 'mine' : ''}" data-session="${s.id}">
      <span class="card-room">${icon('pin', { size: 14 })} ${esc(roomName(s.room))}</span>
      <span class="card-title">${esc(s.title)}</span>
      <span class="card-lead">${esc(sessionLead(s))}</span>
      ${s.tags ? `<span class="card-tags">${tagDots(s)}</span>` : ''}
    </button>
    <button type="button" class="star ${on ? 'on' : ''}" data-star="${s.id}" aria-pressed="${on}" aria-label="${on ? 'Verwijder uit' : 'Zet in'} mijn programma">${icon('star', { size: 20 })}</button></li>`;
}

// ---------------------------------------------------------------- partners
function viewPartners() {
  const q = state.partnerQ.toLowerCase();
  const match = p => !q || `${p.name} ${p.stand} ${p.description}`.toLowerCase().includes(q);
  const sortKey = p => (/^\d+$/.test(p.stand) ? Number(p.stand) : 1000 + p.stand.charCodeAt(0));
  const main = E.partners.filter(p => p.main && match(p));
  const rest = E.partners.filter(p => match(p)).sort((a, b) => sortKey(a) - sortKey(b));
  const item = p => {
    const want = mine.stands.includes(p.id), seen = mine.visited.includes(p.id);
    return `<li class="${seen ? 'seen' : ''}">
      <button type="button" class="prow" data-partner="${p.id}">
        <span class="badge-stand ${/^\d+$/.test(p.stand) ? '' : 'letter'}">${esc(p.stand)}</span>
        <span class="prow-name">${esc(p.name)}${p.main ? ' <em class="tag-main">Hoofdpartner</em>' : ''}</span>
        ${E.sessions.some(s => s.partner === p.id) ? `<span class="prow-ws" title="Geeft een workshop">${icon('workshop', { size: 16 })}</span>` : ''}
      </button>
      <button type="button" class="star ${want ? 'on' : ''}" data-want="${p.id}" aria-pressed="${want}" aria-label="Wil ik bezoeken">${icon('heart', { size: 20 })}</button>
    </li>`;
  };
  return `<div class="panel-head"><h2>Standhouders</h2></div>
    <p class="lede">Deze (zorg)organisaties vind je op de beursvloer. Tik op een naam om de stand op de kaart te zien.</p>
    <label class="search">${icon('search', { size: 18 })}<span class="sr">Zoek standhouder</span>
      <input id="partner-q" type="search" placeholder="Zoek op naam of standnummer" value="${esc(state.partnerQ)}"></label>
    ${main.length ? `<h3 class="sub">Hoofdpartners</h3><ul class="plist">${main.map(item).join('')}</ul>` : ''}
    <h3 class="sub">Alle standhouders <small>(${rest.length})</small></h3>
    <ul class="plist">${rest.map(item).join('') || '<li class="empty">Niets gevonden.</li>'}</ul>`;
}

// ---------------------------------------------------------------- mijn dag
function viewMijn() {
  const sessions = E.sessions.filter(s => mine.sessions.includes(s.id)).sort((a, b) => toMin(a.start) - toMin(b.start));
  const clash = new Set();
  sessions.forEach((a, i) => sessions.slice(i + 1).forEach(b => { if (toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end)) { clash.add(a.id); clash.add(b.id); } }));
  const stands = E.partners.filter(p => mine.stands.includes(p.id));
  const free = E.rounds.filter(r => !sessions.some(s => s.start === r.start));
  return `<div class="panel-head"><h2>Mijn dag</h2></div>
    <p class="lede">Je keuzes worden alleen op dit apparaat bewaard.</p>
    <h3 class="sub">Mijn workshops</h3>
    ${sessions.length ? `<ol class="agenda">${sessions.map(s => `<li class="${clash.has(s.id) ? 'clash' : ''} ${sessionStatus(s)}">
        <time>${fmt(s.start)}<br><small>${fmt(s.end)}</small></time>
        <button type="button" class="card" data-session="${s.id}">
          <span class="card-room">${icon('pin', { size: 14 })} ${esc(roomName(s.room))}</span>
          <span class="card-title">${esc(s.title)}</span>
          ${clash.has(s.id) ? `<span class="warn">${icon('warn', { size: 14 })} Overlapt met een andere keuze</span>` : ''}
        </button></li>`).join('')}</ol>`
      : `<p class="empty-inline">Nog geen workshops gekozen. Tik op ${icon('star', { size: 16 })} in het <a href="#programma">programma</a>.</p>`}
    ${sessions.length && free.length ? `<p class="hint">Nog vrij: ${free.map(r => `<a href="#programma">${esc(r.name.replace('Workshopronde', 'ronde'))} (${fmt(r.start)})</a>`).join(', ')}</p>` : ''}
    <h3 class="sub">Stands die ik wil bezoeken</h3>
    ${stands.length ? `<ul class="plist">${stands.map(p => `<li class="${mine.visited.includes(p.id) ? 'seen' : ''}">
        <button type="button" class="check ${mine.visited.includes(p.id) ? 'on' : ''}" data-visited="${p.id}" aria-pressed="${mine.visited.includes(p.id)}" aria-label="Bezocht">${icon('check', { size: 16 })}</button>
        <button type="button" class="prow" data-partner="${p.id}"><span class="badge-stand">${esc(p.stand)}</span><span class="prow-name">${esc(p.name)}</span></button>
      </li>`).join('')}</ul>
      <button type="button" class="btn ghost" data-show-mine>${icon('map', { size: 18 })} Toon op de kaart</button>`
      : `<p class="empty-inline">Tik op ${icon('heart', { size: 16 })} bij een <a href="#partners">standhouder</a> om hem aan je lijst toe te voegen.</p>`}
    ${sessions.length ? `<p><button type="button" class="btn ghost" data-ics>${icon('calendar', { size: 18 })} Zet in mijn agenda</button></p>` : ''}`;
}

// ---------------------------------------------------------------- info
function viewInfo() {
  const acts = (E.activities || []);
  const facilities = V.pois.filter(p => !p.hidden);
  return `<div class="hero">
      <p class="eyebrow">Welkom Zorgheld!</p>
      <h2>${esc(E.name)} ${esc(E.city || '')}</h2>
      <p>${esc(E.tagline || '')}</p>
    </div>
    ${(E.intro || []).map(t => `<p class="prose">${esc(t)}</p>`).join('')}
    <p class="prose sign">Het Hart voor Zorg team</p>
    <h3 class="sub">Workshoprondes</h3>
    <ul class="rounds">${E.rounds.map(r => `<li><time>${fmt(r.start)} – ${fmt(r.end)}</time><span>${esc(r.name)}</span></li>`).join('')}</ul>
    <h3 class="sub">Wat is er te doen?</h3>
    <ul class="acts-list">${acts.map(a => `<li><span class="act-ico">${icon(a.icon, { size: 22 })}</span><div>
        <strong>${esc(a.name)}</strong><p>${esc(a.text)}</p>
        ${a.x != null ? `<button type="button" class="link" data-act="${a.id}">${icon('pin', { size: 14 })} Toon op kaart</button>` : ''}
      </div></li>`).join('')}</ul>
    <h3 class="sub">Praktisch</h3>
    <ul class="facts">${facilities.map(p => `<li><button type="button" class="link" data-poi="${p.id}">${icon(p.icon, { size: 18 })} ${esc(p.name)}</button></li>`).join('')}
      ${E.rooms.map(r => `<li><button type="button" class="link" data-room="${r.id}">${icon('pin', { size: 18 })} ${esc(r.name)} <small>· ${esc(r.location || '')}</small></button></li>`).join('')}
    </ul>
    <p class="outro">De beste zorg leveren we samen. <a href="https://www.hartvoorzorg.nl" target="_blank" rel="noopener">www.hartvoorzorg.nl</a></p>`;
}

// ---------------------------------------------------------------- panel events
function bindPanel() {
  const p = $('#panel');
  p.onclick = e => {
    const t = e.target.closest('button, a');
    if (!t) return;
    const d = t.dataset;
    if (d.mode) { state.mode = d.mode; store.set('hvz:mode', d.mode); renderPanel(); }
    else if (d.tag) { state.tags.has(d.tag) ? state.tags.delete(d.tag) : state.tags.add(d.tag); renderPanel(); }
    else if (d.star) { toggle(mine.sessions, d.star); renderPanel(); }
    else if (d.want) { toggle(mine.stands, d.want); renderPanel(); refreshMapMarks(); }
    else if (d.visited) { toggle(mine.visited, d.visited); renderPanel(); refreshMapMarks(); }
    else if (d.session) go(state.tab, `sessie/${d.session}`);
    else if (d.partner) go(state.tab, `partner/${d.partner}`);
    else if (d.room) go(state.tab, `zaal/${d.room}`);
    else if (d.act) go(isWide() ? state.tab : 'kaart', `activiteit/${d.act}`);
    else if (d.poi) go(isWide() ? state.tab : 'kaart', `plek/${d.poi}`);
    else if (d.showMine != null) showMineOnMap();
    else if (d.ics != null) downloadICS();
  };
  const bindSearch = (sel, key, target) => {
    const inp = $(sel, p);
    if (!inp) return;
    inp.oninput = () => {
      state[key] = inp.value;
      const pos = inp.selectionStart;
      if (target) { $(target).innerHTML = state.mode === 'blokken' ? blocks() : list(); }
      else { renderPanel(); const again = $(sel); again.focus(); again.setSelectionRange(pos, pos); }
    };
  };
  bindSearch('#prog-q', 'q', '#prog-body');
  bindSearch('#partner-q', 'partnerQ');
}

function toggle(arr, id) {
  const i = arr.indexOf(id);
  i >= 0 ? arr.splice(i, 1) : arr.push(id);
  saveMine();
  updateLive();
}

// ---------------------------------------------------------------- map
function setupMap() {
  $('#map').innerHTML = renderMapSVG(E, V);
  const svg = $('#map svg');
  router = new Router(V, E);
  pz = new PanZoom(svg, {
    onTap: target => {
      const g = target.closest('[data-stand],[data-act],[data-poi],[data-room]');
      if (!g) return;
      const d = g.dataset, tab = isWide() ? state.tab : 'kaart';
      if (d.stand) {
        const s = E.stands.find(x => x.id === d.stand);
        const ps = partnersAtStand(E, s.label);
        if (ps.length === 1) go(tab, `partner/${ps[0].id}`);
        else if (ps.length > 1) go(tab, `stand/${s.id}`);
      } else if (d.act) go(tab, `activiteit/${d.act}`);
      else if (d.poi) go(tab, `plek/${d.poi}`);
      else if (d.room) go(tab, `zaal/${d.room}`);
    },
  });
  $('.map-ctrl [data-zoom="in"]').innerHTML = icon('plus');
  $('.map-ctrl [data-zoom="out"]').innerHTML = icon('minus');
  $('.map-ctrl [data-zoom="reset"]').innerHTML = icon('home');
  $('.map-ctrl').onclick = e => {
    const z = e.target.closest('[data-zoom]')?.dataset.zoom;
    if (z === 'in') pz.zoomBy(1.5); else if (z === 'out') pz.zoomBy(1 / 1.5); else if (z === 'reset') pz.reset();
  };
  refreshMapMarks();
  setupMapSearch();
}

function refreshMapMarks() {
  for (const g of document.querySelectorAll('#map [data-stand]')) {
    const s = E.stands.find(x => x.id === g.dataset.stand);
    const ps = partnersAtStand(E, s.label);
    g.classList.toggle('want', ps.some(p => mine.stands.includes(p.id)));
    g.classList.toggle('visited', ps.length > 0 && ps.every(p => mine.visited.includes(p.id)));
  }
}

function highlight(standIds = [], extra = []) {
  for (const g of document.querySelectorAll('#map .hl')) g.classList.remove('hl');
  for (const id of standIds) document.querySelector(`#map [data-stand="${CSS.escape(id)}"]`)?.classList.add('hl');
  const layer = $('#map .marker-layer');
  layer.innerHTML = extra.map(p => `<g class="pin" transform="translate(${p.x} ${p.y})"><circle r="16"/></g>`).join('');
}

function setupMapSearch() {
  const inp = $('#map-q'), ul = $('#map-suggest');
  const items = () => [
    ...E.partners.map(p => ({ kind: 'partner', id: p.id, label: p.name, meta: `Stand ${p.stand}` })),
    ...E.rooms.map(r => ({ kind: 'zaal', id: r.id, label: r.name, meta: 'Workshopzaal' })),
    ...(E.activities || []).filter(a => a.x != null).map(a => ({ kind: 'activiteit', id: a.id, label: a.name, meta: 'Activiteit' })),
    ...V.pois.filter(p => !p.hidden).map(p => ({ kind: 'plek', id: p.id, label: p.name, meta: 'Voorziening' })),
  ];
  inp.oninput = () => {
    const q = inp.value.trim().toLowerCase();
    if (!q) { ul.hidden = true; return; }
    const res = items().filter(i => i.label.toLowerCase().includes(q) || i.meta.toLowerCase() === `stand ${q}`).slice(0, 8);
    ul.innerHTML = res.map(i => `<li><button type="button" data-k="${i.kind}" data-id="${i.id}">${esc(i.label)}<small>${esc(i.meta)}</small></button></li>`).join('') || '<li class="none">Niets gevonden</li>';
    ul.hidden = false;
  };
  ul.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    ul.hidden = true; inp.value = '';
    go(isWide() ? state.tab : 'kaart', `${b.dataset.k}/${b.dataset.id}`);
  };
  inp.onkeydown = e => { if (e.key === 'Enter') ul.querySelector('button')?.click(); if (e.key === 'Escape') { ul.hidden = true; } };
}

function showOnMap(points, standIds = []) {
  if (!isWide() && state.tab !== 'kaart') return;
  highlight(standIds, standIds.length ? [] : points);
  if (points.length) pz.focus(points);
}

function showMineOnMap() {
  const ids = E.stands.filter(s => partnersAtStand(E, s.label).some(p => mine.stands.includes(p.id))).map(s => s.id);
  if (!isWide()) go('kaart');
  setTimeout(() => { highlight(ids); pz.focus(E.stands.filter(s => ids.includes(s.id)).map(standCenter)); }, 50);
}

// Location of a destination: { point, standIds, label, note }
function placeOf(type, id) {
  if (type === 'partner') {
    const p = partnerById(id); const ss = p ? standsOfPartner(E, p) : [];
    return ss.length ? { point: standCenter(ss[0]), points: ss.map(standCenter), standIds: ss.map(s => s.id), label: `${p.name} (stand ${p.stand})` } : null;
  }
  if (type === 'stand') {
    const s = E.stands.find(x => x.id === id);
    return s ? { point: standCenter(s), points: [standCenter(s)], standIds: [s.id], label: `Stand ${s.label}` } : null;
  }
  if (type === 'activiteit') {
    const a = E.activities.find(x => x.id === id);
    return a?.x != null ? { point: { x: a.x, y: a.y }, points: [{ x: a.x, y: a.y }], standIds: [], label: a.name } : null;
  }
  if (type === 'plek') {
    const p = V.pois.find(x => x.id === id);
    return p ? { point: { x: p.x, y: p.y }, points: [{ x: p.x, y: p.y }], standIds: [], label: p.name } : null;
  }
  if (type === 'zaal') {
    const r = V.rooms[id];
    if (!r) return null;
    if (r.poi) { const p = V.pois.find(x => x.id === r.poi); return { point: p, points: [p], standIds: [], label: roomName(id), note: r.note }; }
    return { point: { x: r.x, y: r.y }, points: [{ x: r.x, y: r.y }], standIds: [], label: roomName(id) };
  }
  return null;
}

function fromOptions() {
  const pois = V.pois.map(p => `<option value="plek:${p.id}" ${state.from === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const stands = E.partners.filter(p => standsOfPartner(E, p).length).sort((a, b) => a.name.localeCompare(b.name))
    .map(p => `<option value="partner:${p.id}" ${state.from === p.id ? 'selected' : ''}>Stand ${esc(p.stand)} · ${esc(p.name)}</option>`).join('');
  return `<optgroup label="Plekken">${pois}</optgroup><optgroup label="Bij een stand">${stands}</optgroup>`;
}

function showRoute(type, id) {
  const dest = placeOf(type, id);
  if (!dest) return;
  const [ft, fid] = state.from.includes(':') ? state.from.split(':') : ['plek', state.from];
  const src = placeOf(ft, fid) || placeOf('plek', 'ingang');
  const r = router.route(src.point, dest.point);
  if (!isWide()) go('kaart');
  setTimeout(() => {
    const layer = $('#map .route-layer');
    if (!r) { layer.innerHTML = ''; return; }
    const pts = r.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    layer.innerHTML = `<polyline class="route-casing" points="${pts}"/><polyline class="route-line" points="${pts}"/>
      <g class="route-start" transform="translate(${src.point.x} ${src.point.y})"><circle r="8"/></g>
      <g class="route-end" transform="translate(${dest.point.x} ${dest.point.y})"><circle r="9"/></g>`;
    highlight(dest.standIds);
    pz.focus(r.points);
    const meters = Math.round(r.length * METERS_PER_UNIT / 5) * 5;
    const bar = $('#route-bar');
    bar.innerHTML = `<div class="rb-main">${icon('route', { size: 20 })}<div><strong>Naar ${esc(dest.label)}</strong>
        <span>± ${Math.max(meters, 5)} m · ${Math.max(1, Math.round(meters / 70))} min lopen${dest.note ? ` · ${esc(dest.note)}` : ''}</span></div>
        <button type="button" class="icon-btn" data-close-route aria-label="Route sluiten">${icon('x', { size: 18 })}</button></div>
      <label class="rb-from">Vanaf <select id="route-from">${fromOptions()}</select></label>`;
    bar.hidden = false;
    state.route = { type, id };
    $('#route-from').onchange = e => { state.from = e.target.value; showRoute(type, id); };
    bar.querySelector('[data-close-route]').onclick = clearRoute;
    if (!isWide()) closeSheet({ keepHash: true });
  }, 60);
}

function clearRoute() {
  $('#map .route-layer').innerHTML = '';
  $('#route-bar').hidden = true;
  state.route = null;
  highlight();
}

// ---------------------------------------------------------------- detail sheet
function setupSheet() {
  $('.sheet-close').innerHTML = icon('x');
  $('.sheet-close').onclick = () => closeSheet();
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
  $('#sheet').addEventListener('click', e => {
    const b = e.target.closest('button, a');
    if (!b) return;
    const d = b.dataset;
    if (d.routeType) showRoute(d.routeType, d.routeId);
    else if (d.star) { toggle(mine.sessions, d.star); reopen(); renderPanel(); }
    else if (d.want) { toggle(mine.stands, d.want); reopen(); renderPanel(); refreshMapMarks(); }
    else if (d.visited) { toggle(mine.visited, d.visited); reopen(); renderPanel(); refreshMapMarks(); }
    else if (d.mapType) go('kaart', `${d.mapType}/${d.mapId}`);
    else if (d.session) go(state.tab, `sessie/${d.session}`);
    else if (d.partner) go(state.tab, `partner/${d.partner}`);
    else if (d.room) go(state.tab, `zaal/${d.room}`);
  });
}

let current = null;
function reopen() { if (current) openDetail(current.type, current.id, { silent: true }); }

function openDetail(type, id, { silent = false } = {}) {
  const html = detailHTML(type, id);
  if (!html) return;
  current = { type, id };
  $('#sheet-body').innerHTML = html;
  const sh = $('#sheet');
  sh.hidden = false;
  requestAnimationFrame(() => sh.classList.add('open'));
  if (silent) return;
  const place = placeOf(type, id) || (type === 'sessie' ? placeOf('zaal', E.sessions.find(s => s.id === id)?.room) : null);
  if (place && (isWide() || state.tab === 'kaart')) showOnMap(place.points, place.standIds);
}

function closeSheet({ keepHash = false } = {}) {
  const sh = $('#sheet');
  current = null;
  sh.classList.remove('open');
  setTimeout(() => { if (!sh.classList.contains('open')) sh.hidden = true; }, 250);
  if (!keepHash && location.hash.includes('/')) history.replaceState(null, '', `#${document.body.dataset.tab}`);
}

function actions(type, id, extra = '') {
  const place = placeOf(type, id);
  const onMap = place && !isWide() && state.tab !== 'kaart'
    ? `<button type="button" class="btn" data-map-type="${type}" data-map-id="${esc(id)}">${icon('map', { size: 18 })} Toon op kaart</button>` : '';
  return `<div class="actions">${place ? `<button type="button" class="btn" data-route-type="${type}" data-route-id="${esc(id)}">${icon('route', { size: 18 })} Route hierheen</button>` : ''}${onMap}${extra}</div>`;
}

function detailHTML(type, id) {
  if (type === 'sessie') {
    const s = E.sessions.find(x => x.id === id);
    if (!s) return '';
    const p = partnerById(s.partner), on = mine.sessions.includes(s.id);
    const same = E.sessions.filter(x => x.start === s.start && x.id !== s.id);
    const tags = (s.tags || []).map(t => E.tags?.find(x => x.id === t)).filter(Boolean);
    return `<p class="eyebrow">${fmt(s.start)} – ${fmt(s.end)} · ${esc(roomName(s.room))}</p>
      <h2 id="sheet-title">${esc(s.title)}</h2>
      ${s.speaker ? `<p class="who">${esc(s.speaker)}</p>` : ''}
      ${p ? `<p><button type="button" class="link" data-partner="${p.id}">${esc(p.name)} · stand ${esc(p.stand)}</button></p>` : s.organisation ? `<p>${esc(s.organisation)}</p>` : ''}
      ${tags.length ? `<p class="taglist">${tags.map(t => `<span class="pill" style="--c:${t.color}">${esc(t.name)}</span>`).join('')}</p>` : ''}
      ${s.description ? `<p class="prose">${esc(s.description)}</p>` : ''}
      ${E.rooms.find(r => r.id === s.room)?.location ? `<p class="muted">${icon('pin', { size: 14 })} ${esc(E.rooms.find(r => r.id === s.room).location)}</p>` : ''}
      <div class="actions">
        <button type="button" class="btn ${on ? 'on' : 'primary'}" data-star="${s.id}">${icon('star', { size: 18 })} ${on ? 'In mijn programma' : 'Zet in mijn programma'}</button>
        <button type="button" class="btn" data-route-type="zaal" data-route-id="${s.room}">${icon('route', { size: 18 })} Route naar zaal</button>
      </div>
      ${same.length ? `<h3 class="sub">Ook in deze ronde</h3><ul class="mini">${same.map(x => `<li><button type="button" data-session="${x.id}"><strong>${esc(x.title)}</strong><small>${esc(roomName(x.room))}</small></button></li>`).join('')}</ul>` : ''}`;
  }
  if (type === 'partner') {
    const p = partnerById(id);
    if (!p) return '';
    const ws = E.sessions.filter(s => s.partner === p.id);
    const want = mine.stands.includes(p.id), seen = mine.visited.includes(p.id);
    const nStands = standsOfPartner(E, p).length;
    return `<p class="eyebrow">Stand ${esc(p.stand)}${nStands > 1 ? ` · ${nStands} plekken op de beursvloer` : ''}${p.main ? ' · Hoofdpartner' : ''}</p>
      <h2 id="sheet-title">${p.logo ? `<img class="logo" src="${esc(p.logo)}" alt="">` : ''}${esc(p.name)}</h2>
      ${p.description ? `<p class="prose">${esc(p.description)}</p>` : ''}
      ${p.website ? `<p><a class="link" href="${esc(p.website)}" target="_blank" rel="noopener">${icon('link', { size: 14 })} ${esc(p.website.replace(/^https?:\/\//, ''))}</a></p>` : ''}
      ${actions('partner', p.id, `
        <button type="button" class="btn ${want ? 'on' : ''}" data-want="${p.id}">${icon('heart', { size: 18 })} ${want ? 'Op mijn lijst' : 'Wil ik bezoeken'}</button>
        <button type="button" class="btn ${seen ? 'on' : ''}" data-visited="${p.id}">${icon('check', { size: 18 })} ${seen ? 'Bezocht' : 'Markeer als bezocht'}</button>`)}
      ${ws.length ? `<h3 class="sub">Workshops van ${esc(p.name)}</h3><ul class="mini">${ws.map(s => `<li><button type="button" data-session="${s.id}"><strong>${esc(s.title)}</strong><small>${fmt(s.start)} · ${esc(roomName(s.room))}</small></button></li>`).join('')}</ul>` : ''}`;
  }
  if (type === 'stand') {
    const s = E.stands.find(x => x.id === id);
    if (!s) return '';
    const ps = partnersAtStand(E, s.label);
    return `<p class="eyebrow">Stand ${esc(s.label)}</p><h2 id="sheet-title">${ps.length ? 'Op deze stand' : 'Stand ' + esc(s.label)}</h2>
      <ul class="mini">${ps.map(p => `<li><button type="button" data-partner="${p.id}"><strong>${esc(p.name)}</strong></button></li>`).join('')}</ul>${actions('stand', s.id)}`;
  }
  if (type === 'zaal') {
    const r = E.rooms.find(x => x.id === id);
    if (!r) return '';
    const ss = E.sessions.filter(s => s.room === id).sort((a, b) => toMin(a.start) - toMin(b.start));
    return `<p class="eyebrow">Workshopzaal${r.location ? ' · ' + esc(r.location) : ''}</p><h2 id="sheet-title">${esc(r.name)}</h2>
      ${actions('zaal', id)}
      <h3 class="sub">Programma in deze zaal</h3>
      <ul class="mini">${ss.map(s => `<li class="${sessionStatus(s)}"><button type="button" data-session="${s.id}"><strong>${esc(s.title)}</strong><small>${fmt(s.start)} – ${fmt(s.end)}</small></button></li>`).join('')}</ul>`;
  }
  if (type === 'activiteit') {
    const a = (E.activities || []).find(x => x.id === id);
    if (!a) return '';
    return `<p class="eyebrow">Activiteit</p><h2 id="sheet-title">${esc(a.name)}</h2><p class="prose">${esc(a.text)}</p>${actions('activiteit', id)}`;
  }
  if (type === 'plek') {
    const p = V.pois.find(x => x.id === id);
    if (!p) return '';
    return `<p class="eyebrow">Voorziening</p><h2 id="sheet-title">${esc(p.name)}</h2>${actions('plek', id)}`;
  }
  return '';
}

// ---------------------------------------------------------------- calendar export
function downloadICS() {
  if (!E.date) { alert('De datum van dit festival is nog niet bekend.'); return; }
  const d = E.date.replace(/-/g, '');
  const t = s => s.replace(':', '') + '00';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hart voor Zorg//Programmaboekje//NL'];
  for (const s of E.sessions.filter(x => mine.sessions.includes(x.id))) {
    lines.push('BEGIN:VEVENT', `UID:${E.id}-${s.id}@hartvoorzorg.nl`, `DTSTART;TZID=Europe/Amsterdam:${d}T${t(s.start)}`,
      `DTEND;TZID=Europe/Amsterdam:${d}T${t(s.end)}`, `SUMMARY:${s.title.replace(/[,;]/g, '\\$&')}`,
      `LOCATION:${roomName(s.room)} · ${E.name} ${E.city || ''}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = `${E.id}-mijn-programma.ics`;
  a.click();
}
