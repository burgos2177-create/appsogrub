/* =====================================================
   SOGRUB Bitácora — Vista: Análisis Financiero Global
   ===================================================== */
'use strict';

// ---- Estado del módulo ----
let _analPeriodo = 'mes';
let _analDesde   = '';
let _analHasta   = '';
let _analProyId  = '';
let _analSubTab  = 'bitacora';
let _analBitPage = 0;
const _ANAL_PG   = 50;
let _analChartPer   = '6m';   // '3m'|'6m'|'1y'|'2y'|'all'
let _bitFiltOrig    = '';      // ''|'sogrub'|'proyecto'
let _bitFiltTipo    = '';      // ''|tipo value
let _bitFiltCat     = '';      // ''|categoria
let _bitFiltProv    = '';      // ''|text search

// =====================================================
// PUNTO DE ENTRADA
// =====================================================
function renderAnalisis() {
  const root = document.getElementById('analisis-root');
  if (!root) return;
  root.innerHTML = '';
  try {
    const hdr = document.createElement('div');
    hdr.className = 'mb-24';
    hdr.innerHTML = `
      <h2 style="font-size:18px;font-weight:600;color:var(--text);margin:0 0 4px">&#x1F4CA; An&aacute;lisis Financiero</h2>
      <p style="font-size:12px;color:var(--text-muted);margin:0">Consolidado de todos los movimientos &middot; Caja SOGRUB + Proyectos</p>
    `;
    root.appendChild(hdr);
    root.appendChild(_aControls());

    const { desde, hasta } = _aRange();
    const todos   = _aAllMovs();
    const periodo = _aFiltrar(todos, desde, hasta);
    const kpis    = _aCalcKPIs(periodo);

    root.appendChild(_aKPIGrid(kpis));
    root.appendChild(_aSubTabs());

    const content = document.createElement('div');
    content.id = 'anal-content';
    _aFillContent(content, todos, periodo, kpis, desde, hasta);
    root.appendChild(content);
  } catch (err) {
    console.error('[Analisis] Error al renderizar:', err);
    root.innerHTML = `
      <div style="margin:40px auto;max-width:600px;background:var(--surface);border:1px solid var(--danger);border-radius:var(--radius-lg);padding:24px">
        <div style="color:var(--danger);font-weight:700;font-size:15px;margin-bottom:8px">&#9888; Error al cargar An&aacute;lisis</div>
        <pre style="font-size:12px;color:var(--text-muted);white-space:pre-wrap;word-break:break-word">${err.message}\n\n${err.stack || ''}</pre>
      </div>
    `;
  }
}

