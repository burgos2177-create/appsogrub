/* =====================================================
   SOGRUB Bitácora — Motor de Cálculo Fiscal
   Funciones puras para IVA, ISR y agregaciones fiscales
   ===================================================== */
'use strict';

// =====================================================
// CONFIGURACIÓN FISCAL POR DEFECTO
// =====================================================
const DEFAULT_FISCAL_CONFIG = Object.freeze({
  tasa_iva: 0.16,
  tasa_isr: 0.30,
  categorias_fiscal: {
    'Material':       { deducible: true,  iva_acreditable: true,  requiere_xml: false },
    'Mano de Obra':   { deducible: true,  iva_acreditable: true,  requiere_xml: false },
    'Subcontratista': { deducible: true,  iva_acreditable: true,  requiere_xml: true  },
    'Indirecto':      { deducible: true,  iva_acreditable: true,  requiere_xml: false },
  },
  reglas: {
    requiere_xml_para_iva_acreditable: true,
  },
});

/** Obtiene config fiscal (de Firebase o default) */
function getFiscalConfig() {
  return getCollection(KEYS.FISCAL_CONFIG) ?? { ...DEFAULT_FISCAL_CONFIG };
}

/** Inicializa config fiscal si no existe */
function initFiscalConfigSiVacio() {
  const existing = getCollection(KEYS.FISCAL_CONFIG);
  if (!existing || !existing.tasa_iva) {
    saveCollection(KEYS.FISCAL_CONFIG, { ...DEFAULT_FISCAL_CONFIG });
  }
}

// =====================================================
// DESGLOSE FISCAL — Regla única global
// monto siempre es el TOTAL capturado
// =====================================================
function calcDesgloseFiscal(monto, incluye_iva) {
  const abs = Math.abs(monto || 0);
  if (incluye_iva) {
    const subtotal = Math.round((abs / 1.16) * 100) / 100;
    const iva = Math.round((abs - subtotal) * 100) / 100;
    return { subtotal, iva, total: abs };
  }
  return { subtotal: abs, iva: 0, total: abs };
}

// =====================================================
// ESTATUS FISCAL POR MOVIMIENTO
// =====================================================
function inferirEstatusFiscal(mov) {
  const cfg = getFiscalConfig();
  const catCfg = cfg.categorias_fiscal?.[mov.categoria];
  const tieneFactura = !!(mov.factura_drive_url || mov.factura_xml_url
    || mov.factura_nombre || mov.factura_xml_nombre);

  // Sin categoría → pendiente
  if (!mov.categoria || !catCfg) return 'pendiente_revision';

  // Categoría no deducible
  if (!catCfg.deducible) return 'no_deducible';

  // Deducible con IVA
  if (mov.incluye_iva) {
    const requiereXml = cfg.reglas?.requiere_xml_para_iva_acreditable ?? true;
    if (requiereXml && !tieneFactura) return 'pendiente_revision';
    return 'deducible_con_iva';
  }

  return 'deducible_sin_iva';
}

/** Label legible del estatus fiscal */
function labelEstatusFiscal(estatus) {
  const map = {
    'deducible_con_iva':  'Deducible + IVA',
    'deducible_sin_iva':  'Deducible (sin IVA)',
    'no_deducible':       'No deducible',
    'pendiente_revision': 'Pendiente revisión',
  };
  return map[estatus] ?? estatus;
}

