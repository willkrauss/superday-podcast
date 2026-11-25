// Block-based script editor on a single contenteditable root.
// Each element (scene heading, action, dialogue...) is a <div class="el" data-id data-t>.
// Typing inside an element is native; anything that changes structure (Enter, Tab, Backspace at a
// boundary, multi-element selections, paste, cut, undo) is performed on the model and re-rendered
// with a keyed diff. A MutationObserver plus a reconcile pass repair anything the browser does natively.
import { h, uid, debounce, isMac } from './util.js';
import { getFormat, typeDef, SCENE_PREFIXES, SCENE_TIMES, TRANSITIONS, CHAR_EXTENSIONS, convertType } from './formats.js';
import {
  sanitizeNode, htmlToRuns, runsToHTML, htmlToText, textToHTML, domHTML, splitRuns, deleteRuns, insertRuns,
  applyAttr, runsLen, runsText, upperSafe, unwrapSpan, runsStyleAt,
} from './inline.js';
import { numberWord } from './util.js';

const OBS = { childList: true, subtree: true, characterData: true };
const HEAD_PREFIX = /^\s*(INT\.\s*\/\s*EXT\.|EXT\.\s*\/\s*INT\.|INT\.|EXT\.|I\/E\.?|EST\.)\s*/i;

function leaves(el) {
  const out = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => (n.nodeType === 3 || n.tagName === 'BR') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP,
  });
  let n;
  while ((n = w.nextNode())) out.push(n);
  return out;
}
const idxOf = n => Array.prototype.indexOf.call(n.parentNode.childNodes, n);

export class ScriptEditor {
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.doc = opts.doc;
    this.fmt = getFormat(this.doc.fmt);
    this.els = new Map();
    this.dirty = new Set();
    this.structDirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.lastKind = null;
    this.lastTime = 0;
    this.ac = null;
    this.savedSel = null;
    this.curEl = null;
    this.composing = false;
    this.namesCache = null;

    root.classList.add('ed');
    root.dataset.fmt = this.fmt.id;
    root.contentEditable = opts.readOnly ? 'false' : 'true';
    root.spellcheck = opts.spellcheck !== false;
    root.setAttribute('role', 'textbox');
    root.setAttribute('aria-multiline', 'true');
    root.setAttribute('aria-label', 'Script editor');
    root.setAttribute('autocapitalize', 'sentences');

    this.flushLater = debounce(() => this.flush(), 220);
    this.markersLater = debounce(() => this.drawMarkers(), 60);
    this.mo = new MutationObserver(m => this.onMutations(m));
    this.render();
    this.mo.observe(root, OBS);
    this.lastState = this.snapshot();

