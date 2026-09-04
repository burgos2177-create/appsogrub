import { h, toast, modal } from '../util/dom.js?v=20260904-0310';
import { state, setState } from '../state/store.js?v=20260904-0310';
import { navigate } from '../state/router.js?v=20260904-0310';
import { renderShell, cargando } from './shell.js?v=20260904-0310';
import { loadAll, watchOportunidades, moverEtapa } from '../services/crm.js?v=20260904-0310';
import {
  ETAPAS, etapaDef, estaAbierta, montoRef, montoPonderado, probabilidadDe,
  diasEnEtapa, estaEstancada, estadoProximaAccion, resumenPipeline, normalizarTexto, cierreDef
} from '../services/pipeline.js?v=20260904-0310';
import { money0, moneyCompact, todayISO, dateShort, diasHasta } from '../util/format.js?v=20260904-0310';
import { prioridadTag, avatar, kpi, select } from './_ui.js?v=20260904-0310';
import { abrirFormOportunidad } from './_form-oportunidad.js?v=20260904-0310';

let _unwatch = null;
let _verCerradas = false;
let _dragId = null;   // id de la tarjeta en vuelo (dataTransfer no es fiable en todos los navegadores)

export async function renderPipeline() {
  renderShell(cargando('Cargando pipeline…'), { wide: true });
  let data;
  try { data = await loadAll(); setState({ data }); }
  catch (e) { return renderShell(h('div', { class: 'empty' }, String(e?.message || e))); }

  // Vivo: si otro usuario mueve una tarjeta, se refleja sin recargar.
  if (_unwatch) _unwatch();
  _unwatch = watchOportunidades((ops) => {
    if (!location.hash.startsWith('#/') || location.hash.split('?')[0] !== '#/') { _unwatch(); _unwatch = null; return; }
    state.data.oportunidades = ops;
    pintar();
  });
  pintar();
}

