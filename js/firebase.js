/* =====================================================
   SOGRUB Bitácora — Firebase Realtime Database
   Sincronización en tiempo real entre dispositivos
   ===================================================== */
'use strict';

// ---- Configuración Firebase ----
const firebaseConfig = {
  apiKey:            "AIzaSyA0Y5s_alrZv6Y0Do03yZZG3lpUlDDhbQI",
  authDomain:        "database-sogrub.firebaseapp.com",
  databaseURL:       "https://database-sogrub-default-rtdb.firebaseio.com",
  projectId:         "database-sogrub",
  storageBucket:     "database-sogrub.firebasestorage.app",
  messagingSenderId: "363314772797",
  appId:             "1:363314772797:web:1927acdcc749bbb1a62354",
  measurementId:     "G-7X9745Q9F5"
};

// ---- Inicializar app ----
const _fbApp = firebase.initializeApp(firebaseConfig);
const _db    = firebase.database();

// ---- Estado de conexión interno ----
let _fbReady    = false;   // true cuando la primera carga de datos terminó
let _fbOnline   = false;   // true cuando hay conexión activa

// Firebase Storage
const _storage = firebase.storage();

// Cache local en memoria (espejo de Firebase)
const _cache = {
  sogrub_config:           null,
  sogrub_movimientos:      null,
  sogrub_proyectos:        null,
  sogrub_proy_movimientos: null,
  sogrub_proveedores:      null,
  sogrub_proy_proveedores: null,
  sogrub_fiscal_config:    null,
};

// Callbacks suscritos a cambios (vista actual los registra)
const _listeners = {};

// =====================================================
// API PÚBLICA — misma interfaz que el storage.js anterior
// =====================================================

/** Lee una colección del cache local */
function getCollection(key) {
  return _cache[key];
}

/** Guarda/actualiza una colección completa en Firebase */
function saveCollection(key, data) {
  // Actualizar cache inmediatamente (optimistic update)
  _cache[key] = data;
  // Persistir en Firebase
  _db.ref(key).set(data).catch(err => {
    console.error(`[Firebase] Error al guardar "${key}":`, err);
  });
  return true;
}

/** Genera UUID */
function generateId() {
  return crypto.randomUUID();
}

/** Agrega un item a una colección array */
function addItem(key, item) {
  const col     = Array.isArray(_cache[key]) ? [..._cache[key]] : [];
  const newItem = { id: generateId(), ...item };
  col.push(newItem);
  saveCollection(key, col);
  return newItem;
}

/** Actualiza un item por id */
function updateItem(key, id, updates) {
  const col = Array.isArray(_cache[key]) ? [..._cache[key]] : [];
  const idx = col.findIndex(x => x.id === id);
  if (idx === -1) return null;
  col[idx] = { ...col[idx], ...updates };
  saveCollection(key, col);
  return col[idx];
}

/** Elimina un item por id */
function deleteItem(key, id) {
  const col      = Array.isArray(_cache[key]) ? [..._cache[key]] : [];
  const filtered = col.filter(x => x.id !== id);
  if (filtered.length === col.length) return false;
  saveCollection(key, filtered);
  return true;
}

/** Busca un item por id en el cache */
function getItem(key, id) {
  const col = Array.isArray(_cache[key]) ? _cache[key] : [];
  return col.find(x => x.id === id) ?? null;
}

/** Lee config */
function getConfig() {
  return _cache['sogrub_config'] ?? { saldo_inicial_mifel: 0, fondos_inversion: [] };
}

/** Guarda config */
function saveConfig(config) {
  return saveCollection('sogrub_config', config);
}

/** Actualiza config parcialmente */
function updateConfig(updates) {
  const cfg = getConfig();
  return saveConfig({ ...cfg, ...updates });
}

// =====================================================
// CLAVES — compatibilidad con código existente
// =====================================================
const KEYS = Object.freeze({
  CONFIG:           'sogrub_config',
  MOVIMIENTOS:      'sogrub_movimientos',
  PROYECTOS:        'sogrub_proyectos',
  PROY_MOVIMIENTOS: 'sogrub_proy_movimientos',
  PROVEEDORES:      'sogrub_proveedores',
  PROY_PROVEEDORES: 'sogrub_proy_proveedores',
  FISCAL_CONFIG:    'sogrub_fiscal_config',
});

// =====================================================
// LISTENERS EN TIEMPO REAL
// Cada colección escucha cambios de Firebase y actualiza
// el cache + re-renderiza la vista activa si es necesario
// =====================================================
const _COLECCIONES = [
  'sogrub_config',
  'sogrub_movimientos',
  'sogrub_proyectos',
  'sogrub_proy_movimientos',
  'sogrub_proveedores',
  'sogrub_proy_proveedores',
  'sogrub_fiscal_config',
];

let _loadedCount = 0;

function _suscribirColecciones() {
  // Si Firebase tarda más de 20s, arrancar con datos vacíos.
  // Cuando conecte después, los listeners dispararán _onRemoteChange
  // y la vista activa se re-renderizará con los datos reales.
  const _fallbackTimer = setTimeout(() => {
    if (!_fbReady) {
      console.warn('[Firebase] Sin respuesta en 20s — arrancando sin datos');
      const msgEl = document.getElementById('loading-msg');
      if (msgEl) msgEl.textContent = 'Sin conexión — intenta recargar';
      _fbReady = true;
      _onFirebaseReady();
    }
  }, 20000);

  function _contarCarga() {
    if (_fbReady) return;
    _loadedCount++;
    if (_loadedCount >= _COLECCIONES.length) {
      clearTimeout(_fallbackTimer);
      _fbReady = true;
      _onFirebaseReady();
    }
  }

  _COLECCIONES.forEach(key => {
    _db.ref(key).on('value', snapshot => {
      const data = snapshot.val();
      if (data !== null) {
        _cache[key] = data;
      }
      if (!_fbReady) {
        _contarCarga();
      } else {
        _onRemoteChange(key);
      }
    }, err => {
      console.error(`[Firebase] Error listener "${key}":`, err);
      _contarCarga(); // contar igual para no colgar
    });
  });
}

