// Script reports: overview, scenes, characters, locations, elements.
import { h, clear, download, slug, toCSV, fmtEighths, plural } from '../util.js';
import { tabs, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import { getScenes, characterStats, sceneElements, CATEGORIES, docWords, docLabel, syncCatalog } from '../model.js';
import { pickDoc, docPicker, scriptDocs, sceneTitle } from './common.js';
import { sceneLengths } from '../production.js';
import { layoutScript, estimateRuntime } from '../paginate.js';
import { printHTML } from '../preview.js';
import { getFormat, typeDef } from '../formats.js';
import { htmlToText } from '../inline.js';
import { wordCount } from '../util.js';

export function render(ctx) {
  const { project } = ctx;
  const docs = scriptDocs(project).filter(d => d.kind !== 'av');
  const doc = pickDoc(project, ctx.arg, docs);
  ctx.setTitle('Reports');
  if (!doc) { ctx.view.append(h('div.view-pad', emptyState('No scripts', 'Reports cover screenplays, plays, audio dramas and comics.'))); return; }
  if (syncCatalog(project)) app.markDirty();
  let tab = project.reportTab || 'overview';
  const body = h('div.view-inner');
  ctx.view.append(h('div.view-pad.scroll', { style: { flex: 1 } }, body));

  function paint() {
    clear(body);
    body.append(h('div.section-head', h('h2', 'Reports'), docPicker(project, doc, 'reports', docs), h('div.spacer'),
      h('button.btn.sm', { type: 'button', onclick: () => exportCSV() }, icon('download'), 'CSV'),
      h('button.btn.sm', { type: 'button', onclick: () => printHTML(h('div', h('h2', `${project.title}: ${docLabel(doc)} (${labelOf(tab)})`), content().cloneNode(true)), { title: labelOf(tab) }) }, icon('print'), 'Print')));
    body.append(tabs(TABS, tab, t => { tab = project.reportTab = t; paint(); }));
    body.append(h('div', { style: { marginTop: '14px' } }, content()));
  }
  const TABS = [['overview', 'Overview'], ['scenes', 'Scenes'], ['characters', 'Characters'], ['locations', 'Locations'], ['elements', 'Elements']];
  const labelOf = t => (TABS.find(x => x[0] === t) || [, ''])[1];

  function data() {
    const fmt = getFormat(doc.fmt);
    const scenes = getScenes(doc);
    const lens = fmt.production || doc.fmt === 'comic' ? sceneLengths(project, doc) : new Map();
    const L = layoutScript(doc, project, { noTitle: true });
    return { fmt, scenes, lens, L, chars: characterStats(doc).sort((a, b) => b.words - a.words) };
  }

  let cache = null;
  function content() {
    cache = cache || data();
    const { fmt, scenes, lens, L, chars } = cache;
    if (tab === 'overview') {
      let dlg = 0, act = 0;
      for (const b of doc.blocks) { const n = wordCount(htmlToText(b.h)); const r = typeDef(fmt, b.t).role; if (r === 'dialogue') dlg += n; else if (r === 'action') act += n; }
      const total = docWords(doc);
      const tods = {};
      for (const s of scenes) { const k = (s.tod || '—').split(' ')[0]; tods[k] = (tods[k] || 0) + 1; }
      const ie = { INT: scenes.filter(s => s.ie === 'INT').length, EXT: scenes.filter(s => s.ie === 'EXT').length, 'INT/EXT': scenes.filter(s => s.ie === 'INT/EXT').length };
      const longest = scenes.slice().sort((a, b) => ((lens.get(b.id) || {}).eighths || 0) - ((lens.get(a.id) || {}).eighths || 0)).slice(0, 5);
      return h('div',
        h('div.report-grid',
          stat(L.pageCount, 'pages'), stat(estimateRuntime(L.pageCount).replace('~', ''), 'est. runtime'), stat(scenes.length, 'scenes'), stat(total.toLocaleString(), 'words'),
          stat(chars.length, 'speaking parts'), stat(total ? Math.round(dlg / total * 100) + '%' : '—', 'dialogue'), stat(total ? Math.round(act / total * 100) + '%' : '—', 'action')),
        h('div.form-grid',
          h('div.card.card-pad', h('b', 'Interior / exterior'), bars(Object.entries(ie))),
          h('div.card.card-pad', h('b', 'Time of day'), bars(Object.entries(tods))),
          h('div.card.card-pad', h('b', 'Longest scenes'), longest.map(s => h('div.row.small', { style: { padding: '2px 0' } }, h('b', s.num), h('span.ellipsis.grow', s.text), h('span', fmtEighths((lens.get(s.id) || {}).eighths || 0)))))));
    }
    if (tab === 'scenes') {
      if (!scenes.length) return emptyState('No scenes', '');
      return table(['#', 'Heading', 'I/E', 'D/N', 'Page', 'Length', 'Characters', 'Words', 'Synopsis'],
        scenes.map(s => [s.num, sceneTitle(s), s.ie, s.tod, (lens.get(s.id) || {}).page || '', fmtEighths((lens.get(s.id) || {}).eighths || 0), Array.from(s.chars).join(', '), s.words, s.syn]));
    }
    if (tab === 'characters') {
      if (!chars.length) return emptyState('No dialogue yet', '');
      const firstPage = c => { const b = doc.blocks[c.first]; return b ? L.blockPage.get(b.id) || '' : ''; };
      const max = chars[0].words || 1;
      return table(['Character', 'Speeches', 'Words of dialogue', 'Share', 'Scenes', 'First page'],
        chars.map(c => [c.name, c.lines, c.words, h('div.bar', { style: { width: '120px' } }, h('i', { style: { width: (c.words / max * 100) + '%' } })), c.scenes.size, firstPage(c)]));
    }
    if (tab === 'locations') {
      const m = new Map();
      for (const s of scenes) {
        const k = s.loc || s.text || '—';
        if (!m.has(k)) m.set(k, { scenes: [], eighths: 0, ie: new Set(), tod: new Set() });
        const r = m.get(k);
        r.scenes.push(s.num); r.eighths += (lens.get(s.id) || {}).eighths || 0; if (s.ie) r.ie.add(s.ie); if (s.tod) r.tod.add(s.tod.split(' ')[0]);
      }
      const rows = Array.from(m.entries()).sort((a, b) => b[1].eighths - a[1].eighths);
      if (!rows.length) return emptyState('No locations', '');
      return table(['Location', 'Scenes', 'Pages', 'Int/Ext', 'Times'], rows.map(([k, r]) => [k, r.scenes.join(', '), fmtEighths(r.eighths), [...r.ie].join(', '), [...r.tod].join(', ')]));
    }
    // elements
    const rows = [];
    for (const c of CATEGORIES) {
      for (const it of project.catalog.filter(x => x.cat === c.id)) {
        const inScenes = scenes.filter(s => (sceneElements(project, doc, s).get(c.id) || []).includes(it));
        if (inScenes.length) rows.push([c.label, it.name, inScenes.length, inScenes.map(s => s.num).join(', ')]);
      }
    }
    if (!rows.length) return emptyState('No elements', 'Tag props, wardrobe, vehicles and more in the script to see them here.');
    return table(['Category', 'Element', 'Scenes', 'Scene numbers'], rows);
  }

  function stat(v, l) { return h('div.stat', h('b', String(v)), h('span', l)); }
  function bars(entries) {
    const max = Math.max(1, ...entries.map(e => e[1]));
    return h('div', { style: { marginTop: '6px' } }, entries.filter(e => e[1]).map(([k, v]) => h('div.hbar', { style: { gridTemplateColumns: '90px 1fr 30px' } }, h('span', k), h('div.bar', h('i', { style: { width: (v / max * 100) + '%' } })), h('span.small', v))));
  }
  function table(head, rows) {
    lastRows = [head, ...rows.map(r => r.map(c => (c instanceof Node ? '' : c)))];
    return h('div.tbl-wrap', h('table.tbl', h('thead', h('tr', head.map(x => h('th', x)))), h('tbody', rows.map(r => h('tr', r.map(c => h('td', c instanceof Node ? c : String(c ?? ''))))))));
  }
  let lastRows = null;
  function exportCSV() {
    if (tab === 'overview') { tab = 'scenes'; content(); tab = project.reportTab || 'overview'; }
    if (lastRows) download(`${slug(docLabel(doc))}-${tab}.csv`, toCSV(lastRows), 'text/csv');
  }

  paint();
  return { cleanup() {} };
}
