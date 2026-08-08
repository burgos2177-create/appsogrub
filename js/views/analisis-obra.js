/* =====================================================
   SOGRUB Bitácora — Sub-tab: Análisis financiero de la obra
   Vista tipo "asesor financiero": evolución de la caja,
   flujo de entradas vs salidas, curvas acumuladas contra
   contrato, composición del gasto y lectura automática.
   ===================================================== */
'use strict';

const _aoState = { rango: 'todo', gran: 'mes', incluirPendientes: true };
let _aoCharts = {};

const _AO_COLORS = {
  success: '#4caf82',
  danger:  '#e05252',
  warning: '#e0a752',
  accent:  '#1a9fd4',
  muted:   '#8a8f98',
  purple:  '#9b59b6',
  teal:    '#1abc9c',
  orange:  '#e67e22',
};

const _AO_CAT_COLORS = {
  'Material':        _AO_COLORS.accent,
  'Mano de Obra':    _AO_COLORS.success,
  'Subcontratista':  _AO_COLORS.danger,
  'Indirecto':       _AO_COLORS.warning,
};
const _AO_CAT_FALLBACK = [_AO_COLORS.purple, _AO_COLORS.teal, _AO_COLORS.orange, _AO_COLORS.muted];

function destroyAnalisisObraCharts() {
  Object.values(_aoCharts).forEach(c => { try { c.destroy(); } catch {} });
  _aoCharts = {};
}

// =====================================================
// DATA PREP
// =====================================================

