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
| `/shared/avanceObra/{obraId}` | estimaciones | Solo lectura. Avance ejecutado a precio de catálogo — habilita la utilidad realizada (ver abajo). |
| `/shared/contratos/{obraId}` | estimaciones | Solo lectura. Contrato vigente con órdenes de cambio aplicadas (ver abajo). |
| `/legacy/bitacora/sogrub_retenciones` | **Esta app** | Fondos de garantía retenidos a subs. NO son movimientos de caja (ver abajo). |
| `/shared/cajaChica/{obraId}/{meta,movimientos}` | **materiales** y **esta app** | Ledger de caja chica por obra (saldo conciliado vive aquí, no en el ledger del proyecto). |
| `/shared/crm/*` | **CRM** (`crm/`, sólo admin) | Pipeline comercial previo a la obra. La consola sólo lo lee. |

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
| `oc_materiales` | compras | `sogrub_proy_movimientos` (gasto, categoria='Material') | Folio CP. Desglose OPUS por `conceptoKey`. Espejo en `/shared/compras/oc`. |
| `gasto_indirecto` | indirectos | obra → `sogrub_proy_movimientos` (gasto, categoria='Indirecto'); **empresa** (`empresa:true`/sin obra) → egreso directo de Mifel (`sogrub_movimientos`) | Folio CP. Proveedor y desglose OPUS **opcionales** (`conceptoKey`); `monto={subtotal,iva,importe}`. Resuelve obra→proyecto vía `obraLinks`. Prorrateo = N items (uno por obra). Ver `_aprobarGastoIndirecto`. |
| `nomina_*` (`nomina_operativo_semana`, `nomina_tecnico_campo_quincena`, `nomina_tecnico_oficina_quincena`, `nomina_directivo_quincena`) | indirectos | 1 egreso Mifel (`sogrub_movimientos`, neto total) **+** N `sogrub_proy_movimientos` por `prorrateoPorObra` con `no_afecta_mifel:true` | Folio CP. `netoSinObra` queda sólo en el egreso de empresa. Categoría por `tipoPersonal`: operativo/técnico-campo→'Mano de Obra', oficina/directivo→'Indirecto'. Anti-doble-conteo: `calcSaldoMifel` excluye `no_afecta_mifel` (el neto ya bajó Mifel una vez), pero SÍ baja la caja de cada proyecto. Ver `_aprobarNomina`. |

**Forma de pago — de qué caja sale el dinero.** Todo contable que nace del buzón hereda
`metodo_pago` vía `_metodoPagoDeItem(item)` (lee `formaPago` / `metodoPago` / `metodo` /
`forma_pago`, normaliza `Efectivo|SPEI|Cheque|…`). No es cosmético: `calcSaldoMifel` lee
`metodo_pago ?? 'transferencia'`, así que **un contable sin el campo se descuenta de Mifel**
aunque se haya pagado con billetes, y el arqueo de efectivo termina sobrando ese monto. El
modal de pago (`_modalDatosPago`, tanto en aprobar+pagar como en `_marcarPagadoCobrado`) lo
escribe para todos los tipos, no sólo `gasto_oc`. `credito` y `caja_chica` **no** son cajas:
devuelven `undefined` a propósito y los resuelve quien llama (status Pendiente /
`paga_de_caja_chica`). En la tabla del proyecto la pastilla lleva `?` cuando el campo falta,
para distinguir "fue transferencia" de "nadie lo dijo".

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
4. **⇄ Cambio / devolución** (solo fondo efectivo, 2026-08-02) — el almacenista entrega el efectivo que custodia y se le repone con otros billetes. Un modal con dos montos (entrego / recibo) que dispara `_devolverCajaChicaEfectivoDesdeBitacora` y/o `_depositarCajaChicaDesdeBitacora`. La devolución es el **inverso exacto** del depósito: caja física SOGRUB ↑, caja del proyecto ↑, fondo ↓ (folio CC). A la par, el neto es cero en todas las cajas y ambos arqueos siguen cuadrando. En `/shared/cajaChica` viaja como `tipo:'gasto', estado:'aprobado', esDevolucion:true` — **no un tipo nuevo**, para que la fórmula de saldo replicada en las otras 3 apps la reste sin cambios; el contable es `tipo:'devolucion_caja_chica'` (monto positivo) en `sogrub_efectivo_movimientos` + `sogrub_proy_movimientos`. Deshacer = 🗑 en la fila (borra ambos contables).

