/* =====================================================
   Buzón cross-app — "aduana financiera"

   Máquina de estados:
     recibido → en_revision → aprobado → cobrado/pagado → cerrado
                                        ↘ huerfano (movimiento borrado)
                                        ↗ (reabrir desde cobrado/pagado)
     cualquier estado → rechazado

   Folios: CC-YYYY-NNN (cuentas por cobrar) / CP-YYYY-NNN (cuentas por pagar)
   Datos en /shared/buzon/{itemId}  (path absoluto, sin prefijo legacy)
   ===================================================== */
'use strict';

// ─── Configuración de estados ──────────────────────────────────────────────

const _ESTADOS_CFG = {
  recibido:    { label: 'Recibido',      color: '#e0a04c', bg: 'rgba(224,160,76,0.05)',  accionable: true  },
  en_revision: { label: 'En revisión',   color: '#5b9ef2', bg: 'rgba(91,158,242,0.05)', accionable: true  },
  aprobado:    { label: 'Aprobado',      color: '#5dd39e', bg: 'rgba(93,211,158,0.05)', accionable: false },
  cobrado:     { label: 'Cobrado',       color: '#4db884', bg: 'rgba(77,184,132,0.05)', accionable: false },
  pagado:      { label: 'Pagado',        color: '#4db884', bg: 'rgba(77,184,132,0.05)', accionable: false },
  cerrado:     { label: 'Cerrado',       color: '#666',    bg: 'rgba(102,102,102,0.04)',accionable: false },
  rechazado:   { label: 'Rechazado',     color: '#e15555', bg: 'rgba(225,85,85,0.04)',  accionable: false },
  huerfano:    { label: '⚠ Huérfano',   color: '#a06bd9', bg: 'rgba(160,107,217,0.05)',accionable: true  },
  // compat legacy
  pendiente:   { label: 'Pendiente',     color: '#e0a04c', bg: 'rgba(224,160,76,0.05)', accionable: true  },
};

const _TABS = [
  { key: 'recibido',       label: 'Recibidos',        estados: ['recibido', 'pendiente'], priority: true  },
  { key: 'en_revision',    label: 'En revisión',      estados: ['en_revision'],           priority: true  },
  { key: 'aprobado',       label: 'Aprobados',        estados: ['aprobado'],              priority: false },
  { key: 'cobrado_pagado', label: 'Cobrado / Pagado', estados: ['cobrado', 'pagado'],     priority: false },
  { key: 'cerrado',        label: 'Cerrados',         estados: ['cerrado'],               priority: false },
  { key: 'rechazado',      label: 'Rechazados',       estados: ['rechazado'],             priority: false },
  { key: 'huerfano',       label: 'Huérfanos',        estados: ['huerfano'],              priority: true  },
  { key: 'todos',          label: 'Todos',            estados: null,                      priority: false },
];

// Tipos que NO se muestran en el buzón mientras son un placeholder sin folio
// (p. ej. una requisición de materiales llega en $0 sólo para ir armando el
// movimiento; el contador la debe ver hasta que se materializa en OC/recepción
// con folio). En cuanto tienen folio, se muestran normalmente.
const _TIPOS_OCULTOS_SIN_FOLIO = ['requisicion_materiales'];
function _esItemOculto(it) {
  return _TIPOS_OCULTOS_SIN_FOLIO.includes(it?.tipo) && !it?.folio;
}

// Etiqueta corta por tipo, para el dropdown de filtro (sin variantes por item).
function _tipoLabelCorto(tipo) {
  return {
    pago_cliente: '💰 Pago de cliente',
    estimacion_subcontratista: '🔧 Estim. subcontratista',
    gasto_caja_chica: '🧾 Gasto caja chica',
    deposito_caja_chica: '🏦 Depósito caja chica',
    oc_materiales: '📦 Orden de compra',
    gasto_oc: '📦 Gasto de OC',
    gasto_indirecto: '🏗️ Gasto indirecto',
    carga_social: '🏛️ Carga social',
    requisicion_materiales: '📋 Requisición',
    nomina_operativo_semana: '👷 Nómina operativo',
    nomina_tecnico_campo_quincena: '👷 Nómina técnico campo',
    nomina_tecnico_oficina_quincena: '🧑‍💼 Nómina técnico oficina',
    nomina_directivo_quincena: '🧑‍💼 Nómina directivo',
    orden_cambio: '📐 Orden de cambio',
  }[tipo] || tipo;
}

// ─── Estado del módulo ─────────────────────────────────────────────────────

const _buzon = {
  items:      {},
  obraLinks:  {},        // mapa obraId → proyectoId (cargado de /shared/obraLinks)
  tab:        'recibido',
  expanded:   new Set(),
  subscribed: false,
  linksSubscribed: false,
  migrated:   false,
  filtroTipo: 'todos',   // tipo seleccionado en el dropdown
  filtroModo: 'solo',    // 'solo' = mostrar ese tipo · 'excepto' = todos menos ese
};

// El filtro de tipo sobrevive recargas: el contador suele trabajar varios días
// con la misma vista (p. ej. "todo menos nóminas") y re-elegirlo cada vez
// estorba. Se guarda en localStorage, no en RTDB: es preferencia de vista local.
const _LS_BUZON_FILTRO = 'sogrub_buzon_filtro_tipo';

function _cargarFiltroBuzon() {
  try {
    const raw = localStorage.getItem(_LS_BUZON_FILTRO);
    if (!raw) return;
    const { tipo, modo } = JSON.parse(raw) || {};
    if (typeof tipo === 'string') _buzon.filtroTipo = tipo;
    if (modo === 'solo' || modo === 'excepto') _buzon.filtroModo = modo;
  } catch { /* preferencia corrupta: se ignora y queda el default */ }
}

function _guardarFiltroBuzon() {
  try {
    localStorage.setItem(_LS_BUZON_FILTRO,
      JSON.stringify({ tipo: _buzon.filtroTipo, modo: _buzon.filtroModo }));
  } catch { /* modo privado / cuota llena: el filtro sigue funcionando en memoria */ }
}
_cargarFiltroBuzon();

// Resuelve proyectoId para un item del buzón. Items de estimaciones lo traen
// directo en el payload (item.proyectoId); items de materiales (gasto/depósito
// caja chica) sólo traen obraId, así que hay que cruzar contra /shared/obraLinks.
function _resolverProyectoIdItem(item) {
  return item.proyectoId || (item.obraId && _buzon.obraLinks[item.obraId]) || null;
}

// ─── Suscripción ───────────────────────────────────────────────────────────

function _suscribirBuzon() {
  if (_buzon.subscribed) return;
  _buzon.subscribed = true;
  // /shared/obraLinks: mapa pequeño (un entry por obra). Lo suscribimos una vez
  // y queda en cache para resolver proyectoId de items de caja chica al render.
  if (!_buzon.linksSubscribed) {
    _buzon.linksSubscribed = true;
    _dbRef('/shared/obraLinks').on('value', s => {
      _buzon.obraLinks = s.val() || {};
      _actualizarBadgeBuzon();
      if (typeof _activeView !== 'undefined' && _activeView === 'buzon') {
        renderBuzon();
      }
    }, err => console.warn('[Buzón] obraLinks listener:', err));
  }
  _dbRef('/shared/buzon').on('value', snap => {
    _buzon.items = snap.val() || {};
    if (!_buzon.migrated) {
      _buzon.migrated = true;
      _migrarEstadosLegacy().catch(e => console.warn('[Buzón migrate]', e));
    }
    _reconciliarBuzon().catch(e => console.warn('[Buzón reconcile]', e));
    _actualizarBadgeBuzon();
    if (typeof _activeView !== 'undefined' && _activeView === 'buzon') {
      renderBuzon();
    }
  }, err => console.error('[Buzón] listener:', err));
}

// ─── Migración legacy ──────────────────────────────────────────────────────

// Migra 'pendiente' → 'recibido' una sola vez por sesión.
async function _migrarEstadosLegacy() {
  const updates = {};
  for (const [id, item] of Object.entries(_buzon.items)) {
    if (item?.estado !== 'pendiente') continue;
    const histKey = Date.now() + '_mig_' + id.slice(-4);
    updates[`${id}/estado`] = 'recibido';
    updates[`${id}/estadoHistorial/${histKey}`] = {
      estado: 'recibido', at: Date.now(), por: 'auto-migration',
      nota: 'Migrado de "pendiente" al nuevo esquema'
    };
  }
  if (!Object.keys(updates).length) return;
  console.log(`[Buzón] Migrando ${Object.values(_buzon.items).filter(i => i?.estado === 'pendiente').length} items pendiente→recibido`);
  await _dbRef('/shared/buzon').update(updates);
}

// ─── Reconciliación ────────────────────────────────────────────────────────

// Detecta items aprobados/cobrados/pagados cuyo movimiento fue borrado → huérfano.
async function _reconciliarBuzon() {
  if (!_fbReady) return;
  // El movId puede vivir en sogrub_proy_movimientos (gastos/abonos de proyecto)
  // O en sogrub_movimientos (egresos de Mifel: nómina, carga social, indirecto
  // de empresa, depósito de caja chica). Hay que buscar en AMBAS colecciones,
  // si no, esos items se marcan huérfanos apenas se aprueban.
  const proyMovs = getCollection('sogrub_proy_movimientos');
  const genMovs  = getCollection('sogrub_movimientos');
  if (!Array.isArray(proyMovs) && !Array.isArray(genMovs)) return;
  const movIds = new Set([
    ...(Array.isArray(proyMovs) ? proyMovs : []),
    ...(Array.isArray(genMovs)  ? genMovs  : []),
  ].map(m => m?.id).filter(Boolean));

  const updates = {};
  for (const [itemId, item] of Object.entries(_buzon.items)) {
    if (!['aprobado', 'cobrado', 'pagado'].includes(item?.estado)) continue;
    if (!item.movId || movIds.has(item.movId)) continue;
    const histKey = Date.now() + '_rec_' + itemId.slice(-4);
    updates[`${itemId}/estado`] = 'huerfano';
    updates[`${itemId}/huerfanoAt`] = Date.now();
    updates[`${itemId}/huerfanoPor`] = 'auto-reconcile';
    updates[`${itemId}/descripcionHuerfano`] = 'El movimiento contable fue eliminado externamente.';
    updates[`${itemId}/movId`] = null;
    updates[`${itemId}/estadoHistorial/${histKey}`] = {
      estado: 'huerfano', at: Date.now(), por: 'auto-reconcile',
      nota: 'Movimiento contable eliminado'
    };
  }
  if (Object.keys(updates).length) {
    console.log(`[Buzón] Reconciliados ${Object.keys(updates).length / 7} items → huérfanos`);
    await _dbRef('/shared/buzon').update(updates);
  }
}

// ─── Badge nav ─────────────────────────────────────────────────────────────

function _actualizarBadgeBuzon() {
  const badge = document.getElementById('buzon-badge');
  if (!badge) return;
  // Sólo cuenta trabajo realmente pendiente de aprobar y visible:
  //  · excluye los items ocultos (requisiciones placeholder en $0 sin folio),
  //  · excluye huérfanos (no son "pendiente de aprobar"; tienen su propia pestaña).
  const n = Object.values(_buzon.items).filter(i =>
    !_esItemOculto(i) && ['recibido', 'pendiente', 'en_revision'].includes(i?.estado)
  ).length;
  badge.style.display = n > 0 ? '' : 'none';
  badge.textContent = n;
}

// ─── Render principal ──────────────────────────────────────────────────────

