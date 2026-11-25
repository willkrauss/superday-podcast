// Project shell: sidebar (documents + tools), top bar, view host.
import { h, clear, download, slug, pickFile, readFile } from '../util.js';
import { menu, promptDialog, confirmDialog, toast, modal, field } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import * as store from '../store.js';
import { newDoc, docLabel, PROJECT_TYPES, convertDoc, migrateProject } from '../model.js';
import { FORMATS } from '../formats.js';
import { parseScriptFile } from '../io.js';

const VIEWS = {
  script: () => import('./script.js'),
  cards: () => import('./cards.js'),
  board: () => import('./board.js'),
  catalog: () => import('./catalog.js'),
  breakdown: () => import('./breakdown.js'),
  shots: () => import('./shots.js'),
  storyboard: () => import('./storyboard.js'),
  schedule: () => import('./schedule.js'),
  callsheets: () => import('./callsheet.js'),
  budget: () => import('./budget.js'),
  contacts: () => import('./contacts.js'),
  reports: () => import('./reports.js'),
  versions: () => import('./versions.js'),
  settings: () => import('./settings.js'),
};

const SECTIONS = [
  ['Story', [['cards', 'Index Cards & Outline', 'cards'], ['board', 'Beat Board', 'board']]],
  ['Prep', [['catalog', 'Catalog', 'catalog'], ['breakdown', 'Breakdown', 'breakdown'], ['shots', 'Shot List', 'shots'], ['storyboard', 'Storyboard', 'storyboard']]],
  ['Production', [['schedule', 'Schedule', 'schedule'], ['callsheets', 'Call Sheets', 'callsheet'], ['budget', 'Budget', 'budget'], ['contacts', 'Cast & Crew', 'contacts']]],
  ['Review', [['reports', 'Reports', 'reports'], ['versions', 'Version History', 'versions']]],
];