**Saldo**: replica idéntica de `computeSaldoCajaChica` del lado materiales. Reglas:
- Depósito transferencia con `estado='aprobado'` (o sin estado, legacy) → suma al saldo conciliado. `solicitado`/`rechazado` no cuentan (2026-07-25: unificado con materiales; bitácora ahora sella `estado:'aprobado'` en el espejo al aprobar un depósito y `'solicitado'` al reabrirlo).
- Depósito efectivo (sin `fondo`) → informativo, no afecta.
- Gasto aprobado → resta. Reportado/rechazado → no afectan saldo. Las devoluciones (`esDevolucion:true`) son gastos aprobados para efectos del saldo, pero se contabilizan aparte (`totalDevuelto`) para no inflar "total gastado" — no son un costo.
- Paridad verificada entre las 4 apps (bitácora, materiales, indirectos, consola) — misma fórmula por fondo.

**Dos fondos por obra (2026-07-25)**: cada movimiento de `/shared/cajaChica` pertenece a un fondo — `fondo` ausente = **transferencia** (histórico, intacto) o `fondo:'efectivo'` = **fondo de efectivo** (nuevo). Cada fondo lleva su propio saldo conciliado (`_computeSaldoCajaChica(movs, fondo)`); la vista tiene pills 🏦/💵 para cambiar de fondo. El fondo efectivo replica la máquina de estados completa pero al asentar mueve dinero desde la **caja física de SOGRUB** (`sogrub_efectivo_movimientos`, la del arqueo) en vez de Mifel: depósito = caja física ↓ + caja proyecto ↓ + fondo ↑ (folio CC); gasto aprobado = contable `paga_de_caja_chica:true, fondo_caja:'efectivo'` (folio CP, no vuelve a descontar saldos). El depósito "efectivo" sin `fondo` sigue siendo informativo (legacy, no confundir). Los items de buzón `gasto_caja_chica`/`deposito_caja_chica`/`gasto_oc` llevan `fondo:'efectivo'` cuando pertenecen al fondo; a diferencia del efectivo informativo, el **depósito del fondo efectivo SÍ pasa por el buzón y SÍ se asienta**. Contrato para las apps de campo: `docs/spec-caja-chica-fondo-efectivo.md`.

## Efectivo (caja física SOGRUB) ↔ fondos de efectivo en obra

`js/views/efectivo.js` concilia la caja física de SOGRUB por denominación. Desde
2026-07-25 muestra también el otro lado del fondo efectivo de caja chica:

- **KPI "🏗️ Fondos en obra"** — Σ saldos de los fondos efectivo por obra, más el
  *efectivo total de la empresa* (caja SOGRUB + obra) en el subtítulo.
- **Tarjeta "Fondos de efectivo en obra"** — una fila por obra con fondo efectivo
  (saldo, arqueo declarado, diferencia, pendiente de aprobación) y botón 🧮 para
  capturar el arqueo que reportó el almacenista. Se guarda en
  `/shared/cajaChica/{obraId}/meta.arqueoEfectivo` (path compartido, las apps de
  campo pueden leerlo). Lee `/shared/cajaChica` + `/shared/obraLinks` con listener
  propio; el cache vive en `calculations.js` (`setFondosEfectivoObra`).
- **Conciliación consolidada** en el arqueo: `(arqueo SOGRUB + arqueo declarado en
  obra) − (saldo SOGRUB + saldo de esos fondos)`. Solo entran las obras **con**
  arqueo declarado; las demás se listan aparte con su monto, para no aparentar que
  cuadran sin haberlas contado.

