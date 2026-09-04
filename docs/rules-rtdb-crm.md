# Reglas de RTDB para `/shared/crm` (CRM comercial)

> **Fragmento, no un archivo de reglas completo.** Pégalo dentro de las reglas que ya
> tiene `sogrub-suite`, bajo el nodo `shared`, junto a `buzon`, `cajaChica`, etc.
> **No subas este bloque solo**: publicar unas reglas parciales borra las de todo lo
> demás y deja la suite sin acceso.

## La regla, en una línea

`/shared/crm` es **sólo para admins**: leer y escribir requieren
`role === 'admin'` en `/legacy/estimaciones/users/{uid}`. Es el mismo gate duro de
la consola, y coincide con lo que ya valida la app en `crm/js/services/auth.js`
(las reglas son la defensa real; el gate del cliente es sólo UX).

Por qué tan cerrado: el pipeline comercial trae montos de contrato, márgenes,
motivos de pérdida y competidores de toda la empresa. Un ingeniero puede aparecer
como **responsable** de una oportunidad —se listan desde
`/legacy/estimaciones/users`— sin poder abrir la app.

## El fragmento

```json
{
  "rules": {
    "shared": {
      "crm": {
        ".read":  "auth != null && root.child('legacy/estimaciones/users').child(auth.uid).child('role').val() === 'admin'",
        ".write": "auth != null && root.child('legacy/estimaciones/users').child(auth.uid).child('role').val() === 'admin'",

        "oportunidades": {
          "$opId": {
            ".validate": "newData.hasChildren(['nombre', 'etapa', 'estado'])",
            "etapa":  { ".validate": "newData.val().matches(/^(lead|contacto|visita|presupuesto|propuesta|negociacion)$/)" },
            "estado": { ".validate": "newData.val().matches(/^(abierta|ganada|perdida|declinada|pospuesta)$/)" },
            "folio":  { ".validate": "newData.isString() && newData.val().matches(/^OP-[0-9]{4}-[0-9]{3,}$/)" },
            "$otro":  { ".validate": true }
          }
        },

        "_counters": {
          "oportunidades": {
            "$anio": {
              ".validate": "newData.isNumber() && (!data.exists() || newData.val() > data.val())"
            }
          }
        }
      }
    }
  }
}
```

`$otro: { ".validate": true }` deja pasar el resto de campos de la oportunidad
(presupuesto, actividades, historial, cierre…) sin enumerarlos: lo que se valida
aquí es la forma de lo que otras apps y la consola sí leen —etapa, estado y
folio—, no la ficha completa.

El contador del folio **sólo sube**: así una transacción concurrente no puede
reciclar un `OP-AAAA-NNN` ya emitido.

## Lo que el CRM lee fuera de su nodo

Ambos ya deberían ser legibles para un admin; si no, hay que abrirlos:

| Path | Uso | Acceso necesario |
|---|---|---|
| `/legacy/estimaciones/users` | perfil (rol) y lista de responsables asignables | lectura |
| `/legacy/bitacora/sogrub_proyectos` | crear el proyecto al ganar (`convertirEnProyecto`) | lectura y escritura |

## Cómo aplicarlas

1. Firebase Console → Realtime Database → **Rules**.
2. Copia las reglas vigentes a un lado (respaldo).
3. Inserta el bloque `"crm": { … }` dentro de `"shared"`.
4. Usa el **Rules Playground** para comprobar, contra un uid real:
   - admin → lectura y escritura en `/shared/crm/oportunidades/x` ✓
   - ingeniero → lectura denegada ✗
   - sin auth → denegado ✗
5. Publica.
