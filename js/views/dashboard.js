/* =====================================================
   SOGRUB Bitácora — Vista: Dashboard
   ===================================================== */
'use strict';

function renderDashboard() {
  const root = document.getElementById('dashboard-root');
  root.innerHTML = '';

  // ---- Saludo con fecha ----
  const now = new Date();
  const fechaStr = now.toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const hora = now.getHours();
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';

  const greeting = document.createElement('div');
  greeting.className = 'mb-24';
  greeting.innerHTML = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <h2 style="font-size:18px;font-weight:600;color:var(--text)">${saludo}, SOGRUB</h2>
      <span style="font-size:12px;color:var(--text-muted);text-transform:capitalize">${fechaStr}</span>
    </div>
  `;
  root.appendChild(greeting);

  // ---- KPI Cards ----
  const saldoMifel      = calcSaldoMifel();
  const saldoGlobal     = calcSaldoGlobal();
  const comprometido    = calcDineroComprometido();
  const disponibleReal  = calcDisponibleReal();

  const kpiGrid = document.createElement('div');
  kpiGrid.className = 'kpi-grid';
  kpiGrid.innerHTML = `
    ${kpiCard('💳', 'Saldo Mifel',               saldoMifel,     'Cuenta principal SOGRUB')}
    ${kpiCard('🌐', 'Saldo Global',               saldoGlobal,    'Mifel + fondos de inversión')}
    <div class="kpi-card">
      <div class="kpi-label">🔒 Comprometido en proyectos</div>
      <div class="kpi-value text-warning">${formatMXN(comprometido)}</div>
      <div class="kpi-sub" style="display:flex;align-items:center;justify-content:space-between">
        <span>Asignado a proyectos activos</span>
        <button class="btn-comprometido-detail" title="Ver desglose por proyecto" style="background:none;border:1px solid var(--border);border-radius:4px;color:var(--accent);font-size:11px;font-weight:600;padding:2px 7px;cursor:pointer;transition:background var(--transition)">
          Desglose
        </button>
      </div>
    </div>
    ${kpiCard('✅', 'Disponible real',             disponibleReal, 'Mifel libre de compromisos')}
  `;
  root.appendChild(kpiGrid);

  // Botón desglose comprometido
  kpiGrid.querySelector('.btn-comprometido-detail').addEventListener('click', () => {
    const proyectos = (getCollection(KEYS.PROYECTOS) ?? []).filter(p => p.estado === 'activo');
    const filas = proyectos
      .map(p => ({ nombre: p.nombre, saldo: calcSaldoCajaProyecto(p.id) }))
      .filter(r => r.saldo > 0)
      .sort((a, b) => b.saldo - a.saldo);

    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:0';

    if (filas.length === 0) {
      body.innerHTML = '<p class="text-muted text-sm" style="padding:8px 0">Ningún proyecto activo tiene saldo positivo.</p>';
    } else {
      const total = filas.reduce((a, r) => a + r.saldo, 0);
      body.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:6px">
          ${filas.map(r => {
            const pct = total > 0 ? (r.saldo / total * 100).toFixed(1) : '0';
            return `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm)">
                <span style="font-weight:500;font-size:13px">${r.nombre}</span>
                <div style="display:flex;align-items:center;gap:10px">
                  <span style="font-size:11px;color:var(--text-muted)">${pct}%</span>
                  <span style="font-weight:600;font-variant-numeric:tabular-nums;color:var(--warning)">${formatMXN(r.saldo)}</span>
                </div>
              </div>`;
          }).join('')}
          <div style="display:flex;justify-content:space-between;padding:10px 14px;border-top:1px solid var(--border);margin-top:4px">
            <span style="font-size:12px;color:var(--text-muted);font-weight:600">TOTAL</span>
            <span style="font-weight:700;font-variant-numeric:tabular-nums;color:var(--warning)">${formatMXN(total)}</span>
          </div>
        </div>
      `;
    }

    openModal({
      title: '🔒 Comprometido por proyecto',
      body,
      confirmText: 'Cerrar',
      onConfirm: () => closeModal(),
    });
  });

  // ---- Fondos de Inversión ----
  root.appendChild(renderFondosCard());

  // ---- Tabla resumen proyectos activos ----
  root.appendChild(renderProyectosResumen());
}

// ---- KPI card helper ----
function kpiCard(icon, label, value, sub, dynamic = true) {
  const colorClass = dynamic
    ? (value >= 0 ? 'text-success' : 'text-danger')
    : 'text-warning';
  return `
    <div class="kpi-card">
      <div class="kpi-label">${icon} ${label}</div>
      <div class="kpi-value ${colorClass}">${formatMXN(value)}</div>
      <div class="kpi-sub">${sub}</div>
    </div>
  `;
}