**No hay doble conteo**: `calcSaldoEfectivo()` ya está neto de los fondos (el
depósito al fondo efectivo asienta su egreso en `sogrub_efectivo_movimientos`), así
que el arqueo de arriba sigue conciliando exactamente igual que antes. El gasto
pagado con caja chica (`paga_de_caja_chica:true`) tampoco vuelve a descontar.
`calcSaldoGlobal` se deja **sin cambio**: igual que el fondo transferencia, la caja
chica no suma al saldo global una vez depositada.

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

## Utilidad realizada vs flotante — la obra leída como un trade (2026-08-04)

**El problema que resuelve:** bitácora sola no puede calcular utilidad. Lo único que tiene es
`cobrado − gastado`, que es **flujo de caja**: el anticipo del cliente lo infla porque es dinero
recibido por obra que todavía no se ejecuta. En Cimentación Ocaso ese número daba $271,146 (42.3%)
cuando la utilidad realmente ganada era $5,741 (1.5%).

El dato que faltaba lo publica **app-estimaciones** en `/shared/avanceObra/{obraId}`:
`ejecutadoCatalogoSubtotal` = valor de **venta** de la obra ya ejecutada, a precio de catálogo y
sin IVA. Se lee vía búsqueda inversa en `/shared/obraLinks` (`cargarAvanceObra` en
`js/calculations.js`, cache en `_avanceObraCache`). Si el nodo no existe, la lectura sale
"pendiente" en vez de inventar un número.

**Fórmulas** (`calcLecturaTrade`, todo SIN IVA — el IVA es pass-through, no utilidad):

```
V_ejec      = ejecutadoCatalogoSubtotal        C_incurrido = gastado (pagado)
V_contrato  = contrato VIGENTE sin IVA         C_presup    = (directo + ind. oficina + ind. campo) VIGENTES

Utilidad esperada (target)  = V_contrato − C_presup
PnL realizado (ya ganado)   = V_ejec − C_incurrido
PnL flotante (por ganar)    = Utilidad esperada − PnL realizado
Margen realizado %          = PnL realizado / V_ejec          ← el margen honesto a la fecha
Efectivo flotante cliente   = netoCobrado − V_ejec            ← en caja pero aún no es tuyo
```

Invariante: `PnL realizado + PnL flotante = Utilidad esperada`. Se muestra como línea de
verificación en la tarjeta.

**Los dos lados van vigentes (2026-08-13).** `V_contrato` sale de
`calcContratoVigenteSubtotal` (nodo de OC → `avanceObra` → original + `rubrosAcum.venta`) y
`C_presup` de `calcPresupuestoCostoTotal`, que suma `rubrosAcum` de los tres rubros de costo.
Mezclarlos —venta vigente contra costo original— hacía que **toda** una OC deductiva se leyera
como utilidad perdida: se quitaba obra del contrato pero el costo de esa obra seguía
presupuestado. Sólo la parte de la OC que no es costo mueve la utilidad esperada; la tarjeta
lo desglosa en `t.oc` (venta / costo / neto).

**Dónde se ve:**
- Detalle → KPI 📈 Utilidad: *Realizada* (V_ejec − gastado), *Esperada* (obra completa) y
  *Flujo de caja* etiquetado explícitamente como "cobrado − gastado", ya no como utilidad.
- Detalle → tab 📊 Análisis: tarjeta **📉 Lectura como trade** con PnL realizado, margen
  realizado, PnL flotante, utilidad esperada y efectivo flotante del cliente.
- La curva de acumulados trae una tercera línea, *Ejecutado a catálogo*: la brecha contra
  gastado es el PnL realizado; la brecha contra cobrado es el anticipo aún no ganado.

**Caveat de costos:** el realizado asume que lo gastado corresponde a lo ejecutado. Material
comprado para obra futura lo hunde temporalmente (es inventario) y se recupera al instalarlo; el
flotante lo absorbe, así que la utilidad esperada no se mueve. Va como nota al pie en la tarjeta.

