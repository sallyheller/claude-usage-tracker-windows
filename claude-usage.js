#!/usr/bin/env node
/**
 * claude-usage.js — Reporte HTML de uso y costes de Claude Code (Windows)
 *
 * Uso:
 *   node claude-usage.js           → modo API  (coste real)
 *   node claude-usage.js --plan    → modo Plan (equivalente estimado, suscripción plana)
 *
 * Genera un reporte HTML con tabs (Mes / Proyecto / Modelo),
 * export CSV, gasto de hoy y barra de progreso mensual.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync } = require('child_process');

// ─── Modo de facturación ─────────────────────────────────────────────────────
const IS_PLAN = process.argv.includes('--plan');

// ─── Logo Orange ──────────────────────────────────────────────────────────────
const LOGO_PATHS = [
  path.join(__dirname, 'orange-logo.svg'),
  path.join(os.homedir(), 'OneDrive - MASORANGE', 'Descargas', 'Orange_Master_logo.svg'),
];
let logoB64    = '';
let logoInline = '';
for (const p of LOGO_PATHS) {
  try {
    const svgRaw = fs.readFileSync(p, 'utf8');
    logoB64    = Buffer.from(svgRaw).toString('base64');
    logoInline = svgRaw.trim();
    break;
  } catch { }
}

// ─── Precios por modelo (USD / millón de tokens) ─────────────────────────────
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

// ─── Nombre de proyecto ───────────────────────────────────────────────────────
function cleanProjectName(folder) {
  const parts = folder.split('---').filter(Boolean);
  const last  = parts[parts.length - 1] || folder;
  return last.replace(/^[A-Za-z]--[^-]+-[^-]+-/i, '') || last;
}

// ─── Lectura de datos ─────────────────────────────────────────────────────────
const projectsDir = path.join(os.homedir(), '.claude', 'projects');

if (!fs.existsSync(projectsDir)) {
  console.error(`No se encontró la carpeta: ${projectsDir}`);
  process.exit(1);
}

const byMonth   = {};
const byProject = {};
const byModel   = {};
let   totalCost = 0;
let   totalTok  = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
let   todayCost = 0;
let   todayTok  = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
const today     = new Date().toISOString().slice(0, 10);

const projectFolders = fs.readdirSync(projectsDir).filter(f => {
  try { return fs.statSync(path.join(projectsDir, f)).isDirectory(); } catch { return false; }
});

for (const folder of projectFolders) {
  const projectName = cleanProjectName(folder);
  const folderPath  = path.join(projectsDir, folder);
  let jsonlFiles;
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
      const timestamp = entry.timestamp || '';
      const month     = timestamp.slice(0, 7);
      const day       = timestamp.slice(0, 10);
      if (!month) continue;

      const cost = calcCost(usage, model);
      totalCost += cost;
      totalTok.input      += usage.input_tokens                || 0;
      totalTok.cacheWrite += usage.cache_creation_input_tokens || 0;
      totalTok.cacheRead  += usage.cache_read_input_tokens     || 0;
      totalTok.output     += usage.output_tokens               || 0;

      if (day === today) {
        todayCost += cost;
        todayTok.input      += usage.input_tokens                || 0;
        todayTok.cacheWrite += usage.cache_creation_input_tokens || 0;
        todayTok.cacheRead  += usage.cache_read_input_tokens     || 0;
        todayTok.output     += usage.output_tokens               || 0;
      }

      if (!byMonth[month])                    byMonth[month] = {};
      if (!byMonth[month][projectName])       byMonth[month][projectName] = { cost: 0, tokens: 0, models: {} };
      byMonth[month][projectName].cost   += cost;
      byMonth[month][projectName].tokens += (usage.input_tokens || 0) + (usage.output_tokens || 0);
      byMonth[month][projectName].models[model] = (byMonth[month][projectName].models[model] || 0) + cost;

      if (!byProject[projectName]) byProject[projectName] = { cost: 0, tokens: 0 };
      byProject[projectName].cost   += cost;
      byProject[projectName].tokens += (usage.input_tokens || 0) + (usage.output_tokens || 0);

      if (!byModel[model]) byModel[model] = { cost: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
      byModel[model].cost       += cost;
      byModel[model].input      += usage.input_tokens                || 0;
      byModel[model].cacheWrite += usage.cache_creation_input_tokens || 0;
      byModel[model].cacheRead  += usage.cache_read_input_tokens     || 0;
      byModel[model].output     += usage.output_tokens               || 0;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt  = n => n >= 1e6 ? `${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : String(n);
const $4   = n => `${IS_PLAN ? '~' : ''}$${n.toFixed(4)}`;
const $2   = n => `${IS_PLAN ? '~' : ''}$${n.toFixed(2)}`;

function monthLabel(m) {
  const [y, mo] = m.split('-');
  const names = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${names[parseInt(mo,10)-1]} ${y}`;
}

// ─── Datos para export CSV ────────────────────────────────────────────────────
const meses     = Object.keys(byMonth).sort().reverse();
const mesActual = meses[0] || '';
const costeMes  = mesActual ? Object.values(byMonth[mesActual]).reduce((s,p)=>s+p.cost,0) : 0;
const now       = new Date().toLocaleString('es-ES');

const csvRows = [['Mes','Proyecto','Coste USD','Tokens Entrada','Tokens Salida','Cache Escritura','Cache Lectura']];
for (const [mes, proyectos] of Object.entries(byMonth).sort()) {
  for (const [proj, d] of Object.entries(proyectos)) {
    csvRows.push([mes, proj, d.cost.toFixed(6), d.tokens, '', '', '']);
  }
}
const csvModelos = [['Modelo','Coste USD','Tokens Entrada','Cache Escritura','Cache Lectura','Tokens Salida']];
for (const [model, d] of Object.entries(byModel)) {
  csvModelos.push([model, d.cost.toFixed(6), d.input, d.cacheWrite, d.cacheRead, d.output]);
}

// ─── HTML: Tab "Por Mes" ──────────────────────────────────────────────────────
const tabMes = meses.map(mes => {
  const proyectos = byMonth[mes];
  const totalMes  = Object.values(proyectos).reduce((s,p)=>s+p.cost,0);
  const filas = Object.entries(proyectos)
    .sort((a,b)=>b[1].cost-a[1].cost)
    .map(([proj, d]) => {
      const pct = totalMes > 0 ? ((d.cost/totalMes)*100).toFixed(1) : '0.0';
      const bar = Math.max(1, Math.round(parseFloat(pct)));
      const badges = Object.entries(d.models)
        .sort((a,b)=>b[1]-a[1])
        .map(([m,c])=>`<span class="badge">${m.replace('claude-','')}: ${$4(c)}</span>`)
        .join('');
      return `<tr>
        <td class="td-proj">${proj}</td>
        <td class="td-r cost">${$4(d.cost)}</td>
        <td class="td-r dim">${pct}%</td>
        <td><div class="bar-wrap"><div class="bar" style="width:${bar}%"></div></div>
            <div class="badges">${badges}</div></td>
      </tr>`;
    }).join('');
  const isFirst = mes === meses[0];
  return `<div class="month-card${isFirst ? '' : ' collapsed'}" id="mc-${mes}">
    <div class="month-head" onclick="toggleMonth('${mes}')">
      <span class="month-name"><span class="month-chevron">&#9660;</span>${monthLabel(mes)}</span>
      <span class="month-cost">${$4(totalMes)}</span>
    </div>
    <div class="month-body">
    <table><thead><tr>
      <th>Proyecto</th>
      <th class="td-r">${IS_PLAN?'Equiv. estim.':'Coste'}</th>
      <th class="td-r">%</th>
      <th>Detalle</th>
    </tr></thead><tbody>${filas}</tbody></table>
    </div>
  </div>`;
}).join('') || '<p class="empty">Sin datos</p>';

// ─── HTML: Tab "Por Proyecto" ─────────────────────────────────────────────────
const tabProyecto = (() => {
  const sorted = Object.entries(byProject).sort((a,b)=>b[1].cost-a[1].cost);
  if (!sorted.length) return '<p class="empty">Sin datos</p>';
  const rows = sorted.map(([proj, d]) => {
    const pct = totalCost > 0 ? ((d.cost/totalCost)*100).toFixed(1) : '0.0';
    const bar = Math.max(1, Math.round(parseFloat(pct)));
    return `<tr>
      <td class="td-proj">${proj}</td>
      <td class="td-r cost">${$4(d.cost)}</td>
      <td class="td-r dim">${pct}%</td>
      <td class="td-r dim">${fmt(d.tokens)}</td>
      <td><div class="bar-wrap bar-wide"><div class="bar" style="width:${bar}%"></div></div></td>
    </tr>`;
  }).join('');
  return `<div class="month-card">
    <table><thead><tr>
      <th>Proyecto</th>
      <th class="td-r">${IS_PLAN?'Equiv. estim.':'Coste total'}</th>
      <th class="td-r">%</th>
      <th class="td-r">Tokens</th>
      <th>Distribución</th>
    </tr></thead><tbody>${rows}</tbody></table>
  </div>`;
})();

// ─── HTML: Tab "Por Modelo" ───────────────────────────────────────────────────
const tabModelo = (() => {
  const sorted = Object.entries(byModel).sort((a,b)=>b[1].cost-a[1].cost);
  if (!sorted.length) return '<p class="empty">Sin datos</p>';
  const rows = sorted.map(([model, d]) => {
    const pct = totalCost > 0 ? ((d.cost/totalCost)*100).toFixed(1) : '0.0';
    return `<tr>
      <td>${model}</td>
      <td class="td-r cost">${$4(d.cost)}</td>
      <td class="td-r dim">${pct}%</td>
      <td class="td-r dim">${fmt(d.input)}</td>
      <td class="td-r dim">${fmt(d.cacheWrite)}</td>
      <td class="td-r dim">${fmt(d.cacheRead)}</td>
      <td class="td-r dim">${fmt(d.output)}</td>
    </tr>`;
  }).join('');
  return `<div class="month-card">
    <table><thead><tr>
      <th>Modelo</th>
      <th class="td-r">${IS_PLAN?'Equiv. estim.':'Coste'}</th>
      <th class="td-r">%</th>
      <th class="td-r">Entrada</th>
      <th class="td-r">Cache escr.</th>
      <th class="td-r">Cache lect.</th>
      <th class="td-r">Salida</th>
    </tr></thead><tbody>${rows}</tbody></table>
  </div>`;
})();

// ─── HTML completo ────────────────────────────────────────────────────────────
const planBanner = IS_PLAN
  ? `<div class="plan-banner">Modo <strong>Plan</strong> &mdash; importes mostrados son equivalentes estimados de API. Con suscripcion plana (Max/Pro) no se cobra por tokens.</div>`
  : '';

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude Usage Tracker</title>
${logoB64
  ? `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${logoB64}">`
  : `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='16' fill='%23FF6600'/><text x='16' y='21' text-anchor='middle' font-family='Arial' font-size='16' font-weight='bold' fill='white'>$</text></svg>">`
}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --orange:  #FF6600;
    --orange2: #FF8533;
    --bg:      #0C0C0C;
    --bg2:     #141414;
    --bg3:     #1A1A1A;
    --bg4:     #212121;
    --border:  #2C2C2C;
    --text:    #E8E8E8;
    --dim:     #5A5A5A;
    --dim2:    #888;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif;
    background: var(--bg);
    color: var(--text);
    font-size: 14px;
    line-height: 1.5;
  }

  /* ── Topbar ───────────────────────────────────────────────────── */
  .topbar {
    position: sticky; top: 0; z-index: 100;
    background: var(--bg2);
    border-bottom: 1px solid var(--border);
    padding: 0 32px;
    height: 56px;
    display: flex; align-items: center; justify-content: space-between;
    gap: 16px;
  }
  .topbar-left { display: flex; align-items: center; gap: 12px; }
  .brand-dot {
    width: 28px; height: 28px; border-radius: 50%;
    background: var(--orange);
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 13px; color: #fff; flex-shrink: 0;
  }
  .brand-logo { width: 32px; height: 32px; flex-shrink: 0; display: flex; align-items: center; }
  .brand-logo svg { width: 32px; height: 32px; }
  .topbar-title { font-weight: 600; font-size: 15px; color: #fff; }
  .topbar-sub   { font-size: 12px; color: var(--dim2); margin-top: 1px; }
  .topbar-right { display: flex; align-items: center; gap: 10px; }
  .mode-pill {
    font-size: 11px; font-weight: 600; letter-spacing: .04em;
    padding: 3px 10px; border-radius: 20px;
    background: ${IS_PLAN ? 'rgba(255,102,0,.12)' : 'rgba(255,102,0,.12)'};
    color: var(--orange);
    border: 1px solid rgba(255,102,0,.3);
  }
  .btn-csv {
    font-family: inherit;
    font-size: 12px; font-weight: 500;
    padding: 6px 14px; border-radius: 6px; cursor: pointer;
    background: var(--bg3); border: 1px solid var(--border); color: var(--dim2);
    transition: color .15s, border-color .15s, background .15s;
  }
  .btn-csv:hover { color: var(--text); border-color: #444; background: var(--bg4); }

  /* ── Content ─────────────────────────────────────────────────── */
  .content { padding: 28px 32px 48px; max-width: 1100px; margin: 0 auto; }

  /* ── Plan banner ─────────────────────────────────────────────── */
  .plan-banner {
    background: rgba(255,102,0,.07); border: 1px solid rgba(255,102,0,.25);
    border-radius: 8px; color: var(--orange2);
    font-size: 13px; padding: 10px 16px; margin-bottom: 24px; line-height: 1.6;
  }

  /* ── KPI Cards ───────────────────────────────────────────────── */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; margin-bottom: 32px; }
  .card {
    background: var(--bg2); border: 1px solid var(--border);
    border-radius: 10px; padding: 20px 20px 16px;
  }
  .card.featured { border-top: 3px solid var(--orange); padding-top: 17px; }
  .card-label { font-size: 11px; font-weight: 500; color: var(--dim2); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 10px; }
  .card-value { font-size: 1.65rem; font-weight: 700; color: var(--orange); line-height: 1; font-variant-numeric: tabular-nums; }
  .card-value.secondary { font-size: 1.3rem; color: var(--text); }
  .card-sub { font-size: 11px; color: var(--dim); margin-top: 8px; }

  /* ── Tab bar ─────────────────────────────────────────────────── */
  .tab-bar {
    display: flex; gap: 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 20px;
  }
  .tab-btn {
    font-family: inherit;
    background: none; border: none; border-bottom: 2px solid transparent;
    color: var(--dim2); font-size: 13px; font-weight: 500;
    padding: 10px 20px; cursor: pointer; margin-bottom: -1px;
    transition: color .15s, border-color .15s;
  }
  .tab-btn:hover  { color: var(--text); }
  .tab-btn.active { color: var(--orange); border-bottom-color: var(--orange); }
  .tab-pane  { display: none; }
  .tab-pane.active { display: block; }

  /* ── Month cards / tables ────────────────────────────────────── */
  .month-card {
    background: var(--bg2); border: 1px solid var(--border);
    border-radius: 10px; margin-bottom: 14px; overflow: hidden;
  }
  .month-head {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 20px; background: var(--bg3); border-bottom: 1px solid var(--border);
    cursor: pointer; user-select: none;
  }
  .month-head:hover { background: var(--bg4); }
  .month-name { font-weight: 600; font-size: 14px; color: #fff; display: flex; align-items: center; gap: 8px; }
  .month-chevron { font-size: 10px; color: var(--dim2); transition: transform .2s; display: inline-block; }
  .month-card.collapsed .month-chevron { transform: rotate(-90deg); }
  .month-card.collapsed .month-body { display: none; }
  .month-cost { font-weight: 700; font-size: 15px; color: var(--orange); font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; }
  th {
    padding: 9px 18px; text-align: left;
    font-size: 11px; font-weight: 600; color: var(--dim);
    text-transform: uppercase; letter-spacing: .05em;
    border-bottom: 1px solid var(--border); white-space: nowrap;
    background: var(--bg3);
  }
  td { padding: 9px 18px; font-size: 13px; border-bottom: 1px solid #1C1C1C; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(255,255,255,.02); }
  .td-r    { text-align: right; }
  .td-proj { max-width: 280px; word-break: break-word; }
  .cost    { color: var(--orange); font-weight: 600; font-variant-numeric: tabular-nums; }
  .dim     { color: var(--dim2); }

  /* ── Bars & badges ───────────────────────────────────────────── */
  .bar-wrap { background: #252525; border-radius: 3px; height: 4px; max-width: 180px; width: 100%; margin-bottom: 6px; }
  .bar-wide { max-width: 260px; }
  .bar { background: linear-gradient(90deg, var(--orange), var(--orange2)); border-radius: 3px; height: 4px; }
  .badges { display: flex; flex-wrap: wrap; gap: 3px; }
  .badge  { font-size: 11px; background: #252525; color: var(--dim2); padding: 1px 7px; border-radius: 8px; }
  .empty  { color: var(--dim); padding: 24px 20px; font-size: 13px; }

  /* ── Footer ──────────────────────────────────────────────────── */
  .footer { font-size: 11px; color: #2E2E2E; margin-top: 40px; text-align: center; }

  @media (max-width: 640px) {
    .topbar { padding: 0 16px; }
    .content { padding: 20px 16px 40px; }
    .cards  { grid-template-columns: 1fr 1fr; }
    .tab-btn { padding: 10px 14px; font-size: 12px; }
    th, td { padding: 8px 12px; }
  }
</style>
</head>
<body>

<!-- Topbar -->
<header class="topbar">
  <div class="topbar-left">
    ${logoInline ? `<div class="brand-logo">${logoInline}</div>` : `<div class="brand-dot">$</div>`}
    <div>
      <div class="topbar-title">Claude Usage Tracker</div>
      <div class="topbar-sub">Orange &mdash; Monitorizacion de uso &middot; ${now}</div>
    </div>
  </div>
  <div class="topbar-right">
    <span class="mode-pill">${IS_PLAN ? 'PLAN' : 'API'}</span>
    <button class="btn-csv" onclick="exportCSV()">Exportar CSV</button>
  </div>
</header>

<!-- Content -->
<main class="content">

${planBanner}

<!-- KPI Cards -->
<div class="cards">
  <div class="card featured">
    <div class="card-label">${IS_PLAN ? 'Equiv. total estimado' : 'Coste total'}</div>
    <div class="card-value">${$4(totalCost)}</div>
    <div class="card-sub">${projectFolders.length} proyectos &middot; ${meses.length} meses</div>
  </div>
  <div class="card">
    <div class="card-label">Mes actual</div>
    <div class="card-value secondary">${mesActual ? $4(costeMes) : '&mdash;'}</div>
    <div class="card-sub">${mesActual ? monthLabel(mesActual) : '&mdash;'}</div>
  </div>
  <div class="card">
    <div class="card-label">Hoy</div>
    <div class="card-value secondary">${$4(todayCost)}</div>
    <div class="card-sub">in: ${fmt(todayTok.input)} &middot; out: ${fmt(todayTok.output)}</div>
  </div>
  <div class="card">
    <div class="card-label">Tokens entrada</div>
    <div class="card-value secondary">${fmt(totalTok.input)}</div>
    <div class="card-sub">Cache escr: ${fmt(totalTok.cacheWrite)}</div>
  </div>
  <div class="card">
    <div class="card-label">Tokens salida</div>
    <div class="card-value secondary">${fmt(totalTok.output)}</div>
    <div class="card-sub">Cache lect: ${fmt(totalTok.cacheRead)}</div>
  </div>
</div>

<!-- Tab bar -->
<div class="tab-bar">
  <button class="tab-btn active" onclick="showTab('mes',this)">Por Mes</button>
  <button class="tab-btn"        onclick="showTab('proyecto',this)">Por Proyecto</button>
  <button class="tab-btn"        onclick="showTab('modelo',this)">Por Modelo</button>
</div>

<!-- Tab Mes -->
<div id="tab-mes" class="tab-pane active">
  ${tabMes}
</div>

<!-- Tab Proyecto -->
<div id="tab-proyecto" class="tab-pane">
  ${tabProyecto}
</div>

<!-- Tab Modelo -->
<div id="tab-modelo" class="tab-pane">
  ${tabModelo}
</div>

<p class="footer">Datos desde ${projectsDir.replace(/\\/g,'/')}</p>

</main>

<script>
function toggleMonth(mes) {
  document.getElementById('mc-' + mes).classList.toggle('collapsed');
}

function showTab(name, btn) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
}

const CSV_DATA = ${JSON.stringify({ rows: csvRows, modelos: csvModelos })};

function exportCSV() {
  const all = [
    ['=== POR MES Y PROYECTO ==='],
    ...CSV_DATA.rows,
    [],
    ['=== POR MODELO ==='],
    ...CSV_DATA.modelos
  ];
  const csv = all.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g,'""') + '"').join(',')).join('\\n');
  const blob = new Blob(['\\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'claude-usage-${new Date().toISOString().slice(0,10)}.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
</script>
</body>
</html>`;

// ─── Guardar y abrir ──────────────────────────────────────────────────────────
const outFile = path.join(os.tmpdir(), 'claude-usage-report.html');
fs.writeFileSync(outFile, html, 'utf8');
console.log(`\n  Reporte: ${outFile}`);
console.log(`  Modo:    ${IS_PLAN ? 'Plan (equiv. estimado)' : 'API (coste real)'}\n`);

try {
  execSync(`rundll32 url.dll,FileProtocolHandler "${outFile}"`, { stdio: 'ignore', shell: true });
} catch {
  console.log(`  Abre manualmente: ${outFile}`);
}
