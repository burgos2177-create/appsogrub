/* =====================================================
   SOGRUB Bitácora — Vista: Detalle de Proyecto
   ===================================================== */
'use strict';

const _detalleState = { filtroTipo: 'todos', filtroStatus: 'Todos' };

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
  const utilidad         = calcUtilidadEstimada(proyectoId);
  const avance           = calcAvanceFinanciero(proyectoId);
  const deudaPend        = calcDeudaPendiente(proyectoId);

  const cls = avance < 60 ? 'low' : avance < 85 ? 'medium' : 'high';

  const grid = document.createElement('div');
  grid.className = 'detalle-kpi-grid mb-24';
  grid.id = 'detalle-kpi-grid';
  grid.innerHTML = `
    ${detalleKPI('💰', 'Saldo en caja',       formatMXN(saldoCaja),     saldoCaja >= 0 ? 'text-success' : 'text-danger')}
    ${detalleKPI('📥', 'Total cobrado',        formatMXN(totalCobrado),  'text-success')}
    ${detalleKPI('📤', 'Total gastado',        formatMXN(totalGastado),  'text-danger')}
    ${detalleKPI('📈', 'Utilidad estimada',    formatMXN(utilidad),      utilidad >= 0 ? 'text-success' : 'text-danger')}
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
    <div class="toolbar-spacer"></div>
    <button class="btn btn-ghost btn-sm" id="btn-editar-proy">✏️ Editar proyecto</button>
  `;

  bar.querySelector('#btn-gasto').addEventListener('click', () =>
    abrirModalMovProy(proyectoId, 'gasto'));
  bar.querySelector('#btn-abono').addEventListener('click', () =>
    abrirModalMovProy(proyectoId, 'abono_cliente'));
  bar.querySelector('#btn-recibir').addEventListener('click', () =>
    abrirModalRecibirSOGRUB(proyectoId));
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

  // Filtros toolbar
  const filterBar = document.createElement('div');
  filterBar.className = 'toolbar mb-16';
  filterBar.innerHTML = `
    <span class="text-muted text-sm">Filtrar:</span>
    <select class="filter-select" id="dt-filter-tipo">
      <option value="todos">Todos los tipos</option>
      <option value="gasto">Gastos</option>
      <option value="abono_cliente">Abonos cliente</option>
      <option value="transferencia_sogrub">De SOGRUB</option>
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
  filterBar.querySelector('#dt-filter-tipo').value   = _detalleState.filtroTipo;
  filterBar.querySelector('#dt-filter-status').value = _detalleState.filtroStatus;

  filterBar.querySelector('#dt-filter-tipo').addEventListener('change', e => {
    _detalleState.filtroTipo = e.target.value;
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
            <th>Subcontratista</th>
            <th>Tipo</th>
            <th>Monto</th>
            <th>Status</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${movs.map(m => {
            const colorMonto = m.monto >= 0 ? 'amount-positive' : 'amount-negative';
            return `
              <tr>
                <td class="text-muted">${formatDate(m.fecha)}</td>
                <td>${m.concepto || '—'}</td>
                <td class="text-muted">${m.subcontratista || '—'}</td>
                <td>${tipoBadge(m.tipo)}</td>
                <td class="${colorMonto} font-mono">${formatMXN(m.monto)}</td>
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
      <label class="form-label" for="pm-subcon">Subcontratista <span class="text-dim">(opcional)</span></label>
      <input type="text" id="pm-subcon" class="form-input" placeholder="Nombre del subcontratista"
        value="${mov?.subcontratista ?? ''}">
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

  openModal({
    title:       titulo,
    body,
    confirmText: mov ? 'Guardar cambios' : (esGasto ? 'Registrar gasto' : 'Registrar abono'),
    onConfirm:   () => {
      const fecha    = body.querySelector('#pm-fecha').value;
      const montoRaw = parseFloat(body.querySelector('#pm-monto').value);
      const concepto = body.querySelector('#pm-concepto').value.trim();
      const subcon   = body.querySelector('#pm-subcon, #pm-nota')?.value.trim() ?? '';
      const status   = esGasto
        ? (body.querySelector('input[name="pm-status"]:checked')?.value ?? 'Pagado')
        : 'Pagado';

      const valid = validateFields([
        { el: body.querySelector('#pm-fecha'),   msg: 'Selecciona una fecha' },
        { el: body.querySelector('#pm-monto'),   msg: 'Ingresa un monto mayor a 0' },
        { el: body.querySelector('#pm-concepto'),msg: 'Escribe un concepto' },
      ]);
      if (!valid) return;

      const monto = esGasto ? -montoRaw : montoRaw;

      const data = { fecha, monto, concepto, subcontratista: subcon, status, tipo, proyecto_id: proyectoId };

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
