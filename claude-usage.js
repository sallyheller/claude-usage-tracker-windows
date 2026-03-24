#!/usr/bin/env node
/**
 * claude-usage.js — Tracker de uso y costes de Claude Code para Windows
 *
 * Uso:
 *   node claude-usage.js           (modo API — coste real por tokens)
 *   node claude-usage.js --plan    (modo Plan — coste equivalente estimado)
 *
 * Genera un reporte HTML y lo abre en el navegador.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync } = require('child_process');

// ─── Modo de facturación ──────────────────────────────────────────────────────
// --plan  → suscripción plana (Max / Pro): los costes son equivalentes estimados
// --api   → facturación por tokens (por defecto)
const IS_PLAN = process.argv.includes('--plan');

// ─── Precios por modelo (USD por millón de tokens) ───────────────────────────
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

// ─── Nombre de proyecto a partir del nombre de carpeta ────────────────────────
function cleanProjectName(folder) {
  // Las carpetas de Claude usan '---' como separador de ruta
  const parts = folder.split('---').filter(Boolean);
  const last  = parts[parts.length - 1] || folder;
  // Elimina prefijos de unidad tipo "C--Users-xxx-"
  return last.replace(/^[A-Z]--[^-]+-[^-]+-/i, '') || last;
}

// ─── Lectura de datos ─────────────────────────────────────────────────────────
const projectsDir = path.join(os.homedir(), '.claude', 'projects');

if (!fs.existsSync(projectsDir)) {
  console.error(`No se encontró la carpeta de proyectos: ${projectsDir}`);
  process.exit(1);
}

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
      const month = (entry.timestamp || '').slice(0, 7);
      if (!month) continue;

      const cost = calcCost(usage, model);
      totalCost += cost;

      totalTok.input      += usage.input_tokens                || 0;
      totalTok.cacheWrite += usage.cache_creation_input_tokens || 0;
      totalTok.cacheRead  += usage.cache_read_input_tokens     || 0;
      totalTok.output     += usage.output_tokens               || 0;

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

// ─── Helpers de formato ───────────────────────────────────────────────────────
const fmt = n => n >= 1e6 ? `${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : String(n);
const $   = n => IS_PLAN ? `~$${n.toFixed(4)}` : `$${n.toFixed(4)}`;
const $2  = n => IS_PLAN ? `~$${n.toFixed(2)}`  : `$${n.toFixed(2)}`;

function monthLabel(m) {
  const [y, mo] = m.split('-');
  const nombres = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${nombres[parseInt(mo,10)-1]} ${y}`;
}

// ─── Resumen en terminal ──────────────────────────────────────────────────────
const modeBadge = IS_PLAN ? ' [PLAN — coste equivalente estimado]' : ' [API — coste real]';
console.log('\n╔══════════════════════════════════════════════╗');
console.log('║     CLAUDE CODE — USO Y COSTES              ║');
console.log('╚══════════════════════════════════════════════╝');
console.log(modeBadge + '\n');
console.log(`  TOTAL ACUMULADO: ${$(totalCost)}`);
console.log(`  Tokens entrada:   ${fmt(totalTok.input)}`);
console.log(`  Cache escritura:  ${fmt(totalTok.cacheWrite)}`);
console.log(`  Cache lectura:    ${fmt(totalTok.cacheRead)}`);
console.log(`  Tokens salida:    ${fmt(totalTok.output)}\n`);

const meses = Object.keys(byMonth).sort().reverse();
for (const mes of meses) {
  const proyectos = byMonth[mes];
  const totalMes  = Object.values(proyectos).reduce((s, p) => s + p.cost, 0);
  console.log(`  ── ${monthLabel(mes)}: ${$(totalMes)}`);
  for (const [proj, data] of Object.entries(proyectos).sort((a,b) => b[1].cost - a[1].cost)) {
    console.log(`     ${proj.padEnd(35)} ${$(data.cost)}`);
  }
  console.log('');
}

// ─── Generación del HTML ──────────────────────────────────────────────────────
const planBanner = IS_PLAN
  ? `<div class="plan-banner">Modo <strong>Plan</strong> — los costes mostrados son equivalentes estimados de API, no cargos reales. Tienes una suscripción de tarifa plana.</div>`
  : '';

const mesesTabla = meses.map(mes => {
  const proyectos = byMonth[mes];
  const totalMes  = Object.values(proyectos).reduce((s, p) => s + p.cost, 0);
  const filas = Object.entries(proyectos)
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([proj, data]) => {
      const pct      = totalMes > 0 ? ((data.cost / totalMes) * 100).toFixed(1) : '0.0';
      const barWidth = Math.max(1, Math.round(parseFloat(pct)));
      const modelsList = Object.entries(data.models)
        .sort((a,b) => b[1]-a[1])
        .map(([m, c]) => `<span class="badge-model">${m.replace('claude-','')}: ${$(c)}</span>`)
        .join(' ');
      return `
        <tr>
          <td>${proj}</td>
          <td class="text-right cost">${$(data.cost)}</td>
          <td class="text-right">${pct}%</td>
          <td>
            <div class="bar-wrap"><div class="bar" style="width:${barWidth}%"></div></div>
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
      <table>
        <thead><tr><th>Proyecto</th><th class="text-right">${IS_PLAN ? 'Equiv. estimado' : 'Coste'}</th><th class="text-right">%</th><th>Detalle</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
}).join('');

const modelasTabla = Object.entries(byModel)
  .sort((a,b) => b[1].cost - a[1].cost)
  .map(([model, data]) => {
    const pct = totalCost > 0 ? ((data.cost / totalCost) * 100).toFixed(1) : '0.0';
    return `
      <tr>
        <td>${model}</td>
        <td class="text-right cost">${$(data.cost)}</td>
        <td class="text-right">${pct}%</td>
        <td class="text-right">${fmt(data.input)}</td>
        <td class="text-right">${fmt(data.cacheWrite)}</td>
        <td class="text-right">${fmt(data.cacheRead)}</td>
        <td class="text-right">${fmt(data.output)}</td>
      </tr>`;
  }).join('');

const mesActualKey   = meses[0] || '';
const costeMesActual = mesActualKey
  ? Object.values(byMonth[mesActualKey]).reduce((s,p) => s+p.cost, 0)
  : 0;
const now = new Date().toLocaleString('es-ES');

const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude Usage Tracker</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; padding: 24px; }
  h1 { font-size: 1.5rem; font-weight: 700; color: #fff; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 0.85rem; margin-bottom: 16px; }
  .plan-banner { background: #1a2a1a; border: 1px solid #3a6b3a; border-radius: 8px; color: #7ec87e; font-size: 0.82rem; padding: 10px 16px; margin-bottom: 20px; }
  .mode-badge { display: inline-block; font-size: 0.7rem; font-weight: 600; padding: 2px 8px; border-radius: 10px; margin-left: 8px; vertical-align: middle; background: ${IS_PLAN ? '#1a2a1a' : '#1a1a2a'}; color: ${IS_PLAN ? '#7ec87e' : '#7ec8e3'}; border: 1px solid ${IS_PLAN ? '#3a6b3a' : '#3a5a7a'}; }
  .cards { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 32px; }
  .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 20px 24px; min-width: 180px; }
  .card-label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
  .card-value { font-size: 1.6rem; font-weight: 700; color: #f0a500; }
  .card-sub { font-size: 0.8rem; color: #555; margin-top: 4px; }
  .section-title { font-size: 1rem; font-weight: 600; color: #aaa; margin-bottom: 14px; text-transform: uppercase; letter-spacing: .06em; }
  .month-block { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; margin-bottom: 20px; overflow: hidden; }
  .month-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; background: #222; border-bottom: 1px solid #2a2a2a; }
  .month-name { font-weight: 600; font-size: 1rem; color: #fff; }
  .month-total { font-weight: 700; font-size: 1.1rem; color: #f0a500; }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 10px 16px; text-align: left; font-size: 0.75rem; color: #555; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #222; }
  td { padding: 10px 16px; font-size: 0.85rem; border-bottom: 1px solid #1e1e1e; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #202020; }
  .text-right { text-align: right; }
  .cost { color: #f0a500; font-weight: 600; font-family: monospace; }
  .bar-wrap { background: #2a2a2a; border-radius: 4px; height: 6px; width: 100%; max-width: 200px; margin-bottom: 6px; }
  .bar { background: linear-gradient(90deg, #f0a500, #ff6b35); border-radius: 4px; height: 6px; }
  .models-list { display: flex; flex-wrap: wrap; gap: 4px; }
  .badge-model { font-size: 0.72rem; background: #2a2a2a; color: #888; padding: 2px 7px; border-radius: 10px; }
  .section { margin-bottom: 36px; }
  .updated { font-size: 0.78rem; color: #444; margin-top: 32px; text-align: center; }
  @media (max-width: 600px) { .cards { flex-direction: column; } }
</style>
</head>
<body>

<h1>Claude Usage Tracker <span class="mode-badge">${IS_PLAN ? 'PLAN' : 'API'}</span></h1>
<p class="subtitle">Actualizado: ${now}</p>

${planBanner}

<div class="cards">
  <div class="card">
    <div class="card-label">${IS_PLAN ? 'Equiv. total estimado' : 'Coste total'}</div>
    <div class="card-value">${$(totalCost)}</div>
    <div class="card-sub">${projectFolders.length} proyectos</div>
  </div>
  <div class="card">
    <div class="card-label">Tokens entrada</div>
    <div class="card-value" style="font-size:1.2rem;color:#7ec8e3">${fmt(totalTok.input)}</div>
    <div class="card-sub">Cache escritura: ${fmt(totalTok.cacheWrite)}</div>
  </div>
  <div class="card">
    <div class="card-label">Cache leída</div>
    <div class="card-value" style="font-size:1.2rem;color:#7ec8e3">${fmt(totalTok.cacheRead)}</div>
    <div class="card-sub">Tokens salida: ${fmt(totalTok.output)}</div>
  </div>
  <div class="card">
    <div class="card-label">Mes actual</div>
    <div class="card-value" style="font-size:1.2rem">
      ${mesActualKey ? $(costeMesActual) : '$0.0000'}
    </div>
    <div class="card-sub">${mesActualKey ? monthLabel(mesActualKey) : '—'}</div>
  </div>
</div>

<div class="section">
  <div class="section-title">Por mes y proyecto</div>
  ${mesesTabla || '<p style="color:#555">Sin datos</p>'}
</div>

<div class="section">
  <div class="section-title">Por modelo</div>
  <div class="month-block">
    <table>
      <thead>
        <tr>
          <th>Modelo</th>
          <th class="text-right">${IS_PLAN ? 'Equiv. estimado' : 'Coste'}</th>
          <th class="text-right">%</th>
          <th class="text-right">Entrada</th>
          <th class="text-right">Cache escr.</th>
          <th class="text-right">Cache lect.</th>
          <th class="text-right">Salida</th>
        </tr>
      </thead>
      <tbody>${modelasTabla || '<tr><td colspan="7" style="color:#555;text-align:center">Sin datos</td></tr>'}</tbody>
    </table>
  </div>
</div>

<p class="updated">Datos leídos desde ${projectsDir.replace(/\\/g,'/')}</p>

</body>
</html>`;

// ─── Guardar y abrir ──────────────────────────────────────────────────────────
const outFile = path.join(os.tmpdir(), 'claude-usage-report.html');
fs.writeFileSync(outFile, html, 'utf8');
console.log(`  Reporte generado: ${outFile}`);

try {
  execSync(`start "" "${outFile}"`, { stdio: 'ignore', shell: true });
  console.log('  Abriendo en el navegador...\n');
} catch {
  console.log(`  Abre manualmente: ${outFile}\n`);
}