// =====================================================
// FONDOS DE INVERSIÓN
// =====================================================
function renderFondosCard() {
  const card = document.createElement('div');
  card.className = 'card mb-24';
  card.id = 'fondos-card';
  card.innerHTML = `
    <div class="card-header">
      <h3 class="section-title" style="margin:0">Fondos de Inversión</h3>
      <button class="btn btn-secondary btn-sm" id="btn-add-fondo">＋ Agregar instrumento</button>
    </div>
    <div id="fondos-list" class="fondos-list"></div>
    <div class="fondos-add-form hidden" id="fondos-add-form">
      <div style="display:flex;gap:8px;align-items:flex-end;padding:10px 0">
        <div class="form-group" style="flex:1">
          <label class="form-label">Nombre</label>
          <input type="text" class="form-input" id="fondo-nombre-input" placeholder="Ej: Binance, GBM…">
        </div>
        <div class="form-group" style="width:160px">
          <label class="form-label">Monto ($)</label>
          <input type="number" class="form-input" id="fondo-monto-input" placeholder="0" min="0" step="0.01">
        </div>
        <button class="btn btn-primary btn-sm" id="btn-save-fondo" style="margin-bottom:1px">Guardar</button>
        <button class="btn btn-ghost btn-sm" id="btn-cancel-fondo" style="margin-bottom:1px">Cancelar</button>
      </div>
    </div>
    <div class="fondo-total" id="fondo-total"></div>
  `;

  // Wire add button
  card.querySelector('#btn-add-fondo').addEventListener('click', () => {
    card.querySelector('#fondos-add-form').classList.remove('hidden');
    card.querySelector('#fondo-nombre-input').focus();
  });

  card.querySelector('#btn-cancel-fondo').addEventListener('click', () => {
    card.querySelector('#fondos-add-form').classList.add('hidden');
    card.querySelector('#fondo-nombre-input').value = '';
    card.querySelector('#fondo-monto-input').value  = '';
  });

  card.querySelector('#btn-save-fondo').addEventListener('click', () => {
    const nombre = card.querySelector('#fondo-nombre-input').value.trim();
    const monto  = parseFloat(card.querySelector('#fondo-monto-input').value) || 0;
    if (!nombre) { showToast('Escribe un nombre para el instrumento', 'warning'); return; }

    const cfg = getConfig();
    cfg.fondos_inversion.push({ id: generateId(), nombre, monto });
    saveConfig(cfg);

    card.querySelector('#fondos-add-form').classList.add('hidden');
    card.querySelector('#fondo-nombre-input').value = '';
    card.querySelector('#fondo-monto-input').value  = '';

    showToast(`${nombre} agregado`, 'success');
    refreshFondos(card);
    refreshKPIs();
  });

  refreshFondos(card);
  return card;
}

function refreshFondos(card) {
  const cfg   = getConfig();
  const list  = card.querySelector('#fondos-list');
  const total = card.querySelector('#fondo-total');

  const fondos = cfg.fondos_inversion ?? [];

  if (fondos.length === 0) {
    list.innerHTML = `<p class="text-muted text-sm" style="padding:8px 0">Sin instrumentos registrados.</p>`;
  } else {
    list.innerHTML = fondos.map(f => `
      <div class="fondo-item" data-id="${f.id}">
        <span class="fondo-nombre">${f.nombre}</span>
        <span class="fondo-monto inline-edit-value" data-id="${f.id}" title="Click para editar">
          ${formatMXN(f.monto)}
        </span>
        <button class="btn btn-ghost btn-icon btn-delete-fondo" data-id="${f.id}" title="Eliminar">✕</button>
      </div>
    `).join('');

    // Inline edit on monto
    list.querySelectorAll('.inline-edit-value').forEach(span => {
      span.addEventListener('click', () => startInlineEditFondo(span, card));
    });

    // Delete
    list.querySelectorAll('.btn-delete-fondo').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const f  = cfg.fondos_inversion.find(x => x.id === id);
        openConfirmModal({
          title:       'Eliminar instrumento',
          message:     `¿Eliminar "${f?.nombre}"? Esta acción no se puede deshacer.`,
          confirmText: 'Eliminar',
          onConfirm:   () => {
            const c = getConfig();
            c.fondos_inversion = c.fondos_inversion.filter(x => x.id !== id);
            saveConfig(c);
            closeModal();
            showToast('Instrumento eliminado', 'success');
            refreshFondos(card);
            refreshKPIs();
          },
        });
      });
    });
  }

  const sum = fondos.reduce((a, f) => a + (f.monto ?? 0), 0);
  total.innerHTML = `<span>Total fondos</span><strong>${formatMXN(sum)}</strong>`;
}

