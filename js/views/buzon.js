/* =====================================================
   Buzón cross-app — items pendientes que vienen de otras apps
   (estimaciones, en el futuro: compras, materiales, etc.)
   esperando aprobación del contador para afectar saldos.

   Datos en /shared/buzon/{itemId}.
   Path absoluto (con "/" inicial) para que _dbRef no le agregue prefijo.
   ===================================================== */
'use strict';

const _buzon = {
  items: {},      // itemId → item
  filtro: 'pendiente',  // 'pendiente' | 'aprobado' | 'rechazado' | 'huerfano' | 'todos'
  subscribed: false
};

function _suscribirBuzon() {
  if (_buzon.subscribed) return;
  _buzon.subscribed = true;
  _dbRef('/shared/buzon').on('value', snap => {
    _buzon.items = snap.val() || {};
    // Reconciliar: detecta aprobados cuyo movimiento ya no existe (fueron
    // borrados antes de que el hook automático estuviera, o desde otro lado).
    _reconciliarBuzon().catch(e => console.warn('[Buzón reconcile]', e));
    _actualizarBadgeBuzon();
    if (typeof _activeView !== 'undefined' && _activeView === 'buzon') {
      renderBuzon();
    }
  }, err => console.error('[Buzón] listener:', err));
}

// Recorre items APROBADOS y verifica si su movimiento contable sigue vivo.
// Si no existe, marca el item como huérfano. Se invoca:
//   · cada vez que /shared/buzon cambia
//   · cada vez que sogrub_proy_movimientos cambia (vía _onRemoteChange en firebase.js)
async function _reconciliarBuzon() {
  // No corras hasta que el cache de movimientos haya terminado la carga inicial,
  // porque si no, marcaríamos todo como huérfano por falsos negativos.
  if (!_fbReady) return;
  const movs = getCollection('sogrub_proy_movimientos');
  if (!Array.isArray(movs)) return;
  const movIds = new Set(movs.map(m => m?.id).filter(Boolean));

  const updates = {};
  for (const [itemId, item] of Object.entries(_buzon.items)) {
    if (item?.estado !== 'aprobado') continue;
    if (!item.movId) continue;
    if (movIds.has(item.movId)) continue;
    // Aprobado pero el movimiento ya no existe → huérfano
    updates[`${itemId}/estado`] = 'huerfano';
    updates[`${itemId}/huerfanoAt`] = Date.now();
    updates[`${itemId}/huerfanoPor`] = 'auto-reconcile';
    updates[`${itemId}/descripcionHuerfano`] = 'El movimiento contable ya no existe. Pudo haber sido borrado antes de que el sistema sincronizara automáticamente.';
    updates[`${itemId}/movId`] = null;
  }
  if (Object.keys(updates).length > 0) {
    console.log(`[Buzón] Reconciliados ${Object.keys(updates).length / 5} items aprobados → huérfanos.`);
    await _dbRef('/shared/buzon').update(updates);
  }
}

function _actualizarBadgeBuzon() {
  const badge = document.getElementById('buzon-badge');
  if (!badge) return;
  // Cuenta items que requieren acción del contador: pendientes + huérfanos.
  const accionables = Object.values(_buzon.items).filter(i => i?.estado === 'pendiente' || i?.estado === 'huerfano').length;
  if (accionables > 0) {
    badge.style.display = '';
    badge.textContent = accionables;
  } else {
    badge.style.display = 'none';
  }
}

