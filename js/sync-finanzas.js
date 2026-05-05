/* =====================================================
   SOGRUB Bitácora — Sync saldo Mifel → fnz-psnal
   Escribe el saldo de la cuenta Mifel en el proyecto
   de finanzas personales (Firestore) cada vez que
   sogrub_movimientos, sogrub_proy_movimientos o
   sogrub_config cambia.
   ===================================================== */
'use strict';

// ---- Configuración Firebase fnz-psnal ----
const _fnzConfig = {
  apiKey:            'AIzaSyD4AguJyQYpv49hrO84RtK3kv5kf93FtjE',
  authDomain:        'fnz-psnal.firebaseapp.com',
  databaseURL:       'https://fnz-psnal-default-rtdb.firebaseio.com',
  projectId:         'fnz-psnal',
  storageBucket:     'fnz-psnal.firebasestorage.app',
  messagingSenderId: '570838574175',
  appId:             '1:570838574175:web:f9194df1b31f21e3c6e7ea',
};

// Ruta Firestore destino
const _FNZ_DOC_PATH = 'usuarios/p8zgQMAmVhR0FPIveMOVo6rMEi93/global/empresas';
const _FNZ_EMPRESA_ID = 'sogrub_mifel';

// App secundaria (puede inicializarse solo una vez)
let _fnzApp       = null;
let _fnzFirestore = null;
let _fnzReady     = false;  // true una vez que inicializó sin error

// Debounce — evita ráfagas de writes cuando varios listeners disparan juntos
let _syncTimer = null;
const _SYNC_DEBOUNCE_MS = 1200;

// =====================================================
// INICIALIZAR app secundaria fnz-psnal
// =====================================================
function _initFnzApp() {
  if (_fnzApp) return true;
  try {
    // Verificar si ya fue inicializada (p.ej. recarga parcial)
    try {
      _fnzApp = firebase.app('fnz-psnal');
    } catch (_) {
      _fnzApp = firebase.initializeApp(_fnzConfig, 'fnz-psnal');
    }
    _fnzFirestore = firebase.firestore(_fnzApp);
    _fnzReady = true;
    console.log('[SyncFinanzas] App fnz-psnal inicializada.');
    return true;
  } catch (err) {
    console.error('[SyncFinanzas] Error inicializando app fnz-psnal:', err);
    return false;
  }
}

// =====================================================
// FUNCIÓN PÚBLICA — llamada desde firebase.js
// Se llama con debounce cada vez que cambia una de las
// colecciones que afectan al saldo Mifel.
// =====================================================
function scheduleSyncSaldoMifel() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(_doSync, _SYNC_DEBOUNCE_MS);
}

async function _doSync() {
  if (!_fnzReady && !_initFnzApp()) return; // no pudo inicializar, silent fail

  let saldo;
  try {
    saldo = calcSaldoMifel(); // definida en calculations.js
  } catch (err) {
    console.warn('[SyncFinanzas] No se pudo calcular saldo Mifel:', err);
    return;
  }

  const payload = {
    list: [{
      id:         _FNZ_EMPRESA_ID,
      nombre:     'SOGRUB — Mifel',
      saldo:      saldo,
      moneda:     'MXN',
      source:     'external',
      lastUpdate: new Date().toISOString(),
    }]
  };

  try {
    await _fnzFirestore.doc(_FNZ_DOC_PATH).set(payload, { merge: false });
    console.log(`[SyncFinanzas] Saldo Mifel sincronizado: $${saldo.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`);
  } catch (err) {
    console.warn('[SyncFinanzas] Error al escribir en fnz-psnal Firestore:', err.code ?? err.message);
    // No lanzar — no queremos que un error de sync detenga la app
  }
}
