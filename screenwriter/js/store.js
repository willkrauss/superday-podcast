// IndexedDB persistence: projects, lightweight library heads, version snapshots and images.
import { uid } from './util.js';
import { migrateProject, docLabel } from './model.js';

const DB_NAME = 'reelwright';
const DB_VERSION = 1;
let dbPromise = null;
export let storageMode = 'indexeddb';
const mem = { projects: new Map(), heads: new Map(), versions: new Map(), images: new Map(), meta: new Map() };

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { storageMode = 'memory'; return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('heads')) db.createObjectStore('heads', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('versions')) db.createObjectStore('versions', { keyPath: 'id' }).createIndex('pid', 'pid');
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' }).createIndex('pid', 'pid');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { storageMode = 'memory'; resolve(null); };
    req.onblocked = () => {};
  });
  return dbPromise;
}

function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
function txDone(tx) { return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Transaction aborted')); }); }

async function get(store, key) {
  const db = await openDB();
  if (!db) return mem[store].get(key);
  return reqP(db.transaction(store).objectStore(store).get(key));
}
async function getAll(store) {
  const db = await openDB();
  if (!db) return Array.from(mem[store].values());
  return reqP(db.transaction(store).objectStore(store).getAll());
}
async function getAllBy(store, index, key) {
  const db = await openDB();
  if (!db) return Array.from(mem[store].values()).filter(v => v[index] === key);
  return reqP(db.transaction(store).objectStore(store).index(index).getAll(key));
}
async function put(store, val) {
  const db = await openDB();
  if (!db) { mem[store].set(val.id ?? val.k, val); return; }
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(val);
  return txDone(tx);
}
async function del(store, key) {
  const db = await openDB();
  if (!db) { mem[store].delete(key); return; }
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return txDone(tx);
}

export async function init() {
  await openDB();
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
  return storageMode;
}

export function headOf(p) {
  return {
    id: p.id, title: p.title, type: p.type, created: p.created, updated: p.updated,
    docs: p.docs.map(d => ({ id: d.id, title: docLabel(d), kind: d.kind, fmt: d.fmt, pages: d.pages || 0 })),
  };
}

export async function listProjects() {
  const heads = await getAll('heads');
  return heads.sort((a, b) => b.updated - a.updated);
}

export async function loadProject(id) {
  const p = await get('projects', id);
  return p ? migrateProject(p) : null;
}

export async function saveProject(p) {
  p.updated = Date.now();
  const db = await openDB();
  if (!db) { mem.projects.set(p.id, structuredClone(p)); mem.heads.set(p.id, headOf(p)); return; }
  const tx = db.transaction(['projects', 'heads'], 'readwrite');
  tx.objectStore('projects').put(p);
  tx.objectStore('heads').put(headOf(p));
  return txDone(tx);
}

export async function deleteProject(id) {
  const versions = await getAllBy('versions', 'pid', id);
  const images = await getAllBy('images', 'pid', id);
  const db = await openDB();
  if (!db) {
    mem.projects.delete(id); mem.heads.delete(id);
    versions.forEach(v => mem.versions.delete(v.id)); images.forEach(i => mem.images.delete(i.id));
    return;
  }
  const tx = db.transaction(['projects', 'heads', 'versions', 'images'], 'readwrite');
  tx.objectStore('projects').delete(id);
  tx.objectStore('heads').delete(id);
  for (const v of versions) tx.objectStore('versions').delete(v.id);
  for (const i of images) tx.objectStore('images').delete(i.id);
  return txDone(tx);
}

// ---------- Versions ----------
export async function addVersion({ pid, docId, name, auto = false, doc }) {
  const v = { id: uid('v'), pid, docId, name, auto, ts: Date.now(), doc: JSON.parse(JSON.stringify(doc)) };
  await put('versions', v);
  return v;
}
export async function listVersions(pid, docId) {
  const all = await getAllBy('versions', 'pid', pid);
  return all.filter(v => !docId || v.docId === docId).sort((a, b) => b.ts - a.ts);
}
export const getVersion = id => get('versions', id);
export const putVersion = v => put('versions', v);
export const deleteVersion = id => del('versions', id);

// ---------- Images ----------
const urlCache = new Map();
export async function putImage(pid, blob) {
  const id = uid('i');
  await put('images', { id, pid, blob, type: blob.type, ts: Date.now() });
  return id;
}
export async function getImageURL(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  const rec = await get('images', id);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}
export async function getImageBlob(id) { const r = await get('images', id); return r ? r.blob : null; }
export async function deleteImage(id) {
  if (!id) return;
  if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
  return del('images', id);
}

// ---------- Meta / prefs ----------
export async function getMeta(k, dflt = null) { const r = await get('meta', k); return r ? r.v : dflt; }
export async function setMeta(k, v) { return put('meta', { k, v }); }

// ---------- Backup bundles ----------
function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
async function dataURLToBlob(url) { return (await fetch(url)).blob(); }

export async function exportBundle(p, { versions = true } = {}) {
  const imgs = await getAllBy('images', 'pid', p.id);
  const images = {};
  for (const i of imgs) images[i.id] = await blobToDataURL(i.blob);
  const vers = versions ? await getAllBy('versions', 'pid', p.id) : [];
  return { format: 'reelwright-project', formatVersion: 1, exported: new Date().toISOString(), project: p, images, versions: vers };
}

export async function importBundle(bundle, { asCopy = false } = {}) {
  if (!bundle || bundle.format !== 'reelwright-project' || !bundle.project) throw new Error('This file is not a Reelwright project backup.');
  const p = migrateProject(JSON.parse(JSON.stringify(bundle.project)));
  const existing = await get('projects', p.id);
  const oldId = p.id;
  if (existing || asCopy) {
    p.id = uid('p');
    if (existing) p.title = p.title + ' (imported)';
  }
  // Re-key images so a copy never shares image records with the original.
  const idMap = {};
  for (const [oldImg, url] of Object.entries(bundle.images || {})) {
    try {
      const blob = await dataURLToBlob(url);
      const nid = await putImage(p.id, blob);
      idMap[oldImg] = nid;
    } catch {}
  }
  const remap = v => (v && idMap[v]) || v;
  for (const s of p.shots) s.img = remap(s.img);
  for (const c of p.catalog) c.img = remap(c.img);
  for (const c of p.contacts) c.img = remap(c.img);
  for (const v of bundle.versions || []) {
    if (v.pid !== oldId) continue;
    await put('versions', { ...v, id: uid('v'), pid: p.id });
  }
  await saveProject(p);
  return p;
}

export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}
export async function isPersisted() {
  try { return await navigator.storage.persisted(); } catch { return false; }
}
