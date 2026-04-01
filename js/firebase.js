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

// Cache local en memoria (espejo de Firebase)
// Estructura: { sogrub_config:{}, sogrub_movimientos:[], sogrub_proyectos:[], sogrub_proy_movimientos:[] }
const _cache = {
  sogrub_config:           null,
  sogrub_movimientos:      null,
  sogrub_proyectos:        null,
  sogrub_proy_movimientos: null,
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
];

let _loadedCount = 0;

function _suscribirColecciones() {
  _COLECCIONES.forEach(key => {
    _db.ref(key).on('value', snapshot => {
      const data = snapshot.val();

      // Si no existe aún en Firebase, no pisar el cache
      if (data !== null) {
        _cache[key] = data;
      }

      // Contar cargas iniciales
      if (!_fbReady) {
        _loadedCount++;
        if (_loadedCount >= _COLECCIONES.length) {
          _fbReady = true;
          _onFirebaseReady();
        }
      } else {
        // Cambio en tiempo real → re-renderizar vista activa
        _onRemoteChange(key);
      }
    }, err => {
      console.error(`[Firebase] Error listener "${key}":`, err);
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
  // Actualizar pantalla de carga
  const msgEl = document.getElementById('loading-msg');
  if (msgEl) msgEl.textContent = 'Datos cargados ✓';

  setTimeout(() => {
    // Ocultar loading, mostrar app
    const loading = document.getElementById('app-loading');
    const main    = document.getElementById('app-main');
    if (loading) loading.classList.add('app-loading--hidden');
    if (main)    main.style.display = '';

    // Inicializar app normalmente
    _initApp();
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
    dashboard:  () => renderDashboard(),
    caja:       () => renderCaja(),
    proyectos:  () => renderProyectos(),
    detalle:    () => renderDetalle(_activeProyecto),
    importar:   () => {},   // importar no necesita re-render reactivo
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

  const snap = await _db.ref('sogrub_movimientos').get();

  // Si ya hay datos en Firebase, no migrar
  if (snap.exists() && Array.isArray(snap.val()) && snap.val().length > 0) {
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
async function initializeData() {
  const msgEl = document.getElementById('loading-msg');

  try {
    // 1. Monitor de conexión
    _initConnectionStatus();

    // 2. Migrar localStorage → Firebase si Firebase está vacío
    if (msgEl) msgEl.textContent = 'Verificando datos existentes…';
    await _migrarLocalStorageSiEsNecesario();

    // 3. Suscribir listeners en tiempo real (dispara _onFirebaseReady cuando terminan)
    if (msgEl) msgEl.textContent = 'Sincronizando con Firebase…';
    _suscribirColecciones();

  } catch (err) {
    console.error('[Firebase] Error de inicialización:', err);
    if (msgEl) msgEl.textContent = 'Error de conexión — reintentando…';
    // Reintentar en 3s
    setTimeout(initializeData, 3000);
  }
}

// _initApp se define en app.js y es llamado por _onFirebaseReady
// La declaramos aquí como stub por si firebase.js carga antes que app.js
function _initApp() {
  // Sobreescrita en app.js
  console.warn('[Firebase] _initApp no está definida aún');
}
