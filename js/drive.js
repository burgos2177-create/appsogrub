/* =====================================================
   SOGRUB — Google Drive Integration
   Sube facturas PDF a carpetas por proyecto en Drive
   ===================================================== */
'use strict';

const DRIVE_CLIENT_ID        = '1058194321879-dv2ptsmgio75cpom21v0js21blk9mtnh.apps.googleusercontent.com';
const DRIVE_SCOPE            = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_ROOT_FOLDER_NAME = 'SOGRUB Facturas';

let _tokenClient = null;
let _accessToken = null;
let _tokenExpiry = 0;

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

// ---- Obtener token válido (pide login si es necesario) ----
function driveGetToken() {
  _initTokenClient();
  return new Promise((resolve, reject) => {
    if (!_tokenClient) {
      reject(new Error('Google Identity Services no está disponible'));
      return;
    }

    if (_accessToken && Date.now() < _tokenExpiry) {
      resolve(_accessToken);
      return;
    }

    _tokenClient.callback = (resp) => {
      if (resp.error) { reject(new Error(resp.error_description ?? resp.error)); return; }
      _accessToken = resp.access_token;
      _tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
      resolve(_accessToken);
    };

    // Si ya tuvimos token antes, renovar silenciosamente; si no, pedir consent
    _tokenClient.requestAccessToken({ prompt: _accessToken ? '' : 'select_account' });
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

/**
 * Sube PDF y/o XML a la subcarpeta del gasto en Drive.
 *
 * files = { pdf: File|null, xml: File|null }
 *
 * Estructura:
 *   SOGRUB Facturas/{proyecto}/{fecha} - {concepto}/
 *     {concepto}.pdf
 *     {concepto}.xml
 *
 * Retorna { folderId, folderUrl, pdf?: {id,webViewLink}, xml?: {id,webViewLink} }
 */
async function driveUploadFactura(files, proyectoId, { concepto = '', fecha = '' } = {}) {
  const proyFolderId = await _getProjectFolderId(proyectoId);

  const safeName    = _sanitizeName(concepto);
  const folderLabel = fecha ? `${fecha} - ${safeName}` : safeName;
  const subfolder   = await _createFolder(folderLabel, proyFolderId);
  const subfolderId = subfolder.id;

  const result = {
    folderId:  subfolderId,
    folderUrl: `https://drive.google.com/drive/folders/${subfolderId}`,
  };

  if (files.pdf) {
    result.pdf = await _uploadFile(files.pdf, `${safeName}.pdf`, subfolderId);
  }
  if (files.xml) {
    result.xml = await _uploadFile(files.xml, `${safeName}.xml`, subfolderId);
  }

  return result;
}

/** Comprueba si la librería GIS ya está cargada */
function driveAvailable() {
  return !!window.google?.accounts?.oauth2;
}
