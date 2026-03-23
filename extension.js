const vscode = require('vscode');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const { execSync } = require('child_process');

// ─── Precios por modelo (USD por millón de tokens) ────────────────────────────
const PRICING = {
  'claude-sonnet-4-6': { input: 3.00, cacheWrite: 3.75, cacheRead: 0.30, output: 15.00 },
  'claude-sonnet-3-7': { input: 3.00, cacheWrite: 3.75, cacheRead: 0.30, output: 15.00 },
  'claude-sonnet-3-5': { input: 3.00, cacheWrite: 3.75, cacheRead: 0.30, output: 15.00 },
  'claude-opus-4-6':   { input: 15.00, cacheWrite: 18.75, cacheRead: 1.50, output: 75.00 },
  'claude-opus-4-5':   { input: 15.00, cacheWrite: 18.75, cacheRead: 1.50, output: 75.00 },
  'claude-opus-3':     { input: 15.00, cacheWrite: 18.75, cacheRead: 1.50, output: 75.00 },
  'claude-haiku-4-5':  { input: 0.80,  cacheWrite: 1.00,  cacheRead: 0.08, output: 4.00  },
  'claude-haiku-3-5':  { input: 0.80,  cacheWrite: 1.00,  cacheRead: 0.08, output: 4.00  },
  'claude-haiku-3':    { input: 0.25,  cacheWrite: 0.30,  cacheRead: 0.03, output: 1.25  },
  default:             { input: 3.00, cacheWrite: 3.75, cacheRead: 0.30, output: 15.00 },
};

function getPricing(model) {
  if (!model) return PRICING.default;
  for (const key of Object.keys(PRICING)) {
    if (key !== 'default' && model.includes(key.replace('claude-', ''))) return PRICING[key];
  }
  if (model.includes('opus'))   return PRICING['claude-opus-4-6'];
  if (model.includes('haiku'))  return PRICING['claude-haiku-4-5'];
  if (model.includes('sonnet')) return PRICING['claude-sonnet-4-6'];
  return PRICING.default;
}

function calcCost(usage, model) {
  const p = getPricing(model);
  const M = 1_000_000;
  return (
    ((usage.input_tokens                || 0) / M) * p.input     +
    ((usage.cache_creation_input_tokens || 0) / M) * p.cacheWrite +
    ((usage.cache_read_input_tokens     || 0) / M) * p.cacheRead  +
    ((usage.output_tokens               || 0) / M) * p.output
  );
}

function cleanProjectName(folder) {
  // Extrae solo lo que va después del último "DESARROLLO-NNN-..."
  const match = folder.match(/.*DESARROLLO-+(\d[^/\\]*)$/i);
  if (match) return match[1];
  return 'home';
}

