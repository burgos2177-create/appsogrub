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
          Estimación: <b>#${item.estimNumero ?? '—'}</b> · Fecha del pago: <b>${fechaPago}</b><br>
          ${item.proyectoId
            ? `Proyecto contable: <b style="color:#5dd39e">${_obtenerNombreProyecto(item.proyectoId)}</b>`
            : `<span style="color:#e15555">⚠ Obra sin vincular a proyecto contable</span>`}
          ${fechaCreado ? `<br>Recibido: ${fechaCreado}` : ''}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:11px;color:var(--text-muted)">Importe</div>
        <div style="font-family:ui-monospace,monospace;font-size:22px;font-weight:700;color:var(--accent)">
          $${monto.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div style="font-size:10px;color:var(--text-muted)">
          Subtotal $${(item?.monto?.subtotal || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} ·
          IVA $${(item?.monto?.iva || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
        </div>
      </div>
    </div>
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
  if (item.tipo !== 'pago_cliente') {
    _toast('Tipo de buzón no soportado todavía: ' + item.tipo, 'error');
    return;
  }

  // Crear el abono_cliente en sogrub_proy_movimientos
  const fechaISO = item.fecha
    ? new Date(item.fecha).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const movimiento = {
    proyecto_id: item.proyectoId,
    fecha: fechaISO,
    monto: Number(item?.monto?.importe) || 0,
    concepto: `Pago de Estimación #${item.estimNumero ?? '?'} (${item.obraNombre || item.obraId || ''}) — vía buzón`,
    subcontratista: '',
    status: 'Pagado',
    tipo: 'abono_cliente',
    origen_buzon_id: item.id,    // trazabilidad: este mov vino del item buzon X
    monto_subtotal: Number(item?.monto?.subtotal) || 0,
    monto_iva: Number(item?.monto?.iva) || 0
  };

  try {
    const created = addItem('sogrub_proy_movimientos', movimiento);
    // Marcar item como aprobado
    await _dbRef(`/shared/buzon/${item.id}`).update({
      estado: 'aprobado',
      aprobadoAt: Date.now(),
      aprobadoPor: _currentUser?.uid || '',
      movId: created.id,
      destinoRefPath: `sogrub_proy_movimientos[id=${created.id}]`,
      // Limpiar campos de estado huérfano si estamos re-aprobando
      huerfanoAt: null,
      huerfanoPor: null,
      descripcionHuerfano: null
    });
    _toast(`Aprobado. Abono de $${movimiento.monto.toLocaleString('es-MX', { minimumFractionDigits: 2 })} registrado en el proyecto.`, 'success');
  } catch (err) {
    console.error('[Buzón aprobar]', err);
    _toast('Error al aprobar: ' + err.message, 'error');
  }
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
