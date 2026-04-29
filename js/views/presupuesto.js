/* =====================================================
   SOGRUB Bitácora — Módulo Presupuesto OPUS
   Lector del catálogo unificado en /shared/catalogos/{obraId}.
   El catálogo lo escribe app-estimaciones; bitácora solo lee y compara
   contra el gasto real registrado por proyecto.
   ===================================================== */
'use strict';

// =====================================================
// SUSCRIPCIÓN — /shared/catalogos/{obraId} resolviendo proyectoId via obraLinks
// =====================================================

const _presCache     = {};   // { [proyectoId]: { meta, conceptos } | null }
const _presListeners = {};   // { [proyectoId]: { ref, handler, obraId } | '__no_pareo__' }

async function subscribePresupuesto(proyectoId, onChange) {
  if (_presListeners[proyectoId]) return;

  // 1) Resolver proyectoId → obraId via obraLinks. Lectura única (no hot path).
  let obraId = null;
  try {
    const linksSnap = await _dbRef('/shared/obraLinks').get();
    const links = linksSnap.val() || {};
    obraId = Object.entries(links).find(([, pid]) => pid === proyectoId)?.[0] || null;
  } catch (err) {
    console.warn('[Presupuesto] No se pudo leer /shared/obraLinks:', err);
  }

  if (!obraId) {
    _presCache[proyectoId] = null;
    _presListeners[proyectoId] = '__no_pareo__';
    onChange?.();
    return;
  }

  // 2) Suscribir al catálogo compartido. Cada cambio se transforma al shape
  //    histórico de bitácora antes de exponerlo al UI.
  const ref = _dbRef(`/shared/catalogos/${obraId}`);
  const handler = ref.on('value', snap => {
    const data = snap.val();
    _presCache[proyectoId] = data ? _sharedToBitacoraShape(data) : null;
    onChange?.();
  });
  _presListeners[proyectoId] = { ref, handler, obraId };
}

function getPresupuesto(proyectoId) {
  return _presCache[proyectoId] || null;
}

// Adapta el shape de /shared al que esperan _buildTablaComparacion y
// buildGastoDesgloseSection (heredado del importador legacy).
//   · /shared usa `tipo: 'precio_unitario' | 'agrupador'`, bitácora histórica
//     usaba `tipo: 'concepto' | 'agrupador'`. Mapeamos el primero.
//   · `path`/`agrupadores` venían como `[{clave, descripcion}]` en /shared.
//     Bitácora usa array de strings (descripción). Aplanamos.
//   · Conceptos archivados se incluyen para que gastos históricos no queden
//     huérfanos visualmente.
function _sharedToBitacoraShape(shared) {
  const conceptosObj = shared.conceptos || {};
  const conceptos = Object.entries(conceptosObj)
    .map(([id, c]) => ({
      id,
      tipo: c.tipo === 'precio_unitario' ? 'concepto' : c.tipo,
      clave: c.clave || '',
      descripcion: c.descripcion || '',
      unidad: c.unidad || '',
      cantidad: Number(c.cantidad) || 0,
      precio_unitario: Number(c.precio_unitario) || 0,
      total: Number(c.total) || 0,
      nivel: Number(c.nivel) || 0,
      path: (c.path || []).map(p => typeof p === 'string' ? p : (p?.descripcion || '')),
      agrupadores: (c.agrupadores || []).map(a => typeof a === 'string' ? a : (a?.descripcion || '')),
      orden: Number(c.orden) || 0,
      archivado: !!c.archivado
    }))
    .sort((a, b) => a.orden - b.orden);

  // Total = suma de agrupadores raíz si existen, si no Σ PUs (ambos deberían cuadrar)
  const total = conceptos
    .filter(c => c.tipo === 'agrupador' && c.nivel === 0 && !c.archivado)
    .reduce((s, c) => s + c.total, 0)
    || conceptos.filter(c => c.tipo === 'concepto' && !c.archivado).reduce((s, c) => s + c.total, 0);

  return {
    meta: {
      version: shared.meta?.version || 1,
      fecha: shared.meta?.importedAt
        ? new Date(shared.meta.importedAt).toISOString().slice(0, 10)
        : '',
      archivo: shared.meta?.sourceFileName || '(desde Estimaciones)',
      total,
      readonly: true
    },
    conceptos
  };
}

