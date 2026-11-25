// Beat board: free-form sticky notes for brainstorming structure, which can become scenes.
import { h, clear, uid } from '../util.js';
import { menu, modal, field, confirmDialog, toast } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import { docLabel } from '../model.js';
import { getFormat, typeOfRole } from '../formats.js';
import { textToHTML } from '../inline.js';
import { scriptDocs } from './common.js';

const COLORS = ['#fff3b0', '#ffd6e7', '#cfe2ff', '#d4f5d0', '#f6d58a', '#e9d8fd', '#ffffff'];

export function render(ctx) {
  const { project } = ctx;
  ctx.setTitle('Beat Board');
  const board = h('div.board');
  const scroll = h('div.scroll', { style: { flex: 1, background: 'var(--panel-2)' } }, board);
  const bar = h('div.toolbar',
    h('button.btn.sm.primary', { type: 'button', onclick: () => addBeat() }, icon('plus'), 'Add card'),
    h('button.btn.sm', { type: 'button', onclick: () => arrange() }, icon('grid'), 'Tidy up'),
    h('span.small.muted', { style: { marginLeft: '10px' } }, 'Drag cards by their top edge. Use “…” to turn a card into a scene.'));
  ctx.view.append(bar, scroll);

  function paint() {
    clear(board);
    for (const b of project.beats) board.append(card(b));
    if (!project.beats.length) board.append(h('div.empty', { style: { position: 'absolute', left: '40px', top: '40px', textAlign: 'left' } },
      h('div.empty-title', 'Map out your story'), h('p', { style: { margin: '4px 0 12px' } }, 'Add cards for beats, ideas and turning points, arrange them freely, then send them to the script as scenes.'),
      h('button.btn.primary', { type: 'button', onclick: () => seedActs() }, 'Start with a three-act layout')));
  }

  function card(b) {
    const title = h('input', { value: b.title || '', placeholder: 'Beat', 'aria-label': 'Beat title' });
    title.addEventListener('input', () => { b.title = title.value; app.markDirty(); });
    const text = h('textarea', { placeholder: 'What happens…', 'aria-label': 'Beat text' });
    text.value = b.text || '';
    text.addEventListener('input', () => { b.text = text.value; app.markDirty(); });
    const head = h('div.beat-head', h('span.grip', icon('grip')), title,
      h('button.icon-btn', { type: 'button', 'aria-label': 'Card options', onclick: e => beatMenu(b, e.currentTarget) }, icon('more')));
    const el = h('div.beat', { style: { left: b.x + 'px', top: b.y + 'px', '--card-color': b.color || COLORS[0] } }, head, text);
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('input,button')) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, ox = b.x, oy = b.y;
      el.style.zIndex = 10;
      const move = ev => { b.x = Math.max(0, ox + ev.clientX - sx); b.y = Math.max(0, oy + ev.clientY - sy); el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; };
      const up = () => { el.style.zIndex = ''; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); app.markDirty(); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    return el;
  }

  function beatMenu(b, anchor) {
    menu(anchor, [
      ...COLORS.map(c => ({ label: 'Color', swatch: c, checked: b.color === c, onClick: () => { b.color = c; app.markDirty(); paint(); } })),
      { sep: true },
      { label: 'Send to script as a scene…', onClick: () => sendToScript(b) },
      { label: 'Duplicate', onClick: () => { project.beats.push({ ...b, id: uid('t'), x: b.x + 24, y: b.y + 24 }); app.markDirty(); paint(); } },
      { label: 'Delete', danger: true, onClick: () => { project.beats = project.beats.filter(x => x !== b); app.markDirty(); paint(); } },
    ]);
  }

  async function sendToScript(b) {
    const docs = scriptDocs(project).filter(d => d.kind === 'script' && d.fmt !== 'text');
    if (!docs.length) return toast('Add a script first');
    const sel = h('select.input', docs.map(d => h('option', { value: d.id }, docLabel(d))));
    const head = h('input.input', { value: /^(INT|EXT)/i.test(b.title || '') ? b.title : 'INT. ' });
    const res = await modal({
      title: 'Send card to script',
      body: h('div.form', field('Script', sel), field('Scene heading', head), h('p.small', 'The card text becomes the scene synopsis. The scene is added at the end of the script.')),
      buttons: [{ label: 'Cancel' }, { label: 'Add scene', primary: true, value: true }],
    });
    if (!res) return;
    const doc = docs.find(d => d.id === sel.value);
    const fmt = getFormat(doc.fmt);
    doc.blocks.push({ id: uid('b'), t: typeOfRole(fmt, 'heading'), h: textToHTML(head.value.trim()), s: { syn: [b.title, b.text].filter(Boolean).join(': ') } });
    doc.blocks.push({ id: uid('b'), t: typeOfRole(fmt, 'action'), h: '' });
    b.sent = doc.id;
    app.markDirty();
    toast('Scene added to ' + docLabel(doc));
  }

  function addBeat(extra = {}) {
    const x = scroll.scrollLeft + 40 + (project.beats.length % 6) * 24;
    const y = scroll.scrollTop + 40 + (project.beats.length % 6) * 24;
    project.beats.push({ id: uid('t'), x, y, title: '', text: '', color: COLORS[0], ...extra });
    app.markDirty();
    paint();
    const last = board.lastElementChild;
    if (last) last.querySelector('input').focus();
  }

  function arrange() {
    const cols = Math.max(1, Math.floor((scroll.clientWidth - 40) / 240));
    project.beats.forEach((b, i) => { b.x = 24 + (i % cols) * 240; b.y = 24 + Math.floor(i / cols) * 200; });
    app.markDirty();
    paint();
  }

  function seedActs() {
    const acts = [
      ['ACT ONE', 'Setup: the world, the hero, what they want.', '#cfe2ff'],
      ['Inciting incident', 'The event that upends the status quo.', '#fff3b0'],
      ['Break into Act Two', 'The hero commits to the journey.', '#fff3b0'],
      ['ACT TWO', 'Rising complications, allies and enemies.', '#ffd6e7'],
      ['Midpoint', 'A reversal raises the stakes.', '#fff3b0'],
      ['All is lost', 'The lowest point.', '#fff3b0'],
      ['ACT THREE', 'The final confrontation.', '#d4f5d0'],
      ['Climax', 'The hero faces the central conflict.', '#fff3b0'],
      ['Resolution', 'The new normal.', '#fff3b0'],
    ];
    acts.forEach(([title, text, color], i) => project.beats.push({ id: uid('t'), title, text, color, x: 24 + (i % 3) * 240 + Math.floor(i / 3) * 760, y: 24 + Math.floor(i % 3) * 200 }));
    arrange();
  }

  paint();
  return { cleanup() {} };
}
