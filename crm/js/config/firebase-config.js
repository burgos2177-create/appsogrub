// Firebase config — proyecto unificado sogrub-suite (mismo que las demás apps).
// El CRM escribe SOLO bajo /shared/crm/* (APP_BASE_PATH). Los escapes a paths
// absolutos (/legacy/estimaciones/users, /legacy/bitacora/sogrub_proyectos)
// se piden con "/" inicial, ver _resolve en services/db.js.

export const firebaseConfig = {
  apiKey: "AIzaSyBjOrl1JW4Y383diRe4WO4rX5IF23UEN0k",
  authDomain: "sogrub-suite.firebaseapp.com",
  databaseURL: "https://sogrub-suite-default-rtdb.firebaseio.com",
  projectId: "sogrub-suite",
  storageBucket: "sogrub-suite.firebasestorage.app",
  messagingSenderId: "330378687274",
  appId: "1:330378687274:web:8be51640a6d9d7006ca453",
  measurementId: "G-98BM4PNBPP"
};

export const APP_BASE_PATH = "shared/crm";

// Sello de versión visible en la barra (convención de app-indirectos):
// si no cambia tras un deploy, es caché del navegador.
export const APP_VERSION = '2026.09.04.1';