// =====================================================
// CONTROLES
// =====================================================
function _aControls() {
  const proyectos = getCollection(KEYS.PROYECTOS) ?? [];
  const periods = [
    { key: 'semana', label: 'Esta semana' },
    { key: 'mes',    label: 'Este mes' },
    { key: 'a\u00f1o',    label: 'Este a\u00f1o' },
    { key: 'custom', label: 'Personalizado' },
  ];

  const wrap = document.createElement('div');
  wrap.className = 'card mb-24';
  wrap.style.cssText = 'padding:16px';
  wrap.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end">
      <div>
        <div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Per\u00edodo</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          ${periods.map(p => `<button class="period-pill${_analPeriodo === p.key ? ' active' : ''}" data-period="${p.key}">${p.label}</button>`).join('')}
        </div>
      </div>
      <div id="anal-custom-wrap" style="display:${_analPeriodo === 'custom' ? 'flex' : 'none'};gap:8px;align-items:flex-end">
        <div class="form-group" style="margin:0">
          <label class="form-label" style="margin-bottom:4px">Desde</label>
          <input type="date" class="form-input form-input--sm" id="anal-desde" value="${_analDesde}" style="width:140px">
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label" style="margin-bottom:4px">Hasta</label>
          <input type="date" class="form-input form-input--sm" id="anal-hasta" value="${_analHasta}" style="width:140px">
        </div>
      </div>
      <div>
        <div style="font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Origen</div>
        <select class="form-input form-input--sm" id="anal-proy-filter" style="min-width:200px">
          <option value="">Todos los movimientos</option>
          <option value="__sogrub__"${_analProyId === '__sogrub__' ? ' selected' : ''}>Solo Caja SOGRUB</option>
          ${proyectos.map(p => `<option value="${p.id}"${_analProyId === p.id ? ' selected' : ''}>${p.nombre}</option>`).join('')}
        </select>
      </div>
    </div>
  `;

  wrap.querySelectorAll('.period-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      _analPeriodo = btn.dataset.period;
      _analBitPage = 0;
      renderAnalisis();
    });
  });

  const desdeIn = wrap.querySelector('#anal-desde');
  const hastaIn = wrap.querySelector('#anal-hasta');
  if (desdeIn) desdeIn.addEventListener('change', () => { _analDesde = desdeIn.value; _analBitPage = 0; renderAnalisis(); });
  if (hastaIn) hastaIn.addEventListener('change', () => { _analHasta = hastaIn.value; _analBitPage = 0; renderAnalisis(); });

  wrap.querySelector('#anal-proy-filter').addEventListener('change', e => {
    _analProyId = e.target.value;
    _analBitPage = 0;
    renderAnalisis();
  });

  return wrap;
}

// =====================================================
// RANGO DE FECHAS
// =====================================================
function _aRange() {
  const now = new Date();
  let desde, hasta;
  if (_analPeriodo === 'semana') {
    const dow = now.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(now); mon.setDate(now.getDate() + diff);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    desde = mon.toISOString().slice(0, 10);
    hasta = sun.toISOString().slice(0, 10);
  } else if (_analPeriodo === 'mes') {
    const y = now.getFullYear(), m = now.getMonth() + 1;
    desde = `${y}-${String(m).padStart(2,'0')}-01`;
    hasta = `${y}-${String(m).padStart(2,'0')}-${new Date(y, m, 0).getDate()}`;
  } else if (_analPeriodo === 'a\u00f1o') {
    desde = `${now.getFullYear()}-01-01`;
    hasta = `${now.getFullYear()}-12-31`;
  } else {
    desde = _analDesde || `${now.getFullYear()}-01-01`;
    hasta = _analHasta || now.toISOString().slice(0, 10);
  }
  return { desde, hasta };
}

// =====================================================
// TODOS LOS MOVIMIENTOS (SOGRUB + proyectos)
// =====================================================
// Convierte valor de Firebase (array o objeto indexado) a array limpio
function _fbArr(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return Object.values(val).filter(Boolean);
}

function _aAllMovs() {
  const proyectos = _fbArr(getCollection(KEYS.PROYECTOS));
  const proyMap = {};
  proyectos.forEach(p => { if (p && p.id) proyMap[p.id] = p; });

  const movSOGRUB = _fbArr(getCollection(KEYS.MOVIMIENTOS)).map(m => ({
    ...m,
    _src:          'sogrub',
    _srcLabel:     'Caja SOGRUB',
    _proyNombre:   m.proyecto_id ? (proyMap[m.proyecto_id]?.nombre ?? '') : '',
    _tieneFactura: !!(m.factura_drive_url || m.factura_xml_url || m.factura_nombre || m.factura_xml_nombre),
    _interno:      m.tipo === 'transferencia_proyecto',
    _abs:          Math.abs(m.monto ?? 0),
  }));

  const movProy = _fbArr(getCollection(KEYS.PROY_MOVIMIENTOS)).map(m => ({
    ...m,
    _src:          'proyecto',
    _srcLabel:     proyMap[m.proyecto_id]?.nombre ?? 'Proyecto',
    _proyNombre:   proyMap[m.proyecto_id]?.nombre ?? 'Desconocido',
    _tieneFactura: !!(m.factura_drive_url || m.factura_xml_url || m.factura_nombre || m.factura_xml_nombre),
    _interno:      m.tipo === 'transferencia_sogrub',
    _abs:          Math.abs(m.monto ?? 0),
  }));

  return [...movSOGRUB, ...movProy]
    .sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''));
}

// =====================================================
// FILTRO por per\u00edodo y proyecto
// =====================================================
function _aFiltrar(movs, desde, hasta) {
  return movs.filter(m => {
    if (!m.fecha) return false;
    if (m.fecha < desde || m.fecha > hasta) return false;
    if (!_analProyId) return true;
    if (_analProyId === '__sogrub__') return m._src === 'sogrub';
    return m.proyecto_id === _analProyId;
  });
}

// =====================================================
// KPIs calculados
// =====================================================
function _aCalcKPIs(movs) {
  let ingresos = 0, egresos = 0, pendiente = 0;
  let conFactura = 0, sinFactura = 0, cntCon = 0, cntSin = 0;
  let ivaPagado = 0, ivaPorCobrar = 0;

  movs.forEach(m => {
    if (m._interno) return;
    const abs = m._abs;

    if (m._src === 'sogrub') {
      if (m.monto > 0) ingresos += abs;
      else             egresos  += abs;
      return;
    }
    if (m.tipo === 'abono_cliente') {
      ingresos += abs;
    } else if (m.tipo === 'gasto') {
      if (m.status === 'Pagado') {
        egresos += abs;
        if (m._tieneFactura) { conFactura += abs; cntCon++; }
        else                 { sinFactura += abs; cntSin++; }
        if (m.incluye_iva) ivaPagado    += abs - abs / 1.16;
        else               ivaPorCobrar += abs * 0.16;
      } else {
        pendiente += abs;
      }
    }
  });

  const totalGastos = conFactura + sinFactura;
  return {
    ingresos, egresos,
    balance:       ingresos - egresos,
    pendiente,
    conFactura, sinFactura, cntCon, cntSin,
    pctConFactura: totalGastos > 0 ? (conFactura / totalGastos * 100) : 0,
    ivaPagado, ivaPorCobrar,
    ivaTotal:      ivaPagado + ivaPorCobrar,
  };
}

// =====================================================
// KPI GRID — 6 cards en 3 columnas
// =====================================================
function _aKPIGrid(kpis) {
  const grid = document.createElement('div');
  grid.className = 'anal-kpi-grid';

  const cards = [
    { icon: '&#8593;', label: 'Ingresos',      value: kpis.ingresos,  cls: 'text-success',
      sub: 'Cobros de clientes + entradas SOGRUB' },
    { icon: '&#8595;', label: 'Egresos',        value: kpis.egresos,   cls: 'text-danger',
      sub: 'Gastos pagados + salidas SOGRUB' },
    { icon: '=',       label: 'Balance neto',   value: kpis.balance,
      cls: kpis.balance >= 0 ? 'text-success' : 'text-danger',
      sub: 'Ingresos &minus; Egresos del per&iacute;odo' },
    { icon: '&#x1F9FE;', label: 'Con factura',  value: kpis.conFactura, cls: 'text-success',
      sub: `${kpis.cntCon} gasto${kpis.cntCon !== 1 ? 's' : ''} &middot; ${kpis.pctConFactura.toFixed(1)}% del total` },
    { icon: '&#9888;', label: 'Sin factura',    value: kpis.sinFactura,
      cls: kpis.sinFactura > 0 ? 'text-warning' : 'text-muted',
      sub: `${kpis.cntSin} gasto${kpis.cntSin !== 1 ? 's' : ''} sin comprobante` },
    { icon: '&#x1F3DB;', label: 'IVA acumulado', value: kpis.ivaTotal, cls: 'text-accent',
      sub: `${formatMXN(kpis.ivaPagado)} pagado &middot; ${formatMXN(kpis.ivaPorCobrar)} potencial` },
  ];

  grid.innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div class="kpi-label">${c.icon} ${c.label}</div>
      <div class="kpi-value ${c.cls}">${formatMXN(c.value)}</div>
      <div class="kpi-sub">${c.sub}</div>
    </div>
  `).join('');

  return grid;
}

