# Claude Usage Tracker for Windows

Herramienta para monitorizar el uso de tokens y costes de **Claude Code** en Windows.
Basada en [masorange/ClaudeUsageTracker](https://github.com/masorange/ClaudeUsageTracker), adaptada y mejorada para Windows.

---

## Características

- **Reporte HTML** con desglose por mes, proyecto y modelo
- **Extensión VS Code** con coste en la barra de estado en tiempo real
- **Modo API** — muestra el coste real por tokens
- **Modo Plan** — muestra el equivalente estimado de API (para suscripciones Max/Pro)
- Sin dependencias externas (solo Node.js)

---

## Requisitos

- [Node.js](https://nodejs.org) (v16 o superior, LTS recomendada)
- Windows 10/11
- Claude Code instalado y con al menos una sesión registrada

---

## Instalación rápida

### Opción A — Instalador automático (recomendado para compañeros)

1. Descarga o clona este repositorio
2. Haz clic derecho sobre `install.ps1` → **"Ejecutar con PowerShell"**

El script:
- Verifica que Node.js esté instalado
- Instala la extensión de VS Code automáticamente
- Crea dos accesos directos en el escritorio (modo API y modo Plan)

> Si Windows bloquea la ejecución del script, abre PowerShell como administrador y ejecuta:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

---

### Opción B — Manual

#### Script standalone

```powershell
# Modo API (coste real por tokens)
node claude-usage.js

# Modo Plan (equivalente estimado — suscripción plana)
node claude-usage.js --plan
```

Genera un HTML y lo abre en el navegador por defecto.

#### Extensión VS Code

```powershell
code --install-extension vscode-extension\claude-usage-tracker-1.1.0.vsix
```

Aparecerá `$(credit-card) $X.XX / $Y.YY` en la barra de estado inferior derecha.
Haz clic para abrir el reporte HTML completo.

---

## Modo API vs Modo Plan

| | Modo `api` | Modo `plan` |
|---|---|---|
| **Para quién** | Usuarios con facturación por tokens | Suscriptores Claude Max / Pro |
| **Costes mostrados** | Coste real en USD | Equivalente estimado de API (referencia) |
| **Barra de estado** | `$0.42 / $3.81` | `~$0.42 / ~$3.81` |
| **Banner en reporte** | No | Sí, con aviso informativo |

### Configurar en VS Code

Abre **Archivo → Preferencias → Configuración** y busca `Claude Usage`:

| Ajuste | Valores | Por defecto |
|---|---|---|
| `claudeUsage.billingMode` | `api` / `plan` | `api` |
| `claudeUsage.refreshIntervalSeconds` | Número (mín. 10) | `60` |

O edita `settings.json` directamente:

```json
{
  "claudeUsage.billingMode": "plan",
  "claudeUsage.refreshIntervalSeconds": 30
}
```

---

## Estructura del repositorio

```
claude-usage-tracker-windows/
├── claude-usage.js          Script standalone (genera reporte HTML)
├── install.ps1              Instalador automático para Windows
├── README.md
└── vscode-extension/
    ├── extension.js         Código fuente de la extensión
    ├── package.json         Manifiesto de la extensión
    └── claude-usage-tracker-1.1.0.vsix  Extensión empaquetada
```

---

## Precios de los modelos

Los precios usados (USD por millón de tokens) son los oficiales de la API de Anthropic:

| Modelo | Entrada | Cache escr. | Cache lect. | Salida |
|---|---|---|---|---|
| Sonnet 4.6 / 3.7 / 3.5 | $3.00 | $3.75 | $0.30 | $15.00 |
| Opus 4.6 / 4.5 / 3 | $15.00 | $18.75 | $1.50 | $75.00 |
| Haiku 4.5 / 3.5 | $0.80 | $1.00 | $0.08 | $4.00 |
| Haiku 3 | $0.25 | $0.30 | $0.03 | $1.25 |

---

## Cómo funciona

Claude Code guarda el historial de conversaciones en archivos `.jsonl` dentro de:

```
%USERPROFILE%\.claude\projects\
```

El tracker lee esos archivos, extrae los datos de uso (`input_tokens`, `output_tokens`, `cache_*_tokens`) y calcula el coste según el modelo usado.

---

## Créditos

- Proyecto original: [masorange/ClaudeUsageTracker](https://github.com/masorange/ClaudeUsageTracker)
- Adaptación Windows + mejoras: [sallyheller/claude-usage-tracker-windows](https://github.com/sallyheller/claude-usage-tracker-windows)