`updatedAt` del nodo se muestra como "hace X" — el dato se refresca cuando el ingeniero abre el
RESUMEN en estimaciones, así que puede venir viejo.

**Historial por estimación (2026-08-08).** El nodo trae además
`historial/{estimacionId} = { numero, estado:'cerrada'|'abierta', fechaCierre, periodoDesde,
periodoHasta, ejecutadoCatalogoSubtotal (ACUMULADO sin IVA), ejecutadoPeriodoSubtotal, avancePct,
updatedAt }`. Con eso la curva de *Ejecutado a catálogo* deja de ser una recta y se dibuja
escalonada de verdad — un escalón por estimación semanal, y la pendiente entre escalones es el
ritmo al que se realiza la utilidad.

- `_normalizarHistorialAvance` ordena por `numero` y cae a `fechaCierre` si empatan.
- Las `estado:'abierta'` se **excluyen** de la curva y del realizado: no son valor cerrado. Si
  existe una, la tarjeta lo dice para que nadie la busque en la gráfica.
- `avanceEjecutadoEnFecha` da el acumulado vigente en una fecha (el valor se mantiene hasta el
  siguiente cierre); antes del primer cierre devuelve `null` para que la línea no arranque en cero.
- `avanceValidacionRaiz` compara el último cierre contra el campo raíz —deben coincidir por
  definición— y avisa en la tarjeta si no amarran.
- **No se cachea la serie**: la llave es el id de estimación y al reabrir o corregir una se
  reescriben esos puntos, así que `cargarAvanceObra` relee el nodo en cada apertura del proyecto.
- Fallback para obras sin `historial`: bitácora guarda una foto diaria del acumulado en
  `/legacy/bitacora/sogrub_avance_historial/{proyectoId}/{fecha}`. En cuanto la obra tiene
  historial publicado deja de escribirlas y usa el de estimaciones.

## Órdenes de cambio — contrato vigente (2026-08-12)

Estimaciones es el **único escritor**; bitácora solo lee `/shared/contratos/{obraId}` (vía búsqueda
inversa en `obraLinks`). El nodo trae el contrato formal vigente, el original, el acumulado de OC
y `rubrosAcum` con el movimiento por rubro.

**La regla que no se puede romper:** `rubrosAcum` es **estado acumulado, no evento**. El vigente
siempre se **recalcula** como `original + rubrosAcum` — `calcBolsitasProyecto` parte de
`calcDesgloseContrato` fresco en cada llamada y suma el acumulado, nunca sobre el valor ya
ajustado. Sumarlo incrementalmente duplicaría el ajuste.

**Tampoco se usa `impactoRubros` del buzón para mover el presupuesto**: ese es el delta de UNA OC y
sirve solo para pintar la tarjeta. Si se sumara además de `rubrosAcum`, se contaría doble.

- Signos: `rubrosAcum` viene con signo y solo se suma (nada de `Math.abs`). `aditivasAcum` y
  `deductivasAcum` son magnitudes positivas; el signo vive en el neto.
- IVA: `rubrosAcum` y `netoAcum` son **sin IVA**; para montos con IVA se usa `netoAcumCIVA` o
  `contrato.total`, nunca recalculando el 16% acá.
- Mapeo de rubros: `indOficina`/`indCampo` van 1:1 a las dos bolsitas de bitácora (no se fusionan);
  `cargos + otro` → `otros`; `venta` → contrato sin IVA.
- Sin nodo = obra que nunca entró al módulo de OC: se usa el presupuesto original y no se muestra
  nada de OC. La ausencia no es error.
- `validarContratoOC` chequea los tres invariantes (`rubrosAcum.venta = netoAcum`,
  `contrato.total = original + netoAcumCIVA`, `subtotal + iva = total`). Si alguno falla se **avisa
  en la cinta de OC y no se ajusta nada**: es bug del publicador.

**Buzón `orden_cambio`**: informativo. `_aprobarOrdenCambio` cierra el item y relee
`/shared/contratos` — **no genera movimiento contable**, porque una OC mueve el presupuesto y no la
caja; el dinero llega después vía `pago_cliente`.

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