// =====================================================
// SUB-TABS
// =====================================================
function _aSubTabs() {
  const tabs = [
    { key: 'bitacora',   label: '&#x1F4CB; Bit&aacute;cora global' },
    { key: 'mensual',    label: '&#x1F4CA; Por per&iacute;odo' },
    { key: 'iva',        label: '&#x1F9FE; IVA' },
    { key: 'proyectos',  label: '&#x1F3D7; Por proyecto' },
    { key: 'categorias', label: '&#x1F3F7; Por categor&iacute;a' },
  ];

  const wrap = document.createElement('div');
  wrap.className = 'mb-16';
  wrap.style.cssText = 'border-bottom:1px solid var(--border)';
  wrap.innerHTML = `<div style="display:flex;gap:0;flex-wrap:wrap">
    ${tabs.map(t => {
      const a = _analSubTab === t.key;
      return `<button class="anal-subtab" data-tab="${t.key}"
        style="padding:9px 16px;border:none;background:none;
        color:${a ? 'var(--accent)' : 'var(--text-muted)'};
        font-size:13px;font-weight:${a ? '600' : '400'};cursor:pointer;
        border-bottom:2px solid ${a ? 'var(--accent)' : 'transparent'};
        transition:all var(--transition);margin-bottom:-1px;white-space:nowrap">
        ${t.label}
      </button>`;
    }).join('')}
  </div>`;

  wrap.querySelectorAll('.anal-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      _analSubTab = btn.dataset.tab;
      _analBitPage = 0;
      const { desde, hasta } = _aRange();
      const todos   = _aAllMovs();
      const periodo = _aFiltrar(todos, desde, hasta);
      const kpis    = _aCalcKPIs(periodo);
      const content = document.getElementById('anal-content');
      if (content) { content.innerHTML = ''; _aFillContent(content, todos, periodo, kpis, desde, hasta); }
      wrap.querySelectorAll('.anal-subtab').forEach(b => {
        const active = b.dataset.tab === _analSubTab;
        b.style.color        = active ? 'var(--accent)' : 'var(--text-muted)';
        b.style.fontWeight   = active ? '600' : '400';
        b.style.borderBottom = `2px solid ${active ? 'var(--accent)' : 'transparent'}`;
      });
    });
  });
  return wrap;
}

// =====================================================
// ROUTER de contenido
// =====================================================
function _aFillContent(el, todos, periodo, kpis, desde, hasta) {
  if (_analSubTab === 'bitacora')   el.appendChild(_aBitacora(periodo));
  if (_analSubTab === 'mensual')    el.appendChild(_aMensual(todos, desde, hasta));
  if (_analSubTab === 'iva')        el.appendChild(_aIVA(periodo));
  if (_analSubTab === 'proyectos')  el.appendChild(_aPorProyecto(periodo));
  if (_analSubTab === 'categorias') el.appendChild(_aCategorias(periodo));
}

// Helpers de clasificacion
function _aEsIngreso(m) {
  if (m._interno) return false;
  if (m._src === 'sogrub') return (m.monto ?? 0) > 0;
  return m.tipo === 'abono_cliente';
}
function _aEsEgreso(m) {
  if (m._interno) return false;
  if (m._src === 'sogrub') return (m.monto ?? 0) < 0;
  return m.tipo === 'gasto' && m.status === 'Pagado';
}
function _aTipoLabel(m) {
  if (m._src === 'sogrub') return tipoBadge(m.tipo, m._proyNombre);
  const map = {
    'gasto':                { cls: 'badge-danger',  label: 'Gasto' },
    'abono_cliente':        { cls: 'badge-success', label: 'Abono cliente' },
    'transferencia_sogrub': { cls: 'badge-info',    label: 'De SOGRUB' },
  };
  const d = map[m.tipo] ?? { cls: 'badge-muted', label: m.tipo };
  return `<span class="badge ${d.cls}">${d.label}</span>`;
}

// =====================================================
// TAB: BITACORA GLOBAL (paginada)
// =====================================================
function _aBitacora(movs) {
  const wrap  = document.createElement('div');
  const total = movs.length;
  const start = _analBitPage * _ANAL_PG;
  const page  = movs.slice(start, start + _ANAL_PG);

  if (total === 0) {
    wrap.appendChild(emptyState({ title: 'Sin movimientos en este per\u00edodo', desc: 'Ajusta el filtro de per\u00edodo u origen.' }));
    return wrap;
  }

  const info = document.createElement('div');
  info.style.cssText = 'font-size:12px;color:var(--text-muted);margin-bottom:10px';
  info.textContent = `Mostrando ${start + 1}\u2013${Math.min(start + _ANAL_PG, total)} de ${total} movimientos`;
  wrap.appendChild(info);

  const tw = document.createElement('div');
  tw.className = 'table-wrapper';

  const rows = page.map(m => {
    const esIng = _aEsIngreso(m);
    const esEgr = _aEsEgreso(m);
    const mCls  = m._interno ? 'text-muted'
                : esIng ? 'amount-positive'
                : esEgr ? 'amount-negative' : '';
    const mStr  = m._interno ? formatMXN(m._abs)
                : esIng ? `+${formatMXN(m._abs)}`
                : esEgr ? `-${formatMXN(m._abs)}`
                : formatMXN(m._abs);
    const origen = m._src === 'sogrub'
      ? '<span class="badge badge-info" style="font-size:10px">SOGRUB</span>'
      : `<span class="badge badge-muted" style="font-size:10px" title="${m._srcLabel}">${m._srcLabel.length > 18 ? m._srcLabel.slice(0,16)+'\u2026' : m._srcLabel}</span>`;
    const factIco = m._tieneFactura
      ? '<span style="color:var(--success);font-size:13px" title="Tiene factura">\u2713</span>'
      : '<span style="color:var(--text-dim)">\u2014</span>';
    const cat   = m.categoria ? categoriaBadge(m.categoria) : '<span class="text-dim">\u2014</span>';
    const prov  = m.subcontratista || '\u2014';
    const est   = m.status ? statusBadge(m.status) : '<span class="text-dim">\u2014</span>';
    const conc  = m.concepto ?? '\u2014';
    return `<tr class="${m._interno ? 'row-dim' : ''}">
      <td style="white-space:nowrap">${formatDate(m.fecha)}</td>
      <td>${origen}</td>
      <td>${_aTipoLabel(m)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${conc}">${conc}</td>
      <td>${cat}</td>
      <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${prov}</td>
      <td class="${mCls}" style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:600">${mStr}</td>
      <td style="text-align:center">${factIco}</td>
      <td>${est}</td>
    </tr>`;
  }).join('');

  tw.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>Fecha</th><th>Origen</th><th>Tipo</th><th>Concepto</th>
        <th>Categor&iacute;a</th><th>Proveedor</th>
        <th style="text-align:right">Monto</th>
        <th style="text-align:center">Factura</th><th>Estado</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  wrap.appendChild(tw);

  if (total > _ANAL_PG) {
    const totalPages = Math.ceil(total / _ANAL_PG);
    const pag = document.createElement('div');
    pag.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:12px';
    pag.innerHTML = `
      <button class="btn btn-secondary btn-sm" id="anal-prev" ${_analBitPage === 0 ? 'disabled' : ''}>\u2190 Anterior</button>
      <span style="font-size:12px;color:var(--text-muted)">P&aacute;gina ${_analBitPage + 1} de ${totalPages}</span>
      <button class="btn btn-secondary btn-sm" id="anal-next" ${_analBitPage >= totalPages - 1 ? 'disabled' : ''}>Siguiente \u2192</button>
    `;
    const goPage = (dir) => {
      _analBitPage = Math.max(0, Math.min(totalPages - 1, _analBitPage + dir));
      const c = document.getElementById('anal-content');
      if (c) { const {desde, hasta} = _aRange(); const t=_aAllMovs(),p=_aFiltrar(t,desde,hasta),k=_aCalcKPIs(p); c.innerHTML=''; _aFillContent(c,t,p,k,desde,hasta); }
    };
    pag.querySelector('#anal-prev').addEventListener('click', () => goPage(-1));
    pag.querySelector('#anal-next').addEventListener('click', () => goPage(1));
    wrap.appendChild(pag);
  }
  return wrap;
}

