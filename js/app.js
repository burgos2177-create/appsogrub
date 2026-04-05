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

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  const section = document.getElementById(`view-${viewName}`);
  if (section) section.classList.add('active');

  _activeView = viewName;

  const renders = {
    dashboard:   () => renderDashboard(),
    caja:        () => renderCaja(),
    proyectos:   () => renderProyectos(),
    detalle:     () => renderDetalle(_activeProyecto),
    proveedores: () => renderProveedores(),
    importar:    () => renderImportar(),
    analisis:    () => renderAnalisis(),
    fiscal:      () => renderFiscal(),
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