## Consola central de la suite (`console/`)

Sub-app **independiente** de administración del ecosistema (no del uso operativo del contador). Vive en `console/` con su propio stack: **Firebase v10 modular + ES-modules** (a diferencia del appsogrub raíz, que usa compat 9.x no-modular). Es una página aparte — no comparte código con la app raíz — y se sirve como su propia ruta de GitHub Pages (`…/appsogrub/console/`). Gate duro a `role='admin'`.

Para qué sirve: ver las 6 apps desde un solo lugar, verificar interconexión sana, y reparar cosas estructurales sin entrar al directorio de cada app.

Módulos: **Mapa del ecosistema** · **Diagnóstico de salud** (13 invariantes cross-app en `console/js/services/checks.js`, las dos últimas del CRM) · **Editor de obraLinks** · **Obras activas** (togglea `sogrub_proyectos[].estado`, que controla la visibilidad en dashboards). Alcance de escritura: diagnóstico + arreglos guiados con confirmación (`console/js/services/fixes.js`) — nada destructivo ni masivo.

La lógica de invariantes es pura y testeable (`console/js/services/checks.js` + `data-pure.js`, sin Firebase). Cache-busting propio: `bump-cache.sh` **no** aplica a `console/`. Detalle completo en `console/README.md`.

## CRM comercial (`crm/`) — pipeline de leads a obra (2026-09-04)

Sub-app **independiente** (mismo patrón que `console/`: Firebase v10 modular + ES-modules, página
aparte servida en `…/appsogrub/crm/`). Lleva el pipeline comercial **antes** de que exista la obra:
Lead → Contacto → Visita/levantamiento → Presupuesto (OPUS) → Propuesta enviada → Negociación →
Ganada / Perdida / Declinada / Pospuesta. Datos bajo `/shared/crm/*` (oportunidades, actividades,
clientes, config, `_counters` para el folio `OP-AAAA-NNN`). **Gate duro a `role='admin'`**, igual que
la consola — el pipeline trae montos de contrato, márgenes y motivos de pérdida de toda la empresa;
los ingenieros sólo aparecen como responsables asignables. Reglas de RTDB en
`docs/rules-rtdb-crm.md` (fragmento para pegar dentro de las vigentes, nunca solo).

- **El presupuesto usa la misma cascada que "Nuevo proyecto"** (`crm/js/services/pipeline.js#calcCascada`
  ≡ `calcDesgloseContrato`): al ganar, el admin crea el proyecto en `sogrub_proyectos` desde la ficha
  con `costo_directo_base`, los cuatro `sobrecosto_*` y `presupuesto_contrato` sin IVA, más
  `origen_crm_id` / `origen_crm_folio` como rastro. Se escribe con **transacción** sobre el arreglo
  (bitácora lo `set`ea completo; los listeners lo recogen al instante) y es idempotente por
  `origen_crm_id`. La obra de estimaciones se crea como siempre y se liga en consola → obraLinks.
- No publica nada al buzón: una oportunidad no mueve dinero. El dinero llega después vía `pago_cliente`.
- **La consola lo ve y entra**: `console/js/services/data.js` lee `/shared/crm` y el mapa trae tarjeta
  de app y nodo (abiertas / ganadas / perdidas / clientes). Dos invariantes nuevas en `checks.js`:
  oportunidad con `proyectoId` colgante (error) y `ganada` sin proyecto creado (warn tras 7 días).
  Para entrar: botón `🤝 CRM ↗` en la topbar (todas las vistas) y la tarjeta del mapa, ambos a
  `../crm/` — ruta relativa, resuelve en Pages y sirviendo la raíz del repo, no `console/` sola.
- Cache-busting propio: `bash crm/bump-cache.sh` antes de pushear cambios en `crm/js` o `crm/css`.
  El `bump-cache.sh` de la raíz **no** lo cubre. La consola tampoco tiene script: al tocar
  `console/js`, subir a mano el `?v=` de los imports del módulo cambiado. Detalle en cada README.

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

