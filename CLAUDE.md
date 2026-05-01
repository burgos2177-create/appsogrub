# appsogrub — Bitácora financiera (lado contador)

App web para el contador de SOGRUB. Sister apps: **app-estimaciones** (ingeniero de campo, en otro repo) y **app-materiales** (almacenista, `D:\apps-sogrub\app-materiales`). Las tres comparten Firebase RTDB en el proyecto `sogrub-suite`.

## Stack
- Vanilla JS (sin framework, sin bundler), HTML, CSS
- Firebase Realtime Database + Auth + Storage (compat SDK 9.x cargado por CDN)
- Cache-busting manual: `bash bump-cache.sh` antes de cada `git push` que toque `js/` (GitHub Pages cachea agresivo)

## Layout en RTDB

| Path | Quién escribe | Notas |
|---|---|---|
| `/legacy/bitacora/sogrub_*` | **Esta app** (autoritativo) | Datos contables: caja Mifel, ledger por proyecto, proveedores, fiscal config, etc. |
| `/legacy/estimaciones/users/*` | estimaciones | Solo lectura (auth + roles). |
| `/legacy/estimaciones/obras/*` | estimaciones | Solo lectura desde acá. |
| `/shared/catalogos/{obraId}/conceptos` | estimaciones | Solo lectura — usado para mapear `desglose_presupuesto`. |
| `/shared/buzon/{itemId}` | cualquier app | Bus de aprobación cross-app. |
| `/shared/obraLinks/{obraId}` | admin | Mapa `obraId → proyectoId` para resolver el proyecto contable a partir de la obra de campo. |
| `/shared/cajaChica/{obraId}/{meta,movimientos}` | **materiales** y **esta app** | Ledger de caja chica por obra (saldo conciliado vive aquí, no en el ledger del proyecto). |

## Buzón cross-app — máquina de estados B1-B8

Implementada en `js/views/buzon.js`. Estados:
```
recibido → en_revision → aprobado → cobrado / pagado / asentado → cerrado
                                  ↘ huerfano (movimiento contable borrado)
                                  ↗ (reabrir)
cualquier → rechazado
```

**Folios atómicos** vía transacción RTDB en `/legacy/bitacora/_counters/{cuentas_cobrar|cuentas_pagar}/{año}`:
- `CC-YYYY-NNN` — cuentas por cobrar (`pago_cliente`) **+ depósitos a caja chica** (egreso bancario al asentar transferencia).
- `CP-YYYY-NNN` — cuentas por pagar (`estimacion_subcontratista`) **+ gastos de caja chica**.

**Tipos de buzón soportados** (al 2026-05-01):
| `tipo` | Origen | Aprobar genera | Notas |
|---|---|---|---|
| `pago_cliente` | estimaciones | `sogrub_proy_movimientos` (abono cliente) | Folio CC. |
| `estimacion_subcontratista` | estimaciones | `sogrub_proy_movimientos` (gasto, categoria=Subcontratista) | Folio CP. Mapea desglose OPUS por `clave`. |
| `gasto_caja_chica` | materiales | `sogrub_proy_movimientos` (gasto, categoria='Caja chica') | Folio CP. Desglose OPUS por `conceptoKey` (ya viene resuelto). Status='Pagado' (la salida real ya pasó al pagar el ticket). |
| `deposito_caja_chica` | materiales o bitácora | `sogrub_movimientos` (egreso de Mifel) | Folio CC. Solo se publica si `metodoDeposito='transferencia'`; efectivo no genera movimiento contable. |

Ver `_aprobarItem`, `_aprobarGastoCajaChica`, `_aprobarDepositoCajaChica`, `_depositarCajaChicaDesdeBitacora` en `js/views/buzon.js`.

## Caja chica (módulo correlacionado con app-materiales)

Vive como sub-tab dentro del detalle de cada proyecto: **Movimientos · Presupuesto OPUS · Caja chica**. Implementado en `js/views/caja-chica.js`.

**Resolución obraId**: la vista recibe `proyectoId` (terminología contable) y resuelve el `obraId` (terminología de campo) por búsqueda inversa en `/shared/obraLinks`. Si no hay link, muestra estado vacío.

**Operaciones del contador**:
1. **Depositar** — desde aquí. Modal con monto, fecha, método (transferencia / efectivo), comentario.
   - Transferencia: escribe a `/shared/cajaChica/{obraId}/movimientos` + `sogrub_movimientos` (egreso Mifel, folio CC). Marca `asentadoAt` en el movimiento de caja chica.
   - Efectivo: solo el primer write (no afecta saldo Mifel ni saldo conciliado de caja chica — el dinero ya se retiró antes).
