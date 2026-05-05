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
      _renderSyncWidget();
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
  _renderSyncWidget();

  let saldo;
  try {
    // calcSaldoGlobal = Mifel + fondos_inversión (calculations.js)
    saldo = calcSaldoGlobal();
  } catch (e) {
    console.warn('[SyncFinanzas] calcSaldoGlobal error:', e);
    _syncState = 'error';
    _renderSyncWidget();
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

  _renderSyncWidget();
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
  _renderSyncWidget();
}

// =====================================================
// WIDGET UI — renderizado en el div #fnz-sync-widget
// =====================================================
function _renderSyncWidget() {
  const el = document.getElementById('fnz-sync-widget');
  if (!el) return;

  // ---- Sin sesión → botón "fnz" para conectar ----
  if (!_psnUser) {
    el.innerHTML = `
      <button id="fnz-login-btn" title="Conectar Finanzas Personales (fnz)"
        style="display:flex;align-items:center;gap:5px;background:none;
               border:1px solid var(--border);border-radius:20px;
               padding:4px 10px;cursor:pointer;color:var(--text-muted);
               font-size:12px;line-height:1;transition:all var(--transition)"
        onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'"
        onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-muted)'">
        ⇄ fnz
      </button>`;
    el.querySelector('#fnz-login-btn')?.addEventListener('click', _loginGoogle);
    return;
  }

  // ---- Con sesión → indicador + sync manual + logout ----
  const stateIcon  = { ok: '✓', syncing: '⟳', error: '⚠', idle: '·' }[_syncState] ?? '·';
  const stateColor = { ok: '#2dbd7a', syncing: 'var(--accent)', error: '#e15555', idle: 'var(--text-muted)' }[_syncState];
  const timeStr    = _lastSync
    ? _lastSync.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    : '–';
  const tooltip = _psnUser.email
    + (_lastSync ? `\nÚltimo sync: ${timeStr}` : '\nSin sync aún');

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:4px" title="${tooltip}">
      <span style="display:flex;align-items:center;gap:4px;font-size:12px;
                   border:1px solid var(--border);border-radius:20px;
                   padding:4px 8px;line-height:1;color:${stateColor}">
        <span style="font-weight:700">${stateIcon}</span>
        <span style="color:var(--text-muted)">fnz</span>
        ${_lastSync ? `<span style="color:var(--text-muted);font-size:11px">${timeStr}</span>` : ''}
      </span>
      <button id="fnz-sync-now" title="Sync manual"
        style="background:none;border:none;cursor:pointer;color:var(--text-muted);
               font-size:13px;padding:2px 3px;line-height:1"
        onmouseover="this.style.color='var(--accent)'"
        onmouseout="this.style.color='var(--text-muted)'">⟳</button>
      <button id="fnz-logout" title="Desconectar fnz"
        style="background:none;border:none;cursor:pointer;color:var(--text-muted);
               font-size:11px;padding:2px 3px;line-height:1"
        onmouseover="this.style.color='#e15555'"
        onmouseout="this.style.color='var(--text-muted)'">✕</button>
    </div>`;

  el.querySelector('#fnz-sync-now')?.addEventListener('click', syncSaldo);
  el.querySelector('#fnz-logout')?.addEventListener('click', _logoutPsn);
}

// =====================================================
// BOOT — llamado desde _initApp() en app.js
// =====================================================
function initSyncFinanzas() {
  _initPsnApp();
  _renderSyncWidget(); // render inicial antes de que auth responda
}
