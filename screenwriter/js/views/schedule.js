// Stripboard schedule. One sortable list: scheduled strips, then the boneyard of unscheduled scenes.
import { h, clear, uid, sortable, fmtEighths, fmtDate, isoDate, download, slug, toCSV } from '../util.js';
import { menu, modal, field, confirmDialog, toast, emptyState, promptDialog, checkInput } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import { syncCatalog, docLabel } from '../model.js';
import { stripColor } from '../formats.js';
import { sceneIndex, computeDays, dayOutOfDays, stripKey } from '../production.js';
import { productionDocs } from './common.js';
import { printHTML } from '../preview.js';

export function render(ctx) {
  const { project } = ctx;
  ctx.setTitle('Schedule');
  if (!productionDocs(project).length) { ctx.view.append(h('div.view-pad', emptyState('Nothing to schedule', 'Add a screenplay, stage play, audio drama or AV script first.'))); return; }
  if (syncCatalog(project)) app.markDirty();
  const sch = project.schedule;
  let tab = 'board';
  const body = h('div.view-inner');
  const scroll = h('div.view-pad.scroll', { style: { flex: 1 } }, body);
  ctx.view.append(scroll);

  function paint() {
    const index = sceneIndex(project);
    // Drop strips whose scene no longer exists.
    const before = sch.strips.length;
    sch.strips = sch.strips.filter(st => st.k !== 'scene' || index.has(stripKey(st)));
    if (sch.strips.length !== before) app.markDirty();
    const { days, scheduledKeys } = computeDays(project, index);
    const unscheduled = Array.from(index.values()).filter(s => !scheduledKeys.has(s.key));
    clear(body);
    const start = h('input.input', { type: 'date', value: sch.start || '', style: { width: 'auto' }, onchange: () => { sch.start = start.value; app.markDirty(); paint(); } });
    body.append(h('div.section-head', h('h2', 'Schedule'),
      h('div.row', { role: 'group' },
        h('button.btn.sm' + (tab === 'board' ? '.primary' : ''), { type: 'button', onclick: () => { tab = 'board'; paint(); } }, 'Stripboard'),
        h('button.btn.sm' + (tab === 'dood' ? '.primary' : ''), { type: 'button', onclick: () => { tab = 'dood'; paint(); } }, 'Day Out of Days')),
      h('div.spacer'),
      h('label.row.small', 'First shoot day', start),
      checkInput(sch, 'skipWeekends', 'Skip weekends', { onChange: () => { app.markDirty(); paint(); } })));
    if (tab === 'dood') return paintDood(days);

    const totalE = Array.from(index.values()).reduce((a, s) => a + s.eighths, 0);
    const schedE = days.reduce((a, d) => a + d.eighths, 0);
    body.append(h('div.row.wrap', { style: { marginBottom: '12px' } },
      h('button.btn.sm.primary', { type: 'button', onclick: () => { sch.strips.push({ k: 'day', id: uid('x') }); app.markDirty(); paint(); } }, icon('plus'), 'End of day'),
      h('button.btn.sm', { type: 'button', onclick: addBanner }, icon('plus'), 'Banner'),
      h('button.btn.sm', { type: 'button', onclick: autoSchedule }, icon('wand'), 'Auto-schedule…'),
      h('button.btn.sm', { type: 'button', onclick: () => printBoard(days) }, icon('print'), 'Print'),
      h('button.btn.sm', { type: 'button', onclick: () => exportCSV(days) }, icon('download'), 'CSV'),
      h('button.btn.sm.ghost', { type: 'button', onclick: async () => { if (await confirmDialog('Move every scene back to the boneyard and remove all day breaks and banners?', { ok: 'Clear schedule', danger: true })) { sch.strips = []; app.markDirty(); paint(); } } }, 'Clear'),
      h('div.spacer'),
      h('span.small.muted', `${days.length} shoot days · ${fmtEighths(schedE)} of ${fmtEighths(totalE)} pages scheduled`)));

    const list = h('div.strips');
    let dayN = 0;
    for (const st of sch.strips) {
      if (st.k === 'scene') list.append(sceneStrip(index.get(stripKey(st)), st));
      else if (st.k === 'day') { const d = days.find(x => x.id === st.id) || days[dayN]; dayN++; list.append(dayStrip(st, d, dayN)); }
      else if (st.k === 'banner') list.append(bannerStrip(st));
    }
    list.append(h('div.strip.boneyard', { dataset: { k: 'boneyard' } }, `Boneyard: unscheduled scenes (${unscheduled.length}). Drag strips above this line to schedule them.`));
    for (const s of unscheduled) list.append(sceneStrip(s, null));
    const castLegend = project.catalog.filter(c => c.cat === 'cast' && c.n).sort((a, b) => a.n - b.n);
    body.append(h('div.sched-layout', h('div', list),
      h('div.card.card-pad', h('b', 'Cast IDs'), h('div', { style: { marginTop: '6px', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: '13px' } },
        castLegend.length ? castLegend.flatMap(c => [h('span', { style: { fontFamily: 'var(--mono)', fontWeight: 700 } }, c.n), h('span', c.name)]) : h('span.small.muted', 'No characters yet')),
        h('p.small.muted', { style: { marginTop: '12px' } }, 'Strip colors: white = INT day, yellow = EXT day, blue = INT night, green = EXT night. Change cast ID numbers in the Catalog.'))));
    sortable(list, { items: '.strip', handle: '.grip', scroller: scroll, onEnd: () => rebuildFromDOM(list) });
  }

  function rebuildFromDOM(list) {
    const strips = [];
    for (const el of list.children) {
      if (el.dataset.k === 'boneyard') break;
      if (el._strip) strips.push(el._strip);
    }
    sch.strips = strips;
    app.markDirty();
    paint();
  }

  function sceneStrip(s, st) {
    if (!s) return h('div');
    const strip = st || { k: 'scene', docId: s.doc.id, sceneId: s.id };
    const el = h('div.strip.' + stripColor(s.ie, s.dn),
      h('span.grip', { title: 'Drag', 'aria-label': 'Drag strip' }, icon('grip')),
      h('b', { style: { fontFamily: 'var(--mono)' } }, s.label),
      h('span.scene-cell', { title: s.text }, `${s.ie ? s.ie + '. ' : ''}${s.loc || s.text}`),
      h('span.ellipsis', { style: { fontWeight: 600 }, title: s.tod }, s.dn || ''),
      h('span', { title: 'Pages in eighths' }, fmtEighths(s.eighths)),
      h('span.cast-ids', { title: s.cast.map(c => c.name).join(', ') }, s.cast.map(c => c.n).filter(Boolean).join(', ')));
    el._strip = strip;
    el.addEventListener('dblclick', () => { app.pendingScene = s.id; app.go(`#/p/${project.id}/breakdown/${s.doc.id}`); });
    return el;
  }

  function dayStrip(st, d, n) {
    const el = h('div.strip.day',
      h('span.grip', { title: 'Drag', 'aria-label': 'Drag day break' }, icon('grip')),
      h('span', `End of Day ${n}`, d ? ` · ${fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtEighths(d.eighths)} pgs · ${d.scenes.length} scenes` : ''),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Remove day break', onclick: () => { sch.strips = sch.strips.filter(x => x !== st); app.markDirty(); paint(); } }, icon('close')));
    el._strip = st;
    return el;
  }

  function bannerStrip(st) {
    const el = h('div.strip.banner', { style: { background: st.color || '#ffd6e7' } },
      h('span.grip', { title: 'Drag', 'aria-label': 'Drag banner' }, icon('grip')),
      h('span', st.text || 'Banner'),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Banner options', onclick: e => menu(e.currentTarget, [
        { label: 'Edit text…', onClick: async () => { const v = await promptDialog('Banner text', st.text); if (v != null) { st.text = v; app.markDirty(); paint(); } } },
        ...['#ffd6e7', '#cfe2ff', '#d4f5d0', '#fff3b0', '#e9d8fd'].map(c => ({ label: 'Color', swatch: c, checked: st.color === c, onClick: () => { st.color = c; app.markDirty(); paint(); } })),
        { label: 'Remove', danger: true, onClick: () => { sch.strips = sch.strips.filter(x => x !== st); app.markDirty(); paint(); } },
      ]) }, icon('more')));
    el._strip = st;
    return el;
  }

  async function addBanner() {
    const v = await promptDialog('Banner text (e.g. “Company move” or “Night shoots”)', '', { title: 'Add banner' });
    if (!v) return;
    sch.strips.push({ k: 'banner', id: uid('x'), text: v, color: '#ffd6e7' });
    app.markDirty();
    paint();
  }

  async function autoSchedule() {
    const maxPages = h('input.input', { type: 'number', min: 1, step: 0.5, value: project.schedule.pagesPerDay || 5 });
    const groupLoc = h('input', { type: 'checkbox', checked: true });
    const groupIE = h('input', { type: 'checkbox', checked: true });
    const groupDN = h('input', { type: 'checkbox', checked: true });
    const onlyUn = h('input', { type: 'checkbox', checked: false });
    const res = await modal({
      title: 'Auto-schedule',
      body: h('div.form',
        h('p', 'Groups scenes that share a location and lighting so each day stays at one place, then splits them into days by page count. You can drag strips afterwards.'),
        field('Maximum pages per day', maxPages),
        h('label.check', groupLoc, 'Group by location'), h('label.check', groupIE, 'Group interiors and exteriors'), h('label.check', groupDN, 'Group day and night'),
        h('label.check', onlyUn, 'Keep the current schedule and only add unscheduled scenes')),
      buttons: [{ label: 'Cancel' }, { label: 'Build schedule', primary: true, value: true }],
    });
    if (!res) return;
    const cap = Math.max(1, +maxPages.value || 5) * 8;
    project.schedule.pagesPerDay = +maxPages.value || 5;
    const index = sceneIndex(project);
    const { scheduledKeys } = computeDays(project, index);
    const scenes = Array.from(index.values()).filter(s => !s.omit && (!onlyUn.checked || !scheduledKeys.has(s.key)));
    const keyOf = s => [groupLoc.checked ? s.loc : '', groupIE.checked ? (/EXT/.test(s.ie) ? 'EXT' : 'INT') : '', groupDN.checked ? (/NIGHT|DUSK|EVENING/.test(s.dn) ? 'N' : 'D') : ''].join('|');
    const groups = new Map();
    for (const s of scenes) { const k = keyOf(s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
    const ordered = Array.from(groups.values()).sort((a, b) => b.reduce((x, s) => x + s.eighths, 0) - a.reduce((x, s) => x + s.eighths, 0));
    const strips = onlyUn.checked ? sch.strips.slice() : [];
    if (onlyUn.checked && strips.length && strips[strips.length - 1].k !== 'day') strips.push({ k: 'day', id: uid('x') });
    let used = 0;
    for (const g of ordered) {
      for (const s of g) {
        if (used > 0 && used + s.eighths > cap) { strips.push({ k: 'day', id: uid('x') }); used = 0; }
        strips.push({ k: 'scene', docId: s.doc.id, sceneId: s.id });
        used += s.eighths;
      }
    }
    if (used > 0) strips.push({ k: 'day', id: uid('x') });
    sch.strips = strips;
    app.markDirty();
    paint();
    toast('Schedule built');
  }

  function paintDood(days) {
    const rows = dayOutOfDays(project, days);
    if (!days.length) { body.append(emptyState('No shoot days yet', 'Add day breaks on the stripboard to see who works when.')); return; }
    const t = h('table.tbl.dood',
      h('thead', h('tr', h('th', 'Cast'), days.map(d => h('th', h('div', `Day ${d.n}`), h('div.small', fmtDate(d.date, { month: 'numeric', day: 'numeric' })))), h('th', 'Work'), h('th', 'Hold'), h('th', 'Start'), h('th', 'Finish'))),
      h('tbody', rows.map(r => h('tr', h('td', `${r.item.n || ''}. ${r.item.name}`), r.codes.map(c => h('td' + (c === 'H' ? '.h' : c ? '.w' : ''), c)), h('td', r.work), h('td', r.hold), h('td', fmtDate(r.start, { month: 'numeric', day: 'numeric' })), h('td', fmtDate(r.finish, { month: 'numeric', day: 'numeric' }))))));
    body.append(h('p.small.muted', 'SW = start work, W = work, WF = work finish, SWF = start-work-finish (one day), H = hold (paid but not working).'),
      h('div.tbl-wrap', t),
      h('div.row', { style: { marginTop: '10px' } },
        h('button.btn.sm', { type: 'button', onclick: () => download(`${slug(project.title)}-day-out-of-days.csv`, toCSV([['Cast', ...days.map(d => `Day ${d.n} ${isoDate(d.date)}`), 'Work', 'Hold'], ...rows.map(r => [r.item.name, ...r.codes, r.work, r.hold])]), 'text/csv') }, icon('download'), 'CSV'),
        h('button.btn.sm', { type: 'button', onclick: () => printHTML(h('div', h('h2', `${project.title}: Day Out of Days`), t.cloneNode(true)), { title: 'Day Out of Days', landscape: true }) }, icon('print'), 'Print')));
  }

  function printBoard(days) {
    const wrap = h('div', h('h2', { style: { margin: '0 0 8px' } }, `${project.title}: Shooting schedule`));
    for (const d of days) {
      wrap.append(h('h3', { style: { margin: '14px 0 4px' } }, `Day ${d.n}: ${fmtDate(d.date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${fmtEighths(d.eighths)} pages)`));
      for (const b of d.banners) wrap.append(h('div', { style: { fontWeight: 700, background: '#eee', padding: '2px 6px' } }, b.text));
      wrap.append(h('table.tbl', h('thead', h('tr', ['Scene', 'I/E', 'Set', 'D/N', 'Pages', 'Cast', 'Synopsis'].map(x => h('th', x)))),
        h('tbody', d.scenes.map(s => h('tr', h('td', s.label), h('td', s.ie), h('td', s.loc || s.text), h('td', s.dn), h('td', fmtEighths(s.eighths)), h('td', s.cast.map(c => c.n).join(', ')), h('td', s.syn))))));
    }
    printHTML(wrap, { title: 'Shooting schedule', landscape: true });
  }

  function exportCSV(days) {
    const rows = [['Day', 'Date', 'Scene', 'Int/Ext', 'Set', 'Day/Night', 'Pages (8ths)', 'Cast IDs', 'Synopsis', 'Script']];
    for (const d of days) for (const s of d.scenes) rows.push([d.n, isoDate(d.date), s.label, s.ie, s.loc || s.text, s.tod, s.eighths, s.cast.map(c => c.n).join(' '), s.syn, docLabel(s.doc)]);
    download(`${slug(project.title)}-schedule.csv`, toCSV(rows), 'text/csv');
  }

  paint();
  return { cleanup() {} };
}
