import { h } from '../util/dom.js?v=20260904-0325';
import { state, setState } from '../state/store.js?v=20260904-0325';
import { navigate } from '../state/router.js?v=20260904-0325';
import { renderShell, cargando } from './shell.js?v=20260904-0325';
import { loadAll } from '../services/crm.js?v=20260904-0325';
import {
  ETAPAS, estaAbierta, montoRef, resumenPipeline, resumenCierres, agruparPor, tiempoPromedioPorEtapa, cierreDef
} from '../services/pipeline.js?v=20260904-0325';
import { money0, moneyCompact, pct, dateShort } from '../util/format.js?v=20260904-0325';
import { kpi, barRow, select } from './_ui.js?v=20260904-0325';

let _ventana = 365;

export async function renderReportes() {
  renderShell(cargando('Calculando…'));
  let data;
  try { data = await loadAll(); setState({ data }); }
  catch (e) { return renderShell(h('div', { class: 'empty' }, String(e?.message || e))); }
  pintar();
}

function pintar() {
  const ops = state.data.oportunidades;
  const desde = _ventana ? Date.now() - _ventana * 86400000 : 0;
  const pipe = resumenPipeline(ops);
  const cie = resumenCierres(ops, desde);
  const cerradasVentana = ops.filter(o => !estaAbierta(o) && (o.cierre?.at || o.updatedAt || 0) >= desde);
  const enVentana = ops.filter(o => (o.createdAt || 0) >= desde || estaAbierta(o) || cerradasVentana.includes(o));

  const head = h('div', { class: 'page-head' }, [
    h('div', {}, [h('h1', {}, 'Reportes'), h('p', { class: 'subttl' }, 'Embudo, conversión y de dónde vienen las obras. Montos sin IVA.')]),
    h('div', { class: 'toolbar' }, [
      select([{ value: 90, label: 'Últimos 90 días' }, { value: 180, label: 'Últimos 6 meses' }, { value: 365, label: 'Últimos 12 meses' }, { value: 0, label: 'Todo' }], _ventana, { onChange: (e) => { _ventana = Number(e.target.value); pintar(); } })
    ])
  ]);

  const kpis = h('div', { class: 'kpi-row' }, [
    kpi({ n: String(pipe.abiertas), label: 'Abiertas hoy', kind: 'accent' }),
    kpi({ n: moneyCompact(pipe.monto), label: 'En pipeline' }),
    kpi({ n: moneyCompact(pipe.ponderado), label: 'Ponderado' }),
    kpi({ n: `${cie.ganadas.n}`, label: 'Ganadas', sub: money0(cie.ganadas.monto), kind: 'ok' }),
    kpi({ n: `${cie.perdidas.n + cie.declinadas.n}`, label: 'Perdidas + declinadas', sub: `${cie.perdidas.n} perdidas · ${cie.declinadas.n} declinadas`, kind: 'danger' }),
    kpi({ n: cie.tasaConversion == null ? '—' : pct(cie.tasaConversion * 100), label: 'Conversión', sub: 'ganadas / decididas' }),
    kpi({ n: cie.tasaVsCliente == null ? '—' : pct(cie.tasaVsCliente * 100), label: 'Vs. cliente', sub: 'ganadas / (ganadas + perdidas)' }),
    kpi({ n: moneyCompact(cie.ticketPromedioGanada), label: 'Ticket promedio', sub: 'obras ganadas' })
  ]);

  // Embudo: abiertas por etapa (ancho proporcional al monto)
  const maxMonto = Math.max(1, ...pipe.porEtapa.map(e => e.monto));
  const embudo = h('div', { class: 'card' }, [
    h('h3', {}, 'Embudo · abiertas por etapa'),
    h('div', { class: 'embudo' }, pipe.porEtapa.map(e => h('div', { class: 'emb-row' }, [
      h('div', { class: 'emb-l' }, e.label),
      h('div', { class: 'emb-wrap' }, h('div', { class: 'emb-bar', style: { width: Math.max(12, Math.round(e.monto / maxMonto * 100)) + '%' } }, `${e.n}`)),
      h('div', { class: 'emb-v' }, [money0(e.monto), h('div', { class: 'muted', style: { fontSize: '10px' } }, `pond. ${moneyCompact(e.ponderado)}`)])
    ])))
  ]);

  const grupoCard = (titulo, grupos, opts = {}) => {
    const max = Math.max(1, ...grupos.map(g => opts.porN ? g.n : g.monto));
    return h('div', { class: 'card' }, [
      h('h3', {}, titulo),
      grupos.length ? h('div', { class: 'bars' }, grupos.map(g => barRow({
        label: g.key, value: opts.porN ? g.n : g.monto, max,
        text: opts.porN ? `${g.n}` : money0(g.monto), n: opts.porN ? '' : `${g.n}`, kind: opts.kind || ''
      }))) : h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Sin datos en la ventana.')
    ]);
  };

  const ganadas = cerradasVentana.filter(o => o.estado === 'ganada');
  const perdidas = cerradasVentana.filter(o => o.estado === 'perdida');
  const declinadas = cerradasVentana.filter(o => o.estado === 'declinada');

  const tiempos = tiempoPromedioPorEtapa(ops);
  const maxT = Math.max(1, ...tiempos.map(t => t.promedio || 0));
  const tiemposCard = h('div', { class: 'card' }, [
    h('h3', {}, 'Días promedio por etapa'),
    h('div', { class: 'bars' }, tiempos.map(t => barRow({ label: t.label, value: t.promedio || 0, max: maxT, text: t.promedio == null ? '—' : `${t.promedio.toFixed(1)} d`, n: t.n ? `${t.n}` : '' , kind: 'muted' }))),
    h('div', { class: 'hint' }, 'Sólo cuenta tramos ya cerrados (la oportunidad pasó a la siguiente etapa o se cerró).')
  ]);

  // Por responsable: ganadas / perdidas / abiertas
  const porResp = agruparPor(enVentana, o => o.responsableNombre);
  const respCard = h('div', { class: 'card' }, [
    h('h3', {}, 'Por responsable'),
    h('table', { class: 'tbl' }, [
      h('thead', {}, h('tr', {}, ['Responsable', 'Abiertas', 'Monto abierto', 'Ganadas', 'Perdidas/decl.', 'Conversión'].map(t => h('th', {}, t)))),
      h('tbody', {}, porResp.map(g => {
        const abiertas = enVentana.filter(o => (o.responsableNombre || '—') === g.key && estaAbierta(o));
        const dec = g.ganadas + g.perdidas;
        return h('tr', {}, [
          h('td', {}, g.key), h('td', { class: 'num' }, String(abiertas.length)),
          h('td', { class: 'num' }, money0(abiertas.reduce((s, o) => s + montoRef(o), 0))),
          h('td', { class: 'num ok' }, String(g.ganadas)), h('td', { class: 'num danger' }, String(g.perdidas)),
          h('td', { class: 'num' }, dec ? pct(g.ganadas / dec * 100) : '—')
        ]);
      }))
    ])
  ]);

  const ultimas = cerradasVentana.sort((a, b) => (b.cierre?.at || 0) - (a.cierre?.at || 0)).slice(0, 15);
  const ultimasCard = h('div', { class: 'card' }, [
    h('h3', {}, 'Últimos cierres'),
    ultimas.length ? h('table', { class: 'tbl' }, [
      h('thead', {}, h('tr', {}, ['Fecha', 'Folio', 'Oportunidad', 'Cliente', 'Resultado', 'Motivo', 'Monto'].map(t => h('th', {}, t)))),
      h('tbody', {}, ultimas.map(o => { const c = cierreDef(o.estado); return h('tr', { class: 'click', onClick: () => navigate('/oportunidad/' + o.id) }, [
        h('td', { class: 'muted' }, dateShort(o.cierre?.fecha || o.cierre?.at)), h('td', { class: 'mono' }, o.folio || ''), h('td', {}, o.nombre), h('td', {}, o.clienteNombre || '—'),
        h('td', {}, h('span', { class: `tag ${c?.kind || ''}` }, c?.label || o.estado)), h('td', { class: 'muted' }, o.cierre?.motivo || ''), h('td', { class: 'num' }, money0(montoRef(o)))
      ]); }))
    ]) : h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Sin cierres en la ventana.')
  ]);

  renderShell([head, kpis, embudo,
    h('div', { class: 'grid-2', style: { marginTop: '14px' } }, [
      grupoCard('Ganadas por fuente', agruparPor(ganadas, o => o.fuente), { kind: 'ok' }),
      grupoCard('Ganadas por tipo de obra', agruparPor(ganadas, o => o.tipoObra), { kind: 'ok' }),
      grupoCard('Motivos de pérdida', agruparPor(perdidas, o => o.cierre?.motivo), { porN: true, kind: 'danger' }),
      grupoCard('Motivos para declinar', agruparPor(declinadas, o => o.cierre?.motivo), { porN: true, kind: 'muted' }),
      grupoCard('Pipeline abierto por fuente', agruparPor(ops.filter(estaAbierta), o => o.fuente)),
      tiemposCard
    ]),
    h('div', { style: { marginTop: '14px' } }, respCard),
    h('div', { style: { marginTop: '14px' } }, ultimasCard)
  ]);
}