// =====================================================
// CÁLCULO — Gasto real ligado a conceptos
// =====================================================

function _gastoRealPorConcepto(proyectoId) {
  const map = {};
  for (const mov of (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])) {
    if (mov.proyecto_id !== proyectoId || mov.tipo !== 'gasto') continue;
    for (const d of (mov.desglose_presupuesto ?? [])) {
      map[d.concepto_id] = (map[d.concepto_id] || 0) + d.importe;
    }
  }
  return map;
}

// =====================================================
// ESTADO UI
// =====================================================

const _presState = {
  collapsed: new Set()  // descripciones de agrupadores colapsados
};

// =====================================================
// ENTRY POINT — llamado desde renderDetalle
// =====================================================

function renderPresupuestoTab(proyectoId) {
  const wrap = document.getElementById('presupuesto-tab-wrap');
  if (!wrap) return;

  subscribePresupuesto(proyectoId, () => _renderPresContenido(proyectoId));
  _renderPresContenido(proyectoId);
}

function _renderPresContenido(proyectoId) {
  const wrap = document.getElementById('presupuesto-tab-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const pres = getPresupuesto(proyectoId);
  if (!pres?.conceptos?.length) {
    wrap.appendChild(_buildEmptyState(proyectoId));
    return;
  }

  // Barra de info — solo lectura. El catálogo lo administra Estimaciones.
  const bar = document.createElement('div');
  bar.className = 'toolbar mb-16';
  bar.innerHTML = `
    <span class="text-sm text-muted">
      v${pres.meta.version} &nbsp;·&nbsp; ${pres.meta.archivo}
      ${pres.meta.fecha ? ' &nbsp;·&nbsp; ' + formatDate(pres.meta.fecha) : ''}
    </span>
    <div class="toolbar-spacer"></div>
    <span class="text-sm" style="font-weight:600;color:var(--accent)">
      ${formatMXN(pres.meta.total)} presupuestado
    </span>
    <span class="text-sm text-muted" style="font-size:11px;margin-left:8px"
      title="El catálogo lo administra la app de Estimaciones. Cualquier cambio (re-import, jerarquía) se hace allá y se refleja aquí automáticamente.">
      🔒 solo lectura
    </span>
  `;
  wrap.appendChild(bar);

  wrap.appendChild(_buildTablaComparacion(proyectoId, pres));
}

// =====================================================
// EMPTY STATE — sin pareo o sin catálogo importado
// =====================================================

function _buildEmptyState(proyectoId) {
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;flex-direction:column;align-items:center;padding:64px 20px;gap:14px';

  const listener = _presListeners[proyectoId];
  const noPareo = listener === '__no_pareo__';

  if (noPareo) {
    div.innerHTML = `
      <div style="font-size:52px">🔗</div>
      <h3 style="margin:0;font-size:18px">Proyecto sin obra pareada</h3>
      <p class="text-muted text-sm" style="text-align:center;margin:0;max-width:380px">
        Este proyecto contable todavía no está vinculado con una obra de la app de Estimaciones.<br>
        El admin puede pareárlo en Estimaciones &rarr; Admin &rarr; Vincular obras ↔ proyectos.
      </p>
    `;
  } else {
    div.innerHTML = `
      <div style="font-size:52px">📋</div>
      <h3 style="margin:0;font-size:18px">Sin catálogo OPUS</h3>
      <p class="text-muted text-sm" style="text-align:center;margin:0;max-width:380px">
        El ingeniero todavía no importa el catálogo OPUS para esta obra.<br>
        Una vez importado en Estimaciones, aparecerá aquí automáticamente.
      </p>
    `;
  }
  return div;
}

// =====================================================
// TABLA DE COMPARACIÓN — Presupuestado vs. Real (solo lectura)
// =====================================================

function _buildTablaComparacion(proyectoId, pres) {
  const gastoMap  = _gastoRealPorConcepto(proyectoId);
  const conceptos = pres.conceptos;

  // Gasto real acumulado por agrupador (sumando sus PUs)
  function calcAgrGasto() {
    const ag = {};
    for (const item of conceptos) {
      if (item.tipo !== 'concepto') continue;
      const g = gastoMap[item.id] || 0;
      for (const a of (item.agrupadores ?? [])) {
        ag[a] = (ag[a] || 0) + g;
      }
    }
    return ag;
  }

  const wrap = document.createElement('div');
  wrap.className = 'card';
  wrap.style.cssText = 'padding:0;overflow:hidden';

  const cols = '1fr 150px 150px 90px';

  const hdr = document.createElement('div');
  hdr.style.cssText = `
    display:grid;grid-template-columns:${cols};
    padding:9px 16px;font-size:11px;font-weight:700;
    color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;
    border-bottom:1px solid var(--border);background:var(--surface2);
  `;
  hdr.innerHTML = `
    <span>Concepto</span>
    <span style="text-align:right">Presupuestado</span>
    <span style="text-align:right">Gastado real</span>
    <span style="text-align:right">% Ejercido</span>
  `;
  wrap.appendChild(hdr);

  const tbody = document.createElement('div');
  wrap.appendChild(tbody);

  function renderRows() {
    tbody.innerHTML = '';
    const agrGasto = calcAgrGasto();

    for (const item of conceptos) {
      const ancestros = item.tipo === 'agrupador'
        ? (item.path ?? []).slice(0, -1)
        : (item.agrupadores ?? []);
      if (ancestros.some(a => _presState.collapsed.has(a))) continue;

      const row    = document.createElement('div');
      const indent = 16 + item.nivel * 18;
      row.style.cssText = `
        display:grid;grid-template-columns:${cols};
        border-bottom:1px solid var(--border);align-items:center;
      `;

      if (item.tipo === 'agrupador') {
        const g      = agrGasto[item.descripcion] || 0;
        const pct    = item.total > 0 ? (g / item.total * 100) : 0;
        const col    = g > item.total ? 'var(--danger)' : g > 0 ? 'var(--success)' : 'var(--text-muted)';
        const isOpen = !_presState.collapsed.has(item.descripcion);
        const bg     = item.nivel === 0
          ? 'rgba(26,159,212,.07)'
          : item.nivel === 1 ? 'var(--surface2)' : 'var(--surface)';

        row.style.background = bg;
        row.style.padding = `9px 16px 9px ${indent}px`;
        row.style.cursor = 'pointer';

        const nameCell = document.createElement('span');
        nameCell.style.cssText = `font-weight:600;font-size:${Math.max(12, 14 - item.nivel)}px;display:flex;align-items:center;gap:7px`;
        nameCell.innerHTML = `
          <span style="color:var(--text-muted);font-size:10px;display:inline-block;
            transition:transform .18s;transform:rotate(${isOpen ? 0 : -90}deg)">▼</span>
          ${item.descripcion}
        `;
        nameCell.style.cursor = 'pointer';
        nameCell.addEventListener('click', () => {
          _presState.collapsed.has(item.descripcion)
            ? _presState.collapsed.delete(item.descripcion)
            : _presState.collapsed.add(item.descripcion);
          renderRows();
        });

        row.appendChild(nameCell);
        row.insertAdjacentHTML('beforeend', `
          <span style="text-align:right;font-weight:600;padding-right:16px">${formatMXN(item.total)}</span>
          <span style="text-align:right;font-weight:600;color:${col};padding-right:16px">${g > 0 ? formatMXN(g) : '—'}</span>
          <span style="text-align:right;font-weight:600;color:${col};padding-right:16px">${g > 0 ? pct.toFixed(0) + '%' : '—'}</span>
        `);

        row.addEventListener('mouseenter', () => row.style.filter = 'brightness(1.07)');
        row.addEventListener('mouseleave', () => row.style.filter = '');

      } else {
        const g    = gastoMap[item.id] || 0;
        const pct  = item.total > 0 ? (g / item.total * 100) : 0;
        const col  = g > item.total ? 'var(--danger)' : g > 0 ? 'var(--success)' : 'var(--text-muted)';
        const desc = item.descripcion.length > 90
          ? item.descripcion.slice(0, 90) + '…'
          : item.descripcion;
        const archBadge = item.archivado
          ? '<span class="text-muted" style="font-size:10px;margin-left:6px;padding:1px 5px;border-radius:3px;background:rgba(255,193,7,.15);color:#ffc107">archivado</span>'
          : '';

        row.style.background = item.archivado ? 'rgba(255,193,7,.04)' : 'var(--surface)';
        row.style.padding = `7px 16px 7px ${indent}px`;
        row.insertAdjacentHTML('beforeend', `
          <span style="font-size:13px;line-height:1.4">
            ${item.clave ? `<span class="text-muted" style="font-size:11px;font-family:monospace;margin-right:5px">${item.clave}</span>` : ''}
            ${desc}
            <span class="text-muted" style="font-size:11px;margin-left:4px">${item.cantidad} ${item.unidad}</span>
            ${archBadge}
          </span>
          <span style="text-align:right;font-size:13px;padding-right:16px">${formatMXN(item.total)}</span>
          <span style="text-align:right;font-size:13px;color:${col};padding-right:16px">${g > 0 ? formatMXN(g) : '—'}</span>
          <span style="text-align:right;font-size:13px;font-weight:${g > 0 ? 600 : 400};color:${col};padding-right:16px">
            ${g > 0 ? pct.toFixed(0) + '%' : '—'}
          </span>
        `);
      }

      tbody.appendChild(row);
    }
  }

  renderRows();
  return wrap;
}

// =====================================================
// SECCIÓN DESGLOSE EN MODAL DE GASTO
// Llamada desde detalle.js al abrir el modal de gasto.
// Devuelve un elemento DOM con _getDesglose() expuesto.
// =====================================================

function buildGastoDesgloseSection(proyectoId, existingDesglose = []) {
  const pres = getPresupuesto(proyectoId);
  if (!pres?.conceptos?.length) return null;

  // Solo PUs activos (no archivados) en el buscador.
  const conceptos = pres.conceptos.filter(c => c.tipo === 'concepto' && !c.archivado);

  // Para resolver desgloses históricos, usamos TODOS los conceptos (incluso archivados)
  // y además aceptamos lookups por concepto_id que ya no exista en el catálogo (huérfano).
  const conceptosAll = pres.conceptos;

  // Estado interno: array mutable de líneas
  const lineas = [];
  for (const d of existingDesglose) {
    const c = conceptosAll.find(x => x.id === d.concepto_id);
    if (c) {
      lineas.push({ concepto_id: c.id, descripcion: c.descripcion, clave: c.clave, importe: d.importe });
    } else {
      // Huérfano: el concepto referenciado ya no está en el catálogo. Mostrar visible
      // para que el contador pueda corregir manualmente (re-asignar a otro concepto).
      lineas.push({
        concepto_id: d.concepto_id,
        descripcion: '(concepto no encontrado en catálogo actual)',
        clave: d.concepto_id?.slice(0, 12) || '',
        importe: d.importe,
        huerfano: true
      });
    }
  }

  // ---- Sección contenedor ----
  const section = document.createElement('div');
  section.id = 'pm-desglose-pres';
  section.style.cssText = 'border:1px solid var(--border);border-radius:8px;overflow:visible';

  // ---- Header colapsable ----
  const hdr = document.createElement('div');
  hdr.style.cssText = `
    display:flex;align-items:center;justify-content:space-between;
    padding:10px 14px;background:var(--surface2);cursor:pointer;
    border-radius:8px 8px 0 0;
  `;
  hdr.innerHTML = `
    <span style="font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px">
      <span id="pres-desg-arrow" style="font-size:10px;color:var(--text-muted);display:inline-block;transition:transform .18s">▼</span>
      Distribuir a concepto de OPUS
      <span style="font-size:11px;font-weight:400;color:var(--text-muted)">(opcional)</span>
    </span>
    <span id="pres-desg-summary" style="font-size:12px"></span>
  `;
  section.appendChild(hdr);

  // ---- Cuerpo ----
  const body = document.createElement('div');
  body.style.cssText = 'padding:12px 14px;display:flex;flex-direction:column;gap:10px;border-top:1px solid var(--border)';
  section.appendChild(body);

  // Toggle colapso
  let expanded = lineas.length > 0;
  function applyExpanded() {
    body.style.display = expanded ? 'flex' : 'none';
    hdr.querySelector('#pres-desg-arrow').style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
  }
  hdr.addEventListener('click', () => { expanded = !expanded; applyExpanded(); });
  applyExpanded();

  // ---- Buscador de conceptos ----
  const searchRow = document.createElement('div');
  searchRow.style.cssText = 'display:flex;gap:6px;align-items:flex-start';
  const uid = 'pdes-' + Math.random().toString(36).slice(2);
  searchRow.innerHTML = `
    <div style="flex:1;position:relative">
      <input type="text" id="${uid}" class="form-input"
        placeholder="Buscar concepto por clave o descripción…"
        autocomplete="off" style="font-size:12px">
      <div id="${uid}-drop" style="
        display:none;position:absolute;left:0;right:0;top:calc(100% + 2px);
        background:var(--surface);border:1px solid var(--border);border-radius:6px;
        max-height:200px;overflow-y:auto;z-index:400;box-shadow:0 8px 24px rgba(0,0,0,.5)
      "></div>
    </div>
    <button type="button" id="${uid}-add" class="btn btn-secondary btn-sm" style="white-space:nowrap;flex-shrink:0">
      + Agregar
    </button>
  `;
  body.appendChild(searchRow);

  const input    = searchRow.querySelector(`#${uid}`);
  const dropdown = searchRow.querySelector(`#${uid}-drop`);
  const addBtn   = searchRow.querySelector(`#${uid}-add`);
  let _sel       = null;

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    dropdown.innerHTML = '';
    if (q.length < 2) { dropdown.style.display = 'none'; _sel = null; return; }

    const matches = conceptos
      .filter(c => c.descripcion.toLowerCase().includes(q) || c.clave.toLowerCase().includes(q))
      .slice(0, 12);

    if (!matches.length) {
      dropdown.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:var(--text-muted)">Sin resultados</div>';
    } else {
      matches.forEach(c => {
        const opt = document.createElement('div');
        opt.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--border)';
        const path = c.agrupadores.slice(-2).join(' › ');
        opt.innerHTML = `
          <div style="font-weight:500;line-height:1.3">${c.descripcion.length > 65 ? c.descripcion.slice(0,65)+'…' : c.descripcion}</div>
          <div style="color:var(--text-muted);font-size:11px;margin-top:2px">${c.clave}${path ? ' · ' + path : ''}</div>
        `;
        opt.addEventListener('mouseenter', () => opt.style.background = 'var(--surface2)');
        opt.addEventListener('mouseleave', () => opt.style.background = '');
        opt.addEventListener('mousedown', e => {
          e.preventDefault();
          _sel = c;
          input.value = (c.clave ? c.clave + ' — ' : '') + c.descripcion.slice(0, 55);
          dropdown.style.display = 'none';
        });
        dropdown.appendChild(opt);
      });
    }
    dropdown.style.display = 'block';
    _sel = null;
  });

  document.addEventListener('click', e => {
    if (!searchRow.contains(e.target)) dropdown.style.display = 'none';
  }, { passive: true });

  // ---- Contenedor de líneas ----
  const linesWrap = document.createElement('div');
  linesWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  body.appendChild(linesWrap);

  // ---- Pie: total distribuido ----
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:flex-end;padding-top:4px;font-size:12px;color:var(--text-muted)';
  body.appendChild(footer);

  function updateSummary() {
    const total = lineas.reduce((s, l) => s + (l.importe || 0), 0);
    const summEl = hdr.querySelector('#pres-desg-summary');
    footer.textContent = '';
    if (total > 0) {
      summEl.innerHTML  = `<span style="color:var(--accent);font-weight:600">${formatMXN(total)} distribuido</span>`;
      footer.innerHTML  = `Total distribuido: <strong style="color:var(--accent);margin-left:6px">${formatMXN(total)}</strong>`;
    } else {
      summEl.textContent = '';
    }
  }

  function renderLines() {
    linesWrap.innerHTML = '';

    if (!lineas.length) {
      linesWrap.innerHTML = '<p class="text-muted" style="margin:0;font-size:12px;font-style:italic">Sin líneas — agrega conceptos arriba.</p>';
      updateSummary();
      return;
    }

    lineas.forEach((linea, i) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 110px 28px;gap:6px;align-items:center';
      const huerfanoBadge = linea.huerfano
        ? '<span style="color:#ffc107;font-size:10px;font-weight:600;margin-left:4px">⚠ huérfano</span>'
        : '';
      row.innerHTML = `
        <div style="min-width:0">
          <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
            title="${linea.descripcion}">${linea.descripcion.length > 60 ? linea.descripcion.slice(0,60)+'…' : linea.descripcion}${huerfanoBadge}</div>
          <div style="font-size:11px;color:var(--text-muted)">${linea.clave}</div>
        </div>
        <input type="number" class="form-input pdes-importe" data-idx="${i}"
          value="${linea.importe > 0 ? linea.importe.toFixed(2) : ''}"
          placeholder="0.00" min="0.01" step="0.01"
          style="font-size:12px;text-align:right;padding:5px 8px">
        <button type="button" class="pdes-del" data-idx="${i}"
          style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:18px;line-height:1;padding:2px 4px">×</button>
      `;
      linesWrap.appendChild(row);
    });

    linesWrap.querySelectorAll('.pdes-importe').forEach(inp => {
      inp.addEventListener('input', () => {
        lineas[+inp.dataset.idx].importe = parseFloat(inp.value) || 0;
        updateSummary();
      });
      inp.addEventListener('focus', () => inp.select());
    });

    linesWrap.querySelectorAll('.pdes-del').forEach(btn => {
      btn.addEventListener('click', () => {
        lineas.splice(+btn.dataset.idx, 1);
        renderLines();
      });
    });

    updateSummary();
  }

  addBtn.addEventListener('click', () => {
    if (!_sel) { showToast('Busca y selecciona un concepto primero', 'warning'); return; }
    if (lineas.some(l => l.concepto_id === _sel.id)) {
      showToast('Este concepto ya está en la distribución', 'warning'); return;
    }
    lineas.push({ concepto_id: _sel.id, descripcion: _sel.descripcion, clave: _sel.clave, importe: 0 });
    _sel = null;
    input.value = '';
    dropdown.style.display = 'none';
    renderLines();
    setTimeout(() => {
      const imps = linesWrap.querySelectorAll('.pdes-importe');
      imps[imps.length - 1]?.focus();
    }, 0);
  });

  renderLines();

  section._getDesglose = () =>
    lineas.filter(l => l.importe > 0).map(l => ({ concepto_id: l.concepto_id, importe: l.importe }));

  return section;
}
