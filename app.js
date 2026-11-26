/* Painel das aulas práticas de EB I
 * Lê as abas para_html_* da planilha pública do Google Sheets (endpoint gviz)
 * e desenha os gráficos com Plotly. Nenhum dado fica gravado no repositório.
 */
'use strict';

/* ======================================================================
 * Configuração
 * ==================================================================== */
const CONFIG = {
  sheetId: '1uL6H4w_xtsVTnXaCtzWXSEzGB7hGuTp-X9pSAborgQI',
  cacheKey: 'eb1_painel_cache_v1',
  tabs: {
    grupos:     { sheet: 'para_html_grupos',    cols: ['experimento', 'equipe', 'rotulo', 'condicao', 'tem_dados'] },
    curvas:     { sheet: 'para_html_curvas',    cols: ['sistema', 'equipe', 'frasco', 'coleta', 'tempo_min', 'X_g_L', 'fase_exp', 'descartado', 'obs'] },
    bio:        { sheet: 'para_html_bio',       cols: ['amostra', 'tempo_min', 'temp_C', 'pH', 'DO_pct', 'rpm', 'ar_L_min', 'X_g_L', 'fase_exp', 'tempo_pulso_min', 'OUR_mg_L_s', 'qO2_mmol_g_h', 'r2_OUR'] },
    pulsos:     { sheet: 'para_html_pulsos',    cols: ['amostra', 'tempo_s', 'DO_pct', 'DO_mg_L', 'linear'] },
    valores:    { sheet: 'para_html_valores',   cols: ['experimento', 'metrica', 'equipe', 'frasco', 'valor', 'status', 'y_plot', 'ep', 'r2'] },
    stats:      { sheet: 'para_html_stats',     cols: ['experimento', 'metrica', 'grupo_a', 'grupo_b', 'n_a', 'n_b', 'media_a', 'dp_a', 'media_b', 'dp_b', 'p_student', 'p_welch'] },
    descartes:  { sheet: 'para_html_descartes', cols: ['equipe', 'frasco', 'coleta', 'descartado', 'obs'], optional: true },
    parametros: { sheet: 'parametros',          cols: ['parametro', 'valor', 'unidade'], optional: true },
  },
};

const GROUPS = ['1', '2', '3', '4', '5', '6'];
const PLANNED = '3-6';
// Okabe-Ito, ordem fixa por equipe (validada: secundária = símbolo + legenda + tabela)
const COLOR = { '1': '#E69F00', '2': '#56B4E9', '3': '#0072B2', '4': '#009E73', '5': '#CC79A7', '6': '#D55E00', bio: '#2b2f33' };
const SYMBOL = { '1': 'circle', '2': 'square', '3': 'diamond', '4': 'triangle-up', '5': 'triangle-down', '6': 'pentagon', bio: 'star' };
const DASH = ['solid', 'dash', 'dot'];
const INK = '#4a545c', INK3 = '#7b858c', ACCENT = '#256c8c', GRID = '#eef1f3', LINE = '#cfd5da';

const METRICS = {
  mu_min:   { exp: 'cinetica', name: 'μmax', axis: (u) => `μ<sub>max</sub> (${u === 'h' ? 'h⁻¹' : 'min⁻¹'})`, unit: (u) => (u === 'h' ? 'h⁻¹' : 'min⁻¹'), dec: (u) => (u === 'h' ? 3 : 4) },
  tg_min:   { exp: 'cinetica', name: 'tg', axis: () => 't<sub>g</sub> (min)', unit: () => 'min', dec: () => 1 },
  AA:       { exp: 'fes', name: 'Atividade amilolítica', axis: () => 'Atividade amilolítica (U/g)', unit: () => 'U/g', dec: () => 1 },
  proteina: { exp: 'fes', name: 'Proteína', axis: () => 'Proteína (mg/g)', unit: () => 'mg/g', dec: () => 1 },
  AE:       { exp: 'fes', name: 'Atividade específica', axis: () => 'Atividade específica (U/mg)', unit: () => 'U/mg', dec: () => 2 },
};
const T975 = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228 };

/* ======================================================================
 * Estado
 * ==================================================================== */
const S = {
  data: null, loadedAt: null, fromCache: false, warnings: [],
  tab: 'bio',
  bioLogX: false, bioExp: true, doCrit: null, pulse: 1,
  cmpGroups: new Set(['3', '6', 'bio']), cmpMode: 'mean', cmpNorm: 'x', cmpScale: 'linear', cmpDesc: true, cmpExcl: true,
  cinMetric: 'mu_min', cinUnit: 'min', cinBio: true,
  fesMetric: 'AA',
  err: 'sd', points: true, test: 'student',
  statGroups: { cinetica: null, fes: null },   // null = todos com dados
  pairs: {},                                    // 'cinetica|mu_min' -> Set('3-6', ...)
  dataSel: 'curvas',
};

/* ======================================================================
 * Utilidades
 * ==================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
};
const num = (v) => {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const x = Number(v.replace(/\s/g, '').replace(',', '.'));
    return isFinite(x) ? x : null;
  }
  return null;
};
const bool = (v) => v === true || v === 'TRUE' || v === 'true' || v === 1;
const str = (v) => (v == null ? '' : String(v).trim());
const fmt = (v, d = 2) => (v == null || !isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtP = (p) => (p == null ? '—' : p < 0.001 ? '< 0,001' : fmt(p, p < 0.1 ? 3 : 2));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const sd = (a) => {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const alpha = () => {
  const r = (S.data?.parametros || []).find((x) => str(x.parametro) === 'alfa');
  return num(r?.valor) ?? 0.05;
};
const stars = (p) => (p == null ? '' : p < 0.001 ? '***' : p < 0.01 ? '**' : p < alpha() ? '*' : 'n.s.');
const pairKey = (a, b) => (Number(a) < Number(b) ? `${a}-${b}` : `${b}-${a}`);

function groupMeta(exp, g) {
  const r = (S.data?.grupos || []).find((x) => x.experimento === exp && x.equipe === g);
  return {
    rotulo: r ? str(r.rotulo) : g === 'bio' ? 'Biorreator' : `Equipe ${g}`,
    condicao: r ? str(r.condicao) : '',
    tem: r ? bool(r.tem_dados) : true,
  };
}
const shortLabel = (g) => (g === 'bio' ? 'Biorreator' : `Eq. ${g}`);

/* ======================================================================
 * Leitura da planilha (gviz)
 * ==================================================================== */
