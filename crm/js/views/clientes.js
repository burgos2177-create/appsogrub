import { h, modal, toast } from '../util/dom.js?v=20260904-0310';
import { state, setState } from '../state/store.js?v=20260904-0310';
import { navigate } from '../state/router.js?v=20260904-0310';
import { renderShell, cargando } from './shell.js?v=20260904-0310';
import { esAdmin } from '../services/auth.js?v=20260904-0310';
import { loadAll, crearCliente, actualizarCliente, eliminarCliente } from '../services/crm.js?v=20260904-0310';
import { TIPOS_CLIENTE, estaAbierta, montoRef, normalizarTexto } from '../services/pipeline.js?v=20260904-0310';
import { money0, dateShort } from '../util/format.js?v=20260904-0310';
import { field, select, input, textarea, etapaTag } from './_ui.js?v=20260904-0310';

let _q = '';

export async function renderClientes({ query } = {}) {
  renderShell(cargando('Cargando clientes…'));
  let data;
  try { data = await loadAll(); setState({ data }); }
  catch (e) { return renderShell(h('div', { class: 'empty' }, String(e?.message || e))); }
  pintar(query?.id || null);
}

function pintar(selId) {
  const data = state.data;
  const q = normalizarTexto(_q);
  const opsPorCliente = {};
  for (const o of data.oportunidades) { if (o.clienteId) (opsPorCliente[o.clienteId] ||= []).push(o); }
  const rows = data.clientes.filter(c => !q || normalizarTexto([c.nombre, c.empresa, c.contacto, c.telefono, c.email, c.municipio].join(' ')).includes(q));
  const sel = selId ? data.clientes.find(c => c.id === selId) : null;

  const head = h('div', { class: 'page-head' }, [
    h('div', {}, [h('h1', {}, 'Clientes'), h('p', { class: 'subttl' }, `${data.clientes.length} clientes · particulares, constructoras, desarrolladores, arquitectos`)]),
    h('div', { class: 'toolbar' }, [
      h('input', { type: 'search', placeholder: 'Buscar…', value: _q, onInput: (e) => { _q = e.target.value; pintar(selId); } }),
      h('button', { class: 'btn primary', onClick: () => editar(null) }, '+ Nuevo cliente')
    ])
  ]);

  const tabla = h('table', { class: 'tbl' }, [
    h('thead', {}, h('tr', {}, ['Cliente', 'Tipo', 'Contacto', 'Oportunidades', 'Ganadas', 'Monto abierto', ''].map(t => h('th', {}, t)))),
    h('tbody', {}, rows.map(c => {
      const ops = opsPorCliente[c.id] || [];
      const abiertas = ops.filter(estaAbierta);
      const ganadas = ops.filter(o => o.estado === 'ganada');
      return h('tr', { class: 'click', style: sel?.id === c.id ? { background: 'var(--bg-2)' } : {}, onClick: () => navigate('/clientes?id=' + c.id) }, [
        h('td', {}, [c.nombre, c.empresa ? h('span', { class: 'sub' }, c.empresa) : null]),
        h('td', { class: 'muted' }, TIPOS_CLIENTE.find(t => t.id === c.tipo)?.label || c.tipo || '—'),
        h('td', {}, [c.contacto || '', h('span', { class: 'sub' }, [c.telefono, c.email].filter(Boolean).join(' · '))]),
        h('td', { class: 'num' }, String(ops.length)),
        h('td', { class: 'num ok' }, String(ganadas.length)),
        h('td', { class: 'num' }, money0(abiertas.reduce((s, o) => s + montoRef(o), 0))),
        h('td', {}, h('button', { class: 'btn sm ghost', onClick: (e) => { e.stopPropagation(); editar(c); } }, '✎'))
      ]);
    }))
  ]);

  const ficha = sel ? h('div', { class: 'card' }, [
    h('div', { class: 'card-head' }, [h('h3', {}, sel.nombre), h('div', { class: 'row' }, [
      h('button', { class: 'btn sm', onClick: () => editar(sel) }, '✎ Editar'),
      esAdmin(state.user) && !(opsPorCliente[sel.id] || []).length ? h('button', { class: 'btn sm danger', onClick: async () => { if (await modal({ title: 'Eliminar cliente', body: `¿Eliminar a ${sel.nombre}?`, confirmLabel: 'Eliminar', danger: true })) { await eliminarCliente(sel.id); renderClientes({}); } } }, '🗑') : null,
      h('button', { class: 'btn sm ghost', onClick: () => navigate('/clientes') }, '✕')
    ])]),
    h('div', { class: 'kv' }, [
      h('div', { class: 'k' }, 'Tipo'), h('div', { class: 'v' }, TIPOS_CLIENTE.find(t => t.id === sel.tipo)?.label || '—'),
      h('div', { class: 'k' }, 'Empresa'), h('div', { class: 'v' }, sel.empresa || '—'),
      h('div', { class: 'k' }, 'Contacto'), h('div', { class: 'v' }, [sel.contacto || '—', sel.puesto ? ` (${sel.puesto})` : '']),
      h('div', { class: 'k' }, 'Teléfono'), h('div', { class: 'v' }, sel.telefono ? h('a', { href: 'tel:' + sel.telefono }, sel.telefono) : '—'),
      h('div', { class: 'k' }, 'Correo'), h('div', { class: 'v' }, sel.email ? h('a', { href: 'mailto:' + sel.email }, sel.email) : '—'),
      h('div', { class: 'k' }, 'Ubicación'), h('div', { class: 'v' }, [sel.direccion, sel.municipio].filter(Boolean).join(', ') || '—'),
      h('div', { class: 'k' }, 'RFC'), h('div', { class: 'v' }, sel.rfc || '—'),
      h('div', { class: 'k' }, 'Notas'), h('div', { class: 'v', style: { whiteSpace: 'pre-wrap' } }, sel.notas || '—')
    ]),
    h('h3', { style: { marginTop: '16px' } }, 'Oportunidades'),
    (opsPorCliente[sel.id] || []).length ? h('table', { class: 'tbl' }, [
      h('thead', {}, h('tr', {}, ['Folio', 'Oportunidad', 'Etapa', 'Monto', 'Actualizada'].map(t => h('th', {}, t)))),
      h('tbody', {}, (opsPorCliente[sel.id] || []).map(o => h('tr', { class: 'click', onClick: () => navigate('/oportunidad/' + o.id) }, [
        h('td', { class: 'mono' }, o.folio || ''), h('td', {}, o.nombre), h('td', {}, etapaTag(o)), h('td', { class: 'num' }, money0(montoRef(o))), h('td', { class: 'muted' }, dateShort(o.updatedAt))
      ])))
    ]) : h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Sin oportunidades.')
  ]) : null;

  renderShell([head, ficha, h('div', { class: 'card', style: { marginTop: ficha ? '14px' : 0 } }, rows.length ? tabla : h('div', { class: 'empty' }, 'Sin clientes.'))]);

  async function editar(c) {
    const f = {
      nombre: input({ type: 'text', value: c?.nombre || '', placeholder: 'Persona o razón social' }),
      tipo: select(TIPOS_CLIENTE.map(t => ({ value: t.id, label: t.label })), c?.tipo || 'particular'),
      empresa: input({ type: 'text', value: c?.empresa || '', placeholder: 'Constructora / despacho (si aplica)' }),
      contacto: input({ type: 'text', value: c?.contacto || '' }),
      puesto: input({ type: 'text', value: c?.puesto || '' }),
      telefono: input({ type: 'tel', value: c?.telefono || '' }),
      email: input({ type: 'email', value: c?.email || '' }),
      direccion: input({ type: 'text', value: c?.direccion || '' }),
      municipio: input({ type: 'text', value: c?.municipio || '' }),
      rfc: input({ type: 'text', value: c?.rfc || '' }),
      notas: textarea({ rows: 3 })
    };
    f.notas.value = c?.notas || '';
    const ok = await modal({
      title: c ? 'Editar cliente' : 'Nuevo cliente', size: 'lg',
      body: h('div', {}, [
        h('div', { class: 'grid-2' }, [field('Nombre', f.nombre), field('Tipo', f.tipo)]),
        h('div', { class: 'grid-3', style: { marginTop: '10px' } }, [field('Empresa', f.empresa), field('Contacto', f.contacto), field('Puesto', f.puesto)]),
        h('div', { class: 'grid-3', style: { marginTop: '10px' } }, [field('Teléfono', f.telefono), field('Correo', f.email), field('RFC', f.rfc)]),
        h('div', { class: 'grid-2', style: { marginTop: '10px' } }, [field('Dirección', f.direccion), field('Municipio', f.municipio)]),
        h('div', { style: { marginTop: '10px' } }, field('Notas', f.notas))
      ]),
      confirmLabel: 'Guardar',
      onConfirm: async () => {
        if (!f.nombre.value.trim()) { toast('Escribe el nombre', 'danger'); return false; }
        const d = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim() || null]));
        try {
          if (c) {
            await actualizarCliente(c.id, d);
            // Snapshot del nombre en las oportunidades.
            if (d.nombre !== c.nombre) {
              const { actualizarOportunidad } = await import('../services/crm.js?v=20260904-0310');
              for (const o of state.data.oportunidades.filter(o => o.clienteId === c.id)) await actualizarOportunidad(o.id, { clienteNombre: d.nombre });
            }
          } else await crearCliente(d);
          return true;
        } catch (e) { toast('No se pudo guardar: ' + (e.message || e), 'danger'); return false; }
      }
    });
    if (ok) { toast('Guardado', 'ok'); renderClientes({ query: { id: c?.id } }); }
  }
}
