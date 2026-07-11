/* =====================================================
   SOGRUB Bitácora — App entry point + navegación
   ===================================================== */
'use strict';

let _activeView     = 'dashboard';
let _activeProyecto = null;

// =====================================================
// _initApp — llamado por firebase.js cuando los datos
// están listos y la app puede arrancar
// =====================================================
function _initApp() {
  initModalSystem();
  initNavigation();
  navigateTo('dashboard');
  initScrollHints();
  initSyncFinanzas(); // sync saldo → fnz-psnal (sync-finanzas.js)
  document.getElementById('btn-settings')?.addEventListener('click', openSettingsModal);
}

// =====================================================
// BOOTSTRAP — inicia Firebase (asíncrono)
// =====================================================
document.addEventListener('DOMContentLoaded', () => {
  // initializeData() está en firebase.js
  // Cuando termine llamará _initApp() automáticamente
  initializeData();
});

// =====================================================
// NAVEGACIÓN
// =====================================================
function initNavigation() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => navigateTo(tab.dataset.view));
  });
}

function navigateTo(viewName, proyectoId = null) {
  if (viewName === 'detalle' && proyectoId) {
    _activeProyecto = proyectoId;
  }

  const tabTarget = viewName === 'detalle' ? 'proyectos' : viewName;
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.view === tabTarget);
  });

  // Móvil: centra la pestaña activa en la tira deslizable del nav.
  // No-op en escritorio (el nav no tiene overflow ahí).
  document.querySelector('.nav-tab.active')
    ?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  const section = document.getElementById(`view-${viewName}`);
  if (section) section.classList.add('active');

  _activeView = viewName;

  const renders = {
    dashboard:   () => renderDashboard(),
    caja:        () => renderCaja(),
    efectivo:    () => renderEfectivo(),
    proyectos:   () => renderProyectos(),
    detalle:     () => renderDetalle(_activeProyecto),
    proveedores: () => renderProveedores(),
    importar:    () => renderImportar(),
    analisis:    () => renderAnalisis(),
    fiscal:      () => renderFiscal(),
    buzon:       () => renderBuzon(),
  };
  renders[viewName]?.();
}

// =====================================================
// SCROLL HINTS en tablas
// =====================================================
function initScrollHints() {
  document.addEventListener('scroll', updateScrollHints, true);
  updateScrollHints();
}

function updateScrollHints() {
  document.querySelectorAll('.table-wrapper').forEach(wrap => {
    wrap.classList.toggle('scrollable',
      wrap.scrollLeft < wrap.scrollWidth - wrap.clientWidth - 4
    );
  });
}
