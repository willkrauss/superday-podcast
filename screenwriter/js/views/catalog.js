// Catalog: characters, locations and every breakdown element in the project.
import { h, clear, uid, pickFile } from '../util.js';
import { modal, field, confirmDialog, toast, menu, emptyState, promptDialog } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import * as store from '../store.js';
import { CATEGORIES, CAT, CATALOG_FIELDS, syncCatalog, allProductionScenes, sceneElements, docLabel, addCatalog } from '../model.js';
import { unwrapSpan } from '../inline.js';

export function render(ctx) {
  const { project } = ctx;
  ctx.setTitle('Catalog');
  let cat = project.catalogCat || 'all';
  let q = '';
  const nav = h('div.cat-nav');
  const list = h('div.cat-items');
  const search = h('input.input', { type: 'search', placeholder: 'Search catalog', style: { maxWidth: '260px' }, oninput: () => { q = search.value.toLowerCase(); paintList(); } });
  const body = h('div.view-inner',
    h('div.section-head', h('h2', 'Catalog'), search, h('div.spacer'),
      h('button.btn.sm', { type: 'button', title: 'Add characters and locations found in your scripts', onclick: () => { const n = syncCatalog(project); app.markDirty(); toast(n ? `Added ${n} from scripts` : 'Catalog is up to date'); paint(); } }, icon('wand'), 'Sync from scripts'),
      h('button.btn.sm.primary', { type: 'button', onclick: () => newItem() }, icon('plus'), 'Add item')),
    h('div.cat-layout', nav, h('div', list)));
  ctx.view.append(h('div.view-pad.scroll', { style: { flex: 1 } }, body));

  const added = syncCatalog(project);
  if (added) app.markDirty();

  function paint() { paintNav(); paintList(); }

  function paintNav() {
    clear(nav);
    const count = id => project.catalog.filter(c => id === 'all' || c.cat === id).length;
    const item = (id, label, color) => h('button.sb-item' + (cat === id ? '.active' : ''), { type: 'button', onclick: () => { cat = project.catalogCat = id; paint(); } },
      color ? h('span.swatch', { style: { background: color } }) : icon('catalog'), h('span.grow', label), h('span.small.muted', count(id)));
    nav.append(item('all', 'Everything'));
    for (const c of CATEGORIES) if (count(c.id) || ['cast', 'location', 'props', 'wardrobe', 'vehicles', 'extras'].includes(c.id)) nav.append(item(c.id, c.label, c.color));
  }

  function paintList() {
    clear(list);
    const items = project.catalog.filter(c => (cat === 'all' || c.cat === cat) && (!q || (c.name + ' ' + (c.desc || '')).toLowerCase().includes(q)))
      .sort((a, b) => (a.cat === 'cast' && b.cat === 'cast' ? (a.n || 999) - (b.n || 999) : 0) || a.name.localeCompare(b.name));
    if (!items.length) {
      list.append(emptyState('Nothing here yet', cat === 'cast' || cat === 'location' ? 'Characters and locations are added automatically from your scripts.' : 'Tag elements in the script (select text → Tag) or add them here.'));
      return;
    }
    const scenes = allProductionScenes(project);
    for (const c of items) {
      const color = (CAT[c.cat] || CAT.misc).color;
      const n = scenes.filter(s => (sceneElements(project, s.doc, s).get(c.cat) || []).includes(c)).length;
      const thumb = h('div.cat-thumb', (c.name || '?').slice(0, 1).toUpperCase());
      if (c.img) store.getImageURL(c.img).then(u => { if (u) { thumb.style.backgroundImage = `url("${u}")`; thumb.textContent = ''; } });
      const actor = c.cat === 'cast' ? project.contacts.find(k => k.char === c.id) : null;
      list.append(h('div.cat-card', { style: { '--cat-color': color }, tabindex: 0, role: 'button', onclick: () => editItem(c), onkeydown: e => { if (e.key === 'Enter') editItem(c); } },
        thumb,
        h('div.grow', { style: { minWidth: 0 } },
          h('div.cat-name.ellipsis', c.cat === 'cast' && c.n ? `${c.n}. ${c.name}` : c.name),
          h('div.cat-sub', (CAT[c.cat] || CAT.misc).label, ' · ', n === 1 ? '1 scene' : `${n} scenes`, actor ? ` · ${actor.name}` : ''),
          c.desc ? h('div.cat-sub.ellipsis', c.desc) : null)));
    }
  }

  async function newItem() {
    const name = await promptDialog('Name', '', { title: 'New catalog item' });
    if (!name || !name.trim()) return;
    const item = addCatalog(project, cat === 'all' ? 'props' : cat, name.trim());
    app.markDirty();
    paint();
    editItem(item);
  }

  async function editItem(c) {
    const draft = JSON.parse(JSON.stringify(c));
    draft.fields = draft.fields || {};
    let newImg = undefined;
    const name = h('input.input', { value: draft.name });
    const catSel = h('select.input', CATEGORIES.map(x => h('option', { value: x.id }, x.label)));
    catSel.value = draft.cat;
    const desc = h('textarea.input', { rows: 3, placeholder: 'Description' });
    desc.value = draft.desc || '';
    const photo = h('div.photo-drop', { role: 'button', tabindex: 0, title: 'Add a photo' }, 'Add photo');
    if (draft.img) store.getImageURL(draft.img).then(u => { if (u) { photo.style.backgroundImage = `url("${u}")`; photo.textContent = ''; } });
    photo.addEventListener('click', async () => {
      const [f] = await pickFile('image/*');
      if (!f) return;
      newImg = f;
      photo.style.backgroundImage = `url("${URL.createObjectURL(f)}")`;
      photo.textContent = '';
    });
    const fieldsBox = h('div.form-grid');
    const paintFields = () => {
      clear(fieldsBox);
      const keys = [...new Set([...(CATALOG_FIELDS[catSel.value] || CATALOG_FIELDS.default), ...Object.keys(draft.fields)])];
      for (const k of keys) {
        const inp = h(k.length > 14 || /Background|Arc|Relationships|Description/.test(k) ? 'textarea.input' : 'input.input', { rows: 2 });
        inp.value = draft.fields[k] || '';
        inp.addEventListener('input', () => { draft.fields[k] = inp.value; });
        fieldsBox.append(field(k, inp));
      }
    };
    catSel.addEventListener('change', paintFields);
    paintFields();
    const castBox = h('div.form-grid');
    let castNum = null, actorSel = null;
    if (draft.cat === 'cast') {
      castNum = h('input.input', { type: 'number', min: 1, value: draft.n || '' });
      const cast = project.contacts.filter(k => k.kind === 'cast' || k.char === c.id);
      actorSel = h('select.input', h('option', { value: '' }, '—'), cast.map(k => h('option', { value: k.id }, k.name)));
      const cur = project.contacts.find(k => k.char === c.id);
      actorSel.value = cur ? cur.id : '';
      castBox.append(field('Cast ID # (for stripboards)', castNum), field('Played by', actorSel));
    }
    const scenes = allProductionScenes(project).filter(s => (sceneElements(project, s.doc, s).get(c.cat) || []).includes(c));
    const appears = h('div', { style: { maxHeight: '160px', overflow: 'auto' } }, scenes.length
      ? scenes.map(s => h('div.row.small', { style: { padding: '2px 0' } }, h('b', s.label + '.'), h('span.ellipsis.grow', s.text),
        h('button.link.small', { type: 'button', onclick: () => { closeFn && closeFn(); app.go(`#/p/${project.id}/breakdown/${s.doc.id}`); app.pendingScene = s.id; } }, 'Breakdown')))
      : h('div.small.muted', 'Not in any scene yet. Tag it in the script or add it on a breakdown sheet.'));
    let closeFn = null;
    const res = await modal({
      title: 'Catalog item', wide: true,
      body: close => {
        closeFn = close;
        return h('div.form',
          h('div.row', { style: { alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' } }, photo,
            h('div.form.grow', { style: { minWidth: '220px' } }, field('Name', name), field('Category', catSel), field('Description', desc))),
          castBox, fieldsBox,
          h('div.row', h('button.link.small', { type: 'button', onclick: async () => { const k = await promptDialog('Field name', '', { title: 'Add field' }); if (k && k.trim()) { draft.fields[k.trim()] = ''; paintFields(); } } }, '+ Add field')),
          field(`Appears in (${scenes.length})`, appears));
      },
      buttons: [
        { label: 'Delete…', danger: true, left: true, onClick: async () => { if (await removeItem(c)) return 'deleted'; return false; } },
        { label: 'Cancel' },
        { label: 'Save', primary: true, value: 'save' },
      ],
    });
    if (res === 'deleted') { paint(); return; }
    if (res !== 'save') return;
    c.name = name.value.trim() || c.name;
    if (catSel.value !== c.cat) c.cat = catSel.value;
    c.desc = desc.value;
    c.fields = Object.fromEntries(Object.entries(draft.fields).filter(([, v]) => v !== ''));
    if (castNum) c.n = +castNum.value || null;
    if (actorSel) {
      for (const k of project.contacts) if (k.char === c.id && k.id !== actorSel.value) k.char = null;
      const k = project.contacts.find(x => x.id === actorSel.value);
      if (k) k.char = c.id;
    }
    if (newImg) {
      if (c.img) await store.deleteImage(c.img);
      c.img = await store.putImage(project.id, newImg);
    }
    app.markDirty();
    paint();
  }

  async function removeItem(c) {
    const ok = await confirmDialog(`Delete “${c.name}” from the catalog? Its breakdown tags will be removed from the script text (the words stay).`, { title: 'Delete item', ok: 'Delete', danger: true });
    if (!ok) return false;
    for (const d of project.docs) {
      d.blocks = d.blocks.map(b => {
        let nb = b;
        for (const key of ['h', 'v', 'a']) if (nb[key] && nb[key].includes(`data-tg="${c.id}"`)) nb = { ...nb, [key]: unwrapSpan(nb[key], 'tg', c.id) };
        if (nb.s && nb.s.el && nb.s.el.includes(c.id)) nb = { ...nb, s: { ...nb.s, el: nb.s.el.filter(x => x !== c.id) } };
        return nb;
      });
    }
    for (const k of project.contacts) if (k.char === c.id) k.char = null;
    if (c.img) await store.deleteImage(c.img);
    project.catalog = project.catalog.filter(x => x !== c);
    app.markDirty();
    toast('Deleted');
    return true;
  }

  paint();
  if (ctx.arg) { const it = project.catalog.find(c => c.id === ctx.arg); if (it) setTimeout(() => editItem(it), 50); }
  return { cleanup() {} };
}
