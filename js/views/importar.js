/* =====================================================
   SOGRUB Bitácora — Vista: Importar Datos Históricos
   ===================================================== */
'use strict';

const _importState = {
  paso:       1,
  destino:    'caja',    // 'caja' | 'proyecto'
  proyectoId: null,
  tipoMov:    'gasto',   // para proyectos
  rawCSV:     '',
  preview:    [],        // filas parseadas
};

function renderImportar() {
  const root = document.getElementById('importar-root');
  root.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'mb-24';
  header.innerHTML = `
    <h2 class="view-title">Importar Datos Históricos</h2>
    <p class="text-muted mt-4">Importa movimientos masivos desde CSV.</p>
  `;
  root.appendChild(header);

  // Wizard steps
  root.appendChild(renderWizardSteps());

  // Contenido del paso
  const stepContent = document.createElement('div');
  stepContent.id = 'import-step-content';
  root.appendChild(stepContent);

  renderImportPaso(_importState.paso);
}

// =====================================================
// WIZARD STEPS INDICATOR
// =====================================================
function renderWizardSteps() {
  const wrap = document.createElement('div');
  wrap.id = 'wizard-steps';
  wrap.className = 'wizard-steps mb-24';

  const pasos = [
    { n: 1, label: 'Destino' },
    { n: 2, label: 'Datos' },
    { n: 3, label: 'Confirmar' },
  ];

  pasos.forEach((p, i) => {
    const step = document.createElement('div');
    step.className = `wizard-step${_importState.paso === p.n ? ' active' : ''}${_importState.paso > p.n ? ' done' : ''}`;
    step.innerHTML = `
      <div class="wizard-step-num">${_importState.paso > p.n ? '✓' : p.n}</div>
      <span>${p.label}</span>
    `;
    wrap.appendChild(step);

    if (i < pasos.length - 1) {
      const conn = document.createElement('div');
      conn.className = `wizard-connector${_importState.paso > p.n ? ' done' : ''}`;
      wrap.appendChild(conn);
    }
  });

  return wrap;
}

function refreshWizardSteps() {
  const old = document.getElementById('wizard-steps');
  if (old) old.replaceWith(renderWizardSteps());
}

// =====================================================
// PASO 1 — Seleccionar destino
// =====================================================
function renderImportPaso(paso) {
  const content = document.getElementById('import-step-content');
  if (!content) return;
  content.innerHTML = '';

  if (paso === 1) renderPaso1(content);
  else if (paso === 2) renderPaso2(content);
  else if (paso === 3) renderPaso3(content);
}

function renderPaso1(container) {
  const proyectos = (getCollection(KEYS.PROYECTOS) ?? []);

  const card = document.createElement('div');
  card.className = 'card';
  card.style.maxWidth = '560px';
  card.innerHTML = `
    <h3 class="section-title mb-20">Paso 1 — ¿Dónde importar?</h3>

    <div class="form-group mb-20">
      <label class="form-label">Destino</label>
      <div class="toggle-group" style="max-width:300px">
        <input type="radio" name="imp-dest" id="dest-caja"     value="caja"     class="toggle-option"
          ${_importState.destino === 'caja'    ? 'checked' : ''}>
        <label for="dest-caja"     class="toggle-label">Caja SOGRUB</label>
        <input type="radio" name="imp-dest" id="dest-proyecto" value="proyecto" class="toggle-option"
          ${_importState.destino === 'proyecto' ? 'checked' : ''}>
        <label for="dest-proyecto" class="toggle-label">Proyecto</label>
      </div>
    </div>

    <div id="paso1-proy-opts" class="${_importState.destino === 'proyecto' ? '' : 'hidden'}">
      <div class="form-group mb-16">
        <label class="form-label" for="imp-proyecto">Proyecto</label>
        <select id="imp-proyecto" class="form-select">
          ${proyectos.length === 0
            ? '<option value="">Sin proyectos — créalos primero</option>'
            : proyectos.map(p => `<option value="${p.id}" ${_importState.proyectoId === p.id ? 'selected' : ''}>${p.nombre} — ${p.cliente}</option>`).join('')}
        </select>
      </div>
      <div class="form-group mb-16">
        <label class="form-label">Tipo de movimientos a importar</label>
        <div class="toggle-group" style="max-width:480px">
          <input type="radio" name="imp-tipo" id="tipo-gasto"     value="gasto"           class="toggle-option"
            ${_importState.tipoMov === 'gasto'           ? 'checked' : ''}>
          <label for="tipo-gasto"     class="toggle-label">Gastos</label>
          <input type="radio" name="imp-tipo" id="tipo-abono"     value="abono_cliente"    class="toggle-option"
            ${_importState.tipoMov === 'abono_cliente'    ? 'checked' : ''}>
          <label for="tipo-abono"     class="toggle-label">Abonos cliente</label>
          <input type="radio" name="imp-tipo" id="tipo-transf"    value="transferencia_sogrub" class="toggle-option"
            ${_importState.tipoMov === 'transferencia_sogrub' ? 'checked' : ''}>
          <label for="tipo-transf"    class="toggle-label">De SOGRUB</label>
        </div>
      </div>
    </div>

    <div class="flex" style="justify-content:flex-end;margin-top:24px">
      <button class="btn btn-primary" id="btn-paso1-next">Siguiente →</button>
    </div>
  `;

  // Toggle proy options
  card.querySelectorAll('input[name="imp-dest"]').forEach(r => {
    r.addEventListener('change', e => {
      _importState.destino = e.target.value;
      card.querySelector('#paso1-proy-opts').classList.toggle('hidden', e.target.value !== 'proyecto');
    });
  });

  card.querySelector('#btn-paso1-next').addEventListener('click', () => {
    _importState.destino = card.querySelector('input[name="imp-dest"]:checked')?.value ?? 'caja';

    if (_importState.destino === 'proyecto') {
      const sel = card.querySelector('#imp-proyecto');
      if (!sel?.value) { showToast('Selecciona un proyecto', 'warning'); return; }
      _importState.proyectoId = sel.value;
      _importState.tipoMov = card.querySelector('input[name="imp-tipo"]:checked')?.value ?? 'gasto';
    }

    _importState.paso = 2;
    refreshWizardSteps();
    renderImportPaso(2);
  });

  container.appendChild(card);
}