// =====================================================
// TAB: POR PERIODO — TradingView-style canvas chart
// =====================================================
function _aMensual(todos, desde, hasta) {
  const MESES   = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const MESES_L = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  const wrap = document.createElement('div');
  wrap.className = 'card';

  // Period selector row
  const periods = [
    { key: '3m', label: '3M' },
    { key: '6m', label: '6M' },
    { key: '1y', label: '1Y' },
    { key: '2y', label: '2Y' },
    { key: 'all', label: 'ALL' },
  ];

  const perRow = document.createElement('div');
  perRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px';
  perRow.innerHTML = `
    <h3 class="section-title" style="margin:0">Evoluci\u00f3n por per\u00edodo</h3>
    <div style="display:flex;gap:4px">
      ${periods.map(p => `<button class="period-pill${_analChartPer === p.key ? ' active' : ''}" data-cper="${p.key}" style="min-width:36px">${p.label}</button>`).join('')}
    </div>
  `;
  perRow.querySelectorAll('[data-cper]').forEach(btn => {
    btn.addEventListener('click', () => {
      _analChartPer = btn.dataset.cper;
      const c = document.getElementById('anal-content');
      if (c) {
        const {desde: d0, hasta: d1} = _aRange();
        const t = _aAllMovs(), p = _aFiltrar(t, d0, d1), k = _aCalcKPIs(p);
        c.innerHTML = '';
        _aFillContent(c, t, p, k, d0, d1);
      }
    });
  });
  wrap.appendChild(perRow);

  // Compute date range for selected chart period
  const now = new Date();
  function chartCutoff(per) {
    const d = new Date(now);
    if (per === '3m')  { d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10); }
    if (per === '6m')  { d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10); }
    if (per === '1y')  { d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); }
    if (per === '2y')  { d.setFullYear(d.getFullYear() - 2); return d.toISOString().slice(0, 10); }
    return null; // all
  }
  const cutoff = chartCutoff(_analChartPer);
  const useWeeks = _analChartPer === '3m';
  const gran = useWeeks ? 'semana' : 'mes';
  const granLab = useWeeks ? 'Semana' : 'Mes';

  // Build groups from ALL todos (not filtered by date range)
  const grupos = {};
  todos.filter(m => m.fecha && !m._interno && (!cutoff || m.fecha >= cutoff)).forEach(m => {
    let key;
    if (gran === 'semana') {
      const d = new Date(m.fecha + 'T00:00:00');
      const dow = d.getDay() === 0 ? -6 : 1 - d.getDay();
      const mon = new Date(d); mon.setDate(d.getDate() + dow);
      key = mon.toISOString().slice(0, 10);
    } else {
      key = m.fecha.slice(0, 7);
    }
    if (!grupos[key]) grupos[key] = { ingresos: 0, egresos: 0, count: 0 };
    if (_aEsIngreso(m)) { grupos[key].ingresos += m._abs; grupos[key].count++; }
    if (_aEsEgreso(m))  { grupos[key].egresos  += m._abs; grupos[key].count++; }
  });

  const keys = Object.keys(grupos).sort();

  function keyLabel(k, short) {
    if (gran === 'mes') {
      const [y, mo] = k.split('-');
      const label = (short ? MESES : MESES_L)[parseInt(mo) - 1];
      return short ? label : `${label} ${y}`;
    }
    return `Sem. ${formatDate(k)}`;
  }
  function keyLabelLong(k) {
    if (gran === 'mes') { const [y, mo] = k.split('-'); return `${MESES_L[parseInt(mo)-1]} ${y}`; }
    return `Semana del ${formatDate(k)}`;
  }

  if (keys.length === 0) {
    wrap.appendChild(emptyState({ title: 'Sin movimientos en este per\u00edodo' }));
    return wrap;
  }

  // Build groups array for chart
  const groups = keys.map(k => ({ key: k, label: keyLabel(k, false), ingresos: grupos[k].ingresos, egresos: grupos[k].egresos }));

  // Canvas chart container
  const chartContainer = document.createElement('div');
  chartContainer.style.cssText = 'position:relative;margin-bottom:20px';
  wrap.appendChild(chartContainer);
  _aTVChart(chartContainer, groups);

  // Summary table
  const totIng = keys.reduce((a,k)=>a+grupos[k].ingresos,0);
  const totEgr = keys.reduce((a,k)=>a+grupos[k].egresos,0);
  const totBal = totIng - totEgr;
  const tw = document.createElement('div');
  tw.className = 'table-wrapper';
  tw.innerHTML = `
    <table class="data-table">
      <thead><tr>
        <th>${granLab}</th>
        <th style="text-align:right">Ingresos</th>
        <th style="text-align:right">Egresos</th>
        <th style="text-align:right">Balance</th>
        <th style="text-align:right">Movs.</th>
      </tr></thead>
      <tbody>
        ${keys.map(k=>{const g=grupos[k];const bal=g.ingresos-g.egresos;return `
          <tr>
            <td><strong>${keyLabelLong(k)}</strong></td>
            <td style="text-align:right" class="amount-positive">+${formatMXN(g.ingresos)}</td>
            <td style="text-align:right" class="amount-negative">-${formatMXN(g.egresos)}</td>
            <td style="text-align:right" class="${bal>=0?'amount-positive':'amount-negative'}">${bal>=0?'+':''}${formatMXN(bal)}</td>
            <td style="text-align:right;color:var(--text-muted)">${g.count}</td>
          </tr>`;}).join('')}
        <tr style="border-top:2px solid var(--border);font-weight:700">
          <td>Total</td>
          <td style="text-align:right" class="amount-positive">+${formatMXN(totIng)}</td>
          <td style="text-align:right" class="amount-negative">-${formatMXN(totEgr)}</td>
          <td style="text-align:right" class="${totBal>=0?'amount-positive':'amount-negative'}">${totBal>=0?'+':''}${formatMXN(totBal)}</td>
          <td style="text-align:right;color:var(--text-muted)">${keys.reduce((a,k)=>a+grupos[k].count,0)}</td>
        </tr>
      </tbody>
    </table>
  `;
  wrap.appendChild(tw);
  return wrap;
}

