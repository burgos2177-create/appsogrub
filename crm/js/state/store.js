const listeners = new Set();
export const state = {
  user: null,     // { uid, email, role, displayName, crm? }
  data: null,     // { oportunidades, actividades, clientes, config, usuarios } (services/crm.js#loadAll)
  filtros: { responsable: '', tipoObra: '', q: '' }
};

export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach(fn => fn(state));
}
export function onState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
