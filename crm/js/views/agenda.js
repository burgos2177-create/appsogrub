import { h, toast } from '../util/dom.js?v=20260904-0310';
import { state, setState } from '../state/store.js?v=20260904-0310';
import { navigate } from '../state/router.js?v=20260904-0310';
import { renderShell, cargando } from './shell.js?v=20260904-0310';
import { loadAll, getTodasActividades, marcarTarea, setProximaAccion } from '../services/crm.js?v=20260904-0310';
import { estaAbierta, estadoProximaAccion, estaEstancada, diasSinActividad, etapaDef, montoRef } from '../services/pipeline.js?v=20260904-0310';
import { todayISO, addDaysISO, dateShort, diasHasta, money0 } from '../util/format.js?v=20260904-0310';
import { kpi, avatar } from './_ui.js?v=20260904-0310';

let _soloMias = false;

export async function renderAgenda() {
  renderShell(cargando('Armando la agenda…'));
  let data, acts;
  try { [data, acts] = await Promise.all([loadAll(), getTodasActividades()]); setState({ data }); }
  catch (e) { return renderShell(h('div', { class: 'empty' }, String(e?.message || e))); }
  pintar(data, acts);
}

function pintar(data, acts) {
  const hoy = todayISO();
  const fin7 = addDaysISO(hoy, 7);
  const me = state.user.uid;
  const byId = Object.fromEntries(data.oportunidades.map(o => [o.id, o]));
  const abiertas = data.oportunidades.filter(estaAbierta).filter(o => !_soloMias || o.responsableUid === me);

  // Items de agenda: próximas acciones de oportunidades abiertas + tareas pendientes.
  const items = [];
  for (const o of abiertas) {
    if (o.proximaAccion?.fecha) items.push({ kind: 'accion', fecha: o.proximaAccion.fecha, texto: o.proximaAccion.texto || 'Próxima acción', op: o });
  }
  for (const a of acts) {
    if (a.tipo !== 'tarea' || a.hecha) continue;
    const o = byId[a.opId];
    if (!o || !estaAbierta(o)) continue;
    if (_soloMias && o.responsableUid !== me && a.por?.uid !== me) continue;
    items.push({ kind: 'tarea', fecha: a.vence || a.fecha || hoy, texto: a.texto, op: o, act: a });
  }
  items.sort((a, b) => a.fecha.localeCompare(b.fecha));

  const grupos = [
    { id: 'vencida', titulo: '⚠ Vencidas', list: items.filter(i => i.fecha < hoy), kind: 'danger' },
    { id: 'hoy', titulo: '📌 Hoy', list: items.filter(i => i.fecha === hoy), kind: 'warn' },
    { id: 'semana', titulo: '📅 Próximos 7 días', list: items.filter(i => i.fecha > hoy && i.fecha <= fin7), kind: '' },
    { id: 'despues', titulo: 'Después', list: items.filter(i => i.fecha > fin7), kind: '' }
  ];
  const sinAccion = abiertas.filter(o => !o.proximaAccion?.fecha);
  const estancadas = abiertas.filter(o => estaEstancada(o, data.config));
  const vencCierre = abiertas.filter(o => o.fechaCierreEstimada && o.fechaCierreEstimada < hoy);

  const head = h('div', { class: 'page-head' }, [
    h('div', {}, [h('h1', {}, 'Agenda de seguimiento'), h('p', { class: 'subttl' }, 'Qué toca hoy, qué se venció y qué oportunidades se están enfriando.')]),
    h('div', { class: 'toolbar' }, [
      h('label', { class: 'field-inline muted', style: { fontSize: '12px' } }, [h('input', { type: 'checkbox', checked: _soloMias, onChange: (e) => { _soloMias = e.target.checked; pintar(data, acts); } }), 'Sólo lo mío']),
      h('button', { class: 'btn', onClick: () => renderAgenda() }, '↻')
    ])
  ]);
  const kpis = h('div', { class: 'kpi-row' }, [
    kpi({ n: String(grupos[0].list.length), label: 'Vencidas', kind: grupos[0].list.length ? 'danger' : 'ok' }),
    kpi({ n: String(grupos[1].list.length), label: 'Para hoy', kind: 'warn' }),
    kpi({ n: String(grupos[2].list.length), label: 'Esta semana' }),
    kpi({ n: String(sinAccion.length), label: 'Sin próxima acción', kind: sinAccion.length ? 'warn' : 'ok' }),
    kpi({ n: String(estancadas.length), label: 'Estancadas', kind: estancadas.length ? 'warn' : 'ok', sub: `> ${data.config.diasEstancada} d sin actividad` })
  ]);

  const secciones = grupos.filter(g => g.list.length || g.id === 'hoy').map(g => h('div', { class: 'agenda-group' }, [
    h('h2', {}, [g.titulo, h('span', { class: `badge ${g.kind}` }, String(g.list.length))]),
    g.list.length ? g.list.map(i => fila(i, g.id === 'vencida' ? 'vencida' : g.id === 'hoy' ? 'hoy' : '')) : h('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '12px' } }, 'Nada para hoy.')
  ]));

  const listaOps = (ops, extra) => ops.length ? ops.map(o => h('div', { class: 'ag-item' }, [
    h('div', { class: 'ag-f' }, extra(o)),
    h('div', {}, [h('div', { class: 'ag-t' }, `${o.folio || ''} · ${o.nombre}`), h('div', { class: 'ag-op' }, `${etapaDef(o.etapa).label} · ${o.clienteNombre || '—'} · ${money0(montoRef(o))} · ${o.responsableNombre || ''}`)]),
    h('button', { class: 'btn sm', onClick: () => navigate('/oportunidad/' + o.id) }, 'Abrir →')
  ])) : h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Ninguna.');

  renderShell([head, kpis, ...secciones,
    h('div', { class: 'agenda-group' }, [h('h2', {}, ['🧊 Estancadas', h('span', { class: 'badge warn' }, String(estancadas.length))]), listaOps(estancadas, o => `${diasSinActividad(o)} d`)]),
    h('div', { class: 'agenda-group' }, [h('h2', {}, ['❓ Sin próxima acción', h('span', { class: 'badge warn' }, String(sinAccion.length))]), listaOps(sinAccion, () => '—')]),
    vencCierre.length ? h('div', { class: 'agenda-group' }, [h('h2', {}, ['⏰ Cierre estimado ya pasó', h('span', { class: 'badge' }, String(vencCierre.length))]), listaOps(vencCierre, o => dateShort(o.fechaCierreEstimada))]) : null
  ], { badges: { '/agenda': { n: grupos[0].list.length, kind: 'danger' } } });

  function fila(i, cls) {
    const o = i.op;
    const d = diasHasta(i.fecha);
    return h('div', { class: `ag-item ${cls}` }, [
      h('div', { class: 'ag-f' }, [dateShort(i.fecha), h('div', { class: 'muted', style: { fontSize: '10px' } }, d < 0 ? `hace ${-d} d` : d === 0 ? 'hoy' : `en ${d} d`)]),
      h('div', {}, [
        h('div', { class: 'ag-t' }, [i.kind === 'tarea' ? '☑️ ' : '→ ', i.texto]),
        h('div', { class: 'ag-op' }, [h('a', { href: '#/oportunidad/' + o.id }, `${o.folio || ''} · ${o.nombre}`), ` · ${etapaDef(o.etapa).label} · ${o.clienteNombre || '—'} · `, avatar(o.responsableNombre)])
      ]),
      h('div', { class: 'row' }, [
        i.kind === 'tarea'
          ? h('button', { class: 'btn sm', onClick: async () => { await marcarTarea(o.id, i.act.id, true); toast('Tarea hecha', 'ok'); renderAgenda(); } }, '✓ Hecha')
          : h('button', { class: 'btn sm', title: 'Marcar hecha y abrir la ficha para definir la siguiente', onClick: async () => { navigate('/oportunidad/' + o.id); } }, 'Atender →'),
        i.kind === 'accion' ? h('button', { class: 'btn sm ghost', title: 'Posponer 2 días', onClick: async () => { await setProximaAccion(o.id, { fecha: addDaysISO(hoy, 2), texto: i.texto }); renderAgenda(); } }, '+2 d') : null
      ])
    ]);
  }
}
