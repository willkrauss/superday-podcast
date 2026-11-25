// Budget: chart of accounts with line items, fringes, contingency and a top sheet.
import { h, clear, uid, money, download, slug, toCSV, plural } from '../util.js';
import { modal, field, confirmDialog, promptDialog, toast, menu } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import { BUDGET_GROUPS, lineTotal, lineFringe, accountTotal, CATEGORY_ACCOUNT, CAT, syncCatalog } from '../model.js';
import { computeDays, dayOutOfDays } from '../production.js';
import { printHTML } from '../preview.js';

const UNITS = ['Flat', 'Allow', 'Days', 'Weeks', 'Hours', 'Each', 'Pages', 'Miles'];
const CURRENCIES = ['USD', 'CAD', 'GBP', 'EUR', 'AUD', 'NZD', 'JPY', 'INR', 'ZAR', 'MXN', 'BRL', 'SEK', 'NOK', 'DKK', 'CHF', 'KRW', 'NGN'];

export function render(ctx) {
  const { project } = ctx;
  const B = project.budget;
  ctx.setTitle('Budget');
  let tab = 'detail';
  const open = new Set(project.budgetOpen || []);
  const body = h('div.view-inner');
  ctx.view.append(h('div.view-pad.scroll', { style: { flex: 1 } }, body));
  const fmt = v => money(v, B.currency);

  function totals() {
    const g = { atl: 0, btl: 0, post: 0, other: 0 };
    let fringe = 0;
    for (const a of B.accounts) {
      for (const it of a.items) { g[a.group] = (g[a.group] || 0) + lineTotal(it); fringe += lineFringe(B, it); }
    }
    const sub = g.atl + g.btl + g.post + g.other + fringe;
    const cont = sub * (Number(B.contingency) || 0) / 100;
    return { g, fringe, sub, cont, grand: sub + cont };
  }

  function paint() {
    clear(body);
    acctTotals.clear();
    const T = totals();
    const cur = h('select.input', { style: { width: 'auto' }, 'aria-label': 'Currency', onchange: () => { B.currency = cur.value; app.markDirty(); paint(); } }, CURRENCIES.map(c => h('option', { value: c }, c)));
    cur.value = B.currency;
    const cont = h('input.input', { type: 'number', min: 0, step: 1, value: B.contingency, style: { width: '72px' }, 'aria-label': 'Contingency percent', onchange: () => { B.contingency = +cont.value || 0; app.markDirty(); paint(); } });
    body.append(h('div.section-head', h('h2', 'Budget'),
      h('div.row', { role: 'group' },
        h('button.btn.sm' + (tab === 'top' ? '.primary' : ''), { type: 'button', onclick: () => { tab = 'top'; paint(); } }, 'Top sheet'),
        h('button.btn.sm' + (tab === 'detail' ? '.primary' : ''), { type: 'button', onclick: () => { tab = 'detail'; paint(); } }, 'Detail')),
      h('div.spacer'), cur, h('label.row.small', 'Contingency', cont, '%'),
      h('button.btn.sm', { type: 'button', onclick: editFringes }, 'Fringes…'),
      h('button.btn.sm', { type: 'button', onclick: importFromProduction }, icon('wand'), 'Fill from breakdown'),
      h('button.btn.sm', { type: 'button', onclick: exportCSV }, icon('download'), 'CSV'),
      h('button.btn.sm', { type: 'button', onclick: print }, icon('print'), 'Print')));
    statsEl = h('div.budget-top');
    body.append(statsEl);
    paintStats();
    if (tab === 'top') return body.append(topSheet(T));
    for (const [g, label] of Object.entries(BUDGET_GROUPS)) {
      body.append(h('h3', { style: { margin: '18px 0 8px', fontSize: '14px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' } }, label));
      for (const a of B.accounts.filter(x => x.group === g)) body.append(account(a));
      body.append(h('button.btn.sm.ghost', { type: 'button', onclick: async () => {
        const name = await promptDialog('Account name', '', { title: 'New account' });
        if (!name) return;
        const nums = B.accounts.filter(x => x.group === g).map(x => +x.num || 0);
        B.accounts.push({ id: uid('a'), group: g, num: String((nums.length ? Math.max(...nums) : 0) + 100), name, items: [] });
        app.markDirty(); paint();
      } }, icon('plus'), 'Account'));
    }
  }

  let statsEl = null;
  const acctTotals = new Map();
  function paintStats() {
    const T = totals();
    clear(statsEl);
    statsEl.append(
      ...Object.entries(BUDGET_GROUPS).map(([k, label]) => h('div.stat', h('b', fmt(T.g[k])), h('span', label))),
      h('div.stat', h('b', fmt(T.fringe)), h('span', 'Fringes')),
      h('div.stat', h('b', fmt(T.cont)), h('span', `Contingency (${B.contingency || 0}%)`)),
      h('div.stat', { style: { borderColor: 'var(--accent)' } }, h('b', fmt(T.grand)), h('span', 'Grand total')));
    for (const [a, el] of acctTotals) if (el.isConnected) { const t = accountTotal(B, a); el.textContent = t ? fmt(t) : '—'; }
  }

  function topSheet(T) {
    const rows = [];
    for (const [g, label] of Object.entries(BUDGET_GROUPS)) {
      rows.push(h('tr.group', h('td', { colspan: 3 }, label)));
      for (const a of B.accounts.filter(x => x.group === g)) {
        const t = accountTotal(B, a);
        rows.push(h('tr', h('td', { style: { fontFamily: 'var(--mono)' } }, a.num), h('td', a.name), h('td.num', t ? fmt(t) : '—')));
      }
      rows.push(h('tr.total', h('td'), h('td', `Total ${label}`), h('td.num', fmt(T.g[g] + B.accounts.filter(x => x.group === g).reduce((s, a) => s + a.items.reduce((f, it) => f + lineFringe(B, it), 0), 0)))));
    }
    rows.push(h('tr.total', h('td'), h('td', 'Subtotal'), h('td.num', fmt(T.sub))));
    rows.push(h('tr', h('td'), h('td', `Contingency ${B.contingency || 0}%`), h('td.num', fmt(T.cont))));
    rows.push(h('tr.total', h('td'), h('td', 'GRAND TOTAL'), h('td.num', fmt(T.grand))));
    return h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', h('th', 'Acct'), h('th', 'Description'), h('th.num', 'Total'))), h('tbody', rows)));
  }

  function account(a) {
    const t = accountTotal(B, a);
    const isOpen = open.has(a.id);
    const totalEl = h('span.total', t ? fmt(t) : '—');
    acctTotals.set(a, totalEl);
    const toggle = () => { if (open.has(a.id)) open.delete(a.id); else open.add(a.id); project.budgetOpen = [...open]; paint(); };
    const card = h('div.card.acct',
      h('div.acct-head', { role: 'button', tabindex: 0, onclick: e => { if (!e.target.closest('button')) toggle(); }, onkeydown: e => { if (e.key === 'Enter') toggle(); } },
        h('span', isOpen ? '▾' : '▸'), h('span.num', a.num), h('b.grow', a.name), h('span.small.muted', a.items.length ? plural(a.items.length, 'line') : ''), totalEl,
        h('button.icon-btn', { type: 'button', 'aria-label': 'Account options', onclick: e => menu(e.currentTarget, [
          { label: 'Rename…', onClick: async () => { const v = await promptDialog('Account name', a.name); if (v) { a.name = v; app.markDirty(); paint(); } } },
          { label: 'Account number…', onClick: async () => { const v = await promptDialog('Account number', a.num); if (v) { a.num = v; app.markDirty(); paint(); } } },
          { label: 'Delete account', danger: true, onClick: async () => { if (a.items.length && !await confirmDialog(`Delete ${a.name} and its ${a.items.length} lines?`, { ok: 'Delete', danger: true })) return; B.accounts = B.accounts.filter(x => x !== a); app.markDirty(); paint(); } },
        ], { align: 'right' }) }, icon('more'))));
    if (isOpen) {
      const rows = a.items.map(it => lineRow(a, it));
      card.append(h('div', { style: { overflowX: 'auto', borderTop: '1px solid var(--border)' } }, h('table.tbl',
        h('thead', h('tr', ['Description', 'Amount', 'Units', 'X', 'Rate', 'Fringe', 'Subtotal', ''].map((x, i) => h(i >= 1 && i <= 6 && i !== 2 && i !== 5 ? 'th.num' : 'th', x)))),
        h('tbody', rows, h('tr', h('td', { colspan: 8 }, h('button.btn.sm.ghost', { type: 'button', onclick: () => { a.items.push({ id: uid('l'), desc: '', amt: 1, units: 'Flat', x: 1, rate: 0, fringe: false }); app.markDirty(); paint(); } }, icon('plus'), 'Line item')))))));
    }
    return card;
  }

  function lineRow(a, it) {
    const sub = h('td.num', fmt(lineTotal(it) + lineFringe(B, it)));
    const upd = () => { sub.textContent = fmt(lineTotal(it) + lineFringe(B, it)); app.markDirty(); paintStats(); };
    const num = (k, w = '80px') => { const i = h('input.input', { type: 'number', step: 'any', value: it[k], style: { width: w, textAlign: 'right' } }); i.addEventListener('input', () => { it[k] = i.value === '' ? '' : +i.value; upd(); }); return i; };
    const desc = h('input.input', { value: it.desc, placeholder: 'Description', style: { minWidth: '220px' } });
    desc.addEventListener('input', () => { it.desc = desc.value; app.markDirty(); });
    const units = h('select.input', UNITS.map(u => h('option', { value: u }, u)));
    units.value = it.units || 'Flat';
    units.addEventListener('change', () => { it.units = units.value; app.markDirty(); });
    const fr = h('input', { type: 'checkbox', checked: !!it.fringe, 'aria-label': 'Apply fringes' });
    fr.addEventListener('change', () => { it.fringe = fr.checked; upd(); });
    return h('tr', h('td', desc), h('td', num('amt', '70px')), h('td', units), h('td', num('x', '56px')), h('td', num('rate', '96px')), h('td', { style: { textAlign: 'center' } }, fr), sub,
      h('td', h('button.icon-btn', { type: 'button', 'aria-label': 'Delete line', onclick: () => { a.items = a.items.filter(x => x !== it); app.markDirty(); paint(); } }, icon('trash'))));
  }

  async function editFringes() {
    const list = h('div.form');
    const paintList = () => {
      clear(list);
      for (const f of B.fringes) {
        const n = h('input.input', { value: f.name }); n.addEventListener('input', () => { f.name = n.value; });
        const p = h('input.input', { type: 'number', step: 'any', value: f.pct, style: { width: '90px' } }); p.addEventListener('input', () => { f.pct = +p.value || 0; });
        list.append(h('div.row', n, p, h('span', '%'), h('button.icon-btn', { type: 'button', 'aria-label': 'Remove fringe', onclick: () => { B.fringes = B.fringes.filter(x => x !== f); paintList(); } }, icon('trash'))));
      }
      list.append(h('button.btn.sm', { type: 'button', onclick: () => { B.fringes.push({ id: uid('f'), name: 'New fringe', pct: 0 }); paintList(); } }, icon('plus'), 'Add fringe'));
    };
    paintList();
    await modal({ title: 'Fringes', body: h('div', h('p', 'Fringes (payroll taxes, union pension & health, etc.) apply to every line item with “Fringe” checked.'), list), buttons: [{ label: 'Done', primary: true }] });
    app.markDirty();
    paint();
  }

  async function importFromProduction() {
    syncCatalog(project);
    const { days } = computeDays(project);
    const dood = dayOutOfDays(project, days);
    const acct = num => B.accounts.find(a => a.num === num) || B.accounts.find(a => a.name === CAT_ACCT_NAME[num]);
    let added = 0;
    const exists = ref => B.accounts.some(a => a.items.some(it => it.ref === ref));
    for (const c of project.catalog) {
      const num = CATEGORY_ACCOUNT[c.cat];
      if (!num || exists(c.id)) continue;
      const a = acct(num);
      if (!a) continue;
      if (c.cat === 'cast') {
        if (a.items.some(it => new RegExp(`\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(it.desc || ''))) continue;
        const k = project.contacts.find(x => x.char === c.id);
        const r = dood.find(x => x.item === c);
        a.items.push({ id: uid('l'), ref: c.id, desc: `${k ? k.name + ' as ' : ''}${c.name}`, amt: r ? r.work + r.hold : 1, units: 'Days', x: 1, rate: k && k.rate ? +k.rate : 0, fringe: true });
      } else if (c.cat === 'location') {
        a.items.push({ id: uid('l'), ref: c.id, desc: `${c.name} (location fee)`, amt: Math.max(1, days.filter(d => d.scenes.some(s => s.loc && s.loc.toUpperCase() === c.name.toUpperCase())).length), units: 'Days', x: 1, rate: 0, fringe: false });
      } else {
        a.items.push({ id: uid('l'), ref: c.id, desc: `${c.name} (${(CAT[c.cat] || {}).label || c.cat})`, amt: 1, units: 'Allow', x: 1, rate: 0, fringe: false });
      }
      open.add(a.id);
      added++;
    }
    project.budgetOpen = [...open];
    app.markDirty();
    paint();
    toast(added ? `Added ${added} line items from the catalog and schedule. Fill in the rates.` : 'Everything in the catalog already has a budget line.');
  }
  const CAT_ACCT_NAME = {};

  function rows() {
    const out = [['Account', 'Account name', 'Description', 'Amount', 'Units', 'X', 'Rate', 'Fringe', 'Subtotal']];
    for (const a of B.accounts) for (const it of a.items) out.push([a.num, a.name, it.desc, it.amt, it.units, it.x, it.rate, lineFringe(B, it).toFixed(2), (lineTotal(it) + lineFringe(B, it)).toFixed(2)]);
    const T = totals();
    out.push([], ['', 'Contingency', `${B.contingency}%`, '', '', '', '', '', T.cont.toFixed(2)], ['', 'GRAND TOTAL', B.currency, '', '', '', '', '', T.grand.toFixed(2)]);
    return out;
  }
  function exportCSV() { download(`${slug(project.title)}-budget.csv`, toCSV(rows()), 'text/csv'); }
  function print() {
    const T = totals();
    const detail = h('div.page-break', h('h2', 'Detail'), B.accounts.filter(a => a.items.length).map(a => h('div', { style: { marginBottom: '10px' } },
      h('h3', `${a.num} ${a.name}: ${fmt(accountTotal(B, a))}`),
      h('table.tbl', h('thead', h('tr', ['Description', 'Amount', 'Units', 'X', 'Rate', 'Subtotal'].map(x => h('th', x)))),
        h('tbody', a.items.map(it => h('tr', h('td', it.desc), h('td', it.amt), h('td', it.units), h('td', it.x), h('td', fmt(it.rate)), h('td', fmt(lineTotal(it) + lineFringe(B, it))))))))));
    printHTML(h('div', h('h2', `${project.title}: Budget top sheet`), topSheet(T), detail), { title: 'Budget' });
  }

  paint();
  return { cleanup() {} };
}
