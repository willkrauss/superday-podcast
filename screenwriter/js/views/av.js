// Two-column AV script editor (VIDEO | AUDIO), for commercials, documentaries, corporate and online video.
import { h, clear, uid, debounce, download, slug, toCSV, isMac, modKey, plural } from '../util.js';
import { menu, modal, confirmDialog, toast } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import * as store from '../store.js';
import { docLabel, sceneNumberMap } from '../model.js';
import { sanitizeNode, domHTML, htmlToText } from '../inline.js';
import { layoutScript, pagesToText } from '../paginate.js';
import { buildPDF } from '../pdf.js';
import { renderSheets, printSheets } from '../preview.js';
import { editTitlePageModal } from './titlepage.js';

export function render(ctx, doc) {
  const { project } = ctx;
  ctx.setTitle(docLabel(doc));
  const undoStack = [];
  const snapshot = () => { undoStack.push(doc.blocks.slice()); if (undoStack.length > 100) undoStack.shift(); };
  let focusRow = null;

  const tbody = h('tbody');
  const table = h('table.av-table', h('thead', h('tr', h('th', '#'), h('th', 'VIDEO'), h('th', 'AUDIO'), h('th', ''))), tbody);
  const keep = el => { el.addEventListener('mousedown', e => e.preventDefault()); return el; };
  const tb = (ic, title, fn) => keep(h('button.icon-btn', { type: 'button', title, 'aria-label': title, onclick: fn }, icon(ic)));
  const toolbar = h('div.toolbar',
    keep(h('button.btn.sm', { type: 'button', onclick: () => addRow('avrow') }, icon('plus'), 'Row')),
    keep(h('button.btn.sm', { type: 'button', onclick: () => addRow('avscene') }, icon('plus'), 'Scene')),
    h('span.tb-sep'),
    tb('bold', `Bold (${modKey}+B)`, () => document.execCommand('bold')),
    tb('italic', `Italic (${modKey}+I)`, () => document.execCommand('italic')),
    tb('underline', `Underline (${modKey}+U)`, () => document.execCommand('underline')),
    tb('undo', 'Undo row changes', () => { const prev = undoStack.pop(); if (prev) { doc.blocks = prev; app.markDirty(); paint(); } }),
    h('span.tb-sep'),
    tb('title', 'Title page', async () => { if (await editTitlePageModal(doc)) app.markDirty(); }),
    tb('eye', 'Preview pages', () => preview()),
    keep(h('button.icon-btn', { type: 'button', title: 'Export', onclick: e => exportMenu(e.currentTarget) }, icon('download'), h('span.tb-label', 'Export'))),
    h('div.spacer'),
    h('span.small.muted.hide-sm', `Tab: next cell · ${modKey}+Enter: new row · Enter: new line`));
  const scroll = h('div.scroll', { style: { flex: 1, background: 'var(--desk)' } }, h('div.av-wrap', table));
  ctx.view.append(toolbar, scroll);

  const save = debounce(cell => commitCell(cell), 300);
  function commitCell(cell) {
    const i = doc.blocks.findIndex(b => b.id === cell.dataset.id);
    if (i < 0) return;
    const html = sanitizeNode(cell);
    const key = cell.dataset.k;
    if (doc.blocks[i][key] !== html) { doc.blocks[i] = { ...doc.blocks[i], [key]: html }; doc.updated = Date.now(); app.markDirty(); }
  }
  ctx.setFlush(() => { for (const c of tbody.querySelectorAll('.av-ce')) commitCell(c); });

  function cell(b, key, ph) {
    const ce = h('div.av-ce', { contenteditable: 'true', spellcheck: app.prefs.spellcheck !== false ? 'true' : 'false', dataset: { id: b.id, k: key, ph } });
    ce.innerHTML = b[key] ? domHTML(b[key]) : '';
    ce.addEventListener('input', () => { if (ce.innerHTML === '<br>') ce.innerHTML = ''; save(ce); });
    ce.addEventListener('blur', () => { save.cancel(); commitCell(ce); });
    ce.addEventListener('focus', () => { focusRow && focusRow.classList.remove('cur'); focusRow = ce.closest('tr'); focusRow.classList.add('cur'); });
    ce.addEventListener('paste', e => { e.preventDefault(); const t = (e.clipboardData.getData('text/plain') || '').replace(/\r\n?/g, '\n'); document.execCommand('insertText', false, t); });
    ce.addEventListener('keydown', e => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (e.key === 'Enter' && mod) { e.preventDefault(); commitCell(ce); addRow('avrow', b.id); return; }
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); document.execCommand('insertLineBreak'); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        const cells = Array.from(tbody.querySelectorAll('.av-ce'));
        const i = cells.indexOf(ce) + (e.shiftKey ? -1 : 1);
        if (i >= cells.length && !e.shiftKey) { commitCell(ce); addRow('avrow', b.id); return; }
        if (cells[i]) placeCaretEnd(cells[i]);
      }
    });
    return ce;
  }

  function placeCaretEnd(el) {
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  function paint() {
    clear(tbody);
    const nums = sceneNumberMap(doc);
    let shot = 0;
    for (const b of doc.blocks) {
      const tools = h('td.av-tools', h('button.icon-btn', { type: 'button', 'aria-label': 'Row options', onclick: e => rowMenu(b, e.currentTarget) }, icon('more')));
      if (b.t === 'avscene') {
        tbody.append(h('tr.av-scene', h('td.av-num', nums.get(b.id) || ''), h('td', { colspan: 2 }, cell(b, 'v', 'SCENE TITLE')), tools));
      } else {
        shot++;
        tbody.append(h('tr', h('td.av-num', shot), h('td.av-cell', cell(b, 'v', 'Picture: shots, graphics, B-roll…')), h('td.av-cell', cell(b, 'a', 'Sound: narration, dialogue (NAME: line), music, SFX…')), tools));
      }
    }
  }

  function addRow(t, afterId) {
    snapshot();
    const b = { id: uid('b'), t, v: '', a: '' };
    let i = afterId ? doc.blocks.findIndex(x => x.id === afterId) : -1;
    if (i < 0 && focusRow) { const id = focusRow.querySelector('.av-ce')?.dataset.id; i = doc.blocks.findIndex(x => x.id === id); }
    if (i < 0) i = doc.blocks.length - 1;
    doc.blocks.splice(i + 1, 0, b);
    app.markDirty();
    paint();
    const ce = tbody.querySelector(`.av-ce[data-id="${b.id}"]`);
    if (ce) placeCaretEnd(ce);
  }

  function rowMenu(b, anchor) {
    const i = doc.blocks.indexOf(b);
    const mv = d => { snapshot(); const [x] = doc.blocks.splice(i, 1); doc.blocks.splice(i + d, 0, x); app.markDirty(); paint(); };
    menu(anchor, [
      { label: 'Insert row below', onClick: () => addRow('avrow', b.id) },
      { label: 'Insert scene below', onClick: () => addRow('avscene', b.id) },
      { label: b.t === 'avscene' ? 'Make a normal row' : 'Make a scene heading', onClick: () => { snapshot(); doc.blocks[i] = { ...b, t: b.t === 'avscene' ? 'avrow' : 'avscene' }; app.markDirty(); paint(); } },
      { label: 'Move up', disabled: i === 0, onClick: () => mv(-1) },
      { label: 'Move down', disabled: i === doc.blocks.length - 1, onClick: () => mv(1) },
      { label: 'Duplicate', onClick: () => { snapshot(); doc.blocks.splice(i + 1, 0, { ...b, id: uid('b') }); app.markDirty(); paint(); } },
      { sep: true },
      { label: 'Delete row', danger: true, disabled: doc.blocks.length === 1, onClick: () => { snapshot(); doc.blocks.splice(i, 1); app.markDirty(); paint(); toast('Row deleted', { action: { label: 'Undo', run: () => { doc.blocks = undoStack.pop(); app.markDirty(); paint(); } } }); } },
    ]);
  }

  const L = () => { ctx.view.querySelectorAll('.av-ce').forEach(commitCell); return layoutScript(doc, project); };
  const pages = l => (l.titlePage ? [l.titlePage, ...l.pages] : l.pages);
  async function pdf() { const l = L(); download(`${slug(docLabel(doc))}.pdf`, await buildPDF(pages(l), { title: docLabel(doc) }), 'application/pdf'); }
  async function preview() {
    const l = L();
    const sheets = h('div.sheets');
    renderSheets(sheets, pages(l));
    sheets.style.setProperty('--u', Math.min(96, (Math.min(innerWidth, 900) - 56) / 8.5) + 'px');
    await modal({ title: `Preview: ${plural(l.pageCount, 'page')}`, wide: true, body: h('div', { style: { background: 'var(--desk)', margin: '0 -20px -16px' } }, sheets),
      buttons: [{ label: 'Print…', onClick: () => { printSheets(pages(l), project.settings.paper); return true; } }, { label: 'Download PDF', primary: true, onClick: async () => { await pdf(); return false; } }] });
  }
  function exportMenu(anchor) {
    menu(anchor, [
      { label: 'PDF', hint: '.pdf', onClick: pdf },
      { label: 'Spreadsheet (CSV)', hint: '.csv', onClick: () => { L(); download(`${slug(docLabel(doc))}.csv`, toCSV([['#', 'Type', 'Video', 'Audio'], ...doc.blocks.map((b, i) => [i + 1, b.t === 'avscene' ? 'Scene' : 'Row', htmlToText(b.v), htmlToText(b.a)])]), 'text/csv'); } },
      { label: 'Plain text', hint: '.txt', onClick: () => download(`${slug(docLabel(doc))}.txt`, pagesToText(L()), 'text/plain') },
      { label: 'Print…', onClick: () => printSheets(pages(L()), project.settings.paper) },
      { label: 'Save a named version…', onClick: async () => { L(); const { promptDialog } = await import('../ui.js'); const n = await promptDialog('Version name', 'Draft'); if (n != null) { await store.addVersion({ pid: project.id, docId: doc.id, name: n || 'Draft', doc }); toast('Version saved'); } } },
    ], { align: 'right' });
  }

  paint();
  return { cleanup() { ctx.view.querySelectorAll('.av-ce').forEach(commitCell); } };
}
