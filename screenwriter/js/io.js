// Import / export: Fountain (.fountain), Final Draft (.fdx), plain text.
import { uid } from './util.js';
import { getFormat, typeDef, typeOfRole } from './formats.js';
import { htmlToRuns, htmlToText, runsToHTML, textToHTML, upperSafe, escText } from './inline.js';
import { defaultTitlePage, sceneNumberMap } from './model.js';

// ---------- role helpers ----------

function typeFor(fmt, role, fallback = 'action') {
  if (role === 'other' && fmt.types.centered) return 'centered';
  if (role === 'act' && fmt.types.act) return 'act';
  if (role === 'endact' && fmt.types.endact) return 'endact';
  if (role === 'shot' && fmt.types.shot) return 'shot';
  return typeOfRole(fmt, role) || typeOfRole(fmt, fallback) || fmt.order[0];
}

// ---------- Fountain export ----------

function runsToFountain(runs) {
  let out = '';
  for (const r of runs) {
    if (r.t === '\n') { out += '\n'; continue; }
    let t = r.t.replace(/([*_\\])/g, '\\$1');
    if (!t.trim()) { out += t; continue; }
    const lead = t.match(/^\s*/)[0], trail = t.match(/\s*$/)[0];
    t = t.trim();
    if (r.u) t = `_${t}_`;
    if (r.b && r.i) t = `***${t}***`;
    else if (r.b) t = `**${t}**`;
    else if (r.i) t = `*${t}*`;
    out += lead + t + trail;
  }
  return out;
}

const HEADING_RE = /^(INT|EXT|EST|INT\.?\/EXT|EXT\.?\/INT|I\/E)[\.\s]/i;

