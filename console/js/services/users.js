import { rread, rset, rupdate } from './db.js?v=1';
import { firebaseConfig } from './firebase.js?v=1';

// ============================================================================
// Gestión del pool único de usuarios en /legacy/estimaciones/users. El perfil
// (con `role`) es la segunda capa de acceso: sin él, un usuario de Firebase
// Auth se autentica pero lo rebota "Sin acceso" en todas las apps.
//
// Roles y a qué apps dan acceso:
//   admin       → todo (estimaciones, bitácora, compras, consola)
//   ingeniero   → estimaciones (solo sus obrasAsignadas)
//   comprador   → compras
//   almacenista → materiales / compras
// (Bitácora y la consola exigen role='admin' — gate duro.)
// ============================================================================

export const ROLES = ['admin', 'ingeniero', 'comprador', 'almacenista'];

export async function listUsers() {
  const node = await rread('/legacy/estimaciones/users');
  return Object.entries(node || {}).map(([uid, u]) => ({ uid, ...(u || {}) }));
}

export async function listObras() {
  const node = await rread('/legacy/estimaciones/obras');
  return Object.entries(node || {})
    .map(([obraId, o]) => ({ obraId, nombre: (o && o.meta && o.meta.nombre) || obraId }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export function setUserRole(uid, role) {
  return rupdate(`/legacy/estimaciones/users/${uid}`, { role });
}

// Crea/repara el perfil de un usuario de Auth ya existente (caso: se creó en la
// consola de Firebase o falló un alta previo). No toca la contraseña.
export function upsertProfile(uid, { email, displayName, role }) {
  return rupdate(`/legacy/estimaciones/users/${uid}`, {
    email: email || null,
    displayName: displayName || email || null,
    role,
    createdAt: Date.now()
  });
}

export function setObraAsignada(uid, obraId, assigned) {
  return rset(`/legacy/estimaciones/users/${uid}/obrasAsignadas/${obraId}`, assigned ? true : null);
}

// Alta de usuario NUEVO: crea la credencial en Firebase Auth vía REST signUp
// (returnSecureToken:false para no cambiar la sesión del admin) y luego escribe
// el perfil. Mismo patrón que app-compras/js/services/auth.js#createUser.
const REST = 'https://identitytoolkit.googleapis.com/v1/accounts';
export async function createUser({ email, password, displayName, role }) {
  const r = await fetch(`${REST}:signUp?key=${firebaseConfig.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: false })
  });
  const data = await r.json();
  if (!r.ok) {
    const code = data?.error?.message || 'Error creando usuario';
    if (code === 'EMAIL_EXISTS') throw new Error('Ese correo ya existe en Authentication. Usa "Reparar perfil" con su UID en vez de crearlo de nuevo.');
    throw new Error(code);
  }
  const uid = data.localId;
  await upsertProfile(uid, { email, displayName, role });
  return { uid, email, displayName, role };
}