function renderBuzon() {
  _suscribirBuzon();
  const root = document.getElementById('buzon-root');
  if (!root) return;

  const all = Object.entries(_buzon.items)
    .map(([id, it]) => ({ id, ...it }))
    .sort((a, b) => (b.creadoAt || 0) - (a.creadoAt || 0));

  const counts = {
    pendiente: all.filter(i => i.estado === 'pendiente').length,
    aprobado: all.filter(i => i.estado === 'aprobado').length,
    rechazado: all.filter(i => i.estado === 'rechazado').length,
    huerfano: all.filter(i => i.estado === 'huerfano').length
  };
  const filtered = _buzon.filtro === 'todos' ? all : all.filter(i => i.estado === _buzon.filtro);

  root.innerHTML = '';

  // Header con tabs de filtro
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap';
  header.innerHTML = `
    <h2 style="margin:0">Buzón de aprobaciones</h2>
    <div style="display:flex;gap:6px">
      ${['pendiente', 'aprobado', 'huerfano', 'rechazado', 'todos'].map(f => `
        <button class="filter-tab" data-filtro="${f}" style="padding:6px 12px;border:1px solid var(--border);background:${_buzon.filtro === f ? 'var(--accent)' : 'transparent'};color:${_buzon.filtro === f ? '#08121a' : 'var(--text)'};border-radius:6px;cursor:pointer;font-size:13px;${_buzon.filtro === f ? 'font-weight:600' : ''}">
          ${f.charAt(0).toUpperCase() + f.slice(1)}${f !== 'todos' ? ` <span style="opacity:0.7">(${counts[f]})</span>` : ''}
        </button>
      `).join('')}
    </div>
    <div style="flex:1"></div>
    <div style="font-size:12px;color:var(--text-muted)">
      Total: ${all.length} · Pendientes: <b>${counts.pendiente}</b>
    </div>
  `;
  root.appendChild(header);
  header.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      _buzon.filtro = btn.dataset.filtro;
      renderBuzon();
    });
  });

  // Empty state
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;padding:60px 20px;color:var(--text-muted);border:1px dashed var(--border);border-radius:8px';
    empty.innerHTML = `
      <div style="font-size:32px;opacity:0.5;margin-bottom:8px">📥</div>
      <div>${_buzon.filtro === 'pendiente'
        ? 'No hay solicitudes pendientes. Las apps de estimaciones, compras, etc. enviarán items aquí cuando necesiten tu aprobación.'
        : `No hay items en estado "${_buzon.filtro}".`}</div>
    `;
    root.appendChild(empty);
    return;
  }

  // Lista de cards
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:10px';
  for (const item of filtered) list.appendChild(_buzonCard(item));
  root.appendChild(list);
}

