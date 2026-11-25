// Version history: named and automatic snapshots per document; preview, compare, restore.
import { h, clear, fmtDateTime, plural, download, slug } from '../util.js';
import { modal, confirmDialog, promptDialog, toast, emptyState, menu } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import * as store from '../store.js';
import { docLabel, docWords, migrateProject } from '../model.js';
import { getFormat, typeDef } from '../formats.js';
import { htmlToText, upperSafe } from '../inline.js';
import { layoutScript } from '../paginate.js';
import { renderSheets } from '../preview.js';
import { pickDoc, docPicker } from './common.js';
import { toFountain } from '../io.js';

export async function render(ctx) {
  const { project } = ctx;
  const docs = project.docs;
  const doc = pickDoc(project, ctx.arg, docs);
  ctx.setTitle('Version History');
  const body = h('div.view-inner');
  ctx.view.append(h('div.view-pad.scroll', { style: { flex: 1 } }, body));

  async function paint() {
    const versions = await store.listVersions(project.id, doc.id);
    clear(body);
    body.append(h('div.section-head', h('h2', 'Version History'), docPicker(project, doc, 'versions', docs), h('div.spacer'),
      h('button.btn.sm.primary', { type: 'button', onclick: saveNow }, icon('plus'), 'Save version now')));
    body.append(h('p.small.muted', 'Named versions are kept until you delete them. An automatic snapshot is taken the first time you open a script each day (the last 14 are kept). Versions are stored on this device and included in project backups.'));
    if (!versions.length) { body.append(emptyState('No versions yet', 'Save a version before big rewrites so you can compare or go back.')); return; }
    const list = h('div.ver-list');
    for (const v of versions) {
      list.append(h('div.ver',
        icon(v.auto ? 'versions' : 'check'),
        h('div.grow', h('div', h('b', v.name), v.auto ? h('span.badge', { style: { marginLeft: '6px' } }, 'auto') : null),
          h('div.small.muted', `${fmtDateTime(v.ts)} · ${docWords(v.doc).toLocaleString()} words · ${v.doc.blocks.length} elements`)),
        h('button.btn.sm', { type: 'button', onclick: () => compare(v) }, 'Compare'),
        h('button.btn.sm.hide-sm', { type: 'button', onclick: () => preview(v) }, 'View'),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Version options', onclick: e => menu(e.currentTarget, [
          { label: 'View pages', onClick: () => preview(v) },
          { label: 'Restore this version…', onClick: () => restore(v) },
          { label: 'Restore as a new document', onClick: () => restoreCopy(v) },
          { label: 'Download as Fountain', onClick: () => download(`${slug(v.name)}.fountain`, toFountain(v.doc), 'text/plain') },
          { label: 'Rename…', onClick: async () => { const n = await promptDialog('Version name', v.name); if (n) { v.name = n; v.auto = false; await store.putVersion(v); paint(); } } },
          { sep: true },
          { label: 'Delete', danger: true, onClick: async () => { if (await confirmDialog(`Delete version “${v.name}”?`, { ok: 'Delete', danger: true })) { await store.deleteVersion(v.id); paint(); } } },
        ], { align: 'right' }) }, icon('more'))));
    }
    body.append(list);
  }

  async function saveNow() {
    const name = await promptDialog('Version name', `${docLabel(doc)} draft`, { title: 'Save version' });
    if (name == null) return;
    if (app.beforeClose) app.beforeClose({ soft: true });
    await store.addVersion({ pid: project.id, docId: doc.id, name: name.trim() || 'Untitled version', doc });
    toast('Version saved');
    paint();
  }

  async function preview(v) {
    const L = layoutScript(v.doc, project);
    const sheets = h('div.sheets');
    renderSheets(sheets, L.titlePage ? [L.titlePage, ...L.pages] : L.pages);
    sheets.style.setProperty('--u', Math.min(96, (Math.min(innerWidth, 900) - 56) / 8.5) + 'px');
    await modal({ title: `${v.name}: ${plural(L.pageCount, 'page')}`, wide: true, body: h('div', { style: { background: 'var(--desk)', margin: '0 -20px -16px' } }, sheets), buttons: [{ label: 'Close', primary: true }] });
  }

  async function restore(v) {
    if (!await confirmDialog(`Replace the current “${docLabel(doc)}” with “${v.name}”? The current text is saved as a version first, so you can undo this.`, { title: 'Restore version', ok: 'Restore' })) return;
    if (app.beforeClose) app.beforeClose({ soft: true });
    await store.addVersion({ pid: project.id, docId: doc.id, name: `Before restoring “${v.name}”`, doc });
    const old = JSON.parse(JSON.stringify(v.doc));
    doc.blocks = old.blocks;
    doc.tp = old.tp;
    doc.comments = old.comments || [];
    doc.rev = old.rev || { list: [], active: null };
    doc.locked = !!old.locked;
    migrateProject(project);
    app.markDirty();
    toast('Version restored');
    paint();
  }

  function restoreCopy(v) {
    const c = JSON.parse(JSON.stringify(v.doc));
    c.id = 'd' + Math.random().toString(36).slice(2, 10);
    c.title = `${doc.title} (${v.name})`;
    project.docs.push(c);
    migrateProject(project);
    app.markDirty();
    ctx.refreshSidebar();
    toast('Restored as a new document');
  }

  function compare(v) {
    if (app.beforeClose) app.beforeClose({ soft: true });
    const fmt = getFormat(doc.fmt);
    const textOf = b => {
      if (doc.kind === 'av') return `${htmlToText(b.v)}  |  ${htmlToText(b.a)}`;
      const t = htmlToText(b.h);
      return typeDef(fmt, b.t).caps ? upperSafe(t) : t;
    };
    const oldMap = new Map(v.doc.blocks.map((b, i) => [b.id, { b, i }]));
    const curIds = new Set(doc.blocks.map(b => b.id));
    const rows = [];
    let added = 0, removed = 0, changed = 0;
    // Walk the current document; insert removed blocks where they used to be.
    const removedBefore = new Map();
    let lastKept = -1;
    v.doc.blocks.forEach((b, i) => { if (!curIds.has(b.id)) { const k = lastKept; if (!removedBefore.has(k)) removedBefore.set(k, []); removedBefore.get(k).push(b); } else lastKept = i; });
    const pushRemoved = k => { for (const b of removedBefore.get(k) || []) { rows.push(h('div.diff-row.diff-del', textOf(b) || ' ')); removed++; } };
    pushRemoved(-1);
    for (const b of doc.blocks) {
      const o = oldMap.get(b.id);
      if (!o) { rows.push(h('div.diff-row.diff-add', textOf(b) || ' ')); added++; }
      else if (o.b.h !== b.h || o.b.t !== b.t || o.b.v !== b.v || o.b.a !== b.a) {
        rows.push(h('div.diff-row.diff-del', textOf(o.b) || ' '), h('div.diff-row.diff-add', textOf(b) || ' ')); changed++;
      } else rows.push(h('div.diff-row', { style: { color: 'var(--muted)' } }, textOf(b) || ' '));
      if (o) pushRemoved(o.i);
    }
    const onlyChanges = h('input', { type: 'checkbox' });
    const list = h('div', rows);
    onlyChanges.addEventListener('change', () => { for (const r of rows) if (!r.classList.contains('diff-add') && !r.classList.contains('diff-del')) r.style.display = onlyChanges.checked ? 'none' : ''; });
    modal({
      title: `Compare “${v.name}” with current`, wide: true,
      body: h('div', h('div.row.wrap', { style: { marginBottom: '10px' } },
        h('span.badge', { style: { background: 'rgba(47,138,74,.18)', color: 'var(--ok)' } }, `${added} added`),
        h('span.badge', { style: { background: 'rgba(196,53,43,.15)', color: 'var(--danger)' } }, `${removed} removed`),
        h('span.badge', { style: { background: 'rgba(183,121,31,.18)', color: 'var(--warn)' } }, `${changed} changed`),
        h('div.spacer'), h('label.check.small', onlyChanges, 'Only show changes')), list),
      buttons: [{ label: 'Restore this version…', onClick: () => { restore(v); return true; } }, { label: 'Close', primary: true }],
    });
  }

  await paint();
  return { cleanup() {} };
}
