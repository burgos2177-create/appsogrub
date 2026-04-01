/* =====================================================
   SOGRUB Bitácora — Vista: Caja SOGRUB
   ===================================================== */
'use strict';

// Estado local de filtros
const _cajaState = { mes: '', status: 'Todos' };

function renderCaja() {
  const root = document.getElementById('caja-root');
  root.innerHTML = '';

  // ---- Toolbar ----
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar mb-20';
  toolbar.innerHTML = `
    <button class="btn btn-primary" id="btn-nuevo-mov">＋ Nuevo movimiento</button>
    <button class="btn btn-secondary" id="btn-transferir">⇄ Transferir a proyecto</button>
    <div class="toolbar-spacer"></div>
    <div class="toolbar-filters">
      <select class="filter-select" id="filter-mes">
        <option value="">Todos los meses</option>
        ${generarOpcionesMeses()}
      </select>
      <select class="filter-select" id="filter-status">
        <option value="Todos">Todos</option>
        <option value="Pagado">Pagado</option>
        <option value="Pendiente">Pendiente</option>
      </select>
    </div>
  `;
  root.appendChild(toolbar);

  // Restaurar filtros
  toolbar.querySelector('#filter-mes').value    = _cajaState.mes;
  toolbar.querySelector('#filter-status').value = _cajaState.status;

  toolbar.querySelector('#filter-mes').addEventListener('change', e => {
    _cajaState.mes = e.target.value;
    refreshCajaTable();
  });
  toolbar.querySelector('#filter-status').addEventListener('change', e => {
    _cajaState.status = e.target.value;
    refreshCajaTable();
  });

  toolbar.querySelector('#btn-nuevo-mov').addEventListener('click', () => abrirModalMovimiento());
  toolbar.querySelector('#btn-transferir').addEventListener('click', () => abrirModalTransferencia());

  // ---- Tabla ----
  const tableContainer = document.createElement('div');
  tableContainer.id = 'caja-table-container';
  root.appendChild(tableContainer);

  // ---- Config saldo inicial (colapsable) ----
  root.appendChild(renderConfigSaldo());

  refreshCajaTable();
}