// =====================================================
// ALERTAS FISCALES POR MOVIMIENTO
// =====================================================
function generarAlertasMovimiento(mov) {
  const alertas = [];
  const tieneFactura = !!(mov.factura_drive_url || mov.factura_xml_url
    || mov.factura_nombre || mov.factura_xml_nombre);
  const tienePDF = !!(mov.factura_drive_url || mov.factura_nombre);
  const tieneXML = !!(mov.factura_xml_url || mov.factura_xml_nombre);

  if (mov.tipo === 'gasto') {
    if (mov.incluye_iva && !tieneFactura) {
      alertas.push({ tipo: 'warning', mensaje: 'Gasto con IVA sin factura adjunta' });
    }
    if (mov.incluye_iva && tienePDF && !tieneXML) {
      alertas.push({ tipo: 'info', mensaje: 'Tiene PDF pero falta XML' });
    }
    if (!mov.categoria) {
      alertas.push({ tipo: 'warning', mensaje: 'Sin categoría asignada' });
    }
    if (mov.factura_monto_ocr && Math.abs(Math.abs(mov.monto) - mov.factura_monto_ocr) > 0.50) {
      alertas.push({ tipo: 'error', mensaje: `Monto capturado (${formatMXN(Math.abs(mov.monto))}) ≠ factura (${formatMXN(mov.factura_monto_ocr)})` });
    }
  }

  if (mov.tipo === 'abono_cliente') {
    if (mov.incluye_iva && !tieneFactura) {
      alertas.push({ tipo: 'info', mensaje: 'Ingreso con IVA sin soporte documental' });
    }
  }

  return alertas;
}

