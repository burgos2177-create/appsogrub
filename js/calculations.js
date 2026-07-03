/* =====================================================
   SOGRUB Bitácora — Reglas de negocio (funciones puras)
   ===================================================== */
'use strict';

// =====================================================
// REGLA 1 — Saldo Mifel
// saldo_inicial_mifel
//   + movimientos generales SOGRUB (ya firmados: − egresos, + ingresos)
//   + cobros de clientes en proyectos (entran físicamente al banco)
//   + gastos de proyectos pagados (salen físicamente del banco; monto ya es negativo)
//
// Las transferencias internas SOGRUB↔proyecto (transferencia_proyecto /
// transferencia_sogrub) son asientos contables que ya están contemplados en
// KEYS.MOVIMIENTOS y en el saldo del proyecto respectivamente — no se
// duplican aquí.
// =====================================================
function calcSaldoMifel() {
  const { saldo_inicial_mifel } = getConfig();

  // Movimientos generales de SOGRUB (incluye transferencias internas a proyectos
  // y egresos por depósitos a caja chica — ambos ya descuentan acá).
  const movSOGRUB = (getCollection(KEYS.MOVIMIENTOS) ?? [])
    .filter(m => m.status === 'Pagado')
    .reduce((acc, m) => acc + m.monto, 0);

  const proyMov = getCollection(KEYS.PROY_MOVIMIENTOS) ?? [];

  // Cobros del cliente → entran al banco de SOGRUB (monto positivo)
  const abonosCliente = proyMov
    .filter(m => m.tipo === 'abono_cliente')
    .reduce((acc, m) => acc + m.monto, 0);

  // Gastos pagados → salen del banco de SOGRUB (monto ya es negativo en BD).
  // Excluye los pagados con caja chica: ese dinero ya bajó de Mifel cuando se
  // hizo el depósito a caja chica (vía sogrub_movimientos egreso). Si volvemos
  // a contarlo aquí, doble descuento.
  const gastosPagados = proyMov
    .filter(m => m.tipo === 'gasto' && m.status === 'Pagado' && !m.paga_de_caja_chica)
    .reduce((acc, m) => acc + m.monto, 0);

  return saldo_inicial_mifel + movSOGRUB + abonosCliente + gastosPagados;
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

  // Gastos pagados que SÍ descuentan del saldo del proyecto. Excluye los
  // pagados con caja chica: para esos, el saldo ya bajó cuando se depositó
  // a caja chica (movimiento `tipo='deposito_caja_chica'` abajo). Si los
  // restáramos también aquí, doble conteo.
  const gastosPagados = movs
    .filter(m => m.tipo === 'gasto' && m.status === 'Pagado' && !m.paga_de_caja_chica)
    .reduce((acc, m) => acc + Math.abs(m.monto), 0);

  // Depósitos del proyecto a caja chica → bajan saldo del proyecto.
  const depositosCajaChica = movs
    .filter(m => m.tipo === 'deposito_caja_chica' && m.status === 'Pagado')
    .reduce((acc, m) => acc + Math.abs(m.monto), 0);

  return abonos + transferencias - gastosPagados - depositosCajaChica;
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
// Saldo Mifel (incluye cobros de clientes y gastos de proyectos)
// − Dinero comprometido (saldos positivos en proyectos activos)
// → El "libre de compromisos" no cambia cuando un cliente paga o se paga
//   un gasto de proyecto: el banco sube/baja y el comprometido sube/baja
//   en igual medida, manteniéndose estable el disponible real.
// =====================================================
function calcDisponibleReal() {
  return calcSaldoMifel() - calcDineroComprometido();
}

// =====================================================
// REGLA 6 — Deuda pendiente de un proyecto (compat: número total)
// Total = deuda a proveedores (gastos con status='Pendiente').
// Para el desglose con caja chica, usar calcDeudaPendienteDesglose() abajo.
// =====================================================
function calcDeudaPendiente(proyectoId) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto' && m.status === 'Pendiente');
  return movs.reduce((acc, m) => acc + Math.abs(m.monto), 0);
}

// Desglose de deuda pendiente:
//   - proveedores: gastos status='Pendiente' (lo de siempre)
//   - cajaChica: cuando alguien (almacenista/auxiliar) puso de su bolsillo
//                porque la caja chica no tenía saldo. Se deriva del saldo
//                conciliado: si saldo < 0, la diferencia es la deuda.
//   - total = proveedores + cajaChica
//
// `saldoCajaChica` se inyecta como parámetro porque vive en /shared/cajaChica
// (lectura async). El caller pasa el valor ya resuelto o 0 si no hay vínculo.
function calcDeudaPendienteDesglose(proyectoId, saldoCajaChica = 0) {
  const proveedores = calcDeudaPendiente(proyectoId);
  const cajaChica = Math.max(0, -Number(saldoCajaChica || 0));
  return { proveedores, cajaChica, total: proveedores + cajaChica };
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

// Desglose IVA de lo cobrado al cliente
function calcIVACobradoCliente(proyectoId) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'abono_cliente');
  let netoTotal = 0, ivaTotal = 0;
  movs.forEach(m => {
    const abs = Math.abs(m.monto ?? 0);
    if (m.incluye_iva) {
      netoTotal += abs / 1.16;
      ivaTotal  += abs - abs / 1.16;
    } else {
      netoTotal += abs;
    }
  });
  return { netoTotal, ivaTotal, total: netoTotal + ivaTotal };
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

