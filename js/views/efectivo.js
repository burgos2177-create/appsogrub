/* =====================================================
   SOGRUB Bitácora — Vista: Efectivo (caja física)
   Bitácora de movimientos manda el saldo; el arqueo por
   denominación concilia (faltante / sobrante).
   ===================================================== */
'use strict';

const _efectivoState = { mes: '', tipo: 'todos' };

// Etiqueta corta de denominación: $1,000 · $0.50
function _denomLabel(d) {
  return d < 1
    ? `$${d.toFixed(2)}`
    : `$${d.toLocaleString('es-MX')}`;
}

function renderEfectivo() {
  const root = document.getElementById('efectivo-root');
  root.innerHTML = '';

  // Fondos de efectivo en obra (caja chica): async, se refresca solo cuando
  // llega. Si aún no cargó, las sumas dan 0 y la vista se ve como siempre.
  _suscribirFondosEfectivoObra();

  // ---- KPIs ----
  root.appendChild(renderEfectivoKPIs());

  // ---- Toolbar ----
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar mb-20';
  toolbar.style.flexWrap = 'wrap';
  toolbar.innerHTML = `
    <button class="btn btn-primary"   id="btn-efec-mov">＋ Movimiento en efectivo</button>
    <button class="btn btn-secondary" id="btn-efec-retiro">⇄ Retiro de Mifel</button>
    <button class="btn btn-secondary" id="btn-efec-ingreso">⇄ Ingreso a Mifel</button>
    <div class="toolbar-spacer"></div>
    <div class="toolbar-filters">
      <select class="filter-select" id="efec-filter-mes">
        <option value="">Todos los meses</option>
        ${_efectivoMeses()}
      </select>
      <select class="filter-select" id="efec-filter-tipo">
        <option value="todos">Todos</option>
        <option value="ingreso">Ingresos</option>
        <option value="egreso">Egresos</option>
        <option value="retiro">Traspasos Mifel ⇄</option>
      </select>
    </div>
  `;
  root.appendChild(toolbar);

  toolbar.querySelector('#efec-filter-mes').value  = _efectivoState.mes;
  toolbar.querySelector('#efec-filter-tipo').value = _efectivoState.tipo;
  toolbar.querySelector('#btn-efec-mov').addEventListener('click', () => abrirModalEfectivo());
  toolbar.querySelector('#btn-efec-retiro').addEventListener('click', () => abrirModalRetiroEfectivo());
  toolbar.querySelector('#btn-efec-ingreso').addEventListener('click', () => abrirModalIngresoMifel());
  toolbar.querySelector('#efec-filter-mes').addEventListener('change', e => {
    _efectivoState.mes = e.target.value; refreshEfectivoTable();
  });
  toolbar.querySelector('#efec-filter-tipo').addEventListener('change', e => {
    _efectivoState.tipo = e.target.value; refreshEfectivoTable();
  });

  // ---- Arqueo por denominación ----
  root.appendChild(renderArqueoCard());

  // ---- Fondos de efectivo en obra (caja chica) ----
  const fondosContainer = document.createElement('div');
  fondosContainer.id = 'efectivo-fondos-container';
  root.appendChild(fondosContainer);
  refreshFondosObraCard();

  // ---- Tabla de movimientos ----
  const tableContainer = document.createElement('div');
  tableContainer.id = 'efectivo-table-container';
  root.appendChild(tableContainer);
  refreshEfectivoTable();

  // ---- Config saldo inicial efectivo ----
  root.appendChild(renderConfigSaldoEfectivo());
}