// =====================================================
// PASO 2 — Pegar CSV y previsualizar
// =====================================================
function renderPaso2(container) {
  const esProy   = _importState.destino === 'proyecto';
  const placeholder = esProy
    ? `fecha,monto,concepto,status,subcontratista\n2024-11-15,-2999,Dron,Pagado,Mario\n2024-11-20,-522,Chalecos,Pagado,`
    : `fecha,monto,concepto,status\n2024-11-15,-2999,Gasolina,Pagado\n2024-11-20,-1200,Comida,Pendiente`;

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h3 class="section-title mb-4">Paso 2 — Pegar datos CSV</h3>
    <p class="text-muted text-sm mb-16">
      Formato esperado: <code style="background:var(--surface2);padding:2px 6px;border-radius:4px;font-size:11px">
        ${esProy ? 'fecha,monto,concepto,status,subcontratista' : 'fecha,monto,concepto,status'}
      </code><br>
      El monto es negativo para egresos y positivo para ingresos.
      La columna <em>status</em> acepta "Pagado" o "Pendiente".
    </p>

    <div class="form-group mb-16">
      <label class="form-label" for="imp-csv">Pega el CSV aquí</label>
      <textarea id="imp-csv" class="form-textarea" style="min-height:160px;font-family:monospace;font-size:12px"
        placeholder="${placeholder}">${_importState.rawCSV}</textarea>
    </div>

    <div id="imp-preview-wrap"></div>

    <div class="flex mt-20" style="gap:10px;justify-content:space-between">
      <button class="btn btn-ghost" id="btn-paso2-back">← Atrás</button>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary" id="btn-previsualizar">👁 Previsualizar</button>
        <button class="btn btn-primary hidden" id="btn-paso2-next">Continuar →</button>
      </div>
    </div>
  `;

  card.querySelector('#btn-paso2-back').addEventListener('click', () => {
    _importState.paso = 1;
    _importState.preview = [];
    refreshWizardSteps();
    renderImportPaso(1);
  });

  card.querySelector('#btn-previsualizar').addEventListener('click', () => {
    const csv = card.querySelector('#imp-csv').value.trim();
    _importState.rawCSV = csv;

    if (!csv) { showToast('Pega datos CSV primero', 'warning'); return; }

    const resultado = parsearCSV(csv, esProy);
    if (!resultado.ok) { showToast(resultado.error, 'error'); return; }

    _importState.preview = resultado.filas;
    renderPreviewTable(card.querySelector('#imp-preview-wrap'), resultado.filas, esProy);
    card.querySelector('#btn-paso2-next').classList.remove('hidden');
  });

  card.querySelector('#btn-paso2-next').addEventListener('click', () => {
    if (_importState.preview.length === 0) { showToast('Previsualiza los datos primero', 'warning'); return; }
    _importState.paso = 3;
    refreshWizardSteps();
    renderImportPaso(3);
  });

  container.appendChild(card);
}

// ---- Parser CSV ----
function parsearCSV(csv, esProy) {
  const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { ok: false, error: 'Se necesitan al menos 2 líneas (encabezado + datos)' };

  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const reqs   = esProy ? ['fecha','monto','concepto'] : ['fecha','monto','concepto'];
  for (const r of reqs) {
    if (!header.includes(r)) return { ok: false, error: `Falta columna "${r}" en el encabezado` };
  }

  const filas = [];
  for (let i = 1; i < lines.length; i++) {
    const cols  = splitCSVLine(lines[i]);
    const get   = (col) => cols[header.indexOf(col)]?.trim() ?? '';

    const fecha    = get('fecha');
    const montoRaw = parseFloat(get('monto'));
    const concepto = get('concepto');
    const status   = get('status') || 'Pagado';
    const subcon   = esProy ? get('subcontratista') : '';

    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return { ok: false, error: `Línea ${i+1}: fecha inválida "${fecha}" (usa AAAA-MM-DD)` };
    }
    if (isNaN(montoRaw)) {
      return { ok: false, error: `Línea ${i+1}: monto inválido` };
    }
    if (!concepto) {
      return { ok: false, error: `Línea ${i+1}: concepto vacío` };
    }
    if (!['Pagado','Pendiente'].includes(status)) {
      return { ok: false, error: `Línea ${i+1}: status debe ser "Pagado" o "Pendiente"` };
    }

    filas.push({ fecha, monto: montoRaw, concepto, status, subcontratista: subcon, _error: null });
  }

  return { ok: true, filas };
}

function splitCSVLine(line) {
  const result = [];
  let cur = '', inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

// ---- Tabla de previsualización editable ----
function renderPreviewTable(wrap, filas, esProy) {
  wrap.innerHTML = '';
  if (filas.length === 0) return;

  const tableDiv = document.createElement('div');
  tableDiv.className = 'table-wrapper mt-8';
  tableDiv.innerHTML = `
    <table class="data-table" id="preview-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Fecha</th>
          <th>Monto</th>
          <th>Concepto</th>
          ${esProy ? '<th>Subcontratista</th>' : ''}
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${filas.map((f, i) => `
          <tr>
            <td class="text-muted">${i+1}</td>
            <td><input class="form-input" style="width:130px;padding:4px 8px" data-row="${i}" data-col="fecha"  value="${f.fecha}"></td>
            <td><input class="form-input" style="width:110px;padding:4px 8px" data-row="${i}" data-col="monto"  value="${f.monto}" type="number" step="0.01"></td>
            <td><input class="form-input" style="min-width:180px;padding:4px 8px" data-row="${i}" data-col="concepto" value="${f.concepto}"></td>
            ${esProy ? `<td><input class="form-input" style="min-width:120px;padding:4px 8px" data-row="${i}" data-col="subcontratista" value="${f.subcontratista}"></td>` : ''}
            <td>
              <select class="form-select" style="padding:4px 30px 4px 8px" data-row="${i}" data-col="status">
                <option ${f.status === 'Pagado'   ? 'selected' : ''}>Pagado</option>
                <option ${f.status === 'Pendiente'? 'selected' : ''}>Pendiente</option>
              </select>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Sync edits back to _importState.preview
  tableDiv.querySelectorAll('[data-row]').forEach(el => {
    el.addEventListener('change', e => {
      const row = +e.target.dataset.row;
      const col = e.target.dataset.col;
      let val   = e.target.value;
      if (col === 'monto') val = parseFloat(val);
      _importState.preview[row][col] = val;
    });
  });

  wrap.appendChild(tableDiv);
  wrap.insertAdjacentHTML('afterbegin',
    `<p class="text-muted text-sm mt-8"><strong>${filas.length}</strong> fila(s) listas para importar. Puedes editar los valores directamente en la tabla.</p>`
  );
}

// =====================================================
// PASO 3 — Confirmar
// =====================================================
function renderPaso3(container) {
  const filas    = _importState.preview;
  const esProy   = _importState.destino === 'proyecto';
  const proyecto = esProy ? getItem(KEYS.PROYECTOS, _importState.proyectoId) : null;

  const totalMonto = filas.reduce((a, f) => a + (parseFloat(f.monto) || 0), 0);
  const colorTotal = totalMonto >= 0 ? 'text-success' : 'text-danger';

  const tipoLabels = {
    gasto: 'Gastos', abono_cliente: 'Abonos cliente', transferencia_sogrub: 'Transferencias SOGRUB'
  };

  const card = document.createElement('div');
  card.className = 'card';
  card.style.maxWidth = '520px';
  card.innerHTML = `
    <h3 class="section-title mb-20">Paso 3 — Confirmar importación</h3>

    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;display:flex;flex-direction:column;gap:10px;margin-bottom:20px">
      <div class="flex justify-between">
        <span class="text-muted">Destino</span>
        <strong>${esProy ? proyecto?.nombre ?? '—' : 'Caja SOGRUB'}</strong>
      </div>
      ${esProy ? `
      <div class="flex justify-between">
        <span class="text-muted">Tipo</span>
        <strong>${tipoLabels[_importState.tipoMov] ?? _importState.tipoMov}</strong>
      </div>` : ''}
      <div class="flex justify-between">
        <span class="text-muted">Movimientos a importar</span>
        <strong>${filas.length}</strong>
      </div>
      <div class="flex justify-between">
        <span class="text-muted">Total de montos</span>
        <strong class="${colorTotal}">${formatMXN(totalMonto)}</strong>
      </div>
    </div>

    <div class="flex" style="gap:10px;justify-content:space-between">
      <button class="btn btn-ghost" id="btn-paso3-back">← Editar datos</button>
      <button class="btn btn-primary" id="btn-confirmar-import">✓ Confirmar importación</button>
    </div>

    <div id="import-success" class="hidden mt-16"
      style="background:var(--success-glow);border:1px solid var(--success);border-radius:var(--radius-md);padding:14px;color:var(--success)">
      <strong>✓ Importación exitosa</strong><br>
      <span style="font-size:13px;opacity:0.85" id="import-success-msg"></span>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" id="import-ir-vista">Ver movimientos →</button>
        <button class="btn btn-ghost btn-sm" id="import-otra">Importar más</button>
      </div>
    </div>
  `;

  card.querySelector('#btn-paso3-back').addEventListener('click', () => {
    _importState.paso = 2;
    refreshWizardSteps();
    renderImportPaso(2);
  });

  card.querySelector('#btn-confirmar-import').addEventListener('click', () => {
    ejecutarImportacion();

    const msg = `${filas.length} movimiento(s) importados correctamente.`;
    card.querySelector('#import-success-msg').textContent = msg;
    card.querySelector('#import-success').classList.remove('hidden');
    card.querySelector('#btn-confirmar-import').disabled = true;
    card.querySelector('#btn-paso3-back').disabled = true;
    showToast(msg, 'success');
  });

  card.querySelector('#btn-paso3-back')?.parentElement;

  // Botones post-importación (se conectan después de render)
  setTimeout(() => {
    card.querySelector('#import-ir-vista')?.addEventListener('click', () => {
      navigateTo(_importState.destino === 'caja' ? 'caja' : 'detalle', _importState.proyectoId);
    });
    card.querySelector('#import-otra')?.addEventListener('click', () => {
      Object.assign(_importState, { paso:1, destino:'caja', proyectoId:null, tipoMov:'gasto', rawCSV:'', preview:[] });
      renderImportar();
    });
  }, 0);

  container.appendChild(card);
}

// =====================================================
// EJECUTAR IMPORTACIÓN
// =====================================================
function ejecutarImportacion() {
  const filas  = _importState.preview;
  const esProy = _importState.destino === 'proyecto';

  if (esProy) {
    filas.forEach(f => {
      addItem(KEYS.PROY_MOVIMIENTOS, {
        proyecto_id:    _importState.proyectoId,
        fecha:          f.fecha,
        monto:          parseFloat(f.monto),
        concepto:       f.concepto,
        subcontratista: f.subcontratista ?? '',
        status:         f.status,
        tipo:           _importState.tipoMov,
      });
    });
  } else {
    filas.forEach(f => {
      addItem(KEYS.MOVIMIENTOS, {
        fecha:       f.fecha,
        monto:       parseFloat(f.monto),
        concepto:    f.concepto,
        status:      f.status,
        tipo:        'gasto_general',
        proyecto_id: null,
      });
    });
  }
}
