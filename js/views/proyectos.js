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
    const pct = r.avanceCobranza;

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
          <span style="font-size:11px;color:var(--text-muted)">Avance de cobranza</span>
          <strong style="font-size:12px">${pct.toFixed(1)}%</strong>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${Math.min(pct,100)}%;background:var(--accent)"></div>
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
      <label class="form-label" for="proy-costo-directo">Costo directo estimado ($)</label>
      <input type="number" id="proy-costo-directo" class="form-input" placeholder="0.00" min="0" step="0.01"
        value="${proy?.costo_directo_base ?? ''}">
      <span class="text-dim" style="font-size:11px">Presupuesto de obra (material + mano de obra + subcontratos). El monto del contrato se calcula solo.</span>
    </div>
    <div class="form-group">
      <label class="form-label">Sobrecostos en cascada (%)</label>
      <div class="form-row" style="gap:8px">
        <div class="form-group" style="flex:1">
          <label class="form-label" for="proy-ind-oficina" style="font-size:11px;color:var(--text-muted)">Ind. oficina</label>
          <input type="number" id="proy-ind-oficina" class="form-input" placeholder="0" min="0" max="100" step="0.1"
            value="${proy?.sobrecosto_ind_oficina ?? proy?.sobrecosto_indirectos ?? ''}">
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label" for="proy-ind-campo" style="font-size:11px;color:var(--text-muted)">Ind. campo</label>
          <input type="number" id="proy-ind-campo" class="form-input" placeholder="0" min="0" max="100" step="0.1"
            value="${proy?.sobrecosto_ind_campo ?? ''}">
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label" for="proy-financiamiento" style="font-size:11px;color:var(--text-muted)">Financiam.</label>
          <input type="number" id="proy-financiamiento" class="form-input" placeholder="0" min="0" max="100" step="0.1"
            value="${proy?.sobrecosto_financiamiento ?? ''}">
        </div>
        <div class="form-group" style="flex:1">
          <label class="form-label" for="proy-utilidad" style="font-size:11px;color:var(--text-muted)">Utilidad</label>
          <input type="number" id="proy-utilidad" class="form-input" placeholder="0" min="0" max="100" step="0.1"
            value="${proy?.sobrecosto_utilidad ?? ''}">
        </div>
      </div>
    </div>
    <div id="proy-contrato-preview" style="background:var(--surface2);border-radius:var(--radius-md);padding:12px 14px"></div>
    <div class="form-group">
      <label class="form-label" for="proy-estado">Estado</label>
      <select id="proy-estado" class="form-select">
        <option value="activo"     ${(proy?.estado ?? 'activo') === 'activo'    ? 'selected' : ''}>Activo</option>
        <option value="pausa"      ${proy?.estado === 'pausa'     ? 'selected' : ''}>Pausa</option>
        <option value="terminado"  ${proy?.estado === 'terminado' ? 'selected' : ''}>Terminado</option>
      </select>
    </div>
  `;

  // ---- Preview del contrato en cascada (en vivo) ----
  setTimeout(() => {
    const preview = body.querySelector('#proy-contrato-preview');
    const ids = ['proy-costo-directo', 'proy-ind-oficina', 'proy-ind-campo', 'proy-financiamiento', 'proy-utilidad'];
    const linea = (label, val, extra = '') => `
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted)${extra}">
        <span>${label}</span><strong style="color:var(--text);font-variant-numeric:tabular-nums">${formatMXN(val)}</strong>
      </div>`;
    const upd = () => {
      const d = calcDesgloseContrato({
        costo_directo_base:        parseFloat(body.querySelector('#proy-costo-directo').value) || 0,
        sobrecosto_ind_oficina:    parseFloat(body.querySelector('#proy-ind-oficina').value) || 0,
        sobrecosto_ind_campo:      parseFloat(body.querySelector('#proy-ind-campo').value) || 0,
        sobrecosto_financiamiento: parseFloat(body.querySelector('#proy-financiamiento').value) || 0,
        sobrecosto_utilidad:       parseFloat(body.querySelector('#proy-utilidad').value) || 0,
      });
      preview.innerHTML = `
        ${linea('Costo directo', d.costoDirecto)}
        ${d.indOficina     > 0 ? linea('+ Indirectos oficina', d.indOficina)     : ''}
        ${d.indCampo       > 0 ? linea('+ Indirectos campo',   d.indCampo)       : ''}
        ${d.financiamiento > 0 ? linea('+ Financiamiento',     d.financiamiento) : ''}
        ${d.utilidad       > 0 ? linea('+ Utilidad',           d.utilidad)       : ''}
        <div style="display:flex;justify-content:space-between;margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">
          <span style="font-weight:600">Monto del contrato</span>
          <strong style="color:var(--accent);font-size:15px;font-variant-numeric:tabular-nums">${formatMXN(d.contrato)}</strong>
        </div>`;
    };
    ids.forEach(id => body.querySelector('#' + id)?.addEventListener('input', upd));
    upd();
  }, 0);

  openModal({
    title:       titulo,
    body,
    confirmText: proy ? 'Guardar cambios' : 'Crear proyecto',
    onConfirm:   () => {
      const nombre       = body.querySelector('#proy-nombre').value.trim();
      const cliente      = body.querySelector('#proy-cliente').value.trim();
      const fecha_inicio = body.querySelector('#proy-fecha').value;
      const costo_directo_base = parseFloat(body.querySelector('#proy-costo-directo').value) || 0;
      const estado       = body.querySelector('#proy-estado').value;
      const sobrecosto_ind_oficina    = parseFloat(body.querySelector('#proy-ind-oficina').value) || 0;
      const sobrecosto_ind_campo      = parseFloat(body.querySelector('#proy-ind-campo').value) || 0;
      const sobrecosto_financiamiento = parseFloat(body.querySelector('#proy-financiamiento').value) || 0;
      const sobrecosto_utilidad       = parseFloat(body.querySelector('#proy-utilidad').value) || 0;

      const valid = validateFields([
        { el: body.querySelector('#proy-nombre'),        msg: 'Escribe el nombre del proyecto' },
        { el: body.querySelector('#proy-cliente'),       msg: 'Escribe el nombre del cliente' },
        { el: body.querySelector('#proy-fecha'),         msg: 'Selecciona la fecha de inicio' },
        { el: body.querySelector('#proy-costo-directo'), msg: 'Ingresa un costo directo mayor a 0' },
      ]);
      if (!valid) return;

      // El monto del contrato es derivado de la cascada.
      const presupuesto_contrato = calcContratoDesdeCosto({
        costo_directo_base, sobrecosto_ind_oficina, sobrecosto_ind_campo,
        sobrecosto_financiamiento, sobrecosto_utilidad,
      });

      const data = { nombre, cliente, fecha_inicio, estado,
                     costo_directo_base, presupuesto_contrato,
                     sobrecosto_ind_oficina, sobrecosto_ind_campo,
                     sobrecosto_financiamiento, sobrecosto_utilidad };

      if (proy) {
        updateItem(KEYS.PROYECTOS, id, data);
        showToast('Proyecto actualizado', 'success');
      } else {
        addItem(KEYS.PROYECTOS, data);
        showToast(`Proyecto "${nombre}" creado`, 'success');
      }

      closeModal();
      refreshProyectosGrid();

      // Si se editó desde la vista de detalle, refrescar sus KPIs y bolsitas.
      if (proy && document.getElementById('bolsitas-card')) {
        if (typeof refreshDetalleKPIs === 'function') refreshDetalleKPIs(id);
        if (typeof refreshBolsitas    === 'function') refreshBolsitas(id);
      }
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