function gvizUrl(sheet, handler) {
  const tqx = handler ? `out:json;responseHandler:${handler}` : 'out:json';
  return `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/gviz/tq?tqx=${tqx}&headers=1&sheet=${encodeURIComponent(sheet)}&_=${Date.now()}`;
}
function tableToRows(table) {
  const labels = table.cols.map((c, i) => str(c.label) || str(c.id) || `col${i}`);
  const rows = [];
  for (const r of table.rows || []) {
    const cells = r.c || [];
    const o = {};
    let any = false;
    labels.forEach((lab, i) => {
      const c = cells[i];
      let v = c ? c.v : null;
      if (c && c.f != null && ((typeof v === 'string' && v.startsWith('Date(')) || Array.isArray(v))) v = c.f;
      if (v === '') v = null;
      if (v != null) any = true;
      o[lab] = v;
    });
    if (any) rows.push(o);
  }
  return { labels, rows };
}
function parseGviz(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < 0) throw new Error('resposta inesperada');
  const obj = JSON.parse(text.slice(s, e + 1));
  if (obj.status === 'error') throw new Error((obj.errors || []).map((x) => x.detailed_message || x.message).join('; ') || 'erro do Sheets');
  return tableToRows(obj.table);
}
function jsonpSheet(sheet) {
  return new Promise((resolve, reject) => {
    const cb = `__gviz_${Math.random().toString(36).slice(2)}`;
    const sc = document.createElement('script');
    const timer = setTimeout(() => { cleanup(); reject(new Error('tempo esgotado')); }, 20000);
    function cleanup() { clearTimeout(timer); try { delete window[cb]; } catch (_) { window[cb] = undefined; } sc.remove(); }
    window[cb] = (obj) => {
      cleanup();
      if (obj.status === 'error') reject(new Error((obj.errors || []).map((x) => x.detailed_message || x.message).join('; ')));
      else resolve(tableToRows(obj.table));
    };
    sc.onerror = () => { cleanup(); reject(new Error('falha de rede')); };
    sc.src = gvizUrl(sheet, cb);
    document.head.appendChild(sc);
  });
}
async function fetchSheet(sheet) {
  try {
    const r = await fetch(gvizUrl(sheet), { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return parseGviz(await r.text());
  } catch (err) {
    return jsonpSheet(sheet); // alternativa se o fetch for bloqueado por CORS
  }
}

function normalize(key, rows) {
  const N = (r, k) => (r[k] = num(r[k]));
  const B = (r, k) => (r[k] = bool(r[k]));
  const T = (r, k) => (r[k] = str(r[k]));
  for (const r of rows) {
    switch (key) {
      case 'grupos': T(r, 'experimento'); T(r, 'equipe'); B(r, 'tem_dados'); break;
      case 'curvas': T(r, 'sistema'); T(r, 'equipe'); ['frasco', 'coleta', 'tempo_min', 'X_g_L'].forEach((k) => N(r, k)); B(r, 'fase_exp'); B(r, 'descartado'); T(r, 'obs'); break;
      case 'bio': ['amostra', 'tempo_min', 'temp_C', 'pH', 'DO_pct', 'rpm', 'ar_L_min', 'X_g_L', 'tempo_pulso_min', 'OUR_mg_L_s', 'qO2_mmol_g_h', 'r2_OUR'].forEach((k) => N(r, k)); B(r, 'fase_exp'); break;
      case 'pulsos': ['amostra', 'tempo_s', 'DO_pct', 'DO_mg_L'].forEach((k) => N(r, k)); B(r, 'linear'); break;
      case 'valores': T(r, 'experimento'); T(r, 'metrica'); T(r, 'equipe'); T(r, 'status'); ['frasco', 'valor', 'y_plot', 'ep', 'r2'].forEach((k) => N(r, k)); break;
      case 'stats': T(r, 'experimento'); T(r, 'metrica'); T(r, 'grupo_a'); T(r, 'grupo_b'); ['n_a', 'n_b', 'media_a', 'dp_a', 'media_b', 'dp_b', 'p_student', 'p_welch'].forEach((k) => N(r, k)); break;
      default: break;
    }
  }
  if (key === 'curvas') return rows.filter((r) => r.sistema);
  if (key === 'valores' || key === 'stats') return rows.filter((r) => r.experimento);
  if (key === 'bio') return rows.filter((r) => r.amostra != null);
  if (key === 'pulsos') return rows.filter((r) => r.amostra != null);
  return rows;
}

async function loadAll() {
  const btn = $('#btn-refresh');
  btn.disabled = true; btn.classList.add('loading');
  document.querySelectorAll('.chart').forEach((c) => c.classList.add('loading-dim'));
  setStatus('Lendo a planilha…');
  const entries = Object.entries(CONFIG.tabs);
  const results = await Promise.allSettled(entries.map(([, t]) => fetchSheet(t.sheet)));
  const data = {}, raw = {}, warnings = [];
  let fatal = 0;
  results.forEach((res, i) => {
    const [key, t] = entries[i];
    if (res.status === 'rejected') {
      warnings.push(`Não foi possível ler a aba “${t.sheet}”: ${res.reason?.message || res.reason}`);
      if (!t.optional) fatal++;
      data[key] = S.data?.[key] || [];
      raw[key] = S.data?.__raw?.[key] || { labels: [], rows: [] };
      return;
    }
    const { labels, rows } = res.value;
    const missing = t.cols.filter((c) => !labels.includes(c));
    if (missing.length) warnings.push(`Aba “${t.sheet}”: colunas ausentes ou renomeadas: ${missing.join(', ')}.`);
    raw[key] = { labels, rows: rows.map((r) => ({ ...r })) };
    data[key] = normalize(key, rows);
  });
  btn.disabled = false; btn.classList.remove('loading');
  document.querySelectorAll('.chart').forEach((c) => c.classList.remove('loading-dim'));
  if (fatal === entries.filter(([, t]) => !t.optional).length) {
    S.warnings = warnings;
    renderWarnings();
    setStatus('<span class="bad">Falha ao ler a planilha.</span> Confira se ela está compartilhada como “qualquer pessoa com o link”.');
    return;
  }
  data.__raw = raw;
  S.data = data; S.loadedAt = new Date(); S.fromCache = false; S.warnings = warnings;
  try { localStorage.setItem(CONFIG.cacheKey, JSON.stringify({ t: S.loadedAt.toISOString(), data })); } catch (_) { /* armazenamento indisponível */ }
  afterData();
}

function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG.cacheKey) || 'null');
    if (!c || !c.data) return false;
    S.data = c.data; S.loadedAt = new Date(c.t); S.fromCache = true; S.warnings = [];
    return true;
  } catch (_) { return false; }
}

function afterData() {
  sanitizeSelections();
  renderWarnings();
  const nRows = Object.entries(S.data).filter(([k]) => k !== '__raw').reduce((s, [, v]) => s + v.length, 0);
  const when = S.loadedAt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  setStatus(S.fromCache
    ? `Dados em cache de <b>${when}</b> · clique em Atualizar para buscar a versão atual.`
    : `<span class="ok">Atualizado</span> em ${when} · ${nRows.toLocaleString('pt-BR')} linhas${S.warnings.length ? ` · ${S.warnings.length} aviso(s)` : ''}`);
  buildStaticControls();
  renderTab();
}
function setStatus(html) { $('#status').innerHTML = html; }
function renderWarnings() {
  const box = $('#warnings');
  box.replaceChildren();
  if (!S.warnings.length) { box.hidden = true; return; }
  box.hidden = false;
  box.append(el('strong', { text: 'Avisos da leitura' }));
  const ul = el('ul');
  S.warnings.forEach((w) => ul.append(el('li', { text: w })));
  box.append(ul);
}
function sanitizeSelections() {
  for (const g of [...S.cmpGroups]) if (!groupMeta('cinetica', g).tem) S.cmpGroups.delete(g);
}

/* ======================================================================
 * Plotly: base comum
 * ==================================================================== */
const BASE_LAYOUT = () => ({
  font: { family: 'Archivo, system-ui, sans-serif', size: 12, color: INK },
  paper_bgcolor: '#fff', plot_bgcolor: '#fff', separators: ',.',
  margin: { l: 70, r: 24, t: 24, b: 52 },
  hoverlabel: { font: { family: 'JetBrains Mono, monospace', size: 12, color: '#1d2328' }, bgcolor: '#fff', bordercolor: LINE, align: 'left' },
  legend: { orientation: 'h', x: 0, y: -0.16, font: { size: 12 } },
});
const LOGTICKS = { tickvals: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50], ticktext: ['0,01', '0,02', '0,05', '0,1', '0,2', '0,5', '1', '2', '5', '10', '20', '50'] };
const AX = (extra = {}) => ({ gridcolor: GRID, zeroline: false, linecolor: LINE, showline: true, ticks: 'outside', tickcolor: LINE, ticklen: 4, automargin: true, ...extra });
const PCFG = {
  displaylogo: false, responsive: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'toggleSpikelines'],
  toImageButtonOptions: { format: 'png', scale: 3 },
  locale: 'pt-BR',
};
function emptyChart(id, msg) {
  const div = document.getElementById(id);
  try { Plotly.purge(div); } catch (_) { /* nada */ }
  div.replaceChildren(el('div', { class: 'empty', text: msg }));
}
function plot(id, traces, layout) {
  const div = document.getElementById(id);
  if (div.querySelector('.empty')) div.replaceChildren();
  return Plotly.react(div, traces, layout, PCFG);
}