// =====================================================
// KPIs
// =====================================================
function renderEfectivoKPIs() {
  const saldo = calcSaldoEfectivo();
  const arqueo = calcTotalArqueo();
  const dif = calcDiferenciaArqueo();

  const difLabel = Math.abs(dif) < 0.005 ? 'Caja cuadrada' : dif > 0 ? 'Sobrante' : 'Faltante';
  const difClass = Math.abs(dif) < 0.005 ? 'text-success' : dif > 0 ? 'text-warning' : 'text-danger';
  const difIcon  = Math.abs(dif) < 0.005 ? '✅' : '⚠️';

  // Efectivo que ya salió de esta caja pero sigue siendo de la empresa:
  // los fondos de caja chica en efectivo, custodiados por cada almacenista.
  const fondos      = getFondosEfectivoObra();
  const totalFondos = calcTotalFondosEfectivoObra();
  const totalEmpresa = calcEfectivoTotalEmpresa();

  const grid = document.createElement('div');
  grid.className = 'kpi-grid mb-24';
  grid.id = 'efectivo-kpi-grid';
  grid.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">💵 Saldo en efectivo</div>
      <div class="kpi-value ${saldo >= 0 ? 'text-success' : 'text-danger'}">${formatMXN(saldo)}</div>
      <div class="kpi-sub">Caja física SOGRUB · según bitácora</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">🧮 Arqueo físico</div>
      <div class="kpi-value">${formatMXN(arqueo)}</div>
      <div class="kpi-sub">Conteo de billetes y monedas</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">${difIcon} Conciliación</div>
      <div class="kpi-value ${difClass}">${dif >= 0 ? '+' : ''}${formatMXN(dif)}</div>
      <div class="kpi-sub">${difLabel} (arqueo − bitácora)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">🏗️ Fondos en obra</div>
      <div class="kpi-value ${totalFondos > 0 ? 'text-warning' : ''}">${formatMXN(totalFondos)}</div>
      <div class="kpi-sub">
        ${fondos.length
          ? `Caja chica en efectivo · ${fondos.length} obra${fondos.length === 1 ? '' : 's'} · total empresa ${formatMXN(totalEmpresa)}`
          : 'Sin fondos de efectivo en obra'}
      </div>
    </div>
  `;
  return grid;
}

function refreshEfectivoKPIs() {
  const old = document.getElementById('efectivo-kpi-grid');
  if (old) old.replaceWith(renderEfectivoKPIs());
}

// =====================================================
// ARQUEO POR DENOMINACIÓN
// =====================================================
function renderArqueoCard() {
  const cfg = getConfig();
  const conteo = { ...(cfg.efectivo_arqueo ?? {}) };

  // Fondos de efectivo en obra: el arqueo de esta caja solo cuenta el billete
  // que está AQUÍ, así que la conciliación consolidada suma el arqueo que cada
  // obra declaró (ver tarjeta de abajo) contra el saldo teórico de esos fondos.
  const cc = { ...calcConciliacionEfectivoConsolidada(), fondos: getFondosEfectivoObra() };

  const card = document.createElement('div');
  card.className = 'card mb-24';
  card.id = 'arqueo-card';

  const billetes = DENOMINACIONES.filter(d => d >= 20);
  const monedas  = DENOMINACIONES.filter(d => d < 20);

  const _fila = (d) => `
    <div class="arqueo-fila">
      <span class="arqueo-denom">${_denomLabel(d)}</span>
      <span class="arqueo-x">×</span>
      <input type="number" class="form-input arqueo-input" data-denom="${d}"
        min="0" step="1" inputmode="numeric" placeholder="0"
        value="${conteo[d] != null && conteo[d] !== 0 ? conteo[d] : ''}">
      <span class="arqueo-sub" data-sub="${d}">${formatMXN(d * (Number(conteo[d]) || 0))}</span>
    </div>`;

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <h3 class="section-title" style="margin:0">🧮 Arqueo de caja</h3>
      <button class="btn btn-primary btn-sm" id="btn-guardar-arqueo">Guardar arqueo</button>
    </div>
    <div class="arqueo-grid">
      <div>
        <div class="arqueo-subtitle">Billetes</div>
        ${billetes.map(_fila).join('')}
      </div>
      <div>
        <div class="arqueo-subtitle">Monedas</div>
        ${monedas.map(_fila).join('')}
      </div>
    </div>
    <div class="arqueo-totales">
      <div class="arqueo-total-row">
        <span>Total contado <span class="text-dim" style="font-weight:400">· caja SOGRUB</span></span>
        <strong id="arqueo-total">${formatMXN(calcTotalArqueo())}</strong>
      </div>
      <div class="arqueo-total-row">
        <span class="text-muted">Saldo en bitácora</span>
        <strong class="text-muted" id="arqueo-teorico">${formatMXN(calcSaldoEfectivo())}</strong>
      </div>
      <div class="arqueo-total-row arqueo-dif-row">
        <span>Diferencia</span>
        <strong id="arqueo-dif">—</strong>
      </div>
      ${cc.fondos.length ? `
        <div class="arqueo-total-row" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
          <span class="text-muted">+ Arqueo declarado en obra
            <span class="text-dim" style="font-weight:400">· ${cc.conArqueo.length} de ${cc.fondos.length} fondo${cc.fondos.length === 1 ? '' : 's'}</span>
          </span>
          <strong class="text-muted" id="arqueo-obras">${formatMXN(cc.arqueoObras)}</strong>
        </div>
        <div class="arqueo-total-row">
          <span class="text-muted">+ Saldo de esos fondos <span class="text-dim" style="font-weight:400">· según bitácora</span></span>
          <strong class="text-muted">${formatMXN(cc.teoricoObras)}</strong>
        </div>
        <div class="arqueo-total-row arqueo-dif-row">
          <span>Diferencia consolidada <span class="text-dim" style="font-weight:400">· caja SOGRUB + obra</span></span>
          <strong id="arqueo-dif-consol">—</strong>
        </div>
        ${cc.sinArqueo.length ? `
          <div class="arqueo-total-row">
            <span class="text-dim" style="font-size:12px">
              ⚠️ ${cc.sinArqueo.length} fondo${cc.sinArqueo.length === 1 ? '' : 's'} sin arqueo declarado —
              ${formatMXN(cc.montoSinArqueo)} fuera de la conciliación
            </span>
          </div>` : ''}
      ` : ''}
    </div>
  `;

  // Recalcular en vivo mientras se cuenta
  const _recalc = () => {
    let total = 0;
    card.querySelectorAll('.arqueo-input').forEach(inp => {
      const d = parseFloat(inp.dataset.denom);
      const n = Number(inp.value) || 0;
      const sub = d * n;
      total += sub;
      const subEl = card.querySelector(`[data-sub="${inp.dataset.denom}"]`);
      if (subEl) subEl.textContent = formatMXN(sub);
    });
    const teorico = calcSaldoEfectivo();
    const dif = total - teorico;
    card.querySelector('#arqueo-total').textContent = formatMXN(total);
    const difEl = card.querySelector('#arqueo-dif');
    difEl.textContent = `${dif >= 0 ? '+' : ''}${formatMXN(dif)}`;
    difEl.className = Math.abs(dif) < 0.005 ? 'text-success' : dif > 0 ? 'text-warning' : 'text-danger';

    // Consolidada: usa el conteo en vivo de esta caja + lo ya declarado en obra.
    const difConsolEl = card.querySelector('#arqueo-dif-consol');
    if (difConsolEl) {
      const difConsol = (total + cc.arqueoObras) - (teorico + cc.teoricoObras);
      difConsolEl.textContent = `${difConsol >= 0 ? '+' : ''}${formatMXN(difConsol)}`;
      difConsolEl.className = Math.abs(difConsol) < 0.005 ? 'text-success' : difConsol > 0 ? 'text-warning' : 'text-danger';
    }
  };
  card.querySelectorAll('.arqueo-input').forEach(inp => inp.addEventListener('input', _recalc));
  _recalc();

  card.querySelector('#btn-guardar-arqueo').addEventListener('click', () => {
    const nuevoConteo = {};
    card.querySelectorAll('.arqueo-input').forEach(inp => {
      const n = Number(inp.value) || 0;
      if (n > 0) nuevoConteo[inp.dataset.denom] = n;
    });
    updateConfig({ efectivo_arqueo: nuevoConteo });
    showToast('Arqueo guardado', 'success');
    refreshEfectivoKPIs();
  });

  return card;
}

