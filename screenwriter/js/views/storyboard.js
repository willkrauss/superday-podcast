// Storyboard: one frame per shot, with an uploaded photo, camera capture or a hand-drawn sketch.
import { h, clear, uid } from '../util.js';
import { menu, modal, emptyState, toast } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import * as store from '../store.js';
import { getScenes, docLabel } from '../model.js';
import { pickDoc, docPicker, sceneTitle, noScripts, scriptDocs } from './common.js';
import { shotsFor, newShot, shotNumber, SIZES } from './shots.js';
import { printHTML } from '../preview.js';
import { pickFile } from '../util.js';

const ASPECTS = { '16:9': 16 / 9, '2.39:1': 2.39, '1.85:1': 1.85, '4:3': 4 / 3, '1:1': 1, '9:16': 9 / 16 };

export function render(ctx) {
  const { project } = ctx;
  const docs = scriptDocs(project).filter(d => d.kind !== 'text');
  const doc = pickDoc(project, ctx.arg, docs);
  ctx.setTitle('Storyboard');
  if (!doc) return noScripts(ctx.view, project, 'storyboard');
  const body = h('div.view-inner');
  ctx.view.append(h('div.view-pad.scroll', { style: { flex: 1 } }, body));
  const aspect = () => ASPECTS[project.settings.sbAspect || '16:9'] || 16 / 9;

  function paint() {
    clear(body);
    const scenes = getScenes(doc);
    const asel = h('select.input', { style: { width: 'auto' }, 'aria-label': 'Frame aspect ratio', onchange: () => { project.settings.sbAspect = asel.value; app.markDirty(); paint(); } }, Object.keys(ASPECTS).map(a => h('option', { value: a }, a)));
    asel.value = project.settings.sbAspect || '16:9';
    body.append(h('div.section-head', h('h2', 'Storyboard'), docPicker(project, doc, 'storyboard', docs), asel, h('div.spacer'),
      h('button.btn.sm', { type: 'button', onclick: print }, icon('print'), 'Print')));
    if (!scenes.length) { body.append(emptyState('No scenes yet', 'Storyboard frames belong to scenes. Add scene headings to your script first.')); return; }
    for (const s of scenes) {
      const shots = shotsFor(project, doc, s.id);
      const grid = h('div.sb-grid');
      shots.forEach((sh, i) => grid.append(frame(s, sh, i)));
      grid.append(h('button.frame', { type: 'button', style: { minHeight: '160px', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', cursor: 'pointer', borderStyle: 'dashed', background: 'transparent' }, onclick: () => { project.shots.push(newShot(doc, s.id)); app.markDirty(); paint(); } }, icon('plus'), 'Add frame'));
      body.append(h('div', { style: { margin: '18px 0 8px' } }, h('div.row', h('span.scene-cell', { style: { fontFamily: 'var(--mono)', fontWeight: 700, textTransform: 'uppercase' } }, `${s.num}. ${sceneTitle(s)}`), s.syn ? h('span.small.muted.ellipsis', '— ' + s.syn) : null)), grid);
    }
  }

  function frame(s, sh, i) {
    const img = h('div.frame-img', { style: { aspectRatio: String(aspect()) }, role: 'button', tabindex: 0, 'aria-label': 'Frame image options', onclick: e => imageMenu(sh, e.currentTarget) }, sh.img ? null : h('span', icon('image'), ' Add image'));
    if (sh.img) store.getImageURL(sh.img).then(u => { if (u) { img.style.backgroundImage = `url("${u}")`; img.style.backgroundColor = '#111'; } });
    const sizeSel = h('select.input.sm', { style: { width: 'auto' } }, SIZES.map(o => h('option', { value: o }, o || 'Size')));
    sizeSel.value = sh.size || '';
    sizeSel.addEventListener('change', () => { sh.size = sizeSel.value; app.markDirty(); });
    const desc = h('textarea.input', { rows: 2, placeholder: 'Action / what we see' });
    desc.value = sh.desc || '';
    desc.addEventListener('input', () => { sh.desc = desc.value; app.markDirty(); });
    const notes = h('textarea.input', { rows: 1, placeholder: 'Dialogue / sound / notes' });
    notes.value = sh.notes || '';
    notes.addEventListener('input', () => { sh.notes = notes.value; app.markDirty(); });
    return h('div.frame', img,
      h('div.frame-body', h('div.row', h('b', { style: { fontFamily: 'var(--mono)' } }, sh.num || shotNumber(s, i)), sizeSel, h('div.spacer'),
        h('button.icon-btn', { type: 'button', 'aria-label': 'Frame options', onclick: e => frameMenu(sh, e.currentTarget) }, icon('more'))), desc, notes));
  }

  function frameMenu(sh, anchor) {
    menu(anchor, [
      { label: 'Delete frame', danger: true, onClick: async () => { project.shots = project.shots.filter(x => x !== sh); if (sh.img) await store.deleteImage(sh.img); app.markDirty(); paint(); } },
    ]);
  }

  function imageMenu(sh, anchor) {
    menu(anchor, [
      { label: 'Upload image…', onClick: async () => { const [f] = await pickFile('image/*'); if (f) setImage(sh, await downscale(f)); } },
      { label: 'Take photo…', onClick: async () => { const [f] = await pickFile('image/*', false, 'environment'); if (f) setImage(sh, await downscale(f)); } },
      { label: sh.img ? 'Draw on this frame…' : 'Draw a sketch…', onClick: () => draw(sh) },
      sh.img ? { label: 'Remove image', danger: true, onClick: async () => { await store.deleteImage(sh.img); sh.img = null; app.markDirty(); paint(); } } : null,
    ]);
  }

  async function setImage(sh, blob) {
    if (sh.img) await store.deleteImage(sh.img);
    sh.img = await store.putImage(project.id, blob);
    app.markDirty();
    paint();
  }

  async function downscale(file, max = 1600) {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (k === 1 && file.size < 1.5e6) return file;
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
    } catch { return file; }
  }

  async function draw(sh) {
    const W = 1280, H = Math.round(W / aspect());
    const canvas = h('canvas.draw-canvas', { width: W, height: H });
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.lineCap = 'round'; g.lineJoin = 'round';
    if (sh.img) {
      const url = await store.getImageURL(sh.img);
      if (url) await new Promise(res => { const im = new Image(); im.onload = () => { const k = Math.min(W / im.width, H / im.height); g.drawImage(im, (W - im.width * k) / 2, (H - im.height * k) / 2, im.width * k, im.height * k); res(); }; im.onerror = res; im.src = url; });
    }
    let color = '#111', size = 4, erase = false;
    const history = [g.getImageData(0, 0, W, H)];
    const dots = ['#111', '#666', '#d33', '#2753c4', '#2f8a4a', '#e8a400'].map(c => {
      const d = h('button.color-dot' + (c === color ? '.sel' : ''), { type: 'button', 'aria-label': 'Color ' + c, style: { background: c }, onclick: () => { color = c; erase = false; dots.forEach(x => x.classList.toggle('sel', x === d)); eraser.classList.remove('on'); } });
      return d;
    });
    const sizeIn = h('input', { type: 'range', min: 1, max: 30, value: size, 'aria-label': 'Brush size', oninput: e => { size = +e.target.value; } });
    const eraser = h('button.icon-btn', { type: 'button', title: 'Eraser', onclick: () => { erase = !erase; eraser.classList.toggle('on', erase); } }, 'Eraser');
    const undo = h('button.icon-btn', { type: 'button', title: 'Undo stroke', onclick: () => { if (history.length > 1) { history.pop(); g.putImageData(history[history.length - 1], 0, 0); } } }, icon('undo'));
    const clearBtn = h('button.icon-btn', { type: 'button', onclick: () => { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); history.push(g.getImageData(0, 0, W, H)); } }, 'Clear');
    let drawing = false, last = null;
    const pos = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
    canvas.addEventListener('pointerdown', e => { drawing = true; canvas.setPointerCapture(e.pointerId); last = pos(e); stroke(last, last, e.pressure); });
    canvas.addEventListener('pointermove', e => { if (!drawing) return; const p = pos(e); stroke(last, p, e.pressure); last = p; });
    const end = () => { if (drawing) { drawing = false; history.push(g.getImageData(0, 0, W, H)); if (history.length > 30) history.splice(1, 1); } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    function stroke(a, b, pressure) {
      g.strokeStyle = erase ? '#fff' : color;
      g.lineWidth = (erase ? size * 4 : size) * (pressure && pressure !== 0.5 ? 0.5 + pressure : 1);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
    const ok = await modal({
      title: 'Sketch', wide: true,
      body: h('div.draw-wrap', h('div.draw-tools', dots, h('span.small.muted', 'Size'), sizeIn, eraser, undo, clearBtn), canvas),
      buttons: [{ label: 'Cancel' }, { label: 'Save frame', primary: true, value: true }],
    });
    if (!ok) return;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    await setImage(sh, blob);
  }

  async function print() {
    const scenes = getScenes(doc);
    const wrap = h('div', h('h2', { style: { margin: '0 0 10px' } }, `${project.title}: ${docLabel(doc)} storyboard`));
    for (const s of scenes) {
      const shots = shotsFor(project, doc, s.id);
      if (!shots.length) continue;
      const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '14px' } });
      for (const [i, sh] of shots.entries()) {
        const url = sh.img ? await store.getImageURL(sh.img) : null;
        grid.append(h('div', { style: { breakInside: 'avoid', border: '1px solid #999', fontSize: '10px' } },
          h('div', { style: { aspectRatio: String(aspect()), background: url ? `#fff url("${url}") center/contain no-repeat` : '#f3f3f3' } }),
          h('div', { style: { padding: '4px 6px' } }, h('b', `${sh.num || shotNumber(s, i)} ${sh.size || ''}`), h('div', sh.desc || ''), sh.notes ? h('div', { style: { color: '#555' } }, sh.notes) : null)));
      }
      wrap.append(h('div', { style: { fontWeight: 700, fontFamily: 'Courier Prime, monospace', margin: '8px 0 4px' } }, `${s.num}. ${sceneTitle(s)}`), grid);
    }
    printHTML(wrap, { title: 'Storyboard', landscape: true });
  }

  paint();
  return { cleanup() {} };
}
