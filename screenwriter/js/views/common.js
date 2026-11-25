// Helpers shared by the production/story views.
import { h } from '../util.js';
import { docLabel, isProductionDoc } from '../model.js';
import { app } from '../app.js';

export function productionDocs(project) { return project.docs.filter(isProductionDoc); }
export function scriptDocs(project) { return project.docs.filter(d => d.kind !== 'text'); }

// Choose which document a per-script tool shows: route arg, then last used, then first eligible.
export function pickDoc(project, arg, list = productionDocs(project)) {
  return list.find(d => d.id === arg) || list.find(d => d.id === project.toolDoc) || list.find(d => d.id === project.lastDoc) || list[0] || null;
}

export function docPicker(project, doc, tool, list = productionDocs(project)) {
  if (list.length < 2) return null;
  const sel = h('select.input.doc-picker', { 'aria-label': 'Script', onchange: () => { project.toolDoc = sel.value; app.go(`#/p/${project.id}/${tool}/${sel.value}`); } },
    list.map(d => h('option', { value: d.id }, docLabel(d))));
  sel.value = doc.id;
  return sel;
}

// Replace a scene heading block's metadata immutably.
export function setSceneMeta(doc, sceneId, patch) {
  const i = doc.blocks.findIndex(b => b.id === sceneId);
  if (i < 0) return;
  const b = doc.blocks[i];
  const s = { ...(b.s || {}), ...patch };
  for (const k of Object.keys(patch)) if (patch[k] === undefined || patch[k] === '' || (Array.isArray(patch[k]) && !patch[k].length)) delete s[k];
  doc.blocks[i] = { ...b, s };
  doc.updated = Date.now();
}

export function sceneTitle(s) { return s.omit ? 'OMITTED' : (s.text || '(untitled scene)'); }

export function noScripts(view, project, what) {
  view.append(h('div.view-pad', h('div.empty', h('div.empty-title', `No script to ${what} yet`), h('p', 'Add a screenplay, stage play, audio drama or AV script to this project first.'))));
}