/* ======================================================================
 * Aba Biorreator
 * ==================================================================== */
function renderBio() {
  const rows = (S.data?.bio || []).slice().sort((a, b) => a.tempo_min - b.tempo_min);
  if (!rows.length) { emptyChart('chart-bio', 'Clique em “Atualizar dados” para carregar o biorreator.'); return; }

  const panels = [
    { key: 'X_g_L', title: '<b>X</b> · concentração celular', axis: 'g/L', name: 'X', ht: '%{y:.3f} g/L', type: S.bioLogX ? 'log' : 'linear' },
    { key: 'DO_pct', title: '<b>OD</b> · oxigênio dissolvido', axis: '% sat.', name: 'OD', ht: '%{y:.1f} % sat.' },
    { key: 'pH', title: '<b>pH</b>', axis: 'pH', name: 'pH', ht: '%{y:.2f}' },
    { key: 'qO2_mmol_g_h', title: '<b>q<sub>O₂</sub></b> · consumo específico de O₂ (no tempo do pulso; clique para abrir)', axis: 'mmol g⁻¹ h⁻¹', name: 'qO₂', ht: '%{y:.2f} mmol g⁻¹ h⁻¹ · pulso %{customdata}', xkey: 'tempo_pulso_min', markersOnly: true },
    { key: 'temp_C', title: '<b>Temperatura</b>', axis: '°C', name: 'T', ht: '%{y:.1f} °C' },
    { key: 'rpm', title: '<b>Agitação</b>', axis: 'rpm', name: 'Agitação', ht: '%{y:.0f} rpm', shape: 'hv' },
  ];
  const n = panels.length, gap = 0.034, h = (1 - gap * (n - 1)) / n;
  const layout = BASE_LAYOUT();
  layout.margin = { l: 78, r: 24, t: 30, b: 50 };
  layout.hovermode = 'x unified';
  layout.showlegend = false;
  layout.annotations = [];
  layout.shapes = [];
  const xmax = Math.max(...rows.map((r) => Math.max(r.tempo_min ?? 0, r.tempo_pulso_min ?? 0))) + 8;
  layout.xaxis = AX({
    anchor: `y${n}`, domain: [0, 1], title: { text: 'Tempo de cultivo (min)' }, range: [-6, xmax],
    showspikes: true, spikemode: 'across', spikesnap: 'cursor', spikethickness: 1, spikedash: 'dot', spikecolor: INK3,
  });
  const traces = [];
  panels.forEach((p, i) => {
    const top = 1 - i * (h + gap), bot = top - h;
    const ax = i === 0 ? 'yaxis' : `yaxis${i + 1}`, yref = i === 0 ? 'y' : `y${i + 1}`;
    const yv = rows.map((r) => r[p.key]).filter((v) => v != null);
    const lo = Math.min(...yv), hi = Math.max(...yv), span = (hi - lo) || Math.abs(hi) || 1;
    const isLog = p.type === 'log';
    layout[ax] = AX({ domain: [bot, top], anchor: 'x', title: { text: p.axis, font: { size: 11 }, standoff: 6 }, type: p.type || 'linear', nticks: 5,
      ...(isLog ? LOGTICKS : { range: [lo - 0.12 * span, hi + 0.32 * span] }) });
    layout.annotations.push({ xref: 'paper', yref: 'paper', x: 0, y: top, xanchor: 'left', yanchor: 'bottom', text: p.title, showarrow: false, font: { size: 12, color: '#1d2328' } });
    const xs = rows.map((r) => r[p.xkey || 'tempo_min']);
    const ys = rows.map((r) => r[p.key]);
    const isX = p.key === 'X_g_L';
    traces.push({
      type: 'scatter', mode: p.markersOnly ? 'markers' : 'lines+markers', x: xs, y: ys, yaxis: yref, name: p.name,
      customdata: rows.map((r) => r.amostra),
      line: { color: ACCENT, width: 2, shape: p.shape || 'linear' },
      marker: {
        color: isX ? rows.map((r) => (r.fase_exp ? ACCENT : '#fff')) : ACCENT,
        size: p.markersOnly ? 10 : 8,
        line: { color: ACCENT, width: 2 },
      },
      hovertemplate: p.ht,
      connectgaps: true,
    });
  });

  // Fase exponencial (pontos usados no ajuste do biorreator)
  const exp = rows.filter((r) => r.fase_exp);
  if (S.bioExp && exp.length >= 2) {
    const x0 = Math.min(...exp.map((r) => r.tempo_min)), x1 = Math.max(...exp.map((r) => r.tempo_min));
    layout.shapes.push({ type: 'rect', xref: 'x', yref: 'paper', x0, x1, y0: 0, y1: 1, fillcolor: ACCENT, opacity: 0.06, line: { width: 0 }, layer: 'below' });
    layout.annotations.push({ xref: 'x', yref: 'paper', x: (x0 + x1) / 2, y: 1, yanchor: 'bottom', yshift: 14, text: 'fase exponencial (ajuste)', showarrow: false, font: { size: 11, color: ACCENT } });
  }
  // Mudanças de vazão de ar (registradas na amostra em que o novo valor aparece)
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].ar_L_min, b = rows[i].ar_L_min;
    if (a != null && b != null && a !== b) {
      const x = rows[i].tempo_min;
      layout.shapes.push({ type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1, line: { color: INK3, width: 1, dash: 'dash' } });
      layout.annotations.push({ xref: 'x', yref: 'paper', x, y: 1, yanchor: 'top', yshift: -16, xanchor: 'left', xshift: 3, text: `ar ${fmt(a, 1)} → ${fmt(b, 1)} L/min`, showarrow: false, font: { size: 10.5, color: INK }, bgcolor: 'rgba(255,255,255,.85)' });
    }
  }
  // Limite de OD informado pelo usuário
  if (S.doCrit != null && S.doCrit > 0) {
    layout.shapes.push({ type: 'rect', xref: 'paper', yref: 'y2', x0: 0, x1: 1, y0: 0, y1: S.doCrit, fillcolor: '#7b858c', opacity: 0.13, line: { width: 0 }, layer: 'below' });
    layout.shapes.push({ type: 'line', xref: 'paper', yref: 'y2', x0: 0, x1: 1, y0: S.doCrit, y1: S.doCrit, line: { color: INK3, width: 1, dash: 'dot' } });
    const below = rows.filter((r) => r.DO_pct != null && r.DO_pct < S.doCrit).length;
    layout.annotations.push({ xref: 'paper', yref: 'y2', x: 1, y: S.doCrit, xanchor: 'right', yanchor: 'bottom', text: `limite ${fmt(S.doCrit, 0)} % · ${below} amostra(s) abaixo`, showarrow: false, font: { size: 10.5, color: INK } });
    layout.yaxis2.range = [0, layout.yaxis2.range[1]];
  }

  plot('chart-bio', traces, layout).then((div) => {
    div.removeAllListeners?.('plotly_click');
    div.on('plotly_click', (ev) => {
      const pt = ev.points.find((p) => p.data.name === 'qO₂') || ev.points[0];
      const am = pt && pt.customdata;
      if (am != null) {
        S.pulse = am; $('#pulse-sel').value = String(am); renderPulse();
        $('#chart-pulse').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });
}

function renderPulse() {
  const all = S.data?.pulsos || [];
  const ids = [...new Set(all.map((r) => r.amostra))].sort((a, b) => a - b);
  const sel = $('#pulse-sel');
  if (sel.options.length !== ids.length) {
    sel.replaceChildren(...ids.map((i) => el('option', { value: String(i), text: `Pulso ${i}` })));
  }
  if (!ids.includes(S.pulse)) S.pulse = ids[0];
  sel.value = String(S.pulse);
  const pts = all.filter((r) => r.amostra === S.pulse && r.DO_mg_L != null).sort((a, b) => a.tempo_s - b.tempo_s);
  if (!pts.length) { emptyChart('chart-pulse', 'Sem dados de pulso.'); $('#pulse-info').textContent = ''; return; }
  const lin = pts.filter((r) => r.linear);
  const info = (S.data?.bio || []).find((r) => r.amostra === S.pulse) || {};
  const traces = [
    { type: 'scatter', mode: 'lines+markers', x: pts.map((r) => r.tempo_s), y: pts.map((r) => r.DO_mg_L), name: 'OD registrado',
      customdata: pts.map((r) => r.DO_pct), line: { color: LINE, width: 2 }, marker: { color: '#fff', size: 7, line: { color: INK3, width: 1.5 } },
      hovertemplate: '<b>%{y:.3f} mg/L</b> (%{customdata:.1f} % sat.)<br>t = %{x:.0f} s<extra></extra>' },
    { type: 'scatter', mode: 'markers', x: lin.map((r) => r.tempo_s), y: lin.map((r) => r.DO_mg_L), name: 'Janela linear',
      marker: { color: ACCENT, size: 9, line: { color: '#fff', width: 1.5 } },
      hovertemplate: '<b>%{y:.3f} mg/L</b><br>t = %{x:.0f} s · janela linear<extra></extra>' },
  ];
  // Reta com a inclinação calculada na planilha, passando pelo centróide da janela
  if (lin.length >= 2 && info.OUR_mg_L_s != null) {
    const tb = mean(lin.map((r) => r.tempo_s)), yb = mean(lin.map((r) => r.DO_mg_L));
    const t0 = lin[0].tempo_s, t1 = lin[lin.length - 1].tempo_s;
    traces.push({ type: 'scatter', mode: 'lines', x: [t0, t1], y: [yb - info.OUR_mg_L_s * (t0 - tb), yb - info.OUR_mg_L_s * (t1 - tb)], name: 'Inclinação (planilha)',
      line: { color: '#1d2328', width: 1.5, dash: 'dash' }, hoverinfo: 'skip' });
  }
  const layout = BASE_LAYOUT();
  layout.hovermode = 'closest';
  layout.xaxis = AX({ title: { text: 'Tempo desde o desligamento do ar (s)' } });
  layout.yaxis = AX({ title: { text: 'OD (mg/L)' } });
  plot('chart-pulse', traces, layout);
  const parts = [`pulso aos ${fmt(info.tempo_pulso_min, 1)} min`, `OUR = ${fmt(info.OUR_mg_L_s, 4)} mg L⁻¹ s⁻¹`, `r² = ${fmt(info.r2_OUR, 4)}`, `qO₂ = ${fmt(info.qO2_mmol_g_h, 2)} mmol g⁻¹ h⁻¹`, `${lin.length} pontos na janela`];
  $('#pulse-info').textContent = parts.join('  ·  ');
}

/* ---------- comparação biorreator × Erlenmeyers ---------- */
function buildCmpChips() {
  const box = $('#cmp-groups');
  box.replaceChildren();
  [...GROUPS, 'bio'].forEach((g) => {
    const m = groupMeta('cinetica', g);
    const on = m.tem && S.cmpGroups.has(g);
    const chip = el('button', {
      class: `chip${m.tem ? '' : ' nodata'}`, type: 'button', 'aria-pressed': String(on), disabled: !m.tem,
      title: m.tem ? (m.condicao || m.rotulo) : `${m.rotulo}: sem dados na planilha`,
      onclick: () => { if (S.cmpGroups.has(g)) S.cmpGroups.delete(g); else S.cmpGroups.add(g); buildCmpChips(); renderCmp(); writeHash(); },
    });
    chip.append(el('span', { class: 'sw', style: `background:${COLOR[g]}` }), el('span', { text: m.rotulo }));
    if (m.condicao) chip.append(el('span', { class: 'cond', text: `· ${m.condicao}` }));
    box.append(chip);
  });
}

function renderCmp() {
  const rows = S.data?.curvas || [];
  if (!rows.length) { emptyChart('chart-cmp', 'Clique em “Atualizar dados” para carregar as curvas.'); return; }
  const ratio = S.cmpNorm === 'ratio';
  const traces = [];
  const yLab = ratio ? 'X / X₀' : 'X (g/L)';
  const sel = [...GROUPS, 'bio'].filter((g) => S.cmpGroups.has(g));
  if (!sel.length) { emptyChart('chart-cmp', 'Selecione ao menos um grupo acima.'); return; }

  for (const g of sel) {
    const meta = groupMeta('cinetica', g);
    const gr = rows.filter((r) => r.equipe === g && r.X_g_L != null);
    if (!gr.length) continue;
    const flasks = [...new Set(gr.map((r) => r.frasco))].sort((a, b) => a - b);
    // X0 por frasco = primeira coleta não descartada
    const x0 = {};
    flasks.forEach((f) => {
      const k = gr.filter((r) => r.frasco === f && !r.descartado).sort((a, b) => a.tempo_min - b.tempo_min)[0];
      x0[f] = k ? k.X_g_L : null;
    });
    const val = (r) => (ratio ? (x0[r.frasco] ? r.X_g_L / x0[r.frasco] : null) : r.X_g_L);
    const cd = (r) => [meta.rotulo, r.frasco, r.coleta, r.fase_exp ? 'sim' : 'não', r.descartado ? `descartado${r.obs ? ' · ' + r.obs : ''}` : (r.obs || '—'), r.X_g_L];
    const htPoint = `<b>%{y:.4f}</b> ${ratio ? '× X₀' : 'g/L'}<br>%{customdata[0]} · frasco %{customdata[1]} · coleta %{customdata[2]}<br>t = %{x:.0f} min · fase exp.: %{customdata[3]}<br>%{customdata[4]}<extra></extra>`;
    const sym = SYMBOL[g];

    if (S.cmpMode === 'flask' || g === 'bio') {
      flasks.forEach((f, fi) => {
        const pts = gr.filter((r) => r.frasco === f).sort((a, b) => a.tempo_min - b.tempo_min);
        const keep = pts.filter((r) => !r.descartado && val(r) != null);
        const label = g === 'bio' ? 'Biorreator' : `${shortLabel(g)} · F${f}`;
        traces.push({
          type: 'scatter', mode: 'lines+markers', name: label, legendgroup: g,
          x: keep.map((r) => r.tempo_min), y: keep.map(val), customdata: keep.map(cd),
          line: { color: COLOR[g], width: 2, dash: g === 'bio' ? 'solid' : DASH[fi % 3] },
          marker: { symbol: sym, size: keep.map((r) => (r.fase_exp ? 10 : 8)), color: COLOR[g], line: { color: keep.map((r) => (r.fase_exp ? '#1d2328' : '#fff')), width: keep.map((r) => (r.fase_exp ? 1.8 : 1)) } },
          hovertemplate: htPoint,
        });
        const desc = pts.filter((r) => r.descartado && val(r) != null);
        if (S.cmpDesc && desc.length) {
          traces.push({
            type: 'scatter', mode: 'markers', name: `${label} (descartados)`, legendgroup: g, showlegend: false,
            x: desc.map((r) => r.tempo_min), y: desc.map(val), customdata: desc.map(cd),
            marker: { symbol: `${sym}-open`, size: 9, color: COLOR[g], line: { width: 1.8 } }, hovertemplate: htPoint,
          });
        }
      });
    } else {
      const times = [...new Set(gr.map((r) => r.tempo_min))].sort((a, b) => a - b);
      const mx = [], my = [], me = [], mcd = [];
      times.forEach((t) => {
        const at = gr.filter((r) => r.tempo_min === t && (!S.cmpExcl || !r.descartado));
        const v = at.map(val).filter((x) => x != null);
        if (!v.length) return;
        mx.push(t); my.push(mean(v)); me.push(sd(v)); mcd.push([meta.rotulo, v.length, sd(v)]);
      });
      traces.push({
        type: 'scatter', mode: 'lines+markers', name: `${meta.rotulo}${meta.condicao ? ' · ' + meta.condicao : ''}`, legendgroup: g,
        x: mx, y: my, customdata: mcd,
        error_y: { type: 'data', array: me.map((e) => e ?? 0), visible: true, color: COLOR[g], thickness: 1.3, width: 4 },
        line: { color: COLOR[g], width: 2 }, marker: { symbol: sym, size: 9, color: COLOR[g], line: { color: '#fff', width: 1 } },
        hovertemplate: `<b>%{y:.4f}</b> ${ratio ? '× X₀' : 'g/L'} (média)<br>%{customdata[0]} · n = %{customdata[1]}<br>DP = %{customdata[2]:.4f}<br>t = %{x:.0f} min<extra></extra>`,
      });
      if (S.cmpDesc) {
        const desc = gr.filter((r) => r.descartado && val(r) != null);
        if (desc.length) traces.push({
          type: 'scatter', mode: 'markers', name: `${meta.rotulo} (descartados)`, legendgroup: g, showlegend: false,
          x: desc.map((r) => r.tempo_min), y: desc.map(val), customdata: desc.map(cd),
          marker: { symbol: `${sym}-open`, size: 9, color: COLOR[g], line: { width: 1.8 } }, hovertemplate: htPoint,
        });
      }
    }
  }
  const layout = BASE_LAYOUT();
  layout.hovermode = 'closest';
  layout.xaxis = AX({ title: { text: 'Tempo (min)' } });
  layout.yaxis = AX({ title: { text: yLab }, type: S.cmpScale === 'log' ? 'log' : 'linear', ...(S.cmpScale === 'log' ? LOGTICKS : {}) });
  layout.legend = { orientation: 'v', x: 1.01, y: 1, xanchor: 'left', font: { size: 11.5 } };
  layout.margin.r = 230;
  plot('chart-cmp', traces, layout);
}

/* ======================================================================
 * Abas de estatística (cinética e FES): barras + pontos + colchetes
 * ==================================================================== */
function statInfo(exp) {
  return exp === 'cinetica'
    ? { metric: S.cinMetric, unit: S.cinMetric === 'mu_min' ? S.cinUnit : 'min', mult: S.cinMetric === 'mu_min' && S.cinUnit === 'h' ? 60 : 1 }
    : { metric: S.fesMetric, unit: '', mult: 1 };
}
function groupValues(exp, metric, g, mult) {
  const rows = (S.data?.valores || []).filter((r) => r.experimento === exp && r.metrica === metric && r.equipe === g);
  const valid = rows.filter((r) => r.status === 'valido' && r.valor != null).map((r) => r.valor * mult);
  return { rows, valid, n: valid.length, m: mean(valid), s: sd(valid) };
}
function errOf(v) {
  if (v.s == null) return null;
  if (S.err === 'sd') return v.s;
  const se = v.s / Math.sqrt(v.n);
  return S.err === 'se' ? se : se * (T975[v.n - 1] || 2);
}
function statsRow(exp, metric, a, b) {
  const [x, y] = Number(a) < Number(b) ? [a, b] : [b, a];
  return (S.data?.stats || []).find((r) => r.experimento === exp && r.metrica === metric && r.grupo_a === x && r.grupo_b === y);
}
function pairSet(exp, metric) {
  const k = `${exp}|${metric}`;
  if (!S.pairs[k]) S.pairs[k] = new Set([PLANNED]);
  return S.pairs[k];
}
function visibleGroups(exp) {
  const withData = GROUPS.filter((g) => groupMeta(exp, g).tem);
  const chosen = S.statGroups[exp];
  return chosen ? withData.filter((g) => chosen.has(g)) : withData;
}

function renderStat(exp) {
  const root = document.getElementById(exp === 'cinetica' ? 'stat-cin' : 'stat-fes');
  const { metric, unit, mult } = statInfo(exp);
  const M = METRICS[metric];
  const chartId = `chart-${exp}`;
  if (!root.dataset.built) buildStatSkeleton(root, exp);
  const tableBox = root.querySelector('.summary-box');
  const side = root.querySelector('.side-dyn');
  buildStatChips(root, exp);

  if (!S.data?.valores?.length) { emptyChart(chartId, 'Clique em “Atualizar dados” para carregar as estatísticas.'); side.replaceChildren(); tableBox.replaceChildren(); return; }

  const groups = visibleGroups(exp);
  const dec = M.dec(unit);
  const vals = Object.fromEntries(groups.map((g) => [g, groupValues(exp, metric, g, mult)]));
  const xs = groups.map((_, i) => i);
  const traces = [];
  // Barras (média) com barra de erro
  traces.push({
    type: 'bar', x: xs, y: groups.map((g) => vals[g].m), width: 0.62, name: 'Média',
    marker: { color: groups.map((g) => COLOR[g]), opacity: 0.82, line: { color: '#fff', width: 2 } },
    error_y: { type: 'data', array: groups.map((g) => errOf(vals[g]) ?? 0), visible: true, color: '#1d2328', thickness: 1.5, width: 8 },
    customdata: groups.map((g) => [groupMeta(exp, g).rotulo, vals[g].n, errOf(vals[g]), groupMeta(exp, g).condicao || '—']),
    hovertemplate: `<b>%{y:.${dec}f}</b> ${M.unit(unit)} (média)<br>%{customdata[0]} · n = %{customdata[1]}<br>${S.err === 'sd' ? 'DP' : S.err === 'se' ? 'EP' : 'IC 95 %'} = %{customdata[2]:.${dec}f}<br>%{customdata[3]}<extra></extra>`,
    showlegend: false,
  });
  // Pontos individuais
  let ptsMax = 0;
  if (S.points) {
    for (const [i, g] of groups.entries()) {
      for (const st of ['valido', 'abaixo_LQ']) {
        const rs = vals[g].rows.filter((r) => r.status === st && r.y_plot != null);
        if (!rs.length) continue;
        const ys = rs.map((r) => r.y_plot * mult);
        ptsMax = Math.max(ptsMax, ...ys);
        traces.push({
          type: 'scatter', mode: 'markers', showlegend: false,
          x: rs.map((r) => i + ((r.frasco || 2) - 2) * 0.13), y: ys,
          customdata: rs.map((r) => [groupMeta(exp, g).rotulo, r.frasco, st === 'valido' ? '' : 'abaixo do LQ (fora da média e do teste)', r.r2]),
          marker: st === 'valido'
            ? { symbol: SYMBOL[g], size: 10, color: COLOR[g], line: { color: '#1d2328', width: 1.2 } }
            : { symbol: `${SYMBOL[g]}-open`, size: 10, color: '#1d2328', line: { width: 1.6 } },
          hovertemplate: (st === 'valido' ? `<b>%{y:.${dec}f}</b> ${M.unit(unit)}` : '<b>&lt; LQ</b>')
            + '<br>%{customdata[0]} · frasco %{customdata[1]}' + (exp === 'cinetica' ? '<br>r² do ajuste = %{customdata[3]:.4f}' : '') + '<br>%{customdata[2]}<extra></extra>',
        });
      }
    }
  }
  const layout = BASE_LAYOUT();
  layout.hovermode = 'closest';
  layout.bargap = 0.3;
  layout.shapes = []; layout.annotations = [];
  layout.xaxis = AX({ tickvals: xs, ticktext: groups.map((g) => {
    const c = groupMeta(exp, g).condicao;
    return `<b>${groupMeta(exp, g).rotulo}</b>${c ? `<br><span style="font-size:10.5px;color:${INK3}">${c}</span>` : ''}`;
  }), range: [-0.6, groups.length - 0.4], showgrid: false });
  const tops = groups.map((g) => (vals[g].m ?? 0) + (errOf(vals[g]) ?? 0));
  let top = Math.max(0, ...tops, ptsMax);

  // Referência do biorreator (n = 1: sem estatística)
  if (exp === 'cinetica' && S.cinBio) {
    const b = (S.data.valores || []).find((r) => r.experimento === 'cinetica' && r.metrica === metric && r.equipe === 'bio');
    if (b && b.valor != null) {
      const v = b.valor * mult, e = (b.ep ?? 0) * mult;
      layout.shapes.push({ type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: v - e, y1: v + e, fillcolor: COLOR.bio, opacity: 0.08, line: { width: 0 }, layer: 'below' });
      layout.shapes.push({ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: v, y1: v, line: { color: COLOR.bio, width: 1.5, dash: 'dash' } });
      layout.annotations.push({ xref: 'paper', yref: 'y', x: 1, y: v + e, xanchor: 'right', yanchor: 'bottom', showarrow: false,
        text: `Biorreator: ${fmt(v, dec)} ± ${fmt(e, dec)} ${M.unit(unit)} (EP do ajuste, n = 1)`, font: { size: 11, color: COLOR.bio }, bgcolor: 'rgba(255,255,255,.8)' });
      top = Math.max(top, v + e);
    }
  }
  // Limite de quantificação da proteína
  if (metric === 'proteina') {
    const lq = num((S.data.parametros || []).find((r) => str(r.parametro) === 'LQ_prot_mg_g')?.valor)
      ?? (S.data.valores || []).find((r) => r.status === 'abaixo_LQ')?.y_plot;
    if (lq != null) {
      layout.shapes.push({ type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: lq, y1: lq, line: { color: INK3, width: 1, dash: 'dot' } });
      layout.annotations.push({ xref: 'paper', yref: 'y', x: 0, y: lq, xanchor: 'left', yanchor: 'bottom', showarrow: false, text: `LQ ≈ ${fmt(lq, 1)} mg/g`, font: { size: 11, color: INK3 } });
    }
  }

  // Colchetes de significância
  const set = pairSet(exp, metric);
  const pos = Object.fromEntries(groups.map((g, i) => [g, i]));
  const brackets = [...set].map((k) => k.split('-')).filter(([a, b]) => a in pos && b in pos)
    .map(([a, b]) => ({ a, b, i: Math.min(pos[a], pos[b]), j: Math.max(pos[a], pos[b]), row: statsRow(exp, metric, a, b) }))
    .filter((x) => x.row && pVal(x.row) != null)
    .sort((p, q) => (p.j - p.i) - (q.j - q.i) || p.i - q.i);
  const step = (top || 1) * 0.11;
  const levels = [];
  brackets.forEach((br) => {
    let L = 0;
    while ((levels[L] || []).some((o) => !(br.j < o.i || br.i > o.j))) L++;
    (levels[L] = levels[L] || []).push(br);
    // altura: acima de tudo que há entre i..j
    const localTop = Math.max(...groups.slice(br.i, br.j + 1).map((g) => {
      const v = vals[g];
      const pm = S.points ? Math.max(0, ...v.rows.filter((r) => r.y_plot != null).map((r) => r.y_plot * mult)) : 0;
      return Math.max((v.m ?? 0) + (errOf(v) ?? 0), pm);
    }));
    br.y = Math.max(localTop + step * 0.6, 0) + L * step;
  });
  // evita sobreposição vertical entre níveis
  brackets.forEach((br) => {
    const below = brackets.filter((o) => o !== br && !(br.j < o.i || br.i > o.j) && (o.j - o.i) < (br.j - br.i));
    below.forEach((o) => { if (br.y < o.y + step) br.y = o.y + step; });
  });
  const tick = step * 0.22;
  brackets.forEach((br) => {
    const p = pVal(br.row), s = stars(p);
    layout.shapes.push({ type: 'path', xref: 'x', yref: 'y', path: `M ${br.i},${br.y - tick} L ${br.i},${br.y} L ${br.j},${br.y} L ${br.j},${br.y - tick}`, line: { color: '#1d2328', width: 1.2 } });
    layout.annotations.push({ xref: 'x', yref: 'y', x: (br.i + br.j) / 2, y: br.y, yanchor: 'bottom', showarrow: false,
      text: `${s === 'n.s.' ? 'n.s.' : s} <span style="color:${INK3}">p ${p < 0.001 ? '' : '= '}${fmtP(p)}</span>`, font: { size: 11.5, family: 'JetBrains Mono, monospace', color: '#1d2328' } });
    top = Math.max(top, br.y + step * 0.6);
  });
  layout.yaxis = AX({ title: { text: M.axis(unit) }, range: [0, top * 1.06 || 1], rangemode: 'tozero' });
  layout.margin.b = 70;
  if (!groups.length) emptyChart(chartId, 'Nenhuma equipe selecionada.');
  else plot(chartId, traces, layout);

  // Tabela-resumo
  const tb = el('table', { class: 'summary' });
  const hdr = el('tr');
  ['Equipe', 'n', 'Média', 'DP', 'EP', 'Observação'].forEach((h) => hdr.append(el('th', { text: h })));
  tb.append(hdr);
  groups.forEach((g) => {
    const v = vals[g];
    const lq = v.rows.filter((r) => r.status === 'abaixo_LQ').length, nc = v.rows.filter((r) => r.status === 'nao_calculavel').length;
    const obs = [lq ? `${lq} abaixo do LQ` : '', nc ? `${nc} não calculável` : ''].filter(Boolean).join(' · ') || '—';
    const tr = el('tr');
    const c0 = el('td'); c0.append(el('span', { class: 'swatch', style: `background:${COLOR[g]}` }), groupMeta(exp, g).rotulo);
    tr.append(c0, el('td', { text: String(v.n) }), el('td', { text: fmt(v.m, dec) }), el('td', { text: fmt(v.s, dec) }),
      el('td', { text: fmt(v.s != null ? v.s / Math.sqrt(v.n) : null, dec) }), el('td', { text: obs, style: 'font-family:var(--font);text-align:left' }));
    tb.append(tr);
  });
  tableBox.replaceChildren(el('h3', { text: `Resumo · ${M.name} (${M.unit(unit)})`, style: 'margin:10px 0 0;font-size:14px' }), tb);

  // Painel lateral: comparações
  side.replaceChildren();
  const blk = el('div', { class: 'block' });
  blk.append(el('h3', { text: 'Comparações (colchetes)' }),
    el('p', { text: `Teste t bicaudal, ${S.test === 'student' ? 'variâncias iguais (Student)' : 'sem supor variâncias iguais (Welch)'}, α = ${fmt(alpha(), 2)}. Marque os pares para desenhar o colchete. Cada p é de um teste isolado, sem correção para múltiplas comparações.` }));
  const btns = el('div', { style: 'display:flex;gap:6px;margin-bottom:8px' },
    el('button', { class: 'btn-ghost', type: 'button', text: 'Só a planejada (3 × 6)', onclick: () => { S.pairs[`${exp}|${metric}`] = new Set([PLANNED]); renderStat(exp); writeHash(); } }),
    el('button', { class: 'btn-ghost', type: 'button', text: 'Limpar', onclick: () => { S.pairs[`${exp}|${metric}`] = new Set(); renderStat(exp); writeHash(); } }));
  blk.append(btns);
  const t = el('table', { class: 'pairs' });
  const h = el('tr'); ['Par', `p (${S.test === 'student' ? 'Student' : 'Welch'})`, ''].forEach((x) => h.append(el('th', { text: x }))); t.append(h);
  for (let i = 0; i < GROUPS.length; i++) for (let j = i + 1; j < GROUPS.length; j++) {
    const a = GROUPS[i], b = GROUPS[j], key = `${a}-${b}`;
    const ma = groupMeta(exp, a), mb = groupMeta(exp, b);
    if (!ma.tem || !mb.tem) continue;
    const row = statsRow(exp, metric, a, b);
    const p = row ? pVal(row) : null;
    const ok = p != null, shown = a in pos && b in pos;
    const tr = el('tr', { class: [ok ? '' : 'na', key === PLANNED ? 'planned' : ''].join(' ').trim() || null });
    const cb = el('input', { type: 'checkbox', checked: set.has(key), disabled: !ok || !shown, 'aria-label': `Comparar equipes ${a} e ${b}`,
      onchange: (e) => { if (e.target.checked) set.add(key); else set.delete(key); renderStat(exp); writeHash(); } });
    const lab = el('label', { style: 'display:inline-flex;align-items:center;gap:6px;cursor:pointer' }, cb,
      el('span', { class: 'swatch', style: `background:${COLOR[a]}` }), `${a} × ${b}`, el('span', { class: 'swatch', style: `background:${COLOR[b]};margin-left:4px` }));
    const tdP = el('td', { class: `p${ok && p < alpha() ? ' sig' : ''}`, text: ok ? fmtP(p) : row ? `n = ${row.n_a ?? 0}/${row.n_b ?? 0}` : '—' });
    const tdS = el('td', { text: ok ? stars(p) : 'n < 2', style: 'font-family:var(--mono);font-size:12px;color:var(--ink-3)' });
    tr.append(el('td', {}, lab), tdP, tdS);
    if (!shown && ok) tr.title = 'Ative as duas equipes acima do gráfico para desenhar este par';
    t.append(tr);
  }
  blk.append(t);
  side.append(blk);
}
const pVal = (row) => (S.test === 'student' ? row.p_student : row.p_welch);

function buildStatSkeleton(root, exp) {
  root.dataset.built = '1';
  const chartCard = el('div', { class: 'card' },
    el('div', { class: 'filters inner' }, el('div', { class: 'chips stat-chips', 'aria-label': 'Equipes' })),
    el('div', { id: `chart-${exp}`, class: 'chart chart-bar' }),
    el('div', { class: 'summary-box' }),
    el('p', { class: 'foot', text: exp === 'fes'
      ? 'Barra = média dos frascos válidos · pontos = frascos (vazado = abaixo do LQ, desenhado sobre a linha do LQ e fora da média).'
      : 'Barra = média dos frascos · pontos = frascos. Linha tracejada = biorreator (ajuste único, sem teste estatístico).' }));
  const side = el('aside', { class: 'card side' });
  const ctl = el('div', { class: 'block' }, el('h3', { text: 'Exibição' }));
  const segErr = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Barra de erro', 'data-k': 'err' },
    ...[['sd', 'DP'], ['se', 'EP'], ['ci', 'IC 95 %']].map(([v, t]) => el('button', { type: 'button', 'data-v': v, text: t })));
  const segTest = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Teste', 'data-k': 'test' },
    ...[['student', 'Student'], ['welch', 'Welch']].map(([v, t]) => el('button', { type: 'button', 'data-v': v, text: t })));
  const pts = el('label', { class: 'chk' }, el('input', { type: 'checkbox', 'data-k': 'points' }), 'Mostrar frascos');
  ctl.append(el('div', { style: 'display:flex;flex-direction:column;gap:8px' },
    el('div', { class: 'field' }, 'Barra de erro', segErr), el('div', { class: 'field' }, 'Teste', segTest), pts));
  side.append(ctl, el('div', { class: 'side-dyn' }));
  root.append(chartCard, side);
  [segErr, segTest].forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S[seg.dataset.k] = b.dataset.v; syncSegs(); renderTab(); writeHash();
  }));
  pts.querySelector('input').addEventListener('change', (e) => { S.points = e.target.checked; renderTab(); writeHash(); });
  syncSegs();
}
function buildStatChips(root, exp) {
  const box = root.querySelector('.stat-chips');
  box.replaceChildren();
  const vis = new Set(visibleGroups(exp));
  GROUPS.forEach((g) => {
    const m = groupMeta(exp, g);
    const on = m.tem && vis.has(g);
    const chip = el('button', {
      class: `chip${m.tem ? '' : ' nodata'}`, type: 'button', 'aria-pressed': String(on), disabled: !m.tem,
      title: m.tem ? (m.condicao || m.rotulo) : `${m.rotulo}: sem dados na planilha`,
      onclick: () => {
        const cur = new Set(visibleGroups(exp));
        if (cur.has(g)) cur.delete(g); else cur.add(g);
        S.statGroups[exp] = cur; renderStat(exp); writeHash();
      },
    });
    chip.append(el('span', { class: 'sw', style: `background:${COLOR[g]}` }), el('span', { text: m.rotulo }));
    if (m.condicao) chip.append(el('span', { class: 'cond', text: `· ${m.condicao}` }));
    box.append(chip);
  });
}

