// Production helpers: shoot days from the stripboard, Day Out of Days, scene page lengths.
import { allProductionScenes, sceneElements, getScenes } from './model.js';
import { layoutScript } from './paginate.js';
import { isoDate, parseISODate } from './util.js';

const lenCache = new WeakMap();
// Map(sceneId -> {eighths, page}) for a doc. Cached until any block object or setting changes.
export function sceneLengths(project, doc) {
  const sig = JSON.stringify(project.settings);
  const c = lenCache.get(doc);
  if (c && c.sig === sig && c.blocks.length === doc.blocks.length && c.blocks.every((b, i) => b === doc.blocks[i])) return c.map;
  const L = layoutScript(doc, project, { noTitle: true });
  const map = new Map();
  for (const [id, s] of L.scenes) map.set(id, { eighths: s.eighths, page: s.page });
  lenCache.set(doc, { sig, blocks: doc.blocks.slice(), map });
  doc.pages = L.pageCount;
  return map;
}

export function sceneIndex(project) {
  const map = new Map();
  for (const s of allProductionScenes(project)) {
    const len = sceneLengths(project, s.doc).get(s.id);
    s.eighths = len ? len.eighths : 1;
    s.page = len ? len.page : null;
    s.cast = (sceneElements(project, s.doc, s).get('cast') || []).slice().sort((a, b) => (a.n || 999) - (b.n || 999));
    map.set(s.key, s);
  }
  return map;
}

export function stripKey(st) { return st.docId + ':' + st.sceneId; }

export function shootDate(project, n) {
  const sch = project.schedule;
  const d = sch.start ? parseISODate(sch.start) : new Date();
  const off = new Set(sch.daysOff || []);
  let count = 0;
  const cur = new Date(d);
  for (let guard = 0; guard < 2000; guard++) {
    const dow = cur.getDay();
    const skip = (sch.skipWeekends && (dow === 0 || dow === 6)) || off.has(isoDate(cur));
    if (!skip) { count++; if (count === n) return new Date(cur); }
    cur.setDate(cur.getDate() + 1);
  }
  return cur;
}

// Returns {days:[{id, n, date, scenes:[scene], eighths}], scheduledKeys:Set, index}
export function computeDays(project, index = sceneIndex(project)) {
  const days = [];
  let cur = { scenes: [], banners: [] };
  const keys = new Set();
  const close = (id) => {
    const n = days.length + 1;
    days.push({ id, n, date: shootDate(project, n), scenes: cur.scenes, banners: cur.banners, eighths: cur.scenes.reduce((a, s) => a + (s.eighths || 0), 0) });
    cur = { scenes: [], banners: [] };
  };
  for (const st of project.schedule.strips) {
    if (st.k === 'scene') {
      const s = index.get(stripKey(st));
      if (s) { cur.scenes.push(s); keys.add(s.key); }
    } else if (st.k === 'day') close(st.id);
    else if (st.k === 'banner') cur.banners.push(st);
  }
  if (cur.scenes.length) close('open');
  return { days, scheduledKeys: keys, index };
}

// Day Out of Days for cast members.
export function dayOutOfDays(project, days) {
  const cast = project.catalog.filter(c => c.cat === 'cast').sort((a, b) => (a.n || 999) - (b.n || 999));
  const rows = [];
  for (const c of cast) {
    const work = days.map(d => d.scenes.some(s => s.cast.includes(c)));
    const first = work.indexOf(true), last = work.lastIndexOf(true);
    if (first === -1) continue;
    const codes = work.map((w, i) => {
      if (i < first || i > last) return '';
      if (!w) return 'H';
      if (first === last) return 'SWF';
      if (i === first) return 'SW';
      if (i === last) return 'WF';
      return 'W';
    });
    rows.push({
      item: c, codes,
      work: work.filter(Boolean).length,
      hold: codes.filter(x => x === 'H').length,
      start: days[first].date, finish: days[last].date,
    });
  }
  return rows;
}

export function castStatusOn(project, days, dayIdx, item) {
  const row = dayOutOfDays(project, days).find(r => r.item === item);
  return row ? row.codes[dayIdx] : '';
}

export { getScenes };
