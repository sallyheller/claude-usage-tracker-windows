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
  // Claude usa '---' como separador de path en los nombres de carpeta
  const parts = folder.split('---').filter(Boolean);
  const last  = parts[parts.length - 1] || folder;
  // Elimina prefijos de usuario tipo "C--Users-nombre-"
  return last.replace(/^[A-Za-z]--[^-]+-[^-]+-/i, '') || last;
}

// ─── Lectura de datos ─────────────────────────────────────────────────────────
const projectsDir = path.join(os.homedir(), '.claude', 'projects');

if (!fs.existsSync(projectsDir)) {
  console.error(`No se encontró la carpeta: ${projectsDir}`);
  process.exit(1);
}

const byMonth   = {};  // { "2026-03": { project: { cost, tokens, models } } }
const byProject = {};  // { project: { cost, tokens } }
const byModel   = {};  // { model: { cost, input, cacheWrite, cacheRead, output } }
let   totalCost = 0;
let   totalTok  = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
let   todayCost = 0;
let   todayTok  = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
const today     = new Date().toISOString().slice(0, 10); // "2026-03-24"

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

      // Por mes + proyecto
      if (!byMonth[month])                    byMonth[month] = {};
      if (!byMonth[month][projectName])       byMonth[month][projectName] = { cost: 0, tokens: 0, models: {} };
      byMonth[month][projectName].cost   += cost;
      byMonth[month][projectName].tokens += (usage.input_tokens || 0) + (usage.output_tokens || 0);
      byMonth[month][projectName].models[model] = (byMonth[month][projectName].models[model] || 0) + cost;

      // Por proyecto
      if (!byProject[projectName]) byProject[projectName] = { cost: 0, tokens: 0 };
      byProject[projectName].cost   += cost;
      byProject[projectName].tokens += (usage.input_tokens || 0) + (usage.output_tokens || 0);

      // Por modelo
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

// ─── Datos para export CSV (se inyectan en el HTML como JSON) ─────────────────
const meses    = Object.keys(byMonth).sort().reverse();
const mesActual = meses[0] || '';
const costeMes  = mesActual ? Object.values(byMonth[mesActual]).reduce((s,p)=>s+p.cost,0) : 0;
const now       = new Date().toLocaleString('es-ES');

// Filas CSV: mes, proyecto, coste, tokens in, tokens out
const csvRows = [['Mes','Proyecto','Coste USD','Tokens Entrada','Tokens Salida','Cache Escritura','Cache Lectura']];
for (const [mes, proyectos] of Object.entries(byMonth).sort()) {
  for (const [proj, d] of Object.entries(proyectos)) {
    csvRows.push([mes, proj, d.cost.toFixed(6), d.tokens, '', '', '']);
  }
}
// modelo rows
const csvModelos = [['Modelo','Coste USD','Tokens Entrada','Cache Escritura','Cache Lectura','Tokens Salida']];
for (const [model, d] of Object.entries(byModel)) {
  csvModelos.push([model, d.cost.toFixed(6), d.input, d.cacheWrite, d.cacheRead, d.output]);
}

