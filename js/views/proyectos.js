/* =====================================================
   SOGRUB Bitácora — Vista: Proyectos (lista)
   ===================================================== */
'use strict';

const _proyState = { filtro: 'activos' };

function renderProyectos() {
  const root = document.getElementById('proyectos-root');
  root.innerHTML = '';

  // ---- Toolbar ----
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar mb-20';
  toolbar.innerHTML = `
    <button class="btn btn-primary" id="btn-nuevo-proyecto">＋ Nuevo proyecto</button>
    <div class="toolbar-spacer"></div>
    <div class="toggle-group" style="width:auto">
      <input type="radio" name="proy-filtro" id="filtro-activos" value="activos" class="toggle-option"
        ${_proyState.filtro === 'activos' ? 'checked' : ''}>
      <label for="filtro-activos" class="toggle-label">Activos</label>
      <input type="radio" name="proy-filtro" id="filtro-todos"   value="todos"   class="toggle-option"
        ${_proyState.filtro === 'todos' ? 'checked' : ''}>
      <label for="filtro-todos" class="toggle-label">Todos</label>
    </div>
  `;

  toolbar.querySelector('#btn-nuevo-proyecto').addEventListener('click', () => abrirModalProyecto());
  toolbar.querySelectorAll('input[name="proy-filtro"]').forEach(r => {
    r.addEventListener('change', e => {
      _proyState.filtro = e.target.value;
      refreshProyectosGrid();
    });
  });

  root.appendChild(toolbar);

  // ---- Grid container ----
  const gridWrap = document.createElement('div');
  gridWrap.id = 'proyectos-grid';
  root.appendChild(gridWrap);

  refreshProyectosGrid();
}

