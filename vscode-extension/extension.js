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
  default:             { input: 3.00,  cacheWrite: 3.75,  cacheRead: 0.30, output: 15.00 },
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
    ((usage.input_tokens                || 0) / M) * p.input      +
    ((usage.cache_creation_input_tokens || 0) / M) * p.cacheWrite +
    ((usage.cache_read_input_tokens     || 0) / M) * p.cacheRead  +
    ((usage.output_tokens               || 0) / M) * p.output
  );
}

function cleanProjectName(folder) {
  const parts = folder.split('---').filter(Boolean);
  const last  = parts[parts.length - 1] || folder;
  return last.replace(/^[A-Z]--[^-]+-[^-]+-/i, '') || last;
}

function monthLabel(m) {
  const [y, mo] = m.split('-');
  const nombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${nombres[parseInt(mo,10)-1]} ${y}`;
}

const fmt = n => n >= 1e6 ? `${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : String(n);

function fmtCost(n, isPlan) {
  return isPlan ? `~$${n.toFixed(4)}` : `$${n.toFixed(4)}`;
}

function fmtCost2(n, isPlan) {
  return isPlan ? `~$${n.toFixed(2)}` : `$${n.toFixed(2)}`;
}

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

        const model = (entry.message && entry.message.model) || 'unknown';
        if (model === '<synthetic>') continue;
        const month = (entry.timestamp || '').slice(0, 7);
        if (!month) continue;

        const cost = calcCost(usage, model);
        totalCost += cost;

        totalTok.input      += usage.input_tokens                || 0;
        totalTok.cacheWrite += usage.cache_creation_input_tokens || 0;
        totalTok.cacheRead  += usage.cache_read_input_tokens     || 0;
        totalTok.output     += usage.output_tokens               || 0;

        if (!byMonth[month])              byMonth[month] = {};
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
function generateHtml(data, isPlan) {
  const { byMonth, byModel, totalCost, totalTok, projectFolders, projectsDir } = data;
  const meses = Object.keys(byMonth).sort().reverse();
  const $ = n => fmtCost(n, isPlan);

  const planBanner = isPlan
    ? `<div class="plan-banner">Modo <strong>Plan</strong> — los costes mostrados son equivalentes estimados de API, no cargos reales. Tienes una suscripción de tarifa plana.</div>`
    : '';

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
          .map(([m, c]) => `<span class="badge-model">${m.replace('claude-','')}: ${$(c)}</span>`)
          .join(' ');
        return `<tr>
          <td>${proj}</td>
          <td class="right cost">${$(d.cost)}</td>
          <td class="right">${pct}%</td>
          <td><div class="bar-wrap"><div class="bar" style="width:${barWidth}%"></div></div>
          <div class="models-list">${modelsList}</div></td>
        </tr>`;
      }).join('');
    return `
      <div class="month-block">
        <div class="month-header">
          <span class="month-name">${monthLabel(mes)}</span>
          <span class="month-total">${$(totalMes)}</span>
        </div>
        <table><thead><tr><th>Proyecto</th><th class="right">${isPlan ? 'Equiv. estimado' : 'Coste'}</th><th class="right">%</th><th>Detalle</th></tr></thead>
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

  const mesActual      = meses[0] || '';
  const costeMesActual = mesActual
    ? Object.values(byMonth[mesActual]).reduce((s,p) => s+p.cost, 0)
    : 0;
  const now = new Date().toLocaleString('es-ES');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Usage Tracker</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--orange:#FF6600;--orange2:#FF8533;--bg:#0C0C0C;--bg2:#141414;--bg3:#1A1A1A;--bg4:#212121;--border:#2C2C2C;--text:#E8E8E8;--dim:#5A5A5A;--dim2:#888}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);font-size:14px;line-height:1.5}
  .topbar{position:sticky;top:0;z-index:100;background:var(--bg2);border-bottom:1px solid var(--border);padding:0 32px;height:56px;display:flex;align-items:center;justify-content:space-between;gap:16px}
  .topbar-left{display:flex;align-items:center;gap:12px}
  .brand-dot{width:28px;height:28px;border-radius:50%;background:var(--orange);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#fff;flex-shrink:0}
  .topbar-title{font-weight:600;font-size:15px;color:#fff}
  .topbar-sub{font-size:12px;color:var(--dim2);margin-top:1px}
  .topbar-right{display:flex;align-items:center;gap:10px}
  .mode-pill{font-size:11px;font-weight:600;letter-spacing:.04em;padding:3px 10px;border-radius:20px;background:rgba(255,102,0,.12);color:var(--orange);border:1px solid rgba(255,102,0,.3)}
  .content{padding:28px 32px 48px;max-width:1100px;margin:0 auto}
  .plan-banner{background:rgba(255,102,0,.07);border:1px solid rgba(255,102,0,.25);border-radius:8px;color:var(--orange2);font-size:13px;padding:10px 16px;margin-bottom:24px;line-height:1.6}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-bottom:32px}
  .card{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:20px 20px 16px}
  .card.featured{border-top:3px solid var(--orange);padding-top:17px}
  .card-label{font-size:11px;font-weight:500;color:var(--dim2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}
  .card-value{font-size:1.65rem;font-weight:700;color:var(--orange);line-height:1;font-variant-numeric:tabular-nums}
  .card-value.secondary{font-size:1.3rem;color:var(--text)}
  .card-sub{font-size:11px;color:var(--dim);margin-top:8px}
  .tab-bar{display:flex;gap:0;border-bottom:1px solid var(--border);margin-bottom:20px}
  .tab-btn{font-family:inherit;background:none;border:none;border-bottom:2px solid transparent;color:var(--dim2);font-size:13px;font-weight:500;padding:10px 20px;cursor:pointer;margin-bottom:-1px;transition:color .15s,border-color .15s}
  .tab-btn:hover{color:var(--text)}
  .tab-btn.active{color:var(--orange);border-bottom-color:var(--orange)}
  .tab-pane{display:none}
  .tab-pane.active{display:block}
  .month-card{background:var(--bg2);border:1px solid var(--border);border-radius:10px;margin-bottom:14px;overflow:hidden}
  .month-head{display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:var(--bg3);border-bottom:1px solid var(--border)}
  .month-name{font-weight:600;font-size:14px;color:#fff}
  .month-cost{font-weight:700;font-size:15px;color:var(--orange);font-variant-numeric:tabular-nums}
  table{width:100%;border-collapse:collapse}
  th{padding:9px 18px;text-align:left;font-size:11px;font-weight:600;color:var(--dim);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);white-space:nowrap;background:var(--bg3)}
  td{padding:9px 18px;font-size:13px;border-bottom:1px solid #1C1C1C;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tr:hover td{background:rgba(255,255,255,.02)}
  .td-r{text-align:right}
  .td-proj{max-width:280px;word-break:break-word}
  .cost{color:var(--orange);font-weight:600;font-variant-numeric:tabular-nums}
  .dim{color:var(--dim2)}
  .bar-wrap{background:#252525;border-radius:3px;height:4px;max-width:180px;width:100%;margin-bottom:6px}
  .bar-wide{max-width:260px}
  .bar{background:linear-gradient(90deg,var(--orange),var(--orange2));border-radius:3px;height:4px}
  .badges{display:flex;flex-wrap:wrap;gap:3px}
  .badge{font-size:11px;background:#252525;color:var(--dim2);padding:1px 7px;border-radius:8px}
  .empty{color:var(--dim);padding:24px 20px;font-size:13px}
  .footer{font-size:11px;color:#2E2E2E;margin-top:40px;text-align:center}
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-left">
    <div class="brand-dot">O</div>
    <div>
      <div class="topbar-title">Claude Usage Tracker</div>
      <div class="topbar-sub">Orange &mdash; Monitorizacion de uso &middot; ${now}</div>
    </div>
  </div>
  <div class="topbar-right">
    <span class="mode-pill">${isPlan ? 'PLAN' : 'API'}</span>
  </div>
</header>
<main class="content">
${planBanner}
<div class="cards">
  <div class="card featured"><div class="card-label">${isPlan ? 'Equiv. total estimado' : 'Coste total'}</div><div class="card-value">${$(totalCost)}</div><div class="card-sub">${projectFolders.length} proyectos</div></div>
  <div class="card"><div class="card-label">Mes actual</div><div class="card-value secondary">${$(costeMesActual)}</div><div class="card-sub">${mesActual ? monthLabel(mesActual) : '&mdash;'}</div></div>
  <div class="card"><div class="card-label">Tokens entrada</div><div class="card-value secondary">${fmt(totalTok.input)}</div><div class="card-sub">Cache escr: ${fmt(totalTok.cacheWrite)}</div></div>
  <div class="card"><div class="card-label">Tokens salida</div><div class="card-value secondary">${fmt(totalTok.output)}</div><div class="card-sub">Cache lect: ${fmt(totalTok.cacheRead)}</div></div>
</div>
<div class="tab-bar">
  <button class="tab-btn active" onclick="showTab('mes',this)">Por Mes</button>
  <button class="tab-btn" onclick="showTab('modelo',this)">Por Modelo</button>
</div>
<div id="tab-mes" class="tab-pane active">${mesesTabla || '<p class="empty">Sin datos</p>'}</div>
<div id="tab-modelo" class="tab-pane">
  <div class="month-card"><table>
    <thead><tr><th>Modelo</th><th class="td-r">${isPlan ? 'Equiv. estim.' : 'Coste'}</th><th class="td-r">%</th><th class="td-r">Entrada</th><th class="td-r">Cache escr.</th><th class="td-r">Cache lect.</th><th class="td-r">Salida</th></tr></thead>
    <tbody>${modelasTabla || '<tr><td colspan="7" class="empty">Sin datos</td></tr>'}</tbody>
  </table></div>
</div>
<p class="footer">Datos desde ${projectsDir.replace(/\\/g,'/')}</p>
</main>
<script>
function showTab(name,btn){document.querySelectorAll('.tab-pane').forEach(el=>el.classList.remove('active'));document.querySelectorAll('.tab-btn').forEach(el=>el.classList.remove('active'));document.getElementById('tab-'+name).classList.add('active');btn.classList.add('active')}
</script>
</body></html>`;
}

