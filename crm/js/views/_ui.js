import { h } from '../util/dom.js?v=20260904-0310';
import { etapaDef, cierreDef, PRIORIDADES, estaAbierta } from '../services/pipeline.js?v=20260904-0310';
import { state } from '../state/store.js?v=20260904-0310';

export function etapaTag(op) {
  if (!estaAbierta(op)) {
    const c = cierreDef(op.estado);
    return h('span', { class: `tag ${c?.kind || ''}` }, c?.label || op.estado);
  }
  return h('span', { class: 'tag accent' }, etapaDef(op.etapa).label);
}
export function prioridadTag(prio) {
  const p = PRIORIDADES.find(x => x.id === prio);
  if (!p || p.id === 'baja') return null;
  return h('span', { class: `tag ${p.kind}` }, p.label);
}
export function iniciales(nombre) {
  return String(nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join('') || '?';
}
export function avatar(nombre) {
  return h('span', { class: 'avatar', title: nombre || '' }, iniciales(nombre));
}
export function nombreUsuario(uid) {
  const u = (state.data?.usuarios || []).find(x => x.uid === uid);
  return u ? (u.displayName || u.email) : null;
}

// Campos de formulario reutilizables
export function field(label, input, hint) {
  return h('div', { class: 'field' }, [h('label', {}, label), input, hint ? h('div', { class: 'hint' }, hint) : null]);
}
export function select(opts, value, attrs = {}) {
  return h('select', attrs, opts.map(o => {
    const v = typeof o === 'string' ? o : o.value;
    const l = typeof o === 'string' ? o : o.label;
    return h('option', { value: v, selected: String(v) === String(value ?? '') }, l);
  }));
}
export function input(attrs = {}) { return h('input', attrs); }
export function textarea(attrs = {}) { return h('textarea', attrs); }

export function kpi({ n, label, sub, kind = '', onClick }) {
  return h('div', { class: `kpi ${kind} ${onClick ? 'click' : ''}`, onClick }, [
    h('div', { class: 'kpi-n' }, n),
    h('div', { class: 'kpi-l' }, label),
    sub ? h('div', { class: 'kpi-s' }, sub) : null
  ]);
}

export function barRow({ label, value, max, text, n, kind = '' }) {
  const w = max > 0 ? Math.max(1, Math.round(value / max * 100)) : 0;
  return h('div', { class: 'bar-row' }, [
    h('div', { class: 'bar-l', title: label }, label),
    h('div', { class: 'bar-track' }, h('div', { class: `bar-fill ${kind}`, style: { width: w + '%' } })),
    h('div', { class: 'bar-v' }, text),
    h('div', { class: 'bar-n' }, n != null ? String(n) : '')
  ]);
}
