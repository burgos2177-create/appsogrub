import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { auth } from './firebase.js?v=20260904-0325';
import { rread } from './db.js?v=20260904-0325';

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

// Gate DURO a `role='admin'`, igual que la consola. El pipeline comercial es
// de dirección: montos de contrato, márgenes y motivos de pérdida de toda la
// empresa. Los ingenieros SÍ aparecen como responsables de seguimiento (se
// listan desde /legacy/estimaciones/users), pero no entran a la app.
export function tieneAccesoCRM(profile) {
  return profile?.role === 'admin';
}

export function esAdmin(profile) { return profile?.role === 'admin'; }