// ─── Extensión VS Code ────────────────────────────────────────────────────────
let statusBarItem;
let refreshTimer;

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('claudeUsage');
  return {
    isPlan:          cfg.get('billingMode', 'api') === 'plan',
    refreshInterval: cfg.get('refreshIntervalSeconds', 60) * 1000,
  };
}

function updateStatusBar() {
  const { isPlan } = getConfig();
  try {
    const data = parseUsage();
    if (!data) {
      statusBarItem.text    = '$(warning) Claude: sin datos';
      statusBarItem.tooltip = 'No se encontró ~/.claude/projects/';
      return;
    }

    const meses     = Object.keys(data.byMonth).sort().reverse();
    const mesActual = meses[0] || '';
    const costeMes  = mesActual
      ? Object.values(data.byMonth[mesActual]).reduce((s,p) => s+p.cost, 0)
      : 0;

    const prefix = isPlan ? '~' : '';
    statusBarItem.text = `$(credit-card) ${prefix}$${costeMes.toFixed(2)} / ${prefix}$${data.totalCost.toFixed(2)}`;
    statusBarItem.tooltip = [
      `Claude Code — Uso y costes`,
      `Modo: ${isPlan ? 'Plan (tarifa plana)' : 'API (por tokens)'}`,
      ``,
      `Mes actual (${mesActual ? monthLabel(mesActual) : '—'}): ${fmtCost2(costeMes, isPlan)}`,
      `Total acumulado: ${fmtCost2(data.totalCost, isPlan)}`,
      ``,
      `Tokens entrada:   ${fmt(data.totalTok.input)}`,
      `Cache escritura:  ${fmt(data.totalTok.cacheWrite)}`,
      `Cache lectura:    ${fmt(data.totalTok.cacheRead)}`,
      `Tokens salida:    ${fmt(data.totalTok.output)}`,
      ``,
      isPlan ? '⚠ Costes son equivalentes estimados (no cargos reales)' : '',
      `Clic para abrir el reporte completo`,
    ].filter(l => l !== '').join('\n');

    const outFile = path.join(os.tmpdir(), 'claude-usage-report.html');
    fs.writeFileSync(outFile, generateHtml(data, isPlan), 'utf8');

  } catch (err) {
    statusBarItem.text    = '$(warning) Claude: error';
    statusBarItem.tooltip = String(err);
  }
}

function openReport() {
  const outFile = path.join(os.tmpdir(), 'claude-usage-report.html');
  try { execSync(`rundll32 url.dll,FileProtocolHandler "${outFile}"`, { stdio: 'ignore', shell: true }); }
  catch { vscode.window.showErrorMessage(`No se pudo abrir: ${outFile}`); }
}

function scheduleRefresh(ctx) {
  const { refreshInterval } = getConfig();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(updateStatusBar, refreshInterval);
  ctx.subscriptions.push({ dispose: () => clearInterval(refreshTimer) });
}

function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'claudeUsage.openReport';
  statusBarItem.show();

  context.subscriptions.push(
    statusBarItem,
    vscode.commands.registerCommand('claudeUsage.openReport', openReport),
    vscode.commands.registerCommand('claudeUsage.refresh',    updateStatusBar),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('claudeUsage')) {
        updateStatusBar();
        scheduleRefresh(context);
      }
    }),
  );

  updateStatusBar();
  scheduleRefresh(context);
}

function deactivate() {
  clearInterval(refreshTimer);
}

module.exports = { activate, deactivate };
