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
  // Excluye los marcados metodo_pago='efectivo' (salieron de la caja de efectivo,
  // no de Mifel — p. ej. un indirecto de empresa pagado en efectivo).
  const movSOGRUB = (getCollection(KEYS.MOVIMIENTOS) ?? [])
    .filter(m => m.status === 'Pagado' && m.metodo_pago !== 'efectivo')
    .reduce((acc, m) => acc + m.monto, 0);

  const proyMov = getCollection(KEYS.PROY_MOVIMIENTOS) ?? [];

  // Cobros del cliente → entran al banco de SOGRUB (monto positivo).
  // Excluye los cobrados en efectivo: ese dinero entró a la caja física, no a Mifel.
  const abonosCliente = proyMov
    .filter(m => m.tipo === 'abono_cliente' && (m.metodo_pago ?? 'transferencia') !== 'efectivo')
    .reduce((acc, m) => acc + m.monto, 0);

  // Gastos pagados → salen del banco de SOGRUB (monto ya es negativo en BD).
  // Excluye los pagados con caja chica: ese dinero ya bajó de Mifel cuando se
  // hizo el depósito a caja chica (vía sogrub_movimientos egreso). Si volvemos
  // a contarlo aquí, doble descuento.
  // Excluye también: (a) pagados en efectivo — salieron de la caja física, no de
  // Mifel (van a calcSaldoEfectivo); (b) prorrateo de nómina (no_afecta_mifel) —
  // el neto ya salió de Mifel en el egreso único de nómina, aunque estos SÍ bajan
  // la caja del proyecto (calcSaldoCajaProyecto no los excluye).
  const gastosPagados = proyMov
    .filter(m => m.tipo === 'gasto' && m.status === 'Pagado' && !m.paga_de_caja_chica
              && !m.no_afecta_mifel
              && (m.metodo_pago ?? 'transferencia') !== 'efectivo')
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
  return calcSaldoMifel() + totalFondos + calcSaldoEfectivo();
}

// =====================================================
// EFECTIVO — caja física de SOGRUB
// Denominaciones MXN (billetes y monedas) de mayor a menor.
// =====================================================
const DENOMINACIONES = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5];

// Saldo teórico de efectivo = saldo inicial + Σ movimientos (monto con signo)
// + movimientos de PROYECTOS liquidados en efectivo (abonos entran, gastos salen).
// La bitácora manda; el arqueo por denominación solo concilia.
function calcSaldoEfectivo() {
  const { saldo_inicial_efectivo } = getConfig();
  const movs = getCollection(KEYS.EFECTIVO_MOV) ?? [];
  const base = (Number(saldo_inicial_efectivo) || 0) +
    movs.reduce((acc, m) => acc + (Number(m.monto) || 0), 0);

  // Nota: los gastos con paga_de_caja_chica se excluyen — ese billete ya salió
  // de la caja física cuando se depositó al fondo efectivo de la obra (egreso
  // en sogrub_efectivo_movimientos); contarlos aquí sería doble descuento.
  // Los tipo='deposito_caja_chica' tampoco pasan este reduce (solo abono/gasto):
  // su descuento de caja física es el egreso propio en EFECTIVO_MOV.
  const proyEfectivo = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.metodo_pago === 'efectivo' && !m.paga_de_caja_chica)
    .reduce((acc, m) => {
      if (m.tipo === 'abono_cliente') return acc + Math.abs(m.monto);                 // ingreso a caja
      if (m.tipo === 'gasto' && m.status === 'Pagado') return acc - Math.abs(m.monto); // egreso de caja
      return acc;
    }, 0);

  // Movimientos generales (empresa) pagados en efectivo — monto ya con signo.
  const mifelEfectivo = (getCollection(KEYS.MOVIMIENTOS) ?? [])
    .filter(m => m.metodo_pago === 'efectivo' && m.status === 'Pagado')
    .reduce((acc, m) => acc + (Number(m.monto) || 0), 0);

  return base + proyEfectivo + mifelEfectivo;
}

// Total del arqueo físico = Σ denominación × cantidad.
function calcTotalArqueo() {
  const { efectivo_arqueo } = getConfig();
  const conteo = efectivo_arqueo ?? {};
  return DENOMINACIONES.reduce((acc, d) => acc + d * (Number(conteo[d]) || 0), 0);
}

// Diferencia de conciliación: arqueo físico − saldo teórico.
//   > 0 sobrante · < 0 faltante · 0 cuadrado.
function calcDiferenciaArqueo() {
  return calcTotalArqueo() - calcSaldoEfectivo();
}

