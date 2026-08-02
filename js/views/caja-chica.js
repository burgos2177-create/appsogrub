/* =====================================================
   SOGRUB Bitácora — Caja chica por proyecto

   Módulo correlacionado con app-materiales. Lee/escribe
   /shared/cajaChica/{obraId}/{meta,movimientos} (source of truth
   compartido). Resuelve obraId a partir de proyectoId vía
   /shared/obraLinks (búsqueda inversa).

   Acciones:
     - Depositar (transferencia o efectivo)  → desde aquí
     - Aprobar gasto reportado (de materiales) → genera contable + sincroniza
     - Rechazar / reabrir
   Reusa _aprobarGastoCajaChica, _aprobarDepositoCajaChica,
   _depositarCajaChicaDesdeBitacora del scope global de buzon.js.
   ===================================================== */
'use strict';

const _DEFAULT_UMBRAL_CC = 1000;

// Estado por proyecto: cache local de movimientos + meta + obraId resuelto.
const _ccState = {};

function renderCajaChicaProyecto(proyectoId) {
  const root = document.getElementById('caja-chica-tab-wrap');
  if (!root) return;

  const proyecto = getItem(KEYS.PROYECTOS, proyectoId);
  if (!proyecto) {
    root.innerHTML = '<p class="text-muted" style="padding:40px">Proyecto no encontrado.</p>';
    return;
  }

  // Cache UI inicial mientras carga
  root.innerHTML = '<div class="empty-state"><div class="empty-state-title">Cargando caja chica…</div></div>';

  _cargarCajaChica(proyectoId, proyecto).catch(err => {
    console.error('[CajaChica] cargar:', err);
    root.innerHTML = `<div class="empty-state"><div class="empty-state-title">Error al cargar</div><p class="empty-state-desc">${err.message}</p></div>`;
  });
}

async function _cargarCajaChica(proyectoId, proyecto) {
  // Resolver obraId vía búsqueda inversa en /shared/obraLinks
  const linksSnap = await _dbRef('/shared/obraLinks').get();
  const links = linksSnap.val() || {};
  const obraId = Object.entries(links).find(([, pid]) => String(pid) === String(proyectoId))?.[0] || null;

  if (!obraId) {
    _renderEmptyVinculo(proyectoId, proyecto);
    return;
  }

  // Suscribir a cambios — el almacenista puede reportar gastos en cualquier momento
  const ccPath = `/shared/cajaChica/${obraId}`;
  const ref = _dbRef(ccPath);
  // Detach previous listener if same proyecto re-rendered
  if (_ccState[proyectoId]?._unsub) _ccState[proyectoId]._unsub();
  const handler = ref.on('value', snap => {
    const val = snap.val() || {};
    _ccState[proyectoId] = {
      ..._ccState[proyectoId],
      obraId,
      meta: val.meta || null,
      movimientos: val.movimientos || {},
      _unsub: () => ref.off('value', handler)
    };
    if (_detalleState.activeTab === 'caja_chica' && _activeProyecto === proyectoId) {
      _renderCajaChicaContenido(proyectoId, proyecto);
    }
  }, err => {
    console.error('[CajaChica] listener:', err);
  });
}

function _renderEmptyVinculo(proyectoId, proyecto) {
  const root = document.getElementById('caja-chica-tab-wrap');
  if (!root) return;
  root.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'card';
  card.style.padding = '32px';
  card.innerHTML = `
    <h3 style="margin-top:0">⚠ Obra sin vincular</h3>
    <p class="text-muted" style="line-height:1.6">
      Este proyecto contable (<b>${proyecto.nombre}</b>) no tiene una obra de
      <code>app-materiales</code> vinculada. La caja chica vive en
      <code>/shared/cajaChica/{obraId}</code>, así que necesito el link en
      <code>/shared/obraLinks/{obraId} = ${proyectoId}</code> para mostrar el saldo.
    </p>
    <p class="text-sm text-muted">
      Crea el link desde <code>app-estimaciones</code> al definir la obra, o pídele
      al admin que lo agregue manualmente en Firebase RTDB.
    </p>
  `;
  root.appendChild(card);
}

// Fondo al que pertenece un movimiento de caja chica. Ausente = transferencia
// (todo lo histórico), 'efectivo' = fondo de efectivo por obra (2026-07).
function _fondoDeMovCC(m) {
  return m?.fondo === 'efectivo' ? 'efectivo' : 'transferencia';
}