/* ======================================================================
 * Metodologia e Dados
 * ==================================================================== */
function renderMet() {
  const box = $('#met-params');
  const raw = S.data?.__raw?.parametros;
  if (!raw || !raw.rows.length) { box.replaceChildren(el('p', { class: 'hint', text: 'Carregue os dados para ver os parâmetros.' })); return; }
  box.replaceChildren(dataTable(raw.labels.filter((l) => l), raw.rows));
}
function dataTable(labels, rows) {
  const t = el('table', { class: 'data' });
  const h = el('tr'); labels.forEach((l) => h.append(el('th', { text: l }))); t.append(h);
  rows.forEach((r) => {
    const tr = el('tr');
    labels.forEach((l) => {
      const v = r[l];
      const isNum = typeof v === 'number';
      tr.append(el('td', { class: isNum ? 'num' : null, text: v == null ? '' : isNum ? v.toLocaleString('pt-BR', { maximumFractionDigits: 6 }) : String(v) }));
    });
    t.append(tr);
  });
  return t;
}
function renderDados() {
  const sel = $('#data-sel');
  const keys = Object.keys(CONFIG.tabs);
  if (!sel.options.length) sel.replaceChildren(...keys.map((k) => el('option', { value: k, text: CONFIG.tabs[k].sheet })));
  sel.value = S.dataSel;
  const raw = S.data?.__raw?.[S.dataSel];
  const box = $('#data-table');
  if (!raw) { box.replaceChildren(el('div', { class: 'empty', text: 'Clique em “Atualizar dados”.' })); $('#data-info').textContent = ''; return; }
  box.replaceChildren(dataTable(raw.labels, raw.rows));
  $('#data-info').textContent = `${raw.rows.length} linhas · ${raw.labels.length} colunas`;
}
function downloadCsv() {
  const raw = S.data?.__raw?.[S.dataSel];
  if (!raw) return;
  const esc = (v) => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [raw.labels.map(esc).join(';'), ...raw.rows.map((r) => raw.labels.map((l) => {
    const v = r[l]; return esc(typeof v === 'number' ? String(v).replace('.', ',') : v);
  }).join(';'))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${CONFIG.tabs[S.dataSel].sheet}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ======================================================================
 * Controles, abas e estado na URL
 * ==================================================================== */
function syncSegs() {
  const map = { 'cmp-mode': S.cmpMode, 'cmp-norm': S.cmpNorm, 'cmp-scale': S.cmpScale, 'cin-metric': S.cinMetric, 'cin-unit': S.cinUnit, 'fes-metric': S.fesMetric };
  for (const [id, v] of Object.entries(map)) document.querySelectorAll(`#${id} button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  document.querySelectorAll('.seg[data-k]').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === S[seg.dataset.k]))));
  document.querySelectorAll('input[data-k="points"]').forEach((i) => { i.checked = S.points; });
  document.querySelectorAll('#cin-unit button').forEach((b) => { b.disabled = S.cinMetric !== 'mu_min'; });
  $('#bio-logx').checked = S.bioLogX; $('#bio-exp').checked = S.bioExp;
  $('#bio-docrit').value = S.doCrit ?? '';
  $('#cmp-desc').checked = S.cmpDesc; $('#cmp-excl').checked = S.cmpExcl; $('#cin-bio').checked = S.cinBio;
}
function buildStaticControls() { buildCmpChips(); syncSegs(); }

function renderTab() {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === S.tab)));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${S.tab}`; });
  if (S.tab === 'bio') { renderBio(); renderPulse(); buildCmpChips(); renderCmp(); }
  else if (S.tab === 'cin') renderStat('cinetica');
  else if (S.tab === 'fes') renderStat('fes');
  else if (S.tab === 'met') renderMet();
  else if (S.tab === 'dados') renderDados();
}

function wireControls() {
  $('#sheet-link').href = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}`;
  $('#btn-refresh').addEventListener('click', loadAll);
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { S.tab = b.dataset.tab; renderTab(); writeHash(); }));
  const segs = { 'cmp-mode': 'cmpMode', 'cmp-norm': 'cmpNorm', 'cmp-scale': 'cmpScale', 'cin-metric': 'cinMetric', 'cin-unit': 'cinUnit', 'fes-metric': 'fesMetric' };
  for (const [id, key] of Object.entries(segs)) {
    $(`#${id}`).addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      S[key] = b.dataset.v; syncSegs(); renderTab(); writeHash();
    });
  }
  $('#bio-logx').addEventListener('change', (e) => { S.bioLogX = e.target.checked; renderBio(); writeHash(); });
  $('#bio-exp').addEventListener('change', (e) => { S.bioExp = e.target.checked; renderBio(); writeHash(); });
  $('#bio-docrit').addEventListener('input', (e) => { const v = num(e.target.value); S.doCrit = v; renderBio(); writeHash(); });
  $('#pulse-sel').addEventListener('change', (e) => { S.pulse = Number(e.target.value); renderPulse(); writeHash(); });
  $('#cmp-desc').addEventListener('change', (e) => { S.cmpDesc = e.target.checked; renderCmp(); writeHash(); });
  $('#cmp-excl').addEventListener('change', (e) => { S.cmpExcl = e.target.checked; renderCmp(); writeHash(); });
  $('#cin-bio').addEventListener('change', (e) => { S.cinBio = e.target.checked; renderStat('cinetica'); writeHash(); });
  $('#data-sel').addEventListener('change', (e) => { S.dataSel = e.target.value; renderDados(); });
  $('#data-csv').addEventListener('click', downloadCsv);
  window.addEventListener('hashchange', () => { if (readHash()) { syncSegs(); renderTab(); } });
}