function monthLabel(m) {
  const [y, mo] = m.split('-');
  const nombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${nombres[parseInt(mo,10)-1]} ${y}`;
}

const fmt = n => n >= 1e6 ? `${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : String(n);
const $   = n => `$${n.toFixed(4)}`;

// ─── Parseo de datos ──────────────────────────────────────────────────────────
function parseUsage() {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return null;

  const byMonth   = {};
  const byProject = {};
  const byModel   = {};
  let   totalCost = 0;
  let   totalTok  = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };

  const projectFolders = fs.readdirSync(projectsDir).filter(f => {
    try { return fs.statSync(path.join(projectsDir, f)).isDirectory(); } catch { return false; }
  });

  for (const folder of projectFolders) {
    const projectName = cleanProjectName(folder);
    const folderPath  = path.join(projectsDir, folder);
    let   jsonlFiles;
    try { jsonlFiles = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl')); }
    catch { continue; }

    for (const file of jsonlFiles) {
      let lines;
      try { lines = fs.readFileSync(path.join(folderPath, file), 'utf8').split('\n').filter(Boolean); }
      catch { continue; }

      for (const line of lines) {
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }

        if (entry.type !== 'assistant') continue;
        const usage = entry.message && entry.message.usage;
        if (!usage) continue;

        const model     = (entry.message && entry.message.model) || 'desconocido';
        const month     = (entry.timestamp || '').slice(0, 7);
        if (!month) continue;

        const cost = calcCost(usage, model);
        totalCost += cost;

        totalTok.input      += usage.input_tokens                || 0;
        totalTok.cacheWrite += usage.cache_creation_input_tokens || 0;
        totalTok.cacheRead  += usage.cache_read_input_tokens     || 0;
        totalTok.output     += usage.output_tokens               || 0;

        if (!byMonth[month]) byMonth[month] = {};
        if (!byMonth[month][projectName]) byMonth[month][projectName] = { cost: 0, models: {} };
        byMonth[month][projectName].cost += cost;
        byMonth[month][projectName].models[model] = (byMonth[month][projectName].models[model] || 0) + cost;

        if (!byProject[projectName]) byProject[projectName] = { cost: 0 };
        byProject[projectName].cost += cost;

        if (!byModel[model]) byModel[model] = { cost: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
        byModel[model].cost       += cost;
        byModel[model].input      += usage.input_tokens                || 0;
        byModel[model].cacheWrite += usage.cache_creation_input_tokens || 0;
        byModel[model].cacheRead  += usage.cache_read_input_tokens     || 0;
        byModel[model].output     += usage.output_tokens               || 0;
      }
    }
  }

  return { byMonth, byProject, byModel, totalCost, totalTok, projectFolders, projectsDir };
}

// ─── Generación del HTML ──────────────────────────────────────────────────────
function generateHtml(data) {
  const { byMonth, byModel, totalCost, totalTok, projectFolders, projectsDir } = data;
  const meses = Object.keys(byMonth).sort().reverse();

  const mesesTabla = meses.map(mes => {
    const proyectos = byMonth[mes];
    const totalMes  = Object.values(proyectos).reduce((s, p) => s + p.cost, 0);
    const filas = Object.entries(proyectos)
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([proj, d]) => {
        const pct      = totalMes > 0 ? ((d.cost / totalMes) * 100).toFixed(1) : '0.0';
        const barWidth = Math.max(1, Math.round(parseFloat(pct)));
        const modelsList = Object.entries(d.models)
          .sort((a,b) => b[1]-a[1])
          .map(([m, c]) => {
            const shortName = m.replace('claude-','');
            const cls = m.includes('opus') ? 'badge-opus' : m.includes('haiku') ? 'badge-haiku' : 'badge-sonnet';
            return `<span class="badge-model ${cls}" title="${m}">${shortName}<br><span class="badge-cost">${$(c)}</span></span>`;
          })
          .join('');
        return `<tr>
          <td>${proj}</td>
          <td class="right cost">${$(d.cost)}</td>
          <td class="right">${pct}%</td>
          <td>
            <div class="bar-container">
              <div class="bar-wrap"><div class="bar" style="width:${barWidth}%"><span class="bar-label">${pct}%</span></div></div>
            </div>
            <div class="models-list">${modelsList}</div>
          </td>
        </tr>`;
      }).join('');
    return `
      <div class="month-block">
        <div class="month-header">
          <span class="month-name">${monthLabel(mes)}</span>
          <span class="month-total">${$(totalMes)}</span>
        </div>
        <table><thead><tr><th>Proyecto</th><th class="right">Coste</th><th class="right">%</th><th>Detalle</th></tr></thead>
        <tbody>${filas}</tbody></table>
      </div>`;
  }).join('');

  const modelasTabla = Object.entries(byModel)
    .sort((a,b) => b[1].cost - a[1].cost)
    .map(([model, d]) => {
      const pct = totalCost > 0 ? ((d.cost / totalCost) * 100).toFixed(1) : '0.0';
      return `<tr>
        <td>${model}</td>
        <td class="right cost">${$(d.cost)}</td>
        <td class="right">${pct}%</td>
        <td class="right">${fmt(d.input)}</td>
        <td class="right">${fmt(d.cacheWrite)}</td>
        <td class="right">${fmt(d.cacheRead)}</td>
        <td class="right">${fmt(d.output)}</td>
      </tr>`;
    }).join('');

  const mesActual     = meses[0] || '';
  const costeMesActual = mesActual
    ? Object.values(byMonth[mesActual]).reduce((s,p) => s+p.cost, 0)
    : 0;
  const now = new Date().toLocaleString('es-ES');

  return `<!DOCTYPE html><html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Usage Tracker</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;image-rendering:pixelated}
body{font-family:'Press Start 2P',monospace;background:#0a0500;color:#ff7900;padding:24px;font-size:9px;line-height:2;background-image:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.25) 2px,rgba(0,0,0,0.25) 4px)}
h1{font-size:13px;color:#ff7900;margin-bottom:6px;text-shadow:3px 3px #4d2400}
.subtitle{color:#7a3800;font-size:7px;margin-bottom:28px}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:32px}
.card{background:#110800;border:2px solid #ff7900;box-shadow:4px 4px 0 #4d2400;padding:16px 18px;min-width:160px}
.card-label{font-size:6px;color:#994800;margin-bottom:8px}
.card-value{font-size:15px;color:#ffffff;text-shadow:2px 2px #4d2400}
.card-value.blue{color:#ffb347;text-shadow:2px 2px #4d2400}
.card-sub{font-size:6px;color:#5c2d00;margin-top:6px}
.section-title{font-size:8px;color:#ff7900;margin-bottom:14px;border-bottom:1px solid #4d2400;padding-bottom:6px}
.month-block{border:2px solid #ff7900;box-shadow:4px 4px 0 #4d2400;margin-bottom:20px;background:#080300}
.month-header{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#2a1400;border-bottom:2px solid #ff7900}
.month-name{font-size:9px;color:#ff7900}
.month-total{font-size:11px;color:#ffffff;text-shadow:1px 1px #4d2400}
table{width:100%;border-collapse:collapse}
th{padding:8px 12px;text-align:left;font-size:6px;color:#7a3800;border-bottom:1px solid #2a1400}
td{padding:8px 12px;font-size:7px;border-bottom:1px dotted #1a0900;vertical-align:top}
tr:last-child td{border-bottom:none}
tr:hover td{background:#1a0900}
.right{text-align:right}
.cost{color:#ffffff}
.bar-container{margin-bottom:8px}
.bar-wrap{background:#0d0500;height:14px;width:100%;max-width:200px;border:1px solid #4d2400;position:relative;overflow:hidden}
.bar{background:linear-gradient(90deg,#7a3800,#ff7900);height:100%;display:flex;align-items:center;min-width:2px;transition:width 0.3s}
.bar-label{font-size:5px;color:#fff;padding-left:4px;white-space:nowrap;text-shadow:1px 1px #000}
.models-list{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.badge-model{font-size:5px;border:2px solid;padding:3px 5px;text-align:center;min-width:60px;line-height:1.6}
.badge-sonnet{border-color:#ff7900;color:#ff7900;background:#1a0700}
.badge-opus{border-color:#ffd700;color:#ffd700;background:#1a1400;box-shadow:0 0 4px #7a6000}
.badge-haiku{border-color:#00cc88;color:#00cc88;background:#001a0e}
.badge-cost{font-size:6px;color:#fff}
.section{margin-bottom:36px}
.updated{font-size:6px;color:#4d2400;margin-top:32px;text-align:center}
.blink{animation:blink 1s step-end infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
</style></head><body>
<h1>&gt; CLAUDE USAGE TRACKER_<span class="blink">█</span></h1>
<p class="subtitle">// ACTUALIZADO: ${now}</p>
<div class="cards">
  <div class="card"><div class="card-label">&gt; COSTE TOTAL</div><div class="card-value">${$(totalCost)}</div><div class="card-sub">${projectFolders.length} PROYECTOS</div></div>
  <div class="card"><div class="card-label">&gt; TOKENS ENTRADA</div><div class="card-value blue" style="font-size:12px">${fmt(totalTok.input)}</div><div class="card-sub">CACHE ESCR: ${fmt(totalTok.cacheWrite)}</div></div>
  <div class="card"><div class="card-label">&gt; CACHE LEIDA</div><div class="card-value blue" style="font-size:12px">${fmt(totalTok.cacheRead)}</div><div class="card-sub">TOK SALIDA: ${fmt(totalTok.output)}</div></div>
  <div class="card"><div class="card-label">&gt; MES ACTUAL</div><div class="card-value" style="font-size:12px">${$(costeMesActual)}</div><div class="card-sub">${mesActual ? monthLabel(mesActual).toUpperCase() : '---'}</div></div>
</div>
<div class="section"><div class="section-title">// POR MES Y PROYECTO</div>${mesesTabla || '<p style="color:#003b00">SIN DATOS</p>'}</div>
<div class="section"><div class="section-title">// POR MODELO</div>
  <div class="month-block"><table>
    <thead><tr><th>MODELO</th><th class="right">COSTE</th><th class="right">%</th><th class="right">ENTRADA</th><th class="right">C.ESCR</th><th class="right">C.LECT</th><th class="right">SALIDA</th></tr></thead>
    <tbody>${modelasTabla || '<tr><td colspan="7" style="color:#003b00;text-align:center">SIN DATOS</td></tr>'}</tbody>
  </table></div>
</div>
<p class="updated">// DATA PATH: ${projectsDir.replace(/\\/g,'/')}</p>
</body></html>`;
}

// ─── Extensión VS Code ────────────────────────────────────────────────────────
let statusBarItem;
let refreshTimer;

function updateStatusBar() {
  try {
    const data = parseUsage();
    if (!data) {
      statusBarItem.text = '$(warning) Claude: sin datos';
      statusBarItem.tooltip = 'No se encontró ~/.claude/projects/';
      return;
    }

    const meses     = Object.keys(data.byMonth).sort().reverse();
    const mesActual = meses[0] || '';
    const costeMes  = mesActual
      ? Object.values(data.byMonth[mesActual]).reduce((s,p) => s+p.cost, 0)
      : 0;

    statusBarItem.text    = `$(credit-card) $${costeMes.toFixed(2)} / $${data.totalCost.toFixed(2)}`;
    statusBarItem.tooltip = [
      `Claude Code — Uso y costes`,
      ``,
      `Mes actual (${mesActual ? monthLabel(mesActual) : '—'}): $${costeMes.toFixed(4)}`,
      `Total acumulado: $${data.totalCost.toFixed(4)}`,
      ``,
      `Tokens entrada:   ${fmt(data.totalTok.input)}`,
      `Cache escritura:  ${fmt(data.totalTok.cacheWrite)}`,
      `Cache lectura:    ${fmt(data.totalTok.cacheRead)}`,
      `Tokens salida:    ${fmt(data.totalTok.output)}`,
      ``,
      `Clic para abrir el reporte completo`,
    ].join('\n');

    // Guarda el HTML para que el comando pueda abrirlo
    const outFile = path.join(os.tmpdir(), 'claude-usage-report.html');
    fs.writeFileSync(outFile, generateHtml(data), 'utf8');

  } catch (err) {
    statusBarItem.text    = '$(warning) Claude: error';
    statusBarItem.tooltip = String(err);
  }
}

function openReport() {
  const outFile = path.join(os.tmpdir(), 'claude-usage-report.html');
  try { execSync(`start "" "${outFile}"`, { stdio: 'ignore', shell: true }); }
  catch { vscode.window.showErrorMessage(`No se pudo abrir: ${outFile}`); }
}

function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'claudeUsage.openReport';
  statusBarItem.show();

  context.subscriptions.push(
    statusBarItem,
    vscode.commands.registerCommand('claudeUsage.openReport', openReport),
    vscode.commands.registerCommand('claudeUsage.refresh',    updateStatusBar),
  );

  // Primera carga y refresco cada minuto
  updateStatusBar();
  refreshTimer = setInterval(updateStatusBar, 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });
}

function deactivate() {
  clearInterval(refreshTimer);
}

module.exports = { activate, deactivate };
