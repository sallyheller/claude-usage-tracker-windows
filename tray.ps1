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

    $projectDirs = [System.IO.Directory]::GetDirectories($projectsDir)
    foreach ($dir in $projectDirs) {
        try {
            $jsonlFiles = [System.IO.Directory]::GetFiles($dir, "*.jsonl")
        } catch { continue }
        foreach ($filePath in $jsonlFiles) {
            try {
                $reader = [System.IO.StreamReader]::new($filePath, [System.Text.Encoding]::UTF8)
                while (($line = $reader.ReadLine()) -ne $null) {
                    if ($line.Length -lt 20) { continue }
                    try {
                        $e = $line | ConvertFrom-Json -ErrorAction Stop
                        if ($e.type -ne "assistant") { continue }
                        $usage = $e.message.usage
                        if (-not $usage) { continue }
                        $model = if ($e.message.model) { [string]$e.message.model } else { "" }
                        if ($model -eq "<synthetic>") { continue }
                        $ts = if ($e.timestamp) { [string]$e.timestamp } else { "" }
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

    $monthCost = if ($byMonth.ContainsKey($currentMonth)) { $byMonth[$currentMonth] } else { 0.0 }
    return @{
        Total        = [math]::Round($totalCost, 6)
        Today        = [math]::Round($todayCost, 6)
        CurrentMonth = [math]::Round($monthCost, 6)
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


# ─── Actualizar datos (lee archivos) + refresca labels ───────────────────────
function script:Update-Display {
    try {
        $script:data = script:Get-UsageData
    } catch {
        $script:data = $null
    }

    $isPlan = ($script:config.mode -eq "plan")
    $prefix = if ($isPlan) { "~" } else { "" }

    if ($null -ne $script:data) {
        try {
            $mes   = [double]$script:data["CurrentMonth"]
            $total = [double]$script:data["Total"]
            $tip = "Claude Cost  $prefix`$$([math]::Round($mes,2))/mes"
            $script:tray.Text = if ($tip.Length -gt 63) { $tip.Substring(0, 63) } else { $tip }
        } catch {
            $script:tray.Text = "Claude Cost"
        }
    } else {
        $script:tray.Text = "Claude Cost"
    }

    script:Refresh-Labels
}

# ─── DWM: esquinas redondeadas nativas Windows 11 ────────────────────────────
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class DwmApi {
    [DllImport("dwmapi.dll")]
    public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);
    public static void RoundCorners(IntPtr h) { int v = 2; DwmSetWindowAttribute(h, 33, ref v, 4); }
}
"@ -ErrorAction SilentlyContinue

# ─── Popup moderno ───────────────────────────────────────────────────────────
function script:New-Popup {
    $cBg     = [System.Drawing.Color]::FromArgb(28, 28, 28)
    $cBgHead = [System.Drawing.Color]::FromArgb(32, 32, 32)
    $cSep    = [System.Drawing.Color]::FromArgb(90, 90, 90)
    $cText   = [System.Drawing.Color]::FromArgb(235, 235, 235)
    $cDim    = [System.Drawing.Color]::FromArgb(130, 130, 130)
    $cOrange = [System.Drawing.Color]::FromArgb(255, 110, 20)
    $cHover  = [System.Drawing.Color]::FromArgb(45, 45, 45)
    $cBorder = [System.Drawing.Color]::FromArgb(55, 55, 55)

    $W = 268
    $fontUI  = New-Object System.Drawing.Font("Segoe UI", 9)
    $fontSm  = New-Object System.Drawing.Font("Segoe UI", 8)

    $form = New-Object System.Windows.Forms.Form
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.ShowInTaskbar   = $false
    $form.TopMost         = $true
    $form.BackColor       = $cBg
    $form.Width           = $W
    $form.Height          = 10
    $form.StartPosition   = [System.Windows.Forms.FormStartPosition]::Manual
    $form.Padding         = New-Object System.Windows.Forms.Padding(0)

    $form.Add_HandleCreated({
        try { [DwmApi]::RoundCorners($this.Handle) } catch {}
    }) | Out-Null
    $form.Add_Paint({
        $pen = New-Object System.Drawing.Pen($cBorder)
        $_.Graphics.DrawRectangle($pen, 0, 0, ($form.Width - 1), ($form.Height - 1))
        $pen.Dispose()
    }) | Out-Null
    $form.Add_Deactivate({ $script:popup.Hide() }) | Out-Null

    $y = 0

    # Helper: label izquierda
    function AddLabel($text, $x, $ly, $w, $h, $color, $font) {
        $l = New-Object System.Windows.Forms.Label
        $l.Text      = $text
        $l.ForeColor = $color
        $l.Font      = $font
        $l.Location  = New-Object System.Drawing.Point($x, $ly)
        $l.Size      = New-Object System.Drawing.Size($w, $h)
        $l.BackColor = [System.Drawing.Color]::Transparent
        $form.Controls.Add($l)
        return $l
    }

    # Helper: separador full-width
    function AddSep($sy) {
        $s = New-Object System.Windows.Forms.Panel
        $s.BackColor = $cSep
        $s.Location  = New-Object System.Drawing.Point(0, $sy)
        $s.Size      = New-Object System.Drawing.Size($W, 1)
        $form.Controls.Add($s)
    }

    # Helper: boton plano
    function AddBtn($text, $x, $by, $bw, $bh, $action) {
        $b = New-Object System.Windows.Forms.Button
        $b.Text      = $text
        $b.Font      = $fontSm
        $b.ForeColor = $cText
        $b.BackColor = $cBg
        $b.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
        $b.FlatAppearance.BorderSize             = 1
        $b.FlatAppearance.BorderColor            = $cBorder
        $b.FlatAppearance.MouseOverBackColor     = $cHover
        $b.FlatAppearance.MouseDownBackColor     = [System.Drawing.Color]::FromArgb(58, 58, 58)
        $b.Location  = New-Object System.Drawing.Point($x, $by)
        $b.Size      = New-Object System.Drawing.Size($bw, $bh)
        $b.Cursor    = [System.Windows.Forms.Cursors]::Hand
        $b.Add_Click($action) | Out-Null
        $form.Controls.Add($b)
        return $b
    }

    # ── Header ───────────────────────────────────────────────────────────────
    $y = 14
    AddLabel "Claude Cost" 16 $y 160 20 $cText $fontUI | Out-Null
    $modeX = $W - 56
    $script:lblModeTag = AddLabel "API" $modeX $y 40 18 $cOrange $fontSm
    $script:lblModeTag.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
    $y += 30

    AddSep $y; $y += 12

    # ── Stats ────────────────────────────────────────────────────────────────
    $valX  = $W - 100
    $valW  = 88
    $rowH  = 22

    AddLabel "Este mes" 16 $y 120 $rowH $cDim $fontUI | Out-Null
    $script:lblMes = AddLabel "..." $valX $y $valW $rowH $cText $fontUI
    $script:lblMes.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
    $y += $rowH + 4

    AddLabel "Hoy" 16 $y 120 $rowH $cDim $fontUI | Out-Null
    $script:lblHoy = AddLabel "..." $valX $y $valW $rowH $cText $fontUI
    $script:lblHoy.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
    $y += $rowH + 4

    AddLabel "Total" 16 $y 120 $rowH $cDim $fontUI | Out-Null
    $script:lblTotal = AddLabel "..." $valX $y $valW $rowH $cOrange $fontUI
    $script:lblTotal.TextAlign = [System.Drawing.ContentAlignment]::MiddleRight
    $y += $rowH + 12

    AddSep $y; $y += 12

    # ── Acciones ─────────────────────────────────────────────────────────────
    $btnH = 28
    AddBtn "Ver reporte" 12 $y 140 $btnH { $script:popup.Hide(); script:Open-Report } | Out-Null
    $refreshX = 158
    AddBtn "Actualizar" $refreshX $y 98 $btnH { script:Update-Display } | Out-Null
    $y += $btnH + 8

    AddSep $y; $y += 10

    # ── Footer: modo + arranque + salir ──────────────────────────────────────
    $smH = 24
    $modeLabel = if ($script:config.mode -eq "plan") { "Plan" } else { "API" }
    $script:btnMode = AddBtn "Modo: $modeLabel" 12 $y 90 $smH {
        if ($script:config.mode -eq "api") {
            $script:config.mode = "plan"; $script:btnMode.Text = "Modo: Plan"
        } else {
            $script:config.mode = "api";  $script:btnMode.Text = "Modo: API"
        }
        script:Save-Config; script:Update-Display
    }
    $startTxt = if (script:Test-StartupEntry) { "Arranque ON" } else { "Arranque" }
    $script:btnStartup = AddBtn $startTxt 108 $y 96 $smH {
        if (script:Test-StartupEntry) {
            script:Disable-Startup; $script:btnStartup.Text = "Arranque"
        } else {
            script:Enable-Startup;  $script:btnStartup.Text = "Arranque ON"
        }
    }
    AddBtn "Salir" 210 $y 46 $smH {
        $script:popup.Hide()
        $script:tray.Visible = $false; $script:timer.Stop()
        try { $script:mutex.ReleaseMutex() } catch {}
        [System.Windows.Forms.Application]::Exit()
    } | Out-Null
    $y += $smH + 12

    $form.Height = $y
    return $form
}

# ─── Refrescar labels del popup desde datos cacheados ────────────────────────
function script:Refresh-Labels {
    $isPlan = ($script:config.mode -eq "plan")
    $prefix = if ($isPlan) { "~" } else { "" }

    if ($script:lblModeTag) {
        $script:lblModeTag.Text = if ($isPlan) { "Plan" } else { "API" }
    }

    if ($null -eq $script:data) {
        if ($script:lblMes)   { $script:lblMes.Text   = "sin datos" }
        if ($script:lblHoy)   { $script:lblHoy.Text   = "sin datos" }
        if ($script:lblTotal) { $script:lblTotal.Text = "sin datos" }
        return
    }
    try {
        $mes   = [double]$script:data["CurrentMonth"]
        $hoy   = [double]$script:data["Today"]
        $total = [double]$script:data["Total"]
        if ($script:lblMes)   { $script:lblMes.Text   = "$prefix`$$('{0:F4}' -f $mes)" }
        if ($script:lblHoy)   { $script:lblHoy.Text   = "$prefix`$$('{0:F4}' -f $hoy)" }
        if ($script:lblTotal) { $script:lblTotal.Text = "$prefix`$$('{0:F4}' -f $total)" }
    } catch {
        if ($script:lblMes)   { $script:lblMes.Text   = "error" }
        if ($script:lblHoy)   { $script:lblHoy.Text   = "error" }
        if ($script:lblTotal) { $script:lblTotal.Text = "error" }
    }
}

# ─── Mostrar popup cerca del icono ───────────────────────────────────────────
function script:Show-Popup {
    if ($script:popup.Visible) { $script:popup.Hide(); return }
    script:Refresh-Labels
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $px = $screen.Right  - $script:popup.Width  - 14
    $py = $screen.Bottom - $script:popup.Height - 14
    $script:popup.Location = New-Object System.Drawing.Point($px, $py)
    $script:popup.Show()
    $script:popup.Activate()
}

# ─── MAIN ────────────────────────────────────────────────────────────────────
$script:data  = $null
$script:popup = script:New-Popup

$script:tray = New-Object System.Windows.Forms.NotifyIcon
$script:tray.Icon    = script:New-TrayIcon
$script:tray.Visible = $true
$script:tray.Text    = "Claude Cost"

$script:tray.Add_MouseClick({
    if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left)  { script:Open-Report  }
    if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Right) { script:Show-Popup   }
}) | Out-Null
$script:tray.Add_DoubleClick({ script:Open-Report }) | Out-Null

$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = 60000
$script:timer.Add_Tick({ script:Update-Display }) | Out-Null
$script:timer.Start()

script:Update-Display

$script:tray.ShowBalloonTip(
    3000, "Claude Usage Tracker",
    "Activo en la bandeja. Clic para ver el reporte.",
    [System.Windows.Forms.ToolTipIcon]::Info
)

[System.Windows.Forms.Application]::Run()
