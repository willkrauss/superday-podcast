// Renders the page model as HTML sheets (preview, print, read-only version views).
import { h, clear } from './util.js';
import { escText } from './inline.js';

export function renderSheets(container, pages, { scale = null, graySids = null } = {}) {
  clear(container);
  container.classList.add('sheets');
  for (const p of pages) container.appendChild(sheet(p, graySids));
  if (scale) container.style.setProperty('--u', scale);
  return container;
}

export function sheet(p, graySids) {
  const s = h('div.sheet' + (p.title ? '.title-sheet' : ''), { style: { width: `calc(var(--u) * ${p.w})`, height: `calc(var(--u) * ${p.h})` } });
  if (p.tint) s.style.background = p.tint;
  for (const l of p.lines || []) {
    s.appendChild(h('div.sheet-rule', { style: { left: `calc(var(--u) * ${l.x1})`, top: `calc(var(--u) * ${l.y1})`, height: `calc(var(--u) * ${l.y2 - l.y1})` } }));
  }
  let html = '';
  for (const it of p.items) {
    const gray = it.gray || (graySids && it.sid && !graySids.has(it.sid));
    html += `<div class="ln${it.rev ? ' rv' : ''}${gray ? ' gray' : ''}" style="left:calc(var(--u) * ${it.x.toFixed(3)});top:calc(var(--u) * ${it.y.toFixed(3)})">`;
    for (const r of it.runs) {
      const cls = (r.b ? 'b ' : '') + (r.i ? 'i ' : '') + (r.u ? 'u' : '');
      html += cls ? `<span class="${cls.trim()}">${escText(r.t)}</span>` : escText(r.t);
    }
    html += '</div>';
  }
  s.insertAdjacentHTML('beforeend', html);
  return s;
}

// Print using the browser (Save as PDF works on every platform).
export function printSheets(pages, paper = 'letter') {
  cleanupPrevious();
  const root = h('div#print-root');
  renderSheets(root, pages);
  root.style.setProperty('--u', '1in');
  const style = h('style', { 'data-print': '1' }, `@page { size: ${paper === 'a4' ? 'A4' : 'letter'}; margin: 0; }`);
  document.body.appendChild(style);
  document.body.appendChild(root);
  document.body.classList.add('printing');
  const done = () => { root.remove(); style.remove(); document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

function cleanupPrevious() {
  document.getElementById('print-root')?.remove();
  document.querySelectorAll('style[data-print]').forEach(s => s.remove());
  document.body.classList.remove('printing');
}

// Print arbitrary HTML (call sheets, reports, breakdown sheets).
export function printHTML(node, { title = '', landscape = false } = {}) {
  cleanupPrevious();
  const root = h('div#print-root.print-doc', node);
  const style = h('style', { 'data-print': '1' }, `@page { size: ${landscape ? 'landscape' : 'portrait'}; margin: 0.5in; }`);
  const oldTitle = document.title;
  if (title) document.title = title;
  document.body.appendChild(style);
  document.body.appendChild(root);
  document.body.classList.add('printing');
  const done = () => { root.remove(); style.remove(); document.body.classList.remove('printing'); document.title = oldTitle; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
