// Project data model, factories and script analysis helpers.
import { uid, todayISO, wordCount } from './util.js';
import { FORMATS, getFormat, typeDef, convertType, typeOfRole, SCENE_TIMES } from './formats.js';
import { htmlToText, textToHTML, spanIds, upperSafe, htmlToRuns, runsToHTML } from './inline.js';

export const SCHEMA_VERSION = 1;

export const PROJECT_TYPES = {
  film: { label: 'Film', fmt: 'screenplay', desc: 'Feature or short film screenplay' },
  series: { label: 'TV Series', fmt: 'screenplay', episodic: true, desc: 'Multiple episodes sharing one catalog, schedule and budget' },
  stage: { label: 'Stage Play', fmt: 'stage', desc: 'Theatre script with centered character names' },
  audio: { label: 'Audio Drama / Podcast', fmt: 'audio', desc: 'Radio play format with SFX and music cues' },
  av: { label: 'AV / Video (two-column)', fmt: 'av', desc: 'Commercials, documentaries, corporate and YouTube video' },
  comic: { label: 'Comic Book', fmt: 'comic', desc: 'Pages, panels, balloons and captions' },
};

export const DOC_KINDS = {
  script: 'Script',
  av: 'AV Script',
  text: 'Document',
};

export const CATEGORIES = [
  { id: 'cast', label: 'Cast', color: '#e5484d' },
  { id: 'extras', label: 'Extras / Background', color: '#30a46c' },
  { id: 'stunts', label: 'Stunts', color: '#f76b15' },
  { id: 'vehicles', label: 'Vehicles', color: '#d6409f' },
  { id: 'animals', label: 'Animals', color: '#978365' },
  { id: 'props', label: 'Props', color: '#8e4ec6' },
  { id: 'wardrobe', label: 'Wardrobe', color: '#0090ff' },
  { id: 'makeup', label: 'Makeup / Hair', color: '#ffb224' },
  { id: 'setdressing', label: 'Set Dressing', color: '#12a594' },
  { id: 'sfx', label: 'Special Effects', color: '#3e63dd' },
  { id: 'vfx', label: 'Visual Effects', color: '#00a2c7' },
  { id: 'sound', label: 'Sound', color: '#ad7f58' },
  { id: 'music', label: 'Music', color: '#a19100' },
  { id: 'equipment', label: 'Special Equipment', color: '#697177' },
  { id: 'greenery', label: 'Greenery', color: '#5c7c2f' },
  { id: 'security', label: 'Security', color: '#393a40' },
  { id: 'location', label: 'Locations', color: '#0d74ce' },
  { id: 'misc', label: 'Notes / Misc', color: '#8d8d8d' },
];
export const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

export const CATALOG_FIELDS = {
  cast: ['Age', 'Description', 'Background', 'Wants / Needs', 'Arc', 'Traits', 'Relationships', 'Voice'],
  location: ['Address', 'Location contact', 'Permits', 'Parking', 'Power / Facilities'],
  default: ['Quantity', 'Source', 'Estimated cost'],
};

export function defaultSettings() {
  return {
    paper: 'letter',
    sceneSpacing: 2,
    sceneNumbers: 'none', // none|left|right|both
    sceneBold: false,
    sceneUnderline: false,
    autoContd: true,
    moreContd: true,
    pageNumFirst: false,
    header: '',
    footer: '',
    showRevMarks: true,
    revTint: false,
  };
}

export function defaultTitlePage(title = '', author = '') {
  return { show: true, title, credit: 'Written by', author, source: '', draft: '', date: '', contact: '', notes: '' };
}

