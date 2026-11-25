// Script view: the editor plus everything around it.
import { h, clear, debounce, download, slug, fmtDateTime, fmtDate, timeAgo, plural, isMac, modKey, uid, wordCount, todayISO } from '../util.js';
import { menu, modal, promptDialog, confirmDialog, toast, field, tabs, emptyState, closeMenu } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import * as store from '../store.js';
import { ScriptEditor } from '../editor.js';
import { getFormat, typeDef, REVISION_COLORS, FORMATS } from '../formats.js';
import {
  docLabel, allCharacterNames, allLocations, getScenes, characterStats, lockSceneNumbers, unlockSceneNumbers,
  addCatalog, findCatalog, CATEGORIES, CAT, docWords, normalizeCharName,
} from '../model.js';
import { htmlToText, spanTexts, upperSafe } from '../inline.js';
import { layoutScript, pagesToText, estimateRuntime } from '../paginate.js';
import { buildPDF } from '../pdf.js';
import { renderSheets, printSheets } from '../preview.js';
import { toFountain, toFDX, parsePlainPaste, blocksToPlain } from '../io.js';
import { ensureFormatCSS, updateMarkCSS } from '../formatcss.js';
import { editTitlePageModal } from './titlepage.js';

export async function render(ctx) {
  const { project } = ctx;
  const doc = project.docs.find(d => d.id === ctx.arg) || project.docs[0];
  if (doc.kind === 'av') return (await import('./av.js')).render(ctx, doc);
  const fmt = getFormat(doc.fmt);
  ensureFormatCSS(fmt);
  updateMarkCSS(project, doc);
  ctx.setTitle(docLabel(doc));

  const prefs = app.prefs;
  let breakdownMode = false;
  let layout = null;
  let curInfo = null;
  let sideTab = prefs.sideTab || 'scenes';
  const openedWords = docWords(doc);
  trackDay();

  // ---------- DOM ----------
  const ed = h('div');
  const gutter = h('div.gutter');
  const paper = h('div.paper', ed, gutter);
  const scroller = h('div.sv-scroll.scroll', paper);
  const sideBody = h('div.side-body');
  const sideTabs = h('div');
  const side = h('aside.sv-side', { 'aria-label': 'Script panel' }, sideTabs, sideBody);
  const status = h('div.statusbar');
  const findBar = h('div.find-bar.hidden');
  const elembar = h('div.elembar', { role: 'toolbar', 'aria-label': 'Element type' });
  const typeSel = h('select.tb-select', { 'aria-label': 'Element type', title: `Element type (Alt+1…${Math.min(fmt.order.length, 9)})` },
    fmt.order.map((t, i) => h('option', { value: t }, `${fmt.types[t].label}${i < 10 ? `  (Alt+${(i + 1) % 10})` : ''}`)));
  typeSel.addEventListener('change', () => { editor.focus(); if (editor.savedSel) editor.setSel(editor.savedSel, { scroll: false }); editor.setType(typeSel.value); });

  // Toolbar buttons must not steal focus (keeps the selection and the mobile keyboard).
  const keep = el => { el.addEventListener('pointerdown', e => e.preventDefault()); el.addEventListener('mousedown', e => e.preventDefault()); return el; };
  const tb = (ic, title, fn, extra = '') => keep(h('button.icon-btn' + extra, { type: 'button', title, 'aria-label': title, onclick: fn }, icon(ic)));
  const undoBtn = tb('undo', `Undo (${modKey}+Z)`, () => editor.undo());
  const redoBtn = tb('redo', `Redo (${modKey}+Shift+Z)`, () => editor.redo());
  const bdBtn = tb('tag', 'Breakdown tagging mode', () => setBreakdown(!breakdownMode));
  const revBtn = tb('rev', 'Revisions', e => revisionMenu(e.currentTarget));
  // On narrow screens the panel overlays the script, so it always starts closed there.
  let sideOpen = innerWidth >= 980 ? prefs.sidePanel !== false : false;
  const setSide = open => { sideOpen = open; if (innerWidth >= 980) app.setPrefs({ sidePanel: open }); applySide(); };
  const sideBtn = tb('panel', 'Toggle side panel', () => setSide(!sideOpen));
  const toolbar = h('div.toolbar', { role: 'toolbar', 'aria-label': 'Script tools' },
    typeSel,
    h('span.tb-sep'),
    tb('bold', `Bold (${modKey}+B)`, () => editor.format('b')),
    tb('italic', `Italic (${modKey}+I)`, () => editor.format('i')),
    tb('underline', `Underline (${modKey}+U)`, () => editor.format('u')),
    fmt.id === 'screenplay' ? tb('dual', 'Dual dialogue (put this speech beside the previous one)', () => { if (!editor.toggleDual()) toast('Put the cursor in the second of two consecutive speeches.'); }) : null,
    h('span.tb-sep'),
    undoBtn, redoBtn,
    h('span.tb-sep'),
    tb('search', `Find & replace (${modKey}+F)`, () => openFind()),
    tb('comment', 'Comment on selection', () => addComment()),
    bdBtn,
    revBtn,
    tb('title', 'Title page', () => editTitlePage()),
    h('span.tb-sep'),
    tb('eye', 'Preview pages', () => openPreview()),
    keep(h('button.icon-btn', { type: 'button', title: 'Export', 'aria-label': 'Export', onclick: e => exportMenu(e.currentTarget) }, icon('download'), h('span.tb-label', 'Export'))),
    tb('more', 'View & script options', e => viewMenu(e.currentTarget)),
    h('div.spacer'),
    sideBtn);

  const sv = h('div.script-view', toolbar, findBar, h('div.sv-body', scroller, side), status, elembar);
  ctx.view.append(sv);

  // ---------- editor ----------
  const editor = new ScriptEditor(ed, {
    doc, scroller, gutter,
    spellcheck: prefs.spellcheck,
    settings: () => project.settings,
    getNames: () => {
      const stats = characterStats(doc);
      const counts = new Map(stats.map(s => [s.name, s.lines]));
      return allCharacterNames(project).sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
    },
    getLocations: () => allLocations(project),
    parsePlain: text => parsePlainPaste(text, doc.fmt),
    toPlain: frag => blocksToPlain(fmt, frag),
    typewriter: () => app.prefs.typewriter,
    bottomInset: () => (elembar.offsetParent ? elembar.offsetHeight : 0),
    onChange: kind => {
      doc.updated = Date.now();
      app.markDirty();
      undoBtn.disabled = !editor.canUndo();
      redoBtn.disabled = !editor.canRedo();
      scheduleLayout();
      if (kind !== 'typing' || sideTab !== 'scenes') refreshSideLater();
    },
    onSelection: info => {
      curInfo = info;
      if (info && typeSel.value !== info.t) typeSel.value = info.t;
      paintElembar();
      highlightSceneRow();
      paintStatus();
      updateSelPop();
    },
    onSpanClick: (attr, id, span) => {
      if (attr === 'cm') { sideTab = 'comments'; setSide(true); paintSide(id); }
      else if (attr === 'tg' && breakdownMode) tagPopover(id, span);
    },
    onKeyDown: e => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'f') { e.preventDefault(); openFind(); }
      else if (mod && k === 'h' && !isMac) { e.preventDefault(); openFind(true); }
      else if (mod && k === 's') { e.preventDefault(); editor.flush(); app.saveNow().then(() => toast('Saved')); }
      else if (mod && e.shiftKey && k === 'p') { e.preventDefault(); openPreview(); }
      else if (mod && k === 'p') { e.preventDefault(); doPrint(); }
      else if (mod && e.altKey && k === 'c') { e.preventDefault(); addComment(); }
      else if (e.key === 'Escape') closeFind();
    },
    onModEnter: () => openPreview(),
  });
  undoBtn.disabled = redoBtn.disabled = true;
  ctx.setFlush(() => editor.flush());

  // ---------- layout / zoom ----------
  function applyLayoutMode() {
    const mode = app.prefs.layout;
    const narrow = scroller.clientWidth < 600;
    const fluid = mode === 'fluid' || (mode === 'auto' && narrow);
    paper.classList.toggle('fluid', fluid);
    if (!fluid) {
      const avail = scroller.clientWidth - 40;
      const u = Math.min(96 * (app.prefs.zoom || 1), avail / 8.5);
      paper.style.setProperty('--u', Math.max(40, u) + 'px');
    } else paper.style.removeProperty('--u');
    paper.style.setProperty('--scene-sb', project.settings.sceneSpacing ?? 2);
    paper.classList.toggle('scene-bold', !!project.settings.sceneBold);
    paper.classList.toggle('scene-underline', !!project.settings.sceneUnderline);
    ed.classList.toggle('bd', breakdownMode);
    editor.markersLater();
  }
  const ro = new ResizeObserver(debounce(applyLayoutMode, 80));
  ro.observe(scroller);

  const scheduleLayout = debounce(() => {
    layout = layoutScript(doc, project);
    doc.pages = layout.pageCount;
    editor.setLayout(layout);
    paintStatus();
    if (sideTab === 'scenes') paintSide();
  }, doc.blocks.length > 1500 ? 700 : 350);

  // ---------- side panel ----------
  function applySide() {
    side.classList.toggle('hidden', !sideOpen);
    sideBtn.classList.toggle('on', sideOpen);
    if (sideOpen) paintSide();
    setTimeout(applyLayoutMode, 0);
  }
  const refreshSideLater = debounce(() => { if (sideOpen) paintSide(); }, 500);

  function paintSide(focusComment) {
    clear(sideTabs);
    sideTabs.append(tabs([['scenes', 'Scenes'], ['comments', `Notes${openComments().length ? ` (${openComments().length})` : ''}`], ['stats', 'Stats']], sideTab, t => { sideTab = t; app.setPrefs({ sideTab: t }); paintSide(); }));
    clear(sideBody);
    if (sideTab === 'scenes') paintScenes();
    else if (sideTab === 'comments') paintComments(focusComment);
    else paintStats();
  }

  let sceneFilter = '';
  function paintScenes() {
    const scenes = getScenes(doc);
    const filter = h('input.input.sm', { type: 'search', placeholder: 'Filter scenes', value: sceneFilter, oninput: () => { sceneFilter = filter.value; list.replaceChildren(...rows()); } });
    const list = h('div.scene-list');
    const rows = () => scenes.filter(s => !sceneFilter || (s.text + ' ' + s.syn).toLowerCase().includes(sceneFilter.toLowerCase())).map(s => {
      const pg = layout && layout.scenes.get(s.id);
      const row = h('div.scene-row' + (curInfo && curInfo.sceneId === s.id ? '.cur' : ''), {
        dataset: { id: s.id }, style: { borderLeftColor: s.color || 'transparent' },
        onclick: () => { editor.scrollToBlock(s.id); if (innerWidth < 980) setSide(false); },
        oncontextmenu: e => { e.preventDefault(); sceneMenu(s, { x: e.clientX, y: e.clientY }); },
      },
        h('span.num', s.num),
        h('span.hd', s.omit ? 'OMITTED' : (s.text || '(untitled scene)')),
        h('span.pg', pg ? `p${pg.page}` : ''),
        s.syn ? h('span.syn', s.syn) : null);
      return row;
    });
    list.append(...rows());
    sideBody.append(
      h('div.row', { style: { marginBottom: '6px' } }, filter, h('button.icon-btn', { type: 'button', title: 'Scene options', 'aria-label': 'Scene options', onclick: e => { const s = scenes.find(x => curInfo && x.id === curInfo.sceneId); if (s) sceneMenu(s, e.currentTarget); else toast('Put the cursor in a scene first'); } }, icon('more'))),
      scenes.length ? list : emptyState('No scenes yet', fmt.id === 'screenplay' ? 'Type a scene heading like “INT. KITCHEN - NIGHT”.' : 'Add a heading element to start a scene.'));
  }

  function highlightSceneRow() {
    if (sideTab !== 'scenes') return;
    for (const r of sideBody.querySelectorAll('.scene-row')) r.classList.toggle('cur', !!curInfo && r.dataset.id === curInfo.sceneId);
  }

  function sceneMenu(s, anchor) {
    const b = s.block;
    menu(anchor, [
      { label: 'Go to scene', onClick: () => editor.scrollToBlock(s.id) },
      { label: 'Edit synopsis…', onClick: async () => {
        const v = await promptDialog('Synopsis', s.syn, { title: `Scene ${s.num} synopsis`, multiline: true });
        if (v != null) editor.updateBlock(b.id, { s: { ...(b.s || {}), syn: v.trim() } });
      } },
      { heading: 'Color' },
      ...['', '#e5484d', '#f76b15', '#ffb224', '#30a46c', '#0090ff', '#8e4ec6', '#d6409f'].map(c => ({
        label: c ? c : 'None', swatch: c || 'transparent', checked: (b.s && b.s.color || '') === c,
        onClick: () => editor.updateBlock(b.id, { s: { ...(b.s || {}), color: c || undefined } }),
      })),
      { sep: true },
      { label: s.omit ? 'Restore omitted scene' : 'Omit scene (prints “OMITTED”)', onClick: () => editor.updateBlock(b.id, { s: { ...(b.s || {}), omit: !s.omit || undefined } }) },
      { label: 'Delete scene…', danger: true, onClick: async () => {
        if (!await confirmDialog(`Delete scene ${s.num} and all of its text?`, { title: 'Delete scene', ok: 'Delete', danger: true })) return;
        editor.flush();
        const blocks = doc.blocks.slice();
        blocks.splice(s.idx, s.end - s.idx);
        editor.replaceBlocks(blocks, 'delete-scene');
      } },
    ]);
  }

  const openComments = () => (doc.comments || []).filter(c => !c.done);
  let showResolved = false;
  function paintComments(focusId) {
    const all = (doc.comments || []).slice();
    const texts = new Map();
    for (const b of doc.blocks) for (const st of spanTexts(b.h, 'cm')) texts.set(st.id, (texts.get(st.id) || '') + st.text);
    const order = new Map(); let k = 0;
    for (const b of doc.blocks) for (const m of (b.h || '').matchAll(/data-cm="([^"]+)"/g)) if (!order.has(m[1])) order.set(m[1], k++);
    const list = all.filter(c => showResolved || !c.done).sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
    sideBody.append(h('div.row', { style: { marginBottom: '8px' } },
      h('button.btn.sm', { type: 'button', onclick: () => addComment() }, icon('plus'), 'Comment'),
      h('div.spacer'),
      h('label.check.small', h('input', { type: 'checkbox', checked: showResolved, onchange: e => { showResolved = e.target.checked; paintSide(); } }), 'Show resolved')));
    if (!list.length) sideBody.append(emptyState('No notes', 'Select text and press the comment button to leave a note on the script.'));
    for (const c of list) {
      const el = h('div.comment' + (c.done ? '.done' : '') + (focusId === c.id ? '.active' : ''),
        h('div.comment-meta', h('b', c.author || 'You'), h('span', timeAgo(c.ts)), h('div.spacer'),
          h('button.icon-btn', { type: 'button', title: c.done ? 'Reopen' : 'Resolve', 'aria-label': c.done ? 'Reopen' : 'Resolve', onclick: () => { c.done = !c.done; updateMarkCSS(project, doc); app.markDirty(); editor.drawMarkers(); paintSide(); } }, icon(c.done ? 'undo' : 'check')),
          h('button.icon-btn', { type: 'button', title: 'Delete', 'aria-label': 'Delete comment', onclick: async () => {
            if (!await confirmDialog('Delete this comment and its replies?', { ok: 'Delete', danger: true })) return;
            doc.comments = doc.comments.filter(x => x !== c);
            editor.unmark('cm', c.id);
            app.markDirty(); paintSide();
          } }, icon('trash'))),
        texts.get(c.id) ? h('div.comment-quote', { style: { cursor: 'pointer' }, onclick: () => goToComment(c.id) }, texts.get(c.id)) : h('div.small.muted', 'Text removed'),
        h('div.comment-text', c.text),
        (c.replies || []).map(r => h('div.reply', h('div.comment-meta', h('b', r.author || 'You'), h('span', timeAgo(r.ts))), h('div.comment-text', r.text))),
        h('div.row', { style: { marginTop: '6px' } }, h('button.link.small', { type: 'button', onclick: async () => {
          const v = await promptDialog('Reply', '', { title: 'Reply', multiline: true });
          if (v && v.trim()) { (c.replies = c.replies || []).push({ id: uid('r'), text: v.trim(), author: app.prefs.author || 'You', ts: Date.now() }); app.markDirty(); paintSide(c.id); }
        } }, 'Reply')));
      sideBody.append(el);
      if (focusId === c.id) setTimeout(() => { el.scrollIntoView({ block: 'nearest' }); goToComment(c.id); }, 0);
    }
  }

  function goToComment(id) {
    const b = doc.blocks.find(x => x.h && x.h.includes(`data-cm="${id}"`));
    if (!b) return;
    const runs = spanTexts(b.h, 'cm').find(s => s.id === id);
    const text = htmlToText(b.h);
    const start = runs ? text.indexOf(runs.text) : 0;
    editor.selectRange(b.id, Math.max(0, start), Math.max(0, start) + (runs ? runs.text.length : 0));
  }

  async function addComment() {
    const d = editor.selectionDetails();
    if (!d) return toast('Put the cursor in the script first');
    const v = await promptDialog(d.collapsed ? 'Comment on this element' : `Comment on “${d.text.slice(0, 60)}${d.text.length > 60 ? '…' : ''}”`, '', { title: 'New comment', multiline: true, ok: 'Add comment' });
    if (!v || !v.trim()) return;
    editor.focus();
    editor.setSel(d.sel, { scroll: false });
    const c = { id: uid('n'), text: v.trim(), author: app.prefs.author || 'You', ts: Date.now(), done: false, replies: [] };
    (doc.comments = doc.comments || []).push(c);
    editor.markSelection('cm', c.id);
    sideTab = 'comments';
    app.setPrefs({ sideTab: 'comments' });
    setSide(true);
  }

  function paintStats() {
    const scenes = getScenes(doc);
    const words = docWords(doc);
    const chars = characterStats(doc).sort((a, b) => b.words - a.words);
    const pages = layout ? layout.pageCount : 0;
    let dlg = 0, total = 0;
    for (const b of doc.blocks) { const n = wordCount(htmlToText(b.h)); total += n; if (typeDef(fmt, b.t).role === 'dialogue') dlg += n; }
    const ints = scenes.filter(s => /INT/.test(s.ie)).length, exts = scenes.filter(s => /EXT/.test(s.ie)).length;
    const day = doc.day || {};
    const today = day.date === todayISO() ? words - (day.words || 0) : 0;
    const goal = doc.goal || 0;
    const goalInput = h('input.input.sm', { type: 'number', min: 0, step: 50, value: goal || '', placeholder: 'e.g. 1000', style: { width: '110px' }, onchange: () => { doc.goal = Math.max(0, +goalInput.value || 0); app.markDirty(); paintSide(); } });
    sideBody.append(
      h('div.stat-grid',
        h('div.stat', h('b', pages), h('span', 'pages')),
        h('div.stat', h('b', estimateRuntime(pages).replace('~', '')), h('span', 'est. runtime')),
        h('div.stat', h('b', words.toLocaleString()), h('span', 'words')),
        h('div.stat', h('b', scenes.length), h('span', 'scenes')),
        h('div.stat', h('b', (today >= 0 ? '+' : '') + today.toLocaleString()), h('span', 'words today')),
        h('div.stat', h('b', (words - openedWords >= 0 ? '+' : '') + (words - openedWords).toLocaleString()), h('span', 'this session'))),
      h('div', { style: { margin: '14px 4px 6px' } }, h('div.row', h('b.grow', 'Daily goal'), goalInput, h('span.small.muted', 'words')),
        goal ? h('div', { style: { marginTop: '6px' } }, h('div.bar', h('i', { style: { width: Math.min(100, Math.max(0, today) / goal * 100) + '%' } })), h('div.small.muted', `${Math.max(0, today)} of ${goal} words today`)) : null),
      sprintBox(),
      h('div', { style: { margin: '14px 4px 6px' } }, h('b', 'Breakdown'),
        h('div.small.muted', `${total ? Math.round(dlg / total * 100) : 0}% dialogue · ${ints} INT · ${exts} EXT · ${scenes.filter(s => /NIGHT/.test(s.tod)).length} night scenes`)),
      h('div', { style: { margin: '14px 4px 6px' } }, h('b', 'Speaking parts'),
        chars.length ? chars.slice(0, 12).map(c => h('div.hbar', { style: { gridTemplateColumns: '1fr 70px 50px' } },
          h('span.ellipsis', c.name), h('div.bar', h('i', { style: { width: (c.words / (chars[0].words || 1) * 100) + '%' } })), h('span.small.muted', { style: { textAlign: 'right' } }, c.lines + ' ln'))) : h('div.small.muted', 'No dialogue yet')));
  }

  let sprint = null;
  function sprintBox() {
    const box = h('div', { style: { margin: '14px 4px 6px' } });
    const paint = () => {
      clear(box);
      box.append(h('b', 'Writing sprint'));
      if (sprint) {
        const left = Math.max(0, sprint.end - Date.now());
        const m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
        box.append(h('div.row', h('span', { style: { fontSize: '22px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' } }, `${m}:${String(s).padStart(2, '0')}`),
          h('span.small.muted.grow', `+${docWords(doc) - sprint.words} words`),
          h('button.btn.sm', { type: 'button', onclick: () => { clearInterval(sprint.t); sprint = null; paint(); } }, 'Stop')));
      } else {
        box.append(h('div.row.wrap', { style: { marginTop: '6px' } }, [10, 15, 25, 45].map(n => h('button.btn.sm', { type: 'button', onclick: () => {
          sprint = { end: Date.now() + n * 60000, words: docWords(doc) };
          sprint.t = setInterval(() => {
            if (Date.now() >= sprint.end) { const w = docWords(doc) - sprint.words; clearInterval(sprint.t); sprint = null; toast(`Sprint done: +${w} words`, { ms: 6000 }); }
            if (box.isConnected) paint();
          }, 1000);
          paint();
        } }, `${n} min`))));
      }
    };
    paint();
    return box;
  }

  function trackDay() {
    const t = todayISO();
    if (!doc.day || doc.day.date !== t) { doc.day = { date: t, words: docWords(doc) }; }
  }

  // ---------- status bar ----------
  function paintStatus() {
    const pages = layout ? layout.pageCount : 0;
    const cp = layout && curInfo ? layout.blockPage.get(curInfo.id) : null;
    const scenes = layout ? layout.scenes : null;
    const sc = curInfo && curInfo.sceneId && scenes ? scenes.get(curInfo.sceneId) : null;
    const active = doc.rev && doc.rev.active ? doc.rev.list.find(r => r.id === doc.rev.active) : null;
    clear(status);
    status.append(...[
      h('span', 'Page ', h('b', cp || '–'), ` of ${pages}`),
      sc ? h('span', 'Scene ', h('b', sc.num)) : null,
      h('span.hide-sm', `${docWords(doc).toLocaleString()} words`),
      h('span.hide-sm', estimateRuntime(pages)),
      curInfo ? h('span.hide-sm', curInfo.label) : null,
      active ? h('span', { style: { color: 'var(--accent)' } }, `● ${active.name} revision`) : null,
      breakdownMode ? h('span', { style: { color: 'var(--accent)' } }, '● Breakdown tagging') : null,
      doc.locked ? h('span.hide-sm', 'Scene numbers locked') : null].filter(Boolean));
  }

  // ---------- mobile element bar ----------
  function paintElembar() {
    clear(elembar);
    const t = curInfo ? curInfo.t : null;
    const btn = (label, fn, cls = '') => keep(h('button' + cls, { type: 'button', onclick: fn }, label));
    elembar.append(btn('⇥ Tab', () => editor.onTab(false), '.key'));
    for (const k of fmt.order) elembar.append(btn(fmt.types[k].label.replace(' Heading', '').replace('Parenthetical', 'Paren'), () => editor.setType(k), k === t ? '.on' : ''));
    elembar.append(btn('↶', () => editor.undo(), '.key'), btn('↷', () => editor.redo(), '.key'));
  }
  const vv = window.visualViewport;
  const placeElembar = () => {
    if (!vv) return;
    const offset = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    elembar.style.bottom = offset + 'px';
  };
  if (vv) { vv.addEventListener('resize', placeElembar); vv.addEventListener('scroll', placeElembar); }

  // ---------- selection popover (comment / tag) ----------
  let selPop = null;
  function updateSelPop() {
    const s = document.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount || !ed.contains(s.anchorNode)) { hideSelPop(); return; }
    const info = editor.getSel();
    if (!info || info.a.id !== info.f.id) { hideSelPop(); return; }
    const r = s.getRangeAt(0).getBoundingClientRect();
    if (!selPop) {
      selPop = h('div.sel-pop', { onpointerdown: e => e.preventDefault() });
      document.body.appendChild(selPop);
    }
    clear(selPop);
    selPop.append(
      h('button.icon-btn', { type: 'button', title: 'Comment', 'aria-label': 'Comment', onclick: () => { hideSelPop(); addComment(); } }, icon('comment')),
      h('button.icon-btn', { type: 'button', title: 'Tag for breakdown', 'aria-label': 'Tag for breakdown', onclick: e => tagMenu(e.currentTarget) }, icon('tag'), h('span.small', 'Tag')),
      h('button.icon-btn', { type: 'button', title: 'Bold', 'aria-label': 'Bold', onclick: () => editor.format('b') }, icon('bold')),
      h('button.icon-btn', { type: 'button', title: 'Italic', 'aria-label': 'Italic', onclick: () => editor.format('i') }, icon('italic')),
      h('button.icon-btn', { type: 'button', title: 'Underline', 'aria-label': 'Underline', onclick: () => editor.format('u') }, icon('underline')));
    const below = innerWidth < 760;
    let y = below ? r.bottom + 10 : r.top - 46;
    if (y < 60) y = r.bottom + 10;
    selPop.style.left = Math.max(8, Math.min(innerWidth - 230, r.left + r.width / 2 - 110)) + 'px';
    selPop.style.top = y + 'px';
  }
  function hideSelPop() { if (selPop) { selPop.remove(); selPop = null; } }
  scroller.addEventListener('scroll', hideSelPop, { passive: true });
  const onSelChange = debounce(updateSelPop, 120);
  document.addEventListener('selectionchange', onSelChange);

  function tagMenu(anchor) {
    const d = editor.selectionDetails();
    if (!d || d.collapsed || !d.sameBlock) return toast('Select a word or phrase inside one element to tag it.');
    const name = d.text.replace(/\s+/g, ' ').trim();
    if (!name) return;
    menu(anchor, [{ heading: `Tag “${name.slice(0, 30)}” as` }, ...CATEGORIES.filter(c => c.id !== 'location').map(c => ({
      label: c.label, swatch: c.color,
      onClick: () => applyTag(c.id, name, d),
    }))]);
  }

  function applyTag(cat, name, d) {
    const item = findCatalog(project, cat, name) || addCatalog(project, cat, cat === 'cast' ? upperSafe(name) : name);
    editor.focus();
    editor.setSel(d.sel, { scroll: false });
    editor.markSelection('tg', item.id, { singleBlock: true, wholeBlockIfEmpty: false });
    updateMarkCSS(project, doc);
    if (!breakdownMode) setBreakdown(true);
    hideSelPop();
    app.markDirty();
    const others = editor.find(name, { wholeWord: true }).length - 1;
    toast(`Tagged “${name}” as ${CAT[cat].label}`, others > 0 ? { ms: 6000, action: { label: `Tag all ${others + 1}`, run: () => { const n = editor.tagOccurrences(name, item.id); toast(`Tagged ${n} more`); } } } : {});
  }

  function tagPopover(id, span) {
    const item = project.catalog.find(c => c.id === id);
    const r = span.getBoundingClientRect();
    menu({ x: r.left, y: r.bottom + 4 }, [
      { heading: item ? `${item.name} · ${(CAT[item.cat] || CAT.misc).label}` : 'Missing catalog item' },
      item ? { label: 'Open in catalog', onClick: () => app.go(`#/p/${project.id}/catalog/${item.id}`) } : null,
      item ? { label: 'Change category…', onClick: () => menu({ x: r.left, y: r.bottom + 4 }, CATEGORIES.map(c => ({ label: c.label, swatch: c.color, checked: c.id === item.cat, onClick: () => { item.cat = c.id; updateMarkCSS(project, doc); app.markDirty(); } }))) } : null,
      { label: 'Remove this tag everywhere', danger: true, onClick: () => { editor.unmark('tg', id); app.markDirty(); } },
    ]);
  }

  function setBreakdown(on) {
    breakdownMode = on;
    ed.classList.toggle('bd', on);
    bdBtn.classList.toggle('on', on);
    paintStatus();
    if (on) toast('Breakdown mode: select text and choose “Tag” to add it to the catalog.', { ms: 3500 });
  }

  // ---------- find & replace ----------
  let matches = [], mi = -1;
  const findIn = h('input.input', { type: 'search', placeholder: 'Find', 'aria-label': 'Find' });
  const replIn = h('input.input', { type: 'text', placeholder: 'Replace with', 'aria-label': 'Replace with' });
  const caseCb = h('input', { type: 'checkbox' });
  const wordCb = h('input', { type: 'checkbox' });
  const countEl = h('span.find-count');
  findBar.append(findIn,
    h('button.icon-btn', { type: 'button', title: 'Previous', 'aria-label': 'Previous match', onclick: () => step(-1) }, icon('arrowUp')),
    h('button.icon-btn', { type: 'button', title: 'Next', 'aria-label': 'Next match', onclick: () => step(1) }, icon('arrowDown')),
    countEl, replIn,
    h('button.btn.sm', { type: 'button', onclick: () => replaceOne() }, 'Replace'),
    h('button.btn.sm', { type: 'button', onclick: () => replaceAll() }, 'All'),
    h('label.check.small', caseCb, 'Match case'), h('label.check.small', wordCb, 'Whole word'),
    h('div.spacer'),
    h('button.icon-btn', { type: 'button', title: 'Close', 'aria-label': 'Close find', onclick: () => closeFind() }, icon('close')));
  const runFind = debounce(() => {
    matches = editor.find(findIn.value, { caseSensitive: caseCb.checked, wholeWord: wordCb.checked });
    mi = matches.length ? 0 : -1;
    countEl.textContent = findIn.value ? (matches.length ? `1 of ${matches.length}` : 'No results') : '';
    if (mi >= 0) { const m = matches[0]; editor.selectRange(m.id, m.start, m.end); findIn.focus(); }
  }, 200);
  findIn.addEventListener('input', runFind);
  caseCb.addEventListener('change', runFind);
  wordCb.addEventListener('change', runFind);
  findIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') closeFind(); });
  replIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } if (e.key === 'Escape') closeFind(); });
  function step(dir) {
    if (!matches.length) { runFind(); return; }
    mi = (mi + dir + matches.length) % matches.length;
    const m = matches[mi];
    countEl.textContent = `${mi + 1} of ${matches.length}`;
    editor.selectRange(m.id, m.start, m.end);
    findIn.focus();
  }
  function replaceOne() {
    if (mi < 0 || !matches[mi]) return;
    editor.replaceMatches([matches[mi]], replIn.value);
    const prevIndex = mi;
    matches = editor.find(findIn.value, { caseSensitive: caseCb.checked, wholeWord: wordCb.checked });
    mi = Math.min(prevIndex, matches.length - 1);
    countEl.textContent = matches.length ? `${mi + 1} of ${matches.length}` : 'No results';
    if (mi >= 0) editor.selectRange(matches[mi].id, matches[mi].start, matches[mi].end);
  }
  function replaceAll() {
    if (!matches.length) return;
    const n = matches.length;
    editor.replaceMatches(matches, replIn.value);
    matches = []; mi = -1;
    countEl.textContent = `Replaced ${n}`;
  }
  function openFind(focusReplace = false) {
    findBar.classList.remove('hidden');
    const d = editor.selectionDetails();
    if (d && !d.collapsed && d.sameBlock && d.text.length < 80) findIn.value = d.text;
    (focusReplace ? replIn : findIn).focus();
    findIn.select();
    if (findIn.value) runFind();
  }
  function closeFind() { if (findBar.classList.contains('hidden')) return; findBar.classList.add('hidden'); editor.focus(); }

  // ---------- revisions ----------
  function revisionMenu(anchor) {
    const rev = doc.rev || (doc.rev = { list: [], active: null });
    const active = rev.active ? rev.list.find(r => r.id === rev.active) : null;
    const next = REVISION_COLORS[(rev.list.length + 1) % REVISION_COLORS.length];
    menu(anchor, [
      { heading: active ? `Tracking: ${active.name} revision` : 'Revision mode is off' },
      active
        ? { label: 'Stop tracking changes', onClick: () => { rev.active = null; app.markDirty(); revBtn.classList.remove('on'); paintStatus(); } }
        : { label: `Start ${next.name} revision…`, onClick: startRevision },
      rev.list.length && !active ? { label: `Resume ${rev.list[rev.list.length - 1].name} revision`, onClick: () => { rev.active = rev.list[rev.list.length - 1].id; app.markDirty(); revBtn.classList.add('on'); paintStatus(); } } : null,
      { sep: true },
      { label: 'Show revision marks', checked: project.settings.showRevMarks !== false, onClick: () => { project.settings.showRevMarks = project.settings.showRevMarks === false; app.markDirty(); scheduleLayout(); editor.drawMarkers(); } },
      { label: 'Tint revised pages in PDF', checked: !!project.settings.revTint, onClick: () => { project.settings.revTint = !project.settings.revTint; app.markDirty(); } },
      { label: doc.locked ? 'Unlock scene numbers' : 'Lock scene numbers', onClick: () => {
        const blocks = doc.locked ? unlockSceneNumbers(doc) : lockSceneNumbers(doc);
        editor.replaceBlocks(blocks, 'lock');
        toast(doc.locked ? 'Scene numbers locked. New scenes get A/B numbers (12A).' : 'Scene numbers unlocked and renumbered.');
      } },
      { sep: true },
      { label: 'Clear all revision marks…', disabled: !doc.blocks.some(b => b.r), onClick: async () => {
        if (!await confirmDialog('Remove every revision mark from this script? Revision history (the list of colors) is kept.', { ok: 'Clear marks' })) return;
        editor.replaceBlocks(doc.blocks.map(b => { if (!b.r) return b; const c = { ...b }; delete c.r; return c; }), 'clear-rev');
      } },
      { label: 'Save a named version…', onClick: saveVersion },
    ]);
  }
  async function startRevision() {
    const rev = doc.rev;
    const nextIdx = (rev.list.length + 1) % REVISION_COLORS.length;
    const sel = h('select.input', REVISION_COLORS.map((c, i) => h('option', { value: i }, c.name)));
    sel.value = String(nextIdx);
    const date = h('input.input', { type: 'date', value: todayISO() });
    const snap = h('input', { type: 'checkbox', checked: true });
    const res = await modal({
      title: 'Start a revision',
      body: h('div.form',
        h('p', 'Changes you make while tracking are marked with an asterisk (*) in the right margin, and pages with changes show the revision in the header, as in production drafts.'),
        field('Revision color', sel), field('Date', date), h('label.check', snap, 'Save the current script as a version first')),
      buttons: [{ label: 'Cancel' }, { label: 'Start', primary: true, value: true }],
    });
    if (!res) return;
    const c = REVISION_COLORS[+sel.value];
    if (snap.checked) { editor.flush(); await store.addVersion({ pid: project.id, docId: doc.id, name: `Before ${c.name} revision`, doc }); }
    const d = date.value ? new Date(date.value + 'T12:00') : new Date();
    const r = { id: uid('r'), name: c.name, color: c.color, date: `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}` };
    rev.list.push(r);
    rev.active = r.id;
    revBtn.classList.add('on');
    app.markDirty();
    paintStatus();
    toast(`${c.name} revision started`);
  }
  revBtn.classList.toggle('on', !!(doc.rev && doc.rev.active));

  async function saveVersion() {
    const v = await promptDialog('Version name', `Draft ${fmtDate(Date.now())}`, { title: 'Save version' });
    if (v == null) return;
    editor.flush();
    await store.addVersion({ pid: project.id, docId: doc.id, name: v.trim() || 'Untitled version', doc });
    toast('Version saved. See Version History to compare or restore.');
  }

  // ---------- title page ----------
  async function editTitlePage() { if (await editTitlePageModal(doc)) { app.markDirty(); toast('Title page saved'); } }

  // ---------- preview / export ----------
  function currentLayout() { editor.flush(); layout = layoutScript(doc, project); doc.pages = layout.pageCount; return layout; }
  const allPages = L => (L.titlePage ? [L.titlePage, ...L.pages] : L.pages);

  async function openPreview() {
    const L = currentLayout();
    const sheets = h('div.sheets');
    const fit = () => sheets.style.setProperty('--u', Math.min(96, (Math.min(innerWidth, 900) - 56) / 8.5) + 'px');
    renderSheets(sheets, allPages(L));
    fit();
    await modal({
      title: `Preview: ${plural(L.pageCount, 'page')}`, wide: true, className: 'preview-modal',
      body: h('div', { style: { background: 'var(--desk)', margin: '0 -20px -16px', borderRadius: '0 0 14px 14px' } }, sheets),
      buttons: [
        { label: 'Print…', onClick: () => { doPrint(L); return true; } },
        { label: 'Download PDF', primary: true, onClick: async () => { await exportPDF(L); return false; } },
      ],
    });
  }

  async function exportPDF(L = currentLayout(), name = docLabel(doc), pages = allPages(L)) {
    const blob = await buildPDF(pages, { title: name, author: doc.tp.author || project.author || '' });
    download(`${slug(name)}.pdf`, blob, 'application/pdf');
  }
  function doPrint(L = currentLayout()) { printSheets(allPages(L), project.settings.paper); }

  function exportMenu(anchor) {
    const name = docLabel(doc);
    menu(anchor, [
      { label: 'PDF (industry format)', hint: '.pdf', onClick: () => exportPDF() },
      { label: 'Final Draft', hint: '.fdx', onClick: () => { editor.flush(); download(`${slug(name)}.fdx`, toFDX(doc), 'application/xml'); } },
      { label: 'Fountain', hint: '.fountain', onClick: () => { editor.flush(); download(`${slug(name)}.fountain`, toFountain(doc), 'text/plain'); } },
      { label: 'Plain text (formatted)', hint: '.txt', onClick: () => download(`${slug(name)}.txt`, pagesToText(currentLayout()), 'text/plain') },
      { sep: true },
      { label: 'Print…', hint: `${modKey}+P`, onClick: () => doPrint() },
      fmt.production ? { label: 'Sides for selected scenes (PDF)…', onClick: exportSides } : null,
      { label: 'Save a named version…', onClick: saveVersion },
    ], { align: 'right' });
  }

  async function exportSides() {
    const L = currentLayout();
    const scenes = getScenes(doc);
    const checks = scenes.map(s => ({ s, cb: h('input', { type: 'checkbox', checked: curInfo && curInfo.sceneId === s.id }) }));
    const res = await modal({
      title: 'Sides', wide: true,
      body: h('div.form', h('p', 'Pick the scenes for the day. Each page that contains them is included; text from other scenes on those pages is grayed out.'),
        h('div', { style: { maxHeight: '50vh', overflow: 'auto' } }, checks.map(({ s, cb }) => h('label.check', { style: { display: 'flex', padding: '4px 0' } }, cb, h('span', h('b', s.num + '. '), s.text))))),
      buttons: [{ label: 'Cancel' }, { label: 'Download PDF', primary: true, value: true }],
    });
    if (!res) return;
    const sel = new Set(checks.filter(c => c.cb.checked).map(c => c.s.id));
    if (!sel.size) return toast('No scenes selected');
    const pages = L.pages.filter(p => p.items.some(it => it.sid && sel.has(it.sid)))
      .map(p => ({ ...p, items: p.items.map(it => (it.sid && !sel.has(it.sid) ? { ...it, gray: true } : it)) }));
    await exportPDF(L, `${docLabel(doc)} sides`, pages);
  }

  function viewMenu(anchor) {
    const L = app.prefs.layout;
    menu(anchor, [
      { heading: 'Page layout' },
      { label: 'Automatic', checked: L === 'auto', onClick: () => { app.setPrefs({ layout: 'auto' }); applyLayoutMode(); } },
      { label: 'Exact page (8.5 × 11)', checked: L === 'page', onClick: () => { app.setPrefs({ layout: 'page' }); applyLayoutMode(); } },
      { label: 'Fit to screen', checked: L === 'fluid', onClick: () => { app.setPrefs({ layout: 'fluid' }); applyLayoutMode(); } },
      { label: 'Zoom in', hint: Math.round((app.prefs.zoom || 1) * 100) + '%', onClick: () => { app.setPrefs({ zoom: Math.min(2, (app.prefs.zoom || 1) + 0.1) }); applyLayoutMode(); } },
      { label: 'Zoom out', onClick: () => { app.setPrefs({ zoom: Math.max(0.6, (app.prefs.zoom || 1) - 0.1) }); applyLayoutMode(); } },
      { sep: true },
      { label: 'Focus mode', checked: ctx.shell.classList.contains('focus-mode'), onClick: () => ctx.shell.classList.toggle('focus-mode') },
      { label: 'Typewriter scrolling', checked: !!app.prefs.typewriter, onClick: () => app.setPrefs({ typewriter: !app.prefs.typewriter }) },
      { label: 'Spell check', checked: app.prefs.spellcheck !== false, onClick: () => { app.setPrefs({ spellcheck: !app.prefs.spellcheck }); ed.spellcheck = app.prefs.spellcheck; } },
      { label: 'Highlight comments', checked: !ed.classList.contains('hide-cm'), onClick: () => ed.classList.toggle('hide-cm') },
      { label: 'Dark mode', checked: app.isDark(), onClick: () => app.setPrefs({ theme: app.isDark() ? 'light' : 'dark' }) },
      { sep: true },
      { label: 'Script format settings…', onClick: () => app.go(`#/p/${project.id}/settings`) },
      { label: 'Keyboard shortcuts', onClick: shortcutsHelp },
    ], { align: 'right' });
  }

  function shortcutsHelp() {
    const row = (k, d) => h('tr', h('td', { style: { padding: '4px 12px 4px 0', whiteSpace: 'nowrap' } }, k.split(' ').map(x => [h('span.kbd', x), ' '])), h('td', d));
    modal({
      title: 'Keyboard shortcuts',
      body: h('table', h('tbody',
        row('Enter', 'New element (scene heading → action, character → dialogue…). On an empty element: change type.'),
        row('Tab', 'Change element type (action → character, dialogue → parenthetical…)'),
        row('Shift Tab', 'Change element type backwards'),
        row('Alt 1…9', fmt.order.map((t, i) => `${i + 1} ${fmt.types[t].label}`).slice(0, 9).join(' · ')),
        row('Shift Enter', 'Line break inside an element'),
        row(`${modKey} B / I / U`, 'Bold / italic / underline'),
        row(`${modKey} Z`, 'Undo'), row(`${modKey} Shift Z`, 'Redo'),
        row(`${modKey} F`, 'Find & replace'),
        row(`${modKey} Alt C`, 'Comment on selection'),
        row(`${modKey} P`, 'Print'), row(`${modKey} Shift P`, 'Preview pages'),
        row(`${modKey} S`, 'Save now (saving is automatic)'),
        row('INT. / EXT.', 'Typed at the start of an action line, turns it into a scene heading'))),
      buttons: [{ label: 'Close', primary: true }],
    });
  }

  // ---------- daily automatic version ----------
  (async () => {
    try {
      const t = todayISO();
      if (doc.autoVer !== t && doc.blocks.length > 1) {
        await store.addVersion({ pid: project.id, docId: doc.id, name: `Automatic snapshot`, auto: true, doc });
        doc.autoVer = t;
        const vs = (await store.listVersions(project.id, doc.id)).filter(v => v.auto);
        for (const v of vs.slice(14)) await store.deleteVersion(v.id);
      }
    } catch (e) { console.warn('auto version failed', e); }
  })();

  // ---------- init ----------
  applySide();
  applyLayoutMode();
  paintElembar();
  scheduleLayout();
  scheduleLayout.flush();
  placeElembar();
  if (app.pendingBreakdown) { app.pendingBreakdown = false; setBreakdown(true); }
  requestAnimationFrame(() => {
    if (app.pendingScroll) { const id = app.pendingScroll; app.pendingScroll = null; editor.scrollToBlock(id); return; }
    if (doc.blocks.length === 1 && !doc.blocks[0].h) { editor.focus(); editor.setSel(editor.caret(doc.blocks[0].id, 0)); editor.updateCurrent(); editor.updateAC(); }
  });

  return {
    cleanup() {
      editor.destroy();
      ro.disconnect();
      scheduleLayout.cancel();
      refreshSideLater.cancel();
      document.removeEventListener('selectionchange', onSelChange);
      if (vv) { vv.removeEventListener('resize', placeElembar); vv.removeEventListener('scroll', placeElembar); }
      hideSelPop();
      closeMenu();
      if (sprint) clearInterval(sprint.t);
      ctx.shell.classList.remove('focus-mode');
    },
  };
}
