/* =====================================================
   SOGRUB — Google Drive Integration
   Sube facturas PDF a carpetas por proyecto en Drive
   ===================================================== */
'use strict';

const DRIVE_CLIENT_ID        = '1058194321879-dv2ptsmgio75cpom21v0js21blk9mtnh.apps.googleusercontent.com';
const DRIVE_SCOPE            = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_ROOT_FOLDER_NAME = 'SOGRUB Facturas';

const _LS_TOKEN  = 'sogrub_drive_token';
const _LS_EXPIRY = 'sogrub_drive_expiry';

let _tokenClient = null;
let _accessToken = null;
let _tokenExpiry = 0;

// ---- Restaurar token desde localStorage al cargar ----
(function _restoreToken() {
  const t = localStorage.getItem(_LS_TOKEN);
  const e = parseInt(localStorage.getItem(_LS_EXPIRY) ?? '0', 10);
  if (t && Date.now() < e) {
    _accessToken = t;
    _tokenExpiry = e;
  }
})();

// ---- Persistir token ----
function _saveToken(token, expiresIn) {
  _accessToken = token;
  _tokenExpiry = Date.now() + (expiresIn - 60) * 1000;
  localStorage.setItem(_LS_TOKEN,  _accessToken);
  localStorage.setItem(_LS_EXPIRY, String(_tokenExpiry));
}

// ---- Inicialización lazy ----
function _initTokenClient() {
  if (_tokenClient) return;
  if (!window.google?.accounts?.oauth2) return;
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: DRIVE_CLIENT_ID,
    scope:     DRIVE_SCOPE,
    callback:  () => {},   // se sobreescribe por solicitud
  });
}

// ---- Obtener token válido (pide login solo si expiró) ----
function driveGetToken() {
  _initTokenClient();
  return new Promise((resolve, reject) => {
    if (!_tokenClient) {
      reject(new Error('Google Identity Services no está disponible'));
      return;
    }

    // Token en memoria o restaurado de localStorage todavía válido
    if (_accessToken && Date.now() < _tokenExpiry) {
      resolve(_accessToken);
      return;
    }

    _tokenClient.callback = (resp) => {
      if (resp.error) { reject(new Error(resp.error_description ?? resp.error)); return; }
      _saveToken(resp.access_token, resp.expires_in);
      resolve(_accessToken);
    };

    // prompt:'' intenta renovar silenciosamente si la sesión Google sigue activa
    _tokenClient.requestAccessToken({ prompt: '' });
  });
}

// ---- Helpers internos ----
async function _apiFetch(url, options = {}) {
  const token = await driveGetToken();
  const resp  = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Drive API ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function _findFolder(name, parentId) {
  const q = `name='${name.replace(/'/g,"\\'")}' and mimeType='application/vnd.google-apps.folder'${parentId ? ` and '${parentId}' in parents` : ''} and trashed=false`;
  const data = await _apiFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`
  );
  return data.files?.[0]?.id ?? null;
}

async function _createFolder(name, parentId) {
  const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) meta.parents = [parentId];
  return _apiFetch('https://www.googleapis.com/drive/v3/files', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(meta),
  });
}

// ---- Carpeta raíz "SOGRUB Facturas" ----
async function _getRootFolderId() {
  const cfg = getConfig();
  if (cfg.drive_root_folder_id) return cfg.drive_root_folder_id;

  let id = await _findFolder(DRIVE_ROOT_FOLDER_NAME, null);
  if (!id) {
    const folder = await _createFolder(DRIVE_ROOT_FOLDER_NAME, null);
    id = folder.id;
  }

  const c = getConfig();
  c.drive_root_folder_id = id;
  saveConfig(c);
  return id;
}

// ---- Carpeta del proyecto (crea si no existe) ----
async function _getProjectFolderId(proyectoId) {
  const proyecto = getItem(KEYS.PROYECTOS, proyectoId);
  if (!proyecto) throw new Error('Proyecto no encontrado');

  if (proyecto.drive_folder_id) return proyecto.drive_folder_id;

  const rootId = await _getRootFolderId();
  let folderId = await _findFolder(proyecto.nombre, rootId);
  if (!folderId) {
    const folder = await _createFolder(proyecto.nombre, rootId);
    folderId = folder.id;
  }

  updateItem(KEYS.PROYECTOS, proyectoId, { drive_folder_id: folderId });
  return folderId;
}

// =====================================================
// API PÚBLICA
// =====================================================

// ---- Sanitizar nombre para usarlo en Drive ----
function _sanitizeName(str) {
  return (str ?? 'sin-concepto')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 80) || 'factura';
}

// ---- Subir un archivo a una carpeta de Drive ----
async function _uploadFile(file, fileName, folderId) {
  const token = await driveGetToken();
  const meta  = JSON.stringify({ name: fileName, parents: [folderId] });
  const form  = new FormData();
  form.append('metadata', new Blob([meta], { type: 'application/json' }));
  form.append('file', file);

  const resp = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}` },
      body:    form,
    }
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Drive upload ${resp.status}: ${text}`);
  }
  return resp.json();  // { id, webViewLink }
}

// ---- Sobreescribir un archivo existente en Drive (PATCH) ----
async function _patchFile(file, fileId) {
  const token = await driveGetToken();
  const form  = new FormData();
  form.append('metadata', new Blob(['{}'], { type: 'application/json' }));
  form.append('file', file);

  const resp = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,webViewLink`,
    {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body:    form,
    }
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Drive patch ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ---- Sobreescribe si hay ID previo, si no sube nuevo ----
async function _overwriteOrUpload(file, fileName, folderId, existingId) {
  if (existingId) {
    try {
      return await _patchFile(file, existingId);
    } catch (err) {
      // El archivo fue borrado de Drive — crear uno nuevo
      console.warn('[Drive] Archivo previo no encontrado, creando nuevo:', err.message);
    }
  }
  return await _uploadFile(file, fileName, folderId);
}

/**
 * Sube PDF y/o XML a la subcarpeta del gasto en Drive.
 *
 * files = { pdf: File|null, xml: File|null }
 * existing = { pdfId, xmlId, folderId } — IDs previos para sobreescribir
 *
 * Estructura:
 *   SOGRUB Facturas/{proyecto}/{fecha} - {concepto}/
 *     {concepto}.pdf
 *     {nombre-original}.xml
 *
 * Retorna { folderId, folderUrl, pdf?: {id,webViewLink}, xml?: {id,webViewLink} }
 */
async function driveUploadFactura(files, proyectoId, { concepto = '', fecha = '', existing = {} } = {}) {
  const proyFolderId = await _getProjectFolderId(proyectoId);

  const safeName    = _sanitizeName(concepto);
  const folderLabel = fecha ? `${fecha} - ${safeName}` : safeName;

  // Reusar carpeta existente o crear nueva
  const subfolderId = existing.folderId
    ?? (await _createFolder(folderLabel, proyFolderId)).id;

  const result = {
    folderId:  subfolderId,
    folderUrl: `https://drive.google.com/drive/folders/${subfolderId}`,
  };

  if (files.pdf) {
    result.pdf = await _overwriteOrUpload(files.pdf, `${safeName}.pdf`, subfolderId, existing.pdfId ?? null);
  }
  if (files.xml) {
    result.xml = await _overwriteOrUpload(files.xml, files.xml.name, subfolderId, existing.xmlId ?? null);
  }

  return result;
}

/** Comprueba si la librería GIS ya está cargada */
function driveAvailable() {
  return !!window.google?.accounts?.oauth2;
}
