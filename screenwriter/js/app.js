// Global app state: current project, preferences, autosave and cross-tab safety.
import * as store from './store.js';
import { debounce } from './util.js';

const PREF_KEY = 'rw.prefs';
const DEFAULT_PREFS = {
  theme: 'system',      // system | light | dark
  author: '',           // name used on comments and new title pages
  layout: 'auto',       // auto | page | fluid  (page = exact page geometry)
  zoom: 1,
  spellcheck: true,
  typewriter: false,
  sidePanel: true,
  sideTab: 'scenes',
  libSort: 'recent',
};

function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; }
  catch { return { ...DEFAULT_PREFS }; }
}

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('reelwright') : null;
const TAB_ID = Math.random().toString(36).slice(2);

export const app = {
  project: null,
  prefs: loadPrefs(),
  saveState: 'saved',
  lastSaved: 0,
  stateListeners: new Set(),
  externalChange: null,

  setPrefs(patch) {
    Object.assign(this.prefs, patch);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs)); } catch {}
    if ('theme' in patch) this.applyTheme();
  },

  applyTheme() {
    const t = this.prefs.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  },

  isDark() {
    const t = this.prefs.theme;
    return t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  },

  go(hash) { if (location.hash !== hash) location.hash = hash; },

  onSaveState(fn) { this.stateListeners.add(fn); return () => this.stateListeners.delete(fn); },
  setSaveState(s) { this.saveState = s; for (const fn of this.stateListeners) fn(s); },

  markDirty() {
    if (!this.project) return;
    this.project.updated = Date.now();
    this.setSaveState('dirty');
    this._saveLater();
  },

  async saveNow() {
    this._saveLater.cancel();
    const p = this.project;
    if (!p) return;
    if (this.saveState === 'saved') return;
    this.setSaveState('saving');
    try {
      await store.saveProject(p);
      this.lastSaved = Date.now();
      if (this.project === p) this.setSaveState('saved');
      channel && channel.postMessage({ type: 'saved', pid: p.id, tab: TAB_ID, ts: p.updated });
    } catch (e) {
      console.error(e);
      this.setSaveState('error');
      const { toast } = await import('./ui.js');
      toast('Could not save: ' + (e && e.message ? e.message : 'storage error') + '. Export a backup to be safe.', { kind: 'error', ms: 8000 });
    }
  },

  async openProject(id) {
    if (this.project && this.project.id === id) return this.project;
    await this.closeProject();
    const p = await store.loadProject(id);
    this.project = p;
    this.saveState = 'saved';
    return p;
  },

  async closeProject() {
    if (this.beforeClose) { try { this.beforeClose(); } catch {} }
    if (this.project) await this.saveNow();
    this.project = null;
  },
};
app._saveLater = debounce(() => app.saveNow(), 700);

if (channel) {
  channel.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === 'saved' && m.tab !== TAB_ID && app.project && app.project.id === m.pid && app.externalChange) app.externalChange(m);
  };
}

const flush = () => { if (app.beforeClose) { try { app.beforeClose({ soft: true }); } catch {} } app.saveNow(); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', (e) => {
  if (app.saveState === 'dirty' || app.saveState === 'saving') { flush(); e.preventDefault(); e.returnValue = ''; }
});