export function newDoc({ kind = 'script', fmt = 'screenplay', title = 'Untitled', ep = null, author = '' } = {}) {
  const d = {
    id: uid('d'), kind, fmt: kind === 'av' ? 'av' : (kind === 'text' ? 'text' : fmt), title, ep,
    created: Date.now(), updated: Date.now(),
    blocks: [], comments: [],
    tp: defaultTitlePage(title, author),
    rev: { list: [], active: null },
    locked: false,
    goal: 0,
  };
  if (kind === 'text') d.tp.show = false;
  if (kind === 'av') d.blocks = [{ id: uid('b'), t: 'avscene', v: '', a: '' }, { id: uid('b'), t: 'avrow', v: '', a: '' }];
  else d.blocks = [{ id: uid('b'), t: getFormat(d.fmt).first, h: d.fmt === 'comic' ? 'PAGE ONE' : '' }];
  return d;
}

export function newProject({ title = 'Untitled', type = 'film', author = '' } = {}) {
  const pt = PROJECT_TYPES[type] || PROJECT_TYPES.film;
  const p = {
    id: uid('p'), schema: SCHEMA_VERSION, title, type, author,
    created: Date.now(), updated: Date.now(),
    docs: [],
    catalog: [], shots: [], beats: [], contacts: [],
    schedule: { start: todayISO(), skipWeekends: true, strips: [], dayHours: 12 },
    budget: defaultBudget(),
    callsheets: {},
    settings: defaultSettings(),
  };
  const kind = pt.fmt === 'av' ? 'av' : 'script';
  if (pt.episodic) p.docs.push(newDoc({ kind, fmt: pt.fmt, title: 'Pilot', ep: 1, author }));
  else p.docs.push(newDoc({ kind, fmt: pt.fmt, title, author }));
  p.docs[0].tp.title = title;
  if (pt.episodic) p.docs[0].tp.title = `${title}\n"Pilot"`;
  return p;
}

// Upgrade older/partial project objects (imports, older saves).
export function migrateProject(p) {
  p.schema = SCHEMA_VERSION;
  p.docs = p.docs || [];
  p.catalog = p.catalog || [];
  p.shots = p.shots || [];
  p.beats = p.beats || [];
  p.contacts = p.contacts || [];
  p.schedule = Object.assign({ start: todayISO(), skipWeekends: true, strips: [], dayHours: 12 }, p.schedule || {});
  p.budget = p.budget || defaultBudget();
  p.callsheets = p.callsheets || {};
  p.settings = Object.assign(defaultSettings(), p.settings || {});
  for (const d of p.docs) {
    d.blocks = d.blocks || [];
    d.comments = d.comments || [];
    d.tp = Object.assign(defaultTitlePage(d.title), d.tp || {});
    d.rev = d.rev || { list: [], active: null };
    if (!d.blocks.length) d.blocks.push(d.kind === 'av' ? { id: uid('b'), t: 'avrow', v: '', a: '' } : { id: uid('b'), t: getFormat(d.fmt).first, h: '' });
  }
  return p;
}

export function docLabel(doc) {
  if (doc.ep != null && doc.ep !== '') return `Ep. ${doc.ep}: ${doc.title}`;
  return doc.title;
}

export function isProductionDoc(doc) {
  if (doc.kind === 'av') return true;
  return doc.kind === 'script' && !!getFormat(doc.fmt).production;
}

// ---------- Scene analysis ----------

const IE_RE = /^\s*(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|I\s*\/\s*E\.?|INT\.?|EXT\.?|EST\.?)(?=[\s.\/]|$)[\s.]*/i;
const TIME_SET = new Set(SCENE_TIMES);

export function parseHeading(text) {
  let t = upperSafe(String(text || '').trim()).replace(/\s+/g, ' ');
  let ie = '';
  const m = IE_RE.exec(t);
  if (m) {
    const raw = m[1].replace(/\s|\./g, '');
    ie = /^(INT\/EXT|EXT\/INT|I\/E)$/.test(raw) ? 'INT/EXT' : raw;
    t = t.slice(m[0].length);
  }
  let loc = t, tod = '';
  const parts = t.split(/\s+[-–—]+\s+/);
  if (parts.length > 1) {
    const last = parts[parts.length - 1].trim();
    const firstWord = last.replace(/\(.*?\)/g, '').trim();
    if (TIME_SET.has(firstWord) || TIME_SET.has(firstWord.split(' ')[0]) || /^(DAY|NIGHT)\b/.test(firstWord) || ie) {
      tod = last;
      loc = parts.slice(0, -1).join(' - ');
    }
  }
  return { ie, loc: loc.trim(), tod: tod.trim() };
}

