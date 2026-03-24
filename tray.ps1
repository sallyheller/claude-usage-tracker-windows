#Requires -Version 5.1
<#
.SYNOPSIS
    Claude Usage Tracker — Bandeja del sistema Windows
.DESCRIPTION
    Muestra el gasto de Claude Code en el icono de la bandeja del sistema.
    Lee ~/.claude/projects/*.jsonl directamente. No requiere dependencias.
    Clic izquierdo / doble clic → abre el reporte HTML completo.
    Clic derecho → menú con stats, opciones y configuración.
.NOTES
    Ejecutar oculto: powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File tray.ps1
#>

# ─── Instancia única (mutex) ─────────────────────────────────────────────────
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:mutex = New-Object System.Threading.Mutex($false, "Global\ClaudeUsageTrackerTray")
if (-not $script:mutex.WaitOne(0, $false)) {
    [System.Windows.Forms.MessageBox]::Show(
        "Claude Usage Tracker ya está en ejecución.`nBúscalo en la bandeja del sistema (esquina inferior derecha).",
        "Claude Usage Tracker",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    exit 0
}

# ─── Rutas ───────────────────────────────────────────────────────────────────
$script:SCRIPT_DIR  = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:USAGE_JS    = Join-Path $script:SCRIPT_DIR "claude-usage.js"
$script:CONFIG_PATH = Join-Path $env:APPDATA "ClaudeUsageTracker\config.json"
$script:STARTUP_VBS = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\ClaudeUsageTracker.vbs"

# ─── Config ──────────────────────────────────────────────────────────────────
function script:Load-Config {
    $default = [PSCustomObject]@{ mode = "api"; startWithWindows = $false }
    if (-not (Test-Path $script:CONFIG_PATH)) { return $default }
    try {
        $c = Get-Content $script:CONFIG_PATH -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $c.PSObject.Properties["mode"])             { $c | Add-Member -NotePropertyName mode             -NotePropertyValue "api"   }
        if (-not $c.PSObject.Properties["startWithWindows"]) { $c | Add-Member -NotePropertyName startWithWindows -NotePropertyValue $false }
        return $c
    } catch { return $default }
}

function script:Save-Config {
    $dir = Split-Path $script:CONFIG_PATH
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $script:config | ConvertTo-Json | Set-Content $script:CONFIG_PATH -Encoding UTF8
}

$script:config = Load-Config

# ─── Precios (USD / millón de tokens) ────────────────────────────────────────
$script:PRICING = @{
    "sonnet-4-6" = @{ i = 3.00;  cw = 3.75;  cr = 0.30; o = 15.00 }
    "sonnet-3-7" = @{ i = 3.00;  cw = 3.75;  cr = 0.30; o = 15.00 }
    "sonnet-3-5" = @{ i = 3.00;  cw = 3.75;  cr = 0.30; o = 15.00 }
    "opus-4-6"   = @{ i = 15.00; cw = 18.75; cr = 1.50; o = 75.00 }
    "opus-4-5"   = @{ i = 15.00; cw = 18.75; cr = 1.50; o = 75.00 }
    "opus-3"     = @{ i = 15.00; cw = 18.75; cr = 1.50; o = 75.00 }
    "haiku-4-5"  = @{ i = 0.80;  cw = 1.00;  cr = 0.08; o = 4.00  }
    "haiku-3-5"  = @{ i = 0.80;  cw = 1.00;  cr = 0.08; o = 4.00  }
    "haiku-3"    = @{ i = 0.25;  cw = 0.30;  cr = 0.03; o = 1.25  }
    "default"    = @{ i = 3.00;  cw = 3.75;  cr = 0.30; o = 15.00 }
}

function script:Get-Cost($usage, $model) {
    $p = $script:PRICING["default"]
    if ($model) {
        foreach ($key in $script:PRICING.Keys) {
            if ($key -ne "default" -and $model -like "*$key*") { $p = $script:PRICING[$key]; break }
        }
    }
    $M = 1000000.0
    return (
        ([double]$usage.input_tokens                / $M) * $p.i  +
        ([double]$usage.cache_creation_input_tokens / $M) * $p.cw +
        ([double]$usage.cache_read_input_tokens     / $M) * $p.cr +
        ([double]$usage.output_tokens               / $M) * $p.o
    )
}

# ─── Lectura de datos ─────────────────────────────────────────────────────────
function script:Get-UsageData {
    $projectsDir = Join-Path $env:USERPROFILE ".claude\projects"
    if (-not (Test-Path $projectsDir)) { return $null }

    $totalCost    = 0.0
    $todayCost    = 0.0
    $byMonth      = @{}
    $today        = (Get-Date).ToString("yyyy-MM-dd")
    $currentMonth = (Get-Date).ToString("yyyy-MM")

    Get-ChildItem $projectsDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        Get-ChildItem $_.FullName -Filter "*.jsonl" -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $reader = [System.IO.StreamReader]::new($_.FullName, [System.Text.Encoding]::UTF8)
                while (($line = $reader.ReadLine()) -ne $null) {
                    if ($line.Length -lt 20) { continue }
                    try {
                        $e = $line | ConvertFrom-Json -ErrorAction Stop
                        if ($e.type -ne "assistant") { continue }
                        $usage = $e.message.usage
                        if (-not $usage) { continue }
                        $model = if ($e.message.model) { $e.message.model } else { "" }
                        if ($model -eq "<synthetic>") { continue }
                        $ts = if ($e.timestamp) { $e.timestamp } else { "" }
                        if ($ts.Length -lt 7) { continue }

                        $cost  = script:Get-Cost $usage $model
                        $month = $ts.Substring(0, 7)
                        $day   = if ($ts.Length -ge 10) { $ts.Substring(0, 10) } else { "" }

                        $totalCost += $cost
                        if ($byMonth.ContainsKey($month)) { $byMonth[$month] += $cost } else { $byMonth[$month] = $cost }
                        if ($day -eq $today) { $todayCost += $cost }
                    } catch { }
                }
                $reader.Close(); $reader.Dispose()
            } catch { }
        }
    }

    return @{
        Total        = [math]::Round($totalCost, 6)
        Today        = [math]::Round($todayCost, 6)
        CurrentMonth = [math]::Round((if ($byMonth.ContainsKey($currentMonth)) { $byMonth[$currentMonth] } else { 0.0 }), 6)
        Month        = $currentMonth
    }
}

# ─── Startup ─────────────────────────────────────────────────────────────────
function script:Test-StartupEntry { return (Test-Path $script:STARTUP_VBS) }

function script:Enable-Startup {
    $psFile = $MyInvocation.MyCommand.Path
    $vbs = @"
Dim sh : Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & "$psFile" & """", 0, False
"@
    $vbs | Set-Content $script:STARTUP_VBS -Encoding ASCII
    $script:config.startWithWindows = $true
    script:Save-Config
}

function script:Disable-Startup {
    if (Test-Path $script:STARTUP_VBS) { Remove-Item $script:STARTUP_VBS -Force -ErrorAction SilentlyContinue }
    $script:config.startWithWindows = $false
    script:Save-Config
}

# ─── Icono (círculo naranja con $) ───────────────────────────────────────────
function script:New-TrayIcon {
    try {
        $bmp  = New-Object System.Drawing.Bitmap(16, 16)
        $g    = [System.Drawing.Graphics]::FromImage($bmp)
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

        $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 100, 0))
        $g.FillEllipse($bgBrush, 0, 0, 15, 15)
        $bgBrush.Dispose()

        $font  = New-Object System.Drawing.Font("Arial", 8, [System.Drawing.FontStyle]::Bold)
        $fgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $sf    = New-Object System.Drawing.StringFormat
        $sf.Alignment     = [System.Drawing.StringAlignment]::Center
        $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
        $rect  = New-Object System.Drawing.RectangleF(0, 1, 16, 15)
        $g.DrawString("`$", $font, $fgBrush, $rect, $sf)

        $font.Dispose(); $fgBrush.Dispose(); $sf.Dispose(); $g.Dispose()
        $ptr  = $bmp.GetHicon()
        $icon = [System.Drawing.Icon]::FromHandle($ptr)
        $bmp.Dispose()
        return $icon
    } catch {
        return [System.Drawing.SystemIcons]::Application
    }
}

# ─── Abrir reporte HTML ───────────────────────────────────────────────────────
function script:Open-Report {
    if (-not (Test-Path $script:USAGE_JS)) {
        [System.Windows.Forms.MessageBox]::Show(
            "No se encontró claude-usage.js en:`n$script:SCRIPT_DIR`n`nAsegúrate de que la carpeta del tracker está completa.",
            "Claude Usage Tracker",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        ) | Out-Null
        return
    }

    try {
        $mode = if ($script:config.mode -eq "plan") { "--plan" } else { "" }
        if ($mode) {
            $p = Start-Process "node" -ArgumentList "`"$script:USAGE_JS`"", $mode -WindowStyle Hidden -PassThru -Wait
        } else {
            $p = Start-Process "node" -ArgumentList "`"$script:USAGE_JS`"" -WindowStyle Hidden -PassThru -Wait
        }
        $htmlFile = Join-Path $env:TEMP "claude-usage-report.html"
        if (Test-Path $htmlFile) {
            Start-Process "rundll32.exe" -ArgumentList "url.dll,FileProtocolHandler `"$htmlFile`""
        }
    } catch {
        [System.Windows.Forms.MessageBox]::Show(
            "Error al generar el reporte. ¿Está Node.js instalado?`n`n$_",
            "Claude Usage Tracker",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}

# ─── Actualizar display (tooltip + labels del menú) ──────────────────────────
function script:Update-Display {
    $isPlan = ($script:config.mode -eq "plan")
    $prefix = if ($isPlan) { "~" } else { "" }

    try {
        $script:data = script:Get-UsageData
    } catch {
        $script:data = $null
    }

    if ($null -eq $script:data) {
        $script:tray.Text = "Claude Cost"
        if ($script:itemMes)   { $script:itemMes.Text   = "  Este mes:   sin datos" }
        if ($script:itemHoy)   { $script:itemHoy.Text   = "  Hoy:        sin datos" }
        if ($script:itemTotal) { $script:itemTotal.Text = "  Total:      sin datos" }
        return
    }

    try {
        $mes   = [double]$script:data["CurrentMonth"]
        $hoy   = [double]$script:data["Today"]
        $total = [double]$script:data["Total"]

        $tip = "Claude $prefix`$$([math]::Round($mes,2))/mes  $prefix`$$([math]::Round($total,2)) total"
        $script:tray.Text = if ($tip.Length -gt 63) { $tip.Substring(0, 63) } else { $tip }

        if ($script:itemMes)   { $script:itemMes.Text   = "  Este mes:   $prefix`$$('{0:F4}' -f $mes)" }
        if ($script:itemHoy)   { $script:itemHoy.Text   = "  Hoy:        $prefix`$$('{0:F4}' -f $hoy)" }
        if ($script:itemTotal) { $script:itemTotal.Text = "  Total:      $prefix`$$('{0:F4}' -f $total)" }
    } catch {
        $script:tray.Text = "Claude Cost"
        if ($script:itemMes)   { $script:itemMes.Text   = "  Este mes:   error" }
        if ($script:itemHoy)   { $script:itemHoy.Text   = "  Hoy:        error" }
        if ($script:itemTotal) { $script:itemTotal.Text = "  Total:      error" }
    }
}

# ─── Construir menú contextual ───────────────────────────────────────────────
function script:Build-Menu {
    $menu = New-Object System.Windows.Forms.ContextMenuStrip
    $menu.Font = New-Object System.Drawing.Font("Segoe UI", 9)

    # ── Stats (no clicables) ──
    $script:itemMes   = New-Object System.Windows.Forms.ToolStripMenuItem("  Este mes:   cargando...")
    $script:itemHoy   = New-Object System.Windows.Forms.ToolStripMenuItem("  Hoy:        ...")
    $script:itemTotal = New-Object System.Windows.Forms.ToolStripMenuItem("  Total:      ...")
    foreach ($it in @($script:itemMes, $script:itemHoy, $script:itemTotal)) {
        $it.Enabled = $false
        $it.Font    = New-Object System.Drawing.Font("Consolas", 9)
        $menu.Items.Add($it) | Out-Null
    }

    $menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

    # ── Ver reporte ──
    $itemReport = New-Object System.Windows.Forms.ToolStripMenuItem("  Ver reporte completo")
    $itemReport.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $itemReport.Add_Click({ script:Open-Report }) | Out-Null
    $menu.Items.Add($itemReport) | Out-Null

    # ── Actualizar ──
    $itemRefresh = New-Object System.Windows.Forms.ToolStripMenuItem("  Actualizar ahora")
    $itemRefresh.Add_Click({ script:Update-Display }) | Out-Null
    $menu.Items.Add($itemRefresh) | Out-Null

    $menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

    # ── Modo facturacion ──
    $itemMode = New-Object System.Windows.Forms.ToolStripMenuItem("  Modo de facturacion")

    $script:itemApi  = New-Object System.Windows.Forms.ToolStripMenuItem("  API  -  coste real por tokens")
    $script:itemPlan = New-Object System.Windows.Forms.ToolStripMenuItem("  Plan -  equivalente estimado (Max/Pro)")
    $script:itemApi.Checked  = ($script:config.mode -eq "api")
    $script:itemPlan.Checked = ($script:config.mode -eq "plan")

    $script:itemApi.Add_Click({
        $script:config.mode = "api"
        $script:itemApi.Checked  = $true
        $script:itemPlan.Checked = $false
        script:Save-Config; script:Update-Display
    }) | Out-Null
    $script:itemPlan.Add_Click({
        $script:config.mode = "plan"
        $script:itemPlan.Checked = $true
        $script:itemApi.Checked  = $false
        script:Save-Config; script:Update-Display
    }) | Out-Null

    $itemMode.DropDownItems.Add($script:itemApi)  | Out-Null
    $itemMode.DropDownItems.Add($script:itemPlan) | Out-Null
    $menu.Items.Add($itemMode) | Out-Null

    $menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

    # ── Iniciar con Windows ──
    $script:itemStartup = New-Object System.Windows.Forms.ToolStripMenuItem("  Iniciar con Windows")
    $script:itemStartup.Checked = (script:Test-StartupEntry)
    $script:itemStartup.Add_Click({
        if (script:Test-StartupEntry) {
            script:Disable-Startup
            $script:itemStartup.Checked = $false
        } else {
            script:Enable-Startup
            $script:itemStartup.Checked = $true
        }
    }) | Out-Null
    $menu.Items.Add($script:itemStartup) | Out-Null

    $menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

    # ── Salir ──
    $itemExit = New-Object System.Windows.Forms.ToolStripMenuItem("  Salir")
    $itemExit.Add_Click({
        $script:tray.Visible = $false
        $script:timer.Stop()
        try { $script:mutex.ReleaseMutex() } catch {}
        [System.Windows.Forms.Application]::Exit()
    }) | Out-Null
    $menu.Items.Add($itemExit) | Out-Null

    return $menu
}

# ─── MAIN ────────────────────────────────────────────────────────────────────
$script:data = $null

# Crear icono en la bandeja
$script:tray = New-Object System.Windows.Forms.NotifyIcon
$script:tray.Icon    = script:New-TrayIcon
$script:tray.Visible = $true
$script:tray.Text    = "Claude Usage Tracker - iniciando..."

# Clic izquierdo y doble clic → abrir reporte
$script:tray.Add_MouseClick({
    if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) { script:Open-Report }
}) | Out-Null
$script:tray.Add_DoubleClick({ script:Open-Report }) | Out-Null

# Construir y asignar menú contextual
$script:tray.ContextMenuStrip = script:Build-Menu

# Timer de refresco automático (cada 60 segundos)
$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = 60000
$script:timer.Add_Tick({ script:Update-Display }) | Out-Null
$script:timer.Start()

# Primera carga de datos
script:Update-Display

# Notificación de bienvenida
$script:tray.ShowBalloonTip(
    4000,
    "Claude Usage Tracker",
    "Activo en la bandeja. Clic para ver el reporte.",
    [System.Windows.Forms.ToolTipIcon]::Info
)

# Bucle de mensajes de Windows Forms
[System.Windows.Forms.Application]::Run()
