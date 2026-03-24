# ============================================================================
# Claude Usage Tracker — Instalador para Windows
# ============================================================================
# Uso: Haz clic derecho sobre este archivo → "Ejecutar con PowerShell"
#      O desde una terminal: .\install.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Claude Usage Tracker — Instalador" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ─── 1. Comprobar Node.js ────────────────────────────────────────────────────
Write-Host "[1/3] Comprobando Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  OK — Node.js $nodeVersion encontrado" -ForegroundColor Green
    } else {
        throw "Node.js no disponible"
    }
} catch {
    Write-Host "  ERROR — Node.js no está instalado." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Descárgalo desde: https://nodejs.org (versión LTS recomendada)" -ForegroundColor Yellow
    Write-Host "  Después de instalarlo, vuelve a ejecutar este script." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Pulsa Enter para salir"
    exit 1
}

# ─── 2. Instalar extensión VS Code ───────────────────────────────────────────
Write-Host ""
Write-Host "[2/3] Instalando extensión de VS Code..." -ForegroundColor Yellow

$vsixPath = Join-Path $ScriptDir "vscode-extension\claude-usage-tracker-1.1.0.vsix"

# Busca también la versión 1.0.0 por compatibilidad
if (-not (Test-Path $vsixPath)) {
    $vsixPath = Join-Path $ScriptDir "vscode-extension\claude-usage-tracker-1.0.0.vsix"
}

if (-not (Test-Path $vsixPath)) {
    Write-Host "  AVISO — No se encontró el archivo .vsix en vscode-extension\" -ForegroundColor Yellow
    Write-Host "  La extensión de VS Code no se instalará." -ForegroundColor Yellow
} else {
    try {
        $codeCmd = $null
        foreach ($cmd in @("code", "code-insiders")) {
            if (Get-Command $cmd -ErrorAction SilentlyContinue) {
                $codeCmd = $cmd
                break
            }
        }
        if ($null -eq $codeCmd) {
            Write-Host "  AVISO — VS Code no encontrado en el PATH." -ForegroundColor Yellow
            Write-Host "  Instala la extensión manualmente:" -ForegroundColor Yellow
            Write-Host "    code --install-extension `"$vsixPath`"" -ForegroundColor Cyan
        } else {
            & $codeCmd --install-extension $vsixPath --force
            Write-Host "  OK — Extensión instalada correctamente" -ForegroundColor Green
            Write-Host "  Configuración: Archivo > Preferencias > Configuración > busca 'Claude Usage'" -ForegroundColor Gray
            Write-Host "    claudeUsage.billingMode: 'api' o 'plan'" -ForegroundColor Gray
        }
    } catch {
        Write-Host "  ERROR al instalar la extensión: $_" -ForegroundColor Red
        Write-Host "  Instala manualmente: code --install-extension `"$vsixPath`"" -ForegroundColor Yellow
    }
}

# ─── 3. Crear acceso directo al script standalone ────────────────────────────
Write-Host ""
Write-Host "[3/3] Creando acceso directo en el escritorio..." -ForegroundColor Yellow

$scriptPath   = Join-Path $ScriptDir "claude-usage.js"
$desktopPath  = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath "Claude Usage (API).lnk"
$shortcutPlan = Join-Path $desktopPath "Claude Usage (Plan).lnk"

try {
    $wsh = New-Object -ComObject WScript.Shell

    # Acceso directo modo API
    $sc = $wsh.CreateShortcut($shortcutPath)
    $sc.TargetPath       = "node"
    $sc.Arguments        = "`"$scriptPath`""
    $sc.WorkingDirectory = $ScriptDir
    $sc.Description      = "Claude Usage Tracker — modo API (coste real)"
    $sc.Save()

    # Acceso directo modo Plan
    $sc2 = $wsh.CreateShortcut($shortcutPlan)
    $sc2.TargetPath       = "node"
    $sc2.Arguments        = "`"$scriptPath`" --plan"
    $sc2.WorkingDirectory = $ScriptDir
    $sc2.Description      = "Claude Usage Tracker — modo Plan (equiv. estimado)"
    $sc2.Save()

    Write-Host "  OK — Accesos directos creados en el escritorio:" -ForegroundColor Green
    Write-Host "    'Claude Usage (API).lnk'  — muestra coste real" -ForegroundColor Gray
    Write-Host "    'Claude Usage (Plan).lnk' — muestra equivalente estimado" -ForegroundColor Gray
} catch {
    Write-Host "  AVISO — No se pudieron crear los accesos directos: $_" -ForegroundColor Yellow
    Write-Host "  Ejecuta el script manualmente con:" -ForegroundColor Yellow
    Write-Host "    node `"$scriptPath`"          # modo API" -ForegroundColor Cyan
    Write-Host "    node `"$scriptPath`" --plan   # modo Plan" -ForegroundColor Cyan
}

# ─── Resumen final ────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Instalacion completada" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Cómo usar:" -ForegroundColor White
Write-Host "  Script standalone:" -ForegroundColor Yellow
Write-Host "    node `"$scriptPath`"          # facturación API" -ForegroundColor Cyan
Write-Host "    node `"$scriptPath`" --plan   # suscripción Plan" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Extensión VS Code:" -ForegroundColor Yellow
Write-Host "    Aparece en la barra de estado inferior derecha." -ForegroundColor Gray
Write-Host "    Clic → abre el reporte en el navegador." -ForegroundColor Gray
Write-Host "    Configurar modo Plan/API: busca 'Claude Usage' en la configuración." -ForegroundColor Gray
Write-Host ""
Read-Host "Pulsa Enter para salir"
