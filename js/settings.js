/* =====================================================
   SOGRUB Bitácora — Modal de configuración
   Conexiones (Firebase principal + fnz-psnal),
   apps relacionadas, sesión.
   ===================================================== */
'use strict';

const _SISTER_APPS_KEY = 'sogrub_sister_app_urls';
const _SISTER_APPS_DEFAULTS = {
  estimaciones: '',
  materiales:   '',
  fnzPsnal:     'https://fnz-psnal.web.app',
};

function _getSisterApps() {
  try {
    return { ..._SISTER_APPS_DEFAULTS, ...JSON.parse(localStorage.getItem(_SISTER_APPS_KEY) || '{}') };
  } catch (_) { return { ..._SISTER_APPS_DEFAULTS }; }
}
function _saveSisterApps(obj) {
  localStorage.setItem(_SISTER_APPS_KEY, JSON.stringify(obj));
}

// Helpers de estilo reutilizables
const _SS = {
  section:  'background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:12px',
  h:        'font-size:13px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:.5px;margin:0',
  row:      'display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px',
  label:    'color:var(--text-muted);font-size:12px',
  val:      'color:var(--text);font-family:ui-monospace,monospace;font-size:12px',
  btn:      'background:var(--accent);color:#08121a;border:none;border-radius:6px;padding:6px 12px;font-weight:600;cursor:pointer;font-size:12px',
  btnGhost: 'background:none;border:1px solid var(--border);border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;color:var(--text-muted)',
  btnDanger:'background:none;border:1px solid #e15555;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;color:#e15555',
  input:    'flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-size:12px',
};

function openSettingsModal() {
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:18px';

  body.appendChild(_buildSogrubSection());
  body.appendChild(_buildFnzSection());
  body.appendChild(_buildSisterAppsSection());
  body.appendChild(_buildAboutSection());

  openModal({
    title: '⚙ Configuración',
    body,
    confirmText: 'Listo',
    cancelText:  'Cerrar',
    onConfirm:   () => closeModal(),
    large:       true,
  });

  // Renderizar la sección fnz (sync-finanzas.js inyecta el contenido)
  if (typeof _renderFnzSection === 'function') _renderFnzSection();
}

// =====================================================
// SECCIÓN 1 — Firebase principal (sogrub-suite)
// =====================================================
function _buildSogrubSection() {
  const sec = document.createElement('div');
  sec.style.cssText = _SS.section;

  const user = (typeof _currentUser !== 'undefined' ? _currentUser : null);
  const online = (typeof _fbOnline !== 'undefined' && _fbOnline);
  const dot = online ? '#2dbd7a' : '#e15555';

  sec.innerHTML = `
    <h4 style="${_SS.h}">Firebase principal · sogrub-suite</h4>
    <div style="${_SS.row}">
      <span style="${_SS.label}">Estado</span>
      <span style="${_SS.val};display:flex;align-items:center;gap:6px">
        <span style="width:8px;height:8px;border-radius:50%;background:${dot}"></span>
        ${online ? 'En línea' : 'Sin conexión'}
      </span>
    </div>
    <div style="${_SS.row}">
      <span style="${_SS.label}">Cuenta admin</span>
      <span style="${_SS.val}">${user?.email ?? '—'}</span>
    </div>
    <div style="${_SS.row}">
      <span style="${_SS.label}">Proyecto / DB</span>
      <span style="${_SS.val}">sogrub-suite (RTDB)</span>
    </div>
    <div style="${_SS.row}">
      <span style="${_SS.label}">Path bitácora</span>
      <span style="${_SS.val}">/legacy/bitacora/*</span>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
      <button id="ss-signout" style="${_SS.btnDanger}">Cerrar sesión admin</button>
    </div>
  `;
  sec.querySelector('#ss-signout').addEventListener('click', async () => {
    if (!confirm('¿Cerrar sesión de la bitácora?')) return;
    try { await _fbAuth.signOut(); closeModal(); } catch (e) { showToast('Error al cerrar sesión', 'error'); }
  });
  return sec;
}

