// Modal de alta / edición de oportunidad. Se usa desde el tablero y el detalle.
import { h, modal, toast } from '../util/dom.js?v=20260904-0325';
import { state } from '../state/store.js?v=20260904-0325';
import { ETAPAS, PRIORIDADES, TIPOS_CLIENTE, etapaDef } from '../services/pipeline.js?v=20260904-0325';
import { crearOportunidad, actualizarOportunidad, crearCliente } from '../services/crm.js?v=20260904-0325';
import { field, select, input, textarea } from './_ui.js?v=20260904-0325';
import { todayISO, addDaysISO } from '../util/format.js?v=20260904-0325';

// Devuelve el id de la oportunidad creada/editada, o null si se canceló.
export async function abrirFormOportunidad(op = null) {
  const data = state.data;
  const cfg = data.config;
  const me = state.user;

  const nombre  = input({ type: 'text', value: op?.nombre || '', placeholder: 'Ej. Cimentación casa Lomas' });
  const cliSel  = select([{ value: '', label: '— elegir cliente —' }, ...data.clientes.map(c => ({ value: c.id, label: c.nombre + (c.empresa ? ` · ${c.empresa}` : '') })), { value: '__nuevo__', label: '+ Nuevo cliente…' }], op?.clienteId || '');
  const nuevoCli = h('div', { class: 'grid-2 hidden', style: { marginTop: '8px' } }, [
    field('Nombre del cliente', input({ type: 'text', id: 'nc-nombre', placeholder: 'Persona o razón social' })),
    field('Tipo', select(TIPOS_CLIENTE.map(t => ({ value: t.id, label: t.label })), 'particular', { id: 'nc-tipo' })),
    field('Teléfono', input({ type: 'tel', id: 'nc-tel' })),
    field('Correo', input({ type: 'email', id: 'nc-email' }))
  ]);
  cliSel.addEventListener('change', () => nuevoCli.classList.toggle('hidden', cliSel.value !== '__nuevo__'));

  const contacto = input({ type: 'text', value: op?.contacto || '', placeholder: 'Con quién se trata' });
  const telefono = input({ type: 'tel', value: op?.telefono || '' });
  const tipoObra = select(cfg.tiposObra, op?.tipoObra || cfg.tiposObra[0]);
  const fuente   = select(cfg.fuentes, op?.fuente || cfg.fuentes[0]);
  const ubic     = input({ type: 'text', value: op?.ubicacion || '', placeholder: 'Calle, colonia' });
  const muni     = input({ type: 'text', value: op?.municipio || '', placeholder: 'Municipio' });
  const monto    = input({ type: 'number', min: 0, step: 1000, value: op?.montoEstimado ?? '', placeholder: '0' });
  const prio     = select(PRIORIDADES.map(p => ({ value: p.id, label: p.label })), op?.prioridad || 'media');
  const resp     = select(data.usuarios.map(u => ({ value: u.uid, label: u.displayName || u.email })), op?.responsableUid || me.uid);
  const etapa    = select(ETAPAS.map(e => ({ value: e.id, label: e.label })), op?.etapa || 'lead');
  const fCierre  = input({ type: 'date', value: op?.fechaCierreEstimada || (op ? '' : addDaysISO(todayISO(), 30)) });
  const desc     = textarea({ rows: 3, placeholder: 'Alcance a grandes rasgos, qué pidió el cliente, restricciones…' });
  desc.value = op?.descripcion || '';
  const proxF    = input({ type: 'date', value: op?.proximaAccion?.fecha || (op ? '' : addDaysISO(todayISO(), 2)) });
  const proxT    = input({ type: 'text', value: op?.proximaAccion?.texto || '', placeholder: op ? '' : 'Llamar para agendar visita' });

  const body = h('div', {}, [
    field('Nombre de la oportunidad', nombre, 'Como la vas a reconocer en el tablero: tipo de obra + cliente o lugar.'),
    h('div', { class: 'grid-2', style: { marginTop: '12px' } }, [
      field('Cliente', cliSel),
      field('Contacto', contacto)
    ]),
    nuevoCli,
    h('div', { class: 'grid-3', style: { marginTop: '12px' } }, [
      field('Teléfono del contacto', telefono),
      field('Tipo de obra', tipoObra),
      field('Fuente', fuente)
    ]),
    h('div', { class: 'grid-2', style: { marginTop: '12px' } }, [
      field('Ubicación', ubic),
      field('Municipio', muni)
    ]),
    h('div', { class: 'grid-3', style: { marginTop: '12px' } }, [
      field('Monto estimado (sin IVA)', monto, 'Orden de magnitud. El presupuesto formal se captura después.'),
      field('Prioridad', prio),
      field('Responsable', resp)
    ]),
    h('div', { class: 'grid-2', style: { marginTop: '12px' } }, [
      op ? null : field('Etapa inicial', etapa),
      field('Cierre estimado', fCierre)
    ]),
    h('div', { style: { marginTop: '12px' } }, field('Descripción / alcance', desc)),
    h('div', { class: 'grid-2', style: { marginTop: '12px' } }, [
      field('Próxima acción · fecha', proxF),
      field('Próxima acción · qué', proxT)
    ])
  ]);

  let resultId = null;
  await modal({
    title: op ? `Editar ${op.folio || 'oportunidad'}` : 'Nueva oportunidad',
    body, size: 'lg',
    confirmLabel: op ? 'Guardar' : 'Crear',
    onConfirm: async () => {
      if (!nombre.value.trim()) { toast('Escribe el nombre de la oportunidad', 'danger'); return false; }
      let clienteId = cliSel.value, clienteNombre = '';
      if (clienteId === '__nuevo__') {
        const nc = nuevoCli.querySelector('#nc-nombre').value.trim();
        if (!nc) { toast('Escribe el nombre del cliente nuevo', 'danger'); return false; }
        clienteId = await crearCliente({
          nombre: nc, tipo: nuevoCli.querySelector('#nc-tipo').value,
          telefono: nuevoCli.querySelector('#nc-tel').value.trim() || null,
          email: nuevoCli.querySelector('#nc-email').value.trim() || null
        });
        clienteNombre = nc;
      } else if (clienteId) {
        clienteNombre = data.clientes.find(c => c.id === clienteId)?.nombre || '';
      }
      const respU = data.usuarios.find(u => u.uid === resp.value);
      const patch = {
        nombre: nombre.value.trim(),
        clienteId: clienteId || null, clienteNombre: clienteNombre || null,
        contacto: contacto.value.trim() || null, telefono: telefono.value.trim() || null,
        tipoObra: tipoObra.value, fuente: fuente.value,
        ubicacion: ubic.value.trim() || null, municipio: muni.value.trim() || null,
        montoEstimado: Number(monto.value) || 0,
        prioridad: prio.value,
        responsableUid: resp.value || null, responsableNombre: respU ? (respU.displayName || respU.email) : null,
        fechaCierreEstimada: fCierre.value || null,
        descripcion: desc.value.trim() || null,
        proximaAccion: proxF.value ? { fecha: proxF.value, texto: proxT.value.trim() } : null
      };
      try {
        if (op) { await actualizarOportunidad(op.id, patch); resultId = op.id; toast('Guardado', 'ok'); }
        else { resultId = await crearOportunidad({ ...patch, etapa: etapa.value }); toast(`Creada en ${etapaDef(etapa.value).label}`, 'ok'); }
        return true;
      } catch (e) { console.error(e); toast('No se pudo guardar: ' + (e.message || e), 'danger'); return false; }
    }
  });
  return resultId;
}
