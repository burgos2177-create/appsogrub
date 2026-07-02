import { computeSaldoCajaChica, parseFolio, resolveProyectoId, nombreObra } from './data-pure.js?v=1';

// ============================================================================
// Invariantes del ecosistema. Cada check es PURO: recibe el ctx de data.js y
// devuelve Finding[]. Sin efectos secundarios → seguro de re-correr.
//
// Finding = { id, severity:'error'|'warn'|'info', check, title, detail, fix? }
//   fix = { action, label, params }  (interpretado por views/salud.js + fixes.js)
// ============================================================================

const ACTIONABLE = new Set(['recibido', 'pendiente', 'en_revision', 'huerfano']);
const CON_MOV    = new Set(['aprobado', 'cobrado', 'pagado']);

// 1 — obraLinks inválido: valor no-string o proyecto inexistente.
function checkObraLinksValidos(ctx) {
  const out = [];
  for (const [obraId, pid] of Object.entries(ctx.obraLinks)) {
    const nombre = nombreObra(ctx.obrasCampo, obraId) || obraId;
    if (pid == null || (typeof pid !== 'string' && typeof pid !== 'number') || String(pid).trim() === '') {
      out.push({
        id: `link-shape-${obraId}`, severity: 'error', check: 'obraLinks',
        title: `obraLink con valor inválido: ${nombre}`,
        detail: `/shared/obraLinks/${obraId} = ${JSON.stringify(pid)} (se espera el proyectoId como string).`,
        fix: { action: 'linkObra', label: 'Editar link', params: { obraId } }
      });
    } else if (!ctx.proyectosById[String(pid)]) {
      out.push({
        id: `link-dangling-${obraId}`, severity: 'error', check: 'obraLinks',
        title: `obraLink apunta a proyecto inexistente: ${nombre}`,
        detail: `obraId ${obraId} → proyectoId "${pid}", que no existe en sogrub_proyectos.`,
        fix: { action: 'linkObra', label: 'Corregir link', params: { obraId } }
      });
    }
  }
  return out;
}

// 2 — Buzón sin ruta: item con obraId pero sin proyectoId ni entrada en obraLinks.
function checkBuzonRuteable(ctx) {
  const out = [];
  for (const item of ctx.buzonList) {
    if (!item.obraId) continue;
    if (resolveProyectoId(item, ctx.obraLinks)) continue;
    out.push({
      id: `buzon-sinruta-${item.id}`, severity: 'error', check: 'buzon',
      title: `Item de buzón sin proyecto vinculado`,
      detail: `${item.tipo || '—'} · ${item.obraNombre || item.obraId} · estado ${item.estado || '—'}. La obra ${item.obraId} no tiene entrada en /shared/obraLinks.`,
      fix: { action: 'crearObraLink', label: 'Vincular obra', params: { obraId: item.obraId, obraNombre: item.obraNombre } }
    });
  }
  return out;
}

// 3 — origen_buzon_id colgante: movimiento que referencia un item de buzón inexistente.
function checkMovsBuzon(ctx) {
  const out = [];
  for (const m of ctx.movimientos) {
    if (!m.origen_buzon_id) continue;
    if (!ctx.buzon[m.origen_buzon_id]) {
      out.push({
        id: `mov-colgante-${m.id}`, severity: 'error', check: 'buzon',
        title: `Movimiento con origen_buzon_id colgante`,
        detail: `mov ${m.id} (${m.tipo || '—'}, ${m.concepto || ''}) referencia buzón ${m.origen_buzon_id}, que ya no existe.`
      });
    }
  }
  return out;
}

// 4 — Debería ser huérfano: item aprobado/cobrado/pagado con movId inexistente.
function checkDeberiaHuerfano(ctx) {
  const out = [];
  for (const item of ctx.buzonList) {
    if (!CON_MOV.has(item.estado) || !item.movId) continue;
    if (!ctx.movById[String(item.movId)]) {
      out.push({
        id: `buzon-debe-huerfano-${item.id}`, severity: 'error', check: 'buzon',
        title: `Item ${item.estado} apunta a movimiento borrado`,
        detail: `buzón ${item.id} (${item.tipo || '—'}) tiene movId ${item.movId} que no existe en sogrub_proy_movimientos. Debería estar en 'huerfano'.`,
        fix: { action: 'marcarHuerfano', label: 'Marcar huérfano', params: { itemId: item.id } }
      });
    }
  }
  return out;
}

