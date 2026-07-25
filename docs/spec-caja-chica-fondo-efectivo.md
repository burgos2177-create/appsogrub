# Spec — Caja chica: fondo EFECTIVO por obra (2026-07-25)

Contrato para **app-materiales**, **app-indirectos** (y cualquier app de campo)
para operar el nuevo **fondo de efectivo** de la caja chica. Conviven **dos
fondos por obra** — el histórico de transferencia **no cambia**:

```
/shared/cajaChica/{obraId}/movimientos/{movId}
   ├─ fondo ausente      → fondo TRANSFERENCIA (todo lo histórico, intacto)
   └─ fondo: 'efectivo'  → fondo EFECTIVO (nuevo)
```

**Regla de oro:** el campo `fondo` decide a qué fondo pertenece el movimiento.
Nunca reinterpretar movimientos sin `fondo` — son del fondo transferencia.

## Por qué

La caja chica de transferencia ya opera bien, pero en obra también circula
billete físico. El fondo efectivo lleva ese billete con la misma máquina de
estados (`reportado → aprobado/rechazado`, reabrir, buzón, folios CC/CP),
pero al asentar el dinero sale de la **caja física de SOGRUB** (arqueo de
bitácora), no de Mifel.

## Modelo contable (lado bitácora, ya implementado)

| Movimiento | Mifel | Caja física SOGRUB | Caja proyecto | Fondo efectivo obra |
|---|---|---|---|---|
| Retiro Mifel → efectivo (bitácora) | ↓ | ↑ | — | — |
| **Depósito al fondo efectivo** | — | ↓ | ↓ | ↑ |
| **Gasto pagado del fondo efectivo** | — | — | — | ↓ |

El dinero baja **una sola vez** (al depositar). El gasto aprobado genera el
contable (`paga_de_caja_chica:true`, `fondo_caja:'efectivo'`, status Pagado,
folio CP) que cuenta en utilidad/IVA/desglose pero no vuelve a descontar
ningún saldo. Igual que el fondo transferencia.

## Fórmula de saldo (replicar EXACTA en cada app)

```js
// Un saldo POR FONDO. fondo(m) = m.fondo === 'efectivo' ? 'efectivo' : 'transferencia'
saldo(fondo) =
    Σ depósitos del fondo que cuentan
  − Σ gastos con estado='aprobado' del fondo
// Un depósito cuenta si (m.estado || 'aprobado') === 'aprobado'  ← sin estado =
// aprobado (legacy; los del contador nacen aprobados) — 'solicitado' y
// 'rechazado' NO cuentan — y además:
//   fondo transferencia → (m.metodoDeposito || 'transferencia') !== 'efectivo'
//     (el depósito "efectivo" SIN fondo sigue siendo informativo, legacy)
//   fondo efectivo      → sin condición extra (todo depósito del fondo es billete)
// Gastos reportado / rechazado no afectan (igual que siempre)
```

## Qué escribe la app de campo

### 1. Reportar un gasto pagado con el fondo efectivo

Exactamente igual que un gasto de caja chica de hoy, agregando `fondo`:

```js
// /shared/cajaChica/{obraId}/movimientos/{movId}
{ tipo:'gasto', estado:'reportado', fondo:'efectivo', monto, fecha,
  comentario, refRecepcionId, autor, origen:'materiales'|'indirectos', createdAt }

// /shared/buzon/{itemId}  — MISMO tipo de siempre + fondo
{ tipo:'gasto_caja_chica', fondo:'efectivo', obraId, obraNombre, movimientoId,
  monto, fecha, proveedor, desglose:[{conceptoKey,monto}], incluyeIva, estado:'recibido', ... }
```

Bitácora al aprobar: contable con `categoria` elegida por el contador,
`paga_de_caja_chica:true`, `fondo_caja:'efectivo'`, folio **CP**; sincroniza
`estado:'aprobado'` en el espejo. Rechazo/reabrir/huérfano: idéntico al fondo
transferencia (mismos campos, mismo espejo).

### 2. Solicitar un depósito al fondo efectivo

```js
// /shared/cajaChica/{obraId}/movimientos/{movId}
{ tipo:'deposito', fondo:'efectivo', metodoDeposito:'efectivo', monto, fecha,
  comentario, autor, origen, createdAt, pendienteAsentar:true }

// /shared/buzon/{itemId}
{ tipo:'deposito_caja_chica', fondo:'efectivo', obraId, obraNombre,
  movimientoId, monto, fecha, estado:'recibido', ... }
```

⚠ Diferencia clave vs hoy: el depósito "efectivo" del fondo transferencia NO
se publica al buzón (informativo). El depósito del **fondo efectivo SÍ se
publica** — al aprobarlo, bitácora asienta el egreso en la **caja física
SOGRUB** (`sogrub_efectivo_movimientos`, folio **CC**) + egreso espejo del
proyecto, y sella `estado:'aprobado'` + `asentadoAt`/`asentadoBancarioId`/
`folioBancario` en el espejo. El depósito solicitado desde campo NO cuenta al
saldo hasta ese `estado:'aprobado'`; los depósitos hechos por el contador
desde bitácora nacen aprobados y cuentan de inmediato.

### 3. `gasto_oc` pagado con caja chica (materiales)

Si la recepción se pagó del fondo efectivo, agregar `fondo:'efectivo'` al item
del buzón (`tipo:'gasto_oc'`, `formaPago:'caja_chica'`). Bitácora marca el
contable con `fondo_caja:'efectivo'`.

> Implementado en materiales: el fondo se pregunta al **crear** la recepción de
> caja chica (queda en `fondoCaja` de la recepción) y al **enviar** una de OC
> cuando la forma de pago es caja chica. El modal de reportar solo lo confirma.

### 4. `meta.arqueoEfectivo` — arqueo del fondo declarado por la obra

El billete del fondo efectivo ya salió de la caja física de SOGRUB, así que el
arqueo por denominación de bitácora **no** lo cuenta. Para poder conciliar el
otro lado, el contador captura en la vista de Efectivo lo que el almacenista
reportó contar, y se guarda en el path compartido:

```js
/shared/cajaChica/{obraId}/meta/arqueoEfectivo = {
  monto,                 // efectivo contado en obra
  fecha,                 // 'YYYY-MM-DD' del conteo
  registradoPor,         // email de quien lo capturó
  updatedAt
}
```

Es informativo y opcional: nadie lo necesita para calcular saldo. Las apps de
campo pueden mostrarlo (“último arqueo confirmado”) o dejar que el almacenista
lo capture; mientras no exista, ese fondo simplemente queda fuera de la
conciliación consolidada en vez de asumirse cuadrado.

## UI sugerida (para paridad con bitácora)

Bitácora muestra la caja chica del proyecto con **pills de fondo**
(🏦 Fondo transferencia · 💵 Fondo efectivo), saldo conciliado por fondo y la
tabla filtrada. Badges: `💵 Fondo efectivo · asentada/pendiente asentar` en
depósitos. Replicar el patrón que cada app ya tenga para caja chica.

## Compatibilidad

- Apps que aún no implementen esto siguen funcionando: no escriben `fondo`,
  todo cae al fondo transferencia como hoy.
- Mientras una app no filtre por fondo, su saldo de caja chica mostrará de
  más/menos si la obra ya usa el fondo efectivo → **actualizar la fórmula de
  saldo es lo primero** que hay que portar.
- La consola central ya diagnostica fondos por separado
  (`computeSaldosCajaChicaPorFondo`), incluido fondo negativo (alguien puso
  de su bolsillo) aunque el otro fondo esté en positivo.