function _renderCajaChicaContenido(proyectoId, proyecto) {
  const root = document.getElementById('caja-chica-tab-wrap');
  if (!root) return;
  const st = _ccState[proyectoId];
  if (!st) return;
  const { obraId, meta, movimientos } = st;
  const fondo = st.fondo || 'transferencia';
  const esEfectivo = fondo === 'efectivo';

  const sums = _computeSaldoCajaChica(movimientos, fondo);
  const sumsOtro = _computeSaldoCajaChica(movimientos, esEfectivo ? 'transferencia' : 'efectivo');
  const umbral = (meta?.umbralAlerta ?? _DEFAULT_UMBRAL_CC);
  const lowBalance = sums.saldo < umbral && sums.saldo > 0;
  const empty = sums.saldo <= 0 && sums.totalDepositado === 0;

  const saldoColor = sums.saldo <= 0 ? 'var(--danger)' : (lowBalance ? 'var(--warning)' : 'var(--success)');
  const saldoBadge = sums.saldo <= 0 && !empty
    ? `<span class="badge badge-danger" style="margin-top:8px">🔴 Saldo agotado · pedir depósito</span>`
    : lowBalance
      ? `<span class="badge badge-warning" style="margin-top:8px">⚠ Saldo bajo · umbral ${formatMXN(umbral)}</span>`
      : empty
        ? `<span class="text-muted" style="display:block;margin-top:8px;font-size:12px">Sin depósitos. Empieza depositando saldo inicial.</span>`
        : '';

  // ─── KPIs ───
  const kpis = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:14px;margin-top:20px">
      ${_kpiCajaChica(esEfectivo ? 'Depositado (efectivo)' : 'Depositado (transfer)', formatMXN(sums.totalDepositadoTransfer),
        esEfectivo ? `${sums.countDepositosTransfer} depósitos en efectivo` : `${sums.countDepositosTransfer} transferencias`)}
      ${!esEfectivo && sums.totalDepositadoEfectivo > 0
        ? _kpiCajaChica('Efectivo informativo', formatMXN(sums.totalDepositadoEfectivo),
            `${sums.countDepositosEfectivo} en efectivo · no afecta saldo`)
        : ''}
      ${_kpiCajaChica('Total gastado (aprobado)', formatMXN(sums.totalGastadoAprobado),
        `${sums.countAprobados} gastos aprobados`)}
      ${_kpiCajaChica('Reportado pendiente', formatMXN(sums.totalReportadoPendiente),
        `${sums.countReportados} esperan aprobación`,
        sums.totalReportadoPendiente > 0 ? 'var(--accent)' : null)}
      ${sums.totalDevuelto > 0
        ? _kpiCajaChica('Devuelto a SOGRUB', formatMXN(sums.totalDevuelto),
            `${sums.countDevoluciones} devoluciones · no es gasto`)
        : ''}
      ${sums.totalRechazado > 0
        ? _kpiCajaChica('Rechazado', formatMXN(sums.totalRechazado), `${sums.countRechazados} rechazados`)
        : ''}
    </div>
  `;

  // ─── Tarjeta saldo ───
  const saldoCard = `
    <div class="card" style="padding:24px;text-align:center">
      <div class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.4px">Saldo conciliado</div>
      <div style="font-size:36px;font-weight:700;margin-top:6px;color:${saldoColor}">
        ${formatMXN(sums.saldo)}
      </div>
      ${saldoBadge}
      ${kpis}
    </div>
  `;

  // ─── Tabla (solo movimientos del fondo activo) ───
  const ids = Object.keys(movimientos).filter(id => _fondoDeMovCC(movimientos[id]) === fondo);
  ids.sort((a, b) => (movimientos[b].fecha || movimientos[b].createdAt || 0) - (movimientos[a].fecha || movimientos[a].createdAt || 0));

  const tableHTML = ids.length === 0
    ? `<div class="empty-state" style="margin-top:16px">
         <div class="empty-state-icon">${esEfectivo ? '💵' : '💰'}</div>
         <div class="empty-state-title">Sin movimientos ${esEfectivo ? 'del fondo efectivo' : 'todavía'}</div>
         <p class="empty-state-desc">${esEfectivo
           ? 'Deposita efectivo para iniciar el fondo de esta obra. Sale de la caja física de SOGRUB (arqueo) y los gastos llegan reportados desde las apps de campo.'
           : 'Deposita para iniciar la caja chica de esta obra. Los gastos aprobados llegan reportados desde recepciones del almacenista.'}</p>
       </div>`
    : `<div class="table-wrapper" style="margin-top:14px">
         <table class="data-table" id="cc-tabla">
           <thead>
             <tr>
               <th>Fecha</th><th>Tipo</th><th>Estado</th><th>Monto</th><th>Comentario</th><th>Autor</th><th>Ref</th><th>Acciones</th>
             </tr>
           </thead>
           <tbody>
             ${ids.map(id => _filaMovimientoCC(obraId, id, movimientos[id])).join('')}
           </tbody>
         </table>
       </div>`;

  // Pill del otro fondo con su saldo, para ver ambos de un vistazo.
  const _pill = (f, activo, saldoStr) => `
    <button class="btn btn-sm ${activo ? 'btn-primary' : 'btn-secondary'}" data-cc-fondo="${f}"
      style="${activo ? '' : 'opacity:.75'}">
      ${f === 'efectivo' ? '💵 Fondo efectivo' : '🏦 Fondo transferencia'}${saldoStr ? ` · ${saldoStr}` : ''}
    </button>`;

  root.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <h3 style="margin:0">Caja chica · ${proyecto.nombre}</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="cc-btn-depositar">＋ Depositar${esEfectivo ? ' efectivo' : ''}</button>
        ${esEfectivo ? `<button class="btn btn-secondary" id="cc-btn-cambio" title="Recoger el efectivo del fondo y reponerlo con otros billetes">⇄ Cambio / devolución</button>` : ''}
        <button class="btn btn-secondary btn-sm" id="cc-btn-umbral">⚙ Umbral de alerta</button>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      ${_pill('transferencia', !esEfectivo, esEfectivo ? formatMXN(sumsOtro.saldo) : '')}
      ${_pill('efectivo', esEfectivo, esEfectivo ? '' : formatMXN(sumsOtro.saldo))}
    </div>
    <div class="text-muted" style="font-size:11px;margin-bottom:10px">
      Obra vinculada: <code>${obraId}</code> · Vista compartida con las apps de campo (los cambios aquí se reflejan allá).
      ${esEfectivo ? ' · Los depósitos de este fondo salen de la <b>caja física de SOGRUB</b> (arqueo), no de Mifel.' : ''}
    </div>
    ${saldoCard}
    <h4 style="margin:20px 0 4px">Movimientos</h4>
    ${tableHTML}
  `;

  root.querySelectorAll('[data-cc-fondo]').forEach(btn =>
    btn.addEventListener('click', () => {
      _ccState[proyectoId].fondo = btn.dataset.ccFondo;
      _renderCajaChicaContenido(proyectoId, proyecto);
    }));
  root.querySelector('#cc-btn-depositar').addEventListener('click', () => esEfectivo
    ? _abrirModalDepositarCCEfectivo(obraId, proyecto.nombre, proyectoId, proyecto)
    : _abrirModalDepositarCC(obraId, proyecto.nombre, proyectoId, proyecto));
  root.querySelector('#cc-btn-cambio')?.addEventListener('click', () =>
    _abrirModalCambioCCEfectivo(obraId, proyecto.nombre, sums.saldo));
  root.querySelector('#cc-btn-umbral').addEventListener('click', () =>
    _abrirModalUmbralCC(obraId, umbral, proyectoId, proyecto));

  // Wire row actions
  root.querySelectorAll('.cc-btn-aprobar').forEach(btn =>
    btn.addEventListener('click', () => _aprobarFilaCC(btn.dataset.movId, obraId)));
  root.querySelectorAll('.cc-btn-rechazar').forEach(btn =>
    btn.addEventListener('click', () => _rechazarFilaCC(btn.dataset.movId, obraId)));
  root.querySelectorAll('.cc-btn-reabrir').forEach(btn =>
    btn.addEventListener('click', () => _reabrirFilaCC(btn.dataset.movId, obraId)));
  root.querySelectorAll('.cc-btn-borrar').forEach(btn =>
    btn.addEventListener('click', () => _borrarFilaCC(btn.dataset.movId, obraId)));
  root.querySelectorAll('.cc-btn-ver-rec').forEach(btn =>
    btn.addEventListener('click', () => _verRecepcionFilaCC(btn.dataset.movId, obraId)));
}

