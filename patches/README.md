# Parches pendientes de push (fondo efectivo de caja chica)

Respaldo temporal: esta sesión de Claude Code solo tiene permiso de escritura
en appsogrub / app-compras / app-estimaciones. Los cambios del **fondo
efectivo** para las otras dos apps quedaron commiteados localmente en la
sesión y aquí como parches, listos para aplicarse:

| Parche | Repo destino | Contenido |
|---|---|---|
| `app-materiales-fondo-efectivo.patch` | `burgos2177-create/app-materiales` | `computeSaldoCajaChica` por fondo, pills 🏦/💵, solicitud de depósito al fondo efectivo, selector de fondo al reportar recepción, tarjeta de obra. |
| `app-indirectos-fondo-efectivo.patch` | `burgos2177-create/app-indirectos` | `calcSaldo` por fondo (estado-aware), pills 🏦/💵, gasto/depósito con fondo, **fix del service worker** (pantalla en blanco con señal intermitente). |

## Cómo aplicar (una vez con acceso de escritura al repo)

```bash
cd app-materiales   # o app-indirectos
git checkout -b claude/sogrubsuite-central-management-819dhk origin/main
git am ../appsogrub/patches/app-materiales-fondo-efectivo.patch
git push -u origin claude/sogrubsuite-central-management-819dhk
```

Cuando ambos parches estén pusheados a sus repos, esta carpeta puede borrarse.
Contrato del módulo: `../docs/spec-caja-chica-fondo-efectivo.md`.
