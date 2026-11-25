// Call sheets generated from the schedule, cast list and crew contacts. Editable, printable.
import { h, clear, fmtDate, fmtEighths } from '../util.js';
import { emptyState, toast } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import { syncCatalog, findCatalog } from '../model.js';
import { computeDays, dayOutOfDays } from '../production.js';
import { printHTML } from '../preview.js';

export function render(ctx) {
  const { project } = ctx;
  ctx.setTitle('Call Sheets');
  if (syncCatalog(project)) app.markDirty();
  const body = h('div.view-inner');
  ctx.view.append(h('div.view-pad.scroll', { style: { flex: 1 } }, body));
  let { days } = computeDays(project);
  let dayId = ctx.arg && days.some(d => d.id === ctx.arg) ? ctx.arg : (days[0] && days[0].id);

  function paint() {
    clear(body);
    days = computeDays(project).days;
    if (!days.length) {
      body.append(emptyState('No shoot days yet', 'Call sheets are built from the schedule. Add day breaks to the stripboard first.',
        h('button.btn.primary', { type: 'button', onclick: () => app.go(`#/p/${project.id}/schedule`) }, 'Open schedule')));
      return;
    }
    const sel = h('select.input', { style: { width: 'auto' }, onchange: () => { dayId = sel.value; paint(); } },
      days.map(d => h('option', { value: d.id }, `Day ${d.n}: ${fmtDate(d.date, { weekday: 'short', month: 'short', day: 'numeric' })}`)));
    sel.value = dayId;
    const di = Math.max(0, days.findIndex(d => d.id === dayId));
    const day = days[di];
    const cs = sheetData(day.id);
    const sheetEl = sheet(day, di, cs);
    body.append(h('div.section-head', h('h2', 'Call Sheet'), sel, h('div.spacer'),
      h('button.btn.sm', { type: 'button', onclick: () => printHTML(sheet(day, di, cs, true), { title: `Call sheet day ${day.n}` }) }, icon('print'), 'Print / PDF')),
      h('p.small.muted', 'Everything below is editable. Scenes and cast come from the schedule; crew comes from Cast & Crew.'),
      sheetEl);
  }

  function sheetData(id) {
    if (!project.callsheets[id]) project.callsheets[id] = { crewCall: '07:00', shootCall: '08:00', lunch: '13:00', wrap: '19:00', weather: '', sunrise: '', sunset: '', hospital: '', parking: '', safety: '', notes: '', cast: {}, crew: {}, bg: '' };
    return project.callsheets[id];
  }

  function sheet(day, di, cs, forPrint = false) {
    const inp = (obj, key, ph = '', type = 'text') => {
      if (forPrint) return h('span', obj[key] || '');
      const el = h('input', { type, placeholder: ph, value: obj[key] || '' });
      el.addEventListener('input', () => { obj[key] = el.value; app.markDirty(); });
      return el;
    };
    const area = (obj, key, ph = '') => {
      if (forPrint) return h('div', { style: { whiteSpace: 'pre-wrap' } }, obj[key] || '');
      const el = h('textarea', { placeholder: ph, rows: 2 });
      el.value = obj[key] || '';
      el.addEventListener('input', () => { obj[key] = el.value; app.markDirty(); });
      return el;
    };
    const role = re => project.contacts.find(k => k.kind === 'crew' && re.test(k.role || ''));
    const dir = role(/^director$/i), prod = role(/producer/i), ad = role(/1st|first a\.?d|assistant director/i);
    const doodRows = dayOutOfDays(project, days);
    const castOnDay = [];
    for (const s of day.scenes) for (const c of s.cast) if (!castOnDay.includes(c)) castOnDay.push(c);
    castOnDay.sort((a, b) => (a.n || 999) - (b.n || 999));
    const locs = [];
    for (const s of day.scenes) {
      const it = findCatalog(project, 'location', s.loc);
      const key = it ? it.id : s.loc;
      if (!locs.some(l => l.key === key)) locs.push({ key, name: s.loc || s.text, address: it && it.fields ? it.fields.Address : '', parking: it && it.fields ? it.fields.Parking : '' });
    }
    const next = days[di + 1];
    const crew = project.contacts.filter(k => k.kind === 'crew').sort((a, b) => (a.dept || '').localeCompare(b.dept || '') || a.name.localeCompare(b.name));

    return h('div.cs',
      h('div.cs-head',
        h('div.kv', h('b', 'Director'), h('span', dir ? dir.name : '—'), h('b', 'Producer'), h('span', prod ? prod.name : '—'), h('b', '1st AD'), h('span', ad ? `${ad.name}${ad.phone ? ' · ' + ad.phone : ''}` : '—')),
        h('div.cs-title', h('div.t', project.title), h('div.d', fmtDate(day.date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })), h('div', `Day ${day.n} of ${days.length}`),
          h('div', { style: { marginTop: '8px' } }, 'General crew call'), h('div.cs-big', forPrint ? cs.crewCall : inp(cs, 'crewCall', '07:00', 'time'))),
        h('div.kv', h('b', 'Shooting call'), inp(cs, 'shootCall', '', 'time'), h('b', 'Lunch'), inp(cs, 'lunch', '', 'time'), h('b', 'Est. wrap'), inp(cs, 'wrap', '', 'time'),
          h('b', 'Weather'), inp(cs, 'weather', 'Sunny, 64°F'), h('b', 'Sunrise'), inp(cs, 'sunrise', '06:52'), h('b', 'Sunset'), inp(cs, 'sunset', '17:31'))),
      h('h3', 'Locations'),
      h('table', h('thead', h('tr', h('th', 'Set / location'), h('th', 'Address'), h('th', 'Parking / notes'))),
        h('tbody', locs.map(l => h('tr', h('td', l.name), h('td', l.address || ''), h('td', l.parking || ''))))),
      h('div.kv', { style: { marginTop: '8px' } }, h('b', 'Nearest hospital'), inp(cs, 'hospital', 'Name, address, phone'), h('b', 'Parking'), inp(cs, 'parking', 'Crew parking'), h('b', 'Safety'), inp(cs, 'safety', 'Safety notes')),
      h('h3', 'Scenes'),
      h('table', h('thead', h('tr', ['Sc', 'Set & description', 'I/E', 'D/N', 'Pages', 'Cast'].map(x => h('th', x)))),
        h('tbody', day.scenes.map(s => h('tr', h('td', s.label), h('td', h('b', s.loc || s.text), s.syn ? h('div', s.syn) : null), h('td', s.ie), h('td', s.dn), h('td', fmtEighths(s.eighths)), h('td', s.cast.map(c => c.n).join(', ')))),
          h('tr', h('td', { colspan: 4, style: { textAlign: 'right', fontWeight: 700 } }, 'Total pages'), h('td', { style: { fontWeight: 700 } }, fmtEighths(day.eighths)), h('td')))),
      h('h3', 'Cast'),
      h('table', h('thead', h('tr', ['#', 'Character', 'Cast', 'Status', 'Pickup', 'Makeup / hair', 'On set'].map(x => h('th', x)))),
        h('tbody', castOnDay.map(c => {
          const k = project.contacts.find(x => x.char === c.id);
          const row = cs.cast[c.id] || (cs.cast[c.id] = {});
          const status = (doodRows.find(r => r.item === c) || { codes: [] }).codes[di] || '';
          return h('tr', h('td', c.n || ''), h('td', c.name), h('td', k ? k.name : ''), h('td', status), h('td', inp(row, 'pickup', '', 'time')), h('td', inp(row, 'mu', '', 'time')), h('td', inp(row, 'set', '', 'time')));
        }))),
      h('div.kv', { style: { marginTop: '8px' } }, h('b', 'Background / extras'), area(cs, 'bg', 'e.g. 6 fishermen, 2 dog walkers')),
      h('h3', 'Crew'),
      crew.length ? h('table', h('thead', h('tr', ['Department', 'Position', 'Name', 'Phone', 'Call'].map(x => h('th', x)))),
        h('tbody', crew.map(k => {
          if (cs.crew[k.id] == null) cs.crew[k.id] = k.call || cs.crewCall;
          const t = forPrint ? h('span', cs.crew[k.id]) : (() => { const el = h('input', { type: 'time', value: cs.crew[k.id] || '' }); el.addEventListener('input', () => { cs.crew[k.id] = el.value; app.markDirty(); }); return el; })();
          return h('tr', h('td', k.dept || ''), h('td', k.role || ''), h('td', k.name), h('td', k.phone || ''), h('td', t));
        }))) : h('p.small', { style: { color: '#666' } }, 'Add crew in Cast & Crew to list them here.'),
      h('h3', 'Notes'), area(cs, 'notes', 'Special instructions, props, wardrobe, vehicles…'),
      next ? h('div', h('h3', `Advance schedule: Day ${next.n}, ${fmtDate(next.date, { weekday: 'long', month: 'short', day: 'numeric' })}`),
        h('table', h('tbody', next.scenes.map(s => h('tr', h('td', s.label), h('td', s.loc || s.text), h('td', s.ie), h('td', s.dn), h('td', fmtEighths(s.eighths)), h('td', s.cast.map(c => c.n).join(', '))))))) : null);
  }

  paint();
  return { cleanup() {} };
}
