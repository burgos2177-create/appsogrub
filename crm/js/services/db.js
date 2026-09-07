import {
  ref, get, set, update, push, remove, onValue, off, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js';
import { db } from './firebase.js?v=20260904-0325';
import { APP_BASE_PATH } from '../config/firebase-config.js?v=20260904-0325';

// Path relativo → /shared/crm/<path>. Path con "/" inicial → absoluto.
function _resolve(path) {
  if (typeof path !== 'string') throw new Error('path debe ser string');
  if (path.startsWith('/')) return path.slice(1);
  return APP_BASE_PATH ? `${APP_BASE_PATH}/${path}` : path;
}
function _ref(path) {
  const resolved = _resolve(path);
  return resolved ? ref(db, resolved) : ref(db);
}

// Firebase rechaza `undefined` (lanza síncrono). Un opcional omitido debe
// quedar ausente, no undefined.
export function clean(obj) {
  const out = {};
  for (const k in obj) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function rread(path) {
  return get(_ref(path)).then(s => s.exists() ? s.val() : null);
}
export function rset(path, val) { return set(_ref(path), val); }
export function rupdate(path, patch) { return update(_ref(path), clean(patch)); }
export function rpush(path, val) {
  const r = push(_ref(path));
  return set(r, clean(val)).then(() => r.key);
}
export function rremove(path) { return remove(_ref(path)); }
export function rwatch(path, cb) {
  const r = _ref(path);
  const handler = onValue(r, s => cb(s.exists() ? s.val() : null));
  return () => off(r, 'value', handler);
}
export function rtransaction(path, fn) {
  return runTransaction(_ref(path), fn);
}