function filtrar(ops) {
  const f = state.filtros;
  const q = normalizarTexto(f.q);
  return ops.filter(o => {
    if (f.responsable && o.responsableUid !== f.responsable) return false;
    if (f.tipoObra && o.tipoObra !== f.tipoObra) return false;
    if (q) {
      const hay = normalizarTexto([o.nombre, o.folio, o.clienteNombre, o.contacto, o.municipio, o.ubicacion, o.tipoObra].join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function pintar() {
  const data = state.data;
  const hoy = todayISO();
  const todas = data.oportunidades;
  const visibles = filtrar(todas);
  const abiertas = visibles.filter(estaAbierta);
  const res = resumenPipeline(abiertas);
  const vencidas = abiertas.filter(o => estadoProximaAccion(o, hoy) === 'vencida').length;
  const sinAccion = abiertas.filter(o => !o.proximaAccion?.fecha).length;
  const estancadas = abiertas.filter(o => estaEstancada(o, data.config)).length;

  const head = h('div', { class: 'page-head' }, [
    h('div', {}, [
      h('h1', {}, 'Pipeline comercial'),
      h('p', { class: 'subttl' }, `${res.abiertas} oportunidades abiertas · ${money0(res.monto)} en juego · ${money0(res.ponderado)} ponderado por probabilidad`)
    ]),
    h('div', { class: 'toolbar' }, [
      h('input', { type: 'search', placeholder: 'Buscar folio, cliente, obra…', value: state.filtros.q,
        onInput: (e) => { state.filtros.q = e.target.value; pintar(); } }),
      select([{ value: '', label: 'Todos los responsables' }, ...data.usuarios.map(u => ({ value: u.uid, label: u.displayName || u.email }))], state.filtros.responsable,
        { onChange: (e) => { state.filtros.responsable = e.target.value; pintar(); } }),
      select([{ value: '', label: 'Todo tipo de obra' }, ...data.config.tiposObra], state.filtros.tipoObra,
        { onChange: (e) => { state.filtros.tipoObra = e.target.value; pintar(); } }),
      h('label', { class: 'field-inline muted', style: { fontSize: '12px' } }, [
        h('input', { type: 'checkbox', checked: _verCerradas, onChange: (e) => { _verCerradas = e.target.checked; pintar(); } }), 'Ver cerradas'
      ]),
      h('button', { class: 'btn primary', onClick: async () => { const id = await abrirFormOportunidad(); if (id) navigate('/oportunidad/' + id); } }, '+ Nueva oportunidad')
    ])
  ]);

  const kpis = h('div', { class: 'kpi-row' }, [
    kpi({ n: String(res.abiertas), label: 'Abiertas', kind: 'accent' }),
    kpi({ n: moneyCompact(res.monto), label: 'En pipeline', sub: 'sin IVA' }),
    kpi({ n: moneyCompact(res.ponderado), label: 'Ponderado', sub: 'monto × probabilidad' }),
    kpi({ n: String(vencidas), label: 'Acciones vencidas', kind: vencidas ? 'danger' : 'ok', onClick: () => navigate('/agenda') }),
    kpi({ n: String(sinAccion), label: 'Sin próxima acción', kind: sinAccion ? 'warn' : 'ok' }),
    kpi({ n: String(estancadas), label: 'Estancadas', sub: `> ${data.config.diasEstancada} días sin actividad`, kind: estancadas ? 'warn' : 'ok' })
  ]);

  const board = h('div', { class: 'board' }, ETAPAS.map(e => columna(e, abiertas.filter(o => (o.etapa || 'lead') === e.id), res)));

  const cerradas = visibles.filter(o => !estaAbierta(o)).sort((a, b) => (b.cierre?.at || 0) - (a.cierre?.at || 0));
  const cerradasCard = _verCerradas ? h('div', { class: 'card', style: { marginTop: '14px' } }, [
    h('h3', {}, `Cerradas (${cerradas.length})`),
    cerradas.length ? h('table', { class: 'tbl' }, [
      h('thead', {}, h('tr', {}, ['Folio', 'Oportunidad', 'Cliente', 'Resultado', 'Motivo', 'Monto', 'Fecha'].map(t => h('th', {}, t)))),
      h('tbody', {}, cerradas.slice(0, 100).map(o => {
        const c = cierreDef(o.estado);
        return h('tr', { class: 'click', onClick: () => navigate('/oportunidad/' + o.id) }, [
          h('td', { class: 'mono' }, o.folio || ''),
          h('td', {}, o.nombre),
          h('td', {}, o.clienteNombre || '—'),
          h('td', {}, h('span', { class: `tag ${c?.kind || ''}` }, c?.label || o.estado)),
          h('td', { class: 'muted' }, o.cierre?.motivo || '—'),
          h('td', { class: 'num' }, money0(montoRef(o))),
          h('td', { class: 'muted' }, dateShort(o.cierre?.fecha || o.cierre?.at))
        ]);
      }))
    ]) : h('div', { class: 'muted' }, 'Ninguna cerrada con estos filtros.')
  ]) : null;

  renderShell([head, kpis, board, cerradasCard], { wide: true, badges: { '/agenda': { n: vencidas, kind: 'danger' } } });
}

function columna(etapa, ops, res) {
  const r = res.porEtapa.find(x => x.etapa === etapa.id) || { monto: 0, ponderado: 0 };
  const body = h('div', { class: 'col-body' }, ops.length
    ? ops.sort(ordenTarjetas).map(tarjeta)
    : h('div', { class: 'empty-col' }, 'Arrastra aquí'));
  const col = h('div', { class: 'col', dataset: { etapa: etapa.id } }, [
    h('div', { class: 'col-head', title: etapa.desc }, [
      h('span', { class: 'col-title' }, etapa.label),
      h('span', { class: 'col-n' }, String(ops.length))
    ]),
    h('div', { class: 'col-sub' }, `${money0(r.monto)} · pond. ${moneyCompact(r.ponderado)} · ${etapa.prob}%`),
    body
  ]);
  col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
  col.addEventListener('dragleave', () => col.classList.remove('over'));
  col.addEventListener('drop', async (e) => {
    e.preventDefault(); col.classList.remove('over');
    const opId = _dragId || e.dataTransfer.getData('text/op');
    _dragId = null;
    const op = state.data.oportunidades.find(o => o.id === opId);
    if (!op || (op.etapa || 'lead') === etapa.id) return;
    try { await moverEtapa(op, etapa.id); toast(`${op.folio || op.nombre} → ${etapa.label}`, 'ok'); }
    catch (err) { toast('No se pudo mover: ' + (err.message || err), 'danger'); }
  });
  return col;
}

// Vencidas primero, luego prioridad, luego monto.
function ordenTarjetas(a, b) {
  const hoy = todayISO();
  const rank = (o) => ({ vencida: 0, hoy: 1, proxima: 2 })[estadoProximaAccion(o, hoy)] ?? 3;
  const pr = (o) => ({ alta: 0, media: 1, baja: 2 })[o.prioridad] ?? 1;
  return rank(a) - rank(b) || pr(a) - pr(b) || montoRef(b) - montoRef(a);
}

function tarjeta(op) {
  const hoy = todayISO();
  const pa = estadoProximaAccion(op, hoy);
  const dias = diasEnEtapa(op);
  const estancada = estaEstancada(op, state.data.config);
  const flags = [];
  if (pa === 'vencida') flags.push(h('span', { class: 'tag danger' }, `⚠ ${Math.abs(diasHasta(op.proximaAccion.fecha))} d vencida`));
  else if (pa === 'hoy') flags.push(h('span', { class: 'tag warn' }, 'hoy'));
  else if (pa === 'proxima') flags.push(h('span', { class: 'tag muted' }, `→ ${dateShort(op.proximaAccion.fecha)}`));
  else flags.push(h('span', { class: 'tag muted' }, 'sin próxima acción'));
  if (estancada) flags.push(h('span', { class: 'tag warn' }, 'estancada'));
  const pt = prioridadTag(op.prioridad); if (pt) flags.push(pt);
  if (op.presupuesto?.version) flags.push(h('span', { class: 'tag' }, `propuesta v${op.presupuesto.version}`));

  const card = h('div', {
    class: `op-card prio-${op.prioridad || 'media'} ${estancada ? 'estancada' : ''}`,
    draggable: true,
    onClick: () => navigate('/oportunidad/' + op.id)
  }, [
    h('div', { class: 'op-folio' }, [h('span', {}, op.folio || ''), h('span', {}, op.tipoObra || '')]),
    h('div', { class: 'op-name' }, op.nombre),
    h('div', { class: 'op-cli' }, [op.clienteNombre || '—', op.municipio ? ` · ${op.municipio}` : '']),
    h('div', { class: 'op-flags' }, flags),
    h('div', { class: 'op-foot' }, [
      h('span', { class: 'op-monto' }, money0(montoRef(op))),
      h('span', { title: 'Probabilidad' }, `${probabilidadDe(op)}%`),
      h('span', { title: 'Días en esta etapa' }, `${dias} d`),
      avatar(op.responsableNombre)
    ])
  ]);
  card.addEventListener('dragstart', (e) => { _dragId = op.id; e.dataTransfer.setData('text/op', op.id); e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  return card;
}
