const listeners = new Set();
export const state = {
  user: null,        // { uid, email, role, displayName }
  ctx: null,         // snapshot agregado del ecosistema (services/data.js#loadEcosystem)
  loading: false
};

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach(fn => fn(state));
}

export function onState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