// =====================================================
// INDICADOR DE CONEXIÓN
// =====================================================
function _initConnectionStatus() {
  const connRef = _db.ref('.info/connected');
  connRef.on('value', snap => {
    _fbOnline = snap.val() === true;
    _updateStatusUI(_fbOnline ? 'online' : 'offline');
  });
}

function _updateStatusUI(state) {
  const el = document.getElementById('db-status');
  if (!el) return;
  el.className = `db-status db-status--${state}`;
  const labels = { online: 'En línea', offline: 'Sin conexión', connecting: 'Conectando…' };
  el.querySelector('.db-status__label').textContent = labels[state] ?? state;
}

// =====================================================
// ARRANQUE — cuando Firebase tiene los datos listos
// =====================================================
function _onFirebaseReady() {
  const msgEl = document.getElementById('loading-msg');
  if (msgEl) msgEl.textContent = 'Datos cargados ✓';

  setTimeout(() => {
    const loading = document.getElementById('app-loading');
    const main    = document.getElementById('app-main');
    if (loading) loading.classList.add('app-loading--hidden');
    if (main)    main.style.display = '';

    _initApp();

    // Migración en segundo plano — no bloquea el arranque
    _migrarLocalStorageSiEsNecesario().catch(e =>
      console.warn('[Firebase] Migración bg:', e.message)
    );
  }, 400);
}

// =====================================================
// RE-RENDER EN TIEMPO REAL
// Cuando Firebase notifica un cambio remoto, re-renderiza
// la vista activa para reflejar los nuevos datos
// =====================================================
function _onRemoteChange(changedKey) {
  if (typeof _activeView === 'undefined') return;

  const rerender = {
    dashboard:   () => renderDashboard(),
    caja:        () => renderCaja(),
    proyectos:   () => renderProyectos(),
    detalle:     () => renderDetalle(_activeProyecto),
    proveedores: () => renderProveedores(),
    importar:    () => {},   // importar no necesita re-render reactivo
    analisis:    () => renderAnalisis(),
    fiscal:      () => renderFiscal(),
  };

  rerender[_activeView]?.();
}

// =====================================================
// MIGRACIÓN — localStorage → Firebase (primera vez)
// Si Firebase está vacío, sube los datos del localStorage
// =====================================================
let _migracionRealizada = false;

async function _migrarLocalStorageSiEsNecesario() {
  if (_migracionRealizada) return;
  _migracionRealizada = true;

  let snap;
  try {
    // Timeout de 8s para no colgar la app si Firebase tarda
    snap = await Promise.race([
      _db.ref('sogrub_movimientos').get(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('migration-timeout')), 8000)
      ),
    ]);
  } catch (e) {
    console.warn('[Firebase] Omitiendo migración (timeout/error):', e.message);
    return; // Continuar sin migrar — los listeners traerán los datos
  }

  // Si ya hay datos en Firebase, no migrar
  const val = snap.val();
  const yaExiste = snap.exists() && val !== null &&
    (Array.isArray(val) ? val.length > 0 : Object.keys(val).length > 0);
  if (yaExiste) {
    console.log('[Firebase] Datos ya existen en Firebase, sin migración.');
    return;
  }

  // Buscar datos en localStorage
  const lsKeys = ['sogrub_config', 'sogrub_movimientos', 'sogrub_proyectos', 'sogrub_proy_movimientos'];
  let hayDatos = false;

  for (const key of lsKeys) {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        const tieneContenido = Array.isArray(parsed) ? parsed.length > 0 : Object.keys(parsed).length > 0;
        if (tieneContenido) { hayDatos = true; break; }
      } catch {}
    }
  }

  if (!hayDatos) return;

  console.log('[Firebase] Migrando datos de localStorage a Firebase…');
  const msgEl = document.getElementById('loading-msg');
  if (msgEl) msgEl.textContent = 'Migrando datos históricos…';

  const updates = {};
  for (const key of lsKeys) {
    const raw = localStorage.getItem(key);
    if (raw) {
      try { updates[key] = JSON.parse(raw); } catch {}
    }
  }

  await _db.ref('/').update(updates);
  console.log('[Firebase] Migración completada.');
}

// =====================================================
// INICIALIZACIÓN — reemplaza initializeData()
// =====================================================
function initializeData() {
  try {
    _initConnectionStatus();
    _suscribirColecciones(); // arranca inmediatamente, sin esperar migración
  } catch (err) {
    console.error('[Firebase] Error de inicialización:', err);
    const msgEl = document.getElementById('loading-msg');
    if (msgEl) msgEl.textContent = 'Error — reintentando…';
    setTimeout(initializeData, 3000);
  }
}

// =====================================================
// FIREBASE STORAGE — Upload de facturas (PDF)
// =====================================================
async function uploadFactura(file, movimientoId) {
  const ref = _storage.ref(`facturas/${movimientoId}_${file.name}`);
  const snap = await ref.put(file);
  return snap.ref.getDownloadURL();
}

// _initApp se define en app.js y es llamado por _onFirebaseReady
// La declaramos aquí como stub por si firebase.js carga antes que app.js
function _initApp() {
  // Sobreescrita en app.js
  console.warn('[Firebase] _initApp no está definida aún');
}
