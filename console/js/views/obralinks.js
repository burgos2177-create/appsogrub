import { h, modal, toast } from '../util/dom.js?v=2';
import { setState } from '../state/store.js?v=1';
import { renderShell } from './shell.js?v=2';
import { loadEcosystem, nombreObra } from '../services/data.js?v=2';
import { crearObraLink, borrarObraLink } from '../services/fixes.js?v=1';

export async function renderObraLinks({ query } = {}) {
  renderShell(h('div', { class: 'empty' }, [h('div', { class: 'ico' }, '⏳'), 'Cargando obras…']));
  let ctx;
  try { ctx = await loadEcosystem(); setState({ ctx }); }
  catch (e) { return renderShell(h('div', { class: 'empty' }, String(e && e.message || e))); }

  const rows = buildUniverse(ctx);

  renderShell([
    h('div', { class: 'row', style: { justifyContent: 'space-between' } }, [
      h('div', {}, [
        h('h1', {}, 'Editor de obraLinks'),
        h('p', { class: 'subttl' }, 'Mapa obra (campo) → proyecto (contable). Es la causa raíz de muchos items de buzón sin ruta.')
      ]),
      h('div', { class: 'row' }, [
        h('button', { class: 'btn', onClick: () => renderObraLinks() }, '↻ Recargar'),
        h('button', { class: 'btn primary', onClick: () => manualAdd(ctx) }, '+ Vincular obra')
      ])
    ]),
    rows.length ? h('table', { class: 'tbl' }, [
      h('thead', {}, h('tr', {}, ['Obra', 'obraId', 'Proyecto vinculado', 'Estado', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, rows.map(r => linkRow(r, ctx)))
    ]) : h('div', { class: 'empty' }, 'No hay obras conocidas todavía.')
  ]);

  // Deep-link: abrir editor de la obra indicada.
  if (query && query.obraId) {
    const r = rows.find(x => x.obraId === query.obraId) || { obraId: query.obraId, nombre: query.obraId, pid: null };
    editLink(r, ctx);
  }
}

// Universo de obras = obras de estimaciones ∪ claves de obraLinks ∪ obraIds vistos en buzón.
function buildUniverse(ctx) {
  const ids = new Set();
  Object.keys(ctx.obrasCampo).forEach(id => ids.add(id));
  Object.keys(ctx.obraLinks).forEach(id => ids.add(id));
  ctx.buzonList.forEach(i => { if (i.obraId) ids.add(i.obraId); });
  const rows = [...ids].map(obraId => {
    const pid = ctx.obraLinks[obraId] != null ? String(ctx.obraLinks[obraId]) : null;
    const nombre = nombreObra(ctx.obrasCampo, obraId)
      || (ctx.buzonList.find(i => i.obraId === obraId && i.obraNombre) || {}).obraNombre
      || '(obra desconocida)';
    return { obraId, pid, nombre };
  });
  // Sin vincular primero, luego alfabético.
  rows.sort((a, b) => (Number(!!a.pid) - Number(!!b.pid)) || a.nombre.localeCompare(b.nombre));
  return rows;
}

function linkRow(r, ctx) {
  const proy = r.pid ? ctx.proyectosById[r.pid] : null;
  const dangling = r.pid && !proy;
  const dupCount = r.pid ? Object.values(ctx.obraLinks).filter(v => String(v) === r.pid).length : 0;
  let estado;
  if (!r.pid) estado = h('span', { class: 'tag warn' }, 'sin vincular');
  else if (dangling) estado = h('span', { class: 'tag danger' }, 'proyecto inexistente');
  else if (dupCount > 1) estado = h('span', { class: 'tag warn' }, `compartido ×${dupCount}`);
  else estado = h('span', { class: 'tag ok' }, 'ok');

  return h('tr', {}, [
    h('td', {}, r.nombre),
    h('td', { class: 'mono muted' }, r.obraId),
    h('td', {}, proy ? proy.nombre : (r.pid ? h('span', { class: 'mono danger' }, r.pid) : h('span', { class: 'muted' }, '—'))),
    h('td', {}, estado),
    h('td', { class: 'txt-r' }, h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, [
      h('button', { class: 'btn sm', onClick: () => editLink(r, ctx) }, 'Editar'),
      r.pid ? h('button', { class: 'btn sm danger', onClick: () => removeLink(r) }, 'Quitar') : null
    ]))
  ]);
}

function proyectoSelect(ctx, selected) {
  const opts = [h('option', { value: '' }, '— elegir proyecto —')];
  [...ctx.proyectos].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
    .forEach(p => opts.push(h('option', { value: String(p.id), selected: String(p.id) === String(selected) },
      `${p.nombre || '(sin nombre)'}${p.estado ? ' · ' + p.estado : ''}`)));
  return h('select', {}, opts);
}

async function editLink(r, ctx) {
  const sel = proyectoSelect(ctx, r.pid);
  const warnBox = h('div', { class: 'f-detail', style: { minHeight: '16px', color: 'var(--warn)' } }, '');
  sel.addEventListener('change', () => {
    const v = sel.value;
    const dup = v && Object.entries(ctx.obraLinks).some(([oid, pid]) => oid !== r.obraId && String(pid) === v);
    warnBox.textContent = dup ? '⚠ Ese proyecto ya está vinculado a otra obra (rompe el reverse-lookup de caja chica).' : '';
  });
  const ok = await modal({
    title: `Vincular: ${r.nombre}`,
    body: h('div', {}, [
      h('div', { class: 'field' }, [h('label', {}, 'obraId'), h('input', { value: r.obraId, disabled: true })]),
      h('div', { class: 'field', style: { marginTop: '12px' } }, [h('label', {}, 'Proyecto contable'), sel]),
      warnBox
    ]),
    confirmLabel: 'Guardar vínculo'
  });
  if (!ok) return;
  if (!sel.value) { toast('Elige un proyecto o usa Quitar.', 'warn'); return; }
  try {
    await crearObraLink(r.obraId, sel.value);
    toast('Vínculo guardado.', 'ok');
    renderObraLinks();
  } catch (e) { toast('Error: ' + (e && e.message || e), 'danger'); }
}

async function removeLink(r) {
  const ok = await modal({
    title: 'Quitar vínculo',
    body: h('div', {}, [
      h('p', {}, `Se eliminará el vínculo de "${r.nombre}".`),
      h('p', { class: 'muted mono', style: { fontSize: '12px' } }, `/shared/obraLinks/${r.obraId}`)
    ]),
    confirmLabel: 'Quitar', danger: true
  });
  if (!ok) return;
  try { await borrarObraLink(r.obraId); toast('Vínculo eliminado.', 'ok'); renderObraLinks(); }
  catch (e) { toast('Error: ' + (e && e.message || e), 'danger'); }
}

async function manualAdd(ctx) {
  const idInput = h('input', { placeholder: 'obraId (clave de campo)' });
  const sel = proyectoSelect(ctx, null);
  const ok = await modal({
    title: 'Vincular obra manual',
    body: h('div', {}, [
      h('div', { class: 'field' }, [h('label', {}, 'obraId'), idInput]),
      h('div', { class: 'field', style: { marginTop: '12px' } }, [h('label', {}, 'Proyecto contable'), sel])
    ]),
    confirmLabel: 'Vincular'
  });
  if (!ok) return;
  const obraId = idInput.value.trim();
  if (!obraId || !sel.value) { toast('Faltan datos.', 'warn'); return; }
  try { await crearObraLink(obraId, sel.value); toast('Vínculo creado.', 'ok'); renderObraLinks(); }
  catch (e) { toast('Error: ' + (e && e.message || e), 'danger'); }
}
