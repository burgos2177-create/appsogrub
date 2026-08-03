# Parches pendientes de push

Respaldo temporal: esta sesión solo tiene **escritura** en appsogrub /
app-compras / app-estimaciones (materiales e indirectos se pueden clonar y
leer, pero `git push` devuelve 403). Los cambios para esas dos apps quedan
aquí como parches listos para aplicar.

## Pendientes ahora

| Parche | Repo destino | Contenido |
|---|---|---|
| `app-materiales-modal-guard.patch` | `burgos2177-create/app-materiales` | Aviso "¿Descartar lo capturado?" antes de cerrar un modal por click fuera. |
| `app-indirectos-modal-guard.patch` | `burgos2177-create/app-indirectos` | Lo mismo. |

Ambos se aplican **sobre la punta actual** de
`claude/sogrubsuite-central-management-819dhk` en su repo:

- materiales → encima de `770c7e9` (Recepción: elegir el fondo de caja chica)
- indirectos → encima de `0fc05db` (Caja chica: fondo EFECTIVO + service worker)

Es el mismo bloque de `js/util/dom.js` que ya está pusheado y verificado en
app-compras, app-estimaciones y appsogrub/console — los tres `modal()` eran
byte-idénticos. La suite de Playwright (18 aserciones) se corrió también
contra el archivo resultante de cada repo.

## Cómo aplicar

```bash
cd app-materiales   # o app-indirectos
git fetch origin
git checkout claude/sogrubsuite-central-management-819dhk
git pull --ff-only
git am ../appsogrub/patches/app-materiales-modal-guard.patch
git push -u origin claude/sogrubsuite-central-management-819dhk
```

`git am` conserva mensaje y autoría; si algo falla, `git am --abort` deja todo
como estaba. Cuando ambos estén pusheados, esta carpeta puede borrarse otra vez.
