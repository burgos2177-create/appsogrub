/* =====================================================
   SOGRUB Bitácora — Firebase Realtime Database
   Migrado a proyecto unificado sogrub-suite (2026-04-29).
   Datos de esta app viven bajo /legacy/bitacora/* en el RTDB compartido.
   Pares con app-estimaciones bajo /legacy/estimaciones/*.
   Plan futuro: /shared/* por entidad.
   ===================================================== */
'use strict';

// ---- Configuración Firebase: proyecto sogrub-suite ----
const firebaseConfig = {
  apiKey:            "AIzaSyBjOrl1JW4Y383diRe4WO4rX5IF23UEN0k",
  authDomain:        "sogrub-suite.firebaseapp.com",
  databaseURL:       "https://sogrub-suite-default-rtdb.firebaseio.com",
  projectId:         "sogrub-suite",
  storageBucket:     "sogrub-suite.firebasestorage.app",
  messagingSenderId: "330378687274",
  appId:             "1:330378687274:web:8be51640a6d9d7006ca453",
  measurementId:     "G-98BM4PNBPP"
};

// Base path donde vive todo el dato de esta app dentro del RTDB compartido.
const BITACORA_BASE = 'legacy/bitacora';

// ---- Inicializar app ----
const _fbApp  = firebase.initializeApp(firebaseConfig);
const _db     = firebase.database();
const _fbAuth = firebase.auth();

