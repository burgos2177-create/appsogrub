/* =====================================================
   SOGRUB Bitácora — Sync saldo global → fnz-psnal
   Google Sign-In + Firestore read-modify-write upsert

   NOTA: Para que funcione en producción, agrega el dominio
   en Firebase Console → fnz-psnal → Authentication →
   Settings → Authorized domains (localhost, GitHub Pages, etc.)
   ===================================================== */
'use strict';

// ---- Empresa a registrar en fnz-psnal ----
const _PSN_EMPRESA_ID     = 'sogrub';
const _PSN_EMPRESA_NOMBRE = 'SOGRUB';

// ---- Configuración Firebase fnz-psnal ----
const _PSN_CONFIG = {
  apiKey:            'AIzaSyD4AguJyQYpv49hrO84RtK3kv5kf93FtjE',
  authDomain:        'fnz-psnal.firebaseapp.com',
  databaseURL:       'https://fnz-psnal-default-rtdb.firebaseio.com',
  projectId:         'fnz-psnal',
  storageBucket:     'fnz-psnal.firebasestorage.app',
  messagingSenderId: '570838574175',
  appId:             '1:570838574175:web:f9194df1b31f21e3c6e7ea',
};

// ---- Runtime state ----
let _psnApp    = null;
let _psnAuth   = null;
let _psnDb     = null;
let _psnUser   = null;      // Firebase User | null
let _syncTimer = null;
let _lastSync  = null;      // Date | null
let _syncState = 'idle';    // 'idle' | 'syncing' | 'ok' | 'error'

// =====================================================
// INICIALIZAR app secundaria 'personal'
// =====================================================
function _initPsnApp() {
  if (_psnApp) return;
  try {
    // Reusar si ya se inicializó (p.ej. hot-reload)
    try   { _psnApp = firebase.app('personal'); }
    catch (_) { _psnApp = firebase.initializeApp(_PSN_CONFIG, 'personal'); }

    _psnAuth = _psnApp.auth();
    _psnDb   = _psnApp.firestore();

    // Persistencia de sesión — Firebase la maneja en localStorage
    _psnAuth.onAuthStateChanged(user => {
      _psnUser = user;
      _renderFnzSection();
      if (user) syncSaldo(); // sync inmediato al detectar sesión
    });
  } catch (err) {
    console.error('[SyncFinanzas] Error init app:', err);
  }
}

// =====================================================
// SYNC — read-modify-write con upsert sobre el array
// CRÍTICO: nunca hacer set({list:[entry]}) — borra las
// demás empresas del documento.
// =====================================================
async function syncSaldo() {
  if (!_psnUser || !_psnDb) return;

  _syncState = 'syncing';
  _renderFnzSection();

  let saldo;
  try {
    // calcSaldoGlobal = Mifel + fondos_inversión (calculations.js)
    saldo = calcSaldoGlobal();
  } catch (e) {
    console.warn('[SyncFinanzas] calcSaldoGlobal error:', e);
    _syncState = 'error';
    _renderFnzSection();
    return;
  }

  const entry = {
    id:         _PSN_EMPRESA_ID,
    nombre:     _PSN_EMPRESA_NOMBRE,
    saldo:      Number(saldo.toFixed(2)),
    moneda:     'MXN',
    source:     'external',
    lastUpdate: new Date().toISOString(),
  };

  try {
    const ref = _psnDb
      .collection('usuarios').doc(_psnUser.uid)
      .collection('global').doc('empresas');

    // Leer → upsert → escribir
    const snap = await ref.get();
    const data = snap.exists ? (snap.data() || {}) : {};
    const list = Array.isArray(data.list) ? [...data.list] : [];

    const idx = list.findIndex(e => e && e.id === entry.id);
    if (idx >= 0) list[idx] = entry; else list.push(entry);

    await ref.set({ ...data, list }, { merge: true });

    _lastSync  = new Date();
    _syncState = 'ok';
    console.log(
      `[SyncFinanzas] ✓ $${saldo.toLocaleString('es-MX', { minimumFractionDigits: 2 })} → fnz-psnal`
    );
  } catch (err) {
    _syncState = 'error';
    const code = err?.code ?? err?.message ?? String(err);
    console.warn('[SyncFinanzas] Error write:', code);

    if (code.includes('permission-denied')) {
      showToast('fnz: permiso denegado — inicia sesión con la cuenta dueña de la bitácora personal', 'error', 7000);
    } else if (code.includes('unavailable')) {
      showToast('fnz: sin conexión — se reintentará en el próximo cambio', 'warning', 4000);
    }
  }

  _renderFnzSection();
}

// =====================================================
// SCHEDULE SYNC — debounce 1s para agrupar ráfagas
// Llamado desde firebase.js en _onRemoteChange
// =====================================================
function scheduleSync() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncSaldo, 1000);
}

// Alias para el hook existente en firebase.js
function scheduleSyncSaldoMifel() { scheduleSync(); }

