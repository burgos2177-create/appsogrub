# Spec — Sobrecostos, IVA y anticipo entre estimaciones ↔ bitácora

> Documento de coordinación cross-app. Lo escribe **bitácora** (lado contador) para
> alinear con **estimaciones** (lado ingeniero de campo). Fuente de verdad de la
> economía de la obra = **estimaciones (desde OPUS)**. Bitácora solo lee y controla.
>
> Ejemplo numérico usado en todo el doc: obra "Cimentación Ocaso".

---

## 0. TL;DR — quién manda qué

| Dato | Fuente de verdad | Quién lee |
|---|---|---|
| Obra (contrato, cliente, constructora, fechas) | **estimaciones** | bitácora |
| Costo directo + %s de sobrecostos (OPUS) | **estimaciones** | bitácora |
| Monto C/IVA (contrato) | **derivado** de lo anterior | ambos |
| % y base del anticipo | **estimaciones** | bitácora |
| Estimaciones (avance de obra cobrado) | **estimaciones** → buzón | bitácora |
| Gastos reales, saldos, utilidad real, IVA acreditable | **bitácora** | — |

Regla de oro: **el Monto C/IVA NO se teclea a mano.** Sale de la integración OPUS.
Si se teclea, se desalinea del presupuesto real.

---

## 1. La cascada correcta (igual que OPUS)

OPUS integra el precio así. **Ojo con la base de cada nivel:**

```
Costo directo (CD)                             856,070.78   ← subtotal del presupuesto OPUS
+ Indirectos de oficina   (% sobre CD)        + 42,803.54   (5% de CD)
+ Indirectos de campo     (% sobre CD)        + 68,485.66   (8% de CD)
= Subtotal de indirectos                       967,359.98
+ Financiamiento          (% sobre subtotal)  +      0.00   (0%)
= Subtotal                                     967,359.98
+ Utilidad                (% sobre subtotal)  + 96,736.00   (10%)
= PRECIO DE VENTA (sin IVA)                  1,064,095.98   ← "Importe total del presupuesto" en OPUS
+ IVA 16%                 (sobre precio venta)+170,255.36
= MONTO C/IVA (contrato)                     1,234,351.34   ← campo "Monto C/IVA" de Nueva obra
```

**Puntos críticos que deben quedar bien:**

1. **Los dos indirectos (oficina y campo) son % del COSTO DIRECTO**, no en cascada uno
   sobre otro. Sumados dan el subtotal de indirectos. (Este era el error que teníamos:
   calculábamos campo sobre CD+oficina; OPUS lo hace sobre CD.)
2. **Financiamiento y utilidad SÍ cascadean** sobre el acumulado.
3. **El IVA es una capa aparte**, encima del precio de venta. Los indirectos y la utilidad
   se calculan **sin IVA**. El IVA nunca entra a las "bolsitas" de costo.
4. La pequeña diferencia (~$9) entre este cálculo y OPUS es por el **redondeo por partida**
   de OPUS (aplica el % a cada concepto y redondea). Es 0.0009% — inevitable si solo se
   manda el CD total y no concepto por concepto.

---

## 2. Qué debe capturar "Nueva obra" en estimaciones

El modal hoy tiene: Nombre, Contrato No., Cliente, Constructora, Ubicación, Municipio,
Programa, **Monto C/IVA**, IVA, **% Anticipo**, fechas.

**Cambiar Monto C/IVA de "se teclea" a "se calcula"**, y agregar el bloque de integración
(estos valores salen directo del OPUS que el ingeniero ya arma):

| Campo nuevo | Ejemplo | Notas |
|---|---|---|
| `costo_directo` | 856,070.78 | Subtotal del presupuesto OPUS (sin sobrecostos). |
| `pct_ind_oficina` | 5 | % sobre CD |
| `pct_ind_campo` | 8 | % sobre CD |
| `pct_financiamiento` | 0 | % sobre subtotal |
| `pct_utilidad` | 10 | % sobre subtotal |
| `pct_cargos_adicionales` | 0 | opcional (OPUS lo tiene) |
| `pct_otro` | 0 | opcional |
| `iva_pct` | 0.16 | ya existe |
| `anticipo_pct` | 30 | ya existe (% Anticipo) |
| `anticipo_base` | `subtotal` | **NUEVO** — `subtotal` \| `total_c_iva` (ver §4) |

Con eso, `subtotal_venta` y `monto_con_iva` se **derivan** (mostrar en el modal como
preview, igual que ya lo hace bitácora). El usuario ya no teclea el monto: lo confirma.

---

## 3. Contrato de datos (lo que bitácora leerá)

Estimaciones guarda la integración en el registro de la obra (bitácora ya tiene lectura
de `/legacy/estimaciones/obras/*`):

```
/legacy/estimaciones/obras/{obraId}/integracion = {
  costo_directo:          856070.78,
  pct_ind_oficina:        5,
  pct_ind_campo:          8,
  pct_financiamiento:     0,
  pct_utilidad:           10,
  pct_cargos_adicionales: 0,
  pct_otro:               0,
  subtotal_venta:         1064095.98,   // derivado
  iva_pct:                0.16,
  iva_monto:              170255.36,     // derivado
  monto_con_iva:          1234351.34,    // derivado
  anticipo_pct:           30,
  anticipo_base:          "subtotal"     // "subtotal" | "total_c_iva"
}
```

El link obra→proyecto ya existe: `/shared/obraLinks/{obraId} = proyectoId`.
Bitácora resuelve el proyecto y **copia/lee** estos valores para armar sus bolsitas.
Nadie más escribe en `integracion`: es de estimaciones.

