// Cast & crew directory.
import { h, clear, uid, download, slug, toCSV } from '../util.js';
import { modal, field, confirmDialog, emptyState, menu } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import { syncCatalog } from '../model.js';

const KINDS = [['cast', 'Cast'], ['crew', 'Crew'], ['vendor', 'Vendor'], ['location', 'Location contact'], ['other', 'Other']];
const DEPTS = ['Production', 'Direction', 'Camera', 'Lighting & Electric', 'Grip', 'Sound', 'Art', 'Wardrobe', 'Makeup & Hair', 'Locations', 'Transportation', 'Stunts', 'Special Effects', 'Post', 'Catering', 'Other'];

export function render(ctx) {
  const { project } = ctx;
  ctx.setTitle('Cast & Crew');
  if (syncCatalog(project)) app.markDirty();
  let filter = 'all', q = '';
  const body = h('div.view-inner');
  ctx.view.append(h('div.view-pad.scroll', { style: { flex: 1 } }, body));

  function paint() {
    clear(body);
    const search = h('input.input', { type: 'search', placeholder: 'Search', value: q, style: { maxWidth: '220px' }, oninput: () => { q = search.value.toLowerCase(); paintTable(); } });
    const fsel = h('select.input', { style: { width: 'auto' }, onchange: () => { filter = fsel.value; paintTable(); } }, h('option', { value: 'all' }, 'Everyone'), KINDS.map(([v, l]) => h('option', { value: v }, l)));
    fsel.value = filter;
    body.append(h('div.section-head', h('h2', 'Cast & Crew'), search, fsel, h('div.spacer'),
      h('button.btn.sm', { type: 'button', onclick: exportCSV }, icon('download'), 'CSV'),
      h('button.btn.sm.primary', { type: 'button', onclick: () => edit(null) }, icon('plus'), 'Add person')));
    const wrap = h('div');
    body.append(wrap);
    const paintTable = () => {
      clear(wrap);
      const list = project.contacts.filter(k => (filter === 'all' || k.kind === filter) && (!q || [k.name, k.role, k.dept, k.email, k.phone].join(' ').toLowerCase().includes(q)))
        .sort((a, b) => (a.kind || '').localeCompare(b.kind || '') || (a.dept || '').localeCompare(b.dept || '') || a.name.localeCompare(b.name));
      if (!list.length) { wrap.append(emptyState('No one here yet', 'Add cast and crew to fill call sheets and budgets automatically.')); return; }
      wrap.append(h('div.tbl-wrap', h('table.tbl',
        h('thead', h('tr', ['Name', 'Type', 'Role / character', 'Department', 'Phone', 'Email', 'Rate/day', ''].map(x => h('th', x)))),
        h('tbody', list.map(k => {
          const ch = k.char ? project.catalog.find(c => c.id === k.char) : null;
          return h('tr', { style: { cursor: 'pointer' }, onclick: e => { if (!e.target.closest('a,button')) edit(k); } },
            h('td', h('b', k.name)), h('td', (KINDS.find(x => x[0] === k.kind) || ['', ''])[1]), h('td', ch ? `${ch.name}` : (k.role || '')),
            h('td', k.dept || ''), h('td', k.phone ? h('a', { href: `tel:${k.phone}` }, k.phone) : ''), h('td', k.email ? h('a', { href: `mailto:${k.email}` }, k.email) : ''),
            h('td.num', k.rate ? String(k.rate) : ''),
            h('td', h('button.icon-btn', { type: 'button', 'aria-label': 'Options', onclick: e => menu(e.currentTarget, [
              { label: 'Edit', onClick: () => edit(k) },
              { label: 'Delete', danger: true, onClick: async () => { if (await confirmDialog(`Remove ${k.name}?`, { ok: 'Remove', danger: true })) { project.contacts = project.contacts.filter(x => x !== k); app.markDirty(); paint(); } } },
            ], { align: 'right' }) }, icon('more'))));
        })))));
    };
    paintTable();
  }

  async function edit(k) {
    const d = k ? { ...k } : { id: uid('k'), name: '', kind: filter !== 'all' ? filter : 'crew', role: '', dept: '', phone: '', email: '', address: '', rate: '', call: '', notes: '', char: null };
    const inp = (key, attrs = {}) => { const el = h('input.input', attrs); el.value = d[key] ?? ''; el.addEventListener('input', () => { d[key] = el.value; }); return el; };
    const kind = h('select.input', KINDS.map(([v, l]) => h('option', { value: v }, l)));
    kind.value = d.kind;
    const dept = h('select.input', h('option', { value: '' }, '—'), DEPTS.map(x => h('option', { value: x }, x)));
    dept.value = d.dept || '';
    const chars = project.catalog.filter(c => c.cat === 'cast');
    const charSel = h('select.input', h('option', { value: '' }, '—'), chars.map(c => h('option', { value: c.id }, c.name)));
    charSel.value = d.char || '';
    const notes = h('textarea.input', { rows: 2 });
    notes.value = d.notes || '';
    const castOnly = h('div', field('Plays character', charSel));
    const crewOnly = h('div.form-grid', field('Department', dept), field('Default call time', inp('call', { type: 'time' })));
    const sync = () => { castOnly.style.display = kind.value === 'cast' ? '' : 'none'; crewOnly.style.display = kind.value === 'crew' ? '' : 'none'; };
    kind.addEventListener('change', sync);
    sync();
    const ok = await modal({
      title: k ? 'Edit person' : 'Add person',
      body: h('div.form', h('div.form-grid', field('Name', inp('name', { autofocus: true })), field('Type', kind)),
        field(kind.value === 'cast' ? 'Role' : 'Position / role', inp('role', { placeholder: 'e.g. Director of Photography' })),
        castOnly, crewOnly,
        h('div.form-grid', field('Phone', inp('phone', { type: 'tel' })), field('Email', inp('email', { type: 'email' })), field('Daily rate', inp('rate', { type: 'number', min: 0, step: 'any' }))),
        field('Address', inp('address')), field('Notes', notes)),
      buttons: [{ label: 'Cancel' }, { label: 'Save', primary: true, value: true }],
    });
    if (!ok || !d.name.trim()) return;
    d.kind = kind.value; d.dept = dept.value; d.notes = notes.value; d.char = kind.value === 'cast' ? (charSel.value || null) : null;
    d.rate = d.rate === '' ? '' : +d.rate;
    if (d.char) for (const x of project.contacts) if (x !== k && x.char === d.char) x.char = null;
    if (k) Object.assign(k, d); else project.contacts.push(d);
    app.markDirty();
    paint();
  }

  function exportCSV() {
    const rows = [['Name', 'Type', 'Role', 'Character', 'Department', 'Phone', 'Email', 'Address', 'Daily rate', 'Call', 'Notes']];
    for (const k of project.contacts) {
      const ch = k.char ? project.catalog.find(c => c.id === k.char) : null;
      rows.push([k.name, k.kind, k.role, ch ? ch.name : '', k.dept, k.phone, k.email, k.address, k.rate, k.call, k.notes]);
    }
    download(`${slug(project.title)}-cast-crew.csv`, toCSV(rows), 'text/csv');
  }

  paint();
  return { cleanup() {} };
}
