/* =====================================================
   SOGRUB Bitácora — Vista: Detalle de Proyecto
   ===================================================== */
'use strict';

const _detalleState = { filtroTipo: 'todos', filtroStatus: 'Todos', filtroCategoria: 'Todas', filtroProveedor: 'Todos', activeTab: 'movimientos' };

const _driveIcon = (size = 12) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor"><path d="M4.433 22l-2.775-4.8 5.775-10h5.55L4.433 22zm9.042-10H22l-4.8 8.35-2.725-4.675L19.567 12h-6.092zm-1.15-2L9.55 5.65l2.725-4.65L19.567 12h-7.242zM7.258 5.65L4.433 10.8l2.825-5.15 2.725 4.675L7.258 5.65z"/></svg>`;

function renderDetalle(proyectoId) {
  const root = document.getElementById('detalle-root');
  root.innerHTML = '';

  const proyecto = getItem(KEYS.PROYECTOS, proyectoId);
  if (!proyecto) {
    root.innerHTML = '<p class="text-muted" style="padding:40px">Proyecto no encontrado.</p>';
    return;
  }

  // ---- Avance de obra (app-estimaciones) ----
  // Trae el valor de venta de lo ya ejecutado, sin el cual no se puede
  // separar la utilidad realizada del anticipo del cliente. Llega async: al
  // resolver se repintan los KPIs y, si está abierto, el tab de análisis.
  Promise.all([
    cargarAvanceObra(proyectoId),
    cargarProgramaObra(proyectoId),
    cargarContratoOC(proyectoId),      // contrato vigente con órdenes de cambio
  ]).then(() => {
    if (_activeProyecto !== proyectoId) return;
    refreshDetalleKPIs(proyectoId);
    refreshBolsitas(proyectoId);
    if (_detalleState.activeTab === 'analisis') renderAnalisisObraTab(proyectoId);
  });

  // ---- Suscribir presupuesto OPUS en cuanto se abre el proyecto ----
  // (necesario para que buildGastoDesgloseSection tenga datos aunque el tab no se haya visitado)
  subscribePresupuesto(proyectoId, () => {
    // Si el tab presupuesto está activo, re-renderizarlo
    if (_detalleState.activeTab === 'presupuesto') _renderPresContenido(proyectoId);
  });

  // ---- Breadcrumb ----
  const bc = document.createElement('div');
  bc.className = 'breadcrumb';
  bc.innerHTML = `
    <button class="breadcrumb-link" id="bc-back">Proyectos</button>
    <span class="breadcrumb-sep">›</span>
    <span class="breadcrumb-current">${proyecto.nombre}</span>
  `;
  bc.querySelector('#bc-back').addEventListener('click', () => navigateTo('proyectos'));
  root.appendChild(bc);

  // ---- KPI 6-grid ----
  root.appendChild(renderDetalleKPIs(proyectoId, proyecto));

  // ---- Bolsitas de presupuesto por rubro ----
  root.appendChild(renderBolsitasProyecto(proyectoId));
  const _ret = renderFondosRetenidos(proyectoId);
  if (_ret) root.appendChild(_ret);

  // ---- Toolbar acciones ----
  root.appendChild(renderDetalleToolbar(proyectoId, proyecto));

  // ---- Sub-tabs: Movimientos | Presupuesto | Caja chica ----
  const subNav = document.createElement('div');
  subNav.className = 'detalle-sub-nav';
  subNav.innerHTML = `
    <button class="detalle-sub-tab${_detalleState.activeTab === 'movimientos' ? ' active' : ''}" data-tab="movimientos">Movimientos</button>
    <button class="detalle-sub-tab${_detalleState.activeTab === 'analisis' ? ' active' : ''}" data-tab="analisis">📊 Análisis</button>
    <button class="detalle-sub-tab${_detalleState.activeTab === 'presupuesto' ? ' active' : ''}" data-tab="presupuesto">Presupuesto OPUS</button>
    <button class="detalle-sub-tab${_detalleState.activeTab === 'caja_chica' ? ' active' : ''}" data-tab="caja_chica">💰 Caja chica</button>
  `;
  root.appendChild(subNav);

  // ---- Área de contenido de tabs ----
  const contentArea = document.createElement('div');
  contentArea.id = 'detalle-tab-content';
  root.appendChild(contentArea);

  function _showDetalleTab(tab) {
    // Limpiar suscripción de caja chica del tab anterior si aplica
    if (_detalleState.activeTab === 'caja_chica' && tab !== 'caja_chica' &&
        typeof _detenerCajaChica === 'function') {
      _detenerCajaChica(proyectoId);
    }
    // Liberar instancias de Chart.js del tab de análisis al salir
    if (_detalleState.activeTab === 'analisis' && tab !== 'analisis' &&
        typeof destroyAnalisisObraCharts === 'function') {
      destroyAnalisisObraCharts();
    }
    _detalleState.activeTab = tab;
    subNav.querySelectorAll('.detalle-sub-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === tab)
    );
    contentArea.innerHTML = '';

    if (tab === 'movimientos') {
      const chartsWrap = document.createElement('div');
      chartsWrap.id = 'detalle-charts-wrap';
      contentArea.appendChild(chartsWrap);
      refreshDetalleCharts(proyectoId);

      const tableWrap = document.createElement('div');
      tableWrap.id = 'detalle-table-wrap';
      contentArea.appendChild(tableWrap);
      refreshDetalleTable(proyectoId);
    } else if (tab === 'analisis') {
      const aoWrap = document.createElement('div');
      aoWrap.id = 'analisis-obra-tab-wrap';
      contentArea.appendChild(aoWrap);
      renderAnalisisObraTab(proyectoId);
    } else if (tab === 'presupuesto') {
      const presWrap = document.createElement('div');
      presWrap.id = 'presupuesto-tab-wrap';
      contentArea.appendChild(presWrap);
      renderPresupuestoTab(proyectoId);
    } else if (tab === 'caja_chica') {
      const ccWrap = document.createElement('div');
      ccWrap.id = 'caja-chica-tab-wrap';
      contentArea.appendChild(ccWrap);
      renderCajaChicaProyecto(proyectoId);
    }
  }

  subNav.querySelectorAll('.detalle-sub-tab').forEach(btn =>
    btn.addEventListener('click', () => _showDetalleTab(btn.dataset.tab))
  );

  _showDetalleTab(_detalleState.activeTab);
}

// =====================================================
// KPIs
// =====================================================
function renderDetalleKPIs(proyectoId, proyecto) {
  const saldoCaja        = calcSaldoCajaProyecto(proyectoId);
  const saldoDesg        = calcSaldoCajaProyectoDesglose(proyectoId);
  const totalCobrado     = calcTotalCobradoCliente(proyectoId);
  const ivaCobrado       = calcIVACobradoCliente(proyectoId);
  const totalGastado     = calcTotalGastadoPagado(proyectoId);
  const utilidadReal     = calcUtilidadReal(proyectoId);
  const utilidadEst      = calcUtilidadEstimada(proyectoId);
  const trade            = calcLecturaTrade(proyectoId);
  const avance           = calcAvanceFinanciero(proyectoId);
  const avanceCobranza   = calcAvanceCobranza(proyectoId);
  const deudaPend        = calcDeudaPendiente(proyectoId);
  const fondosRet        = calcFondosRetenidos(proyectoId);
  const iva              = calcIVADesglose(proyectoId);
  const presupuesto      = proyecto?.presupuesto_contrato ?? 0;
  const restantePorCobrar = Math.max(0, presupuesto - totalCobrado);
  const ivaBalance       = ivaCobrado.ivaTotal - iva.ivaPagado;

  const cls = avance < 60 ? 'low' : avance < 85 ? 'medium' : 'high';

  const grid = document.createElement('div');
  grid.className = 'detalle-kpi-grid mb-24';
  grid.id = 'detalle-kpi-grid';
  grid.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">💰 Saldo en caja</div>
      <div class="kpi-value ${saldoCaja >= 0 ? 'text-success' : 'text-danger'}" style="font-size:20px">${formatMXN(saldoCaja)}</div>
      <div class="kpi-sub" style="display:flex;flex-direction:column;gap:3px;margin-top:4px">
        <div style="display:flex;justify-content:space-between">
          <span>💳 Electrónico</span>
          <strong style="font-variant-numeric:tabular-nums">${formatMXN(saldoDesg.electronico)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span>💵 Efectivo</span>
          <strong style="font-variant-numeric:tabular-nums">${formatMXN(saldoDesg.efectivo)}</strong>
        </div>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">📥 Total cobrado</div>
      <div class="kpi-value text-success" style="font-size:20px">${formatMXN(totalCobrado)}</div>
      <div class="kpi-sub" style="display:flex;flex-direction:column;gap:3px;margin-top:4px">
        ${ivaCobrado.ivaTotal > 0 ? `
        <div style="display:flex;justify-content:space-between">
          <span>Neto cobrado</span>
          <strong style="font-variant-numeric:tabular-nums">${formatMXN(ivaCobrado.netoTotal)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span>IVA cobrado al cliente</span>
          <strong style="color:var(--accent);font-variant-numeric:tabular-nums">${formatMXN(ivaCobrado.ivaTotal)}</strong>
        </div>
        <div style="border-top:1px solid var(--border);margin-top:2px;padding-top:3px;display:flex;justify-content:space-between">
          <span style="color:${ivaBalance >= 0 ? 'var(--success)' : 'var(--warning)'}">Balance IVA</span>
          <strong style="color:${ivaBalance >= 0 ? 'var(--success)' : 'var(--warning)'};font-variant-numeric:tabular-nums"
            title="IVA cobrado al cliente minus IVA pagado en gastos">${ivaBalance >= 0 ? '+' : ''}${formatMXN(ivaBalance)}</strong>
        </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;${ivaCobrado.ivaTotal > 0 ? '' : ''}">
          <span>Restante por cobrar</span>
          <strong style="color:${restantePorCobrar > 0 ? 'var(--warning)' : 'var(--text-muted)'};font-variant-numeric:tabular-nums">${formatMXN(restantePorCobrar)}</strong>
        </div>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">📤 Total gastado
        <button class="btn-iva-info" title="Ver desglose IVA" data-proyecto="${proyectoId}">ℹ</button>
      </div>
      <div class="kpi-value text-danger" style="font-size:20px">${formatMXN(totalGastado)}</div>
      <div class="kpi-sub iva-desglose hidden" id="iva-desglose-${proyectoId}">
        <div style="font-weight:600;color:var(--text-muted);margin-bottom:3px;font-size:10px;text-transform:uppercase;letter-spacing:.05em">Gastos</div>
        <div>Neto gastado: <strong>${formatMXN(iva.gastoNeto)}</strong></div>
        <div>IVA pagado (gastos): <strong style="color:var(--danger)">${formatMXN(iva.ivaPagado)}</strong></div>
        <div style="color:var(--success)">IVA verificado c/facturas: <strong>${formatMXN(iva.ivaVerificado)}</strong>
          <span style="font-size:10px;color:var(--text-dim)">(${iva.conteos.conFactura} de ${iva.conteos.conIva} gastos con IVA)</span></div>
        <div style="color:var(--warning)" title="IVA que ya pagaste pero todavía no tiene factura que lo respalde. Hasta conseguirla no se puede acreditar.">
          IVA sin factura: <strong>${formatMXN(iva.ivaSinFactura)}</strong>
          <span style="font-size:10px;color:var(--text-dim)">(${iva.conteos.sinFactura} gasto${iva.conteos.sinFactura === 1 ? '' : 's'})</span></div>
        <div style="color:var(--text-dim);font-size:10px;line-height:1.4;margin-top:2px">
          ${iva.conteos.sinIva} gasto${iva.conteos.sinIva === 1 ? '' : 's'} marcado${iva.conteos.sinIva === 1 ? '' : 's'} sin IVA — no generan IVA acreditable.
        </div>
        <div style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px;font-weight:600;color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Cobrado al cliente</div>
        <div>IVA cobrado: <strong style="color:var(--accent)">${formatMXN(ivaCobrado.ivaTotal)}</strong></div>
        <div style="margin-top:3px">Balance IVA:
          <strong style="color:${ivaBalance >= 0 ? 'var(--success)' : 'var(--warning)'}">${ivaBalance >= 0 ? '+' : ''}${formatMXN(ivaBalance)}</strong>
          <span style="font-size:10px;color:var(--text-dim)">(cobrado &minus; pagado)</span>
        </div>
      </div>
      <button class="btn btn-secondary btn-sm" id="btn-estado-cuenta-${proyectoId}"
        style="margin-top:8px;font-size:11px;padding:4px 10px">
        📄 Generar estado de cuenta
      </button>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">📈 Utilidad</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
        <div>
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px"
               title="Venta de lo ya ejecutado (a precio de catálogo, sin IVA) menos el costo incurrido. Esto es lo que de verdad has ganado.">
            Realizada (lo ya ejecutado)
          </div>
          ${trade.tieneAvance ? `
            <div class="kpi-value ${trade.pnlRealizado >= 0 ? 'text-success' : 'text-danger'}" style="font-size:17px">
              ${formatMXN(trade.pnlRealizado)}
              ${trade.margenRealizado !== null
                ? `<span style="font-size:12px;color:var(--text-muted);font-weight:400"> · ${trade.margenRealizado.toFixed(1)}%</span>` : ''}
            </div>`
          : `<div class="text-muted" style="font-size:12px;line-height:1.4">Pendiente — requiere el avance de la app de estimaciones</div>`}
        </div>
        <div style="border-top:1px solid var(--border);padding-top:8px">
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px"
               title="Contrato menos costo presupuestado. Es el objetivo de la obra si todo sale según lo planeado.">
            Esperada (obra completa)
          </div>
          <div class="kpi-value ${trade.utilidadEsperada >= 0 ? 'text-success' : 'text-danger'}" style="font-size:17px">${formatMXN(trade.utilidadEsperada)}</div>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:8px">
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px"
               title="Cobrado menos gastado. Es caja, no utilidad: incluye el anticipo del cliente por obra que todavía no ejecutas.">
            Flujo de caja <span style="text-transform:none;letter-spacing:0">(cobrado − gastado)</span>
          </div>
          <div class="${utilidadReal >= 0 ? 'text-success' : 'text-danger'}" style="font-size:15px;font-weight:600">${formatMXN(utilidadReal)}</div>
        </div>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">📊 Avance financiero</div>
      <div class="kpi-value" style="font-size:20px">${avanceCobranza.toFixed(1)}%</div>
      <div class="progress-bar" style="margin-top:6px">
        <div class="progress-fill" style="width:${Math.min(avanceCobranza,100)}%;background:var(--accent)"></div>
      </div>
      <div class="kpi-sub">cobrado de ${formatMXN(proyecto.presupuesto_contrato)} contratados</div>
      <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:6px">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span style="font-size:11px;color:var(--text-muted)"
                title="Lo que la empresa ya tuvo que poner para sacar la obra adelante, como % del contrato.">
            💸 Capital gastado
          </span>
          <strong style="font-size:12px;font-variant-numeric:tabular-nums">${avance.toFixed(1)}%</strong>
        </div>
        ${!trade.tieneAvance ? `
          <div class="progress-bar" style="margin-top:4px;height:6px">
            <div class="progress-fill ${cls}" style="width:${Math.min(avance, 100)}%"></div>
          </div>`
        : (() => {
            // Las dos barras comparten color de base a propósito: miden lo
            // mismo (% del contrato) y sólo la brecha lleva color, que es lo
            // único que hay que interpretar.
            // Capital ejecutado = valor de venta de lo ya producido, sobre el
            // mismo contrato que el gastado, para que las dos barras comparen.
            const ejec  = (trade.vEjec / (proyecto.presupuesto_contrato || 1)) * 100;
            const brecha = ejec - avance;                 // + produces más de lo que gastas
            const base  = Math.max(0, Math.min(avance, ejec));
            const ancho = Math.min(Math.abs(brecha), 100 - base);
            const color = brecha >= 0 ? 'var(--success)' : 'var(--danger)';
            return `
        <div class="progress-bar" style="margin-top:4px;height:8px">
          <div class="progress-fill" style="width:${Math.min(avance, 100)}%;background:var(--text-muted);opacity:.55"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:8px">
          <span style="font-size:11px;color:var(--text-muted)"
                title="Valor de venta de la obra ya ejecutada (dato de estimaciones), como % del contrato.">
            🏗️ Capital ejecutado
          </span>
          <strong style="font-size:12px;font-variant-numeric:tabular-nums">${ejec.toFixed(1)}%</strong>
        </div>
        <div class="progress-bar" style="margin-top:4px;height:8px;position:relative;overflow:hidden"
             title="La barra llega hasta el menor de los dos; el tramo de color es la brecha entre ejecutado y gastado.">
          <div style="position:absolute;inset:0 auto 0 0;width:${Math.min(base, 100)}%;background:var(--text-muted);opacity:.55"></div>
          <div style="position:absolute;top:0;bottom:0;left:${Math.min(base, 100)}%;width:${ancho}%;background:${color}"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:4px">
          <span style="font-size:10px;color:var(--text-muted)">
            ${brecha >= 0 ? 'Produces más de lo que gastas' : 'Gastas más de lo que produces'}
          </span>
          <strong style="font-size:11px;font-variant-numeric:tabular-nums;color:${color}">
            ${brecha >= 0 ? '+' : '−'}${Math.abs(brecha).toFixed(1)} pts
          </strong>
        </div>`;
          })()}
      </div>
    </div>
    <div class="kpi-card" id="kpi-deuda-pendiente-${proyectoId}">
      <div class="kpi-label">⚠️ Deuda pendiente</div>
      <div class="kpi-value ${(deudaPend + fondosRet.pendiente) > 0 ? 'text-warning' : 'text-muted'}" style="font-size:20px" id="deuda-total-${proyectoId}">${formatMXN(deudaPend + fondosRet.pendiente)}</div>
      <div class="kpi-sub" style="display:flex;flex-direction:column;gap:3px;margin-top:4px" id="deuda-desglose-${proyectoId}">
        <div style="display:flex;justify-content:space-between">
          <span>A proveedores</span>
          <strong style="font-variant-numeric:tabular-nums">${formatMXN(deudaPend)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between" id="deuda-cc-row-${proyectoId}">
          <span>De caja chica</span>
          <strong style="font-variant-numeric:tabular-nums;color:var(--text-muted)" id="deuda-cc-${proyectoId}">—</strong>
        </div>
        ${fondosRet.pendiente > 0 ? `
        <div style="display:flex;justify-content:space-between" title="Fondos de garantía retenidos a subcontratistas. El dinero sigue en tu caja, pero se les debe.">
          <span>🔒 Fondos retenidos</span>
          <strong style="font-variant-numeric:tabular-nums">${formatMXN(fondosRet.pendiente)}</strong>
        </div>` : ''}
      </div>
    </div>
  `;

  // Cargar deuda de caja chica async (vive en /shared/cajaChica)
  setTimeout(() => _cargarDeudaCajaChica(proyectoId, deudaPend + fondosRet.pendiente), 0);

  // Toggle IVA info + botón estado de cuenta
  setTimeout(() => {
    grid.querySelectorAll('.btn-iva-info').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const el = grid.querySelector(`#iva-desglose-${btn.dataset.proyecto}`);
        if (el) el.classList.toggle('hidden');
      });
    });
    const btnEC = grid.querySelector(`#btn-estado-cuenta-${proyectoId}`);
    if (btnEC) btnEC.addEventListener('click', () => generarEstadoDeCuenta(proyectoId));
  }, 0);

  return grid;
}