// =====================================================
// SECCIÓN 2 — fnz-psnal (sync saldo)
// El contenido lo renderiza sync-finanzas.js (_renderFnzSection)
// =====================================================
function _buildFnzSection() {
  const sec = document.createElement('div');
  sec.id = 'settings-fnz-section';
  sec.style.cssText = _SS.section;
  // Placeholder mientras sync-finanzas.js no inyecta contenido
  sec.innerHTML = `<h4 style="${_SS.h}">Bitácora Personal · fnz-psnal</h4>
    <div style="${_SS.label}">Cargando…</div>`;
  return sec;
}

// =====================================================
// SECCIÓN 3 — Apps hermanas (links configurables)
// =====================================================
function _buildSisterAppsSection() {
  const sec = document.createElement('div');
  sec.style.cssText = _SS.section;
  const urls = _getSisterApps();

  const apps = [
    { key: 'estimaciones', nombre: 'app-estimaciones', desc: 'Ingeniero de campo · estimaciones, presupuestos OPUS' },
    { key: 'materiales',   nombre: 'app-materiales',   desc: 'Almacenista · recepciones y caja chica' },
    { key: 'fnzPsnal',     nombre: 'fnz-psnal',        desc: 'Finanzas personales · destino del sync' },
  ];

  sec.innerHTML = `<h4 style="${_SS.h}">Apps relacionadas</h4>`;
  apps.forEach(({ key, nombre, desc }) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--border);padding-top:10px';
    row.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:13px;font-weight:600">${nombre}</span>
        <span style="${_SS.label}">${desc}</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="url" placeholder="https://…" data-key="${key}" value="${urls[key] || ''}" style="${_SS.input}"/>
        <button data-open="${key}" style="${_SS.btnGhost}" ${!urls[key] ? 'disabled' : ''}>Abrir</button>
      </div>
    `;
    sec.appendChild(row);
  });

  // Guardado en blur o cambio
  sec.querySelectorAll('input[data-key]').forEach(input => {
    input.addEventListener('change', () => {
      const cur = _getSisterApps();
      cur[input.dataset.key] = input.value.trim();
      _saveSisterApps(cur);
      const btn = sec.querySelector(`button[data-open="${input.dataset.key}"]`);
      if (btn) btn.disabled = !input.value.trim();
    });
  });
  sec.querySelectorAll('button[data-open]').forEach(btn => {
    btn.addEventListener('click', () => {
      const u = _getSisterApps()[btn.dataset.open];
      if (u) window.open(u, '_blank', 'noopener');
    });
  });
  return sec;
}

// =====================================================
// SECCIÓN 4 — Acerca de
// =====================================================
function _buildAboutSection() {
  const sec = document.createElement('div');
  sec.style.cssText = _SS.section;

  // Extraer la versión del cache-buster del primer script local
  let cacheVer = '—';
  try {
    const sample = document.querySelector('script[src^="js/app.js"]')?.getAttribute('src') || '';
    const m = sample.match(/v=([\w-]+)/);
    if (m) cacheVer = m[1];
  } catch (_) {}

  sec.innerHTML = `
    <h4 style="${_SS.h}">Acerca de</h4>
    <div style="${_SS.row}">
      <span style="${_SS.label}">Cache version</span>
      <span style="${_SS.val}">${cacheVer}</span>
    </div>
    <div style="${_SS.row}">
      <span style="${_SS.label}">Origen</span>
      <span style="${_SS.val}">${location.hostname || 'localhost'}</span>
    </div>
    <div style="${_SS.row}">
      <span style="${_SS.label}">SDK Firebase</span>
      <span style="${_SS.val}">9.22.2 (compat)</span>
    </div>
  `;
  return sec;
}
