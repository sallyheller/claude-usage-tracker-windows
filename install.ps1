# ============================================================================
# Claude Usage Tracker — Instalador para Windows
# ============================================================================
#
# Uso: Haz clic derecho sobre este archivo → "Ejecutar con PowerShell"
#      O desde una terminal: .\install.ps1
#
# Qué hace:
#   1. Verifica que Node.js esté instalado
#   2. Instala la extensión de VS Code (si VS Code está disponible)
#   3. Lanza la app de bandeja del sistema (tray.ps1)
#   4. Registra la app en el inicio de Windows (opcional)
#   5. Crea accesos directos en el escritorio
#
# La carpeta de este script puede estar en un recurso compartido (SharePoint /
# OneDrive de empresa) y todos los compañeros ejecutan este install.ps1 desde ahí.
# Las actualizaciones se despliegan automáticamente en el siguiente reinicio.
# ============================================================================

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Claude Usage Tracker — Instalador" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ─── 1. Comprobar Node.js ────────────────────────────────────────────────────
Write-Host "[1/4] Comprobando Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = & node --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
    Write-Host "  OK — Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host ""
    Write-Host "  ERROR — Node.js no está instalado." -ForegroundColor Red
    Write-Host "  Descárgalo desde: https://nodejs.org  (versión LTS)" -ForegroundColor Yellow
    Write-Host "  Después de instalarlo, vuelve a ejecutar este script." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Pulsa Enter para salir"
    exit 1
}

# ─── 2. Instalar extensión VS Code ───────────────────────────────────────────
Write-Host ""
Write-Host "[2/4] Instalando extensión de VS Code..." -ForegroundColor Yellow

$vsixFiles = @(
    (Join-Path $ScriptDir "vscode-extension\claude-usage-tracker-1.1.0.vsix"),
    (Join-Path $ScriptDir "vscode-extension\claude-usage-tracker-1.0.0.vsix")
)
$vsixPath = $vsixFiles | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $vsixPath) {
    Write-Host "  AVISO — No se encontró el .vsix. Omitiendo extensión VS Code." -ForegroundColor Yellow
} else {
    $codeCmd = @("code","code-insiders") | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
    if (-not $codeCmd) {
        Write-Host "  AVISO — VS Code no encontrado en el PATH." -ForegroundColor Yellow
        Write-Host "  Para instalarlo manualmente: code --install-extension `"$vsixPath`"" -ForegroundColor Cyan
    } else {
        try {
            & $codeCmd --install-extension $vsixPath --force | Out-Null
            Write-Host "  OK — Extensión instalada en VS Code" -ForegroundColor Green
            Write-Host "  Configurar modo Plan/API: busca 'Claude Usage' en la Configuración de VS Code." -ForegroundColor Gray
        } catch {
            Write-Host "  ERROR al instalar: $_" -ForegroundColor Red
        }
    }
}

# ─── 3. Lanzar la bandeja del sistema ────────────────────────────────────────
Write-Host ""
Write-Host "[3/4] Lanzando la app de bandeja del sistema..." -ForegroundColor Yellow

$trayScript = Join-Path $ScriptDir "tray.ps1"
if (-not (Test-Path $trayScript)) {
    Write-Host "  ERROR — No se encontró tray.ps1 en: $ScriptDir" -ForegroundColor Red
} else {
    # Registrar en el startup de Windows (VBScript sin ventana de consola)
    $startupVbs  = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\ClaudeUsageTracker.vbs"
    $vbsContent  = @"
Dim sh : Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & "$trayScript" & """", 0, False
"@
    $vbsContent | Set-Content $startupVbs -Encoding ASCII
    Write-Host "  OK — Registrado en el inicio de Windows" -ForegroundColor Green

    # Lanzar ahora mismo (sin ventana)
    $alreadyRunning = Get-Process -Name "powershell" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*tray.ps1*" }
    if ($alreadyRunning) {
        Write-Host "  INFO — La bandeja ya estaba en ejecución (no se relanza)" -ForegroundColor Cyan
    } else {
        Start-Process "powershell.exe" -ArgumentList "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$trayScript`"" -WindowStyle Hidden
        Write-Host "  OK — Bandeja del sistema iniciada" -ForegroundColor Green
    }
}

# ─── 4. Crear accesos directos en el escritorio ──────────────────────────────
Write-Host ""
Write-Host "[4/4] Creando accesos directos en el escritorio..." -ForegroundColor Yellow

$desktop  = [Environment]::GetFolderPath("Desktop")
$usageJs  = Join-Path $ScriptDir "claude-usage.js"
$wsh      = New-Object -ComObject WScript.Shell

try {
    # Acceso directo: reporte HTML modo API
    $sc = $wsh.CreateShortcut((Join-Path $desktop "Claude Usage — Reporte (API).lnk"))
    $sc.TargetPath       = "node"
    $sc.Arguments        = "`"$usageJs`""
    $sc.WorkingDirectory = $ScriptDir
    $sc.Description      = "Abre el reporte HTML de Claude Code (modo API)"
    $sc.Save()

    # Acceso directo: reporte HTML modo Plan
    $sc2 = $wsh.CreateShortcut((Join-Path $desktop "Claude Usage — Reporte (Plan).lnk"))
    $sc2.TargetPath       = "node"
    $sc2.Arguments        = "`"$usageJs`" --plan"
    $sc2.WorkingDirectory = $ScriptDir
    $sc2.Description      = "Abre el reporte HTML de Claude Code (modo Plan)"
    $sc2.Save()

    Write-Host "  OK — Accesos directos creados en el escritorio" -ForegroundColor Green
} catch {
    Write-Host "  AVISO — No se pudieron crear los accesos directos: $_" -ForegroundColor Yellow
}

# ─── Resumen ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Instalación completada" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Qué tienes ahora:" -ForegroundColor White
Write-Host "  Bandeja del sistema:" -ForegroundColor Yellow
Write-Host "    Busca el icono naranja '`$' en la esquina inferior derecha." -ForegroundColor Gray
Write-Host "    · Clic izquierdo → abre el reporte HTML completo" -ForegroundColor Gray
Write-Host "    · Clic derecho   → menú con stats y opciones" -ForegroundColor Gray
Write-Host "    · Se inicia automáticamente con Windows" -ForegroundColor Gray
Write-Host ""
Write-Host "  Reporte HTML desde terminal:" -ForegroundColor Yellow
Write-Host "    node `"$usageJs`"          # facturación API" -ForegroundColor Cyan
Write-Host "    node `"$usageJs`" --plan   # suscripción Plan" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Extensión VS Code:" -ForegroundColor Yellow
Write-Host "    Barra de estado inferior derecha. Clic → abre el reporte." -ForegroundColor Gray
Write-Host "    Configura el modo en: Archivo > Preferencias > Configuración > 'Claude Usage'." -ForegroundColor Gray
Write-Host ""
Read-Host "Pulsa Enter para salir"
