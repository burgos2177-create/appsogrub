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
  // Se suma pago por pago, no movimiento por movimiento: un gasto liquidado en
  // exhibiciones baja de Mifel sólo lo que ya salió, y cada exhibición puede
  // haber salido de una caja distinta.
  const gastosPagados = -proyMov
    .filter(m => m.tipo === 'gasto' && !m.paga_de_caja_chica && !m.no_afecta_mifel)
    .flatMap(aplicacionesPago)
    .filter(p => p.metodo_pago !== 'efectivo')
    .reduce((acc, p) => acc + p.monto, 0);

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
  const proyMovs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => !m.paga_de_caja_chica);
  // Abonos del cliente cobrados en efectivo → entran a la caja física.
  const abonosEfectivo = proyMovs
    .filter(m => m.tipo === 'abono_cliente' && m.metodo_pago === 'efectivo')
    .reduce((acc, m) => acc + Math.abs(m.monto), 0);
  // Gastos: exhibición por exhibición, sólo las liquidadas en efectivo.
  const gastosEfectivo = proyMovs
    .filter(m => m.tipo === 'gasto')
    .flatMap(aplicacionesPago)
    .filter(p => p.metodo_pago === 'efectivo')
    .reduce((acc, p) => acc + p.monto, 0);
  const proyEfectivo = abonosEfectivo - gastosEfectivo;

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
// Si se pasa proyectoId, el efectivo era comprometido a esa obra: sigue
// comprometido, sólo cambia de efectivo a electrónico. Se etiqueta proyecto_id
// en ambos movimientos; el desglose de la obra (calcSaldoCajaProyectoDesglose)
// corre ese monto de efectivo → electrónico sin cambiar el total (comprometido
// y disponible quedan igual; el saldo de Mifel sube y el de efectivo baja).
function ejecutarIngresoMifel(monto, concepto, fecha, proyectoId = null) {
  const ref = generateId();
  const conceptoFinal = concepto || 'Ingreso de efectivo a Mifel';

  const movMifel = addItem(KEYS.MOVIMIENTOS, {
    fecha,
    monto:       Math.abs(monto),
    concepto:    conceptoFinal,
    status:      'Pagado',
    tipo:        'ingreso_efectivo',
    proyecto_id: proyectoId || null,
    retiro_ref:  ref,
  });

  const movEfectivo = addItem(KEYS.EFECTIVO_MOV, {
    fecha,
    monto:      -Math.abs(monto),
    concepto:   conceptoFinal,
    tipo:       'ingreso_mifel',
    origen:     'mifel',
    proyecto_id: proyectoId || null,
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
    .filter(m => m.tipo === 'gasto' && !m.paga_de_caja_chica)
    .reduce((acc, m) => acc + montoPagadoDe(m), 0);

  // Depósitos del proyecto a caja chica → bajan saldo del proyecto.
  const depositosCajaChica = movs
    .filter(m => m.tipo === 'deposito_caja_chica' && m.status === 'Pagado')
    .reduce((acc, m) => acc + Math.abs(m.monto), 0);

  // Devoluciones del fondo efectivo de caja chica → el billete regresa a la
  // caja física de SOGRUB y el proyecto recupera el monto que bajó al depositar.
  // Inverso exacto del depósito: una devolución del mismo monto lo neutraliza.
  const devolucionesCajaChica = movs
    .filter(m => m.tipo === 'devolucion_caja_chica' && m.status === 'Pagado')
    .reduce((acc, m) => acc + Math.abs(m.monto), 0);

  return abonos + transferencias - gastosPagados - depositosCajaChica + devolucionesCajaChica;
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

  // Traspasos efectivo↔Mifel asignados a esta obra (viven en EFECTIVO_MOV).
  // Ajustan sólo el split, no el total (por eso el electrónico es el residuo):
  //   ingreso_mifel (monto −): efectivo de la obra pasó a electrónico → efectivo −
  //   retiro        (monto +): electrónico de la obra pasó a efectivo  → efectivo +
  const traspasos = (getCollection(KEYS.EFECTIVO_MOV) ?? [])
    .filter(m => m.proyecto_id === proyectoId && (m.tipo === 'ingreso_mifel' || m.tipo === 'retiro'))
    .reduce((acc, m) => acc + (Number(m.monto) || 0), 0);

  // Movimientos del fondo EFECTIVO de caja chica (metodo_pago='efectivo'):
  // el billete sale de la obra al depositar y regresa al devolver, así que
  // mueven la mitad de efectivo del saldo, no la electrónica. Sin esto el
  // efectivo de la obra queda inflado por todo lo que tenga en el fondo (el
  // residuo se lo comía el electrónico) y podía llegar a superar la caja
  // física de toda la empresa. El depósito del fondo TRANSFERENCIA sí sale de
  // Mifel: ese sigue absorbiéndolo el electrónico como residuo, y por eso no
  // entra aquí.
  const cajaChicaEfectivo = movs
    .filter(m => esEfectivo(m) && m.status === 'Pagado' &&
      (m.tipo === 'deposito_caja_chica' || m.tipo === 'devolucion_caja_chica'))
    .reduce((acc, m) => acc + (m.tipo === 'devolucion_caja_chica' ? 1 : -1) * Math.abs(m.monto), 0);

  const efectivo = efIn - efOut + traspasos + cajaChicaEfectivo;
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

  // Se suma el saldo NETO de cada obra, incluyendo los negativos. Un saldo
  // negativo (la obra gastó/nominó más de lo que se le ha fondeado) sigue siendo
  // dinero comprometido con esa obra —no un gasto libre de SOGRUB—, así que
  // debe restar de "comprometido" para que el "libre de compromisos" NO se altere:
  // Mifel baja por la nómina y comprometido baja igual → el libre queda estable.
  // (Antes se pisaba a 0 el negativo, y por eso el libre absorbía esas nóminas.)
  return proyectos.reduce((acc, p) => acc + calcSaldoCajaProyecto(p.id), 0);
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
// REGLA 5B — Disponible libre partido por forma de dinero
//   electrónico = Mifel        − Σ saldo electrónico de proyectos activos
//   efectivo    = caja física  − Σ saldo efectivo de proyectos activos
// La suma de ambos es exactamente calcDisponibleReal(): el total siempre
// cuadra aunque una mitad no.
//
// Para qué: el disponible global puede verse sano y aun así estar mal
// repartido. Si el efectivo libre sale NEGATIVO, las obras tienen asignado
// más billete del que existe en la caja física — señal de que hay cobros
// marcados como efectivo que en realidad entraron por transferencia (o al
// revés), o de un traspaso efectivo↔Mifel sin vincular a su obra. El dinero
// total está bien; lo que está mal es de qué caja se dice que salió.
// =====================================================
function calcDisponibleDesglose() {
  const proyectos = (getCollection(KEYS.PROYECTOS) ?? [])
    .filter(p => p.estado === 'activo');

  let compElectronico = 0, compEfectivo = 0;
  for (const p of proyectos) {
    const d = calcSaldoCajaProyectoDesglose(p.id);
    compElectronico += d.electronico;
    compEfectivo    += d.efectivo;
  }

  const electronico = calcSaldoMifel()    - compElectronico;
  const efectivo    = calcSaldoEfectivo() - compEfectivo;
  return {
    electronico, efectivo,
    total: electronico + efectivo,
    compElectronico, compEfectivo,
  };
}

// =====================================================
// REGLA 6 — Deuda pendiente de un proyecto (compat: número total)
// Total = deuda a proveedores (gastos con status='Pendiente').
// Para el desglose con caja chica, usar calcDeudaPendienteDesglose() abajo.
// =====================================================
function calcDeudaPendiente(proyectoId) {
  // Saldo insoluto, no monto completo: un gasto con el 60% de anticipo ya
  // pagado sólo debe el 40% restante.
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto');
  return movs.reduce((acc, m) => acc + saldoPendienteDe(m), 0);
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
  const retenido  = calcFondosRetenidos(proyectoId).pendiente;
  return { proveedores, cajaChica, retenido, total: proveedores + cajaChica + retenido };
}

// =====================================================
// FONDOS RETENIDOS A SUBCONTRATISTAS
//
// Al pagarle una estimación a un sub se le puede retener una parte (fondo de
// garantía por vicios ocultos, típicamente 5-10%) y liberarla meses después.
//
// La regla que no se puede romper: **retener NO es gastar**. El dinero sigue
// en tu caja; es un pasivo, no una salida. Por eso el fondo vive en su propia
// colección y NO en `sogrub_proy_movimientos`: si estuviera ahí, cualquier
// suma de gastos lo contaría, y al liberarlo se contaría otra vez.
//
// El gasto de la estimación ya viene NETO desde estimaciones (`monto.importe`).
// `importeBruto` y `retencionTotal` son informativos, para explicar por qué el
// gasto no coincide con lo estimado. No se restan ni se suman.
// =====================================================
function retencionesDeProyecto(proyectoId) {
  return (getCollection(KEYS.RETENCIONES) ?? [])
    .filter(r => r.proyecto_id === proyectoId)
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
}

function calcFondosRetenidos(proyectoId) {
  const rs = retencionesDeProyecto(proyectoId);
  const n = v => Math.abs(Number(v) || 0);
  const pendiente = rs.filter(r => r.estado !== 'liberado').reduce((a, r) => a + n(r.monto), 0);
  const liberado  = rs.filter(r => r.estado === 'liberado').reduce((a, r) => a + n(r.monto), 0);
  return { retenciones: rs, pendiente, liberado, total: pendiente + liberado, count: rs.length };
}

// Comprometido con un subcontratista = lo que ya se le pagó + lo que se le
// retiene. Es el costo real del subcontrato, aunque parte no haya salido.
function calcComprometidoSubcontratistas(proyectoId) {
  const gastos = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto'
              && (m.categoria || '') === 'Subcontratista');
  const pagado = gastos.reduce((a, m) => a + Math.abs(Number(m.monto) || 0), 0);
  const fondo  = calcFondosRetenidos(proyectoId).pendiente;
  return { pagado, fondo, total: pagado + fondo };
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
// AVANCE DE OBRA — lo publica app-estimaciones
//
// /shared/avanceObra/{obraId} trae el dato que a bitácora le faltaba para
// medir utilidad de verdad: `ejecutadoCatalogoSubtotal`, el valor de VENTA
// (a precio de catálogo, sin IVA) de la obra que YA se ejecutó. Sin ese
// número, lo único que se puede calcular es cobrado − gastado, que es flujo
// de caja y no utilidad: el anticipo del cliente lo infla.
//
// El vínculo proyecto↔obra sale de /shared/obraLinks por búsqueda inversa.
// =====================================================
const _avanceObraCache = {};   // proyectoId → { obraId, ...datos } | null
const _avanceHistCache = {};   // proyectoId → [ punto por estimación, ordenado ]
const _avanceSnapsCache = {};  // proyectoId → { 'YYYY-MM-DD': valor }  (fallback propio)

function getAvanceObra(proyectoId) {
  return _avanceObraCache[proyectoId] ?? null;
}

// Historial por estimación que publica estimaciones en
// /shared/avanceObra/{obraId}/historial. Un punto por estimación, con el
// ACUMULADO sin IVA a su fecha de corte.
function getAvanceHistorial(proyectoId) {
  return _avanceHistCache[proyectoId] ?? [];
}

function _normalizarHistorialAvance(raw) {
  return Object.entries(raw || {})
    .map(([id, h]) => ({
      id,
      numero:       Number(h?.numero) || 0,
      estado:       h?.estado === 'abierta' ? 'abierta' : 'cerrada',
      fechaCierre:  typeof h?.fechaCierre === 'string' ? h.fechaCierre.slice(0, 10) : null,
      acumulado:    Number(h?.ejecutadoCatalogoSubtotal),
      delPeriodo:   Number(h?.ejecutadoPeriodoSubtotal),
      periodoDesde: h?.periodoDesde ?? null,
      periodoHasta: h?.periodoHasta ?? null,
      avancePct:    Number(h?.avancePct),
    }))
    .filter(h => h.fechaCierre && Number.isFinite(h.acumulado))
    .sort((a, b) => (a.numero - b.numero) || a.fechaCierre.localeCompare(b.fechaCierre));
}

// Puntos utilizables para dibujar la curva. Se prefiere el historial de
// estimaciones; si la obra todavía no lo tiene, se cae a las fotos diarias que
// bitácora se guarda por su cuenta.
function avanceNumPuntos(proyectoId) {
  const cerradas = getAvanceHistorial(proyectoId).filter(h => h.estado !== 'abierta').length;
  return cerradas || Object.keys(_avanceSnapsCache[proyectoId] ?? {}).length;
}

// Acumulado ejecutado vigente en `fechaISO` — da la curva escalonada: el valor
// de una estimación se mantiene hasta que cierra la siguiente. Las estimaciones
// 'abierta' se excluyen: todavía no son valor cerrado.
function avanceEjecutadoEnFecha(proyectoId, fechaISO) {
  const hist = getAvanceHistorial(proyectoId);
  let mejor = null;
  if (hist.length) {
    for (const h of hist) {
      if (h.estado === 'abierta') continue;
      if (h.fechaCierre <= fechaISO) mejor = h.acumulado;
    }
    return mejor;
  }
  const snaps = _avanceSnapsCache[proyectoId] ?? {};
  for (const f of Object.keys(snaps).sort()) {
    if (f <= fechaISO) mejor = Number(snaps[f]);
  }
  return Number.isFinite(mejor) ? mejor : null;
}

// El último punto cerrado del historial debe coincidir con el campo raíz
// (misma definición). Si no amarran, algo se publicó a medias y conviene verlo
// antes de creerle a la utilidad realizada.
function avanceValidacionRaiz(proyectoId) {
  const av   = getAvanceObra(proyectoId);
  const hist = getAvanceHistorial(proyectoId).filter(h => h.estado !== 'abierta');
  const raiz = Number(av?.ejecutadoCatalogoSubtotal);
  if (!hist.length || !Number.isFinite(raiz)) return null;
  const ultimo = hist[hist.length - 1];
  const dif = raiz - ultimo.acumulado;
  return { raiz, ultimo, dif, cuadra: Math.abs(dif) <= 1 };
}

// La estimación en curso, si estimaciones la publica.
function avanceEstimacionAbierta(proyectoId) {
  return getAvanceHistorial(proyectoId).find(h => h.estado === 'abierta') ?? null;
}

// Siempre relee: la llave del historial es el id de estimación y si reabren o
// corrigen una, esos puntos se reescriben. Cachear la serie dejaría la curva
// vieja en pantalla sin forma de saberlo.
async function cargarAvanceObra(proyectoId) {
  try {
    const links  = (await _dbRef('/shared/obraLinks').get()).val() || {};
    const obraId = Object.entries(links).find(([, pid]) => String(pid) === String(proyectoId))?.[0];
    if (!obraId) { _avanceObraCache[proyectoId] = null; return null; }

    // Si hay vínculo pero todavía no hay nodo de avance, se conserva el obraId
    // con `sinDatos`: no es lo mismo "obra sin parear" que "obra pareada a la
    // que estimaciones aún no le publica el avance", y el mensaje debe decir cuál.
    const val = (await _dbRef(`/shared/avanceObra/${obraId}`).get()).val();
    _avanceObraCache[proyectoId] = val ? { obraId, ...val } : { obraId, sinDatos: true };
    _avanceHistCache[proyectoId] = _normalizarHistorialAvance(val?.historial);

    // Fallback para obras que aún no traen historial: bitácora se guarda una
    // foto diaria del acumulado. Con historial publicado ya no hace falta y no
    // se escribe nada.
    const ejec = Number(val?.ejecutadoCatalogoSubtotal);
    if (!_avanceHistCache[proyectoId].length && Number.isFinite(ejec)) {
      const hoy = new Date().toISOString().slice(0, 10);
      _dbRef(`sogrub_avance_historial/${proyectoId}/${hoy}`).set(ejec)
        .catch(e => console.warn('[AvanceObra snapshot]', e));
      try {
        _avanceSnapsCache[proyectoId] =
          (await _dbRef(`sogrub_avance_historial/${proyectoId}`).get()).val() || {};
      } catch { _avanceSnapsCache[proyectoId] = {}; }
    }

    return _avanceObraCache[proyectoId];
  } catch (err) {
    console.warn('[AvanceObra]', err);
    // No se cachea el fallo: puede ser un corte de red y conviene reintentar.
    return null;
  }
}

// Costo presupuestado VIGENTE = las tres bolsitas de gasto (directo + los dos
// indirectos), ya con el acumulado de órdenes de cambio. No incluye
// financiamiento ni utilidad: eso es margen, no costo.
//
// Tiene que ser el vigente y no el original: una OC deductiva baja la venta Y
// baja los rubros de costo. Si acá se dejara el costo original, toda la
// reducción del contrato caería sobre la utilidad esperada, como si se hubiera
// quitado obra y aun así hubiera que pagarla.
//
// Igual que en calcBolsitasProyecto, `rubrosAcum` es ESTADO: se parte del
// original fresco y se le suma el acumulado, nunca sobre el valor ya ajustado.
function calcPresupuestoCostoTotal(proyectoId) {
  const d  = calcDesgloseContrato(getItem(KEYS.PROYECTOS, proyectoId) ?? {});
  const oc = ajusteRubrosOC(proyectoId);
  const base = d.costoDirecto + d.indOficina + d.indCampo;
  return oc ? base + oc.costoDirecto + oc.indOficina + oc.indCampo : base;
}

// Contrato vigente SIN IVA. Prioridad: el nodo de OC (autoritativo, lo publica
// estimaciones) → el que trae avanceObra → el original de bitácora + el
// acumulado de venta. Sin OC las tres rutas dan lo mismo.
function calcContratoVigenteSubtotal(proyectoId, avance) {
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  const d   = calcDesgloseContrato(getItem(KEYS.PROYECTOS, proyectoId) ?? {});
  const oc  = ajusteRubrosOC(proyectoId);
  return num(getContratoOC(proyectoId)?.contrato?.subtotal)
      ?? num(avance?.contratoSubtotal)
      ?? (d.contrato + (oc ? oc.venta : 0));
}

// =====================================================
// LECTURA TIPO "TRADE" — separa lo ganado de lo flotante
//
// La obra se lee como una posición: hay una parte cerrada (lo ejecutado, ya
// ganado) y una abierta (lo que falta por ejecutar, todavía por materializar).
//
//   PnL realizado = venta de lo ejecutado − costo incurrido
//   PnL flotante  = utilidad esperada − PnL realizado
//   Efectivo flotante del cliente = cobrado neto − venta ejecutada
//     → dinero que ya está en tu caja pero aún no es tuyo; se gana ejecutando.
//
// Todo SIN IVA: el IVA es un pass-through, no utilidad.
//
// Caveat de costos: el realizado asume que lo gastado corresponde a lo
// ejecutado. Si se compró material para obra futura, el realizado se ve bajo
// temporalmente (es inventario) y se recupera al instalarlo; el flotante lo
// absorbe, así que la utilidad esperada no se mueve.
// =====================================================
function calcLecturaTrade(proyectoId) {
  const avance   = getAvanceObra(proyectoId);
  const d        = calcDesgloseContrato(getItem(KEYS.PROYECTOS, proyectoId) ?? {});
  const ocAj     = ajusteRubrosOC(proyectoId);

  // Ambos lados VIGENTES: si una OC movió el contrato, también movió los rubros
  // de costo. Comparar venta vigente contra costo original hacía que toda la
  // deductiva se leyera como utilidad perdida.
  const cPresup     = calcPresupuestoCostoTotal(proyectoId);
  const vContrato   = calcContratoVigenteSubtotal(proyectoId, avance);
  const cIncurrido  = calcTotalGastadoPagado(proyectoId);
  const netoCobrado = calcIVACobradoCliente(proyectoId).netoTotal;

  const vEjecRaw    = Number(avance?.ejecutadoCatalogoSubtotal);
  const tieneAvance = Number.isFinite(vEjecRaw);
  const vEjec       = tieneAvance ? vEjecRaw : null;

  const utilidadEsperada = vContrato - cPresup;
  const pnlRealizado     = tieneAvance ? vEjec - cIncurrido : null;

  return {
    tieneAvance,
    obraId:  avance?.obraId ?? null,
    updatedAt: avance?.updatedAt ?? null,
    vEjec, vContrato, cIncurrido, cPresup, netoCobrado,
    utilidadEsperada,
    // Desglose del efecto de las OC sobre la utilidad esperada, para que se vea
    // cuánto del cambio de contrato fue obra que se quitó (costo) y cuánto fue
    // margen de verdad. Sin OC va en null y la tarjeta no lo pinta.
    oc: ocAj ? {
      venta:    ocAj.venta,
      costo:    ocAj.costoDirecto + ocAj.indOficina + ocAj.indCampo,
      utilidad: ocAj.venta - (ocAj.costoDirecto + ocAj.indOficina + ocAj.indCampo),
      contratoOriginal: vContrato - ocAj.venta,
      costoOriginal:    cPresup - (ocAj.costoDirecto + ocAj.indOficina + ocAj.indCampo),
    } : null,
    pnlRealizado,
    pnlFlotante:      tieneAvance ? utilidadEsperada - pnlRealizado : null,
    margenRealizado:  (tieneAvance && vEjec > 0) ? (pnlRealizado / vEjec) * 100 : null,
    margenEsperado:   vContrato > 0 ? (utilidadEsperada / vContrato) * 100 : null,
    efectivoFlotante: tieneAvance ? netoCobrado - vEjec : null,
    avanceEjecutado:  (tieneAvance && vContrato > 0) ? (vEjec / vContrato) * 100 : null,
    // Cobrado − gastado. Es caja, NO utilidad: incluye el anticipo del cliente.
    flujoCaja: netoCobrado - cIncurrido,
  };
}

// =====================================================
// ÓRDENES DE CAMBIO — contrato vigente (lo publica estimaciones)
//
// /shared/contratos/{obraId} trae el contrato FORMAL VIGENTE, ya con las OC
// aplicadas, y `rubrosAcum` con el movimiento ACUMULADO por rubro (con signo).
//
// Regla que no se puede romper: `rubrosAcum` es ESTADO, no evento. El vigente
// siempre se RECALCULA como original + rubrosAcum. Si se acumulara en cada
// lectura, el ajuste se duplicaría. Por lo mismo, el `impactoRubros` que trae
// cada item del buzón es el delta de UNA OC y sirve SOLO para mostrarlo en la
// tarjeta — sumarlo además de rubrosAcum contaría doble.
//
// Bitácora solo LEE estos nodos. Si algo no cuadra, es bug de estimaciones.
// =====================================================
const _contratoOCCache = {};   // proyectoId → nodo | null

function getContratoOC(proyectoId) {
  return _contratoOCCache[proyectoId] ?? null;
}

async function cargarContratoOC(proyectoId) {
  try {
    const links  = (await _dbRef('/shared/obraLinks').get()).val() || {};
    const obraId = Object.entries(links).find(([, pid]) => String(pid) === String(proyectoId))?.[0];
    if (!obraId) { _contratoOCCache[proyectoId] = null; return null; }
    const val = (await _dbRef(`/shared/contratos/${obraId}`).get()).val();
    // Ausencia = obra que nunca pasó por el módulo de OC. No es error.
    _contratoOCCache[proyectoId] = val ? { obraId, ...val } : null;
  } catch (err) {
    console.warn('[ContratoOC]', err);
    _contratoOCCache[proyectoId] = null;
  }
  return _contratoOCCache[proyectoId];
}

// ¿Esta obra tiene órdenes de cambio aplicadas?
function tieneOrdenesCambio(proyectoId) {
  return (Number(getContratoOC(proyectoId)?.ordenesCambio?.count) || 0) > 0;
}

// Lista de OC aplicadas, ordenada por número.
function listaOrdenesCambio(proyectoId) {
  const ap = getContratoOC(proyectoId)?.ordenesCambio?.aplicadas || {};
  return Object.entries(ap)
    .map(([ocId, oc]) => ({ ocId, ...oc }))
    .sort((a, b) => (Number(a.numero) || 0) - (Number(b.numero) || 0));
}

// Ajuste acumulado por rubro, mapeado a las bolsitas de bitácora.
// Los rubros vienen CON SIGNO: solo se suman, sin Math.abs ni inversiones.
function ajusteRubrosOC(proyectoId) {
  const r = getContratoOC(proyectoId)?.rubrosAcum;
  if (!r) return null;
  const n = v => Number(v) || 0;
  return {
    costoDirecto:   n(r.costoDirecto),
    indOficina:     n(r.indOficina),
    indCampo:       n(r.indCampo),
    financiamiento: n(r.financiamiento),
    utilidad:       n(r.utilidad),
    otros:          n(r.cargos) + n(r.otro),
    venta:          n(r.venta),
  };
}

// Invariantes del nodo. No se corrige nada: si algo no amarra es bug del
// publicador y hay que verlo allá, no taparlo acá.
function validarContratoOC(proyectoId) {
  const c = getContratoOC(proyectoId);
  if (!c?.ordenesCambio) return null;
  const n = v => Number(v) || 0;
  const tol = 1;
  const pruebas = [
    { nombre: 'rubrosAcum.venta = netoAcum',
      a: n(c.rubrosAcum?.venta), b: n(c.ordenesCambio.netoAcum) },
    { nombre: 'contrato.total = original + netoAcumCIVA',
      a: n(c.contrato?.total), b: n(c.contratoOriginalCIVA) + n(c.ordenesCambio.netoAcumCIVA) },
    { nombre: 'subtotal + iva = total',
      a: n(c.contrato?.subtotal) + n(c.contrato?.iva), b: n(c.contrato?.total) },
  ].map(p => ({ ...p, dif: p.a - p.b, ok: Math.abs(p.a - p.b) <= tol }));
  return { pruebas, cuadra: pruebas.every(p => p.ok) };
}

// =====================================================
// PROGRAMA DE OBRA — la línea base (valor planeado / curva S)
//
// Vive en /legacy/bitacora/sogrub_programa_obra/{proyectoId}:
//   { nombre, inicio, fin, festivos:[], actividades:{ id: {orden, nombre, frente,
//     inicio, fin, dias, claves:[...] } } }
//
// El programa da FECHAS y el catálogo OPUS da DINERO. Se cruzan por clave: el
// importe de cada concepto se reparte entre las actividades que lo mencionan
// (ponderando por días, porque una actividad agrupa claves de unidades
// distintas y multiplicar cantidad × PU mezclaría m² con m³), y el importe de
// cada actividad se reparte en sus días hábiles. Así Σ curva = Σ catálogo, que
// es la condición para que el SPI signifique algo.
// =====================================================
const _programaCache = {};   // proyectoId → programa | null

function getProgramaObra(proyectoId) {
  return _programaCache[proyectoId] ?? null;
}

async function cargarProgramaObra(proyectoId) {
  try {
    _programaCache[proyectoId] =
      (await _dbRef(`sogrub_programa_obra/${proyectoId}`).get()).val() || null;
  } catch (err) {
    console.warn('[ProgramaObra]', err);
    _programaCache[proyectoId] = null;
  }
  return _programaCache[proyectoId];
}

// Días laborables entre dos fechas (L-V menos festivos declarados).
function _diasHabilesEntre(inicio, fin, festivos = []) {
  const out = [];
  const d = new Date(inicio + 'T12:00'), f = new Date(fin + 'T12:00');
  while (d <= f && out.length < 500) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6 && !festivos.includes(iso)) out.push(iso);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function calcCurvaPlaneada(proyectoId) {
  const prog = getProgramaObra(proyectoId);
  const pres = typeof getPresupuesto === 'function' ? getPresupuesto(proyectoId) : null;
  if (!prog?.actividades || !pres?.conceptos?.length) return null;

  const acts = Object.entries(prog.actividades)
    .map(([id, a]) => ({ id, ...a }))
    .filter(a => a.inicio && a.fin)
    .sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
  if (!acts.length) return null;

  // clave → actividades que la ejecutan
  const porClave = new Map();
  for (const a of acts) {
    for (const k of (a.claves || [])) {
      const kk = String(k).trim();
      if (!porClave.has(kk)) porClave.set(kk, []);
      porClave.get(kk).push(a);
    }
  }

  const valor = Object.fromEntries(acts.map(a => [a.id, 0]));
  const sinProgramar = [];
  let totalCatalogo = 0;

  for (const c of pres.conceptos) {
    if (c.tipo !== 'concepto' || c.archivado) continue;
    const total = Number(c.total) || 0;
    if (!total) continue;
    totalCatalogo += total;

    const destinos = porClave.get(String(c.clave).trim());
    if (!destinos?.length) {
      sinProgramar.push({ clave: c.clave, descripcion: c.descripcion, total });
      continue;
    }
    const sumaDias = destinos.reduce((s, a) => s + (Number(a.dias) || 1), 0);
    for (const a of destinos) valor[a.id] += total * ((Number(a.dias) || 1) / sumaDias);
  }

  // Cada actividad se reparte linealmente en sus días hábiles.
  const festivos = prog.festivos || [];
  const porDia = {};
  for (const a of acts) {
    const dias = _diasHabilesEntre(a.inicio, a.fin, festivos);
    if (!dias.length || !valor[a.id]) continue;
    const cuota = valor[a.id] / dias.length;
    for (const d of dias) porDia[d] = (porDia[d] || 0) + cuota;
  }

  const fechas = Object.keys(porDia).sort();
  const acumulado = {};
  let acc = 0;
  for (const f of fechas) { acc += porDia[f]; acumulado[f] = acc; }

  return {
    acumulado, fechas,
    total: acc,
    totalCatalogo,
    cobertura: totalCatalogo > 0 ? acc / totalCatalogo : 0,
    sinProgramar: sinProgramar.sort((a, b) => b.total - a.total),
    actividades: acts.map(a => ({ ...a, importe: valor[a.id] })),
    inicio: prog.inicio, fin: prog.fin, nombre: prog.nombre,
  };
}

// Valor planeado acumulado a una fecha (interpolado al último día con dato).
function planeadoEnFecha(proyectoId, fechaISO, curva = null) {
  const c = curva || calcCurvaPlaneada(proyectoId);
  if (!c) return null;
  let mejor = null;
  for (const f of c.fechas) {
    if (f > fechaISO) break;
    mejor = c.acumulado[f];
  }
  return mejor;
}

// Índice de tiempo: cuánto llevas ejecutado contra cuánto debías llevar hoy.
// SPI = 1 → al corriente · < 1 → atrasado · > 1 → adelantado.
function calcSPI(proyectoId) {
  const curva = calcCurvaPlaneada(proyectoId);
  const t = calcLecturaTrade(proyectoId);
  if (!curva || !t.tieneAvance) return null;
  const hoy = new Date().toISOString().slice(0, 10);
  const pv  = planeadoEnFecha(proyectoId, hoy, curva);
  if (!pv) return null;
  return {
    pv, ev: t.vEjec,
    spi: pv > 0 ? t.vEjec / pv : null,
    variacion: t.vEjec - pv,        // + adelantado · − atrasado (en dinero)
    curva,
  };
}

// =====================================================
// VALOR GANADO (earned value) — el índice de costo honesto
//
// El ejecutado viene a precio de VENTA, así que ejecutado/gastado da un número
// mayor a 1 que no es eficiencia: es el margen otra vez, con otro nombre. Para
// medir si la obra hecha está costando lo presupuestado hay que valuar ese
// ejecutado a COSTO, con la misma proporción costo/venta del presupuesto:
//
//   EV_costo = ejecutado × (costo presupuestado / contrato)
//   CPI      = EV_costo / costo incurrido       CPI = 1 → exactamente en presupuesto
//
// De ahí sale la proyección a terminación, que es lo que de verdad interesa:
// si el ritmo de costo se mantiene, ¿en cuánto acaba la obra y con qué utilidad?
//
//   Costo final estimado = costo presupuestado / CPI
//   Utilidad proyectada  = contrato − costo final estimado
//
// No incluye SPI ni curva S: eso necesita el programa de obra (valor planeado),
// que bitácora no tiene. Inventarlo sería medir contra una referencia falsa.
// =====================================================
function calcValorGanado(proyectoId) {
  const t = calcLecturaTrade(proyectoId);
  if (!t.tieneAvance || !(t.vContrato > 0) || !(t.cIncurrido > 0)) return null;

  const factorCosto = t.cPresup / t.vContrato;
  const evCosto     = t.vEjec * factorCosto;
  const cpi         = evCosto / t.cIncurrido;
  const costoFinal  = cpi > 0 ? t.cPresup / cpi : null;

  return {
    factorCosto, evCosto, cpi,
    // + ahorro · − sobrecosto sobre la obra ya hecha
    variacionCosto: evCosto - t.cIncurrido,
    costoFinalEstimado: costoFinal,
    utilidadProyectada: costoFinal !== null ? t.vContrato - costoFinal : null,
    utilidadEsperada:   t.utilidadEsperada,
    desvioUtilidad:     costoFinal !== null ? (t.vContrato - costoFinal) - t.utilidadEsperada : null,
  };
}

// Producción por estimación: cuánto se ejecutó en cada periodo. Si estimaciones
// no manda `ejecutadoPeriodoSubtotal`, se deriva de la diferencia de acumulados.
function calcRitmoEjecucion(proyectoId) {
  const hist = getAvanceHistorial(proyectoId).filter(h => h.estado !== 'abierta');
  let previo = 0;
  return hist.map(h => {
    const delPeriodo = Number.isFinite(h.delPeriodo) ? h.delPeriodo : (h.acumulado - previo);
    previo = h.acumulado;
    return { numero: h.numero, fechaCierre: h.fechaCierre, delPeriodo, acumulado: h.acumulado };
  });
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

// =====================================================
// PAGOS PARCIALES — una obligación, N aplicaciones de pago
//
// Un gasto puede liquidarse en varias exhibiciones (anticipo 60% + liquidación
// contra entrega, por ejemplo). La obligación es UNA: un movimiento, una
// factura, un desglose OPUS. Lo que se parte es el pago.
//
//   m.pagos = [{ id, fecha, monto, metodo_pago, referencia, nota }]
//
// `status` se sigue escribiendo ('Pagado' cuando ya no queda saldo, si no
// 'Pendiente') para que nada de lo que ya lee ese campo se rompa — incluidas
// las otras apps y el buzón. El estado intermedio vive en `pagos`, y quien
// necesite dinero real usa las funciones de aquí abajo, NO `status`.
//
// Compatibilidad: un movimiento SIN `pagos[]` rinde una aplicación implícita
// por el total si está Pagado, y ninguna si está Pendiente. Con eso todo lo
// histórico calcula exactamente igual que antes.
// =====================================================
function aplicacionesPago(m) {
  const total = Math.abs(Number(m?.monto) || 0);
  const ps = Array.isArray(m?.pagos) ? m.pagos.filter(p => Math.abs(Number(p?.monto) || 0) > 0) : [];
  if (ps.length) {
    return ps.map((p, i) => ({
      id:          p.id || `${m.id}#${i}`,
      fecha:       p.fecha || m.fecha,
      monto:       Math.abs(Number(p.monto) || 0),
      // Cada exhibición puede salir de una caja distinta: el anticipo por
      // transferencia y la liquidación en efectivo, por ejemplo.
      metodo_pago: p.metodo_pago ?? m.metodo_pago ?? 'transferencia',
      referencia:  p.referencia || '',
      nota:        p.nota || '',
      movId:       m.id,
    }));
  }
  if (m?.status === 'Pagado' && total > 0) {
    return [{
      id: m.id, fecha: m.fecha, monto: total,
      metodo_pago: m.metodo_pago ?? 'transferencia',
      referencia: '', nota: '', movId: m.id, implicita: true,
    }];
  }
  return [];
}

function montoPagadoDe(m) {
  return aplicacionesPago(m).reduce((a, p) => a + p.monto, 0);
}

function saldoPendienteDe(m) {
  return Math.max(0, Math.abs(Number(m?.monto) || 0) - montoPagadoDe(m));
}

// Pagado de más. No se tapa: si aparece, hay un pago mal capturado o el
// movimiento se editó a la baja después de pagarlo.
function sobrepagoDe(m) {
  return Math.max(0, montoPagadoDe(m) - Math.abs(Number(m?.monto) || 0));
}

// 'Pendiente' · 'Parcial' · 'Pagado'. Es el estado REAL, derivado del dinero.
function statusPagoDe(m) {
  const total = Math.abs(Number(m?.monto) || 0);
  const pag   = montoPagadoDe(m);
  if (pag <= 0.005) return 'Pendiente';
  if (pag >= total - 0.005) return 'Pagado';
  return 'Parcial';
}

// Fracción liquidada (0 a 1). Un movimiento en $0 se considera saldado.
function fraccionPagadaDe(m) {
  const total = Math.abs(Number(m?.monto) || 0);
  return total > 0 ? Math.min(1, montoPagadoDe(m) / total) : 1;
}

// Costo SIN IVA de la parte YA PAGADA. Es lo que entra a las bolsitas y al
// total gastado: se prorratea el subtotal por la fracción liquidada.
function costoPagadoSinIVA(m) {
  return montoSinIVA(m) * fraccionPagadaDe(m);
}

// Importe SIN IVA de un movimiento (sirve igual para gastos y para abonos).
//
// Por qué existe: el presupuesto OPUS (contrato, bolsitas, catálogo) está SIN
// IVA, y `monto` guarda el total CON IVA — es lo que salió del banco. Sumar
// `monto` contra un presupuesto sin IVA infla el gasto por el IVA completo y
// hace que las bolsitas se vean sobregiradas antes de estarlo.
//
// El IVA no es costo de obra: es un impuesto acreditable, un tema fiscal
// aparte. Para CAJA sí se usa `monto` (el banco no acredita nada), y por eso
// calcSaldoCajaProyecto / calcSaldoMifel se quedan como están.
//
// Prioridad: subtotal capturado → total − IVA capturado → derivado al 16% →
// el monto tal cual (gasto sin IVA).
function montoSinIVA(m) {
  const abs = Math.abs(Number(m?.monto) || 0);
  const sub = Number(m?.monto_subtotal);
  // Guarda de cordura: hay registros viejos donde monto_subtotal trae otra cosa
  // (p. ej. el ejecutado del período). Si excede el total, no es un subtotal.
  if (Number.isFinite(sub) && sub > 0 && sub <= abs + 0.005) return sub;
  const iva = Number(m?.monto_iva);
  if (Number.isFinite(iva) && iva > 0 && iva < abs) return abs - iva;
  if (m?.incluye_iva) return abs / 1.16;
  return abs;
}

// Total gastado pagado, SIN IVA — se compara contra presupuesto y contra el
// ejecutado a catálogo, que también van sin IVA.
function calcTotalGastadoPagado(proyectoId) {
  const movs = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto');
  // Sólo la parte liquidada: un gasto a 60% de anticipo aporta el 60% del costo.
  return movs.reduce((acc, m) => acc + costoPagadoSinIVA(m), 0);
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
  let nConIva = 0, nConFactura = 0, nSinIva = 0;

  movs.forEach(m => {
    const abs = Math.abs(m.monto);
    const tieneFactura = !!(m.factura_drive_url || m.factura_xml_url || m.factura_nombre || m.factura_xml_nombre);
    if (m.incluye_iva) {
      nConIva++;
      if (tieneFactura) nConFactura++;
      // Preferir subtotal/IVA guardados (exactos aun con retenciones, donde el
      // monto viene neto); si no existen, derivar del monto bruto (/1.16).
      const tieneDesglose = Number(m.monto_subtotal) > 0 && m.monto_iva != null;
      const neto = tieneDesglose ? Math.abs(m.monto_subtotal) : abs / 1.16;
      const iva  = tieneDesglose ? Math.abs(m.monto_iva)      : abs - neto;
      gastoNeto += neto;
      ivaPagado += iva;
      if (tieneFactura) ivaVerificado += iva;
    } else {
      nSinIva++;
      gastoNeto += abs;
      // OJO: esto NO es IVA que se pueda acreditar. Es el IVA que se AÑADIRÍA
      // si estos gastos llegaran facturados — sirve para armar el total de
      // factura del estado de cuenta, nada más. Un gasto marcado sin IVA no
      // generó ningún IVA acreditable.
      ivaPorCobrar += abs * 0.16;
    }
  });

  return {
    gastoNeto, ivaPagado, ivaVerificado,
    // IVA realmente pagado que todavía no tiene CFDI que lo respalde. ESTE es
    // el que no puedes acreditar hasta conseguir la factura.
    ivaSinFactura: ivaPagado - ivaVerificado,
    // IVA hipotético sobre los gastos sin IVA (ver arriba). Se conserva porque
    // el estado de cuenta lo usa para el total de factura.
    ivaPorCobrar,
    conteos: { conIva: nConIva, conFactura: nConFactura, sinFactura: nConIva - nConFactura, sinIva: nSinIva },
    totalBruto: gastoNeto + ivaPagado,
  };
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

  // Ajuste acumulado por órdenes de cambio. Se RECALCULA cada vez desde el
  // original: nunca se acumula sobre el valor ya ajustado.
  const oc  = ajusteRubrosOC(proyectoId);
  const cOC = getContratoOC(proyectoId);
  const A   = (rubro) => oc ? oc[rubro] : 0;

  const gastosTodos = (getCollection(KEYS.PROY_MOVIMIENTOS) ?? [])
    .filter(m => m.proyecto_id === proyectoId && m.tipo === 'gasto');
  const gastos = gastosTodos.filter(m => montoPagadoDe(m) > 0);

  // SIN IVA: el presupuesto de cada bolsita está sin IVA (ver montoSinIVA).
  const gastado = { costo_directo: 0, ind_oficina: 0, ind_campo: 0 };
  gastos.forEach(m => { gastado[_bolsaDeGasto(m)] += costoPagadoSinIVA(m); });
  // Comprometido = lo devengado que todavía no se paga. No entra al gastado
  // (la bolsita mide dinero ejercido) pero se pinta encima de la barra para
  // que un sobregiro que ya está firmado no aparezca hasta que se pague.
  const comprometido = { costo_directo: 0, ind_oficina: 0, ind_campo: 0 };
  gastosTodos.forEach(m => {
    const pend = saldoPendienteDe(m);
    if (pend > 0) comprometido[_bolsaDeGasto(m)] += montoSinIVA(m) * (pend / (Math.abs(Number(m.monto)) || 1));
  });

  const bolsas = [
    { key: 'costo_directo', label: 'Costo directo',      icon: '🧱', original: d.costoDirecto, ajuste: A('costoDirecto'), gastado: gastado.costo_directo, comprometido: comprometido.costo_directo },
    { key: 'ind_oficina',   label: 'Indirectos oficina', icon: '🏢', original: d.indOficina,   ajuste: A('indOficina'),   gastado: gastado.ind_oficina,   comprometido: comprometido.ind_oficina },
    { key: 'ind_campo',     label: 'Indirectos campo',   icon: '🚧', original: d.indCampo,     ajuste: A('indCampo'),     gastado: gastado.ind_campo,     comprometido: comprometido.ind_campo },
  ].map(b => {
    const budget    = b.original + b.ajuste;          // vigente = original + acumulado
    const overflow  = Math.max(0, b.gastado - budget);
    const restante  = budget - b.gastado;
    const pct       = budget > 0 ? (b.gastado / budget) * 100 : (b.gastado > 0 ? 100 : 0);
    // Con lo firmado y no pagado encima: adelanta el sobregiro que ya existe.
    const pctComp   = budget > 0 ? ((b.gastado + b.comprometido) / budget) * 100 : 0;
    const overflowComp = Math.max(0, b.gastado + b.comprometido - budget);
    return { ...b, budget, overflow, restante, pct, pctComp, overflowComp };
  });

  const overflowTotal      = bolsas.reduce((a, b) => a + b.overflow, 0);
  const utilidadPlaneada   = d.utilidad + A('utilidad');
  const utilidadDisponible = utilidadPlaneada - overflowTotal;

  return {
    bolsas,
    financiamiento:   d.financiamiento + A('financiamiento'),
    utilidadPlaneada,
    utilidadOriginal: d.utilidad,
    otros:            A('otros'),
    overflowTotal,
    utilidadDisponible,
    // Contrato vigente sin IVA. Se prefiere el que publica estimaciones; si no
    // hay nodo, el derivado de la cascada local.
    contrato:         Number(cOC?.contrato?.subtotal) || (d.contrato + A('venta')),
    contratoOriginal: d.contrato,
    ajusteContrato:   A('venta'),
    tieneOC:          !!oc && (Number(cOC?.ordenesCambio?.count) || 0) > 0,
    numOC:            Number(cOC?.ordenesCambio?.count) || 0,
    contratoVigenteCIVA:  Number(cOC?.contrato?.total) || null,
    contratoOriginalCIVA: Number(cOC?.contratoOriginalCIVA) || null,
    netoAcumCIVA:         Number(cOC?.ordenesCambio?.netoAcumCIVA) || 0,
    aditivasAcum:         Number(cOC?.ordenesCambio?.aditivasAcum) || 0,
    deductivasAcum:       Number(cOC?.ordenesCambio?.deductivasAcum) || 0,
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
