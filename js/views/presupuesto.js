/* =====================================================
   SOGRUB Bitácora — Módulo Presupuesto OPUS
   Parser XLS, almacenamiento Firebase, comparación
   Presupuestado vs. Gastado Real por concepto
   ===================================================== */
'use strict';

// =====================================================
// FIREBASE — nodo independiente por proyecto
// sogrub_presupuestos/{proyectoId}/{ meta, conceptos }
// =====================================================

const _presCache     = {};   // { [proyectoId]: { meta, conceptos } | null }
const _presListeners = {};   // { [proyectoId]: Firebase listener ref }

function subscribePresupuesto(proyectoId, onChange) {
  if (_presListeners[proyectoId]) return;
  const ref = _dbRef(`sogrub_presupuestos/${proyectoId}`);
  _presListeners[proyectoId] = ref.on('value', snap => {
    _presCache[proyectoId] = snap.val() || null;
    onChange?.();
  });
}

function getPresupuesto(proyectoId) {
  return _presCache[proyectoId] || null;
}

function savePresupuesto(proyectoId, data) {
  _presCache[proyectoId] = data;
  return _dbRef(`sogrub_presupuestos/${proyectoId}`).set(data);
}

// =====================================================
// PARSER — XLS de OPUS a estructura jerárquica
//
// Algoritmo de inferencia de niveles:
//   Cada agrupador descuenta su total del "rem" (remaining)
//   del padre. Cuando rem ≈ 0 el padre se considera cerrado
//   y se saca del stack. Así determinamos a qué nivel
//   pertenece cada agrupador / concepto sin marcas explícitas.
// =====================================================

