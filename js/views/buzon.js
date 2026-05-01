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

// ─── Estado del módulo ─────────────────────────────────────────────────────

const _buzon = {
  items:      {},
  tab:        'recibido',
  expanded:   new Set(),
  subscribed: false,
  migrated:   false,
};

// ─── Suscripción ───────────────────────────────────────────────────────────

function _suscribirBuzon() {
  if (_buzon.subscribed) return;
  _buzon.subscribed = true;
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
  const movs = getCollection('sogrub_proy_movimientos');
  if (!Array.isArray(movs)) return;
  const movIds = new Set(movs.map(m => m?.id).filter(Boolean));

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
  const n = Object.values(_buzon.items).filter(i =>
    ['recibido', 'pendiente', 'en_revision', 'huerfano'].includes(i?.estado)
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
  const filtered  = activeTab.estados
    ? all.filter(i => activeTab.estados.includes(i.estado))
    : all;

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
    </div>`;
  root.appendChild(header);
  header.querySelectorAll('.bz-tab').forEach(b =>
    b.addEventListener('click', () => { _buzon.tab = b.dataset.tab; renderBuzon(); })
  );

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
    empty.innerHTML = `<div style="font-size:32px;opacity:.5;margin-bottom:8px">📥</div><div>${msgs[_buzon.tab] || 'Sin items.'}</div>`;
    root.appendChild(empty);
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
  // Caja chica usa monto plano (number); CxC/CxP usan { subtotal, iva, importe }.
  const esCajaChica = item.tipo === 'gasto_caja_chica' || item.tipo === 'deposito_caja_chica';
  const monto     = esCajaChica
    ? Number(item.monto) || 0
    : (item?.monto?.importe || 0);
  const fechaPago = item.fecha
    ? new Date(item.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
  const tipoLabel = {
    pago_cliente: '💰 Pago de cliente',
    estimacion_subcontratista: '🔧 Estim. subcontratista',
    gasto_caja_chica: '🧾 Gasto caja chica',
    deposito_caja_chica: '🏦 Depósito caja chica'
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
      <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.descripcion || '—'}</div>
      <div style="font-size:11px;color:var(--text-muted)">${tipoLabel} · ${item.obraNombre || item.obraId || '—'} · ${fechaPago}</div>
    </div>
    ${desfase ? `<span title="${desfase.tooltip}" style="font-size:11px;color:#e0a04c;background:rgba(224,160,76,.12);padding:2px 7px;border-radius:8px;flex-shrink:0">⚠ Δ$${Math.abs(desfase.delta).toLocaleString('es-MX', {minimumFractionDigits:2})}</span>` : ''}
    <div style="text-align:right;flex-shrink:0">
      <div style="font-family:ui-monospace,monospace;font-size:17px;font-weight:700;color:${(esSub || item.tipo === 'gasto_caja_chica') ? '#e15555' : 'var(--accent)'}">
        ${(esSub || item.tipo === 'gasto_caja_chica') ? '−' : '+'}$${monto.toLocaleString('es-MX', {minimumFractionDigits:2, maximumFractionDigits:2})}
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

function _cardBodyHTML(item) {
  const esSub     = item.tipo === 'estimacion_subcontratista';
  const esGastoCC = item.tipo === 'gasto_caja_chica';
  const esDepCC   = item.tipo === 'deposito_caja_chica';
  const esCajaChica = esGastoCC || esDepCC;
  const fechaPago = item.fecha
    ? new Date(item.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
  const fechaCreado = item.creadoAt ? new Date(item.creadoAt).toLocaleString('es-MX') : '';
  const montoNum = esCajaChica ? Number(item.monto) || 0 : 0;
  const montoInfo = esCajaChica
    ? `Importe: <b>$${montoNum.toLocaleString('es-MX',{minimumFractionDigits:2})}</b> <span style="color:var(--text-muted);font-size:11px">(monto plano · sin desglose IVA del lado almacén)</span>`
    : (item?.monto?.conIva === false
        ? '<span style="color:#e0a04c">Sin IVA</span> — importe = subtotal'
        : `Subtotal $${(item?.monto?.subtotal || 0).toLocaleString('es-MX',{minimumFractionDigits:2})} · IVA $${(item?.monto?.iva || 0).toLocaleString('es-MX',{minimumFractionDigits:2})}`);
  const proyNombre  = item.proyectoId
    ? `<b style="color:#5dd39e">${_obtenerNombreProyecto(item.proyectoId)}</b>`
    : `<span style="color:#e15555">⚠ Obra sin vincular</span>`;

  const col1 = esSub
    ? `Subcontrato: <b>${item.subcontratoNombre || '—'}</b><br>
       Estim. sub: <b>#${item.subEstimacionNumero ?? '—'}</b><br>
       Subcontratista: <b>${item.proveedorNombre || '—'}</b><br>
       Fecha pago: <b>${fechaPago}</b>`
    : esGastoCC
    ? `Proveedor: <b>${item.proveedor || '—'}</b><br>
       Factura: <b>${item.factura || '<span style=\'color:#e0a04c\'>sin factura</span>'}</b><br>
       Recepción: <b>${item.refRecepcionId ? '<code style=\'font-size:11px\'>' + item.refRecepcionId.slice(-8) + '</code>' : '—'}</b><br>
       Fecha: <b>${fechaPago}</b>`
    : esDepCC
    ? `Método: <b>${item.metodoDeposito === 'transferencia' ? '🏦 Transferencia bancaria' : item.metodoDeposito || '—'}</b><br>
       Comentario: <b>${item.comentario || '—'}</b><br>
       Fecha depósito: <b>${fechaPago}</b>`
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
  if (esGastoCC && Array.isArray(item.desglose) && item.desglose.length > 0) {
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
    const monto = Number(it?.monto?.importe) || 0;
    if (!monto) continue;
    if (it.estado === 'rechazado') { excluidos.rechazados++; continue; }
    if (it.estado === 'huerfano')  { excluidos.huerfanos++; excluidos.montoHuerfano += monto; continue; }

    const target = it.tipo === 'pago_cliente' ? cxc
                 : it.tipo === 'estimacion_subcontratista' ? cxp
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
  const esCxP     = item.tipo === 'estimacion_subcontratista';
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
  const noProj = !item.proyectoId && !esCajaChica;  // CC resuelve via obraLinks al aprobar
  const noVinc = noProj ? '<span style="font-size:11px;color:#e15555;align-self:center">Vincula la obra primero</span>' : '';
  const dis    = noProj ? 'disabled style="opacity:.5;cursor:not-allowed"' : 'style="cursor:pointer"';
  const e      = item.estado;

  if (e === 'recibido' || e === 'pendiente' || e === 'en_revision') {
    if (esCajaChica) {
      // Caja chica: aprobar = asentar contable directamente. No hay flujo
      // CxC/CxP, así que tampoco hay "Aprobar + Pagar".
      const lbl = item.tipo === 'gasto_caja_chica' ? '✓ Aprobar gasto' : '✓ Aprobar y asentar';
      return `
        <button class="bz-btn-aprobar" ${dis} style="background:#5dd39e;color:#0e3a25;border:none;border-radius:6px;padding:8px 14px;font-weight:600">${lbl}</button>
        <button class="bz-btn-rechazar" style="background:transparent;color:#e15555;border:1px solid #e15555;border-radius:6px;padding:8px 14px;cursor:pointer">✕ Rechazar</button>`;
    }
    const labelPagoRapido = item.tipo === 'estimacion_subcontratista' ? 'Aprobar + Pagar' : 'Aprobar + Cobrar';
    return `
      <button class="bz-btn-aprobar" ${dis} style="background:#5dd39e;color:#0e3a25;border:none;border-radius:6px;padding:8px 14px;font-weight:600">✓ Aprobar</button>
      <button class="bz-btn-aprobar-pagar" ${dis} style="background:#3ab87a;color:#0e3a25;border:none;border-radius:6px;padding:8px 14px;font-weight:600">${labelPagoRapido}</button>
      <button class="bz-btn-rechazar" style="background:transparent;color:#e15555;border:1px solid #e15555;border-radius:6px;padding:8px 14px;cursor:pointer">✕ Rechazar</button>
      ${noVinc}`;
  }
  if (e === 'aprobado') {
    if (esCajaChica) {
      // Aprobado en caja chica = ya asentado. Solo permitir reabrir o cerrar.
      return `
        <button class="bz-btn-reabrir" style="background:transparent;color:#5dd39e;border:1px solid #5dd39e;border-radius:6px;padding:8px 14px;cursor:pointer">↺ Reabrir</button>
        <button class="bz-btn-cerrar" style="background:transparent;color:var(--text-muted);border:1px solid var(--border);border-radius:6px;padding:8px 14px;cursor:pointer">Cerrar</button>`;
    }
    const labelMrk = item.tipo === 'estimacion_subcontratista' ? 'Marcar Pagado' : 'Marcar Cobrado';
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
async function _aprobarItem(item, aprobarYPagar = false) {
  // Caja chica: rutas especializadas (ver _aprobarGastoCajaChica / _aprobarDepositoCajaChica)
  if (item.tipo === 'gasto_caja_chica')   return _aprobarGastoCajaChica(item);
  if (item.tipo === 'deposito_caja_chica') return _aprobarDepositoCajaChica(item);

  if (!item.proyectoId) { _toast('Falta vincular la obra al proyecto contable.', 'error'); return; }

  const fechaISO = item.fecha
    ? new Date(item.fecha).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  let movimiento, nombrePill, folio;

  try {
    if (item.tipo === 'pago_cliente') {
      folio = await _generarFolio('CC');
      const conIva = item?.monto?.conIva !== false && (Number(item?.monto?.iva) || 0) > 0;
      movimiento = {
        proyecto_id:    item.proyectoId,
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
      const desglose = await _mapearDesgloseAOpusBitacora(item.proyectoId, item.desglose);
      movimiento = {
        proyecto_id:    item.proyectoId,
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
    pagoData = await _modalDatosPago(item.tipo === 'estimacion_subcontratista' ? 'pago' : 'cobro');
    if (!pagoData) return; // cancelado
  }

  try {
    const created       = addItem('sogrub_proy_movimientos', movimiento);
    const nuevoEstado   = aprobarYPagar
      ? (item.tipo === 'estimacion_subcontratista' ? 'pagado' : 'cobrado')
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
  const pagoData = await _modalDatosPago(esSub ? 'pago' : 'cobro');
  if (!pagoData) return;

  try {
    updateItem('sogrub_proy_movimientos', item.movId, {
      status: 'Pagado',
      fecha:  pagoData.fechaISO,
    });

    const nuevoEstado = esSub ? 'pagado' : 'cobrado';
    const tsField     = nuevoEstado === 'cobrado' ? 'cobradoAt' : 'pagadoAt';
    const histKey     = `${Date.now()}_pago`;
    await _dbRef(`/shared/buzon/${item.id}`).update({
      estado:       nuevoEstado,
      [tsField]:    pagoData.fecha,
      metodoPago:   pagoData.metodo,
      referenciaPago: pagoData.referencia || null,
      [`estadoHistorial/${histKey}`]: {
        estado: nuevoEstado, at: pagoData.fecha, por: _currentUser?.uid || '',
        nota: `${pagoData.metodo}${pagoData.referencia ? ' ref:' + pagoData.referencia : ''}`
      }
    });
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
    await _dbRef(`/shared/buzon/${item.id}`).update({
      estado:       'aprobado',
      cobradoAt:    null,
      pagadoAt:     null,
      metodoPago:   null,
      referenciaPago: null,
      [`estadoHistorial/${histKey}`]: {
        estado: 'aprobado', at: Date.now(), por: _currentUser?.uid || '',
        nota: 'Reabierto desde ' + item.estado
      }
    });
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
        deleteItem('sogrub_movimientos', item.movId);
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
        : { pendienteAsentar: true, actualizadoAt: Date.now() };
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
  const motivo = prompt('Motivo del rechazo (visible en la app de origen):');
  if (motivo === null) return;
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
  await Promise.all(Object.entries(updates).map(([path, patch]) =>
    _dbRef(path).update(patch)
  ));
}

async function _cerrarItem(item) {
  if (!confirm('¿Cerrar este item? Quedará archivado.')) return;
  try {
    const histKey = `${Date.now()}_cerr`;
    await _dbRef(`/shared/buzon/${item.id}`).update({
      estado:    'cerrado',
      cerradoAt: Date.now(),
      cerradoPor: _currentUser?.uid || '',
      [`estadoHistorial/${histKey}`]: { estado: 'cerrado', at: Date.now(), por: _currentUser?.uid || '' }
    });
    _buzon.expanded.delete(item.id);
    _toast('Item cerrado.', 'success');
  } catch (err) {
    _toast('Error al cerrar: ' + err.message, 'error');
  }
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

  let folio;
  try { folio = await _generarFolio('CP'); }
  catch (err) { _toast('Error al generar folio: ' + err.message, 'error'); return; }

  // Tickets de caja chica suelen traer IVA mexicano del 16% bruto
  const subtotal = importe / 1.16;
  const iva = importe - subtotal;

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
    concepto:       `[${folio}] Caja chica · ${proveedorNombre || '(sin proveedor)'}${item.factura ? ' · F.' + item.factura : ''}${item.comentario ? ' · ' + item.comentario.slice(0, 60) : ''}`,
    subcontratista: proveedorNombre,
    status:         'Pagado',
    tipo:           'gasto',
    categoria:      'Caja chica',
    origen_buzon_id: item.id,
    monto_subtotal: subtotal,
    monto_iva:      iva,
    incluye_iva:    true,
    proveedor_id:   provDef?.id || null,
    desglose_presupuesto: mapped.length ? mapped : undefined,
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

  // Egreso de Mifel — el saldo de caja chica vive en /shared/cajaChica, no
  // duplicamos con un ingreso al ledger del proyecto.
  const movimiento = {
    fecha:          fechaISO,
    monto:          -Math.abs(importe),
    concepto:       `[${folio}] Depósito caja chica${item.obraNombre ? ' · ' + item.obraNombre : ''} · TRANSF${item.comentario ? ' · ' + item.comentario.slice(0, 60) : ''}`,
    status:         'Pagado',
    tipo:           'deposito_caja_chica',
    proyecto_id:    proyectoId || null,
    obraId:         item.obraId,
    movimiento_caja_chica_id: item.movimientoId,
    origen_buzon_id: item.id,
  };

  try {
    const created = addItem('sogrub_movimientos', movimiento);
    const histKey = `${Date.now()}_apr_dep`;
    const buzonPatch = {
      estado:       'aprobado',
      folio,
      aprobadoAt:   Date.now(),
      aprobadoPor:  _currentUser?.uid || '',
      movId:        created.id,
      destinoRefPath: `sogrub_movimientos[id=${created.id}]`,
      huerfanoAt:   null,
      huerfanoPor:  null,
      descripcionHuerfano: null,
      [`estadoHistorial/${histKey}`]: { estado: 'aprobado', at: Date.now(), por: _currentUser?.uid || '' }
    };
    const updates = { [`/shared/buzon/${item.id}`]: buzonPatch };
    if (item.obraId && item.movimientoId) {
      updates[`/shared/cajaChica/${item.obraId}/movimientos/${item.movimientoId}`] = {
        asentadoAt: Date.now(),
        asentadoPor: { uid: _currentUser?.uid || '', email: _currentUser?.email || '' },
        actualizadoAt: Date.now(),
        pendienteAsentar: false
      };
    }
    await _multiPathUpdate(updates);
    _buzon.expanded.delete(item.id);
    _toast(`${folio} · Depósito $${importe.toLocaleString('es-MX', {minimumFractionDigits:2})} asentado en Mifel.`, 'success');
  } catch (err) {
    console.error('[Buzón aprobar depósito CC]', err);
    _toast('Error al aprobar: ' + err.message, 'error');
  }
}

// Acción originada desde la vista por proyecto (caja-chica.js): el contador
// deposita directamente desde bitácora (no pasa por el buzón). Crea el
// movimiento en /shared/cajaChica + el egreso bancario en sogrub_movimientos.
async function _depositarCajaChicaDesdeBitacora({ obraId, obraNombre, monto, fecha, comentario, metodoDeposito }) {
  if (!obraId) throw new Error('obraId requerido');
  const importe = Number(monto) || 0;
  if (importe <= 0) throw new Error('Monto inválido');
  const fechaMs = fecha ? new Date(fecha + 'T12:00').getTime() : Date.now();
  const fechaISO = fecha || new Date().toISOString().slice(0, 10);
  const metodo = metodoDeposito || 'transferencia';

  const proyectoId = await _resolverProyectoIdPorObra(obraId);

  // 1) Crear movimiento en /shared/cajaChica (source of truth del saldo)
  const ccData = {
    tipo: 'deposito',
    metodoDeposito: metodo,
    monto: importe,
    fecha: fechaMs,
    comentario: comentario || null,
    autor: { uid: _currentUser?.uid || '', email: _currentUser?.email || '' },
    origen: 'bitacora',
    createdAt: Date.now()
  };
  const movRef = _dbRef(`/shared/cajaChica/${obraId}/movimientos`).push();
  await movRef.set(ccData);
  const movCajaChicaId = movRef.key;

  // 2) Si es transferencia, asentar el egreso bancario en sogrub_movimientos
  if (metodo === 'transferencia') {
    const folio = await _generarFolio('CC');
    const created = addItem('sogrub_movimientos', {
      fecha:    fechaISO,
      monto:    -Math.abs(importe),
      concepto: `[${folio}] Depósito caja chica${obraNombre ? ' · ' + obraNombre : ''} · TRANSF${comentario ? ' · ' + comentario.slice(0, 60) : ''}`,
      status:   'Pagado',
      tipo:     'deposito_caja_chica',
      proyecto_id: proyectoId || null,
      obraId,
      movimiento_caja_chica_id: movCajaChicaId,
    });
    // Marcar el movimiento de caja chica como ya asentado
    await _dbRef(`/shared/cajaChica/${obraId}/movimientos/${movCajaChicaId}`).update({
      asentadoAt: Date.now(),
      asentadoBancarioId: created.id,
      folioBancario: folio
    });
    return { movCajaChicaId, mifelMovId: created.id, folio };
  }

  // Efectivo: solo el registro en /shared/cajaChica, sin egreso bancario.
  return { movCajaChicaId, mifelMovId: null, folio: null };
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