function refreshArqueoCard() {
  const old = document.getElementById('arqueo-card');
  if (old) old.replaceWith(renderArqueoCard());
}

// =====================================================
// FONDOS DE EFECTIVO EN OBRA (caja chica)
//
// El billete que se deposita al fondo efectivo de una obra ya salió de esta
// caja (egreso en sogrub_efectivo_movimientos), así que NO se cuenta en el
// arqueo de arriba — pero sigue siendo dinero de la empresa. Aquí se ve el
// saldo de cada fondo y se captura el arqueo que reportó el almacenista, para
// que la conciliación cierre por los dos lados.
//
// Fuente: /shared/cajaChica/{obraId} (mismo path que el tab del proyecto y que
// app-materiales / app-indirectos). El arqueo declarado se guarda en
// .../meta.arqueoEfectivo para que las apps de campo también puedan verlo.
// =====================================================
const _efecFondos = { unsub: null, obraLinks: {}, cargado: false };

function _suscribirFondosEfectivoObra() {
  if (_efecFondos.unsub) return;   // ya suscrito, el listener mantiene el cache

  // obraLinks resuelve obraId → proyectoId, para nombrar cada fondo con el
  // nombre del proyecto contable (el contador piensa en proyectos, no obras).
  const refLinks = _dbRef('/shared/obraLinks');
  refLinks.on('value', snap => {
    _efecFondos.obraLinks = snap.val() || {};
    _recomputarFondosEfectivo();
  }, err => console.warn('[Efectivo] obraLinks listener:', err));

  const refCC = _dbRef('/shared/cajaChica');
  const handler = refCC.on('value', snap => {
    _efecFondos.raw = snap.val() || {};
    _efecFondos.cargado = true;
    _recomputarFondosEfectivo();
  }, err => console.warn('[Efectivo] cajaChica listener:', err));

  _efecFondos.unsub = () => refCC.off('value', handler);
}

function _recomputarFondosEfectivo() {
  const todas = _efecFondos.raw || {};
  const lista = [];

  // _computeSaldoCajaChica vive en views/caja-chica.js (mismo scope global).
  if (typeof _computeSaldoCajaChica !== 'function') {
    console.warn('[Efectivo] _computeSaldoCajaChica no disponible; se omiten los fondos en obra');
    return;
  }

  for (const [obraId, nodo] of Object.entries(todas)) {
    const movimientos = nodo?.movimientos || {};
    // Réplica exacta del cálculo por fondo (caja-chica.js) — misma fórmula que
    // materiales/indirectos/consola. 'efectivo' = billete físico de la obra.
    const sums = _computeSaldoCajaChica(movimientos, 'efectivo');

    // Solo obras que realmente tienen fondo de efectivo: sin esto la vista se
    // llenaría de obras en ceros que solo usan el fondo de transferencia.
    const tieneFondo = sums.countDepositos > 0 || sums.countAprobados > 0 ||
                       sums.countReportados > 0 || sums.countRechazados > 0;
    if (!tieneFondo) continue;

    const arq = nodo?.meta?.arqueoEfectivo || null;
    const proyectoId = _efecFondos.obraLinks[obraId] || null;
    const proy = proyectoId ? getItem(KEYS.PROYECTOS, proyectoId) : null;

    lista.push({
      obraId,
      proyectoId,
      nombre: proy?.nombre || nodo?.meta?.obraNombre || obraId,
      vinculada: !!proy,
      saldo: sums.saldo,
      pendiente: sums.totalReportadoPendiente,
      depositado: sums.totalDepositado,
      gastado: sums.totalGastadoAprobado,
      arqueo: (arq && Number.isFinite(Number(arq.monto)))
        ? { monto: Number(arq.monto), fecha: arq.fecha || null, registradoPor: arq.registradoPor || null }
        : null,
    });
  }

  lista.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  setFondosEfectivoObra(lista);

  if (_activeView === 'efectivo') {
    refreshEfectivoKPIs();
    refreshArqueoCard();
    refreshFondosObraCard();
  }
}

