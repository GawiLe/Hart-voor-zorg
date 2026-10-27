// Editor for event data: fill in programme, partners and stand positions, then export JSON.
import { esc, icon, fetchJSON, store, DRAFT_KEY, toMin, fmt, slugify } from './core.js';
import { renderMapSVG, PanZoom, partnersAtStand, standsOfPartner } from './map.js';

const $ = (s, r = document) => r.querySelector(s);
const ICONS = ['workshop', 'camera', 'escape', 'hand', 'coffee', 'food', 'heart', 'star', 'info'];

let index = [], E = null, V = null, tab = store.get('hvz-ed:tab', 'programma'), selected = null, editing = null;

init();

async function init() {
  index = await fetchJSON('data/events/index.json');
  const drafts = Object.keys(localStorage).filter(k => k.startsWith('hvz-draft:')).map(k => k.slice(10));
  for (const id of drafts) if (!index.some(e => e.id === id)) {
    const d = store.get(DRAFT_KEY(id));
    if (d) index.push({ id, name: d.name, city: d.city, draftOnly: true });
  }
  const sel = $('#ev-select');
  const last = store.get('hvz-ed:event', index[0]?.id);
  sel.innerHTML = index.map(e => `<option value="${e.id}">${esc(e.name)} ${esc(e.city || '')}${e.draftOnly ? ' (concept)' : ''}</option>`).join('')
    + '<option value="__new">+ Nieuw festival…</option>';
  sel.value = index.some(e => e.id === last) ? last : index[0].id;
  sel.onchange = () => sel.value === '__new' ? newEvent() : load(sel.value);
  $('#ed-tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; store.set('hvz-ed:tab', tab); render(); } };
  $('#btn-export').onclick = exportJSON;
  $('#btn-preview').onclick = () => window.open(`event.html?e=${encodeURIComponent(E.id)}&draft=1`, '_blank');
  $('#btn-import').onclick = () => $('#file-import').click();
  $('#file-import').onchange = importJSON;
  await load(sel.value);
}

async function load(id) {
  store.set('hvz-ed:event', id);
  const draft = store.get(DRAFT_KEY(id));
  E = draft || await fetchJSON(`data/events/${id}.json`);
  V = await fetchJSON(`data/venues/${E.venue}.json`);
  selected = null; editing = null;
  setStatus(draft ? 'Concept uit deze browser geladen' : 'Gepubliceerde versie geladen');
  render();
}

function save(msg = 'Concept opgeslagen') {
  store.set(DRAFT_KEY(E.id), E);
  const t = new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  setStatus(`${msg} om ${t} · alleen in deze browser, download de JSON om te publiceren`);
  updateIssueCount();
}

function setStatus(t) { $('#status').textContent = `${E ? `${E.name} ${E.city || ''} · ` : ''}${t}`; }

function newEvent() {
  const base = E;
  const name = 'Nieuw festival';
  const id = `nieuw-festival-${Date.now().toString(36).slice(-4)}`;
  E = {
    ...structuredClone(base), id, name, date: '', sessions: [], partners: [],
    stands: base.stands.map(s => ({ ...s })), // keep the stand layout as a starting point
  };
  index.push({ id, name, city: E.city, draftOnly: true });
  const sel = $('#ev-select');
  sel.innerHTML = index.map(e => `<option value="${e.id}">${esc(e.name)} ${esc(e.city || '')}${e.draftOnly ? ' (concept)' : ''}</option>`).join('') + '<option value="__new">+ Nieuw festival…</option>';
  sel.value = id;
  store.set('hvz-ed:event', id);
  tab = 'algemeen';
  save('Nieuw festival aangemaakt op basis van de vorige indeling');
  render();
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(E, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${E.id}.json`;
  a.click();
  setStatus(`${E.id}.json gedownload · zet dit bestand in data/events/ om te publiceren`);
}

async function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.id || !Array.isArray(data.sessions)) throw new Error('Dit lijkt geen festivalbestand.');
    E = data;
    V = await fetchJSON(`data/venues/${E.venue}.json`);
    if (!index.some(x => x.id === E.id)) index.push({ id: E.id, name: E.name, city: E.city, draftOnly: true });
    save('Geïmporteerd');
    init();
  } catch (err) {
    setStatus(`Importeren mislukt: ${err.message}`);
  }
  e.target.value = '';
}

// ---------------------------------------------------------------- rendering
function render() {
  for (const b of document.querySelectorAll('#ed-tabs button')) b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false');
  const views = { algemeen: viewGeneral, programma: viewProgramme, partners: viewPartners, kaart: viewMap, controle: viewCheck };
  const main = $('#ed-main');
  main.oninput = main.onclick = null;
  main.innerHTML = views[tab]();
  ({ kaart: bindMap, programma: bindProgramme, partners: bindPartners, algemeen: bindGeneral, controle: bindCheck })[tab]?.();
  updateIssueCount();
}

const field = (label, name, value, { type = 'text', hint = '', attrs = '' } = {}) => `
  <label class="fld"><span>${label}</span>${type === 'textarea'
    ? `<textarea name="${name}" rows="5" ${attrs}>${esc(value)}</textarea>`
    : `<input type="${type}" name="${name}" value="${esc(value)}" ${attrs}>`}${hint ? `<small>${hint}</small>` : ''}</label>`;

// ---------------------------------------------------------------- algemeen
function viewGeneral() {
  return `<div class="ed-cols">
    <section class="ed-card" data-form="general">
      <h2>Festival</h2>
      ${field('Naam', 'name', E.name)}
      ${field('Plaats', 'city', E.city)}
      ${field('Datum', 'date', E.date, { type: 'date', hint: 'Nodig voor “nu bezig” en de agenda-export.' })}
      ${field('Ondertitel', 'tagline', E.tagline)}
      ${field('Welkomsttekst', 'intro', (E.intro || []).join('\n\n'), { type: 'textarea', hint: 'Laat een witregel tussen alinea’s.' })}
      ${field('Bestandsnaam (id)', 'id', E.id, { hint: 'Wordt de link: event.html?e=…', attrs: 'pattern="[a-z0-9-]+"' })}
    </section>
    <section class="ed-card">
      <h2>Workshoprondes</h2>
      <table class="ed-table" data-list="rounds"><thead><tr><th>Naam</th><th>Start</th><th>Eind</th><th></th></tr></thead><tbody>
      ${E.rounds.map((r, i) => `<tr data-i="${i}"><td><input name="name" value="${esc(r.name)}"></td><td><input type="time" name="start" value="${r.start}"></td><td><input type="time" name="end" value="${r.end}"></td>
        <td><button type="button" class="icon-btn" data-del aria-label="Verwijder">${icon('trash', { size: 16 })}</button></td></tr>`).join('')}
      </tbody></table>
      <button type="button" class="btn" data-add="rounds">${icon('plus', { size: 16 })} Ronde toevoegen</button>
      <h2>Zalen</h2>
      <table class="ed-table" data-list="rooms"><thead><tr><th>Naam</th><th>Locatie</th><th></th></tr></thead><tbody>
      ${E.rooms.map((r, i) => `<tr data-i="${i}"><td><input name="name" value="${esc(r.name)}"></td><td><input name="location" value="${esc(r.location || '')}"></td>
        <td><button type="button" class="icon-btn" data-del aria-label="Verwijder">${icon('trash', { size: 16 })}</button></td></tr>`).join('')}
      </tbody></table>
      <button type="button" class="btn" data-add="rooms">${icon('plus', { size: 16 })} Zaal toevoegen</button>
      <h2>Doelgroep-labels <small>(bijv. opleidingen bij NURSE.)</small></h2>
      <table class="ed-table" data-list="tags"><thead><tr><th>Naam</th><th>Kleur</th><th></th></tr></thead><tbody>
      ${(E.tags || []).map((t, i) => `<tr data-i="${i}"><td><input name="name" value="${esc(t.name)}"></td><td><input type="color" name="color" value="${t.color}"></td>
        <td><button type="button" class="icon-btn" data-del aria-label="Verwijder">${icon('trash', { size: 16 })}</button></td></tr>`).join('')}
      </tbody></table>
      <button type="button" class="btn" data-add="tags">${icon('plus', { size: 16 })} Label toevoegen</button>
    </section>
    <section class="ed-card ed-wide">
      <h2>Wat is er te doen?</h2>
      <table class="ed-table" data-list="activities"><thead><tr><th>Naam</th><th>Icoon</th><th>Tekst</th><th>Op kaart</th><th></th></tr></thead><tbody>
      ${(E.activities || []).map((a, i) => `<tr data-i="${i}"><td><input name="name" value="${esc(a.name)}"></td>
        <td><select name="icon">${ICONS.map(n => `<option ${n === a.icon ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
        <td><textarea name="text" rows="3">${esc(a.text)}</textarea></td>
        <td>${a.x != null ? 'Ja' : `<button type="button" class="btn" data-place-act="${i}">Plaatsen</button>`}</td>
        <td><button type="button" class="icon-btn" data-del aria-label="Verwijder">${icon('trash', { size: 16 })}</button></td></tr>`).join('')}
      </tbody></table>
      <button type="button" class="btn" data-add="activities">${icon('plus', { size: 16 })} Activiteit toevoegen</button>
    </section>
  </div>`;
}

function bindGeneral() {
  const main = $('#ed-main');
  main.oninput = e => (e.target.closest('[data-form="general"]') ? onGeneral : onRow)(e);
  const onGeneral = e => {
    const { name, value } = e.target;
    if (name === 'intro') E.intro = value.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    else if (name === 'id') {
      if (!/^[a-z0-9-]+$/.test(value)) return;
      localStorage.removeItem(DRAFT_KEY(E.id));
      const entry = index.find(x => x.id === E.id); if (entry) entry.id = value;
      E.id = value; store.set('hvz-ed:event', value);
    } else E[name] = value;
    save();
  };
  const onRow = e => {
    const row = e.target.closest('[data-list] tr[data-i]');
    if (!row) return;
    const list = row.closest('[data-list]').dataset.list, i = +row.dataset.i;
    const item = E[list][i], { name, value } = e.target;
    if (list === 'rounds' && (name === 'start' || name === 'end')) {
      // keep sessions in this round in sync
      for (const s of E.sessions) if (s[name] === item[name]) s[name] = value;
    }
    item[name] = value;
    if ((list === 'rooms' || list === 'tags' || list === 'activities') && name === 'name' && !item.fixedId) {
      const old = item.id, id = slugify(value) || old;
      if (list === 'rooms' && old !== id && !E.rooms.some(r => r.id === id)) { E.sessions.forEach(s => { if (s.room === old) s.room = id; }); item.id = id; }
      if (list === 'tags' && old !== id && !E.tags.some(t => t.id === id)) { E.sessions.forEach(s => { if (s.tags) s.tags = s.tags.map(t => t === old ? id : t); }); item.id = id; }
    }
    save();
  };
  main.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.add) {
      const list = b.dataset.add;
      E[list] ||= [];
      const n = E[list].length + 1;
      const last = E.rounds[E.rounds.length - 1];
      const add = {
        rounds: () => ({ name: `Workshopronde ${n}`, start: last ? addMin(last.end, 15) : '09:30', end: last ? addMin(last.end, 60) : '10:15' }),
        rooms: () => ({ id: `zaal-${n}`, name: `Zaal ${n}`, location: '' }),
        tags: () => ({ id: `label-${n}`, name: `Label ${n}`, color: '#3d9a6e' }),
        activities: () => ({ id: `activiteit-${n}`, name: 'Nieuwe activiteit', icon: 'star', text: '' }),
      }[list]();
      E[list].push(add); save(); render();
    } else if (b.hasAttribute('data-del')) {
      const row = b.closest('tr[data-i]'), list = row.closest('[data-list]').dataset.list;
      const [gone] = E[list].splice(+row.dataset.i, 1);
      if (list === 'rooms') E.sessions = E.sessions.filter(s => s.room !== gone.id);
      if (list === 'rounds') E.sessions = E.sessions.filter(s => s.start !== gone.start);
      save(); render();
    } else if (b.dataset.placeAct) {
      const a = E.activities[+b.dataset.placeAct];
      const [vx, vy, vw, vh] = V.viewBox; a.x = Math.round(vx + vw / 2); a.y = Math.round(vy + vh / 3);
      selected = { kind: 'act', id: a.id }; tab = 'kaart'; save(); render();
    }
  };
}

const addMin = (t, m) => { const x = toMin(t) + m; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

// ---------------------------------------------------------------- programma
function viewProgramme() {
  const cell = (room, round) => {
    const s = E.sessions.find(x => x.room === room.id && x.start === round.start);
    if (!s) return `<td><button type="button" class="slot empty" data-new="${room.id}|${round.start}">${icon('plus', { size: 16 })} Workshop</button></td>`;
    const p = E.partners.find(x => x.id === s.partner);
    return `<td><button type="button" class="slot ${editing === s.id ? 'sel' : ''}" data-edit="${s.id}">
      <strong>${esc(s.title || 'Zonder titel')}</strong><small>${esc([s.speaker, p?.name || s.organisation].filter(Boolean).join(' · ') || '—')}</small>
      ${s.tags?.length ? `<span class="tagdots">${s.tags.map(t => `<i style="--c:${E.tags?.find(x => x.id === t)?.color || '#999'}"></i>`).join('')}</span>` : ''}</button></td>`;
  };
  return `<div class="ed-split">
    <section class="ed-card ed-grow">
      <h2>Workshopprogramma</h2>
      <p class="lede">Klik op een vak om een workshop toe te voegen of te bewerken. Zalen en rondes stel je in onder Algemeen.</p>
      <div class="ed-scroll"><table class="prog-grid"><thead><tr><th></th>${E.rounds.map(r => `<th>${esc(r.name)}<small>${fmt(r.start)} – ${fmt(r.end)}</small></th>`).join('')}</tr></thead>
      <tbody>${E.rooms.map(room => `<tr><th>${esc(room.name)}</th>${E.rounds.map(r => cell(room, r)).join('')}</tr>`).join('')}</tbody></table></div>
    </section>
    <aside class="ed-card ed-side" id="session-form">${editing ? sessionForm(E.sessions.find(s => s.id === editing)) : '<p class="muted">Selecteer een workshop.</p>'}</aside>
  </div>`;
}

function sessionForm(s) {
  if (!s) return '';
  const partners = [...E.partners].sort((a, b) => a.name.localeCompare(b.name));
  return `<h2>Workshop</h2>
    <form id="sform" autocomplete="off">
      ${field('Titel', 'title', s.title)}
      ${field('Spreker', 'speaker', s.speaker, { hint: 'Leeg laten als de organisatie de spreker is.' })}
      <label class="fld"><span>Standhouder / organisatie</span><select name="partner"><option value="">— geen standhouder —</option>
        ${partners.map(p => `<option value="${p.id}" ${p.id === s.partner ? 'selected' : ''}>${esc(p.name)} (stand ${esc(p.stand)})</option>`).join('')}</select></label>
      ${!s.partner ? field('Organisatie (zonder stand)', 'organisation', s.organisation || '') : ''}
      <label class="fld"><span>Zaal</span><select name="room">${E.rooms.map(r => `<option value="${r.id}" ${r.id === s.room ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label>
      <div class="fld-row">${field('Start', 'start', s.start, { type: 'time' })}${field('Eind', 'end', s.end, { type: 'time' })}</div>
      ${field('Omschrijving', 'description', s.description || '', { type: 'textarea', hint: 'Verschijnt bij het openen van de workshop.' })}
      ${E.tags?.length ? `<fieldset class="fld"><legend>Voor wie</legend>${E.tags.map(t => `<label class="cb"><input type="checkbox" name="tags" value="${t.id}" ${(s.tags || []).includes(t.id) ? 'checked' : ''}> <i style="--c:${t.color}"></i>${esc(t.name)}</label>`).join('')}</fieldset>` : ''}
    </form>
    <div class="actions"><button type="button" class="btn" data-dup>${icon('plus', { size: 16 })} Herhaal in volgende ronde</button>
      <button type="button" class="btn danger" data-delete>${icon('trash', { size: 16 })} Verwijderen</button></div>`;
}

function bindProgramme() {
  const main = $('#ed-main');
  main.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.new) {
      const [room, start] = b.dataset.new.split('|');
      const r = E.rounds.find(x => x.start === start);
      const s = { id: uniqueId(`${room}-${E.rounds.indexOf(r) + 1}`, E.sessions), room, start, end: r.end, title: '', speaker: '', partner: '', description: '' };
      E.sessions.push(s); editing = s.id; save(); render(); $('#sform [name="title"]').focus();
    } else if (b.dataset.edit) { editing = b.dataset.edit; render(); }
    else if (b.hasAttribute('data-delete')) { E.sessions = E.sessions.filter(s => s.id !== editing); editing = null; save(); render(); }
    else if (b.hasAttribute('data-dup')) {
      const s = E.sessions.find(x => x.id === editing);
      const next = E.rounds.find(r => toMin(r.start) > toMin(s.start) && !E.sessions.some(x => x.room === s.room && x.start === r.start));
      if (!next) { setStatus('Geen vrije volgende ronde in deze zaal'); return; }
      const c = { ...structuredClone(s), id: uniqueId(`${s.room}-${E.rounds.indexOf(next) + 1}`, E.sessions), start: next.start, end: next.end };
      E.sessions.push(c); editing = c.id; save(); render();
    }
  };
  const form = $('#sform');
  if (!form) return;
  const update = e => {
    const s = E.sessions.find(x => x.id === editing);
    const fd = new FormData(form);
    for (const k of ['title', 'speaker', 'partner', 'room', 'start', 'end', 'description']) s[k] = fd.get(k) ?? s[k];
    if (fd.has('organisation')) { s.organisation = fd.get('organisation'); if (!s.organisation) delete s.organisation; }
    if (s.partner) delete s.organisation;
    if (E.tags?.length) { s.tags = fd.getAll('tags'); if (!s.tags.length) delete s.tags; }
    save();
    // refresh grid cell text without losing focus
    const slot = $(`[data-edit="${CSS.escape(s.id)}"]`);
    if (slot && e.target.name !== 'room' && e.target.name !== 'start' && e.target.name !== 'partner') {
      slot.querySelector('strong').textContent = s.title || 'Zonder titel';
    } else { const pos = e.target.name; render(); $(`#sform [name="${pos}"]`)?.focus(); }
  };
  form.addEventListener('input', update);
}

function uniqueId(base, list) {
  let id = base, n = 2;
  while (list.some(x => x.id === id)) id = `${base}-${n++}`;
  return id;
}

// ---------------------------------------------------------------- partners
function viewPartners() {
  const sorted = E.partners.map((p, i) => ({ p, i }));
  return `<section class="ed-card">
    <div class="panel-head"><h2>Standhouders <small>(${E.partners.length})</small></h2>
      <div class="actions"><button type="button" class="btn" data-add-partner>${icon('plus', { size: 16 })} Standhouder</button>
      <button type="button" class="btn" data-paste-toggle>${icon('upload', { size: 16 })} Lijst plakken</button></div></div>
    <div id="paste" class="paste" hidden>
      <p class="muted">Plak de lijst uit het programmaboekje, Excel of InDesign: één standhouder per regel, eerst het standnummer (of letter), dan de naam.
      Bestaande standhouders met dezelfde naam worden bijgewerkt.</p>
      <textarea id="paste-text" rows="8" placeholder="1  Lichen Sclerosus&#10;2  Imvorma&#10;A  Mentorschap Nederland"></textarea>
      <button type="button" class="btn primary" data-paste-apply>Verwerk lijst</button>
    </div>
    <div class="ed-scroll"><table class="ed-table partners" data-list="partners">
      <thead><tr><th>Stand</th><th>Naam</th><th>Hoofd&shy;partner</th><th>Website</th><th>Omschrijving</th><th>Logo-URL</th><th>Op kaart</th><th></th></tr></thead>
      <tbody>${sorted.map(({ p, i }) => `<tr data-i="${i}">
        <td><input name="stand" value="${esc(p.stand)}" class="w-xs"></td>
        <td><input name="name" value="${esc(p.name)}"></td>
        <td class="c"><input type="checkbox" name="main" ${p.main ? 'checked' : ''}></td>
        <td><input name="website" value="${esc(p.website || '')}" placeholder="https://"></td>
        <td><textarea name="description" rows="2">${esc(p.description || '')}</textarea></td>
        <td><input name="logo" value="${esc(p.logo || '')}" placeholder="assets/logos/…"></td>
        <td class="c">${standsOfPartner(E, p).length ? icon('check', { size: 18, cls: 'ok' }) : `<span class="warn-txt" title="Geen stand met dit nummer op de plattegrond">${icon('warn', { size: 16 })}</span>`}</td>
        <td><button type="button" class="icon-btn" data-del aria-label="Verwijder">${icon('trash', { size: 16 })}</button></td></tr>`).join('')}</tbody>
    </table></div></section>`;
}

function bindPartners() {
  const main = $('#ed-main');
  main.oninput = e => {
    const row = e.target.closest('tr[data-i]');
    if (!row) return;
    const p = E.partners[+row.dataset.i], { name, value, type, checked } = e.target;
    if (type === 'checkbox') p[name] = checked;
    else if (name === 'logo' && !value) delete p.logo;
    else p[name] = value;
    if (name === 'name') {
      const old = p.id, id = slugify(value);
      if (id && id !== old && !E.partners.some(x => x.id === id)) { E.sessions.forEach(s => { if (s.partner === old) s.partner = id; }); p.id = id; }
    }
    save();
  };
  main.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-add-partner')) {
      const n = Math.max(0, ...E.partners.map(p => +p.stand || 0)) + 1;
      E.partners.push({ id: uniqueId('nieuwe-standhouder', E.partners), name: 'Nieuwe standhouder', stand: String(n), website: '', description: '', main: false });
      save(); render();
    } else if (b.hasAttribute('data-del')) {
      const [gone] = E.partners.splice(+b.closest('tr').dataset.i, 1);
      E.sessions.forEach(s => { if (s.partner === gone.id) { s.partner = ''; s.organisation = gone.name; } });
      save(); render();
    } else if (b.hasAttribute('data-paste-toggle')) $('#paste').hidden = !$('#paste').hidden;
    else if (b.hasAttribute('data-paste-apply')) {
      let added = 0, updated = 0;
      for (const line of $('#paste-text').value.split('\n')) {
        const m = line.trim().match(/^([0-9]+|[A-Z])\b[\s.:\-\t]+(.+)$/);
        if (!m) continue;
        const [, stand, name] = m;
        const p = E.partners.find(x => x.name.toLowerCase() === name.trim().toLowerCase());
        if (p) { p.stand = stand; updated++; }
        else { E.partners.push({ id: uniqueId(slugify(name), E.partners), name: name.trim(), stand, website: '', description: '', main: false }); added++; }
      }
      save(`${added} toegevoegd, ${updated} bijgewerkt`); render();
    }
  };
}

// ---------------------------------------------------------------- plattegrond
function viewMap() {
  const s = selected?.kind === 'stand' ? E.stands.find(x => x.id === selected.id) : null;
  const a = selected?.kind === 'act' ? E.activities.find(x => x.id === selected.id) : null;
  const unplaced = E.partners.filter(p => !standsOfPartner(E, p).length);
  const orphan = E.stands.filter(st => !partnersAtStand(E, st.label).length);
  return `<div class="ed-split">
    <section class="ed-card ed-grow ed-mapcard">
      <div class="panel-head"><h2>Plattegrond</h2>
        <div class="actions">
          <button type="button" class="btn" data-add-stand="large">${icon('plus', { size: 16 })} Grote stand</button>
          <button type="button" class="btn" data-add-stand="small">${icon('plus', { size: 16 })} Kleine stand</button>
          <button type="button" class="btn" data-add-stand="point">${icon('plus', { size: 16 })} Tafel (letter)</button>
        </div></div>
      <p class="lede">Sleep stands en activiteiten naar hun plek. Sleep het hoekje rechtsonder om de maat te wijzigen. Scrollen of knijpen zoomt.</p>
      <div class="ed-map" id="ed-map">${renderMapSVG(E, V, { editable: true })}</div>
    </section>
    <aside class="ed-card ed-side">
      ${s ? `<h2>Stand ${esc(s.label)}</h2>
        <form id="stand-form">
          ${field('Nummer of letter', 'label', s.label, { hint: partnersAtStand(E, s.label).map(p => p.name).join(', ') || 'Nog geen standhouder met dit nummer.' })}
          <label class="fld"><span>Soort</span><select name="kind">
            ${[['large', 'Grote stand (roze)'], ['small', 'Kleine stand (groen)'], ['point', 'Tafel / letter (oranje)']].map(([k, l]) => `<option value="${k}" ${k === s.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          ${s.kind !== 'point' ? `<div class="fld-row">${field('Breedte', 'w', s.w, { type: 'number' })}${field('Hoogte', 'h', s.h, { type: 'number' })}</div>` : ''}
          <div class="fld-row">${field('X', 'x', s.x, { type: 'number' })}${field('Y', 'y', s.y, { type: 'number' })}</div>
        </form>
        <div class="actions"><button type="button" class="btn" data-dup-stand>${icon('plus', { size: 16 })} Dupliceer</button>
          <button type="button" class="btn" data-rotate>${icon('route', { size: 16 })} Draai</button>
          <button type="button" class="btn danger" data-del-stand>${icon('trash', { size: 16 })} Verwijder</button></div>`
      : a ? `<h2>${esc(a.name)}</h2><p class="muted">Sleep het icoon naar de juiste plek op de kaart.</p>
          <div class="actions"><button type="button" class="btn danger" data-unplace-act>Van kaart halen</button></div>`
      : `<h2>Selecteer een stand</h2><p class="muted">Klik op een stand om nummer en maat aan te passen.</p>`}
      <h3 class="sub">Standhouders zonder plek <small>(${unplaced.length})</small></h3>
      ${unplaced.length ? `<ul class="ed-mini">${unplaced.map(p => `<li><b>${esc(p.stand)}</b> ${esc(p.name)}</li>`).join('')}</ul>` : '<p class="muted">Iedereen staat op de kaart.</p>'}
      <h3 class="sub">Stands zonder standhouder <small>(${orphan.length})</small></h3>
      ${orphan.length ? `<p class="ed-chips">${orphan.map(st => `<button type="button" class="chip" data-pick="${st.id}">${esc(st.label)}</button>`).join('')}</p>` : '<p class="muted">Geen.</p>'}
    </aside></div>`;
}

function bindMap() {
  const svg = $('#ed-map svg');
  const pz = new PanZoom(svg, {
    dragFilter: e => !e.target.closest('[data-stand],[data-act]'),
    maxScale: 8,
  });
  if (selected?.kind === 'stand') svg.querySelector(`[data-stand="${CSS.escape(selected.id)}"]`)?.classList.add('hl');
  // dragging stands and activities
  let drag = null;
  svg.addEventListener('pointerdown', e => {
    const g = e.target.closest('[data-stand],[data-act]');
    if (!g) return;
    e.stopPropagation();
    const p = pz.toSvg(e.clientX, e.clientY);
    const item = g.dataset.stand ? E.stands.find(x => x.id === g.dataset.stand) : E.activities.find(x => x.id === g.dataset.act);
    drag = { g, item, start: p, orig: { ...item }, resize: e.target.classList.contains('resize'), moved: false, kind: g.dataset.stand ? 'stand' : 'act' };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = pz.toSvg(e.clientX, e.clientY);
    const dx = Math.round(p.x - drag.start.x), dy = Math.round(p.y - drag.start.y);
    if (Math.abs(dx) + Math.abs(dy) > 1) drag.moved = true;
    if (drag.resize) { drag.item.w = Math.max(10, drag.orig.w + dx); drag.item.h = Math.max(10, drag.orig.h + dy); }
    else { drag.item.x = drag.orig.x + dx; drag.item.y = drag.orig.y + dy; }
    redrawItem(drag);
  });
  svg.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    selected = { kind: d.kind, id: d.item.id };
    if (d.moved) save();
    lastView = { ...pz.view };
    render();
  });
  if (lastView) { pz.view = { ...lastView }; pz.apply(); }
  svg.addEventListener('pointerup', () => { if (!drag) lastView = { ...pz.view }; });
  svg.addEventListener('wheel', () => { lastView = { ...pz.view }; });

  const main = $('#ed-main');
  main.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = selected?.kind === 'stand' ? E.stands.find(x => x.id === selected.id) : null;
    const v = pz.view;
    if (b.dataset.addStand) {
      const kind = b.dataset.addStand;
      const used = new Set(E.stands.map(x => x.label));
      const label = kind === 'point' ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(l => !used.has(l)) : String(Math.max(0, ...E.stands.map(x => +x.label || 0)) + 1);
      const st = kind === 'point' ? { id: label, label, kind, x: Math.round(v.x + v.w / 2), y: Math.round(v.y + v.h / 2) }
        : { id: uniqueId(label, E.stands), label, kind, x: Math.round(v.x + v.w / 2), y: Math.round(v.y + v.h / 2), w: kind === 'large' ? 58 : 29, h: 29 };
      E.stands.push(st); selected = { kind: 'stand', id: st.id }; save(); render();
    } else if (b.dataset.pick) { selected = { kind: 'stand', id: b.dataset.pick }; render(); }
    else if (s && b.hasAttribute('data-del-stand')) { E.stands = E.stands.filter(x => x !== s); selected = null; save(); render(); }
    else if (s && b.hasAttribute('data-dup-stand')) {
      const c = { ...s, id: uniqueId(s.label, E.stands), x: s.x + (s.w || 20) + 2 };
      E.stands.push(c); selected = { kind: 'stand', id: c.id }; save(); render();
    } else if (s && b.hasAttribute('data-rotate') && s.kind !== 'point') { [s.w, s.h] = [s.h, s.w]; save(); render(); }
    else if (b.hasAttribute('data-unplace-act')) { const a = E.activities.find(x => x.id === selected.id); delete a.x; delete a.y; selected = null; save(); render(); }
  };
  const form = $('#stand-form');
  if (form) form.addEventListener('change', () => {
    const s = E.stands.find(x => x.id === selected.id);
    const fd = new FormData(form);
    s.label = fd.get('label').trim() || s.label;
    const kind = fd.get('kind');
    if (kind !== s.kind) {
      if (kind === 'point') { s.x = Math.round(s.x + (s.w || 0) / 2); s.y = Math.round(s.y + (s.h || 0) / 2); delete s.w; delete s.h; }
      else if (s.kind === 'point') { s.w = 29; s.h = 29; s.x -= 14; s.y -= 14; }
      s.kind = kind;
    }
    for (const k of ['w', 'h', 'x', 'y']) if (fd.has(k) && fd.get(k) !== '') s[k] = Math.round(+fd.get(k));
    save(); render();
  });
}
let lastView = null;

function redrawItem(d) {
  if (d.kind === 'act') { d.g.setAttribute('transform', `translate(${d.item.x} ${d.item.y})`); return; }
  const s = d.item;
  if (s.kind === 'point') { d.g.setAttribute('transform', `translate(${s.x} ${s.y})`); return; }
  const [rect, text, , handle] = [d.g.querySelector('rect'), d.g.querySelector('text'), null, d.g.querySelector('.resize')];
  rect.setAttribute('x', s.x); rect.setAttribute('y', s.y); rect.setAttribute('width', s.w); rect.setAttribute('height', s.h);
  text.setAttribute('x', s.x + s.w / 2); text.setAttribute('y', s.y + s.h / 2 + 4);
  handle.setAttribute('x', s.x + s.w - 7); handle.setAttribute('y', s.y + s.h - 7);
}

// ---------------------------------------------------------------- controle
function issues() {
  const out = [];
  const add = (level, text, goto) => out.push({ level, text, goto });
  if (!E.date) add('warn', 'Er is nog geen datum ingevuld.', 'algemeen');
  for (const s of E.sessions) {
    if (!s.title) add('error', `Workshop zonder titel in ${roomLabel(s.room)} om ${fmt(s.start)}.`, 'programma');
    if (!s.partner && !s.speaker && !s.organisation) add('warn', `“${s.title}” heeft geen spreker of organisatie.`, 'programma');
    if (s.partner && !E.partners.some(p => p.id === s.partner)) add('error', `“${s.title}” verwijst naar een onbekende standhouder.`, 'programma');
    if (!E.rooms.some(r => r.id === s.room)) add('error', `“${s.title}” staat in een zaal die niet meer bestaat.`, 'programma');
    if (toMin(s.end) <= toMin(s.start)) add('error', `“${s.title}” eindigt voordat hij begint.`, 'programma');
  }
  E.sessions.forEach((a, i) => E.sessions.slice(i + 1).forEach(b => {
    if (a.room === b.room && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end))
      add('error', `Dubbele boeking in ${roomLabel(a.room)}: “${a.title}” en “${b.title}”.`, 'programma');
  }));
  const seen = {};
  for (const p of E.partners) {
    if (!p.stand) add('warn', `${p.name} heeft geen standnummer.`, 'partners');
    else if (!standsOfPartner(E, p).length) add('warn', `Stand ${p.stand} (${p.name}) staat niet op de plattegrond.`, 'kaart');
    if (p.stand) (seen[p.stand] ||= []).push(p.name);
  }
  for (const [st, names] of Object.entries(seen)) if (names.length > 1) add('info', `Stand ${st} wordt gedeeld door ${names.join(' en ')}.`, 'partners');
  for (const s of E.stands) if (!partnersAtStand(E, s.label).length) add('warn', `Stand ${s.label} op de kaart heeft geen standhouder.`, 'kaart');
  const labels = {};
  for (const s of E.stands) (labels[s.label] ||= 0), labels[s.label]++;
  for (const [l, n] of Object.entries(labels)) if (n > 1) add('info', `Nummer ${l} staat ${n}× op de kaart (bijv. een extra plein voor dezelfde standhouder).`, 'kaart');
  return out;
}
const roomLabel = id => E.rooms.find(r => r.id === id)?.name || id;

function updateIssueCount() {
  const n = issues().filter(i => i.level !== 'info').length;
  const el = $('#issue-count');
  el.hidden = !n; el.textContent = n;
}

function viewCheck() {
  const list = issues();
  const lbl = { error: 'Fout', warn: 'Let op', info: 'Ter info' };
  return `<div class="ed-split">
    <section class="ed-card ed-grow">
      <h2>Controle</h2>
      <p class="lede">Loop deze lijst na voordat je publiceert.</p>
      ${list.length ? `<ul class="issues">${list.map(i => `<li class="is-${i.level}"><span class="lvl">${lbl[i.level]}</span><span>${esc(i.text)}</span><button type="button" class="link" data-goto="${i.goto}">Open</button></li>`).join('')}</ul>`
        : '<p>Alles ziet er goed uit.</p>'}
      <h3 class="sub">Publiceren</h3>
      <ol class="steps">
        <li>Klik op <b>Download JSON</b>. Je krijgt <code>${esc(E.id)}.json</code>.</li>
        <li>Zet het bestand in de map <code>data/events/</code> van de website (bijv. via GitHub: <i>Add file → Upload files</i>).</li>
        <li>Nieuw festival? Voeg het ook toe aan <code>data/events/index.json</code>.</li>
        <li>De site staat binnen een minuut live op <code>event.html?e=${esc(E.id)}</code>.</li>
      </ol>
    </section>
    <aside class="ed-card ed-side">
      <h2>Ruwe gegevens</h2>
      <p class="muted">Voor gevorderden: pas de JSON direct aan en klik op Toepassen.</p>
      <textarea id="raw" class="raw" spellcheck="false">${esc(JSON.stringify(E, null, 2))}</textarea>
      <div class="actions"><button type="button" class="btn" data-apply-raw>Toepassen</button>
        <button type="button" class="btn danger" data-reset>Concept weggooien</button></div>
      <p id="raw-msg" class="muted"></p>
    </aside></div>`;
}

function bindCheck() {
  let confirmReset = false;
  $('#ed-main').onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.goto) { tab = b.dataset.goto; render(); }
    else if (b.hasAttribute('data-apply-raw')) {
      try { E = JSON.parse($('#raw').value); save('JSON toegepast'); render(); }
      catch (err) { $('#raw-msg').textContent = `Ongeldige JSON: ${err.message}`; }
    } else if (b.hasAttribute('data-reset')) {
      if (!confirmReset) { confirmReset = true; b.textContent = 'Zeker weten? Klik nogmaals'; return; }
      localStorage.removeItem(DRAFT_KEY(E.id));
      await load(E.id);
    }
  };
}
