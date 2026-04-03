/* =====================================================
   SOGRUB Bitácora — Reglas de negocio (funciones puras)
   ===================================================== */
'use strict';

// =====================================================
// REGLA 1 — Saldo Mifel
// saldo_inicial_mifel − suma de movimientos donde status === "Pagado"
// (los montos ya son negativos para egresos, positivos para ingresos)
// =====================================================
function calcSaldoMifel() {
  const { saldo_inicial_mifel } = getConfig();
  const movs = getCollection(KEYS.MOVIMIENTOS) ?? [];
  const sumaPagados = movs
    .filter(m => m.status === 'Pagado')
    .reduce((acc, m) => acc + m.monto, 0);
  return saldo_inicial_mifel + sumaPagados;
}

// =====================================================
// REGLA 2 — Saldo Global
// Saldo Mifel + suma de fondos_inversion[].monto
// =====================================================
function calcSaldoGlobal() {
  const { fondos_inversion } = getConfig();
  const totalFondos = (fondos_inversion ?? []).reduce((acc, f) => acc + (f.monto ?? 0), 0);
  return calcSaldoMifel() + totalFondos;
}

// =====================================================
// REGLA 3 — Saldo caja de un proyecto
// abono_cliente + transferencia_sogrub − gastos pagados
// =====================================================
function calcSaldoCajaProyecto(proyectoId) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId);

  const abonos = movs
    .filter(m => m.tipo === 'abono_cliente')
    .reduce((acc, m) => acc + m.monto, 0);

  const transferencias = movs
    .filter(m => m.tipo === 'transferencia_sogrub')
    .reduce((acc, m) => acc + m.monto, 0);

  const gastosPagados = movs
    .filter(m => m.tipo === 'gasto' && m.status === 'Pagado')
    .reduce((acc, m) => acc + Math.abs(m.monto), 0);

  return abonos + transferencias - gastosPagados;
}

// =====================================================
// REGLA 4 — Dinero comprometido en proyectos
// Suma de saldos de caja positivos de proyectos activos
// =====================================================
function calcDineroComprometido() {
  const proyectos = (getCollection(KEYS.PROYECTOS) ?? [])
    .filter(p => p.estado === 'activo');

  return proyectos.reduce((acc, p) => {
    const saldo = calcSaldoCajaProyecto(p.id);
    return acc + (saldo > 0 ? saldo : 0);
  }, 0);
}

// =====================================================
// REGLA 5 — Disponible real SOGRUB
// Saldo Mifel − Dinero comprometido
// =====================================================
function calcDisponibleReal() {
  return calcSaldoMifel() - calcDineroComprometido();
}

// =====================================================
// REGLA 6 — Deuda pendiente de un proyecto
// Suma de gastos con status "Pendiente" (valor absoluto)
// =====================================================
function calcDeudaPendiente(proyectoId) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto' && m.status === 'Pendiente');
  return movs.reduce((acc, m) => acc + Math.abs(m.monto), 0);
}

// =====================================================
// REGLA 7 — % Avance financiero
// (gastos pagados / presupuesto_contrato) × 100
// =====================================================
function calcAvanceFinanciero(proyectoId) {
  const proyecto = getItem(KEYS.PROYECTOS, proyectoId);
  if (!proyecto || !proyecto.presupuesto_contrato) return 0;

  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto' && m.status === 'Pagado');

  const gastado = movs.reduce((acc, m) => acc + Math.abs(m.monto), 0);
  return (gastado / proyecto.presupuesto_contrato) * 100;
}

// =====================================================
// REGLA 8A — Utilidad real a la fecha
// Total cobrado al cliente − total gastado (pagado)
// =====================================================
function calcUtilidadReal(proyectoId) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId);

  const cobrado = movs
    .filter(m => m.tipo === 'abono_cliente')
    .reduce((acc, m) => acc + m.monto, 0);

  const gastado = movs
    .filter(m => m.tipo === 'gasto' && m.status === 'Pagado')
    .reduce((acc, m) => acc + Math.abs(m.monto), 0);

  return cobrado - gastado;
}

// =====================================================
// REGLA 8B — Utilidad estimada (al 100% del contrato)
// Presupuesto del contrato − total gastado (pagado)
// =====================================================
function calcUtilidadEstimada(proyectoId) {
  const proyecto = getItem(KEYS.PROYECTOS, proyectoId);
  const presupuesto = proyecto?.presupuesto_contrato ?? 0;

  const gastado = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto' && m.status === 'Pagado')
    .reduce((acc, m) => acc + Math.abs(m.monto), 0);

  return presupuesto - gastado;
}

// =====================================================
// REGLA 9 — Transferencia SOGRUB → Proyecto (doble registro)
// =====================================================
function ejecutarTransferenciaSOGRUB(proyectoId, monto, concepto, fecha) {
  const proyecto = getItem(KEYS.PROYECTOS, proyectoId);
  if (!proyecto) throw new Error('Proyecto no encontrado');

  const nombreProyecto = proyecto.nombre;
  const conceptoFinal  = concepto || `Transferencia a ${nombreProyecto}`;

  // Registro en caja SOGRUB (egreso)
  const movSOGRUB = addItem(KEYS.MOVIMIENTOS, {
    fecha,
    monto:       -Math.abs(monto),
    concepto:    conceptoFinal,
    status:      'Pagado',
    tipo:        'transferencia_proyecto',
    proyecto_id: proyectoId,
  });

  // Registro en caja del proyecto (ingreso)
  const movProy = addItem(KEYS.PROY_MOVIMIENTOS, {
    proyecto_id:    proyectoId,
    fecha,
    monto:          Math.abs(monto),
    concepto:       conceptoFinal,
    subcontratista: '',
    status:         'Pagado',
    tipo:           'transferencia_sogrub',
  });

  return { movSOGRUB, movProy };
}