// Ámbitos de un gasto indirecto (para separar oficina vs campo)
const INDIRECTO_AMBITOS = ['oficina', 'campo'];

// =====================================================
// PRESUPUESTO EN CASCADA
// costo directo → indirectos oficina → indirectos campo → financiamiento → utilidad
// Cada nivel se calcula sobre el acumulado del anterior (cascada multiplicativa,
// estándar OPUS). El monto del contrato es el acumulado final.
// =====================================================
function calcDesgloseContrato(proyecto) {
  const cd  = Number(proyecto?.costo_directo_base) || 0;
  // Compat: si un proyecto viejo solo tiene `sobrecosto_indirectos`, se toma como oficina.
  const io  = (Number(proyecto?.sobrecosto_ind_oficina ?? proyecto?.sobrecosto_indirectos) || 0) / 100;
  const ic  = (Number(proyecto?.sobrecosto_ind_campo) || 0) / 100;
  const fin = (Number(proyecto?.sobrecosto_financiamiento) || 0) / 100;
  const uti = (Number(proyecto?.sobrecosto_utilidad) || 0) / 100;

  const indOficina = cd * io;
  let acum = cd + indOficina;
  const indCampo = acum * ic;
  acum += indCampo;
  const financiamiento = acum * fin;
  acum += financiamiento;
  const utilidad = acum * uti;
  acum += utilidad;

  return { costoDirecto: cd, indOficina, indCampo, financiamiento, utilidad, contrato: acum };
}

// Monto del contrato derivado del costo directo + cascada de sobrecostos.
function calcContratoDesdeCosto(proyecto) {
  return calcDesgloseContrato(proyecto).contrato;
}

// A qué bolsita pertenece un gasto:
//   - categoría 'Indirecto' → ind_oficina / ind_campo según su ámbito (default oficina)
//   - cualquier otra categoría (Material, Mano de Obra, Subcontratista) → costo_directo
function _bolsaDeGasto(m) {
  if ((m.categoria ?? '').toLowerCase() === 'indirecto') {
    return m.indirecto_ambito === 'campo' ? 'ind_campo' : 'ind_oficina';
  }
  return 'costo_directo';
}

// =====================================================
// BOLSITAS — presupuesto por rubro vs. lo gastado (pagado)
// El sobregiro de las bolsitas de gasto (directo + indirectos) se come la
// utilidad: utilidadDisponible = utilidadPlaneada − Σ sobregiros.
// =====================================================
function calcBolsitasProyecto(proyectoId) {
  const proyecto = getItem(KEYS.PROYECTOS, proyectoId) ?? {};
  const d = calcDesgloseContrato(proyecto);

  const gastos = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto' && m.status === 'Pagado');

  const gastado = { costo_directo: 0, ind_oficina: 0, ind_campo: 0 };
  gastos.forEach(m => { gastado[_bolsaDeGasto(m)] += Math.abs(m.monto); });

  const bolsas = [
    { key: 'costo_directo', label: 'Costo directo',      icon: '🧱', budget: d.costoDirecto, gastado: gastado.costo_directo },
    { key: 'ind_oficina',   label: 'Indirectos oficina', icon: '🏢', budget: d.indOficina,   gastado: gastado.ind_oficina },
    { key: 'ind_campo',     label: 'Indirectos campo',   icon: '🚧', budget: d.indCampo,     gastado: gastado.ind_campo },
  ].map(b => {
    const overflow  = Math.max(0, b.gastado - b.budget);
    const restante  = b.budget - b.gastado;
    const pct       = b.budget > 0 ? (b.gastado / b.budget) * 100 : (b.gastado > 0 ? 100 : 0);
    return { ...b, overflow, restante, pct };
  });

  const overflowTotal      = bolsas.reduce((a, b) => a + b.overflow, 0);
  const utilidadDisponible = d.utilidad - overflowTotal;

  return {
    bolsas,
    financiamiento:   d.financiamiento,
    utilidadPlaneada: d.utilidad,
    overflowTotal,
    utilidadDisponible,
    contrato:         d.contrato,
  };
}

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
