// Shot list, grouped by scene. Shots are shared with the storyboard.
import { h, clear, uid, download, slug, toCSV } from '../util.js';
import { menu, confirmDialog, emptyState, toast } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import { getScenes, docLabel } from '../model.js';
import { pickDoc, docPicker, sceneTitle, noScripts } from './common.js';
import { printHTML } from '../preview.js';

export const SIZES = ['', 'ECU', 'CU', 'MCU', 'MS', 'MLS', 'FS', 'WS', 'EWS', 'Two Shot', 'OTS', 'POV', 'Insert', 'Establishing', 'Aerial'];
export const ANGLES = ['', 'Eye Level', 'High', 'Low', 'Overhead', "Bird's Eye", "Worm's Eye", 'Dutch', 'Shoulder', 'Hip'];
export const MOVES = ['', 'Static', 'Pan', 'Tilt', 'Dolly In', 'Dolly Out', 'Truck', 'Pedestal', 'Zoom', 'Push In', 'Pull Out', 'Handheld', 'Steadicam', 'Gimbal', 'Crane / Jib', 'Drone', 'Tracking', 'Whip Pan'];
export const SOUND = ['Sync', 'MOS', 'VO', 'Playback', 'Wild'];

export function shotNumber(scene, i) {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return `${scene.num}${i < 26 ? L[i] : L[Math.floor(i / 26) - 1] + L[i % 26]}`;
}

export function shotsFor(project, doc, sceneId) {
  return project.shots.filter(s => s.docId === doc.id && s.sceneId === sceneId);
}

export function newShot(doc, sceneId) {
  return { id: uid('s'), docId: doc.id, sceneId, size: '', angle: '', move: '', lens: '', desc: '', subj: '', dur: '', sound: 'Sync', done: false, notes: '', img: null };
}