## Pagos parciales — una obligación, N exhibiciones (2026-08-24)

Un gasto puede liquidarse en varias exhibiciones (anticipo 60% + liquidación contra
entrega). La obligación es **una**: un movimiento, una factura, un desglose OPUS. Lo que
se parte es el pago.

```
m.pagos = [{ id, fecha, monto, metodo_pago, referencia, nota }]
```

Helpers en `js/calculations.js`: `aplicacionesPago(m)` (la primitiva — todo lo demás
deriva de ella), `montoPagadoDe`, `saldoPendienteDe`, `sobrepagoDe`, `statusPagoDe`
(`Pendiente|Parcial|Pagado`), `fraccionPagadaDe`, `costoPagadoSinIVA`.

- **Compatibilidad total**: un movimiento SIN `pagos[]` rinde una aplicación implícita por
  el total si `status='Pagado'`, y ninguna si está `'Pendiente'`. Todo lo histórico calcula
  idéntico. No hay migración.
- **`status` se sigue escribiendo** (`'Pagado'` cuando ya no queda saldo, si no
  `'Pendiente'`) para no romper el buzón, los hooks ni las otras apps. Pero quien necesite
  **dinero real** usa las funciones de arriba, NUNCA `status` — un parcial lleva
  `status='Pendiente'` con dinero ya salido.
- **Cada exhibición trae su propia caja**: el anticipo por transferencia y la liquidación en
  efectivo es un caso normal. `calcSaldoMifel` y `calcSaldoEfectivo` iteran
  `aplicacionesPago`, no movimientos.
- **Costo prorrateado**: las bolsitas y `calcTotalGastadoPagado` usan `costoPagadoSinIVA` =
  subtotal × fracción liquidada. Un gasto al 60% aporta el 60% del costo.
- **Comprometido**: `calcBolsitasProyecto` devuelve además `comprometido` / `pctComp` /
  `overflowComp` por bolsa — lo devengado sin pagar. Se pinta rayado encima de la barra para
  que un sobregiro ya firmado no aparezca hasta que se liquide.
- **Conciliación**: `_concLedgerApp` emite una línea **por exhibición**, no por movimiento.
  Al banco llegan pagos sueltos; emparejar contra el total nunca encontraría ninguno.
- **Deuda pendiente** = Σ `saldoPendienteDe`, no monto completo.

UI: botón 💵 en cada fila de gasto → modal de pagos (barra de avance, alta/baja de
exhibiciones, "Liquidar el saldo"). En el buzón, "Marcar Pagado" de una CxP pregunta el
monto: si es menor al saldo, agrega la exhibición y el item **no** pasa a `pagado` — sigue
siendo cuenta por pagar viva, y el espejo de la OC en `/shared/compras` no se cierra.


## Retenciones a subcontratistas — fondo de garantía (2026-08-25)

Al pagarle una estimación a un sub se le puede retener una parte (garantía por vicios
ocultos, 5-10%) y liberarla meses después. Estimaciones manda **dos** items al buzón.

**LA REGLA, y no admite matices:**

```
esGasto === false  →  NO se genera movimiento de efectivo. Retener no es gastar.
esGasto === true   →  Sí sale. Gasto normal, con la FECHA DEL ITEM.
```

Si se sumara al retener y otra vez al liberar, el mismo dinero saldría dos veces.

| `tipo` | `movimiento` | `esGasto` | Aprobar genera |
|---|---|---|---|
| `estimacion_subcontratista` | — | — | Gasto por `monto.importe`, que **ya viene NETO**. `importeBruto` y `retencionTotal` son informativos: no se restan ni se suman, sólo explican por qué el gasto no coincide con lo estimado. |
| `retencion_subcontratista` | `retencion` | `false` | Registro en `sogrub_retenciones` (`estado:'pendiente'`). **Cero contables.** Item queda `asentado`. |
| `retencion_subcontratista` | `liberacion` | `true` | `sogrub_proy_movimientos` (gasto, categoria='Subcontratista', folio CP) con la fecha del item + marca la retención `liberado`. |

