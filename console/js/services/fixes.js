import { rset, rupdate, rread } from './db.js?v=1';
import { state } from '../state/store.js?v=1';

// ============================================================================
// Capa de escritura: arreglos guiados. Cada función hace UN write puntual a un
// path absoluto del RTDB compartido. La confirmación (modal), el toast y el
// recargado los orquestan las vistas — aquí sólo vive la mutación.
// ============================================================================

function _uid() { return state.user?.uid || 'consola'; }

// Crea/repara el vínculo obra→proyecto. Idéntico al writer de estimaciones
// (app-estimaciones/js/services/db.js:435): el valor es el proyectoId string.
export function crearObraLink(obraId, proyectoId) {
  return rset(`/shared/obraLinks/${obraId}`, String(proyectoId));
}

export function borrarObraLink(obraId) {
  return rset(`/shared/obraLinks/${obraId}`, null);
}

// Marca un item de buzón como huérfano (replica _reconciliarBuzon de
// appsogrub/js/views/buzon.js): limpia movId y sella la marca.
export function marcarHuerfano(itemId) {
  return rupdate(`/shared/buzon/${itemId}`, {
    estado: 'huerfano', movId: null,
    huerfanoAt: Date.now(), huerfanoPor: _uid(),
    descripcionHuerfano: 'Marcado desde la consola central',
    actualizadoAt: Date.now()
  });
}

// Normaliza un huérfano mal formado: fuerza movId=null y asegura huerfanoAt.
export async function normalizarHuerfano(itemId) {
  const item = await rread(`/shared/buzon/${itemId}`);
  return rupdate(`/shared/buzon/${itemId}`, {
    movId: null,
    huerfanoAt: item && item.huerfanoAt ? item.huerfanoAt : Date.now(),
    actualizadoAt: Date.now()
  });
}

// Cambia el estado de un proyecto contable (activo/pausa/terminado). Localiza
// la posición dentro del nodo sogrub_proyectos (array u objeto) y reescribe ese
// hijo con el objeto fusionado, preservando la forma del contenedor.
export async function setEstadoProyecto(proyectoId, estado) {
  const node = await rread('/legacy/bitacora/sogrub_proyectos');
  if (!node) throw new Error('No se encontró sogrub_proyectos');
  let childKey = null;
  let current = null;
  if (Array.isArray(node)) {
    const idx = node.findIndex(p => p && String(p.id) === String(proyectoId));
    if (idx >= 0) { childKey = String(idx); current = node[idx]; }
  } else {
    for (const [k, v] of Object.entries(node)) {
      if (v && String(v.id) === String(proyectoId)) { childKey = k; current = v; break; }
    }
  }
  if (childKey == null) throw new Error(`Proyecto ${proyectoId} no encontrado en sogrub_proyectos`);
  return rset(`/legacy/bitacora/sogrub_proyectos/${childKey}`, { ...current, estado });
}

// Despacho por nombre de acción (usado por findings de salud con fix.action).
export const FIX_ACTIONS = {
  crearObraLink:     (p) => crearObraLink(p.obraId, p.proyectoId),
  marcarHuerfano:    (p) => marcarHuerfano(p.itemId),
  normalizarHuerfano:(p) => normalizarHuerfano(p.itemId)
};