function _aoMovsProyecto(proyectoId) {
  return (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.fecha)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// Lunes de la semana de una fecha ISO (clave de bucket semanal)
function _aoMonday(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function _aoBucketKey(fecha, gran) {
  return gran === 'semana' ? _aoMonday(fecha) : fecha.slice(0, 7);
}

function _aoNextBucket(key, gran) {
  if (gran === 'semana') {
    const d = new Date(key + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }
  let [y, m] = key.split('-').map(Number);
  m++; if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function _aoBucketLabel(key, gran) {
  if (gran === 'semana') {
    const d = new Date(key + 'T00:00:00');
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  }
  const d = new Date(key + '-01T00:00:00');
  return d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
}

// Serie completa por buckets continuos (desde el primer movimiento hasta hoy).
// deltaSaldo replica las reglas de calcSaldoCajaProyecto (excluye caja chica
// pagada, resta depósitos a caja chica); gastado es la vista de COSTO (todo
// gasto pagado, incluido el pagado con caja chica).
function _aoSeries(proyectoId, gran) {
  const movs = _aoMovsProyecto(proyectoId);
  if (!movs.length) return null;

  let first = _aoBucketKey(movs[0].fecha, gran);
  let last  = _aoBucketKey(todayISO(), gran);
  if (last < first) last = first;

  const keys = [];
  for (let k = first; keys.length < 420; k = _aoNextBucket(k, gran)) {
    keys.push(k);
    if (k >= last) break;
  }
  const idx = {};
  keys.forEach((k, i) => { idx[k] = i; });
  const Z = () => keys.map(() => 0);

  const s = {
    keys,
    labels: keys.map(k => _aoBucketLabel(k, gran)),
    cobrado: Z(), sogrub: Z(), gastado: Z(), gastoPend: Z(), deltaSaldo: Z(),
    porCat: {},
  };

  for (const m of movs) {
    let i = idx[_aoBucketKey(m.fecha, gran)];
    if (i === undefined) i = m.fecha <= keys[0] ? 0 : keys.length - 1;
    const abs = Math.abs(m.monto);

    if (m.tipo === 'abono_cliente') {
      s.cobrado[i] += abs;
      s.deltaSaldo[i] += m.monto;
    } else if (m.tipo === 'transferencia_sogrub') {
      s.sogrub[i] += m.monto;
      s.deltaSaldo[i] += m.monto;
    } else if (m.tipo === 'gasto') {
      if (m.status === 'Pagado') {
        s.gastado[i] += abs;
        const cat = m.categoria || 'Sin categoría';
        if (!s.porCat[cat]) s.porCat[cat] = Z();
        s.porCat[cat][i] += abs;
        if (!m.paga_de_caja_chica) s.deltaSaldo[i] -= abs;
      } else {
        s.gastoPend[i] += abs;
      }
    } else if (m.tipo === 'deposito_caja_chica' && m.status === 'Pagado') {
      s.deltaSaldo[i] -= abs;
    } else if (m.tipo === 'devolucion_caja_chica' && m.status === 'Pagado') {
      // El fondo de efectivo devolvió billete a SOGRUB: la caja del proyecto
      // recupera el monto (inverso del depósito).
      s.deltaSaldo[i] += abs;
    }
  }

  const acc = (arr) => { let t = 0; return arr.map(v => t += v); };
  s.saldoAcum   = acc(s.deltaSaldo);
  s.cobradoAcum = acc(s.cobrado);
  s.gastadoAcum = acc(s.gastado);
  return s;
}

// Recorta la serie al rango elegido. Los acumulados ya traen el arrastre
// histórico (se calculan antes del corte), así que las curvas no "reinician".
function _aoAplicarRango(s, rango, gran) {
  const meses = { '3m': 3, '6m': 6, '12m': 12 }[rango];
  if (!meses) return s;
  const d = new Date();
  d.setMonth(d.getMonth() - meses);
  const cutoff = _aoBucketKey(d.toISOString().slice(0, 10), gran);
  const from = s.keys.findIndex(k => k >= cutoff);
  if (from <= 0) return s;

  const cut = arr => arr.slice(from);
  const out = {
    keys: cut(s.keys), labels: cut(s.labels),
    cobrado: cut(s.cobrado), sogrub: cut(s.sogrub),
    gastado: cut(s.gastado), gastoPend: cut(s.gastoPend),
    deltaSaldo: cut(s.deltaSaldo), saldoAcum: cut(s.saldoAcum),
    cobradoAcum: cut(s.cobradoAcum), gastadoAcum: cut(s.gastadoAcum),
    porCat: {},
  };
  for (const [c, arr] of Object.entries(s.porCat)) out.porCat[c] = cut(arr);
  return out;
}

// Formato corto para ejes: $1.2M / $350k
function _aoMoney(v) {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}k`;
  return `${sign}$${Math.round(a)}`;
}

// =====================================================
// KPIs DE ANÁLISIS
// =====================================================
function _aoKPIs(proyectoId) {
  const movs = _aoMovsProyecto(proyectoId);

  // Burn rate: promedio mensual del gasto pagado en los últimos 90 días
  const d90 = new Date();
  d90.setDate(d90.getDate() - 90);
  const corte90 = d90.toISOString().slice(0, 10);
  const gasto90 = movs
    .filter(m => m.tipo === 'gasto' && m.status === 'Pagado' && m.fecha >= corte90)
    .reduce((a, m) => a + Math.abs(m.monto), 0);
  const burnRate = gasto90 / 3;

  const saldo   = calcSaldoCajaProyecto(proyectoId);
  const runway  = burnRate > 0 ? saldo / burnRate : null;   // meses

  const cobrado = calcTotalCobradoCliente(proyectoId);
  const gastado = calcTotalGastadoPagado(proyectoId);
  const margenReal = cobrado > 0 ? ((cobrado - gastado) / cobrado) * 100 : null;

  const b = calcBolsitasProyecto(proyectoId);
  const margenPlan = b.contrato > 0 ? (b.utilidadPlaneada / b.contrato) * 100 : null;

  const sogrubNeto = movs
    .filter(m => m.tipo === 'transferencia_sogrub')
    .reduce((a, m) => a + m.monto, 0);

  return {
    burnRate, saldo, runway, cobrado, gastado,
    margenReal, margenPlan, bolsitas: b,
    sogrubNeto, flujoNeto: cobrado - gastado,
    deuda: calcDeudaPendiente(proyectoId),
  };
}

// =====================================================
// TARJETA "LECTURA COMO TRADE"
// Separa lo ganado de verdad (posición cerrada) de lo que todavía está por
// materializarse (posición abierta). El anticipo del cliente NO es utilidad:
// es efectivo flotante que se gana ejecutando.
// =====================================================
function _aoHaceCuanto(ms) {
  const t = Number(ms);
  if (!Number.isFinite(t) || t <= 0) return '';
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1)    return 'hace un momento';
  if (min < 60)   return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)     return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

function _aoTradeCard(proyectoId) {
  const t = calcLecturaTrade(proyectoId);
  const card = document.createElement('div');
  card.className = 'card mb-24';

  if (!t.tieneAvance) {
    card.innerHTML = `
      <h3 class="section-title" style="margin-bottom:6px">📉 Lectura como trade</h3>
      <p class="text-muted text-sm" style="line-height:1.55;margin:0 0 10px">
        Pendiente: sin el valor de venta de lo ya ejecutado no se puede separar la
        utilidad realizada del anticipo del cliente, y lo único medible es flujo de caja.
      </p>
      ${t.obraId ? `
        <div style="padding:10px 12px;background:var(--surface2);border-left:3px solid var(--accent);border-radius:var(--radius);font-size:12px;line-height:1.6;color:var(--text-muted)">
          La obra <b>sí está vinculada</b> (<code>${t.obraId}</code>), pero estimaciones todavía
          no publica su avance en <code>/shared/avanceObra/${t.obraId}</code>.
          <div style="margin-top:6px">
            <b>Cómo activarlo:</b> bitácora solo <i>lee</i> ese dato — lo escribe la app de
            estimaciones. Pídele al ingeniero que abra la obra y entre al
            <b>RESUMEN</b>: al hacerlo se publica el avance ejecutado y esta tarjeta se llena sola.
          </div>
        </div>`
      : `
        <div style="padding:10px 12px;background:var(--surface2);border-left:3px solid var(--warning);border-radius:var(--radius);font-size:12px;line-height:1.6;color:var(--text-muted)">
          Este proyecto <b>no tiene obra vinculada</b> en <code>/shared/obraLinks</code>, así que
          no hay de dónde leer el avance. El pareo se hace desde estimaciones
          (Admin → Vincular obras ↔ proyectos) o desde la consola central.
        </div>`}`;
    return card;
  }

  const M = (v) => formatMXN(v);
  const signo = (v) => v >= 0 ? 'text-success' : 'text-danger';

  const bloque = (etiqueta, valor, sub, clase, grande) => `
    <div style="flex:1;min-width:150px">
      <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px">${etiqueta}</div>
      <div class="${clase || ''}" style="font-size:${grande ? 22 : 16}px;font-weight:700;font-variant-numeric:tabular-nums">${valor}</div>
      ${sub ? `<div class="text-muted" style="font-size:11px;margin-top:2px;line-height:1.35">${sub}</div>` : ''}
    </div>`;

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:14px">
      <h3 class="section-title" style="margin:0">📉 Lectura como trade</h3>
      <span class="text-muted" style="font-size:11px">
        Avance ejecutado ${t.avanceEjecutado !== null ? t.avanceEjecutado.toFixed(1) + '%' : '—'}
        ${t.updatedAt ? ` · dato de estimaciones ${_aoHaceCuanto(t.updatedAt)}` : ''}
      </span>
    </div>

    <div style="display:flex;gap:20px;flex-wrap:wrap;padding-bottom:14px;border-bottom:1px solid var(--border)">
      ${bloque('✅ PnL realizado <span style="text-transform:none;letter-spacing:0">(ya ganado)</span>',
        M(t.pnlRealizado),
        `${M(t.vEjec)} ejecutado − ${M(t.cIncurrido)} gastado`, signo(t.pnlRealizado), true)}
      ${bloque('Margen realizado',
        t.margenRealizado !== null ? t.margenRealizado.toFixed(1) + '%' : '—',
        t.margenEsperado !== null ? `esperado ${t.margenEsperado.toFixed(1)}%` : '', signo(t.pnlRealizado), true)}
    </div>

    <div style="display:flex;gap:20px;flex-wrap:wrap;padding:14px 0;border-bottom:1px solid var(--border)">
      ${bloque('⏳ PnL flotante <span style="text-transform:none;letter-spacing:0">(por materializar)</span>',
        M(t.pnlFlotante),
        'lo que queda por ganar al terminar la obra', signo(t.pnlFlotante))}
      ${bloque('🎯 Utilidad esperada',
        M(t.utilidadEsperada),
        `${M(t.vContrato)} contrato − ${M(t.cPresup)} costo presupuestado`, signo(t.utilidadEsperada))}
    </div>

    <div style="padding-top:14px">
      ${bloque('💧 Efectivo flotante del cliente',
        M(t.efectivoFlotante),
        `${M(t.netoCobrado)} cobrado neto − ${M(t.vEjec)} ejecutado · dinero en tu caja que <b>aún no es tuyo</b>: se gana ejecutando`,
        t.efectivoFlotante > 0 ? 'text-warning' : 'text-muted')}
    </div>

    <div style="margin-top:14px;padding:10px 12px;background:var(--surface2);border-radius:var(--radius);font-size:11px;color:var(--text-muted);line-height:1.55">
      <div>✔ ${M(t.pnlRealizado)} realizado + ${M(t.pnlFlotante)} flotante = ${M(t.utilidadEsperada)} esperada</div>
      <div style="margin-top:6px">
        El <b>flujo de caja</b> (cobrado − gastado) de esta obra va en <b>${M(t.flujoCaja)}</b>, pero eso
        no es utilidad: ${M(Math.max(0, t.efectivoFlotante))} de ese dinero es anticipo por obra que
        todavía no ejecutas.
      </div>
      <div style="margin-top:6px">
        El realizado asume que lo gastado corresponde a lo ejecutado. Si compraste material para obra
        futura, se ve bajo temporalmente (es inventario) y se recupera al instalarlo — el flotante lo absorbe.
      </div>
    </div>
  `;
  return card;
}

// =====================================================
// LECTURA FINANCIERA (insights automáticos)
// =====================================================
function _aoInsights(proyectoId, k) {
  const out = [];
  const push = (nivel, texto) => out.push({ nivel, texto });

  // 1. Cliente vs SOGRUB: ¿quién está fondeando la obra?
  if (k.flujoNeto < 0) {
    push('bad', `La obra ha gastado <strong>${formatMXN(-k.flujoNeto)}</strong> más de lo cobrado al cliente — ese hueco lo está financiando SOGRUB${k.sogrubNeto > 0 ? ` (transferido a la fecha: ${formatMXN(k.sogrubNeto)})` : ''}. Conviene empujar cobranza o una estimación.`);
  } else if (k.cobrado > 0) {
    push('ok', `El cliente va fondeando el gasto: lo cobrado supera lo gastado por <strong>${formatMXN(k.flujoNeto)}</strong>.`);
  }

  // 2. Margen REALIZADO vs esperado. Se compara contra lo ejecutado, no
  // contra lo cobrado: el anticipo del cliente no es utilidad.
  const t = calcLecturaTrade(proyectoId);
  if (t.tieneAvance && t.margenRealizado !== null && t.margenEsperado !== null) {
    const diff = t.margenRealizado - t.margenEsperado;
    if (diff < -5) {
      push('warn', `El margen <strong>realizado</strong> va en ${t.margenRealizado.toFixed(1)}% contra ${t.margenEsperado.toFixed(1)}% esperado — ${Math.abs(diff).toFixed(1)} pts abajo. De lo ejecutado (${formatMXN(t.vEjec)}) has ganado ${formatMXN(t.pnlRealizado)}. Si no es material comprado por adelantado, el costo se está comiendo la utilidad.`);
    } else {
      push('ok', `El margen <strong>realizado</strong> (${t.margenRealizado.toFixed(1)}%) va en línea o mejor que el esperado (${t.margenEsperado.toFixed(1)}%).`);
    }
    if (t.efectivoFlotante > 0) {
      push('info', `De tu caja, <strong>${formatMXN(t.efectivoFlotante)}</strong> es anticipo del cliente por obra que aún no ejecutas: es dinero recibido, no ganado. Lo conviertes en utilidad ejecutando.`);
    }
  } else if (!t.tieneAvance) {
    push('info', `Sin el avance de estimaciones solo se puede medir flujo de caja. La "utilidad" que ves como cobrado − gastado incluye el anticipo del cliente y sobrestima lo ganado.`);
  }

  // 3. Runway de caja
  if (k.saldo <= 0) {
    push('bad', `La caja de la obra está en <strong>${formatMXN(k.saldo)}</strong> — los gastos recientes se están cubriendo con dinero de SOGRUB, no de la obra.`);
  } else if (k.runway !== null && k.runway < 1) {
    push('warn', `Al ritmo de gasto actual (${formatMXN(k.burnRate)}/mes), la caja alcanza para <strong>~${Math.max(1, Math.round(k.runway * 4.33))} semana(s)</strong>. Programa cobranza o fondeo.`);
  }

  // 4. Sobregiro de bolsitas → utilidad
  if (k.bolsitas.contrato > 0 && k.bolsitas.overflowTotal > 0) {
    push('bad', `Hay sobregiros de presupuesto por <strong>${formatMXN(k.bolsitas.overflowTotal)}</strong> que se comen la utilidad: disponible ${formatMXN(k.bolsitas.utilidadDisponible)} de ${formatMXN(k.bolsitas.utilidadPlaneada)} planeada.`);
  }

  // 5. Deuda vs caja
  if (k.deuda > 0 && k.deuda > k.saldo) {
    push('warn', `La deuda a proveedores (<strong>${formatMXN(k.deuda)}</strong>) supera el saldo en caja (${formatMXN(k.saldo)}); al pagarla, la obra quedará en negativo si no entra cobranza antes.`);
  }

  // 6. Concentración de proveedor
  const porProv = calcGastoPorProveedor(proyectoId);
  const provs = Object.entries(porProv).filter(([n]) => n !== 'Sin proveedor');
  const totalProv = provs.reduce((a, [, v]) => a + v, 0);
  if (totalProv > 0 && k.gastado > 0) {
    const [topN, topV] = provs.sort((a, b) => b[1] - a[1])[0];
    const share = (topV / k.gastado) * 100;
    if (share > 40) {
      push('info', `<strong>${topN}</strong> concentra el ${share.toFixed(0)}% del gasto de la obra (${formatMXN(topV)}). Alta dependencia de un solo proveedor.`);
    }
  }

  // 7. Balance de IVA
  const ivaCob = calcIVACobradoCliente(proyectoId);
  const ivaDes = calcIVADesglose(proyectoId);
  const ivaBal = ivaCob.ivaTotal - ivaDes.ivaPagado;
  if (ivaCob.ivaTotal > 0 && ivaBal < 0) {
    push('info', `Has pagado ${formatMXN(-ivaBal)} más de IVA en gastos del que has cobrado al cliente en esta obra — IVA a favor acumulándose.`);
  }

  return out;
}

// =====================================================
// ENTRY POINT — llamado desde renderDetalle
// =====================================================
function renderAnalisisObraTab(proyectoId) {
  const wrap = document.getElementById('analisis-obra-tab-wrap');
  if (!wrap) return;
  destroyAnalisisObraCharts();
  wrap.innerHTML = '';

  const movs = _aoMovsProyecto(proyectoId);
  if (!movs.length) {
    wrap.appendChild(emptyState({
      icon:  svgEmptyMovimientos(),
      title: 'Sin datos para analizar',
      desc:  'Cuando la obra tenga movimientos (gastos, abonos, transferencias) aquí verás su panorama financiero.',
    }));
    return;
  }

  const k = _aoKPIs(proyectoId);
  const trade = calcLecturaTrade(proyectoId);
  const proyecto = getItem(KEYS.PROYECTOS, proyectoId);

  // ---- Toolbar de filtros ----
  const bar = document.createElement('div');
  bar.className = 'toolbar mb-16';
  bar.style.flexWrap = 'wrap';
  const _pill = (grupo, val, label) => {
    const active = _aoState[grupo] === val;
    return `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}" data-grupo="${grupo}" data-val="${val}">${label}</button>`;
  };
  bar.innerHTML = `
    <span class="text-muted text-sm">Periodo:</span>
    ${_pill('rango', 'todo', 'Todo')}
    ${_pill('rango', '12m', '12 m')}
    ${_pill('rango', '6m', '6 m')}
    ${_pill('rango', '3m', '3 m')}
    <span class="text-muted text-sm" style="margin-left:10px">Agrupar por:</span>
    ${_pill('gran', 'mes', 'Mes')}
    ${_pill('gran', 'semana', 'Semana')}
    <div class="toolbar-spacer"></div>
    <label class="text-sm text-muted" style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" id="ao-chk-pend" ${_aoState.incluirPendientes ? 'checked' : ''}>
      Mostrar gasto pendiente
    </label>
  `;
  bar.querySelectorAll('button[data-grupo]').forEach(btn =>
    btn.addEventListener('click', () => {
      _aoState[btn.dataset.grupo] = btn.dataset.val;
      renderAnalisisObraTab(proyectoId);
    })
  );
  bar.querySelector('#ao-chk-pend').addEventListener('change', e => {
    _aoState.incluirPendientes = e.target.checked;
    renderAnalisisObraTab(proyectoId);
  });
  wrap.appendChild(bar);

  // ---- KPIs de análisis ----
  const runwayTxt = k.saldo <= 0 ? '0 meses'
    : k.runway === null ? '∞'
    : k.runway >= 1 ? `${k.runway.toFixed(1)} meses`
    : `~${Math.max(1, Math.round(k.runway * 4.33))} sem`;
  const runwayCls = k.saldo <= 0 || (k.runway !== null && k.runway < 1) ? 'text-danger'
    : (k.runway !== null && k.runway < 2) ? 'text-warning' : 'text-success';

  const kpis = document.createElement('div');
  kpis.className = 'mb-24';
  kpis.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px';
  kpis.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">🔥 Ritmo de gasto</div>
      <div class="kpi-value" style="font-size:19px">${formatMXN(k.burnRate)}<span style="font-size:12px;color:var(--text-muted)"> /mes</span></div>
      <div class="kpi-sub">promedio de los últimos 90 días</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">⏳ Colchón de caja</div>
      <div class="kpi-value ${runwayCls}" style="font-size:19px">${runwayTxt}</div>
      <div class="kpi-sub">lo que dura el saldo (${formatMXN(k.saldo)}) al ritmo actual</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">📐 Margen realizado</div>
      <div class="kpi-value ${trade.margenRealizado === null ? 'text-muted' : trade.margenRealizado >= 0 ? 'text-success' : 'text-danger'}" style="font-size:19px">
        ${trade.margenRealizado === null ? '—' : trade.margenRealizado.toFixed(1) + '%'}
      </div>
      <div class="kpi-sub">${trade.tieneAvance
        ? `${formatMXN(trade.pnlRealizado)} sobre lo ejecutado${trade.margenEsperado !== null ? ` · esperado ${trade.margenEsperado.toFixed(1)}%` : ''}`
        : 'pendiente: falta el avance de estimaciones'}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">⚖️ Flujo de caja <span style="font-weight:400;color:var(--text-muted)">(no es utilidad)</span></div>
      <div class="kpi-value ${k.flujoNeto >= 0 ? 'text-success' : 'text-danger'}" style="font-size:19px">${formatMXN(k.flujoNeto)}</div>
      <div class="kpi-sub">${trade.tieneAvance && trade.efectivoFlotante > 0
        ? `incluye ${formatMXN(trade.efectivoFlotante)} de anticipo aún no ganado`
        : (k.flujoNeto >= 0 ? 'el cliente fondea la obra' : 'financiado por SOGRUB')} · de SOGRUB: ${formatMXN(k.sogrubNeto)}</div>
    </div>
  `;
  wrap.appendChild(kpis);

  // ---- Lectura como trade (realizado vs flotante) ----
  wrap.appendChild(_aoTradeCard(proyectoId));

  // ---- Lectura financiera ----
  const insights = _aoInsights(proyectoId, k);
  if (insights.length) {
    const nivelCfg = {
      ok:   { color: 'var(--success)', icon: '✔' },
      warn: { color: 'var(--warning)', icon: '⚠' },
      bad:  { color: 'var(--danger)',  icon: '⚠' },
      info: { color: 'var(--accent)',  icon: 'ℹ' },
    };
    const card = document.createElement('div');
    card.className = 'card mb-24';
    card.innerHTML = `
      <h3 class="section-title" style="margin-bottom:12px">🧠 Lectura financiera</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${insights.map(i => {
          const c = nivelCfg[i.nivel] ?? nivelCfg.info;
          return `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 12px;background:var(--surface2);border-left:3px solid ${c.color};border-radius:var(--radius);font-size:13px;line-height:1.5">
            <span style="color:${c.color};flex-shrink:0">${c.icon}</span>
            <span>${i.texto}</span>
          </div>`;
        }).join('')}
      </div>
    `;
    wrap.appendChild(card);
  }

  // ---- Grid de gráficas ----
  const grid = document.createElement('div');
  grid.className = 'mb-24';
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:16px';
  const _chartCard = (id, titulo, sub) => `
    <div class="card">
      <h3 class="section-title" style="margin-bottom:2px">${titulo}</h3>
      ${sub ? `<div class="text-sm text-muted" style="margin-bottom:10px">${sub}</div>` : '<div style="margin-bottom:10px"></div>'}
      <div style="position:relative;height:270px"><canvas id="${id}"></canvas></div>
    </div>
  `;
  grid.innerHTML = `
    ${_chartCard('ao-chart-caja', '💰 Evolución de la caja de la obra', 'Saldo disponible después de cada entrada y salida')}
    ${_chartCard('ao-chart-flujo', '⇄ Entradas vs salidas por periodo', 'Cobros al cliente y fondeo SOGRUB contra gasto ejecutado')}
    ${_chartCard('ao-chart-acum', '📈 Curva cobrado vs gastado vs ejecutado',
      trade.tieneAvance
        ? `<b>Hoy:</b> ejecutado ${formatMXN(trade.vEjec)} − gastado ${formatMXN(trade.cIncurrido)} =
           <b class="${trade.pnlRealizado >= 0 ? 'text-success' : 'text-danger'}">${formatMXN(trade.pnlRealizado)}</b> de utilidad realizada ·
           cobrado − ejecutado = ${formatMXN(trade.efectivoFlotante)} de anticipo aún no ganado.
           <span class="text-dim">La línea de ejecutado es plana porque estimaciones publica un solo
           acumulado, el de hoy: las brechas solo se leen en el extremo derecho.</span>`
        : 'Ejecutado − gastado = utilidad realizada · cobrado − ejecutado = anticipo aún no ganado')}
    ${_chartCard('ao-chart-cat', '🧱 Composición del gasto por periodo', 'En qué se está yendo el dinero a lo largo del tiempo')}
  `;
  wrap.appendChild(grid);

  _aoBuildCharts(proyectoId, proyecto);
}

// =====================================================
// CONSTRUCCIÓN DE GRÁFICAS
// =====================================================
function _aoChartOpts(extraScales = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: '#999', boxWidth: 12, font: { size: 11 } } },
      tooltip: {
        filter: item => item.dataset._skipTooltip !== true,
        callbacks: {
          label: ctx => ` ${ctx.dataset.label ?? ''}: ${formatMXN(ctx.parsed.y)}`,
        },
      },
    },
    scales: {
      x: { ticks: { color: '#999', font: { size: 10 }, maxRotation: 60, autoSkip: true }, grid: { color: '#222' }, ...(extraScales.x ?? {}) },
      y: { ticks: { color: '#999', font: { size: 10 }, callback: v => _aoMoney(v) }, grid: { color: '#222' }, ...(extraScales.y ?? {}) },
    },
  };
}

function _aoBuildCharts(proyectoId, proyecto) {
  if (typeof Chart === 'undefined') return;

  const full = _aoSeries(proyectoId, _aoState.gran);
  if (!full) return;
  const s = _aoAplicarRango(full, _aoState.rango, _aoState.gran);
  const C = _AO_COLORS;
  const zeros = s.labels.map(() => 0);

  // ---- 1. Evolución de la caja (saldo acumulado) ----
  const ctx1 = document.getElementById('ao-chart-caja');
  if (ctx1) {
    _aoCharts.caja = new Chart(ctx1, {
      type: 'line',
      data: {
        labels: s.labels,
        datasets: [
          {
            label: 'Saldo en caja',
            data: s.saldoAcum,
            borderColor: C.accent,
            backgroundColor: C.accent + '22',
            fill: 'origin',
            tension: 0.25,
            pointRadius: s.labels.length > 40 ? 0 : 2,
            pointHoverRadius: 4,
            borderWidth: 2,
            segment: {
              borderColor: c => (c.p1.parsed.y < 0 || c.p0.parsed.y < 0) ? C.danger : C.accent,
            },
          },
          { label: '', data: zeros, borderColor: C.muted + '66', borderDash: [4, 4], pointRadius: 0, borderWidth: 1, _skipTooltip: true },
        ],
      },
      options: { ..._aoChartOpts(), plugins: { ..._aoChartOpts().plugins, legend: { display: false } } },
    });
  }

  // ---- 2. Entradas vs salidas por periodo (barras apiladas por columna) ----
  const ctx2 = document.getElementById('ao-chart-flujo');
  if (ctx2) {
    const datasets = [
      { label: 'Cobrado al cliente', data: s.cobrado, backgroundColor: C.success, stack: 'in' },
      { label: 'Recibido de SOGRUB', data: s.sogrub, backgroundColor: C.teal + 'bb', stack: 'in' },
      { label: 'Gastado (pagado)', data: s.gastado, backgroundColor: C.danger, stack: 'out' },
    ];
    if (_aoState.incluirPendientes) {
      datasets.push({ label: 'Gasto pendiente de pago', data: s.gastoPend, backgroundColor: C.danger + '55', stack: 'out' });
    }
    _aoCharts.flujo = new Chart(ctx2, {
      type: 'bar',
      data: { labels: s.labels, datasets },
      options: _aoChartOpts({ x: { stacked: true }, y: { stacked: true } }),
    });
  }

  // ---- 3. Curvas acumuladas vs contrato ----
  const ctx3 = document.getElementById('ao-chart-acum');
  if (ctx3) {
    const contrato = Number(proyecto?.presupuesto_contrato) || 0;
    const presOpus = (typeof getPresupuesto === 'function' ? getPresupuesto(proyectoId)?.meta?.total : 0) || 0;
    const datasets = [
      { label: 'Cobrado acumulado', data: s.cobradoAcum, borderColor: C.success, backgroundColor: C.success + '18', fill: 'origin', tension: 0.25, pointRadius: 0, borderWidth: 2 },
      { label: 'Gastado acumulado', data: s.gastadoAcum, borderColor: C.danger, backgroundColor: C.danger + '18', fill: 'origin', tension: 0.25, pointRadius: 0, borderWidth: 2 },
    ];
    // Valor de venta de lo ya ejecutado. Estimaciones publica un solo dato
    // (el acumulado de hoy), no una serie, así que va como línea de
    // referencia: la brecha contra 'gastado' es el PnL realizado y la brecha
    // contra 'cobrado' es el anticipo que todavía no se gana.
    const trade = calcLecturaTrade(proyectoId);
    if (trade.tieneAvance && trade.vEjec > 0) {
      datasets.push({
        label: 'Ejecutado a catálogo (hoy)',
        data: s.labels.map(() => trade.vEjec),
        borderColor: C.orange, borderDash: [8, 3], pointRadius: 0, borderWidth: 2,
      });
    }
    if (contrato > 0) {
      datasets.push({ label: 'Contrato', data: s.labels.map(() => contrato), borderColor: C.muted, borderDash: [6, 4], pointRadius: 0, borderWidth: 1.5 });
    }
    if (presOpus > 0 && Math.abs(presOpus - contrato) > 1) {
      datasets.push({ label: 'Presupuesto OPUS', data: s.labels.map(() => presOpus), borderColor: C.purple, borderDash: [3, 4], pointRadius: 0, borderWidth: 1.5 });
    }
    _aoCharts.acum = new Chart(ctx3, {
      type: 'line',
      data: { labels: s.labels, datasets },
      options: _aoChartOpts(),
    });
  }

  // ---- 4. Composición del gasto por categoría ----
  const ctx4 = document.getElementById('ao-chart-cat');
  if (ctx4) {
    let fb = 0;
    const cats = Object.entries(s.porCat)
      .sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0));
    const datasets = cats.map(([cat, data]) => ({
      label: cat,
      data,
      backgroundColor: _AO_CAT_COLORS[cat] ?? _AO_CAT_FALLBACK[fb++ % _AO_CAT_FALLBACK.length],
      stack: 'g',
    }));
    _aoCharts.cat = new Chart(ctx4, {
      type: 'bar',
      data: { labels: s.labels, datasets },
      options: _aoChartOpts({ x: { stacked: true }, y: { stacked: true } }),
    });
  }
}
