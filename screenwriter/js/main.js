// Entry point: storage init, routing between the library and projects.
import { app } from './app.js';
import * as store from './store.js';
import { toast } from './ui.js';
import { clear } from './util.js';

const root = document.getElementById('app');
let current = null; // {kind:'library'|'project', cleanup}

let routing = Promise.resolve();
function route() { routing = routing.then(doRoute, doRoute); return routing; }

async function doRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'p' && parts[1]) {
    let p = app.project;
    if (!p || p.id !== parts[1]) {
      if (current && current.cleanup) { current.cleanup(); current = null; }
      p = await app.openProject(parts[1]);
      if (!p) { toast('That project could not be found on this device.'); history.replaceState(null, '', '#/'); return doRoute(); }
    }
    const { renderProject } = await import('./views/shell.js');
    if (!current || current.kind !== 'project') {
      if (current && current.cleanup) current.cleanup();
      clear(root);
      current = { kind: 'project', ...renderProject(root) };
    }
    await current.show(parts[2] || '', parts[3] || '');
    return;
  }
  if (current && current.cleanup) current.cleanup();
  current = null;
  await app.closeProject();
  const { renderLibrary } = await import('./views/library.js');
  clear(root);
  current = { kind: 'library', ...(await renderLibrary(root)) };
}

window.addEventListener('hashchange', route);

(async function start() {
  app.applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => app.applyTheme());
  const mode = await store.init();
  if (mode === 'memory') toast('Browser storage is unavailable (private mode?). Work will be lost when you close this tab unless you export it.', { kind: 'error', ms: 10000 });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  route();
})();