export function renderProject(root) {
  const shell = h('div.shell');
  const sbBody = h('div.sb-body');
  const sbTitle = h('div.sb-title.ellipsis.grow', { title: 'Rename project', onclick: () => renameProject() });
  const sidebar = h('nav.sidebar', { 'aria-label': 'Project' },
    h('div.sb-head',
      h('button.icon-btn', { type: 'button', title: 'All projects', 'aria-label': 'All projects', onclick: () => app.go('#/') }, icon('back')),
      sbTitle,
      h('button.icon-btn', { type: 'button', title: 'Project menu', 'aria-label': 'Project menu', onclick: e => projectMenu(e.currentTarget) }, icon('more'))),
    sbBody);
  const backdrop = h('div.sb-backdrop', { onclick: () => shell.classList.remove('nav-open') });
  const titleEl = h('h1');
  const tbSlot = h('div.row.grow', { style: { minWidth: 0, justifyContent: 'flex-end' } });
  const saveEl = h('span.save-state', { 'aria-live': 'polite' });
  const topbar = h('header.topbar',
    h('button.icon-btn.menu-toggle', { type: 'button', 'aria-label': 'Open navigation', onclick: () => shell.classList.add('nav-open') }, icon('menu')),
    titleEl, tbSlot, saveEl);
  const viewEl = h('div.view');
  shell.append(sidebar, backdrop, h('main.main', topbar, viewEl));
  root.appendChild(shell);

  let cleanupView = null;
  let cur = { tool: '', arg: '' };
  let showToken = 0;

  const paintSave = s => {
    saveEl.className = 'save-state' + (s === 'error' ? ' err' : '');
    saveEl.textContent = s === 'saving' ? 'Saving…' : s === 'dirty' ? 'Edited' : s === 'error' ? 'Not saved!' : 'Saved';
  };
  const unsub = app.onSaveState(paintSave);
  paintSave(app.saveState);

  app.externalChange = async () => {
    const ok = await confirmDialog('This project was just saved from another tab or window. Reload it here to avoid overwriting those changes?', { title: 'Changed elsewhere', ok: 'Reload' });
    if (ok) { const id = app.project.id; app.project = null; location.reload(); }
  };

  function project() { return app.project; }

  function paintSidebar() {
    const p = project();
    sbTitle.textContent = p.title;
    clear(sbBody);
    const docs = p.docs;
    const pt = PROJECT_TYPES[p.type] || PROJECT_TYPES.film;
    const addBtn = h('button.icon-btn', { type: 'button', title: 'Add document', 'aria-label': 'Add document', onclick: e => addDocMenu(e.currentTarget) }, icon('plus'));
    sbBody.append(h('div.sb-label', pt.episodic ? 'Episodes & Documents' : 'Documents', addBtn));
    for (const d of docs) {
      const active = cur.tool === 'script' && cur.arg === d.id;
      const more = h('button.icon-btn.sb-more', { type: 'button', 'aria-label': 'Document options', onclick: e => { e.stopPropagation(); docMenu(d, e.currentTarget); } }, icon('more'));
      sbBody.append(h('button.sb-item' + (active ? '.active' : ''), { type: 'button', onclick: () => app.go(`#/p/${p.id}/script/${d.id}`) },
        icon(d.kind === 'av' ? 'av' : d.kind === 'text' ? 'doc' : 'script'),
        h('span.grow', h('div.ellipsis', docLabel(d)), h('div.sb-doc-sub', (d.kind === 'text' ? 'Document' : d.kind === 'av' ? 'AV script' : (FORMATS[d.fmt] || {}).label) + (d.pages ? ` · ${d.pages} pp` : ''))),
        more));
    }
    const hideProd = p.type === 'comic';
    for (const [label, items] of SECTIONS) {
      if (hideProd && label === 'Production') continue;
      const sec = h('div.sb-section', h('div.sb-label', label));
      for (const [id, text, ic] of items) {
        if (hideProd && (id === 'breakdown' || id === 'shots')) continue;
        sec.append(h('button.sb-item' + (cur.tool === id ? '.active' : ''), { type: 'button', onclick: () => app.go(`#/p/${p.id}/${id}`) }, icon(ic), h('span', text)));
      }
      sbBody.append(sec);
    }
    sbBody.append(h('div.sb-section', h('button.sb-item' + (cur.tool === 'settings' ? '.active' : ''), { type: 'button', onclick: () => app.go(`#/p/${p.id}/settings`) }, icon('settings'), h('span', 'Project Settings'))));
  }

  async function renameProject() {
    const p = project();
    const v = await promptDialog('Project title', p.title, { title: 'Rename project' });
    if (!v || !v.trim()) return;
    p.title = v.trim();
    app.markDirty();
    paintSidebar();
  }

  function projectMenu(anchor) {
    const p = project();
    menu(anchor, [
      { label: 'Rename project', onClick: renameProject },
      { label: 'Export project backup (.json)', onClick: async () => {
        await app.saveNow();
        const bundle = await store.exportBundle(p);
        download(`${slug(p.title)}.reelwright.json`, JSON.stringify(bundle), 'application/json');
      } },
      { label: 'Import script into this project…', onClick: importIntoProject },
      { sep: true },
      { label: 'All projects', onClick: () => app.go('#/') },
    ]);
  }

  function addDocMenu(anchor) {
    const p = project();
    const pt = PROJECT_TYPES[p.type] || PROJECT_TYPES.film;
    const mainFmt = pt.fmt;
    const items = [];
    if (pt.episodic) items.push({ label: 'New episode', onClick: () => addDoc({ kind: 'script', fmt: mainFmt }) });
    items.push({ heading: 'Scripts' });
    for (const [id, f] of Object.entries(FORMATS)) {
      if (id === 'text') continue;
      items.push({ label: `New ${f.label.toLowerCase()}`, onClick: () => addDoc({ kind: 'script', fmt: id }) });
    }
    items.push({ label: 'New AV (two-column) script', onClick: () => addDoc({ kind: 'av', fmt: 'av' }) });
    items.push({ heading: 'Documents' });
    items.push({ label: 'New text document (treatment, bible, notes)', onClick: () => addDoc({ kind: 'text', fmt: 'text' }) });
    items.push({ sep: true });
    items.push({ label: 'Import script file…', onClick: importIntoProject });
    menu(anchor, items);
  }

  async function addDoc({ kind, fmt }) {
    const p = project();
    const pt = PROJECT_TYPES[p.type] || PROJECT_TYPES.film;
    const episodic = pt.episodic && kind === 'script' && fmt === pt.fmt;
    const nextEp = episodic ? Math.max(0, ...p.docs.map(d => +d.ep || 0)) + 1 : null;
    const dflt = episodic ? `Episode ${nextEp}` : kind === 'text' ? 'Treatment' : kind === 'av' ? 'Video script' : (FORMATS[fmt] || {}).label || 'Script';
    const title = await promptDialog(episodic ? 'Episode title' : 'Title', dflt, { title: episodic ? 'New episode' : 'New document' });
    if (title == null) return;
    const d = newDoc({ kind, fmt, title: title.trim() || dflt, ep: nextEp, author: p.author || app.prefs.author });
    d.tp.title = episodic ? `${p.title}\n"${d.title}"` : d.title;
    p.docs.push(d);
    app.markDirty();
    app.go(`#/p/${p.id}/script/${d.id}`);
  }

  async function importIntoProject() {
    const p = project();
    const files = await pickFile('.fountain,.fdx,.txt,.spmd,text/plain', true);
    let last = null;
    for (const f of files) {
      try {
        const text = await readFile(f);
        const pt = PROJECT_TYPES[p.type] || PROJECT_TYPES.film;
        const fmt = pt.fmt === 'av' ? 'screenplay' : pt.fmt;
        const parsed = parseScriptFile(f.name, text, fmt);
        const d = newDoc({ kind: 'script', fmt, title: (parsed.tp.title || f.name.replace(/\.[^.]+$/, '')).split('\n')[0] });
        d.blocks = parsed.blocks;
        d.tp = { ...d.tp, ...parsed.tp };
        d.locked = !!parsed.locked;
        if (pt.episodic) d.ep = Math.max(0, ...p.docs.map(x => +x.ep || 0)) + 1;
        p.docs.push(d);
        last = d;
        toast(`Imported “${d.title}” (${parsed.source})`);
      } catch (e) { toast(`Could not import ${f.name}: ${e.message}`, { kind: 'error' }); }
    }
    if (last) { migrateProject(p); app.markDirty(); app.go(`#/p/${p.id}/script/${last.id}`); }
  }

  function docMenu(d, anchor) {
    const p = project();
    const idx = p.docs.indexOf(d);
    const items = [
      { label: 'Open', onClick: () => app.go(`#/p/${p.id}/script/${d.id}`) },
      { label: 'Rename…', onClick: async () => {
        const v = await promptDialog('Title', d.title, { title: 'Rename' });
        if (v && v.trim()) { d.title = v.trim(); app.markDirty(); paintSidebar(); if (cur.arg === d.id) titleEl.textContent = docLabel(d); }
      } },
    ];
    if (d.ep != null && d.ep !== '') items.push({ label: 'Episode number…', onClick: async () => {
      const v = await promptDialog('Episode number', String(d.ep), { title: 'Episode number' });
      if (v != null && v.trim()) { d.ep = isNaN(+v) ? v.trim() : +v; app.markDirty(); paintSidebar(); }
    } });
    items.push(
      { label: 'Duplicate (new draft)', onClick: () => {
        const c = JSON.parse(JSON.stringify(d));
        c.id = 'd' + Math.random().toString(36).slice(2, 10);
        c.title = d.title + ' (copy)';
        c.created = c.updated = Date.now();
        p.docs.splice(idx + 1, 0, c);
        app.markDirty();
        app.go(`#/p/${p.id}/script/${c.id}`);
      } });
    if (d.kind !== 'text') {
      const conv = [];
      for (const [id, f] of Object.entries(FORMATS)) if (id !== d.fmt && id !== 'text') conv.push({ label: `Convert copy to ${f.label}`, onClick: () => convertTo(d, id) });
      if (d.kind !== 'av') conv.push({ label: 'Convert copy to AV (two-column)', onClick: () => convertTo(d, 'av') });
      items.push({ sep: true }, ...conv);
    }
    items.push(
      { sep: true },
      { label: 'Move up', disabled: idx === 0, onClick: () => { p.docs.splice(idx - 1, 0, p.docs.splice(idx, 1)[0]); app.markDirty(); paintSidebar(); } },
      { label: 'Move down', disabled: idx === p.docs.length - 1, onClick: () => { p.docs.splice(idx + 1, 0, p.docs.splice(idx, 1)[0]); app.markDirty(); paintSidebar(); } },
      { sep: true },
      { label: 'Delete…', danger: true, disabled: p.docs.length === 1, onClick: async () => {
        const ok = await confirmDialog(`Delete “${docLabel(d)}”? Shots and schedule entries linked to its scenes will also be removed. Saved versions stay in Version History.`, { title: 'Delete document', ok: 'Delete', danger: true });
        if (!ok) return;
        p.docs = p.docs.filter(x => x !== d);
        p.shots = p.shots.filter(s => s.docId !== d.id);
        p.schedule.strips = p.schedule.strips.filter(s => s.docId !== d.id);
        app.markDirty();
        if (cur.arg === d.id) app.go(`#/p/${p.id}/script/${p.docs[0].id}`); else paintSidebar();
      } });
    menu(anchor, items);
  }

  function convertTo(d, fmtId) {
    const p = project();
    const c = convertDoc(d, fmtId);
    c.title = `${d.title} (${fmtId === 'av' ? 'AV' : FORMATS[fmtId].label})`;
    p.docs.splice(p.docs.indexOf(d) + 1, 0, c);
    app.markDirty();
    toast('Converted copy created. The original is unchanged.');
    app.go(`#/p/${p.id}/script/${c.id}`);
  }

  async function show(tool, arg) {
    const token = ++showToken;
    const p = project();
    if (!tool) { tool = 'script'; arg = p.lastDoc && p.docs.some(d => d.id === p.lastDoc) ? p.lastDoc : p.docs[0].id; }
    if (tool === 'script' && !p.docs.some(d => d.id === arg)) arg = p.docs[0].id;
    if (!VIEWS[tool]) tool = 'script';
    if (cleanupView) { try { cleanupView(); } catch (e) { console.error(e); } cleanupView = null; }
    app.beforeClose = null;
    clear(viewEl);
    clear(tbSlot);
    cur = { tool, arg };
    if (tool === 'script' && p.lastDoc !== arg) { p.lastDoc = arg; }
    paintSidebar();
    shell.classList.remove('nav-open');
    const mod = await VIEWS[tool]();
    if (token !== showToken) return;
    const ctx = {
      project: p, arg, view: viewEl, toolbar: tbSlot, shell,
      setTitle: t => { titleEl.textContent = t; document.title = `${t} · Reelwright`; },
      refreshSidebar: paintSidebar,
      setFlush: fn => { app.beforeClose = fn; },
    };
    try {
      const r = await mod.render(ctx);
      cleanupView = r && r.cleanup ? r.cleanup : null;
    } catch (e) {
      console.error(e);
      viewEl.append(h('div.empty', h('div.empty-title', 'Something went wrong showing this view.'), h('p', String(e && e.message || e))));
    }
  }

  return {
    show,
    cleanup() {
      if (cleanupView) { try { cleanupView(); } catch {} }
      cleanupView = null;
      app.beforeClose = null;
      app.externalChange = null;
      unsub();
      document.title = 'Reelwright';
    },
  };
}
