/* =====================================================
   SOGRUB Bitácora — Módulo Fiscal
   Dashboard fiscal con KPIs, gráficas, desgloses y alertas
   ===================================================== */
'use strict';

// Estado local del módulo fiscal
const _fiscalState = {
  tipoPeriodo: 'mes',
  anio: new Date().getFullYear(),
  valor: new Date().getMonth() + 1,
  desdeCustom: '',
  hastaCustom: '',
  filtroProyecto: '',
  filtroEstatus: '',
  tabActiva: 'resumen',
};

let _fiscalCharts = {};
let _fiscalData = null;

// =====================================================
// RENDER PRINCIPAL
// =====================================================
function renderFiscal() {
  const root = document.getElementById('fiscal-root');
  if (!root) return;

  // Inicializar config fiscal si no existe
  initFiscalConfigSiVacio();

  const rango = _getFiscalRango();
  if (!rango) {
    root.innerHTML = '<div class="fiscal-container"><p class="text-muted">Selecciona un periodo válido.</p></div>';
    return;
  }

  _fiscalData = calcFiscalPeriodo(rango.desde, rango.hasta);
  const d = _fiscalData;

  root.innerHTML = `
    <div class="fiscal-container">
      <!-- HEADER -->
      <div class="fiscal-header">
        <div>
          <h2 class="fiscal-title">Módulo Fiscal</h2>
          <p class="text-muted text-sm">RESICO Persona Moral — Estimación interna</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-secondary btn-sm" id="fiscal-btn-config" title="Configuración fiscal">&#9881; Config</button>
          <button class="btn btn-secondary btn-sm" id="fiscal-btn-export-xl">&#128196; Excel</button>
          <button class="btn btn-secondary btn-sm" id="fiscal-btn-export-csv">&#128196; CSV</button>
          <button class="btn btn-secondary btn-sm" id="fiscal-btn-export-pdf">&#128196; PDF</button>
        </div>
      </div>

      <!-- FILTRO DE PERIODO -->
      <div class="fiscal-period-bar">
        ${_renderPeriodSelector()}
      </div>

      <!-- TABS -->
      <div class="fiscal-tabs">
        <button class="fiscal-tab ${_fiscalState.tabActiva === 'resumen' ? 'active' : ''}" data-tab="resumen">Resumen</button>
        <button class="fiscal-tab ${_fiscalState.tabActiva === 'proyectos' ? 'active' : ''}" data-tab="proyectos">Por Proyecto</button>
        <button class="fiscal-tab ${_fiscalState.tabActiva === 'categorias' ? 'active' : ''}" data-tab="categorias">Por Categoría</button>
        <button class="fiscal-tab ${_fiscalState.tabActiva === 'trazabilidad' ? 'active' : ''}" data-tab="trazabilidad">Trazabilidad</button>
        <button class="fiscal-tab ${_fiscalState.tabActiva === 'alertas' ? 'active' : ''}" data-tab="alertas">Alertas <span class="fiscal-alert-count">${d.alertas.length}</span></button>
      </div>

      <!-- CONTENIDO TAB -->
      <div id="fiscal-tab-content">
        ${_renderTabContent(d, rango)}
      </div>
    </div>
  `;

  _bindFiscalEvents();
  _renderFiscalCharts(d);
}