function renderBuzon() {
  _suscribirBuzon();
  const root = document.getElementById('buzon-root');
  if (!root) return;

  const all = Object.entries(_buzon.items)
    .map(([id, it]) => ({ id, ...it }))
    .filter(it => !_esItemOculto(it))
    .sort((a, b) => (b.creadoAt || 0) - (a.creadoAt || 0));

  // Conteos por tab
  const tabCounts = {};
  for (const tab of _TABS) {
    tabCounts[tab.key] = tab.estados
      ? all.filter(i => tab.estados.includes(i.estado)).length
      : all.length;
  }
  const accionables = all.filter(i => _ESTADOS_CFG[i?.estado]?.accionable).length;

  const activeTab = _TABS.find(t => t.key === _buzon.tab) || _TABS[0];
  let filtered = activeTab.estados
    ? all.filter(i => activeTab.estados.includes(i.estado))
    : all;

  // Filtro por tipo (dropdown), independiente de la pestaña de estado.
  // El modo decide si el tipo elegido se muestra o se esconde:
  //   'solo'    → únicamente ese tipo
  //   'excepto' → todos los demás (útil para sacar de la vista lo ya revisado,
  //               p. ej. ver todo el buzón menos las nóminas)
  if (!_buzon.filtroTipo) _buzon.filtroTipo = 'todos';
  if (_buzon.filtroModo !== 'excepto') _buzon.filtroModo = 'solo';
  const excluyendo = _buzon.filtroTipo !== 'todos' && _buzon.filtroModo === 'excepto';
  // Tipos presentes en los items visibles (para poblar el dropdown).
  const tiposPresentes = [...new Set(all.map(i => i.tipo).filter(Boolean))].sort();
  // Si el tipo guardado ya no existe en el buzón, el filtro se vuelve inerte
  // en vez de dejar la vista vacía sin explicación.
  const tipoVigente = _buzon.filtroTipo !== 'todos' && tiposPresentes.includes(_buzon.filtroTipo);
  if (tipoVigente) {
    filtered = excluyendo
      ? filtered.filter(i => i.tipo !== _buzon.filtroTipo)
      : filtered.filter(i => i.tipo === _buzon.filtroTipo);
  }

  root.innerHTML = '';

  // ── Header + tabs ──
  const header = document.createElement('div');
  header.style.cssText = 'margin-bottom:16px';
  const stats = _calcularResumenFinanciero(_buzon.items);

  header.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <h2 style="margin:0">Buzón de aprobaciones</h2>
      ${accionables > 0
        ? `<span style="font-size:12px;color:#e0a04c">Requieren acción: <b>${accionables}</b></span>`
        : `<span style="font-size:12px;color:var(--text-muted)">Total: ${all.length}</span>`}
    </div>
    ${_resumenFinancieroHTML(stats)}
    <details style="margin-bottom:10px;font-size:12px;color:var(--text-muted)">
      <summary style="cursor:pointer;padding:4px 0">📊 Los 3 momentos contables — qué significa cada estado</summary>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;padding:10px 12px;margin-top:6px;background:rgba(0,0,0,.15);border-radius:6px;line-height:1.45">
        <div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="width:18px;height:18px;border-radius:50%;background:#e0a04c;color:#08121a;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">1</span>
            <b style="color:#e0a04c">Devengado</b>
          </div>
          <span>El trabajo <b>ya se generó</b> (estimación cobrada al cliente, sub entregó). Nace la obligación, pero todavía no se reconoce contablemente. Estados: <em>Recibido, En revisión</em>.</span>
        </div>
        <div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="width:18px;height:18px;border-radius:50%;background:#5dd39e;color:#08121a;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">2</span>
            <b style="color:#5dd39e">Por cobrar / Por pagar</b>
          </div>
          <span>El contador <b>valida el compromiso</b>. Queda como cuenta por cobrar (CxC) o por pagar (CxP) con folio. El movimiento existe en libros con status <em>Pendiente</em>. Estado: <em>Aprobado</em>.</span>
        </div>
        <div>
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
            <span style="width:18px;height:18px;border-radius:50%;background:#4db884;color:#08121a;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">3</span>
            <b style="color:#4db884">Cobrado / Pagado</b>
          </div>
          <span>El <b>dinero efectivamente</b> entró o salió de caja. Movimiento con status <em>Pagado</em> + fecha + método. Estados: <em>Cobrado, Pagado, Cerrado</em>.</span>
        </div>
      </div>
    </details>
    <div style="display:flex;gap:0;flex-wrap:wrap;border-bottom:1px solid var(--border)">
      ${_TABS.map(tab => {
        const cnt   = tabCounts[tab.key] || 0;
        const active = tab.key === _buzon.tab;
        const urgent = tab.priority && cnt > 0;
        return `<button class="bz-tab" data-tab="${tab.key}" style="
          padding:8px 14px;border:none;border-bottom:${active ? '2px solid var(--accent)' : '2px solid transparent'};
          background:transparent;cursor:pointer;font-size:13px;white-space:nowrap;
          color:${active ? 'var(--accent)' : urgent ? '#e0a04c' : 'var(--text-muted)'};
          font-weight:${active ? 600 : 400}">
          ${tab.label}${cnt > 0 ? ` <small style="opacity:.75">(${cnt})</small>` : ''}
        </button>`;
      }).join('')}
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap">
      <label style="font-size:12px;color:var(--text-muted)">Filtrar por tipo:</label>
      <select id="bz-filtro-tipo" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg,var(--surface));color:var(--text);font-size:12px">
        <option value="todos" ${_buzon.filtroTipo === 'todos' ? 'selected' : ''}>Todos los tipos (${tabCounts[activeTab.key] ?? all.length})</option>
        ${tiposPresentes.map(t => `<option value="${t}" ${_buzon.filtroTipo === t ? 'selected' : ''}>${_tipoLabelCorto(t)}</option>`).join('')}
      </select>
      ${_buzon.filtroTipo !== 'todos' ? `
        <div style="display:inline-flex;border:1px solid var(--border);border-radius:6px;overflow:hidden" role="group"
             title="Solo: muestra únicamente ese tipo · Excepto: muestra todos los demás">
          ${['solo', 'excepto'].map(modo => {
            const activo = _buzon.filtroModo === modo;
            return `<button class="bz-filtro-modo" data-modo="${modo}" style="
              padding:5px 12px;border:none;cursor:pointer;font-size:12px;white-space:nowrap;
              background:${activo ? 'var(--accent)' : 'transparent'};
              color:${activo ? '#08121a' : 'var(--text-muted)'};
              font-weight:${activo ? 600 : 400}">
              ${modo === 'solo' ? 'Solo este' : 'Todos menos este'}
            </button>`;
          }).join('')}
        </div>
        <button id="bz-filtro-clear" style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text-muted);font-size:12px;cursor:pointer">✕ Limpiar</button>
        <span style="font-size:11px;color:var(--text-muted)">
          ${!tipoVigente
            ? `⚠ No hay items de <b>${_tipoLabelCorto(_buzon.filtroTipo)}</b> en el buzón — filtro sin efecto.`
            : excluyendo
              ? `Ocultando <b>${_tipoLabelCorto(_buzon.filtroTipo)}</b> · ${filtered.length} visibles`
              : `${filtered.length} visibles`}
          · el filtro se recuerda
        </span>
      ` : ''}
    </div>`;
  root.appendChild(header);
  header.querySelectorAll('.bz-tab').forEach(b =>
    b.addEventListener('click', () => { _buzon.tab = b.dataset.tab; renderBuzon(); })
  );
  header.querySelector('#bz-filtro-tipo')?.addEventListener('change', (e) => {
    _buzon.filtroTipo = e.target.value;
    _guardarFiltroBuzon(); renderBuzon();
  });
  header.querySelectorAll('.bz-filtro-modo').forEach(b =>
    b.addEventListener('click', () => {
      _buzon.filtroModo = b.dataset.modo;
      _guardarFiltroBuzon(); renderBuzon();
    })
  );
  header.querySelector('#bz-filtro-clear')?.addEventListener('click', () => {
    _buzon.filtroTipo = 'todos'; _buzon.filtroModo = 'solo';
    _guardarFiltroBuzon(); renderBuzon();
  });

  // ── Empty ──
  if (!filtered.length) {
    const msgs = {
      recibido: 'No hay solicitudes nuevas.',
      en_revision: 'No hay items en revisión.',
      aprobado: 'No hay movimientos pendientes de cobro/pago.',
      cobrado_pagado: 'Sin items cobrados o pagados.',
      cerrado: 'Sin items cerrados.',
      rechazado: 'Sin items rechazados.',
      huerfano: 'Sin items huérfanos.',
      todos: 'El buzón está vacío.',
    };
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;padding:60px 20px;color:var(--text-muted);border:1px dashed var(--border);border-radius:8px;margin-top:12px';
    // Si hay un filtro de tipo puesto, decirlo: si no, parece que la pestaña
    // está vacía cuando en realidad el filtro (que persiste entre sesiones)
    // se está comiendo los items.
    empty.innerHTML = tipoVigente
      ? `<div style="font-size:32px;opacity:.5;margin-bottom:8px">🔍</div>
         <div>Nada que mostrar con el filtro <b>${excluyendo ? 'Todos menos' : 'Solo'} ${_tipoLabelCorto(_buzon.filtroTipo)}</b>.</div>
         <button id="bz-empty-clear" style="margin-top:12px;padding:6px 14px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--accent);font-size:12px;cursor:pointer">✕ Quitar filtro</button>`
      : `<div style="font-size:32px;opacity:.5;margin-bottom:8px">📥</div><div>${msgs[_buzon.tab] || 'Sin items.'}</div>`;
    root.appendChild(empty);
    empty.querySelector('#bz-empty-clear')?.addEventListener('click', () => {
      _buzon.filtroTipo = 'todos'; _buzon.filtroModo = 'solo';
      _guardarFiltroBuzon(); renderBuzon();
    });
    return;
  }

  // ── Lista ──
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:12px';
  for (const item of filtered) list.appendChild(_buzonCard(item));
  root.appendChild(list);
}

// ─── Card ──────────────────────────────────────────────────────────────────

function _buzonCard(item) {
  const card = document.createElement('div');
  const ecfg     = _ESTADOS_CFG[item.estado] || _ESTADOS_CFG.recibido;
  const expanded  = _buzon.expanded.has(item.id);
  const esSub     = item.tipo === 'estimacion_subcontratista';
  const esOC      = item.tipo === 'oc_materiales';
  const esGastoOC = item.tipo === 'gasto_oc';
  // Caja chica usa monto plano (number); CxC/CxP usan { subtotal, iva, importe }.
  // OC y gasto_oc traen total plano.
  const esCajaChica = item.tipo === 'gasto_caja_chica' || item.tipo === 'deposito_caja_chica';
  // La OC trae su neto CON IVA y con signo propio: puede ser negativa (deductiva).
  const esOrdenCambio = item.tipo === 'orden_cambio';
  const monto     = esOrdenCambio
    ? Math.abs(Number(item.netoCIVA) || 0)
    : (esOC || esGastoOC)
    ? Number(item.total ?? item.monto) || 0
    : (esCajaChica
      ? Number(item.monto) || 0
      : (item?.monto?.importe || 0));
  const fechaPago = item.fecha
    ? new Date(item.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    : (item.fechaEmision
      ? new Date(item.fechaEmision).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—');
  const tipoLabel = {
    pago_cliente: '💰 Pago de cliente',
    estimacion_subcontratista: '🔧 Estim. subcontratista',
    gasto_caja_chica: item.fondo === 'efectivo' ? '🧾 Gasto caja chica · 💵 efectivo' : '🧾 Gasto caja chica',
    deposito_caja_chica: item.fondo === 'efectivo' ? '💵 Depósito caja chica (efectivo)' : '🏦 Depósito caja chica',
    oc_materiales: item.claseCompra === 'servicio' ? '🧰 Orden de compra (servicio)' : '📦 Orden de compra (materiales)',
    gasto_oc: '📦 Gasto de OC (materiales)',
    carga_social: '🏛️ Carga social (IMSS/Infonavit)',
    gasto_indirecto: item.empresa || !item.obraId ? '🏗️ Indirecto (empresa)' : '🏗️ Gasto indirecto',
    nomina_operativo_semana: '👷 Nómina operativo (semanal)',
    nomina_tecnico_campo_quincena: '👷 Nómina técnico campo (quincenal)',
    nomina_tecnico_oficina_quincena: '🧑‍💼 Nómina técnico oficina (quincenal)',
    nomina_directivo_quincena: '🧑‍💼 Nómina directivo (quincenal)',
    orden_cambio: '📐 Orden de cambio (contrato)'
  }[item.tipo] || item.tipo;
  const desfase   = _calcularDesfase(item);

  card.style.cssText = `border:1px solid var(--border);border-left:4px solid ${ecfg.color};background:${ecfg.bg};border-radius:8px;overflow:hidden`;

  // ── Cabecera (siempre visible, clickable) ──
  const hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;user-select:none';
  hdr.innerHTML = `
    <span style="background:${ecfg.color};color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;text-transform:uppercase;letter-spacing:.4px;font-weight:600;flex-shrink:0">${ecfg.label}</span>
    ${item.folio ? `<code style="font-size:11px;color:var(--text-muted);background:var(--surface);padding:1px 5px;border-radius:4px;flex-shrink:0">${item.folio}</code>` : ''}
    <div style="flex:1;min-width:0;overflow:hidden">
      <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.descripcion || item.concepto || (esOC ? `OC para ${item.proveedor?.nombre || '(sin proveedor)'}` : '—')}</div>
      <div style="font-size:11px;color:var(--text-muted)">${tipoLabel} · ${item.obraNombre || item.obraId || '—'} · ${fechaPago}</div>
    </div>
    ${desfase ? `<span title="${desfase.tooltip}" style="font-size:11px;color:#e0a04c;background:rgba(224,160,76,.12);padding:2px 7px;border-radius:8px;flex-shrink:0">⚠ Δ$${Math.abs(desfase.delta).toLocaleString('es-MX', {minimumFractionDigits:2})}</span>` : ''}
    <div style="text-align:right;flex-shrink:0">
      <div style="font-family:ui-monospace,monospace;font-size:17px;font-weight:700;color:${esOrdenCambio ? ((Number(item.netoCIVA) || 0) >= 0 ? '#4caf82' : '#e0a04c') : (esSub || esOC || item.tipo === 'gasto_caja_chica' || item.tipo === 'gasto_indirecto' || item.tipo === 'gasto_oc' || item.tipo === 'carga_social' || (item.tipo && item.tipo.startsWith('nomina_'))) ? '#e15555' : 'var(--accent)'}">
        ${esOrdenCambio ? ((Number(item.netoCIVA) || 0) >= 0 ? '+' : '−') : (esSub || esOC || item.tipo === 'gasto_caja_chica' || item.tipo === 'gasto_indirecto' || item.tipo === 'gasto_oc' || item.tipo === 'carga_social' || (item.tipo && item.tipo.startsWith('nomina_'))) ? '−' : '+'}$${monto.toLocaleString('es-MX', {minimumFractionDigits:2, maximumFractionDigits:2})}
      </div>
    </div>
    <span style="color:var(--text-muted);font-size:14px;flex-shrink:0">${expanded ? '▲' : '▼'}</span>`;

  hdr.addEventListener('click', () => {
    if (_buzon.expanded.has(item.id)) {
      _buzon.expanded.delete(item.id);
    } else {
      _buzon.expanded.add(item.id);
      // Auto-transition recibido → en_revision + cambiar tab
      if (item.estado === 'recibido' || item.estado === 'pendiente') {
        if (_buzon.items[item.id]) _buzon.items[item.id].estado = 'en_revision'; // optimista
        _marcarEnRevision(item).catch(e => console.warn('[Buzón] en_revision:', e));
        _buzon.tab = 'en_revision';
      }
    }
    renderBuzon();
  });
  card.appendChild(hdr);

  // ── Cuerpo (solo cuando expandido) ──
  if (expanded) {
    const body = document.createElement('div');
    body.style.cssText = 'padding:0 14px 14px;border-top:1px solid var(--border)';
    body.innerHTML = _cardBodyHTML(item);
    _attachAcciones(body, item);
    card.appendChild(body);
  }

  return card;
}

// RFC del proveedor de un item del buzón. Primero intenta del propio item;
// si no lo trae, lo busca por nombre en el catálogo de proveedores.
// Devuelve '' si no se encuentra.
function _rfcProveedorBuzon(nombre, item) {
  const directo = item?.proveedorRfc || item?.proveedor?.rfc || item?.rfc;
  if (directo) return String(directo).trim();
  const n = (nombre || '').trim().toLowerCase();
  if (!n) return '';
  const prov = (getCollection(KEYS.PROVEEDORES) || []).find(p => (p?.nombre || '').trim().toLowerCase() === n);
  return (prov?.rfc || '').trim();
}

// Detalle de una orden de cambio. Es informativo: se muestra el impacto que
// reporta el item, pero el presupuesto vigente NO sale de aquí — sale del
// acumulado de /shared/contratos (ver _aprobarOrdenCambio).
function _cardBodyOrdenCambio(item) {
  const n = v => Number(v) || 0;
  const M = v => `$${Math.abs(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const neto = n(item.netoCIVA);
  const col  = neto >= 0 ? '#4caf82' : '#e0a04c';
  const fila = (etiqueta, valor, color) => `
    <div style="display:flex;justify-content:space-between;gap:16px;padding:2px 0">
      <span style="color:var(--text-muted)">${etiqueta}</span>
      <strong style="font-variant-numeric:tabular-nums${color ? `;color:${color}` : ''}">${valor}</strong>
    </div>`;

  const rubros = item.impactoRubros || {};
  const filasRubros = Object.entries(rubros)
    .filter(([, v]) => Math.abs(n(v)) > 0.005)
    .map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:12px">
        <span>${k}</span>
        <span style="font-variant-numeric:tabular-nums;color:${n(v) >= 0 ? '#4caf82' : '#e0a04c'}">${n(v) >= 0 ? '+' : '−'}${M(n(v))}</span>
      </div>`).join('');

  return `
    <div style="padding-top:12px;display:flex;flex-direction:column;gap:12px;font-size:13px">
      <div style="padding:10px 12px;background:var(--surface);border-radius:6px">
        <div style="font-weight:600;margin-bottom:6px">OC #${item.ocNumero ?? '—'} · ${item.obraNombre || item.obraId || ''}</div>
        <div style="color:var(--text-muted);line-height:1.5">${item.descripcion || 'Sin descripción del motivo.'}</div>
      </div>

      <div style="padding:10px 12px;background:var(--surface);border-radius:6px">
        ${fila('Aditivo', `+${M(n(item.montoAditivo))}`, '#4caf82')}
        ${fila('Deductivo', `−${M(n(item.montoDeductivo))}`, '#e0a04c')}
        ${fila('Neto sin IVA', `${n(item.montoNeto) >= 0 ? '+' : '−'}${M(n(item.montoNeto))}`)}
        ${fila(`IVA (${n(item.ivaPct) || 16}%)`, M(n(item.iva)))}
        <div style="border-top:1px solid var(--border);margin-top:5px;padding-top:5px">
          ${fila('<b>Neto con IVA</b>', `${neto >= 0 ? '+' : '−'}${M(neto)}`, col)}
        </div>
      </div>

      <div style="padding:10px 12px;background:var(--surface);border-radius:6px">
        ${fila('Contrato antes', M(n(item.contratoAntesCIVA)))}
        ${fila('Contrato después', M(n(item.contratoDespuesCIVA)), col)}
      </div>

      ${filasRubros ? `
        <div style="padding:10px 12px;background:var(--surface);border-radius:6px;font-size:12px;line-height:1.7">
          <div style="color:var(--text-muted);margin-bottom:4px">Impacto por rubro de esta OC</div>
          ${filasRubros}
        </div>` : ''}

      <div style="padding:9px 11px;background:rgba(26,159,212,.08);border-left:3px solid var(--accent);border-radius:6px;font-size:11px;color:var(--text-muted);line-height:1.55">
        Informativa: al registrarla <b>no se genera ningún movimiento contable</b>. Una orden de
        cambio mueve el presupuesto, no la caja — el dinero llegará después por las estimaciones.
        El presupuesto por rubro se actualiza desde el contrato vigente que publica estimaciones.
      </div>
    </div>`;
}

function _cardBodyHTML(item) {
  if (item.tipo === 'orden_cambio') return _cardBodyOrdenCambio(item);
  const esSub     = item.tipo === 'estimacion_subcontratista';
  const esGastoCC = item.tipo === 'gasto_caja_chica';
  const esDepCC   = item.tipo === 'deposito_caja_chica';
  const esOC      = item.tipo === 'oc_materiales';
  const esGastoOC = item.tipo === 'gasto_oc';
  const esIndirecto = item.tipo === 'gasto_indirecto';
  const esNomina  = typeof item.tipo === 'string' && item.tipo.startsWith('nomina_');
  const esCargaSocial = item.tipo === 'carga_social';
  const esCajaChica = esGastoCC || esDepCC;
  // Etiqueta legible de forma de pago (gasto_oc)
  const _formaPagoLbl = { credito: '🧾 Crédito (por pagar)', efectivo: '💵 Efectivo', transferencia: '🏦 Transferencia', caja_chica: '💰 Caja chica' }[item.formaPago] || item.formaPago || '—';
  const fechaPago = item.fecha
    ? new Date(item.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    : (esOC && item.fechaEmision
      ? new Date(item.fechaEmision).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—');
  const fechaCreado = item.creadoAt ? new Date(item.creadoAt).toLocaleString('es-MX') : '';
  const montoNum = esCajaChica ? Number(item.monto) || 0 : 0;
  const montoInfo = esOC
    ? `Subtotal $${(item.subtotal || 0).toLocaleString('es-MX',{minimumFractionDigits:2})} · IVA $${(item.ivaImporte || 0).toLocaleString('es-MX',{minimumFractionDigits:2})}${item.retencionesTotal ? ' · Retenciones $' + (item.retencionesTotal).toLocaleString('es-MX',{minimumFractionDigits:2}) : ''} · Total <b>$${(item.total || 0).toLocaleString('es-MX',{minimumFractionDigits:2})}</b>`
    : esGastoOC
    ? `Subtotal $${(Number(item.subtotal) || 0).toLocaleString('es-MX',{minimumFractionDigits:2})} · IVA $${(Number(item.iva) || 0).toLocaleString('es-MX',{minimumFractionDigits:2})} · Total <b>$${(Number(item.total ?? item.monto) || 0).toLocaleString('es-MX',{minimumFractionDigits:2})}</b>`
    : esCajaChica
    ? `Importe: <b>$${montoNum.toLocaleString('es-MX',{minimumFractionDigits:2})}</b> <span style="color:var(--text-muted);font-size:11px">(monto plano · sin desglose IVA del lado almacén)</span>${item.fondo === 'efectivo' ? ' · <b style="color:#e0a04c">💵 fondo efectivo</b>' : ''}`
    : (item?.monto?.conIva === false
        ? '<span style="color:#e0a04c">Sin IVA</span> — importe = subtotal'
        : `Subtotal $${(item?.monto?.subtotal || 0).toLocaleString('es-MX',{minimumFractionDigits:2})} · IVA $${(item?.monto?.iva || 0).toLocaleString('es-MX',{minimumFractionDigits:2})}`);
  const proyectoIdResuelto = _resolverProyectoIdItem(item);
  const proyNombre  = ((esIndirecto || esNomina || esCargaSocial) && (item.empresa || !item.obraId))
    ? `<b style="color:#5dd39e">🏢 Empresa SOGRUB</b> <span class="text-muted" style="font-size:11px">(sin obra${(esNomina || esCargaSocial) ? ' · prorrateo por obra abajo' : ''})</span>`
    : proyectoIdResuelto
    ? `<b style="color:#5dd39e">${_obtenerNombreProyecto(proyectoIdResuelto)}</b>${(!item.proyectoId && proyectoIdResuelto) ? '<span class="text-muted" style="font-size:11px"> (vía obraLinks)</span>' : ''}`
    : `<span style="color:#e15555">⚠ Obra sin vincular${item.obraId ? ` <code style='font-size:10px'>${item.obraId}</code>` : ''}</span>`;

  const col1 = esSub
    ? `Subcontrato: <b>${item.subcontratoNombre || '—'}</b><br>
       Estim. sub: <b>#${item.subEstimacionNumero ?? '—'}</b><br>
       Subcontratista: <b>${item.proveedorNombre || '—'}</b><br>
       Fecha pago: <b>${fechaPago}</b>`
    : esGastoCC
    ? `Proveedor: <b>${item.proveedor || '—'}</b> <code style="font-size:11px" title="RFC del proveedor">${_rfcProveedorBuzon(item.proveedor, item) || '—'}</code><br>
       Factura: <b>${item.factura || '<span style=\'color:#e0a04c\'>sin factura</span>'}</b><br>
       Recepción: <b>${item.refRecepcionId ? '<code style=\'font-size:11px\'>' + item.refRecepcionId.slice(-8) + '</code>' : '—'}</b><br>
       Fecha: <b>${fechaPago}</b>`
    : esDepCC
    ? `Método: <b>${item.metodoDeposito === 'transferencia' ? '🏦 Transferencia bancaria' : item.metodoDeposito || '—'}</b><br>
       Comentario: <b>${item.comentario || '—'}</b><br>
       Fecha depósito: <b>${fechaPago}</b>`
    : esOC
    ? `Proveedor: <b>${item.proveedor?.nombre || '—'}</b>${item.proveedor?.rfc ? ' <code style="font-size:11px">' + item.proveedor.rfc + '</code>' : ''}<br>
       Items: <b>${(item.items || []).length}</b>${item.reqIds?.length ? ` · Requisiciones cubiertas: <b>${item.reqIds.length}</b>` : ''}<br>
       Condiciones: <b>${item.condicionesPago || '—'}</b><br>
       Fecha emisión: <b>${fechaPago}</b>`
    : esGastoOC
    ? `Proveedor: <b>${item.proveedor || '—'}</b> <code style="font-size:11px" title="RFC del proveedor">${_rfcProveedorBuzon(item.proveedor, item) || '—'}</code><br>
       Factura: <b>${item.factura || '<span style=\'color:#e0a04c\'>sin factura</span>'}</b> · Forma de pago: <b>${_formaPagoLbl}</b><br>
       Items: <b>${(item.items || []).length}</b> · Recepción: <b>${item.refRecepcionId ? '<code style=\'font-size:11px\'>' + String(item.refRecepcionId).slice(-8) + '</code>' : '—'}</b><br>
       Fecha: <b>${fechaPago}</b>`
    : esIndirecto
    ? `Concepto: <b>${item.concepto || '—'}</b><br>
       Categoría: <b>${item.categoriaNombre || item.categoria || '—'}</b>${item.empresa ? ' <span style="color:#e0a04c">· empresa</span>' : ''}<br>
       ${item.proveedorNombre ? `Proveedor: <b>${item.proveedorNombre}</b> <code style="font-size:11px" title="RFC del proveedor">${_rfcProveedorBuzon(item.proveedorNombre, item) || '—'}</code><br>` : ''}Fecha: <b>${fechaPago}</b>`
    : esNomina
    ? `Personal: <b>${item.tipoPersonal || '—'}</b>${item.periodicidad ? ' · ' + item.periodicidad : ''}<br>
       Período: <b>${item.label || item.periodoId || '—'}</b><br>
       Empleados: <b>${item.numEmpleados ?? '—'}</b> · Neto: <b>$${(Number(item.totalNeto ?? item?.monto?.importe) || 0).toLocaleString('es-MX',{minimumFractionDigits:2})}</b><br>
       Obras prorrateadas: <b>${Object.keys(item.prorrateoPorObra || {}).length}</b>${Number(item.netoSinObra) ? ' + empresa' : ''}`
    : esCargaSocial
    ? `Clasificación: <b>${item.clasificacion || '—'}${item.ambito ? ' · ' + item.ambito : ''}</b><br>
       Mes: <b>${item.mes || '—'}</b>${item.incluyeInfonavit ? ' · <span style="color:#5dd39e">incluye Infonavit</span>' : ''}<br>
       Empleados: <b>${(item.empleados || []).length}</b> · Obras prorrateadas: <b>${Object.keys(item.prorrateoPorObra || {}).length}</b><br>
       ${item.fechaVencimiento ? `Vence: <b>${new Date(item.fechaVencimiento).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}</b>` : `Fecha: <b>${fechaPago}</b>`}`
    : `Estimación: <b>#${item.estimNumero ?? '—'}</b><br>
       Fecha pago: <b>${fechaPago}</b>`;

  const col2 = `${montoInfo}<br>
    Proyecto: ${proyNombre}<br>
    ${item.folio ? `Folio: <b>${item.folio}</b><br>` : ''}
    ${fechaCreado ? `Recibido: ${fechaCreado}` : ''}`;

  const movInfo = item.movId
    ? `<div style="margin-top:4px;font-size:11px;color:var(--text-muted)">Movimiento: <code>${item.movId}</code>${item.actualizadoPorContador ? ' · ✎ editado por contador' : ''}</div>`
    : '';

  const pagoInfo = (item.cobradoAt || item.pagadoAt)
    ? `<div style="margin-top:4px;font-size:11px;color:var(--text-muted)">
        ${item.estado === 'cobrado' ? 'Cobrado' : 'Pagado'}: ${new Date(item.cobradoAt || item.pagadoAt).toLocaleString('es-MX')}
        ${item.metodoPago ? ` · ${item.metodoPago}` : ''}
        ${item.referenciaPago ? ` · Ref: ${item.referenciaPago}` : ''}
       </div>`
    : '';

  const rechazInfo = item.comentarioRechazo
    ? `<div style="margin-top:4px;font-size:12px;color:#e15555">Rechazo: <em>${item.comentarioRechazo}</em></div>`
    : '';

  const huerfanoInfo = item.descripcionHuerfano
    ? `<div style="margin-top:4px;font-size:12px;color:#a06bd9">⚠ ${item.descripcionHuerfano}${item.huerfanoAt ? ' (' + new Date(item.huerfanoAt).toLocaleString('es-MX') + ')' : ''}</div>`
    : '';

  // Desglose OPUS — caja chica usa shape distinta {conceptoKey, conceptoClave, conceptoDescripcion, monto}
  let desgloseHTML = '';
  if ((esGastoCC || esOC || esGastoOC) && Array.isArray(item.desglose) && item.desglose.length > 0) {
    const totalCC = item.desglose.reduce((s, d) => s + (Number(d.monto) || 0), 0);
    desgloseHTML = `
      <details open style="margin-top:10px;font-size:11px">
        <summary style="cursor:pointer;color:var(--text-muted)">📋 Desglose por concepto OPUS (${item.desglose.length} líneas · $${totalCC.toLocaleString('es-MX',{minimumFractionDigits:2})})</summary>
        <table style="width:100%;margin-top:6px;border-collapse:collapse">
          <thead style="color:var(--text-muted)"><tr>
            <th style="text-align:left;padding:2px 5px">Clave</th>
            <th style="text-align:left;padding:2px 5px">Descripción</th>
            <th style="text-align:right;padding:2px 5px">Importe</th>
          </tr></thead>
          <tbody>
            ${item.desglose.map(d => `<tr>
              <td style="padding:2px 5px;font-family:monospace">${d.conceptoClave || '—'}</td>
              <td style="padding:2px 5px">${(d.conceptoDescripcion || '').slice(0, 60)}</td>
              <td style="padding:2px 5px;text-align:right;font-weight:600">$${(Number(d.monto) || 0).toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </details>`;
  } else if (esSub && Array.isArray(item.desglose) && item.desglose.length > 0) {
    const total = item.desglose.reduce((s, d) => s + (Number(d.importe) || 0), 0);
    desgloseHTML = `
      <details style="margin-top:10px;font-size:11px">
        <summary style="cursor:pointer;color:var(--text-muted)">📋 Desglose OPUS (${item.desglose.length} líneas · $${total.toLocaleString('es-MX',{minimumFractionDigits:2})})</summary>
        <table style="width:100%;margin-top:6px;border-collapse:collapse">
          <thead style="color:var(--text-muted)"><tr>
            <th style="text-align:left;padding:2px 5px">Clave</th>
            <th style="text-align:left;padding:2px 5px">Descripción</th>
            <th style="text-align:right;padding:2px 5px">Cant.</th>
            <th style="text-align:right;padding:2px 5px">P.U.</th>
            <th style="text-align:right;padding:2px 5px">Importe</th>
          </tr></thead>
          <tbody>
            ${item.desglose.map(d => `<tr>
              <td style="padding:2px 5px;font-family:monospace">${d.clave || '—'}</td>
              <td style="padding:2px 5px">${(d.descripcion || '').slice(0, 55)}</td>
              <td style="padding:2px 5px;text-align:right">${(Number(d.cantidad) || 0).toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
              <td style="padding:2px 5px;text-align:right">$${(Number(d.precioUnitario) || 0).toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
              <td style="padding:2px 5px;text-align:right;font-weight:600">$${(Number(d.importe) || 0).toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </details>`;
  }

  // Historial de estados
  let historialHTML = '';
  if (item.estadoHistorial) {
    const entradas = Object.values(item.estadoHistorial).sort((a, b) => (a.at || 0) - (b.at || 0));
    if (entradas.length) {
      historialHTML = `
        <details style="margin-top:8px;font-size:11px">
          <summary style="cursor:pointer;color:var(--text-muted)">Historial (${entradas.length} cambios)</summary>
          <div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">
            ${entradas.map(e => {
              const ec = _ESTADOS_CFG[e.estado] || _ESTADOS_CFG.recibido;
              return `<div style="color:var(--text-muted)">
                <span style="background:${ec.color};color:#fff;padding:1px 5px;border-radius:6px;font-size:10px">${e.estado}</span>
                ${e.at ? ` ${new Date(e.at).toLocaleString('es-MX')}` : ''}
                ${e.nota ? ` <em>— ${e.nota}</em>` : ''}
              </div>`;
            }).join('')}
          </div>
        </details>`;
    }
  }

  return `
    ${_stepperHTML(item)}
    <div style="padding-top:10px;font-size:12px;color:var(--text-muted);line-height:1.7">
      <div style="display:flex;gap:20px;flex-wrap:wrap">
        <div>${col1}</div>
        <div>${col2}</div>
      </div>
      ${movInfo}${pagoInfo}${rechazInfo}${huerfanoInfo}
    </div>
    ${desgloseHTML}
    ${historialHTML}
    <div class="bz-acciones" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
      ${_accionesHTML(item)}
    </div>`;
}

// ─── Análisis financiero (los 3 momentos × CxC/CxP) ───────────────────────

// Recorre todos los items y suma por tipo (CxC = pago_cliente / CxP = sub) y
// momento contable. Excluye rechazados y huérfanos (no son obligaciones reales).
function _calcularResumenFinanciero(items) {
  const cxc = { devengado: 0, pendienteRev: 0, porCobrar: 0, cobrado: 0, count: 0 };
  const cxp = { devengado: 0, pendienteRev: 0, porPagar: 0,  pagado: 0,  count: 0 };
  const excluidos = { rechazados: 0, huerfanos: 0, montoHuerfano: 0 };

  for (const it of Object.values(items || {})) {
    if (!it) continue;
    // OC de compras usa monto plano (item.total). CxC/CxP normales tienen
    // {subtotal, iva, importe}. Caja chica también usa monto plano pero NO
    // entra al análisis CxC/CxP (es flujo paralelo).
    const monto = (it.tipo === 'oc_materiales' || it.tipo === 'gasto_oc')
      ? (Number(it.total) || 0)
      : (Number(it?.monto?.importe) || 0);
    if (!monto) continue;
    if (it.estado === 'rechazado') { excluidos.rechazados++; continue; }
    if (it.estado === 'huerfano')  { excluidos.huerfanos++; excluidos.montoHuerfano += monto; continue; }

    const target = it.tipo === 'pago_cliente' ? cxc
                 : (it.tipo === 'estimacion_subcontratista' || it.tipo === 'oc_materiales' || it.tipo === 'gasto_indirecto' || it.tipo === 'gasto_oc') ? cxp
                 : null;
    if (!target) continue;

    target.devengado += monto;
    target.count++;
    if (['recibido', 'pendiente', 'en_revision'].includes(it.estado)) {
      target.pendienteRev += monto;
    } else if (it.estado === 'aprobado') {
      if (it.tipo === 'pago_cliente') target.porCobrar += monto;
      else target.porPagar += monto;
    } else if (['cobrado', 'pagado', 'cerrado'].includes(it.estado)) {
      if (it.tipo === 'pago_cliente') target.cobrado += monto;
      else target.pagado += monto;
    }
  }

  return { cxc, cxp, excluidos };
}

function _resumenFinancieroHTML(stats) {
  const { cxc, cxp } = stats;
  const sinCartera = cxc.devengado === 0 && cxp.devengado === 0;

  const fmt = n => '$' + Math.round(n).toLocaleString('es-MX');
  const pctTxt = (n, t) => t > 0 ? Math.round((n / t) * 100) + '%' : '0%';
  const pctNum = (n, t) => t > 0 ? (n / t) * 100 : 0;

  // Bloque por flujo (CxC o CxP). Stacked bar + tabla compacta de 3 momentos.
  const renderFlujo = (titulo, color, total, count, pendRev, comp, compLbl, mat, matLbl) => {
    if (total === 0) {
      return `<div style="flex:1;min-width:280px;padding:14px;border:1px dashed var(--border);border-radius:8px;color:var(--text-muted);font-size:12px;text-align:center">${titulo}: sin items</div>`;
    }
    return `
      <div style="flex:1;min-width:280px;padding:12px 14px;background:var(--surface);border:1px solid var(--border);border-left:3px solid ${color};border-radius:8px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">
          <div><b style="color:${color}">${titulo}</b> <span style="font-size:11px;color:var(--text-muted)">${count} item${count===1?'':'s'}</span></div>
          <span style="font-family:ui-monospace,monospace;font-weight:700;font-size:15px">${fmt(total)}</span>
        </div>
        <div style="height:9px;display:flex;background:rgba(0,0,0,.25);border-radius:4px;overflow:hidden;margin-bottom:10px">
          <div style="width:${pctNum(mat,total)}%;background:#4db884"  title="${matLbl}: ${fmt(mat)}"></div>
          <div style="width:${pctNum(comp,total)}%;background:#5dd39e" title="${compLbl}: ${fmt(comp)}"></div>
          <div style="width:${pctNum(pendRev,total)}%;background:#e0a04c" title="Pendiente revisión: ${fmt(pendRev)}"></div>
        </div>
        <div style="font-size:11px;display:grid;grid-template-columns:1fr auto auto;gap:3px 10px;color:var(--text-muted)">
          <span><span style="display:inline-block;width:8px;height:8px;background:#e0a04c;border-radius:2px;vertical-align:middle;margin-right:4px"></span>1. Devengado, sin revisar</span>
          <span style="font-family:ui-monospace,monospace">${fmt(pendRev)}</span>
          <span style="font-family:ui-monospace,monospace">${pctTxt(pendRev, total)}</span>
          <span><span style="display:inline-block;width:8px;height:8px;background:#5dd39e;border-radius:2px;vertical-align:middle;margin-right:4px"></span>2. ${compLbl}</span>
          <span style="font-family:ui-monospace,monospace">${fmt(comp)}</span>
          <span style="font-family:ui-monospace,monospace">${pctTxt(comp, total)}</span>
          <span><span style="display:inline-block;width:8px;height:8px;background:#4db884;border-radius:2px;vertical-align:middle;margin-right:4px"></span>3. ${matLbl}</span>
          <span style="font-family:ui-monospace,monospace">${fmt(mat)}</span>
          <span style="font-family:ui-monospace,monospace">${pctTxt(mat, total)}</span>
        </div>
      </div>`;
  };

  const blockCxC = renderFlujo('Por cobrar (clientes)', '#5dd39e',
    cxc.devengado, cxc.count, cxc.pendienteRev,
    cxc.porCobrar, 'En CxC (libros)', cxc.cobrado, 'Cobrado (caja)');
  const blockCxP = renderFlujo('Por pagar (subcontratistas)', '#e15555',
    cxp.devengado, cxp.count, cxp.pendienteRev,
    cxp.porPagar, 'En CxP (libros)', cxp.pagado, 'Pagado (caja)');

  // Saldos
  const saldoCaja        = cxc.cobrado    - cxp.pagado;
  const saldoLibros      = (cxc.cobrado + cxc.porCobrar) - (cxp.pagado + cxp.porPagar);
  const saldoProyectado  = cxc.devengado  - cxp.devengado;

  const sgn      = n => n >= 0 ? '+' : '−';
  const sgnColor = n => n >= 0 ? '#5dd39e' : '#e15555';
  const saldoCard = (titulo, valor, sub) => `
    <div style="padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:6px">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">${titulo}</div>
      <div style="font-family:ui-monospace,monospace;font-size:18px;font-weight:700;color:${sgnColor(valor)}">${sgn(valor)}${fmt(Math.abs(valor))}</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${sub}</div>
    </div>`;

  const exc = stats.excluidos || { rechazados: 0, huerfanos: 0, montoHuerfano: 0 };
  const avisoExcluidos = (exc.rechazados > 0 || exc.huerfanos > 0)
    ? `<div style="font-size:11px;color:var(--text-muted);margin-top:8px;padding:6px 10px;background:rgba(0,0,0,.15);border-radius:4px">
         ℹ Excluidos del análisis: ${exc.rechazados > 0 ? `<b>${exc.rechazados}</b> rechazado${exc.rechazados===1?'':'s'}` : ''}${exc.rechazados > 0 && exc.huerfanos > 0 ? ' · ' : ''}${exc.huerfanos > 0 ? `<b>${exc.huerfanos}</b> huérfano${exc.huerfanos===1?'':'s'} (${fmt(exc.montoHuerfano)})` : ''}.
       </div>`
    : '';

  const avisoSinCartera = sinCartera
    ? `<div style="padding:14px 16px;background:rgba(224,160,76,.08);border:1px dashed #e0a04c;border-radius:6px;margin-bottom:14px;font-size:12px;color:var(--text-muted);line-height:1.55">
         <div style="color:#e0a04c;font-weight:600;margin-bottom:4px">Sin cartera viva</div>
         No hay items aprobados, en revisión, ni recibidos. ${exc.rechazados + exc.huerfanos > 0 ? `Tus ${exc.rechazados + exc.huerfanos} items existentes están en estado rechazado o huérfano y no representan obligaciones reales.` : 'Cuando lleguen items del lado de estimaciones aparecerán aquí.'}
       </div>`
    : '';

  return `
    <details open style="margin-bottom:12px;border:1px solid var(--border);border-radius:8px;background:rgba(0,0,0,.1)">
      <summary style="cursor:pointer;padding:10px 14px;font-weight:600;font-size:13px">📈 Análisis financiero — toda la cartera</summary>
      <div style="padding:0 14px 14px">
        ${avisoSinCartera}
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px">
          ${blockCxC}
          ${blockCxP}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
          ${saldoCard('Saldo en caja',         saldoCaja,       'cobrado − pagado (real)')}
          ${saldoCard('Saldo en libros',       saldoLibros,     '+ CxC y CxP aprobadas')}
          ${saldoCard('Saldo proyectado',      saldoProyectado, 'si todo lo devengado se materializa')}
        </div>
        ${avisoExcluidos}
      </div>
    </details>`;
}

// Stepper visual de los 3 momentos contables. La etapa actual queda resaltada,
// las anteriores marcadas con ✓, las futuras grises. Rechazado/huerfano muestran ✕.
function _stepperHTML(item) {
  const esCxP     = _tipoEsCxP(item.tipo);
  const esGastoCC = item.tipo === 'gasto_caja_chica';
  const esDepCC   = item.tipo === 'deposito_caja_chica';
  let labels, sublabels;
  if (esGastoCC) {
    labels    = ['Reportado', 'Aprobado', 'Asentado'];
    sublabels = ['gasto en almacén', 'libros + saldo', 'gasto contable creado'];
  } else if (esDepCC) {
    labels    = ['Solicitado', 'Aprobado', 'Asentado'];
    sublabels = ['materiales reportó', 'autorizado', 'egreso bancario'];
  } else if (esCxP) {
    labels    = ['Devengado', 'Por pagar', 'Pagado'];
    sublabels = ['obligación nace', 'CxP en libros', 'salió de caja'];
  } else {
    labels    = ['Devengado', 'Por cobrar', 'Cobrado'];
    sublabels = ['obligación nace', 'CxC en libros', 'entró a caja'];
  }

  // map estado → step alcanzado (1, 2 o 3)
  // Para caja chica, aprobar = asentar inmediatamente (no hay segundo momento
  // separado entre libros y caja como en CxC/CxP), así que aprobado → step 3.
  const esCC = esGastoCC || esDepCC;
  const stepMap = esCC ? {
    recibido: 1, pendiente: 1, en_revision: 1,
    aprobado: 3,
    cobrado: 3, pagado: 3, cerrado: 3,
    rechazado: 1, huerfano: 2,
  } : {
    recibido: 1, pendiente: 1, en_revision: 1,
    aprobado: 2,
    cobrado: 3, pagado: 3, cerrado: 3,
    rechazado: 1, huerfano: 2,
  };
  const current   = stepMap[item.estado] ?? 1;
  const isReject  = item.estado === 'rechazado';
  const isOrphan  = item.estado === 'huerfano';
  const broken    = isReject || isOrphan;

  const renderDot = (n) => {
    const done   = n < current && !broken;
    const active = n === current && !broken;
    const future = n > current;
    let bg, fg, border, content;
    if (broken && n === current) {
      bg = isReject ? '#e15555' : '#a06bd9';
      fg = '#fff';
      border = bg;
      content = isReject ? '✕' : '⚠';
    } else if (done) {
      bg = '#5dd39e'; fg = '#08121a'; border = '#5dd39e'; content = '✓';
    } else if (active) {
      bg = '#e0a04c'; fg = '#08121a'; border = '#e0a04c'; content = String(n);
    } else {
      bg = 'transparent'; fg = 'var(--text-muted)'; border = 'var(--border)'; content = String(n);
    }
    const labelColor = (done || active) ? 'var(--text)' : 'var(--text-muted)';
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:3px;flex:0 0 auto;min-width:78px">
        <div style="width:26px;height:26px;border-radius:50%;background:${bg};color:${fg};border:2px solid ${border};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${content}</div>
        <span style="font-size:11px;font-weight:600;color:${labelColor}">${labels[n - 1]}</span>
        <span style="font-size:9px;color:var(--text-muted)">${sublabels[n - 1]}</span>
      </div>`;
  };
  const renderConn = (after) => {
    const filled = after < current && !broken;
    return `<div style="flex:1;height:2px;background:${filled ? '#5dd39e' : 'var(--border)'};margin-top:13px;min-width:18px"></div>`;
  };

  return `
    <div style="display:flex;align-items:flex-start;padding:12px 8px;background:rgba(0,0,0,.18);border-radius:6px;margin-top:10px">
      ${renderDot(1)}${renderConn(1)}${renderDot(2)}${renderConn(2)}${renderDot(3)}
    </div>`;
}

function _accionesHTML(item) {
  const esCajaChica = item.tipo === 'gasto_caja_chica' || item.tipo === 'deposito_caja_chica';
  // Resolvemos via obraLinks para items que sólo traen obraId (los de materiales).
  const proyectoResuelto = _resolverProyectoIdItem(item);
  const obrasSinVinc = _obrasSinVincularDeItem(item);
  // Solo bloqueamos items que requieren un proyecto ÚNICO. Nómina, carga social
  // y gasto de empresa NO se bloquean (multi-obra / empresa).
  const noProj = _itemRequiereProyectoUnico(item) && !proyectoResuelto;
  const vincBtn = obrasSinVinc.length
    ? `<button class="bz-btn-vincular" style="background:transparent;color:var(--accent);border:1px solid var(--accent);border-radius:6px;padding:8px 14px;cursor:pointer">🔗 Vincular obra${obrasSinVinc.length > 1 ? 's (' + obrasSinVinc.length + ')' : ''}</button>`
    : '';
  const noVinc = noProj ? '<span style="font-size:11px;color:#e15555;align-self:center">Vincula la obra primero</span>' : '';
  const dis    = noProj ? 'disabled style="opacity:.5;cursor:not-allowed"' : 'style="cursor:pointer"';
  const e      = item.estado;

  if (e === 'recibido' || e === 'pendiente' || e === 'en_revision') {
    if (esCajaChica) {
      // Caja chica: aprobar = asentar contable directamente. No hay flujo
      // CxC/CxP, así que tampoco hay "Aprobar + Pagar".
      const lbl = item.tipo === 'gasto_caja_chica' ? '✓ Aprobar gasto' : '✓ Aprobar y asentar';
      // El botón "Ver recepción" abre un modal con el ticket, items, factura
      // y atajos para solicitar/subir factura antes de aprobar — solo aplica
      // a gastos de caja chica con recepción asociada.
      const verRecepcion = (item.tipo === 'gasto_caja_chica' && item.refRecepcionId)
        ? `<button class="bz-btn-ver-recepcion" style="background:transparent;color:var(--accent);border:1px solid var(--accent);border-radius:6px;padding:8px 14px;cursor:pointer">👁 Ver recepción + factura</button>`
        : '';
      return `
        ${verRecepcion}
        <button class="bz-btn-aprobar" ${dis} style="background:#5dd39e;color:#0e3a25;border:none;border-radius:6px;padding:8px 14px;font-weight:600">${lbl}</button>
        <button class="bz-btn-rechazar" style="background:transparent;color:#e15555;border:1px solid #e15555;border-radius:6px;padding:8px 14px;cursor:pointer">✕ Rechazar</button>
        ${vincBtn}`;
    }
    const labelPagoRapido = (_tipoEsCxP(item.tipo)) ? 'Aprobar + Pagar' : 'Aprobar + Cobrar';
    return `
      <button class="bz-btn-aprobar" ${dis} style="background:#5dd39e;color:#0e3a25;border:none;border-radius:6px;padding:8px 14px;font-weight:600">✓ Aprobar</button>
      <button class="bz-btn-aprobar-pagar" ${dis} style="background:#3ab87a;color:#0e3a25;border:none;border-radius:6px;padding:8px 14px;font-weight:600">${labelPagoRapido}</button>
      <button class="bz-btn-rechazar" style="background:transparent;color:#e15555;border:1px solid #e15555;border-radius:6px;padding:8px 14px;cursor:pointer">✕ Rechazar</button>
      ${noVinc}${vincBtn}`;
  }
  if (e === 'aprobado') {
    if (esCajaChica) {
      // Aprobado en caja chica = ya asentado. Permitir ver recepción (revisión
      // post-hoc / subir factura tardía), reabrir o cerrar.
      const verRecepcion = (item.tipo === 'gasto_caja_chica' && item.refRecepcionId)
        ? `<button class="bz-btn-ver-recepcion" style="background:transparent;color:var(--accent);border:1px solid var(--accent);border-radius:6px;padding:8px 14px;cursor:pointer">👁 Ver recepción</button>`
        : '';
      return `
        ${verRecepcion}
        <button class="bz-btn-reabrir" style="background:transparent;color:#5dd39e;border:1px solid #5dd39e;border-radius:6px;padding:8px 14px;cursor:pointer">↺ Reabrir</button>
        <button class="bz-btn-cerrar" style="background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:6px;padding:8px 14px;cursor:pointer">Cerrar</button>`;
    }
    const labelMrk = (_tipoEsCxP(item.tipo)) ? 'Marcar Pagado' : 'Marcar Cobrado';
    return `
      <button class="bz-btn-marcar-pagado" style="background:#5dd39e;color:#0e3a25;border:none;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer">✓ ${labelMrk}</button>
      <button class="bz-btn-cerrar" style="background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:6px;padding:8px 14px;cursor:pointer">Cerrar</button>
      <button class="bz-btn-rechazar" style="background:transparent;color:#e15555;border:1px solid #e15555;border-radius:6px;padding:8px 14px;cursor:pointer">✕ Rechazar</button>`;
  }
  if (e === 'cobrado' || e === 'pagado') {
    return `
      <button class="bz-btn-reabrir" style="background:transparent;color:#5dd39e;border:1px solid #5dd39e;border-radius:6px;padding:8px 14px;cursor:pointer">↩ Reabrir</button>
      <button class="bz-btn-cerrar" style="background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:6px;padding:8px 14px;cursor:pointer">Cerrar</button>`;
  }
  if (e === 'huerfano') {
    return `
      <button class="bz-btn-reaprobar" ${dis} style="background:#5dd39e;color:#0e3a25;border:none;border-radius:6px;padding:8px 14px;font-weight:600">✓ Volver a crear movimiento</button>
      <button class="bz-btn-rechazar" style="background:transparent;color:#e15555;border:1px solid #e15555;border-radius:6px;padding:8px 14px;cursor:pointer">✕ Cerrar como rechazado</button>
      ${noVinc}`;
  }
  return ''; // cerrado / rechazado — sin acciones
}

function _attachAcciones(body, item) {
  const on = (cls, fn) => { const el = body.querySelector(cls); if (el) el.addEventListener('click', fn); };
  on('.bz-btn-aprobar',        () => _aprobarItem(item, false));
  on('.bz-btn-aprobar-pagar',  () => _aprobarItem(item, true));
  on('.bz-btn-rechazar',       () => _rechazarItem(item));
  on('.bz-btn-marcar-pagado',  () => _marcarPagadoCobrado(item));
  on('.bz-btn-reabrir',        () => _reabrirItem(item));
  on('.bz-btn-reaprobar',      () => _aprobarItem(item, false));
  on('.bz-btn-cerrar',         () => _cerrarItem(item));
  on('.bz-btn-ver-recepcion',  () => _modalVerRecepcion(item));
  on('.bz-btn-vincular',       () => {
    const obras = _obrasSinVincularDeItem(item);
    if (obras.length) _modalVincularObras(obras, item);
    else _toast('Todas las obras de este item ya están vinculadas.', 'info');
  });
}

// Obras del item que aún NO tienen proyecto contable vinculado (obraLinks).
function _obrasSinVincularDeItem(item) {
  const ids = new Set();
  if (item.obraId && !item.empresa) ids.add(item.obraId);
  for (const oid of Object.keys(item.prorrateoPorObra || {})) ids.add(oid);
  return [...ids].filter(oid => oid && !_buzon.obraLinks[oid]);
}

// ¿Requiere un proyecto ÚNICO para aprobarse? Nómina, carga social y gasto de
// empresa son multi-obra o sin obra: se aprueban sin bloquear (advierten por obra).
function _itemRequiereProyectoUnico(item) {
  if (typeof item.tipo === 'string' && item.tipo.startsWith('nomina_')) return false;
  if (item.tipo === 'carga_social') return false;
  if (item.tipo === 'gasto_indirecto' && (item.empresa || !item.obraId)) return false;
  return true;
}

// Modal: vincula 1..N obras → proyecto contable. Escribe (set) el proyectoId
// (string) en /shared/obraLinks/{obraId}. Desbloquea las aprobaciones.
function _modalVincularObras(obraIds, item) {
  const proyectos = (getCollection('sogrub_proyectos') || [])
    .filter(p => p && p.id).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  if (proyectos.length === 0) { _toast('No hay proyectos contables. Crea uno en Proyectos primero.', 'warning'); return; }
  const nombreObra = (oid) => (item?.obraNombre && item.obraId === oid) ? item.obraNombre : (item?.nombreObraPorObra?.[oid] || '');
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999';
  overlay.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:24px;width:min(520px,92%);max-height:88vh;overflow:auto">
      <h3 style="margin:0 0 6px">🔗 Vincular obra → proyecto</h3>
      <p style="margin:0 0 16px;font-size:12px;color:var(--text-muted)">Elige el proyecto de bitácora que corresponde a cada obra. Se guarda en <code>/shared/obraLinks</code> y desbloquea la aprobación.</p>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${obraIds.map(oid => `
          <label style="font-size:13px">Obra <code style="font-size:11px">${oid}</code>${nombreObra(oid) ? ' · ' + nombreObra(oid) : ''}
            <select data-obra="${oid}" style="margin-top:4px;display:block;width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">
              <option value="">— elegir proyecto —</option>
              ${proyectos.map(p => `<option value="${p.id}">${p.nombre}${p.cliente ? ' · ' + p.cliente : ''}</option>`).join('')}
            </select>
          </label>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end">
        <button id="vo-cancel" style="background:transparent;border:1px solid var(--border);border-radius:6px;padding:8px 16px;color:var(--text);cursor:pointer">Cancelar</button>
        <button id="vo-ok" style="background:#5dd39e;color:#0e3a25;border:none;border-radius:6px;padding:8px 16px;font-weight:600;cursor:pointer">Vincular</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const cleanup = () => document.body.removeChild(overlay);
  overlay.querySelector('#vo-cancel').addEventListener('click', cleanup);
  overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(); });
  overlay.querySelector('#vo-ok').addEventListener('click', async () => {
    const pares = [];
    overlay.querySelectorAll('select[data-obra]').forEach(sel => { if (sel.value) pares.push([sel.dataset.obra, sel.value]); });
    if (!pares.length) { _toast('Elige al menos un proyecto.', 'warning'); return; }
    try {
      // obraLinks/{obraId} = proyectoId (string) → set, no update.
      await Promise.all(pares.map(([oid, pid]) => _dbRef(`/shared/obraLinks/${oid}`).set(pid)));
      pares.forEach(([oid, pid]) => { _buzon.obraLinks[oid] = pid; }); // cache local inmediato
      cleanup();
      _toast(`${pares.length} obra(s) vinculada(s).`, 'success');
      renderBuzon();
    } catch (err) { _toast('Error al vincular: ' + err.message, 'error'); }
  });
}

// ─── Helpers de display ────────────────────────────────────────────────────

function _obtenerNombreProyecto(proyectoId) {
  const arr = getCollection('sogrub_proyectos') || [];
  const list = Array.isArray(arr) ? arr : Object.values(arr);
  const p = list.find(x => String(x?.id) === String(proyectoId));
  return p?.nombre || `(proyecto ${proyectoId})`;
}

// B7: detecta si hay una versión anterior rechazada/huérfana del mismo origen con monto distinto.
function _calcularDesfase(item) {
  if (!['recibido', 'pendiente', 'en_revision'].includes(item.estado)) return null;
  const montoActual = Number(item?.monto?.importe) || 0;
  if (!montoActual) return null;
  const srcKey = item.tipo === 'estimacion_subcontratista'
    ? `${item.obraId}::${item.tipo}::${item.subcontratoId}::${item.subEstimacionNumero}`
    : `${item.obraId}::${item.tipo}::${item.estimacionId}`;
  for (const [id, other] of Object.entries(_buzon.items)) {
    if (id === item.id || !['rechazado', 'huerfano'].includes(other?.estado)) continue;
    const otherKey = other.tipo === 'estimacion_subcontratista'
      ? `${other.obraId}::${other.tipo}::${other.subcontratoId}::${other.subEstimacionNumero}`
      : `${other.obraId}::${other.tipo}::${other.estimacionId}`;
    if (otherKey !== srcKey) continue;
    const otroMonto = Number(other?.monto?.importe) || 0;
    if (!otroMonto) continue;
    const delta = montoActual - otroMonto;
    if (Math.abs(delta / otroMonto) > 0.001) {
      return {
        delta,
        tooltip: `Versión anterior (${other.estado}): $${otroMonto.toLocaleString('es-MX',{minimumFractionDigits:2})} · Diferencia: $${Math.abs(delta).toLocaleString('es-MX',{minimumFractionDigits:2})}`
      };
    }
  }
  return null;
}

// ─── Acciones ──────────────────────────────────────────────────────────────

async function _marcarEnRevision(item) {
  const histKey = `${Date.now()}_rev`;
  await _dbRef(`/shared/buzon/${item.id}`).update({
    estado: 'en_revision',
    enRevisionAt: Date.now(),
    enRevisionPor: _currentUser?.uid || '',
    [`estadoHistorial/${histKey}`]: { estado: 'en_revision', at: Date.now(), por: _currentUser?.uid || 'system' }
  });
}

// aprobarYPagar=false → movimiento status 'Pendiente'
// aprobarYPagar=true  → modal de pago, movimiento status 'Pagado', estado cobrado/pagado
// Cuentas por pagar (gastos): folio CP, monto negativo, se "paga" (no se "cobra").
// Incluye subcontratista, OC de materiales e indirectos.
function _tipoEsCxP(tipo) {
  return tipo === 'estimacion_subcontratista' || tipo === 'oc_materiales' || tipo === 'gasto_indirecto'
      || tipo === 'gasto_oc' || tipo === 'carga_social'
      || (typeof tipo === 'string' && tipo.startsWith('nomina_'));
}

function _formaPagoLblCorto(fp) {
  return { credito: 'crédito', efectivo: 'efectivo', transferencia: 'transferencia', caja_chica: 'caja chica' }[fp] || fp || '';
}

// =====================================================
// Gasto de recepción de OC (app-materiales, tipo='gasto_oc').
// Self-contained: monto = total CON IVA, desglose por conceptoKey (SIN IVA).
// La forma de pago define la liquidación:
//   credito       → gasto POR PAGAR (status Pendiente).
//   efectivo      → gasto PAGADO, sale de la caja de efectivo (metodo_pago='efectivo').
//   transferencia → gasto PAGADO, sale de Mifel (metodo_pago='transferencia').
//   caja_chica    → gasto PAGADO desde el fondo de caja chica (paga_de_caja_chica).
// =====================================================
async function _aprobarGastoOC(item, aprobarYPagar = false) {
  const proyectoId = item.proyectoId || await _resolverProyectoIdPorObra(item.obraId);
  if (!proyectoId) {
    _toast('No hay proyecto vinculado a esta obra. Crea el link en /shared/obraLinks primero.', 'error');
    return;
  }

  const total = Number(item.total ?? item.monto) || 0;
  if (total <= 0) { _toast('Total inválido en el gasto de OC.', 'error'); return; }
  const subtotal = Number(item.subtotal) || total;
  const iva      = Number(item.iva) || Math.max(0, total - subtotal);
  const conIva   = iva > 0.005;

  const proveedorNombre = (item.proveedor || '').trim();
  const provDef = proveedorNombre ? _findOrCreateProveedor(proveedorNombre, { rfc: item.proveedorRfc || '' }) : null;

  // Desglose OPUS por conceptoKey (sin IVA; suma == subtotal).
  const { mapped, faltantes } = await _mapearDesgloseCajaChica(item.obraId, item.desglose);
  if (faltantes > 0) {
    if (!confirm(`⚠ ${faltantes} de ${(item.desglose || []).length} líneas no encontraron concepto OPUS. ¿Aprobar de todas formas? (esas líneas no se cargarán al desglose contable)`)) return;
  }

  const formaPago   = item.formaPago || 'credito';
  const esCredito   = formaPago === 'credito';
  const esCajaChica = formaPago === 'caja_chica';

  // Crédito nace 'Pendiente'; los demás nacen 'Pagado' (el dinero ya salió).
  // "Aprobar + Pagar" sobre un crédito pide datos de pago y lo marca pagado.
  let pagoData = null;
  if (esCredito && aprobarYPagar) {
    pagoData = await _modalDatosPago('pago');
    if (!pagoData) return;
  }
  const pagado = !esCredito || !!pagoData;

  let folio;
  try { folio = await _generarFolio('CP'); }
  catch (err) { _toast('Error al generar folio: ' + err.message, 'error'); return; }

  const fechaISO = pagoData?.fechaISO
    || (item.fecha ? new Date(item.fecha).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));

  // Forma de pago → de qué caja SOGRUB sale.
  let metodo_pago;
  if (esCajaChica)                        metodo_pago = undefined;       // sale del fondo de caja chica
  else if (formaPago === 'efectivo')      metodo_pago = 'efectivo';
  else if (formaPago === 'transferencia') metodo_pago = 'transferencia';
  else if (pagoData)                      metodo_pago = (pagoData.metodo === 'Efectivo') ? 'efectivo' : 'transferencia';
  else                                    metodo_pago = 'transferencia'; // crédito aún sin pagar

  const movimiento = {
    proyecto_id:    proyectoId,
    obraId:         item.obraId,
    fecha:          fechaISO,
    monto:          -Math.abs(total),
    concepto:       `[${folio}] Gasto OC ${item.folio ? item.folio + ' · ' : ''}${proveedorNombre || '(sin proveedor)'}${item.factura ? ' · F.' + item.factura : ''}`,
    subcontratista: proveedorNombre,
    status:         pagado ? 'Pagado' : 'Pendiente',
    tipo:           'gasto',
    categoria:      'Material',
    metodo_pago,
    paga_de_caja_chica: esCajaChica ? true : undefined,
    // Fondo de caja chica del que salió (item.fondo='efectivo' → fondo de
    // efectivo por obra; ausente → fondo transferencia). Solo informativo.
    fondo_caja:     esCajaChica && item.fondo === 'efectivo' ? 'efectivo' : undefined,
    forma_pago:     formaPago,
    origen_buzon_id: item.id,
    origen_recepcion_id: item.refRecepcionId || null,
    monto_subtotal: Math.abs(subtotal),
    monto_iva:      Math.abs(iva),
    incluye_iva:    conIva,
    proveedor_id:   provDef?.id || null,
    desglose_presupuesto: mapped.length ? mapped : undefined,
  };

  try {
    const created = addItem('sogrub_proy_movimientos', movimiento);
    const nuevoEstado = pagado ? 'pagado' : 'aprobado';
    const histKey = `${Date.now()}_apr_gasto_oc`;
    const buzonPatch = {
      estado:       nuevoEstado,
      folio,
      aprobadoAt:   Date.now(),
      aprobadoPor:  _currentUser?.uid || '',
      movId:        created.id,
      destinoRefPath: `sogrub_proy_movimientos[id=${created.id}]`,
      huerfanoAt:   null, huerfanoPor: null, descripcionHuerfano: null,
      [`estadoHistorial/${histKey}`]: { estado: nuevoEstado, at: Date.now(), por: _currentUser?.uid || '' },
    };
    if (pagado) {
      const metodoLbl = pagoData?.metodo
        || ({ efectivo: 'Efectivo', transferencia: 'Transferencia', caja_chica: 'Caja chica' })[formaPago]
        || 'Pagado';
      buzonPatch.pagadoAt       = pagoData?.fecha || Date.now();
      buzonPatch.metodoPago     = metodoLbl;
      buzonPatch.referenciaPago = pagoData?.referencia || null;
      const histKeyPago = `${Date.now() + 1}_pago`;
      buzonPatch[`estadoHistorial/${histKeyPago}`] = { estado: 'pagado', at: buzonPatch.pagadoAt, por: _currentUser?.uid || '', nota: metodoLbl };
    }

    const updates = { [`/shared/buzon/${item.id}`]: buzonPatch };
    // Espejo opcional en la recepción de materiales. _multiPathUpdate hace
    // .update(objeto) por nodo → merge de campos (no reemplaza el nodo).
    if (item.obraId && item.refRecepcionId) {
      updates[`/shared/materiales/${item.obraId}/recepciones/${item.refRecepcionId}`] = {
        estadoContable: nuevoEstado,
        folioContable:  folio,
        movIdContable:  created.id,
        actualizadoAt:  Date.now(),
      };
    }
    await _multiPathUpdate(updates);

    _buzon.expanded.delete(item.id);
    const desgloseExtra = mapped.length ? ` · ${mapped.length} conceptos OPUS` : (item.desglose?.length ? ' · ⚠ sin mapa OPUS' : '');
    _toast(`${folio} · Gasto OC $${total.toLocaleString('es-MX',{minimumFractionDigits:2})} ${pagado ? 'pagado' : 'por pagar'} (${_formaPagoLblCorto(formaPago)})${desgloseExtra}.`, 'success');
  } catch (err) {
    console.error('[Buzón gasto_oc]', err);
    _toast('Error al aprobar: ' + err.message, 'error');
  }
}

async function _aprobarItem(item, aprobarYPagar = false) {
  // Caja chica: rutas especializadas (ver _aprobarGastoCajaChica / _aprobarDepositoCajaChica)
  if (item.tipo === 'gasto_caja_chica')    return _aprobarGastoCajaChica(item);
  if (item.tipo === 'deposito_caja_chica') return _aprobarDepositoCajaChica(item);
  // OC de compras: trata como gasto categoria='Material' con desglose listo.
  if (item.tipo === 'oc_materiales')       return _aprobarOCMateriales(item, aprobarYPagar);
  // Gasto de recepción de OC (app-materiales): gasto categoria='Material',
  // liquidación según formaPago (crédito=por pagar; efectivo/transfer/caja chica=pagado).
  if (item.tipo === 'gasto_oc')            return _aprobarGastoOC(item, aprobarYPagar);
  // Indirectos (app-indirectos): gasto por obra / empresa, y nómina por período.
  if (item.tipo === 'gasto_indirecto')     return _aprobarGastoIndirecto(item, aprobarYPagar);
  if (typeof item.tipo === 'string' && item.tipo.startsWith('nomina_')) return _aprobarNomina(item);
  if (item.tipo === 'carga_social')        return _aprobarCargaSocial(item);
  // Orden de cambio: INFORMATIVA. No genera contable — una OC no es dinero que
  // entró o salió, es un cambio de presupuesto. El presupuesto vigente sale de
  // /shared/contratos, no de este item.
  if (item.tipo === 'orden_cambio')        return _aprobarOrdenCambio(item);

  // Resolvemos el proyecto contable (directo o vía obraLinks) para soportar items
  // que sólo traen obraId (p.ej. indirectos originados en materiales).
  const proyectoIdResuelto = _resolverProyectoIdItem(item);
  if (!proyectoIdResuelto) { _toast('Falta vincular la obra al proyecto contable.', 'error'); return; }

  const fechaISO = item.fecha
    ? new Date(item.fecha).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  let movimiento, nombrePill, folio;

  try {
    if (item.tipo === 'pago_cliente') {
      folio = await _generarFolio('CC');
      const conIva = item?.monto?.conIva !== false && (Number(item?.monto?.iva) || 0) > 0;
      movimiento = {
        proyecto_id:    proyectoIdResuelto,
        fecha:          fechaISO,
        monto:          Number(item?.monto?.importe) || 0,
        concepto:       `[${folio}] Pago Est. #${item.estimNumero ?? '?'} (${item.obraNombre || item.obraId || ''})${conIva ? '' : ' (sin IVA)'}`,
        subcontratista: '',
        status:         aprobarYPagar ? 'Pagado' : 'Pendiente',
        tipo:           'abono_cliente',
        origen_buzon_id: item.id,
        monto_subtotal: Number(item?.monto?.subtotal) || 0,
        monto_iva:      Number(item?.monto?.iva) || 0,
        incluye_iva:    conIva,
      };
      nombrePill = `${folio} · Abono $${movimiento.monto.toLocaleString('es-MX',{minimumFractionDigits:2})} registrado.`;

    } else if (item.tipo === 'estimacion_subcontratista') {
      folio = await _generarFolio('CP');
      const provNombre = (item.proveedorNombre || '').trim();
      if (!provNombre) { _toast('El item no tiene nombre de subcontratista.', 'error'); return; }
      const provDef = _findOrCreateProveedor(provNombre, { email: item.proveedorEmail || '', telefono: item.proveedorTelefono || '' });
      const importe  = Number(item?.monto?.importe) || 0;
      const conIva   = item?.monto?.conIva !== false && (Number(item?.monto?.iva) || 0) > 0;
      const desglose = await _mapearDesgloseAOpusBitacora(proyectoIdResuelto, item.desglose);
      movimiento = {
        proyecto_id:    proyectoIdResuelto,
        fecha:          fechaISO,
        monto:          -Math.abs(importe),
        concepto:       `[${folio}] Pago a ${provNombre} — "${item.subcontratoNombre || ''}" estim. #${item.subEstimacionNumero ?? '?'}${conIva ? '' : ' (sin IVA)'}`,
        subcontratista: provNombre,
        status:         aprobarYPagar ? 'Pagado' : 'Pendiente',
        tipo:           'gasto',
        categoria:      'Subcontratista',
        origen_buzon_id: item.id,
        monto_subtotal: Number(item?.monto?.subtotal) || 0,
        monto_iva:      Number(item?.monto?.iva) || 0,
        incluye_iva:    conIva,
        proveedor_id:   provDef?.id || null,
        desglose_presupuesto: desglose.length ? desglose : undefined,
      };
      const desgloseExtra = desglose.length
        ? ` · ${desglose.length} conceptos OPUS`
        : (item.desglose?.length ? ' · ⚠ sin mapa OPUS' : '');
      nombrePill = `${folio} · Gasto $${Math.abs(movimiento.monto).toLocaleString('es-MX',{minimumFractionDigits:2})} a ${provNombre}${provDef?._creado ? ' (nuevo proveedor)' : ''}.${desgloseExtra}`;

    } else {
      _toast('Tipo de buzón no soportado: ' + item.tipo, 'error');
      return;
    }
  } catch (err) {
    console.error('[Buzón aprobar prep]', err);
    _toast('Error al preparar aprobación: ' + err.message, 'error');
    return;
  }

  // Si es aprobar+pagar, pedir datos de pago antes de crear el movimiento
  let pagoData = null;
  if (aprobarYPagar) {
    pagoData = await _modalDatosPago((_tipoEsCxP(item.tipo)) ? 'pago' : 'cobro');
    if (!pagoData) return; // cancelado
  }

  try {
    const created       = addItem('sogrub_proy_movimientos', movimiento);
    const nuevoEstado   = aprobarYPagar
      ? ((item.tipo === 'estimacion_subcontratista' || item.tipo === 'gasto_indirecto') ? 'pagado' : 'cobrado')
      : 'aprobado';
    const histKeyApr    = `${Date.now()}_apr`;

    const updates = {
      estado:       nuevoEstado,
      folio,
      aprobadoAt:   Date.now(),
      aprobadoPor:  _currentUser?.uid || '',
      movId:        created.id,
      destinoRefPath: `sogrub_proy_movimientos[id=${created.id}]`,
      huerfanoAt:   null,
      huerfanoPor:  null,
      descripcionHuerfano: null,
      [`estadoHistorial/${histKeyApr}`]: { estado: nuevoEstado, at: Date.now(), por: _currentUser?.uid || '' }
    };

    if (pagoData) {
      const histKeyPago = `${Date.now() + 1}_pago`;
      const tsField     = nuevoEstado === 'cobrado' ? 'cobradoAt' : 'pagadoAt';
      updates[tsField]           = pagoData.fecha;
      updates['metodoPago']      = pagoData.metodo;
      updates['referenciaPago']  = pagoData.referencia || null;
      updates[`estadoHistorial/${histKeyPago}`] = {
        estado: nuevoEstado, at: pagoData.fecha, por: _currentUser?.uid || '',
        nota: `${pagoData.metodo}${pagoData.referencia ? ' ref:' + pagoData.referencia : ''}`
      };
      // Actualizar fecha en el movimiento recién creado si el usuario eligió otra fecha
      if (pagoData.fechaISO !== fechaISO) {
        updateItem('sogrub_proy_movimientos', created.id, { fecha: pagoData.fechaISO });
      }
    }

    await _dbRef(`/shared/buzon/${item.id}`).update(updates);
    _buzon.expanded.delete(item.id);
    _toast(nombrePill, 'success');
  } catch (err) {
    console.error('[Buzón aprobar]', err);
    _toast('Error al aprobar: ' + err.message, 'error');
  }
}

async function _marcarPagadoCobrado(item) {
  if (!item.movId) { _toast('No hay movimiento vinculado.', 'error'); return; }
  const esSub  = item.tipo === 'estimacion_subcontratista';
  const esOC   = item.tipo === 'oc_materiales';
  const esInd  = item.tipo === 'gasto_indirecto';
  const esGastoOC = item.tipo === 'gasto_oc';
  const esCxP  = esSub || esOC || esInd || esGastoOC;
  const pagoData = await _modalDatosPago(esCxP ? 'pago' : 'cobro');
  if (!pagoData) return;

  try {
    const movUpdates = { status: 'Pagado', fecha: pagoData.fechaISO };
    // gasto_oc a crédito: al pagarlo, define de qué caja salió (efectivo/Mifel).
    if (esGastoOC) movUpdates.metodo_pago = (pagoData.metodo === 'Efectivo') ? 'efectivo' : 'transferencia';
    updateItem('sogrub_proy_movimientos', item.movId, movUpdates);

    const nuevoEstado = esCxP ? 'pagado' : 'cobrado';
    const tsField     = nuevoEstado === 'cobrado' ? 'cobradoAt' : 'pagadoAt';
    const histKey     = `${Date.now()}_pago`;
    const buzonPatch = {
      estado:       nuevoEstado,
      [tsField]:    pagoData.fecha,
      metodoPago:   pagoData.metodo,
      referenciaPago: pagoData.referencia || null,
      [`estadoHistorial/${histKey}`]: {
        estado: nuevoEstado, at: pagoData.fecha, por: _currentUser?.uid || '',
        nota: `${pagoData.metodo}${pagoData.referencia ? ' ref:' + pagoData.referencia : ''}`
      }
    };
    const updates = { [`/shared/buzon/${item.id}`]: buzonPatch };
    if (esOC && item.obraId && item.ocId) {
      updates[`/shared/compras/obras/${item.obraId}/oc/${item.ocId}`] = {
        estado: 'pagada',
        pagadaAt: pagoData.fecha,
        metodoPago: pagoData.metodo,
        referenciaPago: pagoData.referencia || null,
        actualizadoAt: Date.now()
      };
    }
    if (esGastoOC && item.obraId && item.refRecepcionId) {
      updates[`/shared/materiales/${item.obraId}/recepciones/${item.refRecepcionId}`] = {
        estadoContable: 'pagado',
        pagadoAt:       pagoData.fecha,
        actualizadoAt:  Date.now(),
      };
    }
    await _multiPathUpdate(updates);
    _buzon.expanded.delete(item.id);
    _toast(`Marcado como ${nuevoEstado}.`, 'success');
  } catch (err) {
    _toast('Error: ' + err.message, 'error');
  }
}

async function _reabrirItem(item) {
  // Caja chica no tiene paso intermedio "Pendiente" — reabrir = volver a 'reportado'.
  if (item.tipo === 'gasto_caja_chica' || item.tipo === 'deposito_caja_chica') {
    return _reabrirItemCajaChica(item);
  }
  if (!confirm('¿Reabrir? El movimiento volverá a estado "Pendiente".')) return;
  try {
    if (item.movId) updateItem('sogrub_proy_movimientos', item.movId, { status: 'Pendiente' });
    const histKey = `${Date.now()}_reabrir`;
    const buzonPatch = {
      estado:       'aprobado',
      cobradoAt:    null,
      pagadoAt:     null,
      metodoPago:   null,
      referenciaPago: null,
      [`estadoHistorial/${histKey}`]: {
        estado: 'aprobado', at: Date.now(), por: _currentUser?.uid || '',
        nota: 'Reabierto desde ' + item.estado
      }
    };
    const updates = { [`/shared/buzon/${item.id}`]: buzonPatch };
    const ocMirror = _ocComprasMirrorPatch(item, 'aprobado', {
      pagadaAt: null, metodoPago: null, referenciaPago: null,
      reabiertaPorContador: true
    });
    if (ocMirror) Object.assign(updates, ocMirror);
    await _multiPathUpdate(updates);
    _buzon.expanded.delete(item.id);
    _toast('Item reabierto como Aprobado.', 'success');
  } catch (err) {
    _toast('Error al reabrir: ' + err.message, 'error');
  }
}

// Reabrir = borrar el movimiento contable creado al aprobar y devolver el
// item del buzón + el espejo en /shared/cajaChica al estado 'reportado'
// (gasto) o limpiar el asentamiento (depósito).
async function _reabrirItemCajaChica(item) {
  if (!confirm('¿Reabrir este movimiento de caja chica? Se eliminará el asentamiento contable y volverá a estado "reportado".')) return;
  try {
    if (item.movId) {
      // Borra el movimiento — el hook onDelete sincroniza el espejo a
      // 'reportado' automáticamente. (Ver firebase.js _syncCajaChicaMirrorOnDelete)
      if (item.tipo === 'gasto_caja_chica') {
        deleteItem('sogrub_proy_movimientos', item.movId);
      } else if (item.tipo === 'deposito_caja_chica') {
        // El egreso vive en Mifel (fondo transferencia) o en la caja física
        // de efectivo (fondo efectivo).
        deleteItem(item.fondo === 'efectivo' ? KEYS.EFECTIVO_MOV : 'sogrub_movimientos', item.movId);
        // Borrar también el egreso espejo del proyecto (si se asentó), para
        // que la caja del proyecto recupere el monto al deshacer el depósito.
        if (item.obraId && item.movimientoId) {
          try {
            const ccMov = (await _dbRef(`/shared/cajaChica/${item.obraId}/movimientos/${item.movimientoId}`).get()).val();
            if (ccMov?.asentadoProyectoMovId) deleteItem('sogrub_proy_movimientos', ccMov.asentadoProyectoMovId);
          } catch (e) { console.warn('[Buzón reabrir CC] espejo proyecto:', e); }
        }
      }
    }
    // El delete hook del firebase ya marca el buzón como 'huerfano' — sobreescribimos a 'recibido'
    // porque aquí la reapertura es intencional, no una pérdida.
    const histKey = `${Date.now()}_reabrir_cc`;
    const buzonPatch = {
      estado:       'recibido',
      aprobadoAt:   null,
      aprobadoPor:  null,
      huerfanoAt:   null,
      huerfanoPor:  null,
      descripcionHuerfano: null,
      movId:        null,
      [`estadoHistorial/${histKey}`]: {
        estado: 'recibido', at: Date.now(), por: _currentUser?.uid || '',
        nota: 'Reabierto desde ' + item.estado + ' (caja chica)'
      }
    };
    const updates = { [`/shared/buzon/${item.id}`]: buzonPatch };
    if (item.obraId && item.movimientoId) {
      const ccPatch = item.tipo === 'gasto_caja_chica'
        ? { estado: 'reportado', aprobadoAt: null, aprobadoPor: null, actualizadoAt: Date.now() }
        : { estado: 'solicitado', pendienteAsentar: true, asentadoAt: null, asentadoBancarioId: null,
            asentadoProyectoMovId: null, folioBancario: null, actualizadoAt: Date.now() };
      updates[`/shared/cajaChica/${item.obraId}/movimientos/${item.movimientoId}`] = ccPatch;
    }
    await _multiPathUpdate(updates);
    _buzon.expanded.delete(item.id);
    _toast('Movimiento reabierto. Vuelve a estado reportado.', 'success');
  } catch (err) {
    console.error('[Buzón reabrir CC]', err);
    _toast('Error al reabrir: ' + err.message, 'error');
  }
}

async function _rechazarItem(item) {
  // Modal propio en vez de prompt(): los diálogos nativos se suprimen tras
  // varios usos en la misma sesión y a veces no aparecen (era el bug de "no
  // deja rechazar").
  const wrap = document.createElement('div');
  const lbl  = document.createElement('p');
  lbl.textContent = 'Motivo del rechazo (visible en la app de origen):';
  lbl.style.cssText = 'margin:0 0 8px;color:var(--text-muted);font-size:13px';
  const ta = document.createElement('textarea');
  ta.placeholder = 'Opcional…';
  ta.style.cssText = 'width:100%;min-height:90px;padding:8px 10px;border-radius:6px;background:var(--surface,#1d222b);color:var(--text-0,#e6e9ef);border:1px solid var(--border,#2d3340);font-family:inherit;font-size:14px;resize:vertical';
  wrap.appendChild(lbl); wrap.appendChild(ta);

  openModal({
    title: 'Rechazar solicitud',
    body: wrap,
    confirmText: 'Rechazar',
    cancelText: 'Cancelar',
    onConfirm: async () => {
      const motivo = (ta.value || '').trim();
      closeModal();
      await _ejecutarRechazo(item, motivo);
    }
  });
  setTimeout(() => ta.focus(), 50);
}

async function _ejecutarRechazo(item, motivo) {
  try {
    const histKey = `${Date.now()}_rech`;
    const buzonPatch = {
      estado:             'rechazado',
      rechazadoAt:        Date.now(),
      rechazadoPor:       _currentUser?.uid || '',
      comentarioRechazo:  motivo || '',
      [`estadoHistorial/${histKey}`]: {
        estado: 'rechazado', at: Date.now(), por: _currentUser?.uid || '', nota: motivo || ''
      }
    };
    // Multi-path update: si es caja chica, también actualizar el espejo en
    // /shared/cajaChica/{obraId}/movimientos/{movimientoId} para que el
    // saldo conciliado y el estado en materiales queden sincronizados.
    const updates = { [`/shared/buzon/${item.id}`]: buzonPatch };
    if ((item.tipo === 'gasto_caja_chica' || item.tipo === 'deposito_caja_chica')
        && item.obraId && item.movimientoId) {
      updates[`/shared/cajaChica/${item.obraId}/movimientos/${item.movimientoId}`] = {
        estado: 'rechazado',
        rechazadoAt: Date.now(),
        rechazadoPor: { uid: _currentUser?.uid || '', email: _currentUser?.email || '' },
        motivoRechazo: motivo || '',
        actualizadoAt: Date.now()
      };
    }
    // Espejo OC compras
    const ocMirror = _ocComprasMirrorPatch(item, 'rechazado', {
      rechazadaAt: Date.now(),
      motivoRechazo: motivo || '',
      rechazadaPor: { uid: _currentUser?.uid || '', email: _currentUser?.email || '' }
    });
    if (ocMirror) Object.assign(updates, ocMirror);
    await _multiPathUpdate(updates);
    _buzon.expanded.delete(item.id);
    _toast('Item rechazado.', 'success');
  } catch (err) {
    _toast('Error al rechazar: ' + err.message, 'error');
  }
}

// Helper: aplica varios update() bajo distintos paths absolutos. Firebase RTDB
// soporta multi-path update solo si comparten root; aquí los ejecuto en
// paralelo, individualmente. Atomicidad relajada (best-effort).
async function _multiPathUpdate(updates) {
  await Promise.all(Object.entries(updates).map(([path, patch]) => {
    // .update() exige un OBJETO (merge de campos). Para valores primitivos
    // (string/number/null) hay que usar .set() sobre la hoja, si no Firebase
    // lanza "values argument must be an object".
    const esObjeto = patch !== null && typeof patch === 'object' && !Array.isArray(patch);
    return esObjeto ? _dbRef(path).update(patch) : _dbRef(path).set(patch);
  }));
}

// Helper: para items del buzón con tipo='oc_materiales', construye el patch
// del espejo en /shared/compras/obras/{obraId}/oc/{ocId} con el estado
// equivalente. La OC espejo usa nombres de estado distintos al buzón
// (aprobada/pagada/cerrada/rechazada/cancelada) — esta función los traduce.
function _ocComprasMirrorPatch(item, estadoBuzon, extra = {}) {
  if (item.tipo !== 'oc_materiales' || !item.obraId || !item.ocId) return null;
  const estadoOC = ({
    aprobado: 'aprobada',
    pagado:   'pagada',
    cobrado:  'pagada',     // n/a para OC pero por simetría
    cerrado:  'cerrada',
    rechazado:'rechazada',
    huerfano: 'huerfana',
    en_revision: 'enviada_buzon',
    recibido:    'enviada_buzon'
  })[estadoBuzon] || estadoBuzon;
  return {
    [`/shared/compras/obras/${item.obraId}/oc/${item.ocId}`]: {
      estado: estadoOC,
      actualizadoAt: Date.now(),
      ...extra
    }
  };
}

async function _cerrarItem(item) {
  if (!confirm('¿Cerrar este item? Quedará archivado.')) return;
  try {
    const histKey = `${Date.now()}_cerr`;
    const buzonPatch = {
      estado:    'cerrado',
      cerradoAt: Date.now(),
      cerradoPor: _currentUser?.uid || '',
      [`estadoHistorial/${histKey}`]: { estado: 'cerrado', at: Date.now(), por: _currentUser?.uid || '' }
    };
    const updates = { [`/shared/buzon/${item.id}`]: buzonPatch };
    const ocMirror = _ocComprasMirrorPatch(item, 'cerrado', { cerradaAt: Date.now() });
    if (ocMirror) Object.assign(updates, ocMirror);
    await _multiPathUpdate(updates);
    _buzon.expanded.delete(item.id);
    _toast('Item cerrado.', 'success');
  } catch (err) {
    _toast('Error al cerrar: ' + err.message, 'error');
  }
}

// ─── Indirectos: gasto por obra / empresa + nómina ─────────────────────────

// Patch estándar de un item de buzón que pasa a 'aprobado', apuntando al
// movimiento creado. Reutilizado por los aprobadores de indirectos/nómina.
function _buzonPatchAprobado(folio, movId, coleccion) {
  const now = Date.now();
  const histKey = `${now}_apr`;
  return {
    estado:       'aprobado',
    folio,
    aprobadoAt:   now,
    aprobadoPor:  _currentUser?.uid || '',
    movId,
    destinoRefPath: `${coleccion}[id=${movId}]`,
    huerfanoAt:   null, huerfanoPor: null, descripcionHuerfano: null,
    [`estadoHistorial/${histKey}`]: { estado: 'aprobado', at: now, por: _currentUser?.uid || '' }
  };
}

// Gasto indirecto (app-indirectos). Dos casos:
//  · obra   → sogrub_proy_movimientos { tipo:'gasto', categoria:'Indirecto' } (folio CP).
//  · empresa (empresa:true o sin obraId) → egreso directo de Mifel (sogrub_movimientos).
async function _aprobarGastoIndirecto(item, aprobarYPagar = false) {
  const importe = Number(item?.monto?.importe) || 0;
  if (importe <= 0) { _toast('Monto inválido en el gasto indirecto.', 'error'); return; }
  const conIva      = item?.monto?.conIva !== false && (Number(item?.monto?.iva) || 0) > 0;
  const fechaISO    = item.fecha ? new Date(item.fecha).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const conceptoTxt = item.concepto || item.descripcion || 'gasto indirecto';
  const provNombre  = (item.proveedorNombre || '').trim();
  const provDef     = provNombre ? _findOrCreateProveedor(provNombre, {}) : null;
  const esEmpresa   = item.empresa === true || !item.obraId;

  let folio;
  try { folio = await _generarFolio('CP'); }
  catch (err) { _toast('Error al generar folio: ' + err.message, 'error'); return; }

  // Forma de pago (opcional; indirectos puede mandar formaPago/metodoPago).
  // 'efectivo' → sale de la CAJA DE EFECTIVO; cualquier otra cosa → Mifel.
  const _fp = item.formaPago || item.metodoPago || '';
  const metodoPago = _fp === 'efectivo' ? 'efectivo' : (_fp === 'transferencia' ? 'transferencia' : undefined);

  // ── Empresa / sin obra → egreso de Mifel (o de efectivo), no toca proyecto ──
  if (esEmpresa) {
    const movMifel = {
      fecha:          fechaISO,
      monto:          -Math.abs(importe),
      concepto:       `[${folio}] Indirecto empresa — ${conceptoTxt}${conIva ? '' : ' (sin IVA)'}`,
      status:         'Pagado',
      tipo:           'gasto',
      categoria:      'Indirecto',
      empresa:        true,
      metodo_pago:    metodoPago,   // 'efectivo' → sale de la caja de efectivo, no de Mifel
      subcontratista: provNombre,
      proveedor_id:   provDef?.id || null,
      monto_subtotal: Number(item?.monto?.subtotal) || 0,
      monto_iva:      Number(item?.monto?.iva) || 0,
      incluye_iva:    conIva,
      gasto_indirecto_id: item.gastoId || null,
      origen_buzon_id: item.id,
    };
    try {
      const created = addItem('sogrub_movimientos', movMifel);
      await _dbRef(`/shared/buzon/${item.id}`).update(_buzonPatchAprobado(folio, created.id, 'sogrub_movimientos'));
      _buzon.expanded.delete(item.id);
      _toast(`${folio} · Indirecto empresa $${importe.toLocaleString('es-MX',{minimumFractionDigits:2})} ${metodoPago === 'efectivo' ? 'pagado de efectivo' : 'asentado en Mifel'}.`, 'success');
    } catch (err) { console.error('[Buzón indirecto empresa]', err); _toast('Error al aprobar: ' + err.message, 'error'); }
    return;
  }

  // ── Obra → gasto del proyecto (categoria Indirecto) ──
  const proyectoId = item.proyectoId || await _resolverProyectoIdPorObra(item.obraId);
  if (!proyectoId) { _toast('No hay proyecto vinculado a esta obra. Crea el link en /shared/obraLinks primero.', 'error'); return; }

  // Desglose OPUS por conceptoKey (opcional, un solo concepto).
  let desglose;
  if (item.conceptoKey) {
    try {
      const snap = await _dbRef(`/shared/catalogos/${item.obraId}/conceptos`).get();
      if (snap.val()?.[item.conceptoKey]) {
        desglose = [{ concepto_id: item.conceptoKey, importe: Number(item?.monto?.subtotal) || importe }];
      }
    } catch (e) { console.warn('[Buzón indirecto] catálogo:', e); }
  }

  // Etiqueta de obra legible: nombre de la obra o del proyecto contable.
  // Nunca el obraId crudo (clave Firebase tipo -OweAtheZ475fTLhZOEm).
  const obraLabel = (item.obraNombre || _obtenerNombreProyecto(proyectoId) || '').trim();

  const movimiento = {
    proyecto_id:    proyectoId,
    obraId:         item.obraId,
    fecha:          fechaISO,
    monto:          -Math.abs(importe),
    concepto:       `[${folio}] Indirecto — ${conceptoTxt}${obraLabel ? ` (${obraLabel})` : ''}${conIva ? '' : ' (sin IVA)'}`,
    subcontratista: provNombre,
    status:         aprobarYPagar ? 'Pagado' : 'Pendiente',
    tipo:           'gasto',
    categoria:      'Indirecto',
    // Ámbito enviado por indirectos → alimenta la bolsita oficina/campo.
    indirecto_ambito: item.ambito === 'campo' ? 'campo' : 'oficina',
    metodo_pago:    metodoPago,   // 'efectivo' → figura en la caja de efectivo
    gasto_indirecto_id: item.gastoId || null,
    origen_buzon_id: item.id,
    monto_subtotal: Number(item?.monto?.subtotal) || 0,
    monto_iva:      Number(item?.monto?.iva) || 0,
    incluye_iva:    conIva,
    proveedor_id:   provDef?.id || null,
    desglose_presupuesto: desglose,
  };
  try {
    const created = addItem('sogrub_proy_movimientos', movimiento);
    await _dbRef(`/shared/buzon/${item.id}`).update(_buzonPatchAprobado(folio, created.id, 'sogrub_proy_movimientos'));
    _buzon.expanded.delete(item.id);
    _toast(`${folio} · Indirecto $${importe.toLocaleString('es-MX',{minimumFractionDigits:2})} en ${item.obraNombre || 'obra'}.`, 'success');
  } catch (err) { console.error('[Buzón indirecto obra]', err); _toast('Error al aprobar: ' + err.message, 'error'); }
}

// Nómina de un período cerrado (tipo 'nomina_*'). Genera:
//  · N sogrub_proy_movimientos por prorrateoPorObra — se registran como gastos
//    normales de cada obra: bajan la caja del proyecto Y bajan Mifel una sola
//    vez (el dinero sí sale del banco), igual que cualquier gasto de proyecto.
//    NO se crea un egreso separado en Caja SOGRUB por el neto: la nómina vive
//    en la obra y SOGRUB queda independiente (respaldo).
//  · netoSinObra (parte no atribuible a ninguna obra) + partes de obras SIN
//    proyecto vinculado → un egreso de empresa en Mifel (Caja SOGRUB).
// Categoría por tipoPersonal: operativo/técnico-campo → 'Mano de Obra';
// técnico-oficina/directivo → 'Indirecto'.
async function _aprobarNomina(item) {
  const neto = Number(item?.monto?.importe) || Number(item.totalNeto) || 0;
  if (neto <= 0) { _toast('Nómina con neto total inválido.', 'error'); return; }
  const fechaISO  = item.fechaCorteISO || item.fecha || new Date().toISOString().slice(0, 10);
  const CAT_POR_PERSONAL = { operativo: 'Mano de Obra', tecnico_campo: 'Mano de Obra', tecnico_oficina: 'Indirecto', directivo: 'Indirecto' };
  const categoria = CAT_POR_PERSONAL[item.tipoPersonal] || 'Indirecto';
  const label     = item.label || item.concepto || 'nómina';

  let folio;
  try { folio = await _generarFolio('CP'); }
  catch (err) { _toast('Error al generar folio: ' + err.message, 'error'); return; }

  // Prorrateo por obra → gastos de proyecto normales (bajan Mifel y caja de obra).
  const prorrateo = item.prorrateoPorObra || {};
  const proyMovs = [];
  const sinVincular = [];
  let montoSinVincular = 0;
  for (const [obraId, netoObra] of Object.entries(prorrateo)) {
    const monto = Number(netoObra) || 0;
    if (monto <= 0) continue;
    // Prefiere el proyecto que indirectos ya resolvió; si no, obraLinks.
    const proyectoId = (item.proyectoPorObra && item.proyectoPorObra[obraId]) || await _resolverProyectoIdPorObra(obraId);
    if (!proyectoId) { sinVincular.push(obraId); montoSinVincular += monto; continue; }
    proyMovs.push({
      proyecto_id:  proyectoId,
      obraId,
      fecha:        fechaISO,
      monto:        -Math.abs(monto),
      concepto:     `[${folio}] Nómina ${item.tipoPersonal || ''} · ${label} (prorrateo)`,
      status:       'Pagado',
      tipo:         'gasto',
      categoria,
      nomina_periodo_id: item.periodoId || null,
      origen_buzon_id: item.id,
    });
  }

  // Parte que va a Caja SOGRUB (empresa): overhead sin obra + obras no vinculadas.
  const montoEmpresa = (Number(item.netoSinObra) || 0) + montoSinVincular;

  if (!proyMovs.length && montoEmpresa <= 0) {
    _toast('La nómina no tiene prorrateo a obras ni parte de empresa que asentar.', 'error');
    return;
  }
  if (sinVincular.length && !confirm(`⚠ ${sinVincular.length} obra(s) del prorrateo no tienen proyecto vinculado: su parte ($${montoSinVincular.toLocaleString('es-MX',{minimumFractionDigits:2})}) se cargará como egreso de empresa (Caja SOGRUB) en vez de a la obra. ¿Procesar de todas formas?`)) return;

  try {
    let refMovId = null, refColeccion = 'sogrub_proy_movimientos';
    for (const m of proyMovs) { const c = addItem('sogrub_proy_movimientos', m); if (!refMovId) refMovId = c.id; }
    if (montoEmpresa > 0) {
      const createdMifel = addItem('sogrub_movimientos', {
        fecha:          fechaISO,
        monto:          -Math.abs(montoEmpresa),
        concepto:       `[${folio}] Nómina ${item.tipoPersonal || ''} · ${label} (empresa)`,
        status:         'Pagado',
        tipo:           'nomina',
        categoria,
        empresa:        true,
        nomina_periodo_id: item.periodoId || null,
        tipo_personal:  item.tipoPersonal || null,
        num_empleados:  item.numEmpleados || null,
        total_percepciones: item.totalPercepciones || null,
        total_deducciones:  item.totalDeducciones || null,
        origen_buzon_id: item.id,
      });
      if (!refMovId) { refMovId = createdMifel.id; refColeccion = 'sogrub_movimientos'; }
    }
    await _dbRef(`/shared/buzon/${item.id}`).update(_buzonPatchAprobado(folio, refMovId, refColeccion));
    _buzon.expanded.delete(item.id);
    _toast(`${folio} · Nómina $${neto.toLocaleString('es-MX',{minimumFractionDigits:2})} · ${proyMovs.length} obra(s)${montoEmpresa > 0 ? ' + empresa' : ''}.`, 'success');
  } catch (err) { console.error('[Buzón nómina]', err); _toast('Error al procesar nómina: ' + err.message, 'error'); }
}

// Carga social (IMSS/Infonavit) — mismo patrón que nómina: los gastos de cada
// obra son gastos de proyecto normales (bajan Mifel una vez + caja de la obra).
// Sólo la parte de obras SIN proyecto vinculado va a Caja SOGRUB (empresa).
// Categoría: clasificacion 'directo' → 'Mano de Obra'; si no → 'Indirecto'.
async function _aprobarCargaSocial(item) {
  const neto = Number(item?.monto?.importe) || 0;
  if (neto <= 0) { _toast('Carga social con importe inválido.', 'error'); return; }
  const fechaISO  = item.fecha || new Date().toISOString().slice(0, 10);
  const categoria = item.clasificacion === 'directo' ? 'Mano de Obra' : 'Indirecto';
  const ambito    = item.ambito === 'campo' ? 'campo' : 'oficina';

  let folio;
  try { folio = await _generarFolio('CP'); }
  catch (err) { _toast('Error al generar folio: ' + err.message, 'error'); return; }

  const prorrateo = item.prorrateoPorObra || {};
  const proyMovs = [];
  const sinVincular = [];
  let montoSinVincular = 0;
  for (const [obraId, montoObra] of Object.entries(prorrateo)) {
    const m = Number(montoObra) || 0;
    if (m <= 0) continue;
    const proyectoId = (item.proyectoPorObra && item.proyectoPorObra[obraId]) || await _resolverProyectoIdPorObra(obraId);
    if (!proyectoId) { sinVincular.push(obraId); montoSinVincular += m; continue; }
    proyMovs.push({
      proyecto_id:  proyectoId,
      obraId,
      fecha:        fechaISO,
      monto:        -Math.abs(m),
      concepto:     `[${folio}] Carga social${item.mes ? ' · ' + item.mes : ''} (prorrateo)`,
      status:       'Pagado',
      tipo:         'gasto',
      categoria,
      indirecto_ambito: categoria === 'Indirecto' ? ambito : undefined,
      carga_social_mes: item.mes || null,
      origen_buzon_id: item.id,
    });
  }

  // Parte que va a Caja SOGRUB (empresa): sólo obras no vinculadas.
  const montoEmpresa = montoSinVincular;

  if (!proyMovs.length && montoEmpresa <= 0) {
    _toast('La carga social no tiene prorrateo válido que asentar.', 'error');
    return;
  }
  if (sinVincular.length && !confirm(`⚠ ${sinVincular.length} obra(s) sin proyecto vinculado: su parte ($${montoSinVincular.toLocaleString('es-MX',{minimumFractionDigits:2})}) se cargará como egreso de empresa (Caja SOGRUB) en vez de a la obra. ¿Procesar de todas formas?`)) return;

  try {
    let refMovId = null, refColeccion = 'sogrub_proy_movimientos';
    for (const m of proyMovs) { const c = addItem('sogrub_proy_movimientos', m); if (!refMovId) refMovId = c.id; }
    if (montoEmpresa > 0) {
      const createdMifel = addItem('sogrub_movimientos', {
        fecha:          fechaISO,
        monto:          -Math.abs(montoEmpresa),
        concepto:       `[${folio}] ${item.concepto || 'Carga social'}${item.mes ? ' · ' + item.mes : ''} (empresa)`,
        status:         'Pagado',
        tipo:           'carga_social',
        categoria,
        empresa:        true,
        carga_social_mes:  item.mes || null,
        incluye_infonavit: !!item.incluyeInfonavit,
        origen_buzon_id: item.id,
      });
      if (!refMovId) { refMovId = createdMifel.id; refColeccion = 'sogrub_movimientos'; }
    }
    await _dbRef(`/shared/buzon/${item.id}`).update(_buzonPatchAprobado(folio, refMovId, refColeccion));
    _buzon.expanded.delete(item.id);
    _toast(`${folio} · Carga social $${neto.toLocaleString('es-MX',{minimumFractionDigits:2})} · ${proyMovs.length} obra(s)${montoEmpresa > 0 ? ' + empresa' : ''}.`, 'success');
  } catch (err) { console.error('[Buzón carga social]', err); _toast('Error al procesar carga social: ' + err.message, 'error'); }
}

// ─── Folio atómico ─────────────────────────────────────────────────────────

async function _generarFolio(tipo) {
  const año        = new Date().getFullYear();
  const counterKey = tipo === 'CC' ? 'cuentas_cobrar' : 'cuentas_pagar';
  const ref        = _dbRef(`/legacy/bitacora/_counters/${counterKey}/${año}`);
  let numero;
  await ref.transaction(current => { numero = (current || 0) + 1; return numero; });
  return `${tipo}-${año}-${String(numero).padStart(3, '0')}`;
}

// ─── Modal datos de pago ───────────────────────────────────────────────────

function _modalDatosPago(modo) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999';
    const hoy = new Date().toISOString().slice(0, 10);
    overlay.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:24px;width:min(480px,90%)">
        <h3 style="margin:0 0 16px">Datos de ${modo === 'pago' ? 'pago' : 'cobro'}</h3>
        <div style="display:flex;flex-direction:column;gap:12px">
          <label style="font-size:13px">Fecha
            <input type="date" id="mp-fecha" value="${hoy}"
              style="margin-top:4px;display:block;width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">
          </label>
          <label style="font-size:13px">Método
            <select id="mp-metodo"
              style="margin-top:4px;display:block;width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">
              <option>Transferencia</option><option>SPEI</option><option>Cheque</option>
              <option>Efectivo</option><option>Otro</option>
            </select>
          </label>
          <label style="font-size:13px">Referencia (opcional)
            <input type="text" id="mp-ref" placeholder="Folio SPEI, num. cheque, etc."
              style="margin-top:4px;display:block;width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">
          </label>
        </div>
        <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end">
          <button id="mp-cancel" style="background:transparent;border:1px solid var(--border);border-radius:6px;padding:8px 16px;color:var(--text);cursor:pointer">Cancelar</button>
          <button id="mp-ok" style="background:#5dd39e;color:#0e3a25;border:none;border-radius:6px;padding:8px 16px;font-weight:600;cursor:pointer">Confirmar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const cleanup = (result) => { document.body.removeChild(overlay); resolve(result); };
    overlay.querySelector('#mp-cancel').addEventListener('click', () => cleanup(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(null); });
    overlay.querySelector('#mp-ok').addEventListener('click', () => {
      const fechaStr = overlay.querySelector('#mp-fecha').value;
      const fecha    = new Date(fechaStr + 'T12:00:00').getTime();
      cleanup({ fecha, fechaISO: fechaStr, metodo: overlay.querySelector('#mp-metodo').value, referencia: overlay.querySelector('#mp-ref').value.trim() });
    });
  });
}

// ─── Desglose OPUS ─────────────────────────────────────────────────────────

async function _mapearDesgloseAOpusBitacora(proyectoId, desglose) {
  if (!Array.isArray(desglose) || !desglose.length || !proyectoId) return [];
  let obraId = null;
  try {
    const snap = await _dbRef('/shared/obraLinks').get();
    const links = snap.val() || {};
    obraId = Object.entries(links).find(([, pid]) => pid === proyectoId)?.[0] || null;
  } catch (e) { console.warn('[Buzón] obraLinks:', e); return []; }
  if (!obraId) return [];
  let conceptos = null;
  try {
    const snap = await _dbRef(`/shared/catalogos/${obraId}/conceptos`).get();
    conceptos = snap.val();
  } catch (e) { console.warn('[Buzón] shared/catalogos:', e); return []; }
  if (!conceptos) return [];
  const byClave = new Map();
  for (const [key, c] of Object.entries(conceptos)) {
    if (c?.tipo !== 'precio_unitario' || c?.archivado) continue;
    const k = (c.clave || '').trim();
    if (k && !byClave.has(k)) byClave.set(k, key);
  }
  const out = [];
  for (const linea of desglose) {
    const k = (linea.clave || '').trim();
    const conceptoKey = k && byClave.get(k);
    const importe     = Number(linea.importe) || 0;
    if (conceptoKey && importe > 0) out.push({ concepto_id: conceptoKey, importe });
  }
  return out;
}

// ─── Caja chica ────────────────────────────────────────────────────────────
//
// Tipos del buzón originados desde app-materiales:
//   - gasto_caja_chica     → recepción de almacén pagada con caja chica.
//   - deposito_caja_chica  → depósito por transferencia desde Mifel a la caja
//                            (los depósitos en efectivo no se publican).
//
// Aprobar gasto:    crear sogrub_proy_movimientos {tipo:'gasto', categoria:'Caja chica'}.
// Aprobar depósito: crear sogrub_movimientos {tipo:'deposito_caja_chica'} (egreso de Mifel).
// En ambos casos: multi-path update del buzón + espejo en /shared/cajaChica.
//
// Estas funciones están exportadas implícitamente al scope global para que la
// vista por proyecto (caja-chica.js) pueda invocarlas desde la fila de la tabla.

async function _resolverProyectoIdPorObra(obraId) {
  if (!obraId) return null;
  try {
    const snap = await _dbRef(`/shared/obraLinks/${obraId}`).get();
    return snap.exists() ? snap.val() : null;
  } catch (e) { console.warn('[Buzón] obraLinks lookup:', e); return null; }
}

// Mapea el desglose de un gasto_caja_chica al shape de bitácora
// `[{concepto_id, importe}]`. El payload de materiales ya incluye conceptoKey
// (la clave del catálogo /shared/catalogos/{obraId}/conceptos), así que solo
// validamos su existencia.
async function _mapearDesgloseCajaChica(obraId, desglose) {
  if (!Array.isArray(desglose) || !desglose.length || !obraId) return { mapped: [], faltantes: 0 };
  let conceptos = null;
  try {
    const snap = await _dbRef(`/shared/catalogos/${obraId}/conceptos`).get();
    conceptos = snap.val();
  } catch (e) { console.warn('[Buzón] shared/catalogos:', e); return { mapped: [], faltantes: desglose.length }; }
  const mapped = [];
  let faltantes = 0;
  for (const d of desglose) {
    const ck = d.conceptoKey;
    const importe = Number(d.monto) || 0;
    if (importe <= 0) continue;
    if (ck && conceptos?.[ck]) {
      mapped.push({ concepto_id: ck, importe });
    } else {
      faltantes++;
    }
  }
  return { mapped, faltantes };
}

// Modal de traspaso: el contador elige con qué CATEGORÍA contable entra el
// gasto de caja chica a la bitácora (default Material). Si es Indirecto, pide
// el ámbito (oficina/campo). Devuelve {categoria, indirectoAmbito} o null.
function _modalCategoriaGastoCC(item) {
  return new Promise(resolve => {
    const cats = (typeof CATEGORIAS !== 'undefined' ? CATEGORIAS : ['Material', 'Mano de Obra', 'Subcontratista', 'Indirecto']);
    const importe = Number(item.monto) || 0;
    // La app de origen puede sugerir la categoría/ámbito (p. ej. indirectos manda
    // categoriaSugerida:'Indirecto'). Si no, default Material.
    const catSug = cats.includes(item.categoriaSugerida) ? item.categoriaSugerida : 'Material';
    const ambSug = item.ambitoSugerido === 'campo' ? 'campo' : 'oficina';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999';
    overlay.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:24px;width:min(460px,90%)">
        <h3 style="margin:0 0 6px">Traspaso a bitácora</h3>
        <p style="margin:0 0 16px;font-size:12px;color:var(--text-muted)">
          ${(item.concepto || item.proveedor || 'Gasto de caja chica')} · $${importe.toLocaleString('es-MX', {minimumFractionDigits:2})}
        </p>
        <div style="display:flex;flex-direction:column;gap:12px">
          <label style="font-size:13px">Categoría contable
            <select id="cc-cat" style="margin-top:4px;display:block;width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">
              ${cats.map(c => `<option value="${c}"${c === catSug ? ' selected' : ''}>${c}</option>`).join('')}
            </select>
          </label>
          <label id="cc-amb-wrap" style="font-size:13px;display:${catSug === 'Indirecto' ? 'block' : 'none'}">Ámbito del indirecto
            <select id="cc-amb" style="margin-top:4px;display:block;width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px">
              <option value="oficina"${ambSug === 'oficina' ? ' selected' : ''}>🏢 Oficina</option>
              <option value="campo"${ambSug === 'campo' ? ' selected' : ''}>🚧 Campo</option>
            </select>
          </label>
        </div>
        <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end">
          <button id="cc-cancel" style="background:transparent;border:1px solid var(--border);border-radius:6px;padding:8px 16px;color:var(--text);cursor:pointer">Cancelar</button>
          <button id="cc-ok" style="background:#5dd39e;color:#0e3a25;border:none;border-radius:6px;padding:8px 16px;font-weight:600;cursor:pointer">Aprobar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const catSel = overlay.querySelector('#cc-cat');
    const ambWrap = overlay.querySelector('#cc-amb-wrap');
    catSel.addEventListener('change', () => { ambWrap.style.display = catSel.value === 'Indirecto' ? 'block' : 'none'; });
    const cleanup = (r) => { document.body.removeChild(overlay); resolve(r); };
    overlay.querySelector('#cc-cancel').addEventListener('click', () => cleanup(null));
    overlay.addEventListener('click', e => { if (e.target === overlay) cleanup(null); });
    overlay.querySelector('#cc-ok').addEventListener('click', () => {
      cleanup({ categoria: catSel.value, indirectoAmbito: overlay.querySelector('#cc-amb').value });
    });
  });
}

async function _aprobarGastoCajaChica(item) {
  // Resolver proyectoId
  const proyectoId = item.proyectoId || await _resolverProyectoIdPorObra(item.obraId);
  if (!proyectoId) {
    _toast('No hay proyecto vinculado a esta obra. Crea el link en /shared/obraLinks primero.', 'error');
    return;
  }

  const importe = Number(item.monto) || 0;
  if (importe <= 0) { _toast('Monto inválido.', 'error'); return; }

  // Mapear desglose contra catálogo
  const { mapped, faltantes } = await _mapearDesgloseCajaChica(item.obraId, item.desglose);

  if (faltantes > 0) {
    if (!confirm(`⚠ ${faltantes} de ${item.desglose.length} líneas no encontraron concepto OPUS en el catálogo. ¿Aprobar de todas formas? (esas líneas no se cargarán al desglose contable)`)) {
      return;
    }
  }

  // El contador traduce el gasto al lenguaje de la bitácora: elige categoría
  // (y ámbito si es Indirecto). Default Material.
  const traspaso = await _modalCategoriaGastoCC(item);
  if (!traspaso) return; // cancelado

  let folio;
  try { folio = await _generarFolio('CP'); }
  catch (err) { _toast('Error al generar folio: ' + err.message, 'error'); return; }

  // Tickets de caja chica suelen traer IVA mexicano del 16% bruto. La app de
  // origen puede marcar incluyeIva:false (viáticos, gastos sin comprobante…).
  const conIva = item.incluyeIva !== false;
  const subtotal = conIva ? importe / 1.16 : importe;
  const iva = conIva ? importe - subtotal : 0;

  const proveedorNombre = (item.proveedor || '').trim();
  const provDef = proveedorNombre
    ? _findOrCreateProveedor(proveedorNombre, {})
    : null;

  const fechaISO = item.fecha
    ? new Date(item.fecha).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const movimiento = {
    proyecto_id:    proyectoId,
    obraId:         item.obraId,
    movimiento_caja_chica_id: item.movimientoId,
    fecha:          fechaISO,
    monto:          -Math.abs(importe),
    concepto:       `[${folio}] Caja chica${item.fondo === 'efectivo' ? ' (efectivo)' : ''} · ${proveedorNombre || '(sin proveedor)'}${item.factura ? ' · F.' + item.factura : ''}${item.comentario ? ' · ' + item.comentario.slice(0, 60) : ''}`,
    subcontratista: proveedorNombre,
    status:         'Pagado',
    tipo:           'gasto',
    // Categoría elegida por el contador al aprobar (default Material). El
    // marcador de "vino de caja chica" es movimiento_caja_chica_id, no la
    // categoria — por eso puede ser cualquiera sin romper los hooks.
    categoria:      traspaso.categoria,
    indirecto_ambito: traspaso.categoria === 'Indirecto' ? traspaso.indirectoAmbito : undefined,
    // El gasto se pagó con caja chica → ya bajó saldo cuando se depositó.
    // calcSaldoCajaProyecto y calcSaldoMifel excluyen estos gastos para no
    // doble-contar. El monto sí cuenta para utilidad / total gastado / IVA.
    paga_de_caja_chica: true,
    // De qué fondo de la caja chica salió el dinero: 'efectivo' (fondo de
    // efectivo por obra) o ausente (fondo transferencia, el histórico).
    // Solo informativo/badge — el anti-doble-conteo es el mismo para ambos.
    fondo_caja:     item.fondo === 'efectivo' ? 'efectivo' : undefined,
    origen_buzon_id: item.id,
    monto_subtotal: subtotal,
    monto_iva:      iva,
    incluye_iva:    conIva,
    proveedor_id:   provDef?.id || null,
    desglose_presupuesto: mapped.length ? mapped : undefined,
    // Factura adjuntada antes de aprobar (subida desde el modal Ver recepción)
    factura_drive_url:   item.factura_drive_url   || null,
    factura_nombre:      item.factura_nombre      || null,
    factura_xml_url:     item.factura_xml_url     || null,
    factura_xml_nombre:  item.factura_xml_nombre  || null,
  };

  try {
    const created = addItem('sogrub_proy_movimientos', movimiento);
    const histKey = `${Date.now()}_apr_cc`;
    const buzonPatch = {
      estado:       'aprobado',
      folio,
      aprobadoAt:   Date.now(),
      aprobadoPor:  _currentUser?.uid || '',
      movId:        created.id,
      destinoRefPath: `sogrub_proy_movimientos[id=${created.id}]`,
      huerfanoAt:   null,
      huerfanoPor:  null,
      descripcionHuerfano: null,
      [`estadoHistorial/${histKey}`]: { estado: 'aprobado', at: Date.now(), por: _currentUser?.uid || '' }
    };
    const updates = { [`/shared/buzon/${item.id}`]: buzonPatch };
    if (item.obraId && item.movimientoId) {
      updates[`/shared/cajaChica/${item.obraId}/movimientos/${item.movimientoId}`] = {
        estado: 'aprobado',
        aprobadoAt: Date.now(),
        aprobadoPor: { uid: _currentUser?.uid || '', email: _currentUser?.email || '' },
        actualizadoAt: Date.now()
      };
    }
    await _multiPathUpdate(updates);
    _buzon.expanded.delete(item.id);
    const desgloseExtra = mapped.length
      ? ` · ${mapped.length} concepto${mapped.length === 1 ? '' : 's'} OPUS${faltantes > 0 ? ' · ⚠ ' + faltantes + ' faltante(s)' : ''}`
      : (faltantes > 0 ? ' · ⚠ sin desglose OPUS' : '');
    _toast(`${folio} · Gasto $${importe.toLocaleString('es-MX', {minimumFractionDigits:2})} asentado.${desgloseExtra}`, 'success');
  } catch (err) {
    console.error('[Buzón aprobar gasto CC]', err);
    _toast('Error al aprobar: ' + err.message, 'error');
  }
}

async function _aprobarDepositoCajaChica(item) {
  const importe = Number(item.monto) || 0;
  if (importe <= 0) { _toast('Monto inválido.', 'error'); return; }

  let folio;
  try { folio = await _generarFolio('CC'); }
  catch (err) { _toast('Error al generar folio: ' + err.message, 'error'); return; }

  const fechaISO = item.fecha
    ? new Date(item.fecha).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const proyectoId = item.proyectoId || await _resolverProyectoIdPorObra(item.obraId);

  // Asentar dos movimientos: egreso de la caja de origen + egreso del proyecto
  // (saldo en caja del proyecto baja, ya que caja chica es un sub-fondo del
  // proyecto). El saldo conciliado de caja chica sube en /shared/cajaChica.
  //   - fondo transferencia (default) → egreso de Mifel (sogrub_movimientos)
  //   - fondo efectivo → egreso de la caja física SOGRUB (sogrub_efectivo_movimientos);
  //     el billete sale del arqueo de oficina y se va a la obra. Mifel no se toca
  //     (ya bajó cuando se hizo el retiro de Mifel a efectivo).
  const fondoEfectivo = item.fondo === 'efectivo';
  const cajaOrigenKey = fondoEfectivo ? KEYS.EFECTIVO_MOV : 'sogrub_movimientos';
  const concepto = `[${folio}] Depósito caja chica${item.obraNombre ? ' · ' + item.obraNombre : ''} · ${fondoEfectivo ? 'EFECTIVO' : 'TRANSF'}${item.comentario ? ' · ' + item.comentario.slice(0, 60) : ''}`;
  const movMifel = {
    fecha:          fechaISO,
    monto:          -Math.abs(importe),
    concepto,
    status:         'Pagado',
    tipo:           'deposito_caja_chica',
    proyecto_id:    proyectoId || null,
    obraId:         item.obraId,
    movimiento_caja_chica_id: item.movimientoId,
    origen_buzon_id: item.id,
    fondo_caja:     fondoEfectivo ? 'efectivo' : undefined,
  };

  try {
    const createdMifel = addItem(cajaOrigenKey, movMifel);

    // Espejo en el ledger del proyecto (solo si está vinculado)
    let createdProy = null;
    if (proyectoId) {
      createdProy = addItem('sogrub_proy_movimientos', {
        proyecto_id: proyectoId,
        obraId:      item.obraId,
        fecha:       fechaISO,
        monto:       -Math.abs(importe),
        concepto,
        status:      'Pagado',
        tipo:        'deposito_caja_chica',
        movimiento_caja_chica_id: item.movimientoId,
        sogrub_movimiento_id: createdMifel.id,
        origen_buzon_id: item.id,
        metodo_pago: fondoEfectivo ? 'efectivo' : undefined,
        fondo_caja:  fondoEfectivo ? 'efectivo' : undefined,
      });
    }

    const histKey = `${Date.now()}_apr_dep`;
    const buzonPatch = {
      estado:       'aprobado',
      folio,
      aprobadoAt:   Date.now(),
      aprobadoPor:  _currentUser?.uid || '',
      movId:        createdMifel.id,
      destinoRefPath: `${cajaOrigenKey}[id=${createdMifel.id}]`,
      huerfanoAt:   null,
      huerfanoPor:  null,
      descripcionHuerfano: null,
      [`estadoHistorial/${histKey}`]: { estado: 'aprobado', at: Date.now(), por: _currentUser?.uid || '' }
    };
    const updates = { [`/shared/buzon/${item.id}`]: buzonPatch };
    if (item.obraId && item.movimientoId) {
      updates[`/shared/cajaChica/${item.obraId}/movimientos/${item.movimientoId}`] = {
        // estado='aprobado' es lo que hace que el depósito cuente al saldo
        // conciliado en las apps de campo (materiales exige estado aprobado;
        // los depósitos nacidos como solicitud quedan en 'solicitado' hasta aquí).
        estado: 'aprobado',
        asentadoAt: Date.now(),
        asentadoPor: { uid: _currentUser?.uid || '', email: _currentUser?.email || '' },
        asentadoBancarioId: createdMifel.id,
        asentadoProyectoMovId: createdProy?.id || null,
        actualizadoAt: Date.now(),
        pendienteAsentar: false
      };
    }
    await _multiPathUpdate(updates);
    _buzon.expanded.delete(item.id);
    _toast(`${folio} · Depósito $${importe.toLocaleString('es-MX', {minimumFractionDigits:2})} asentado en ${fondoEfectivo ? 'caja de efectivo SOGRUB' : 'Mifel'} y caja del proyecto.`, 'success');
  } catch (err) {
    console.error('[Buzón aprobar depósito CC]', err);
    _toast('Error al aprobar: ' + err.message, 'error');
  }
}

// ─── Recepción de almacén — modal de validación ────────────────────────────
//
// === OC de materiales (origen: app-compras) ===
//
// El item del buzón llega ya armado con items, proveedor, totales calculados
// y desglose por concepto OPUS. Compras es la fuente autoritativa del IVA y
// el total — bitácora respeta `incluyeIva`, `subtotal`, `ivaImporte`,
// `retencionesTotal`, `total` (decisión 6 del 2026-05-06).
//
// El movimiento contable se crea con tipo='gasto', categoria='Material',
// status='Pendiente' (CxP) o 'Pagado' si aprobarYPagar. Folio CP-YYYY-NNN.
// El espejo `/shared/compras/obras/{obraId}/oc/{ocId}` se actualiza con el
// estado y folio para que compras refleje el avance.

async function _aprobarOCMateriales(item, aprobarYPagar = false) {
  const proyectoId = item.proyectoId || await _resolverProyectoIdPorObra(item.obraId);
  if (!proyectoId) {
    _toast('No hay proyecto vinculado a esta obra. Crea el link en /shared/obraLinks primero.', 'error');
    return;
  }

  const total = Number(item.total) || 0;
  if (total <= 0) { _toast('Total inválido.', 'error'); return; }

  const proveedorNombre = (item.proveedor?.nombre || '').trim();
  if (!proveedorNombre) { _toast('La OC no tiene proveedor.', 'error'); return; }

  const provDef = _findOrCreateProveedor(proveedorNombre, {
    rfc: item.proveedor?.rfc || '',
    email: item.proveedor?.email || '',
    telefono: item.proveedor?.telefono || ''
  });

  // Mapear desglose OPUS — el shape coincide con caja chica: [{conceptoKey, monto}]
  const { mapped, faltantes } = await _mapearDesgloseCajaChica(item.obraId, item.desglose);
  if (faltantes > 0) {
    if (!confirm(`⚠ ${faltantes} de ${item.desglose.length} líneas no encontraron concepto OPUS. ¿Aprobar de todas formas? (esas líneas no se cargarán al desglose contable)`)) {
      return;
    }
  }

  let folio;
  try { folio = await _generarFolio('CP'); }
  catch (err) { _toast('Error al generar folio: ' + err.message, 'error'); return; }

  let pagoData = null;
  if (aprobarYPagar) {
    pagoData = await _modalDatosPago('pago');
    if (!pagoData) return;
  }

  const fechaISO = pagoData?.fechaISO
    || (item.fechaEmision ? new Date(item.fechaEmision).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));

  const subtotal = Number(item.subtotal) || (item.incluyeIva ? total / (1 + (item.ivaPct || 0.16)) : total);
  const ivaImporte = Number(item.ivaImporte) || (total - subtotal);

  const reqsLabel = (item.reqIds || []).length > 0
    ? ` · cubre ${item.reqIds.length} req${item.reqIds.length === 1 ? '' : 's'}`
    : '';

  // Categoría contable: compras la envía (Material/Mano de Obra/Subcontratista/
  // Indirecto). Default 'Material' por compatibilidad con OCs de material viejas.
  const CATS_VALIDAS = ['Material', 'Mano de Obra', 'Subcontratista', 'Indirecto'];
  const categoria = CATS_VALIDAS.includes(item.categoria) ? item.categoria : 'Material';
  const esServicio = item.claseCompra === 'servicio';

  const movimiento = {
    proyecto_id:    proyectoId,
    obraId:         item.obraId,
    fecha:          fechaISO,
    monto:          -Math.abs(total),
    concepto:       `[${folio}] OC${esServicio ? ' servicio' : ''} ${proveedorNombre}${reqsLabel}${item.comentariosCompras ? ' · ' + item.comentariosCompras.slice(0, 60) : ''}`,
    subcontratista: proveedorNombre,
    status:         aprobarYPagar ? 'Pagado' : 'Pendiente',
    tipo:           'gasto',
    categoria,
    // Servicio indirecto → ámbito oficina/campo para las bolsitas del proyecto.
    indirecto_ambito: categoria === 'Indirecto' ? (item.indirectoAmbito === 'campo' ? 'campo' : 'oficina') : undefined,
    clase_compra:   esServicio ? 'servicio' : 'material',
    origen_buzon_id: item.id,
    origen_oc_id:   item.ocId || null,
    monto_subtotal: Math.abs(subtotal),
    monto_iva:      Math.abs(ivaImporte),
    incluye_iva:    !!item.incluyeIva,
    // Retenciones de servicios (ISR, IVA retenido, etc.). Se guardan para
    // trazabilidad/fiscal; `total` ya viene neto (subtotal + IVA − retenciones).
    retenciones:       Array.isArray(item.retenciones) && item.retenciones.length ? item.retenciones : undefined,
    retenciones_total: Number(item.retencionesTotal) > 0 ? Number(item.retencionesTotal) : undefined,
    cfdi_uuid:         item.cfdiUuid || undefined,
    proveedor_id:   provDef?.id || null,
    desglose_presupuesto: mapped.length ? mapped : undefined
  };

  try {
    const created = addItem('sogrub_proy_movimientos', movimiento);
    const nuevoEstado = aprobarYPagar ? 'pagado' : 'aprobado';
    const histKey = `${Date.now()}_apr_oc`;
    const buzonPatch = {
      estado:       nuevoEstado,
      folio,
      aprobadoAt:   Date.now(),
      aprobadoPor:  _currentUser?.uid || '',
      movId:        created.id,
      destinoRefPath: `sogrub_proy_movimientos[id=${created.id}]`,
      huerfanoAt:   null,
      huerfanoPor:  null,
      descripcionHuerfano: null,
      [`estadoHistorial/${histKey}`]: { estado: nuevoEstado, at: Date.now(), por: _currentUser?.uid || '' }
    };
    if (pagoData) {
      const histKeyPago = `${Date.now() + 1}_pago`;
      buzonPatch.pagadoAt        = pagoData.fecha;
      buzonPatch.metodoPago      = pagoData.metodo;
      buzonPatch.referenciaPago  = pagoData.referencia || null;
      buzonPatch[`estadoHistorial/${histKeyPago}`] = {
        estado: 'pagado', at: pagoData.fecha, por: _currentUser?.uid || '',
        nota: `${pagoData.metodo}${pagoData.referencia ? ' ref:' + pagoData.referencia : ''}`
      };
      if (pagoData.fechaISO !== fechaISO) {
        updateItem('sogrub_proy_movimientos', created.id, { fecha: pagoData.fechaISO });
      }
    }

    const updates = { [`/shared/buzon/${item.id}`]: buzonPatch };
    // Espejo en /shared/compras/obras/{obraId}/oc/{ocId} para que compras vea
    // el folio asignado y el estado contable.
    if (item.obraId && item.ocId) {
      updates[`/shared/compras/obras/${item.obraId}/oc/${item.ocId}`] = {
        estado: aprobarYPagar ? 'pagada' : 'aprobada',
        folioContable: folio,
        movId: created.id,
        aprobadaAt: Date.now(),
        aprobadaPor: { uid: _currentUser?.uid || '', email: _currentUser?.email || '' },
        ...(pagoData && {
          pagadaAt: pagoData.fecha,
          metodoPago: pagoData.metodo,
          referenciaPago: pagoData.referencia || null
        }),
        actualizadoAt: Date.now()
      };
    }
    await _multiPathUpdate(updates);
    _buzon.expanded.delete(item.id);
    const desgloseExtra = mapped.length
      ? ` · ${mapped.length} concepto${mapped.length === 1 ? '' : 's'} OPUS${faltantes > 0 ? ' · ⚠ ' + faltantes + ' faltante(s)' : ''}`
      : (faltantes > 0 ? ' · ⚠ sin desglose OPUS' : '');
    _toast(`${folio} · OC $${total.toLocaleString('es-MX', {minimumFractionDigits:2})} a ${proveedorNombre}${provDef?._creado ? ' (nuevo proveedor)' : ''}${desgloseExtra}`, 'success');
  } catch (err) {
    console.error('[Buzón aprobar OC]', err);
    _toast('Error al aprobar: ' + err.message, 'error');
  }
}