2. **Aprobar gasto reportado** — desde la fila. Reusa `_aprobarGastoCajaChica` del buzón (genera el contable + multi-path update a buzón + caja chica espejo).
3. **Rechazar / reabrir / borrar** — propaga a `/shared/buzon` y `/shared/cajaChica` simétricamente.

**Saldo**: replica idéntica de `computeSaldoCajaChica` del lado materiales. Reglas:
- Depósito transferencia → suma al saldo conciliado.
- Depósito efectivo → informativo, no afecta.
- Gasto aprobado → resta. Reportado/rechazado → no afectan saldo.

## Hook bidireccional `sogrub_proy_movimientos` ↔ buzón ↔ caja chica

En `js/firebase.js` (`_syncBuzonOnMovimientoUpdate` / `_syncBuzonOnMovimientoDelete` / `_syncCajaChicaMirrorOnUpdate` / `_syncCajaChicaMirrorOnDelete`):

- Cuando el contador **edita** un movimiento con `origen_buzon_id`, propaga monto/fecha al item del buzón. Si es de caja chica, también al espejo en `/shared/cajaChica`.
- Cuando el contador **borra** un movimiento con `origen_buzon_id`, marca el item del buzón como `huerfano`. Si era gasto de caja chica, además reabre el espejo a `estado='reportado'` (saldo en materiales recupera el monto). Si era depósito, marca `pendienteAsentar=true`.
- Tipos sincronizados: `abono_cliente`, `gasto`, `deposito_caja_chica`.

## Decisiones (2026-05-01, revisadas)

1. **Categoría: pre-clasificada por origen, no por caja chica.** Los `CATEGORIAS` quedan en `Material, Mano de Obra, Subcontratista, Indirecto` — no hay categoría "Caja chica". La categoría es para *qué se compró*, no *de dónde salió el dinero*. Las recepciones de caja chica que vienen de materiales son siempre compras de material (es lo que captura el almacenista), así que `_aprobarGastoCajaChica` crea el contable con `categoria='Material'` por default. Cuando se construya el módulo de **indirectos** en materiales, ese flujo enviará un `tipo` distinto al buzón con `categoria='Indirecto'` propia, evitando reclasificación manual. Marcador "vino de caja chica" para los hooks bidireccionales: presencia de `movimiento_caja_chica_id` en el contable, no la categoría.

2. **Modelo de tres cajas anidadas + regla anti-doble-conteo (CRÍTICA)**

   ```
   Mifel (banco) → Caja del proyecto (saldo virtual) → Caja chica (sub-fondo)
   ```

   El dinero baja **una sola vez**, al **depositar**. El gasto de caja chica registra el costo en bitácora pero **no descuenta saldos otra vez**. Cada movimiento mueve dinero entre dos cajas adyacentes:

   | Movimiento | Mifel | Caja proyecto | Caja chica |
   |---|---|---|---|
   | Transfer SOGRUB → proyecto | ↓ | ↑ | — |
   | Depósito a caja chica | ↓ | ↓ | ↑ |
   | **Gasto pagado con caja chica** | — | — | ↓ |
   | Gasto pagado del proyecto (directo) | ↓ | ↓ | — |

   **Implementación** (`js/calculations.js`):
   - `calcSaldoCajaProyecto`: resta gastos pagados (excluyendo `paga_de_caja_chica===true`) **y** `tipo='deposito_caja_chica'`.
   - `calcSaldoMifel`: excluye `paga_de_caja_chica===true` de gastosPagados.
   - El gasto con `paga_de_caja_chica:true` SÍ cuenta en utilidad, total gastado, IVA, fiscal y desglose por categoría/proveedor — solo NO descuenta de los saldos de Mifel y caja del proyecto.

   **Persistencia: todo se ve en bitácora.** Tanto el depósito (`tipo='deposito_caja_chica'`) como el gasto (`tipo='gasto', paga_de_caja_chica:true`) se crean en `sogrub_proy_movimientos`. Aparecen en la tabla de movimientos del proyecto. Badge `💰 caja chica` junto a la categoría de los gastos pagados con caja chica para que sea evidente que no descuentan saldo otra vez.

3. **Deuda Pendiente con desglose** (KPI del detalle):
   - **A proveedores**: gastos `tipo='gasto', status='Pendiente'` (lo de siempre).
   - **De caja chica**: derivado del saldo conciliado negativo de `/shared/cajaChica/{obraId}` (almacenista puso de su bolsillo). Carga async vía `_cargarDeudaCajaChica`. Cuando se reponga la caja con un depósito, baja a 0.
   - **Total**: suma de ambas. Se muestra grande arriba con el desglose abajo.

