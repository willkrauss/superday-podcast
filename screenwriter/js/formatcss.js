// Generates per-format editor CSS from the format definitions, and tag/comment highlight rules.
import { FORMATS } from './formats.js';
import { CAT } from './model.js';

function ensureStyle(id) {
  let el = document.getElementById(id);
  if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
  return el;
}

export function ensureFormatCSS(fmt) {
  const id = 'fmtcss-' + fmt.id;
  if (document.getElementById(id)) return;
  const defs = Object.entries(fmt.types);
  const base = Math.min(...defs.map(([, d]) => d.l));
  const right = Math.max(...defs.map(([, d]) => d.l + d.w));
  const tw = right - base;
  const sel = t => `.ed[data-fmt="${fmt.id}"] .el[data-t="${t}"]`;
  let css = `.ed[data-fmt="${fmt.id}"] > .el:first-child { margin-top: 0 !important; }\n`;
  for (const [t, d] of defs) {
    const sb = d.sb === 'scene' ? 'var(--scene-sb, 2)' : (d.sb || 0);
    css += `${sel(t)} { margin-top: calc(var(--lh) * ${sb});`;
    if (d.caps) css += 'text-transform: uppercase;';
    if (d.b) css += 'font-weight: 700;';
    if (d.i) css += 'font-style: italic;';
    if (d.u) css += 'text-decoration: underline;';
    if (d.align) css += `text-align: ${d.align};`;
    css += '}\n';
    css += `.paper:not(.fluid) ${sel(t)} { margin-left: calc(var(--u) * ${d.l}); width: calc(var(--u) * ${d.w}); }\n`;
    const ml = ((d.l - base) / tw) * 100, w = (d.w / tw) * 100;
    css += `.paper.fluid ${sel(t)} { margin-left: ${ml.toFixed(2)}%; width: ${Math.min(100 - ml, w).toFixed(2)}%; }\n`;
    if (d.prefix) css += `${sel(t)}::before { content: ${JSON.stringify(d.prefix)}; }\n`;
    if (d.role === 'heading') {
      css += `.paper.scene-bold ${sel(t)} { font-weight: 700; }\n.paper.scene-underline ${sel(t)} { text-decoration: underline; }\n`;
    }
  }
  ensureStyle(id).textContent = css;
}

export function ensureAllFormatCSS() { for (const f of Object.values(FORMATS)) ensureFormatCSS(f); }

function hexToRgba(hex, a) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return `rgba(128,128,128,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

// Breakdown tag colors (by catalog item category) and resolved-comment suppression.
export function updateMarkCSS(project, doc) {
  let css = '';
  for (const c of project.catalog) {
    const col = (CAT[c.cat] || CAT.misc).color;
    css += `.ed.bd span.tg[data-tg="${c.id}"] { background: ${hexToRgba(col, 0.22)}; box-shadow: inset 0 -2px 0 ${col}; }\n`;
  }
  for (const c of (doc && doc.comments) || []) {
    if (c.done) css += `.ed span.cm[data-cm="${c.id}"] { background: none; border-bottom: 0; }\n`;
  }
  ensureStyle('markcss').textContent = css;
}