export function normalizeCharName(text) {
  return upperSafe(String(text || ''))
    .replace(/\(.*?\)/g, ' ')
    .replace(/\bCONT['’]?D\b/g, ' ')
    .replace(/[\^:]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function letterSeq(i) { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = LETTERS[r] + s; i = Math.floor((i - 1) / 26); } return s; }
function letterIndex(s) { let n = 0; for (const ch of s) n = n * 26 + (LETTERS.indexOf(ch) + 1); return n - 1; }

// Scene number labels. Locked docs keep stored numbers and letter-suffix new scenes (12A, 12B; A1 before 1).
export function sceneNumberMap(doc) {
  const fmt = getFormat(doc.fmt);
  const heads = doc.kind === 'av'
    ? doc.blocks.filter(b => b.t === 'avscene')
    : doc.blocks.filter(b => typeDef(fmt, b.t).role === 'heading');
  const map = new Map();
  if (!doc.locked) { heads.forEach((b, i) => map.set(b.id, String(i + 1))); return map; }
  let last = null, k = 0;
  const pending = [];
  for (const b of heads) {
    const num = b.s && b.s.num;
    if (num) {
      if (pending.length) {
        const m = /^(\d+)/.exec(num);
        pending.forEach((pb, i) => map.set(pb.id, letterSeq(i) + (m ? m[1] : num)));
        pending.length = 0;
      }
      map.set(b.id, num); last = num; k = 0;
    } else if (last == null) pending.push(b);
    else {
      const m = /^(.*?\d+)([A-Z]*)$/.exec(last);
      if (m) { k++; map.set(b.id, m[1] + letterSeq((m[2] ? letterIndex(m[2]) : -1) + k)); }
      else { k++; map.set(b.id, last + letterSeq(k - 1)); }
    }
  }
  pending.forEach((pb, i) => map.set(pb.id, letterSeq(i) + '1'));
  return map;
}

// Both return a new blocks array (block objects are treated as immutable by the editor's undo history).
export function lockSceneNumbers(doc) {
  const map = sceneNumberMap(doc);
  doc.locked = true;
  return doc.blocks.map(b => map.has(b.id) ? { ...b, s: { ...(b.s || {}), num: map.get(b.id) } } : b);
}
export function unlockSceneNumbers(doc) {
  doc.locked = false;
  return doc.blocks.map(b => {
    if (!b.s || !b.s.num) return b;
    const s = { ...b.s };
    delete s.num;
    return { ...b, s };
  });
}

// Returns scenes for a script or AV doc.
export function getScenes(doc) {
  const scenes = [];
  if (!doc) return scenes;
  const nums = sceneNumberMap(doc);
  if (doc.kind === 'av') {
    let cur = null;
    doc.blocks.forEach((b, i) => {
      if (b.t === 'avscene') {
        cur = mkScene(b, i, htmlToText(b.v || b.a || ''), nums.get(b.id));
        scenes.push(cur);
      } else if (cur) {
        cur.end = i + 1;
        const txt = htmlToText(b.v) + ' ' + htmlToText(b.a);
        cur.words += wordCount(txt);
        for (const id of spanIds(b.v, 'tg').concat(spanIds(b.a, 'tg'))) cur.tags.add(id);
        // "NAME:" at the start of an audio line counts as a speaking character
        for (const line of htmlToText(b.a).split('\n')) {
          const m = /^\s*([A-Z][A-Z0-9 .'\-]{1,30})(?:\s*\(.*?\))?\s*:/.exec(line);
          if (m) cur.chars.add(normalizeCharName(m[1]));
        }
      }
    });
    return applyDayNight(scenes);
  }
  const fmt = getFormat(doc.fmt);
  let cur = null;
  doc.blocks.forEach((b, i) => {
    const role = typeDef(fmt, b.t).role;
    if (role === 'heading') {
      cur = mkScene(b, i, htmlToText(b.h), nums.get(b.id));
      scenes.push(cur);
      return;
    }
    if (!cur) return;
    cur.end = i + 1;
    const txt = htmlToText(b.h);
    cur.words += wordCount(txt);
    if (role === 'character') { const n = normalizeCharName(txt); if (n) cur.chars.add(n); }
    if (!cur.firstLine && (role === 'action') && txt.trim()) cur.firstLine = txt.trim();
    for (const id of spanIds(b.h, 'tg')) cur.tags.add(id);
  });
  return applyDayNight(scenes);
}

const INHERIT_TOD = /^(CONTINUOUS|CONT|LATER|MOMENTS LATER|SAME|SAME TIME|CONTINUED|SIMULTANEOUS)\b/;

// Day/night for scheduling: CONTINUOUS, LATER etc. inherit from the previous scene.
function applyDayNight(scenes) {
  let prev = 'DAY';
  for (const s of scenes) {
    const t = (s.tod || '').replace(/[()]/g, '').trim();
    if (!t || INHERIT_TOD.test(t)) s.dn = prev;
    else { s.dn = t.split(/[\s(]/)[0]; prev = s.dn; }
  }
  return scenes;
}

function mkScene(b, i, text, num) {
  const hd = parseHeading(text);
  const s = b.s || {};
  return {
    id: b.id, idx: i, end: i + 1, block: b, text: text.trim(), num: num || '',
    ie: hd.ie, loc: hd.loc, tod: hd.tod,
    chars: new Set(), tags: new Set(), words: 0, firstLine: '',
    syn: s.syn || '', color: s.color || '', omit: !!s.omit, time: s.time || '',
  };
}

export function sceneById(doc, id) { return getScenes(doc).find(s => s.id === id); }

// All speaking characters in a doc with counts.
export function characterStats(doc) {
  const fmt = getFormat(doc.fmt);
  const stats = new Map();
  let curScene = null, sceneIdx = -1, curChar = null;
  doc.blocks.forEach((b, i) => {
    const role = typeDef(fmt, b.t).role;
    if (role === 'heading') { curScene = b.id; sceneIdx++; curChar = null; return; }
    if (role === 'character') {
      const n = normalizeCharName(htmlToText(b.h));
      curChar = n || null;
      if (!n) return;
      if (!stats.has(n)) stats.set(n, { name: n, lines: 0, words: 0, scenes: new Set(), first: i });
      const s = stats.get(n);
      s.lines++;
      if (curScene) s.scenes.add(curScene);
      return;
    }
    if (role === 'dialogue' && curChar && stats.has(curChar)) stats.get(curChar).words += wordCount(htmlToText(b.h));
    else if (role !== 'paren' && role !== 'dialogue') curChar = null;
  });
  return Array.from(stats.values());
}

export function allCharacterNames(project) {
  const set = new Set();
  for (const d of project.docs) {
    if (d.kind === 'script') {
      const fmt = getFormat(d.fmt);
      for (const b of d.blocks) if (typeDef(fmt, b.t).role === 'character') { const n = normalizeCharName(htmlToText(b.h)); if (n) set.add(n); }
    }
  }
  for (const c of project.catalog) if (c.cat === 'cast' && c.name) set.add(upperSafe(c.name));
  return Array.from(set).sort();
}

export function allLocations(project) {
  const set = new Set();
  for (const d of project.docs) for (const s of getScenes(d)) if (s.loc) set.add(s.loc);
  for (const c of project.catalog) if (c.cat === 'location' && c.name) set.add(upperSafe(c.name));
  return Array.from(set).sort();
}

export function docText(doc) {
  if (doc.kind === 'av') return doc.blocks.map(b => htmlToText(b.v) + '\n' + htmlToText(b.a)).join('\n');
  return doc.blocks.map(b => htmlToText(b.h)).join('\n');
}

export function docWords(doc) { return wordCount(docText(doc)); }

// ---------- Catalog ----------

export function findCatalog(project, cat, name) {
  const n = upperSafe(String(name || '').trim());
  return project.catalog.find(c => c.cat === cat && upperSafe(c.name.trim()) === n);
}

export function addCatalog(project, cat, name, extra = {}) {
  const ex = findCatalog(project, cat, name);
  if (ex) return ex;
  const item = { id: uid('c'), cat, name: String(name).trim(), desc: '', img: null, fields: {}, ...extra };
  if (cat === 'cast' || cat === 'location') item.name = upperSafe(item.name);
  project.catalog.push(item);
  return item;
}

// Add characters and locations found in scripts. Never removes anything.
export function syncCatalog(project) {
  let added = 0;
  for (const name of allCharacterNamesFromScripts(project)) {
    if (!findCatalog(project, 'cast', name)) { addCatalog(project, 'cast', name, { auto: true }); added++; }
  }
  for (const d of project.docs) {
    if (!isProductionDoc(d)) continue;
    for (const s of getScenes(d)) {
      if (s.loc && !findCatalog(project, 'location', s.loc)) { addCatalog(project, 'location', s.loc, { auto: true }); added++; }
      for (const ch of s.chars) if (!findCatalog(project, 'cast', ch)) { addCatalog(project, 'cast', ch, { auto: true }); added++; }
    }
  }
  assignCastNumbers(project);
  return added;
}

function allCharacterNamesFromScripts(project) {
  const set = new Set();
  for (const d of project.docs) {
    if (d.kind !== 'script' || !isProductionDoc(d)) continue;
    const fmt = getFormat(d.fmt);
    for (const b of d.blocks) if (typeDef(fmt, b.t).role === 'character') { const n = normalizeCharName(htmlToText(b.h)); if (n) set.add(n); }
  }
  return set;
}

// Cast ID numbers (1 = most scenes) for stripboards and call sheets; keeps numbers already assigned.
export function assignCastNumbers(project) {
  const cast = project.catalog.filter(c => c.cat === 'cast');
  const used = new Set(cast.filter(c => c.n).map(c => +c.n));
  const counts = new Map();
  for (const d of project.docs) for (const s of getScenes(d)) for (const ch of s.chars) counts.set(ch, (counts.get(ch) || 0) + 1);
  const unnumbered = cast.filter(c => !c.n).sort((a, b) => (counts.get(upperSafe(b.name)) || 0) - (counts.get(upperSafe(a.name)) || 0));
  let next = 1;
  for (const c of unnumbered) { while (used.has(next)) next++; c.n = next; used.add(next); }
}

// Elements in a scene grouped by category: Map(cat -> [catalog items])
export function sceneElements(project, doc, scene) {
  const out = new Map();
  const add = (item) => {
    if (!item) return;
    if (!out.has(item.cat)) out.set(item.cat, []);
    const arr = out.get(item.cat);
    if (!arr.includes(item)) arr.push(item);
  };
  for (const ch of scene.chars) add(findCatalog(project, 'cast', ch));
  if (scene.loc) add(findCatalog(project, 'location', scene.loc));
  for (const id of scene.tags) add(project.catalog.find(c => c.id === id));
  for (const id of (scene.block.s?.el || [])) add(project.catalog.find(c => c.id === id));
  return out;
}

export function sceneCast(project, scene) {
  const els = sceneElements(project, null, scene);
  return (els.get('cast') || []).slice().sort((a, b) => (a.n || 999) - (b.n || 999));
}

// Every scene in every production doc, labelled for multi-episode projects.
export function allProductionScenes(project) {
  const out = [];
  const episodic = project.docs.filter(isProductionDoc).length > 1;
  for (const d of project.docs) {
    if (!isProductionDoc(d)) continue;
    for (const s of getScenes(d)) {
      out.push({ ...s, doc: d, key: d.id + ':' + s.id, label: episodic ? `${d.ep != null && d.ep !== '' ? 'E' + d.ep : d.title.slice(0, 6)}-${s.num}` : s.num });
    }
  }
  return out;
}

// ---------- Conversion between formats ----------

export function convertDoc(doc, toFmtId) {
  const out = JSON.parse(JSON.stringify(doc));
  out.id = uid('d');
  out.created = out.updated = Date.now();
  if (toFmtId === 'av' && doc.kind !== 'av') {
    out.kind = 'av'; out.fmt = 'av';
    out.blocks = scriptToAV(doc);
    return out;
  }
  if (doc.kind === 'av' && toFmtId !== 'av') {
    out.kind = 'script'; out.fmt = toFmtId;
    out.blocks = avToScript(doc, getFormat(toFmtId));
    return out;
  }
  const from = getFormat(doc.fmt), to = getFormat(toFmtId);
  out.fmt = toFmtId;
  out.kind = toFmtId === 'text' ? 'text' : 'script';
  out.blocks = doc.blocks.map(b => ({ ...b, t: convertType(from, to, b.t) }));
  return out;
}

function scriptToAV(doc) {
  const fmt = getFormat(doc.fmt);
  const rows = [];
  let row = null, speaker = null;
  const newRow = () => { row = { id: uid('b'), t: 'avrow', v: '', a: '' }; rows.push(row); };
  const addTo = (k, html) => { if (!row) newRow(); row[k] = row[k] ? row[k] + '<br>' + html : html; };
  for (const b of doc.blocks) {
    const role = typeDef(fmt, b.t).role;
    if (role === 'heading') { rows.push({ id: b.id, t: 'avscene', v: b.h, a: '', s: b.s }); row = null; continue; }
    if (role === 'action' || role === 'shot' || role === 'other' || role === 'act' || role === 'endact') {
      if (row && row.v) newRow();
      addTo('v', role === 'shot' ? upperSafe(htmlToText(b.h)) : b.h);
      continue;
    }
    if (role === 'character') { speaker = upperSafe(htmlToText(b.h)); continue; }
    if (role === 'paren') { addTo('a', `<i>${b.h}</i>`); continue; }
    if (role === 'dialogue') { addTo('a', (speaker ? `<b>${speaker}:</b> ` : '') + b.h); speaker = null; continue; }
    if (role === 'transition') { addTo('v', upperSafe(htmlToText(b.h))); continue; }
  }
  if (!rows.length) rows.push({ id: uid('b'), t: 'avrow', v: '', a: '' });
  return rows;
}

function avToScript(doc, fmt) {
  const out = [];
  const T = r => typeOfRole(fmt, r) || fmt.order[0];
  for (const b of doc.blocks) {
    if (b.t === 'avscene') { out.push({ id: b.id, t: T('heading'), h: b.v || b.a, s: b.s }); continue; }
    if (b.v) for (const line of splitBr(b.v)) out.push({ id: uid('b'), t: T('action'), h: line });
    if (b.a) for (const line of splitBr(b.a)) {
      const txt = htmlToText(line);
      const m = /^\s*([A-Z][A-Z0-9 .'\-]{1,30}(?:\s*\(.*?\))?)\s*:\s*(.*)$/.exec(txt);
      if (m && T('character') && T('dialogue')) {
        out.push({ id: uid('b'), t: T('character'), h: textToHTML(m[1]) });
        out.push({ id: uid('b'), t: T('dialogue'), h: textToHTML(m[2]) });
      } else out.push({ id: uid('b'), t: T('action'), h: line });
    }
  }
  if (!out.length) out.push({ id: uid('b'), t: fmt.first, h: '' });
  return out;
}

function splitBr(html) { return html.split(/<br>/).map(s => s.trim()).filter(Boolean); }

// ---------- Budget ----------

const BUDGET_TEMPLATE = [
  ['atl', '1100', 'Story & Rights'], ['atl', '1200', 'Producers'], ['atl', '1300', 'Director'], ['atl', '1400', 'Cast'], ['atl', '1500', 'ATL Travel & Living'],
  ['btl', '2000', 'Production Staff'], ['btl', '2100', 'Extras / Background'], ['btl', '2200', 'Art Department'], ['btl', '2300', 'Set Construction'],
  ['btl', '2500', 'Set Dressing'], ['btl', '2600', 'Props'], ['btl', '2700', 'Wardrobe'], ['btl', '2800', 'Makeup & Hair'],
  ['btl', '2900', 'Lighting & Electric'], ['btl', '3000', 'Camera'], ['btl', '3100', 'Grip'], ['btl', '3200', 'Production Sound'],
  ['btl', '3300', 'Transportation'], ['btl', '3400', 'Locations'], ['btl', '3500', 'Picture Vehicles & Animals'], ['btl', '3600', 'Special Effects'],
  ['btl', '3700', 'Stunts'], ['btl', '3800', 'Catering & Craft Services'], ['btl', '3900', 'Production Equipment'],
  ['post', '4000', 'Editorial'], ['post', '4100', 'Music'], ['post', '4200', 'Post Sound'], ['post', '4300', 'Visual Effects'], ['post', '4400', 'Titles & Deliverables'],
  ['other', '5000', 'Insurance'], ['other', '5100', 'Legal & Accounting'], ['other', '5200', 'Publicity & Festivals'], ['other', '5300', 'General Expenses'],
];
export const BUDGET_GROUPS = { atl: 'Above the Line', btl: 'Below the Line: Production', post: 'Post-Production', other: 'Other Costs' };
export const CATEGORY_ACCOUNT = { cast: '1400', extras: '2100', stunts: '3700', vehicles: '3500', animals: '3500', props: '2600', wardrobe: '2700', makeup: '2800', setdressing: '2500', sfx: '3600', vfx: '4300', sound: '4200', music: '4100', equipment: '3900', greenery: '2500', security: '3400', location: '3400' };

export function defaultBudget() {
  return {
    currency: 'USD',
    contingency: 10,
    fringes: [{ id: uid('f'), name: 'Payroll taxes', pct: 10 }, { id: uid('f'), name: 'Union pension & health', pct: 0 }],
    accounts: BUDGET_TEMPLATE.map(([g, num, name]) => ({ id: uid('a'), group: g, num, name, items: [] })),
  };
}

export function lineTotal(item) {
  return (Number(item.amt) || 0) * (Number(item.x) || 1) * (Number(item.rate) || 0);
}
export function lineFringe(budget, item) {
  if (!item.fringe) return 0;
  const pct = budget.fringes.reduce((s, f) => s + (Number(f.pct) || 0), 0);
  return lineTotal(item) * pct / 100;
}
export function accountTotal(budget, acct) {
  return acct.items.reduce((s, it) => s + lineTotal(it) + lineFringe(budget, it), 0);
}

// ---------- Text helpers for blocks ----------

export function blockText(b) { return htmlToText(b.h); }

export function setBlockText(b, text) { return { ...b, h: textToHTML(text) }; }

export function newBlock(t, text = '') { return { id: uid('b'), t, h: textToHTML(text) }; }

export function mapBlockRuns(b, fn) { return { ...b, h: runsToHTML(fn(htmlToRuns(b.h))) }; }

export { FORMATS };