function _buzonCard(item) {
  const card = document.createElement('div');
  const colors = {
    pendiente: { border: '#e0a04c', bg: 'rgba(224,160,76,0.04)', tag: '#e0a04c' },
    aprobado:  { border: '#5dd39e', bg: 'rgba(93,211,158,0.04)', tag: '#5dd39e' },
    rechazado: { border: '#e15555', bg: 'rgba(225,85,85,0.04)', tag: '#e15555' },
    huerfano:  { border: '#a06bd9', bg: 'rgba(160,107,217,0.05)', tag: '#a06bd9' }
  };
  const c = colors[item.estado] || colors.pendiente;
  card.style.cssText = `border:1px solid var(--border);border-left:4px solid ${c.border};background:${c.bg};border-radius:8px;padding:14px 16px`;

  const monto = item?.monto?.importe || 0;
  const fechaPago = item.fecha ? new Date(item.fecha).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fechaCreado = item.creadoAt ? new Date(item.creadoAt).toLocaleString('es-MX') : '';
  const tipoLabel = ({
    pago_cliente: '💰 Pago de cliente',
    estimacion_subcontratista: '🔧 Estimación a subcontratista'
  })[item.tipo] || item.tipo;

  // Renderizar metadatos según tipo
  const esSub = item.tipo === 'estimacion_subcontratista';
  const linea2 = esSub
    ? `Subcontrato: <b style="color:var(--text)">${item.subcontratoNombre || '—'}</b> · Estim. del sub: <b>#${item.subEstimacionNumero ?? '—'}</b>`
    : `Estimación: <b>#${item.estimNumero ?? '—'}</b>`;
  const linea2b = esSub
    ? `Pagado a: <b style="color:var(--text)">${item.proveedorNombre || '—'}</b> · Fecha: <b>${fechaPago}</b>`
    : `Fecha del pago: <b>${fechaPago}</b>`;

  card.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="background:${c.tag};color:white;padding:2px 8px;border-radius:10px;font-size:10px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600">${item.estado}</span>
          <span style="font-size:13px;color:var(--text-muted)">${tipoLabel}</span>
        </div>
        <div style="font-size:16px;font-weight:600;margin-bottom:4px">${item.descripcion || '—'}</div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.6">
          Obra: <b style="color:var(--text)">${item.obraNombre || item.obraId || '—'}</b><br>
          ${linea2}<br>
          ${linea2b}<br>
          ${item.proyectoId
            ? `Proyecto contable: <b style="color:#5dd39e">${_obtenerNombreProyecto(item.proyectoId)}</b>`
            : `<span style="color:#e15555">⚠ Obra sin vincular a proyecto contable</span>`}
          ${fechaCreado ? `<br>Recibido: ${fechaCreado}` : ''}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:var(--text-muted)">${esSub ? 'Saldrá de caja' : 'Entrará a caja'}</div>
        <div style="font-family:ui-monospace,monospace;font-size:22px;font-weight:700;color:${esSub ? '#e15555' : 'var(--accent)'}">
          ${esSub ? '−' : ''}$${monto.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div style="font-size:10px;color:var(--text-muted)">
          ${item?.monto?.conIva === false
            ? '<b style="color:#e0a04c">Sin IVA</b> — importe = subtotal'
            : `Subtotal $${(item?.monto?.subtotal || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} · IVA $${(item?.monto?.iva || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`
          }
        </div>
      </div>
    </div>
    ${esSub && Array.isArray(item.desglose) && item.desglose.length > 0 ? `
      <details style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px">
        <summary style="cursor:pointer;color:var(--text-muted)">
          📋 Desglose por concepto OPUS (${item.desglose.length} línea${item.desglose.length === 1 ? '' : 's'} · $${item.desglose.reduce((s,d)=>s+(Number(d.importe)||0),0).toLocaleString('es-MX', { minimumFractionDigits: 2 })})
        </summary>
        <table style="width:100%;margin-top:6px;border-collapse:collapse;font-size:11px">
          <thead style="color:var(--text-muted)">
            <tr><th style="text-align:left;padding:3px 6px">Clave</th><th style="text-align:left;padding:3px 6px">Descripción</th><th style="text-align:right;padding:3px 6px">Cant.</th><th style="text-align:right;padding:3px 6px">P.U.</th><th style="text-align:right;padding:3px 6px">Importe</th></tr>
          </thead>
          <tbody>
            ${item.desglose.map(d => `
              <tr>
                <td style="padding:3px 6px;font-family:monospace">${d.clave || '—'}</td>
                <td style="padding:3px 6px">${(d.descripcion || '').slice(0, 60)}</td>
                <td style="padding:3px 6px;text-align:right">${(Number(d.cantidad) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                <td style="padding:3px 6px;text-align:right">$${(Number(d.precioUnitario) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                <td style="padding:3px 6px;text-align:right;font-weight:600">$${(Number(d.importe) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="margin-top:4px;color:var(--text-muted);font-size:10px">Al aprobar, este desglose se trasladará automáticamente al campo "Distribuir a concepto OPUS" del gasto si bitácora tiene el presupuesto importado en este proyecto.</div>
      </details>
    ` : ''}
    ${item.estado === 'pendiente' ? `
      <div style="display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <button class="btn-aprobar" style="background:#5dd39e;color:#0e3a25;border:none;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer">✓ Aprobar y crear movimiento</button>
        <button class="btn-rechazar" style="background:transparent;color:#e15555;border:1px solid #e15555;border-radius:6px;padding:8px 14px;cursor:pointer">✕ Rechazar</button>
        ${!item.proyectoId ? '<span style="font-size:11px;color:#e15555;align-self:center">Vincula la obra primero</span>' : ''}
      </div>
    ` : item.estado === 'huerfano' ? `
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:12px;color:#a06bd9;line-height:1.5">
        ⚠ El movimiento contable que se había creado fue eliminado.<br>
        ${item.descripcionHuerfano || 'La app de origen verá este pago como pendiente de re-aprobar.'}
        ${item.huerfanoAt ? `<br><span style="color:var(--text-muted)">Eliminado: ${new Date(item.huerfanoAt).toLocaleString('es-MX')}</span>` : ''}
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
        <button class="btn-reaprobar" style="background:#5dd39e;color:#0e3a25;border:none;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer">✓ Volver a crear movimiento</button>
        <button class="btn-cerrar-huerfano" style="background:transparent;color:#e15555;border:1px solid #e15555;border-radius:6px;padding:8px 14px;cursor:pointer">✕ Cerrar como rechazado</button>
      </div>
    ` : item.comentarioRechazo ? `
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:12px;color:var(--text-muted)">
        Motivo del rechazo: <em>${item.comentarioRechazo}</em>
      </div>
    ` : item.movId ? `
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:12px;color:var(--text-muted)">
        ✓ Movimiento creado · ID interno: <code>${item.movId}</code>${item.aprobadoAt ? ' · ' + new Date(item.aprobadoAt).toLocaleString('es-MX') : ''}
        ${item.actualizadoPorContador ? `<br>✎ Editado por el contador${item.actualizadoAt ? ' el ' + new Date(item.actualizadoAt).toLocaleString('es-MX') : ''}` : ''}
      </div>
    ` : ''}
  `;

  if (item.estado === 'pendiente') {
    card.querySelector('.btn-aprobar').addEventListener('click', () => _aprobarItem(item));
    card.querySelector('.btn-rechazar').addEventListener('click', () => _rechazarItem(item));
  } else if (item.estado === 'huerfano') {
    card.querySelector('.btn-reaprobar').addEventListener('click', () => _aprobarItem(item));
    card.querySelector('.btn-cerrar-huerfano').addEventListener('click', () => _rechazarItem(item));
  }

  return card;
}

function _obtenerNombreProyecto(proyectoId) {
  const proyectos = getCollection('sogrub_proyectos') || [];
  const p = (Array.isArray(proyectos) ? proyectos : Object.values(proyectos)).find(x => String(x?.id) === String(proyectoId));
  return p?.nombre || `(proyecto ${proyectoId})`;
}

async function _aprobarItem(item) {
  if (!item.proyectoId) {
    _toast('Falta vincular la obra al proyecto contable. Hazlo desde la app de estimaciones (Admin → Vincular obras) y vuelve.', 'error');
    return;
  }

  const fechaISO = item.fecha
    ? new Date(item.fecha).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  let movimiento;
  let nombrePill;

  if (item.tipo === 'pago_cliente') {
    const conIvaFlag = item?.monto?.conIva !== false && (Number(item?.monto?.iva) || 0) > 0;
    movimiento = {
      proyecto_id: item.proyectoId,
      fecha: fechaISO,
      monto: Number(item?.monto?.importe) || 0,
      concepto: `Pago de Estimación #${item.estimNumero ?? '?'} (${item.obraNombre || item.obraId || ''})${conIvaFlag ? '' : ' (sin IVA)'} — vía buzón`,
      subcontratista: '',
      status: 'Pagado',
      tipo: 'abono_cliente',
      origen_buzon_id: item.id,
      monto_subtotal: Number(item?.monto?.subtotal) || 0,
      monto_iva: Number(item?.monto?.iva) || 0,
      incluye_iva: conIvaFlag
    };
    nombrePill = `Abono de $${movimiento.monto.toLocaleString('es-MX', { minimumFractionDigits: 2 })} registrado en el proyecto.`;

  } else if (item.tipo === 'estimacion_subcontratista') {
    // Buscar o crear el proveedor por nombre (case-insensitive)
    const proveedorNombre = (item.proveedorNombre || '').trim();
    if (!proveedorNombre) {
      _toast('El item no tiene nombre de subcontratista.', 'error');
      return;
    }
    const provDef = _findOrCreateProveedor(proveedorNombre, {
      email: item.proveedorEmail || '',
      telefono: item.proveedorTelefono || ''
    });
    // Gastos en este modelo se guardan como monto NEGATIVO
    const importe = Number(item?.monto?.importe) || 0;
    const conIvaFlag = item?.monto?.conIva !== false && (Number(item?.monto?.iva) || 0) > 0;

    // Mapear el desglose por clave OPUS al concepto_id de bitácora
    const desglose_presupuesto = await _mapearDesgloseAOpusBitacora(item.proyectoId, item.desglose);

    movimiento = {
      proyecto_id: item.proyectoId,
      fecha: fechaISO,
      monto: -Math.abs(importe),
      concepto: `Pago a ${proveedorNombre} — Subcontrato "${item.subcontratoNombre || ''}", estimación #${item.subEstimacionNumero ?? '?'}${conIvaFlag ? '' : ' (sin IVA)'} — vía buzón`,
      subcontratista: proveedorNombre,
      status: 'Pagado',
      tipo: 'gasto',
      categoria: 'Subcontratista',
      origen_buzon_id: item.id,
      monto_subtotal: Number(item?.monto?.subtotal) || 0,
      monto_iva: Number(item?.monto?.iva) || 0,
      incluye_iva: conIvaFlag,
      proveedor_id: provDef?.id || null,
      desglose_presupuesto: desglose_presupuesto.length ? desglose_presupuesto : undefined
    };
    const claveExtra = desglose_presupuesto.length
      ? ` · ${desglose_presupuesto.length} concepto(s) OPUS distribuidos`
      : (item.desglose?.length ? ' · ⚠ desglose no se pudo mapear (¿catálogo OPUS no importado en bitácora?)' : '');
    nombrePill = `Gasto de $${Math.abs(movimiento.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 })} a ${proveedorNombre}${provDef?._creado ? ' (proveedor nuevo creado)' : ''} registrado.${claveExtra}`;

  } else {
    _toast('Tipo de buzón no soportado todavía: ' + item.tipo, 'error');
    return;
  }

  try {
    const created = addItem('sogrub_proy_movimientos', movimiento);
    await _dbRef(`/shared/buzon/${item.id}`).update({
      estado: 'aprobado',
      aprobadoAt: Date.now(),
      aprobadoPor: _currentUser?.uid || '',
      movId: created.id,
      destinoRefPath: `sogrub_proy_movimientos[id=${created.id}]`,
      huerfanoAt: null,
      huerfanoPor: null,
      descripcionHuerfano: null
    });
    _toast(nombrePill, 'success');
  } catch (err) {
    console.error('[Buzón aprobar]', err);
    _toast('Error al aprobar: ' + err.message, 'error');
  }
}

// Mapea el desglose enviado por estimaciones (clave OPUS + importe) al
// formato que espera bitácora: [{concepto_id, importe}]. El catálogo unificado
// vive en /shared/catalogos/{obraId}; resolvemos proyectoId → obraId via
// obraLinks. concepto_id resultante es conceptoKey (estable cross-app).
async function _mapearDesgloseAOpusBitacora(proyectoId, desglose) {
  if (!Array.isArray(desglose) || desglose.length === 0 || !proyectoId) return [];

  // Resolver proyectoId → obraId via /shared/obraLinks
  let obraId = null;
  try {
    const linksSnap = await _dbRef('/shared/obraLinks').get();
    const links = linksSnap.val() || {};
    obraId = Object.entries(links).find(([, pid]) => pid === proyectoId)?.[0] || null;
  } catch (e) {
    console.warn('[Buzón] No se pudo leer obraLinks:', e);
    return [];
  }
  if (!obraId) return [];

  // Leer conceptos del catálogo unificado
  let conceptos = null;
  try {
    const snap = await _dbRef(`/shared/catalogos/${obraId}/conceptos`).get();
    conceptos = snap.val();
  } catch (e) {
    console.warn('[Buzón] No se pudo leer /shared/catalogos:', e);
    return [];
  }
  if (!conceptos) return [];

  // Index por clave OPUS (PUs no archivados, primera ocurrencia gana).
  // Si una clave aparece en múltiples partidas (Torre 1/Torre 2), tomamos
  // la primera por orden — el contador puede re-asignar manualmente si hace falta.
  const byClave = new Map();
  for (const [conceptoKey, c] of Object.entries(conceptos)) {
    if (c?.tipo !== 'precio_unitario' || c?.archivado) continue;
    const k = (c.clave || '').trim();
    if (!k) continue;
    if (!byClave.has(k)) byClave.set(k, conceptoKey);
  }

  const out = [];
  for (const linea of desglose) {
    const k = (linea.clave || '').trim();
    if (!k) continue;
    const conceptoKey = byClave.get(k);
    if (!conceptoKey) continue;
    const importe = Number(linea.importe) || 0;
    if (importe <= 0) continue;
    out.push({ concepto_id: conceptoKey, importe });
  }
  return out;
}

// Busca proveedor en sogrub_proveedores por nombre (case-insensitive). Si no
// existe, lo crea sobre la marcha. Devuelve el proveedor con flag _creado=true
// si se acaba de crear, para feedback al usuario.
function _findOrCreateProveedor(nombre, extras = {}) {
  const proveedores = getCollection('sogrub_proveedores') || [];
  const arr = Array.isArray(proveedores) ? proveedores : Object.values(proveedores);
  const norm = (s) => String(s || '').trim().toLowerCase();
  const existente = arr.find(p => norm(p?.nombre) === norm(nombre));
  if (existente) return { ...existente, _creado: false };
  const nuevo = addItem('sogrub_proveedores', {
    nombre: nombre.trim(),
    rfc: '',
    telefono: extras.telefono || '',
    email: extras.email || '',
    notas: 'Creado automáticamente desde el buzón al aprobar pago a subcontratista.'
  });
  return { ...nuevo, _creado: true };
}

async function _rechazarItem(item) {
  const motivo = prompt('Motivo del rechazo (visible en la app de origen):');
  if (motivo === null) return;
  try {
    await _dbRef(`/shared/buzon/${item.id}`).update({
      estado: 'rechazado',
      rechazadoAt: Date.now(),
      rechazadoPor: _currentUser?.uid || '',
      comentarioRechazo: motivo || ''
    });
    _toast('Item rechazado.', 'success');
  } catch (err) {
    _toast('Error al rechazar: ' + err.message, 'error');
  }
}

// Toast helper compatible con el que ya tiene la app (busca uno global o hace fallback)
function _toast(msg, kind) {
  if (typeof showToast === 'function') return showToast(msg, kind);
  if (typeof toast === 'function') return toast(msg, kind);
  console.log(`[${kind}] ${msg}`);
}

// Suscribir tan pronto el user esté autenticado (después de Auth, no antes)
// Lo hace el ciclo de _onFirebaseReady → _initApp; pero como esta vista solo
// se monta al hacer click en el tab, hacemos suscripción lazy en renderBuzon().
