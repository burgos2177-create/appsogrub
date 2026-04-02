/* =====================================================
   SOGRUB Bitácora — Vista: Detalle de Proyecto
   ===================================================== */
'use strict';

const _detalleState = { filtroTipo: 'todos', filtroStatus: 'Todos', filtroCategoria: 'Todas', filtroProveedor: 'Todos' };

function renderDetalle(proyectoId) {
  const root = document.getElementById('detalle-root');
  root.innerHTML = '';

  const proyecto = getItem(KEYS.PROYECTOS, proyectoId);
  if (!proyecto) {
    root.innerHTML = '<p class="text-muted" style="padding:40px">Proyecto no encontrado.</p>';
    return;
  }

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

  // ---- Toolbar acciones ----
  root.appendChild(renderDetalleToolbar(proyectoId, proyecto));

  // ---- Gráficas ----
  const chartsWrap = document.createElement('div');
  chartsWrap.id = 'detalle-charts-wrap';
  root.appendChild(chartsWrap);
  refreshDetalleCharts(proyectoId);

  // ---- Tabla movimientos ----
  const tableWrap = document.createElement('div');
  tableWrap.id = 'detalle-table-wrap';
  root.appendChild(tableWrap);

  refreshDetalleTable(proyectoId);
}

// =====================================================
// KPIs
// =====================================================
function renderDetalleKPIs(proyectoId, proyecto) {
  const saldoCaja        = calcSaldoCajaProyecto(proyectoId);
  const totalCobrado     = calcTotalCobradoCliente(proyectoId);
  const totalGastado     = calcTotalGastadoPagado(proyectoId);
  const utilidadReal     = calcUtilidadReal(proyectoId);
  const utilidadEst      = calcUtilidadEstimada(proyectoId);
  const avance           = calcAvanceFinanciero(proyectoId);
  const deudaPend        = calcDeudaPendiente(proyectoId);
  const iva              = calcIVADesglose(proyectoId);

  const cls = avance < 60 ? 'low' : avance < 85 ? 'medium' : 'high';

  const grid = document.createElement('div');
  grid.className = 'detalle-kpi-grid mb-24';
  grid.id = 'detalle-kpi-grid';
  grid.innerHTML = `
    ${detalleKPI('💰', 'Saldo en caja',       formatMXN(saldoCaja),     saldoCaja >= 0 ? 'text-success' : 'text-danger')}
    ${detalleKPI('📥', 'Total cobrado',        formatMXN(totalCobrado),  'text-success')}
    <div class="kpi-card">
      <div class="kpi-label">📤 Total gastado
        <button class="btn-iva-info" title="Ver desglose IVA" data-proyecto="${proyectoId}">ℹ</button>
      </div>
      <div class="kpi-value text-danger" style="font-size:20px">${formatMXN(totalGastado)}</div>
      <div class="kpi-sub iva-desglose hidden" id="iva-desglose-${proyectoId}">
        <div>Neto: <strong>${formatMXN(iva.gastoNeto)}</strong></div>
        <div>IVA pagado: <strong>${formatMXN(iva.ivaPagado)}</strong></div>
        <div style="color:var(--warning)">IVA por cobrar: <strong>${formatMXN(iva.ivaPorCobrar)}</strong></div>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">📈 Utilidad</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px">
        <div>
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px">Real a la fecha</div>
          <div class="kpi-value ${utilidadReal >= 0 ? 'text-success' : 'text-danger'}" style="font-size:17px">${formatMXN(utilidadReal)}</div>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:8px">
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px">Estimada (100% contrato)</div>
          <div class="kpi-value ${utilidadEst >= 0 ? 'text-success' : 'text-danger'}" style="font-size:17px">${formatMXN(utilidadEst)}</div>
        </div>
      </div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">📊 Avance financiero</div>
      <div class="kpi-value" style="font-size:20px">${avance.toFixed(1)}%</div>
      <div class="progress-bar" style="margin-top:6px">
        <div class="progress-fill ${cls}" style="width:${Math.min(avance,100)}%"></div>
      </div>
      <div class="kpi-sub">de ${formatMXN(proyecto.presupuesto_contrato)} contratados</div>
    </div>
    ${detalleKPI('⚠️', 'Deuda pendiente',      formatMXN(deudaPend),     deudaPend > 0 ? 'text-warning' : 'text-muted')}
  `;

  // Toggle IVA info
  setTimeout(() => {
    grid.querySelectorAll('.btn-iva-info').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const el = grid.querySelector(`#iva-desglose-${btn.dataset.proyecto}`);
        if (el) el.classList.toggle('hidden');
      });
    });
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