export function render(ctx) {
  const { project } = ctx;
  const doc = pickDoc(project, ctx.arg);
  ctx.setTitle('Shot List');
  if (!doc) return noScripts(ctx.view, project, 'shot');
  let only = '';
  const body = h('div.view-inner');
  ctx.view.append(h('div.view-pad.scroll', { style: { flex: 1 } }, body));

  function paint() {
    clear(body);
    const scenes = getScenes(doc);
    const sceneSel = h('select.input', { style: { maxWidth: '280px' }, onchange: () => { only = sceneSel.value; paint(); } },
      h('option', { value: '' }, 'All scenes'), scenes.map(s => h('option', { value: s.id }, `${s.num}. ${sceneTitle(s)}`)));
    sceneSel.value = only;
    const all = project.shots.filter(s => s.docId === doc.id);
    const secs = all.reduce((a, s) => a + (+s.dur || 0), 0);
    body.append(h('div.section-head', h('h2', 'Shot List'), docPicker(project, doc, 'shots'), sceneSel, h('div.spacer'),
      h('span.small.muted', `${all.length} shots · ${all.filter(s => s.done).length} done · ~${Math.round(secs / 60)} min screen time`),
      h('button.btn.sm', { type: 'button', onclick: exportCSV }, icon('download'), 'CSV'),
      h('button.btn.sm', { type: 'button', onclick: print }, icon('print'), 'Print')));
    if (!scenes.length) { body.append(emptyState('No scenes yet', 'Add scene headings to your script, then plan shots for each scene.')); return; }
    const table = h('table.tbl');
    table.append(h('thead', h('tr', ['', 'Shot', 'Size', 'Angle', 'Movement', 'Lens', 'Description', 'Subjects', 'Sec', 'Sound', 'Done', ''].map(t => h('th', t)))));
    const tb = h('tbody');
    for (const s of scenes) {
      if (only && s.id !== only) continue;
      const shots = shotsFor(project, doc, s.id);
      tb.append(h('tr.group', h('td', { colspan: 12 }, h('div.row', h('span.scene-cell', `${s.num}. ${sceneTitle(s)}`), h('div.spacer'),
        h('button.btn.sm', { type: 'button', onclick: () => { project.shots.push(newShot(doc, s.id)); app.markDirty(); paint(); focusLast(s.id); } }, icon('plus'), 'Shot')))));
      shots.forEach((sh, i) => tb.append(row(s, sh, i, shots)));
    }
    const orphans = project.shots.filter(x => x.docId === doc.id && !scenes.some(s => s.id === x.sceneId));
    if (orphans.length) {
      tb.append(h('tr.group', h('td', { colspan: 12 }, `Shots whose scene was deleted (${orphans.length})`)));
      orphans.forEach((sh, i) => tb.append(row({ num: '?', id: sh.sceneId }, sh, i, orphans)));
    }
    table.append(tb);
    body.append(h('div.tbl-wrap', table));
  }

  function focusLast(sceneId) {
    const rows = body.querySelectorAll(`tr[data-scene="${sceneId}"]`);
    const r = rows[rows.length - 1];
    if (r) r.querySelector('textarea')?.focus();
  }

  function sel(sh, key, opts) {
    const s = h('select.input', opts.map(o => h('option', { value: o }, o || '—')));
    s.value = sh[key] || '';
    s.addEventListener('change', () => { sh[key] = s.value; app.markDirty(); });
    return s;
  }
  function inp(sh, key, attrs = {}) {
    const i = h('input.input', attrs);
    i.value = sh[key] ?? '';
    i.addEventListener('input', () => { sh[key] = i.value; app.markDirty(); });
    return i;
  }
  function area(sh, key, ph) {
    const t = h('textarea.input', { rows: 1, placeholder: ph, style: { minWidth: '220px' } });
    t.value = sh[key] || '';
    t.addEventListener('input', () => { sh[key] = t.value; app.markDirty(); });
    return t;
  }

  function row(s, sh, i, list) {
    const done = h('input', { type: 'checkbox', checked: !!sh.done, 'aria-label': 'Shot done', onchange: e => { sh.done = e.target.checked; app.markDirty(); } });
    return h('tr', { dataset: { scene: s.id } },
      h('td', h('span.small.muted', i + 1)),
      h('td', { style: { fontFamily: 'var(--mono)', fontWeight: 700, whiteSpace: 'nowrap' } }, sh.num || shotNumber(s, i)),
      h('td', sel(sh, 'size', SIZES)), h('td', sel(sh, 'angle', ANGLES)), h('td', sel(sh, 'move', MOVES)),
      h('td', inp(sh, 'lens', { placeholder: '35mm', style: { width: '70px' } })),
      h('td', area(sh, 'desc', 'What we see')),
      h('td', inp(sh, 'subj', { placeholder: 'Who / what', style: { width: '120px' } })),
      h('td', inp(sh, 'dur', { type: 'number', min: 0, style: { width: '64px' } })),
      h('td', sel(sh, 'sound', SOUND)),
      h('td', done),
      h('td', h('button.icon-btn', { type: 'button', 'aria-label': 'Shot options', onclick: e => shotMenu(sh, list, e.currentTarget) }, icon('more'))));
  }

  function shotMenu(sh, list, anchor) {
    const idx = project.shots.indexOf(sh);
    const li = list.indexOf(sh);
    const swap = (other) => { const j = project.shots.indexOf(other); [project.shots[idx], project.shots[j]] = [project.shots[j], project.shots[idx]]; app.markDirty(); paint(); };
    menu(anchor, [
      { label: 'Move up', disabled: li === 0, onClick: () => swap(list[li - 1]) },
      { label: 'Move down', disabled: li === list.length - 1, onClick: () => swap(list[li + 1]) },
      { label: 'Duplicate', onClick: () => { project.shots.splice(idx + 1, 0, { ...sh, id: uid('s'), img: null, done: false }); app.markDirty(); paint(); } },
      { label: 'Custom shot number…', onClick: async () => { const { promptDialog } = await import('../ui.js'); const v = await promptDialog('Shot number (blank for automatic)', sh.num || ''); if (v != null) { sh.num = v.trim(); app.markDirty(); paint(); } } },
      { label: 'Open storyboard', onClick: () => app.go(`#/p/${project.id}/storyboard/${doc.id}`) },
      { sep: true },
      { label: 'Delete shot', danger: true, onClick: async () => {
        if (sh.img && !await confirmDialog('This shot has a storyboard image. Delete both?', { ok: 'Delete', danger: true })) return;
        project.shots.splice(idx, 1);
        if (sh.img) (await import('../store.js')).deleteImage(sh.img);
        app.markDirty(); paint();
      } },
    ]);
  }

  function rowsForExport() {
    const out = [['Scene', 'Heading', 'Shot', 'Size', 'Angle', 'Movement', 'Lens', 'Description', 'Subjects', 'Seconds', 'Sound', 'Done', 'Notes']];
    for (const s of getScenes(doc)) shotsFor(project, doc, s.id).forEach((sh, i) =>
      out.push([s.num, s.text, sh.num || shotNumber(s, i), sh.size, sh.angle, sh.move, sh.lens, sh.desc, sh.subj, sh.dur, sh.sound, sh.done ? 'yes' : '', sh.notes]));
    return out;
  }
  function exportCSV() { download(`${slug(docLabel(doc))}-shot-list.csv`, toCSV(rowsForExport()), 'text/csv'); }
  function print() {
    const rows = rowsForExport();
    const t = h('table.tbl', h('thead', h('tr', rows[0].map(c => h('th', c)))), h('tbody', rows.slice(1).map(r => h('tr', r.map(c => h('td', String(c ?? '')))))));
    printHTML(h('div', h('h2', { style: { margin: '0 0 10px' } }, `${project.title}: ${docLabel(doc)} shot list`), t), { title: 'Shot list', landscape: true });
  }

  paint();
  return { cleanup() {} };
}
