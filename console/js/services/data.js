import { rread } from './db.js?v=1';
import { buildCtx } from './data-pure.js?v=3';

// Re-export de helpers puros para las vistas (compat).
export {
  toItemArray, parseFolio, computeSaldoCajaChica, lastWrite,
  resolveProyectoId, nombreProyecto, nombreObra, buildCtx
} from './data-pure.js?v=3';

// ============================================================================
// Lecturas agregadas cross-app. Todo se lee con "/"-escape (paths absolutos)
// contra el RTDB compartido sogrub-suite. loadEcosystem() devuelve el `ctx`
// normalizado (buildCtx, en data-pure.js) que consumen las 4 vistas y checks.js.
// ============================================================================

export async function loadEcosystem() {
  const [
    buzonNode, obraLinks, obrasCampoNode, proyectosNode,
    movsNode, cajaChicaNode, comprasNode, countersNode, crmNode
  ] = await Promise.all([
    rread('/shared/buzon'),
    rread('/shared/obraLinks'),
    rread('/legacy/estimaciones/obras'),
    rread('/legacy/bitacora/sogrub_proyectos'),
    rread('/legacy/bitacora/sogrub_proy_movimientos'),
    rread('/shared/cajaChica'),
    rread('/shared/compras/obras'),
    rread('/legacy/bitacora/_counters'),
    rread('/shared/crm')
  ]);

  const ctx = buildCtx({
    buzonNode, obraLinks, obrasCampoNode, proyectosNode,
    movsNode, cajaChicaNode, comprasNode, countersNode, crmNode
  });
  ctx.loadedAt = Date.now();
  return ctx;
}
