# SOGRUB Bitácora Financiera

Sistema de gestión financiera para **SOGRUB Grupo Constructor**.
Vanilla JS + CSS · Firebase Realtime Database · Sin frameworks.

## Tecnologías

- HTML5 / CSS3 / JavaScript ES6+ (sin frameworks)
- [Firebase Realtime Database](https://firebase.google.com/) — sincronización en tiempo real
- Google Fonts (Inter)

## Estructura

```
appsogrub/
├── index.html
├── css/
│   └── styles.css
└── js/
    ├── firebase.js        ← conexión Firebase + CRUD
    ├── storage.js         ← stub (delegado a firebase.js)
    ├── calculations.js    ← reglas de negocio
    ├── components.js      ← modal, toasts, helpers UI
    ├── app.js             ← navegación + arranque
    └── views/
        ├── dashboard.js
        ├── caja.js
        ├── proyectos.js
        ├── detalle.js
        └── importar.js
```

## Correr localmente

```bash
npx serve . --listen 3000
# → http://localhost:3000
```

O con Python:

```bash
python -m http.server 3001
# → http://localhost:3001
```

## Vistas

| Vista | Descripción |
|---|---|
| Dashboard | KPIs, fondos de inversión, resumen proyectos activos |
| Caja SOGRUB | Movimientos generales, transferencias a proyectos |
| Proyectos | Grid de cards, detalle por proyecto |
| Importar | Wizard CSV para carga masiva de datos históricos |

## Reglas de negocio principales

1. **Saldo Mifel** = saldo_inicial − suma movimientos pagados
2. **Saldo Global** = Saldo Mifel + fondos de inversión
3. **Disponible real** = Saldo Mifel − comprometido en proyectos activos
4. **Transferencia SOGRUB→Proyecto** genera doble registro automático
