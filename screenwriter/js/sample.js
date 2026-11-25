// Builds the sample project (an original short film) so every tool has data to explore.
import { newProject, addCatalog, syncCatalog, getScenes, findCatalog } from './model.js';
import { parseFountain } from './io.js';
import { htmlToRuns, runsToHTML, applyAttr, runsText } from './inline.js';
import { uid, todayISO } from './util.js';
import { getFormat, typeDef } from './formats.js';

export async function buildSample() {
  const txt = await (await fetch('samples/sample.fountain')).text();
  const parsed = parseFountain(txt);
  const p = newProject({ title: 'The Last Lighthouse', type: 'film', author: 'Sam Rivera' });
  p.sample = true;
  const d = p.docs[0];
  d.title = 'The Last Lighthouse';
  d.blocks = parsed.blocks;
  d.tp = { ...parsed.tp, show: true };
  const fmt = getFormat(d.fmt);

  const syn = [
    ['Mara arrives at the dark lighthouse; Theo says the light failed last night.', '#4f8cff'],
    ['The climb up the stairwell. Theo warns her about the ninetieth step.', ''],
    ['In the lamp room Mara finds a singed logbook; the lamp flares on by itself.', '#e5484d'],
    ['The beam sweeps the sea and a ship answers with three flashes.', ''],
    ['Theo explains the logbook. The last entry is dated tonight. A ghost ship appears.', '#e5484d'],
    ['Mara runs to the cove. Wet footprints lead out of the sea and stop at her feet.', '#30a46c'],
  ];
  let si = 0;
  d.blocks = d.blocks.map(b => {
    if (typeDef(fmt, b.t).role !== 'heading') return b;
    const [s, color] = syn[si++] || ['', ''];
    return { ...b, s: { ...(b.s || {}), syn: s, ...(color ? { color } : {}) } };
  });

  syncCatalog(p);
  const tag = (cat, phrase, name) => {
    const item = addCatalog(p, cat, name);
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    d.blocks = d.blocks.map(b => {
      const role = typeDef(fmt, b.t).role;
      if (role === 'heading' || role === 'character') return b;
      let runs = htmlToRuns(b.h);
      const m = re.exec(runsText(runs));
      if (!m) return b;
      runs = applyAttr(runs, m.index, m.index + m[0].length, 'tg', item.id);
      return { ...b, h: runsToHTML(runs) };
    });
    return item;
  };
  tag('props', 'NOTEBOOK', 'Leather logbook (singed)');
  tag('props', 'dead flashlight', 'Flashlight');
  tag('props', 'canvas tool bag', 'Canvas tool bag');
  tag('vehicles', 'rusted pickup', 'Rusted pickup truck');
  tag('props', 'two mugs of tea', 'Tea mugs');
  tag('props', 'kettle', 'Kettle');
  tag('sfx', 'FLARES', 'Lamp flare rig');
  tag('vfx', 'TALL-MASTED SHIP', 'Ghost ship (CG)');
  tag('vfx', "SHIP'S LIGHT", 'Distant ship light');
  tag('wardrobe', 'wool cap', "Theo's wool cap");
  tag('sfx', 'fog', 'Fog');
  tag('makeup', 'soot', 'Soot on hands');
  const mara = findCatalog(p, 'cast', 'MARA');
  const theo = findCatalog(p, 'cast', 'THEO');
  if (mara) Object.assign(mara, { desc: 'Lighthouse engineer, 40s. Practical, unsentimental, quietly lonely.', fields: { Age: '40s', Arc: 'From fixing things to believing in them.' } });
  if (theo) Object.assign(theo, { desc: 'Third-generation keeper, 60s. Knows more than he says.', fields: { Age: '60s' } });
  for (const c of p.catalog.filter(c => c.cat === 'location')) {
    c.fields = { Address: c.name.includes('COTTAGE') ? 'Keeper\'s cottage, Gull Point Rd' : 'Gull Point Light, Gull Point Rd', Parking: 'Gravel lot at the gate' };
  }

  const crew = (name, role, dept, extra = {}) => ({ id: uid('k'), name, kind: 'crew', role, dept, phone: '', email: '', notes: '', ...extra });
  p.contacts = [
    crew('Avery Lin', 'Director', 'Direction', { call: '06:30' }),
    crew('Jordan Park', 'Producer', 'Production', { call: '06:00' }),
    crew('Casey Moore', '1st Assistant Director', 'Direction', { call: '06:00' }),
    crew('Riley Chen', 'Director of Photography', 'Camera', { call: '06:30' }),
    crew('Morgan Diaz', 'Production Sound Mixer', 'Sound', { call: '07:00' }),
    { id: uid('k'), name: 'Nadia Bello', kind: 'cast', role: 'Mara', char: mara ? mara.id : null, rate: 800, phone: '', email: '', notes: '' },
    { id: uid('k'), name: 'Hal Whitaker', kind: 'cast', role: 'Theo', char: theo ? theo.id : null, rate: 650, phone: '', email: '', notes: '' },
  ];

  const scenes = getScenes(d);
  const shots = [
    [0, 'WS', 'Eye Level', 'Static', '24mm', 'The lighthouse on the headland at dawn, waves below.'],
    [0, 'MS', 'Eye Level', 'Dolly In', '35mm', 'Pickup pulls in; Mara gets out and looks up.'],
    [0, 'OTS', 'Eye Level', 'Static', '50mm', 'Over Mara onto Theo holding the dead flashlight.'],
    [2, 'CU', 'High', 'Handheld', '50mm', 'Mara\'s sooty fingers on the brass housing.'],
    [2, 'Insert', 'Overhead', 'Static', '85mm', 'The singed logbook wedged in the gears.'],
    [2, 'MCU', 'Low', 'Static', '35mm', 'The lamp flares; Mara throws up an arm.'],
  ];
  p.shots = shots.map(([sc, size, angle, move, lens, desc], i) => ({
    id: uid('s'), docId: d.id, sceneId: scenes[sc].id, size, angle, move, lens, desc, subj: '', dur: 6, sound: 'Sync', done: false, notes: '', img: null,
  }));

  const S = i => ({ k: 'scene', docId: d.id, sceneId: scenes[i].id });
  p.schedule = {
    start: todayISO(), skipWeekends: true, dayHours: 12,
    strips: [
      { k: 'banner', id: uid('x'), text: 'EXTERIORS - Gull Point', color: '#ffd6e7' },
      S(0), S(5), S(3),
      { k: 'day', id: uid('x') },
      S(1), S(2),
      { k: 'day', id: uid('x') },
      S(4),
      { k: 'day', id: uid('x') },
    ],
  };

  const acct = num => p.budget.accounts.find(a => a.num === num);
  const line = (num, desc, amt, units, x, rate, fringe = false, ref) => acct(num).items.push({ id: uid('l'), desc, amt, units, x, rate, fringe, ...(ref ? { ref } : {}) });
  line('1300', 'Director (flat)', 1, 'Flat', 1, 3000, true);
  line('1400', 'Nadia Bello as MARA', 3, 'Days', 1, 800, true, mara && mara.id);
  line('1400', 'Hal Whitaker as THEO', 3, 'Days', 1, 650, true, theo && theo.id);
  line('3000', 'Camera package rental', 3, 'Days', 1, 450);
  line('3400', 'Gull Point Light location fee', 3, 'Days', 1, 500);
  line('3600', 'Lamp flare rig + fog', 1, 'Allow', 1, 750);
  line('4300', 'Ghost ship VFX (2 shots)', 2, 'Each', 1, 1200);
  line('3800', 'Catering, cast & crew of 14', 3, 'Days', 14, 25);
  p.beats = [
    ['Hook', 'A lighthouse that has never failed goes dark.', '#cfe2ff'],
    ['Discovery', 'The singed logbook: three generations recording ships that should not exist.', '#fff3b0'],
    ['Turn', 'The last entry is dated tonight, in wet ink.', '#ffd6e7'],
    ['Ending', 'Footprints from the sea stop at Mara\'s feet. She is part of the log now.', '#d4f5d0'],
  ].map(([title, text, color], i) => ({ id: uid('t'), title, text, color, x: 32 + i * 250, y: 40 + (i % 2) * 40 }));
  return p;
}