// Antes de aprobar un `gasto_caja_chica` el contador necesita ver la recepción
// que el almacenista cargó en materiales: ticket, items, proveedor, factura
// folio, etc. Este modal abre el detalle, permite solicitar la factura al
// proveedor y subir el PDF/XML cuando llega, y dispara la aprobación o
// rechazo desde el mismo lugar.
//
// La recepción vive en /shared/materiales/obras/{obraId}/recepciones/{recId}.
// El catálogo de materiales (para resolver descripciones) en
// /shared/materiales/obras/{obraId}/catalogo/items.

async function _modalVerRecepcion(item) {
  if (!item.obraId || !item.refRecepcionId) {
    _toast('Este item no tiene recepción asociada.', 'error');
    return;
  }
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;overflow:auto';
  const card = document.createElement('div');
  card.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:0;width:min(1100px,100%);max-height:92vh;display:flex;flex-direction:column;overflow:hidden';
  card.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted)">Cargando recepción…</div>';
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => { try { document.body.removeChild(overlay); } catch (e) {} };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Carga paralela: recepción + catálogo materiales + catálogo conceptos +
  // requisiciones (para resolver el dropdown "Requisición vinculada") +
  // movimiento de caja chica espejo (para el badge de status, igual que en
  // la app de materiales).
  let rec = null, materiales = {}, conceptos = {}, requisiciones = {}, ccMov = null;
  try {
    const [recSnap, matSnap, conSnap, reqSnap, ccSnap] = await Promise.all([
      _dbRef(`/shared/materiales/obras/${item.obraId}/recepciones/${item.refRecepcionId}`).get(),
      _dbRef(`/shared/materiales/obras/${item.obraId}/catalogo/items`).get(),
      _dbRef(`/shared/catalogos/${item.obraId}/conceptos`).get(),
      _dbRef(`/shared/materiales/obras/${item.obraId}/requisiciones`).get(),
      item.movimientoId
        ? _dbRef(`/shared/cajaChica/${item.obraId}/movimientos/${item.movimientoId}`).get()
        : Promise.resolve({ exists: () => false }),
    ]);
    rec = recSnap.val();
    materiales = matSnap.val() || {};
    conceptos = conSnap.val() || {};
    requisiciones = reqSnap.val() || {};
    if (ccSnap.exists && ccSnap.exists()) ccMov = ccSnap.val();
  } catch (err) {
    console.error('[VerRecepcion]', err);
  }

  if (!rec) {
    card.innerHTML = `
      <div style="padding:24px">
        <h3 style="margin-top:0">⚠ Recepción no encontrada</h3>
        <p class="text-muted">No se pudo leer <code>${item.refRecepcionId}</code> bajo la obra <code>${item.obraId}</code>. Puede haber sido borrada por el almacenista.</p>
        <div style="text-align:right;margin-top:16px">
          <button id="vr-close" style="background:transparent;border:1px solid var(--border);border-radius:6px;padding:8px 16px;color:var(--text);cursor:pointer">Cerrar</button>
        </div>
      </div>`;
    card.querySelector('#vr-close').addEventListener('click', close);
    return;
  }

  // Re-fetch buzón item por si cambió mientras tanto
  let liveItem = item;
  try {
    const liveSnap = await _dbRef(`/shared/buzon/${item.id}`).get();
    if (liveSnap.exists()) liveItem = { id: item.id, ...liveSnap.val() };
  } catch {}

  _renderRecepcionModal(card, liveItem, rec, materiales, conceptos, requisiciones, ccMov, close);
}

