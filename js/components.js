/* =====================================================
   SOGRUB Bitácora — Componentes reutilizables
   Modal, Toast, formatos
   ===================================================== */
'use strict';

// =====================================================
// FORMATO DE MONEDA Y FECHAS
// =====================================================

function formatMXN(amount) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(amount);
}

// Orden para tablas de movimientos: lo más reciente arriba.
//
// Las fechas se guardan como 'YYYY-MM-DD' (sin hora), así que dentro de un
// mismo día no desempatan y un sort estable deja el orden de la colección —
// que es cronológico ascendente, porque addItem hace push al final. Resultado:
// el movimiento recién capturado quedaba hasta abajo de su día, pegado al día
// anterior. Aquí se invierte ese desempate: a igual fecha, el índice más alto
// (capturado después) va primero, y lo nuevo entra por arriba.
function sortByFechaDesc(movs) {
  return movs
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const cmp = String(b.m.fecha ?? '').localeCompare(String(a.m.fecha ?? ''));
      return cmp !== 0 ? cmp : b.i - a.i;
    })
    .map(x => x.m);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// =====================================================
// TOAST NOTIFICATIONS
// =====================================================

function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] ?? icons.info}</span>
    <span>${message}</span>
  `;

  container.appendChild(toast);

  const remove = () => {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };

  setTimeout(remove, duration);
  toast.addEventListener('click', remove);
}

// =====================================================
// MODAL SYSTEM
// =====================================================

let _modalResolve = null;
// ¿El usuario ya capturó algo en el modal abierto? Lo marca la interacción real
// (ver initModalSystem); asignar .value por código no dispara input/change, así
// que los valores precargados no cuentan como captura.
let _modalSucio = false;

function openModal({ title, body, confirmText = 'Confirmar', cancelText = 'Cancelar', onConfirm, large = false }) {
  const overlay   = document.getElementById('modal-overlay');
  const card      = document.getElementById('modal-card');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const footerEl  = document.getElementById('modal-footer');

  titleEl.textContent = title;
  bodyEl.innerHTML    = '';
  footerEl.innerHTML  = '';
  _modalSucio         = false;

  if (typeof body === 'string') {
    bodyEl.innerHTML = body;
  } else if (body instanceof HTMLElement) {
    bodyEl.appendChild(body);
  }

  card.classList.toggle('modal-lg', !!large);

  // Footer buttons
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary';
  cancelBtn.textContent = cancelText;
  cancelBtn.addEventListener('click', closeModal);

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn btn-primary';
  confirmBtn.textContent = confirmText;
  confirmBtn.id = 'modal-confirm-btn';
  confirmBtn.addEventListener('click', () => {
    if (onConfirm) onConfirm(confirmBtn);
  });

  footerEl.appendChild(cancelBtn);
  footerEl.appendChild(confirmBtn);

  overlay.classList.remove('hidden');

  // Trap focus on open
  document.getElementById('modal-close-btn').focus();
}

// Cierre incondicional. Lo usan los flujos que ya terminaron (guardar, aprobar,
// etc.), así que NUNCA debe preguntar nada: el trabajo ya se guardó.
// Para el cierre pedido por el usuario (click fuera, ✕, Escape) ver
// requestCloseModal, que sí protege lo capturado.
function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('hidden');
  const body   = document.getElementById('modal-body');
  const footer = document.getElementById('modal-footer');
  // Limpiar errores de validación antes de cerrar
  clearValidation(body);
  body.innerHTML   = '';
  footer.innerHTML = '';
  const aviso = document.getElementById('modal-descartar');
  if (aviso) aviso.remove();
  _modalSucio = false;
}

// Cierre pedido por el usuario. Si ya capturó algo, pregunta antes de perderlo;
// si el formulario sigue intacto, cierra sin fricción.
function requestCloseModal() {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  if (!_modalSucio) return closeModal();
  if (document.getElementById('modal-descartar')) return;   // ya se está preguntando
  _confirmarDescartarModal();
}

// Aviso dibujado ENCIMA del modal (no lo reemplaza) para que, si el usuario
// elige seguir editando, encuentre todo exactamente como lo dejó.
// A propósito no se usa confirm() nativo: el navegador lo suprime tras varios
// diálogos en la misma sesión y el aviso simplemente no aparecería.
function _confirmarDescartarModal() {
  const overlay = document.getElementById('modal-overlay');
  const capa = document.createElement('div');
  capa.id = 'modal-descartar';
  capa.style.cssText = 'position:absolute;top:0;right:0;bottom:0;left:0;display:flex;' +
    'align-items:center;justify-content:center;background:rgba(0,0,0,.6);z-index:10;padding:20px';
  capa.innerHTML = `
    <div class="modal-card" style="max-width:400px;padding:24px">
      <h3 style="margin:0 0 10px">¿Descartar lo capturado?</h3>
      <p class="text-muted" style="line-height:1.6;margin:0 0 20px">
        Si sales ahora se perderá la información que escribiste en este formulario.
      </p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-danger" id="modal-descartar-si">Descartar</button>
        <button class="btn btn-primary" id="modal-descartar-no">Seguir editando</button>
      </div>
    </div>`;
  // Un click dentro del aviso no debe llegar al overlay (dispararía otro cierre).
  capa.addEventListener('click', (e) => e.stopPropagation());
  overlay.appendChild(capa);
  capa.querySelector('#modal-descartar-si').addEventListener('click', () => closeModal());
  capa.querySelector('#modal-descartar-no').addEventListener('click', () => capa.remove());
  capa.querySelector('#modal-descartar-no').focus();   // la opción segura queda enfocada
}

function openConfirmModal({ title, message, confirmText = 'Eliminar', onConfirm }) {
  const body = document.createElement('p');
  body.style.cssText = 'color: var(--text-muted); line-height: 1.6;';
  body.textContent = message;

  openModal({
    title,
    body,
    confirmText,
    onConfirm,
  });
}

// =====================================================
// FORM VALIDATION HELPERS
// =====================================================

/**
 * Valida campos requeridos, aplica estilos de error y retorna true si todo ok.
 * @param {Array<{el: HTMLElement, msg: string}>} rules
 */
function validateFields(rules) {
  let ok = true;
  rules.forEach(({ el, msg }) => {
    // Limpiar estado previo
    el.classList.remove('error');
    el.parentElement.querySelector('.form-error-msg')?.remove();

    const val = el.value?.trim();
    const empty = !val || val === '';
    const invalid = el.type === 'number' && (isNaN(parseFloat(val)) || parseFloat(val) <= 0);

    if (empty || invalid) {
      el.classList.add('error');
      const errEl = document.createElement('span');
      errEl.className = 'form-error-msg';
      errEl.textContent = msg;
      el.parentElement.appendChild(errEl);
      if (ok) el.focus();
      ok = false;
    }
  });
  return ok;
}

/** Limpia errores de validación de un contenedor */
function clearValidation(container) {
  container.querySelectorAll('.error').forEach(el => el.classList.remove('error'));
  container.querySelectorAll('.form-error-msg').forEach(el => el.remove());
}

// =====================================================
// GLOBAL MODAL WIRING (runs once after DOM ready)
// =====================================================

function initModalSystem() {
  const overlay  = document.getElementById('modal-overlay');
  const closeBtn = document.getElementById('modal-close-btn');
  const bodyEl   = document.getElementById('modal-body');

  // Se registran UNA sola vez: el overlay es un singleton que se reusa en cada
  // openModal (si se registraran ahí, los listeners se irían acumulando).
  bodyEl.addEventListener('input',  () => { _modalSucio = true; });
  bodyEl.addEventListener('change', () => { _modalSucio = true; });

  // Las tres vías de cierre a petición del usuario pasan por el aviso.
  closeBtn.addEventListener('click', requestCloseModal);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) requestCloseModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') requestCloseModal();
  });
}

// =====================================================
// BADGE HELPERS
// =====================================================

function statusBadge(status) {
  const map = { 'Pagado': 'badge-success', 'Pendiente': 'badge-warning' };
  return `<span class="badge ${map[status] ?? 'badge-muted'}">${status}</span>`;
}

function estadoBadge(estado) {
  const map = { 'activo': 'badge-success', 'terminado': 'badge-muted', 'pausa': 'badge-warning' };
  const labels = { 'activo': 'Activo', 'terminado': 'Terminado', 'pausa': 'Pausa' };
  return `<span class="badge ${map[estado] ?? 'badge-muted'}">${labels[estado] ?? estado}</span>`;
}

function tipoBadge(tipo, proyectoNombre = '') {
  const map = {
    'gasto_general':         { cls: 'badge-muted',   label: 'Gasto general' },
    'transferencia_proyecto':{ cls: 'badge-info',    label: proyectoNombre ? `→ ${proyectoNombre}` : 'Transferencia' },
    'gasto':                 { cls: 'badge-danger',  label: 'Gasto' },
    'abono_cliente':         { cls: 'badge-success', label: 'Abono cliente' },
    'transferencia_sogrub':  { cls: 'badge-info',    label: 'De SOGRUB' },
    'retiro_utilidad':       { cls: 'badge-success', label: '💸 Utilidad a SOGRUB' },
    'retiro_utilidad_proyecto': { cls: 'badge-success', label: proyectoNombre ? `💸 Utilidad de ${proyectoNombre}` : '💸 Utilidad de obra' },
    'deposito_caja_chica':   { cls: 'badge-warning', label: '💰 Depósito caja chica' },
    'devolucion_caja_chica': { cls: 'badge-info',    label: '⇄ Devolución caja chica' },
    'retiro_efectivo':       { cls: 'badge-warning', label: '💵 Retiro a efectivo' },
    'ingreso_efectivo':      { cls: 'badge-info',    label: '⇄ Ingreso de efectivo' },
  };
  const def = map[tipo] ?? { cls: 'badge-muted', label: tipo };
  return `<span class="badge ${def.cls}">${def.label}</span>`;
}

// =====================================================
// PROGRESS BAR HELPER
// =====================================================

function progressBar(pct, showLabel = true) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const cls = clamped < 60 ? 'low' : clamped < 85 ? 'medium' : 'high';
  const label = showLabel
    ? `<div class="progress-label"><span>Avance financiero</span><strong>${clamped.toFixed(1)}%</strong></div>`
    : '';
  return `
    ${label}
    <div class="progress-bar">
      <div class="progress-fill ${cls}" style="width:${clamped}%"></div>
    </div>
  `;
}

// =====================================================
// EMPTY STATE HELPER
// =====================================================

// =====================================================
// CATEGORÍA BADGE
// =====================================================
function categoriaBadge(cat) {
  const map = {
    'Material':       { cls: 'badge-info',    label: 'Material' },
    'Mano de Obra':   { cls: 'badge-warning', label: 'Mano de Obra' },
    'Subcontratista': { cls: 'badge-danger',  label: 'Subcontratista' },
    'Indirecto':      { cls: 'badge-muted',   label: 'Indirecto' },
  };
  const def = map[cat] ?? { cls: 'badge-muted', label: cat || '—' };
  return `<span class="badge ${def.cls}">${def.label}</span>`;
}

// =====================================================
// HORIZONTAL BAR CHART (CSS-based)
// data = { label: value, ... }
// =====================================================
let _barChartSeq = 0;
function renderBarChart(data, { colorVar = '--accent', title = '', collapseAfter = null } = {}) {
  const entries = Object.entries(data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '<p class="text-muted text-sm" style="padding:8px 0">Sin datos.</p>';

  const max = Math.max(...entries.map(([, v]) => v));
  const total = entries.reduce((a, [, v]) => a + v, 0);

  const colors = ['#1a9fd4', '#4caf82', '#e0a752', '#e05252', '#9b59b6', '#3498db', '#e67e22', '#1abc9c'];

  const rowHTML = ([label, val], i) => {
    const pct = max > 0 ? (val / max) * 100 : 0;
    const pctTotal = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
    const color = colors[i % colors.length];
    return `
          <div class="bar-chart-row">
            <span class="bar-chart-label">${label}</span>
            <div class="bar-chart-track">
              <div class="bar-chart-fill" style="width:${pct}%;background:${color}"></div>
            </div>
            <span class="bar-chart-value">${formatMXN(val)} <span class="text-dim">(${pctTotal}%)</span></span>
          </div>`;
  };

  // ¿Colapsar? Muestra las primeras N filas y esconde el resto tras "Ver más".
  const limite = Number.isInteger(collapseAfter) && collapseAfter > 0 ? collapseAfter : null;
  const colapsa = limite && entries.length > limite;
  const visibles = colapsa ? entries.slice(0, limite) : entries;
  const ocultas  = colapsa ? entries.slice(limite) : [];
  const uid = 'bc' + (++_barChartSeq);
  const restantes = ocultas.length;

  return `
    ${title ? `<div class="chart-title">${title}</div>` : ''}
    <div class="bar-chart">
      ${visibles.map(rowHTML).join('')}
      ${colapsa ? `<div class="bar-chart" id="${uid}-more" style="display:none;margin:0">${ocultas.map((e, i) => rowHTML(e, i + limite)).join('')}</div>` : ''}
    </div>
    ${colapsa ? `<button type="button" id="${uid}-btn" class="btn btn-ghost btn-sm" style="margin-top:10px"
        onclick="(function(){var m=document.getElementById('${uid}-more'),b=document.getElementById('${uid}-btn'),abierto=m.style.display!=='none';m.style.display=abierto?'none':'flex';b.textContent=abierto?'Ver más (${restantes})':'Ver menos';})()">Ver más (${restantes})</button>` : ''}
  `;
}

// =====================================================
// EMPTY STATE HELPER
// =====================================================
// =====================================================
// FISCAL BADGE HELPERS
// =====================================================
function fiscalStatusBadge(estatus) {
  const map = {
    'deducible_con_iva':  { cls: 'badge-success', label: 'Deducible + IVA' },
    'deducible_sin_iva':  { cls: 'badge-info',    label: 'Deducible' },
    'no_deducible':       { cls: 'badge-muted',   label: 'No deducible' },
    'pendiente_revision': { cls: 'badge-warning', label: 'Pendiente' },
  };
  const def = map[estatus] ?? { cls: 'badge-muted', label: estatus || '—' };
  return `<span class="badge ${def.cls}">${def.label}</span>`;
}

function ivaIndicator(incluye_iva) {
  return incluye_iva
    ? '<span class="badge badge-info" style="font-size:10px">IVA</span>'
    : '';
}

function cfdiIcon(tiene) {
  return tiene
    ? '<span style="color:var(--success)" title="Presente">&#10003;</span>'
    : '<span style="color:var(--text-dim)" title="Sin archivo">&#10007;</span>';
}

function alertaSeveridadIcon(tipo) {
  const map = { error: '&#9888;', warning: '&#9888;', info: '&#9432;' };
  const colors = { error: 'var(--danger)', warning: 'var(--warning)', info: 'var(--accent)' };
  return `<span style="color:${colors[tipo] ?? 'var(--text-muted)'}">${map[tipo] ?? ''}</span>`;
}

function emptyState({ icon = '', title = 'Sin datos', desc = '', actionLabel = '', onAction = null }) {
  const el = document.createElement('div');
  el.className = 'empty-state';
  el.innerHTML = `
    ${icon ? `<div class="empty-state-icon">${icon}</div>` : ''}
    <div class="empty-state-title">${title}</div>
    ${desc ? `<p class="empty-state-desc">${desc}</p>` : ''}
    ${actionLabel ? `<button class="btn btn-primary mt-8" id="empty-action">${actionLabel}</button>` : ''}
  `;
  if (actionLabel && onAction) {
    el.querySelector('#empty-action').addEventListener('click', onAction);
  }
  return el;
}
