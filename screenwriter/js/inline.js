// Inline content of a block is a small, sanitized HTML subset:
//   <b> <i> <u> <br> <span class="tg" data-tg="catalogId"> (breakdown tag) <span class="cm" data-cm="commentId"> (comment)
// Everything else is unwrapped. These helpers convert between that HTML, plain text and styled runs.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

export function escText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

export function textToHTML(text) {
  return escText(text).replace(/\n/g, '<br>');
}

// Sanitize a DOM subtree into the allowed subset.
export function sanitizeNode(root) {
  let out = '';
  const walk = (n, inTg, inCm) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { out += escText(c.data); continue; }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName.toLowerCase();
      if (tag === 'br') { out += '<br>'; continue; }
      if (tag === 'script' || tag === 'style' || tag === 'template') continue;
      let open = '', close = '', tg = inTg, cm = inCm;
      const st = c.style || {};
      const b = tag === 'b' || tag === 'strong' || /^(bold|[6-9]00)$/.test(st.fontWeight || '');
      const i = tag === 'i' || tag === 'em' || st.fontStyle === 'italic';
      const u = tag === 'u' || /underline/.test(st.textDecoration || st.textDecorationLine || '');
      if (tag === 'span' && c.classList.contains('tg') && c.dataset.tg && !inTg) {
        open += `<span class="tg" data-tg="${escAttr(c.dataset.tg)}">`; close = '</span>' + close; tg = true;
      } else if (tag === 'span' && c.classList.contains('cm') && c.dataset.cm && !inCm) {
        open += `<span class="cm" data-cm="${escAttr(c.dataset.cm)}">`; close = '</span>' + close; cm = true;
      }
      if (b) { open += '<b>'; close = '</b>' + close; }
      if (i) { open += '<i>'; close = '</i>' + close; }
      if (u) { open += '<u>'; close = '</u>' + close; }
      const isBlock = /^(div|p|li|h\d|tr|blockquote)$/.test(tag);
      out += open;
      walk(c, tg, cm);
      out += close;
      if (isBlock && c.nextSibling) out += ' ';
    }
  };
  walk(root, false, false);
  return stripPlaceholderBr(normalizeHTML(out));
}

const tpl = typeof document !== 'undefined' ? document.createElement('template') : null;
export function sanitizeHTML(html) {
  tpl.innerHTML = html;
  return sanitizeNode(tpl.content);
}

// Remove empty formatting tags, merge adjacent identical tags, drop a single trailing <br>.
export function normalizeHTML(html) {
  let prev;
  do {
    prev = html;
    html = html.replace(/<(b|i|u)><\/\1>/g, '').replace(/<span class="(?:tg|cm)" data-(?:tg|cm)="[^"]*"><\/span>/g, '');
    html = html.replace(/<\/(b|i|u)><\1>/g, '');
  } while (html !== prev);
  return html;
}

// The DOM needs one extra trailing <br> to show a final empty line (or to give an empty block height).
const TRAILING_BR = /<br>((?:<\/(?:b|i|u|span)>)*)$/;
export function stripPlaceholderBr(html) { return html.replace(TRAILING_BR, '$1'); }
export function endsWithBr(html) { return TRAILING_BR.test(html); }
export function domHTML(html) { return !html ? '<br>' : (endsWithBr(html) ? html + '<br>' : html); }

