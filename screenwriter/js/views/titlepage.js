// Title page editor shared by the script and AV views.
import { h, fmtDate } from '../util.js';
import { modal, field } from '../ui.js';

export async function editTitlePageModal(doc) {
  const tp = { ...doc.tp };
  const inp = (k, ml = false, ph = '') => {
    const el = ml ? h('textarea.input', { rows: 3, placeholder: ph }) : h('input.input', { type: 'text', placeholder: ph });
    el.value = tp[k] || '';
    el.addEventListener('input', () => { tp[k] = el.value; });
    return el;
  };
  const show = h('input', { type: 'checkbox', checked: tp.show !== false, onchange: e => { tp.show = e.target.checked; } });
  const res = await modal({
    title: 'Title page', wide: true,
    body: h('div.form',
      h('label.check', show, 'Include a title page'),
      h('div.form-grid',
        field('Title', inp('title', true, 'THE TITLE\n(one line per row)')),
        field('Credit', inp('credit', false, 'Written by')),
        field('Author(s)', inp('author', true, 'Your name')),
        field('Based on / source', inp('source', true, 'Based on the novel by…'))),
      h('div.form-grid',
        field('Draft', inp('draft', false, 'First Draft')),
        field('Date', inp('date', false, fmtDate(Date.now()))),
        field('Contact (bottom left)', inp('contact', true, 'Agent / email / phone')),
        field('Notes (bottom right)', inp('notes', true, 'WGA Registered #…')))),
    buttons: [{ label: 'Cancel' }, { label: 'Save', primary: true, value: true }],
  });
  if (!res) return false;
  doc.tp = tp;
  return true;
}