// Réplica fiel del form de app-materiales (recepciones.js > renderMetaCard +
// renderItemsCard), en modo SOLO LECTURA. La idea es que el contador vea
// exactamente lo que el almacenista capturó, sin reformatear ni resumir.
// Cuando materiales habilite la foto del ticket, agrega el campo
// `rec.fotoTicketUrl` (o equivalente) y se renderiza automáticamente abajo.
function _renderRecepcionModal(card, item, rec, materiales, conceptos, requisiciones, ccMov, close) {
  const numeroFmt = `E-${String(rec.numero || 0).padStart(4, '0')}`;
  const fechaIso = rec.fecha
    ? new Date(rec.fecha).toISOString().slice(0, 10)
    : '';
  const isCajaChica = rec.origenTipo === 'caja_chica';
  const total = Number(rec.totalRecepcion) || 0;
  const recibidoPor = rec.recibidoPor?.displayName || rec.recibidoPor?.email || '—';

  // ── Items con resolución de material y concepto ──
  const itemsArr = Object.entries(rec.items || {}).map(([id, it]) => {
    const mat = materiales[it.materialKey] || null;
    const concepto = it.conceptoKey ? conceptos[it.conceptoKey] : null;
    return { id, mat, concepto, ...it };
  });

  // ── Requisición vinculada: igual que en materiales, solo enviadas + borrador ──
  const reqEntries = Object.entries(requisiciones || {})
    .filter(([, r]) => r.estado === 'enviada' || r.estado === 'borrador')
    .sort((a, b) => (b[1].numero || 0) - (a[1].numero || 0));
  const reqOptions = `
    <option value="">— sin vínculo —</option>
    ${reqEntries.map(([rid, r]) => `<option value="${rid}" ${rec.origenRef?.reqId === rid ? 'selected' : ''}>R-${String(r.numero).padStart(4, '0')}  (${Object.keys(r.items || {}).length} items, ${r.estado})</option>`).join('')}
  `;

  // ── Foto del ticket: lectura defensiva sobre múltiples shapes posibles ──
  const fotoUrl = rec.fotoTicketUrl
    || rec.origenRef?.fotoUrl
    || rec.origenRef?.fotoTicketUrl
    || rec.ticketFotoUrl
    || (Array.isArray(rec.fotos) && rec.fotos.length ? rec.fotos[0] : null)
    || null;
  const ticketTxt = rec.origenRef?.ticketDescripcion || '';

  // ── Status caja chica (réplica de renderCajaChicaStatus en materiales) ──
  let cajaChicaStatusHTML = '';
  if (ccMov) {
    const totalRec = Number(rec.totalRecepcion) || 0;
    const needsUpdate = Math.abs((Number(ccMov.monto) || 0) - totalRec) > 0.01 && ccMov.estado !== 'aprobado';
    const badgeStr = ccMov.estado === 'reportado' ? '<span class="badge badge-warning">⏳ Reportado a caja chica</span>'
      : ccMov.estado === 'aprobado' ? '<span class="badge badge-success">✓ Aprobado por contador</span>'
      : ccMov.estado === 'rechazado' ? '<span class="badge badge-danger">✕ Rechazado por contador</span>'
      : `<span class="badge badge-muted">${ccMov.estado || '—'}</span>`;
    cajaChicaStatusHTML = `
      <div class="form-group" style="grid-column:span 3">
        <div style="padding:10px 12px;background:rgba(0,0,0,.18);border:1px solid var(--border);border-radius:6px">
          <div class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.4px">Caja chica</div>
          <div style="margin-top:6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            ${badgeStr}
            <span style="font-size:13px">Monto reportado: <b>${formatMXN(Number(ccMov.monto) || 0)}</b></span>
            ${needsUpdate ? `<span class="badge badge-warning">⚠ Total real ahora: ${formatMXN(totalRec)}</span>` : ''}
          </div>
        </div>
      </div>`;
  }

  card.innerHTML = `
    <div style="padding:14px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.4px">Recepción de almacén · vista del contador</div>
        <h3 style="margin:2px 0 0">${numeroFmt}${rec.proveedor ? ' · ' + rec.proveedor : ''}</h3>
      </div>
      <span class="badge ${isCajaChica ? 'badge-warning' : 'badge-info'}">${isCajaChica ? '💰 Caja chica' : '📋 OC'}</span>
      <button id="vr-close" style="background:transparent;border:1px solid var(--border);border-radius:6px;padding:6px 10px;color:var(--text);cursor:pointer">✕</button>
    </div>

    <div style="overflow:auto;padding:18px 22px;flex:1">

      <!-- ============ DATOS (grid 3 col idéntico al form de materiales) ============ -->
      <div class="card" style="padding:16px;margin-bottom:16px">
        <h3 class="text-muted" style="margin:0 0 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600">Datos</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px">

          <div class="form-group">
            <label class="form-label">Folio</label>
            <div style="padding:7px 0;font-weight:600">${numeroFmt}</div>
          </div>
          <div class="form-group">
            <label class="form-label">Fecha</label>
            <input type="date" class="form-input" value="${fechaIso}" disabled>
          </div>
          <div class="form-group">
            <label class="form-label">Total recepción</label>
            <div style="padding:7px 0;font-weight:700;font-family:ui-monospace,monospace;color:var(--accent)">${formatMXN(total)}</div>
          </div>

          <div class="form-group">
            <label class="form-label">Proveedor</label>
            <input type="text" class="form-input" value="${(rec.proveedor || '').replace(/"/g, '&quot;')}" placeholder="Proveedor" disabled>
          </div>
          <div class="form-group">
            <label class="form-label">Factura</label>
            <input type="text" class="form-input" value="${(rec.factura || '').replace(/"/g, '&quot;')}" placeholder="Folio de factura (opcional)" disabled>
          </div>
          <div class="form-group">
            <label class="form-label">Recibido por</label>
            <div style="padding:7px 0;font-weight:600">${recibidoPor}</div>
          </div>

          <div class="form-group" style="grid-column:span 3">
            <label class="form-label">Requisición vinculada</label>
            <select class="form-select" disabled>${reqOptions}</select>
          </div>

          ${isCajaChica ? `
            <div class="form-group" style="grid-column:span 3">
              <label class="form-label">Ticket</label>
              <input type="text" class="form-input" value="${(ticketTxt || '').replace(/"/g, '&quot;')}" placeholder="Descripción del ticket / referencia (foto se subirá próximamente)" disabled>
              ${fotoUrl ? `
                <div style="margin-top:10px">
                  <a href="${fotoUrl}" target="_blank" rel="noopener" title="Abrir foto del ticket en pestaña nueva">
                    <img src="${fotoUrl}" alt="Foto del ticket"
                         style="max-width:100%;max-height:340px;border:1px solid var(--border);border-radius:6px;cursor:zoom-in;display:block">
                  </a>
                  <div class="text-muted" style="font-size:11px;margin-top:4px">📷 Click para abrir en pestaña nueva</div>
                </div>
              ` : `
                <div class="text-muted" style="font-size:11px;margin-top:6px">📷 <em>Foto del ticket: pendiente — se mostrará aquí cuando el almacenista la suba.</em></div>
              `}
            </div>
          ` : ''}

          ${cajaChicaStatusHTML}

          <div class="form-group" style="grid-column:span 3">
            <label class="form-label">Notas</label>
            <input type="text" class="form-input" value="${(rec.notas || '').replace(/"/g, '&quot;')}" placeholder="Notas (opcional)" disabled>
          </div>

        </div>
      </div>

      <!-- ============ ITEMS ============ -->
      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:14px 18px 0">
          <h3 class="text-muted" style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600">Items <span style="text-transform:none;font-weight:normal">(${itemsArr.length})</span></h3>
        </div>
        ${itemsArr.length === 0 ? `
          <div class="empty-state" style="padding:30px"><div class="empty-state-title">Sin items</div></div>
        ` : `
          <div class="table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Unidad</th>
                  <th class="num">Cantidad</th>
                  <th class="num">Costo unit.</th>
                  <th class="num">Importe</th>
                  <th>Concepto</th>
                </tr>
              </thead>
              <tbody>
                ${itemsArr.map(it => _filaItemRecepcion(it)).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>

    </div>

    <!-- ============ ACCIONES ============ -->
    <div style="padding:14px 22px;border-top:1px solid var(--border);background:rgba(0,0,0,.15);display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
      ${(item.estado === 'recibido' || item.estado === 'pendiente' || item.estado === 'en_revision') ? `
        <span class="text-muted" style="font-size:12px;align-self:center;margin-right:auto">Revisa la información que capturó el almacenista. Al aprobar se asienta el gasto contable.</span>
        <button id="vr-rechazar" style="background:transparent;color:#e15555;border:1px solid #e15555;border-radius:6px;padding:8px 14px;cursor:pointer">✕ Rechazar</button>
        <button id="vr-aprobar" style="background:#5dd39e;color:#0e3a25;border:none;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer">✓ Aprobar y asentar gasto</button>
      ` : `
        <span class="text-muted" style="font-size:12px;align-self:center;margin-right:auto">Estado actual: <b>${item.estado}</b></span>
      `}
      <button id="vr-cerrar" style="background:transparent;border:1px solid var(--border);border-radius:6px;padding:8px 14px;color:var(--text);cursor:pointer">Cerrar</button>
    </div>
  `;

  card.querySelector('#vr-close').addEventListener('click', close);
  card.querySelector('#vr-cerrar').addEventListener('click', close);
  const btnAprobar = card.querySelector('#vr-aprobar');
  if (btnAprobar) btnAprobar.addEventListener('click', async () => {
    close();
    await _aprobarGastoCajaChica(item);
  });
  const btnRechazar = card.querySelector('#vr-rechazar');
  if (btnRechazar) btnRechazar.addEventListener('click', async () => {
    close();
    await _rechazarItem(item);
  });
}

function _filaItemRecepcion(it) {
  const mat = it.mat;
  const cant = Number(it.cantidad) || 0;
  const cu = Number(it.costoUnitario) || 0;
  const importe = cant * cu;

  const matCell = mat
    ? `<div>
         <div style="font-family:monospace;font-size:11px;color:var(--text-muted)">${mat.clave || ''}</div>
         <div style="font-weight:600">${mat.descripcion || '—'}</div>
         ${mat.marca ? `<div class="text-muted" style="font-size:11px">${mat.marca}</div>` : ''}
       </div>`
    : `<span class="badge badge-danger">⚠ Material eliminado del catálogo</span>`;

  // Δ vs requisición original — replica de la lógica en materiales
  let cantStr = cant.toLocaleString('es-MX', { minimumFractionDigits: 2 });
  if (it.requisicionItemRef) {
    const orig = Number(it.requisicionItemRef.cantidadOriginal) || 0;
    const delta = cant - orig;
    if (Math.abs(delta) >= 0.0001) {
      const sign = delta > 0 ? '+' : '';
      const tooltip = `Requisitada: ${orig} · Recibida: ${cant} · Δ ${sign}${delta}` + (it.razonDiferencia ? ` · Razón: ${it.razonDiferencia}` : ' · Sin razón registrada');
      cantStr += ` <span class="badge ${delta > 0 ? 'badge-info' : 'badge-warning'}" style="font-size:10px" title="${tooltip}">Δ ${sign}${delta}</span>`;
    }
  }

  const conceptoCell = it.concepto
    ? `<span title="${(it.concepto.descripcion || '').replace(/"/g, '&quot;')}">
         <span style="font-family:monospace;font-size:11px">${it.concepto.clave || ''}</span>
         <span class="text-muted" style="margin-left:6px;font-size:11px">${(it.concepto.descripcion || '').slice(0, 30)}</span>
       </span>`
    : '<span class="text-muted">—</span>';

  return `
    <tr>
      <td style="max-width:340px">${matCell}</td>
      <td>${mat?.unidad || ''}</td>
      <td class="num font-mono">${cantStr}</td>
      <td class="num font-mono">${formatMXN(cu)}</td>
      <td class="num font-mono" style="font-weight:600">${formatMXN(importe)}</td>
      <td>${conceptoCell}</td>
    </tr>`;
}

// Acción originada desde la vista por proyecto (caja-chica.js): el contador
// deposita directamente desde bitácora (no pasa por el buzón). Crea el
// movimiento en /shared/cajaChica + el egreso bancario en sogrub_movimientos.
async function _depositarCajaChicaDesdeBitacora({ obraId, obraNombre, monto, fecha, comentario, metodoDeposito, fondo }) {
  if (!obraId) throw new Error('obraId requerido');
  const importe = Number(monto) || 0;
  if (importe <= 0) throw new Error('Monto inválido');
  const fechaMs = fecha ? new Date(fecha + 'T12:00').getTime() : Date.now();
  const fechaISO = fecha || new Date().toISOString().slice(0, 10);
  // Fondo efectivo: el depósito siempre es billete físico (metodo 'efectivo'),
  // pero a diferencia del efectivo "informativo" del fondo transferencia, SÍ
  // cuenta al saldo del fondo y SÍ se asienta (sale de la caja física SOGRUB).
  const fondoEfectivo = fondo === 'efectivo';
  const metodo = fondoEfectivo ? 'efectivo' : (metodoDeposito || 'transferencia');

  const proyectoId = await _resolverProyectoIdPorObra(obraId);

  // 1) Crear movimiento en /shared/cajaChica (source of truth del saldo)
  const ccData = {
    tipo: 'deposito',
    // El contador deposita con autoridad propia: nace aprobado (no pasa por
    // solicitud). Las apps de campo cuentan depósitos con estado='aprobado'.
    estado: 'aprobado',
    metodoDeposito: metodo,
    monto: importe,
    fecha: fechaMs,
    comentario: comentario || null,
    autor: { uid: _currentUser?.uid || '', email: _currentUser?.email || '' },
    origen: 'bitacora',
    createdAt: Date.now()
  };
  if (fondoEfectivo) ccData.fondo = 'efectivo';
  const movRef = _dbRef(`/shared/cajaChica/${obraId}/movimientos`).push();
  await movRef.set(ccData);
  const movCajaChicaId = movRef.key;

  // 2) Asentar el egreso de la caja de origen + un egreso espejo en
  //    sogrub_proy_movimientos para que el saldo en caja del proyecto baje
  //    (la caja chica es un sub-fondo del proyecto).
  //      - fondo transferencia → egreso de Mifel (sogrub_movimientos)
  //      - fondo efectivo → egreso de la caja física SOGRUB (sogrub_efectivo_movimientos)
  //    El efectivo "informativo" del fondo transferencia NO se asienta (legacy).
  if (metodo === 'transferencia' || fondoEfectivo) {
    const cajaOrigenKey = fondoEfectivo ? KEYS.EFECTIVO_MOV : 'sogrub_movimientos';
    const folio = await _generarFolio('CC');
    const concepto = `[${folio}] Depósito caja chica${obraNombre ? ' · ' + obraNombre : ''} · ${fondoEfectivo ? 'EFECTIVO' : 'TRANSF'}${comentario ? ' · ' + comentario.slice(0, 60) : ''}`;

    const createdMifel = addItem(cajaOrigenKey, {
      fecha:    fechaISO,
      monto:    -Math.abs(importe),
      concepto,
      status:   'Pagado',
      tipo:     'deposito_caja_chica',
      proyecto_id: proyectoId || null,
      obraId,
      movimiento_caja_chica_id: movCajaChicaId,
      fondo_caja: fondoEfectivo ? 'efectivo' : undefined,
    });

    // Egreso del saldo del proyecto. Solo si el proyecto está vinculado;
    // si no, se omite (saldo del proyecto no se ve afectado, solo la caja de origen).
    let createdProy = null;
    if (proyectoId) {
      createdProy = addItem('sogrub_proy_movimientos', {
        proyecto_id: proyectoId,
        obraId,
        fecha:    fechaISO,
        monto:    -Math.abs(importe),
        concepto,
        status:   'Pagado',
        tipo:     'deposito_caja_chica',
        movimiento_caja_chica_id: movCajaChicaId,
        sogrub_movimiento_id: createdMifel.id,
        metodo_pago: fondoEfectivo ? 'efectivo' : undefined,
        fondo_caja:  fondoEfectivo ? 'efectivo' : undefined,
      });
    }

    await _dbRef(`/shared/cajaChica/${obraId}/movimientos/${movCajaChicaId}`).update({
      asentadoAt: Date.now(),
      asentadoBancarioId: createdMifel.id,
      asentadoProyectoMovId: createdProy?.id || null,
      folioBancario: folio
    });
    return { movCajaChicaId, mifelMovId: createdMifel.id, proyMovId: createdProy?.id || null, folio };
  }

  // Efectivo informativo (fondo transferencia): solo el registro en
  // /shared/cajaChica, sin egreso contable — el retiro ya se contabilizó antes.
  return { movCajaChicaId, mifelMovId: null, folio: null };
}

// ─── Orden de cambio (informativa) ─────────────────────────────────────────
//
// Se acusa de recibido y se cierra. Deliberadamente NO crea movimiento
// contable: una OC cambia el presupuesto, no la caja. El dinero llegará
// después por las estimaciones, que sí generan `pago_cliente`.
//
// Tampoco se toca el presupuesto con `impactoRubros` del item: ese es el delta
// de UNA OC y la fuente de verdad es el acumulado de /shared/contratos. Solo
// se relee ese nodo para que el presupuesto por rubro se refresque.
async function _aprobarOrdenCambio(item) {
  try {
    const histKey = `${Date.now()}_oc`;
    await _multiPathUpdate({
      [`/shared/buzon/${item.id}/estado`]:     'cerrado',
      [`/shared/buzon/${item.id}/cerradoAt`]:  Date.now(),
      [`/shared/buzon/${item.id}/cerradoPor`]: _currentUser?.email || '',
      [`/shared/buzon/${item.id}/historial/${histKey}`]: {
        estado: 'cerrado', at: Date.now(), por: _currentUser?.email || '',
        nota: 'Orden de cambio acusada de recibido. No genera movimiento contable.',
      },
    });

    // Releer el contrato vigente para que el presupuesto por rubro se actualice.
    const proyectoId = item.proyectoId || await _resolverProyectoIdPorObra(item.obraId);
    if (proyectoId) {
      await cargarContratoOC(proyectoId);
      if (typeof _activeProyecto !== 'undefined' && _activeProyecto === proyectoId) {
        if (typeof refreshBolsitas === 'function')     refreshBolsitas(proyectoId);
        if (typeof refreshDetalleKPIs === 'function')  refreshDetalleKPIs(proyectoId);
      }
    }
    _toast(`OC #${item.ocNumero ?? ''} registrada · presupuesto vigente actualizado`, 'success');
  } catch (err) {
    console.error('[OC]', err);
    _toast('Error: ' + err.message, 'error');
  }
}