// =====================================================
// HELPER: TradingView-style canvas chart
// =====================================================
function _aTVChart(container, groups) {
  const PAD = { top: 20, right: 16, bottom: 40, left: 72 };
  const H = 280;

  // Closure state
  let _canvas, _ctx, _W, _scales, _groups;

  function fmtAmt(v) {
    if (Math.abs(v) >= 1e6) return '$' + (v/1e6).toFixed(1).replace(/\.0$/,'') + 'M';
    if (Math.abs(v) >= 1e3) return '$' + (v/1e3).toFixed(0) + 'K';
    return '$' + Math.round(v);
  }

  function buildScales(w) {
    const cW = w - PAD.left - PAD.right;
    const cH = H - PAD.top - PAD.bottom;
    const n  = groups.length;

    const maxIE = Math.max(...groups.map(g => Math.max(g.ingresos, g.egresos)), 1);
    const rawBals = groups.map(g => g.ingresos - g.egresos);
    const maxAbsBal = Math.max(...rawBals.map(Math.abs), 1);
    const balMid  = (Math.max(...rawBals) + Math.min(...rawBals)) / 2;
    const balRange = maxAbsBal * 1.5;

    const xPos = (i) => PAD.left + (n <= 1 ? cW / 2 : i / (n - 1) * cW);
    const yIE  = (v) => PAD.top + cH - (v / (maxIE * 1.1)) * cH;
    const yBal = (v) => PAD.top + cH / 2 - ((v - balMid) / balRange) * cH;

    return { cW, cH, n, maxIE, rawBals, balMid, balRange, xPos, yIE, yBal };
  }

  function drawChart(hoverIdx) {
    const ctx = _ctx;
    const w = _W;
    const sc = _scales;
    const { cW, cH, n, maxIE, xPos, yIE, yBal } = sc;

    ctx.clearRect(0, 0, w, H);

    // Chart area background
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(PAD.left, PAD.top, cW, cH);

    // Horizontal grid lines + Y labels
    const nLines = 5;
    for (let i = 0; i <= nLines; i++) {
      const frac = i / nLines;
      const val  = maxIE * 1.1 * (1 - frac);
      const y    = PAD.top + frac * cH;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '11px system-ui,sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(fmtAmt(val), PAD.left - 6, y + 4);
    }

    // X-axis labels (max 8)
    const maxLabels = 8;
    const step = Math.max(1, Math.ceil(n / maxLabels));
    for (let i = 0; i < n; i += step) {
      const x = xPos(i);
      // Vertical grid line
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + cH); ctx.stroke();
      // Label
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '11px system-ui,sans-serif';
      ctx.textAlign = 'center';
      const lbl = groups[i].label;
      ctx.fillText(lbl, x, PAD.top + cH + 16);
    }

    // Ingresos area
    ctx.beginPath();
    ctx.moveTo(xPos(0), PAD.top + cH);
    for (let i = 0; i < n; i++) ctx.lineTo(xPos(i), yIE(groups[i].ingresos));
    ctx.lineTo(xPos(n - 1), PAD.top + cH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(34,197,94,0.12)';
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < n; i++) { if (i === 0) ctx.moveTo(xPos(i), yIE(groups[i].ingresos)); else ctx.lineTo(xPos(i), yIE(groups[i].ingresos)); }
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Egresos area
    ctx.beginPath();
    ctx.moveTo(xPos(0), PAD.top + cH);
    for (let i = 0; i < n; i++) ctx.lineTo(xPos(i), yIE(groups[i].egresos));
    ctx.lineTo(xPos(n - 1), PAD.top + cH);
    ctx.closePath();
    ctx.fillStyle = 'rgba(239,68,68,0.12)';
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < n; i++) { if (i === 0) ctx.moveTo(xPos(i), yIE(groups[i].egresos)); else ctx.lineTo(xPos(i), yIE(groups[i].egresos)); }
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Balance dashed line
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = xPos(i);
      const y = yBal(groups[i].ingresos - groups[i].egresos);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Hover crosshair
    if (hoverIdx != null && hoverIdx >= 0 && hoverIdx < n) {
      const hx = xPos(hoverIdx);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(hx, PAD.top); ctx.lineTo(hx, PAD.top + cH); ctx.stroke();
      ctx.setLineDash([]);

      // Dots
      [[yIE(groups[hoverIdx].ingresos), '#22c55e'],
       [yIE(groups[hoverIdx].egresos),  '#ef4444'],
       [yBal(groups[hoverIdx].ingresos - groups[hoverIdx].egresos), '#60a5fa']
      ].forEach(([hy, color]) => {
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#1a2030';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }
  }

  function initCanvas() {
    _canvas = document.createElement('canvas');
    _W = container.offsetWidth || 600;
    _canvas.width  = _W;
    _canvas.height = H;
    _canvas.style.cssText = 'width:100%;height:' + H + 'px;display:block';
    _ctx    = _canvas.getContext('2d');
    _groups = groups;
    _scales = buildScales(_W);
    container.appendChild(_canvas);
    drawChart(null);

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;gap:16px;justify-content:center;margin-top:10px;font-size:12px;color:rgba(255,255,255,0.6)';
    legend.innerHTML = [
      ['#22c55e', 'Ingresos'],
      ['#ef4444', 'Egresos'],
      ['#60a5fa', 'Balance neto'],
    ].map(([color, label]) =>
      `<span style="display:flex;align-items:center;gap:5px">
        <span style="width:10px;height:10px;border-radius:2px;background:${color};display:inline-block;flex-shrink:0"></span>${label}
      </span>`
    ).join('');
    container.appendChild(legend);

    // Tooltip
    const tooltip = document.createElement('div');
    tooltip.style.cssText = 'position:absolute;pointer-events:none;background:rgba(15,20,30,0.92);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:8px 12px;font-size:12px;color:#e2e8f0;display:none;z-index:10;min-width:160px;white-space:nowrap';
    container.appendChild(tooltip);

    _canvas.addEventListener('mousemove', (e) => {
      const rect = _canvas.getBoundingClientRect();
      const mx   = (e.clientX - rect.left) * (_W / rect.width);
      if (!_scales || _scales.n < 1) return;
      const { n, xPos } = _scales;
      // Find nearest index
      let nearest = 0, minDist = Infinity;
      for (let i = 0; i < n; i++) {
        const dist = Math.abs(xPos(i) - mx);
        if (dist < minDist) { minDist = dist; nearest = i; }
      }
      drawChart(nearest);
      const g   = groups[nearest];
      const bal = g.ingresos - g.egresos;
      tooltip.innerHTML = `
        <div style="font-weight:600;margin-bottom:5px;color:#94a3b8">${g.label}</div>
        <div style="color:#22c55e">Ingresos &nbsp;+${formatMXN(g.ingresos)}</div>
        <div style="color:#ef4444">Egresos &nbsp;&nbsp;-${formatMXN(g.egresos)}</div>
        <div style="color:#60a5fa;margin-top:3px;border-top:1px solid rgba(255,255,255,0.08);padding-top:3px">Balance &nbsp;${bal>=0?'+':''}${formatMXN(bal)}</div>
      `;
      // Position tooltip
      const hx   = xPos(nearest);
      const flip  = hx > _W * 0.65;
      tooltip.style.display  = 'block';
      tooltip.style.top      = (PAD.top + 4) + 'px';
      tooltip.style.left     = flip ? '' : (hx + 12) + 'px';
      tooltip.style.right    = flip ? (_W - hx + 12) + 'px' : '';
    });

    _canvas.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
      drawChart(null);
    });
  }

  // Defer so container has layout
  if (container.offsetWidth > 0) {
    initCanvas();
  } else {
    requestAnimationFrame(() => { if (container.offsetWidth > 0) initCanvas(); });
  }
}