function refreshFondosObraCard() {
  const container = document.getElementById('efectivo-fondos-container');
  if (!container) return;
  container.innerHTML = '';
  const card = renderFondosObraCard();
  if (card) container.appendChild(card);
}

function renderFondosObraCard() {
  const fondos = getFondosEfectivoObra();

  // Sin fondos de efectivo en obra no hay nada que conciliar: la vista se
  // queda idéntica a como era antes (solo la caja de SOGRUB).
  if (!fondos.length) {
    if (!_efecFondos.cargado) return null;
    const vacio = document.createElement('div');
    vacio.className = 'card mb-24';
    vacio.innerHTML = `
      <h3 class="section-title" style="margin:0 0 8px">🏗️ Fondos de efectivo en obra</h3>
      <p class="text-muted text-sm" style="margin:0;line-height:1.5">
        Ninguna obra tiene fondo de caja chica en efectivo todavía. Cuando deposites uno
        (proyecto → <b>Caja chica</b> → pill 💵), el billete sale de esta caja y su saldo
        aparece aquí para conciliarse junto con el arqueo.
      </p>
    `;
    return vacio;
  }

  const total     = calcTotalFondosEfectivoObra();
  const cc        = calcConciliacionEfectivoConsolidada();
  const card      = document.createElement('div');
  card.className  = 'card mb-24';
  card.id         = 'fondos-obra-card';

  const _difCell = (f) => {
    if (!f.arqueo) return '<span class="text-dim" style="font-size:12px">sin arqueo</span>';
    const d = Number(f.arqueo.monto) - (Number(f.saldo) || 0);
    const cls = Math.abs(d) < 0.005 ? 'text-success' : d > 0 ? 'text-warning' : 'text-danger';
    return `<span class="${cls} font-mono">${d >= 0 ? '+' : ''}${formatMXN(d)}</span>`;
  };

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;flex-wrap:wrap;gap:8px">
      <h3 class="section-title" style="margin:0">🏗️ Fondos de efectivo en obra <span class="text-dim" style="font-size:13px;font-weight:400">· caja chica</span></h3>
      <span class="text-muted text-sm">Total custodiado en obra: <strong class="${total > 0 ? 'text-warning' : ''}">${formatMXN(total)}</strong></span>
    </div>
    <p class="text-muted text-sm" style="margin:0 0 14px;line-height:1.5">
      Este billete ya salió de la caja de SOGRUB al depositarse, por eso <b>no</b> se cuenta en el
      arqueo de arriba. Captura aquí lo que el almacenista reportó tener y la diferencia se suma a
      la <b>conciliación consolidada</b>.
    </p>
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th>Obra / proyecto</th>
            <th>Saldo (bitácora)</th>
            <th>Arqueo declarado</th>
            <th>Diferencia</th>
            <th>Pendiente</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${fondos.map(f => `
            <tr>
              <td>
                ${f.nombre}
                ${f.vinculada ? '' : '<span class="text-dim" style="font-size:11px" title="Obra sin proyecto contable vinculado en /shared/obraLinks"> · sin vincular</span>'}
              </td>
              <td class="font-mono ${f.saldo < 0 ? 'amount-negative' : ''}">${formatMXN(f.saldo)}</td>
              <td class="font-mono">
                ${f.arqueo
                  ? `${formatMXN(f.arqueo.monto)}${f.arqueo.fecha ? `<span class="text-dim" style="font-size:11px"> · ${formatDate(f.arqueo.fecha)}</span>` : ''}`
                  : '<span class="text-dim" style="font-size:12px">—</span>'}
              </td>
              <td>${_difCell(f)}</td>
              <td class="font-mono text-muted">${f.pendiente > 0 ? formatMXN(f.pendiente) : '—'}</td>
              <td>
                <div class="td-actions">
                  <button class="btn btn-ghost btn-icon btn-arqueo-obra" data-obra="${f.obraId}" title="Registrar arqueo declarado por la obra">🧮</button>
                  ${f.proyectoId
                    ? `<button class="btn btn-ghost btn-icon btn-ver-proy-cc" data-proy="${f.proyectoId}" title="Ver caja chica en el proyecto">🏗️→</button>`
                    : ''}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="table-footer">
        <span style="margin-left:auto">
          Arqueo declarado: <strong>${formatMXN(cc.arqueoObras)}</strong> de <strong>${formatMXN(cc.teoricoObras)}</strong> conciliables
          ${cc.sinArqueo.length ? `<span class="text-dim"> · ${formatMXN(cc.montoSinArqueo)} sin contar</span>` : ''}
        </span>
      </div>
    </div>
  `;

  card.querySelectorAll('.btn-arqueo-obra').forEach(btn =>
    btn.addEventListener('click', () => abrirModalArqueoObra(btn.dataset.obra)));
  card.querySelectorAll('.btn-ver-proy-cc').forEach(btn =>
    btn.addEventListener('click', () => navigateTo('detalle', btn.dataset.proy)));

  return card;
}

// Registrar el arqueo que la obra declaró de su fondo de efectivo.
// Se guarda en /shared/cajaChica/{obraId}/meta.arqueoEfectivo — path compartido,
// así que app-materiales / app-indirectos pueden mostrarlo sin sync extra.
function abrirModalArqueoObra(obraId) {
  const f = getFondosEfectivoObra().find(x => x.obraId === obraId);
  if (!f) { showToast('Fondo no encontrado', 'warning'); return; }

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="arq-obra-monto">Efectivo contado en obra ($)</label>
        <input type="number" id="arq-obra-monto" class="form-input" min="0" step="0.01" placeholder="0.00"
          value="${f.arqueo ? f.arqueo.monto : ''}" autofocus>
      </div>
      <div class="form-group">
        <label class="form-label" for="arq-obra-fecha">Fecha del conteo</label>
        <input type="date" id="arq-obra-fecha" class="form-input" value="${f.arqueo?.fecha ?? todayISO()}">
      </div>
    </div>
    <div class="arqueo-totales" style="margin-top:0">
      <div class="arqueo-total-row">
        <span class="text-muted">Saldo según bitácora</span>
        <strong class="text-muted font-mono">${formatMXN(f.saldo)}</strong>
      </div>
      <div class="arqueo-total-row arqueo-dif-row">
        <span>Diferencia</span>
        <strong id="arq-obra-dif">—</strong>
      </div>
    </div>
    <p class="text-muted text-sm" style="margin:0;line-height:1.5">
      Es lo que el almacenista reportó tener del fondo de <b>${f.nombre}</b>. Se guarda en la caja
      chica compartida, así que también se ve desde las apps de campo, y entra en la conciliación
      consolidada del arqueo.
    </p>
  `;

  const montoInput = body.querySelector('#arq-obra-monto');
  const difEl      = body.querySelector('#arq-obra-dif');
  const _recalcDif = () => {
    if (montoInput.value === '') { difEl.textContent = '—'; difEl.className = 'text-muted'; return; }
    const d = (Number(montoInput.value) || 0) - (Number(f.saldo) || 0);
    difEl.textContent = `${d >= 0 ? '+' : ''}${formatMXN(d)}`;
    difEl.className = Math.abs(d) < 0.005 ? 'text-success' : d > 0 ? 'text-warning' : 'text-danger';
  };
  montoInput.addEventListener('input', _recalcDif);
  _recalcDif();

  openModal({
    title: `🧮 Arqueo del fondo en obra · ${f.nombre}`,
    body,
    confirmText: 'Guardar arqueo',
    onConfirm: async () => {
      const monto = parseFloat(montoInput.value);
      if (isNaN(monto) || monto < 0) { showToast('Ingresa un monto válido', 'warning'); return; }
      try {
        await _dbRef(`/shared/cajaChica/${obraId}/meta`).update({
          arqueoEfectivo: {
            monto,
            fecha: body.querySelector('#arq-obra-fecha').value || todayISO(),
            registradoPor: _currentUser?.email || '',
            updatedAt: Date.now(),
          },
          updatedAt: Date.now(),
        });
        closeModal();
        showToast('Arqueo del fondo guardado', 'success');
        // El listener de /shared/cajaChica repinta solo.
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    },
  });
}

// =====================================================
// TABLA DE MOVIMIENTOS
// =====================================================
function refreshEfectivoTable() {
  const container = document.getElementById('efectivo-table-container');
  if (!container) return;

  // Movimientos propios de la caja de efectivo (editables)
  const propios = (getCollection(KEYS.EFECTIVO_MOV) ?? []).map(m => ({ ...m, _source: 'efectivo' }));

  // Movimientos de PROYECTOS liquidados en efectivo (solo lectura, se gestionan en el proyecto)
  const deProyectos = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.metodo_pago === 'efectivo' &&
      (m.tipo === 'abono_cliente' || (m.tipo === 'gasto' && m.status === 'Pagado')))
    .map(m => ({
      id:          m.id,
      fecha:       m.fecha,
      concepto:    m.concepto,
      monto:       m.tipo === 'abono_cliente' ? Math.abs(m.monto) : -Math.abs(m.monto),
      tipo:        m.tipo === 'abono_cliente' ? 'ingreso' : 'egreso',
      _source:     'proyecto',
      proyecto_id: m.proyecto_id,
    }));

  // Movimientos generales (empresa) pagados en efectivo — solo lectura.
  const deEmpresa = (getCollection(KEYS.MOVIMIENTOS) ?? [])
    .filter(m => m.metodo_pago === 'efectivo')
    .map(m => ({
      id:       m.id,
      fecha:    m.fecha,
      concepto: m.concepto,
      monto:    Number(m.monto) || 0,
      tipo:     (Number(m.monto) || 0) >= 0 ? 'ingreso' : 'egreso',
      _source:  'empresa',
    }));

  let movs = [...propios, ...deProyectos, ...deEmpresa];
  if (_efectivoState.mes) movs = movs.filter(m => m.fecha && m.fecha.startsWith(_efectivoState.mes));
  const _esTraspaso = m => m.tipo === 'retiro' || m.tipo === 'ingreso_mifel';
  if (_efectivoState.tipo !== 'todos') {
    movs = _efectivoState.tipo === 'retiro'
      ? movs.filter(_esTraspaso)
      : movs.filter(m => (m.monto >= 0 ? 'ingreso' : 'egreso') === _efectivoState.tipo && !_esTraspaso(m));
  }
  movs = [...movs].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''));

  container.innerHTML = '';

  if (movs.length === 0) {
    container.appendChild(emptyState({
      icon:        svgEmptyEfectivo(),
      title:       'Sin movimientos en efectivo',
      desc:        'Registra entradas y salidas de efectivo, o haz un retiro de Mifel.',
      actionLabel: '＋ Movimiento en efectivo',
      onAction:    () => abrirModalEfectivo(),
    }));
    return;
  }

  const _efecTipoBadge = (m) => {
    if (m.tipo === 'retiro') return '<span class="badge badge-info badge-no-dot">⇄ Retiro Mifel</span>';
    if (m.tipo === 'ingreso_mifel') return '<span class="badge badge-info badge-no-dot">⇄ Ingreso Mifel</span>';
    if (m.tipo === 'deposito_caja_chica') return '<span class="badge badge-warning badge-no-dot">💵 → Caja chica obra</span>';
    const base = m.monto >= 0
      ? '<span class="badge badge-success badge-no-dot">Ingreso</span>'
      : '<span class="badge badge-danger badge-no-dot">Egreso</span>';
    if (m._source === 'proyecto') {
      const proy = getItem(KEYS.PROYECTOS, m.proyecto_id);
      return `${base} <span class="badge badge-info badge-no-dot" style="font-size:10px">🏗️ ${proy?.nombre ?? 'Proyecto'}</span>`;
    }
    if (m._source === 'empresa') {
      return `${base} <span class="badge badge-muted badge-no-dot" style="font-size:10px">🏢 Empresa</span>`;
    }
    return base;
  };

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th>Monto</th><th>Acciones</th></tr>
        </thead>
        <tbody>
          ${movs.map(m => `
            <tr>
              <td class="text-muted">${formatDate(m.fecha)}</td>
              <td>${m.concepto || '—'}</td>
              <td>${_efecTipoBadge(m)}</td>
              <td class="${m.monto >= 0 ? 'amount-positive' : 'amount-negative'} font-mono">${formatMXN(m.monto)}</td>
              <td>
                <div class="td-actions">
                  ${m._source === 'proyecto'
                    ? `<button class="btn btn-ghost btn-icon btn-ver-proy-efec" data-proy="${m.proyecto_id}" title="Ver en el proyecto (se gestiona ahí)">🏗️→</button>`
                    : m._source === 'empresa'
                    ? `<span class="text-dim" style="font-size:11px" title="Egreso de empresa pagado en efectivo · se gestiona en Caja SOGRUB / Buzón">🔒 empresa</span>`
                    : m.tipo === 'deposito_caja_chica'
                      ? `<span class="text-dim" style="font-size:11px" title="Depósito al fondo efectivo de la caja chica de una obra · gestiónalo desde el proyecto (tab Caja chica) para que el saldo compartido no se desincronice">🔒 caja chica</span>`
                    : _esTraspaso(m)
                      ? `<span class="text-dim" style="font-size:11px" title="Los traspasos se gestionan borrando la fila (ajusta también Mifel)">🔗 ligado</span>
                         <button class="btn btn-ghost btn-icon btn-del-efec" data-id="${m.id}" title="Eliminar">🗑️</button>`
                      : `<button class="btn btn-ghost btn-icon btn-edit-efec" data-id="${m.id}" title="Editar">✏️</button>
                         <button class="btn btn-ghost btn-icon btn-del-efec" data-id="${m.id}" title="Eliminar">🗑️</button>`}
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="table-footer">
        <span style="margin-left:auto">Saldo en efectivo: <strong class="${calcSaldoEfectivo() >= 0 ? 'amount-positive' : 'amount-negative'}">${formatMXN(calcSaldoEfectivo())}</strong></span>
      </div>
    </div>
  `;

  wrap.querySelectorAll('.btn-edit-efec').forEach(btn =>
    btn.addEventListener('click', () => abrirModalEfectivo(btn.dataset.id)));
  wrap.querySelectorAll('.btn-del-efec').forEach(btn =>
    btn.addEventListener('click', () => confirmarEliminarEfectivo(btn.dataset.id)));
  wrap.querySelectorAll('.btn-ver-proy-efec').forEach(btn =>
    btn.addEventListener('click', () => navigateTo('detalle', btn.dataset.proy)));

  container.appendChild(wrap);
}

function _refreshEfectivoTodo() {
  refreshEfectivoKPIs();
  refreshEfectivoTable();
  refreshArqueoCard();
  refreshFondosObraCard();
}

// =====================================================
// MODAL: MOVIMIENTO EN EFECTIVO (ingreso / egreso)
// =====================================================
function abrirModalEfectivo(id = null) {
  const mov = id ? getItem(KEYS.EFECTIVO_MOV, id) : null;
  const titulo = mov ? 'Editar movimiento' : 'Movimiento en efectivo';
  const tipoActual = mov ? (mov.monto >= 0 ? 'ingreso' : 'egreso') : 'egreso';

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="form-group">
      <label class="form-label">Tipo</label>
      <div class="toggle-group">
        <input type="radio" name="ef-tipo" id="ef-egreso"  value="egreso"  class="toggle-option" ${tipoActual === 'egreso'  ? 'checked' : ''}>
        <label for="ef-egreso"  class="toggle-label">Salida (egreso)</label>
        <input type="radio" name="ef-tipo" id="ef-ingreso" value="ingreso" class="toggle-option" ${tipoActual === 'ingreso' ? 'checked' : ''}>
        <label for="ef-ingreso" class="toggle-label">Entrada (ingreso)</label>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="ef-fecha">Fecha</label>
        <input type="date" id="ef-fecha" class="form-input" value="${mov?.fecha ?? todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label" for="ef-monto">Monto ($)</label>
        <input type="number" id="ef-monto" class="form-input" placeholder="0.00" min="0.01" step="0.01"
          value="${mov ? Math.abs(mov.monto) : ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="ef-concepto">Concepto</label>
      <input type="text" id="ef-concepto" class="form-input" placeholder="Ej: pago a chofer, compra menor…"
        value="${mov?.concepto ?? ''}">
    </div>
  `;

  openModal({
    title: titulo,
    body,
    confirmText: mov ? 'Guardar cambios' : 'Registrar',
    onConfirm: () => {
      const tipo     = body.querySelector('input[name="ef-tipo"]:checked')?.value ?? 'egreso';
      const fecha    = body.querySelector('#ef-fecha').value;
      const montoRaw = parseFloat(body.querySelector('#ef-monto').value);
      const concepto = body.querySelector('#ef-concepto').value.trim();

      const valid = validateFields([
        { el: body.querySelector('#ef-fecha'),    msg: 'Selecciona una fecha' },
        { el: body.querySelector('#ef-monto'),    msg: 'Ingresa un monto mayor a 0' },
        { el: body.querySelector('#ef-concepto'), msg: 'Escribe un concepto' },
      ]);
      if (!valid) return;

      const monto = tipo === 'egreso' ? -montoRaw : montoRaw;

      if (mov) {
        updateItem(KEYS.EFECTIVO_MOV, id, { fecha, monto, concepto });
        showToast('Movimiento actualizado', 'success');
      } else {
        addItem(KEYS.EFECTIVO_MOV, { fecha, monto, concepto, tipo: tipo === 'egreso' ? 'egreso' : 'ingreso', origen: 'efectivo' });
        showToast('Movimiento registrado', 'success');
      }

      closeModal();
      _refreshEfectivoTodo();
    },
  });
}

// =====================================================
// MODAL: RETIRO DE MIFEL A EFECTIVO (doble registro)
// =====================================================
function abrirModalRetiroEfectivo() {
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="ret-fecha">Fecha</label>
        <input type="date" id="ret-fecha" class="form-input" value="${todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label" for="ret-monto">Monto ($)</label>
        <input type="number" id="ret-monto" class="form-input" placeholder="0.00" min="0.01" step="0.01">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="ret-concepto">Concepto</label>
      <input type="text" id="ret-concepto" class="form-input" value="Retiro de Mifel a efectivo">
    </div>
    <p class="text-muted text-sm">
      Baja el saldo de Mifel (egreso) y sube el efectivo (ingreso) en un solo paso.
    </p>
  `;

  openModal({
    title: '⇄ Retiro de Mifel a efectivo',
    body,
    confirmText: 'Retirar',
    onConfirm: () => {
      const fecha    = body.querySelector('#ret-fecha').value;
      const monto    = parseFloat(body.querySelector('#ret-monto').value);
      const concepto = body.querySelector('#ret-concepto').value.trim();

      const valid = validateFields([
        { el: body.querySelector('#ret-fecha'), msg: 'Selecciona una fecha' },
        { el: body.querySelector('#ret-monto'), msg: 'Ingresa un monto mayor a 0' },
      ]);
      if (!valid) return;

      ejecutarRetiroEfectivo(monto, concepto, fecha);
      showToast('Retiro registrado (Mifel → efectivo)', 'success');
      closeModal();
      _refreshEfectivoTodo();
    },
  });
}

// Ingreso de efectivo a Mifel (inverso del retiro): baja el efectivo y sube Mifel.
function abrirModalIngresoMifel() {
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="ing-fecha">Fecha</label>
        <input type="date" id="ing-fecha" class="form-input" value="${todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label" for="ing-monto">Monto ($)</label>
        <input type="number" id="ing-monto" class="form-input" placeholder="0.00" min="0.01" step="0.01">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="ing-concepto">Concepto</label>
      <input type="text" id="ing-concepto" class="form-input" value="Ingreso de efectivo a Mifel">
    </div>
    <p class="text-muted text-sm">
      Baja el saldo de efectivo (egreso) y sube Mifel (ingreso electrónico) en un solo paso.
    </p>
  `;

  openModal({
    title: '⇄ Ingreso de efectivo a Mifel',
    body,
    confirmText: 'Depositar',
    onConfirm: () => {
      const fecha    = body.querySelector('#ing-fecha').value;
      const monto    = parseFloat(body.querySelector('#ing-monto').value);
      const concepto = body.querySelector('#ing-concepto').value.trim();

      const valid = validateFields([
        { el: body.querySelector('#ing-fecha'), msg: 'Selecciona una fecha' },
        { el: body.querySelector('#ing-monto'), msg: 'Ingresa un monto mayor a 0' },
      ]);
      if (!valid) return;

      const saldoEfec = calcSaldoEfectivo();
      if (monto > saldoEfec && !confirm(`El monto ($${monto.toLocaleString('es-MX',{minimumFractionDigits:2})}) supera el saldo en efectivo ($${saldoEfec.toLocaleString('es-MX',{minimumFractionDigits:2})}). ¿Continuar de todas formas?`)) return;

      ejecutarIngresoMifel(monto, concepto, fecha);
      showToast('Ingreso registrado (efectivo → Mifel)', 'success');
      closeModal();
      _refreshEfectivoTodo();
    },
  });
}

// =====================================================
// ELIMINAR MOVIMIENTO EN EFECTIVO
// (si es un retiro ligado, borra también la contraparte en Mifel)
// =====================================================
function confirmarEliminarEfectivo(id) {
  const mov = getItem(KEYS.EFECTIVO_MOV, id);
  const esTraspaso = (mov?.tipo === 'retiro' || mov?.tipo === 'ingreso_mifel') && mov?.retiro_ref;
  openConfirmModal({
    title:   'Eliminar movimiento',
    message: esTraspaso
      ? `¿Eliminar este traspaso? Se borrará también el movimiento correspondiente en Mifel.`
      : `¿Eliminar "${mov?.concepto ?? 'este movimiento'}"? Esta acción no se puede deshacer.`,
    confirmText: 'Eliminar',
    onConfirm: () => {
      if (esTraspaso) {
        // Borrar la contraparte en Mifel con el mismo retiro_ref
        const mifelMov = (getCollection(KEYS.MOVIMIENTOS) ?? []).find(m => m.retiro_ref === mov.retiro_ref);
        if (mifelMov) deleteItem(KEYS.MOVIMIENTOS, mifelMov.id);
      }
      deleteItem(KEYS.EFECTIVO_MOV, id);
      closeModal();
      showToast('Movimiento eliminado', 'success');
      _refreshEfectivoTodo();
    },
  });
}

// =====================================================
// CONFIG SALDO INICIAL EFECTIVO (colapsable)
// =====================================================
function renderConfigSaldoEfectivo() {
  const wrap = document.createElement('div');
  wrap.className = 'card mt-24';
  wrap.innerHTML = `
    <button class="collapsible-trigger" id="cfg-efec-trigger">
      ⚙️ Configurar saldo inicial de efectivo <span class="caret">▼</span>
    </button>
    <div class="collapsible-content" id="cfg-efec-content">
      <div style="padding-top:16px;display:flex;align-items:flex-end;gap:10px">
        <div class="form-group" style="flex:1;max-width:260px">
          <label class="form-label" for="saldo-efec-input">Saldo inicial de caja ($)</label>
          <input type="number" id="saldo-efec-input" class="form-input" step="0.01"
            value="${getConfig().saldo_inicial_efectivo ?? 0}" placeholder="0.00">
        </div>
        <button class="btn btn-primary btn-sm" id="btn-guardar-saldo-efec" style="margin-bottom:1px">Guardar</button>
      </div>
      <p class="text-muted text-sm mt-8">
        Efectivo con el que abre la caja física. Los movimientos se aplican sobre este valor.
      </p>
    </div>
  `;

  wrap.querySelector('#cfg-efec-trigger').addEventListener('click', () => {
    wrap.querySelector('#cfg-efec-trigger').classList.toggle('open');
    wrap.querySelector('#cfg-efec-content').classList.toggle('open');
  });
  wrap.querySelector('#btn-guardar-saldo-efec').addEventListener('click', () => {
    const val = parseFloat(wrap.querySelector('#saldo-efec-input').value);
    if (isNaN(val)) { showToast('Ingresa un valor numérico', 'warning'); return; }
    updateConfig({ saldo_inicial_efectivo: val });
    showToast('Saldo inicial de efectivo actualizado', 'success');
    _refreshEfectivoTodo();
  });

  return wrap;
}

// =====================================================
// HELPERS
// =====================================================
function _efectivoMeses() {
  const movs = getCollection(KEYS.EFECTIVO_MOV) ?? [];
  const meses = [...new Set(movs.map(m => m.fecha?.slice(0, 7)).filter(Boolean))].sort().reverse();
  const fmt = (ym) => {
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  };
  return meses.map(m => `<option value="${m}">${fmt(m)}</option>`).join('');
}

function svgEmptyEfectivo() {
  return `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="18" width="52" height="28" rx="4" stroke="currentColor" stroke-width="2"/>
    <circle cx="32" cy="32" r="7" stroke="currentColor" stroke-width="2"/>
    <line x1="14" y1="26" x2="18" y2="26" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <line x1="46" y1="38" x2="50" y2="38" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}