async function _verRecepcionFilaCC(movCajaChicaId, obraId) {
  // Resolver el item del buzón (mismo lookup que aprobar/rechazar)
  const buzonItem = await _buscarBuzonItem(obraId, movCajaChicaId);
  if (!buzonItem) {
    showToast('No se encontró el item del buzón asociado.', 'warning');
    return;
  }
  await _modalVerRecepcion(buzonItem);
}

function _kpiCajaChica(label, value, sub, color) {
  return `
    <div>
      <div class="text-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.4px">${label}</div>
      <div style="font-size:18px;font-weight:600;margin-top:2px;color:${color || 'var(--text)'}">${value}</div>
      ${sub ? `<div class="text-muted" style="font-size:11px;margin-top:2px">${sub}</div>` : ''}
    </div>
  `;
}

function _filaMovimientoCC(obraId, movId, m) {
  const isDeposito = m.tipo === 'deposito';
  // Devolución de efectivo a SOGRUB: viaja como gasto aprobado (para que la
  // fórmula de saldo de las apps de campo la reste sin cambios), pero no es un
  // costo — es un traspaso, y se muestra como tal.
  const esDevolucion = !!m.esDevolucion;
  const isReportado = m.tipo === 'gasto' && m.estado === 'reportado' && !esDevolucion;
  const isAprobado = m.tipo === 'gasto' && m.estado === 'aprobado' && !esDevolucion;
  const isRechazado = m.tipo === 'gasto' && m.estado === 'rechazado' && !esDevolucion;

  const tipoCell = esDevolucion
    ? `<span class="badge badge-info">⇄ Devolución</span>`
    : isDeposito
    ? `<span class="badge badge-success">⬆ Depósito</span>`
    : `<span class="badge badge-danger">⬇ Gasto</span>`;

  const sufAsentado = m.asentadoAt ? ' · asentada' : (m.pendienteAsentar ? ' · pendiente asentar' : '');
  const estadoCell = esDevolucion
    ? `<span class="badge badge-info" title="El efectivo regresó a la caja física de SOGRUB y la caja del proyecto recuperó el monto">💵 → SOGRUB${sufAsentado}</span>`
    : isDeposito
    ? (_fondoDeMovCC(m) === 'efectivo'
        ? `<span class="badge badge-warning">💵 Fondo efectivo${sufAsentado}</span>`
        : m.metodoDeposito === 'efectivo'
        ? `<span class="badge badge-muted">💵 Efectivo (informativo)</span>`
        : `<span class="badge badge-info">🏦 Transfer${sufAsentado}</span>`)
    : isReportado ? `<span class="badge badge-warning">⏳ Reportado</span>`
    : isAprobado  ? `<span class="badge badge-success">✓ Aprobado</span>`
    : isRechazado ? `<span class="badge badge-danger">✕ Rechazado</span>`
    : `<span class="text-muted">${m.estado || '—'}</span>`;

  const montoColor = isDeposito ? 'amount-positive' : (isAprobado || esDevolucion ? 'amount-negative' : 'text-muted');
  const montoSign = isDeposito ? '+' : (isAprobado || esDevolucion ? '−' : '');
  const fecha = m.fecha ? new Date(m.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  // Comentario y ref a recepción (si aplica)
  const comentario = (m.comentario || '').slice(0, 80);
  const refCell = m.refRecepcionId
    ? `<code style="font-size:11px">${m.refRecepcionId.slice(-8)}</code>`
    : (m.folioBancario ? `<code style="font-size:11px">${m.folioBancario}</code>` : '<span class="text-muted">—</span>');

  // Acciones según estado
  let acciones = '';
  // "Ver recepción" disponible para gastos con refRecepcionId (cualquier estado),
  // así el contador puede revisar el ticket / factura antes y después de aprobar.
  if (m.tipo === 'gasto' && m.refRecepcionId) {
    acciones += `<button class="btn btn-sm btn-secondary cc-btn-ver-rec" data-mov-id="${movId}" title="Ver recepción + ticket + factura">👁</button>`;
  }
  if (isReportado) {
    acciones += `
      <button class="btn btn-sm btn-primary cc-btn-aprobar" data-mov-id="${movId}" title="Aprobar y asentar contable">✓</button>
      <button class="btn btn-sm btn-secondary cc-btn-rechazar" data-mov-id="${movId}" title="Rechazar">✕</button>`;
  } else if (isAprobado) {
    acciones += `<button class="btn btn-sm btn-ghost cc-btn-reabrir" data-mov-id="${movId}" title="Reabrir">↺</button>`;
  }
  acciones += `<button class="btn btn-sm btn-ghost cc-btn-borrar" data-mov-id="${movId}" title="Borrar movimiento">🗑</button>`;

  return `
    <tr>
      <td class="text-muted">${fecha}</td>
      <td>${tipoCell}</td>
      <td>${estadoCell}</td>
      <td class="${montoColor} font-mono">${montoSign}${formatMXN(m.monto)}</td>
      <td class="text-sm" title="${(m.comentario || '').replace(/"/g, '&quot;')}">${comentario || '—'}</td>
      <td class="text-muted text-sm">${m.autor?.email || m.autor?.displayName || '—'}</td>
      <td>${refCell}</td>
      <td><div class="td-actions">${acciones}</div></td>
    </tr>
  `;
}

// Réplica idéntica de computeSaldoCajaChica del lado materiales
// (D:\apps-sogrub\app-materiales\js\services\db.js), generalizada a fondos.
// Cada movimiento pertenece a un fondo: 'transferencia' (default, ausente)
// o 'efectivo' (campo m.fondo). Cada fondo lleva su propio saldo conciliado.
// Reglas por fondo:
//   - transferencia: depósitos transferencia SUMAN; depósitos efectivo NO
//     afectan (informativos, legacy).
//   - efectivo: TODO depósito suma (siempre es billete físico).
//   - Depósitos cuentan solo con estado='aprobado' (sin estado = aprobado,
//     legacy). Los 'solicitado' van a pendiente; 'rechazado' a rechazado.
//     Igual que computeSaldoCajaChica del lado materiales.
//   - Gastos aprobados restan (del fondo al que pertenecen).
//     Reportados y rechazados no afectan.
function _computeSaldoCajaChica(movimientos, fondo = 'transferencia') {
  let saldo = 0, totalDepositadoTransfer = 0, totalDepositadoEfectivo = 0;
  let totalGastadoAprobado = 0, totalReportadoPendiente = 0, totalRechazado = 0;
  let totalDevuelto = 0, countDevoluciones = 0;
  let countDepositosTransfer = 0, countDepositosEfectivo = 0;
  let countAprobados = 0, countReportados = 0, countRechazados = 0;
  for (const m of Object.values(movimientos || {})) {
    if (_fondoDeMovCC(m) !== fondo) continue;
    const monto = Number(m.monto) || 0;
    if (m.tipo === 'deposito') {
      const metodo = m.metodoDeposito || 'transferencia';
      const estadoDep = m.estado || 'aprobado';   // legacy default
      // En el fondo efectivo todo depósito cuenta; el "efectivo informativo"
      // solo existe en el fondo transferencia.
      if (fondo === 'transferencia' && metodo === 'efectivo') {
        totalDepositadoEfectivo += monto; countDepositosEfectivo++;
      } else if (estadoDep === 'aprobado') {
        saldo += monto; totalDepositadoTransfer += monto; countDepositosTransfer++;
      } else if (estadoDep === 'rechazado') {
        totalRechazado += monto; countRechazados++;
      } else {   // solicitado — esperando aprobación del contador
        totalReportadoPendiente += monto; countReportados++;
      }
    } else if (m.tipo === 'gasto') {
      if (m.estado === 'aprobado') {
        saldo -= monto;
        // Las devoluciones de efectivo a SOGRUB viajan como gasto aprobado
        // (así restan del saldo en las 4 apps sin cambiar su fórmula), pero
        // no son un costo: se contabilizan aparte para no inflar "gastado".
        if (m.esDevolucion) { totalDevuelto += monto; countDevoluciones++; }
        else { totalGastadoAprobado += monto; countAprobados++; }
      }
      else if (m.estado === 'reportado') { totalReportadoPendiente += monto; countReportados++; }
      else if (m.estado === 'rechazado') { totalRechazado += monto; countRechazados++; }
    }
  }
  return {
    saldo,
    totalDepositadoTransfer, totalDepositadoEfectivo,
    totalDepositado: totalDepositadoTransfer + totalDepositadoEfectivo,
    totalGastadoAprobado, totalReportadoPendiente, totalRechazado,
    totalDevuelto, countDevoluciones,
    countDepositosTransfer, countDepositosEfectivo,
    countDepositos: countDepositosTransfer + countDepositosEfectivo,
    countAprobados, countReportados, countRechazados
  };
}

// =====================================================
// MODALES — Depositar / Umbral
// =====================================================

function _abrirModalDepositarCC(obraId, obraNombre, proyectoId, proyecto) {
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="cc-dep-monto">Monto ($)</label>
        <input type="number" id="cc-dep-monto" class="form-input" placeholder="0.00" min="0.01" step="0.01" autofocus>
      </div>
      <div class="form-group">
        <label class="form-label" for="cc-dep-fecha">Fecha</label>
        <input type="date" id="cc-dep-fecha" class="form-input" value="${todayISO()}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Método</label>
      <div class="toggle-group">
        <input type="radio" name="cc-dep-metodo" id="cc-dep-transfer" value="transferencia" class="toggle-option" checked>
        <label for="cc-dep-transfer" class="toggle-label">🏦 Transferencia</label>
        <input type="radio" name="cc-dep-metodo" id="cc-dep-efectivo" value="efectivo" class="toggle-option">
        <label for="cc-dep-efectivo" class="toggle-label">💵 Efectivo</label>
      </div>
      <div class="text-sm text-muted" style="margin-top:6px;line-height:1.4" id="cc-dep-explicacion">
        🏦 Transferencia: afecta saldo conciliado y se asienta egreso en Mifel (folio CC).
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="cc-dep-comentario">Comentario <span class="text-dim">(opcional)</span></label>
      <input type="text" id="cc-dep-comentario" class="form-input" placeholder="p.ej. fondo inicial, reposición mensual…">
    </div>
  `;

  setTimeout(() => {
    const explicacion = body.querySelector('#cc-dep-explicacion');
    const update = () => {
      const metodo = body.querySelector('input[name="cc-dep-metodo"]:checked').value;
      explicacion.textContent = metodo === 'efectivo'
        ? '💵 Efectivo: solo registro histórico. NO afecta saldo (el efectivo ya se retiró del banco antes y eso ya está contabilizado).'
        : '🏦 Transferencia: afecta saldo conciliado y se asienta egreso en Mifel (folio CC).';
    };
    body.querySelectorAll('input[name="cc-dep-metodo"]').forEach(r =>
      r.addEventListener('change', update));
  }, 0);

  openModal({
    title: `Depositar en caja chica · ${obraNombre}`,
    body,
    confirmText: 'Depositar',
    onConfirm: async () => {
      const valid = validateFields([
        { el: body.querySelector('#cc-dep-monto'), msg: 'Ingresa un monto válido' },
        { el: body.querySelector('#cc-dep-fecha'), msg: 'Selecciona una fecha' },
      ]);
      if (!valid) return;

      const monto = parseFloat(body.querySelector('#cc-dep-monto').value);
      const fecha = body.querySelector('#cc-dep-fecha').value;
      const comentario = body.querySelector('#cc-dep-comentario').value.trim();
      const metodo = body.querySelector('input[name="cc-dep-metodo"]:checked').value;

      try {
        const res = await _depositarCajaChicaDesdeBitacora({
          obraId, obraNombre, monto, fecha, comentario, metodoDeposito: metodo
        });
        closeModal();
        const msg = metodo === 'transferencia'
          ? `Depositado ${formatMXN(monto)} · ${res.folio}`
          : `Depositado ${formatMXN(monto)} (efectivo, no afecta saldo)`;
        showToast(msg, 'success');
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    }
  });
}

// Depósito al FONDO EFECTIVO: siempre billete físico. Sale de la caja física
// de SOGRUB (arqueo) → egreso en sogrub_efectivo_movimientos + egreso espejo
// del proyecto. Folio CC, igual que el fondo transferencia.
function _abrirModalDepositarCCEfectivo(obraId, obraNombre, proyectoId, proyecto) {
  const saldoCajaFisica = (typeof calcSaldoEfectivo === 'function') ? calcSaldoEfectivo() : null;
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="cce-dep-monto">Monto ($)</label>
        <input type="number" id="cce-dep-monto" class="form-input" placeholder="0.00" min="0.01" step="0.01" autofocus>
      </div>
      <div class="form-group">
        <label class="form-label" for="cce-dep-fecha">Fecha</label>
        <input type="date" id="cce-dep-fecha" class="form-input" value="${todayISO()}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="cce-dep-comentario">Comentario <span class="text-dim">(opcional)</span></label>
      <input type="text" id="cce-dep-comentario" class="form-input" placeholder="p.ej. fondo inicial en efectivo, reposición…">
    </div>
    <p class="text-muted text-sm" style="line-height:1.5;margin:0">
      💵 El billete sale de la <b>caja física de SOGRUB</b>${saldoCajaFisica != null ? ` (saldo actual: <b>${formatMXN(saldoCajaFisica)}</b>)` : ''}
      y baja también la caja del proyecto. Mifel no se toca — si el efectivo aún está en el banco,
      primero haz el <b>retiro de Mifel</b> en la pestaña Efectivo.
    </p>
  `;

  openModal({
    title: `💵 Depositar efectivo en caja chica · ${obraNombre}`,
    body,
    confirmText: 'Depositar',
    onConfirm: async () => {
      const valid = validateFields([
        { el: body.querySelector('#cce-dep-monto'), msg: 'Ingresa un monto válido' },
        { el: body.querySelector('#cce-dep-fecha'), msg: 'Selecciona una fecha' },
      ]);
      if (!valid) return;

      const monto = parseFloat(body.querySelector('#cce-dep-monto').value);
      const fecha = body.querySelector('#cce-dep-fecha').value;
      const comentario = body.querySelector('#cce-dep-comentario').value.trim();

      try {
        const res = await _depositarCajaChicaDesdeBitacora({
          obraId, obraNombre, monto, fecha, comentario, fondo: 'efectivo'
        });
        closeModal();
        showToast(`Depositado ${formatMXN(monto)} al fondo efectivo · ${res.folio}`, 'success');
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    }
  });
}

// Cambio de billetes / devolución del FONDO EFECTIVO.
// El almacenista entrega el efectivo que trae (típicamente monedas y cambio
// acumulado) y se le repone con billetes nuevos. Son dos operaciones inversas
// que se pueden usar juntas o por separado:
//   Entrego → devolución: caja física SOGRUB ↑, caja proyecto ↑, fondo ↓
//   Recibo  → depósito:   caja física SOGRUB ↓, caja proyecto ↓, fondo ↑
// A la par (mismo monto) el neto es cero en todas las cajas: solo cambian los
// billetes físicos, y tanto el arqueo de SOGRUB como el del fondo cuadran.
function _abrirModalCambioCCEfectivo(obraId, obraNombre, saldoActual) {
  const saldoCajaFisica = (typeof calcSaldoEfectivo === 'function') ? calcSaldoEfectivo() : null;
  const saldoDefault = saldoActual > 0 ? saldoActual.toFixed(2) : '';

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <p class="text-muted text-sm" style="margin:0;line-height:1.5">
      Saldo actual del fondo: <b style="color:var(--text)">${formatMXN(saldoActual)}</b>.
      Deja un campo en blanco si solo quieres hacer una de las dos operaciones.
    </p>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="cce-cambio-entrego">⬅ Entrego a SOGRUB ($)</label>
        <input type="number" id="cce-cambio-entrego" class="form-input" placeholder="0.00" min="0" step="0.01"
          value="${saldoDefault}" autofocus>
        <span class="text-dim" style="font-size:11px">Efectivo que devuelve la obra (regresa al arqueo de SOGRUB).</span>
      </div>
      <div class="form-group">
        <label class="form-label" for="cce-cambio-recibo">➡ Recibo de SOGRUB ($)</label>
        <input type="number" id="cce-cambio-recibo" class="form-input" placeholder="0.00" min="0" step="0.01"
          value="${saldoDefault}">
        <span class="text-dim" style="font-size:11px">Billetes nuevos que se entregan al fondo.</span>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" for="cce-cambio-fecha">Fecha</label>
        <input type="date" id="cce-cambio-fecha" class="form-input" value="${todayISO()}">
      </div>
      <div class="form-group">
        <label class="form-label" for="cce-cambio-comentario">Comentario <span class="text-dim">(opcional)</span></label>
        <input type="text" id="cce-cambio-comentario" class="form-input" placeholder="p.ej. cambio de monedas por billetes">
      </div>
    </div>
    <div id="cce-cambio-preview" style="padding:12px 14px;background:var(--surface2);border-radius:var(--radius);font-size:13px;line-height:1.7"></div>
  `;

  const _num = (sel) => {
    const v = parseFloat(body.querySelector(sel)?.value);
    return isNaN(v) || v < 0 ? 0 : v;
  };

  const _refrescarPreview = () => {
    const entrego = _num('#cce-cambio-entrego');
    const recibo  = _num('#cce-cambio-recibo');
    const prev    = body.querySelector('#cce-cambio-preview');
    if (!prev) return;

    if (entrego === 0 && recibo === 0) {
      prev.innerHTML = '<span class="text-muted">Captura al menos un monto.</span>';
      return;
    }

    const saldoFinal = saldoActual - entrego + recibo;
    const netoSogrub = entrego - recibo;   // + entra a la caja física, − sale
    const fila = (etiqueta, valor, color) => `
      <div style="display:flex;justify-content:space-between;gap:16px">
        <span class="text-muted">${etiqueta}</span>
        <strong style="font-variant-numeric:tabular-nums${color ? `;color:${color}` : ''}">${valor}</strong>
      </div>`;

    const alerta = entrego > saldoActual + 0.001
      ? `<div style="margin-top:8px;color:var(--warning)">⚠ Estás devolviendo más de lo que registra el fondo (${formatMXN(saldoActual)}). El saldo quedará negativo — revisa si faltan gastos por reportar.</div>`
      : '';

    prev.innerHTML = `
      ${fila('Saldo del fondo después', formatMXN(saldoFinal), saldoFinal < 0 ? 'var(--danger)' : null)}
      ${fila('Efecto en la caja física de SOGRUB',
             `${netoSogrub >= 0 ? '+' : '−'}${formatMXN(Math.abs(netoSogrub))}`,
             netoSogrub === 0 ? 'var(--text-muted)' : (netoSogrub > 0 ? 'var(--success)' : 'var(--danger)'))}
      ${saldoCajaFisica != null ? fila('Caja física de SOGRUB después', formatMXN(saldoCajaFisica + netoSogrub)) : ''}
      ${netoSogrub === 0 && entrego > 0
        ? '<div style="margin-top:8px;color:var(--success)">✔ Cambio a la par: ningún saldo se mueve, solo cambian los billetes. El arqueo sigue cuadrando.</div>'
        : ''}
      ${alerta}
    `;
  };

  setTimeout(() => {
    ['#cce-cambio-entrego', '#cce-cambio-recibo'].forEach(sel =>
      body.querySelector(sel)?.addEventListener('input', _refrescarPreview));
    _refrescarPreview();
  }, 0);

  openModal({
    title: `⇄ Cambio / devolución de efectivo · ${obraNombre}`,
    body,
    confirmText: 'Registrar',
    onConfirm: async () => {
      const entrego = _num('#cce-cambio-entrego');
      const recibo  = _num('#cce-cambio-recibo');
      const fecha   = body.querySelector('#cce-cambio-fecha').value;
      const comentario = body.querySelector('#cce-cambio-comentario').value.trim();

      if (entrego === 0 && recibo === 0) {
        showToast('Captura cuánto entrega la obra o cuánto recibe.', 'warning');
        return;
      }
      if (!fecha) { showToast('Selecciona una fecha', 'warning'); return; }

      const notas = [];
      try {
        // Primero la devolución: el billete entra a la caja de SOGRUB antes de
        // volver a salir, para que el arqueo nunca quede momentáneamente corto.
        if (entrego > 0) {
          const res = await _devolverCajaChicaEfectivoDesdeBitacora({
            obraId, obraNombre, monto: entrego, fecha,
            comentario: comentario || (recibo > 0 ? 'Cambio de efectivo · entrega del fondo' : 'Devolución de efectivo a SOGRUB')
          });
          notas.push(`devuelto ${formatMXN(entrego)} · ${res.folio}`);
        }
        if (recibo > 0) {
          const res = await _depositarCajaChicaDesdeBitacora({
            obraId, obraNombre, monto: recibo, fecha, fondo: 'efectivo',
            comentario: comentario || (entrego > 0 ? 'Cambio de efectivo · reposición del fondo' : 'Depósito al fondo efectivo')
          });
          notas.push(`repuesto ${formatMXN(recibo)} · ${res.folio}`);
        }
        closeModal();
        showToast(notas.join(' · '), 'success');
      } catch (err) {
        console.error('[CajaChica cambio]', err);
        showToast('Error: ' + err.message, 'error');
      }
    }
  });
}

function _abrirModalUmbralCC(obraId, umbralActual, proyectoId, proyecto) {
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:14px';
  body.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="cc-umb-monto">Umbral de alerta de saldo bajo (MXN)</label>
      <input type="number" id="cc-umb-monto" class="form-input" min="0" step="0.01" value="${umbralActual}">
    </div>
    <p class="text-muted text-sm">
      Cuando el saldo conciliado quede por debajo de este monto aparecerá una alerta visual aquí y en app-materiales.
    </p>
  `;
  openModal({
    title: 'Umbral de alerta',
    body,
    confirmText: 'Guardar',
    onConfirm: async () => {
      const v = parseFloat(body.querySelector('#cc-umb-monto').value);
      if (isNaN(v) || v < 0) { showToast('Valor inválido', 'warning'); return; }
      try {
        await _dbRef(`/shared/cajaChica/${obraId}/meta`).update({
          umbralAlerta: v,
          updatedAt: Date.now()
        });
        closeModal();
        showToast('Umbral actualizado', 'success');
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    }
  });
}

// =====================================================
// ACCIONES DE FILA
// =====================================================

// Encuentra el item del buzón asociado a un movimiento de caja chica.
// Ambos lados se referencian: el cajaChica.movimiento tiene `buzonItemId`,
// y el buzón.item tiene `movimientoId` + `obraId`.
async function _buscarBuzonItem(obraId, movCajaChicaId) {
  // 1) Lookup directo si conocemos buzonItemId
  const movSnap = await _dbRef(`/shared/cajaChica/${obraId}/movimientos/${movCajaChicaId}`).get();
  const mov = movSnap.val();
  if (mov?.buzonItemId) {
    const itemSnap = await _dbRef(`/shared/buzon/${mov.buzonItemId}`).get();
    if (itemSnap.exists()) {
      return { id: mov.buzonItemId, ...itemSnap.val() };
    }
  }
  // 2) Fallback: scan del buzón (rara vez necesario)
  const buzSnap = await _dbRef('/shared/buzon').get();
  const all = buzSnap.val() || {};
  for (const [id, item] of Object.entries(all)) {
    if (item?.obraId === obraId && item?.movimientoId === movCajaChicaId) {
      return { id, ...item };
    }
  }
  return null;
}

async function _aprobarFilaCC(movCajaChicaId, obraId) {
  try {
    const buzonItem = await _buscarBuzonItem(obraId, movCajaChicaId);
    if (!buzonItem) {
      showToast('No se encontró el item del buzón asociado. ¿Es un movimiento sin enviar a bitácora?', 'warning');
      return;
    }
    if (buzonItem.tipo === 'gasto_caja_chica') {
      await _aprobarGastoCajaChica(buzonItem);
    } else if (buzonItem.tipo === 'deposito_caja_chica') {
      await _aprobarDepositoCajaChica(buzonItem);
    } else {
      showToast('Tipo de buzón no soportado: ' + buzonItem.tipo, 'error');
    }
  } catch (err) {
    console.error('[CajaChica aprobar]', err);
    showToast('Error: ' + err.message, 'error');
  }
}

async function _rechazarFilaCC(movCajaChicaId, obraId) {
  const buzonItem = await _buscarBuzonItem(obraId, movCajaChicaId);
  if (!buzonItem) { showToast('No se encontró el item del buzón.', 'warning'); return; }
  await _rechazarItem(buzonItem);
}

async function _reabrirFilaCC(movCajaChicaId, obraId) {
  const buzonItem = await _buscarBuzonItem(obraId, movCajaChicaId);
  if (!buzonItem) {
    // Sin item de buzón (depósito hecho desde bitácora) — reabrir directo
    if (!confirm('Reabrir este movimiento de caja chica? Si el depósito ya tenía egreso bancario asentado, se borrará.')) return;
    try {
      const movSnap = await _dbRef(`/shared/cajaChica/${obraId}/movimientos/${movCajaChicaId}`).get();
      const mov = movSnap.val();
      if (mov?.asentadoBancarioId) {
        // Fondo efectivo → el egreso vive en la caja física, no en Mifel.
        deleteItem(_fondoDeMovCC(mov) === 'efectivo' ? KEYS.EFECTIVO_MOV : 'sogrub_movimientos', mov.asentadoBancarioId);
      }
      if (mov?.asentadoProyectoMovId) {
        deleteItem('sogrub_proy_movimientos', mov.asentadoProyectoMovId);
      }
      await _dbRef(`/shared/cajaChica/${obraId}/movimientos/${movCajaChicaId}`).update({
        estado: 'solicitado',
        asentadoAt: null,
        asentadoBancarioId: null,
        asentadoProyectoMovId: null,
        folioBancario: null,
        pendienteAsentar: true,
        actualizadoAt: Date.now()
      });
      showToast('Movimiento reabierto', 'success');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
    return;
  }
  await _reabrirItem(buzonItem);
}

async function _borrarFilaCC(movCajaChicaId, obraId) {
  if (!confirm('¿Borrar este movimiento de caja chica? Esta acción no se puede deshacer.')) return;
  try {
    const movSnap = await _dbRef(`/shared/cajaChica/${obraId}/movimientos/${movCajaChicaId}`).get();
    const mov = movSnap.val();
    // Si tiene asentamientos contables, borrarlos también
    if (mov?.asentadoBancarioId) {
      // Fondo efectivo → el egreso vive en la caja física, no en Mifel.
      deleteItem(_fondoDeMovCC(mov) === 'efectivo' ? KEYS.EFECTIVO_MOV : 'sogrub_movimientos', mov.asentadoBancarioId);
    }
    if (mov?.asentadoProyectoMovId) {
      deleteItem('sogrub_proy_movimientos', mov.asentadoProyectoMovId);
    }
    if (mov?.buzonItemId) {
      const buzonItem = (await _dbRef(`/shared/buzon/${mov.buzonItemId}`).get()).val();
      if (buzonItem?.movId) {
        deleteItem('sogrub_proy_movimientos', buzonItem.movId);
      }
      await _dbRef(`/shared/buzon/${mov.buzonItemId}`).remove();
    }
    await _dbRef(`/shared/cajaChica/${obraId}/movimientos/${movCajaChicaId}`).remove();
    showToast('Movimiento borrado', 'success');
  } catch (err) {
    console.error('[CajaChica borrar]', err);
    showToast('Error: ' + err.message, 'error');
  }
}

// Cleanup cuando se navega fuera del proyecto/tab
function _detenerCajaChica(proyectoId) {
  const st = _ccState[proyectoId];
  if (st?._unsub) {
    try { st._unsub(); } catch (e) {}
    st._unsub = null;
  }
}
