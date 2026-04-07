# Claude Usage Tracker for Windows

Monitor de uso de tokens y costes de **Claude Code** en Windows.
Inspirado en [masorange/ClaudeUsageTracker](https://github.com/masorange/ClaudeUsageTracker) (macOS), portado y mejorado para Windows.

---

## Instalación

```
npm install -g @diegoalvarezf/claude-usage-tracker
```

Eso es todo. El instalador:
- Lanza el icono `$` en la **bandeja del sistema** automáticamente
- Lo registra para que **arranque con Windows**
- Deja los comandos `claude-usage` y `claude-usage-tray` disponibles en el PATH

**Requisito único:** [Node.js](https://nodejs.org) v16+ (LTS recomendada)

---

## Características

| | |
|---|---|
| Icono naranja en la bandeja del sistema con gasto del mes | ✅ |
| Popup moderno con stats en tiempo real (hoy / mes / total) | ✅ |
| Reporte HTML con tabs: **Por Mes · Por Proyecto · Por Modelo** | ✅ |
| Tarjeta de gasto de **hoy** | ✅ |
| **Export CSV** desde el reporte | ✅ |
| Modo **API** (coste real) y **Plan** (equiv. estimado Max/Pro) | ✅ |
| Toggle "Iniciar con Windows" desde el propio menú | ✅ |
| Extensión VS Code con coste en la barra de estado | ✅ |
| Sin dependencias externas (solo Node.js) | ✅ |

---

## Uso

### Bandeja del sistema

Después de instalar aparece un icono naranja **`$`** en la bandeja (esquina inferior derecha).

| Acción | Resultado |
|---|---|
| **Clic izquierdo** | Abre el reporte HTML en el navegador |
| **Clic derecho** | Popup con stats y opciones |

**Popup:**
```
┌─────────────────────────────────┐
│ Claude Cost                 API │
├─────────────────────────────────┤
│ Este mes              $1.2345   │
│ Hoy                   $0.0123   │
│ Total                 $8.9012   │
├─────────────────────────────────┤
│ [Ver reporte]      [Actualizar] │
├─────────────────────────────────┤
│ [Modo: API]  [Arranque]  [Salir]│
└─────────────────────────────────┘
```

### Comandos

```bash
claude-usage              # reporte HTML — modo API
claude-usage --plan       # reporte HTML — modo Plan (suscripción plana)
claude-usage-tray         # relanzar la bandeja si se cierra
```

### Reporte HTML

El reporte incluye tres tabs:

- **Por Mes** — desglose mensual por proyecto, colapsable por mes, barras de progreso y badges por modelo
- **Por Proyecto** — ranking acumulado de todos los proyectos
- **Por Modelo** — tokens y costes por modelo (Sonnet, Opus, Haiku...)

Botón **⬇ Exportar CSV** para descargar todos los datos en un clic.

---

## Modo API vs Modo Plan

| | Modo `api` | Modo `plan` |
|---|---|---|
| **Para quién** | Facturación directa por tokens | Suscripción Claude Max / Pro |
| **Costes mostrados** | Coste real en USD | Equivalente estimado de API |
| **Bandeja** | `$1.23 / $9.45` | `~$1.23 / ~$9.45` |

Cambiar modo desde el popup: clic derecho → botón **Modo: API / Plan**.

---

## Actualizar

```
npm update -g @diegoalvarezf/claude-usage-tracker
```

---

## Extensión VS Code (opcional)

La extensión muestra el coste en la barra de estado inferior derecha de VS Code.
Instalar desde el `.vsix` incluido en la carpeta `vscode-extension/`:

```
code --install-extension vscode-extension\claude-usage-tracker-1.1.1.vsix
```

**Configuración** (busca "Claude Usage" en la Configuración de VS Code):

| Ajuste | Valores | Por defecto |
|---|---|---|
| `claudeUsage.billingMode` | `api` / `plan` | `api` |
| `claudeUsage.refreshIntervalSeconds` | Número (mín. 10) | `60` |

---

## Instalación manual (sin npm)

Si prefieres instalar sin npm, desde la carpeta del proyecto:

```powershell
# Clic derecho → "Ejecutar con PowerShell", o:
powershell -ExecutionPolicy Bypass -File install.ps1
```

Útil para despliegue desde una **carpeta compartida de empresa** (SharePoint / OneDrive):
coloca la carpeta en el recurso compartido y cada compañero ejecuta `install.ps1` una sola vez.
Las actualizaciones llegan automáticamente al reiniciar Windows.

---

## Estructura del repositorio

```
claude-usage-tracker-windows/
├── claude-usage.js          Generador del reporte HTML (bin: claude-usage)
├── tray.ps1                 App de bandeja del sistema (PowerShell puro)
├── tray-launcher.js         Relanzador de la bandeja (bin: claude-usage-tray)
├── postinstall.js           Setup automático tras npm install -g
├── orange-logo.svg          Logo Orange (favicon y topbar del reporte)
├── install.ps1              Instalador manual (alternativa al npm)
├── package.json             Manifiesto npm
├── README.md
└── vscode-extension/
    ├── extension.js
    ├── package.json
    └── claude-usage-tracker-1.1.2.vsix
```

---

## Precios de los modelos

Precios oficiales de la API de Anthropic (USD por millón de tokens) — _última actualización: abril 2026_:

| Modelo | Entrada | Cache escr. | Cache lect. | Salida |
|---|---|---|---|---|
| Sonnet 4.6 / 3.7 / 3.5 | $3.00 | $3.75 | $0.30 | $15.00 |
| Opus 4.6 / 4.5 | $5.00 | $6.25 | $0.50 | $25.00 |
| Opus 3 | $15.00 | $18.75 | $1.50 | $75.00 |
| Haiku 4.5 | $1.00 | $1.25 | $0.10 | $5.00 |
| Haiku 3.5 | $0.80 | $1.00 | $0.08 | $4.00 |
| Haiku 3 | $0.25 | $0.30 | $0.03 | $1.25 |

---

## Cómo funciona

Claude Code guarda el historial en archivos `.jsonl` en `%USERPROFILE%\.claude\projects\`.
El tracker los lee directamente, extrae los tokens de uso y calcula el coste por modelo.
No envía ningún dato a servidores externos.

---

## Créditos

- Original (macOS, Swift): [masorange/ClaudeUsageTracker](https://github.com/masorange/ClaudeUsageTracker)
- Adaptación Windows: [diegoalvarezf/claude-usage-tracker-windows](https://github.com/diegoalvarezf/claude-usage-tracker-windows)