function parseOpusXLS(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb  = XLSX.read(e.target.result, { type: 'binary' });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        resolve(_inferirJerarquia(raw));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

function _inferirJerarquia(rawRows) {
  const EPS    = 15;   // tolerancia de redondeo en totales OPUS (pesos)
  const stack  = [];   // { desc, total, rem, nivel }
  const result = [];
  let lastWasAgrupador = false;

  for (let i = 1; i < rawRows.length; i++) {
    const row    = rawRows[i];
    const tipo   = (row[0] ?? '').toString().trim();
    const clave  = (row[1] ?? '').toString().trim();
    const desc   = (row[2] ?? '').toString().trim();
    const unidad = (row[3] ?? '').toString().trim();
    const cant   = parseFloat(row[4]) || 0;
    const pu     = parseFloat(row[5]) || 0;
    const total  = parseFloat(row[6]) || 0;

    if (!tipo || !desc) continue;

    if (tipo === 'Agrupador') {
      if (!lastWasAgrupador) {
        // Venimos de conceptos → cerrar agrupadores agotados
        while (stack.length > 0 && Math.abs(stack[stack.length - 1].rem) <= EPS) {
          stack.pop();
        }
      }
      if (stack.length > 0) stack[stack.length - 1].rem -= total;
      const nivel = stack.length;
      stack.push({ desc, total, rem: total, nivel });

      result.push({
        id:          crypto.randomUUID(),
        tipo:        'agrupador',
        descripcion: desc,
        total,
        nivel,
        path:        stack.map(s => s.desc),
        orden:       result.length,
      });
      lastWasAgrupador = true;

    } else if (tipo === 'Precio unitario') {
      if (stack.length > 0) stack[stack.length - 1].rem -= total;
      result.push({
        id:              crypto.randomUUID(),
        tipo:            'concepto',
        clave,
        descripcion:     desc,
        unidad,
        cantidad:        cant,
        precio_unitario: pu,
        total,
        agrupadores:     stack.map(s => s.desc),
        nivel:           stack.length,
        orden:           result.length,
      });
      lastWasAgrupador = false;
    }
  }

  return result;
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
  collapsed:   new Set(),  // descripciones de agrupadores colapsados
  importando:  false,
  editando:    false,      // modo edición de jerarquía
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

  if (_presState.importando) {
    wrap.appendChild(_buildImportUI(proyectoId));
    return;
  }

  const pres = getPresupuesto(proyectoId);
  if (!pres?.conceptos?.length) {
    wrap.appendChild(_buildEmptyState(proyectoId));
    return;
  }

  // Barra de info + botones
  const bar = document.createElement('div');
  bar.className = 'toolbar mb-16';
  const editLabel = _presState.editando ? '✓ Guardar jerarquía' : '✏️ Editar jerarquía';
  const editClass = _presState.editando ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  bar.innerHTML = `
    <span class="text-sm text-muted">
      v${pres.meta.version} &nbsp;·&nbsp; ${pres.meta.archivo} &nbsp;·&nbsp; ${formatDate(pres.meta.fecha)}
    </span>
    <div class="toolbar-spacer"></div>
    <span class="text-sm" style="font-weight:600;color:var(--accent)">
      ${formatMXN(pres.meta.total)} presupuestado
    </span>
    <button class="${editClass}" id="btn-pres-editar">${editLabel}</button>
    <button class="btn btn-ghost btn-sm" id="btn-pres-reimport">⟳ Re-importar</button>
  `;
  bar.querySelector('#btn-pres-reimport').addEventListener('click', () => {
    _presState.importando = true;
    _presState.editando   = false;
    _renderPresContenido(proyectoId);
  });
  bar.querySelector('#btn-pres-editar').addEventListener('click', async () => {
    if (_presState.editando) {
      // Guardar cambios en Firebase
      const presActual = getPresupuesto(proyectoId);
      await savePresupuesto(proyectoId, presActual);
      showToast('Jerarquía guardada', 'success');
    }
    _presState.editando = !_presState.editando;
    _presState.collapsed = new Set(); // expandir todo en modo edición
    _renderPresContenido(proyectoId);
  });
  wrap.appendChild(bar);

  if (_presState.editando) {
    const hint = document.createElement('div');
    hint.style.cssText = 'margin-bottom:12px;padding:10px 14px;border-radius:8px;background:rgba(26,159,212,.08);border:1px solid rgba(26,159,212,.2);font-size:12px;color:var(--accent)';
    hint.innerHTML = '✏️ <strong>Modo edición:</strong> haz clic en <strong>↕ Mover</strong> en cualquier fila para reasignarla a otra partida. Los descendientes se actualizan automáticamente.';
    wrap.appendChild(hint);
  }

  wrap.appendChild(_buildTablaComparacion(proyectoId, pres));
}

// =====================================================
// EMPTY STATE
// =====================================================

function _buildEmptyState(proyectoId) {
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;flex-direction:column;align-items:center;padding:64px 20px;gap:14px';
  div.innerHTML = `
    <div style="font-size:52px">📋</div>
    <h3 style="margin:0;font-size:18px">Sin presupuesto importado</h3>
    <p class="text-muted text-sm" style="text-align:center;margin:0;max-width:340px">
      Importa tu presupuesto de OPUS (.xls) para comparar<br>lo presupuestado vs. el gasto real por concepto.
    </p>
    <button class="btn btn-primary" id="btn-pres-first-import" style="margin-top:8px">
      Importar presupuesto OPUS
    </button>
  `;
  div.querySelector('#btn-pres-first-import').addEventListener('click', () => {
    _presState.importando = true;
    _renderPresContenido(proyectoId);
  });
  return div;
}

// =====================================================
// IMPORT UI — drag & drop → preview → confirmar
// =====================================================

function _buildImportUI(proyectoId) {
  const div = document.createElement('div');
  div.style.cssText = 'max-width:520px;margin:0 auto;padding:24px 0';
  div.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <h3 style="margin:0;font-size:16px">Importar presupuesto OPUS</h3>
      <button class="btn btn-ghost btn-sm" id="btn-pres-cancel-import">✕ Cancelar</button>
    </div>
    <div id="pres-drop-zone" style="
      border:2px dashed var(--border);border-radius:12px;padding:40px 24px;
      cursor:pointer;transition:border-color .2s,background .2s;
      background:var(--surface);text-align:center;
    ">
      <div style="font-size:40px;margin-bottom:10px">📂</div>
      <p style="margin:0 0 4px;font-weight:600;font-size:14px">Arrastra tu archivo OPUS aquí</p>
      <p class="text-muted text-sm" style="margin:0 0 10px">o haz clic para seleccionar</p>
      <p class="text-muted" style="margin:0;font-size:11px">.xls / .xlsx exportados de OPUS</p>
    </div>
    <input type="file" id="pres-file-input" accept=".xls,.xlsx" style="display:none">
    <div id="pres-preview" style="margin-top:16px"></div>
  `;

  const dropZone  = div.querySelector('#pres-drop-zone');
  const fileInput = div.querySelector('#pres-file-input');
  const preview   = div.querySelector('#pres-preview');

  div.querySelector('#btn-pres-cancel-import').addEventListener('click', () => {
    _presState.importando = false;
    _renderPresContenido(proyectoId);
  });

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--accent)';
    dropZone.style.background  = 'rgba(26,159,212,.06)';
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.style.borderColor = 'var(--border)';
    dropZone.style.background  = 'var(--surface)';
  });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--border)';
    dropZone.style.background  = 'var(--surface)';
    _handleOpusFile(e.dataTransfer.files[0], proyectoId, dropZone, preview);
  });

  fileInput.addEventListener('change', e =>
    _handleOpusFile(e.target.files[0], proyectoId, dropZone, preview)
  );

  return div;
}

async function _handleOpusFile(file, proyectoId, dropZone, preview) {
  if (!file) return;

  dropZone.innerHTML = `
    <div style="font-size:32px;margin-bottom:10px">⏳</div>
    <p class="text-sm" style="margin:0">Procesando ${file.name}…</p>
  `;
  preview.innerHTML = '';

  try {
    const conceptos     = await parseOpusXLS(file);
    const soloConceptos = conceptos.filter(c => c.tipo === 'concepto');
    const agrupadores   = conceptos.filter(c => c.tipo === 'agrupador');
    const total         = soloConceptos.reduce((s, c) => s + c.total, 0);

    preview.innerHTML = `
      <div class="card" style="padding:16px">
        <p style="margin:0 0 12px;font-weight:600;font-size:14px">
          ✓&nbsp; <span style="color:var(--accent)">${file.name}</span>
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
          <div>
            <div class="text-muted" style="font-size:11px;margin-bottom:3px">CONCEPTOS</div>
            <div style="font-size:22px;font-weight:700">${soloConceptos.length}</div>
          </div>
          <div>
            <div class="text-muted" style="font-size:11px;margin-bottom:3px">PARTIDAS</div>
            <div style="font-size:22px;font-weight:700">${agrupadores.length}</div>
          </div>
          <div>
            <div class="text-muted" style="font-size:11px;margin-bottom:3px">TOTAL</div>
            <div style="font-size:17px;font-weight:700;color:var(--accent)">${formatMXN(total)}</div>
          </div>
        </div>
        <button class="btn btn-primary" id="btn-pres-confirmar" style="width:100%">
          Confirmar e importar
        </button>
      </div>
    `;

    preview.querySelector('#btn-pres-confirmar').addEventListener('click', async () => {
      const btn = preview.querySelector('#btn-pres-confirmar');
      btn.disabled = true;
      btn.textContent = 'Guardando…';

      const existing = getPresupuesto(proyectoId);
      const version  = (existing?.meta?.version ?? 0) + 1;

      await savePresupuesto(proyectoId, {
        meta: { version, fecha: todayISO(), archivo: file.name, total },
        conceptos,
      });

      _presState.importando = false;
      _presState.collapsed  = new Set();
      showToast(`Presupuesto v${version} importado — ${soloConceptos.length} conceptos`, 'success');
      _renderPresContenido(proyectoId);
    });

  } catch (err) {
    console.error('[Presupuesto]', err);
    dropZone.innerHTML = `
      <div style="font-size:32px;margin-bottom:8px">⚠️</div>
      <p class="text-sm" style="color:var(--danger);margin:0">Error al leer el archivo</p>
      <p class="text-muted" style="font-size:11px;margin:6px 0 0">${err.message}</p>
    `;
    showToast('Error al procesar el archivo OPUS', 'error');
  }
}

// =====================================================
// REPARENTEO — mueve un item a otro padre en la jerarquía
// Actualiza automáticamente todos los descendientes
// =====================================================

function _pathStartsWith(path, prefix) {
  if (path.length < prefix.length) return false;
  return prefix.every((p, i) => path[i] === p);
}

function _reparentItem(conceptos, itemId, newParentDesc) {
  const item = conceptos.find(c => c.id === itemId);
  if (!item) return conceptos;

  // Nuevo padre: null = raíz
  const newParent = newParentDesc
    ? conceptos.find(c => c.tipo === 'agrupador' && c.descripcion === newParentDesc)
    : null;

  // Evitar que un agrupador se convierta en hijo de sí mismo o de un descendiente
  if (item.tipo === 'agrupador' && newParent) {
    if (_pathStartsWith(newParent.path, item.path)) return conceptos; // ciclo
  }

  const oldAncestors = item.tipo === 'agrupador'
    ? item.path.slice(0, -1)   // path sin self
    : item.agrupadores;

  const newAncestors = newParent ? newParent.path : [];
  const newNivelItem = newAncestors.length + (item.tipo === 'concepto' ? 1 : 0);

  return conceptos.map(c => {
    // El propio item
    if (c.id === itemId) {
      if (c.tipo === 'agrupador') {
        return { ...c, nivel: newAncestors.length, path: [...newAncestors, c.descripcion] };
      } else {
        return { ...c, nivel: newNivelItem, agrupadores: newAncestors };
      }
    }

    // Descendientes del agrupador movido (solo aplica si el item era agrupador)
    if (item.tipo === 'agrupador') {
      const oldPrefix = item.path; // path completo incluyendo self

      if (c.tipo === 'agrupador' && _pathStartsWith(c.path, oldPrefix) && c.id !== itemId) {
        const suffix   = c.path.slice(oldPrefix.length);       // parte después del item
        const newPath  = [...newAncestors, item.descripcion, ...suffix];
        return { ...c, nivel: newPath.length - 1, path: newPath };
      }

      if (c.tipo === 'concepto' && _pathStartsWith(c.agrupadores, oldPrefix)) {
        const suffix = c.agrupadores.slice(oldPrefix.length);
        const newAgr = [...newAncestors, item.descripcion, ...suffix];
        return { ...c, nivel: newAgr.length, agrupadores: newAgr };
      }
    }

    return c;
  });
}

// =====================================================
// TABLA DE COMPARACIÓN — Presupuestado vs. Real
// =====================================================

function _buildTablaComparacion(proyectoId, pres) {
  const gastoMap  = _gastoRealPorConcepto(proyectoId);
  // Referencia mutable al array de conceptos (para edición sin re-fetch)
  let conceptos = pres.conceptos;

  // Gasto real acumulado por agrupador
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

  // Encabezado — en modo edición añade columna de acción
  const hdr = document.createElement('div');
  const cols = _presState.editando
    ? '1fr 150px 150px 90px 96px'
    : '1fr 150px 150px 90px';
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
    ${_presState.editando ? '<span style="text-align:center">Mover</span>' : ''}
  `;
  wrap.appendChild(hdr);

  const tbody = document.createElement('div');
  wrap.appendChild(tbody);

  // Panel de selección de padre (se reutiliza, uno a la vez)
  let _activePickerId = null;

  function _openParentPicker(itemId, anchorRow) {
    // Cerrar picker anterior si hay uno abierto
    document.querySelectorAll('.pres-parent-picker').forEach(p => p.remove());
    if (_activePickerId === itemId) { _activePickerId = null; return; }
    _activePickerId = itemId;

    const item      = conceptos.find(c => c.id === itemId);
    const agrupads  = conceptos.filter(c => c.tipo === 'agrupador');

    const picker = document.createElement('div');
    picker.className = 'pres-parent-picker';
    picker.style.cssText = `
      position:absolute;z-index:200;
      background:var(--surface);border:1px solid var(--border);
      border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.4);
      min-width:280px;max-height:260px;overflow-y:auto;
      padding:6px 0;
    `;

    // Opciones: raíz + todos los agrupadores válidos
    const currentParentDesc = item.tipo === 'agrupador'
      ? (item.path.length > 1 ? item.path[item.path.length - 2] : null)
      : (item.agrupadores.length > 0 ? item.agrupadores[item.agrupadores.length - 1] : null);

    const opciones = [
      { label: '— Sin padre (nivel raíz)', value: null },
      ...agrupads
        .filter(a => a.id !== itemId)                              // no self
        .filter(a => !_pathStartsWith(a.path, item.tipo === 'agrupador' ? item.path : []))  // no descendientes
        .map(a => ({ label: '  '.repeat(a.nivel) + a.descripcion, value: a.descripcion }))
    ];

    opciones.forEach(opt => {
      const btn = document.createElement('button');
      btn.style.cssText = `
        display:block;width:100%;text-align:left;padding:7px 14px;
        background:${opt.value === currentParentDesc ? 'var(--accent-glow)' : 'none'};
        color:${opt.value === currentParentDesc ? 'var(--accent)' : 'var(--text)'};
        border:none;cursor:pointer;font-size:12px;white-space:nowrap;
        overflow:hidden;text-overflow:ellipsis;
      `;
      btn.textContent = opt.label;
      btn.title = opt.label.trim();
      btn.addEventListener('mouseenter', () => btn.style.background = 'var(--surface2)');
      btn.addEventListener('mouseleave', () => {
        btn.style.background = opt.value === currentParentDesc ? 'var(--accent-glow)' : 'none';
      });
      btn.addEventListener('click', () => {
        picker.remove();
        _activePickerId = null;
        conceptos = _reparentItem(conceptos, itemId, opt.value);
        // Actualizar cache local sin guardar Firebase aún
        pres.conceptos = conceptos;
        renderRows();
        showToast('Movido — recuerda guardar la jerarquía', 'info', 2000);
      });
      picker.appendChild(btn);
    });

    // Posicionar bajo el botón de la fila
    anchorRow.style.position = 'relative';
    anchorRow.appendChild(picker);

    // Cerrar al hacer clic fuera
    setTimeout(() => {
      document.addEventListener('click', function closePicker(e) {
        if (!picker.contains(e.target)) {
          picker.remove();
          _activePickerId = null;
          document.removeEventListener('click', closePicker);
        }
      });
    }, 0);
  }

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
        if (!_presState.editando) row.style.cursor = 'pointer';

        const nameCell = document.createElement('span');
        nameCell.style.cssText = `font-weight:600;font-size:${Math.max(12, 14 - item.nivel)}px;display:flex;align-items:center;gap:7px`;
        nameCell.innerHTML = `
          <span style="color:var(--text-muted);font-size:10px;display:inline-block;
            transition:transform .18s;transform:rotate(${isOpen ? 0 : -90}deg)">▼</span>
          ${item.descripcion}
        `;
        if (!_presState.editando) {
          nameCell.style.cursor = 'pointer';
          nameCell.addEventListener('click', () => {
            _presState.collapsed.has(item.descripcion)
              ? _presState.collapsed.delete(item.descripcion)
              : _presState.collapsed.add(item.descripcion);
            renderRows();
          });
        }

        row.appendChild(nameCell);
        row.insertAdjacentHTML('beforeend', `
          <span style="text-align:right;font-weight:600;padding-right:16px">${formatMXN(item.total)}</span>
          <span style="text-align:right;font-weight:600;color:${col};padding-right:16px">${g > 0 ? formatMXN(g) : '—'}</span>
          <span style="text-align:right;font-weight:600;color:${col};padding-right:${_presState.editando ? 0 : 16}px">${g > 0 ? pct.toFixed(0) + '%' : '—'}</span>
        `);

        if (!_presState.editando) {
          row.addEventListener('mouseenter', () => row.style.filter = 'brightness(1.07)');
          row.addEventListener('mouseleave', () => row.style.filter = '');
        }

      } else {
        const g   = gastoMap[item.id] || 0;
        const pct = item.total > 0 ? (g / item.total * 100) : 0;
        const col = g > item.total ? 'var(--danger)' : g > 0 ? 'var(--success)' : 'var(--text-muted)';
        const desc = item.descripcion.length > 90
          ? item.descripcion.slice(0, 90) + '…'
          : item.descripcion;

        row.style.background = 'var(--surface)';
        row.style.padding = `7px 16px 7px ${indent}px`;

        row.insertAdjacentHTML('beforeend', `
          <span style="font-size:13px;line-height:1.4">
            ${item.clave ? `<span class="text-muted" style="font-size:11px;font-family:monospace;margin-right:5px">${item.clave}</span>` : ''}
            ${desc}
            <span class="text-muted" style="font-size:11px;margin-left:4px">${item.cantidad} ${item.unidad}</span>
          </span>
          <span style="text-align:right;font-size:13px;padding-right:16px">${formatMXN(item.total)}</span>
          <span style="text-align:right;font-size:13px;color:${col};padding-right:16px">${g > 0 ? formatMXN(g) : '—'}</span>
          <span style="text-align:right;font-size:13px;font-weight:${g > 0 ? 600 : 400};color:${col};padding-right:${_presState.editando ? 0 : 16}px">
            ${g > 0 ? pct.toFixed(0) + '%' : '—'}
          </span>
        `);
      }

      // Botón mover (solo modo edición)
      if (_presState.editando) {
        const moveBtn = document.createElement('button');
        moveBtn.textContent = '↕ Mover';
        moveBtn.style.cssText = `
          font-size:11px;padding:4px 8px;border-radius:5px;cursor:pointer;
          background:var(--surface2);border:1px solid var(--border);
          color:var(--text-muted);margin:0 8px;white-space:nowrap;
          transition:all .15s;
        `;
        moveBtn.addEventListener('mouseenter', () => {
          moveBtn.style.borderColor = 'var(--accent)';
          moveBtn.style.color       = 'var(--accent)';
        });
        moveBtn.addEventListener('mouseleave', () => {
          moveBtn.style.borderColor = 'var(--border)';
          moveBtn.style.color       = 'var(--text-muted)';
        });
        moveBtn.addEventListener('click', e => {
          e.stopPropagation();
          _openParentPicker(item.id, row);
        });
        row.appendChild(moveBtn);
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

  const conceptos = pres.conceptos.filter(c => c.tipo === 'concepto');

  // Estado interno: array mutable de líneas
  const lineas = [];
  for (const d of existingDesglose) {
    const c = conceptos.find(x => x.id === d.concepto_id);
    if (c) lineas.push({ concepto_id: c.id, descripcion: c.descripcion, clave: c.clave, importe: d.importe });
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
  let _sel       = null; // concepto seleccionado

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
          e.preventDefault(); // evita que el input pierda focus
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
      row.innerHTML = `
        <div style="min-width:0">
          <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
            title="${linea.descripcion}">${linea.descripcion.length > 60 ? linea.descripcion.slice(0,60)+'…' : linea.descripcion}</div>
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
      // Seleccionar todo al hacer foco
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
    // Foco en el último input de importe
    setTimeout(() => {
      const imps = linesWrap.querySelectorAll('.pdes-importe');
      imps[imps.length - 1]?.focus();
    }, 0);
  });

  renderLines();

  // ---- API pública para onConfirm ----
  section._getDesglose = () =>
    lineas.filter(l => l.importe > 0).map(l => ({ concepto_id: l.concepto_id, importe: l.importe }));

  return section;
}
