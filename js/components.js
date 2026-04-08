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

function openModal({ title, body, confirmText = 'Confirmar', cancelText = 'Cancelar', onConfirm, large = false }) {
  const overlay   = document.getElementById('modal-overlay');
  const card      = document.getElementById('modal-card');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const footerEl  = document.getElementById('modal-footer');

  titleEl.textContent = title;
  bodyEl.innerHTML    = '';
  footerEl.innerHTML  = '';

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

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('hidden');
  const body   = document.getElementById('modal-body');
  const footer = document.getElementById('modal-footer');
  // Limpiar errores de validación antes de cerrar
  clearValidation(body);
  body.innerHTML   = '';
  footer.innerHTML = '';
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

  closeBtn.addEventListener('click', closeModal);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
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
    'gasto_general':        { cls: 'badge-muted',   label: 'Gasto general' },
    'transferencia_proyecto':{ cls: 'badge-info',    label: proyectoNombre ? `→ ${proyectoNombre}` : 'Transferencia' },
    'gasto':                { cls: 'badge-danger',  label: 'Gasto' },
    'abono_cliente':        { cls: 'badge-success', label: 'Abono cliente' },
    'transferencia_sogrub': { cls: 'badge-info',    label: 'De SOGRUB' },
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
function renderBarChart(data, { colorVar = '--accent', title = '' } = {}) {
  const entries = Object.entries(data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '<p class="text-muted text-sm" style="padding:8px 0">Sin datos.</p>';

  const max = Math.max(...entries.map(([, v]) => v));
  const total = entries.reduce((a, [, v]) => a + v, 0);

  const colors = ['#1a9fd4', '#4caf82', '#e0a752', '#e05252', '#9b59b6', '#3498db', '#e67e22', '#1abc9c'];

  return `
    ${title ? `<div class="chart-title">${title}</div>` : ''}
    <div class="bar-chart">
      ${entries.map(([label, val], i) => {
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
          </div>
        `;
      }).join('')}
    </div>
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
