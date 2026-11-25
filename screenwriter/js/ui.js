// Modals, menus, toasts and small form helpers.
import { h, $, clear } from './util.js';

let modalStack = [];

export function modal({ title, body, buttons = [], wide = false, onClose, className = '' }) {
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const close = (val) => {
      if (!overlay.isConnected) return;
      overlay.remove();
      modalStack = modalStack.filter(m => m !== overlay);
      document.removeEventListener('keydown', onKey, true);
      if (onClose) onClose(val);
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) try { prevFocus.focus({ preventScroll: true }); } catch {}
      resolve(val);
    };
    const foot = buttons.length ? h('div.modal-foot', buttons.map(b => {
      const btn = h('button.btn' + (b.primary ? '.primary' : '') + (b.danger ? '.danger' : ''), {
        type: 'button',
        onclick: async () => {
          if (b.onClick) {
            const r = await b.onClick(close);
            if (r === false) return;
            if (r !== undefined) return close(r);
          }
          close(b.value);
        }
      }, b.label);
      if (b.left) btn.style.marginRight = 'auto';
      return btn;
    })) : null;
    const box = h('div.modal' + (wide ? '.wide' : '') + (className ? '.' + className : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' },
      h('div.modal-head', h('h2', title || ''), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: () => close(undefined) }, '✕')),
      h('div.modal-body', typeof body === 'function' ? body(close) : body),
      foot);
    const overlay = h('div.overlay', { onpointerdown: e => { if (e.target === overlay) overlay._down = true; }, onclick: e => { if (e.target === overlay && overlay._down) close(undefined); overlay._down = false; } }, box);
    function onKey(e) {
      if (modalStack[modalStack.length - 1] !== overlay) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(undefined); }
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
        const primary = buttons.find(b => b.primary);
        if (primary) { e.preventDefault(); box.querySelector('.modal-foot .primary')?.click(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    modalStack.push(overlay);
    setTimeout(() => {
      const f = box.querySelector('[autofocus], .modal-body input:not([type=checkbox]), .modal-body textarea, .modal-body select');
      if (f) { f.focus(); if (f.select && f.type !== 'date' && f.type !== 'number') try { f.select(); } catch {} }
      else box.querySelector('.modal-foot .primary')?.focus();
    }, 30);
  });
}

export function confirmDialog(message, { title = 'Are you sure?', ok = 'OK', danger = false } = {}) {
  return modal({
    title,
    body: h('p', message),
    buttons: [{ label: 'Cancel', value: false }, { label: ok, value: true, primary: !danger, danger }]
  }).then(v => !!v);
}

export function promptDialog(message, value = '', { title = '', ok = 'OK', multiline = false, placeholder = '' } = {}) {
  const inp = multiline ? h('textarea.input', { rows: 5, placeholder }) : h('input.input', { type: 'text', placeholder });
  inp.value = value;
  return modal({
    title: title || message,
    body: h('div.form', title ? h('label', message) : null, inp),
    buttons: [{ label: 'Cancel', value: null }, { label: ok, primary: true, onClick: () => inp.value }]
  }).then(v => (v === undefined ? null : v));
}

export function alertDialog(message, title = '') {
  return modal({ title, body: typeof message === 'string' ? h('p', message) : message, buttons: [{ label: 'OK', primary: true, value: true }] });
}