// 5 — Huérfano mal formado: estado huerfano pero con movId o sin sello huerfanoAt.
function checkHuerfanoFormado(ctx) {
  const out = [];
  for (const item of ctx.buzonList) {
    if (item.estado !== 'huerfano') continue;
    const problemas = [];
    if (item.movId != null) problemas.push('movId no es null');
    if (!item.huerfanoAt) problemas.push('falta huerfanoAt');
    if (problemas.length) {
      out.push({
        id: `buzon-huerfano-malformado-${item.id}`, severity: 'warn', check: 'buzon',
        title: `Huérfano mal formado`,
        detail: `buzón ${item.id}: ${problemas.join(', ')}.`,
        fix: { action: 'normalizarHuerfano', label: 'Normalizar', params: { itemId: item.id } }
      });
    }
  }
  return out;
}

// 6 — Espejo caja chica: mov con movimiento_caja_chica_id sin espejo vivo o desalineado.
function checkEspejoCajaChica(ctx) {
  const out = [];
  for (const m of ctx.movimientos) {
    if (!m.movimiento_caja_chica_id) continue;
    const obraId = ctx.obraByProyecto[String(m.proyecto_id)];
    const espejo = obraId && ctx.cajaChica[obraId] && ctx.cajaChica[obraId].movimientos
      ? ctx.cajaChica[obraId].movimientos[m.movimiento_caja_chica_id] : null;
    if (!espejo) {
      out.push({
        id: `cc-sinespejo-${m.id}`, severity: 'warn', check: 'cajaChica',
        title: `Gasto de caja chica sin espejo`,
        detail: `mov ${m.id} referencia caja chica ${m.movimiento_caja_chica_id}${obraId ? ` (obra ${obraId})` : ' (obra no resuelta por obraLinks)'}, que no existe en /shared/cajaChica.`
      });
    } else if (espejo.tipo === 'gasto' && espejo.estado !== 'aprobado') {
      out.push({
        id: `cc-desalineado-${m.id}`, severity: 'warn', check: 'cajaChica',
        title: `Espejo de caja chica desalineado`,
        detail: `mov ${m.id} está asentado pero el espejo (obra ${obraId}) está en '${espejo.estado}' en vez de 'aprobado'.`
      });
    }
  }
  return out;
}

// 7 — Espejo OC: OC aprobada/pagada sin buzonId, o buzonId colgante.
function checkEspejoOC(ctx) {
  const out = [];
  for (const o of ctx.oc) {
    if (['aprobada', 'pagada'].includes(o.estado)) {
      if (!o.buzonId) {
        out.push({
          id: `oc-sinbuzon-${o.obraId}-${o.ocId}`, severity: 'warn', check: 'compras',
          title: `OC ${o.estado} sin vínculo a buzón`,
          detail: `OC ${o.folio || o.ocId} (obra ${o.obraId}) está ${o.estado} pero no tiene buzonId.`
        });
      } else if (!ctx.buzon[o.buzonId]) {
        out.push({
          id: `oc-buzoncolgante-${o.obraId}-${o.ocId}`, severity: 'warn', check: 'compras',
          title: `OC con buzonId colgante`,
          detail: `OC ${o.folio || o.ocId} referencia buzón ${o.buzonId}, que ya no existe.`
        });
      }
    }
  }
  return out;
}

// 8 — Folios: duplicados por año, o counter por debajo del máximo emitido.
function checkFolios(ctx) {
  const out = [];
  const seen = new Map();   // "CC-2026" → { nums:Set, max, dupes:Set }
  const bump = (folio) => {
    const p = parseFolio(folio);
    if (!p) return;
    const k = `${p.prefix}-${p.year}`;
    if (!seen.has(k)) seen.set(k, { prefix: p.prefix, year: p.year, nums: new Set(), max: 0, dupes: new Set() });
    const rec = seen.get(k);
    if (rec.nums.has(p.n)) rec.dupes.add(p.n); else rec.nums.add(p.n);
    if (p.n > rec.max) rec.max = p.n;
  };
  ctx.buzonList.forEach(i => bump(i.folio));
  ctx.movimientos.forEach(m => bump(m.folio));

  const counterKey = { CC: 'cuentas_cobrar', CP: 'cuentas_pagar' };
  for (const rec of seen.values()) {
    if (rec.dupes.size) {
      out.push({
        id: `folio-dup-${rec.prefix}-${rec.year}`, severity: 'warn', check: 'folios',
        title: `Folios ${rec.prefix} duplicados en ${rec.year}`,
        detail: `Números repetidos: ${[...rec.dupes].sort((a, b) => a - b).join(', ')}.`
      });
    }
    const ckey = counterKey[rec.prefix];
    const counterVal = ctx.counters && ctx.counters[ckey] ? Number(ctx.counters[ckey][rec.year]) : null;
    if (Number.isFinite(counterVal) && counterVal < rec.max) {
      out.push({
        id: `folio-counter-${rec.prefix}-${rec.year}`, severity: 'warn', check: 'folios',
        title: `Counter ${rec.prefix} atrasado en ${rec.year}`,
        detail: `_counters/${ckey}/${rec.year} = ${counterVal} pero el folio máximo en uso es ${rec.max}. El próximo folio podría colisionar.`
      });
    }
  }
  return out;
}