// =====================================================
// HELPERS de resumen por proyecto (para tablas)
// =====================================================
function calcResumenProyecto(proyectoId) {
  return {
    saldoCaja:        calcSaldoCajaProyecto(proyectoId),
    deudaPendiente:   calcDeudaPendiente(proyectoId),
    avancePct:        calcAvanceFinanciero(proyectoId),
    utilidadReal:     calcUtilidadReal(proyectoId),
    utilidadEstimada: calcUtilidadEstimada(proyectoId),
  };
}

// Total cobrado al cliente (para detalle)
function calcTotalCobradoCliente(proyectoId) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'abono_cliente');
  return movs.reduce((acc, m) => acc + m.monto, 0);
}

// Total gastado pagado (para detalle)
function calcTotalGastadoPagado(proyectoId) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto' && m.status === 'Pagado');
  return movs.reduce((acc, m) => acc + Math.abs(m.monto), 0);
}

// =====================================================
// IVA — Desglose por proyecto
// Gastos con incluye_iva=true: neto = monto/1.16, iva = monto - neto
// Gastos sin IVA: neto = monto, iva_por_cobrar = monto * 0.16
// =====================================================
function calcIVADesglose(proyectoId) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto' && m.status === 'Pagado');

  let gastoNeto = 0;
  let ivaPagado = 0;
  let ivaPorCobrar = 0;
  let ivaVerificado = 0;  // IVA de gastos que tienen factura adjunta (PDF o XML)

  movs.forEach(m => {
    const abs = Math.abs(m.monto);
    const tieneFactura = !!(m.factura_drive_url || m.factura_xml_url || m.factura_nombre || m.factura_xml_nombre);
    if (m.incluye_iva) {
      const neto = abs / 1.16;
      gastoNeto += neto;
      ivaPagado += abs - neto;
      if (tieneFactura) ivaVerificado += abs - neto;
    } else {
      gastoNeto += abs;
      ivaPorCobrar += abs * 0.16;
    }
  });

  return { gastoNeto, ivaPagado, ivaPorCobrar, ivaVerificado, totalBruto: gastoNeto + ivaPagado };
}

// =====================================================
// ANALYTICS — Gasto por categoría (proyecto)
// =====================================================
const CATEGORIAS = ['Material', 'Mano de Obra', 'Subcontratista', 'Indirecto'];

function calcGastoPorCategoria(proyectoId) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto' && m.status === 'Pagado');

  const result = {};
  CATEGORIAS.forEach(c => result[c] = 0);

  movs.forEach(m => {
    const cat = m.categoria || 'Sin categoría';
    result[cat] = (result[cat] || 0) + Math.abs(m.monto);
  });

  return result;
}

// =====================================================
// ANALYTICS — Gasto por proveedor (proyecto)
// =====================================================
function calcGastoPorProveedor(proyectoId) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto' && m.status === 'Pagado');

  const result = {};
  movs.forEach(m => {
    const prov = m.subcontratista || 'Sin proveedor';
    result[prov] = (result[prov] || 0) + Math.abs(m.monto);
  });

  return result;
}

// =====================================================
// ANALYTICS — Total gastado con un proveedor (global)
// =====================================================
function calcGastoGlobalProveedor(proveedorNombre) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.tipo === 'gasto' && m.status === 'Pagado' && m.subcontratista === proveedorNombre);
  return movs.reduce((acc, m) => acc + Math.abs(m.monto), 0);
}

// Detalle de gasto por proyecto para un proveedor
function calcGastoProveedorPorProyecto(proveedorNombre) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.tipo === 'gasto' && m.status === 'Pagado' && m.subcontratista === proveedorNombre);

  const result = {};
  movs.forEach(m => {
    const proy = getItem(KEYS.PROYECTOS, m.proyecto_id);
    const nombre = proy?.nombre || 'Desconocido';
    result[nombre] = (result[nombre] || 0) + Math.abs(m.monto);
  });
  return result;
}

// Resumen por proyecto con total, totalFacturado y proyectoId
function calcResumenProveedorPorProyecto(proveedorNombre) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.tipo === 'gasto' && m.status === 'Pagado' && m.subcontratista === proveedorNombre);

  const byProject = {};
  movs.forEach(m => {
    const proy = getItem(KEYS.PROYECTOS, m.proyecto_id);
    const nombre = proy?.nombre || 'Desconocido';
    const id = m.proyecto_id;
    if (!byProject[id]) byProject[id] = { proyectoId: id, nombre, total: 0, totalFacturado: 0 };
    const abs = Math.abs(m.monto);
    byProject[id].total += abs;
    if (m.factura_drive_url || m.factura_xml_url || m.factura_nombre || m.factura_xml_nombre) {
      byProject[id].totalFacturado += abs;
    }
  });
  return Object.values(byProject).sort((a, b) => b.total - a.total);
}
