/* =====================================================
   SOGRUB Bitácora — Vista: Proveedores (global)
   ===================================================== */
'use strict';

function renderProveedores() {
  const root = document.getElementById('proveedores-root');
  root.innerHTML = '';

  // ---- Header ----
  const header = document.createElement('div');
  header.className = 'mb-24';
  header.innerHTML = `
    <h2 class="view-title">Proveedores</h2>
    <p class="text-muted mt-4">Base de datos global de proveedores. Desde aquí puedes importarlos a cada proyecto.</p>
  `;
  root.appendChild(header);

  // ---- Toolbar ----
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar mb-20';
  toolbar.innerHTML = `
    <button class="btn btn-primary" id="btn-nuevo-prov">＋ Nuevo proveedor</button>
  `;
  toolbar.querySelector('#btn-nuevo-prov').addEventListener('click', () =>
    abrirModalProveedorGlobal());
  root.appendChild(toolbar);

  // ---- Lista ----
  const listWrap = document.createElement('div');
  listWrap.id = 'proveedores-list-wrap';
  root.appendChild(listWrap);

  refreshProveedoresList();
}

function refreshProveedoresList() {
  const wrap = document.getElementById('proveedores-list-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const proveedores = getCollection(KEYS.PROVEEDORES) ?? [];

  if (proveedores.length === 0) {
    wrap.appendChild(emptyState({
      icon:        svgEmptyProveedores(),
      title:       'Sin proveedores',
      desc:        'Agrega proveedores para usarlos en tus proyectos.',
      actionLabel: '＋ Nuevo proveedor',
      onAction:    () => abrirModalProveedorGlobal(),
    }));
    return;
  }

  const sorted = [...proveedores].sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? ''));

  const tableDiv = document.createElement('div');
  tableDiv.className = 'table-wrapper';
  tableDiv.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Nombre</th>
          <th>RFC</th>
          <th>Teléfono</th>
          <th>Email</th>
          <th>Total gastado</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(p => {
          const totalGastado = calcGastoGlobalProveedor(p.nombre);
          return `
            <tr>
              <td><strong>${p.nombre}</strong></td>
              <td class="text-muted">${p.rfc || '—'}</td>
              <td class="text-muted">${p.telefono || '—'}</td>
              <td class="text-muted">${p.email || '—'}</td>
              <td class="amount-negative font-mono">${totalGastado > 0 ? formatMXN(totalGastado) : '—'}</td>
              <td>
                <div class="td-actions">
                  <button class="btn btn-ghost btn-icon btn-ver-prov" data-nombre="${p.nombre}" title="Ver detalle">📊</button>
                  <button class="btn btn-ghost btn-icon btn-edit-prov" data-id="${p.id}" title="Editar">✏️</button>
                  <button class="btn btn-ghost btn-icon btn-del-prov" data-id="${p.id}" title="Eliminar">🗑️</button>
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  // Wire buttons
  tableDiv.querySelectorAll('.btn-edit-prov').forEach(btn => {
    btn.addEventListener('click', () => abrirModalProveedorGlobal(btn.dataset.id));
  });
  tableDiv.querySelectorAll('.btn-del-prov').forEach(btn => {
    btn.addEventListener('click', () => confirmarEliminarProveedorGlobal(btn.dataset.id));
  });
  tableDiv.querySelectorAll('.btn-ver-prov').forEach(btn => {
    btn.addEventListener('click', () => abrirModalDetalleProveedor(btn.dataset.nombre));
  });

  wrap.appendChild(tableDiv);
}

// =====================================================
// MODAL: NUEVO / EDITAR PROVEEDOR GLOBAL
// =====================================================
function abrirModalProveedorGlobal(id = null) {
  const prov   = id ? getItem(KEYS.PROVEEDORES, id) : null;
  const titulo = prov ? 'Editar proveedor' : 'Nuevo proveedor';

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="gp-nombre">Nombre</label>
      <input type="text" id="gp-nombre" class="form-input" placeholder="Nombre del proveedor"
        value="${prov?.nombre ?? ''}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="gp-rfc">RFC <span class="text-dim">(opcional)</span></label>
        <input type="text" id="gp-rfc" class="form-input" placeholder="RFC del proveedor"
          value="${prov?.rfc ?? ''}">
      </div>
      <div class="form-group">
        <label class="form-label" for="gp-telefono">Teléfono <span class="text-dim">(opcional)</span></label>
        <input type="text" id="gp-telefono" class="form-input" placeholder="Teléfono"
          value="${prov?.telefono ?? ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="gp-email">Email <span class="text-dim">(opcional)</span></label>
      <input type="email" id="gp-email" class="form-input" placeholder="correo@ejemplo.com"
        value="${prov?.email ?? ''}">
    </div>
    <div class="form-group">
      <label class="form-label" for="gp-notas">Notas <span class="text-dim">(opcional)</span></label>
      <textarea id="gp-notas" class="form-textarea" style="min-height:60px" placeholder="Notas adicionales">${prov?.notas ?? ''}</textarea>
    </div>
  `;

  openModal({
    title: titulo,
    body,
    confirmText: prov ? 'Guardar cambios' : 'Agregar proveedor',
    onConfirm: () => {
      const nombre   = body.querySelector('#gp-nombre').value.trim();
      const rfc      = body.querySelector('#gp-rfc').value.trim();
      const telefono = body.querySelector('#gp-telefono').value.trim();
      const email    = body.querySelector('#gp-email').value.trim();
      const notas    = body.querySelector('#gp-notas').value.trim();

      const valid = validateFields([
        { el: body.querySelector('#gp-nombre'), msg: 'Escribe el nombre del proveedor' },
      ]);
      if (!valid) return;

      if (prov) {
        updateItem(KEYS.PROVEEDORES, id, { nombre, rfc, telefono, email, notas });
        showToast('Proveedor actualizado', 'success');
      } else {
        addItem(KEYS.PROVEEDORES, { nombre, rfc, telefono, email, notas });
        showToast(`Proveedor "${nombre}" agregado`, 'success');
      }

      closeModal();
      refreshProveedoresList();
    },
  });
}

// =====================================================
// MODAL: DETALLE PROVEEDOR — gasto por proyecto
// =====================================================
function abrirModalDetalleProveedor(nombre) {
  const porProyecto = calcGastoProveedorPorProyecto(nombre);
  const total       = calcGastoGlobalProveedor(nombre);

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--surface2);border-radius:var(--radius-md);border:1px solid var(--border)">
      <span class="text-muted">Total gastado</span>
      <strong class="amount-negative" style="font-size:18px">${formatMXN(total)}</strong>
    </div>
    <h4 style="font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-top:8px">Desglose por proyecto</h4>
    ${renderBarChart(porProyecto)}
  `;

  openModal({
    title: nombre,
    body,
    confirmText: 'Cerrar',
    onConfirm: () => closeModal(),
    large: true,
  });
}

// =====================================================
// ELIMINAR PROVEEDOR GLOBAL
// =====================================================
function confirmarEliminarProveedorGlobal(id) {
  const prov = getItem(KEYS.PROVEEDORES, id);
  openConfirmModal({
    title:       'Eliminar proveedor',
    message:     `¿Eliminar "${prov?.nombre ?? 'este proveedor'}"? No afectará los movimientos existentes.`,
    confirmText: 'Eliminar',
    onConfirm:   () => {
      deleteItem(KEYS.PROVEEDORES, id);
      closeModal();
      showToast('Proveedor eliminado', 'success');
      refreshProveedoresList();
    },
  });
}

// =====================================================
// SVG placeholder
// =====================================================
function svgEmptyProveedores() {
  return `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="22" cy="22" r="8" stroke="currentColor" stroke-width="2"/>
    <path d="M10 44c0-6.627 5.373-12 12-12s12 5.373 12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <circle cx="42" cy="22" r="6" stroke="currentColor" stroke-width="2"/>
    <path d="M34 44c0-4.418 3.582-8 8-8s8 3.582 8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="8" y1="54" x2="56" y2="54" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}