function detalleKPI(icon, label, valueStr, colorClass) {
  return `
    <div class="kpi-card">
      <div class="kpi-label">${icon} ${label}</div>
      <div class="kpi-value ${colorClass}" style="font-size:20px">${valueStr}</div>
    </div>
  `;
}

// Carga el saldo conciliado de caja chica (async, vive en /shared/cajaChica)
// y, si es negativo, lo refleja en el KPI Deuda Pendiente como "deuda de caja
// chica" — significa que el almacenista puso de su bolsillo. Actualiza el
// total y el desglose en su lugar, sin re-renderizar todo el grid.
async function _cargarDeudaCajaChica(proyectoId, deudaProveedores) {
  try {
    const linksSnap = await _dbRef('/shared/obraLinks').get();
    const links = linksSnap.val() || {};
    const obraId = Object.entries(links).find(([, pid]) => String(pid) === String(proyectoId))?.[0];
    if (!obraId) return;

    const movsSnap = await _dbRef(`/shared/cajaChica/${obraId}/movimientos`).get();
    const movs = movsSnap.val() || {};

    // Réplica de _computeSaldoCajaChica (caja-chica.js), por fondo. Cada
    // movimiento pertenece al fondo 'transferencia' (default) o 'efectivo';
    // la deuda es la suma de los saldos negativos de ambos fondos (alguien
    // puso de su bolsillo en ese fondo).
    let saldoTransfer = 0, saldoEfectivo = 0;
    for (const m of Object.values(movs)) {
      const monto = Number(m.monto) || 0;
      const esFondoEfectivo = m.fondo === 'efectivo';
      if (m.tipo === 'deposito') {
        // Solo depósitos aprobados cuentan (sin estado = aprobado, legacy).
        if ((m.estado || 'aprobado') !== 'aprobado') continue;
        if (esFondoEfectivo) saldoEfectivo += monto;
        else if ((m.metodoDeposito || 'transferencia') !== 'efectivo') saldoTransfer += monto;
        // depósito efectivo informativo (fondo transferencia): no afecta
      } else if (m.tipo === 'gasto' && m.estado === 'aprobado') {
        if (esFondoEfectivo) saldoEfectivo -= monto;
        else saldoTransfer -= monto;
      }
    }
    const deudaCC = Math.max(0, -saldoTransfer) + Math.max(0, -saldoEfectivo);
    const total = deudaProveedores + deudaCC;

    // Update KPI in place
    const totalEl = document.getElementById(`deuda-total-${proyectoId}`);
    const ccEl = document.getElementById(`deuda-cc-${proyectoId}`);
    if (totalEl) {
      totalEl.textContent = formatMXN(total);
      totalEl.className = `kpi-value ${total > 0 ? 'text-warning' : 'text-muted'}`;
      totalEl.style.fontSize = '20px';
    }
    if (ccEl) {
      ccEl.textContent = formatMXN(deudaCC);
      ccEl.style.color = deudaCC > 0 ? 'var(--warning)' : 'var(--text-muted)';
      if (deudaCC > 0) {
        ccEl.title = `El almacenista puso $${deudaCC.toLocaleString('es-MX', {minimumFractionDigits:2})} de su bolsillo (saldo de caja chica negativo). Deposita para reponérselo.`;
      }
    }
  } catch (err) {
    console.warn('[Deuda CC]', err);
  }
}

function refreshDetalleKPIs(proyectoId) {
  const proyecto = getItem(KEYS.PROYECTOS, proyectoId);
  if (!proyecto) return;
  const old = document.getElementById('detalle-kpi-grid');
  if (old) old.replaceWith(renderDetalleKPIs(proyectoId, proyecto));
}

