const $ = (sel) => document.querySelector(sel);
const fmt = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const fmtPrice = (cell) => {
  const v = cell.getValue();
  return v == null ? '' : `<b>${fmt(v)}</b>`;
};

const fmtColored = (cell) => {
  const v = cell.getValue();
  if (v == null) return '';
  const el = cell.getElement();
  el.style.color = v < 0 ? '#c00' : v === 0 ? '#888' : '#1a7a3a';
  el.style.fontWeight = '600';
  el.style.cursor = 'help';
  return fmt(v);
};

const fmtPctColored = (cell) => {
  const v = cell.getValue();
  if (v == null) return '';
  const el = cell.getElement();
  el.style.color = v < 0 ? '#c00' : v < 10 ? '#c07000' : '#1a7a3a';
  el.style.fontWeight = '600';
  el.style.cursor = 'help';
  return v + '%';
};

const fmtDelta = (cell) => {
  const v = cell.getValue();
  if (v == null) return '';
  const el = cell.getElement();
  el.style.color = v > 0 ? '#1a7a3a' : v < 0 ? '#c00' : '#888';
  return (v > 0 ? '+' : '') + fmt(v);
};

const fmtDeltaPct = (cell) => {
  const v = cell.getValue();
  if (v == null) return '';
  const el = cell.getElement();
  el.style.color = v > 0 ? '#1a7a3a' : v < 0 ? '#c00' : '#888';
  return (v > 0 ? '+' : '') + v + '%';
};

// ---- Таблица ----
const table = new Tabulator('#table', {
  layout: 'fitDataStretch',
  pagination: true,
  paginationSize: 100,
  paginationSizeSelector: [50, 100, 200, 500],
  columns: [
    { title: '', field: 'image_url', width: 56, formatter: (cell) => {
        const v = cell.getValue(); return v ? `<img class="thumb" src="${v}">` : '';
      }, headerSort: false },
    { title: 'SKU', field: 'offer_id', width: 160, frozen: true },
    { title: 'Название', field: 'name', minWidth: 200, widthGrow: 3 },
    { title: 'Категория', field: 'category_name', width: 150 },
    { title: 'Поставщик', field: 'vendor', width: 110 },
    { title: 'Наценка, %', field: 'margin_percent', width: 90, hozAlign: 'right' },
    { title: 'Закупочная, ₽', field: 'purchase_price', width: 120, hozAlign: 'right',
      formatter: (cell) => fmt(cell.getValue()) },
    { title: 'Текущая цена, ₽', field: 'current_price', width: 130, hozAlign: 'right',
      formatter: (cell) => fmt(cell.getValue()) },
    { title: 'Предложение FBS, ₽', field: 'proposed_fbs', width: 145, hozAlign: 'right', formatter: fmtPrice },
    { title: 'Изменение FBS, ₽', field: 'delta_fbs', width: 130, hozAlign: 'right', formatter: fmtDelta },
    { title: 'Изменение FBS, %', field: 'delta_pct_fbs', width: 125, hozAlign: 'right', formatter: fmtDeltaPct },
    { title: 'Выручка FBS, ₽', field: 'actual_net_fbs', width: 120, hozAlign: 'right', formatter: fmtColored },
    { title: 'Маржа FBS, ₽', field: 'actual_margin_fbs', width: 110, hozAlign: 'right', formatter: fmtColored },
    { title: 'Маржа FBS, %', field: 'actual_margin_pct_fbs', width: 105, hozAlign: 'right', formatter: fmtPctColored },
    { title: 'Предложение FBO, ₽', field: 'proposed_fbo', width: 145, hozAlign: 'right', formatter: fmtPrice },
    { title: 'Выручка FBO, ₽', field: 'actual_net_fbo', width: 120, hozAlign: 'right', formatter: fmtColored },
    { title: 'Маржа FBO, ₽', field: 'actual_margin_fbo', width: 110, hozAlign: 'right', formatter: fmtColored },
    { title: 'Маржа FBO, %', field: 'actual_margin_pct_fbo', width: 105, hozAlign: 'right', formatter: fmtPctColored },
    { title: 'Ком. FBS, %', field: 'fbs_commission_percent', width: 95, hozAlign: 'right',
      formatter: (cell) => { const v = cell.getValue(); return v == null ? '' : v + '%'; } },
    { title: 'Ком. FBO, %', field: 'fbo_commission_percent', width: 95, hozAlign: 'right',
      formatter: (cell) => { const v = cell.getValue(); return v == null ? '' : v + '%'; } },
    { title: 'Эквайринг, %', field: 'acq_pct', width: 95, hozAlign: 'right',
      formatter: (cell) => { const v = cell.getValue(); return v == null ? '' : v + '%'; } },
  ],
});

