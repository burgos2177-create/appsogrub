import {
  ref, get, set, update, push, remove, onValue, off
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-database.js';
import { db } from './firebase.js?v=1';
import { APP_BASE_PATH } from '../config/firebase-config.js?v=1';

// Prefija toda path relativa con APP_BASE_PATH. Para escapes (rutas absolutas
// como /shared/buzon, /shared/obraLinks, /legacy/bitacora/*, /legacy/estimaciones/*)
// pasar el path comenzando con "/" — se interpreta como absoluto.
function _resolve(path) {
  if (typeof path !== 'string') throw new Error('path debe ser string');
  if (path.startsWith('/')) return path.slice(1);
  return APP_BASE_PATH ? `${APP_BASE_PATH}/${path}` : path;
}

export function appPath(relPath) { return _resolve(relPath); }

function _ref(path) {
  const resolved = _resolve(path);
  return resolved ? ref(db, resolved) : ref(db);
}

export function rread(path) {
  return get(_ref(path)).then(s => s.exists() ? s.val() : null);
}
export function rset(path, val) { return set(_ref(path), val); }
export function rupdate(path, patch) { return update(_ref(path), patch); }
export function rpush(path, val) {
  const r = push(_ref(path));
  return set(r, val).then(() => r.key);
}
export function rremove(path) { return remove(_ref(path)); }
export function rwatch(path, cb) {
  const r = _ref(path);
  const handler = onValue(r, s => cb(s.exists() ? s.val() : null));
  return () => off(r, 'value', handler);
}
