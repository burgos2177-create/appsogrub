// ============================================================================
// Helpers PUROS (sin dependencias de Firebase) de normalización y resolución.
// Separados de data.js para poder testearlos y reusarlos desde checks.js sin
// arrastrar el SDK. data.js los re-exporta para compatibilidad.
// ============================================================================

// RTDB devuelve las colecciones como array (con posibles huecos) o como objeto.
// Normalizamos a array de items con .id.
export function toItemArray(node) {
  if (!node) return [];
  if (Array.isArray(node)) return node.filter(x => x != null);
  if (typeof node === 'object') {
    return Object.entries(node).map(([k, v]) => (
      v && typeof v === 'object' ? { id: v.id != null ? v.id : k, _key: k, ...v } : { id: k, _key: k, value: v }
    ));
  }
  return [];
}

const YEAR_RE = /^(CC|CP)-(\d{4})-(\d+)$/;

export function parseFolio(folio) {
  if (typeof folio !== 'string') return null;
  const m = folio.match(YEAR_RE);
  if (!m) return null;
  return { prefix: m[1], year: m[2], n: parseInt(m[3], 10) };
}

// Saldos conciliados de una caja chica por fondo — réplica de
// appsogrub/js/views/caja-chica.js (_computeSaldoCajaChica). Cada movimiento
// pertenece al fondo 'transferencia' (default, m.fondo ausente) o 'efectivo'.
//   - transferencia: Σ(depósito transferencia aprobado) − Σ(gasto aprobado del
//     fondo). Depósitos "efectivo" sin fondo son informativos (legacy, no cuentan).
//   - efectivo: Σ(depósito aprobado del fondo) − Σ(gasto aprobado del fondo).
//   - Depósitos sin estado se asumen aprobados (legacy); 'solicitado' y
//     'rechazado' no cuentan.
export function computeSaldosCajaChicaPorFondo(cajaObra) {
  const movs = cajaObra && cajaObra.movimientos ? Object.values(cajaObra.movimientos) : [];
  const s = { transferencia: 0, efectivo: 0 };
  for (const m of movs) {
    if (!m) continue;
    const fondo = m.fondo === 'efectivo' ? 'efectivo' : 'transferencia';
    if (m.tipo === 'deposito') {
      if ((m.estado || 'aprobado') !== 'aprobado') continue;
      if (fondo === 'efectivo') s.efectivo += Number(m.monto) || 0;
      else if ((m.metodoDeposito || 'transferencia') === 'transferencia') s.transferencia += Number(m.monto) || 0;
    } else if (m.tipo === 'gasto' && m.estado === 'aprobado') {
      s[fondo] -= Number(m.monto) || 0;
    }
  }
  return s;
}

// Compat: saldo total (suma de ambos fondos). Para detectar fondos en negativo
// usar computeSaldosCajaChicaPorFondo (un fondo negativo puede quedar oculto
// por el otro en la suma).
export function computeSaldoCajaChica(cajaObra) {
  const s = computeSaldosCajaChicaPorFondo(cajaObra);
  return s.transferencia + s.efectivo;
}

// Máximo timestamp hallado entre los hijos de un nodo (para "último escrito").
const TS_FIELDS = ['actualizadoAt', 'updatedAt', 'creadoAt', 'createdAt', 'asentadoAt', 'aprobadoAt', 'huerfanoAt', 'enviadaBuzonAt'];
export function lastWrite(items) {
  let max = 0;
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    for (const f of TS_FIELDS) {
      const v = o[f];
      const t = typeof v === 'number' ? v : Date.parse(v);
      if (Number.isFinite(t) && t > max) max = t;
    }
  };
  (Array.isArray(items) ? items : Object.values(items || {})).forEach(walk);
  return max || null;
}

export function resolveProyectoId(item, obraLinks) {
  return item.proyectoId || (item.obraId && obraLinks[item.obraId]) || null;
}
export function nombreProyecto(proyectosById, pid) {
  const p = pid != null ? proyectosById[String(pid)] : null;
  return p ? (p.nombre || '(sin nombre)') : null;
}
export function nombreObra(obrasCampo, obraId) {
  const o = obraId ? obrasCampo[obraId] : null;
  return (o && o.meta && o.meta.nombre) || null;
}

// Construcción del ctx a partir de nodos crudos del RTDB. Puro → testeable con
// datos sintéticos sin tocar Firebase. loadEcosystem() (data.js) lo alimenta con
// las lecturas reales.
export function buildCtx({ buzonNode, obraLinks, obrasCampoNode, proyectosNode, movsNode, cajaChicaNode, comprasNode, countersNode }) {
  const buzon = buzonNode || {};
  const buzonList = Object.entries(buzon).map(([id, item]) => ({ id, ...(item || {}) }));

  const proyectos = toItemArray(proyectosNode);
  const proyectosById = {};
  proyectos.forEach(p => { if (p.id != null) proyectosById[String(p.id)] = p; });

  const movimientos = toItemArray(movsNode);
  const movById = {};
  movimientos.forEach(m => { if (m.id != null) movById[String(m.id)] = m; });

  const obrasCampo = obrasCampoNode || {};
  const cajaChica = cajaChicaNode || {};

  // Reverse map proyectoId → obraId (primer match, como caja-chica.js:46).
  const links = obraLinks || {};
  const obraByProyecto = {};
  Object.entries(links).forEach(([obraId, pid]) => {
    const key = String(pid);
    if (!(key in obraByProyecto)) obraByProyecto[key] = obraId;
  });

  // Aplanar OC: /shared/compras/obras/{obraId}/oc/{ocId}
  const oc = [];
  Object.entries(comprasNode || {}).forEach(([obraId, obraNode]) => {
    const ocs = (obraNode && obraNode.oc) || {};
    Object.entries(ocs).forEach(([ocId, ocv]) => {
      if (ocv && typeof ocv === 'object') oc.push({ obraId, ocId, ...ocv });
    });
  });

  return {
    buzon, buzonList,
    obraLinks: links, obraByProyecto,
    obrasCampo,
    proyectos, proyectosById,
    movimientos, movById,
    cajaChica,
    oc,
    counters: countersNode || {},
    loadedAt: 0
  };
}
