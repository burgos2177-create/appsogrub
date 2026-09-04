// Capa de datos del CRM. Todo lo del CRM vive bajo /shared/crm/*:
//   oportunidades/{opId}            ficha + etapa + presupuesto + historial
//   actividades/{opId}/{actId}      bitácora de seguimiento (llamadas, visitas, tareas…)
//   clientes/{clienteId}            catálogo de clientes/contactos
//   config                          listas editables + defaults de sobrecostos
//   _counters/oportunidades/{año}   folio OP-AAAA-NNN (transacción, como CC/CP en bitácora)
import { rread, rset, rupdate, rpush, rremove, rwatch, rtransaction, clean } from './db.js?v=20260904-0310';
import { state } from '../state/store.js?v=20260904-0310';
import {
  ETAPAS, etapaDef, cierreDef, estaAbierta, mergeConfig, calcCascada, formatoFolio, normalizarTexto
} from './pipeline.js?v=20260904-0310';

function _autor() {
  const u = state.user || {};
  return { uid: u.uid || null, nombre: u.displayName || u.email || '—' };
}
function _toList(node) {
  return Object.entries(node || {}).map(([id, v]) => ({ id, ...(v || {}) }));
}

// ---------------------------------------------------------------------------
// Carga agregada (una lectura por render; las vistas que quieren vivo usan watch*)
export async function loadAll() {
  const [ops, clientes, config, users] = await Promise.all([
    rread('oportunidades'), rread('clientes'), rread('config'), rread('/legacy/estimaciones/users')
  ]);
  const usuarios = Object.entries(users || {})
    .map(([uid, u]) => ({ uid, ...(u || {}) }))
    .filter(u => u.role === 'admin' || u.role === 'ingeniero' || u.crm === true)
    .sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || ''));
  return {
    oportunidades: _toList(ops).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)),
    clientes: _toList(clientes).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '')),
    config: mergeConfig(config),
    usuarios
  };
}
export function watchOportunidades(cb) { return rwatch('oportunidades', node => cb(_toList(node))); }
export async function getOportunidad(id) {
  const op = await rread(`oportunidades/${id}`);
  return op ? { id, ...op } : null;
}
export async function getActividades(opId) {
  return _toList(await rread(`actividades/${opId}`)).sort((a, b) => (b.at || 0) - (a.at || 0));
}
export function watchActividades(opId, cb) {
  return rwatch(`actividades/${opId}`, node => cb(_toList(node).sort((a, b) => (b.at || 0) - (a.at || 0))));
}
// Todas las actividades de todas las oportunidades (para la agenda).
export async function getTodasActividades() {
  const node = await rread('actividades');
  const out = [];
  for (const [opId, acts] of Object.entries(node || {})) {
    for (const [id, a] of Object.entries(acts || {})) out.push({ id, opId, ...(a || {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Folio atómico
async function _siguienteFolio() {
  const anio = new Date().getFullYear();
  const res = await rtransaction(`_counters/oportunidades/${anio}`, (cur) => (Number(cur) || 0) + 1);
  const n = res.snapshot.val();
  return formatoFolio(anio, n);
}

// ---------------------------------------------------------------------------
// Oportunidades
export async function crearOportunidad(data) {
  const now = Date.now();
  const autor = _autor();
  const folio = await _siguienteFolio();
  const etapa = ETAPAS.some(e => e.id === data.etapa) ? data.etapa : 'lead';
  const op = clean({
    ...data,
    folio, etapa,
    estado: 'abierta',
    etapaDesde: now,
    ultimaActividadAt: now,
    createdAt: now, createdBy: autor, updatedAt: now
  });
  const id = await rpush('oportunidades', op);
  await registrarActividad(id, { tipo: 'sistema', texto: `Oportunidad creada en etapa ${etapaDef(etapa).label} (${folio})` }, { tocaUltima: false });
  return id;
}

export async function actualizarOportunidad(id, patch) {
  return rupdate(`oportunidades/${id}`, { ...patch, updatedAt: Date.now() });
}

export async function eliminarOportunidad(id) {
  await rremove(`actividades/${id}`);
  await rremove(`oportunidades/${id}`);
}

// Mover de etapa. Deja rastro en `historial` y una actividad de sistema; si
// se pasa `nota`, va como actividad aparte del usuario.
export async function moverEtapa(op, nuevaEtapa, nota) {
  if (!ETAPAS.some(e => e.id === nuevaEtapa)) throw new Error('Etapa inválida');
  const now = Date.now();
  const autor = _autor();
  const de = op.etapa || 'lead';
  if (de === nuevaEtapa && estaAbierta(op)) return;
  const patch = { etapa: nuevaEtapa, etapaDesde: now, updatedAt: now, ultimaActividadAt: now };
  if (!estaAbierta(op)) { patch.estado = 'abierta'; patch.cierre = null; }
  await rupdate(`oportunidades/${op.id}`, patch);
  await rpush(`oportunidades/${op.id}/historial`, {
    tipo: estaAbierta(op) ? 'etapa' : 'reapertura', de, a: nuevaEtapa, at: now, por: autor
  });
  const label = `${etapaDef(de).label} → ${etapaDef(nuevaEtapa).label}`;
  await registrarActividad(op.id, { tipo: 'sistema', texto: estaAbierta(op) ? `Movida: ${label}` : `Reabierta en ${etapaDef(nuevaEtapa).label}` }, { tocaUltima: false });
  if (nota) await registrarActividad(op.id, { tipo: 'nota', texto: nota });
}

// Cerrar: ganada / perdida / declinada / pospuesta.
export async function cerrarOportunidad(op, { tipo, motivo, detalle, competidor, fecha }) {
  const def = cierreDef(tipo);
  if (!def) throw new Error('Cierre inválido');
  const now = Date.now();
  const autor = _autor();
  const cierre = clean({ tipo, motivo: motivo || null, detalle: detalle || null, competidor: competidor || null, fecha: fecha || null, at: now, por: autor });
  await rupdate(`oportunidades/${op.id}`, { estado: tipo, cierre, updatedAt: now, ultimaActividadAt: now, proximaAccion: null });
  await rpush(`oportunidades/${op.id}/historial`, { tipo: 'cierre', de: op.etapa || 'lead', a: tipo, at: now, por: autor });
  const txt = `Cerrada como ${def.label}${motivo ? ` · ${motivo}` : ''}${detalle ? ` — ${detalle}` : ''}`;
  await registrarActividad(op.id, { tipo: 'sistema', texto: txt }, { tocaUltima: false });
}

export async function reabrirOportunidad(op, etapa) {
  return moverEtapa({ ...op }, etapa || op.etapa || 'lead');
}

// Guardar el presupuesto (cascada OPUS). Cada guardado con cambios en el
// monto queda como versión de propuesta, para saber qué se le mandó al
// cliente y cuándo.
export async function guardarPresupuesto(op, form, { comoVersion = false, notas = '' } = {}) {
  const c = calcCascada(form);
  const now = Date.now();
  const anterior = op.presupuesto || {};
  const version = comoVersion ? (Number(anterior.version) || 0) + 1 : (Number(anterior.version) || 0);
  const presupuesto = clean({
    ...form,
    subtotal: c.subtotal, iva: c.iva, total: c.total, anticipo: c.anticipo,
    version, actualizadoAt: now
  });
  await rupdate(`oportunidades/${op.id}`, { presupuesto, updatedAt: now, ultimaActividadAt: now });
  if (comoVersion) {
    await rpush(`oportunidades/${op.id}/propuestas`, clean({
      version, fecha: form.fecha || null, vigenciaDias: form.vigenciaDias || null,
      subtotal: c.subtotal, iva: c.iva, total: c.total, anticipo: c.anticipo,
      costo_directo_base: c.costoDirecto, notas: notas || null, archivoUrl: form.archivoUrl || null,
      at: now, por: _autor()
    }));
    await registrarActividad(op.id, { tipo: 'sistema', texto: `Propuesta v${version} registrada · ${_mxn(c.total)} con IVA` }, { tocaUltima: false });
  }
  return presupuesto;
}
function _mxn(n) { return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n || 0); }

// ---------------------------------------------------------------------------
// Actividades (bitácora de seguimiento)
export async function registrarActividad(opId, { tipo, texto, fecha, vence, hecha }, { tocaUltima = true } = {}) {
  const now = Date.now();
  const act = clean({
    tipo: tipo || 'nota', texto: String(texto || '').trim(),
    fecha: fecha || null, vence: vence || null,
    hecha: tipo === 'tarea' ? !!hecha : undefined,
    at: now, por: _autor()
  });
  const id = await rpush(`actividades/${opId}`, act);
  if (tocaUltima) await rupdate(`oportunidades/${opId}`, { ultimaActividadAt: now, updatedAt: now });
  return id;
}
export async function marcarTarea(opId, actId, hecha) {
  return rupdate(`actividades/${opId}/${actId}`, { hecha: !!hecha, hechaAt: hecha ? Date.now() : null });
}
export async function eliminarActividad(opId, actId) {
  return rremove(`actividades/${opId}/${actId}`);
}
export async function setProximaAccion(opId, { fecha, texto }) {
  const now = Date.now();
  return rupdate(`oportunidades/${opId}`, { proximaAccion: fecha ? { fecha, texto: texto || '' } : null, updatedAt: now });
}

// ---------------------------------------------------------------------------
// Clientes. Dedupe por nombre normalizado, mismo criterio que proveedores.
export async function crearCliente(data) {
  const node = await rread('clientes');
  const nom = normalizarTexto(data.nombre);
  for (const [id, c] of Object.entries(node || {})) {
    if (normalizarTexto(c?.nombre) === nom) return id;
  }
  const now = Date.now();
  return rpush('clientes', clean({ ...data, createdAt: now, updatedAt: now, createdBy: _autor() }));
}
export async function actualizarCliente(id, patch) {
  return rupdate(`clientes/${id}`, { ...patch, updatedAt: Date.now() });
}
export async function eliminarCliente(id) { return rremove(`clientes/${id}`); }

// ---------------------------------------------------------------------------
// Config
export async function guardarConfig(config) { return rset('config', clean(config)); }

// ---------------------------------------------------------------------------
// Conversión ganada → proyecto contable en bitácora.
// sogrub_proyectos es un ARREGLO que bitácora escribe completo con .set();
// aquí se agrega con transacción para no pisar una escritura concurrente.
// Campos = los que crea abrirModalProyecto en appsogrub/js/views/proyectos.js;
// `presupuesto_contrato` es SIN IVA (calcContratoDesdeCosto).
export async function convertirEnProyecto(op, { fecha_inicio, nombre } = {}) {
  if (op.proyectoId) return op.proyectoId;
  const p = op.presupuesto || {};
  const c = calcCascada(p);
  const proyectoId = crypto.randomUUID();
  const proyecto = clean({
    id: proyectoId,
    nombre: nombre || op.nombre,
    cliente: op.clienteNombre || '',
    fecha_inicio: fecha_inicio || new Date().toISOString().slice(0, 10),
    estado: 'activo',
    costo_directo_base: c.costoDirecto,
    presupuesto_contrato: c.subtotal,
    sobrecosto_ind_oficina: Number(p.sobrecosto_ind_oficina) || 0,
    sobrecosto_ind_campo: Number(p.sobrecosto_ind_campo) || 0,
    sobrecosto_financiamiento: Number(p.sobrecosto_financiamiento) || 0,
    sobrecosto_utilidad: Number(p.sobrecosto_utilidad) || 0,
    origen_crm_id: op.id,
    origen_crm_folio: op.folio || null
  });
  await rtransaction('/legacy/bitacora/sogrub_proyectos', (cur) => {
    if (cur == null) return [proyecto];
    if (Array.isArray(cur)) {
      if (cur.some(x => x && x.origen_crm_id === op.id)) return; // ya estaba: abortar
      return [...cur, proyecto];
    }
    // Objeto con llaves numéricas (RTDB a veces lo devuelve así si hay huecos)
    const vals = Object.values(cur);
    if (vals.some(x => x && x.origen_crm_id === op.id)) return;
    return { ...cur, [String(vals.length)]: proyecto };
  });
  // Releer por si otra sesión lo convirtió primero.
  const node = await rread('/legacy/bitacora/sogrub_proyectos');
  const lista = Array.isArray(node) ? node : Object.values(node || {});
  const real = lista.find(x => x && x.origen_crm_id === op.id);
  const idFinal = real ? real.id : proyectoId;
  await rupdate(`oportunidades/${op.id}`, { proyectoId: idFinal, proyectoCreadoAt: Date.now(), updatedAt: Date.now() });
  await registrarActividad(op.id, { tipo: 'sistema', texto: `Proyecto creado en bitácora: "${proyecto.nombre}" · contrato ${_mxn(c.subtotal)} sin IVA` }, { tocaUltima: false });
  return idFinal;
}

// Lookup de proyectos de bitácora (para mostrar el vínculo y evitar duplicados)
export async function getProyectosBitacora() {
  const node = await rread('/legacy/bitacora/sogrub_proyectos');
  return (Array.isArray(node) ? node : Object.values(node || {})).filter(Boolean);
}
