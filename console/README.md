# Consola central · SOGRUB Suite

App de **administración** del ecosistema `sogrub-suite`. No es de uso operativo como las demás (estimaciones, bitácora, compras, materiales, indirectos): sirve para **verlas todas desde un solo lugar**, verificar que estén sanamente interconectadas, arreglar cosas estructurales, y gestionar qué obras/proyectos aparecen en los dashboards — sin tener que entrar al directorio de cada app y editar el RTDB a mano.

Vive dentro de `appsogrub` porque es la app autoritativa de `/shared` y `/legacy/bitacora`, pero es una **página independiente** con su propio stack (Firebase v10 modular, ES-modules), separada del appsogrub raíz (que usa compat 9.x).

## Módulos

| Ruta | Módulo | Qué hace |
|---|---|---|
| `#/` | **Mapa del ecosistema** | Conteos y "último escrito" por nodo `/shared` y `/legacy`, estado de las 6 apps (incluido el CRM), actividad del buzón en vivo, banner de salud. |
| `#/salud` | **Diagnóstico de salud** | Corre 13 invariantes de interconexión cross-app y ofrece arreglos guiados (con confirmación). |
| `#/obralinks` | **Editor de obraLinks** | Crear/reparar el mapa `obraId → proyectoId` (`/shared/obraLinks`). |
| `#/obras` | **Obras activas** | Togglear el `estado` del proyecto (controla visibilidad en dashboards), vista unificada campo↔contable + saldo de caja chica. |

## Las 13 invariantes (`js/services/checks.js`)

1. `obraLinks` inválido — valor no-string o `proyectoId` inexistente en `sogrub_proyectos`.
2. Item de buzón **sin ruta** — tiene `obraId` pero no `proyectoId` ni entrada en `obraLinks`.
3. `origen_buzon_id` **colgante** — movimiento que referencia un item de buzón inexistente.
4. Item `aprobado/cobrado/pagado` con `movId` borrado → debería estar `huerfano`.
5. Huérfano **mal formado** — `estado='huerfano'` pero con `movId` o sin `huerfanoAt`.
6. Espejo de **caja chica** faltante o desalineado (`movimiento_caja_chica_id` sin par en `/shared/cajaChica`).
7. Espejo de **OC** — OC `aprobada/pagada` sin `buzonId`, o `buzonId` colgante.
8. **Folios** — duplicados por año, o `_counters` por debajo del máximo emitido.
9. **Caja chica en negativo** — saldo conciliado < 0 (el almacenista adelantó dinero).
10. **`proyectoId` duplicado** en `obraLinks` — rompe el reverse-lookup de caja chica.
11. **Trabajo rezagado** — proyecto `pausa/terminado` con buzón accionable o caja chica negativa.
12. **CRM · proyecto colgante** — oportunidad con `proyectoId` que ya no existe en `sogrub_proyectos`.
13. **CRM · ganada sin proyecto** — oportunidad `ganada` que todavía no se convirtió en proyecto contable (warn tras 7 días).

La lógica pura de invariantes vive en `js/services/checks.js` + `js/services/data-pure.js` (sin dependencias de Firebase → testeable con datos sintéticos).

## Alcance de escritura

Diagnóstico + **arreglos guiados**: cada escritura (crear/quitar obraLink, marcar/normalizar huérfano, cambiar estado de proyecto) pasa por un modal que describe el nodo exacto afectado antes de aplicar. Nada destructivo ni masivo. Ver `js/services/fixes.js`.

## Acceso

Pool único de usuarios en `/legacy/estimaciones/users`. **Gate duro a `role='admin'`** — sin perfil o rol distinto, "Sin acceso".

## Cómo arrancar

```bash
cd appsogrub/console
python -m http.server 3009
```
Abrir `http://localhost:3009/` y entrar con una cuenta admin de `sogrub-suite`. En producción se sirve como su propia ruta de GitHub Pages: `…github.io/appsogrub/console/`.

## Estructura

```
console/
  index.html · css/main.css
  js/
    main.js                      # rutas + gate a role=admin
    config/firebase-config.js    # APP_BASE_PATH="shared/console"; escapes con "/" a paths absolutos
    services/
      firebase.js · db.js · auth.js
      data-pure.js               # normalización + buildCtx (PURO, sin Firebase)
      data.js                    # loadEcosystem (lecturas agregadas cross-app)
      checks.js                  # 11 invariantes → findings (PURO)
      fixes.js                   # capa de escritura (arreglos guiados)
    state/{store,router}.js · util/{dom,format}.js
    views/{shell,login,mapa,salud,obralinks,obras,_ui}.js
```

## Notas

- Cache-busting propio (`?v=Date.now()` en el import de entrada); `bump-cache.sh` de appsogrub **no** aplica aquí.
- No toca compras, estimaciones ni el CRM; sólo lee/repara `/shared/*` y `/legacy/bitacora/*`. De `/shared/crm` únicamente **lee** las oportunidades (para el mapa y las dos invariantes).