// =====================================================
// FONDOS DE EFECTIVO EN OBRA (caja chica · billete fuera de la caja SOGRUB)
//
// Al depositar al fondo efectivo de una obra, el billete SALE de la caja
// física de SOGRUB (egreso en sogrub_efectivo_movimientos) y queda en manos
// del almacenista. Por eso calcSaldoEfectivo() ya está NETO de esos fondos y
// el arqueo por denominación de arriba concilia sin tocar nada.
//
// Lo que faltaba era el otro lado: ese efectivo sigue siendo de la empresa,
// solo que custodiado en obra. Aquí viven el cache (lo llena la vista de
// efectivo, async desde /shared/cajaChica) y las sumas puras que consolidan
// ambas cajas:
//
//   Efectivo total de la empresa = caja física SOGRUB + Σ fondos en obra
//
// La conciliación consolidada solo suma las obras CON arqueo declarado (el
// contador captura lo que el almacenista reportó contar, en
// /shared/cajaChica/{obraId}/meta.arqueoEfectivo). Las obras sin conteo se
// reportan aparte: sin arqueo no hay nada que conciliar, y meterlas como si
// cuadraran escondería justo lo que esta vista debe destapar.
// =====================================================
let _fondosEfectivoObra = [];   // lo llena setFondosEfectivoObra() desde la vista

// [{ obraId, nombre, proyectoId, saldo, pendiente, arqueo: {monto,fecha}|null }]
function setFondosEfectivoObra(lista) {
  _fondosEfectivoObra = Array.isArray(lista) ? lista : [];
}

function getFondosEfectivoObra() {
  return _fondosEfectivoObra;
}

// Σ saldo teórico de los fondos de efectivo en obra.
function calcTotalFondosEfectivoObra() {
  return _fondosEfectivoObra.reduce((acc, f) => acc + (Number(f.saldo) || 0), 0);
}

// Efectivo total de la empresa: caja física de SOGRUB + custodiado en obra.
function calcEfectivoTotalEmpresa() {
  return calcSaldoEfectivo() + calcTotalFondosEfectivoObra();
}

// ¿Este fondo trae un arqueo declarado usable?
function _tieneArqueoObra(f) {
  return !!(f && f.arqueo && Number.isFinite(Number(f.arqueo.monto)));
}

// Conciliación consolidada: caja SOGRUB + fondos en obra con arqueo declarado.
//   diferencia > 0 sobrante · < 0 faltante · 0 cuadrado (mismo signo que arriba).
function calcConciliacionEfectivoConsolidada() {
  const conArqueo = _fondosEfectivoObra.filter(_tieneArqueoObra);
  const sinArqueo = _fondosEfectivoObra.filter(f => !_tieneArqueoObra(f));

  const arqueoObras  = conArqueo.reduce((acc, f) => acc + Number(f.arqueo.monto), 0);
  const teoricoObras = conArqueo.reduce((acc, f) => acc + (Number(f.saldo) || 0), 0);

  const arqueoSOGRUB  = calcTotalArqueo();
  const teoricoSOGRUB = calcSaldoEfectivo();
  const arqueoTotal   = arqueoSOGRUB + arqueoObras;
  const teoricoTotal  = teoricoSOGRUB + teoricoObras;

  return {
    arqueoSOGRUB, teoricoSOGRUB,
    arqueoObras, teoricoObras,
    arqueoTotal, teoricoTotal,
    diferencia: arqueoTotal - teoricoTotal,
    difSOGRUB:  arqueoSOGRUB - teoricoSOGRUB,
    difObras:   arqueoObras - teoricoObras,
    conArqueo, sinArqueo,
    // Saldo teórico que nadie ha contado todavía — no entra en la diferencia.
    montoSinArqueo: sinArqueo.reduce((acc, f) => acc + (Number(f.saldo) || 0), 0),
  };
}

// =====================================================
// Retiro de Mifel a efectivo (doble registro)
//   Mifel: egreso (sogrub_movimientos, tipo='retiro_efectivo')
//   Efectivo: ingreso (sogrub_efectivo_movimientos, tipo='retiro')
// Ligados por retiro_ref para poder borrarlos juntos.
// =====================================================
function ejecutarRetiroEfectivo(monto, concepto, fecha) {
  const ref = generateId();
  const conceptoFinal = concepto || 'Retiro de Mifel a efectivo';

  const movMifel = addItem(KEYS.MOVIMIENTOS, {
    fecha,
    monto:       -Math.abs(monto),
    concepto:    conceptoFinal,
    status:      'Pagado',
    tipo:        'retiro_efectivo',
    proyecto_id: null,
    retiro_ref:  ref,
  });

  const movEfectivo = addItem(KEYS.EFECTIVO_MOV, {
    fecha,
    monto:      Math.abs(monto),
    concepto:   conceptoFinal,
    tipo:       'retiro',
    origen:     'mifel',
    retiro_ref: ref,
  });

  return { movMifel, movEfectivo };
}