// =====================================================
// RANGOS DE PERIODO
// =====================================================
function calcRangoPeriodo(tipo, anio, valor) {
  anio = parseInt(anio);
  valor = parseInt(valor);

  switch (tipo) {
    case 'mes':
      return {
        desde: `${anio}-${String(valor).padStart(2,'0')}-01`,
        hasta: _ultimoDiaMes(anio, valor),
      };
    case 'bimestre': {
      const mesInicio = (valor - 1) * 2 + 1;
      const mesFin = mesInicio + 1;
      return {
        desde: `${anio}-${String(mesInicio).padStart(2,'0')}-01`,
        hasta: _ultimoDiaMes(anio, mesFin),
      };
    }
    case 'trimestre': {
      const mesI = (valor - 1) * 3 + 1;
      const mesF = mesI + 2;
      return {
        desde: `${anio}-${String(mesI).padStart(2,'0')}-01`,
        hasta: _ultimoDiaMes(anio, mesF),
      };
    }
    case 'semestre': {
      const mI = valor === 1 ? 1 : 7;
      const mF = valor === 1 ? 6 : 12;
      return {
        desde: `${anio}-${String(mI).padStart(2,'0')}-01`,
        hasta: _ultimoDiaMes(anio, mF),
      };
    }
    case 'anual':
      return { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
    default:
      return null;
  }
}

function _ultimoDiaMes(anio, mes) {
  const d = new Date(anio, mes, 0);
  return `${anio}-${String(mes).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// =====================================================
// FILTRAR MOVIMIENTOS POR PERIODO
// =====================================================
function filtrarMovsPeriodo(desde, hasta) {
  const movs = getCollection(KEYS.PROY_MOVIMIENTOS) ?? [];
  return movs.filter(m => {
    if (!m.fecha) return false;
    return m.fecha >= desde && m.fecha <= hasta;
  });
}

// =====================================================
// CÁLCULO FISCAL COMPLETO DEL PERIODO
// =====================================================
function calcFiscalPeriodo(desde, hasta) {
  const cfg = getFiscalConfig();
  const tasaISR = cfg.tasa_isr ?? 0.30;
  const allMovs = filtrarMovsPeriodo(desde, hasta);

  // Separar por tipo fiscal (excluir transferencias)
  const ingresos = allMovs.filter(m => m.tipo === 'abono_cliente');
  const gastos = allMovs.filter(m => m.tipo === 'gasto');

  // --- INGRESOS ---
  let ing_total = 0, ing_con_iva_total = 0, ing_sin_iva_total = 0;
  let ing_subtotal = 0, ing_iva = 0;

  ingresos.forEach(m => {
    const d = calcDesgloseFiscal(m.monto, m.incluye_iva);
    ing_total += d.total;
    ing_subtotal += d.subtotal;
    ing_iva += d.iva;
    if (m.incluye_iva) ing_con_iva_total += d.total;
    else ing_sin_iva_total += d.total;
  });

  // --- GASTOS ---
  let gas_total = 0, gas_con_iva_total = 0, gas_sin_iva_total = 0;
  let gas_subtotal = 0, gas_iva = 0;
  let gas_deducible_subtotal = 0, gas_no_deducible_total = 0;
  let iva_acreditable = 0;

  gastos.forEach(m => {
    const d = calcDesgloseFiscal(m.monto, m.incluye_iva);
    const estatus = inferirEstatusFiscal(m);

    gas_total += d.total;
    gas_subtotal += d.subtotal;
    gas_iva += d.iva;

    if (m.incluye_iva) gas_con_iva_total += d.total;
    else gas_sin_iva_total += d.total;

    if (estatus === 'deducible_con_iva' || estatus === 'deducible_sin_iva') {
      gas_deducible_subtotal += d.subtotal;
    } else if (estatus === 'no_deducible') {
      gas_no_deducible_total += d.total;
    }

    if (estatus === 'deducible_con_iva') {
      iva_acreditable += d.iva;
    }
  });

  // --- IVA ---
  const iva_trasladado = ing_iva;
  const iva_neto = Math.round((iva_trasladado - iva_acreditable) * 100) / 100;

  // --- ISR ---
  const utilidad_fiscal = ing_subtotal - gas_deducible_subtotal;
  const isr_estimado = utilidad_fiscal > 0
    ? Math.round(utilidad_fiscal * tasaISR * 100) / 100
    : 0;

  // --- POR PROYECTO ---
  const proyectosInvolucrados = new Set();
  allMovs.forEach(m => {
    if (m.tipo === 'abono_cliente' || m.tipo === 'gasto') {
      proyectosInvolucrados.add(m.proyecto_id);
    }
  });

  const porProyecto = [...proyectosInvolucrados].map(pid => {
    const proy = getItem(KEYS.PROYECTOS, pid);
    const pIngresos = ingresos.filter(m => m.proyecto_id === pid);
    const pGastos = gastos.filter(m => m.proyecto_id === pid);

    let pIngTotal = 0, pIngSub = 0, pIngIva = 0;
    pIngresos.forEach(m => {
      const d = calcDesgloseFiscal(m.monto, m.incluye_iva);
      pIngTotal += d.total; pIngSub += d.subtotal; pIngIva += d.iva;
    });

    let pGasTotal = 0, pGasSub = 0, pGasIva = 0;
    pGastos.forEach(m => {
      const d = calcDesgloseFiscal(m.monto, m.incluye_iva);
      pGasTotal += d.total; pGasSub += d.subtotal; pGasIva += d.iva;
    });

    return {
      proyecto_id: pid,
      nombre: proy?.nombre ?? 'Desconocido',
      cliente: proy?.cliente ?? '',
      ingresos_total: pIngTotal,
      ingresos_subtotal: pIngSub,
      iva_trasladado: pIngIva,
      gastos_total: pGasTotal,
      gastos_subtotal: pGasSub,
      iva_acreditable: pGasIva,
      utilidad: pIngSub - pGasSub,
      num_ingresos: pIngresos.length,
      num_gastos: pGastos.length,
    };
  }).sort((a, b) => b.ingresos_total - a.ingresos_total);

  // --- POR CATEGORÍA ---
  const catMap = {};
  gastos.forEach(m => {
    const cat = m.categoria || 'Sin categoría';
    if (!catMap[cat]) catMap[cat] = { total: 0, subtotal: 0, iva: 0, con_iva: 0, sin_iva: 0, count: 0, proveedores: {} };
    const d = calcDesgloseFiscal(m.monto, m.incluye_iva);
    catMap[cat].total += d.total;
    catMap[cat].subtotal += d.subtotal;
    catMap[cat].iva += d.iva;
    catMap[cat].count++;
    if (m.incluye_iva) catMap[cat].con_iva += d.total;
    else catMap[cat].sin_iva += d.total;
    const prov = m.subcontratista || 'Sin proveedor';
    catMap[cat].proveedores[prov] = (catMap[cat].proveedores[prov] || 0) + d.total;
  });

  const porCategoria = Object.entries(catMap)
    .map(([nombre, data]) => ({
      nombre,
      ...data,
      proveedor_principal: Object.entries(data.proveedores).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—',
    }))
    .sort((a, b) => b.total - a.total);

  // --- ALERTAS GLOBALES ---
  const alertas = [];
  let gastosIvaSinFactura = 0;
  let sinCategoria = 0;

  [...ingresos, ...gastos].forEach(m => {
    const movAlertas = generarAlertasMovimiento(m);
    movAlertas.forEach(a => alertas.push({ ...a, movimiento_id: m.id, proyecto_id: m.proyecto_id }));
    if (m.tipo === 'gasto' && m.incluye_iva) {
      const tieneF = !!(m.factura_drive_url || m.factura_xml_url || m.factura_nombre || m.factura_xml_nombre);
      if (!tieneF) gastosIvaSinFactura++;
    }
    if (m.tipo === 'gasto' && !m.categoria) sinCategoria++;
  });

  // Alertas de resumen
  porProyecto.forEach(p => {
    if (p.utilidad < 0) {
      alertas.push({ tipo: 'warning', mensaje: `Proyecto "${p.nombre}" con utilidad negativa: ${formatMXN(p.utilidad)}`, proyecto_id: p.proyecto_id });
    }
  });

  if (iva_neto < 0 && Math.abs(iva_neto) > ing_total * 0.1) {
    alertas.push({ tipo: 'info', mensaje: `Saldo a favor de IVA elevado: ${formatMXN(Math.abs(iva_neto))}` });
  }

  if (gastosIvaSinFactura > 3) {
    alertas.push({ tipo: 'warning', mensaje: `${gastosIvaSinFactura} gastos con IVA sin factura en el periodo` });
  }

  if (sinCategoria > 0) {
    alertas.push({ tipo: 'warning', mensaje: `${sinCategoria} gastos sin categoría asignada` });
  }

  return {
    periodo: { desde, hasta },
    ingresos: {
      total: ing_total,
      subtotal: ing_subtotal,
      iva: ing_iva,
      con_iva: ing_con_iva_total,
      sin_iva: ing_sin_iva_total,
      count: ingresos.length,
    },
    gastos: {
      total: gas_total,
      subtotal: gas_subtotal,
      iva: gas_iva,
      con_iva: gas_con_iva_total,
      sin_iva: gas_sin_iva_total,
      deducible_subtotal: gas_deducible_subtotal,
      no_deducible_total: gas_no_deducible_total,
      count: gastos.length,
    },
    iva_trasladado,
    iva_acreditable,
    iva_neto,
    utilidad_fiscal,
    isr_estimado,
    porProyecto,
    porCategoria,
    alertas,
    proyectos_count: proyectosInvolucrados.size,
    movimientos_count: ingresos.length + gastos.length,
  };
}

// =====================================================
// TRAZABILIDAD — Tabla detallada de todos los registros
// =====================================================
function calcTrazabilidadFiscal(desde, hasta) {
  const allMovs = filtrarMovsPeriodo(desde, hasta);

  return allMovs
    .filter(m => m.tipo === 'abono_cliente' || m.tipo === 'gasto')
    .map(m => {
      const proy = getItem(KEYS.PROYECTOS, m.proyecto_id);
      const d = calcDesgloseFiscal(m.monto, m.incluye_iva);
      const estatus = m.tipo === 'gasto' ? inferirEstatusFiscal(m) : null;
      const alertas = generarAlertasMovimiento(m);
      const tieneXML = !!(m.factura_xml_url || m.factura_xml_nombre);
      const tienePDF = !!(m.factura_drive_url || m.factura_nombre);

      return {
        id: m.id,
        fecha: m.fecha,
        proyecto_id: m.proyecto_id,
        proyecto_nombre: proy?.nombre ?? 'Desconocido',
        tipo: m.tipo === 'abono_cliente' ? 'Ingreso' : 'Gasto',
        tipo_raw: m.tipo,
        concepto: m.concepto,
        categoria: m.categoria || '—',
        proveedor: m.subcontratista || '—',
        subtotal: d.subtotal,
        iva: d.iva,
        total: d.total,
        incluye_iva: !!m.incluye_iva,
        tiene_xml: tieneXML,
        tiene_pdf: tienePDF,
        estatus_fiscal: estatus,
        estatus_label: estatus ? labelEstatusFiscal(estatus) : '—',
        alertas,
        status: m.status,
      };
    })
    .sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0);
}
