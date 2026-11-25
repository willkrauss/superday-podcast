// Pagination engine. Produces page models (positioned text runs, in inches) used by the
// editor's page-break markers, the HTML preview/print view and the PDF writer.
//
// Rules implemented (industry-standard screenplay conventions):
//  - Courier 12pt: 10 characters per inch, 6 lines per inch, 54 body lines on US Letter (1" top/bottom).
//  - Scene headings, shots, character cues and act headings are kept with what follows.
//  - Action splits only at a sentence boundary with at least 2 lines on each page; otherwise it moves.
//  - Dialogue splits at a sentence boundary (or between parts) with (MORE) / CHARACTER (CONT'D).
//  - Optional automatic (CONT'D) when the same character speaks again within a scene.
//  - Dual dialogue is laid out in two columns and kept together.
import { getFormat, typeDef, spacingBefore, pageGeometry, REVISION_COLORS } from './formats.js';
import { htmlToRuns, upperSafe, htmlToText } from './inline.js';
import { sceneNumberMap, normalizeCharName } from './model.js';

export const LINE = 1 / 6;
export const CHAR = 0.1;

// ---------- wrapping ----------

export function wrapText(text, width) {
  const lines = [];
  width = Math.max(1, Math.floor(width));
  let start = 0;
  for (;;) {
    let nl = text.indexOf('\n', start);
    const last = nl === -1;
    if (last) nl = text.length;
    wrapPara(start, nl);
    if (last) break;
    start = nl + 1;
  }
  function wrapPara(s, e) {
    while (e > s && text[e - 1] === ' ') e--;
    if (s >= e) { lines.push([s, s]); return; }
    while (e - s > width) {
      let cut = -1, next = -1;
      for (let k = s + width; k > s; k--) {
        if (text[k] === ' ') { cut = k; next = k; break; }
        if (text[k - 1] === '-' && text[k] !== '-' && k - 1 > s) { cut = k; next = k; break; }
      }
      if (cut === -1) { cut = s + width; next = cut; }
      let le = cut;
      while (le > s && text[le - 1] === ' ') le--;
      lines.push([s, le]);
      s = next;
      while (s < e && text[s] === ' ') s++;
    }
    if (s < e) lines.push([s, e]);
  }
  return lines;
}

function sliceRuns(runs, s, e) {
  const out = [];
  let pos = 0;
  for (const r of runs) {
    const rs = pos, re = pos + r.t.length;
    pos = re;
    if (re <= s || rs >= e) continue;
    const t = r.t.slice(Math.max(0, s - rs), Math.min(r.t.length, e - rs));
    if (t) out.push({ t, b: r.b, i: r.i, u: r.u, tg: r.tg, cm: r.cm });
  }
  return out;
}

export function wrapRuns(runs, width) {
  const flat = runs.map(r => r.t).join('');
  return wrapText(flat, width).map(([s, e]) => ({ runs: sliceRuns(runs, s, e), len: e - s, text: flat.slice(s, e) }));
}

