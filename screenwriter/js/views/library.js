// Home screen: every project on this device.
import { h, clear, timeAgo, slug, download, pickFile, readFile, plural } from '../util.js';
import { modal, confirmDialog, promptDialog, toast, menu, field } from '../ui.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import { app } from '../app.js';
import { newProject, PROJECT_TYPES, migrateProject } from '../model.js';
import { parseScriptFile } from '../io.js';

export async function renderLibrary(root) {
  let heads = await store.listProjects();
  let q = '';
  const grid = h('div.proj-grid');
  const search = h('input.input', { type: 'search', placeholder: 'Search projects', 'aria-label': 'Search projects', oninput: () => { q = search.value.toLowerCase(); paint(); } });
  const sortSel = h('select.input', { style: { width: 'auto' }, 'aria-label': 'Sort', onchange: () => { app.setPrefs({ libSort: sortSel.value }); paint(); } },
    h('option', { value: 'recent' }, 'Recently edited'), h('option', { value: 'title' }, 'Title A–Z'), h('option', { value: 'created' }, 'Newest first'));
  sortSel.value = app.prefs.libSort || 'recent';
  const themeBtn = h('button.icon-btn', { type: 'button', title: 'Toggle dark mode', 'aria-label': 'Toggle dark mode', onclick: () => { app.setPrefs({ theme: app.isDark() ? 'light' : 'dark' }); themeBtn.replaceChildren(icon(app.isDark() ? 'sun' : 'moon')); } }, icon(app.isDark() ? 'sun' : 'moon'));
  const storageNote = h('div.storage-note');

  const view = h('div.library',
    h('header.lib-head',
      h('div.logo', h('div.logo-mark', icon('film')), 'Reelwright'),
      h('div.spacer'),
      h('button.btn.ghost.hide-sm', { type: 'button', onclick: () => importFlow() }, icon('upload'), 'Import'),
      themeBtn,
      h('button.icon-btn', { type: 'button', title: 'Your name', 'aria-label': 'Your name', onclick: async () => {
        const v = await promptDialog('Your name (used for comments and new title pages)', app.prefs.author, { title: 'Writer name' });
        if (v != null) { app.setPrefs({ author: v.trim() }); toast('Saved'); }
      } }, icon('settings'))),
    h('div.lib-body', h('div.lib-inner',
      h('div.lib-tools',
        h('h2', { style: { fontSize: '22px', marginRight: '8px' } }, 'Projects'),
        search, sortSel, h('div.spacer'),
        h('button.btn.only-sm', { type: 'button', onclick: () => importFlow() }, icon('upload'), 'Import'),
        h('button.btn.primary', { type: 'button', onclick: () => newFlow() }, icon('plus'), 'New project')),
      grid,
      storageNote)));
  root.appendChild(view);

  async function refresh() { heads = await store.listProjects(); paint(); }

  function paint() {
    clear(grid);
    let list = heads.filter(p => !q || p.title.toLowerCase().includes(q) || p.docs.some(d => d.title.toLowerCase().includes(q)));
    const sort = sortSel.value;
    if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'created') list.sort((a, b) => b.created - a.created);
    else list.sort((a, b) => b.updated - a.updated);
    grid.appendChild(h('button.proj-card.new-card', { type: 'button', onclick: () => newFlow() }, icon('plus'), 'New project'));
    for (const p of list) grid.appendChild(card(p));
    if (!heads.length) {
      grid.appendChild(h('button.proj-card.new-card', { type: 'button', onclick: () => openSample() }, icon('film'), 'Open the sample film', h('span.small.muted', { style: { fontWeight: 400 } }, 'A short script with breakdown, shots, schedule and budget filled in')));
    }
    paintStorage();
  }

  function card(p) {
    const pages = p.docs.reduce((n, d) => n + (d.pages || 0), 0);
    const type = PROJECT_TYPES[p.type] ? PROJECT_TYPES[p.type].label : p.type;
    const scripts = p.docs.filter(d => d.kind !== 'text').length;
    const more = h('button.icon-btn.card-menu', { type: 'button', 'aria-label': 'Project options', onclick: e => { e.stopPropagation(); projectMenu(p, more); } }, icon('more'));
    return h('div.proj-card', { tabindex: 0, role: 'button', 'aria-label': `Open ${p.title}`, onclick: () => app.go(`#/p/${p.id}`), onkeydown: e => { if (e.key === 'Enter') app.go(`#/p/${p.id}`); } },
      h('div.proj-cover', h('span', p.title || 'Untitled')),
      h('div.proj-meta',
        h('div.proj-title.ellipsis', p.title || 'Untitled'),
        h('div.proj-sub', h('span.badge', type), scripts > 1 ? h('span', plural(scripts, 'script')) : null, pages ? h('span', plural(pages, 'page')) : null),
        h('div.proj-sub', 'Edited ' + timeAgo(p.updated))),
      more);
  }

  function projectMenu(p, anchor) {
    menu(anchor, [
      { label: 'Open', onClick: () => app.go(`#/p/${p.id}`) },
      { label: 'Rename', onClick: async () => {
        const v = await promptDialog('Project title', p.title, { title: 'Rename project' });
        if (!v || !v.trim()) return;
        const full = await store.loadProject(p.id);
        full.title = v.trim();
        await store.saveProject(full);
        refresh();
      } },
      { label: 'Duplicate', onClick: async () => {
        const full = await store.loadProject(p.id);
        const bundle = await store.exportBundle(full, { versions: false });
        bundle.project.title = full.title + ' (copy)';
        await store.importBundle(bundle, { asCopy: true });
        toast('Project duplicated');
        refresh();
      } },
      { label: 'Export backup (.json)', onClick: async () => {
        const full = await store.loadProject(p.id);
        const bundle = await store.exportBundle(full);
        download(`${slug(full.title)}.reelwright.json`, JSON.stringify(bundle), 'application/json');
      } },
      { sep: true },
      { label: 'Delete…', danger: true, onClick: async () => {
        const ok = await confirmDialog(`Delete “${p.title}” and all of its scripts, versions and images from this device? This cannot be undone. Export a backup first if you might need it.`, { title: 'Delete project', ok: 'Delete', danger: true });
        if (!ok) return;
        await store.deleteProject(p.id);
        toast('Project deleted');
        refresh();
      } },
    ], { align: 'right' });
  }

  async function paintStorage() {
    const est = await store.storageEstimate();
    const persisted = await store.isPersisted();
    clear(storageNote);
    storageNote.append(
      icon('info'),
      h('div.grow',
        h('div', h('b', 'Your scripts are stored in this browser on this device. '), 'Nothing is uploaded. Clearing site data deletes them, so back up regularly.'),
        h('div.small', est ? `Using ${(est.usage / 1048576).toFixed(1)} MB${est.quota ? ` of ${Math.round(est.quota / 1048576).toLocaleString()} MB available` : ''}. ` : '', persisted ? 'Storage is marked persistent.' : 'Storage is not marked persistent; the browser may evict it under storage pressure.')),
      h('button.btn.sm', { type: 'button', onclick: backupAll }, icon('download'), 'Back up all'),
      h('button.btn.sm', { type: 'button', onclick: () => importFlow('.json') }, icon('upload'), 'Restore'));
  }

  async function backupAll() {
    if (!heads.length) return toast('No projects to back up');
    const bundles = [];
    for (const hd of heads) { const full = await store.loadProject(hd.id); if (full) bundles.push(await store.exportBundle(full)); }
    download(`reelwright-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'reelwright-library', formatVersion: 1, projects: bundles }), 'application/json');
  }

  async function newFlow() {
    let type = 'film';
    const title = h('input.input', { type: 'text', placeholder: 'Untitled', autofocus: true });
    const author = h('input.input', { type: 'text', placeholder: 'Your name' });
    author.value = app.prefs.author || '';
    const opts = Object.entries(PROJECT_TYPES).map(([id, t]) => {
      const b = h('button.type-opt' + (id === type ? '.sel' : ''), { type: 'button', onclick: () => { type = id; opts.forEach(o => o.classList.toggle('sel', o === b)); } }, h('b', t.label), h('span', t.desc));
      return b;
    });
    const res = await modal({
      title: 'New project', wide: true,
      body: h('div.form', field('Title', title), field('Type', h('div.type-grid', opts)), field('Written by', author)),
      buttons: [{ label: 'Cancel', value: null }, { label: 'Create', primary: true, onClick: () => ({ title: title.value.trim() || 'Untitled', type, author: author.value.trim() }) }],
    });
    if (!res) return;
    if (res.author && !app.prefs.author) app.setPrefs({ author: res.author });
    const p = newProject(res);
    await store.saveProject(p);
    app.go(`#/p/${p.id}`);
  }

  async function openSample() {
    const { buildSample } = await import('../sample.js');
    const p = await buildSample();
    await store.saveProject(p);
    app.go(`#/p/${p.id}`);
  }

  async function importFlow(accept = '.fountain,.fdx,.txt,.spmd,.json,.md,text/plain,application/json') {
    const files = await pickFile(accept, true);
    let lastId = null, n = 0;
    for (const f of files) {
      try {
        const text = await readFile(f);
        if (/\.json$/i.test(f.name) || /^\s*\{/.test(text)) {
          const data = JSON.parse(text);
          if (data.format === 'reelwright-library') {
            for (const b of data.projects || []) { const p = await store.importBundle(b); lastId = p.id; n++; }
          } else { const p = await store.importBundle(data); lastId = p.id; n++; }
          continue;
        }
        const parsed = parseScriptFile(f.name, text, 'screenplay');
        const title = parsed.tp.title ? parsed.tp.title.split('\n')[0] : f.name.replace(/\.[^.]+$/, '');
        const p = newProject({ title: titleCase(title), type: 'film', author: parsed.tp.author || app.prefs.author });
        const d = p.docs[0];
        d.title = p.title;
        d.blocks = parsed.blocks;
        d.tp = { ...d.tp, ...parsed.tp, show: parsed.tp.show };
        d.locked = !!parsed.locked;
        if (parsed.notes && parsed.notes.length) d.importNotes = parsed.notes;
        migrateProject(p);
        await store.saveProject(p);
        lastId = p.id; n++;
        toast(`Imported ${parsed.source} script “${p.title}”`);
      } catch (e) {
        console.error(e);
        toast(`Could not import ${f.name}: ${e.message}`, { kind: 'error', ms: 6000 });
      }
    }
    if (n === 1 && lastId) app.go(`#/p/${lastId}`);
    else if (n > 1) { toast(`Imported ${n} projects`); refresh(); }
  }

  paint();
  return { cleanup() {} };
}

function titleCase(s) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}