let lastHash = '';
function writeHash() {
  const p = new URLSearchParams();
  p.set('aba', S.tab);
  p.set('g', [...S.cmpGroups].join(','));
  p.set('modo', S.cmpMode); p.set('norm', S.cmpNorm); p.set('esc', S.cmpScale);
  p.set('cin', S.cinMetric); p.set('un', S.cinUnit); p.set('fes', S.fesMetric);
  p.set('err', S.err); p.set('t', S.test); p.set('pts', S.points ? '1' : '0');
  if (S.bioLogX) p.set('logx', '1');
  if (!S.bioExp) p.set('exp', '0');
  if (S.doCrit != null) p.set('od', String(S.doCrit));
  if (!S.cinBio) p.set('bio', '0');
  if (!S.cmpDesc) p.set('desc', '0');
  if (!S.cmpExcl) p.set('excl', '0');
  p.set('pulso', String(S.pulse));
  for (const [k, set] of Object.entries(S.pairs)) p.set(`p_${k.replace('|', '_')}`, [...set].join(','));
  for (const [exp, set] of Object.entries(S.statGroups)) if (set) p.set(`eq_${exp}`, [...set].join(','));
  lastHash = '#' + p.toString();
  history.replaceState(null, '', lastHash);
}
function readHash() {
  if (!location.hash || location.hash === lastHash) return false;
  const p = new URLSearchParams(location.hash.slice(1));
  const pick = (k, allowed, cur) => (p.has(k) && allowed.includes(p.get(k)) ? p.get(k) : cur);
  S.tab = pick('aba', ['bio', 'cin', 'fes', 'met', 'dados'], S.tab);
  if (p.has('g')) S.cmpGroups = new Set(p.get('g').split(',').filter((g) => [...GROUPS, 'bio'].includes(g)));
  S.cmpMode = pick('modo', ['mean', 'flask'], S.cmpMode);
  S.cmpNorm = pick('norm', ['x', 'ratio'], S.cmpNorm);
  S.cmpScale = pick('esc', ['linear', 'log'], S.cmpScale);
  S.cinMetric = pick('cin', ['mu_min', 'tg_min'], S.cinMetric);
  S.cinUnit = pick('un', ['min', 'h'], S.cinUnit);
  S.fesMetric = pick('fes', ['AA', 'proteina', 'AE'], S.fesMetric);
  S.err = pick('err', ['sd', 'se', 'ci'], S.err);
  S.test = pick('t', ['student', 'welch'], S.test);
  if (p.has('pts')) S.points = p.get('pts') === '1';
  S.bioLogX = p.get('logx') === '1';
  S.bioExp = p.get('exp') !== '0';
  S.doCrit = p.has('od') ? num(p.get('od')) : null;
  S.cinBio = p.get('bio') !== '0';
  S.cmpDesc = p.get('desc') !== '0';
  S.cmpExcl = p.get('excl') !== '0';
  if (p.has('pulso')) S.pulse = Number(p.get('pulso')) || 1;
  for (const [k, v] of p.entries()) {
    if (k.startsWith('p_')) {
      const [, exp, ...m] = k.split('_');
      S.pairs[`${exp}|${m.join('_')}`] = new Set(v.split(',').filter((x) => /^[1-6]-[1-6]$/.test(x)));
    }
    if (k.startsWith('eq_')) S.statGroups[k.slice(3)] = new Set(v.split(',').filter((g) => GROUPS.includes(g)));
  }
  lastHash = location.hash;
  return true;
}

/* ======================================================================
 * Início
 * ==================================================================== */
function init() {
  wireControls();
  readHash();
  syncSegs();
  if (loadCache()) afterData();
  else {
    buildStaticControls();
    renderTab();
    setStatus('Nenhum dado carregado ainda · clique em <b>Atualizar dados</b> para ler a planilha.');
  }
}
document.addEventListener('DOMContentLoaded', init);
