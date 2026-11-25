// Small DOM and data helpers shared by every module.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// h('div.card#main', {onclick, style:{}, dataset:{}}, ...children)
export function h(tag, props, ...children) {
  let cls = [];
  let id = null;
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  let name = 'div';
  if (m) {
    name = m[1] || 'div';
    (m[2] || '').replace(/([.#])([\w-]+)/g, (_, k, v) => {
      if (k === '.') cls.push(v); else id = v;
    });
  } else name = tag;
  const el = document.createElement(name);
  if (cls.length) el.className = cls.join(' ');
  if (id) el.id = id;
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') el.className = [el.className, v].filter(Boolean).join(' ');
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function uid(prefix = '') {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return prefix + Date.now().toString(36).slice(-5) + r[0].toString(36).slice(0, 5) + r[1].toString(36).slice(0, 3);
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.flush = (...a) => { if (t) { clearTimeout(t); t = null; fn(...a); } };
  d.cancel = () => { clearTimeout(t); t = null; };
  d.pending = () => !!t;
  return d;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

export function plural(n, word, pl) { return `${n} ${n === 1 ? word : (pl || word + 's')}`; }

export function download(filename, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

export function pickFile(accept = '', multiple = false, capture = null) {
  return new Promise(resolve => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    if (multiple) inp.multiple = true;
    if (capture) inp.setAttribute('capture', capture);
    inp.addEventListener('change', () => { resolve(Array.from(inp.files || [])); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}

export function readFile(file, as = 'text') {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    if (as === 'dataURL') r.readAsDataURL(file);
    else if (as === 'arrayBuffer') r.readAsArrayBuffer(file);
    else r.readAsText(file);
  });
}

export function fmtDate(ts, opts = { year: 'numeric', month: 'short', day: 'numeric' }) {
  if (!ts) return '';
  const d = typeof ts === 'string' ? parseISODate(ts) : new Date(ts);
  if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, opts);
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} days ago`;
  return fmtDate(ts);
}

// 'YYYY-MM-DD' -> local Date (avoids UTC shift)
export function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return new Date(s);
  return new Date(+m[1], +m[2] - 1, +m[3]);
}
export function isoDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function todayISO() { return isoDate(new Date()); }

// eighths -> "1 3/8"
export function fmtEighths(e) {
  e = Math.round(e || 0);
  const whole = Math.floor(e / 8), rem = e % 8;
  if (!whole && !rem) return '0';
  return [whole || '', rem ? `${rem}/8` : ''].filter(Boolean).join(' ');
}

export function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCSV(rows) { return rows.map(r => r.map(csvCell).join(',')).join('\r\n'); }

export function slug(s) {
  return String(s || 'untitled').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 60) || 'untitled';
}

export function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

export function moveItem(arr, from, to) {
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
  return arr;
}

const ONES = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
export function numberWord(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  return String(n);
}

export function money(v, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(v || 0);
  } catch { return (v || 0).toFixed(2); }
}

export function wordCount(s) { const m = String(s).match(/[\p{L}\p{N}'’]+/gu); return m ? m.length : 0; }

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';
export const isTouch = matchMedia('(pointer: coarse)').matches;

// Pointer-driven sortable list that works with mouse and touch.
// opts: {items: selector for draggable children, handle: selector (optional), onEnd(fromIndex, toIndex, el), axis:'y'|'grid'}
export function sortable(container, opts) {
  let drag = null;
  const itemsSel = opts.items;
  container.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const handle = opts.handle ? e.target.closest(opts.handle) : e.target.closest(itemsSel);
    if (!handle || !container.contains(handle)) return;
    const item = handle.closest(itemsSel);
    if (!item || item.parentElement !== container) return;
    if (!opts.handle && e.target.closest('input,textarea,select,button,[contenteditable="true"],a')) return;
    const startX = e.clientX, startY = e.clientY;
    const items = () => Array.from(container.children).filter(c => c.matches(itemsSel));
    const from = items().indexOf(item);
    let started = false, ghost = null, placeholder = null, offX = 0, offY = 0;
    const touchDelay = e.pointerType === 'touch' && !opts.handle;
    const t0 = Date.now();
    const move = ev => {
      if (!started) {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (dist < 6) return;
        if (touchDelay && Date.now() - t0 < 250) { cleanup(); return; }
        started = true;
        const r = item.getBoundingClientRect();
        offX = startX - r.left; offY = startY - r.top;
        placeholder = item.cloneNode(false);
        placeholder.classList.add('sort-placeholder');
        placeholder.style.height = r.height + 'px';
        placeholder.style.width = r.width + 'px';
        ghost = item;
        container.insertBefore(placeholder, item);
        ghost.classList.add('sort-ghost');
        Object.assign(ghost.style, { position: 'fixed', width: r.width + 'px', height: r.height + 'px', left: r.left + 'px', top: r.top + 'px', zIndex: 1000, pointerEvents: 'none' });
        document.body.classList.add('dragging');
      }
      ev.preventDefault();
      ghost.style.left = (ev.clientX - offX) + 'px';
      ghost.style.top = (ev.clientY - offY) + 'px';
      const list = items().filter(c => c !== ghost);
      let target = null;
      for (const c of list) {
        if (c === placeholder) continue;
        const r = c.getBoundingClientRect();
        if (opts.axis === 'grid') {
          if (ev.clientY >= r.top && ev.clientY <= r.bottom && ev.clientX >= r.left && ev.clientX <= r.right) {
            target = { el: c, before: ev.clientX < r.left + r.width / 2 };
            break;
          }
        } else if (ev.clientY < r.top + r.height / 2) { target = { el: c, before: true }; break; }
      }
      if (target) {
        if (target.before) container.insertBefore(placeholder, target.el);
        else container.insertBefore(placeholder, target.el.nextSibling);
      } else if (opts.axis !== 'grid') {
        const last = list[list.length - 1];
        if (last && last !== placeholder) container.insertBefore(placeholder, last.nextSibling);
      }
      autoScroll(ev.clientY);
    };
    const up = () => {
      if (started) {
        container.insertBefore(ghost, placeholder);
        placeholder.remove();
        ghost.classList.remove('sort-ghost');
        ghost.removeAttribute('style');
        document.body.classList.remove('dragging');
        const to = items().indexOf(ghost);
        if (to !== from) opts.onEnd(from, to, ghost);
      }
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  function autoScroll(y) {
    const sc = opts.scroller || container.closest('.scroll') || document.scrollingElement;
    const r = sc.getBoundingClientRect ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
    if (y < top + 50) sc.scrollTop -= 12; else if (y > bottom - 50) sc.scrollTop += 12;
  }
}