    this.h = {
      keydown: e => this.onKeyDown(e),
      beforeinput: e => this.onBeforeInput(e),
      input: e => this.onInput(e),
      paste: e => this.onPaste(e),
      copy: e => this.onCopy(e, false),
      cut: e => this.onCopy(e, true),
      dragstart: e => e.preventDefault(),
      drop: e => e.preventDefault(),
      compositionstart: () => { this.composing = true; },
      compositionend: () => { this.composing = false; this.flushLater(); this.updateAC(); },
      click: e => this.onClick(e),
      blur: () => { this.flush(); setTimeout(() => { if (!this.root.contains(document.activeElement)) this.closeAC(); }, 150); },
      sel: () => this.onSelChange(),
    };
    for (const k of ['keydown', 'beforeinput', 'input', 'paste', 'copy', 'cut', 'dragstart', 'drop', 'compositionstart', 'compositionend', 'click', 'blur']) root.addEventListener(k, this.h[k]);
    document.addEventListener('selectionchange', this.h.sel);
    this.ro = new ResizeObserver(() => this.markersLater());
    this.ro.observe(root);
  }

  destroy() {
    this.flush();
    for (const k of ['keydown', 'beforeinput', 'input', 'paste', 'copy', 'cut', 'dragstart', 'drop', 'compositionstart', 'compositionend', 'click', 'blur']) this.root.removeEventListener(k, this.h[k]);
    document.removeEventListener('selectionchange', this.h.sel);
    this.mo.disconnect();
    this.ro.disconnect();
    this.flushLater.cancel();
    this.markersLater.cancel();
    this.closeAC();
  }

  // ---------- rendering ----------

  render() {
    const root = this.root;
    this.mo.takeRecords();
    this.mo.disconnect();
    const existing = new Map();
    for (const n of Array.from(root.childNodes)) {
      const id = n.nodeType === 1 && n.dataset ? n.dataset.id : null;
      if (id && !existing.has(id)) existing.set(id, n); else n.remove();
    }
    this.els = new Map();
    let prev = null;
    for (const b of this.doc.blocks) {
      let el = existing.get(b.id);
      if (el) { existing.delete(b.id); if (el._b !== b) this.updateEl(el, b); }
      else el = this.createEl(b);
      const want = prev ? prev.nextSibling : root.firstChild;
      if (want !== el) root.insertBefore(el, want);
      prev = el;
      this.els.set(b.id, el);
    }
    for (const el of existing.values()) el.remove();
    if (this.curEl && !this.curEl.isConnected) this.curEl = null;
    this.mo.observe(root, OBS);
    this.markersLater();
  }

  createEl(b) {
    const el = document.createElement('div');
    el.className = 'el';
    el.dataset.id = b.id;
    this.updateEl(el, b, true);
    return el;
  }

  updateEl(el, b, force) {
    if (el.dataset.t !== b.t) { el.dataset.t = b.t; }
    el.dataset.ph = typeDef(this.fmt, b.t).label;
    if (force || el._h !== b.h) { el.innerHTML = domHTML(b.h); el._h = b.h; }
    const set = (k, v) => { if (v) el.setAttribute(k, v === true ? '' : v); else el.removeAttribute(k); };
    set('data-dual', !!b.d);
    set('data-rev', b.r || '');
    set('data-omit', !!(b.s && b.s.omit));
    set('data-pbf', !!b.pb);
    if (b.s && b.s.color) el.style.setProperty('--scene-color', b.s.color); else el.style.removeProperty('--scene-color');
    el.classList.toggle('empty', !b.h);
    el._b = b;
  }

  // ---------- DOM -> model ----------

  onMutations(muts) {
    if (!muts.length) return;
    for (const m of muts) {
      const t = m.target;
      if (t === this.root) { this.structDirty = true; continue; }
      const base = t.nodeType === 1 ? t : t.parentNode;
      const el = base && base.closest ? base.closest('.el') : null;
      if (!el || el.parentNode !== this.root) { this.structDirty = true; continue; }
      this.dirty.add(el);
    }
    this.flushLater();
    this.markersLater();
  }

  flush() {
    this.onMutations(this.mo.takeRecords());
    this.flushLater.cancel();
    if (!this.structDirty && !this.dirty.size) return false;
    let changed = false;
    if (this.structDirty) changed = this.reconcile();
    else {
      for (const el of this.dirty) {
        if (!el.isConnected) { changed = this.reconcile() || changed; break; }
        const b = el._b;
        const hh = sanitizeNode(el);
        if (b && hh !== b.h) {
          const i = this.doc.blocks.indexOf(b);
          if (i >= 0) {
            const nb = { ...b, h: hh };
            this.doc.blocks[i] = nb;
            el._b = nb; el._h = hh;
            changed = true;
          } else { changed = this.reconcile() || changed; break; }
        }
        el.classList.toggle('empty', !hh);
      }
    }
    this.dirty.clear();
    this.structDirty = false;
    if (changed) this.commit('typing');
    return changed;
  }

  reconcile() {
    this.mo.takeRecords();
    this.mo.disconnect();
    const byId = new Map(this.doc.blocks.map(b => [b.id, b]));
    const seen = new Set();
    const out = [];
    let lastType = this.fmt.first;
    let node = this.root.firstChild;
    while (node) {
      let next = node.nextSibling;
      if (node.nodeType === 1 && (node.tagName === 'DIV' || node.tagName === 'P')) {
        let el = node;
        if (node.tagName === 'P') { el = document.createElement('div'); el.append(...node.childNodes); for (const a of node.attributes) el.setAttribute(a.name, a.value); node.replaceWith(el); }
        el.className = 'el' + (el.classList.contains('cur') ? ' cur' : '');
        let inner;
        while ((inner = el.querySelector('div,p'))) {
          if (inner.previousSibling) inner.before(document.createElement('br'));
          inner.replaceWith(...inner.childNodes);
        }
        let id = el.dataset.id;
        if (!id || seen.has(id)) { id = uid('b'); el.dataset.id = id; }
        seen.add(id);
        let t = el.dataset.t;
        if (!t || !this.fmt.types[t]) t = lastType;
        el.dataset.t = t;
        const old = byId.get(id);
        const hh = sanitizeNode(el);
        let b = old;
        if (!old || old.h !== hh || old.t !== t) b = { ...(old || {}), id, t, h: hh };
        el._b = b; el._h = hh;
        out.push(b);
        lastType = t;
      } else if (node.nodeType === 3 && !node.data.replace(/[\s​﻿]/g, '')) {
        node.remove();
      } else if (node.nodeType === 1 && node.tagName === 'BR' && (!node.previousSibling || node.previousSibling.nodeType === 1)) {
        node.remove();
      } else {
        const el = document.createElement('div');
        el.className = 'el';
        el.dataset.id = uid('b');
        el.dataset.t = lastType;
        this.root.insertBefore(el, node);
        let n = node;
        while (n && !(n.nodeType === 1 && (n.tagName === 'DIV' || n.tagName === 'P'))) { const nx = n.nextSibling; el.appendChild(n); n = nx; }
        next = el;
      }
      node = next;
    }
    let changed = out.length !== this.doc.blocks.length || out.some((b, i) => b !== this.doc.blocks[i]);
    if (!out.length) { out.push({ id: uid('b'), t: this.fmt.first, h: '' }); changed = true; }
    this.doc.blocks = out;
    this.mo.observe(this.root, OBS);
    this.render();
    return changed;
  }

  // ---------- history ----------

  snapshot() { return { blocks: this.doc.blocks.slice(), sel: this.getSel() }; }

  commit(kind = 'edit') {
    const now = Date.now();
    if (this.doc.rev && this.doc.rev.active) this.markRevisions();
    const merge = kind === 'typing' && this.lastKind === 'typing' && now - this.lastTime < 1500;
    if (!merge) {
      this.undoStack.push(this.lastState);
      if (this.undoStack.length > 500) this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.lastState = this.snapshot();
    this.lastKind = kind;
    this.lastTime = now;
    this.namesCache = null;
    this.markersLater();
    this.opts.onChange && this.opts.onChange(kind);
  }

  // Mark only real content changes (text or element type), not metadata like scene numbers or synopses.
  markRevisions() {
    const prev = new Map(this.lastState.blocks.map(b => [b.id, b]));
    const active = this.doc.rev.active;
    this.doc.blocks.forEach((b, i) => {
      const old = prev.get(b.id);
      if (old === b || b.r === active) return;
      if (!old || old.h !== b.h || old.t !== b.t) {
        const nb = { ...b, r: active };
        this.doc.blocks[i] = nb;
        const el = this.els.get(b.id);
        if (el) { el._b = nb; el.setAttribute('data-rev', active); }
      }
    });
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    this.flush();
    if (!this.undoStack.length) return;
    const cur = this.snapshot();
    const st = this.undoStack.pop();
    this.redoStack.push(cur);
    this.restore(st);
  }

  redo() {
    this.flush();
    if (!this.redoStack.length) return;
    const cur = this.snapshot();
    const st = this.redoStack.pop();
    this.undoStack.push(cur);
    this.restore(st);
  }

  restore(st) {
    this.doc.blocks = st.blocks.slice();
    this.render();
    this.focus();
    if (st.sel) this.setSel(st.sel);
    this.lastState = this.snapshot();
    this.lastKind = 'undo';
    this.namesCache = null;
    this.opts.onChange && this.opts.onChange('undo');
  }

  // ---------- selection ----------

  focus() { try { this.root.focus({ preventScroll: true }); } catch {} }

  textLenDOM(el) {
    const L = leaves(el);
    const lastBr = L.length && L[L.length - 1].nodeType === 1 ? L[L.length - 1] : null;
    let n = 0;
    for (const x of L) n += x.nodeType === 3 ? x.data.length : (x === lastBr ? 0 : 1);
    return n;
  }

  domText(el) {
    const L = leaves(el);
    const lastBr = L.length && L[L.length - 1].nodeType === 1 ? L[L.length - 1] : null;
    return L.map(x => x.nodeType === 3 ? x.data : (x === lastBr ? '' : '\n')).join('').replace(/ /g, ' ');
  }

  offsetIn(el, node, off) {
    const L = leaves(el);
    const lastBr = L.length && L[L.length - 1].nodeType === 1 ? L[L.length - 1] : null;
    const len = n => n.nodeType === 3 ? n.data.length : (n === lastBr ? 0 : 1);
    let acc = 0;
    if (node.nodeType === 3) {
      for (const n of L) { if (n === node) return acc + Math.min(off, n.data.length); acc += len(n); }
      return acc;
    }
    const r = document.createRange();
    try { r.setStart(node, off); } catch { return 0; }
    r.collapse(true);
    for (const n of L) {
      let before;
      try { before = r.comparePoint(n.parentNode, idxOf(n)) < 0; } catch { before = false; }
      if (!before) break;
      acc += len(n);
    }
    return acc;
  }

  locate(el, off) {
    const L = leaves(el);
    const lastBr = L.length && L[L.length - 1].nodeType === 1 ? L[L.length - 1] : null;
    let acc = 0;
    for (const n of L) {
      if (n.nodeType === 3) {
        if (off <= acc + n.data.length) return [n, Math.max(0, off - acc)];
        acc += n.data.length;
      } else {
        if (n === lastBr) break;
        if (off <= acc) return [n.parentNode, idxOf(n)];
        acc += 1;
      }
    }
    if (lastBr) return [lastBr.parentNode, idxOf(lastBr)];
    return [el, el.childNodes.length];
  }

  posOf(node, off) {
    if (!node) return null;
    if (node === this.root) {
      const kids = this.root.children;
      if (!kids.length) return null;
      if (off >= kids.length) { const el = kids[kids.length - 1]; return { id: el.dataset.id, off: this.textLenDOM(el) }; }
      return { id: kids[off].dataset.id, off: 0 };
    }
    const base = node.nodeType === 1 ? node : node.parentNode;
    const el = base && base.closest ? base.closest('.el') : null;
    if (!el || el.parentNode !== this.root) return null;
    return { id: el.dataset.id, off: this.offsetIn(el, node, off) };
  }

  getSel() {
    const s = document.getSelection();
    if (!s || !s.rangeCount || !this.root.contains(s.anchorNode) || !this.root.contains(s.focusNode)) return this.savedSel;
    const a = this.posOf(s.anchorNode, s.anchorOffset), f = this.posOf(s.focusNode, s.focusOffset);
    if (!a || !f) return this.savedSel;
    return { a, f };
  }

  setSel(sel, { scroll = true } = {}) {
    if (!sel) return;
    const ea = this.els.get(sel.a.id), ef = this.els.get(sel.f.id);
    if (!ea || !ef) return;
    const [an, ao] = this.locate(ea, sel.a.off);
    const [fn, fo] = this.locate(ef, sel.f.off);
    const s = document.getSelection();
    if (document.activeElement !== this.root) this.focus();
    try { s.setBaseAndExtent(an, ao, fn, fo); } catch {}
    this.savedSel = sel;
    if (scroll) this.scrollCaretIntoView();
  }

  caret(id, off) { return { a: { id, off }, f: { id, off } }; }
  collapsed(sel) { return sel.a.id === sel.f.id && sel.a.off === sel.f.off; }
  idx(id) { return this.doc.blocks.findIndex(b => b.id === id); }
  cmp(p, q) { const a = this.idx(p.id), b = this.idx(q.id); return a !== b ? a - b : p.off - q.off; }
  ordered(sel) { return this.cmp(sel.a, sel.f) <= 0 ? { s: sel.a, e: sel.f } : { s: sel.f, e: sel.a }; }

  scrollCaretIntoView(center = false) {
    const sc = this.opts.scroller;
    if (!sc) return;
    const s = document.getSelection();
    if (!s.rangeCount) return;
    let rect = s.getRangeAt(0).getBoundingClientRect();
    if (!rect || (!rect.top && !rect.bottom)) {
      const el = this.els.get(this.savedSel && this.savedSel.f.id);
      if (!el) return;
      rect = el.getBoundingClientRect();
    }
    const sr = sc.getBoundingClientRect();
    const vv = window.visualViewport;
    const visBottom = Math.min(sr.bottom, vv ? vv.height + vv.offsetTop : innerHeight) - (this.opts.bottomInset ? this.opts.bottomInset() : 0);
    if (center) {
      const target = sr.top + (visBottom - sr.top) * 0.42;
      sc.scrollTop += rect.top - target;
    } else if (rect.bottom > visBottom - 40) sc.scrollTop += rect.bottom - visBottom + 80;
    else if (rect.top < sr.top + 40) sc.scrollTop -= sr.top + 80 - rect.top;
  }

  onSelChange() {
    const s = document.getSelection();
    if (!s || !s.rangeCount || !this.root.contains(s.anchorNode)) return;
    if (this.selRaf) return;
    this.selRaf = requestAnimationFrame(() => { this.selRaf = 0; this.updateCurrent(); });
  }

  updateCurrent() {
    const sel = this.getSel();
    if (!sel) return;
    this.savedSel = sel;
    const el = this.els.get(sel.f.id);
    if (el !== this.curEl) {
      if (this.curEl) this.curEl.classList.remove('cur');
      if (el) el.classList.add('cur');
      this.curEl = el;
    }
    if (el) el.classList.toggle('empty', !el.textContent);
    if (this.ac && this.ac.id !== sel.f.id) this.closeAC();
    if (this.opts.typewriter && this.opts.typewriter()) this.scrollCaretIntoView(true);
    this.opts.onSelection && this.opts.onSelection(this.info());
  }

  info() {
    const sel = this.savedSel || this.getSel();
    if (!sel) return null;
    const i = this.idx(sel.f.id);
    if (i < 0) return null;
    const b = this.doc.blocks[i];
    let sceneId = null;
    for (let k = i; k >= 0; k--) if (typeDef(this.fmt, this.doc.blocks[k].t).role === 'heading') { sceneId = this.doc.blocks[k].id; break; }
    const def = typeDef(this.fmt, b.t);
    return { id: b.id, t: b.t, label: def.label, role: def.role, sceneId, index: i, collapsed: this.collapsed(sel), block: b };
  }

  // ---------- model helpers ----------

  runs(b) { return htmlToRuns(b.h); }
  setRuns(i, runs, patch = {}) { const b = this.doc.blocks[i]; this.doc.blocks[i] = { ...b, ...patch, h: runsToHTML(runs) }; return this.doc.blocks[i]; }

  makeBlock(t, atIndex) {
    const def = typeDef(this.fmt, t);
    const b = { id: uid('b'), t, h: '' };
    let off = 0;
    if (def.parens) { b.h = '()'; off = 1; }
    if (def.autoNum) { b.h = this.autoNumText(t, atIndex); off = b.h.length; }
    return { block: b, off };
  }

  autoNumText(t, atIndex) {
    const def = typeDef(this.fmt, t);
    const blocks = this.doc.blocks;
    let n = 1;
    if (def.role === 'heading') {
      for (let k = 0; k < atIndex && k < blocks.length; k++) if (blocks[k].t === t) n++;
      return `${def.autoNum} ${numberWord(n)}`;
    }
    for (let k = Math.min(atIndex, blocks.length) - 1; k >= 0; k--) {
      const r = typeDef(this.fmt, blocks[k].t).role;
      if (r === 'heading') break;
      if (blocks[k].t === t) n++;
    }
    return `${def.autoNum} ${n}`;
  }

  applyType(i, t) {
    const b = this.doc.blocks[i];
    if (!b || !this.fmt.types[t]) return 0;
    const from = typeDef(this.fmt, b.t), to = typeDef(this.fmt, t);
    let runs = htmlToRuns(b.h);
    let text = runsText(runs);
    let shift = 0;
    if (to.parens && !from.parens && !text.trim().startsWith('(')) {
      runs = insertRuns(insertRuns(runs, runsLen(runs), ')'), 0, '(');
      shift = 1;
    } else if (from.parens && !to.parens) {
      const m = /^(\s*)\((.*)\)(\s*)$/s.exec(text);
      if (m) { runs = deleteRuns(runs, text.length - 1 - m[3].length, text.length - m[3].length); runs = deleteRuns(runs, m[1].length, m[1].length + 1); shift = -1; }
    }
    if (to.autoNum && !text.trim()) { runs = htmlToRuns(textToHTML(this.autoNumText(t, i))); }
    const patch = { t };
    const nb = { ...b, ...patch, h: runsToHTML(runs) };
    if (to.role !== 'character') delete nb.d;
    this.doc.blocks[i] = nb;
    return shift;
  }

  // ---------- public editing API ----------

  setType(t) {
    if (this.opts.readOnly) return;
    this.flush();
    const sel = this.getSel();
    if (!sel) return;
    const { s, e } = this.ordered(sel);
    const i0 = this.idx(s.id), i1 = this.idx(e.id);
    if (i0 < 0) return;
    let shiftA = 0, shiftF = 0;
    for (let i = i0; i <= i1; i++) {
      const sh = this.applyType(i, t);
      if (this.doc.blocks[i].id === sel.a.id) shiftA = sh;
      if (this.doc.blocks[i].id === sel.f.id) shiftF = sh;
    }
    this.render();
    const fix = (p, sh) => {
      const b = this.doc.blocks[this.idx(p.id)];
      const max = runsLen(htmlToRuns(b.h));
      let off = Math.max(0, Math.min(max, p.off + sh));
      if (typeDef(this.fmt, b.t).parens && off === max && max > 1) off = max - 1;
      return { id: p.id, off };
    };
    this.setSel({ a: fix(sel.a, shiftA), f: fix(sel.f, shiftF) });
    this.commit('type');
    this.updateCurrent();
    this.updateAC();
  }

  onEnter() {
    if (this.opts.readOnly) return;
    if (this.ac && this.ac.sel >= 0) { this.acceptAC(); return; }
    this.closeAC();
    this.flush();
    let sel = this.getSel();
    if (!sel) return;
    if (!this.collapsed(sel)) { const p = this.deleteRange(sel); sel = this.caret(p.id, p.off); }
    const i = this.idx(sel.a.id);
    if (i < 0) return;
    const b = this.doc.blocks[i];
    const def = typeDef(this.fmt, b.t);
    const runs = htmlToRuns(b.h);
    const text = runsText(runs);
    const len = text.length;
    let off = sel.a.off;
    if (def.parens && text.endsWith(')') && off >= len - 1) off = len;
    if (!text.trim() || (def.parens && /^\(\s*\)$/.test(text.trim()))) {
      const nt = def.empty || def.next;
      if (nt && nt !== b.t) {
        if (def.parens) this.doc.blocks[i] = { ...b, h: '' };
        this.applyType(i, nt);
        const nb = this.doc.blocks[i];
        this.render();
        const nd = typeDef(this.fmt, nt);
        const o = nd.parens ? 1 : runsLen(htmlToRuns(nb.h));
        this.setSel(this.caret(nb.id, o));
        this.commit('type');
        this.updateCurrent();
        this.updateAC();
      }
      return;
    }
    if (off >= len) {
      const nt = def.next || b.t;
      const { block, off: o } = this.makeBlock(nt, i + 1);
      this.doc.blocks.splice(i + 1, 0, block);
      this.render();
      this.setSel(this.caret(block.id, o));
      this.commit('struct');
      this.updateCurrent();
      this.updateAC();
      return;
    }
    if (off === 0) {
      const nb = { id: uid('b'), t: b.t, h: '' };
      this.doc.blocks.splice(i, 0, nb);
      this.render();
      this.setSel(this.caret(b.id, 0));
      this.commit('struct');
      return;
    }
    const [L, R] = splitRuns(runs, off);
    while (R.length && R[0].t.startsWith(' ')) { R[0] = { ...R[0], t: R[0].t.replace(/^ +/, '') }; if (!R[0].t) R.shift(); }
    this.setRuns(i, L);
    const nb = { id: uid('b'), t: b.t, h: runsToHTML(R) };
    this.doc.blocks.splice(i + 1, 0, nb);
    this.render();
    this.setSel(this.caret(nb.id, 0));
    this.commit('struct');
    this.updateCurrent();
  }

  onTab(shift) {
    if (this.opts.readOnly) return;
    if (!shift && this.ac && this.ac.items.length) { this.acceptAC(Math.max(0, this.ac.sel)); return; }
    this.flush();
    const sel = this.getSel();
    if (!sel) return;
    const i = this.idx(sel.f.id);
    if (i < 0) return;
    const b = this.doc.blocks[i];
    const def = typeDef(this.fmt, b.t);
    const text = htmlToText(b.h);
    if (!shift && text.trim() && def.role === 'dialogue' && this.collapsed(sel) && sel.f.off >= text.length && def.tab) {
      const { block, off } = this.makeBlock(def.tab, i + 1);
      this.doc.blocks.splice(i + 1, 0, block);
      this.render();
      this.setSel(this.caret(block.id, off));
      this.commit('struct');
      this.updateCurrent();
      return;
    }
    const target = shift ? def.stab : def.tab;
    if (target) this.setType(target);
  }

  insertSoftBreak() {
    if (this.opts.readOnly) return;
    this.flush();
    let sel = this.getSel();
    if (!sel) return;
    const p = this.collapsed(sel) ? sel.a : this.deleteRange(sel);
    const i = this.idx(p.id);
    const b = this.doc.blocks[i];
    this.setRuns(i, insertRuns(htmlToRuns(b.h), p.off, '\n'));
    this.render();
    this.setSel(this.caret(p.id, p.off + 1));
    this.commit('struct');
  }

  // Delete the (possibly multi-element) range; returns the caret position. Does not render or commit.
  deleteRange(sel) {
    const { s, e } = this.ordered(sel);
    const i0 = this.idx(s.id), i1 = this.idx(e.id);
    const blocks = this.doc.blocks;
    if (i0 === i1) {
      this.setRuns(i0, deleteRuns(htmlToRuns(blocks[i0].h), s.off, e.off));
      return { id: s.id, off: s.off };
    }
    const b0 = blocks[i0], b1 = blocks[i1];
    const L = splitRuns(htmlToRuns(b0.h), s.off)[0];
    const R = splitRuns(htmlToRuns(b1.h), e.off)[1];
    let merged;
    if (!L.length && R.length) merged = { ...b1, h: runsToHTML(R) };
    else merged = { ...b0, h: runsToHTML(L.concat(R)) };
    blocks.splice(i0, i1 - i0 + 1, merged);
    return { id: merged.id, off: L.length ? s.off : 0 };
  }

  deleteSelection() {
    this.flush();
    const sel = this.getSel();
    if (!sel || this.collapsed(sel)) return;
    const p = this.deleteRange(sel);
    this.render();
    this.setSel(this.caret(p.id, p.off));
    this.commit('delete');
  }

  insertTextAt(p, text) {
    const i = this.idx(p.id);
    if (i < 0 || !text) return;
    const clean = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ');
    this.setRuns(i, insertRuns(htmlToRuns(this.doc.blocks[i].h), p.off, clean));
    this.render();
    this.setSel(this.caret(p.id, p.off + clean.length));
    this.commit('typing');
  }

  backspaceAtStart(sel) {
    const i = this.idx(sel.a.id);
    if (i < 0) return;
    const b = this.doc.blocks[i];
    if (i === 0) {
      if (!b.h && b.t !== this.fmt.first) { this.applyType(0, this.fmt.first); this.render(); this.setSel(this.caret(b.id, 0)); this.commit('type'); }
      return;
    }
    const prev = this.doc.blocks[i - 1];
    const prevRuns = htmlToRuns(prev.h);
    const prevLen = runsLen(prevRuns);
    if (!b.h) {
      this.doc.blocks.splice(i, 1);
      this.render();
      this.setSel(this.caret(prev.id, prevLen));
    } else if (!prev.h) {
      this.doc.blocks.splice(i - 1, 1);
      this.render();
      this.setSel(this.caret(b.id, 0));
    } else {
      this.doc.blocks[i - 1] = { ...prev, h: runsToHTML(prevRuns.concat(htmlToRuns(b.h))) };
      this.doc.blocks.splice(i, 1);
      this.render();
      this.setSel(this.caret(prev.id, prevLen));
    }
    this.commit('struct');
    this.updateCurrent();
  }

  deleteAtEnd(sel) {
    const i = this.idx(sel.a.id);
    if (i < 0 || i >= this.doc.blocks.length - 1) return;
    const b = this.doc.blocks[i], nx = this.doc.blocks[i + 1];
    const runs = htmlToRuns(b.h);
    if (!b.h) { this.doc.blocks.splice(i, 1); this.render(); this.setSel(this.caret(nx.id, 0)); }
    else if (!nx.h) { this.doc.blocks.splice(i + 1, 1); this.render(); this.setSel(this.caret(b.id, runsLen(runs))); }
    else {
      this.doc.blocks[i] = { ...b, h: runsToHTML(runs.concat(htmlToRuns(nx.h))) };
      this.doc.blocks.splice(i + 1, 1);
      this.render();
      this.setSel(this.caret(b.id, runsLen(runs)));
    }
    this.commit('struct');
  }

  format(k) {
    this.flush();
    const sel = this.getSel();
    if (!sel || this.collapsed(sel)) {
      // No selection: toggle native typing style.
      document.execCommand(k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline');
      return;
    }
    const { s, e } = this.ordered(sel);
    const i0 = this.idx(s.id), i1 = this.idx(e.id);
    // If every selected character already has the style, remove it; otherwise apply it.
    let all = true;
    for (let i = i0; i <= i1; i++) {
      const runs = htmlToRuns(this.doc.blocks[i].h);
      const st = i === i0 ? s.off : 0, en = i === i1 ? e.off : runsLen(runs);
      let pos = 0;
      for (const r of runs) { const re = pos + r.t.length; if (re > st && pos < en && r.t !== '\n' && !r[k]) all = false; pos = re; }
    }
    for (let i = i0; i <= i1; i++) {
      const runs = htmlToRuns(this.doc.blocks[i].h);
      const st = i === i0 ? s.off : 0, en = i === i1 ? e.off : runsLen(runs);
      this.setRuns(i, applyAttr(runs, st, en, k, !all));
    }
    this.render();
    this.setSel(sel, { scroll: false });
    this.commit('format');
  }

  toggleDual() {
    this.flush();
    const info = this.info();
    if (!info) return false;
    let i = info.index;
    while (i >= 0 && ['paren', 'dialogue'].includes(typeDef(this.fmt, this.doc.blocks[i].t).role)) i--;
    const b = this.doc.blocks[i];
    if (!b || typeDef(this.fmt, b.t).role !== 'character') return false;
    this.doc.blocks[i] = { ...b, d: !b.d };
    if (!this.doc.blocks[i].d) delete this.doc.blocks[i].d;
    const sel = this.getSel();
    this.render();
    if (sel) this.setSel(sel, { scroll: false });
    this.commit('meta');
    return true;
  }

  updateBlock(id, patch, kind = 'meta') {
    this.flush();
    const i = this.idx(id);
    if (i < 0) return;
    const nb = { ...this.doc.blocks[i], ...patch };
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete nb[k];
    this.doc.blocks[i] = nb;
    const sel = this.getSel();
    this.render();
    if (sel && document.activeElement === this.root) this.setSel(sel, { scroll: false });
    this.commit(kind);
  }

  replaceBlocks(blocks, kind = 'replace') {
    this.flush();
    this.doc.blocks = blocks.length ? blocks : [{ id: uid('b'), t: this.fmt.first, h: '' }];
    this.render();
    this.commit(kind);
  }

  insertBlocksAfter(id, blocks, kind = 'insert') {
    this.flush();
    let i = id ? this.idx(id) : this.doc.blocks.length - 1;
    if (i < 0) i = this.doc.blocks.length - 1;
    this.doc.blocks.splice(i + 1, 0, ...blocks);
    this.render();
    const last = blocks[blocks.length - 1];
    this.setSel(this.caret(last.id, runsLen(htmlToRuns(last.h))));
    this.commit(kind);
  }

  // ---------- comments / breakdown tags ----------

  selectionDetails() {
    this.flush();
    const sel = this.getSel();
    if (!sel) return null;
    const { s, e } = this.ordered(sel);
    const i0 = this.idx(s.id), i1 = this.idx(e.id);
    let text = '';
    for (let i = i0; i <= i1; i++) {
      const t = htmlToText(this.doc.blocks[i].h);
      text += (i > i0 ? '\n' : '') + t.slice(i === i0 ? s.off : 0, i === i1 ? e.off : t.length);
    }
    return { sel, s, e, i0, i1, text, collapsed: this.collapsed(sel), sameBlock: i0 === i1 };
  }

  markSelection(attr, val, { wholeBlockIfEmpty = true, singleBlock = false } = {}) {
    const d = this.selectionDetails();
    if (!d) return null;
    if (singleBlock && !d.sameBlock) return null;
    if (d.collapsed && !wholeBlockIfEmpty) return null;
    for (let i = d.i0; i <= d.i1; i++) {
      const runs = htmlToRuns(this.doc.blocks[i].h);
      let st = i === d.i0 ? d.s.off : 0, en = i === d.i1 ? d.e.off : runsLen(runs);
      if (d.collapsed) { st = 0; en = runsLen(runs); }
      if (en > st) this.setRuns(i, applyAttr(runs, st, en, attr, val));
    }
    this.render();
    this.setSel(d.sel, { scroll: false });
    this.commit('mark');
    return d;
  }

  unmark(attr, val) {
    this.flush();
    let any = false;
    this.doc.blocks.forEach((b, i) => {
      if (b.h && b.h.includes(`data-${attr}="${val}"`)) { this.doc.blocks[i] = { ...b, h: unwrapSpan(b.h, attr, val) }; any = true; }
    });
    if (any) { this.render(); this.commit('unmark'); }
    return any;
  }

  // Tag every occurrence of a phrase within a block range (used by auto-tagging).
  tagOccurrences(phrase, tagId, fromIdx = 0, toIdx = this.doc.blocks.length) {
    this.flush();
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    let n = 0;
    for (let i = fromIdx; i < toIdx; i++) {
      const b = this.doc.blocks[i];
      const role = typeDef(this.fmt, b.t).role;
      if (role === 'heading' || role === 'character') continue;
      let runs = htmlToRuns(b.h);
      const text = runsText(runs);
      let m, changed = false;
      re.lastIndex = 0;
      while ((m = re.exec(text))) {
        const st = m.index + m[1].length, en = st + m[2].length;
        const r = runsStyleAt(runs, st + 1);
        if (r && r.tg) continue;
        runs = applyAttr(runs, st, en, 'tg', tagId);
        changed = true; n++;
      }
      if (changed) this.setRuns(i, runs);
    }
    if (n) { this.render(); this.commit('mark'); }
    return n;
  }

  onClick(e) {
    const span = e.target.closest && e.target.closest('span.tg, span.cm');
    if (span && this.opts.onSpanClick) {
      const sel = document.getSelection();
      if (sel && !sel.isCollapsed) return;
      this.opts.onSpanClick(span.classList.contains('tg') ? 'tg' : 'cm', span.dataset.tg || span.dataset.cm, span, e);
    }
  }

  // ---------- find / replace ----------

  find(query, { caseSensitive = false, wholeWord = false, regex = false } = {}) {
    this.flush();
    if (!query) return [];
    let src = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) src = `(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`;
    let re;
    try { re = new RegExp(src, 'gu' + (caseSensitive ? '' : 'i')); } catch { return []; }
    const out = [];
    for (const b of this.doc.blocks) {
      const t = htmlToText(b.h);
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(t))) {
        if (!m[0].length) { re.lastIndex++; continue; }
        out.push({ id: b.id, start: m.index, end: m.index + m[0].length });
      }
    }
    return out;
  }

  selectRange(id, start, end) {
    const el = this.els.get(id);
    if (!el) return;
    this.focus();
    this.setSel({ a: { id, off: start }, f: { id, off: end } }, { scroll: false });
    const s = document.getSelection();
    const rect = s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : el.getBoundingClientRect();
    const sc = this.opts.scroller;
    if (sc) {
      const sr = sc.getBoundingClientRect();
      if (rect.top < sr.top + 60 || rect.bottom > sr.bottom - 60) sc.scrollTop += rect.top - (sr.top + sr.height * 0.35);
    }
  }

  replaceMatches(matches, text) {
    this.flush();
    const byId = new Map();
    for (const m of matches) { if (!byId.has(m.id)) byId.set(m.id, []); byId.get(m.id).push(m); }
    for (const [id, ms] of byId) {
      const i = this.idx(id);
      if (i < 0) continue;
      let runs = htmlToRuns(this.doc.blocks[i].h);
      for (const m of ms.sort((a, b) => b.start - a.start)) {
        const st = runsStyleAt(runs, m.start + 1);
        runs = insertRuns(deleteRuns(runs, m.start, m.end), m.start, text, st ? { b: st.b, i: st.i, u: st.u, tg: st.tg, cm: st.cm } : null);
      }
      this.setRuns(i, runs);
    }
    this.render();
    this.commit('replace');
  }

  scrollToBlock(id, { caret = true, center = true } = {}) {
    const el = this.els.get(id);
    if (!el) return;
    const sc = this.opts.scroller;
    if (sc) {
      const sr = sc.getBoundingClientRect(), r = el.getBoundingClientRect();
      sc.scrollTop += r.top - sr.top - (center ? sr.height * 0.25 : 24);
    } else el.scrollIntoView({ block: 'center' });
    if (caret) { this.focus(); this.setSel(this.caret(id, 0), { scroll: false }); this.updateCurrent(); }
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 900);
  }

  // ---------- events ----------

  onKeyDown(e) {
    if (this.opts.readOnly) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (this.ac) {
      const n = this.ac.items.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); this.ac.sel = (this.ac.sel + 1) % n; this.paintAC(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); this.ac.sel = this.ac.sel <= 0 ? n - 1 : this.ac.sel - 1; this.paintAC(); return; }
      if (e.key === 'Escape') { e.preventDefault(); this.closeAC(); return; }
      if (e.key === 'Enter' && !e.shiftKey && this.ac.sel >= 0) { e.preventDefault(); this.acceptAC(); return; }
    }
    if (e.key === 'Tab' && !mod && !e.altKey) { e.preventDefault(); this.onTab(e.shiftKey); return; }
    if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      if (mod) { this.opts.onModEnter && this.opts.onModEnter(); return; }
      if (e.shiftKey) this.insertSoftBreak(); else this.onEnter();
      return;
    }
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return; }
      if (k === 'y' && !isMac) { e.preventDefault(); this.redo(); return; }
      if (k === 'b' || k === 'i' || k === 'u') { e.preventDefault(); this.format(k); return; }
    }
    if (e.altKey && !mod && !e.shiftKey && /^Digit\d$/.test(e.code)) {
      const n = +e.code.slice(5);
      const t = this.fmt.order[(n + 9) % 10];
      if (t) { e.preventDefault(); this.setType(t); }
      return;
    }
    if (this.opts.onKeyDown) this.opts.onKeyDown(e);
  }

  onBeforeInput(e) {
    if (this.opts.readOnly) { e.preventDefault(); return; }
    const t = e.inputType;
    if (t === 'historyUndo') { e.preventDefault(); this.undo(); return; }
    if (t === 'historyRedo') { e.preventDefault(); this.redo(); return; }
    if (t === 'insertParagraph') { e.preventDefault(); this.onEnter(); return; }
    if (t === 'insertLineBreak') { e.preventDefault(); this.insertSoftBreak(); return; }
    if (t === 'insertFromDrop' || t === 'deleteByDrag') { e.preventDefault(); return; }
    if (t === 'insertFromPaste' || t === 'insertFromPasteAsQuotation') return; // handled by paste event
    if (t.startsWith('format')) {
      if (t === 'formatBold' || t === 'formatItalic' || t === 'formatUnderline') { e.preventDefault(); this.format(t === 'formatBold' ? 'b' : t === 'formatItalic' ? 'i' : 'u'); }
      return;
    }
    const sel = this.getSel();
    if (!sel) return;
    const multi = sel.a.id !== sel.f.id;
    if (t.startsWith('delete')) {
      if (multi) { e.preventDefault(); this.flush(); this.deleteSelection(); return; }
      if (this.collapsed(sel)) {
        if (t.endsWith('Backward') && sel.a.off === 0) { e.preventDefault(); this.flush(); this.backspaceAtStart(this.getSel() || sel); return; }
        if (t.endsWith('Forward')) {
          const el = this.els.get(sel.a.id);
          if (el && sel.a.off >= this.textLenDOM(el)) { e.preventDefault(); this.flush(); this.deleteAtEnd(this.getSel() || sel); return; }
        }
      }
      return;
    }
    if (t === 'insertText' || t === 'insertReplacementText') {
      const data = e.data ?? (e.dataTransfer ? e.dataTransfer.getData('text/plain') : '');
      if (multi) {
        e.preventDefault();
        this.flush();
        const p = this.deleteRange(this.getSel() || sel);
        this.render();
        this.insertTextAt(p, data || '');
        return;
      }
      // Step over an auto-inserted closing parenthesis.
      if (data === ')' && this.collapsed(sel)) {
        const el = this.els.get(sel.a.id);
        if (el && typeDef(this.fmt, el.dataset.t).parens) {
          const txt = this.domText(el);
          if (txt[sel.a.off] === ')' && sel.a.off === txt.length - 1) { e.preventDefault(); this.setSel(this.caret(sel.a.id, sel.a.off + 1)); }
        }
      }
    }
  }

  onInput() {
    if (this.composing) return;
    const sel = this.getSel();
    if (sel && this.collapsed(sel)) {
      const el = this.els.get(sel.a.id);
      if (el) {
        el.classList.toggle('empty', !el.textContent);
        if (this.fmt.id === 'screenplay' && el.dataset.t === 'action') {
          const tx = this.domText(el);
          if (tx.length < 24 && /^(int|ext|est|i\/e|int\.\/ext|ext\.\/int)\.\s$/i.test(tx)) { this.setType('scene'); return; }
        }
      }
    }
    this.updateAC();
    this.opts.onInput && this.opts.onInput();
  }

  onPaste(e) {
    e.preventDefault();
    if (this.opts.readOnly) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const html = cd.getData('text/html');
    const text = (cd.getData('text/plain') || '').replace(/\r\n?/g, '\n');
    let blocks = null;
    const m = html && /data-rw-blocks="([^"]+)"/.exec(html);
    if (m) {
      try {
        const data = JSON.parse(decodeURIComponent(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')));
        const from = getFormat(data.fmt);
        blocks = data.blocks.map(b => ({ ...b, t: from.id === this.fmt.id ? b.t : convertType(from, this.fmt, b.t) }));
      } catch { blocks = null; }
    }
    if (!blocks && text.trim().includes('\n') && this.opts.parsePlain) blocks = this.opts.parsePlain(text);
    if (!blocks) {
      if (!text) return;
      blocks = [{ t: null, h: textToHTML(text.replace(/\n+/g, ' ')) }];
    }
    this.pasteBlocks(blocks);
  }

  pasteBlocks(blocks) {
    this.flush();
    const sel = this.getSel();
    if (!sel || !blocks.length) return;
    const p = this.collapsed(sel) ? sel.a : this.deleteRange(sel);
    const i = this.idx(p.id);
    const cur = this.doc.blocks[i];
    const commentIds = new Set((this.doc.comments || []).map(c => c.id));
    const clean = b => {
      const runs = htmlToRuns(b.h || '');
      for (const r of runs) if (r.cm && !commentIds.has(r.cm)) r.cm = null;
      return runs;
    };
    const used = new Set(this.doc.blocks.map(b => b.id));
    const fresh = id => { if (id && !used.has(id)) { used.add(id); return id; } const n = uid('b'); used.add(n); return n; };
    const [L, R] = splitRuns(htmlToRuns(cur.h), p.off);
    let caret;
    if (blocks.length === 1) {
      const ins = clean(blocks[0]);
      this.setRuns(i, L.concat(ins, R));
      caret = this.caret(cur.id, runsLen(L) + runsLen(ins));
    } else {
      const first = blocks[0], last = blocks[blocks.length - 1];
      const fr = L.concat(clean(first));
      const newFirst = { ...cur, t: (L.length || !first.t) ? cur.t : first.t, h: runsToHTML(fr) };
      if (!L.length && first.s) newFirst.s = first.s;
      const mid = blocks.slice(1, -1).map(b => ({ ...b, id: fresh(b.id), t: b.t || cur.t, h: runsToHTML(clean(b)) }));
      const lr = clean(last);
      const newLast = { ...last, id: fresh(last.id), t: last.t || cur.t, h: runsToHTML(lr.concat(R)) };
      for (const b of [...mid, newLast]) { if (!this.fmt.types[b.t]) b.t = cur.t; }
      if (!this.fmt.types[newFirst.t]) newFirst.t = cur.t;
      this.doc.blocks.splice(i, 1, newFirst, ...mid, newLast);
      caret = this.caret(newLast.id, runsLen(lr));
    }
    this.render();
    this.setSel(caret);
    this.commit('paste');
    this.updateCurrent();
  }

  fragment(sel) {
    const { s, e } = this.ordered(sel);
    const i0 = this.idx(s.id), i1 = this.idx(e.id);
    const out = [];
    for (let i = i0; i <= i1; i++) {
      const b = this.doc.blocks[i];
      let runs = htmlToRuns(b.h);
      const len = runsLen(runs);
      const st = i === i0 ? s.off : 0, en = i === i1 ? e.off : len;
      runs = splitRuns(splitRuns(runs, en)[0], st)[1];
      const fb = { id: b.id, t: b.t, h: runsToHTML(runs) };
      if (b.d) fb.d = 1;
      if (b.s && st === 0) fb.s = b.s;
      out.push(fb);
    }
    return out;
  }

  onCopy(e, cut) {
    this.flush();
    const sel = this.getSel();
    if (!sel || this.collapsed(sel)) return;
    e.preventDefault();
    const frag = this.fragment(sel);
    const text = this.opts.toPlain ? this.opts.toPlain(frag) : frag.map(b => {
      const t = htmlToText(b.h);
      return typeDef(this.fmt, b.t).caps ? upperSafe(t) : t;
    }).join('\n');
    const json = encodeURIComponent(JSON.stringify({ fmt: this.fmt.id, blocks: frag }));
    const htmlBody = frag.map(b => `<p>${b.h}</p>`).join('');
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData('text/html', `<meta charset="utf-8"><div data-rw-blocks="${json}">${htmlBody}</div>`);
    if (cut && !this.opts.readOnly) {
      const p = this.deleteRange(sel);
      this.render();
      this.setSel(this.caret(p.id, p.off));
      this.commit('cut');
    }
  }

  // ---------- autocomplete ----------

  names() {
    if (!this.namesCache) this.namesCache = this.opts.getNames ? this.opts.getNames() : [];
    return this.namesCache;
  }

  suggest(role, text) {
    const up = upperSafe(text);
    const trimmed = up.trim();
    const fid = this.fmt.id;
    const limit = a => a.slice(0, 8);
    if (role === 'heading' && (fid === 'screenplay' || fid === 'audio')) {
      const m = HEAD_PREFIX.exec(up);
      if (!m) {
        if (trimmed.length > 6) return [];
        return SCENE_PREFIXES.filter(p => p.startsWith(trimmed) && p !== up).map(p => ({ label: p.trim(), value: p, more: true }));
      }
      const pre = up.slice(0, m[0].length).trimEnd() + ' ';
      const rest = up.slice(m[0].length);
      const dash = rest.search(/\s[-–—]\s/);
      if (dash === -1) {
        const locs = this.opts.getLocations ? this.opts.getLocations() : [];
        const r = rest.trim();
        return limit(locs.filter(l => l.startsWith(r) && l !== r)).map(l => ({ label: l, value: pre + l + ' - ', more: true }));
      }
      const head = rest.slice(0, dash).trimEnd();
      const tod = rest.slice(dash + 3).trimStart();
      return SCENE_TIMES.filter(x => x.startsWith(tod) && x !== tod).map(x => ({ label: x, value: pre + head + ' - ' + x }));
    }
    if (role === 'character') {
      const pm = /^(.*?)\s*\(([^)]*)$/.exec(up);
      if (pm && pm[1].trim()) {
        const typed = '(' + pm[2];
        return CHAR_EXTENSIONS.filter(x => x.startsWith(typed) && x !== typed).map(x => ({ label: x, value: pm[1].trim() + ' ' + x }));
      }
      if (/\)$/.test(trimmed)) return [];
      return limit(this.names().filter(n => n.startsWith(trimmed) && n !== trimmed)).map(n => ({ label: n, value: n }));
    }
    if (role === 'transition' && trimmed) {
      return TRANSITIONS.filter(x => x.startsWith(trimmed) && x !== trimmed).map(x => ({ label: x, value: x }));
    }
    return [];
  }

  updateAC() {
    if (this.composing || this.opts.readOnly) return;
    const sel = this.getSel();
    if (!sel || !this.collapsed(sel)) return this.closeAC();
    const el = this.els.get(sel.a.id);
    if (!el) return this.closeAC();
    const text = this.domText(el);
    if (sel.a.off !== text.length) return this.closeAC();
    const role = typeDef(this.fmt, el.dataset.t).role;
    const items = this.suggest(role, text);
    if (!items.length) return this.closeAC();
    const prevSel = this.ac && this.ac.id === sel.a.id ? this.ac.sel : null;
    this.ac = { id: sel.a.id, items, sel: text.trim() ? (prevSel != null && prevSel < items.length ? Math.max(0, prevSel) : 0) : -1 };
    this.paintAC();
  }

  paintAC() {
    const ac = this.ac;
    if (!ac) return;
    if (!this.acEl) {
      this.acEl = h('div.ac', { role: 'listbox' });
      this.acEl.addEventListener('pointerdown', e => e.preventDefault());
      document.body.appendChild(this.acEl);
    }
    this.acEl.replaceChildren(...ac.items.map((it, i) => h('div.ac-item' + (i === ac.sel ? '.sel' : ''), {
      role: 'option', 'aria-selected': i === ac.sel ? 'true' : 'false',
      onclick: () => this.acceptAC(i),
    }, it.label)));
    const s = document.getSelection();
    let rect = s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : null;
    const el = this.els.get(ac.id);
    if ((!rect || (!rect.left && !rect.top)) && el) rect = el.getBoundingClientRect();
    if (!rect) return;
    const elRect = el ? el.getBoundingClientRect() : rect;
    const x = Math.min(Math.max(8, rect.left || elRect.left), innerWidth - 240);
    let y = (rect.bottom || elRect.bottom) + 4;
    this.acEl.style.left = x + 'px';
    this.acEl.style.top = y + 'px';
    this.acEl.style.display = 'block';
    const vv = window.visualViewport;
    const vb = vv ? vv.height + vv.offsetTop : innerHeight;
    if (y + this.acEl.offsetHeight > vb - 8) this.acEl.style.top = Math.max(8, (rect.top || elRect.top) - this.acEl.offsetHeight - 4) + 'px';
  }

  acceptAC(i = this.ac ? this.ac.sel : -1) {
    const ac = this.ac;
    if (!ac || i < 0 || !ac.items[i]) return;
    const it = ac.items[i];
    this.flush();
    const bi = this.idx(ac.id);
    if (bi < 0) return this.closeAC();
    this.doc.blocks[bi] = { ...this.doc.blocks[bi], h: textToHTML(it.value) };
    this.render();
    this.setSel(this.caret(ac.id, it.value.length));
    this.commit('ac');
    this.closeAC();
    if (it.more) this.updateAC();
  }

  closeAC() {
    this.ac = null;
    if (this.acEl) { this.acEl.remove(); this.acEl = null; }
  }

  // ---------- page/scene markers drawn in an overlay (no layout shift) ----------

  setLayout(layout) { this.layout = layout; this.drawMarkers(); }

  lineHeight() {
    const lh = parseFloat(getComputedStyle(this.root).lineHeight);
    return isNaN(lh) ? 16 : lh;
  }

  drawMarkers() {
    const g = this.opts.gutter;
    if (!g || !this.layout || !this.root.isConnected) return;
    const L = this.layout;
    const lh = this.lineHeight();
    const frag = document.createDocumentFragment();
    const settings = this.opts.settings ? this.opts.settings() : {};
    for (const ps of L.pageStarts || []) {
      if (ps.n === 1 || !ps.bid) continue;
      const el = this.els.get(ps.bid);
      if (!el) continue;
      let y;
      if (ps.row > 0) y = el.offsetTop + Math.min(ps.row, Math.max(0, Math.round(el.offsetHeight / lh) - 1)) * lh;
      else y = el.offsetTop - (parseFloat(getComputedStyle(el).marginTop) || 0) / 2;
      frag.append(h('div.g-page', { style: { top: y + 'px' } }, h('span.g-pn', `${ps.n}.`)));
    }
    for (const [id, sc] of L.scenes || []) {
      const el = this.els.get(id);
      if (!el) continue;
      const top = el.offsetTop + 'px';
      frag.append(h('div.g-scn.left', { style: { top } }, sc.num || ''));
      if (settings.sceneNumbers === 'right' || settings.sceneNumbers === 'both') frag.append(h('div.g-scn.right', { style: { top } }, sc.num || ''));
    }
    const revList = (this.doc.rev && this.doc.rev.list) || [];
    const latest = revList.length ? revList[revList.length - 1].id : null;
    const showRev = settings.showRevMarks !== false && latest;
    const commentIds = new Set((this.doc.comments || []).filter(c => !c.done).map(c => c.id));
    for (const b of this.doc.blocks) {
      const revMark = showRev && b.r === latest;
      const cm = commentIds.size && b.h && b.h.includes('data-cm=');
      if (!revMark && !cm) continue;
      const el = this.els.get(b.id);
      if (!el) continue;
      if (revMark) {
        const n = Math.max(1, Math.round(el.offsetHeight / lh));
        frag.append(h('div.g-rev', { style: { top: el.offsetTop + 'px' } }, Array(n).fill('*').join('\n')));
      }
      if (cm) {
        const ids = (b.h.match(/data-cm="([^"]+)"/g) || []).map(s => s.slice(9, -1)).filter(id => commentIds.has(id));
        if (ids.length) {
          const btn = h('button.g-cm', { type: 'button', title: 'Show comment', style: { top: el.offsetTop + 'px' }, onclick: () => this.opts.onSpanClick && this.opts.onSpanClick('cm', ids[0], null) }, String(new Set(ids).size));
          frag.append(btn);
        }
      }
    }
    g.replaceChildren(frag);
  }
}