const SENT_END = /([.!?…]|--|—)["'”’)\]]*$/;

function styledRuns(html, def, extra = {}) {
  let runs = htmlToRuns(html).filter(r => r.t !== '');
  // merge \n runs as text so wrap handles hard breaks
  runs = runs.map(r => ({ ...r }));
  const b = def.b || extra.b, i = def.i || extra.i, u = def.u || extra.u;
  if (b || i || u) for (const r of runs) { if (b) r.b = true; if (i) r.i = true; if (u) r.u = true; }
  if (def.caps) for (const r of runs) r.t = upperSafe(r.t);
  if (def.prefix) runs.unshift({ t: def.prefix, b: !!b, i: !!i, u: false });
  return runs;
}

function alignX(def, len, l = def.l, w = def.w) {
  if (def.align === 'center') return l + Math.max(0, (w * 10 - len) / 2) * CHAR;
  if (def.align === 'right') return l + Math.max(0, w * 10 - len) * CHAR;
  return l;
}

function rowsFromRuns(runs, def, l, w) {
  const lines = wrapRuns(runs, w * 10);
  const blk = { runs, def, l, w };
  return lines.map((ln, k) => ({
    segs: [{ x: alignX(def, ln.len, l, w), runs: ln.runs }],
    text: ln.text,
    sentenceEnd: SENT_END.test(ln.text.trim()),
    first: k === 0,
    blk,
  }));
}

function rowsFor(html, def, opts = {}) {
  const l = opts.l ?? def.l, w = opts.w ?? def.w;
  const runs = styledRuns(html, def, opts.style || {});
  if (opts.suffix) runs.push({ t: opts.suffix, b: false, i: false, u: false });
  return rowsFromRuns(runs, def, l, w);
}

// Split a block's text after the last complete sentence whose wrapped lines fit in maxTop lines,
// re-wrapping both halves (how Final Draft breaks action and dialogue across pages).
const SENT_SPLIT = /[.!?…]+["'”’)\]]*(?=\s)|--+(?=\s)|—(?=\s)/g;
function sentenceSplit(blk, maxTop, minTop = 2, minBot = 2) {
  if (!blk || maxTop < minTop) return null;
  const text = blk.runs.map(r => r.t).join('');
  const cands = [];
  let m;
  SENT_SPLIT.lastIndex = 0;
  while ((m = SENT_SPLIT.exec(text))) cands.push(m.index + m[0].length);
  for (let k = cands.length - 1; k >= 0; k--) {
    const c = cands[k];
    const top = rowsFromRuns(sliceRuns(blk.runs, 0, c), blk.def, blk.l, blk.w);
    if (top.length > maxTop) continue;
    if (top.length < minTop) return null;
    let st = c;
    while (st < text.length && (text[st] === ' ' || text[st] === '\n')) st++;
    if (st >= text.length) return null;
    const bot = rowsFromRuns(sliceRuns(blk.runs, st, text.length), blk.def, blk.l, blk.w);
    if (bot.length < minBot) continue;
    for (const r of bot) r.first = false;
    return { top, bot };
  }
  return null;
}

function retag(rows, proto) {
  return rows.map(r => ({ ...r, bid: proto.bid, kind: proto.kind, rev: proto.rev, sid: proto.sid, part: proto.part }));
}

// ---------- units ----------

const cache = new WeakMap();

function settingsSig(fmt, settings) {
  return fmt.id + '|' + (settings.sceneBold ? 1 : 0) + (settings.sceneUnderline ? 1 : 0);
}

function baseRows(b, fmt, settings) {
  const sig = settingsSig(fmt, settings);
  const c = cache.get(b);
  if (c && c.sig === sig) return c.rows;
  const def = typeDef(fmt, b.t);
  const style = def.role === 'heading' && fmt.id !== 'text' ? { b: settings.sceneBold, u: settings.sceneUnderline } : {};
  const rows = rowsFor(b.h, def, { style });
  cache.set(b, { sig, rows });
  return rows;
}

const DUAL = {
  L: { char: 2.6, paren: 2.0, parenW: 2.0, dial: 1.5, dialW: 2.8 },
  R: { char: 5.7, paren: 5.1, parenW: 2.0, dial: 4.6, dialW: 2.8 },
};

function buildUnits(doc, fmt, settings, revSet) {
  const units = [];
  const blocks = doc.blocks;
  const nums = sceneNumberMap(doc);
  const roleOf = b => typeDef(fmt, b.t).role;
  let sceneId = null, lastSpeaker = null;
  const tag = (rows, b, kind) => rows.map(r => ({ ...r, bid: b.id, kind, rev: revSet.has(b.r), sid: sceneId }));

  const speechRows = (startIdx, side) => {
    const cb = blocks[startIdx];
    const cdef = typeDef(fmt, cb.t);
    const rawName = htmlToText(cb.h);
    const name = normalizeCharName(rawName);
    let suffix = '';
    if (settings.autoContd && name && lastSpeaker === name && !/CONT['’]?D/i.test(rawName)) suffix = " (CONT'D)";
    if (name) lastSpeaker = name;
    const D = side ? DUAL[side] : null;
    let rows = side
      ? rowsFor(cb.h, { ...cdef, align: 'left' }, { l: D.char, w: 7.5 - D.char, suffix })
      : (suffix ? rowsFor(cb.h, cdef, { suffix }) : baseRows(cb, fmt, settings));
    const charRows = tag(rows, cb, 'char');
    const all = [...charRows];
    let j = startIdx + 1;
    while (j < blocks.length && (roleOf(blocks[j]) === 'paren' || roleOf(blocks[j]) === 'dialogue')) {
      const pb = blocks[j];
      const role = roleOf(pb);
      const pdef = typeDef(fmt, pb.t);
      let r = side
        ? rowsFor(pb.h, { ...pdef, align: 'left' }, role === 'paren' ? { l: D.paren, w: D.parenW } : { l: D.dial, w: D.dialW })
        : baseRows(pb, fmt, settings);
      all.push(...tag(r, pb, role === 'paren' ? 'paren' : 'dial').map((x, k) => ({ ...x, part: j, partFirst: k === 0, partLast: k === r.length - 1 })));
      j++;
    }
    const contdText = upperSafe(rawName.trim()) + (/CONT['’]?D/i.test(rawName + suffix) ? suffix : (suffix || " (CONT'D)"));
    return { rows: all, next: j, cb, contdText, cdef };
  };

  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    const def = typeDef(fmt, b.t);
    const role = def.role;
    if (role === 'heading') {
      sceneId = b.id; lastSpeaker = null;
      const sb = spacingBefore(fmt, b.t, settings);
      if (b.s && b.s.omit) {
        const rows = tag(rowsFor(b.s.omitText || 'OMITTED', def), b, 'heading');
        rows[0].sceneNum = nums.get(b.id);
        units.push({ kind: 'block', sb, rows, sceneId, heading: true, newPage: b.pb });
        i++;
        while (i < blocks.length && typeDef(fmt, blocks[i].t).role !== 'heading') i++;
        continue;
      }
      const rows = tag(baseRows(b, fmt, settings), b, 'heading');
      if (rows[0]) rows[0].sceneNum = nums.get(b.id);
      units.push({ kind: 'block', sb, rows, keepNext: 1, sceneId, heading: true, newPage: b.pb || def.newPage });
      i++;
      continue;
    }
    if (role === 'character') {
      const first = speechRows(i, null);
      const nb = blocks[first.next];
      if (fmt.id === 'screenplay' && nb && nb.d && roleOf(nb) === 'character') {
        // Dual dialogue: re-layout both speeches in columns.
        const saveSpeaker = lastSpeaker;
        lastSpeaker = null;
        const left = speechRows(i, 'L');
        const right = speechRows(first.next, 'R');
        lastSpeaker = saveSpeaker;
        const n = Math.max(left.rows.length, right.rows.length);
        const rows = [];
        for (let k = 0; k < n; k++) {
          const a = left.rows[k], c = right.rows[k];
          rows.push({ segs: [...(a ? a.segs : []), ...(c ? c.segs : [])], bid: (a || c).bid, kind: 'dual', rev: !!((a && a.rev) || (c && c.rev)), sid: sceneId, first: k === 0 });
        }
        units.push({ kind: 'dual', sb: def.sb, rows, sceneId, newPage: b.pb });
        lastSpeaker = normalizeCharName(htmlToText(nb.h));
        i = right.next;
        continue;
      }
      units.push({ kind: 'speech', sb: spacingBefore(fmt, b.t, settings), rows: first.rows, split: 1, sceneId, contdText: first.contdText, cdef: first.cdef, newPage: b.pb });
      i = first.next;
      continue;
    }
    if (role === 'transition' || role === 'act' || role === 'endact') lastSpeaker = role === 'transition' ? lastSpeaker : null;
    const rows = tag(baseRows(b, fmt, settings), b, role);
    units.push({
      kind: 'block', sb: spacingBefore(fmt, b.t, settings), rows, sceneId,
      keepNext: def.keepNext, keepPrev: def.keepPrev, split: def.split, newPage: b.pb || (def.newPage && i > 0),
    });
    i++;
  }
  return units;
}

// ---------- splitting ----------

function splitAction(rows, avail) {
  const sp = sentenceSplit(rows[0].blk, avail, 2, 2);
  if (sp) return { top: retag(sp.top, rows[0]), bottom: retag(sp.bot, rows[0]) };
  for (let k = Math.min(avail, rows.length - 2); k >= 2; k--) {
    if (rows[k - 1].sentenceEnd) return { top: rows.slice(0, k), bottom: rows.slice(k).map(r => ({ ...r, first: false })) };
  }
  return null;
}

function splitSpeech(u, rows, avail, settings) {
  const more = settings.moreContd !== false;
  const room = avail - (more ? 1 : 0);
  const groups = [];
  for (const r of rows) {
    const key = r.kind === 'char' ? 'char' : r.part;
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, kind: r.kind, rows: [], start: 0 });
    groups[groups.length - 1].rows.push(r);
  }
  let acc = 0;
  for (const g of groups) { g.start = acc; acc += g.rows.length; }
  let best = null;
  for (let gi = groups.length - 1; gi >= 1 && !best; gi--) {
    const g = groups[gi];
    if (g.kind === 'dial' && g.start < room) {
      const sp = sentenceSplit(g.rows[0].blk, room - g.start, 2, 2);
      if (sp) {
        best = {
          top: rows.slice(0, g.start).concat(retag(sp.top, g.rows[0])),
          bottom: retag(sp.bot, g.rows[0]).concat(rows.slice(g.start + g.rows.length)),
        };
        break;
      }
    }
    if (g.start <= room && groups[gi - 1].kind === 'dial') best = { top: rows.slice(0, g.start), bottom: rows.slice(g.start) };
  }
  if (!best) return null;
  const { top } = best;
  let bottom = best.bottom;
  const charRow = rows.find(r => r.kind === 'char');
  const charX = charRow ? charRow.segs[0].x : (u.cdef ? u.cdef.l : 3.7);
  if (more) {
    top.push({ segs: [{ x: charX, runs: [{ t: '(MORE)' }] }], kind: 'more', bid: top[top.length - 1].bid, sid: u.sceneId, synthetic: true });
    const cdef = u.cdef || { l: 3.7, w: 3.8, caps: 1 };
    const cr = rowsFor(escapeText(u.contdText), cdef)[0];
    bottom = [{ ...cr, kind: 'char', bid: charRow ? charRow.bid : bottom[0].bid, sid: u.sceneId, synthetic: true, first: false }, ...bottom];
  }
  return { top, bottom };
}

function escapeText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ---------- main layout ----------

export function layoutScript(doc, project, opts = {}) {
  const settings = { ...(project.settings || {}), ...(opts.settings || {}) };
  if (doc.kind === 'av') return layoutAV(doc, project, opts);
  const fmt = getFormat(doc.fmt);
  const geo = pageGeometry(settings);
  const cap = geo.lines;
  const revList = (doc.rev && doc.rev.list) || [];
  const latestRev = revList.length ? revList[revList.length - 1] : null;
  const revSet = new Set();
  if (settings.showRevMarks && latestRev) {
    if (opts.allRevMarks) revList.forEach(r => revSet.add(r.id)); else revSet.add(latestRev.id);
  }
  const units = buildUnits(doc, fmt, settings, revSet);

  const pages = [];
  let page, used;
  const scenes = new Map();
  const blockPage = new Map();
  const blockRows = new Map();
  const newPage = () => { page = { n: pages.length + 1, rows: [] }; pages.push(page); used = 0; };
  newPage();
  const addSceneLines = (sid, n) => { if (!sid) return; const s = scenes.get(sid); if (s) s.lines += n; };
  const place = (rows, sb, sid) => {
    if (!page.rows.length) sb = 0;
    used += sb;
    addSceneLines(sid, sb);
    for (const r of rows) {
      const row = { ...r, y: used };
      if (r.bid && !r.synthetic) { const c = blockRows.get(r.bid) || 0; row.bi = c; blockRows.set(r.bid, c + 1); }
      page.rows.push(row);
      if (r.kind === 'heading' && r.first !== false && r.bid && !scenes.has(r.bid)) scenes.set(r.bid, { page: page.n, y: used, lines: 0, num: r.sceneNum });
      if (r.bid && !r.synthetic && !blockPage.has(r.bid)) blockPage.set(r.bid, page.n);
      used++;
    }
    addSceneLines(sid, rows.length);
  };

  for (let ui = 0; ui < units.length; ui++) {
    let u = units[ui];
    if (u.newPage && page.rows.length) newPage();
    let rows = u.rows;
    if (!rows.length) continue;
    let guard = 0;
    while (rows.length && guard++ < 500) {
      const fresh = !page.rows.length;
      const sb = fresh ? 0 : u.sb;
      const avail = cap - used - sb;
      const need = rows.length;
      let extra = 0;
      if (u.keepNext && ui + 1 < units.length) {
        const nx = units[ui + 1];
        if (!nx.newPage) extra = nx.sb + Math.min(nx.rows.length, nx.kind === 'dual' ? nx.rows.length : 2);
      }
      if (need + extra <= avail || (fresh && need <= avail)) { place(rows, sb, u.sceneId); rows = []; break; }
      if (!fresh && need <= avail && u.keepNext) { newPage(); continue; }
      if (u.split && avail >= 2) {
        const sp = u.kind === 'speech' ? splitSpeech(u, rows, avail, settings) : splitAction(rows, avail);
        if (sp) { place(sp.top, sb, u.sceneId); newPage(); rows = sp.bottom; u = { ...u, sb: 0 }; continue; }
      }
      if (!fresh) { newPage(); continue; }
      // Taller than a whole page: hard split.
      const k = Math.max(1, avail);
      place(rows.slice(0, k), 0, u.sceneId);
      rows = rows.slice(k);
      if (rows.length) newPage();
    }
  }
  if (pages.length > 1 && !pages[pages.length - 1].rows.length) pages.pop();

  // eighths
  for (const s of scenes.values()) s.eighths = Math.max(1, Math.round(s.lines * 8 / cap));

  const out = pages.map(p => renderPage(p, geo, settings, doc, latestRev, revSet, opts));
  const pageStarts = pages.map(p => {
    const r = p.rows.find(x => !x.synthetic) || p.rows[0];
    return { n: p.n, bid: r ? r.bid : null, mid: r ? !r.first : false, row: r && r.bi ? r.bi : 0 };
  });
  const result = { geo, pages: out, scenes, blockPage, pageStarts, pageCount: pages.length };
  if (doc.tp && doc.tp.show && !opts.noTitle) result.titlePage = titlePage(doc.tp, geo);
  return result;
}

function renderPage(p, geo, settings, doc, latestRev, revSet, opts) {
  const items = [];
  let revised = false;
  for (const r of p.rows) {
    const y = geo.top + r.y * LINE;
    for (const s of r.segs) if (s.runs.length) items.push({ x: s.x, y, runs: s.runs, sid: r.sid });
    if (r.sceneNum && settings.sceneNumbers && settings.sceneNumbers !== 'none') {
      const n = r.sceneNum;
      const bold = !!settings.sceneBold;
      if (settings.sceneNumbers === 'left' || settings.sceneNumbers === 'both') items.push({ x: 1.5 - (n.length + 3) * CHAR, y, runs: [{ t: n, b: bold }], sid: r.sid });
      if (settings.sceneNumbers === 'right' || settings.sceneNumbers === 'both') items.push({ x: geo.w - 1.0 + 0.1, y, runs: [{ t: n, b: bold }], sid: r.sid });
    }
    if (r.rev) { revised = true; items.push({ x: geo.w - 0.55, y, runs: [{ t: '*' }], rev: true }); }
  }
  // header / footer
  const showNum = p.n > 1 || settings.pageNumFirst;
  const head = [];
  if (revised && latestRev) head.push(`${latestRev.name} Revision ${latestRev.date || ''}`.trim());
  if (showNum) head.push(`${p.n}.`);
  const headText = head.join('    ');
  if (headText) items.push({ x: geo.w - 1.0 - headText.length * CHAR, y: 0.5, runs: [{ t: headText }], header: true });
  if (settings.header) items.push({ x: 1.5, y: 0.5, runs: [{ t: settings.header }], header: true });
  if (settings.footer) items.push({ x: Math.max(1.0, (geo.w - settings.footer.length * CHAR) / 2), y: geo.h - 0.6, runs: [{ t: settings.footer }], header: true });
  const revColor = revised && latestRev && settings.revTint ? (REVISION_COLORS.find(c => c.name === latestRev.name) || {}).color : null;
  return { n: p.n, label: String(p.n), items, revised, tint: revColor, w: geo.w, h: geo.h };
}

export function titlePage(tp, geo) {
  const items = [];
  const center = (t, y, style = {}) => {
    const s = upperSafe(t);
    items.push({ x: (geo.w - s.length * CHAR) / 2, y, runs: [{ t: s, ...style }] });
  };
  const centerRaw = (t, y) => items.push({ x: (geo.w - t.length * CHAR) / 2, y, runs: [{ t }] });
  let y = 3.5;
  const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
  for (const l of lines(tp.title)) { center(l, y, { b: false }); y += LINE; }
  if (lines(tp.title).length) y += LINE * 1;
  if (tp.credit) { y += LINE; centerRaw(tp.credit, y); y += LINE; }
  if (lines(tp.author).length) { y += LINE; for (const l of lines(tp.author)) { centerRaw(l, y); y += LINE; } }
  if (lines(tp.source).length) { y += LINE * 2; for (const l of lines(tp.source)) { centerRaw(l, y); y += LINE; } }
  const contact = lines(tp.contact);
  let cy = geo.h - 1.0 - contact.length * LINE;
  for (const l of contact) { items.push({ x: 1.5, y: cy, runs: [{ t: l }] }); cy += LINE; }
  const right = [...lines(tp.draft), ...lines(tp.date), ...lines(tp.notes)];
  let ry = geo.h - 1.0 - right.length * LINE;
  for (const l of right) { items.push({ x: geo.w - 1.0 - l.length * CHAR, y: ry, runs: [{ t: l }] }); ry += LINE; }
  return { n: 0, label: 'Title', items, w: geo.w, h: geo.h, title: true };
}

// ---------- AV two-column layout ----------

const AV = { vx: 1.0, vw: 3.0, ax: 4.25, aw: 3.25, numX: 0.45 };

export function layoutAV(doc, project, opts = {}) {
  const settings = { ...(project.settings || {}) };
  const geo = pageGeometry(settings);
  const cap = geo.lines - 2; // header row + gap
  const pages = [];
  const scenes = new Map();
  const blockPage = new Map();
  let page, used;
  const newPage = () => { page = { n: pages.length + 1, rows: [] }; pages.push(page); used = 0; };
  newPage();
  const nums = sceneNumberMap(doc);
  let shot = 0, sid = null;
  const plain = { l: 0, w: 1 };
  for (const b of doc.blocks) {
    let rows;
    if (b.t === 'avscene') {
      sid = b.id;
      const txt = upperSafe(htmlToText(b.v || b.a || ''));
      const label = `${nums.get(b.id) || ''}. ${txt}`.trim();
      rows = wrapRuns([{ t: label, b: true }], 65).map(l => ({ segs: [{ x: AV.vx, runs: l.runs }] }));
      if (!rows.length) rows = [{ segs: [] }];
    } else {
      shot++;
      const v = wrapRuns(htmlToRuns(b.v || ''), AV.vw * 10);
      const a = wrapRuns(htmlToRuns(b.a || ''), AV.aw * 10);
      const n = Math.max(v.length, a.length, 1);
      rows = [];
      for (let k = 0; k < n; k++) {
        const segs = [];
        if (k === 0) segs.push({ x: AV.numX, runs: [{ t: String(shot) }] });
        if (v[k]) segs.push({ x: AV.vx, runs: v[k].runs });
        if (a[k]) segs.push({ x: AV.ax, runs: a[k].runs });
        rows.push({ segs });
      }
    }
    let sb = page.rows.length ? (b.t === 'avscene' ? 2 : 1) : 0;
    if (b.t === 'avscene' && used + sb + rows.length + 2 > cap && page.rows.length) { newPage(); sb = 0; }
    if (used + sb + rows.length > cap && page.rows.length && rows.length <= 4) { newPage(); sb = 0; }
    used += sb;
    if (sid && scenes.has(sid)) scenes.get(sid).lines += sb;
    for (const r of rows) {
      if (used >= cap) { newPage(); }
      page.rows.push({ ...r, y: used, bid: b.id, sid, rev: false });
      if (!blockPage.has(b.id)) blockPage.set(b.id, page.n);
      if (b.t === 'avscene' && !scenes.has(b.id)) scenes.set(b.id, { page: page.n, y: used, lines: 0, num: nums.get(b.id) });
      if (sid && scenes.has(sid)) scenes.get(sid).lines++;
      used++;
    }
  }
  for (const s of scenes.values()) s.eighths = Math.max(1, Math.round(s.lines * 8 / cap));
  const out = pages.map(p => {
    const items = [];
    const top = geo.top;
    items.push({ x: AV.vx, y: top, runs: [{ t: 'VIDEO', b: true, u: true }], header: true });
    items.push({ x: AV.ax, y: top, runs: [{ t: 'AUDIO', b: true, u: true }], header: true });
    for (const r of p.rows) for (const s of r.segs) items.push({ x: s.x, y: top + (r.y + 2) * LINE, runs: s.runs, sid: r.sid });
    if (p.n > 1 || settings.pageNumFirst) { const t = `${p.n}.`; items.push({ x: geo.w - 1.0 - t.length * CHAR, y: 0.5, runs: [{ t }], header: true }); }
    if (settings.header) items.push({ x: 1.0, y: 0.5, runs: [{ t: settings.header }], header: true });
    return { n: p.n, label: String(p.n), items, w: geo.w, h: geo.h, lines: [{ x1: 4.1, y1: top, x2: 4.1, y2: geo.h - geo.bottom }] };
  });
  const result = { geo, pages: out, scenes, blockPage, pageStarts: pages.map(p => ({ n: p.n, bid: p.rows[0] && p.rows[0].bid, mid: false })), pageCount: pages.length };
  if (doc.tp && doc.tp.show && !opts.noTitle) result.titlePage = titlePage(doc.tp, geo);
  return result;
}

// ---------- plain text rendering of the page model ----------

export function pagesToText(layout, { includeTitle = true } = {}) {
  const out = [];
  const pages = [...(includeTitle && layout.titlePage ? [layout.titlePage] : []), ...layout.pages];
  for (const p of pages) {
    const rows = new Map();
    for (const it of p.items) {
      const ln = Math.round(it.y / LINE);
      if (!rows.has(ln)) rows.set(ln, []);
      rows.get(ln).push(it);
    }
    const total = Math.round(p.h / LINE);
    const lines = [];
    for (let k = 0; k < total; k++) {
      const its = (rows.get(k) || []).sort((a, b) => a.x - b.x);
      let s = '';
      for (const it of its) {
        const col = Math.max(0, Math.round(it.x / CHAR) - 10);
        if (s.length < col) s += ' '.repeat(col - s.length);
        s += it.runs.map(r => r.t).join('');
      }
      lines.push(s.replace(/\s+$/, ''));
    }
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    while (lines.length && !lines[0]) lines.shift();
    out.push(lines.join('\n'));
  }
  return out.join('\n\f\n');
}

export function estimateRuntime(pageCount) {
  // One page per minute is the industry rule of thumb.
  const m = Math.round(pageCount);
  return m < 60 ? `~${m} min` : `~${Math.floor(m / 60)} hr ${m % 60} min`;
}
