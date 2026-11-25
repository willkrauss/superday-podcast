// Index cards and outline. Reordering cards reorders the scenes in the script.
import { h, clear, sortable, uid, fmtEighths } from '../util.js';
import { menu, promptDialog, confirmDialog, toast, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import { getScenes, docLabel } from '../model.js';
import { getFormat, typeOfRole } from '../formats.js';
import { textToHTML } from '../inline.js';
import { pickDoc, docPicker, scriptDocs, setSceneMeta, sceneTitle } from './common.js';
import { sceneLengths } from '../production.js';

const COLORS = ['', '#e5484d', '#f76b15', '#ffb224', '#30a46c', '#12a594', '#0090ff', '#8e4ec6', '#d6409f', '#8d8d8d'];

export function render(ctx) {
  const { project } = ctx;
  const docs = scriptDocs(project).filter(d => d.kind !== 'av' || true);
  const doc = pickDoc(project, ctx.arg, docs);
  ctx.setTitle('Index Cards & Outline');
  if (!doc) { ctx.view.append(emptyState('No scripts', 'Add a script first.')); return; }
  let mode = project.cardMode || 'cards';
  let colorFilter = '';
  const body = h('div.view-inner');
  const wrap = h('div.view-pad.scroll', { style: { flex: 1 } }, body);
  ctx.view.append(wrap);

  const isAV = doc.kind === 'av';
  const fmt = isAV ? null : getFormat(doc.fmt);
  const headType = isAV ? 'avscene' : typeOfRole(fmt, 'heading');

  function paint() {
    clear(body);
    const scenes = getScenes(doc);
    const lens = doc.kind !== 'text' ? safeLens() : new Map();
    const shown = scenes.filter(s => !colorFilter || (s.color || '') === colorFilter);
    const picker = docPicker(project, doc, 'cards', docs);
    body.append(h('div.section-head',
      h('h2', 'Index Cards'),
      picker,
      h('div.row', { role: 'group' },
        h('button.btn.sm' + (mode === 'cards' ? '.primary' : ''), { type: 'button', onclick: () => { mode = project.cardMode = 'cards'; paint(); } }, icon('grid'), 'Cards'),
        h('button.btn.sm' + (mode === 'outline' ? '.primary' : ''), { type: 'button', onclick: () => { mode = project.cardMode = 'outline'; paint(); } }, icon('list'), 'Outline')),
      h('div.spacer'),
      h('button.btn.sm', { type: 'button', onclick: e => menu(e.currentTarget, COLORS.map(c => ({ label: c ? 'Only this color' : 'All colors', swatch: c || 'transparent', checked: colorFilter === c, onClick: () => { colorFilter = c; paint(); } }))) }, 'Filter'),
      h('button.btn.sm.primary', { type: 'button', onclick: () => addScene() }, icon('plus'), 'New scene')));
    body.append(h('p.muted.small', { style: { marginTop: '-6px' } }, `${scenes.length} scenes in ${docLabel(doc)}. Drag cards to reorder scenes in the script; edits to synopses are saved to the script's scene notes.`));
    if (!scenes.length) { body.append(emptyState('No scenes yet', 'Add a scene here or write a scene heading in the script.')); return; }
    const container = h(mode === 'cards' ? 'div.cards-grid' : 'div.outline-list');
    for (const s of shown) container.append(mode === 'cards' ? card(s, lens.get(s.id)) : orow(s, lens.get(s.id)));
    body.append(container);
    if (!colorFilter) sortable(container, { items: mode === 'cards' ? '.icard' : '.orow', handle: '.grip', axis: mode === 'cards' ? 'grid' : 'y', scroller: wrap, onEnd: (from, to) => moveScene(from, to) });
  }

  function safeLens() { try { return sceneLengths(project, doc); } catch { return new Map(); } }

  function headingInput(s) {
    const inp = h('textarea.input.bare.sm', { rows: 2, placeholder: 'Scene heading', style: { fontFamily: 'var(--mono)', fontWeight: 700, textTransform: 'uppercase', resize: 'none', minHeight: '0', fontSize: '12px', lineHeight: '1.35' } });
    inp.value = s.text;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
    inp.addEventListener('change', () => {
      const i = doc.blocks.findIndex(b => b.id === s.id);
      if (i < 0) return;
      const b = doc.blocks[i];
      doc.blocks[i] = isAV ? { ...b, v: textToHTML(inp.value) } : { ...b, h: textToHTML(inp.value) };
      app.markDirty();
    });
    return inp;
  }

  function synArea(s, rows = 4) {
    const ta = h('textarea', { rows, placeholder: 'Synopsis: what happens in this scene?' });
    ta.value = s.syn;
    ta.addEventListener('input', () => { setSceneMeta(doc, s.id, { syn: ta.value }); app.markDirty(); });
    return ta;
  }

  function card(s, len) {
    return h('div.icard', { style: { '--card-color': s.color || '' } },
      h('div.icard-head',
        h('span.grip', { title: 'Drag to reorder', 'aria-label': 'Drag to reorder' }, icon('grip')),
        h('span.icard-num', s.num),
        h('div.icard-title', headingInput(s)),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Scene options', onclick: e => sceneMenu(s, e.currentTarget) }, icon('more'))),
      synArea(s),
      h('div.icard-foot',
        len ? h('span', `${fmtEighths(len.eighths)} pg`) : null,
        s.chars.size ? h('span.ellipsis', { title: Array.from(s.chars).join(', ') }, Array.from(s.chars).slice(0, 4).join(', ')) : null,
        h('div.spacer'),
        h('button.link.small', { type: 'button', onclick: () => openInScript(s) }, 'Open')));
  }

  function orow(s, len) {
    return h('div.orow', { style: { '--card-color': s.color || '' } },
      h('span.grip', { title: 'Drag to reorder', 'aria-label': 'Drag to reorder' }, icon('grip')),
      h('span.icard-num', s.num),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, headingInput(s), synArea(s, 2),
        s.firstLine ? h('div.small.muted.ellipsis', s.firstLine) : null),
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' } },
        h('button.icon-btn', { type: 'button', 'aria-label': 'Scene options', onclick: e => sceneMenu(s, e.currentTarget) }, icon('more')),
        len ? h('span.small.muted', `${fmtEighths(len.eighths)} pg`) : null));
  }

  function sceneMenu(s, anchor) {
    menu(anchor, [
      { label: 'Open in script', onClick: () => openInScript(s) },
      { label: 'Insert new scene after', onClick: () => addScene(s) },
      { heading: 'Color' },
      ...COLORS.map(c => ({ label: c || 'None', swatch: c || 'transparent', checked: (s.color || '') === c, onClick: () => { setSceneMeta(doc, s.id, { color: c || undefined }); app.markDirty(); paint(); } })),
      { sep: true },
      { label: s.omit ? 'Restore scene' : 'Omit scene', onClick: () => { setSceneMeta(doc, s.id, { omit: s.omit ? undefined : true }); app.markDirty(); paint(); } },
      { label: 'Delete scene…', danger: true, onClick: async () => {
        if (!await confirmDialog(`Delete scene ${s.num} and all of its script text?`, { ok: 'Delete', danger: true })) return;
        doc.blocks.splice(s.idx, s.end - s.idx);
        if (!doc.blocks.length) doc.blocks.push({ id: uid('b'), t: headType, h: '' });
        app.markDirty(); paint();
      } },
    ]);
  }

  function openInScript(s) {
    app.pendingScroll = s.id;
    app.go(`#/p/${project.id}/script/${doc.id}`);
  }

  function moveScene(from, to) {
    const scenes = getScenes(doc);
    const pre = doc.blocks.slice(0, scenes.length ? scenes[0].idx : doc.blocks.length);
    const ranges = scenes.map(s => doc.blocks.slice(s.idx, s.end));
    const [r] = ranges.splice(from, 1);
    ranges.splice(to, 0, r);
    doc.blocks = pre.concat(...ranges);
    doc.updated = Date.now();
    app.markDirty();
    paint();
  }

  async function addScene(after) {
    const v = await promptDialog(isAV ? 'Scene title' : 'Scene heading', isAV ? '' : 'INT. ', { title: 'New scene' });
    if (v == null) return;
    const syn = await promptDialog('Synopsis (optional)', '', { title: 'New scene', multiline: true });
    const head = isAV ? { id: uid('b'), t: 'avscene', v: textToHTML(v.trim()), a: '' } : { id: uid('b'), t: headType, h: textToHTML(v.trim()) };
    if (syn && syn.trim()) head.s = { syn: syn.trim() };
    const body = isAV ? { id: uid('b'), t: 'avrow', v: '', a: '' } : { id: uid('b'), t: typeOfRole(fmt, 'action') || headType, h: '' };
    const at = after ? after.end : doc.blocks.length;
    doc.blocks.splice(at, 0, head, body);
    app.markDirty();
    paint();
  }

  paint();
  return { cleanup() {} };
}