// =====================================================
// TABLA DE MOVIMIENTOS
// =====================================================
function refreshCajaTable() {
  const container = document.getElementById('caja-table-container');
  if (!container) return;

  let movs = getCollection(KEYS.MOVIMIENTOS) ?? [];

  // Filtrar por mes
  if (_cajaState.mes) {
    movs = movs.filter(m => m.fecha && m.fecha.startsWith(_cajaState.mes));
  }
  // Filtrar por status
  if (_cajaState.status !== 'Todos') {
    movs = movs.filter(m => m.status === _cajaState.status);
  }

  // Ordenar por fecha desc
  movs = [...movs].sort((a, b) => b.fecha.localeCompare(a.fecha));

  const proyectos = getCollection(KEYS.PROYECTOS) ?? [];

  if (movs.length === 0) {
    container.innerHTML = '';
    container.appendChild(emptyState({
      icon:        svgEmptyCaja(),
      title:       'Sin movimientos',
      desc:        'Registra tu primer movimiento de caja o cambia los filtros.',
      actionLabel: '＋ Nuevo movimiento',
      onAction:    () => abrirModalMovimiento(),
    }));
    return;
  }

  // Totales
  const allMovs      = getCollection(KEYS.MOVIMIENTOS) ?? [];
  const totalPagado  = allMovs.filter(m => m.status === 'Pagado').reduce((a, m) => a + m.monto, 0);
  const totalPend    = allMovs.filter(m => m.status === 'Pendiente').reduce((a, m) => a + m.monto, 0);
  const balanceNeto  = calcSaldoMifel();

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="table-wrapper">
      <table class="data-table" id="caja-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Concepto</th>
            <th>Monto</th>
            <th>Status</th>
            <th>Tipo</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${movs.map(m => {
            const proy = m.proyecto_id ? proyectos.find(p => p.id === m.proyecto_id) : null;
            const colorMonto = m.monto >= 0 ? 'amount-positive' : 'amount-negative';
            return `
              <tr>
                <td class="text-muted">${formatDate(m.fecha)}</td>
                <td>${m.concepto || '—'}</td>
                <td class="${colorMonto} font-mono">${formatMXN(m.monto)}</td>
                <td>${statusBadge(m.status)}</td>
                <td>${tipoBadge(m.tipo, proy?.nombre ?? '')}</td>
                <td>
                  <div class="td-actions">
                    <button class="btn btn-ghost btn-icon btn-edit-mov" data-id="${m.id}" title="Editar">✏️</button>
                    <button class="btn btn-ghost btn-icon btn-delete-mov" data-id="${m.id}" title="Eliminar">🗑️</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
      <div class="table-footer">
        <span>Pagado: <strong class="amount-${totalPagado >= 0 ? 'positive' : 'negative'}">${formatMXN(totalPagado)}</strong></span>
        <span>Pendiente: <strong class="text-warning">${formatMXN(totalPend)}</strong></span>
        <span style="margin-left:auto">Saldo Mifel: <strong class="${balanceNeto >= 0 ? 'amount-positive' : 'amount-negative'}">${formatMXN(balanceNeto)}</strong></span>
      </div>
    </div>
  `;

  // Wire botones
  wrap.querySelectorAll('.btn-edit-mov').forEach(btn => {
    btn.addEventListener('click', () => abrirModalMovimiento(btn.dataset.id));
  });
  wrap.querySelectorAll('.btn-delete-mov').forEach(btn => {
    btn.addEventListener('click', () => confirmarEliminarMovimiento(btn.dataset.id));
  });

  container.innerHTML = '';
  container.appendChild(wrap);
}

// =====================================================
// MODAL: NUEVO / EDITAR MOVIMIENTO
// =====================================================
function abrirModalMovimiento(id = null) {
  const mov    = id ? getItem(KEYS.MOVIMIENTOS, id) : null;
  const titulo = mov ? 'Editar movimiento' : 'Nuevo movimiento';

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';

  const tipoActual = mov ? (mov.monto >= 0 ? 'ingreso' : 'egreso') : 'egreso';

  body.innerHTML = `
    <div class="form-group">
      <label class="form-label">Tipo</label>
      <div class="toggle-group">
        <input type="radio" name="mov-tipo" id="tipo-egreso"  value="egreso"  class="toggle-option" ${tipoActual === 'egreso'  ? 'checked' : ''}>
        <label for="tipo-egreso"  class="toggle-label">Egreso</label>
        <input type="radio" name="mov-tipo" id="tipo-ingreso" value="ingreso" class="toggle-option" ${tipoActual === 'ingreso' ? 'checked' : ''}>
        <label for="tipo-ingreso" class="toggle-label">Ingreso</label>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="mov-fecha">Fecha</label>
        <input type="date" id="mov-fecha" class="form-input" value="${mov?.fecha ?? todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label" for="mov-monto">Monto ($)</label>
        <input type="number" id="mov-monto" class="form-input" placeholder="0.00" min="0" step="0.01"
          value="${mov ? Math.abs(mov.monto) : ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="mov-concepto">Concepto</label>
      <input type="text" id="mov-concepto" class="form-input" placeholder="Descripción del movimiento"
        value="${mov?.concepto ?? ''}">
    </div>
    <div class="form-group">
      <label class="form-label">Status</label>
      <div class="toggle-group">
        <input type="radio" name="mov-status" id="status-pagado"   value="Pagado"   class="toggle-option" ${(mov?.status ?? 'Pagado') === 'Pagado'   ? 'checked' : ''}>
        <label for="status-pagado"   class="toggle-label">Pagado</label>
        <input type="radio" name="mov-status" id="status-pendiente" value="Pendiente" class="toggle-option" ${mov?.status === 'Pendiente' ? 'checked' : ''}>
        <label for="status-pendiente" class="toggle-label">Pendiente</label>
      </div>
    </div>
  `;

  openModal({
    title:       titulo,
    body,
    confirmText: mov ? 'Guardar cambios' : 'Agregar',
    onConfirm:   (btn) => {
      const tipo    = body.querySelector('input[name="mov-tipo"]:checked')?.value ?? 'egreso';
      const fecha   = body.querySelector('#mov-fecha').value;
      const montoRaw = parseFloat(body.querySelector('#mov-monto').value);
      const concepto = body.querySelector('#mov-concepto').value.trim();
      const status  = body.querySelector('input[name="mov-status"]:checked')?.value ?? 'Pagado';

        const valid = validateFields([
        { el: body.querySelector('#mov-fecha'),   msg: 'Selecciona una fecha' },
        { el: body.querySelector('#mov-monto'),   msg: 'Ingresa un monto mayor a 0' },
        { el: body.querySelector('#mov-concepto'),msg: 'Escribe un concepto' },
      ]);
      if (!valid) return;
      if (isNaN(montoRaw) || montoRaw <= 0) { showToast('Ingresa un monto válido', 'warning'); return; }

      const monto = tipo === 'egreso' ? -montoRaw : montoRaw;

      if (mov) {
        updateItem(KEYS.MOVIMIENTOS, id, { fecha, monto, concepto, status });
        showToast('Movimiento actualizado', 'success');
      } else {
        addItem(KEYS.MOVIMIENTOS, { fecha, monto, concepto, status, tipo: 'gasto_general', proyecto_id: null });
        showToast('Movimiento registrado', 'success');
      }

      closeModal();
      refreshCajaTable();
    },
  });
}

// =====================================================
// MODAL: TRANSFERIR A PROYECTO
// =====================================================
function abrirModalTransferencia() {
  const proyectos = (getCollection(KEYS.PROYECTOS) ?? []).filter(p => p.estado === 'activo');

  if (proyectos.length === 0) {
    showToast('No hay proyectos activos para transferir', 'warning');
    return;
  }

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="tx-proyecto">Proyecto destino</label>
      <select id="tx-proyecto" class="form-select">
        ${proyectos.map(p => `<option value="${p.id}">${p.nombre} — ${p.cliente}</option>`).join('')}
      </select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="tx-fecha">Fecha</label>
        <input type="date" id="tx-fecha" class="form-input" value="${todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label" for="tx-monto">Monto ($)</label>
        <input type="number" id="tx-monto" class="form-input" placeholder="0.00" min="0.01" step="0.01">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="tx-concepto">Concepto</label>
      <input type="text" id="tx-concepto" class="form-input" placeholder="Se completa automáticamente">
    </div>
  `;

  // Auto-fill concepto al cambiar proyecto
  const fillConcepto = () => {
    const sel  = body.querySelector('#tx-proyecto');
    const proy = proyectos.find(p => p.id === sel.value);
    const inp  = body.querySelector('#tx-concepto');
    if (!inp.dataset.edited) inp.value = `Transferencia a ${proy?.nombre ?? ''}`;
  };
  body.querySelector('#tx-proyecto').addEventListener('change', fillConcepto);
  body.querySelector('#tx-concepto').addEventListener('input', e => { e.target.dataset.edited = '1'; });
  setTimeout(fillConcepto, 0);

  openModal({
    title:       'Transferir a proyecto',
    body,
    confirmText: 'Transferir',
    onConfirm:   () => {
      const proyectoId = body.querySelector('#tx-proyecto').value;
      const fecha      = body.querySelector('#tx-fecha').value;
      const monto      = parseFloat(body.querySelector('#tx-monto').value);
      const concepto   = body.querySelector('#tx-concepto').value.trim();

      const valid = validateFields([
        { el: body.querySelector('#tx-fecha'),  msg: 'Selecciona una fecha' },
        { el: body.querySelector('#tx-monto'),  msg: 'Ingresa un monto mayor a 0' },
      ]);
      if (!valid) return;
      if (isNaN(monto) || monto <= 0) { showToast('Ingresa un monto válido', 'warning'); return; }

      ejecutarTransferenciaSOGRUB(proyectoId, monto, concepto, fecha);
      showToast('Transferencia registrada en ambas cajas', 'success');
      closeModal();
      refreshCajaTable();
    },
  });
}

// =====================================================
// ELIMINAR MOVIMIENTO
// =====================================================
function confirmarEliminarMovimiento(id) {
  const mov = getItem(KEYS.MOVIMIENTOS, id);
  openConfirmModal({
    title:       'Eliminar movimiento',
    message:     `¿Eliminar "${mov?.concepto ?? 'este movimiento'}"? Esta acción no se puede deshacer.`,
    confirmText: 'Eliminar',
    onConfirm:   () => {
      deleteItem(KEYS.MOVIMIENTOS, id);
      closeModal();
      showToast('Movimiento eliminado', 'success');
      refreshCajaTable();
    },
  });
}

// =====================================================
// CONFIG SALDO INICIAL (colapsable)
// =====================================================
function renderConfigSaldo() {
  const wrap = document.createElement('div');
  wrap.className = 'card mt-24';
  wrap.innerHTML = `
    <button class="collapsible-trigger" id="cfg-trigger">
      ⚙️ Configurar saldo inicial Mifel <span class="caret">▼</span>
    </button>
    <div class="collapsible-content" id="cfg-content">
      <div style="padding-top:16px;display:flex;align-items:flex-end;gap:10px">
        <div class="form-group" style="flex:1;max-width:260px">
          <label class="form-label" for="saldo-inicial-input">Saldo inicial ($)</label>
          <input type="number" id="saldo-inicial-input" class="form-input" step="0.01"
            value="${getConfig().saldo_inicial_mifel}" placeholder="0.00">
        </div>
        <button class="btn btn-primary btn-sm" id="btn-guardar-saldo" style="margin-bottom:1px">Guardar</button>
      </div>
      <p class="text-muted text-sm mt-8">
        Este es el saldo de apertura de la cuenta Mifel. Los movimientos se aplican sobre este valor.
      </p>
    </div>
  `;

  wrap.querySelector('#cfg-trigger').addEventListener('click', () => {
    const btn     = wrap.querySelector('#cfg-trigger');
    const content = wrap.querySelector('#cfg-content');
    btn.classList.toggle('open');
    content.classList.toggle('open');
  });

  wrap.querySelector('#btn-guardar-saldo').addEventListener('click', () => {
    const val = parseFloat(wrap.querySelector('#saldo-inicial-input').value);
    if (isNaN(val)) { showToast('Ingresa un valor numérico', 'warning'); return; }
    updateConfig({ saldo_inicial_mifel: val });
    showToast('Saldo inicial actualizado', 'success');
    refreshCajaTable();
  });

  return wrap;
}

// =====================================================
// HELPERS
// =====================================================
function generarOpcionesMeses() {
  const movs = getCollection(KEYS.MOVIMIENTOS) ?? [];
  const meses = [...new Set(movs.map(m => m.fecha?.slice(0, 7)).filter(Boolean))].sort().reverse();

  const fmt = (ym) => {
    const [y, m] = ym.split('-');
    const d = new Date(+y, +m - 1, 1);
    return d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  };

  return meses.map(m => `<option value="${m}">${fmt(m)}</option>`).join('');
}

function svgEmptyCaja() {
  return `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="20" width="48" height="36" rx="4" stroke="currentColor" stroke-width="2"/>
    <path d="M8 30h48" stroke="currentColor" stroke-width="2"/>
    <circle cx="20" cy="42" r="4" stroke="currentColor" stroke-width="2"/>
    <line x1="30" y1="40" x2="46" y2="40" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="30" y1="44" x2="40" y2="44" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M24 20v-4a8 8 0 0116 0v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}