// _dbRef: prefija TODA path con BITACORA_BASE automáticamente.
// Excepciones (no se prefijan):
//   · paths que empiezan con '/' → se tratan como absolutos (escape para /shared/* o /legacy/estimaciones/*)
//   · '.info/*' → metadata del SDK, no es dato de app
function _dbRef(path) {
  if (typeof path !== 'string') return _db.ref(path);
  if (path.startsWith('.info/')) return _db.ref(path);
  if (path === '/') return _db.ref(BITACORA_BASE);
  if (path.startsWith('/')) return _db.ref(path.slice(1));
  return _db.ref(`${BITACORA_BASE}/${path}`);
}

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
  _dbRef(key).set(data).catch(err => {
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
  const previo = col[idx];
  col[idx] = { ...previo, ...updates };
  saveCollection(key, col);
  // Si este movimiento vino del buzón, sincronizar el item del buzón
  if (key === 'sogrub_proy_movimientos' && previo.origen_buzon_id) {
    _syncBuzonOnMovimientoUpdate(previo, col[idx]).catch(e => console.warn('[Buzón sync update]', e));
  }
  return col[idx];
}

/** Elimina un item por id */
function deleteItem(key, id) {
  const col      = Array.isArray(_cache[key]) ? [..._cache[key]] : [];
  const item     = col.find(x => x.id === id);
  const filtered = col.filter(x => x.id !== id);
  if (filtered.length === col.length) return false;
  saveCollection(key, filtered);
  // Si este movimiento vino del buzón, marcar el item del buzón como huérfano
  if (key === 'sogrub_proy_movimientos' && item?.origen_buzon_id) {
    _syncBuzonOnMovimientoDelete(item).catch(e => console.warn('[Buzón sync delete]', e));
  }
  return true;
}

// === Sincronización buzón ↔ movimiento contable ===
// Cuando el contador modifica/borra un movimiento que originalmente vino del
// buzón, los cambios se reflejan en el item del buzón para que la app de
// origen (estimaciones) vea el estado actualizado.

async function _syncBuzonOnMovimientoUpdate(previo, nuevo) {
  // Sincroniza para tipos que pueden venir del buzón: abono_cliente, gasto y
  // los dos tipos de caja chica.
  const tiposBuzon = ['abono_cliente', 'gasto', 'deposito_caja_chica'];
  if (!tiposBuzon.includes(nuevo.tipo)) return;
  const itemId = previo.origen_buzon_id;
  const cambios = {
    actualizadoPorContador: true,
    actualizadoAt: Date.now()
  };
  // Si cambió el monto, actualizar también el desglose. Para gastos el monto
  // se almacena negativo en bitácora; en el buzón siempre va positivo (el flag
  // del tipo dice si es entrada o salida de caja).
  if (nuevo.monto !== previo.monto || nuevo.monto_subtotal !== previo.monto_subtotal || nuevo.monto_iva !== previo.monto_iva) {
    const importeAbs = Math.abs(Number(nuevo.monto) || 0);
    // Items de caja chica usan monto plano; CxC/CxP usan { subtotal, iva, importe }.
    // El marcador "es de caja chica" es la presencia de movimiento_caja_chica_id,
    // no la categoria (los gastos vienen pre-categorizados como Material).
    if (nuevo.movimiento_caja_chica_id || nuevo.tipo === 'deposito_caja_chica') {
      cambios.monto = importeAbs;
    } else {
      cambios.monto = {
        subtotal: Math.abs(Number(nuevo.monto_subtotal) || 0),
        iva: Math.abs(Number(nuevo.monto_iva) || 0),
        importe: importeAbs
      };
    }
  }
  if (nuevo.fecha !== previo.fecha) {
    const [yy, mm, dd] = (nuevo.fecha || '').split('-').map(Number);
    if (yy && mm && dd) cambios.fecha = new Date(yy, mm - 1, dd).getTime();
  }
  await _dbRef(`/shared/buzon/${itemId}`).update(cambios);

  // Si el movimiento es de caja chica, además sincronizar el espejo en
  // /shared/cajaChica/{obraId}/movimientos/{movId} para que materiales lo vea.
  await _syncCajaChicaMirrorOnUpdate(previo, nuevo);
}

async function _syncBuzonOnMovimientoDelete(item) {
  const itemId = item.origen_buzon_id;
  await _dbRef(`/shared/buzon/${itemId}`).update({
    estado: 'huerfano',
    huerfanoAt: Date.now(),
    huerfanoPor: _currentUser?.uid || '',
    movId: null,
    descripcionHuerfano: 'El contador eliminó el movimiento contable. La app de origen puede regenerar este pago si fue por error.'
  });
  // Si era de caja chica, además reabrir el movimiento espejo a 'reportado'
  // para que el saldo en materiales recupere el monto.
  await _syncCajaChicaMirrorOnDelete(item);
}

// Espejo en /shared/cajaChica: cuando el contador edita un movimiento de
// caja chica, propaga monto/fecha al ledger compartido. (El estado se maneja
// desde el buzón al aprobar/rechazar, no desde aquí.)
async function _syncCajaChicaMirrorOnUpdate(previo, nuevo) {
  const obraId = nuevo.obraId || previo.obraId;
  const movCajaChicaId = nuevo.movimiento_caja_chica_id || previo.movimiento_caja_chica_id;
  if (!obraId || !movCajaChicaId) return;
  // Marcador "es de caja chica": movimiento_caja_chica_id presente. La
  // categoria del gasto contable es 'Material' (default) y no se usa para
  // identificar el origen, para no acoplar la sync a la taxonomía contable.
  const esCajaChica =
    (nuevo.tipo === 'gasto' && !!movCajaChicaId) ||
    nuevo.tipo === 'deposito_caja_chica';
  if (!esCajaChica) return;

  const patch = { actualizadoPorContador: true, actualizadoAt: Date.now() };
  if (nuevo.monto !== previo.monto) {
    patch.monto = Math.abs(Number(nuevo.monto) || 0);
  }
  if (nuevo.fecha !== previo.fecha) {
    const [yy, mm, dd] = (nuevo.fecha || '').split('-').map(Number);
    if (yy && mm && dd) patch.fecha = new Date(yy, mm - 1, dd).getTime();
  }
  if (Object.keys(patch).length > 2) {
    try {
      await _dbRef(`/shared/cajaChica/${obraId}/movimientos/${movCajaChicaId}`).update(patch);
    } catch (e) { console.warn('[CajaChica sync update]', e); }
  }
}

// Cuando el contador borra un movimiento de caja chica, reabrir el espejo:
//   - Gasto aprobado borrado → reportado (saldo en materiales recupera monto).
//   - Depósito borrado → marcar pendienteAsentar=true (informativo; el saldo
//     conciliado en materiales no cambia: el depósito sigue ahí).
async function _syncCajaChicaMirrorOnDelete(item) {
  const obraId = item.obraId;
  const movCajaChicaId = item.movimiento_caja_chica_id;
  if (!obraId || !movCajaChicaId) return;

  try {
    // Identificamos por presencia de movimiento_caja_chica_id, no por categoria.
    if (item.tipo === 'gasto' && !!item.movimiento_caja_chica_id) {
      await _dbRef(`/shared/cajaChica/${obraId}/movimientos/${movCajaChicaId}`).update({
        estado: 'reportado',
        aprobadoAt: null,
        aprobadoPor: null,
        actualizadoAt: Date.now(),
        notaContador: 'Movimiento contable eliminado por el contador — vuelve a estar pendiente de aprobación.'
      });
    } else if (item.tipo === 'deposito_caja_chica') {
      await _dbRef(`/shared/cajaChica/${obraId}/movimientos/${movCajaChicaId}`).update({
        pendienteAsentar: true,
        actualizadoAt: Date.now(),
        notaContador: 'El asentamiento bancario fue eliminado — pedir al contador re-asentar el depósito.'
      });
    }
  } catch (e) { console.warn('[CajaChica sync delete]', e); }
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
    _dbRef(key).on('value', snapshot => {
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
  const connRef = _dbRef('.info/connected');
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
    buzon:       () => renderBuzon(),
  };

  rerender[_activeView]?.();

  // Si cambiaron los movimientos contables y existe el reconciliador del
  // buzón, dispararlo: por si un movimiento ligado a un item aprobado fue
  // borrado/modificado desde otra ventana, o si el hook no alcanzó a actuar.
  if (changedKey === 'sogrub_proy_movimientos' && typeof _reconciliarBuzon === 'function') {
    _reconciliarBuzon().catch(e => console.warn('[Buzón reconcile from movs]', e));
  }

  // Sincronizar saldo Mifel a fnz-psnal cuando cambian datos que lo afectan
  const _MIFEL_KEYS = ['sogrub_movimientos', 'sogrub_proy_movimientos', 'sogrub_config'];
  if (_MIFEL_KEYS.includes(changedKey) && typeof scheduleSyncSaldoMifel === 'function') {
    scheduleSyncSaldoMifel();
  }
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
      _dbRef('sogrub_movimientos').get(),
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

  await _dbRef('/').update(updates);
  console.log('[Firebase] Migración completada.');
}

// =====================================================
// AUTH — requerido por las reglas de sogrub-suite
// El usuario debe loguearse con un email/password de Firebase Auth
// y tener role='admin' en /legacy/estimaciones/users/{uid}/role
// para poder leer/escribir esta base.
// =====================================================
let _currentUser = null;

async function _verifyAdminRole(uid) {
  // Lee /legacy/estimaciones/users/{uid}/role — leading slash = path absoluto
  const snap = await _dbRef(`/legacy/estimaciones/users/${uid}/role`).get();
  return snap.exists() && snap.val() === 'admin';
}

function _showLogin() {
  document.getElementById('app-loading').style.display = 'none';
  document.getElementById('app-login').style.display = '';
}
function _hideLogin() {
  document.getElementById('app-login').style.display = 'none';
  document.getElementById('app-loading').style.display = '';
}

function _bindLoginForm() {
  const form = document.getElementById('login-form');
  if (!form || form.dataset.bound) return;
  form.dataset.bound = '1';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('login-submit');
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-password').value;
    errEl.textContent = '';
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      await _fbAuth.signInWithEmailAndPassword(email, pass);
      // El listener onAuthStateChanged arranca el resto.
    } catch (err) {
      const m = err?.code || err?.message || '';
      let msg = 'No se pudo iniciar sesión';
      if (m.includes('invalid-credential') || m.includes('wrong-password') || m.includes('user-not-found')) msg = 'Credenciales incorrectas';
      else if (m.includes('too-many-requests')) msg = 'Demasiados intentos. Espera unos minutos.';
      else if (m.includes('network')) msg = 'Sin conexión a Firebase';
      else if (m.includes('unauthorized-domain')) msg = 'Dominio no autorizado en Firebase Auth';
      errEl.textContent = msg;
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });
}

