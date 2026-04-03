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
  const resumen          = calcResumenProveedorPorProyecto(nombre);
  const total            = resumen.reduce((a, r) => a + r.total, 0);
  const totalFacturado   = resumen.reduce((a, r) => a + r.totalFacturado, 0);
  const maxVal           = resumen.length > 0 ? Math.max(...resumen.map(r => r.total)) : 1;
  const colors           = ['#1a9fd4', '#4caf82', '#e0a752', '#e05252', '#9b59b6', '#3498db', '#e67e22', '#1abc9c'];

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div style="display:flex;gap:12px">
      <div style="flex:1;padding:12px 16px;background:var(--surface2);border-radius:var(--radius-md);border:1px solid var(--border)">
        <div class="text-muted" style="font-size:11px;margin-bottom:4px">Total gastado</div>
        <strong class="amount-negative" style="font-size:18px">${formatMXN(total)}</strong>
      </div>
      <div style="flex:1;padding:12px 16px;background:var(--surface2);border-radius:var(--radius-md);border:1px solid var(--border)">
        <div class="text-muted" style="font-size:11px;margin-bottom:4px">Verificado con facturas</div>
        <strong style="font-size:18px;color:var(--success)">${formatMXN(totalFacturado)}</strong>
      </div>
    </div>
    <h4 style="font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-top:4px">Desglose por proyecto</h4>
    <div class="bar-chart">
      ${resumen.map((r, i) => {
        const pct      = maxVal > 0 ? (r.total / maxVal) * 100 : 0;
        const pctTotal = total > 0 ? ((r.total / total) * 100).toFixed(1) : '0';
        const color    = colors[i % colors.length];
        const tieneFacturas = !!(r.totalFacturado > 0);
        return `
          <div class="bar-chart-row" style="flex-wrap:nowrap;gap:6px;align-items:center">
            <span class="bar-chart-label" style="min-width:0;flex:0 0 auto;max-width:140px;overflow:hidden;text-overflow:ellipsis">${r.nombre}</span>
            <div class="bar-chart-track" style="flex:1">
              <div class="bar-chart-fill" style="width:${pct}%;background:${color}"></div>
            </div>
            <span class="bar-chart-value" style="flex:0 0 auto;white-space:nowrap">${formatMXN(r.total)} <span class="text-dim">(${pctTotal}%)</span></span>
            <button class="btn btn-secondary btn-sm" data-idx="${i}"
              style="flex:0 0 auto;white-space:nowrap;font-size:10px;padding:3px 8px"
              title="Descargar facturas de ${r.nombre}"
              ${!tieneFacturas ? 'disabled title="Sin facturas en Drive"' : ''}>
              ⬇ ZIP
            </button>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Botón descargar todo
  const hayFacturas = resumen.some(r => r.totalFacturado > 0);
  if (hayFacturas) {
    const dlAllBtn = document.createElement('button');
    dlAllBtn.className = 'btn btn-primary btn-sm';
    dlAllBtn.style.cssText = 'margin-top:4px;font-size:12px;align-self:flex-start';
    dlAllBtn.textContent = '⬇ Descargar todas las facturas (ZIP)';
    body.appendChild(dlAllBtn);
    dlAllBtn.addEventListener('click', () => descargarTodasFacturasProveedor(nombre, resumen, dlAllBtn));
  }

  // Cablear botones de descarga por proyecto
  body.querySelectorAll('[data-idx]').forEach(btn => {
    const r = resumen[parseInt(btn.dataset.idx)];
    if (r) btn.addEventListener('click', () => descargarFacturasProyecto(nombre, r.proyectoId, r.nombre, btn));
  });

  openModal({
    title: nombre,
    body,
    confirmText: 'Cerrar',
    onConfirm: () => closeModal(),
    large: true,
  });
}

// =====================================================
// DESCARGA ZIP: facturas de un proveedor en un proyecto
// =====================================================
async function descargarFacturasProyecto(proveedorNombre, proyectoId, proyectoNombre, btnEl) {
  if (!window.JSZip) return showToast('JSZip no disponible, recarga la página', 'error');

  const gastos = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.tipo === 'gasto' && m.subcontratista === proveedorNombre && m.proyecto_id === proyectoId)
    .filter(m => m.factura_drive_id || m.factura_xml_id);

  if (gastos.length === 0) return showToast('Sin facturas en Drive para este proyecto', 'warning');

  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }

  try {
    const token = await driveGetToken();
    const zip   = new window.JSZip();
    const carpeta = zip.folder(_zipSafeName(proyectoNombre));
    let ok = 0, errors = 0;

    for (const g of gastos) {
      const base = (g.concepto ?? 'factura').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'factura';

      if (g.factura_drive_id) {
        try {
          const blob = await _driveDownloadBlob(g.factura_drive_id, token);
          const ext  = (g.factura_nombre ?? 'pdf').split('.').pop().toLowerCase();
          carpeta.file(`${base}.${ext}`, blob);
          ok++;
        } catch (e) { console.warn('[ZIP PDF]', e.message); errors++; }
      }

      if (g.factura_xml_id) {
        try {
          const blob    = await _driveDownloadBlob(g.factura_xml_id, token);
          const xmlName = g.factura_xml_nombre ?? `${base}.xml`;
          carpeta.file(xmlName, blob);
          ok++;
        } catch (e) { console.warn('[ZIP XML]', e.message); errors++; }
      }
    }

    if (ok === 0) throw new Error('No se pudo descargar ningún archivo');

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a   = document.createElement('a');
    a.href    = url;
    a.download = `Facturas-${_zipSafeName(proyectoNombre)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(errors > 0
      ? `ZIP descargado — ${ok} archivos (${errors} errores)`
      : `ZIP descargado con ${ok} archivos`, 'success');
  } catch (err) {
    console.error('[ZIP]', err);
    showToast('Error al generar ZIP: ' + err.message, 'error');
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '⬇ ZIP'; }
  }
}

async function _driveDownloadBlob(fileId, token) {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Drive ${resp.status}: ${text.substring(0, 120)}`);
  }
  return resp.blob();
}

function _zipSafeName(str) {
  return (str ?? 'proyecto').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, '_').trim() || 'proyecto';
}

// =====================================================
// DESCARGA ZIP GLOBAL: todas las facturas del proveedor
// =====================================================
async function descargarTodasFacturasProveedor(proveedorNombre, resumen, btnEl) {
  if (!window.JSZip) return showToast('JSZip no disponible, recarga la página', 'error');

  const proyectosConFacturas = resumen.filter(r => r.totalFacturado > 0);
  if (proyectosConFacturas.length === 0) return showToast('Sin facturas en Drive', 'warning');

  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }

  try {
    const token = await driveGetToken();
    const zip   = new window.JSZip();
    let totalOk = 0, totalErr = 0;

    for (const r of proyectosConFacturas) {
      const gastos = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
        .filter(m => m.tipo === 'gasto' && m.subcontratista === proveedorNombre && m.proyecto_id === r.proyectoId)
        .filter(m => m.factura_drive_id || m.factura_xml_id);

      if (gastos.length === 0) continue;
      const carpeta = zip.folder(_zipSafeName(r.nombre));

      for (const g of gastos) {
        const base = (g.concepto ?? 'factura').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'factura';

        if (g.factura_drive_id) {
          try {
            const blob = await _driveDownloadBlob(g.factura_drive_id, token);
            const ext  = (g.factura_nombre ?? 'pdf').split('.').pop().toLowerCase();
            carpeta.file(`${base}.${ext}`, blob);
            totalOk++;
          } catch (e) { console.warn('[ZIP-all PDF]', e.message); totalErr++; }
        }
        if (g.factura_xml_id) {
          try {
            const blob    = await _driveDownloadBlob(g.factura_xml_id, token);
            const xmlName = g.factura_xml_nombre ?? `${base}.xml`;
            carpeta.file(xmlName, blob);
            totalOk++;
          } catch (e) { console.warn('[ZIP-all XML]', e.message); totalErr++; }
        }
      }
    }

    if (totalOk === 0) throw new Error('No se pudo descargar ningún archivo');

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a   = document.createElement('a');
    a.href    = url;
    a.download = `Facturas-${_zipSafeName(proveedorNombre)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(totalErr > 0
      ? `ZIP descargado — ${totalOk} archivos (${totalErr} errores)`
      : `ZIP descargado con ${totalOk} archivos de ${proyectosConFacturas.length} proyecto(s)`, 'success');
  } catch (err) {
    console.error('[ZIP-all]', err);
    showToast('Error al generar ZIP: ' + err.message, 'error');
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = '⬇ Descargar todas las facturas (ZIP)'; }
  }
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
