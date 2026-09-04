import { h, modal, toast } from '../util/dom.js?v=2';
import { setState } from '../state/store.js?v=1';
import { navigate } from '../state/router.js?v=1';
import { renderShell } from './shell.js?v=1';
import { loadEcosystem, computeSaldoCajaChica, nombreObra } from '../services/data.js?v=2';
import { setEstadoProyecto } from '../services/fixes.js?v=1';
import { money } from '../util/format.js?v=1';
import { estadoTag } from './_ui.js?v=1';

const ESTADOS = ['activo', 'pausa', 'terminado'];
let _soloActivas = false;

export async function renderObras() {
  renderShell(h('div', { class: 'empty' }, [h('div', { class: 'ico' }, '⏳'), 'Cargando proyectos…']));
  let ctx;
  try { ctx = await loadEcosystem(); setState({ ctx }); }
  catch (e) { return renderShell(h('div', { class: 'empty' }, String(e && e.message || e))); }

  const rows = ctx.proyectos
    .map(p => {
      const obraId = ctx.obraByProyecto[String(p.id)] || null;
      const caja = obraId ? ctx.cajaChica[obraId] : null;
      return {
        p, obraId,
        obraNombre: obraId ? (nombreObra(ctx.obrasCampo, obraId) || obraId) : null,
        saldo: caja ? computeSaldoCajaChica(caja) : null
      };
    })
    .sort((a, b) => (a.p.nombre || '').localeCompare(b.p.nombre || ''));

  const visibles = _soloActivas ? rows.filter(r => r.p.estado === 'activo') : rows;
  const sinVincular = Object.keys(ctx.obrasCampo).filter(oid => !ctx.obraLinks[oid]).length;
  const activas = rows.filter(r => r.p.estado === 'activo').length;

  renderShell([
    h('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
      h('div', {}, [
        h('h1', {}, 'Obras activas'),
        h('p', { class: 'subttl' }, `${activas} activas de ${rows.length} proyectos · el estado 'activo' controla la visibilidad en los dashboards`)
      ]),
      h('div', { class: 'row' }, [
        h('label', { class: 'field-inline muted' }, [
          h('input', { type: 'checkbox', checked: _soloActivas, onChange: (e) => { _soloActivas = e.target.checked; renderObras(); } }),
          'Sólo activas'
        ]),
        h('button', { class: 'btn', onClick: () => renderObras() }, '↻ Recargar')
      ])
    ]),

    sinVincular ? h('div', { class: 'card', style: { borderColor: 'rgba(245,196,81,.4)' } }, [
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
        h('span', {}, `⚠ ${sinVincular} obra(s) de campo sin proyecto vinculado.`),
        h('button', { class: 'btn sm', onClick: () => navigate('/obralinks') }, 'Ir a obraLinks →')
      ])
    ]) : null,

    visibles.length ? h('table', { class: 'tbl' }, [
      h('thead', {}, h('tr', {}, ['Proyecto', 'Obra (campo)', 'Saldo caja chica', 'Estado', 'En dashboard', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, visibles.map(r => obraRow(r)))
    ]) : h('div', { class: 'empty' }, 'Sin proyectos que mostrar.')
  ]);
}

function obraRow(r) {
  const enDash = r.p.estado === 'activo';
  const saldoCell = r.saldo == null
    ? h('td', { class: 'num muted' }, '—')
    : h('td', { class: 'num ' + (r.saldo < 0 ? 'danger' : '') }, money(r.saldo));

  const sel = h('select', {}, ESTADOS.map(e => h('option', { value: e, selected: e === r.p.estado }, e)));
  sel.addEventListener('change', () => cambiarEstado(r, sel));

  return h('tr', {}, [
    h('td', {}, r.p.nombre || '(sin nombre)'),
    h('td', { class: 'muted' }, r.obraNombre || h('span', { class: 'tag warn' }, 'sin vincular')),
    saldoCell,
    h('td', {}, estadoTag(r.p.estado)),
    h('td', {}, enDash ? h('span', { class: 'tag ok' }, '✓ visible') : h('span', { class: 'tag muted' }, 'oculto')),
    h('td', { class: 'txt-r' }, sel)
  ]);
}

async function cambiarEstado(r, sel) {
  const nuevo = sel.value;
  if (nuevo === r.p.estado) return;
  const ok = await modal({
    title: 'Cambiar estado del proyecto',
    body: h('div', {}, [
      h('p', {}, [`"${r.p.nombre || r.p.id}" pasará de `, h('b', {}, r.p.estado || '—'), ' a ', h('b', {}, nuevo), '.']),
      nuevo === 'activo'
        ? h('p', { class: 'muted' }, 'Volverá a aparecer en los dashboards de la suite.')
        : h('p', { class: 'muted' }, 'Dejará de aparecer en los dashboards (que filtran por estado=activo).')
    ]),
    confirmLabel: 'Cambiar estado'
  });
  if (!ok) { sel.value = r.p.estado; return; }
  try {
    await setEstadoProyecto(r.p.id, nuevo);
    toast('Estado actualizado.', 'ok');
    renderObras();
  } catch (e) {
    sel.value = r.p.estado;
    toast('Error: ' + (e && e.message || e), 'danger');
  }
}
