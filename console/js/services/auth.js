import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js';
import { auth } from './firebase.js?v=1';
import { rread } from './db.js?v=1';

// Pool único de usuarios en /legacy/estimaciones/users (fuente compartida por
// toda la suite). La consola no crea usuarios; sólo autentica y lee el perfil
// para verificar rol admin.

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}
export function logout() { return signOut(auth); }
export function onAuth(cb) { return onAuthStateChanged(auth, cb); }

export async function getUserProfile(uid) {
  return await rread(`/legacy/estimaciones/users/${uid}`);
}