// =====================================================
// GOOGLE SIGN-IN / SIGN-OUT
// =====================================================
async function _loginGoogle() {
  if (!_psnAuth) return;
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    await _psnAuth.signInWithPopup(provider);
    // onAuthStateChanged dispara syncSaldo() automáticamente
  } catch (err) {
    const code = err?.code ?? '';
    if (code === 'auth/unauthorized-domain') {
      showToast(
        'Agrega este dominio en Firebase Console → fnz-psnal → Auth → Authorized domains',
        'error', 9000
      );
    } else if (code !== 'auth/popup-closed-by-user') {
      showToast(`fnz login error: ${code || err.message}`, 'error', 6000);
    }
  }
}

async function _logoutPsn() {
  try { await _psnAuth?.signOut(); } catch (_) {}
  _psnUser  = null;
  _syncState = 'idle';
  _lastSync  = null;
  _renderFnzSection();
}

// =====================================================
// FNZ SECTION — renderizada dentro del modal de configuración
// (#settings-fnz-section). Si el modal está cerrado, no-op.
// =====================================================
function _renderFnzSection() {
  const sec = document.getElementById('settings-fnz-section');
  if (!sec) return;

  const H = 'font-size:13px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:.5px;margin:0';
  const ROW = 'display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px';
  const LBL = 'color:var(--text-muted);font-size:12px';
  const VAL = 'color:var(--text);font-family:ui-monospace,monospace;font-size:12px';
  const BTN = 'background:var(--accent);color:#08121a;border:none;border-radius:6px;padding:6px 12px;font-weight:600;cursor:pointer;font-size:12px';
  const BTN_GHOST  = 'background:none;border:1px solid var(--border);border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;color:var(--text-muted)';
  const BTN_DANGER = 'background:none;border:1px solid #e15555;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;color:#e15555';

  // Saldo actual a sincronizar (preview)
  let saldoPreview = '—';
  try { saldoPreview = '$' + calcSaldoGlobal().toLocaleString('es-MX', { minimumFractionDigits: 2 }); }
  catch (_) {}

  // ---- Sin sesión ----
  if (!_psnUser) {
    sec.innerHTML = `
      <h4 style="${H}">Bitácora Personal · fnz-psnal</h4>
      <div style="${ROW}">
        <span style="${LBL}">Estado</span>
        <span style="${VAL};color:var(--text-muted)">Sin conexión</span>
      </div>
      <div style="${ROW}">
        <span style="${LBL}">Saldo a sincronizar</span>
        <span style="${VAL}">${saldoPreview} (${_PSN_EMPRESA_NOMBRE})</span>
      </div>
      <p style="font-size:12px;color:var(--text-muted);margin:0;line-height:1.5">
        Inicia sesión con la cuenta Google dueña de la bitácora personal para
        empezar a publicar el saldo de SOGRUB en vivo.
      </p>
      <div style="display:flex;justify-content:flex-end">
        <button id="fnz-login-btn" style="${BTN}">Iniciar sesión con Google</button>
      </div>
    `;
    sec.querySelector('#fnz-login-btn')?.addEventListener('click', _loginGoogle);
    return;
  }

  // ---- Con sesión ----
  const icon  = { ok: '✓', syncing: '⟳', error: '⚠', idle: '·' }[_syncState] ?? '·';
  const color = { ok: '#2dbd7a', syncing: 'var(--accent)', error: '#e15555', idle: 'var(--text-muted)' }[_syncState];
  const stateLabel = { ok: 'Sincronizado', syncing: 'Sincronizando…', error: 'Error de sync', idle: 'Listo' }[_syncState];
  const timeStr = _lastSync
    ? _lastSync.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium' })
    : 'Nunca';

  sec.innerHTML = `
    <h4 style="${H}">Bitácora Personal · fnz-psnal</h4>
    <div style="${ROW}">
      <span style="${LBL}">Estado</span>
      <span style="${VAL};color:${color};display:flex;align-items:center;gap:6px">
        <span style="font-weight:700">${icon}</span> ${stateLabel}
      </span>
    </div>
    <div style="${ROW}">
      <span style="${LBL}">Cuenta Google</span>
      <span style="${VAL}">${_psnUser.email}</span>
    </div>
    <div style="${ROW}">
      <span style="${LBL}">Empresa publicada</span>
      <span style="${VAL}">${_PSN_EMPRESA_NOMBRE} (id: ${_PSN_EMPRESA_ID})</span>
    </div>
    <div style="${ROW}">
      <span style="${LBL}">Saldo actual</span>
      <span style="${VAL}">${saldoPreview}</span>
    </div>
    <div style="${ROW}">
      <span style="${LBL}">Último sync</span>
      <span style="${VAL}">${timeStr}</span>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
      <button id="fnz-sync-now" style="${BTN_GHOST}">⟳ Sincronizar ahora</button>
      <button id="fnz-logout" style="${BTN_DANGER}">Desconectar</button>
    </div>
  `;
  sec.querySelector('#fnz-sync-now')?.addEventListener('click', syncSaldo);
  sec.querySelector('#fnz-logout')?.addEventListener('click', _logoutPsn);
}

// =====================================================
// BOOT — llamado desde _initApp() en app.js
// =====================================================
function initSyncFinanzas() {
  _initPsnApp();
  _renderFnzSection(); // render inicial antes de que auth responda
}
