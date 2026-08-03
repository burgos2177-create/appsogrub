import { h } from '../util/dom.js?v=2';

// Mapea el estado de un item (buzón / caja chica / OC / proyecto) a una clase
// de color de .tag. Convención del tema: ok=verde, warn=amarillo, danger=rojo.
const ESTADO_KIND = {
  // buzón
  recibido: 'warn', pendiente: 'warn', en_revision: 'warn',
  aprobado: 'ok', cobrado: 'ok', pagado: 'ok', asentado: 'ok', cerrado: 'muted',
  huerfano: 'danger', rechazado: 'danger',
  // caja chica
  reportado: 'warn',
  // OC
  borrador: 'muted', enviada_buzon: 'warn', aprobada: 'ok', pagada: 'ok',
  cerrada: 'muted', cancelada: 'danger', huerfana: 'danger',
  // proyecto
  activo: 'ok', pausa: 'warn', terminado: 'muted'
};

export function estadoKind(estado) { return ESTADO_KIND[estado] || ''; }

export function estadoTag(estado, label) {
  return h('span', { class: `tag ${estadoKind(estado)}` }, label != null ? label : (estado || '—'));
}