// Devolución del FONDO EFECTIVO → caja física de SOGRUB. Es el inverso exacto
// del depósito: el billete que custodiaba la obra regresa al arqueo de SOGRUB
// y la caja del proyecto recupera el monto.
//
//   caja física SOGRUB ↑ · caja del proyecto ↑ · fondo efectivo de la obra ↓
//
// Uso típico: el almacenista entrega el fondo (monedas/cambio acumulado) y se
// le repone con billetes nuevos. Devolución + depósito del mismo monto = cambio
// puro, neutro en todos los saldos, que deja el arqueo cuadrado.
//
// Representación en /shared/cajaChica: `tipo:'gasto', estado:'aprobado'` con
// marcador `esDevolucion:true`. NO es un tipo nuevo a propósito: la fórmula de
// saldo replicada en las apps de campo (materiales, indirectos, consola) solo
// entiende 'deposito' y 'gasto', así que un tipo propio quedaría invisible y
// sus saldos derivarían. Como gasto aprobado, resta correctamente en las 4 apps
// sin tocar una línea allá. No genera contable de gasto — no es un costo, es un
// traspaso entre cajas propias.
async function _devolverCajaChicaEfectivoDesdeBitacora({ obraId, obraNombre, monto, fecha, comentario }) {
  if (!obraId) throw new Error('obraId requerido');
  const importe = Number(monto) || 0;
  if (importe <= 0) throw new Error('Monto inválido');
  const fechaMs  = fecha ? new Date(fecha + 'T12:00').getTime() : Date.now();
  const fechaISO = fecha || new Date().toISOString().slice(0, 10);

  const proyectoId = await _resolverProyectoIdPorObra(obraId);

  // 1) Salida del fondo en el ledger compartido (source of truth del saldo)
  const movRef = _dbRef(`/shared/cajaChica/${obraId}/movimientos`).push();
  await movRef.set({
    tipo: 'gasto',
    estado: 'aprobado',
    fondo: 'efectivo',
    esDevolucion: true,
    monto: importe,
    fecha: fechaMs,
    comentario: comentario || 'Devolución de efectivo a SOGRUB',
    autor: { uid: _currentUser?.uid || '', email: _currentUser?.email || '' },
    origen: 'bitacora',
    createdAt: Date.now()
  });
  const movCajaChicaId = movRef.key;

  // 2) Ingreso a la caja física de SOGRUB (el billete vuelve al arqueo)
  const folio = await _generarFolio('CC');
  const concepto = `[${folio}] Devolución caja chica${obraNombre ? ' · ' + obraNombre : ''} · EFECTIVO${comentario ? ' · ' + comentario.slice(0, 60) : ''}`;

  const createdEfec = addItem(KEYS.EFECTIVO_MOV, {
    fecha:    fechaISO,
    monto:    Math.abs(importe),
    concepto,
    status:   'Pagado',
    tipo:     'devolucion_caja_chica',
    proyecto_id: proyectoId || null,
    obraId,
    movimiento_caja_chica_id: movCajaChicaId,
    fondo_caja: 'efectivo',
  });

  // 3) Ingreso espejo en la caja del proyecto (revierte el egreso del depósito)
  let createdProy = null;
  if (proyectoId) {
    createdProy = addItem('sogrub_proy_movimientos', {
      proyecto_id: proyectoId,
      obraId,
      fecha:    fechaISO,
      monto:    Math.abs(importe),
      concepto,
      status:   'Pagado',
      tipo:     'devolucion_caja_chica',
      movimiento_caja_chica_id: movCajaChicaId,
      sogrub_movimiento_id: createdEfec.id,
      metodo_pago: 'efectivo',
      fondo_caja:  'efectivo',
    });
  }

  // Se sellan los mismos campos que un depósito asentado para que borrar la
  // fila desde la tabla revierta ambos contables (_borrarFilaCC ya los lee).
  await _dbRef(`/shared/cajaChica/${obraId}/movimientos/${movCajaChicaId}`).update({
    asentadoAt: Date.now(),
    asentadoBancarioId: createdEfec.id,
    asentadoProyectoMovId: createdProy?.id || null,
    folioBancario: folio
  });

  return { movCajaChicaId, efectivoMovId: createdEfec.id, proyMovId: createdProy?.id || null, folio };
}

// ─── Proveedor ─────────────────────────────────────────────────────────────

function _findOrCreateProveedor(nombre, extras = {}) {
  const arr  = getCollection('sogrub_proveedores') || [];
  const list = Array.isArray(arr) ? arr : Object.values(arr);
  const norm = s => String(s || '').trim().toLowerCase();
  const ex   = list.find(p => norm(p?.nombre) === norm(nombre));
  if (ex) return { ...ex, _creado: false };
  return {
    ...addItem('sogrub_proveedores', {
      nombre: nombre.trim(), rfc: '',
      telefono: extras.telefono || '', email: extras.email || '',
      notas: 'Creado automáticamente desde el buzón.'
    }),
    _creado: true
  };
}

// ─── Toast ─────────────────────────────────────────────────────────────────

function _toast(msg, kind) {
  if (typeof showToast === 'function') return showToast(msg, kind);
  if (typeof toast === 'function')     return toast(msg, kind);
  console.log(`[${kind}] ${msg}`);
}