// =====================================================
// BOLSITAS — presupuesto por rubro (costo directo, indirectos, utilidad)
// =====================================================
function renderBolsitasProyecto(proyectoId) {
  const b = calcBolsitasProyecto(proyectoId);
  const card = document.createElement('div');
  card.className = 'card mb-24';
  card.id = 'bolsitas-card';

  // Proyecto sin costo directo configurado (p. ej. creado con el modelo viejo):
  // invitar a configurarlo en vez de mostrar bolsitas vacías.
  if (b.contrato <= 0) {
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div>
          <h3 class="section-title" style="margin:0 0 4px">🎒 Presupuesto por rubro</h3>
          <span class="text-sm text-muted">Captura el costo directo y los sobrecostos para activar las bolsitas.</span>
        </div>
        <button class="btn btn-secondary btn-sm" id="btn-config-bolsitas">⚙️ Configurar presupuesto</button>
      </div>`;
    setTimeout(() => {
      card.querySelector('#btn-config-bolsitas')
        ?.addEventListener('click', () => abrirModalEditarProyecto(proyectoId));
    }, 0);
    return card;
  }

  // Cada bolsita de gasto: barra presupuesto vs. gastado. Cuando la obra tiene
  // órdenes de cambio aplicadas se agrega la línea Original → Ajuste → Vigente;
  // sin OC no se muestra nada de eso para no ensuciar la vista.
  const _bolsaRow = (bag) => {
    const pctFill = Math.min(bag.pct, 100);
    const cls = bag.pct > 100 ? 'high' : bag.pct >= 85 ? 'medium' : 'low';
    const sobregiro = bag.overflow > 0;
    const conAjuste = b.tieneOC && Math.abs(bag.ajuste) > 0.005;
    // Devengado y sin pagar: se raya encima de la barra para que un sobregiro
    // ya firmado no aparezca recién cuando se liquide.
    const comprometido = bag.comprometido || 0;
    return `
      <div class="bolsa-row">
        <div class="bolsa-head">
          <span class="bolsa-label">${bag.icon} ${bag.label}</span>
          <span class="bolsa-nums">
            <strong class="${sobregiro ? 'text-danger' : ''}">${formatMXN(bag.gastado)}</strong>
            <span class="text-dim"> / ${formatMXN(bag.budget)}</span>
          </span>
        </div>
        <div class="progress-bar" style="height:8px;position:relative">
          <div class="progress-fill ${cls}" style="width:${pctFill}%"></div>
          ${comprometido > 0 ? `
            <div title="Comprometido: ${formatMXN(comprometido)} firmado y todavía sin pagar"
                 style="position:absolute;top:0;left:${pctFill}%;height:100%;
                        width:${Math.max(0, Math.min(bag.pctComp, 100) - pctFill)}%;
                        background:repeating-linear-gradient(45deg,var(--warning),var(--warning) 3px,transparent 3px,transparent 6px);
                        opacity:.75"></div>` : ''}
        </div>
        <div class="bolsa-foot">
          <span class="text-dim">${bag.pct.toFixed(0)}% usado${
            comprometido > 0 ? ` <span style="color:var(--warning)">+${(bag.pctComp - bag.pct).toFixed(0)}% comprometido</span>` : ''}</span>
          ${sobregiro
            ? `<span class="text-danger">⚠ Sobregiro ${formatMXN(bag.overflow)} → utilidad</span>`
            : bag.overflowComp > 0
            ? `<span class="text-warning">⚠ Con lo comprometido se sobregira ${formatMXN(bag.overflowComp)}</span>`
            : `<span class="text-muted">Disponible ${formatMXN(bag.restante)}</span>`}
        </div>
        ${conAjuste ? `
          <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:10px;margin-top:3px;color:var(--text-muted)">
            <span>Original ${formatMXN(bag.original)}</span>
            <span style="color:${bag.ajuste >= 0 ? 'var(--success)' : 'var(--warning)'}">
              OC ${bag.ajuste >= 0 ? '+' : '−'}${formatMXN(Math.abs(bag.ajuste))}
            </span>
            <span>Vigente <b style="color:var(--text)">${formatMXN(bag.budget)}</b></span>
          </div>` : ''}
      </div>`;
  };

  const utilNeg = b.utilidadDisponible < 0;
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <h3 class="section-title" style="margin:0">🎒 Presupuesto por rubro</h3>
      <span class="text-sm text-muted">Contrato ${formatMXN(b.contrato)}${b.tieneOC ? ' <span class="text-dim">vigente</span>' : ''}</span>
    </div>
    ${b.tieneOC ? _bolsaCintaOC(proyectoId, b) : ''}
    <div class="bolsas-grid">
      ${b.bolsas.map(_bolsaRow).join('')}
    </div>
    <div class="bolsa-margenes">
      ${b.financiamiento > 0 ? `
        <div class="bolsa-margen-item">
          <span class="text-muted">💵 Financiamiento (reservado)</span>
          <strong>${formatMXN(b.financiamiento)}</strong>
        </div>` : ''}
      <div class="bolsa-margen-item">
        <span class="text-muted">📈 Utilidad planeada</span>
        <strong>${formatMXN(b.utilidadPlaneada)}</strong>
      </div>
      ${b.overflowTotal > 0 ? `
        <div class="bolsa-margen-item">
          <span class="text-danger">− Sobregiros de otras bolsitas</span>
          <strong class="text-danger">${formatMXN(b.overflowTotal)}</strong>
        </div>` : ''}
      ${b.utilidadRetirada > 0 ? `
        <div class="bolsa-margen-item" title="Utilidad que ya salió de la obra a SOGRUB. Ese dinero ya es libre: no hay que justificarlo contra el proyecto.">
          <span class="text-muted">− 💸 Utilidad cobrada (retirada a SOGRUB)</span>
          <strong>${formatMXN(b.utilidadRetirada)}</strong>
        </div>` : ''}
      <div class="bolsa-margen-item bolsa-margen-total">
        <span style="font-weight:600">${b.utilidadRetirada > 0 ? 'Utilidad por cobrar' : 'Utilidad disponible'}</span>
        <strong class="${utilNeg ? 'text-danger' : 'text-success'}" style="font-size:16px">${formatMXN(b.utilidadDisponible)}</strong>
      </div>
      ${b.utilidadRetirada > 0 ? `
        <div class="text-muted" style="font-size:11px;margin-top:6px;line-height:1.5">
          Ya cobraste <b>${formatMXN(b.utilidadRetirada)}</b> de los ${formatMXN(b.utilidadPlaneada)} planeados${
            b.overflowTotal > 0 ? `; los sobregiros (${formatMXN(b.overflowTotal)}) se siguen comiendo lo que queda` : ''}.
        </div>` : ''}
    </div>
  `;
  return card;
}

// Cinta con el resumen de órdenes de cambio: contrato antes → después, el neto
// y la lista de OC aplicadas. Solo se dibuja si la obra tiene alguna.
function _bolsaCintaOC(proyectoId, b) {
  const ocs = listaOrdenesCambio(proyectoId);
  const val = validarContratoOC(proyectoId);
  const neto = b.netoAcumCIVA;
  const color = neto >= 0 ? 'var(--success)' : 'var(--warning)';

  const detalle = ocs.map(o => {
    const n = Number(o.montoNeto) || 0;
    return `<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0">
      <span>OC #${o.numero}${o.fecha ? ` · ${formatDate(String(o.fecha).slice(0, 10))}` : ''} —
        ${(o.descripcion || 'sin descripción').slice(0, 60)}</span>
      <strong style="font-variant-numeric:tabular-nums;color:${n >= 0 ? 'var(--success)' : 'var(--warning)'}">
        ${n >= 0 ? '+' : '−'}${formatMXN(Math.abs(n))}
      </strong>
    </div>`;
  }).join('');

  return `
    <details style="margin-bottom:14px;background:var(--surface2);border-left:3px solid ${color};border-radius:var(--radius);padding:10px 12px">
      <summary style="cursor:pointer;font-size:12px;color:var(--text-muted);list-style:none">
        📐 <b style="color:var(--text)">${b.numOC} orden${b.numOC === 1 ? '' : 'es'} de cambio</b>
        aplicada${b.numOC === 1 ? '' : 's'} · neto
        <b style="color:${color}">${neto >= 0 ? '+' : '−'}${formatMXN(Math.abs(neto))}</b> c/IVA
        ${b.contratoOriginalCIVA && b.contratoVigenteCIVA
          ? ` · ${formatMXN(b.contratoOriginalCIVA)} → <b style="color:var(--text)">${formatMXN(b.contratoVigenteCIVA)}</b>`
          : ''}
        <span class="text-dim">· ver detalle</span>
      </summary>
      <div style="margin-top:8px;font-size:11px;color:var(--text-muted);line-height:1.5">
        ${detalle || '<span class="text-dim">Sin detalle por OC.</span>'}
        <div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;display:flex;gap:14px;flex-wrap:wrap">
          <span>Aditivas <b style="color:var(--success)">+${formatMXN(b.aditivasAcum)}</b></span>
          <span>Deductivas <b style="color:var(--warning)">−${formatMXN(b.deductivasAcum)}</b></span>
          <span class="text-dim">(sin IVA)</span>
        </div>
        ${val && !val.cuadra ? `
          <div style="margin-top:6px;color:var(--danger)">
            ⚠ El nodo que publica estimaciones no cuadra:
            ${val.pruebas.filter(p => !p.ok).map(p => `${p.nombre} (dif ${formatMXN(p.dif)})`).join(' · ')}.
            No se ajusta nada acá — hay que revisarlo en estimaciones.
          </div>` : ''}
      </div>
    </details>`;
}

function refreshBolsitas(proyectoId) {
  const old = document.getElementById('bolsitas-card');
  if (old) old.replaceWith(renderBolsitasProyecto(proyectoId));
  // La tarjeta de retenciones aparece/desaparece según haya fondos, así que
  // hay que poder crearla cuando antes no existía.
  const oldRet = document.getElementById('retenciones-card');
  const nueva  = renderFondosRetenidos(proyectoId);
  if (oldRet && nueva)      oldRet.replaceWith(nueva);
  else if (oldRet)          oldRet.remove();
  else if (nueva) {
    const bols = document.getElementById('bolsitas-card');
    if (bols?.parentNode) bols.parentNode.insertBefore(nueva, bols.nextSibling);
  }
}

// =====================================================
// FONDOS RETENIDOS A SUBCONTRATISTAS
//
// Plata que le debes al sub y que sigue en tu caja. Conviene tenerla a la
// vista: no aparece en el gasto (retener no es gastar) y es fácil olvidarla
// hasta que el sub la reclama meses después.
//
// Devuelve null si el proyecto no tiene retenciones — la tarjeta no se pinta.
// =====================================================
function renderFondosRetenidos(proyectoId) {
  const f = calcFondosRetenidos(proyectoId);
  if (!f.count) return null;

  const comp = calcComprometidoSubcontratistas(proyectoId);
  const card = document.createElement('div');
  card.className = 'card mb-24';
  card.id = 'retenciones-card';

  const fila = (r) => {
    const liberado = r.estado === 'liberado';
    return `
      <tr>
        <td>
          <div style="font-weight:500">${r.proveedorNombre || '—'}</div>
          <div class="text-muted" style="font-size:11px">${r.subcontratoNombre || '—'}${r.subEstimacionNumero != null ? ` · estim. #${r.subEstimacionNumero}` : ''}</div>
        </td>
        <td class="text-muted" style="font-size:12px">
          ${r.etiqueta || 'Fondo de garantía'}
          ${r.modo === 'pct' && r.pct ? `<span class="text-dim"> (${(Number(r.pct) * 100).toFixed(2).replace(/\.?0+$/, '')}%)</span>` : ''}
        </td>
        <td class="text-muted" style="font-size:12px">${formatDate(r.fecha)}</td>
        <td class="font-mono text-right ${liberado ? 'text-muted' : 'text-warning'}">${formatMXN(r.monto)}</td>
        <td>
          ${liberado
            ? `<span class="badge badge-success" style="font-size:10px" title="Liberado el ${formatDate(r.liberadoFecha)}">🔓 Liberado ${r.liberadoFecha ? formatDate(r.liberadoFecha) : ''}</span>`
            : `<span class="badge badge-warning" style="font-size:10px">🔒 Pendiente</span>`}
        </td>
      </tr>`;
  };

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;flex-wrap:wrap;gap:8px">
      <h3 class="section-title" style="margin:0">🔒 Fondos retenidos a subcontratistas</h3>
      <span class="text-sm ${f.pendiente > 0 ? 'text-warning' : 'text-muted'}">
        Por liberar <b>${formatMXN(f.pendiente)}</b>
      </span>
    </div>
    <div class="text-sm text-muted" style="margin-bottom:12px">
      Garantía por vicios ocultos. El dinero <b>sigue en tu caja</b> — no está en el gasto — pero se le debe al sub.
    </div>

    <div style="display:flex;gap:20px;flex-wrap:wrap;padding:10px 12px;background:var(--surface2);border-radius:var(--radius);margin-bottom:14px">
      <div>
        <div class="text-muted" style="font-size:11px">Pagado a subcontratistas</div>
        <div class="font-mono" style="font-size:15px">${formatMXN(comp.pagado)}</div>
      </div>
      <div>
        <div class="text-muted" style="font-size:11px">(+) Fondo retenido</div>
        <div class="font-mono text-warning" style="font-size:15px">${formatMXN(comp.fondo)}</div>
      </div>
      <div style="border-left:1px solid var(--border);padding-left:20px">
        <div class="text-muted" style="font-size:11px">(=) Comprometido con subs</div>
        <div class="font-mono" style="font-size:15px;font-weight:600">${formatMXN(comp.total)}</div>
      </div>
    </div>

    <div class="table-wrap">
      <table class="data-table" style="width:100%">
        <thead><tr>
          <th>Subcontratista</th><th>Concepto</th><th>Fecha</th>
          <th class="text-right">Monto</th><th>Estado</th>
        </tr></thead>
        <tbody>${f.retenciones.map(fila).join('')}</tbody>
      </table>
    </div>
    ${f.liberado > 0 ? `<div class="text-muted" style="font-size:11px;margin-top:8px">
      Ya liberado históricamente: <b>${formatMXN(f.liberado)}</b> — eso sí está dentro del gasto del proyecto.
    </div>` : ''}`;
  return card;
}

// =====================================================
// CHARTS — Gasto por categoría y por proveedor
// =====================================================
function refreshDetalleCharts(proyectoId) {
  const wrap = document.getElementById('detalle-charts-wrap');
  if (!wrap) return;

  const porCategoria  = calcGastoPorCategoria(proyectoId);
  const porProveedor  = calcGastoPorProveedor(proyectoId);

  wrap.innerHTML = `
    <div class="charts-grid mb-24">
      <div class="card">
        <h3 class="section-title" style="margin-bottom:12px">Gasto por Categoría</h3>
        ${renderBarChart(porCategoria, { title: '' })}
      </div>
      <div class="card">
        <h3 class="section-title" style="margin-bottom:12px">Gasto por Proveedor</h3>
        ${renderBarChart(porProveedor, { title: '', collapseAfter: 15 })}
      </div>
    </div>
  `;
}

// =====================================================
// TOOLBAR ACCIONES
// =====================================================
function renderDetalleToolbar(proyectoId, proyecto) {
  const bar = document.createElement('div');
  bar.className = 'toolbar mb-20';
  bar.style.flexWrap = 'wrap';
  bar.innerHTML = `
    <button class="btn btn-primary" id="btn-gasto">＋ Registrar gasto</button>
    <button class="btn btn-secondary" id="btn-abono">＋ Abono del cliente</button>
    <button class="btn btn-secondary" id="btn-recibir">⇄ Recibir de SOGRUB</button>
    <button class="btn btn-secondary" id="btn-retirar-utilidad" title="Pasa dinero de la obra a SOGRUB. Deja de estar comprometido con el proyecto.">💸 Retirar utilidad</button>
    <button class="btn btn-secondary" id="btn-proveedores-proy">📋 Proveedores</button>
    <button class="btn btn-secondary" id="btn-facturas-lote">📄 Cargar facturas</button>
    <div class="toolbar-spacer"></div>
    <button class="btn btn-ghost btn-sm" id="btn-editar-proy">✏️ Editar proyecto</button>
  `;

  bar.querySelector('#btn-gasto').addEventListener('click', () =>
    abrirModalMovProy(proyectoId, 'gasto'));
  bar.querySelector('#btn-abono').addEventListener('click', () =>
    abrirModalMovProy(proyectoId, 'abono_cliente'));
  bar.querySelector('#btn-retirar-utilidad').addEventListener('click', () =>
    abrirModalRetirarUtilidad(proyectoId));
  bar.querySelector('#btn-recibir').addEventListener('click', () =>
    abrirModalRecibirSOGRUB(proyectoId));
  bar.querySelector('#btn-proveedores-proy').addEventListener('click', () =>
    abrirModalProveedoresProyecto(proyectoId));
  bar.querySelector('#btn-facturas-lote').addEventListener('click', () =>
    abrirModalFacturasLote(proyectoId));
  bar.querySelector('#btn-editar-proy').addEventListener('click', () =>
    abrirModalEditarProyecto(proyectoId));

  return bar;
}

// =====================================================
// TABLA MOVIMIENTOS DEL PROYECTO
// =====================================================
function refreshDetalleTable(proyectoId) {
  const wrap = document.getElementById('detalle-table-wrap');
  if (!wrap) return;

  // Proveedores únicos del proyecto para el filtro
  const allMovs      = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? []).filter(m => m.proyecto_id === proyectoId);
  const proveedores  = [...new Set(allMovs.map(m => m.subcontratista).filter(Boolean))].sort();

  // Filtros toolbar
  const filterBar = document.createElement('div');
  filterBar.className = 'toolbar mb-16';
  filterBar.style.flexWrap = 'wrap';
  filterBar.innerHTML = `
    <span class="text-muted text-sm">Filtrar:</span>
    <select class="filter-select" id="dt-filter-tipo">
      <option value="todos">Todos los tipos</option>
      <option value="gasto">Gastos</option>
      <option value="abono_cliente">Abonos cliente</option>
      <option value="transferencia_sogrub">De SOGRUB</option>
      <option value="deposito_caja_chica">Depósito caja chica</option>
      <option value="devolucion_caja_chica">Devolución caja chica</option>
    </select>
    <select class="filter-select" id="dt-filter-categoria">
      <option value="Todas">Todas las categorías</option>
      ${CATEGORIAS.map(c => `<option value="${c}">${c}</option>`).join('')}
    </select>
    <select class="filter-select" id="dt-filter-proveedor">
      <option value="Todos">Todos los proveedores</option>
      ${proveedores.map(p => `<option value="${p}">${p}</option>`).join('')}
    </select>
    <select class="filter-select" id="dt-filter-status">
      <option value="Todos">Todos los status</option>
      <option value="Pagado">Pagado</option>
      <option value="Pendiente">Pendiente</option>
    </select>
  `;

  wrap.innerHTML = '';
  wrap.appendChild(filterBar);

  // Restore filter values
  filterBar.querySelector('#dt-filter-tipo').value       = _detalleState.filtroTipo;
  filterBar.querySelector('#dt-filter-categoria').value  = _detalleState.filtroCategoria;
  filterBar.querySelector('#dt-filter-proveedor').value  = _detalleState.filtroProveedor;
  filterBar.querySelector('#dt-filter-status').value     = _detalleState.filtroStatus;

  filterBar.querySelector('#dt-filter-tipo').addEventListener('change', e => {
    _detalleState.filtroTipo = e.target.value;
    renderDetalleTableOnly(proyectoId, wrap);
  });
  filterBar.querySelector('#dt-filter-categoria').addEventListener('change', e => {
    _detalleState.filtroCategoria = e.target.value;
    renderDetalleTableOnly(proyectoId, wrap);
  });
  filterBar.querySelector('#dt-filter-proveedor').addEventListener('change', e => {
    _detalleState.filtroProveedor = e.target.value;
    renderDetalleTableOnly(proyectoId, wrap);
  });
  filterBar.querySelector('#dt-filter-status').addEventListener('change', e => {
    _detalleState.filtroStatus = e.target.value;
    renderDetalleTableOnly(proyectoId, wrap);
  });

  renderDetalleTableOnly(proyectoId, wrap);
}

function renderDetalleTableOnly(proyectoId, wrap) {
  const existing = wrap.querySelector('#detalle-data-table');
  if (existing) existing.remove();

  let movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId);

  if (_detalleState.filtroTipo !== 'todos') {
    movs = movs.filter(m => m.tipo === _detalleState.filtroTipo);
  }
  if (_detalleState.filtroCategoria !== 'Todas') {
    movs = movs.filter(m => m.categoria === _detalleState.filtroCategoria);
  }
  if (_detalleState.filtroProveedor !== 'Todos') {
    movs = movs.filter(m => m.subcontratista === _detalleState.filtroProveedor);
  }
  if (_detalleState.filtroStatus !== 'Todos') {
    movs = movs.filter(m => m.status === _detalleState.filtroStatus);
  }

  movs = sortByFechaDesc(movs);

  const tableWrap = document.createElement('div');
  tableWrap.id = 'detalle-data-table';

  if (movs.length === 0) {
    tableWrap.appendChild(emptyState({
      icon:  svgEmptyMovimientos(),
      title: 'Sin movimientos',
      desc:  'Registra gastos, abonos del cliente o transferencias de SOGRUB.',
    }));
    wrap.appendChild(tableWrap);
    return;
  }

  tableWrap.innerHTML = `
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Concepto</th>
            <th>Categoría</th>
            <th>Proveedor</th>
            <th>Tipo</th>
            <th>Monto</th>
            <th>IVA</th>
            <th>Status</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${movs.map(m => {
            const colorMonto = m.monto >= 0 ? 'amount-positive' : 'amount-negative';
            const ivaLabel = m.tipo === 'gasto'
              ? (m.incluye_iva ? '<span class="badge badge-success badge-no-dot" style="font-size:10px">Con IVA</span>' : '<span class="badge badge-muted badge-no-dot" style="font-size:10px">Sin IVA</span>')
              : '—';
            const _driveBadge = (url, label) =>
              `<a href="${url}" target="_blank" rel="noopener noreferrer"
                  class="badge badge-info badge-no-dot drive-badge"
                  style="font-size:10px;text-decoration:none;display:inline-flex;align-items:center;gap:3px">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M4.433 22l-2.775-4.8 5.775-10h5.55L4.433 22zm9.042-10H22l-4.8 8.35-2.725-4.675L19.567 12h-6.092zm-1.15-2L9.55 5.65l2.725-4.65L19.567 12h-7.242zM7.258 5.65L4.433 10.8l2.825-5.15 2.725 4.675L7.258 5.65z"/></svg>
                  ${label}
                </a>`;
            const facturaIcon = [
              m.factura_drive_url ? _driveBadge(m.factura_drive_url, 'PDF') : m.factura_nombre ? `<span class="badge badge-muted badge-no-dot" style="font-size:10px">📄 PDF</span>` : '',
              m.factura_xml_url   ? _driveBadge(m.factura_xml_url,   'XML') : m.factura_xml_nombre ? `<span class="badge badge-muted badge-no-dot" style="font-size:10px">📄 XML</span>` : '',
            ].filter(Boolean).join(' ');
            return `
              <tr>
                <td class="text-muted">${formatDate(m.fecha)}</td>
                <td>${m.concepto || '—'}</td>
                <td>${m.tipo === 'gasto' ? categoriaBadge(m.categoria) + (m.categoria === 'Indirecto' && m.indirecto_ambito ? ` <span class="badge badge-muted badge-no-dot" style="font-size:10px">${m.indirecto_ambito === 'campo' ? '🚧 Campo' : '🏢 Oficina'}</span>` : '') + (m.paga_de_caja_chica ? ` <span class="badge badge-warning" style="font-size:10px" title="Pagado con caja chica${m.fondo_caja === 'efectivo' ? ' (fondo efectivo)' : ''} · no descuenta saldo del proyecto (ya bajó al depositar)">${m.fondo_caja === 'efectivo' ? '💵 caja chica efectivo' : '💰 caja chica'}</span>` : '') : '—'}</td>
                <td class="text-muted">${m.subcontratista || '—'}</td>
                <td>${tipoBadge(m.tipo)}${((m.tipo === 'gasto' || m.tipo === 'abono_cliente') && !m.paga_de_caja_chica) ? ` <span class="badge badge-muted badge-no-dot" style="font-size:10px" title="${m.metodo_pago === 'efectivo' ? 'Pagado en efectivo (caja física)' : m.metodo_pago === 'transferencia' ? 'Pagado por transferencia (Mifel)' : 'Forma de pago no especificada — se asume transferencia (Mifel). Edita el movimiento si salió de efectivo.'}">${m.metodo_pago === 'efectivo' ? '💵 Efectivo' : '🏦 Transf.'}${m.metodo_pago ? '' : '<span style="opacity:.55"> ?</span>'}</span>` : ''}</td>
                <td class="${colorMonto} font-mono">${formatMXN(m.monto)}</td>
                <td>${ivaLabel}${facturaIcon}</td>
                <td>${m.tipo === 'gasto' ? _statusPagoBadge(m) : statusBadge(m.status)}</td>
                <td>
                  <div class="td-actions">
                    ${m.tipo === 'gasto' && !m.paga_de_caja_chica
                      ? `<button class="btn btn-ghost btn-icon btn-pagos-pm" data-id="${m.id}" title="Pagos (exhibiciones)">💵</button>` : ''}
                    <button class="btn btn-ghost btn-icon btn-edit-pm" data-id="${m.id}" title="Editar">✏️</button>
                    <button class="btn btn-ghost btn-icon btn-del-pm"  data-id="${m.id}" title="Eliminar">🗑️</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  tableWrap.querySelectorAll('.btn-pagos-pm').forEach(btn => {
    btn.addEventListener('click', () => abrirModalPagos(proyectoId, btn.dataset.id));
  });
  tableWrap.querySelectorAll('.btn-edit-pm').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = getItem(KEYS.PROY_MOVIMIENTOS, btn.dataset.id);
      if (m) abrirModalMovProy(proyectoId, m.tipo, btn.dataset.id);
    });
  });
  tableWrap.querySelectorAll('.btn-del-pm').forEach(btn => {
    btn.addEventListener('click', () => confirmarEliminarMovProy(btn.dataset.id, proyectoId));
  });

  wrap.appendChild(tableWrap);
}

// =====================================================
// MODAL: GASTO / ABONO CLIENTE
// =====================================================
// Pastilla de estado de pago para gastos: Pendiente · Parcial (%) · Pagado.
function _statusPagoBadge(m) {
  const st = statusPagoDe(m);
  if (st !== 'Parcial') {
    const sobre = sobrepagoDe(m);
    return statusBadge(st) + (sobre > 0
      ? ` <span class="badge badge-danger" style="font-size:10px" title="Se pagó más que el monto del gasto">⚠ +${formatMXN(sobre)}</span>` : '');
  }
  const pct = Math.round(fraccionPagadaDe(m) * 100);
  return `<span class="badge badge-warning" style="font-size:11px"
    title="Pagado ${formatMXN(montoPagadoDe(m))} de ${formatMXN(Math.abs(m.monto))} · falta ${formatMXN(saldoPendienteDe(m))}">
    Parcial ${pct}%</span>`;
}

