import { h } from '../util/dom.js?v=1';
import { state, setState } from '../state/store.js?v=1';
import { navigate } from '../state/router.js?v=1';
import { renderShell } from './shell.js?v=1';
import { loadEcosystem, lastWrite, computeSaldoCajaChica } from '../services/data.js?v=1';
import { runChecks, countBySeverity } from '../services/checks.js?v=1';
import { money, num0, ago, dateMx } from '../util/format.js?v=1';
import { estadoTag } from './_ui.js?v=1';

export async function renderMapa() {
  renderShell(loading('Cargando ecosistema…'));
  let ctx;
  try { ctx = await loadEcosystem(); setState({ ctx }); }
  catch (e) { return renderShell(errorBox(e)); }

  const findings = runChecks(ctx);
  const sev = countBySeverity(findings);

  renderShell([
    h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } }, [
      h('div', {}, [
        h('h1', {}, 'Mapa del ecosistema'),
        h('p', { class: 'subttl' }, `sogrub-suite · ${ctx.buzonList.length} items en buzón · leído ${dateMx(ctx.loadedAt)}`)
      ]),
      h('button', { class: 'btn', onClick: () => renderMapa() }, '↻ Recargar')
    ]),

    // Banner de salud
    h('div', { class: 'card' }, [
      h('h3', {}, 'Salud de interconexión'),
      h('div', { class: 'stat-row' }, [
        statTile(sev.error, 'Errores', 'err'),
        statTile(sev.warn, 'Advertencias', 'warn'),
        statTile(sev.info, 'Informativos', 'info'),
        statTile(findings.length === 0 ? '✓' : findings.length, findings.length === 0 ? 'Todo sano' : 'Hallazgos', findings.length === 0 ? 'ok' : '')
      ]),
      h('div', { style: { marginTop: '12px' } },
        h('button', { class: 'btn primary sm', onClick: () => navigate('/salud') }, 'Ver diagnóstico →'))
    ]),

    // Apps de la suite
    h('h2', {}, 'Apps de la suite'),
    h('div', { class: 'node-grid' }, [
      appCard('📐 Estimaciones', 'ingeniero de campo', lastWrite(Object.values(ctx.obrasCampo)), true),
      appCard('📒 Bitácora', 'contador', lastWrite(ctx.movimientos), true),
      appCard('🛒 Compras', 'órdenes de compra', lastWrite(ctx.oc), true),
      appCard('📦 Materiales', 'almacén · caja chica', lastWrite(Object.values(ctx.cajaChica)), true),
      appCard('🧾 Indirectos', 'pendiente de integrar', null, false)
    ]),

    // Nodos compartidos
    h('h2', {}, 'Nodos del RTDB compartido'),
    h('div', { class: 'node-grid' }, [
      nodeCard('Buzón', '/shared/buzon', ctx.buzonList.length, 'items',
        estadoBreakdown(ctx.buzonList)),
      nodeCard('obraLinks', '/shared/obraLinks', Object.keys(ctx.obraLinks).length, 'vínculos',
        [tagMini('accent', 'obra → proyecto')]),
      nodeCard('Obras (campo)', '/legacy/estimaciones/obras', Object.keys(ctx.obrasCampo).length, 'obras', []),
      nodeCard('Proyectos', 'sogrub_proyectos', ctx.proyectos.length, 'proyectos',
        proyectoBreakdown(ctx.proyectos)),
      nodeCard('Caja chica', '/shared/cajaChica', Object.keys(ctx.cajaChica).length, 'obras',
        [tagMini('', `saldo ${money(totalSaldo(ctx))}`)]),
      nodeCard('Órdenes de compra', '/shared/compras', ctx.oc.length, 'OC',
        ocBreakdown(ctx.oc)),
      nodeCard('Movimientos', 'sogrub_proy_movimientos', ctx.movimientos.length, 'movs', [])
    ]),

    // Buzón en vivo
    h('h2', {}, 'Buzón — actividad reciente'),
    buzonTable(ctx)
  ]);
}

