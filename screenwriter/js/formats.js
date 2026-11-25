// Script formats. Geometry is in inches on the page (Courier 12pt: 10 chars/inch, 6 lines/inch).
// l = left edge from page edge, w = text width, sb = blank lines before, caps/b/i/u = styling,
// align = left|center|right, next = element after Enter, tab/stab = Tab / Shift+Tab conversions,
// empty = what Enter does on an empty element, role = semantic role used for conversion and analysis.

const SCREENPLAY = {
  id: 'screenplay', label: 'Screenplay',
  types: {
    scene: { label: 'Scene Heading', role: 'heading', l: 1.5, w: 6.0, caps: 1, sb: 'scene', next: 'action', tab: 'action', stab: 'transition', empty: 'action', keepNext: 1 },
    action: { label: 'Action', role: 'action', l: 1.5, w: 6.0, sb: 1, next: 'action', tab: 'character', stab: 'scene', empty: 'scene', split: 1 },
    character: { label: 'Character', role: 'character', l: 3.7, w: 3.8, caps: 1, sb: 1, next: 'dialogue', tab: 'transition', stab: 'action', empty: 'action', keepNext: 1 },
    parenthetical: { label: 'Parenthetical', role: 'paren', l: 3.1, w: 2.5, sb: 0, next: 'dialogue', tab: 'dialogue', stab: 'dialogue', empty: 'dialogue', parens: 1 },
    dialogue: { label: 'Dialogue', role: 'dialogue', l: 2.5, w: 3.5, sb: 0, next: 'action', tab: 'parenthetical', stab: 'character', empty: 'action' },
    transition: { label: 'Transition', role: 'transition', l: 1.5, w: 6.0, align: 'right', caps: 1, sb: 1, next: 'scene', tab: 'scene', stab: 'character', empty: 'scene', keepPrev: 1 },
    shot: { label: 'Shot', role: 'shot', l: 1.5, w: 6.0, caps: 1, sb: 1, next: 'action', tab: 'action', stab: 'scene', empty: 'action', keepNext: 1 },
    centered: { label: 'Centered', role: 'other', l: 1.5, w: 6.0, align: 'center', sb: 1, next: 'action', tab: 'action', stab: 'action', empty: 'action' },
    act: { label: 'New Act', role: 'act', l: 1.5, w: 6.0, align: 'center', caps: 1, u: 1, sb: 2, newPage: 1, next: 'scene', tab: 'scene', stab: 'action', empty: 'scene', keepNext: 1 },
    endact: { label: 'End of Act', role: 'endact', l: 1.5, w: 6.0, align: 'center', caps: 1, u: 1, sb: 2, next: 'act', tab: 'act', stab: 'action', empty: 'act' },
  },
  order: ['scene', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'centered', 'act', 'endact'],
  first: 'scene',
  production: true,
};

const STAGE = {
  id: 'stage', label: 'Stage Play',
  types: {
    scene: { label: 'Act / Scene', role: 'heading', l: 1.5, w: 6.0, align: 'center', caps: 1, u: 1, sb: 'scene', next: 'direction', tab: 'direction', stab: 'transition', empty: 'direction', keepNext: 1 },
    direction: { label: 'Stage Direction', role: 'action', l: 3.5, w: 4.0, i: 1, sb: 1, next: 'character', tab: 'character', stab: 'scene', empty: 'scene', split: 1 },
    character: { label: 'Character', role: 'character', l: 1.5, w: 6.0, align: 'center', caps: 1, sb: 1, next: 'dialogue', tab: 'direction', stab: 'direction', empty: 'direction', keepNext: 1 },
    parenthetical: { label: 'Actor Direction', role: 'paren', l: 3.0, w: 3.5, i: 1, sb: 0, next: 'dialogue', tab: 'dialogue', stab: 'dialogue', empty: 'dialogue', parens: 1 },
    dialogue: { label: 'Dialogue', role: 'dialogue', l: 1.5, w: 6.0, sb: 0, next: 'character', tab: 'parenthetical', stab: 'character', empty: 'direction' },
    song: { label: 'Lyrics', role: 'dialogue', l: 2.5, w: 4.5, i: 1, sb: 0, next: 'character', tab: 'dialogue', stab: 'dialogue', empty: 'character' },
    transition: { label: 'Transition', role: 'transition', l: 1.5, w: 6.0, align: 'right', caps: 1, sb: 1, next: 'scene', tab: 'scene', stab: 'direction', empty: 'scene', keepPrev: 1 },
  },
  order: ['scene', 'direction', 'character', 'parenthetical', 'dialogue', 'song', 'transition'],
  first: 'scene',
  production: true,
};