// =====================================================
// Ingreso de efectivo a Mifel (doble registro) — inverso del retiro
//   Efectivo: egreso (sogrub_efectivo_movimientos, tipo='ingreso_mifel', monto −)
//   Mifel: ingreso (sogrub_movimientos, tipo='ingreso_efectivo', monto +, sin
//          metodo_pago → cuenta como electrónico en calcSaldoMifel).
// Ligados por retiro_ref para poder borrarlos juntos.
// =====================================================
function ejecutarIngresoMifel(monto, concepto, fecha) {
  const ref = generateId();
  const conceptoFinal = concepto || 'Ingreso de efectivo a Mifel';

  const movMifel = addItem(KEYS.MOVIMIENTOS, {
    fecha,
    monto:       Math.abs(monto),
    concepto:    conceptoFinal,
    status:      'Pagado',
    tipo:        'ingreso_efectivo',
    proyecto_id: null,
    retiro_ref:  ref,
  });

  const movEfectivo = addItem(KEYS.EFECTIVO_MOV, {
    fecha,
    monto:      -Math.abs(monto),
    concepto:   conceptoFinal,
    tipo:       'ingreso_mifel',
    origen:     'mifel',
    retiro_ref: ref,
  });

  return { movMifel, movEfectivo };
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
// REGLA 3B — Desglose del saldo de caja: electrónico vs efectivo
// El saldo total (REGLA 3) se parte según el metodo_pago de los movimientos:
//   efectivo   = cobros en efectivo − gastos pagados en efectivo (excl. caja chica)
//   electrónico = total − efectivo (todo lo demás: transferencias SOGRUB, cobros
//                y gastos por transferencia, depósitos a caja chica, etc.)
// Se define el electrónico como residuo para garantizar que ambos sumen el total
// exacto de calcSaldoCajaProyecto, sin importar casos borde.
// =====================================================
function calcSaldoCajaProyectoDesglose(proyectoId) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId);
  const esEfectivo = m => m.metodo_pago === 'efectivo';

  const efIn = movs
    .filter(m => m.tipo === 'abono_cliente' && esEfectivo(m))
    .reduce((acc, m) => acc + Math.abs(m.monto), 0);

  const efOut = movs
    .filter(m => m.tipo === 'gasto' && m.status === 'Pagado' && !m.paga_de_caja_chica && esEfectivo(m))
    .reduce((acc, m) => acc + Math.abs(m.monto), 0);

  const efectivo = efIn - efOut;
  const total    = calcSaldoCajaProyecto(proyectoId);
  return { total, efectivo, electronico: total - efectivo };
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
// Liquidez operativa (Mifel + efectivo, ambos reciben cobros y pagan gastos)
// − Dinero comprometido (saldos positivos en proyectos activos)
// → El "libre de compromisos" no cambia cuando un cliente paga o se paga
//   un gasto de proyecto: la caja (Mifel o efectivo) sube/baja y el
//   comprometido sube/baja en igual medida, manteniéndose estable.
//   Se incluye efectivo porque los cobros/gastos en efectivo mueven la caja
//   del proyecto (comprometido) sin tocar Mifel; sin él, el disponible se
//   distorsiona.
// =====================================================
function calcDisponibleReal() {
  return calcSaldoMifel() + calcSaldoEfectivo() - calcDineroComprometido();
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
// REGLA 7B — % Avance de cobranza
// (total cobrado al cliente / presupuesto_contrato) × 100
// Mide cuánto del contrato ya pagó el cliente (avance financiero de obra).
// =====================================================
function calcAvanceCobranza(proyectoId) {
  const proyecto = getItem(KEYS.PROYECTOS, proyectoId);
  if (!proyecto || !proyecto.presupuesto_contrato) return 0;
  const cobrado = calcTotalCobradoCliente(proyectoId);
  return (cobrado / proyecto.presupuesto_contrato) * 100;
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
    avanceCobranza:   calcAvanceCobranza(proyectoId),
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
      // Preferir subtotal/IVA guardados (exactos aun con retenciones, donde el
      // monto viene neto); si no existen, derivar del monto bruto (/1.16).
      const tieneDesglose = Number(m.monto_subtotal) > 0 && m.monto_iva != null;
      const neto = tieneDesglose ? Math.abs(m.monto_subtotal) : abs / 1.16;
      const iva  = tieneDesglose ? Math.abs(m.monto_iva)      : abs - neto;
      gastoNeto += neto;
      ivaPagado += iva;
      if (tieneFactura) ivaVerificado += iva;
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

  // Indirectos oficina y campo: ambos son % del costo directo (como OPUS),
  // se suman al CD para formar el subtotal de indirectos.
  const indOficina = cd * io;
  const indCampo   = cd * ic;
  let acum = cd + indOficina + indCampo;
  // Financiamiento y utilidad sí cascadean sobre el acumulado.
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