function totalSaldo(ctx) {
  return Object.values(ctx.cajaChica).reduce((s, c) => s + computeSaldoCajaChica(c), 0);
}

function statTile(n, label, kind) {
  return h('div', { class: `stat ${kind}` }, [
    h('div', { class: 'stat-n' }, String(n)),
    h('div', { class: 'stat-l' }, label)
  ]);
}

function appCard(title, sub, lw, live) {
  return h('div', { class: 'node-card app' }, [
    h('div', { class: 'node-title' }, [h('span', { class: `dot ${live ? (lw ? 'ok' : 'warn') : 'off'}` }), title]),
    h('div', { class: 'node-sub' }, sub),
    h('div', { class: 'node-foot' }, live ? (lw ? `último escrito ${ago(lw)}` : 'sin escrituras con timestamp') : 'no integrada')
  ]);
}

function nodeCard(title, path, big, unit, extra) {
  return h('div', { class: 'node-card' }, [
    h('div', { class: 'node-title' }, title),
    h('div', { class: 'node-path' }, path),
    h('div', { class: 'node-big' }, num0(big)),
    h('div', { class: 'node-sub' }, [h('span', { class: 'muted' }, unit), ...extra])
  ]);
}

function tagMini(kind, txt) { return h('span', { class: `tag ${kind}` }, txt); }

function estadoBreakdown(list) {
  const by = {};
  list.forEach(i => { by[i.estado || '—'] = (by[i.estado || '—'] || 0) + 1; });
  return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([e, n]) => estadoTag(e, `${e} ${n}`));
}
function proyectoBreakdown(proyectos) {
  const by = {};
  proyectos.forEach(p => { by[p.estado || '—'] = (by[p.estado || '—'] || 0) + 1; });
  const kind = { activo: 'ok', pausa: 'warn', terminado: 'muted' };
  return Object.entries(by).map(([e, n]) => tagMini(kind[e] || '', `${e} ${n}`));
}
function ocBreakdown(oc) {
  const by = {};
  oc.forEach(o => { by[o.estado || '—'] = (by[o.estado || '—'] || 0) + 1; });
  return Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([e, n]) => tagMini('', `${e} ${n}`));
}

function buzonTable(ctx) {
  const items = [...ctx.buzonList]
    .sort((a, b) => (tsOf(b) - tsOf(a)))
    .slice(0, 12);
  if (!items.length) return h('div', { class: 'empty' }, 'Buzón vacío.');
  return h('table', { class: 'tbl' }, [
    h('thead', {}, h('tr', {}, ['Tipo', 'Obra', 'Origen', 'Estado', 'Folio', 'Actualizado'].map(t => h('th', {}, t)))),
    h('tbody', {}, items.map(i => h('tr', {}, [
      h('td', {}, i.tipo || '—'),
      h('td', {}, i.obraNombre || i.obraId || '—'),
      h('td', { class: 'muted' }, i.origenApp || '—'),
      h('td', {}, estadoTag(i.estado, i.estado || '—')),
      h('td', { class: 'mono' }, i.folio || '—'),
      h('td', { class: 'muted' }, ago(tsOf(i)))
    ])))
  ]);
}
function tsOf(i) {
  return i.actualizadoAt || i.huerfanoAt || i.creadoAt || (i.fecha ? Date.parse(i.fecha) : 0) || 0;
}

function loading(msg) { return h('div', { class: 'empty' }, [h('div', { class: 'ico' }, '⏳'), msg]); }
function errorBox(e) {
  return h('div', { class: 'empty' }, [h('div', { class: 'ico' }, '⚠️'),
    h('div', {}, 'No se pudo leer el RTDB.'), h('div', { class: 'muted', style: { marginTop: '6px' } }, String(e && e.message || e))]);
}