---

## 4. Anticipo (configurable por obra)

El cliente da un anticipo al inicio. **La base varía por obra**, por eso el switch:

- `anticipo_base = "subtotal"` → anticipo = `subtotal_venta × anticipo_pct`
  (ej. 1,064,095.98 × 30% = **319,228.79**). El IVA se cobra después, con cada estimación.
- `anticipo_base = "total_c_iva"` → anticipo = `monto_con_iva × anticipo_pct`
  (ej. 1,234,351.34 × 30% = **370,305.40**).

El anticipo es **dinero real que entra** → en bitácora es un `abono_cliente` (ingreso a caja
del proyecto / Mifel). Se **amortiza** proporcionalmente en cada estimación (cada estimación
descuenta su parte del anticipo). Sugerencia: guardar `anticipo_monto` y `anticipo_amortizado`
para saber cuánto queda por amortizar.

---

## 5. Estimaciones progresivas (la cobranza "sobre la marcha")

Cada estimación que el ingeniero sube = avance de obra valuado a precios de contrato:

```
Importe de la estimación (avance sin IVA)      p.ej.  200,000.00
− Amortización de anticipo (proporción)        −       60,000.00   (30%)
= Neto sin IVA                                        140,000.00
+ IVA 16% sobre el importe                     +       32,000.00
= NETO A COBRAR al cliente                            172,000.00
```

Esto viaja al **buzón** como `tipo='pago_cliente'` → al aprobarse genera `abono_cliente`
en bitácora (folio CC). Sumadas todas las estimaciones = contrato. El KPI
"Restante por cobrar" de bitácora ya refleja esto.

**Clave:** cada estimación trae **su propio IVA**. Ese IVA es lo que alimenta la bolsita de
IVA (§6). El importe sin IVA es lo que va consumiendo el contrato.

---

## 6. La bolsita de IVA (avance de cobro)

Definición acordada: **avance de cobranza del IVA**, no balance fiscal.

```
IVA total del contrato = subtotal_venta × 16%   = 170,255.36   (lo que el cliente pagará de IVA)
IVA cobrado a la fecha  = Σ IVA de estimaciones cobradas
Bolsita IVA             = IVA cobrado / IVA total del contrato   → barra de avance
```

Es una barra igual que las demás bolsitas: "llevas cobrado $X de $170,255.36 de IVA".
Sirve para saber cuánto IVA ya te trasladó el cliente (dinero que en algún momento enteras
al SAT, neteado con el IVA acreditable de tus gastos).

> No confundir con el **Balance IVA** que bitácora ya calcula (IVA trasladado − IVA
> acreditable de gastos con factura). Ese es el neto fiscal; la bolsita es solo avance de
> cobro. Pueden convivir: la bolsita arriba (cobranza), el balance en el KPI de IVA (fiscal).

---

## 7. Las bolsitas de costo (control interno de bitácora)

Presupuesto de cada bolsita = de la integración OPUS (**sin IVA**):

| Bolsita | Presupuesto | Se gasta con… |
|---|---|---|
| 🧱 Costo directo | `costo_directo` (856,070.78) | gastos Material / Mano de Obra / Subcontratista |
| 🏢 Indirectos oficina | `costo_directo × pct_ind_oficina` (42,803.54) | gastos Indirecto · ámbito Oficina |
| 🚧 Indirectos campo | `costo_directo × pct_ind_campo` (68,485.66) | gastos Indirecto · ámbito Campo |
| 💵 Financiamiento | `subtotal × pct_financiamiento` | reservado (informativo) |
| 📈 Utilidad | `subtotal × pct_utilidad` (96,736.00) | margen; el sobregiro de las de arriba se la come |

- **Comparar NETO contra NETO:** el presupuesto es sin IVA, así que lo gastado debe
  medirse en **neto** (gasto / 1.16 si trae IVA). Si no, sobreestimas el consumo.
- Sobregiro de una bolsita → sale de la utilidad (`utilidad_disponible = utilidad − Σ sobregiros`).
- Esto ya está implementado en bitácora; solo cambia **de dónde salen los presupuestos**
  (antes captura manual, ahora de la obra de estimaciones).

---

## 8. Checklist para el lado de estimaciones

- [ ] Agregar al modelo de obra el bloque `integracion` (§2/§3).
- [ ] En "Nueva obra": cambiar Monto C/IVA a **derivado** (preview), agregar CD + %s + `anticipo_base`.
- [ ] Aplicar la cascada correcta (§1): indirectos ofi/campo sobre **CD**; financiamiento/utilidad en cascada; IVA aparte.
- [ ] Escribir `integracion` en `/legacy/estimaciones/obras/{obraId}`.
- [ ] Asegurar el link `/shared/obraLinks/{obraId} = proyectoId`.
- [ ] En cada estimación, mandar al buzón el importe **sin IVA**, el **IVA** y la **amortización de anticipo** por separado (para las bolsitas de bitácora).

## 9. Checklist para bitácora (este repo)

- [ ] Al abrir un proyecto vinculado, **leer `integracion`** de la obra vía obraLinks y
      precargar `costo_directo_base` + sobrecostos (el modal manual pasa a override/fallback).
- [ ] Guardar `anticipo_pct` / `anticipo_base` y reflejar el anticipo esperado vs cobrado.
- [ ] Agregar la **bolsita de IVA** (avance de cobro) con base `subtotal × 16%`.
- [ ] Medir lo gastado en las bolsitas en **neto** (descontar IVA) para cuadrar con el presupuesto sin IVA.