// =====================================================
// MODAL DE PAGOS — las exhibiciones de un gasto
//
// Una obligación, N pagos. La factura sigue siendo una sola por el total; lo
// que se parte es la liquidación (anticipo 60%, liquidación contra entrega…).
// Cuando la suma de exhibiciones alcanza el monto, el gasto queda Pagado.
// =====================================================
function abrirModalPagos(proyectoId, movId) {
  const mov = getItem(KEYS.PROY_MOVIMIENTOS, movId);
  if (!mov) return;
  const total = Math.abs(Number(mov.monto) || 0);

  const render = () => {
    const m       = getItem(KEYS.PROY_MOVIMIENTOS, movId);
    const apps    = aplicacionesPago(m);
    const pagado  = montoPagadoDe(m);
    const pend    = saldoPendienteDe(m);
    const sobre   = sobrepagoDe(m);
    const pct     = Math.min(100, Math.round(fraccionPagadaDe(m) * 100));
    const implic  = apps.length === 1 && apps[0].implicita;

    const filas = apps.length ? apps.map((p, i) => `
      <tr>
        <td class="text-muted" style="font-size:12px">${formatDate(p.fecha)}</td>
        <td>${p.nota || p.referencia || (p.implicita ? '<em class="text-muted">pago único</em>' : '—')}</td>
        <td><span class="badge badge-muted badge-no-dot" style="font-size:10px">${p.metodo_pago === 'efectivo' ? '💵 Efectivo' : '🏦 Transf.'}</span></td>
        <td class="font-mono text-right">${formatMXN(p.monto)}</td>
        <td style="text-align:right">${implic ? '' :
          `<button class="btn btn-ghost btn-icon btn-del-pago" data-i="${i}" title="Eliminar este pago">🗑️</button>`}</td>
      </tr>`).join('')
      : `<tr><td colspan="5" class="text-muted" style="text-align:center;padding:14px">Sin pagos registrados — el gasto está pendiente por completo.</td></tr>`;

    const hoy = todayISO();
    return `
      <div style="margin-bottom:14px">
        <div style="font-weight:600;margin-bottom:2px">${mov.concepto || 'Gasto'}</div>
        <div class="text-muted" style="font-size:12px">${mov.subcontratista || 'Sin proveedor'} · Total ${formatMXN(total)}</div>
      </div>

      <div style="background:var(--surface2);border-radius:var(--radius);padding:12px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">
          <span>Pagado <b class="text-success">${formatMXN(pagado)}</b></span>
          <span>Falta <b class="${pend > 0 ? 'text-warning' : 'text-muted'}">${formatMXN(pend)}</b></span>
        </div>
        <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${pct >= 100 ? 'var(--success)' : 'var(--warning)'};transition:width .2s"></div>
        </div>
        <div class="text-muted" style="font-size:11px;margin-top:5px">${pct}% liquidado${
          sobre > 0 ? ` · <b class="text-danger">⚠ pagado de más ${formatMXN(sobre)}</b>` : ''}</div>
      </div>

      <table class="data-table" style="width:100%;margin-bottom:16px">
        <thead><tr><th>Fecha</th><th>Concepto del pago</th><th>De</th><th class="text-right">Monto</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>

      ${implic ? `<div class="text-muted" style="font-size:11px;margin-bottom:12px;padding:8px 10px;background:var(--surface2);border-radius:var(--radius)">
        Este gasto se marcó como pagado antes de que existieran las exhibiciones. Al agregar un pago aquí, el pago único de arriba se sustituye por lo que captures.
      </div>` : ''}

      <div style="border-top:1px solid var(--border);padding-top:14px">
        <div style="font-weight:600;font-size:13px;margin-bottom:10px">➕ Registrar pago</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label style="font-size:12px">Fecha
            <input type="date" id="pg-fecha" value="${hoy}" class="form-input" style="margin-top:4px;width:100%">
          </label>
          <label style="font-size:12px">Monto
            <input type="number" id="pg-monto" step="0.01" min="0.01" value="${pend > 0 ? pend.toFixed(2) : ''}"
                   placeholder="0.00" class="form-input" style="margin-top:4px;width:100%">
          </label>
          <label style="font-size:12px">Sale de
            <select id="pg-metodo" class="form-input" style="margin-top:4px;width:100%">
              <option value="transferencia">🏦 Transferencia (Mifel)</option>
              <option value="efectivo">💵 Efectivo (caja física)</option>
            </select>
          </label>
          <label style="font-size:12px">Concepto / referencia
            <input type="text" id="pg-nota" placeholder="Anticipo 60%, liquidación…" class="form-input" style="margin-top:4px;width:100%">
          </label>
        </div>

        <div style="margin-top:10px;padding:9px 11px;background:var(--surface2);border-radius:var(--radius)">
          <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
            <span class="text-muted" style="font-size:11px">% del total:</span>
            ${[30, 40, 50, 60, 70, 100].map(v => `
              <button type="button" class="pg-pct-chip" data-pct="${v}"
                style="background:transparent;border:1px solid var(--border);border-radius:20px;
                       padding:2px 10px;font-size:11px;color:var(--text);cursor:pointer;line-height:1.5">${v}%</button>`).join('')}
            <span class="text-dim" style="font-size:11px">o</span>
            <input type="number" id="pg-pct" step="0.01" min="0.01" max="100" placeholder="—"
              style="width:62px;padding:3px 7px;background:var(--bg);border:1px solid var(--border);
                     border-radius:6px;color:var(--text);font-size:11px;text-align:right">
            <span class="text-muted" style="font-size:11px">%</span>
          </div>
          <div id="pg-hint" class="text-muted" style="font-size:11px;margin-top:6px"></div>
        </div>

        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn btn-sm" id="pg-add" style="background:var(--success);color:#0e3a25;border:none">Agregar pago</button>
          ${pend > 0 ? `<button class="btn btn-sm btn-ghost" id="pg-liquidar">Liquidar el saldo (${formatMXN(pend)})</button>` : ''}
        </div>
      </div>`;
  };

  const guardar = (pagos) => {
    const m = getItem(KEYS.PROY_MOVIMIENTOS, movId);
    const tot = Math.abs(Number(m.monto) || 0);
    const sum = pagos.reduce((a, p) => a + Math.abs(Number(p.monto) || 0), 0);
    // `status` se mantiene sincronizado para todo lo que aún lo lee (buzón,
    // otras apps, hooks). El estado parcial vive en `pagos`.
    updateItem(KEYS.PROY_MOVIMIENTOS, movId, {
      pagos,
      status: sum >= tot - 0.005 ? 'Pagado' : 'Pendiente',
    });
    refrescar();
    refreshDetalleKPIs(proyectoId);
    refreshDetalleTable(proyectoId);
    refreshDetalleCharts(proyectoId);
    refreshBolsitas(proyectoId);
  };

  const contenedor = document.createElement('div');

  const refrescar = () => {
    contenedor.innerHTML = render();
    enlazar(contenedor);
  };

  const enlazar = (body) => {
    body.querySelectorAll('.btn-del-pago').forEach(b => {
      b.addEventListener('click', () => {
        const m = getItem(KEYS.PROY_MOVIMIENTOS, movId);
        const ps = (Array.isArray(m.pagos) ? [...m.pagos] : []);
        ps.splice(Number(b.dataset.i), 1);
        guardar(ps);
        showToast('Pago eliminado', 'success');
      });
    });

    const agregar = (monto, nota) => {
      const m = getItem(KEYS.PROY_MOVIMIENTOS, movId);
      const fecha = body.querySelector('#pg-fecha')?.value || todayISO();
      const mnt   = Math.abs(Number(monto));
      if (!(mnt > 0)) { showToast('Ingresa un monto mayor a 0', 'error'); return; }
      // Si venía como pago único implícito, se materializa antes de agregar
      // para no perder el histórico ni duplicar el monto.
      let ps = Array.isArray(m.pagos) ? [...m.pagos] : [];
      if (!ps.length && m.status === 'Pagado' && Math.abs(Number(m.monto) || 0) > 0) ps = [];
      ps.push({
        id: 'pg_' + Math.random().toString(36).slice(2, 10),
        fecha,
        monto: mnt,
        metodo_pago: body.querySelector('#pg-metodo')?.value || 'transferencia',
        nota: (nota ?? body.querySelector('#pg-nota')?.value ?? '').trim(),
      });
      guardar(ps);
      showToast('Pago registrado', 'success');
    };

    // ---- Monto ⇄ % del total, en los dos sentidos -----------------------
    const elMonto = body.querySelector('#pg-monto');
    const elPct   = body.querySelector('#pg-pct');
    const elHint  = body.querySelector('#pg-hint');

    const pintarHint = () => {
      if (!elHint) return;
      const m   = getItem(KEYS.PROY_MOVIMIENTOS, movId);
      const tot = Math.abs(Number(m.monto) || 0);
      const val = Math.abs(Number(elMonto?.value) || 0);
      if (!(val > 0) || !(tot > 0)) {
        elHint.innerHTML = `Total de la obligación: <b>${formatMXN(tot)}</b>`;
        return;
      }
      const pctVal  = (val / tot) * 100;
      const saldoQ  = saldoPendienteDe(m) - val;
      elHint.innerHTML = `<b>${formatMXN(val)}</b> = <b>${pctVal.toFixed(2)}%</b> del total`
        + (saldoQ > 0.005
            ? ` · quedarían <b class="text-warning">${formatMXN(saldoQ)}</b> por pagar`
            : saldoQ < -0.005
            ? ` · <b class="text-danger">⚠ excede el saldo en ${formatMXN(-saldoQ)}</b>`
            : ` · <b class="text-success">liquida el gasto</b>`);
    };

    const aplicarPct = (pct) => {
      const m   = getItem(KEYS.PROY_MOVIMIENTOS, movId);
      const tot = Math.abs(Number(m.monto) || 0);
      const p   = Math.abs(Number(pct) || 0);
      if (!(p > 0) || !(tot > 0)) return;
      // Se redondea a centavos: dos exhibiciones de 60/40 deben sumar el total
      // exacto, no quedar cortas por un decimal perdido.
      if (elMonto) elMonto.value = ((tot * p) / 100).toFixed(2);
      pintarHint();
    };

    body.querySelectorAll('.pg-pct-chip').forEach(ch => {
      ch.addEventListener('click', () => {
        if (elPct) elPct.value = ch.dataset.pct;
        aplicarPct(ch.dataset.pct);
        const nota = body.querySelector('#pg-nota');
        // Sugerencia de concepto, sólo si el campo sigue vacío.
        if (nota && !nota.value.trim()) {
          nota.value = ch.dataset.pct === '100' ? 'Liquidación' : `Anticipo ${ch.dataset.pct}%`;
        }
      });
    });
    elPct?.addEventListener('input', () => aplicarPct(elPct.value));
    elMonto?.addEventListener('input', () => { if (elPct) elPct.value = ''; pintarHint(); });
    pintarHint();

    body.querySelector('#pg-add')?.addEventListener('click',
      () => agregar(body.querySelector('#pg-monto')?.value));
    body.querySelector('#pg-liquidar')?.addEventListener('click', () => {
      const m = getItem(KEYS.PROY_MOVIMIENTOS, movId);
      agregar(saldoPendienteDe(m), body.querySelector('#pg-nota')?.value || 'Liquidación');
    });
  };

  refrescar();
  openModal({
    title: '💵 Pagos del gasto',
    body: contenedor,
    confirmText: 'Cerrar',
    cancelText: 'Salir',
    onConfirm: () => closeModal(),
    large: true,
  });
}

function abrirModalMovProy(proyectoId, tipo, id = null) {
  const mov = id ? getItem(KEYS.PROY_MOVIMIENTOS, id) : null;

  const titulos = {
    gasto:           id ? 'Editar gasto' : 'Registrar gasto',
    abono_cliente:   id ? 'Editar abono' : 'Abono del cliente',
    retiro_utilidad: 'Editar retiro de utilidad',
  };
  const titulo = titulos[tipo] ?? 'Movimiento';
  const esGasto = tipo === 'gasto';
  // Qué movimientos SALEN de la caja de la obra. No es lo mismo que esGasto:
  // el retiro de utilidad sale pero no es gasto (no consume presupuesto ni
  // entra al costo). Sin esta distinción, editar un retiro le volteaba el
  // signo y la obra recibía dinero en vez de perderlo.
  const esSalida = esGasto || tipo === 'retiro_utilidad';

  // Obtener proveedores del proyecto
  const proveedoresProy = (getCollection(KEYS.PROY_PROVEEDORES) ?? [])
    .filter(p => p.proyecto_id === proyectoId);

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="pm-fecha">Fecha</label>
        <input type="date" id="pm-fecha" class="form-input" value="${mov?.fecha ?? todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label" for="pm-monto">Monto ($)</label>
        <input type="number" id="pm-monto" class="form-input" placeholder="0.00" min="0.01" step="0.01"
          value="${mov ? Math.abs(mov.monto) : ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="pm-concepto">Concepto</label>
      <input type="text" id="pm-concepto" class="form-input"
        placeholder="${esGasto ? 'Ej: Materiales, mano de obra…' : 'Ej: Anticipo, pago parcial…'}"
        value="${mov?.concepto ?? ''}">
    </div>
    <div class="form-group">
      <label class="form-label">Forma de pago</label>
      <div class="toggle-group" style="max-width:320px">
        <input type="radio" name="pm-metodo" id="pm-metodo-transf" value="transferencia" class="toggle-option"
          ${(mov?.metodo_pago ?? 'transferencia') === 'transferencia' ? 'checked' : ''}>
        <label for="pm-metodo-transf" class="toggle-label">🏦 Transferencia</label>
        <input type="radio" name="pm-metodo" id="pm-metodo-efec" value="efectivo" class="toggle-option"
          ${mov?.metodo_pago === 'efectivo' ? 'checked' : ''}>
        <label for="pm-metodo-efec" class="toggle-label">💵 Efectivo</label>
      </div>
      <span class="text-dim" style="font-size:11px">${esGasto ? 'De qué caja SOGRUB sale el pago (Mifel o efectivo).' : 'A qué caja SOGRUB entra el cobro (Mifel o efectivo).'}</span>
    </div>
    ${esGasto ? `
    <div class="form-group">
      <label class="form-label" for="pm-categoria">Categoría</label>
      <select id="pm-categoria" class="form-select">
        <option value="">Selecciona categoría</option>
        ${CATEGORIAS.map(c => `<option value="${c}" ${mov?.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
    </div>
    <div class="form-group${mov?.categoria === 'Indirecto' ? '' : ' hidden'}" id="pm-ambito-group">
      <label class="form-label">Ámbito del indirecto</label>
      <div class="toggle-group" style="max-width:280px">
        <input type="radio" name="pm-ambito" id="pm-ambito-oficina" value="oficina" class="toggle-option"
          ${(mov?.indirecto_ambito ?? 'oficina') === 'oficina' ? 'checked' : ''}>
        <label for="pm-ambito-oficina" class="toggle-label">🏢 Oficina</label>
        <input type="radio" name="pm-ambito" id="pm-ambito-campo" value="campo" class="toggle-option"
          ${mov?.indirecto_ambito === 'campo' ? 'checked' : ''}>
        <label for="pm-ambito-campo" class="toggle-label">🚧 Campo</label>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="pm-proveedor">Proveedor <span class="text-dim">(opcional)</span></label>
      <div style="position:relative">
        <input type="text" id="pm-proveedor" class="form-input" placeholder="Buscar o escribir proveedor"
          value="${mov?.subcontratista ?? ''}" list="prov-list-${proyectoId}" autocomplete="off">
        <datalist id="prov-list-${proyectoId}">
          ${proveedoresProy.map(p => `<option value="${p.nombre}">`).join('')}
        </datalist>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">IVA</label>
      <div class="toggle-group" style="max-width:280px">
        <input type="radio" name="pm-iva" id="pm-siniva" value="false" class="toggle-option"
          ${!mov?.incluye_iva ? 'checked' : ''}>
        <label for="pm-siniva" class="toggle-label">Sin IVA</label>
        <input type="radio" name="pm-iva" id="pm-coniva" value="true" class="toggle-option"
          ${mov?.incluye_iva ? 'checked' : ''}>
        <label for="pm-coniva" class="toggle-label">Incluye IVA</label>
      </div>
    </div>
    <div class="form-group hidden" id="pm-factura-group">
      <label class="form-label">Factura <span class="text-dim">(opcional)</span></label>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <div class="text-sm" style="color:var(--text-muted);margin-bottom:4px;font-weight:500">PDF</div>
          <input type="file" id="pm-factura-pdf" class="form-input" accept=".pdf" style="padding:6px 10px">
          ${mov?.factura_drive_url
            ? `<div style="margin-top:4px;display:flex;align-items:center;gap:6px">
                 <a href="${mov.factura_drive_url}" target="_blank" rel="noopener noreferrer"
                    class="btn btn-secondary btn-sm drive-link-btn" style="font-size:11px">
                   ${_driveIcon(12)} Ver PDF en Drive
                 </a>
                 <span class="text-sm text-muted">${mov.factura_nombre ?? ''}</span>
               </div>`
            : mov?.factura_nombre ? `<div class="text-sm text-muted" style="margin-top:4px">📄 ${mov.factura_nombre}</div>` : ''
          }
        </div>
        <div>
          <div class="text-sm" style="color:var(--text-muted);margin-bottom:4px;font-weight:500">XML (CFDI)</div>
          <input type="file" id="pm-factura-xml" class="form-input" accept=".xml" style="padding:6px 10px">
          ${mov?.factura_xml_url
            ? `<div style="margin-top:4px;display:flex;align-items:center;gap:6px">
                 <a href="${mov.factura_xml_url}" target="_blank" rel="noopener noreferrer"
                    class="btn btn-secondary btn-sm drive-link-btn" style="font-size:11px">
                   ${_driveIcon(12)} Ver XML en Drive
                 </a>
                 <span class="text-sm text-muted">${mov.factura_xml_nombre ?? ''}</span>
               </div>`
            : mov?.factura_xml_nombre ? `<div class="text-sm text-muted" style="margin-top:4px">📄 ${mov.factura_xml_nombre}</div>` : ''
          }
        </div>
      </div>
      <div id="pm-ocr-result" class="ocr-result hidden"></div>
    </div>
    <div class="form-group">
      <label class="form-label">Status</label>
      <div class="toggle-group">
        <input type="radio" name="pm-status" id="pm-pagado"   value="Pagado"   class="toggle-option"
          ${(mov?.status ?? 'Pagado') === 'Pagado'   ? 'checked' : ''}>
        <label for="pm-pagado"   class="toggle-label">Pagado</label>
        <input type="radio" name="pm-status" id="pm-pendiente" value="Pendiente" class="toggle-option"
          ${mov?.status === 'Pendiente' ? 'checked' : ''}>
        <label for="pm-pendiente" class="toggle-label">Pendiente</label>
      </div>
    </div>
    ` : `
    <div class="form-group">
      <label class="form-label">IVA</label>
      <div class="toggle-group" style="max-width:280px">
        <input type="radio" name="pm-iva-abono" id="pm-siniva-abono" value="false" class="toggle-option"
          ${!mov?.incluye_iva ? 'checked' : ''}>
        <label for="pm-siniva-abono" class="toggle-label">Sin IVA</label>
        <input type="radio" name="pm-iva-abono" id="pm-coniva-abono" value="true" class="toggle-option"
          ${mov?.incluye_iva ? 'checked' : ''}>
        <label for="pm-coniva-abono" class="toggle-label">Con IVA (16%)</label>
      </div>
      <div id="pm-abono-iva-desglose" style="display:none;margin-top:8px;padding:8px 12px;background:var(--surface2);border-radius:var(--radius);font-size:12px;color:var(--text-muted)">
        Neto: <strong id="pm-abono-neto">—</strong> &nbsp;+&nbsp; IVA 16%: <strong id="pm-abono-iva">—</strong>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="pm-nota">Nota <span class="text-dim">(opcional)</span></label>
      <input type="text" id="pm-nota" class="form-input" placeholder="Nota adicional"
        value="${mov?.subcontratista ?? ''}">
    </div>
    `}
  `;

  // Abono: toggle IVA desglose en tiempo real
  if (!esGasto) {
    setTimeout(() => {
      const montoEl   = body.querySelector('#pm-monto');
      const desglose  = body.querySelector('#pm-abono-iva-desglose');
      const netoEl    = body.querySelector('#pm-abono-neto');
      const ivaEl     = body.querySelector('#pm-abono-iva');
      const updateAbono = () => {
        const conIva = body.querySelector('#pm-coniva-abono')?.checked;
        const monto  = parseFloat(montoEl?.value) || 0;
        if (desglose) desglose.style.display = conIva ? 'block' : 'none';
        if (conIva && netoEl && ivaEl) {
          const neto = monto / 1.16;
          const iva  = monto - neto;
          netoEl.textContent = formatMXN(neto);
          ivaEl.textContent  = formatMXN(iva);
        }
      };
      body.querySelectorAll('input[name="pm-iva-abono"]').forEach(r =>
        r.addEventListener('change', updateAbono));
      montoEl?.addEventListener('input', updateAbono);
      updateAbono();
    }, 0);
  }

  // Show/hide factura field + wire OCR on file selection
  if (esGasto) {
    setTimeout(() => {
      const toggleIVA = () => {
        const conIva = body.querySelector('#pm-coniva')?.checked;
        const factGroup = body.querySelector('#pm-factura-group');
        if (factGroup) factGroup.classList.toggle('hidden', !conIva);
      };
      body.querySelectorAll('input[name="pm-iva"]').forEach(r =>
        r.addEventListener('change', toggleIVA));
      toggleIVA();

      // Ámbito del indirecto: solo visible cuando la categoría es "Indirecto"
      const catSelect  = body.querySelector('#pm-categoria');
      const ambitoGrp  = body.querySelector('#pm-ambito-group');
      const toggleAmbito = () => {
        if (ambitoGrp) ambitoGrp.classList.toggle('hidden', catSelect?.value !== 'Indirecto');
      };
      catSelect?.addEventListener('change', toggleAmbito);
      toggleAmbito();

      // OCR: leer monto desde XML (preferido) o PDF
      const pdfInput   = body.querySelector('#pm-factura-pdf');
      const xmlInput   = body.querySelector('#pm-factura-xml');
      const ocrResult  = body.querySelector('#pm-ocr-result');
      const montoInput = body.querySelector('#pm-monto');

      const _runOCR = async () => {
        const xmlFile = xmlInput?.files?.[0];
        const pdfFile = pdfInput?.files?.[0];
        const file    = xmlFile ?? pdfFile;
        if (!file) return;

        ocrResult.className = 'ocr-result ocr-loading';
        ocrResult.textContent = `🔍 Analizando ${xmlFile ? 'XML' : 'PDF'}…`;
        ocrResult.classList.remove('hidden');

        try {
          const montoOCR = await leerMontoArchivo(file);

          if (montoOCR === null) {
            ocrResult.className = 'ocr-result ocr-warn';
            ocrResult.textContent = `⚠ No se pudo detectar el monto en el ${xmlFile ? 'XML' : 'PDF'}`;
            return;
          }

          const montoIngresado = parseFloat(montoInput.value);
          ocrResult.dataset.ocrMonto = montoOCR;

          if (!montoInput.value || isNaN(montoIngresado)) {
            ocrResult.className = 'ocr-result ocr-suggest';
            ocrResult.innerHTML = `💡 La factura indica <strong>${formatMXN(montoOCR)}</strong>. <button class="btn-ocr-usar" style="color:var(--accent);background:none;border:none;cursor:pointer;font-weight:600;font-size:12px">Usar este monto</button>`;
            ocrResult.querySelector('.btn-ocr-usar')?.addEventListener('click', () => {
              montoInput.value = montoOCR.toFixed(2);
              ocrResult.className = 'ocr-result ocr-ok';
              ocrResult.textContent = `✓ Monto de factura coincide (${formatMXN(montoOCR)})`;
            });
          } else {
            const diff = Math.abs(montoOCR - montoIngresado);
            const pct  = montoIngresado > 0 ? diff / montoIngresado : 1;
            if (pct < 0.01) {
              ocrResult.className = 'ocr-result ocr-ok';
              ocrResult.textContent = `✓ Monto coincide con la factura (${formatMXN(montoOCR)})`;
            } else {
              ocrResult.className = 'ocr-result ocr-mismatch';
              ocrResult.innerHTML = `⚠ Monto ingresado (${formatMXN(montoIngresado)}) ≠ factura (${formatMXN(montoOCR)})`;
            }
          }
        } catch (err) {
          console.error('[OCR]', err);
          ocrResult.className = 'ocr-result ocr-warn';
          ocrResult.textContent = '⚠ Error al leer el archivo';
        }
      };

      pdfInput?.addEventListener('change', _runOCR);
      xmlInput?.addEventListener('change',  _runOCR);

      // ---- Sección de desglose a presupuesto OPUS ----
      const desgloseEl = buildGastoDesgloseSection(proyectoId, mov?.desglose_presupuesto ?? []);
      if (desgloseEl) body.appendChild(desgloseEl);

      // Re-evaluar al cambiar monto manualmente
      montoInput?.addEventListener('input', () => {
        const montoOCR = parseFloat(ocrResult?.dataset.ocrMonto);
        if (!ocrResult || ocrResult.classList.contains('hidden') || isNaN(montoOCR)) return;
        const montoIngresado = parseFloat(montoInput.value);
        if (isNaN(montoIngresado)) return;
        const diff = Math.abs(montoOCR - montoIngresado);
        const pct  = montoIngresado > 0 ? diff / montoIngresado : 1;
        if (pct < 0.01) {
          ocrResult.className = 'ocr-result ocr-ok';
          ocrResult.textContent = `✓ Monto coincide con la factura (${formatMXN(montoOCR)})`;
        } else {
          ocrResult.className = 'ocr-result ocr-mismatch';
          ocrResult.innerHTML = `⚠ Monto ingresado (${formatMXN(montoIngresado)}) ≠ factura (${formatMXN(montoOCR)})`;
        }
      });
    }, 0);
  }

  openModal({
    title:       titulo,
    body,
    confirmText: mov ? 'Guardar cambios' : (esGasto ? 'Registrar gasto' : 'Registrar abono'),
    onConfirm:   async (btn) => {
      const fecha    = body.querySelector('#pm-fecha').value;
      const montoRaw = parseFloat(body.querySelector('#pm-monto').value);
      const concepto = body.querySelector('#pm-concepto').value.trim();
      const subcon   = body.querySelector('#pm-proveedor, #pm-nota')?.value.trim() ?? '';
      const status   = esGasto
        ? (body.querySelector('input[name="pm-status"]:checked')?.value ?? 'Pagado')
        : 'Pagado';
      const categoria = esGasto
        ? (body.querySelector('#pm-categoria')?.value ?? '')
        : '';
      const indirecto_ambito = (esGasto && categoria === 'Indirecto')
        ? (body.querySelector('input[name="pm-ambito"]:checked')?.value ?? 'oficina')
        : '';
      const incluye_iva = esGasto
        ? body.querySelector('#pm-coniva')?.checked ?? false
        : body.querySelector('#pm-coniva-abono')?.checked ?? false;
      const metodo_pago = body.querySelector('input[name="pm-metodo"]:checked')?.value ?? 'transferencia';

      const valid = validateFields([
        { el: body.querySelector('#pm-fecha'),   msg: 'Selecciona una fecha' },
        { el: body.querySelector('#pm-monto'),   msg: 'Ingresa un monto mayor a 0' },
        { el: body.querySelector('#pm-concepto'),msg: 'Escribe un concepto' },
      ]);
      if (!valid) return;

      if (esGasto && !categoria) {
        const catEl = body.querySelector('#pm-categoria');
        catEl.classList.add('error');
        const errEl = document.createElement('span');
        errEl.className = 'form-error-msg';
        errEl.textContent = 'Selecciona una categoría';
        catEl.parentElement.appendChild(errEl);
        catEl.focus();
        return;
      }

      const monto = esSalida ? -montoRaw : montoRaw;

      // Archivos de factura
      let factura_nombre          = mov?.factura_nombre          ?? '';
      let factura_monto_ocr       = mov?.factura_monto_ocr       ?? null;
      let factura_drive_url       = mov?.factura_drive_url       ?? '';
      let factura_drive_id        = mov?.factura_drive_id        ?? '';
      let factura_xml_nombre      = mov?.factura_xml_nombre      ?? '';
      let factura_xml_url         = mov?.factura_xml_url         ?? '';
      let factura_xml_id          = mov?.factura_xml_id          ?? '';
      let factura_drive_folder_id = mov?.factura_drive_folder_id ?? '';
      let uploadPDF = null;
      let uploadXML = null;

      if (esGasto && incluye_iva) {
        const pdfIn = body.querySelector('#pm-factura-pdf');
        const xmlIn = body.querySelector('#pm-factura-xml');
        if (pdfIn?.files?.length > 0) {
          uploadPDF      = pdfIn.files[0];
          factura_nombre = uploadPDF.name;
          factura_drive_url = '';
          factura_drive_id  = '';
          factura_drive_folder_id = '';
        }
        if (xmlIn?.files?.length > 0) {
          uploadXML         = xmlIn.files[0];
          factura_xml_nombre = uploadXML.name;
          factura_xml_url    = '';
          factura_xml_id     = '';
          factura_drive_folder_id = '';
        }
        const ocrVal = parseFloat(body.querySelector('#pm-ocr-result')?.dataset.ocrMonto);
        if (!isNaN(ocrVal)) factura_monto_ocr = ocrVal;
      }

      // Desglose a conceptos de presupuesto OPUS (opcional)
      const desgloseSection = body.querySelector('#pm-desglose-pres');
      const desglose_presupuesto = desgloseSection?._getDesglose?.()
        ?? (mov?.desglose_presupuesto ?? []);

      const data = {
        fecha, monto, concepto,
        subcontratista: subcon,
        status, tipo, proyecto_id: proyectoId,
        categoria,
        indirecto_ambito,
        metodo_pago,
        incluye_iva,
        factura_nombre,
        factura_monto_ocr,
        factura_drive_url,
        factura_drive_id,
        factura_xml_nombre,
        factura_xml_url,
        factura_xml_id,
        factura_drive_folder_id,
        desglose_presupuesto,
      };

      let savedId;
      if (mov) {
        updateItem(KEYS.PROY_MOVIMIENTOS, id, data);
        savedId = id;
        showToast('Movimiento actualizado', 'success');
      } else {
        const nuevo = addItem(KEYS.PROY_MOVIMIENTOS, data);
        savedId = nuevo.id;
        showToast(esGasto ? 'Gasto registrado' : 'Abono registrado', 'success');
      }

      closeModal();
      refreshDetalleKPIs(proyectoId);
      refreshDetalleTable(proyectoId);
      refreshDetalleCharts(proyectoId);
      refreshBolsitas(proyectoId);

      // Sugerir agregar proveedor si es nuevo
      if (subcon) {
        const provsProy = (getCollection(KEYS.PROY_PROVEEDORES) ?? [])
          .filter(p => p.proyecto_id === proyectoId);
        const yaExiste = provsProy.some(p => p.nombre.trim().toLowerCase() === subcon.toLowerCase());
        if (!yaExiste) {
          // Intentar extraer RFC del XML si hay uno
          const emisorXML = uploadXML ? await leerEmisorDesdeXML(uploadXML).catch(() => null) : null;
          _sugerirAgregarProveedor(proyectoId, subcon, emisorXML);
        }
      }

      // Subir PDF y/o XML a Drive en segundo plano
      if ((uploadPDF || uploadXML) && driveAvailable()) {
        const label = [uploadPDF && 'PDF', uploadXML && 'XML'].filter(Boolean).join(' + ');
        showToast(`📤 Subiendo ${label} a Drive…`, 'info');
        driveUploadFactura({ pdf: uploadPDF, xml: uploadXML }, proyectoId, {
          concepto, fecha,
          existing: {
            folderId: mov?.factura_drive_folder_id ?? null,
            pdfId:    uploadPDF ? (mov?.factura_drive_id  ?? null) : null,
            xmlId:    uploadXML ? (mov?.factura_xml_id    ?? null) : null,
          },
        })
          .then(result => {
            const updates = { factura_drive_folder_id: result.folderId };
            if (result.pdf) {
              updates.factura_drive_url = result.pdf.webViewLink;
              updates.factura_drive_id  = result.pdf.id;
            }
            if (result.xml) {
              updates.factura_xml_url = result.xml.webViewLink;
              updates.factura_xml_id  = result.xml.id;
            }
            updateItem(KEYS.PROY_MOVIMIENTOS, savedId, updates);
            showToast('✅ Archivos guardados en Google Drive', 'success');
            refreshDetalleTable(proyectoId);
          })
          .catch(err => {
            console.error('[Drive upload]', err);
            showToast('⚠ No se pudo subir a Drive: ' + err.message, 'warning');
          });
      } else if ((uploadPDF || uploadXML) && !driveAvailable()) {
        showToast('⚠ Google Drive no disponible — archivos guardados solo localmente', 'warning');
      }
    },
  });
}

// =====================================================
// MODAL: RECIBIR DE SOGRUB (regla #9)
// =====================================================
// =====================================================
// RETIRAR UTILIDAD — obra → SOGRUB
//
// El inverso de "Recibir de SOGRUB". No es un gasto: no compra nada ni consume
// presupuesto. Sólo saca de la obra el dinero que ya sobró, y a partir de ahí
// es libre — no hay que justificarlo contra el proyecto.
// =====================================================
function abrirModalRetirarUtilidad(proyectoId) {
  const proyecto = getItem(KEYS.PROYECTOS, proyectoId);
  const b        = calcBolsitasProyecto(proyectoId);
  const saldo    = calcSaldoCajaProyecto(proyectoId);
  const desg     = calcSaldoCajaProyectoDesglose(proyectoId);
  // Techo prudente: no puedes retirar más utilidad de la que queda, ni más
  // dinero del que hay en la caja de la obra.
  const tope     = Math.max(0, Math.min(b.utilidadDisponible, saldo));

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div style="display:flex;gap:18px;flex-wrap:wrap;padding:10px 12px;background:var(--surface2);border-radius:var(--radius)">
      <div>
        <div class="text-muted" style="font-size:11px">Utilidad por cobrar</div>
        <div class="font-mono ${b.utilidadDisponible < 0 ? 'text-danger' : 'text-success'}" style="font-size:15px">${formatMXN(b.utilidadDisponible)}</div>
      </div>
      <div>
        <div class="text-muted" style="font-size:11px">Caja de la obra</div>
        <div class="font-mono" style="font-size:15px">${formatMXN(saldo)}</div>
        <div class="text-dim" style="font-size:10px">🏦 ${formatMXN(desg.electronico)} · 💵 ${formatMXN(desg.efectivo)}</div>
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="ru-fecha">Fecha</label>
        <input type="date" id="ru-fecha" class="form-input" value="${todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label" for="ru-monto">Monto ($)</label>
        <input type="number" id="ru-monto" class="form-input" placeholder="0.00" min="0.01" step="0.01"
               value="${tope > 0 ? tope.toFixed(2) : ''}">
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">¿De qué parte de la caja de la obra sale?</label>
      <div class="toggle-group">
        <input type="radio" name="ru-metodo" id="ru-transf" value="transferencia" class="toggle-option" checked>
        <label for="ru-transf" class="toggle-label">🏦 Electrónico (Mifel)</label>
        <input type="radio" name="ru-metodo" id="ru-efe" value="efectivo" class="toggle-option">
        <label for="ru-efe" class="toggle-label">💵 Efectivo</label>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label" for="ru-concepto">Concepto</label>
      <input type="text" id="ru-concepto" class="form-input"
        value="Retiro de utilidad — ${proyecto?.nombre ?? ''}" placeholder="Concepto del retiro">
    </div>

    <p class="text-muted text-sm" style="margin:0;line-height:1.6">
      <b>No es un gasto</b> ni una transferencia física: el dinero ya está en Mifel o en la caja.
      Lo único que cambia es que deja de estar apartado para esta obra, así que
      <b>sube tu disponible libre de compromisos</b> por el mismo monto.
      Ni el saldo de Mifel ni el arqueo de efectivo se mueven.
    </p>
    <div id="ru-aviso" style="font-size:12px"></div>
  `;

  const aviso = () => {
    const el = body.querySelector('#ru-aviso');
    const v  = Math.abs(parseFloat(body.querySelector('#ru-monto').value) || 0);
    if (!v) { el.innerHTML = ''; return; }
    const msgs = [];
    if (v > saldo + 0.005) msgs.push(`⚠ Excede la caja de la obra por <b>${formatMXN(v - saldo)}</b>: la dejarías en negativo.`);
    if (v > b.utilidadDisponible + 0.005) msgs.push(`⚠ Excede la utilidad por cobrar en <b>${formatMXN(v - b.utilidadDisponible)}</b>: estarías sacando dinero que todavía hace falta para terminar la obra.`);
    el.innerHTML = msgs.length
      ? `<div style="color:#e0a04c;line-height:1.6">${msgs.join('<br>')}</div>`
      : `<div class="text-muted">Quedarían <b>${formatMXN(saldo - v)}</b> en la caja de la obra y <b>${formatMXN(b.utilidadDisponible - v)}</b> de utilidad por cobrar.</div>`;
  };
  setTimeout(() => { body.querySelector('#ru-monto')?.addEventListener('input', aviso); aviso(); }, 0);

  openModal({
    title:       '💸 Retirar utilidad a SOGRUB',
    body,
    confirmText: 'Retirar',
    onConfirm:   () => {
      const fecha    = body.querySelector('#ru-fecha').value;
      const monto    = parseFloat(body.querySelector('#ru-monto').value);
      const concepto = body.querySelector('#ru-concepto').value.trim();
      const metodo   = body.querySelector('input[name="ru-metodo"]:checked')?.value ?? 'transferencia';

      const valid = validateFields([
        { el: body.querySelector('#ru-fecha'), msg: 'Selecciona una fecha' },
        { el: body.querySelector('#ru-monto'), msg: 'Ingresa un monto mayor a 0' },
      ]);
      if (!valid) return;

      if (monto > saldo + 0.005 &&
          !confirm(`El retiro de ${formatMXN(monto)} deja la caja de la obra en ${formatMXN(saldo - monto)}. ¿Continuar?`)) return;

      try { ejecutarRetiroUtilidad(proyectoId, monto, concepto, fecha, metodo); }
      catch (err) { showToast('Error: ' + err.message, 'error'); return; }

      showToast(`Utilidad retirada · ${formatMXN(monto)} pasó a disponible libre`, 'success');
      closeModal();
      refreshDetalleKPIs(proyectoId);
      refreshDetalleTable(proyectoId);
      refreshDetalleCharts(proyectoId);
      refreshBolsitas(proyectoId);
    },
  });
}

function abrirModalRecibirSOGRUB(proyectoId) {
  const proyecto = getItem(KEYS.PROYECTOS, proyectoId);

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="rs-fecha">Fecha</label>
        <input type="date" id="rs-fecha" class="form-input" value="${todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label" for="rs-monto">Monto ($)</label>
        <input type="number" id="rs-monto" class="form-input" placeholder="0.00" min="0.01" step="0.01">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="rs-concepto">Concepto</label>
      <input type="text" id="rs-concepto" class="form-input"
        value="Transferencia a ${proyecto?.nombre ?? ''}" placeholder="Concepto de la transferencia">
    </div>
    <p class="text-muted text-sm">
      Se registrará automáticamente como egreso en Caja SOGRUB e ingreso en este proyecto.
    </p>
  `;

  openModal({
    title:       'Recibir de SOGRUB',
    body,
    confirmText: 'Transferir',
    onConfirm:   () => {
      const fecha    = body.querySelector('#rs-fecha').value;
      const monto    = parseFloat(body.querySelector('#rs-monto').value);
      const concepto = body.querySelector('#rs-concepto').value.trim();

      const valid = validateFields([
        { el: body.querySelector('#rs-fecha'),  msg: 'Selecciona una fecha' },
        { el: body.querySelector('#rs-monto'),  msg: 'Ingresa un monto mayor a 0' },
      ]);
      if (!valid) return;

      ejecutarTransferenciaSOGRUB(proyectoId, monto, concepto, fecha);
      showToast('Transferencia registrada', 'success');
      closeModal();
      refreshDetalleKPIs(proyectoId);
      refreshDetalleTable(proyectoId);
    },
  });
}

// =====================================================
// MODAL: PROVEEDORES DEL PROYECTO
// Importar de global, exportar a global, gestionar
// =====================================================
function abrirModalProveedoresProyecto(proyectoId) {
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';

  function renderContenido() {
    const provProy = (getCollection(KEYS.PROY_PROVEEDORES) ?? [])
      .filter(p => p.proyecto_id === proyectoId);

    body.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <button class="btn btn-secondary btn-sm" id="prov-importar">⬇ Importar de Global</button>
        <button class="btn btn-secondary btn-sm" id="prov-exportar">⬆ Exportar a Global</button>
        <button class="btn btn-primary btn-sm" id="prov-nuevo">＋ Nuevo proveedor</button>
      </div>
      ${provProy.length === 0
        ? '<p class="text-muted text-sm">Sin proveedores. Importa de la lista global o agrega uno nuevo.</p>'
        : `<div class="prov-list">
            ${provProy.map(p => `
              <div class="fondo-item">
                <span class="fondo-nombre">${p.nombre}</span>
                <button class="btn btn-ghost btn-icon btn-del-prov" data-id="${p.id}" title="Eliminar">✕</button>
              </div>
            `).join('')}
          </div>`
      }
    `;

    // Import from global
    body.querySelector('#prov-importar').addEventListener('click', () => {
      abrirModalImportarProveedores(proyectoId, () => renderContenido());
    });

    // Export to global
    body.querySelector('#prov-exportar').addEventListener('click', () => {
      abrirModalExportarProveedores(proyectoId);
    });

    // New provider
    body.querySelector('#prov-nuevo').addEventListener('click', () => {
      abrirModalNuevoProveedorProyecto(proyectoId, () => renderContenido());
    });

    // Delete
    body.querySelectorAll('.btn-del-prov').forEach(btn => {
      btn.addEventListener('click', () => {
        deleteItem(KEYS.PROY_PROVEEDORES, btn.dataset.id);
        showToast('Proveedor eliminado del proyecto', 'success');
        renderContenido();
      });
    });
  }

  renderContenido();

  openModal({
    title: 'Proveedores del proyecto',
    body,
    confirmText: 'Cerrar',
    onConfirm: () => closeModal(),
    large: true,
  });
}

// ---- Importar proveedores de global a proyecto ----
function abrirModalImportarProveedores(proyectoId, onDone) {
  const globales = getCollection(KEYS.PROVEEDORES) ?? [];
  const yaEnProy = (getCollection(KEYS.PROY_PROVEEDORES) ?? [])
    .filter(p => p.proyecto_id === proyectoId)
    .map(p => p.nombre);

  const disponibles = globales.filter(g => !yaEnProy.includes(g.nombre));

  if (disponibles.length === 0) {
    showToast('No hay proveedores nuevos en la lista global', 'info');
    return;
  }

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:10px';
  body.innerHTML = `
    <p class="text-muted text-sm">Selecciona los proveedores a importar al proyecto:</p>
    ${disponibles.map(g => `
      <label class="prov-check-item">
        <input type="checkbox" value="${g.id}" data-nombre="${g.nombre}">
        <span>${g.nombre}</span>
      </label>
    `).join('')}
  `;

  openModal({
    title: 'Importar proveedores',
    body,
    confirmText: 'Importar seleccionados',
    onConfirm: () => {
      const checks = body.querySelectorAll('input[type="checkbox"]:checked');
      let count = 0;
      checks.forEach(ch => {
        addItem(KEYS.PROY_PROVEEDORES, {
          proyecto_id: proyectoId,
          nombre: ch.dataset.nombre,
          proveedor_global_id: ch.value,
        });
        count++;
      });
      closeModal();
      showToast(`${count} proveedor(es) importado(s)`, 'success');
      if (onDone) setTimeout(() => abrirModalProveedoresProyecto(proyectoId), 100);
    },
  });
}

// ---- Exportar proveedores de proyecto a global ----
function abrirModalExportarProveedores(proyectoId) {
  const provProy = (getCollection(KEYS.PROY_PROVEEDORES) ?? [])
    .filter(p => p.proyecto_id === proyectoId);
  const globales = (getCollection(KEYS.PROVEEDORES) ?? []).map(g => g.nombre);

  const noEnGlobal = provProy.filter(p => !globales.includes(p.nombre));

  if (noEnGlobal.length === 0) {
    showToast('Todos los proveedores ya están en la lista global', 'info');
    return;
  }

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:10px';
  body.innerHTML = `
    <p class="text-muted text-sm">Selecciona los proveedores a exportar a la lista global:</p>
    ${noEnGlobal.map(p => `
      <label class="prov-check-item">
        <input type="checkbox" value="${p.id}" data-nombre="${p.nombre}">
        <span>${p.nombre}</span>
      </label>
    `).join('')}
  `;

  openModal({
    title: 'Exportar a lista global',
    body,
    confirmText: 'Exportar seleccionados',
    onConfirm: () => {
      const checks = body.querySelectorAll('input[type="checkbox"]:checked');
      let count = 0;
      checks.forEach(ch => {
        addItem(KEYS.PROVEEDORES, {
          nombre: ch.dataset.nombre,
          telefono: '',
          email: '',
          rfc: '',
          notas: '',
        });
        count++;
      });
      closeModal();
      showToast(`${count} proveedor(es) exportado(s) a la lista global`, 'success');
    },
  });
}

// ---- Nuevo proveedor directo en proyecto ----
// Sugiere agregar proveedor cuando no existe en el proyecto
function _sugerirAgregarProveedor(proyectoId, nombre, emisor) {
  const rfcInfo = emisor?.rfc ? ` — RFC: ${emisor.rfc}` : '';
  const nombreSAT = emisor?.nombre && emisor.nombre.trim() !== nombre.trim()
    ? ` (SAT: "${emisor.nombre}")` : '';

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:12px';
  body.innerHTML = `
    <p style="font-size:13px">El proveedor <strong>"${nombre}"</strong>${rfcInfo}${nombreSAT} no está en la lista de proveedores del proyecto.</p>
    <div class="form-group">
      <label class="form-label" for="sp-nombre">Nombre</label>
      <input type="text" id="sp-nombre" class="form-input" value="${nombre}">
    </div>
    <div class="form-group">
      <label class="form-label" for="sp-rfc">RFC ${emisor?.rfc ? '(del XML)' : '(opcional)'}</label>
      <input type="text" id="sp-rfc" class="form-input" placeholder="Ej: XAXX010101000"
        value="${emisor?.rfc ?? ''}">
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
      <input type="checkbox" id="sp-global" ${(getCollection(KEYS.PROVEEDORES) ?? []).some(p => p.nombre.trim().toLowerCase() === nombre.toLowerCase()) ? '' : 'checked'}>
      Agregar también a la lista global de proveedores
    </label>
  `;

  openModal({
    title: '¿Agregar proveedor?',
    body,
    confirmText: 'Agregar',
    cancelText: 'No, gracias',
    onConfirm: () => {
      const nombreFinal = body.querySelector('#sp-nombre').value.trim() || nombre;
      const rfcFinal    = body.querySelector('#sp-rfc').value.trim();
      const addGlobal   = body.querySelector('#sp-global').checked;

      let globalId = null;

      if (addGlobal) {
        // Verificar si ya existe en global
        const existeGlobal = (getCollection(KEYS.PROVEEDORES) ?? [])
          .find(p => p.nombre.trim().toLowerCase() === nombreFinal.toLowerCase());
        if (existeGlobal) {
          globalId = existeGlobal.id;
          if (rfcFinal && !existeGlobal.rfc) {
            updateItem(KEYS.PROVEEDORES, existeGlobal.id, { rfc: rfcFinal });
          }
        } else {
          const nuevo = addItem(KEYS.PROVEEDORES, { nombre: nombreFinal, rfc: rfcFinal, telefono: '', email: '', notas: '' });
          globalId = nuevo.id;
        }
      }

      addItem(KEYS.PROY_PROVEEDORES, {
        proyecto_id: proyectoId,
        nombre: nombreFinal,
        proveedor_global_id: globalId,
      });

      closeModal();
      showToast(`Proveedor "${nombreFinal}" agregado`, 'success');
    },
  });
}

function abrirModalNuevoProveedorProyecto(proyectoId, onDone) {
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="np-nombre">Nombre del proveedor</label>
      <input type="text" id="np-nombre" class="form-input" placeholder="Ej: Ferretería Cumbres">
    </div>
  `;

  openModal({
    title: 'Nuevo proveedor',
    body,
    confirmText: 'Agregar',
    onConfirm: () => {
      const nombre = body.querySelector('#np-nombre').value.trim();
      if (!nombre) {
        showToast('Escribe un nombre', 'warning');
        return;
      }
      addItem(KEYS.PROY_PROVEEDORES, {
        proyecto_id: proyectoId,
        nombre,
        proveedor_global_id: null,
      });
      closeModal();
      showToast(`Proveedor "${nombre}" agregado`, 'success');
      if (onDone) setTimeout(() => abrirModalProveedoresProyecto(proyectoId), 100);
    },
  });
}

// =====================================================
// MODAL: EDITAR PROYECTO (desde detalle)
// =====================================================
function abrirModalEditarProyecto(proyectoId) {
  // Reutiliza la función de la vista proyectos
  abrirModalProyecto(proyectoId);
}

// =====================================================
// ELIMINAR MOVIMIENTO PROYECTO
// =====================================================
function confirmarEliminarMovProy(id, proyectoId) {
  const mov = getItem(KEYS.PROY_MOVIMIENTOS, id);
  openConfirmModal({
    title:       'Eliminar movimiento',
    message:     `¿Eliminar "${mov?.concepto ?? 'este movimiento'}"? Esta acción no se puede deshacer.`,
    confirmText: 'Eliminar',
    onConfirm:   () => {
      deleteItem(KEYS.PROY_MOVIMIENTOS, id);
      closeModal();
      showToast('Movimiento eliminado', 'success');
      refreshDetalleKPIs(proyectoId);
      refreshDetalleTable(proyectoId);
      refreshDetalleCharts(proyectoId);
      refreshBolsitas(proyectoId);
    },
  });
}

// =====================================================
// MODAL: CARGA MASIVA DE FACTURAS (PDF + XML)
// =====================================================
function abrirModalFacturasLote(proyectoId) {
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <p class="text-muted text-sm">
      Selecciona todos los PDF y XML de facturas. La app emparejará automáticamente cada factura
      con un gasto registrado que coincida en monto.
    </p>
    <div class="form-group">
      <label class="form-label">Archivos (PDF y XML)</label>
      <input type="file" id="lote-files" class="form-input" accept=".pdf,.xml" multiple style="padding:6px 10px">
    </div>
    <div id="lote-preview" class="hidden"></div>
    <div id="lote-results" class="hidden"></div>
  `;

  openModal({
    title: '📄 Cargar facturas por lote',
    body,
    confirmText: 'Analizar y emparejar',
    large: true,
    onConfirm: async (btn) => {
      const fileInput = body.querySelector('#lote-files');
      if (!fileInput?.files?.length) {
        showToast('Selecciona al menos un archivo', 'warning');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Analizando…';

      try {
        await _procesarLoteFacturas(proyectoId, Array.from(fileInput.files), body);
      } catch (err) {
        console.error('[Lote]', err);
        showToast('Error al procesar archivos: ' + err.message, 'danger');
        btn.disabled = false;
        btn.textContent = 'Analizar y emparejar';
      }
    },
  });
}

// ---- Agrupador: emparejar PDF y XML por nombre base ----
function _agruparArchivos(files) {
  const groups = {};

  for (const f of files) {
    const name = f.name;
    const ext  = name.split('.').pop().toLowerCase();
    // Nombre base: quitar extensión y sufijo de duplicado del SO " (1)", " (2)", etc.
    const baseName = name.replace(/\.[^.]+$/, '').replace(/\s*\(\d+\)$/, '').trim();
    const key      = baseName.toLowerCase();

    if (!groups[key]) groups[key] = { pdf: null, xml: null, baseName };

    if (ext === 'xml') {
      // Preferir el XML sin sufijo de duplicado
      if (!groups[key].xml || !f.name.match(/\s*\(\d+\)\.[^.]+$/)) groups[key].xml = f;
    } else if (ext === 'pdf') {
      // Preferir el PDF sin sufijo de duplicado
      if (!groups[key].pdf || !f.name.match(/\s*\(\d+\)\.[^.]+$/)) groups[key].pdf = f;
    }
  }

  return Object.values(groups);
}

// ---- Core: procesar lote ----
async function _procesarLoteFacturas(proyectoId, files, body) {
  const resultsDiv = body.querySelector('#lote-results');
  resultsDiv.classList.remove('hidden');
  resultsDiv.innerHTML = '<div class="ocr-result ocr-loading">🔍 Leyendo archivos…</div>';

  // 1. Agrupar archivos por nombre base (emparejar PDF ↔ XML)
  const grupos = _agruparArchivos(files);

  // 2. Leer monto de cada grupo (preferir XML)
  const parsed = [];
  for (const g of grupos) {
    let monto = null;
    let source = null;
    try {
      if (g.xml) {
        monto  = await leerMontoXML(g.xml);
        source = 'XML';
      }
      if (monto === null && g.pdf) {
        monto  = await leerMontoFactura(g.pdf);
        source = 'PDF (OCR)';
      }
    } catch (e) {
      console.warn(`[Lote] Error leyendo ${g.baseName}:`, e);
    }
    parsed.push({ ...g, monto, source });
  }

  // 3. Obtener TODOS los gastos con IVA del proyecto (incluir ya facturados)
  const gastos = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto' && m.incluye_iva);

  // 4. Emparejar por monto (±1%) — preferir los sin factura previa
  const matched   = [];   // { grupo, gasto, sobreescribe }
  const unmatched = [];
  const usedGastoIds = new Set();

  // Primero pasar por los sin factura (prioridad)
  const sinFactura = gastos.filter(g => !g.factura_drive_url && !g.factura_xml_url);
  const conFactura = gastos.filter(g =>  g.factura_drive_url ||  g.factura_xml_url);

  for (const p of parsed) {
    if (p.monto === null) {
      unmatched.push({ ...p, reason: 'No se pudo leer el monto' });
      continue;
    }

    const _findByMonto = (lista) => {
      for (const g of lista) {
        if (usedGastoIds.has(g.id)) continue;
        const diff = Math.abs(p.monto - Math.abs(g.monto));
        const pct  = Math.abs(g.monto) > 0 ? diff / Math.abs(g.monto) : 1;
        if (pct < 0.01) return g;
      }
      return null;
    };

    const bestMatch = _findByMonto(sinFactura) ?? _findByMonto(conFactura);

    if (bestMatch) {
      usedGastoIds.add(bestMatch.id);
      const sobreescribe = !!(bestMatch.factura_drive_url || bestMatch.factura_xml_url);
      matched.push({ grupo: p, gasto: bestMatch, sobreescribe });
    } else {
      unmatched.push({ ...p, reason: `Sin gasto para ${formatMXN(p.monto)}` });
    }
  }

  const nuevas      = matched.filter(m => !m.sobreescribe);
  const reemplazar  = matched.filter(m =>  m.sobreescribe);

  // 5. Mostrar resultado para confirmar
  const _matchRow = (grupo, gasto, sobreescribe) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;
      background:${sobreescribe ? 'rgba(251,146,60,0.07)' : 'var(--surface2)'};
      border:1px solid ${sobreescribe ? 'rgba(251,146,60,0.3)' : 'var(--border)'};
      border-radius:var(--radius-sm);font-size:12px">
      <div>
        <span style="font-weight:500">${grupo.baseName}</span>
        <span class="text-muted" style="margin-left:6px">[${[grupo.pdf && 'PDF', grupo.xml && 'XML'].filter(Boolean).join(' + ')}]</span>
        ${sobreescribe ? '<span style="font-size:10px;color:var(--warning);margin-left:6px;font-weight:600">sobreescribirá</span>' : ''}
      </div>
      <div style="text-align:right">
        <span style="color:var(--accent);font-weight:600;font-variant-numeric:tabular-nums">${formatMXN(grupo.monto)}</span>
        <span class="text-muted" style="margin-left:8px">→ ${gasto.concepto}</span>
      </div>
    </div>`;

  let html = '';

  if (nuevas.length > 0) {
    html += `<div style="margin-bottom:12px">
      <div style="font-weight:600;font-size:13px;margin-bottom:6px;color:var(--success)">
        ✓ ${nuevas.length} factura${nuevas.length > 1 ? 's' : ''} nueva${nuevas.length > 1 ? 's' : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${nuevas.map(({ grupo, gasto }) => _matchRow(grupo, gasto, false)).join('')}
      </div>
    </div>`;
  }

  if (reemplazar.length > 0) {
    html += `<div style="margin-bottom:12px">
      <div style="font-weight:600;font-size:13px;margin-bottom:6px;color:var(--warning)">
        ↩ ${reemplazar.length} factura${reemplazar.length > 1 ? 's' : ''} que sobreescribirá${reemplazar.length > 1 ? 'n' : ''} la existente
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${reemplazar.map(({ grupo, gasto }) => _matchRow(grupo, gasto, true)).join('')}
      </div>
    </div>`;
  }

  if (unmatched.length > 0) {
    html += `<div style="margin-bottom:12px">
      <div style="font-weight:600;font-size:13px;margin-bottom:6px;color:var(--text-muted)">
        — ${unmatched.length} archivo${unmatched.length > 1 ? 's' : ''} sin emparejar (se descartan)
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${unmatched.map(u => `
          <div style="display:flex;justify-content:space-between;padding:8px 12px;background:rgba(138,138,138,0.06);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px;color:var(--text-muted)">
            <span>${u.baseName}</span><span>${u.reason}</span>
          </div>`).join('')}
      </div>
    </div>`;
  }

  if (matched.length === 0) {
    html += `<p class="text-muted text-sm">Ninguna factura coincidió con gastos registrados.</p>`;
  }

  resultsDiv.innerHTML = html;

  // 6. Footer: botón subir a Drive
  const footerEl = document.getElementById('modal-footer');
  footerEl.innerHTML = '';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = 'Cerrar';
  cancelBtn.addEventListener('click', closeModal);
  footerEl.appendChild(cancelBtn);

  const _ejecutarSubida = async (btn) => {
    btn.disabled    = true;
    btn.textContent = 'Autenticando…';

    // Obtener/renovar token PRIMERO (dentro del contexto de gesto del usuario)
    try {
      await driveGetToken();
    } catch (authErr) {
      btn.disabled = false;
      btn.textContent = 'Reintentar';
      const errDiv = document.getElementById('lote-results');
      errDiv.classList.remove('hidden');
      errDiv.innerHTML = `<div style="padding:8px 12px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:var(--radius-sm);font-size:12px;color:var(--danger)">
        <strong>Error de autenticación con Google Drive:</strong><br>
        <span style="font-family:monospace">${authErr.message}</span>
      </div>`;
      return;
    }

    btn.textContent = 'Subiendo…';

    let ok = 0;
    const errores = [];

    for (const { grupo, gasto, sobreescribe } of matched) {
      try {
        const result = await driveUploadFactura(
          { pdf: grupo.pdf, xml: grupo.xml },
          proyectoId,
          {
            concepto: gasto.concepto,
            fecha:    gasto.fecha,
            existing: sobreescribe ? {
              folderId: gasto.factura_drive_folder_id ?? null,
              pdfId:    grupo.pdf ? (gasto.factura_drive_id ?? null) : null,
              xmlId:    grupo.xml ? (gasto.factura_xml_id   ?? null) : null,
            } : {},
          }
        );

        const updates = { factura_drive_folder_id: result.folderId, factura_monto_ocr: grupo.monto };
        if (result.pdf) { updates.factura_nombre    = grupo.pdf.name; updates.factura_drive_url = result.pdf.webViewLink; updates.factura_drive_id = result.pdf.id; }
        if (result.xml) { updates.factura_xml_nombre = grupo.xml.name; updates.factura_xml_url   = result.xml.webViewLink; updates.factura_xml_id  = result.xml.id; }

        updateItem(KEYS.PROY_MOVIMIENTOS, gasto.id, updates);
        ok++;
        btn.textContent = `Subiendo… (${ok}/${matched.length})`;
      } catch (err) {
        console.error(`[Lote Drive] ${grupo.baseName}:`, err);
        errores.push({ nombre: grupo.baseName, msg: err.message ?? String(err) });
      }
    }

    // Mostrar resultado con errores detallados
    const footerEl2 = document.getElementById('modal-footer');
    footerEl2.innerHTML = '';
    const cerrarBtn = document.createElement('button');
    cerrarBtn.className = 'btn btn-secondary';
    cerrarBtn.textContent = 'Cerrar';
    cerrarBtn.addEventListener('click', () => { closeModal(); refreshDetalleTable(proyectoId); });
    footerEl2.appendChild(cerrarBtn);

    if (errores.length === 0) {
      showToast(`🎉 ¡Enhorabuena! ${ok} factura${ok > 1 ? 's' : ''} vinculada${ok > 1 ? 's' : ''} exitosamente`, 'success');
      closeModal();
      refreshDetalleTable(proyectoId);
    } else {
      // Mostrar errores en el modal para diagnóstico
      const errDiv = document.getElementById('lote-results');
      let html = '';
      if (ok > 0) html += `<div style="color:var(--success);font-weight:600;font-size:13px;margin-bottom:8px">✓ ${ok} subida${ok>1?'s':''} correctamente</div>`;
      html += `<div style="color:var(--danger);font-weight:600;font-size:13px;margin-bottom:6px">✗ ${errores.length} error${errores.length>1?'es':''}</div>`;
      html += errores.map(e => `
        <div style="padding:8px 12px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:var(--radius-sm);margin-bottom:4px;font-size:11px">
          <div style="font-weight:600;margin-bottom:2px">${e.nombre}</div>
          <div style="color:var(--danger);font-family:monospace;word-break:break-all">${e.msg}</div>
        </div>`).join('');
      errDiv.innerHTML = html;
      if (ok > 0) refreshDetalleTable(proyectoId);
    }
  };

  if (matched.length > 0 && driveAvailable()) {
    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'btn btn-primary';
    const label = reemplazar.length > 0
      ? `Subir a Drive (${nuevas.length} nueva${nuevas.length !== 1 ? 's' : ''}, ${reemplazar.length} reemplazar)`
      : `Subir ${matched.length} factura${matched.length > 1 ? 's' : ''} a Drive`;
    uploadBtn.textContent = label;
    uploadBtn.addEventListener('click', () => _ejecutarSubida(uploadBtn));
    footerEl.appendChild(uploadBtn);
  } else if (matched.length > 0 && !driveAvailable()) {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = `Vincular ${matched.length} factura${matched.length > 1 ? 's' : ''}`;
    saveBtn.addEventListener('click', () => {
      for (const { grupo, gasto } of matched) {
        const updates = { factura_monto_ocr: grupo.monto };
        if (grupo.pdf) updates.factura_nombre    = grupo.pdf.name;
        if (grupo.xml) updates.factura_xml_nombre = grupo.xml.name;
        updateItem(KEYS.PROY_MOVIMIENTOS, gasto.id, updates);
      }
      closeModal();
      showToast(`${matched.length} factura${matched.length > 1 ? 's' : ''} vinculada${matched.length > 1 ? 's' : ''}`, 'success');
      refreshDetalleTable(proyectoId);
    });
    footerEl.appendChild(saveBtn);
  }

  if (matched.length > 0 && unmatched.length === 0) {
    // All matched — replace header with celebration
    const successBanner = document.createElement('div');
    successBanner.style.cssText = 'text-align:center;padding:8px 0;font-size:14px;font-weight:600;color:var(--success)';
    successBanner.textContent = '🎉 ¡Todas las facturas coinciden con gastos registrados!';
    resultsDiv.prepend(successBanner);
  }
}

// =====================================================
// GENERAR ESTADO DE CUENTA (PDF)
// =====================================================
function generarEstadoDeCuenta(proyectoId) {
  try { _generarEstadoDeCuentaImpl(proyectoId); }
  catch (err) { console.error('[PDF]', err); showToast('Error al generar PDF: ' + err.message, 'error'); }
}

function _generarEstadoDeCuentaImpl(proyectoId) {
  const proyecto = getItem(KEYS.PROYECTOS, proyectoId);
  if (!proyecto) return showToast('Proyecto no encontrado', 'error');

  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) return showToast('jsPDF no disponible, recarga la página', 'error');

  const gastos = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto' && m.status === 'Pagado')
    .sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''));

  const totalCobrado = calcTotalCobradoCliente(proyectoId);

  // ---------- Cálculos ----------
  let costoDirecto = 0;
  let gastoIndOficinaReal = 0;  // gastos indirectos de oficina ya pagados
  let gastoIndCampoReal   = 0;  // gastos indirectos de campo ya pagados
  const filas = gastos.map(g => {
    const abs = Math.abs(g.monto);
    costoDirecto += abs;
    if ((g.categoria ?? '').toLowerCase() === 'indirecto') {
      if (g.indirecto_ambito === 'campo') gastoIndCampoReal += abs;
      else                                gastoIndOficinaReal += abs;
    }
    const ivaTag = g.incluye_iva ? 'C/IVA' : 'S/IVA';
    return [
      (g.fecha ?? '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1'),
      `${(g.concepto ?? '').toUpperCase()} ${ivaTag}`,
      _fmtMXN(abs),
    ];
  });

  // Sobrecostos acumulativos en cascada (compat: viejo `sobrecosto_indirectos` → oficina)
  const pctOfi = proyecto.sobrecosto_ind_oficina ?? proyecto.sobrecosto_indirectos ?? 0;
  const pctCam = proyecto.sobrecosto_ind_campo   ?? 0;
  const pctFin = proyecto.sobrecosto_financiamiento ?? 0;
  const pctUti = proyecto.sobrecosto_utilidad       ?? 0;

  // Indirectos oficina y campo: ambos % del costo directo (como OPUS), restando
  // lo ya gastado en cada ámbito para no cobrar doble.
  const montoOfi = Math.max(0, costoDirecto * (pctOfi / 100) - gastoIndOficinaReal);
  const montoCam = Math.max(0, costoDirecto * (pctCam / 100) - gastoIndCampoReal);
  let acum = costoDirecto + montoOfi + montoCam;
  // Financiamiento y utilidad sí cascadean sobre el acumulado.
  const montoFin = acum * (pctFin / 100); acum += montoFin;
  const montoUti = acum * (pctUti / 100); acum += montoUti;
  const subtotal = acum;

  const iva = calcIVADesglose(proyectoId);

  // Balance se calcula con total factura completa (subtotal + IVA restante)
  const balance = totalCobrado - (subtotal + iva.ivaPorCobrar);

  // ---------- PDF ----------
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const marginL = 18;
  const marginR = 18;
  const usable  = pageW - marginL - marginR;
  let y = 20;

  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(`Cliente: ${proyecto.cliente ?? '—'}`, marginL, y);
  y += 6;
  doc.text(`Proyecto: ${proyecto.nombre ?? '—'}`, marginL, y);
  y += 10;

  // ---------- DESGLOSE DE COSTOS DIRECTOS ----------
  doc.setFontSize(12);
  doc.setTextColor(180, 30, 30);
  doc.text('DESGLOSE DE COSTOS DIRECTOS', marginL, y);
  doc.setTextColor(0, 0, 0);
  y += 4;

  doc.autoTable({
    startY: y,
    margin: { left: marginL, right: marginR },
    head: [['Fecha', 'Descripción', 'Importe']],
    body: filas,
    foot: [['', 'COSTO DIRECTO', _fmtMXN(costoDirecto)]],
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: 'bold', lineColor: [0,0,0], lineWidth: 0.3 },
    footStyles: { fillColor: [220, 220, 220], textColor: [0, 0, 0], fontStyle: 'bold', lineColor: [0,0,0], lineWidth: 0.3 },
    bodyStyles: { lineColor: [0, 0, 0], lineWidth: 0.2 },
    columnStyles: {
      0: { cellWidth: 24 },
      2: { cellWidth: 28, halign: 'right' },
    },
    theme: 'grid',
  });

  y = doc.lastAutoTable.finalY + 10;

  // ---------- SOBRECOSTOS ----------
  if (pctOfi > 0 || pctCam > 0 || pctFin > 0 || pctUti > 0) {
    doc.setFontSize(12);
    doc.setTextColor(180, 30, 30);
    doc.text('SOBRECOSTOS', marginL, y);
    doc.setTextColor(0, 0, 0);
    y += 4;

    const sobrecostosBody = [];
    let runningTotal = costoDirecto;
    if (pctOfi > 0) {
      const ofiLabel = gastoIndOficinaReal > 0
        ? `Indirectos oficina ${pctOfi}% (- ${_fmtMXN(gastoIndOficinaReal)} ya gastados)`
        : `Indirectos oficina ${pctOfi}%`;
      runningTotal += montoOfi;
      sobrecostosBody.push([ofiLabel, _fmtMXN(montoOfi), _fmtMXN(runningTotal)]);
    }
    if (pctCam > 0) {
      const camLabel = gastoIndCampoReal > 0
        ? `Indirectos campo ${pctCam}% (- ${_fmtMXN(gastoIndCampoReal)} ya gastados)`
        : `Indirectos campo ${pctCam}%`;
      runningTotal += montoCam;
      sobrecostosBody.push([camLabel, _fmtMXN(montoCam), _fmtMXN(runningTotal)]);
    }
    if (pctFin > 0) {
      const m = runningTotal * (pctFin / 100); runningTotal += m;
      sobrecostosBody.push([`Financiamiento ${pctFin}%`, _fmtMXN(m), _fmtMXN(runningTotal)]);
    }
    if (pctUti > 0) {
      const m = runningTotal * (pctUti / 100); runningTotal += m;
      sobrecostosBody.push([`Utilidad ${pctUti}%`, _fmtMXN(m), _fmtMXN(runningTotal)]);
    }

    doc.autoTable({
      startY: y,
      margin: { left: marginL, right: marginR },
      body: sobrecostosBody,
      styles: { fontSize: 9, cellPadding: 2.5 },
      bodyStyles: { lineColor: [0, 0, 0], lineWidth: 0.2 },
      columnStyles: {
        0: { fontStyle: 'bold' },
        1: { halign: 'right', cellWidth: 28 },
        2: { halign: 'right', cellWidth: 28 },
      },
      theme: 'grid',
    });

    y = doc.lastAutoTable.finalY + 8;
  } else {
    y += 2;
  }

  // ---------- DESGLOSE FISCAL ----------
  const baseGravable = subtotal - iva.ivaPagado;
  const ivaReal      = iva.ivaPagado;
  const ivaRestante  = iva.ivaPorCobrar;
  const totalConIvaReal = subtotal;             // base gravable + IVA ya pagado
  const totalFactura    = subtotal + ivaRestante; // factura completa

  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');

  doc.text('SUBTOTAL (Base gravable):', marginL, y);
  doc.text(_fmtMXN(baseGravable), marginL + usable, y, { align: 'right' });
  y += 6;
  doc.text('+ IVA PAGADO (IVA real c/factura):', marginL, y);
  doc.text(_fmtMXN(ivaReal), marginL + usable, y, { align: 'right' });
  y += 2;
  doc.setLineWidth(0.3);
  doc.line(marginL, y, marginL + usable, y);
  y += 6;
  doc.setFontSize(12);
  doc.text('COSTO + IVA REAL:', marginL, y);
  doc.text(_fmtMXN(totalConIvaReal), marginL + usable, y, { align: 'right' });
  y += 8;

  doc.setFontSize(11);
  doc.text('+ IVA RESTANTE*:', marginL, y);
  doc.text(_fmtMXN(ivaRestante), marginL + usable, y, { align: 'right' });
  y += 2;
  doc.setLineWidth(0.3);
  doc.line(marginL, y, marginL + usable, y);
  y += 6;

  doc.setFontSize(13);
  doc.setTextColor(180, 30, 30);
  doc.text('TOTAL FACTURA COMPLETA:', marginL, y);
  doc.text(_fmtMXN(totalFactura), marginL + usable, y, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  y += 5;

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(100, 100, 100);
  doc.text('*IVA que aplica si el cliente requiere factura sobre gastos registrados sin comprobante fiscal (16% sobre gastos S/IVA)', marginL, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'bold');
  y += 14;

  // ---------- BALANCE ----------
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setDrawColor(0);
  doc.setLineWidth(0.4);
  doc.line(marginL, y, marginL + usable, y);
  y += 7;

  doc.text(`Total cobrado al cliente:`, marginL, y);
  doc.text(_fmtMXN(totalCobrado), marginL + usable, y, { align: 'right' });
  y += 6;
  doc.text(`Total estado de cuenta:`, marginL, y);
  doc.text(_fmtMXN(totalFactura), marginL + usable, y, { align: 'right' });
  y += 6;
  doc.line(marginL, y, marginL + usable, y);
  y += 7;

  const balanceLabel = balance >= 0
    ? `Balance a favor del CLIENTE:`
    : `Balance a favor de SOGRUB:`;
  const balanceColor = balance >= 0 ? [30, 130, 60] : [180, 30, 30];
  doc.setTextColor(...balanceColor);
  doc.setFontSize(12);
  doc.text(balanceLabel, marginL, y);
  doc.text(_fmtMXN(Math.abs(balance)), marginL + usable, y, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  // ---------- PÁGINA 2: ESTADO DE PAGOS ----------
  doc.addPage();
  y = 20;

  // Título
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(180, 30, 30);
  doc.text('ESTADO DE PAGOS', marginL, y);
  doc.setTextColor(0, 0, 0);
  y += 7;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`${proyecto.cliente ?? '—'}  ·  ${proyecto.nombre ?? '—'}`, marginL, y);
  y += 10;

  // Resumen factura de referencia
  const refBody = [
    ['Base gravable (costo + sobrecostos sin IVA)',  _fmtMXN(baseGravable)],
  ];
  if (ivaReal > 0.005)
    refBody.push(['IVA real (gastos con factura)',   _fmtMXN(ivaReal)]);
  refBody.push(['Total Costo + IVA Real',            _fmtMXN(totalConIvaReal)]);
  if (ivaRestante > 0.005) {
    refBody.push(['+ IVA restante (gastos sin comprobante)', _fmtMXN(ivaRestante)]);
    refBody.push(['TOTAL FACTURA COMPLETA',          _fmtMXN(totalFactura)]);
  }
  doc.autoTable({
    startY: y,
    margin: { left: marginL, right: marginR },
    head: [['FACTURA DE REFERENCIA', '']],
    body: refBody,
    styles:     { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [220,220,220], textColor: [0,0,0], fontStyle: 'bold', lineColor: [0,0,0], lineWidth: 0.3 },
    bodyStyles: { lineColor: [0,0,0], lineWidth: 0.2 },
    columnStyles: { 1: { halign: 'right', cellWidth: 38, fontStyle: 'bold' } },
    theme: 'grid',
  });
  y = doc.lastAutoTable.finalY + 10;

  // Obtener abonos ordenados por fecha
  const abonos = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'abono_cliente')
    .sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? ''));

  // Orden de cobertura: 1º base gravable → 2º IVA real → 3º IVA restante (factura completa)
  let baseRunning        = baseGravable;
  let ivaRealRunning     = ivaReal;
  let ivaRestanteRunning = ivaRestante;

  if (abonos.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text('Sin pagos registrados.', marginL, y);
    doc.setTextColor(0, 0, 0);
    y += 10;
  }

  abonos.forEach((abono, i) => {
    const montoTotal = Math.abs(abono.monto ?? 0);
    const conIva     = !!abono.incluye_iva;
    // Si el abono incluye IVA, separar neto e IVA cobrado al cliente
    const montoNeto        = conIva ? montoTotal / 1.16 : montoTotal;
    const ivaCobradoAbono  = conIva ? montoTotal - montoNeto : 0;
    const fechaStr = (abono.fecha ?? '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');
    const concepto = abono.concepto ?? 'Abono';

    // Fase 1: neto del abono cubre base gravable
    let netoRestante = montoNeto;
    const baseAplicada    = Math.min(netoRestante, baseRunning); netoRestante -= baseAplicada;

    // Fase 2-3: IVA cobrado al cliente + excedente del neto cubren IVA real → IVA restante
    let ivaPool           = ivaCobradoAbono + netoRestante;
    const ivaRealAplicado = Math.min(ivaPool, ivaRealRunning); ivaPool -= ivaRealAplicado;
    const ivaRestanteAplicado = Math.min(ivaPool, ivaRestanteRunning);

    baseRunning        = Math.max(0, baseRunning        - baseAplicada);
    ivaRealRunning     = Math.max(0, ivaRealRunning     - ivaRealAplicado);
    ivaRestanteRunning = Math.max(0, ivaRestanteRunning - ivaRestanteAplicado);

    const entroFacturaCompleta = ivaRestanteAplicado > 0;
    const remanente = baseRunning + ivaRealRunning + ivaRestanteRunning;

    if (y > 210) { doc.addPage(); y = 20; }

    // Encabezado del pago
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(30, 100, 160);
    doc.text(`FACTURA ${i + 1}  ·  ${fechaStr}  ·  ${concepto}`, marginL, y);
    doc.setTextColor(0, 0, 0);
    y += 4;

    // Tabla del pago (filas dinámicas según fases cubiertas)
    const pagoBody = [
      ['Subtotal (base gravable aplicada)', _fmtMXN(baseAplicada)],
    ];
    if (conIva)
      pagoBody.push(['IVA cobrado al cliente (16%)', _fmtMXN(ivaCobradoAbono)]);
    if (ivaRealAplicado > 0)
      pagoBody.push(['IVA real aplicado (gastos c/factura)', _fmtMXN(ivaRealAplicado)]);
    if (ivaRestanteAplicado > 0)
      pagoBody.push(['IVA restante aplicado (factura completa)', _fmtMXN(ivaRestanteAplicado)]);
    pagoBody.push(['TOTAL RECIBIDO', _fmtMXN(montoTotal)]);

    doc.autoTable({
      startY: y,
      margin: { left: marginL, right: marginR },
      body: pagoBody,
      styles:     { fontSize: 9, cellPadding: 2.5 },
      bodyStyles: { lineColor: [0,0,0], lineWidth: 0.2 },
      columnStyles: {
        0: { fontStyle: 'normal' },
        1: { halign: 'right', cellWidth: 38, fontStyle: 'bold' },
      },
      theme: 'grid',
    });
    y = doc.lastAutoTable.finalY + 3;

    // Nota si el cliente entró a factura completa
    if (entroFacturaCompleta) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(30, 100, 160);
      doc.text('★ El cliente optó por factura completa — se aplica IVA sobre gastos sin comprobante', marginL, y);
      doc.setTextColor(0, 0, 0);
      y += 5;
    }

    // Balance después del pago
    const remColor = remanente > 0.01 ? [180, 30, 30] : [30, 130, 60];
    const balanceBody = [
      ['Base gravable pendiente', _fmtMXN(baseRunning)],
    ];
    if (ivaReal > 0.005)
      balanceBody.push(['IVA real pendiente', _fmtMXN(ivaRealRunning)]);
    if (ivaRestante > 0.005)
      balanceBody.push(['IVA restante pendiente', _fmtMXN(ivaRestanteRunning)]);
    balanceBody.push(['TOTAL FACTURA REMANENTE', _fmtMXN(remanente)]);

    doc.autoTable({
      startY: y,
      margin: { left: marginL, right: marginR },
      head: [['BALANCE POR CUBRIR', '']],
      body: balanceBody,
      styles:     { fontSize: 9, cellPadding: 2.5 },
      headStyles: { fillColor: [245,245,245], textColor: [80,80,80], fontStyle: 'bold', lineColor: [0,0,0], lineWidth: 0.3 },
      bodyStyles: { lineColor: [0,0,0], lineWidth: 0.2 },
      columnStyles: {
        0: { fontStyle: 'normal' },
        1: { halign: 'right', cellWidth: 38 },
      },
      didDrawCell: (data) => {
        if (data.row.index === balanceBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          if (data.column.index === 1) data.cell.styles.textColor = remColor;
        }
      },
      theme: 'grid',
    });
    y = doc.lastAutoTable.finalY + 12;
  });

  // Resumen final (si hay más de un pago)
  if (abonos.length > 1) {
    if (y > 220) { doc.addPage(); y = 20; }
    const finalRemanente   = baseRunning + ivaRealRunning + ivaRestanteRunning;
    const ivaRealCubierto  = ivaReal     - ivaRealRunning;
    const ivaRestCubierto  = ivaRestante - ivaRestanteRunning;
    const finalColor = finalRemanente <= 0.01 ? [30, 130, 60] : [180, 30, 30];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...finalColor);
    doc.text('RESUMEN FINAL', marginL, y);
    doc.setTextColor(0, 0, 0);
    y += 5;
    const resumenBody = [
      ['Total cobrado al cliente',      _fmtMXN(totalCobrado)],
      ['Base gravable cubierta',        _fmtMXN(baseGravable  - baseRunning)],
      ['IVA real cubierto',             _fmtMXN(ivaRealCubierto)],
    ];
    if (ivaRestCubierto > 0)
      resumenBody.push(['IVA restante cubierto (factura completa)', _fmtMXN(ivaRestCubierto)]);
    resumenBody.push(['Base gravable pendiente', _fmtMXN(baseRunning)]);
    if (ivaReal > 0.005)
      resumenBody.push(['IVA real pendiente', _fmtMXN(ivaRealRunning)]);
    if (ivaRestante > 0.005)
      resumenBody.push(['IVA restante pendiente', _fmtMXN(ivaRestanteRunning)]);
    resumenBody.push(['FACTURA REMANENTE', _fmtMXN(finalRemanente)]);

    doc.autoTable({
      startY: y,
      margin: { left: marginL, right: marginR },
      body: resumenBody,
      styles:     { fontSize: 9, cellPadding: 2.5 },
      bodyStyles: { lineColor: [0,0,0], lineWidth: 0.2 },
      columnStyles: { 1: { halign: 'right', cellWidth: 38, fontStyle: 'bold' } },
      didDrawCell: (data) => {
        if (data.row.index === resumenBody.length - 1) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = finalColor;
        }
      },
      theme: 'grid',
    });
  }

  // Guardar
  const safeName = (proyecto.nombre ?? 'proyecto').replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim().replace(/\s+/g, '_');
  doc.save(`Estado_de_Cuenta_${safeName}.pdf`);
  showToast('PDF generado', 'success');
}

// Formateador corto para PDF (sin símbolo de peso extra)
function _fmtMXN(n) {
  return '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// =====================================================
// SVG placeholder
// =====================================================
function svgEmptyMovimientos() {
  return `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="12" width="48" height="40" rx="4" stroke="currentColor" stroke-width="2"/>
    <line x1="8"  y1="24" x2="56" y2="24" stroke="currentColor" stroke-width="2"/>
    <line x1="16" y1="34" x2="30" y2="34" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="16" y1="40" x2="26" y2="40" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <circle cx="44" cy="37" r="6" stroke="currentColor" stroke-width="2"/>
    <line x1="44" y1="34" x2="44" y2="40" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="41" y1="37" x2="47" y2="37" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}
