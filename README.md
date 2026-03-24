# Claude Usage Tracker for Windows

Herramienta para monitorizar en tiempo real el uso de tokens y costes de **Claude Code** en Windows.
Inspirada en [masorange/ClaudeUsageTracker](https://github.com/masorange/ClaudeUsageTracker) (macOS), portada y mejorada para Windows.

---

## Características

| Feature | Estado |
|---|---|
| Icono en la bandeja del sistema con gasto del mes | ✅ |
| Menú contextual con stats (hoy / mes / total) | ✅ |
| Reporte HTML con tabs (Mes · Proyecto · Modelo) | ✅ |
| Gasto de hoy y gasto acumulado | ✅ |
| Export CSV desde el reporte | ✅ |
| Modo **API** (coste real) y **Plan** (equiv. estimado) | ✅ |
| Toggle "Iniciar con Windows" desde el menú | ✅ |
| Extensión VS Code con coste en la barra de estado | ✅ |
| Sin dependencias externas (solo Node.js) | ✅ |
| Desplegable desde carpeta compartida (SharePoint/OneDrive) | ✅ |

---

## Requisitos

- Windows 10 / 11
- [Node.js](https://nodejs.org) v16+ (LTS recomendada)
- Claude Code instalado y con al menos una sesión registrada

---

## Instalación rápida (recomendada para equipos)

### Desde carpeta compartida (SharePoint / OneDrive de empresa)

Si tienes acceso a la carpeta compartida del equipo, el proceso es:

1. Navega a la carpeta compartida donde está este proyecto
2. Haz clic derecho sobre `install.ps1` → **"Ejecutar con PowerShell"**
3. Listo — la bandeja del sistema aparece al instante

> Si Windows bloquea la ejecución, abre PowerShell y ejecuta primero:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

**Ventaja del despliegue desde carpeta compartida:**
Cuando se actualiza la carpeta compartida, todos los usuarios reciben la nueva versión automáticamente en el siguiente reinicio de Windows (el `.vbs` de startup apunta a la carpeta compartida).

---

### Instalación manual (desde el repositorio)

```powershell
git clone https://github.com/sallyheller/claude-usage-tracker-windows.git
cd claude-usage-tracker-windows
.\install.ps1
```

---

## Cómo usarlo

### Bandeja del sistema

Después de instalar, aparece un icono naranja **`$`** en la bandeja (esquina inferior derecha).

| Acción | Resultado |
|---|---|
| **Clic izquierdo** | Abre el reporte HTML completo en el navegador |
| **Doble clic** | Abre el reporte HTML completo |
| **Clic derecho** | Menú contextual con stats y opciones |

**Menú contextual:**
```
  Este mes:   $1.2345
  Hoy:        $0.0123
  Total:      $8.9012
  ─────────────────────────
  📊  Ver reporte completo
  ↻  Actualizar ahora
  ─────────────────────────
  Modo de facturación
    ● API — coste real por tokens
    ○ Plan — equivalente estimado (Max/Pro)
  ─────────────────────────
  Iniciar con Windows  ✓
  ─────────────────────────
  Salir
```

### Reporte HTML

El reporte incluye tres tabs:

- **Por Mes** — desglose mensual por proyecto con barras de progreso y badges por modelo
- **Por Proyecto** — ranking acumulado de todos los proyectos
- **Por Modelo** — tokens y costes por modelo (Sonnet, Opus, Haiku...)

Botón **⬇ Exportar CSV** para descargar todos los datos.

### Script standalone (sin bandeja)

```powershell
# Modo API (coste real — para usuarios con facturación por tokens)
node claude-usage.js

# Modo Plan (equiv. estimado — para suscriptores Claude Max/Pro)
node claude-usage.js --plan
```

### Extensión VS Code

Aparece `$(credit-card) $X.XX / $Y.YY` en la barra de estado inferior derecha.
Clic → abre el reporte HTML.

**Configuración** (Archivo → Preferencias → Configuración → busca "Claude Usage"):

| Ajuste | Valores | Por defecto |
|---|---|---|
| `claudeUsage.billingMode` | `api` / `plan` | `api` |
| `claudeUsage.refreshIntervalSeconds` | Número (mín. 10) | `60` |

---

## Modo API vs Modo Plan

| | Modo `api` | Modo `plan` |
|---|---|---|
| **Para quién** | Facturación directa por tokens | Suscripción Claude Max / Pro |
| **Costes mostrados** | Coste real en USD | Equivalente estimado de API |
| **Bandeja** | `$1.23 / $9.45` | `~$1.23 / ~$9.45` |
| **Banner en reporte** | No | Sí, con aviso informativo |

---

## Estructura del repositorio

```
claude-usage-tracker-windows/
├── tray.ps1                 App de bandeja del sistema (PowerShell puro, sin deps)
├── claude-usage.js          Generador del reporte HTML (Node.js)
├── install.ps1              Instalador automático
├── README.md
└── vscode-extension/
    ├── extension.js         Código fuente de la extensión
    ├── package.json
    └── claude-usage-tracker-1.1.0.vsix
```

---

## Precios de los modelos

Precios oficiales de la API de Anthropic (USD por millón de tokens):

| Modelo | Entrada | Cache escr. | Cache lect. | Salida |
|---|---|---|---|---|
| Sonnet 4.6 / 3.7 / 3.5 | $3.00 | $3.75 | $0.30 | $15.00 |
| Opus 4.6 / 4.5 / 3 | $15.00 | $18.75 | $1.50 | $75.00 |
| Haiku 4.5 / 3.5 | $0.80 | $1.00 | $0.08 | $4.00 |
| Haiku 3 | $0.25 | $0.30 | $0.03 | $1.25 |

---

## Cómo funciona

Claude Code guarda el historial en archivos `.jsonl` dentro de:
```
%USERPROFILE%\.claude\projects\
```
El tracker lee esos archivos, extrae los tokens de uso y calcula el coste según el modelo. No envía datos a ningún servidor externo.

---

## Créditos

- Proyecto original (macOS): [masorange/ClaudeUsageTracker](https://github.com/masorange/ClaudeUsageTracker)
- Adaptación Windows: [sallyheller/claude-usage-tracker-windows](https://github.com/sallyheller/claude-usage-tracker-windows)