let toastWrap = null;
export function toast(msg, { kind = '', ms = 2600, action } = {}) {
  if (!toastWrap) { toastWrap = h('div.toasts', { 'aria-live': 'polite' }); document.body.appendChild(toastWrap); }
  const t = h('div.toast' + (kind ? '.' + kind : ''), h('span', msg),
    action ? h('button.link', { onclick: () => { action.run(); t.remove(); } }, action.label) : null);
  toastWrap.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

// Popover menu anchored to an element or point. items: [{label, onClick, icon, danger, disabled, checked, sep, hint, submenu}]
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
export function menu(anchor, items, { align = 'left' } = {}) {
  closeMenu();
  const m = h('div.menu', { role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { m.appendChild(h('div.menu-sep')); continue; }
    if (it.heading) { m.appendChild(h('div.menu-head', it.heading)); continue; }
    const b = h('button.menu-item' + (it.danger ? '.danger' : '') + (it.checked ? '.checked' : ''), {
      type: 'button', role: 'menuitem', disabled: !!it.disabled,
      onclick: e => { e.stopPropagation(); closeMenu(); it.onClick && it.onClick(); }
    },
      h('span.mi-check', it.checked ? '✓' : ''),
      it.swatch ? h('span.swatch', { style: { background: it.swatch } }) : null,
      h('span.mi-label', it.label),
      it.hint ? h('span.mi-hint', it.hint) : null);
    m.appendChild(b);
  }
  document.body.appendChild(m);
  let x, y, r;
  if (anchor instanceof Element) {
    r = anchor.getBoundingClientRect();
    x = align === 'right' ? r.right - m.offsetWidth : r.left;
    y = r.bottom + 4;
  } else { x = anchor.x; y = anchor.y; r = { top: y }; }
  const mw = m.offsetWidth, mh = m.offsetHeight;
  if (x + mw > innerWidth - 8) x = innerWidth - mw - 8;
  if (x < 8) x = 8;
  if (y + mh > innerHeight - 8) y = Math.max(8, (r.top || y) - mh - 4);
  m.style.left = x + 'px'; m.style.top = y + 'px';
  openMenu = m;
  setTimeout(() => m.querySelector('.menu-item:not([disabled])')?.focus({ preventScroll: true }), 0);
  m.addEventListener('keydown', e => {
    const btns = Array.from(m.querySelectorAll('.menu-item:not([disabled])'));
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); if (anchor instanceof Element) anchor.focus?.(); }
  });
  return m;
}
document.addEventListener('pointerdown', e => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
window.addEventListener('resize', closeMenu);

// Form field helpers. bind(obj, key) keeps an input in sync with a data object.
export function field(label, input, hint) {
  return h('label.field', h('span.field-label', label), input, hint ? h('span.field-hint', hint) : null);
}

export function textInput(obj, key, { onChange, placeholder = '', type = 'text', cls = '', multiline = false, rows = 3, attrs = {} } = {}) {
  const el = multiline ? h('textarea.input' + cls, { rows, placeholder, ...attrs }) : h('input.input' + cls, { type, placeholder, ...attrs });
  el.value = obj[key] ?? '';
  el.addEventListener('input', () => {
    obj[key] = type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    onChange && onChange(obj[key], el);
  });
  return el;
}

export function selectInput(obj, key, options, { onChange, cls = '' } = {}) {
  const el = h('select.input' + cls, options.map(o => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: v }, l);
  }));
  el.value = obj[key] ?? '';
  el.addEventListener('change', () => { obj[key] = el.value; onChange && onChange(el.value, el); });
  return el;
}

export function checkInput(obj, key, label, { onChange } = {}) {
  const inp = h('input', { type: 'checkbox' });
  inp.checked = !!obj[key];
  inp.addEventListener('change', () => { obj[key] = inp.checked; onChange && onChange(inp.checked); });
  return h('label.check', inp, h('span', label));
}

export function emptyState(title, text, action) {
  return h('div.empty', h('div.empty-title', title), text ? h('p', text) : null, action || null);
}

export function iconBtn(label, title, onClick, cls = '') {
  return h('button.icon-btn' + cls, { type: 'button', title, 'aria-label': title, onclick: onClick }, label);
}

export function tabs(items, active, onSelect) {
  return h('div.tabs', { role: 'tablist' }, items.map(([id, label]) =>
    h('button.tab' + (id === active ? '.active' : ''), { type: 'button', role: 'tab', 'aria-selected': id === active ? 'true' : 'false', onclick: () => onSelect(id) }, label)));
}

export { clear, $ };
