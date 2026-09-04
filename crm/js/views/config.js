import { h, toast } from '../util/dom.js?v=20260904-0310';
import { state, setState } from '../state/store.js?v=20260904-0310';
import { navigate } from '../state/router.js?v=20260904-0310';
import { renderShell, cargando } from './shell.js?v=20260904-0310';
import { esAdmin } from '../services/auth.js?v=20260904-0310';
import { loadAll, guardarConfig } from '../services/crm.js?v=20260904-0310';
import { ETAPAS } from '../services/pipeline.js?v=20260904-0310';
import { field, input } from './_ui.js?v=20260904-0310';

export async function renderConfig() {
  if (!esAdmin(state.user)) return navigate('/');
  renderShell(cargando());
  let data;
  try { data = await loadAll(); setState({ data }); }
  catch (e) { return renderShell(h('div', { class: 'empty' }, String(e?.message || e))); }
  const cfg = JSON.parse(JSON.stringify(data.config));

  const lista = (titulo, key, hint) => {
    const chips = h('div', { class: 'chips' });
    const pintarChips = () => chips.replaceChildren(...cfg[key].map((v, i) => h('span', { class: 'chip' }, [v, h('button', { title: 'Quitar', onClick: () => { cfg[key].splice(i, 1); pintarChips(); } }, '×')])));
    pintarChips();
    const nuevo = input({ type: 'text', placeholder: 'Agregar…', style: { maxWidth: '240px' } });
    const add = () => { const v = nuevo.value.trim(); if (v && !cfg[key].includes(v)) { cfg[key].push(v); pintarChips(); } nuevo.value = ''; };
    nuevo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    return h('div', { class: 'card' }, [
      h('h3', {}, titulo), hint ? h('div', { class: 'hint', style: { marginBottom: '8px' } }, hint) : null, chips,
      h('div', { class: 'row', style: { marginTop: '10px' } }, [nuevo, h('button', { class: 'btn sm', onClick: add }, '+ Agregar')])
    ]);
  };

  const num = (label, get, set, attrs = {}) => {
    const el = input({ type: 'number', value: get(), ...attrs });
    el.addEventListener('input', () => set(Number(el.value) || 0));
    return field(label, el);
  };
  const sc = cfg.sobrecostosDefault;
  const defaults = h('div', { class: 'card' }, [
    h('h3', {}, 'Defaults del presupuesto'),
    h('div', { class: 'hint', style: { marginBottom: '10px' } }, 'Con esto se precarga la cascada al capturar un presupuesto nuevo. Se ajusta por oportunidad.'),
    h('div', { class: 'field-row' }, [
      num('Ind. oficina % de CD', () => sc.sobrecosto_ind_oficina, v => sc.sobrecosto_ind_oficina = v, { step: '0.1' }),
      num('Ind. campo % de CD', () => sc.sobrecosto_ind_campo, v => sc.sobrecosto_ind_campo = v, { step: '0.1' }),
      num('Financiamiento %', () => sc.sobrecosto_financiamiento, v => sc.sobrecosto_financiamiento = v, { step: '0.1' }),
      num('Utilidad %', () => sc.sobrecosto_utilidad, v => sc.sobrecosto_utilidad = v, { step: '0.1' }),
      num('IVA %', () => cfg.ivaPct, v => cfg.ivaPct = v, { step: '0.1' }),
      num('Anticipo % default', () => cfg.anticipoPctDefault, v => cfg.anticipoPctDefault = v, { step: '0.1' }),
      num('Vigencia propuesta (días)', () => cfg.vigenciaDiasDefault, v => cfg.vigenciaDiasDefault = v),
      num('Estancada tras N días sin actividad', () => cfg.diasEstancada, v => cfg.diasEstancada = v)
    ])
  ]);

  const etapasCard = h('div', { class: 'card' }, [
    h('h3', {}, 'Etapas del pipeline'),
    h('div', { class: 'hint', style: { marginBottom: '8px' } }, 'Fijas en código (services/pipeline.js) para que los reportes históricos sigan cuadrando. La probabilidad default por etapa es la que pondera el pipeline.'),
    h('table', { class: 'tbl' }, [h('thead', {}, h('tr', {}, ['Etapa', 'Prob.', 'Qué significa'].map(t => h('th', {}, t)))), h('tbody', {}, ETAPAS.map(e => h('tr', {}, [h('td', {}, e.label), h('td', { class: 'num' }, `${e.prob}%`), h('td', { class: 'muted' }, e.desc)])))])
  ]);

  const guardar = h('button', { class: 'btn primary', onClick: async () => {
    try { await guardarConfig(cfg); toast('Configuración guardada', 'ok'); }
    catch (e) { toast('No se pudo guardar: ' + (e.message || e), 'danger'); }
  } }, 'Guardar configuración');

  renderShell([
    h('div', { class: 'page-head' }, [h('div', {}, [h('h1', {}, 'Configuración'), h('p', { class: 'subttl' }, 'Listas y defaults del CRM · /shared/crm/config')]), guardar]),
    defaults,
    h('div', { class: 'grid-2', style: { marginTop: '14px' } }, [
      lista('Fuentes de leads', 'fuentes', 'De dónde llegan las oportunidades. Alimenta el reporte "Ganadas por fuente".'),
      lista('Tipos de obra', 'tiposObra'),
      lista('Motivos de pérdida', 'motivosPerdida', 'Cuando el cliente no nos eligió o el proyecto no procedió.'),
      lista('Motivos para declinar', 'motivosDeclinada', 'Cuando SOGRUB decide no participar.')
    ]),
    h('div', { style: { marginTop: '14px' } }, etapasCard),
    h('div', { class: 'row', style: { marginTop: '14px', justifyContent: 'flex-end' } }, guardar.cloneNode(true))
  ]);
  // El clon no hereda el listener; reenganchar.
  document.querySelectorAll('.page .btn.primary').forEach(b => { if (b !== guardar) b.addEventListener('click', () => guardar.click()); });
}
