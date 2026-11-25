// Project settings: page format, script options, app preferences, data.
import { h, clear, download, slug } from '../util.js';
import { field, selectInput, checkInput, textInput, confirmDialog, toast } from '../ui.js';
import { icon } from '../icons.js';
import { app } from '../app.js';
import * as store from '../store.js';
import { PROJECT_TYPES } from '../model.js';
import { PAPER } from '../formats.js';

export function render(ctx) {
  const { project } = ctx;
  const S = project.settings;
  ctx.setTitle('Project Settings');
  const dirty = () => app.markDirty();
  const section = (title, ...kids) => h('div.card.card-pad', { style: { marginBottom: '16px' } }, h('h3', { style: { fontSize: '15px', marginBottom: '12px' } }, title), h('div.form', ...kids));
  const body = h('div.view-inner', { style: { maxWidth: '760px' } },
    h('div.section-head', h('h2', 'Project Settings')),
    section('Project',
      h('div.form-grid',
        field('Title', textInput(project, 'title', { onChange: () => { dirty(); ctx.refreshSidebar(); } })),
        field('Type', selectInput(project, 'type', Object.entries(PROJECT_TYPES).map(([k, v]) => [k, v.label]), { onChange: () => { dirty(); ctx.refreshSidebar(); } })),
        field('Written by', textInput(project, 'author', { onChange: dirty })))),
    section('Page format',
      h('div.form-grid',
        field('Paper', selectInput(S, 'paper', Object.entries(PAPER).map(([k, v]) => [k, v.label]), { onChange: dirty })),
        field('Space before scene headings', selectInput({ v: String(S.sceneSpacing ?? 2) }, 'v', [['1', 'One blank line'], ['2', 'Two blank lines (Final Draft default)']], { onChange: v => { S.sceneSpacing = +v; dirty(); } })),
        field('Scene numbers', selectInput(S, 'sceneNumbers', [['none', 'Off'], ['left', 'Left'], ['right', 'Right'], ['both', 'Both sides']], { onChange: dirty }))),
      h('div.row.wrap', { style: { gap: '18px' } },
        checkInput(S, 'sceneBold', 'Bold scene headings', { onChange: dirty }),
        checkInput(S, 'sceneUnderline', 'Underline scene headings', { onChange: dirty }),
        checkInput(S, 'pageNumFirst', 'Number the first page', { onChange: dirty })),
      h('div.form-grid',
        field('Header text (top left of each page)', textInput(S, 'header', { onChange: dirty, placeholder: 'e.g. GOLDENROD DRAFT' })),
        field('Footer text (bottom center)', textInput(S, 'footer', { onChange: dirty, placeholder: 'e.g. CONFIDENTIAL' })))),
    section('Dialogue',
      checkInput(S, 'autoContd', 'Add (CONT’D) automatically when a character speaks again after action in the same scene', { onChange: dirty }),
      checkInput(S, 'moreContd', 'Use (MORE) and (CONT’D) when dialogue breaks across pages', { onChange: dirty })),
    section('Revisions',
      checkInput(S, 'showRevMarks', 'Show revision marks (*) for the current revision', { onChange: dirty }),
      checkInput(S, 'revTint', 'Tint revised pages with the revision color in PDFs', { onChange: dirty }),
      h('p.small.muted', 'Start and stop revisions from the pencil button in the script toolbar.')),
    section('App preferences (this device)',
      h('div.form-grid',
        field('Theme', selectInput({ v: app.prefs.theme }, 'v', [['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark']], { onChange: v => app.setPrefs({ theme: v }) })),
        field('Your name (comments)', textInput({ v: app.prefs.author }, 'v', { onChange: v => app.setPrefs({ author: v }) })),
        field('Editor layout', selectInput({ v: app.prefs.layout }, 'v', [['auto', 'Automatic'], ['page', 'Exact page'], ['fluid', 'Fit to screen']], { onChange: v => app.setPrefs({ layout: v }) }))),
      checkInput({ v: app.prefs.spellcheck !== false }, 'v', 'Spell check while typing', { onChange: v => app.setPrefs({ spellcheck: v }) }),
      checkInput({ v: !!app.prefs.typewriter }, 'v', 'Typewriter scrolling (keep the current line mid-screen)', { onChange: v => app.setPrefs({ typewriter: v }) })),
    section('Data',
      h('p.small.muted', 'This project lives in this browser’s storage on this device. Export a backup to move it to another device or keep a copy.'),
      h('div.row.wrap',
        h('button.btn', { type: 'button', onclick: async () => { await app.saveNow(); const b = await store.exportBundle(project); download(`${slug(project.title)}.reelwright.json`, JSON.stringify(b), 'application/json'); } }, icon('download'), 'Export project backup'),
        h('button.btn.danger', { type: 'button', onclick: async () => {
          if (!await confirmDialog(`Delete “${project.title}” and everything in it from this device? This cannot be undone.`, { title: 'Delete project', ok: 'Delete project', danger: true })) return;
          const id = project.id;
          app.project = null;
          await store.deleteProject(id);
          toast('Project deleted');
          app.go('#/');
        } }, icon('trash'), 'Delete project'))));
  ctx.view.append(h('div.view-pad.scroll', { style: { flex: 1 } }, body));
  return { cleanup() {} };
}