4. **Status de gastos caja chica = 'Pagado'**: el dinero ya salió de la caja física al pagar el ticket; no hay un segundo momento "pendiente de pago". El stepper del buzón refleja esto saltando de step 1 (Reportado) a step 3 (Asentado) cuando se aprueba.

5. **Folio CC para depósitos a caja chica**: convención del spec del lado materiales (CC = depósito, CP = gasto). En este repo CC históricamente significaba "Cuentas por Cobrar"; ahora también cubre "egresos a caja chica". El counter `cuentas_cobrar` lo emite indistintamente — diferenciable por `tipo` del movimiento.

6. **IVA en gastos de caja chica**: por default `incluye_iva=true` con subtotal/IVA derivados (importe / 1.16). La mayoría de tickets de caja chica traen IVA mexicano del 16% bruto. Si el contador necesita marcar uno como sin IVA, edita el movimiento contable después.

7. **Vista de caja chica como sub-tab del detalle**: no como ruta independiente. La nav del proyecto (Movimientos · Presupuesto OPUS · Caja chica) tiene la caja chica al mismo nivel que las demás secciones del proyecto. Es donde el contador la usa naturalmente.

## Heads-up para alinear el lado materiales

Comparado con `D:\apps-sogrub\app-materiales\CLAUDE.md` decisión #11:
- ✓ Saldo: misma fórmula `sum(depósitos transferencia) − sum(gastos aprobados)`, replicada idéntica en `js/views/caja-chica.js#_computeSaldoCajaChica`.
- ✓ Folios: CC para depósito, CP para gasto.
- ✓ Estados sincronizados: `reportado | aprobado | rechazado` (gastos). Bitácora puede reabrir → vuelve a `reportado` y materiales recalcula saldo.
- ✓ El contador puede depositar desde **ambas apps**. Materiales mantiene su `+ Depositar` por cortesía (admin). Lo natural es depositar desde acá.
- ✓ Campo `origen` en cada movimiento de caja chica: `'materiales'` o `'bitacora'`. Útil para audit.

Si en algún punto se cambia el modelo (cuenta separada por obra, IVA distinto, etc.), avisar a materiales para alinear.

## Estructura de archivos

```
index.html
css/styles.css
js/
  app.js                 # entry + nav (no router con :id, viewName-based)
  firebase.js            # init RTDB + auth + colección listeners + hooks bidireccionales
  storage.js             # stub
  calculations.js        # CATEGORIAS, calcSaldo*, ejecutarTransferenciaSOGRUB
  components.js          # modal, toast, badges, formatMXN
  drive.js, ocr.js, fiscal-*.js
  views/
    dashboard.js, caja.js, proyectos.js,
    detalle.js           # detalle del proyecto + sub-tabs (Movs · Presupuesto · Caja chica)
    presupuesto.js       # tab presupuesto OPUS
    caja-chica.js        # tab caja chica (NEW · 2026-05-01)
    proveedores.js, importar.js, analisis.js, fiscal.js,
    buzon.js             # bus de aprobación + funciones de aprobación caja chica
```

## Cómo arrancar

1. `python -m http.server 3001` (o `npx serve .`)
2. Abrir `http://localhost:3001/`
3. Login con cuenta de admin del proyecto `sogrub-suite`.

Antes de pushear cambios en `js/`: `bash bump-cache.sh` (bumpa el `?v=` en cada `<script src="js/...">` de `index.html`).

## Verificación end-to-end de caja chica

1. `cd D:\apps-sogrub\app-materiales && python serve.py 8081` — abrir `http://localhost:8081/`.
2. En materiales: Obra → Caja chica → `+ Depositar` (transferencia) $5000. Verificar que llegue al buzón aquí.
3. Aquí: aprobar el depósito → asienta egreso en Mifel + sincroniza materiales (saldo sigue en $5000, item ya aprobado).
4. En materiales: crear recepción tipo caja chica con $1500 y "Reportar a caja chica" → verificar item nuevo en buzón aquí + en sub-tab Caja chica del proyecto.
5. Aquí: aprobar el gasto desde la fila de la tabla → genera `sogrub_proy_movimientos` con `categoria='Caja chica'` y `desglose_presupuesto` mapeado, sincroniza materiales (saldo cae a $3500).
6. Borrar el `sogrub_proy_movimientos` recién creado → buzón se marca huerfano + espejo en `/shared/cajaChica` vuelve a `reportado` + saldo en materiales recupera los $1500.
