// Firebase config — proyecto unificado sogrub-suite.
// Esta consola es una app de ADMINISTRACIÓN: casi todo lo que lee/escribe son
// paths absolutos (/shared/*, /legacy/bitacora/*, /legacy/estimaciones/*), a los
// que se llega con "/" inicial (ver _resolve en services/db.js). El APP_BASE_PATH
// sólo aloja metadatos propios de la consola (p.ej. marca de última corrida de
// diagnóstico) bajo /shared/console/*.

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

export const APP_BASE_PATH = "shared/console";