// ---- Tooltip с расшифровкой расчёта ----
const _tipEl = document.createElement('div');
_tipEl.className = 'calc-tip';
document.body.appendChild(_tipEl);

document.addEventListener('mousemove', (e) => {
  if (_tipEl.style.display === 'none') return;
  const x = Math.min(e.clientX + 18, window.innerWidth - _tipEl.offsetWidth - 8);
  _tipEl.style.left = x + 'px';
  _tipEl.style.top = Math.max(e.clientY - 10, 4) + 'px';
});

const _TIP_FIELDS = new Set([
  'proposed_fbs', 'actual_net_fbs', 'actual_margin_fbs', 'actual_margin_pct_fbs',
  'proposed_fbo', 'actual_net_fbo', 'actual_margin_fbo', 'actual_margin_pct_fbo',
]);

function buildPriceHtml(data, schema) {
  const isFbo = schema === 'fbo';
  const proposed = isFbo ? data.proposed_fbo : data.proposed_fbs;
  if (proposed == null || !data.purchase_price) return null;

  const commPct = isFbo ? data.fbo_commission_percent : data.fbs_commission_percent;
  const acqPct  = data.acq_pct ?? 1.0;
  const commAmt = proposed * (commPct || 0) / 100;
  const acqAmt  = proposed * acqPct / 100;
  const fixed   = isFbo
    ? (data.actual_net_fbo != null ? proposed * (1 - (commPct + acqPct) / 100) - data.actual_net_fbo : 0)
    : (data.actual_net_fbs != null ? proposed * (1 - (commPct + acqPct) / 100) - data.actual_net_fbs : 0);
  const net     = isFbo ? data.actual_net_fbo : data.actual_net_fbs;
  const margin  = isFbo ? data.actual_margin_fbo : data.actual_margin_fbs;
  const marginPct = isFbo ? data.actual_margin_pct_fbo : data.actual_margin_pct_fbs;

  const r = (v) => Math.abs(v ?? 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tr = (label, val, sign) =>
    `<div class="tip-row"><span>${label}</span><span class="tip-val">${sign}${r(val)} ₽</span></div>`;

  let html = tr(`Предложенная цена (${isFbo ? 'FBO' : 'FBS'})`, proposed, '');
  html += tr(`Комиссия ${commPct ?? '?'}%`, commAmt, '−');
  html += tr(`Эквайринг ${acqPct}%`, acqAmt, '−');
  if (fixed > 0) html += tr('Фиксированная логистика', fixed, '−');
  html += `<div class="tip-sep"></div>`;
  const netClass = (net ?? 0) < 0 ? 'tip-neg' : 'tip-pos';
  html += `<div class="tip-row tip-total ${netClass}">
    <span>К перечислению</span><span class="tip-val">${(net ?? 0) < 0 ? '−' : ''}${r(net)} ₽</span>
  </div>`;
  html += tr('Закупочная цена', data.purchase_price, '−');
  html += `<div class="tip-sep"></div>`;
  const marginClass = (margin ?? 0) < 0 ? 'tip-neg' : 'tip-pos';
  html += `<div class="tip-row tip-total ${marginClass}">
    <span>Маржа (цель: ${data.margin_percent}%)</span>
    <span class="tip-val">${(margin ?? 0) < 0 ? '−' : ''}${r(margin)} ₽${marginPct != null ? ' / ' + marginPct + '%' : ''}</span>
  </div>`;
  return html;
}

table.on('cellMouseEnter', (_e, cell) => {
  const field = cell.getColumn().getField();
  if (!_TIP_FIELDS.has(field)) return;
  const schema = field.includes('fbo') ? 'fbo' : 'fbs';
  const html = buildPriceHtml(cell.getRow().getData(), schema);
  if (!html) return;
  _tipEl.innerHTML = html;
  _tipEl.style.display = 'block';
});

table.on('cellMouseLeave', (_e, cell) => {
  if (_TIP_FIELDS.has(cell.getColumn().getField())) _tipEl.style.display = 'none';
});

// ---- Gear panel ----
const VISIBILITY_KEY = 'stutzen.ozon-price.columnVisibility.v1';
function loadVisibility() { try { return JSON.parse(localStorage.getItem(VISIBILITY_KEY)) ?? {}; } catch { return {}; } }
function saveVisibility(s) { localStorage.setItem(VISIBILITY_KEY, JSON.stringify(s)); }

function applyVisibility() {
  const state = loadVisibility();
  for (const col of table.getColumns()) {
    const f = col.getField();
    if (!f) continue;
    if (state[f] === false) col.hide(); else col.show();
  }
}

function buildGearPanel() {
  const panel = document.querySelector('.gear-panel');
  if (!panel) return;
  const state = loadVisibility();
  panel.innerHTML = '';
  for (const col of table.getColumns().filter(c => c.getField())) {
    const f = col.getField();
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state[f] !== false;
    cb.addEventListener('change', () => {
      const s = loadVisibility(); s[f] = cb.checked; saveVisibility(s);
      if (cb.checked) col.show(); else col.hide();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + (col.getDefinition().title || f)));
    panel.appendChild(label);
  }
  const actions = document.createElement('div');
  actions.className = 'gear-actions';
  const showAll = document.createElement('button');
  showAll.textContent = 'Показать все';
  showAll.onclick = () => { saveVisibility({}); applyVisibility(); buildGearPanel(); };
  actions.appendChild(showAll);
  panel.appendChild(actions);
}

table.on('tableBuilt', () => { applyVisibility(); buildGearPanel(); });
table.on('dataLoaded', () => {
  if (!document.querySelector('.gear-panel')?.children.length) buildGearPanel();
});

document.querySelector('.gear-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.querySelector('.gear-panel')?.classList.toggle('open');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.gear-wrap')) document.querySelector('.gear-panel')?.classList.remove('open');
});