// =====================================================
// GRID DE CARDS
// =====================================================
function refreshProyectosGrid() {
  const wrap = document.getElementById('proyectos-grid');
  if (!wrap) return;

  let proyectos = getCollection(KEYS.PROYECTOS) ?? [];
  if (_proyState.filtro === 'activos') {
    proyectos = proyectos.filter(p => p.estado === 'activo');
  }

  // Orden: activos primero, luego pausa, luego terminados
  const ordenEstado = { activo: 0, pausa: 1, terminado: 2 };
  proyectos = [...proyectos].sort((a, b) =>
    (ordenEstado[a.estado] ?? 9) - (ordenEstado[b.estado] ?? 9)
  );

  wrap.innerHTML = '';

  if (proyectos.length === 0) {
    wrap.appendChild(emptyState({
      icon:        svgEmptyProyectos(),
      title:       _proyState.filtro === 'activos' ? 'Sin proyectos activos' : 'Sin proyectos',
      desc:        'Crea tu primer proyecto para comenzar a registrar movimientos.',
      actionLabel: '＋ Nuevo proyecto',
      onAction:    () => abrirModalProyecto(),
    }));
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'proyectos-grid';

  proyectos.forEach(p => {
    const r   = calcResumenProyecto(p.id);
    const pct = r.avancePct;
    const cls = pct < 60 ? 'low' : pct < 85 ? 'medium' : 'high';

    const card = document.createElement('div');
    card.className = 'proyecto-card';
    card.dataset.id = p.id;
    card.innerHTML = `
      <div class="proyecto-card-header">
        <div>
          <div class="proyecto-nombre">${p.nombre}</div>
          <div class="proyecto-cliente text-muted">${p.cliente}</div>
        </div>
        ${estadoBadge(p.estado)}
      </div>

      <div class="proyecto-metrics" style="grid-template-columns:repeat(4,1fr)">
        <div class="metric-item">
          <span class="metric-label">Saldo caja</span>
          <span class="metric-value ${r.saldoCaja >= 0 ? 'text-success' : 'text-danger'}">
            ${formatMXN(r.saldoCaja)}
          </span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Deuda pend.</span>
          <span class="metric-value ${r.deudaPendiente > 0 ? 'text-warning' : 'text-muted'}">
            ${formatMXN(r.deudaPendiente)}
          </span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Util. real</span>
          <span class="metric-value ${r.utilidadReal >= 0 ? 'text-success' : 'text-danger'}">
            ${formatMXN(r.utilidadReal)}
          </span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Util. estimada</span>
          <span class="metric-value ${r.utilidadEstimada >= 0 ? 'text-success' : 'text-danger'}">
            ${formatMXN(r.utilidadEstimada)}
          </span>
        </div>
      </div>

      <div>
        <div class="progress-label">
          <span style="font-size:11px;color:var(--text-muted)">Avance financiero</span>
          <strong style="font-size:12px">${pct.toFixed(1)}%</strong>
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${cls}" style="width:${Math.min(pct,100)}%"></div>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end">
        <button class="btn btn-secondary btn-sm btn-ver-detalle" data-id="${p.id}">Ver detalle →</button>
      </div>
    `;

    card.querySelector('.btn-ver-detalle').addEventListener('click', (e) => {
      e.stopPropagation();
      navigateTo('detalle', p.id);
    });
    card.addEventListener('click', () => navigateTo('detalle', p.id));

    grid.appendChild(card);
  });

  wrap.appendChild(grid);
}

// =====================================================
// MODAL: NUEVO / EDITAR PROYECTO
// =====================================================
function abrirModalProyecto(id = null) {
  const proy   = id ? getItem(KEYS.PROYECTOS, id) : null;
  const titulo = proy ? 'Editar proyecto' : 'Nuevo proyecto';

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="proy-nombre">Nombre del proyecto</label>
      <input type="text" id="proy-nombre" class="form-input" placeholder="Ej: Pérgola Struxo"
        value="${proy?.nombre ?? ''}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="proy-cliente">Cliente</label>
        <input type="text" id="proy-cliente" class="form-input" placeholder="Nombre del cliente"
          value="${proy?.cliente ?? ''}">
      </div>
      <div class="form-group">
        <label class="form-label" for="proy-fecha">Fecha inicio</label>
        <input type="date" id="proy-fecha" class="form-input" value="${proy?.fecha_inicio ?? todayISO()}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="proy-presupuesto">Presupuesto del contrato ($)</label>
      <input type="number" id="proy-presupuesto" class="form-input" placeholder="0.00" min="0" step="0.01"
        value="${proy?.presupuesto_contrato ?? ''}">
    </div>
    <div class="form-group">
      <label class="form-label" for="proy-estado">Estado</label>
      <select id="proy-estado" class="form-select">
        <option value="activo"     ${(proy?.estado ?? 'activo') === 'activo'    ? 'selected' : ''}>Activo</option>
        <option value="pausa"      ${proy?.estado === 'pausa'     ? 'selected' : ''}>Pausa</option>
        <option value="terminado"  ${proy?.estado === 'terminado' ? 'selected' : ''}>Terminado</option>
      </select>
    </div>
  `;

  openModal({
    title:       titulo,
    body,
    confirmText: proy ? 'Guardar cambios' : 'Crear proyecto',
    onConfirm:   () => {
      const nombre       = body.querySelector('#proy-nombre').value.trim();
      const cliente      = body.querySelector('#proy-cliente').value.trim();
      const fecha_inicio = body.querySelector('#proy-fecha').value;
      const presupuesto  = parseFloat(body.querySelector('#proy-presupuesto').value);
      const estado       = body.querySelector('#proy-estado').value;

      const valid = validateFields([
        { el: body.querySelector('#proy-nombre'),       msg: 'Escribe el nombre del proyecto' },
        { el: body.querySelector('#proy-cliente'),      msg: 'Escribe el nombre del cliente' },
        { el: body.querySelector('#proy-fecha'),        msg: 'Selecciona la fecha de inicio' },
        { el: body.querySelector('#proy-presupuesto'),  msg: 'Ingresa un presupuesto mayor a 0' },
      ]);
      if (!valid) return;

      if (proy) {
        updateItem(KEYS.PROYECTOS, id, { nombre, cliente, fecha_inicio, presupuesto_contrato: presupuesto, estado });
        showToast('Proyecto actualizado', 'success');
      } else {
        addItem(KEYS.PROYECTOS, { nombre, cliente, fecha_inicio, presupuesto_contrato: presupuesto, estado });
        showToast(`Proyecto "${nombre}" creado`, 'success');
      }

      closeModal();
      refreshProyectosGrid();
    },
  });
}

// =====================================================
// SVG placeholder
// =====================================================
function svgEmptyProyectos() {
  return `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="6"  y="32" width="16" height="24" rx="2" stroke="currentColor" stroke-width="2"/>
    <rect x="24" y="22" width="16" height="34" rx="2" stroke="currentColor" stroke-width="2"/>
    <rect x="42" y="14" width="16" height="42" rx="2" stroke="currentColor" stroke-width="2"/>
    <line x1="2" y1="56" x2="62" y2="56" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}