const AUDIO = {
  id: 'audio', label: 'Audio Drama',
  types: {
    scene: { label: 'Scene Heading', role: 'heading', l: 1.5, w: 6.0, caps: 1, b: 1, sb: 'scene', next: 'sound', tab: 'sound', stab: 'transition', empty: 'sound', keepNext: 1 },
    sound: { label: 'Sound (SFX)', role: 'action', l: 1.5, w: 6.0, caps: 1, u: 1, prefix: 'SFX: ', sb: 1, next: 'character', tab: 'music', stab: 'scene', empty: 'character' },
    music: { label: 'Music', role: 'action', l: 1.5, w: 6.0, caps: 1, u: 1, prefix: 'MUSIC: ', sb: 1, next: 'character', tab: 'character', stab: 'sound', empty: 'character' },
    character: { label: 'Character', role: 'character', l: 1.5, w: 2.5, caps: 1, sb: 1, next: 'dialogue', tab: 'action', stab: 'music', empty: 'action', keepNext: 1 },
    parenthetical: { label: 'Direction', role: 'paren', l: 2.5, w: 4.0, sb: 0, next: 'dialogue', tab: 'dialogue', stab: 'dialogue', empty: 'dialogue', parens: 1 },
    dialogue: { label: 'Dialogue', role: 'dialogue', l: 2.5, w: 5.0, sb: 0, next: 'character', tab: 'parenthetical', stab: 'character', empty: 'sound' },
    action: { label: 'Note / Description', role: 'action', l: 1.5, w: 6.0, i: 1, sb: 1, next: 'character', tab: 'character', stab: 'sound', empty: 'scene', split: 1 },
    transition: { label: 'Transition', role: 'transition', l: 1.5, w: 6.0, align: 'right', caps: 1, sb: 1, next: 'scene', tab: 'scene', stab: 'action', empty: 'scene', keepPrev: 1 },
  },
  order: ['scene', 'sound', 'music', 'character', 'parenthetical', 'dialogue', 'action', 'transition'],
  first: 'scene',
  production: true,
};

const COMIC = {
  id: 'comic', label: 'Comic Book',
  types: {
    page: { label: 'Page', role: 'heading', l: 1.5, w: 6.0, caps: 1, b: 1, u: 1, sb: 3, next: 'panel', tab: 'panel', stab: 'sfx', empty: 'panel', keepNext: 1, autoNum: 'PAGE' },
    panel: { label: 'Panel', role: 'shot', l: 1.5, w: 6.0, b: 1, sb: 2, next: 'description', tab: 'description', stab: 'page', empty: 'description', keepNext: 1, autoNum: 'Panel' },
    description: { label: 'Description', role: 'action', l: 1.5, w: 6.0, sb: 1, next: 'character', tab: 'character', stab: 'panel', empty: 'panel', split: 1 },
    character: { label: 'Character', role: 'character', l: 2.5, w: 5.0, caps: 1, sb: 1, next: 'balloon', tab: 'caption', stab: 'description', empty: 'description', keepNext: 1 },
    parenthetical: { label: 'Balloon Type', role: 'paren', l: 3.0, w: 3.5, sb: 0, next: 'balloon', tab: 'balloon', stab: 'balloon', empty: 'balloon', parens: 1 },
    balloon: { label: 'Balloon', role: 'dialogue', l: 3.0, w: 4.5, sb: 0, next: 'character', tab: 'parenthetical', stab: 'character', empty: 'panel' },
    caption: { label: 'Caption', role: 'other', l: 2.5, w: 5.0, prefix: 'CAPTION: ', sb: 1, next: 'character', tab: 'sfx', stab: 'character', empty: 'panel' },
    sfx: { label: 'SFX', role: 'other', l: 2.5, w: 5.0, caps: 1, prefix: 'SFX: ', sb: 1, next: 'panel', tab: 'page', stab: 'caption', empty: 'panel' },
  },
  order: ['page', 'panel', 'description', 'character', 'parenthetical', 'balloon', 'caption', 'sfx'],
  first: 'page',
  production: false,
};

const TEXT = {
  id: 'text', label: 'Text Document',
  types: {
    heading: { label: 'Heading', role: 'heading', l: 1.0, w: 6.5, caps: 1, b: 1, sb: 2, next: 'paragraph', tab: 'subheading', stab: 'paragraph', empty: 'paragraph', keepNext: 1 },
    subheading: { label: 'Subheading', role: 'shot', l: 1.0, w: 6.5, b: 1, sb: 1, next: 'paragraph', tab: 'paragraph', stab: 'heading', empty: 'paragraph', keepNext: 1 },
    paragraph: { label: 'Paragraph', role: 'action', l: 1.0, w: 6.5, sb: 1, next: 'paragraph', tab: 'bullet', stab: 'subheading', empty: 'heading', split: 1 },
    bullet: { label: 'Bullet', role: 'other', l: 1.3, w: 6.2, prefix: '• ', sb: 0, next: 'bullet', tab: 'paragraph', stab: 'paragraph', empty: 'paragraph', split: 1 },
    centered: { label: 'Centered', role: 'other', l: 1.0, w: 6.5, align: 'center', sb: 1, next: 'paragraph', tab: 'paragraph', stab: 'paragraph', empty: 'paragraph' },
  },
  order: ['heading', 'subheading', 'paragraph', 'bullet', 'centered'],
  first: 'heading',
  production: false,
};