export function toFountain(doc, { notes = true } = {}) {
  const fmt = getFormat(doc.fmt);
  const out = [];
  const tp = doc.tp || {};
  const tpl = [];
  const add = (k, v) => {
    if (!v) return;
    const lines = String(v).split('\n');
    if (lines.length === 1) tpl.push(`${k}: ${lines[0]}`);
    else { tpl.push(`${k}:`); lines.forEach(l => tpl.push('   ' + l)); }
  };
  if (tp.show !== false) {
    add('Title', tp.title); add('Credit', tp.credit); add('Author', tp.author); add('Source', tp.source);
    add('Draft date', [tp.draft, tp.date].filter(Boolean).join('\n')); add('Contact', tp.contact); add('Notes', tp.notes);
  }
  if (tpl.length) out.push(tpl.join('\n'), '');
  const nums = doc.locked ? sceneNumberMap(doc) : null;
  const comments = new Map((doc.comments || []).map(c => [c.id, c]));
  const blocks = doc.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const def = typeDef(fmt, b.t);
    const role = def.role;
    const runs = htmlToRuns(b.h);
    let text = runsToFountain(def.caps ? runs.map(r => ({ ...r, t: upperSafe(r.t) })) : runs);
    if (def.prefix) text = def.prefix + text;
    let noteText = '';
    if (notes) {
      const ids = [...new Set(runs.filter(r => r.cm).map(r => r.cm))];
      for (const id of ids) { const c = comments.get(id); if (c) noteText += ` [[${c.text.replace(/\]\]/g, '] ]')}]]`; }
    }
    if (b.pb || (def.newPage && i > 0)) out.push('===', '');
    const prevRole = i > 0 ? typeDef(fmt, blocks[i - 1].t).role : null;
    const inSpeech = (role === 'paren' || role === 'dialogue') && (prevRole === 'character' || prevRole === 'paren' || prevRole === 'dialogue');
    if (inSpeech && out.length && out[out.length - 1] === '') out.pop();
    switch (role) {
      case 'heading': {
        let t = text.trim();
        if (fmt.id !== 'screenplay' || !HEADING_RE.test(t)) t = '.' + t;
        if (nums && nums.get(b.id)) t += ` #${nums.get(b.id)}#`;
        out.push(t + noteText);
        if (b.s && b.s.syn) out.push('', '= ' + b.s.syn.replace(/\n/g, ' '));
        break;
      }
      case 'character': {
        let t = upperSafe(text.trim());
        if (!/[A-Z]/.test(t.replace(/\(.*?\)/g, '')) || /^[!@~.>=#]/.test(t)) t = '@' + t;
        if (b.d) t += ' ^';
        out.push(t + noteText);
        break;
      }
      case 'paren': out.push(text.trim() + noteText); break;
      case 'dialogue': out.push(text.split('\n').map(l => l.trim() ? l : '  ').join('\n') + noteText); break;
      case 'transition': {
        const t = upperSafe(text.trim());
        out.push((/TO:$/.test(t) ? t : '> ' + t) + noteText);
        break;
      }
      case 'act': case 'endact': out.push('> ' + upperSafe(text.trim()) + ' <' + noteText); break;
      case 'other':
        if (def.align === 'center') { out.push('> ' + text.trim() + ' <' + noteText); break; }
      // fallthrough
      default: {
        let t = text;
        const first = t.split('\n')[0];
        const looksSpecial = HEADING_RE.test(first) || /^[!@~.>=#]/.test(first) || /^\[\[/.test(first) ||
          (first === upperSafe(first) && /[A-Z]/.test(first) && (/TO:$/.test(first.trim()) || t.includes('\n')));
        if (looksSpecial) t = '!' + t;
        out.push(t + noteText);
      }
    }
    out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------- Fountain import ----------

function fountainInline(s) {
  let t = escText(s);
  const ph = [];
  t = t.replace(/\\([*_\\])/g, (_, c) => { ph.push(c); return `\u0000${ph.length - 1}\u0000`; });
  t = t.replace(/\*\*\*(?=\S)(.+?)(?<=\S)\*\*\*/g, '<b><i>$1</i></b>');
  t = t.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<b>$1</b>');
  t = t.replace(/\*(?=\S)(.+?)(?<=\S)\*/g, '<i>$1</i>');
  t = t.replace(/_(?=\S)(.+?)(?<=\S)_/g, '<u>$1</u>');
  t = t.replace(/\u0000(\d+)\u0000/g, (_, n) => escText(ph[+n]));
  return t;
}

function isAllCaps(s) {
  const core = s.replace(/\(.*?\)/g, '').replace(/\^$/, '');
  return /\p{Lu}/u.test(core) && !/\p{Ll}/u.test(core);
}

export function parseFountain(src, fmtId = 'screenplay') {
  const fmt = getFormat(fmtId);
  let text = String(src).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const notes = [];
  text = text.replace(/\[\[([\s\S]*?)\]\]/g, (_, n) => { notes.push(n.trim()); return ''; });
  let lines = text.split('\n');

  // Title page
  const tp = defaultTitlePage();
  tp.show = false;
  let start = 0;
  while (start < lines.length && !lines[start].trim()) start++;
  if (start < lines.length && /^[A-Za-z][A-Za-z ]*:/.test(lines[start]) && !HEADING_RE.test(lines[start])) {
    let key = null;
    const vals = {};
    let k = start;
    for (; k < lines.length; k++) {
      const l = lines[k];
      if (!l.trim()) break;
      const m = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/.exec(l);
      if (m && !/^\s/.test(l)) { key = m[1].toLowerCase().trim(); vals[key] = m[2].trim() ? [m[2].trim()] : []; }
      else if (key) vals[key].push(l.trim());
    }
    const get = (...ks) => ks.map(x => (vals[x] || []).join('\n')).filter(Boolean).join('\n');
    tp.title = get('title').replace(/[*_]/g, '');
    tp.credit = get('credit') || 'Written by';
    tp.author = get('author', 'authors');
    tp.source = get('source');
    tp.date = get('draft date', 'date');
    tp.contact = get('contact');
    tp.notes = get('notes', 'copyright');
    tp.show = !!(tp.title || tp.author);
    start = k;
  }
  lines = lines.slice(start);

  const blocks = [];
  const T = role => typeFor(fmt, role);
  const push = (role, html, extra = {}) => {
    const b = { id: uid('b'), t: T(role), h: html, ...extra };
    if (pendingBreak) { b.pb = 1; pendingBreak = false; }
    blocks.push(b);
    return b;
  };
  let pendingBreak = false;
  let lastScene = null;
  const blank = i => i < 0 || i >= lines.length || !lines[i].trim();

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    if (/^={3,}$/.test(line)) { pendingBreak = true; continue; }
    if (/^#/.test(line)) {
      const sec = line.replace(/^#+\s*/, '');
      if (/^(act|teaser|cold open|tag|prologue|epilogue)\b/i.test(sec) && fmt.types.act) push('act', fountainInline(sec));
      continue;
    }
    if (/^=(?!=)/.test(line)) { if (lastScene) lastScene.s = { ...(lastScene.s || {}), syn: ((lastScene.s && lastScene.s.syn ? lastScene.s.syn + ' ' : '') + line.slice(1).trim()) }; continue; }

    // Scene heading
    const forcedHead = /^\.[^.]/.test(line);
    if (forcedHead || (blank(i - 1) && HEADING_RE.test(line))) {
      let t = forcedHead ? line.slice(1) : line;
      let num = null;
      const nm = /\s*#([^#\s]+)#\s*$/.exec(t);
      if (nm) { num = nm[1]; t = t.slice(0, nm.index); }
      const b = push('heading', fountainInline(t.trim()));
      if (num) b.s = { num };
      lastScene = b;
      continue;
    }
    // Centered
    const cm = /^>\s*(.*?)\s*<$/.exec(line);
    if (cm) { push(fmt.types.centered ? 'other' : 'action', fountainInline(cm[1])); continue; }
    // Transitions
    if (/^>/.test(line)) { push('transition', fountainInline(line.slice(1).trim())); continue; }
    if (blank(i - 1) && isAllCaps(line) && (/TO:$/.test(line) || (blank(i + 1) && /^(FADE OUT|FADE TO BLACK|CUT TO BLACK|SMASH TO BLACK)\.?$/.test(line)))) { push('transition', fountainInline(line)); continue; }
    // Character + dialogue
    const forcedChar = /^@/.test(line);
    if (!/^!/.test(line) && (forcedChar || (isAllCaps(line) && !/^[!.>~=]/.test(line))) && blank(i - 1) && !blank(i + 1)) {
      let name = forcedChar ? line.slice(1) : line;
      let dual = false;
      if (/\^\s*$/.test(name)) { dual = true; name = name.replace(/\s*\^\s*$/, ''); }
      push('character', fountainInline(name.trim()), dual ? { d: 1 } : {});
      let dlg = [];
      const flush = () => { if (dlg.length) { push('dialogue', dlg.map(fountainInline).join('<br>')); dlg = []; } };
      let j = i + 1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (!l.trim()) { if (l.length >= 2) { dlg.push(''); continue; } break; }
        const lt = l.trim();
        if (/^\(.*\)$/.test(lt)) { flush(); push('paren', fountainInline(lt)); continue; }
        dlg.push(lt.replace(/^~\s*/, ''));
      }
      flush();
      i = j - 1;
      continue;
    }
    // Action (consecutive lines join with soft breaks)
    const parts = [];
    let j = i;
    for (; j < lines.length && lines[j].trim(); j++) {
      let l = lines[j].replace(/\s+$/, '');
      if (j === i) l = l.replace(/^\s*!/, '');
      if (/^\s*~/.test(l)) l = l.replace(/^\s*~\s*/, '');
      parts.push(fountainInline(l.replace(/^\s{0,3}/, '')));
      // a following heading/forced element after a single line ends the action
      if (j + 1 < lines.length && (/^\s*\.[^.]/.test(lines[j + 1]) || /^\s*[>@]/.test(lines[j + 1]))) { j++; break; }
    }
    push('action', parts.join('<br>'));
    i = j - 1;
  }
  if (!blocks.length) blocks.push({ id: uid('b'), t: fmt.first, h: '' });
  return { blocks, tp, notes };
}

// ---------- FDX ----------

const FDX_TYPES = {
  heading: 'Scene Heading', action: 'Action', character: 'Character', paren: 'Parenthetical', dialogue: 'Dialogue',
  transition: 'Transition', shot: 'Shot', other: 'General', act: 'New Act', endact: 'End of Act',
};
const FDX_IN = {
  'scene heading': 'heading', action: 'action', character: 'character', parenthetical: 'paren', dialogue: 'dialogue',
  transition: 'transition', shot: 'shot', general: 'other', 'new act': 'act', 'end of act': 'endact', lyrics: 'dialogue',
  'cast list': 'action', 'act break': 'act', 'end of teaser': 'endact', teaser: 'act',
};

function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function runsToFdxText(runs, caps) {
  const out = [];
  for (const r of runs) {
    let t = r.t;
    if (caps) t = upperSafe(t);
    const st = [r.b && 'Bold', r.i && 'Italic', r.u && 'Underline'].filter(Boolean).join('+');
    const last = out[out.length - 1];
    if (last && last.st === st) last.t += t; else out.push({ t, st });
  }
  if (!out.length) out.push({ t: '', st: '' });
  return out.map(x => `<Text${x.st ? ` Style="${x.st}"` : ''}>${xmlEsc(x.t)}</Text>`).join('');
}

function fdxColor(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3] : '';
}

export function toFDX(doc) {
  const fmt = getFormat(doc.fmt);
  const nums = sceneNumberMap(doc);
  const paras = [];
  const para = (b) => {
    const def = typeDef(fmt, b.t);
    const role = def.role;
    const type = FDX_TYPES[role] || 'Action';
    let runs = htmlToRuns(b.h);
    if (def.prefix) runs = [{ t: def.prefix }, ...runs];
    const attrs = [`Type="${type}"`];
    if (role === 'heading' && nums.get(b.id)) attrs.push(`Number="${xmlEsc(nums.get(b.id))}"`);
    if (def.align === 'center') attrs.push('Alignment="Center"');
    if (b.pb) attrs.push('StartsNewPage="Yes"');
    let inner = '';
    if (role === 'heading' && b.s && (b.s.syn || b.s.color)) {
      inner += `<SceneProperties${b.s.color ? ` Color="${fdxColor(b.s.color)}"` : ''} Title="">`;
      if (b.s.syn) inner += `<Summary><Paragraph Type="General"><Text>${xmlEsc(b.s.syn)}</Text></Paragraph></Summary>`;
      inner += '</SceneProperties>';
    }
    inner += runsToFdxText(runs, def.caps && role !== 'action');
    return `    <Paragraph ${attrs.join(' ')}>${inner}</Paragraph>`;
  };
  const blocks = doc.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const role = typeDef(fmt, b.t).role;
    // Dual dialogue: the second speech's character has d=1; wrap both speeches.
    if (role === 'character') {
      let j = i + 1;
      while (j < blocks.length && ['paren', 'dialogue'].includes(typeDef(fmt, blocks[j].t).role)) j++;
      const nb = blocks[j];
      if (nb && nb.d && typeDef(fmt, nb.t).role === 'character') {
        let k = j + 1;
        while (k < blocks.length && ['paren', 'dialogue'].includes(typeDef(fmt, blocks[k].t).role)) k++;
        const inner = blocks.slice(i, k).map(para).map(s => '  ' + s).join('\n');
        paras.push(`    <Paragraph><DualDialogue>\n${inner}\n    </DualDialogue></Paragraph>`);
        i = k - 1;
        continue;
      }
    }
    paras.push(para(b));
  }
  const tp = doc.tp || {};
  const tpParas = [];
  const tpp = (t, align = 'Center') => tpParas.push(`      <Paragraph Alignment="${align}" Type="Text"><Text>${xmlEsc(t)}</Text></Paragraph>`);
  if (tp.show !== false && (tp.title || tp.author)) {
    for (let k = 0; k < 16; k++) tpp('');
    for (const l of String(tp.title || '').split('\n')) tpp(upperSafe(l));
    tpp('');
    if (tp.credit) { tpp(tp.credit); tpp(''); }
    for (const l of String(tp.author || '').split('\n')) tpp(l);
    if (tp.source) { tpp(''); for (const l of tp.source.split('\n')) tpp(l); }
    for (let k = 0; k < 14; k++) tpp('');
    for (const l of String(tp.contact || '').split('\n').filter(Boolean)) tpp(l, 'Left');
    for (const l of [tp.draft, tp.date, tp.notes].filter(Boolean).join('\n').split('\n').filter(Boolean)) tpp(l, 'Right');
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${paras.join('\n')}
  </Content>
  <TitlePage>
    <Content>
${tpParas.join('\n')}
    </Content>
  </TitlePage>
</FinalDraft>
`;
}

function fdxParaRuns(p) {
  const runs = [];
  for (const t of p.children) {
    if (t.tagName !== 'Text') continue;
    const st = t.getAttribute('Style') || '';
    const txt = t.textContent || '';
    txt.split(/\r?\n/).forEach((part, k) => {
      if (k > 0) runs.push({ t: '\n' });
      if (part) runs.push({ t: part, b: /Bold/.test(st), i: /Italic/.test(st), u: /Underline/.test(st) });
    });
  }
  return runs;
}

export function parseFDX(xml, fmtId = 'screenplay') {
  const fmt = getFormat(fmtId);
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.querySelector('parsererror')) throw new Error('This FDX file could not be read (invalid XML).');
  const root = dom.querySelector('FinalDraft');
  if (!root) throw new Error('Not a Final Draft file.');
  const content = Array.from(root.children).find(c => c.tagName === 'Content');
  const blocks = [];
  const numbers = [];
  const handle = (p, dualSecond = false) => {
    const typeName = (p.getAttribute('Type') || 'Action').toLowerCase();
    let role = FDX_IN[typeName] || 'action';
    if (role === 'other' && (p.getAttribute('Alignment') || '').toLowerCase() !== 'center') role = 'action';
    const runs = fdxParaRuns(p);
    const b = { id: uid('b'), t: typeFor(fmt, role), h: runsToHTML(runs) };
    if (dualSecond) b.d = 1;
    if (/yes/i.test(p.getAttribute('StartsNewPage') || '')) b.pb = 1;
    if (role === 'heading') {
      const s = {};
      const num = p.getAttribute('Number');
      if (num) { s.num = num; numbers.push(num); }
      const sp = Array.from(p.children).find(c => c.tagName === 'SceneProperties');
      if (sp) {
        const sum = sp.querySelector('Summary');
        if (sum) s.syn = Array.from(sum.querySelectorAll('Text')).map(t => t.textContent).join(' ').trim();
        const col = sp.getAttribute('Color');
        if (col) {
          const m = /^#?([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})$/i.exec(col);
          if (m) s.color = '#' + m[1].slice(0, 2) + m[2].slice(0, 2) + m[3].slice(0, 2);
        }
        if (!s.syn && sp.getAttribute('Title')) s.syn = sp.getAttribute('Title');
      }
      if (Object.keys(s).length) b.s = s;
    }
    blocks.push(b);
  };
  for (const p of content ? Array.from(content.children) : []) {
    if (p.tagName !== 'Paragraph') continue;
    const dd = Array.from(p.children).find(c => c.tagName === 'DualDialogue');
    if (dd) {
      let charCount = 0;
      for (const q of Array.from(dd.children)) {
        if (q.tagName !== 'Paragraph') continue;
        const isChar = /character/i.test(q.getAttribute('Type') || '');
        if (isChar) charCount++;
        handle(q, isChar && charCount === 2);
      }
      continue;
    }
    handle(p);
  }
  // Title page
  const tp = defaultTitlePage();
  tp.show = false;
  const tpc = root.querySelector('TitlePage > Content');
  if (tpc) {
    const center = [], left = [], right = [];
    for (const p of Array.from(tpc.querySelectorAll(':scope > Paragraph'))) {
      const t = Array.from(p.querySelectorAll('Text')).map(x => x.textContent).join('').trim();
      if (!t) continue;
      const al = (p.getAttribute('Alignment') || 'Left').toLowerCase();
      (al === 'center' ? center : al === 'right' ? right : left).push(t);
    }
    if (center.length) {
      const ci = center.findIndex(l => /^(written\s+by|screenplay\s+by|teleplay\s+by|story\s+by|by)$/i.test(l));
      if (ci > 0) {
        tp.title = center.slice(0, ci).join('\n');
        tp.credit = center[ci];
        const rest = center.slice(ci + 1);
        const si = rest.findIndex(l => /^(based on|from)/i.test(l));
        tp.author = (si >= 0 ? rest.slice(0, si) : rest).join('\n');
        tp.source = si >= 0 ? rest.slice(si).join('\n') : '';
      } else { tp.title = center[0]; tp.author = center.slice(1).join('\n'); }
    }
    tp.contact = left.join('\n');
    tp.date = right.join('\n');
    tp.show = !!(tp.title || tp.author);
  }
  if (!blocks.length) blocks.push({ id: uid('b'), t: fmt.first, h: '' });
  const sequential = numbers.every((n, i) => String(i + 1) === String(n));
  return { blocks, tp, locked: numbers.length > 0 && !sequential };
}

// Detect and parse any supported script file.
export function parseScriptFile(name, text, fmtId) {
  const lower = (name || '').toLowerCase();
  if (lower.endsWith('.fdx') || /^\s*<\?xml[\s\S]{0,200}<FinalDraft/.test(text)) return { ...parseFDX(text, fmtId), source: 'Final Draft' };
  return { ...parseFountain(text, fmtId), source: lower.endsWith('.fountain') || lower.endsWith('.spmd') ? 'Fountain' : 'Text' };
}

// Plain-text paste: parse as Fountain, but treat every line as its own element when the text has no blank lines.
export function parsePlainPaste(text, fmtId) {
  const t = text.replace(/\r\n?/g, '\n').trim();
  if (!/\n\s*\n/.test(t)) {
    // No blank lines: one element per line, typed like the element being pasted into.
    return t.split('\n').map(l => l.trim()).filter(Boolean).map(l => ({ id: uid('b'), t: null, h: textToHTML(l) }));
  }
  return parseFountain(t, fmtId).blocks;
}

// Plain text of blocks for the clipboard (keeps screenplay grouping).
export function blocksToPlain(fmt, blocks) {
  const out = [];
  blocks.forEach((b, i) => {
    const def = typeDef(fmt, b.t);
    let t = htmlToText(b.h);
    if (def.caps) t = upperSafe(t);
    if (def.prefix) t = def.prefix + t;
    const role = def.role;
    const prev = i > 0 ? typeDef(fmt, blocks[i - 1].t).role : null;
    if (i > 0 && !((role === 'dialogue' || role === 'paren') && ['character', 'paren', 'dialogue'].includes(prev))) out.push('');
    out.push(t);
  });
  return out.join('\n');
}