// ---- Загрузка категорий ----
async function loadCategories() {
  const cats = await fetch('/api/ozon/categories').then(r => r.json());
  const sel = $('#category');
  for (const c of cats) {
    const opt = document.createElement('option');
    opt.value = c.category_id;
    opt.textContent = `${c.category_name} (${c.cnt})`;
    sel.appendChild(opt);
  }
}

// ---- Загрузка данных ----
async function loadData() {
  const search = $('#search').value.trim();
  const cat = $('#category').value;
  const onlyMatched = $('#only-matched').checked;
  const p = new URLSearchParams();
  if (search) p.set('search', search);
  if (cat) p.set('category', cat);
  if (onlyMatched) p.set('matched', '1');

  const btn = $('#refresh');
  btn.disabled = true;
  try {
    const data = await fetch(`/api/ozon/price-proposals?${p}`).then(r => r.json());
    if (data.error) { alert(data.error); return; }
    table.setData(data.rows);
    $('#stats').textContent = `Позиций: ${data.total}`;
  } finally {
    btn.disabled = false;
  }
}

$('#refresh')?.addEventListener('click', loadData);
$('#search')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadData(); });
$('#category')?.addEventListener('change', loadData);
$('#only-matched')?.addEventListener('change', loadData);

loadCategories();
loadData();