// ─── HTML: Tab "Por Mes" ─────────────────────────────────────────────────────
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
  return `<div class="month-card">
    <div class="month-head">
      <span class="month-name">${monthLabel(mes)}</span>
      <span class="month-cost">${$4(totalMes)}</span>
    </div>
    <table><thead><tr>
      <th>Proyecto</th>
      <th class="td-r">${IS_PLAN?'Equiv. estim.':'Coste'}</th>
      <th class="td-r">%</th>
      <th>Detalle</th>
    </tr></thead><tbody>${filas}</tbody></table>
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
  ? `<div class="plan-banner">⚠ Modo <strong>Plan</strong> — los importes mostrados son equivalentes estimados de API. Con una suscripción plana (Max/Pro) no se te cobra por tokens.</div>`
  : '';

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude Usage Tracker</title>
<style>
  :root {
    --bg: #0d0d0d; --bg2: #161616; --bg3: #1e1e1e;
    --border: #2a2a2a; --accent: #f0a500; --accent2: #ff6b35;
    --blue: #7ec8e3; --green: #7ec87e; --dim: #666; --text: #ddd;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system,'Segoe UI',sans-serif; background: var(--bg); color: var(--text); padding: 20px 24px; font-size: 14px; }
  /* Header */
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; flex-wrap: wrap; gap: 8px; }
  h1 { font-size: 1.3rem; font-weight: 700; color: #fff; }
  .mode-badge { font-size: 0.7rem; font-weight: 600; padding: 3px 10px; border-radius: 20px;
    background: ${IS_PLAN ? '#1a2a1a' : '#1a1a2a'}; color: ${IS_PLAN ? '#7ec87e' : '#7ec8e3'};
    border: 1px solid ${IS_PLAN ? '#3a6b3a' : '#3a5a7a'}; }
  .subtitle { color: var(--dim); font-size: 0.8rem; margin-bottom: 20px; }
  /* Plan banner */
  .plan-banner { background: #0f1f0f; border: 1px solid #3a6b3a; border-radius: 8px;
    color: #7ec87e; font-size: 0.82rem; padding: 10px 16px; margin-bottom: 20px; line-height: 1.6; }
  /* Cards */
  .cards { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 28px; }
  .card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 18px 22px; min-width: 150px; flex: 1; }
  .card-label { font-size: 0.7rem; color: var(--dim); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 8px; }
  .card-value { font-size: 1.6rem; font-weight: 700; color: var(--accent); line-height: 1; }
  .card-value.sm { font-size: 1.2rem; color: var(--blue); }
  .card-value.green { font-size: 1.2rem; color: var(--green); }
  .card-sub { font-size: 0.75rem; color: var(--dim); margin-top: 6px; }
  /* Tabs */
  .tab-bar { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid var(--border); padding-bottom: 0; }
  .tab-btn { background: none; border: none; color: var(--dim); font-size: 0.88rem; font-weight: 500;
    padding: 8px 18px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
    transition: color .15s, border-color .15s; }
  .tab-btn:hover { color: var(--text); }
  .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab-pane { display: none; }
  .tab-pane.active { display: block; }
  /* CSV export button */
  .toolbar { display: flex; justify-content: flex-end; margin-bottom: 14px; }
  .btn-csv { background: var(--bg3); border: 1px solid var(--border); color: var(--dim);
    font-size: 0.78rem; padding: 5px 14px; border-radius: 6px; cursor: pointer; transition: color .15s, border-color .15s; }
  .btn-csv:hover { color: var(--text); border-color: #444; }
  /* Month cards */
  .month-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 16px; overflow: hidden; }
  .month-head { display: flex; justify-content: space-between; align-items: center;
    padding: 12px 18px; background: var(--bg3); border-bottom: 1px solid var(--border); }
  .month-name { font-weight: 600; color: #fff; }
  .month-cost { font-weight: 700; font-size: 1.05rem; color: var(--accent); }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 9px 16px; text-align: left; font-size: 0.72rem; color: var(--dim); text-transform: uppercase;
    letter-spacing: .05em; border-bottom: 1px solid #1e1e1e; white-space: nowrap; }
  td { padding: 9px 16px; font-size: 0.83rem; border-bottom: 1px solid #1a1a1a; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1a1a1a; }
  .td-r { text-align: right; }
  .td-proj { max-width: 280px; word-break: break-word; }
  .cost { color: var(--accent); font-weight: 600; font-family: monospace; }
  .dim { color: var(--dim); }
  .bar-wrap { background: #252525; border-radius: 3px; height: 5px; max-width: 180px; width: 100%; margin-bottom: 5px; }
  .bar-wide { max-width: 260px; }
  .bar { background: linear-gradient(90deg, var(--accent), var(--accent2)); border-radius: 3px; height: 5px; }
  .badges { display: flex; flex-wrap: wrap; gap: 3px; }
  .badge { font-size: 0.68rem; background: #252525; color: #777; padding: 1px 6px; border-radius: 8px; }
  .empty { color: var(--dim); padding: 20px; }
  /* Footer */
  .footer { font-size: 0.75rem; color: #333; margin-top: 32px; text-align: center; }
  @media (max-width: 600px) { .cards { flex-direction: column; } .tab-btn { padding: 8px 12px; } }
</style>
</head>
<body>

<div class="header">
  <h1>Claude Usage Tracker</h1>
  <span class="mode-badge">${IS_PLAN ? 'PLAN' : 'API'}</span>
</div>
<p class="subtitle">Actualizado: ${now}</p>

${planBanner}

<!-- Cards resumen -->
<div class="cards">
  <div class="card">
    <div class="card-label">${IS_PLAN ? 'Equiv. total estimado' : 'Coste total'}</div>
    <div class="card-value">${$4(totalCost)}</div>
    <div class="card-sub">${projectFolders.length} proyectos · ${meses.length} meses</div>
  </div>
  <div class="card">
    <div class="card-label">Mes actual</div>
    <div class="card-value sm">${mesActual ? $4(costeMes) : '-'}</div>
    <div class="card-sub">${mesActual ? monthLabel(mesActual) : '—'}</div>
  </div>
  <div class="card">
    <div class="card-label">Hoy</div>
    <div class="card-value green">${$4(todayCost)}</div>
    <div class="card-sub">in: ${fmt(todayTok.input)} · out: ${fmt(todayTok.output)}</div>
  </div>
  <div class="card">
    <div class="card-label">Tokens entrada (total)</div>
    <div class="card-value sm">${fmt(totalTok.input)}</div>
    <div class="card-sub">Cache escr: ${fmt(totalTok.cacheWrite)} · lect: ${fmt(totalTok.cacheRead)}</div>
  </div>
  <div class="card">
    <div class="card-label">Tokens salida (total)</div>
    <div class="card-value sm">${fmt(totalTok.output)}</div>
    <div class="card-sub"> </div>
  </div>
</div>

<!-- Tabs -->
<div class="tab-bar">
  <button class="tab-btn active" onclick="showTab('mes',this)">Por Mes</button>
  <button class="tab-btn"        onclick="showTab('proyecto',this)">Por Proyecto</button>
  <button class="tab-btn"        onclick="showTab('modelo',this)">Por Modelo</button>
</div>

<!-- Export CSV -->
<div class="toolbar">
  <button class="btn-csv" onclick="exportCSV()">⬇ Exportar CSV</button>
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

<p class="footer">Datos leídos desde ${projectsDir.replace(/\\/g,'/')}</p>

<script>
function showTab(name, btn) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
}

// Datos para CSV
const CSV_DATA = ${JSON.stringify({ rows: csvRows, modelos: csvModelos })};

function exportCSV() {
  const all = [
    ['=== POR MES Y PROYECTO ==='],
    ...CSV_DATA.rows,
    [],
    ['=== POR MODELO ==='],
    ...CSV_DATA.modelos
  ];
  const csv = all.map(r => r.map(c => '"' + String(c ?? '').replace(/"/g,'""') + '"').join(',')).join('\\n');
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
  execSync(`start "" "${outFile}"`, { stdio: 'ignore', shell: true });
} catch {
  console.log(`  Abre manualmente: ${outFile}`);
}