// =====================================================
// TAB: IVA — desglose fiscal
// =====================================================
function _aIVA(movs) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:16px';

  const gastos = movs.filter(m => m._src === 'proyecto' && m.tipo === 'gasto' && m.status === 'Pagado');
  let neto=0, ivaPag=0, ivaVerif=0, ivaPorCob=0;
  const conIVA=[], sinIVA=[];

  gastos.forEach(m => {
    const abs = m._abs;
    if (m.incluye_iva) {
      const ivaM = abs - abs/1.16;
      neto   += abs/1.16; ivaPag += ivaM;
      if (m._tieneFactura) ivaVerif += ivaM;
      conIVA.push({ ...m, _ivaAmt: ivaM });
    } else {
      neto += abs; ivaPorCob += abs*0.16;
      sinIVA.push({ ...m, _ivaPot: abs*0.16 });
    }
  });

  const kpiWrap = document.createElement('div');
  kpiWrap.className = 'anal-kpi-grid';
  kpiWrap.style.gridTemplateColumns = 'repeat(2,1fr)';
  kpiWrap.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">&#x1F3DB; IVA pagado (facturado)</div>
      <div class="kpi-value text-success">${formatMXN(ivaPag)}</div>
      <div class="kpi-sub">${conIVA.length} gasto${conIVA.length!==1?'s':''} con IVA incluido</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">&#10003; IVA verificado</div>
      <div class="kpi-value text-accent">${formatMXN(ivaVerif)}</div>
      <div class="kpi-sub">IVA con factura adjunta en sistema</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">&#9888; IVA potencial sin factura</div>
      <div class="kpi-value text-warning">${formatMXN(ivaPorCob)}</div>
      <div class="kpi-sub">${sinIVA.length} gasto${sinIVA.length!==1?'s':''} sin comprobante</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">&#x1F4B0; Base gravable (sin IVA)</div>
      <div class="kpi-value">${formatMXN(neto)}</div>
      <div class="kpi-sub">Monto neto total de gastos</div>
    </div>
  `;
  wrap.appendChild(kpiWrap);

  if (gastos.length === 0) {
    const emp = document.createElement('div'); emp.className='card';
    emp.appendChild(emptyState({ title: 'Sin gastos pagados en este per\u00edodo' }));
    wrap.appendChild(emp); return wrap;
  }

  if (conIVA.length > 0) {
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<div class="card-header"><h3 class="section-title" style="margin:0">Gastos con IVA incluido</h3><span class="badge badge-success">${conIVA.length}</span></div>`;
    const tw = document.createElement('div'); tw.className = 'table-wrapper';
    tw.innerHTML = `<table class="data-table"><thead><tr>
      <th>Fecha</th><th>Proyecto</th><th>Concepto</th><th>Proveedor</th>
      <th style="text-align:right">Monto bruto</th>
      <th style="text-align:right">Base (&divide;1.16)</th>
      <th style="text-align:right">IVA 16%</th><th>Factura</th>
    </tr></thead><tbody>
      ${conIVA.map(m=>`<tr>
        <td style="white-space:nowrap">${formatDate(m.fecha)}</td>
        <td>${m._proyNombre}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.concepto??'\u2014'}</td>
        <td>${m.subcontratista||'\u2014'}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${formatMXN(m._abs)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${formatMXN(m._abs/1.16)}</td>
        <td style="text-align:right;color:var(--accent);font-weight:600;font-variant-numeric:tabular-nums">${formatMXN(m._ivaAmt)}</td>
        <td>${m._tieneFactura?'<span style="color:var(--success);font-weight:600">\u2713 S\u00ed</span>':'<span style="color:var(--warning)">\u2717 No</span>'}</td>
      </tr>`).join('')}
    </tbody></table>`;
    card.appendChild(tw); wrap.appendChild(card);
  }

  if (sinIVA.length > 0) {
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<div class="card-header"><h3 class="section-title" style="margin:0">Gastos sin factura \u2014 IVA potencial</h3><span class="badge badge-warning">${sinIVA.length}</span></div>`;
    const tw = document.createElement('div'); tw.className = 'table-wrapper';
    tw.innerHTML = `<table class="data-table"><thead><tr>
      <th>Fecha</th><th>Proyecto</th><th>Concepto</th><th>Proveedor</th>
      <th style="text-align:right">Monto</th><th style="text-align:right">IVA potencial</th>
    </tr></thead><tbody>
      ${sinIVA.map(m=>`<tr>
        <td style="white-space:nowrap">${formatDate(m.fecha)}</td>
        <td>${m._proyNombre}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.concepto??'\u2014'}</td>
        <td>${m.subcontratista||'\u2014'}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${formatMXN(m._abs)}</td>
        <td style="text-align:right;color:var(--warning);font-weight:600;font-variant-numeric:tabular-nums">${formatMXN(m._ivaPot)}</td>
      </tr>`).join('')}
    </tbody></table>`;
    card.appendChild(tw); wrap.appendChild(card);
  }
  return wrap;
}

// =====================================================
// TAB: POR PROYECTO
// =====================================================
function _aPorProyecto(movs) {
  const wrap = document.createElement('div');
  wrap.className = 'card';

  const byPid = {};
  movs.forEach(m => {
    if (m._interno) return;
    const pid = m._src === 'sogrub' ? '__sogrub__' : (m.proyecto_id || '__sogrub__');
    if (!byPid[pid]) byPid[pid] = {
      nombre: m._src === 'sogrub' ? 'Caja SOGRUB' : m._srcLabel,
      src: m._src, ingresos:0, egresos:0, pendiente:0, conFactura:0, sinFactura:0,
    };
    const d = byPid[pid];
    if (_aEsIngreso(m)) d.ingresos += m._abs;
    if (_aEsEgreso(m))  { d.egresos += m._abs; if (m._tieneFactura) d.conFactura+=m._abs; else d.sinFactura+=m._abs; }
    if (m.tipo==='gasto'&&m.status==='Pendiente') d.pendiente += m._abs;
  });

  const rows = Object.entries(byPid).sort((a,b)=>(b[1].ingresos-b[1].egresos)-(a[1].ingresos-a[1].egresos));

  wrap.innerHTML = `
    <div class="card-header">
      <h3 class="section-title" style="margin:0">Balance por proyecto / origen</h3>
      <span class="badge badge-info">${rows.length} fuente${rows.length!==1?'s':''}</span>
    </div>
  `;

  if (rows.length === 0) { wrap.appendChild(emptyState({ title: 'Sin datos en este per\u00edodo' })); return wrap; }

  const tw = document.createElement('div');
  tw.className = 'table-wrapper';
  tw.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>Proyecto / Origen</th>
      <th style="text-align:right">Ingresos</th>
      <th style="text-align:right">Egresos</th>
      <th style="text-align:right">Balance</th>
      <th style="text-align:right">Pendiente</th>
      <th style="text-align:right">Con factura</th>
      <th style="text-align:right">Sin factura</th>
      <th>% Facturado</th>
    </tr></thead>
    <tbody>
      ${rows.map(([pid,d])=>{
        const bal = d.ingresos-d.egresos;
        const tot = d.conFactura+d.sinFactura;
        const pct = tot>0?(d.conFactura/tot*100).toFixed(0):null;
        const nav = pid!=='__sogrub__';
        return `<tr class="${nav?'row-clickable':''}" ${nav?`data-pid="${pid}"`:''}
          title="${nav?'Ver detalle del proyecto':''}">
          <td><div style="display:flex;align-items:center;gap:8px">
            ${d.src==='sogrub'?'<span class="badge badge-info">SOGRUB</span>':'<span class="badge badge-muted">Proyecto</span>'}
            <strong>${d.nombre}</strong>
          </div></td>
          <td style="text-align:right" class="amount-positive">${d.ingresos>0?`+${formatMXN(d.ingresos)}`:'&mdash;'}</td>
          <td style="text-align:right" class="amount-negative">${d.egresos>0?`-${formatMXN(d.egresos)}`:'&mdash;'}</td>
          <td style="text-align:right" class="${bal>=0?'amount-positive':'amount-negative'}">${bal>=0?'+':''}${formatMXN(bal)}</td>
          <td style="text-align:right" class="${d.pendiente>0?'text-warning':'text-muted'}">${d.pendiente>0?formatMXN(d.pendiente):'&mdash;'}</td>
          <td style="text-align:right" class="text-success">${d.conFactura>0?formatMXN(d.conFactura):'&mdash;'}</td>
          <td style="text-align:right" class="${d.sinFactura>0?'text-warning':'text-muted'}">${d.sinFactura>0?formatMXN(d.sinFactura):'&mdash;'}</td>
          <td>${pct!==null?`<div style="display:flex;align-items:center;gap:6px">
            <div style="flex:1;height:5px;background:var(--surface3);border-radius:3px;min-width:50px">
              <div style="height:100%;width:${pct}%;background:var(--success);border-radius:3px"></div>
            </div>
            <span style="font-size:11px;color:var(--text-muted)">${pct}%</span>
          </div>`:'<span class="text-dim">&mdash;</span>'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;

  tw.querySelectorAll('.row-clickable').forEach(row => {
    row.addEventListener('click', () => navigateTo('detalle', row.dataset.pid));
  });
  wrap.appendChild(tw);
  return wrap;
}

// =====================================================
// TAB: POR CATEGORIA y proveedores
// =====================================================
function _aCategorias(movs) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:16px';

  const gastos = movs.filter(m => !m._interno && (
    (m._src==='sogrub' && (m.monto??0)<0) ||
    (m._src==='proyecto' && m.tipo==='gasto' && m.status==='Pagado')
  ));

  const byCat  = {}, byProv = {};
  const COLORS  = { 'Material':'#1a9fd4','Mano de Obra':'#4caf82','Subcontratista':'#e05252','Indirecto':'#e0a752' };

  gastos.forEach(m => {
    const cat  = m.categoria || 'Sin categor\u00eda';
    const prov = m.subcontratista || '(Sin proveedor)';
    if (!byCat[cat])   byCat[cat]   = { total:0, conFactura:0, count:0 };
    if (!byProv[prov]) byProv[prov] = { total:0, count:0 };
    byCat[cat].total  += m._abs; byCat[cat].count++;
    byProv[prov].total+= m._abs; byProv[prov].count++;
    if (m._tieneFactura) byCat[cat].conFactura += m._abs;
  });

  // --- Card Categorias ---
  const catCard = document.createElement('div');
  catCard.className = 'card';
  catCard.innerHTML = '<div class="card-header"><h3 class="section-title" style="margin:0">Gastos por categor\u00eda</h3></div>';

  const catRows = Object.entries(byCat).sort((a,b)=>b[1].total-a[1].total);
  const totalG  = catRows.reduce((a,[,d])=>a+d.total,0);

  if (catRows.length === 0) {
    catCard.appendChild(emptyState({ title: 'Sin gastos pagados en este per\u00edodo' }));
  } else {
    const maxCat = catRows[0][1].total;
    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'padding:4px 0 16px';
    catRows.forEach(([cat,d]) => {
      const pctBar   = (d.total/maxCat*100).toFixed(1);
      const pctTotal = totalG>0?(d.total/totalG*100).toFixed(1):0;
      const sinFact  = d.total-d.conFactura;
      const pctFact  = d.total>0?(d.conFactura/d.total*100).toFixed(0):0;
      const color    = COLORS[cat]||'#9b59b6';
      const div = document.createElement('div');
      div.style.cssText = 'margin-bottom:14px';
      div.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="display:flex;align-items:center;gap:8px">
            ${categoriaBadge(cat)}
            <span style="font-size:11px;color:var(--text-muted)">${d.count} mov.</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:11px;color:var(--text-muted)">${pctTotal}% del total</span>
            <span style="font-size:13px;font-weight:700;font-variant-numeric:tabular-nums">${formatMXN(d.total)}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:9px;background:var(--surface3);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pctBar}%;background:${color};border-radius:3px;transition:width .3s"></div>
          </div>
          <span style="font-size:11px;min-width:58px;text-align:right;color:${parseInt(pctFact)>=70?'var(--success)':'var(--warning)'}">
            ${pctFact}% fact.
          </span>
        </div>`;
      barWrap.appendChild(div);
    });
    catCard.appendChild(barWrap);

    const tw = document.createElement('div'); tw.className='table-wrapper';
    tw.innerHTML = `<table class="data-table">
      <thead><tr>
        <th>Categor\u00eda</th>
        <th style="text-align:right">Total</th>
        <th style="text-align:right">Con factura</th>
        <th style="text-align:right">Sin factura</th>
        <th>% Facturado</th>
        <th style="text-align:right">Movs.</th>
      </tr></thead>
      <tbody>
        ${catRows.map(([cat,d])=>{
          const sinFact=d.total-d.conFactura;
          const pctFact=d.total>0?(d.conFactura/d.total*100).toFixed(0):0;
          return `<tr>
            <td>${categoriaBadge(cat)}</td>
            <td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums">${formatMXN(d.total)}</td>
            <td style="text-align:right" class="text-success">${d.conFactura>0?formatMXN(d.conFactura):'&mdash;'}</td>
            <td style="text-align:right" class="${sinFact>0?'text-warning':'text-muted'}">${sinFact>0?formatMXN(sinFact):'&mdash;'}</td>
            <td><div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:5px;background:var(--surface3);border-radius:2px;min-width:50px">
                <div style="height:100%;width:${pctFact}%;background:var(--success);border-radius:2px"></div>
              </div>
              <span style="font-size:11px">${pctFact}%</span>
            </div></td>
            <td style="text-align:right;color:var(--text-muted)">${d.count}</td>
          </tr>`;}).join('')}
        <tr style="border-top:2px solid var(--border);font-weight:700">
          <td>Total</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums">${formatMXN(totalG)}</td>
          <td style="text-align:right" class="text-success">${formatMXN(catRows.reduce((a,[,d])=>a+d.conFactura,0))}</td>
          <td style="text-align:right" class="text-warning">${formatMXN(catRows.reduce((a,[,d])=>a+(d.total-d.conFactura),0))}</td>
          <td></td>
          <td style="text-align:right;color:var(--text-muted)">${catRows.reduce((a,[,d])=>a+d.count,0)}</td>
        </tr>
      </tbody>
    </table>`;
    catCard.appendChild(tw);
  }
  wrap.appendChild(catCard);

  // --- Card Proveedores ---
  const provCard = document.createElement('div');
  provCard.className = 'card';
  const provRows = Object.entries(byProv).sort((a,b)=>b[1].total-a[1].total).slice(0,15);
  provCard.innerHTML = `<div class="card-header">
    <h3 class="section-title" style="margin:0">Top proveedores / subcontratistas</h3>
    <span class="badge badge-muted">${Object.keys(byProv).length} proveedores</span>
  </div>`;
  if (provRows.length === 0) {
    provCard.appendChild(emptyState({ title: 'Sin gastos en este per\u00edodo' }));
  } else {
    const provData = {};
    provRows.forEach(([p,d])=>{ provData[p]=d.total; });
    provCard.innerHTML += renderBarChart(provData);
  }
  wrap.appendChild(provCard);

  return wrap;
}