// 9 — Caja chica negativa: el almacenista puso de su bolsillo (info).
function checkCajaChicaNegativa(ctx) {
  const out = [];
  for (const [obraId, caja] of Object.entries(ctx.cajaChica)) {
    const saldo = computeSaldoCajaChica(caja);
    if (saldo < -0.005) {
      const nombre = nombreObra(ctx.obrasCampo, obraId) || obraId;
      out.push({
        id: `cc-negativa-${obraId}`, severity: 'info', check: 'cajaChica',
        title: `Caja chica en negativo: ${nombre}`,
        detail: `Saldo conciliado ${saldo.toFixed(2)}. El almacenista está adelantando dinero; se salda con un depósito.`
      });
    }
  }
  return out;
}

// 10 — proyectoId duplicado en obraLinks (rompe reverse-lookup de caja chica).
function checkProyectoDuplicado(ctx) {
  const out = [];
  const byPid = {};
  Object.entries(ctx.obraLinks).forEach(([obraId, pid]) => {
    const k = String(pid);
    (byPid[k] = byPid[k] || []).push(obraId);
  });
  for (const [pid, obras] of Object.entries(byPid)) {
    if (obras.length > 1) {
      out.push({
        id: `link-dup-${pid}`, severity: 'warn', check: 'obraLinks',
        title: `Un proyecto vinculado a ${obras.length} obras`,
        detail: `proyectoId "${pid}" ← obras [${obras.join(', ')}]. El reverse-lookup de caja chica toma sólo la primera.`
      });
    }
  }
  return out;
}

// 11 — Trabajo rezagado: proyecto pausa/terminado con buzón accionable o caja negativa.
function checkTrabajoRezagado(ctx) {
  const out = [];
  for (const p of ctx.proyectos) {
    if (p.estado === 'activo' || !p.id) continue;
    const pid = String(p.id);
    const pendientes = ctx.buzonList.filter(i =>
      String(resolveProyectoId(i, ctx.obraLinks)) === pid && ACTIONABLE.has(i.estado));
    const obraId = ctx.obraByProyecto[pid];
    const saldo = obraId && ctx.cajaChica[obraId] ? computeSaldoCajaChica(ctx.cajaChica[obraId]) : 0;
    if (pendientes.length || saldo < -0.005) {
      const bits = [];
      if (pendientes.length) bits.push(`${pendientes.length} item(s) de buzón accionables`);
      if (saldo < -0.005) bits.push(`caja chica en ${saldo.toFixed(2)}`);
      out.push({
        id: `rezago-${pid}`, severity: 'info', check: 'proyectos',
        title: `Proyecto '${p.estado}' con pendientes: ${p.nombre || pid}`,
        detail: `Aunque el proyecto está ${p.estado}, aún tiene ${bits.join(' y ')}.`
      });
    }
  }
  return out;
}

const CHECKS = [
  checkObraLinksValidos, checkBuzonRuteable, checkMovsBuzon, checkDeberiaHuerfano,
  checkHuerfanoFormado, checkEspejoCajaChica, checkEspejoOC, checkFolios,
  checkCajaChicaNegativa, checkProyectoDuplicado, checkTrabajoRezagado
];

const SEV_ORDER = { error: 0, warn: 1, info: 2 };

// Corre todos los checks sobre el ctx y devuelve findings ordenados por severidad.
export function runChecks(ctx) {
  const findings = [];
  for (const fn of CHECKS) {
    try { findings.push(...fn(ctx)); }
    catch (e) { console.error(`[checks] ${fn.name} falló:`, e); }
  }
  findings.sort((a, b) => (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || a.check.localeCompare(b.check));
  return findings;
}

export function countBySeverity(findings) {
  return findings.reduce((acc, f) => { acc[f.severity] = (acc[f.severity] || 0) + 1; return acc; },
    { error: 0, warn: 0, info: 0 });
}