// =====================================================
// SELECTOR DE PERIODO
// =====================================================
function _renderPeriodSelector() {
  const s = _fiscalState;
  const anios = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 3; y <= currentYear + 1; y++) anios.push(y);

  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  let valorSelector = '';
  switch (s.tipoPeriodo) {
    case 'mes':
      valorSelector = `<select id="fiscal-valor" class="form-select form-select-sm">
        ${meses.map((m, i) => `<option value="${i+1}" ${s.valor === i+1 ? 'selected' : ''}>${m}</option>`).join('')}
      </select>`;
      break;
    case 'bimestre':
      valorSelector = `<select id="fiscal-valor" class="form-select form-select-sm">
        ${[1,2,3,4,5,6].map(b => `<option value="${b}" ${s.valor === b ? 'selected' : ''}>Bimestre ${b} (${meses[(b-1)*2]} - ${meses[(b-1)*2+1]})</option>`).join('')}
      </select>`;
      break;
    case 'trimestre':
      valorSelector = `<select id="fiscal-valor" class="form-select form-select-sm">
        ${[1,2,3,4].map(t => `<option value="${t}" ${s.valor === t ? 'selected' : ''}>T${t} (${meses[(t-1)*3]} - ${meses[(t-1)*3+2]})</option>`).join('')}
      </select>`;
      break;
    case 'semestre':
      valorSelector = `<select id="fiscal-valor" class="form-select form-select-sm">
        <option value="1" ${s.valor === 1 ? 'selected' : ''}>1er Semestre (Ene - Jun)</option>
        <option value="2" ${s.valor === 2 ? 'selected' : ''}>2do Semestre (Jul - Dic)</option>
      </select>`;
      break;
    case 'anual':
      valorSelector = '';
      break;
    case 'personalizado':
      valorSelector = `
        <input type="date" id="fiscal-desde" class="form-input form-input-sm" value="${s.desdeCustom}">
        <span class="text-muted">a</span>
        <input type="date" id="fiscal-hasta" class="form-input form-input-sm" value="${s.hastaCustom}">
      `;
      break;
  }

  return `
    <div class="fiscal-period-controls">
      <select id="fiscal-tipo-periodo" class="form-select form-select-sm">
        <option value="mes" ${s.tipoPeriodo === 'mes' ? 'selected' : ''}>Mensual</option>
        <option value="bimestre" ${s.tipoPeriodo === 'bimestre' ? 'selected' : ''}>Bimestral</option>
        <option value="trimestre" ${s.tipoPeriodo === 'trimestre' ? 'selected' : ''}>Trimestral</option>
        <option value="semestre" ${s.tipoPeriodo === 'semestre' ? 'selected' : ''}>Semestral</option>
        <option value="anual" ${s.tipoPeriodo === 'anual' ? 'selected' : ''}>Anual</option>
        <option value="personalizado" ${s.tipoPeriodo === 'personalizado' ? 'selected' : ''}>Personalizado</option>
      </select>
      ${s.tipoPeriodo !== 'personalizado' ? `
        <select id="fiscal-anio" class="form-select form-select-sm">
          ${anios.map(y => `<option value="${y}" ${s.anio === y ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
      ` : ''}
      ${valorSelector}
      <button class="btn btn-primary btn-sm" id="fiscal-btn-aplicar">Aplicar</button>
    </div>
    <div class="fiscal-period-label">
      ${_getPeriodLabel()}
    </div>
  `;
}

function _getPeriodLabel() {
  const rango = _getFiscalRango();
  if (!rango) return '';
  return `${formatDate(rango.desde)} — ${formatDate(rango.hasta)}`;
}

function _getFiscalRango() {
  const s = _fiscalState;
  if (s.tipoPeriodo === 'personalizado') {
    if (s.desdeCustom && s.hastaCustom) return { desde: s.desdeCustom, hasta: s.hastaCustom };
    return null;
  }
  return calcRangoPeriodo(s.tipoPeriodo, s.anio, s.valor);
}

// =====================================================
// CONTENIDO DE TABS
// =====================================================
function _renderTabContent(d, rango) {
  switch (_fiscalState.tabActiva) {
    case 'resumen':    return _renderResumen(d);
    case 'proyectos':  return _renderProyectos(d);
    case 'categorias': return _renderCategorias(d);
    case 'trazabilidad': return _renderTrazabilidad(rango);
    case 'alertas':    return _renderAlertas(d);
    default:           return _renderResumen(d);
  }
}

// =====================================================
// TAB: RESUMEN
// =====================================================
function _renderResumen(d) {
  const ivaTipo = d.iva_neto >= 0 ? 'a pagar' : 'a favor';
  const ivaClass = d.iva_neto >= 0 ? 'fiscal-kpi--danger' : 'fiscal-kpi--success';
  const utilClass = d.utilidad_fiscal >= 0 ? 'fiscal-kpi--success' : 'fiscal-kpi--danger';

  return `
    <!-- KPI CARDS -->
    <div class="fiscal-kpi-grid">
      <div class="fiscal-kpi">
        <div class="fiscal-kpi__label">Total Ingresos</div>
        <div class="fiscal-kpi__value">${formatMXN(d.ingresos.total)}</div>
        <div class="fiscal-kpi__detail">
          Base: ${formatMXN(d.ingresos.subtotal)} · IVA: ${formatMXN(d.ingresos.iva)}
        </div>
        <div class="fiscal-kpi__sub">Con IVA: ${formatMXN(d.ingresos.con_iva)} · Sin IVA: ${formatMXN(d.ingresos.sin_iva)}</div>
      </div>

      <div class="fiscal-kpi">
        <div class="fiscal-kpi__label">Total Gastos</div>
        <div class="fiscal-kpi__value">${formatMXN(d.gastos.total)}</div>
        <div class="fiscal-kpi__detail">
          Base: ${formatMXN(d.gastos.subtotal)} · IVA: ${formatMXN(d.gastos.iva)}
        </div>
        <div class="fiscal-kpi__sub">Con IVA: ${formatMXN(d.gastos.con_iva)} · Sin IVA: ${formatMXN(d.gastos.sin_iva)}</div>
      </div>

      <div class="fiscal-kpi">
        <div class="fiscal-kpi__label">IVA Trasladado</div>
        <div class="fiscal-kpi__value" style="color:var(--warning)">${formatMXN(d.iva_trasladado)}</div>
        <div class="fiscal-kpi__detail">${d.ingresos.count} ingresos con IVA</div>
      </div>

      <div class="fiscal-kpi">
        <div class="fiscal-kpi__label">IVA Acreditable</div>
        <div class="fiscal-kpi__value" style="color:var(--accent)">${formatMXN(d.iva_acreditable)}</div>
        <div class="fiscal-kpi__detail">Gastos deducibles con factura</div>
      </div>

      <div class="fiscal-kpi ${ivaClass}">
        <div class="fiscal-kpi__label">IVA Neto (${ivaTipo})</div>
        <div class="fiscal-kpi__value">${formatMXN(Math.abs(d.iva_neto))}</div>
        <div class="fiscal-kpi__detail">${d.iva_neto >= 0 ? 'Trasladado > Acreditable' : 'Saldo a favor'}</div>
      </div>

      <div class="fiscal-kpi">
        <div class="fiscal-kpi__label">ISR Estimado</div>
        <div class="fiscal-kpi__value" style="color:var(--danger)">${formatMXN(d.isr_estimado)}</div>
        <div class="fiscal-kpi__detail">Tasa: ${((getFiscalConfig().tasa_isr ?? 0.30) * 100).toFixed(0)}% sobre utilidad</div>
      </div>

      <div class="fiscal-kpi ${utilClass}">
        <div class="fiscal-kpi__label">Utilidad Fiscal</div>
        <div class="fiscal-kpi__value fiscal-kpi__value--lg">${formatMXN(d.utilidad_fiscal)}</div>
        <div class="fiscal-kpi__detail">Ingresos base − Gastos deducibles base</div>
      </div>

      <div class="fiscal-kpi">
        <div class="fiscal-kpi__label">Resumen del Periodo</div>
        <div class="fiscal-kpi__detail" style="margin-top:8px">
          <div>${d.proyectos_count} proyecto(s) involucrado(s)</div>
          <div>${d.movimientos_count} movimientos fiscales</div>
          <div>${d.ingresos.count} ingresos · ${d.gastos.count} gastos</div>
          <div>${d.alertas.length} alerta(s)</div>
        </div>
      </div>
    </div>

    <!-- FÓRMULAS TRANSPARENTES -->
    <div class="card" style="margin-top:20px">
      <div class="card-title" style="margin-bottom:12px">Detalle de cálculo</div>
      <div class="fiscal-formulas">
        <div class="fiscal-formula">
          <span class="fiscal-formula__label">IVA Neto</span>
          <span class="fiscal-formula__calc">
            ${formatMXN(d.iva_trasladado)} (trasladado) − ${formatMXN(d.iva_acreditable)} (acreditable) = <strong>${formatMXN(d.iva_neto)}</strong>
          </span>
        </div>
        <div class="fiscal-formula">
          <span class="fiscal-formula__label">Utilidad Fiscal</span>
          <span class="fiscal-formula__calc">
            ${formatMXN(d.ingresos.subtotal)} (ingresos base) − ${formatMXN(d.gastos.deducible_subtotal)} (gastos deducibles base) = <strong>${formatMXN(d.utilidad_fiscal)}</strong>
          </span>
        </div>
        <div class="fiscal-formula">
          <span class="fiscal-formula__label">ISR Estimado</span>
          <span class="fiscal-formula__calc">
            ${formatMXN(d.utilidad_fiscal > 0 ? d.utilidad_fiscal : 0)} × ${((getFiscalConfig().tasa_isr ?? 0.30) * 100).toFixed(0)}% = <strong>${formatMXN(d.isr_estimado)}</strong>
          </span>
        </div>
        ${d.gastos.no_deducible_total > 0 ? `
          <div class="fiscal-formula">
            <span class="fiscal-formula__label">Gastos no deducibles</span>
            <span class="fiscal-formula__calc">${formatMXN(d.gastos.no_deducible_total)} (excluidos del cálculo de utilidad)</span>
          </div>
        ` : ''}
      </div>
    </div>

    <!-- GRÁFICAS -->
    <div class="fiscal-charts-grid">
      <div class="card">
        <div class="card-title">Ingresos vs Gastos</div>
        <canvas id="fiscal-chart-ing-gas" height="220"></canvas>
      </div>
      <div class="card">
        <div class="card-title">Gastos por Categoría</div>
        <canvas id="fiscal-chart-categorias" height="220"></canvas>
      </div>
      <div class="card">
        <div class="card-title">IVA: Trasladado vs Acreditable</div>
        <canvas id="fiscal-chart-iva" height="220"></canvas>
      </div>
      <div class="card">
        <div class="card-title">Utilidad por Proyecto</div>
        <canvas id="fiscal-chart-utilidad" height="220"></canvas>
      </div>
    </div>

    <!-- PROYECTOS INVOLUCRADOS -->
    <div class="card" style="margin-top:20px">
      <div class="card-title">Proyectos en el periodo (${d.porProyecto.length})</div>
      ${d.porProyecto.length === 0 ? '<p class="text-muted text-sm">Sin movimientos fiscales en este periodo.</p>' : `
        <div class="table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Proyecto</th>
                <th class="text-right">Ingresos</th>
                <th class="text-right">Gastos</th>
                <th class="text-right">IVA Trasl.</th>
                <th class="text-right">IVA Acred.</th>
                <th class="text-right">Utilidad</th>
              </tr>
            </thead>
            <tbody>
              ${d.porProyecto.map(p => `
                <tr>
                  <td><strong>${p.nombre}</strong><br><span class="text-muted text-sm">${p.cliente}</span></td>
                  <td class="text-right">${formatMXN(p.ingresos_total)}</td>
                  <td class="text-right">${formatMXN(p.gastos_total)}</td>
                  <td class="text-right">${formatMXN(p.iva_trasladado)}</td>
                  <td class="text-right">${formatMXN(p.iva_acreditable)}</td>
                  <td class="text-right" style="color:${p.utilidad >= 0 ? 'var(--success)' : 'var(--danger)'}">${formatMXN(p.utilidad)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

// =====================================================
// TAB: POR PROYECTO (detallado)
// =====================================================
function _renderProyectos(d) {
  if (d.porProyecto.length === 0) {
    return '<div class="card"><p class="text-muted">Sin proyectos en este periodo.</p></div>';
  }

  return d.porProyecto.map(p => {
    const rango = _getFiscalRango();
    const movs = filtrarMovsPeriodo(rango.desde, rango.hasta)
      .filter(m => m.proyecto_id === p.proyecto_id && (m.tipo === 'abono_cliente' || m.tipo === 'gasto'));

    return `
      <div class="card fiscal-project-card">
        <div class="fiscal-project-header">
          <div>
            <h3 style="margin:0">${p.nombre}</h3>
            <span class="text-muted text-sm">${p.cliente}</span>
          </div>
          <div class="fiscal-project-kpis">
            <div class="fiscal-mini-kpi">
              <span class="text-sm text-muted">Ingresos</span>
              <strong style="color:var(--success)">${formatMXN(p.ingresos_total)}</strong>
            </div>
            <div class="fiscal-mini-kpi">
              <span class="text-sm text-muted">Gastos</span>
              <strong style="color:var(--danger)">${formatMXN(p.gastos_total)}</strong>
            </div>
            <div class="fiscal-mini-kpi">
              <span class="text-sm text-muted">Utilidad</span>
              <strong style="color:${p.utilidad >= 0 ? 'var(--success)' : 'var(--danger)'}">${formatMXN(p.utilidad)}</strong>
            </div>
            <div class="fiscal-mini-kpi">
              <span class="text-sm text-muted">IVA Trasl.</span>
              <strong>${formatMXN(p.iva_trasladado)}</strong>
            </div>
            <div class="fiscal-mini-kpi">
              <span class="text-sm text-muted">IVA Acred.</span>
              <strong>${formatMXN(p.iva_acreditable)}</strong>
            </div>
          </div>
        </div>
        <details class="fiscal-details">
          <summary class="fiscal-details-summary">${movs.length} movimientos en el periodo</summary>
          <div class="table-wrapper" style="margin-top:8px">
            <table class="data-table data-table--sm">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Concepto</th>
                  <th>Categoría</th>
                  <th class="text-right">Base</th>
                  <th class="text-right">IVA</th>
                  <th class="text-right">Total</th>
                  <th>Estatus</th>
                </tr>
              </thead>
              <tbody>
                ${movs.map(m => {
                  const dd = calcDesgloseFiscal(m.monto, m.incluye_iva);
                  const est = m.tipo === 'gasto' ? inferirEstatusFiscal(m) : null;
                  return `<tr>
                    <td>${formatDate(m.fecha)}</td>
                    <td>${tipoBadge(m.tipo)}</td>
                    <td>${m.concepto}</td>
                    <td>${m.categoria ? categoriaBadge(m.categoria) : '<span class="text-muted">—</span>'}</td>
                    <td class="text-right">${formatMXN(dd.subtotal)}</td>
                    <td class="text-right">${dd.iva > 0 ? formatMXN(dd.iva) : '—'}</td>
                    <td class="text-right">${formatMXN(dd.total)}</td>
                    <td>${est ? fiscalStatusBadge(est) : '—'}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    `;
  }).join('');
}

// =====================================================
// TAB: POR CATEGORÍA
// =====================================================
function _renderCategorias(d) {
  if (d.porCategoria.length === 0) {
    return '<div class="card"><p class="text-muted">Sin gastos en este periodo.</p></div>';
  }

  const totalGastos = d.gastos.total || 1;

  return `
    <div class="card">
      <div class="card-title">Distribución de gastos por categoría</div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th>Categoría</th>
              <th class="text-right"># Movs</th>
              <th class="text-right">Total</th>
              <th class="text-right">Base</th>
              <th class="text-right">IVA</th>
              <th class="text-right">Con IVA</th>
              <th class="text-right">Sin IVA</th>
              <th class="text-right">% del Total</th>
              <th>Proveedor principal</th>
            </tr>
          </thead>
          <tbody>
            ${d.porCategoria.map(c => {
              const pct = ((c.total / totalGastos) * 100).toFixed(1);
              const sinIvaPct = c.total > 0 ? ((c.sin_iva / c.total) * 100).toFixed(0) : 0;
              return `
                <tr>
                  <td>${categoriaBadge(c.nombre)}</td>
                  <td class="text-right">${c.count}</td>
                  <td class="text-right"><strong>${formatMXN(c.total)}</strong></td>
                  <td class="text-right">${formatMXN(c.subtotal)}</td>
                  <td class="text-right">${c.iva > 0 ? formatMXN(c.iva) : '—'}</td>
                  <td class="text-right">${formatMXN(c.con_iva)}</td>
                  <td class="text-right">${formatMXN(c.sin_iva)} ${parseInt(sinIvaPct) > 50 ? '<span class="badge badge-warning" style="font-size:9px">alto sin IVA</span>' : ''}</td>
                  <td class="text-right">${pct}%</td>
                  <td>${c.proveedor_principal}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Bar chart de categorías -->
    <div class="card" style="margin-top:16px">
      ${renderBarChart(
        Object.fromEntries(d.porCategoria.map(c => [c.nombre, c.total])),
        { title: 'Gasto por categoría' }
      )}
    </div>
  `;
}

// =====================================================
// TAB: TRAZABILIDAD
// =====================================================
function _renderTrazabilidad(rango) {
  const rows = calcTrazabilidadFiscal(rango.desde, rango.hasta);

  if (rows.length === 0) {
    return '<div class="card"><p class="text-muted">Sin registros fiscales en este periodo.</p></div>';
  }

  return `
    <div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>Trazabilidad fiscal — ${rows.length} registros</span>
        <div style="display:flex;gap:8px">
          <select id="fiscal-traz-filtro-tipo" class="form-select form-select-sm" style="width:auto">
            <option value="">Todos los tipos</option>
            <option value="Ingreso">Ingresos</option>
            <option value="Gasto">Gastos</option>
          </select>
          <select id="fiscal-traz-filtro-estatus" class="form-select form-select-sm" style="width:auto">
            <option value="">Todos los estatus</option>
            <option value="deducible_con_iva">Deducible + IVA</option>
            <option value="deducible_sin_iva">Deducible</option>
            <option value="no_deducible">No deducible</option>
            <option value="pendiente_revision">Pendiente</option>
          </select>
        </div>
      </div>
      <div class="table-wrapper">
        <table class="data-table data-table--sm" id="fiscal-trazabilidad-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Proyecto</th>
              <th>Tipo</th>
              <th>Concepto</th>
              <th>Categoría</th>
              <th>Proveedor</th>
              <th class="text-right">Base</th>
              <th class="text-right">IVA</th>
              <th class="text-right">Total</th>
              <th>IVA</th>
              <th>XML</th>
              <th>PDF</th>
              <th>Estatus</th>
              <th>Alertas</th>
            </tr>
          </thead>
          <tbody id="fiscal-traz-tbody">
            ${_renderTrazRows(rows)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function _renderTrazRows(rows) {
  return rows.map(r => `
    <tr class="${r.alertas.length > 0 ? 'fiscal-row-alert' : ''}">
      <td class="text-nowrap">${formatDate(r.fecha)}</td>
      <td>${r.proyecto_nombre}</td>
      <td>${tipoBadge(r.tipo_raw)}</td>
      <td>${r.concepto}</td>
      <td>${r.categoria !== '—' ? categoriaBadge(r.categoria) : '<span class="text-muted">—</span>'}</td>
      <td>${r.proveedor}</td>
      <td class="text-right">${formatMXN(r.subtotal)}</td>
      <td class="text-right">${r.iva > 0 ? formatMXN(r.iva) : '—'}</td>
      <td class="text-right"><strong>${formatMXN(r.total)}</strong></td>
      <td class="text-center">${ivaIndicator(r.incluye_iva)}</td>
      <td class="text-center">${cfdiIcon(r.tiene_xml)}</td>
      <td class="text-center">${cfdiIcon(r.tiene_pdf)}</td>
      <td>${r.estatus_fiscal ? fiscalStatusBadge(r.estatus_fiscal) : '—'}</td>
      <td>${r.alertas.length > 0
        ? r.alertas.map(a => `<span class="fiscal-alert-inline" title="${a.mensaje}">${alertaSeveridadIcon(a.tipo)}</span>`).join(' ')
        : '<span class="text-muted">—</span>'
      }</td>
    </tr>
  `).join('');
}

// =====================================================
// TAB: ALERTAS
// =====================================================
function _renderAlertas(d) {
  const errors = d.alertas.filter(a => a.tipo === 'error');
  const warnings = d.alertas.filter(a => a.tipo === 'warning');
  const infos = d.alertas.filter(a => a.tipo === 'info');

  if (d.alertas.length === 0) {
    return `<div class="card">
      <div class="fiscal-empty-alerts">
        <span style="font-size:32px">&#10003;</span>
        <p>Sin alertas fiscales en este periodo</p>
      </div>
    </div>`;
  }

  const renderGroup = (title, items, color, icon) => {
    if (items.length === 0) return '';
    return `
      <div class="card fiscal-alert-card" style="border-left:3px solid ${color}">
        <div class="card-title" style="color:${color}">${icon} ${title} (${items.length})</div>
        <ul class="fiscal-alert-list">
          ${items.map(a => {
            const proy = a.proyecto_id ? getItem(KEYS.PROYECTOS, a.proyecto_id) : null;
            return `<li>
              ${a.mensaje}
              ${proy ? `<span class="text-muted text-sm"> — ${proy.nombre}</span>` : ''}
            </li>`;
          }).join('')}
        </ul>
      </div>
    `;
  };

  return `
    ${renderGroup('Errores', errors, 'var(--danger)', '&#9888;')}
    ${renderGroup('Advertencias', warnings, 'var(--warning)', '&#9888;')}
    ${renderGroup('Información', infos, 'var(--accent)', '&#9432;')}
  `;
}

// =====================================================
// GRÁFICAS (Chart.js)
// =====================================================
function _renderFiscalCharts(d) {
  // Destruir charts anteriores
  Object.values(_fiscalCharts).forEach(c => { try { c.destroy(); } catch {} });
  _fiscalCharts = {};

  if (_fiscalState.tabActiva !== 'resumen') return;
  if (typeof Chart === 'undefined') return;

  const chartColors = {
    success: '#4caf82',
    danger: '#e05252',
    warning: '#e0a752',
    accent: '#1a9fd4',
    muted: '#666',
    purple: '#9b59b6',
    teal: '#1abc9c',
    orange: '#e67e22',
  };

  const chartDefaults = {
    color: '#999',
    borderColor: '#333',
    responsive: true,
    maintainAspectRatio: false,
  };

  // Chart 1: Ingresos vs Gastos
  const ctx1 = document.getElementById('fiscal-chart-ing-gas');
  if (ctx1) {
    _fiscalCharts.ingGas = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels: ['Ingresos', 'Gastos', 'Gastos Deducibles'],
        datasets: [{
          label: 'Base',
          data: [d.ingresos.subtotal, d.gastos.subtotal, d.gastos.deducible_subtotal],
          backgroundColor: [chartColors.success, chartColors.danger, chartColors.warning],
        }, {
          label: 'IVA',
          data: [d.ingresos.iva, d.gastos.iva, d.iva_acreditable],
          backgroundColor: [chartColors.success + '88', chartColors.danger + '88', chartColors.warning + '88'],
        }],
      },
      options: {
        ...chartDefaults,
        plugins: {
          legend: { labels: { color: '#999' } },
        },
        scales: {
          x: { ticks: { color: '#999' }, grid: { color: '#222' }, stacked: true },
          y: { ticks: { color: '#999', callback: v => formatMXN(v) }, grid: { color: '#222' }, stacked: true },
        },
      },
    });
  }

  // Chart 2: Gastos por categoría (doughnut)
  const ctx2 = document.getElementById('fiscal-chart-categorias');
  if (ctx2 && d.porCategoria.length > 0) {
    const catColors = [chartColors.accent, chartColors.success, chartColors.warning, chartColors.danger, chartColors.purple, chartColors.teal, chartColors.orange, chartColors.muted];
    _fiscalCharts.categorias = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: d.porCategoria.map(c => c.nombre),
        datasets: [{
          data: d.porCategoria.map(c => c.total),
          backgroundColor: d.porCategoria.map((_, i) => catColors[i % catColors.length]),
        }],
      },
      options: {
        ...chartDefaults,
        plugins: {
          legend: { position: 'right', labels: { color: '#999', padding: 12, font: { size: 11 } } },
        },
      },
    });
  }

  // Chart 3: IVA trasladado vs acreditable
  const ctx3 = document.getElementById('fiscal-chart-iva');
  if (ctx3) {
    _fiscalCharts.iva = new Chart(ctx3, {
      type: 'bar',
      data: {
        labels: ['IVA Trasladado', 'IVA Acreditable', 'IVA Neto'],
        datasets: [{
          data: [d.iva_trasladado, d.iva_acreditable, Math.abs(d.iva_neto)],
          backgroundColor: [chartColors.warning, chartColors.accent, d.iva_neto >= 0 ? chartColors.danger : chartColors.success],
        }],
      },
      options: {
        ...chartDefaults,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#999' }, grid: { color: '#222' } },
          y: { ticks: { color: '#999', callback: v => formatMXN(v) }, grid: { color: '#222' } },
        },
      },
    });
  }

  // Chart 4: Utilidad por proyecto
  const ctx4 = document.getElementById('fiscal-chart-utilidad');
  if (ctx4 && d.porProyecto.length > 0) {
    _fiscalCharts.utilidad = new Chart(ctx4, {
      type: 'bar',
      data: {
        labels: d.porProyecto.map(p => p.nombre.length > 20 ? p.nombre.slice(0, 20) + '…' : p.nombre),
        datasets: [{
          label: 'Utilidad',
          data: d.porProyecto.map(p => p.utilidad),
          backgroundColor: d.porProyecto.map(p => p.utilidad >= 0 ? chartColors.success : chartColors.danger),
        }],
      },
      options: {
        ...chartDefaults,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#999', callback: v => formatMXN(v) }, grid: { color: '#222' } },
          y: { ticks: { color: '#999', font: { size: 11 } }, grid: { color: '#222' } },
        },
      },
    });
  }
}

// =====================================================
// MODAL: CONFIGURACIÓN FISCAL
// =====================================================
function _abrirConfigFiscal() {
  const cfg = getFiscalConfig();

  const catRows = Object.entries(cfg.categorias_fiscal ?? {}).map(([nombre, c]) => `
    <tr>
      <td>${nombre}</td>
      <td><input type="checkbox" ${c.deducible ? 'checked' : ''} data-cat="${nombre}" data-field="deducible"></td>
      <td><input type="checkbox" ${c.iva_acreditable ? 'checked' : ''} data-cat="${nombre}" data-field="iva_acreditable"></td>
      <td><input type="checkbox" ${c.requiere_xml ? 'checked' : ''} data-cat="${nombre}" data-field="requiere_xml"></td>
    </tr>
  `).join('');

  const body = `
    <div class="fiscal-config-form">
      <div class="form-row" style="display:flex;gap:16px;margin-bottom:16px">
        <div style="flex:1">
          <label class="form-label">Tasa IVA (%)</label>
          <input type="number" id="fcfg-tasa-iva" class="form-input" value="${((cfg.tasa_iva ?? 0.16) * 100).toFixed(0)}" step="1" min="0" max="100">
        </div>
        <div style="flex:1">
          <label class="form-label">Tasa ISR estimada (%)</label>
          <input type="number" id="fcfg-tasa-isr" class="form-input" value="${((cfg.tasa_isr ?? 0.30) * 100).toFixed(0)}" step="1" min="0" max="100">
        </div>
      </div>

      <div style="margin-bottom:16px">
        <label class="form-label" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="fcfg-requiere-xml" ${cfg.reglas?.requiere_xml_para_iva_acreditable !== false ? 'checked' : ''}>
          Requiere XML para IVA acreditable
        </label>
      </div>

      <div>
        <label class="form-label">Tratamiento fiscal por categoría</label>
        <div class="table-wrapper">
          <table class="data-table data-table--sm">
            <thead>
              <tr>
                <th>Categoría</th>
                <th>Deducible</th>
                <th>IVA Acreditable</th>
                <th>Requiere XML</th>
              </tr>
            </thead>
            <tbody>${catRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  openModal({
    title: 'Configuración Fiscal',
    body,
    confirmText: 'Guardar',
    large: true,
    onConfirm: () => {
      const tasaIva = parseFloat(document.getElementById('fcfg-tasa-iva').value) / 100;
      const tasaIsr = parseFloat(document.getElementById('fcfg-tasa-isr').value) / 100;
      const requiereXml = document.getElementById('fcfg-requiere-xml').checked;

      const catsFiscal = { ...(cfg.categorias_fiscal ?? {}) };
      document.querySelectorAll('[data-cat]').forEach(el => {
        const cat = el.dataset.cat;
        const field = el.dataset.field;
        if (!catsFiscal[cat]) catsFiscal[cat] = {};
        catsFiscal[cat][field] = el.checked;
      });

      const newCfg = {
        tasa_iva: isNaN(tasaIva) ? 0.16 : tasaIva,
        tasa_isr: isNaN(tasaIsr) ? 0.30 : tasaIsr,
        categorias_fiscal: catsFiscal,
        reglas: { requiere_xml_para_iva_acreditable: requiereXml },
      };

      saveCollection(KEYS.FISCAL_CONFIG, newCfg);
      closeModal();
      showToast('Configuración fiscal guardada', 'success');
      renderFiscal();
    },
  });
}

// =====================================================
// EVENTOS
// =====================================================
function _bindFiscalEvents() {
  // Periodo
  document.getElementById('fiscal-btn-aplicar')?.addEventListener('click', () => {
    const tipo = document.getElementById('fiscal-tipo-periodo')?.value;
    _fiscalState.tipoPeriodo = tipo;
    _fiscalState.anio = parseInt(document.getElementById('fiscal-anio')?.value) || _fiscalState.anio;

    if (tipo === 'personalizado') {
      _fiscalState.desdeCustom = document.getElementById('fiscal-desde')?.value || '';
      _fiscalState.hastaCustom = document.getElementById('fiscal-hasta')?.value || '';
    } else {
      _fiscalState.valor = parseInt(document.getElementById('fiscal-valor')?.value) || 1;
    }
    renderFiscal();
  });

  // Tipo de periodo cambia → re-render para actualizar selector
  document.getElementById('fiscal-tipo-periodo')?.addEventListener('change', (e) => {
    _fiscalState.tipoPeriodo = e.target.value;
    renderFiscal();
  });

  // Tabs
  document.querySelectorAll('.fiscal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      _fiscalState.tabActiva = tab.dataset.tab;
      renderFiscal();
    });
  });

  // Config
  document.getElementById('fiscal-btn-config')?.addEventListener('click', _abrirConfigFiscal);

  // Export buttons
  document.getElementById('fiscal-btn-export-xl')?.addEventListener('click', () => {
    if (typeof exportFiscalExcel === 'function') exportFiscalExcel(_fiscalData, _getFiscalRango());
    else showToast('Exportación Excel no disponible', 'warning');
  });
  document.getElementById('fiscal-btn-export-csv')?.addEventListener('click', () => {
    if (typeof exportFiscalCSV === 'function') exportFiscalCSV(_fiscalData, _getFiscalRango());
    else showToast('Exportación CSV no disponible', 'warning');
  });
  document.getElementById('fiscal-btn-export-pdf')?.addEventListener('click', () => {
    if (typeof exportFiscalPDF === 'function') exportFiscalPDF(_fiscalData, _getFiscalRango());
    else showToast('Exportación PDF no disponible', 'warning');
  });

  // Trazabilidad filters
  document.getElementById('fiscal-traz-filtro-tipo')?.addEventListener('change', _filtrarTrazabilidad);
  document.getElementById('fiscal-traz-filtro-estatus')?.addEventListener('change', _filtrarTrazabilidad);
}

function _filtrarTrazabilidad() {
  const filtroTipo = document.getElementById('fiscal-traz-filtro-tipo')?.value || '';
  const filtroEstatus = document.getElementById('fiscal-traz-filtro-estatus')?.value || '';
  const rango = _getFiscalRango();
  if (!rango) return;

  let rows = calcTrazabilidadFiscal(rango.desde, rango.hasta);
  if (filtroTipo) rows = rows.filter(r => r.tipo === filtroTipo);
  if (filtroEstatus) rows = rows.filter(r => r.estatus_fiscal === filtroEstatus);

  const tbody = document.getElementById('fiscal-traz-tbody');
  if (tbody) tbody.innerHTML = _renderTrazRows(rows);
}
