# CRM · SOGRUB

Pipeline comercial de SOGRUB: desde que aparece un **lead** hasta que la obra se
**gana** (y se convierte en proyecto de bitácora), se **pierde**, se **declina** o
se **pospone**. Sexta pieza de la suite `sogrub-suite`.

Vive dentro de `appsogrub` (como `console/`) porque bitácora es la app autoritativa
de `/shared` y el cierre "ganada" crea el proyecto contable ahí mismo. Es una
**página independiente** con su propio stack (Firebase v10 modular, ES-modules,
sin bundler), separada del appsogrub raíz (compat 9.x).

## El embudo

```
Lead → Contacto → Visita/levantamiento → Presupuesto (OPUS) → Propuesta enviada → Negociación
                                                                                      ├─ Ganada    → proyecto en bitácora
                                                                                      ├─ Perdida   → el cliente no nos eligió / no procedió
                                                                                      ├─ Declinada → SOGRUB dijo que no
                                                                                      └─ Pospuesta → en pausa, reabrible
```

Cada etapa tiene una **probabilidad default** (10 → 80 %) que pondera el pipeline;
se puede ajustar por oportunidad. Las etapas son fijas en `js/services/pipeline.js`
para que los reportes históricos sigan cuadrando; lo editable (fuentes, tipos de
obra, motivos, defaults de sobrecostos) vive en `#/config`.

## Módulos

| Ruta | Módulo | Qué hace |
|---|---|---|
| `#/` | **Pipeline** | Tablero Kanban por etapa con drag & drop, KPIs (abiertas, monto, ponderado, vencidas, estancadas), filtros por responsable/tipo/búsqueda. Se actualiza en vivo. |
| `#/oportunidad/:id` | **Ficha** | Stepper de etapas, datos, presupuesto en cascada OPUS con versiones de propuesta, próxima acción, bitácora de seguimiento (llamadas, visitas, tareas…), cierre y conversión a proyecto. |
| `#/agenda` | **Agenda** | Acciones vencidas / hoy / semana, tareas pendientes, oportunidades estancadas y sin próxima acción. |
| `#/clientes` | **Clientes** | Catálogo de clientes (particular, constructora, desarrollador, arquitecto…) con su historial de oportunidades. |
| `#/reportes` | **Reportes** | Embudo, tasa de conversión, ticket promedio, ganadas por fuente/tipo, motivos de pérdida, días promedio por etapa, por responsable. |
| `#/config` | **Config** (admin) | Listas editables y defaults del presupuesto. |

## Reglas de operación (las que hacen que el CRM sirva)

1. **Toda oportunidad abierta tiene una próxima acción con fecha.** Es lo que
   alimenta la Agenda; sin ella la oportunidad aparece marcada en el tablero.
2. **Estancada** = más de N días sin actividad (default 14, en config).
3. **El presupuesto se captura con la misma cascada que bitácora** (`calcCascada`
   ≡ `calcDesgloseContrato`): indirectos de oficina y campo son % del costo
   directo; financiamiento y utilidad cascadean; IVA encima. Así la conversión a
   proyecto es 1:1 y el monto del contrato nunca se teclea a mano.
4. **Cada propuesta que se manda al cliente queda como versión** (`propuestas/`),
   con monto, fecha, vigencia y link al archivo.
5. **Cerrar no es borrar.** Perdida / declinada / pospuesta con motivo, para que
   los reportes digan por qué se van las obras. Eliminar es sólo para admin.
6. **Ganada → proyecto en bitácora** (admin): agrega a
   `/legacy/bitacora/sogrub_proyectos` con transacción (nombre, cliente,
   `fecha_inicio`, `costo_directo_base`, los cuatro `sobrecosto_*` y
   `presupuesto_contrato` SIN IVA, más `origen_crm_id` / `origen_crm_folio`).
   Idempotente: si ya existe un proyecto con ese `origen_crm_id`, no duplica.
   La obra de estimaciones la crea el ingeniero como siempre y se vincula en la
   consola → obraLinks.

## Modelo (RTDB, bajo `/shared/crm/`)

```
oportunidades/{opId}:
  folio 'OP-2026-001', nombre, clienteId, clienteNombre (snapshot), contacto, telefono,
  tipoObra, fuente, ubicacion, municipio, descripcion, prioridad 'alta|media|baja',
  responsableUid, responsableNombre, montoEstimado (sin IVA),
  etapa 'lead|contacto|visita|presupuesto|propuesta|negociacion',
  estado 'abierta|ganada|perdida|declinada|pospuesta',
  probabilidad? (override), fechaCierreEstimada, proximaAccion { fecha, texto },
  presupuesto { costo_directo_base, sobrecosto_ind_oficina, sobrecosto_ind_campo,
                sobrecosto_financiamiento, sobrecosto_utilidad, iva_pct, anticipo_pct,
                anticipo_base 'subtotal|total_c_iva', subtotal, iva, total, anticipo,
                version, fecha, vigenciaDias, archivoUrl, notas },
  propuestas/{id} { version, fecha, subtotal, total, anticipo, vigenciaDias, notas, archivoUrl, at, por },
  historial/{id}  { tipo 'etapa|cierre|reapertura', de, a, at, por },
  cierre { tipo, motivo, detalle, competidor, fecha, at, por },
  proyectoId?, proyectoCreadoAt?,
  etapaDesde, ultimaActividadAt, createdAt, createdBy, updatedAt

actividades/{opId}/{actId}:
  tipo 'nota|llamada|whatsapp|correo|reunion|visita|tarea|sistema', texto, fecha,
  vence?, hecha?, hechaAt?, at, por { uid, nombre }

clientes/{id}: nombre, tipo, empresa, contacto, puesto, telefono, email, direccion, municipio, rfc, notas
config: fuentes[], tiposObra[], motivosPerdida[], motivosDeclinada[], sobrecostosDefault{}, ivaPct,
        anticipoPctDefault, vigenciaDiasDefault, diasEstancada
_counters/oportunidades/{año}: N   (folio atómico, mismo patrón que CC/CP de bitácora)
```

## Acceso

Pool único de usuarios en `/legacy/estimaciones/users`. Entran `admin` e
`ingeniero`; cualquier otro rol entra si su perfil tiene `crm: true`. Sólo admin
borra oportunidades, edita la configuración y crea el proyecto en bitácora.

## Cómo arrancar

```bash
cd appsogrub/crm
python -m http.server 3010
```
Abrir `http://localhost:3010/`. En producción se sirve como su propia ruta de
GitHub Pages: `…github.io/appsogrub/crm/`.

**Antes de cada push que toque `crm/js` o `crm/css`: `bash crm/bump-cache.sh`.**
El `bump-cache.sh` de la raíz de appsogrub **no** aplica aquí.

## Estructura

```
crm/
  index.html · css/main.css · bump-cache.sh
  js/
    main.js                      # rutas + gate de acceso
    config/firebase-config.js    # APP_BASE_PATH="shared/crm" · APP_VERSION
    services/
      firebase.js · db.js · auth.js
      pipeline.js                # PURO: etapas, cierres, probabilidad, cascada OPUS, métricas
      crm.js                     # datos: folios, CRUD, actividades, conversión a proyecto
    state/{store,router}.js · util/{dom,format}.js
    views/{shell,login,pipeline,oportunidad,agenda,clientes,reportes,config,_ui,_form-oportunidad}.js
```

La lógica de `pipeline.js` no depende de Firebase: se prueba con datos sintéticos
(la cascada reproduce el ejemplo de Cimentación Ocaso del spec al centavo).
