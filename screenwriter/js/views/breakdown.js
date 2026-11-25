// Breakdown sheets per scene: elements from tags in the script, speaking characters, and manual additions.
import { h, clear, download, slug, toCSV, fmtEighths } from '../util.js';
import { menu, promptDialog, toast, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import { getScenes, sceneElements, CATEGORIES, CAT, addCatalog, syncCatalog, docLabel } from '../model.js';
import { pickDoc, docPicker, productionDocs, setSceneMeta, sceneTitle, noScripts } from './common.js';
import { sceneLengths } from '../production.js';
import { printHTML } from '../preview.js';

export function render(ctx) {
  const { project } = ctx;
  const doc = pickDoc(project, ctx.arg);
  ctx.setTitle('Breakdown');
  if (!doc) return noScripts(ctx.view, project, 'break down');
  if (syncCatalog(project)) app.markDirty();
  let selId = app.pendingScene || project.bdScene || null;
  app.pendingScene = null;
  const left = h('div.card.card-pad');
  const right = h('div');
  const body = h('div.view-inner',
    h('div.section-head', h('h2', 'Breakdown'), docPicker(project, doc, 'breakdown'), h('div.spacer'),
      h('button.btn.sm', { type: 'button', onclick: () => { app.pendingBreakdown = true; if (selId) app.pendingScroll = selId; app.go(`#/p/${project.id}/script/${doc.id}`); } }, icon('tag'), 'Tag in script'),
      h('button.btn.sm', { type: 'button', onclick: exportCSV }, icon('download'), 'CSV'),
      h('button.btn.sm', { type: 'button', onclick: printAll }, icon('print'), 'Print sheets')),
    h('div.bd-layout', left, right));
  ctx.view.append(h('div.view-pad.scroll', { style: { flex: 1 } }, body));

  function paint() {
    const scenes = getScenes(doc);
    const lens = sceneLengths(project, doc);
    if (!scenes.find(s => s.id === selId)) selId = scenes[0] ? scenes[0].id : null;
    clear(left);
    left.append(h('div.sb-label', `Scenes (${scenes.length})`));
    const pick = h('div.scene-pick');
    for (const s of scenes) {
      const n = Array.from(sceneElements(project, doc, s).values()).reduce((a, x) => a + x.length, 0);
      pick.append(h('button.sb-item' + (s.id === selId ? '.active' : ''), { type: 'button', onclick: () => { selId = project.bdScene = s.id; paint(); } },
        h('span.small.muted', { style: { width: '24px', fontFamily: 'var(--mono)' } }, s.num),
        h('span.grow.ellipsis', { style: { fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 700 } }, sceneTitle(s)),
        h('span.badge', n)));
    }
    left.append(scenes.length ? pick : h('div.small.muted', 'No scenes yet.'));
    clear(right);
    const s = scenes.find(x => x.id === selId);
    if (!s) { right.append(emptyState('No scene selected', 'Write scene headings in the script to break it down.')); return; }
    right.append(sheet(s, lens.get(s.id), true));
  }

  function sheet(s, len, editable) {
    const els = sceneElements(project, doc, s);
    const manual = new Set((s.block.s && s.block.s.el) || []);
    const tagged = s.tags;
    const head = h('div.bd-sheet-head',
      kv('Scene', s.num), kv('Int / Ext', s.ie || '—'), kv('Day / Night', s.tod || '—'),
      kv('Pages', len ? fmtEighths(len.eighths) : '—'), kv('Script page', len ? len.page : '—'),
      editable ? kv('Est. time', timeInput(s)) : kv('Est. time', s.time || '—'),
      h('div', { style: { gridColumn: '1 / -1' } }, h('div.k', 'Set / Location'), h('div.v', { style: { fontFamily: 'var(--mono)', textTransform: 'uppercase' } }, s.loc || s.text || '—')),
      h('div', { style: { gridColumn: '1 / -1' } }, h('div.k', 'Synopsis'), editable ? synInput(s) : h('div', s.syn || '—')));
    const cats = h('div.bd-cats');
    for (const c of CATEGORIES) {
      const items = els.get(c.id) || [];
      if (!editable && !items.length) continue;
      if (editable && !items.length && !['cast', 'extras', 'props', 'wardrobe', 'makeup', 'vehicles', 'sfx', 'location'].includes(c.id)) continue;
      cats.append(h('div.bd-cat',
        h('h4', h('span.swatch', { style: { background: c.color } }), c.label, h('div.spacer'),
          editable ? h('button.icon-btn', { type: 'button', title: `Add ${c.label}`, 'aria-label': `Add ${c.label}`, onclick: e => addMenu(s, c.id, e.currentTarget) }, icon('plus')) : null),
        items.map(it => h('div.bd-el',
          h('span', c.id === 'cast' && it.n ? `${it.n}. ${it.name}` : it.name),
          editable ? h('span.small.muted', manual.has(it.id) ? 'added' : tagged.has(it.id) ? 'tagged' : 'auto') : null,
          editable && manual.has(it.id) ? h('button.icon-btn', { type: 'button', title: 'Remove', 'aria-label': `Remove ${it.name}`, onclick: () => { setSceneMeta(doc, s.id, { el: [...manual].filter(x => x !== it.id) }); app.markDirty(); paint(); } }, icon('close')) : null))));
    }
    if (editable) {
      const more = CATEGORIES.filter(c => !cats.textContent.includes(c.label));
      cats.append(h('div.bd-cat', h('h4', 'Other categories'), h('button.btn.sm', { type: 'button', onclick: e => menu(e.currentTarget, more.map(c => ({ label: c.label, swatch: c.color, onClick: () => addMenu(s, c.id, e.target) }))) }, icon('plus'), 'Add element')));
    }
    const notes = editable ? (() => {
      const ta = h('textarea.input', { rows: 3, placeholder: 'Notes for departments (special requirements, safety, permits…)' });
      ta.value = (s.block.s && s.block.s.bn) || '';
      ta.addEventListener('input', () => { setSceneMeta(doc, s.id, { bn: ta.value }); app.markDirty(); });
      return ta;
    })() : h('div', (s.block.s && s.block.s.bn) || '');
    return h('div.bd-sheet', head, cats, h('div', { style: { padding: '12px 16px' } }, h('div.k.small.muted', { style: { fontWeight: 700, textTransform: 'uppercase', fontSize: '11px' } }, 'Notes'), notes));
  }

  function kv(k, v) { return h('div', h('div.k', k), h('div.v', v)); }

  function timeInput(s) {
    const inp = h('input.input.sm', { placeholder: 'e.g. 2h', value: s.time || '', style: { maxWidth: '100px' } });
    inp.addEventListener('input', () => { setSceneMeta(doc, s.id, { time: inp.value }); app.markDirty(); });
    return inp;
  }
  function synInput(s) {
    const inp = h('textarea.input', { rows: 2, placeholder: 'What happens in this scene' });
    inp.value = s.syn || '';
    inp.addEventListener('input', () => { setSceneMeta(doc, s.id, { syn: inp.value }); app.markDirty(); });
    return inp;
  }

  function addMenu(s, cat, anchor) {
    const manual = (s.block.s && s.block.s.el) || [];
    const existing = project.catalog.filter(c => c.cat === cat).sort((a, b) => a.name.localeCompare(b.name));
    const add = id => { if (!manual.includes(id)) setSceneMeta(doc, s.id, { el: [...manual, id] }); app.markDirty(); paint(); };
    menu(anchor, [
      { label: `New ${CAT[cat].label.toLowerCase()}…`, onClick: async () => {
        const v = await promptDialog('Name', '', { title: `Add ${CAT[cat].label}` });
        if (v && v.trim()) add(addCatalog(project, cat, v.trim()).id);
      } },
      existing.length ? { sep: true } : null,
      ...existing.slice(0, 40).map(c => ({ label: c.name, checked: manual.includes(c.id), onClick: () => add(c.id) })),
    ]);
  }

  function printAll() {
    const scenes = getScenes(doc);
    const lens = sceneLengths(project, doc);
    const wrap = h('div', h('h2', { style: { margin: '0 0 12px' } }, `${project.title}: ${docLabel(doc)} breakdown`),
      scenes.map((s, i) => h('div' + (i ? '.page-break' : ''), { style: { marginBottom: '16px' } }, sheet(s, lens.get(s.id), false))));
    printHTML(wrap, { title: `${docLabel(doc)} breakdown` });
  }

  function exportCSV() {
    const scenes = getScenes(doc);
    const lens = sceneLengths(project, doc);
    const rows = [['Scene', 'Heading', 'Int/Ext', 'Day/Night', 'Pages (8ths)', 'Synopsis', ...CATEGORIES.map(c => c.label), 'Notes']];
    for (const s of scenes) {
      const els = sceneElements(project, doc, s);
      rows.push([s.num, s.text, s.ie, s.tod, (lens.get(s.id) || {}).eighths || '', s.syn, ...CATEGORIES.map(c => (els.get(c.id) || []).map(x => x.name).join('; ')), (s.block.s && s.block.s.bn) || '']);
    }
    download(`${slug(docLabel(doc))}-breakdown.csv`, toCSV(rows), 'text/csv');
  }

  paint();
  return { cleanup() {} };
}