- **Pareo por `refKey`**: la liberación trae el mismo `refKey` que su retención. Si llega una
  liberación cuyo refKey no existe se pide confirmación, se asienta igual (el dinero sí salió)
  y el contable queda con `retencion_huerfana:true`.
- **Idempotente**: estimaciones puede reenviar el mismo `refKey`; `_retencionPorRefKey` busca y
  actualiza en vez de duplicar.
- **La fecha manda**: una liberación puede llegar meses después, incluso de otro ejercicio. Se
  registra con `item.fecha`, no con la de aprobación.
- **No recalcular desde `pct`**: el `monto` ya viene resuelto (`base:'importe'`, sobre el
  importe C/IVA). El pct es sólo para la etiqueta.

**Por qué colección aparte y no un movimiento contable**: si el fondo viviera en
`sogrub_proy_movimientos`, cualquier suma de gastos lo contaría. Retener es un **pasivo**, no
una salida — el dinero sigue en tu caja. Ver `calcFondosRetenidos` y
`calcComprometidoSubcontratistas` en `js/calculations.js`, `_aprobarRetencionSub` en
`js/views/buzon.js`, y la tarjeta `renderFondosRetenidos` en `js/views/detalle.js`.

Entra al KPI de **Deuda pendiente** como tercer renglón (se le debe al sub) y la tarjeta del
proyecto muestra `pagado + fondo = comprometido con subs`.

## Retiro de utilidad — obra → SOGRUB (2026-08-26)

El inverso exacto de `ejecutarTransferenciaSOGRUB`. Saca de la caja de la obra el dinero que
ya sobró y lo pasa a SOGRUB; a partir de ahí es **utilidad cobrada**: dinero libre que ya no
hay que justificar contra el proyecto.

```
ejecutarRetiroUtilidad(proyectoId, monto, concepto, fecha, metodo)
  SÓLO sogrub_proy_movimientos { tipo:'retiro_utilidad', monto:−abs, metodo_pago }
```

**Un solo asiento, y no es negociable (2026-08-26).** El dinero YA está en Mifel o en la caja
física; lo único que cambia es que deja de estar apartado. Como
`libre = (Mifel + efectivo) − Σ saldos de obras`, al bajar la caja de la obra el libre sube
solo. Escribir además un ingreso del lado SOGRUB sube el libre **dos veces** y, en efectivo,
infla el saldo teórico de la caja física sin que llegue un billete: **el arqueo aparece
faltante por el monto del retiro**. Es el mismo error que el "Ingreso a Mifel" fantasma.

`metodo` no elige caja destino: dice de qué mitad de la caja de la obra sale, para que el
split de `calcSaldoCajaProyectoDesglose` siga cuadrando.

⚠ **`ejecutarTransferenciaSOGRUB` tiene este mismo bug al revés** (escribe el egreso en
`sogrub_movimientos` *y* el ingreso en la obra, así que baja el libre el doble). Se dejó como
estaba por no tocarlo sin pedirlo, pero si se usa "Recibir de SOGRUB" hay que arreglarlo.

**No es un gasto y por eso lleva tipo propio.** Un gasto compra algo para la obra y consume
presupuesto; esto sólo cambia de bolsillo dinero que ya sobró. Si se registrara como `gasto`
contaminaría el costo, las bolsitas, el CPI y la utilidad realizada — justo lo contrario de
lo que mide.

- `calcSaldoCajaProyecto` resta los retiros; `calcSaldoCajaProyectoDesglose` manda los de
  efectivo a `efOut` para que el split efectivo/electrónico siga cuadrando.
- `calcUtilidadRetirada(proyectoId)` = Σ retiros.
- `calcBolsitasProyecto`: `utilidadDisponible = utilidadPlaneada − overflowTotal −
  utilidadRetirada`. **Los sobregiros se siguen restando aunque ya hayas retirado** — retirar
  no protege la utilidad de un rubro que se pasa.