function startInlineEditFondo(span, card) {
  const id  = span.dataset.id;
  const cfg = getConfig();
  const f   = cfg.fondos_inversion.find(x => x.id === id);
  if (!f) return;

  const input = document.createElement('input');
  input.type  = 'number';
  input.className = 'inline-edit-input';
  input.value = f.monto;
  input.step  = '0.01';

  span.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const val = parseFloat(input.value);
    if (!isNaN(val)) {
      const c = getConfig();
      const fi = c.fondos_inversion.find(x => x.id === id);
      if (fi) fi.monto = val;
      saveConfig(c);
      refreshFondos(card);
      refreshKPIs();
    } else {
      refreshFondos(card);
    }
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { input.blur(); }
    if (e.key === 'Escape') { refreshFondos(card); }
  });
}

// =====================================================
// TABLA RESUMEN PROYECTOS ACTIVOS
// =====================================================
function renderProyectosResumen() {
  const wrap = document.createElement('div');
  wrap.className = 'card';

  const proyectos = (getCollection(KEYS.PROYECTOS) ?? [])
    .filter(p => p.estado === 'activo');

  wrap.innerHTML = `
    <div class="card-header">
      <h3 class="section-title" style="margin:0">Proyectos Activos</h3>
      <span class="badge badge-info">${proyectos.length} activo${proyectos.length !== 1 ? 's' : ''}</span>
    </div>
  `;

  if (proyectos.length === 0) {
    wrap.appendChild(emptyState({
      icon:        svgEmptyProjects(),
      title:       'Sin proyectos activos',
      desc:        'Crea tu primer proyecto en la pestaña Proyectos.',
      actionLabel: 'Ir a Proyectos',
      onAction:    () => navigateTo('proyectos'),
    }));
    return wrap;
  }

  const tableWrap = document.createElement('div');
  tableWrap.className = 'table-wrapper';
  tableWrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Proyecto</th>
          <th>Cliente</th>
          <th>Saldo caja</th>
          <th>Deuda pendiente</th>
          <th>% Avance</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody>
        ${proyectos.map(p => {
          const r    = calcResumenProyecto(p.id);
          const pct  = r.avancePct;
          const cls  = pct < 60 ? 'low' : pct < 85 ? 'medium' : 'high';
          const colorSaldo = r.saldoCaja >= 0 ? 'amount-positive' : 'amount-negative';
          return `
            <tr class="row-clickable" data-proyecto-id="${p.id}" title="Ver detalle">
              <td><strong>${p.nombre}</strong></td>
              <td class="text-muted">${p.cliente}</td>
              <td class="${colorSaldo}">${formatMXN(r.saldoCaja)}</td>
              <td class="${r.deudaPendiente > 0 ? 'text-warning' : 'text-muted'}">${formatMXN(r.deudaPendiente)}</td>
              <td style="min-width:140px">
                <div class="progress-label" style="margin-bottom:4px">
                  <strong style="font-size:12px">${pct.toFixed(1)}%</strong>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill ${cls}" style="width:${Math.min(pct,100)}%"></div>
                </div>
              </td>
              <td>${estadoBadge(p.estado)}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  // Click en fila → detalle
  tableWrap.querySelectorAll('.row-clickable').forEach(row => {
    row.addEventListener('click', () => navigateTo('detalle', row.dataset.proyectoId));
  });

  wrap.appendChild(tableWrap);
  return wrap;
}

// =====================================================
// REFRESCO PARCIAL — solo KPIs (sin re-renderizar todo)
// =====================================================
function refreshKPIs() {
  const saldoMifel     = calcSaldoMifel();
  const saldoGlobal    = calcSaldoGlobal();
  const comprometido   = calcDineroComprometido();
  const disponibleReal = calcDisponibleReal();

  const values = [saldoMifel, saldoGlobal, comprometido, disponibleReal];
  const dynamics = [true, true, false, true];

  document.querySelectorAll('.kpi-value').forEach((el, i) => {
    if (i >= values.length) return;
    el.textContent = formatMXN(values[i]);
    if (dynamics[i]) {
      el.className = `kpi-value ${values[i] >= 0 ? 'text-success' : 'text-danger'}`;
    }
  });
}

// =====================================================
// SVG placeholder
// =====================================================
function svgEmptyProjects() {
  return `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="28" width="20" height="28" rx="2" stroke="currentColor" stroke-width="2"/>
    <rect x="22" y="18" width="20" height="38" rx="2" stroke="currentColor" stroke-width="2"/>
    <rect x="36" y="22" width="20" height="34" rx="2" stroke="currentColor" stroke-width="2"/>
    <line x1="4" y1="56" x2="60" y2="56" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}
