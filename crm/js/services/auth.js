import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { auth } from './firebase.js?v=20260904-0310';
import { rread } from './db.js?v=20260904-0310';

// Pool único de usuarios de la suite en /legacy/estimaciones/users. El CRM no
// crea usuarios (eso es de la consola); sólo autentica y lee el perfil.

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}
export function logout() { return signOut(auth); }
export function onAuth(cb) { return onAuthStateChanged(auth, cb); }

export async function getUserProfile(uid) {
  return await rread(`/legacy/estimaciones/users/${uid}`);
}

// Quién entra al CRM: admin (dirección) e ingeniero (hace levantamientos y
// arma el presupuesto en OPUS). Cualquier otro rol entra si el admin le pone
// `crm: true` en su perfil desde la consola — no hace falta un rol nuevo.
export function tieneAccesoCRM(profile) {
  if (!profile) return false;
  return profile.role === 'admin' || profile.role === 'ingeniero' || profile.crm === true;
}

// Sólo admin puede borrar oportunidades y cambiar la configuración.
export function esAdmin(profile) { return profile?.role === 'admin'; }