function _showAccessDenied() {
  document.getElementById('app-login').style.display = '';
  const errEl = document.getElementById('login-error');
  if (errEl) errEl.textContent = 'Tu cuenta no tiene rol admin. Pídelo al administrador.';
  const btn = document.getElementById('login-submit');
  if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
  // Botón para cerrar sesión y reintentar
  if (!document.getElementById('login-signout-link')) {
    const a = document.createElement('a');
    a.id = 'login-signout-link';
    a.href = '#';
    a.textContent = 'Cerrar sesión';
    a.style.cssText = 'display:block;text-align:center;margin-top:8px;color:var(--text-muted);font-size:12px';
    a.onclick = (ev) => { ev.preventDefault(); _fbAuth.signOut(); };
    document.getElementById('login-form').appendChild(a);
  }
}

// =====================================================
// INICIALIZACIÓN — reemplaza initializeData()
// =====================================================
function initializeData() {
  _bindLoginForm();
  // Listener de auth — fuente única de verdad
  _fbAuth.onAuthStateChanged(async (user) => {
    if (!user) {
      _currentUser = null;
      _showLogin();
      return;
    }
    _currentUser = user;
    // Verificar role admin antes de proceder
    let isAdmin = false;
    try { isAdmin = await _verifyAdminRole(user.uid); }
    catch (err) { console.error('[Auth] Error verificando role:', err); }

    if (!isAdmin) {
      _showAccessDenied();
      return;
    }

    _hideLogin();
    try {
      _initConnectionStatus();
      _suscribirColecciones();
      // Suscribir buzón inmediatamente para que el badge cuente pendientes
      // sin tener que entrar a la vista. La vista renderBuzon también lo llama
      // pero es idempotente.
      if (typeof _suscribirBuzon === 'function') _suscribirBuzon();
    } catch (err) {
      console.error('[Firebase] Error de inicialización:', err);
      const msgEl = document.getElementById('loading-msg');
      if (msgEl) msgEl.textContent = 'Error — reintentando…';
      setTimeout(() => {
        try { _suscribirColecciones(); } catch {}
      }, 3000);
    }
  });
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