const TOKEN = /<(\/?)(b|i|u|span|br)\b([^>]*)>|&(amp|lt|gt|quot|#39|apos|nbsp|#\d+|#x[0-9a-f]+);|([^<&]+)|([<&])/gi;

function decodeEnt(e) {
  if (ENT[e] != null) return ENT[e];
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return '';
}

// -> [{t, b, i, u, tg, cm}] ; '\n' appears as its own run for <br>
export function htmlToRuns(html) {
  const runs = [];
  let b = 0, i = 0, u = 0;
  const spans = [];
  let m;
  TOKEN.lastIndex = 0;
  const push = (t) => {
    if (!t) return;
    const tg = spans.find(s => s.tg)?.tg || null;
    const cm = spans.find(s => s.cm)?.cm || null;
    const last = runs[runs.length - 1];
    if (last && last.b === !!b && last.i === !!i && last.u === !!u && last.tg === tg && last.cm === cm && t !== '\n' && last.t !== '\n') last.t += t;
    else runs.push({ t, b: !!b, i: !!i, u: !!u, tg, cm });
  };
  while ((m = TOKEN.exec(html || ''))) {
    if (m[2]) {
      const tag = m[2].toLowerCase(), close = !!m[1];
      if (tag === 'br') { push('\n'); continue; }
      if (tag === 'b') b += close ? -1 : 1;
      else if (tag === 'i') i += close ? -1 : 1;
      else if (tag === 'u') u += close ? -1 : 1;
      else if (tag === 'span') {
        if (close) spans.pop();
        else {
          const a = m[3] || '';
          const tg = /data-tg="([^"]*)"/.exec(a), cm = /data-cm="([^"]*)"/.exec(a);
          spans.push({ tg: tg ? tg[1] : null, cm: cm ? cm[1] : null });
        }
      }
    } else if (m[4]) push(decodeEnt(m[4].toLowerCase()));
    else if (m[5]) push(m[5]);
    else if (m[6]) push(m[6]);
  }
  for (const r of runs) r.t = r.t.replace(/ /g, ' ');
  return runs;
}

export function htmlToText(html) {
  if (!html) return '';
  if (!/[<&]/.test(html)) return html;
  return htmlToRuns(html).map(r => r.t).join('');
}

export function runsToHTML(runs) {
  let out = '';
  for (const r of runs) {
    if (r.t === '\n') { out += '<br>'; continue; }
    let s = escText(r.t);
    if (r.u) s = `<u>${s}</u>`;
    if (r.i) s = `<i>${s}</i>`;
    if (r.b) s = `<b>${s}</b>`;
    if (r.tg) s = `<span class="tg" data-tg="${escAttr(r.tg)}">${s}</span>`;
    if (r.cm) s = `<span class="cm" data-cm="${escAttr(r.cm)}">${s}</span>`;
    out += s;
  }
  return normalizeHTML(out);
}

// Remove all spans for a given tag/comment id (unwrap).
export function unwrapSpan(html, attr, id) {
  const runs = htmlToRuns(html);
  for (const r of runs) if (r[attr] === id) r[attr] = null;
  return runsToHTML(runs);
}

export function htmlHasSpan(html, attr, id) {
  return html.includes(`data-${attr}="${id}"`);
}

export function spanIds(html, attr) {
  const out = [];
  const re = new RegExp(`data-${attr}="([^"]*)"`, 'g');
  let m;
  while ((m = re.exec(html || ''))) out.push(m[1]);
  return out;
}

// Text covered by spans of a given attr: [{id, text}]
export function spanTexts(html, attr) {
  const res = [];
  const runs = htmlToRuns(html);
  let cur = null;
  for (const r of runs) {
    const id = r[attr];
    if (id && cur && cur.id === id) cur.text += r.t;
    else if (id) { cur = { id, text: r.t }; res.push(cur); }
    else cur = null;
  }
  return res;
}

// Upper-case preserving length (so offsets stay aligned).
export function upperSafe(s) {
  let out = '';
  for (const ch of s) { const u = ch.toUpperCase(); out += u.length === ch.length ? u : ch; }
  return out;
}

// ---------- run operations (offsets count '\n' as one character) ----------

export function runsLen(runs) { let n = 0; for (const r of runs) n += r.t.length; return n; }
export function runsText(runs) { return runs.map(r => r.t).join(''); }

export function splitRuns(runs, off) {
  const L = [], R = [];
  let pos = 0;
  for (const r of runs) {
    const end = pos + r.t.length;
    if (end <= off) L.push({ ...r });
    else if (pos >= off) R.push({ ...r });
    else { L.push({ ...r, t: r.t.slice(0, off - pos) }); R.push({ ...r, t: r.t.slice(off - pos) }); }
    pos = end;
  }
  return [L, R];
}

export function deleteRuns(runs, s, e) {
  const [L] = splitRuns(runs, s);
  const [, R] = splitRuns(runs, e);
  return L.concat(R);
}

export function insertRuns(runs, off, text, style = null) {
  if (!text) return runs;
  const [L, R] = splitRuns(runs, off);
  const prev = L[L.length - 1], next = R[0];
  let st = style;
  if (!st) {
    const base = prev && prev.t !== '\n' ? prev : (next && next.t !== '\n' ? next : null);
    st = base ? { b: base.b, i: base.i, u: base.u } : { b: false, i: false, u: false };
    if (prev && next && prev.tg && prev.tg === next.tg) st.tg = prev.tg;
    if (prev && next && prev.cm && prev.cm === next.cm) st.cm = prev.cm;
  }
  const ins = [];
  text.split('\n').forEach((part, k) => {
    if (k > 0) ins.push({ t: '\n', b: false, i: false, u: false });
    if (part) ins.push({ t: part, b: !!st.b, i: !!st.i, u: !!st.u, tg: st.tg || null, cm: st.cm || null });
  });
  return L.concat(ins, R);
}

export function applyAttr(runs, s, e, attr, val) {
  const [L, rest] = splitRuns(runs, s);
  const [M, R] = splitRuns(rest, e - s);
  for (const r of M) if (r.t !== '\n') r[attr] = val;
  return L.concat(M, R);
}

export function runsStyleAt(runs, off) {
  let pos = 0;
  for (const r of runs) { const end = pos + r.t.length; if (off > pos && off <= end) return r; pos = end; }
  return runs[0] || null;
}