function refreshDetalleKPIs(proyectoId) {
  const proyecto = getItem(KEYS.PROYECTOS, proyectoId);
  if (!proyecto) return;
  const old = document.getElementById('detalle-kpi-grid');
  if (old) old.replaceWith(renderDetalleKPIs(proyectoId, proyecto));
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
        ${renderBarChart(porProveedor, { title: '' })}
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
    <button class="btn btn-secondary" id="btn-proveedores-proy">📋 Proveedores</button>
    <div class="toolbar-spacer"></div>
    <button class="btn btn-ghost btn-sm" id="btn-editar-proy">✏️ Editar proyecto</button>
  `;

  bar.querySelector('#btn-gasto').addEventListener('click', () =>
    abrirModalMovProy(proyectoId, 'gasto'));
  bar.querySelector('#btn-abono').addEventListener('click', () =>
    abrirModalMovProy(proyectoId, 'abono_cliente'));
  bar.querySelector('#btn-recibir').addEventListener('click', () =>
    abrirModalRecibirSOGRUB(proyectoId));
  bar.querySelector('#btn-proveedores-proy').addEventListener('click', () =>
    abrirModalProveedoresProyecto(proyectoId));
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

  movs = [...movs].sort((a, b) => b.fecha.localeCompare(a.fecha));

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
            const facturaIcon = m.factura_nombre
              ? `<span class="badge badge-muted badge-no-dot" title="${m.factura_nombre}" style="font-size:10px;cursor:default">📄 Factura</span>`
              : '';
            return `
              <tr>
                <td class="text-muted">${formatDate(m.fecha)}</td>
                <td>${m.concepto || '—'}</td>
                <td>${m.tipo === 'gasto' ? categoriaBadge(m.categoria) : '—'}</td>
                <td class="text-muted">${m.subcontratista || '—'}</td>
                <td>${tipoBadge(m.tipo)}</td>
                <td class="${colorMonto} font-mono">${formatMXN(m.monto)}</td>
                <td>${ivaLabel}${facturaIcon}</td>
                <td>${statusBadge(m.status)}</td>
                <td>
                  <div class="td-actions">
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
function abrirModalMovProy(proyectoId, tipo, id = null) {
  const mov = id ? getItem(KEYS.PROY_MOVIMIENTOS, id) : null;

  const titulos = {
    gasto:           id ? 'Editar gasto' : 'Registrar gasto',
    abono_cliente:   id ? 'Editar abono' : 'Abono del cliente',
  };
  const titulo = titulos[tipo] ?? 'Movimiento';
  const esGasto = tipo === 'gasto';

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
    ${esGasto ? `
    <div class="form-group">
      <label class="form-label" for="pm-categoria">Categoría</label>
      <select id="pm-categoria" class="form-select">
        <option value="">Selecciona categoría</option>
        ${CATEGORIAS.map(c => `<option value="${c}" ${mov?.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
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
      <label class="form-label" for="pm-factura">Factura PDF <span class="text-dim">(opcional)</span></label>
      <input type="file" id="pm-factura" class="form-input" accept=".pdf" style="padding:6px 10px">
      ${mov?.factura_nombre ? `<div class="text-sm text-muted" style="margin-top:4px">📄 ${mov.factura_nombre}</div>` : ''}
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
      <label class="form-label" for="pm-nota">Nota <span class="text-dim">(opcional)</span></label>
      <input type="text" id="pm-nota" class="form-input" placeholder="Nota adicional"
        value="${mov?.subcontratista ?? ''}">
    </div>
    `}
  `;

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

      // OCR: when a PDF is selected, extract the amount
      const fileInput  = body.querySelector('#pm-factura');
      const ocrResult  = body.querySelector('#pm-ocr-result');
      const montoInput = body.querySelector('#pm-monto');

      fileInput?.addEventListener('change', async () => {
        if (!fileInput.files?.length) return;
        const file = fileInput.files[0];

        ocrResult.className = 'ocr-result ocr-loading';
        ocrResult.textContent = '🔍 Analizando factura…';
        ocrResult.classList.remove('hidden');

        try {
          const montoOCR = await leerMontoFactura(file);

          if (montoOCR === null) {
            ocrResult.className = 'ocr-result ocr-warn';
            ocrResult.textContent = '⚠ No se pudo detectar el monto en el PDF';
            return;
          }

          const montoIngresado = parseFloat(montoInput.value);

          if (!montoInput.value || isNaN(montoIngresado)) {
            // Sin monto ingresado → sugerir
            ocrResult.className = 'ocr-result ocr-suggest';
            ocrResult.innerHTML = `💡 La factura indica <strong>${formatMXN(montoOCR)}</strong>. <button class="btn-ocr-usar" style="color:var(--accent);background:none;border:none;cursor:pointer;font-weight:600;font-size:12px">Usar este monto</button>`;
            ocrResult.querySelector('.btn-ocr-usar')?.addEventListener('click', () => {
              montoInput.value = montoOCR.toFixed(2);
              ocrResult.className = 'ocr-result ocr-ok';
              ocrResult.textContent = `✓ Monto de factura coincide con monto ingresado (${formatMXN(montoOCR)})`;
            });
          } else {
            const diff = Math.abs(montoOCR - montoIngresado);
            const pct  = montoIngresado > 0 ? diff / montoIngresado : 1;
            if (pct < 0.01) {
              // Coincide (margen < 1%)
              ocrResult.className = 'ocr-result ocr-ok';
              ocrResult.textContent = `✓ Monto de factura coincide con monto ingresado (${formatMXN(montoOCR)})`;
            } else {
              // No coincide
              ocrResult.className = 'ocr-result ocr-mismatch';
              ocrResult.innerHTML = `⚠ El monto ingresado (${formatMXN(montoIngresado)}) no coincide con la factura (${formatMXN(montoOCR)})`;
            }
          }

          // Guardar monto OCR en el input como data attribute para usarlo al guardar
          fileInput.dataset.ocrMonto = montoOCR;

        } catch (err) {
          console.error('[OCR]', err);
          ocrResult.className = 'ocr-result ocr-warn';
          ocrResult.textContent = '⚠ Error al leer el PDF — el gasto se guardará sin verificación';
        }
      });

      // Re-evaluar al cambiar monto manualmente (si ya hay un OCR result)
      montoInput?.addEventListener('input', () => {
        const montoOCR = parseFloat(fileInput?.dataset.ocrMonto);
        if (!ocrResult || ocrResult.classList.contains('hidden') || isNaN(montoOCR)) return;
        const montoIngresado = parseFloat(montoInput.value);
        if (isNaN(montoIngresado)) return;
        const diff = Math.abs(montoOCR - montoIngresado);
        const pct  = montoIngresado > 0 ? diff / montoIngresado : 1;
        if (pct < 0.01) {
          ocrResult.className = 'ocr-result ocr-ok';
          ocrResult.textContent = `✓ Monto de factura coincide con monto ingresado (${formatMXN(montoOCR)})`;
        } else {
          ocrResult.className = 'ocr-result ocr-mismatch';
          ocrResult.innerHTML = `⚠ El monto ingresado (${formatMXN(montoIngresado)}) no coincide con la factura (${formatMXN(montoOCR)})`;
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
      const incluye_iva = esGasto
        ? body.querySelector('#pm-coniva')?.checked ?? false
        : false;

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

      const monto = esGasto ? -montoRaw : montoRaw;

      // Guardar referencia al PDF (nombre de archivo) sin subir a Storage
      let factura_nombre = mov?.factura_nombre ?? '';
      let factura_monto_ocr = mov?.factura_monto_ocr ?? null;
      if (esGasto && incluye_iva) {
        const fileInput = body.querySelector('#pm-factura');
        if (fileInput?.files?.length > 0) {
          factura_nombre = fileInput.files[0].name;
          const ocrVal = parseFloat(fileInput.dataset.ocrMonto);
          if (!isNaN(ocrVal)) factura_monto_ocr = ocrVal;
        }
      }

      const data = {
        fecha, monto, concepto,
        subcontratista: subcon,
        status, tipo, proyecto_id: proyectoId,
        categoria,
        incluye_iva,
        factura_nombre,
        factura_monto_ocr,
      };

      if (mov) {
        updateItem(KEYS.PROY_MOVIMIENTOS, id, data);
        showToast('Movimiento actualizado', 'success');
      } else {
        addItem(KEYS.PROY_MOVIMIENTOS, data);
        showToast(esGasto ? 'Gasto registrado' : 'Abono registrado', 'success');
      }

      closeModal();
      refreshDetalleKPIs(proyectoId);
      refreshDetalleTable(proyectoId);
      refreshDetalleCharts(proyectoId);
    },
  });
}

// =====================================================
// MODAL: RECIBIR DE SOGRUB (regla #9)
// =====================================================
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
    },
  });
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