export const FORMATS = { screenplay: SCREENPLAY, stage: STAGE, audio: AUDIO, comic: COMIC, text: TEXT };

// Pseudo-format for the two-column AV script editor (not block based).
export const AV_FORMAT = { id: 'av', label: 'AV (Two-Column)', production: true };

export function getFormat(id) { return FORMATS[id] || SCREENPLAY; }

export function typeDef(fmt, t) { return fmt.types[t] || fmt.types[fmt.order[0]]; }

export function spacingBefore(fmt, t, settings) {
  const d = typeDef(fmt, t);
  if (d.sb === 'scene') return settings?.sceneSpacing ?? 2;
  return d.sb || 0;
}

export function typeOfRole(fmt, role) {
  return fmt.order.find(t => fmt.types[t].role === role);
}

// Convert a block type between formats by semantic role.
const ROLE_FALLBACK = { act: 'heading', endact: 'transition', shot: 'action', other: 'action', transition: 'action' };
export function convertType(fromFmt, toFmt, t) {
  const role = typeDef(fromFmt, t).role;
  let out = typeOfRole(toFmt, role);
  if (!out && ROLE_FALLBACK[role]) out = typeOfRole(toFmt, ROLE_FALLBACK[role]);
  return out || typeOfRole(toFmt, 'action') || toFmt.order[0];
}

export const PAPER = {
  letter: { w: 8.5, h: 11, label: 'US Letter' },
  a4: { w: 8.27, h: 11.69, label: 'A4' },
};

export function pageGeometry(settings = {}) {
  const p = PAPER[settings.paper] || PAPER.letter;
  const top = 1.0, bottom = 1.0;
  const lines = Math.floor((p.h - top - bottom) * 6 + 0.001);
  return { w: p.w, h: p.h, top, bottom, lines };
}

// Auto-complete vocabularies.
export const SCENE_PREFIXES = ['INT. ', 'EXT. ', 'INT./EXT. ', 'EXT./INT. ', 'I/E. ', 'EST. '];
export const SCENE_TIMES = ['DAY', 'NIGHT', 'MORNING', 'AFTERNOON', 'EVENING', 'DAWN', 'DUSK', 'SUNRISE', 'SUNSET', 'CONTINUOUS', 'LATER', 'MOMENTS LATER', 'SAME TIME', 'MAGIC HOUR', 'NOON', 'MIDNIGHT'];
export const TRANSITIONS = ['CUT TO:', 'FADE OUT.', 'FADE IN:', 'FADE TO BLACK.', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:', 'JUMP CUT TO:', 'CUT TO BLACK.', 'INTERCUT WITH:', 'BACK TO:', 'TIME CUT:', 'WIPE TO:', 'BLACKOUT.', 'LIGHTS UP.', 'LIGHTS FADE.', 'END OF SCENE', 'CURTAIN.'];
export const CHAR_EXTENSIONS = ['(V.O.)', '(O.S.)', '(O.C.)', "(CONT'D)", '(PRE-LAP)', '(FILTERED)', '(ON PHONE)', '(SUBTITLED)'];

export const REVISION_COLORS = [
  { name: 'White', color: '#ffffff' },
  { name: 'Blue', color: '#cfe2ff' },
  { name: 'Pink', color: '#ffd6e7' },
  { name: 'Yellow', color: '#fff3b0' },
  { name: 'Green', color: '#d4f5d0' },
  { name: 'Goldenrod', color: '#f6d58a' },
  { name: 'Buff', color: '#f3e3c3' },
  { name: 'Salmon', color: '#ffc8b4' },
  { name: 'Cherry', color: '#f7b2bd' },
  { name: 'Tan', color: '#e2cfb3' },
];

// Strip colors for the stripboard (industry convention).
export function stripColor(ie, tod) {
  const night = /NIGHT|DUSK|EVENING|MIDNIGHT/.test(tod || '');
  const ext = /^EXT|^I\/E|^INT\.?\/EXT/.test(ie || '');
  if (ext && night) return 'strip-en';
  if (ext) return 'strip-ed';
  if (night) return 'strip-in';
  return 'strip-id';
}
