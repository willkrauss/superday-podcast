// Minimal PDF 1.4 writer for the page model produced by paginate.js.
// Uses the standard 14 Courier fonts (no embedding needed), WinAnsi encoding, optional Flate compression.

const WIN = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
  0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
  0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
  0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
};
const FALLBACK = { 0x2010: 0x2D, 0x2011: 0x2D, 0x2012: 0x2D, 0x2212: 0x2D, 0x00A0: 0x20, 0x2032: 0x27, 0x2033: 0x22 };

function winHex(str) {
  let hex = '';
  for (let i = 0; i < str.length; i++) {
    const cp = str.charCodeAt(i);
    let b;
    if (cp >= 0xD800 && cp <= 0xDBFF) { i++; b = 0x3F; }
    else if (cp < 0x80) b = cp;
    else if (cp >= 0xA0 && cp <= 0xFF) b = cp;
    else b = WIN[cp] ?? FALLBACK[cp] ?? 0x3F;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex.toUpperCase();
}

function pdfString(s) {
  // ASCII -> literal string, otherwise UTF-16BE hex with BOM (for document info).
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/([\\()])/g, '\\$1') + ')';
  let hex = 'FEFF';
  for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0');
  return '<' + hex.toUpperCase() + '>';
}

const FONT_OF = r => (r.b && r.i ? 'F4' : r.b ? 'F2' : r.i ? 'F3' : 'F1');
const PT = 72;
const SIZE = 12;
const ADV = 7.2; // Courier advance at 12pt
const BASE = 9;  // baseline offset from line top, in points

function f(n) { return (Math.round(n * 100) / 100).toString(); }

function hexColor(c) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || '');
  if (!m) return null;
  return [1, 2, 3].map(i => f(parseInt(m[i], 16) / 255)).join(' ');
}

export function pageContent(page) {
  const H = page.h * PT;
  const out = [];
  if (page.tint) {
    const c = hexColor(page.tint);
    if (c) out.push(`q ${c} rg 0 0 ${f(page.w * PT)} ${f(H)} re f Q`);
  }
  for (const l of page.lines || []) {
    out.push(`q 0.6 w 0.5 G ${f(l.x1 * PT)} ${f(H - l.y1 * PT)} m ${f(l.x2 * PT)} ${f(H - l.y2 * PT)} l S Q`);
  }
  const underlines = [];
  out.push('BT');
  let curFont = '', gray = false;
  for (const it of page.items) {
    let x = it.x * PT;
    const y = H - (it.y * PT + BASE);
    const wantGray = !!it.gray;
    if (wantGray !== gray) { out.push(wantGray ? '0.62 g' : '0 g'); gray = wantGray; }
    for (const r of it.runs) {
      if (!r.t) continue;
      const font = FONT_OF(r);
      if (font !== curFont) { out.push(`/${font} ${SIZE} Tf`); curFont = font; }
      out.push(`1 0 0 1 ${f(x)} ${f(y)} Tm <${winHex(r.t)}> Tj`);
      const w = r.t.length * ADV;
      if (r.u) underlines.push([x, y - 1.6, x + w, wantGray]);
      x += w;
    }
  }
  out.push('ET');
  if (underlines.length) {
    out.push('q 0.6 w');
    for (const [x1, y1, x2, g] of underlines) out.push(`${g ? '0.62' : '0'} G ${f(x1)} ${f(y1)} m ${f(x2)} ${f(y1)} l S`);
    out.push('Q');
  }
  return out.join('\n');
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const cs = new CompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

export async function buildPDF(pages, { title = '', author = '', subject = '', compress = true } = {}) {
  const enc = new TextEncoder();
  const parts = [];
  let offset = 0;
  const offsets = [];
  const push = (data) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    parts.push(b);
    offset += b.length;
  };
  const obj = (n, body) => { offsets[n] = offset; push(`${n} 0 obj\n`); if (typeof body === 'string') push(body); else for (const p of body) push(p); push('\nendobj\n'); };

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

  const nPages = pages.length;
  const firstPageObj = 8;
  const kids = [];
  for (let i = 0; i < nPages; i++) kids.push(`${firstPageObj + i * 2} 0 R`);

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${nPages} >>`);
  const fonts = ['Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique'];
  fonts.forEach((name, i) => obj(3 + i, `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`));
  const d = new Date();
  const p2 = n => String(n).padStart(2, '0');
  const date = `D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  obj(7, `<< /Title ${pdfString(title)} /Author ${pdfString(author)} /Subject ${pdfString(subject)} /Creator (Reelwright) /Producer (Reelwright) /CreationDate (${date}) >>`);

  for (let i = 0; i < nPages; i++) {
    const pg = pages[i];
    const pn = firstPageObj + i * 2, cn = pn + 1;
    obj(pn, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pg.w * PT)} ${f(pg.h * PT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${cn} 0 R >>`);
    const raw = enc.encode(pageContent(pg));
    const z = compress ? await deflate(raw) : null;
    if (z) obj(cn, [`<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`, z, '\nendstream']);
    else obj(cn, [`<< /Length ${raw.length} >>\nstream\n`, raw, '\nendstream']);
  }

  const total = firstPageObj + nPages * 2;
  const xrefAt = offset;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) xref += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  push(xref);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