- Tarjeta de presupuesto: renglón "💸 Utilidad cobrada" y el total pasa a llamarse "Utilidad
  por cobrar" en cuanto hay retiros.
- Análisis → tarjeta de trade: bloque "Utilidad cobrada / Utilidad por cobrar". La curva de
  caja de la obra baja con el retiro (`s.retiros` en `_aoSeries`).
- El modal avisa —sin bloquear— si el monto excede la caja de la obra o la utilidad por
  cobrar. Ni `calcSaldoMifel` ni `calcSaldoEfectivo` se mueven: sólo sube el disponible libre.
- Editar un retiro: `abrirModalMovProy` usa `esSalida` (gasto **o** retiro) para el signo. Con
  `esGasto` a secas le volteaba el signo y la obra recibía dinero en vez de perderlo.

## IVA manual en abonos del cliente (2026-09-07)

En obras donde sólo el material está gravado, **el IVA no es el 16% del subtotal**: lo causa
una parte del importe y el ingeniero lo captura a mano por estimación. Estimaciones lo publica
exacto en el item `pago_cliente`:

```
{ importe_sin_iva, iva, ivaManual: true, ivaPct, importe, amortizacion_anticipo: 0 }
```

**Nunca se re-deriva.** Ni `monto / 1.16`, ni `neto × 0.16`. Con `ivaManual:true` el campo `iva`
es autoridad absoluta aunque no guarde proporción alguna con el subtotal. En Cimentación Ocaso
derivarlo al 16% daba $78,277.38 contra $50,652.85 reales: **$27,624.53 inflados**.

- `_montoAbonoDeItem(item)` (buzón) resuelve el desglose. Acepta los campos nuevos
  (`importe_sin_iva`) y los viejos (`subtotal`), y los busca en `item.monto` y en la raíz.
  Si `subtotal + iva ≠ importe`, o si `amortizacion_anticipo ≠ 0`, **avisa y registra tal cual**
  — nunca ajusta en silencio (regla 4). El importe ya viene neto de amortización: no se
  descuenta nada.
- `calcIVACobradoCliente` lee `monto_subtotal` / `monto_iva` capturados. Prioridad: desglose
  consistente → sólo IVA → 16% legacy. Devuelve `nDerivados` = cuántos abonos siguen estimados
  al 16%, y la tarjeta lo avisa en vez de darlo por bueno.
- Guarda de cordura: si `subtotal + iva` no da el monto, el subtotal no es válido (hay
  registros donde guarda el ejecutado del período) y se usa `monto − iva`.
- **Reparación**: `repararIVAAbonos(proyectoId, aplicar)` relee `/shared/buzon` y repone el IVA
  de los abonos ya asentados. Diagnostica primero; sólo escribe si el contador confirma en el
  modal (`abrirModalRepararIVA`, enlace en el KPI "Total cobrado"). Los abonos cuyo importe ya
  no coincide con el del buzón **no se tocan**: se editaron a mano y los revisa el contador.

**Restante por cobrar** = `contrato.subtotal` VIGENTE − neto cobrado SIN IVA
(`calcContratoVigenteSubtotal`). Antes restaba el contrato **original** menos el cobrado **con
IVA**: contrato desactualizado y bases mezcladas a la vez. En Ocaso decía $124,084.98 cuando lo
correcto son $149,391.36.

## Buzón: estado `cancelado` (2026-09-07)

Estimaciones puede quitar un pago capturado por error y marca el item
`{ estado:'cancelado', canceladoAt, canceladoPor, descripcionCancelado }`.

**Terminal.** Sale de la bandeja de pendientes (aparece en la pestaña Rechazados), no suma a
cartera, y `_aprobarItem` lo rechaza de entrada: asentarlo crearía un cobro que del otro lado
ya no existe.

Si el item **ya había generado movimiento** (`movId` presente), la tarjeta lo marca en rojo con
el id del contable y ofrece "Ver movimiento a reversar". **La app no lo borra sola**: el
contador pudo haberlo editado después, así que el reverso es manual y deliberado.
