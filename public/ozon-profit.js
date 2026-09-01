const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtPct   = (v) => v == null ? '' : `${v}%`;

// Форматтер с цветом для «К перечислению» и маржи
const fmtColored = (cell) => {
  const v = cell.getValue();
  if (v == null) return '';
  const el = cell.getElement();
  el.style.color = v < 0 ? '#c00' : v === 0 ? '#888' : '#1a7a3a';
  el.style.fontWeight = '600';
  el.style.cursor = 'help';
  return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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

// ---- Таблица ----
const table = new Tabulator('#table', {
  layout: 'fitDataStretch',
  ajaxURL: '/api/ozon/profit',
  ajaxConfig: 'GET',
  pagination: true,
  paginationMode: 'remote',
  paginationSize: 100,
  paginationSizeSelector: [50, 100, 200, 500],
  sortMode: 'remote',
  filterMode: 'remote',
  ajaxURLGenerator: (url, _config, params) => {
    const p = new URLSearchParams();
    p.set('limit', params.size ?? 100);
    p.set('offset', ((params.page ?? 1) - 1) * (params.size ?? 100));
    if (params.sort?.[0]) { p.set('sort', params.sort[0].field); p.set('dir', params.sort[0].dir); }
    const search = $('#search').value.trim();
    if (search) p.set('search', search);
    const cat = $('#category').value;
    if (cat) p.set('category', cat);
    if ($('#only-matched').checked) p.set('matched', '1');
    return `${url}?${p}`;
  },
  ajaxResponse: (_url, _params, response) => ({
    data: response.rows,
    last_page: Math.max(1, Math.ceil(response.total / (response.limit || 100))),
  }),
  columns: [
    { title: '', field: 'image_url', width: 56, formatter: (cell) => {
        const v = cell.getValue();
        return v ? `<img class="thumb" src="${v}">` : '';
      }, headerSort: false },
    { title: 'SKU', field: 'offer_id', width: 160, frozen: true },
    { title: 'Название', field: 'name', minWidth: 220, widthGrow: 3 },
    { title: 'Категория', field: 'category_name', width: 160 },
    { title: 'Поставщик', field: 'vendor', width: 120 },
    { title: 'Цена Ozon, ₽', field: 'price', width: 110, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Закупочная, ₽', field: 'purchase_price', width: 120, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'К перечислению FBS, ₽', field: 'fbs_net', width: 150, hozAlign: 'right', formatter: fmtColored },
    { title: 'Маржа FBS, ₽', field: 'margin_fbs', width: 120, hozAlign: 'right', formatter: fmtColored },
    { title: 'Маржа FBS, %', field: 'margin_pct_fbs', width: 110, hozAlign: 'right', formatter: fmtPctColored },
    { title: 'К перечислению FBO, ₽', field: 'fbo_net', width: 150, hozAlign: 'right', formatter: fmtColored },
    { title: 'Маржа FBO, ₽', field: 'margin_fbo', width: 120, hozAlign: 'right', formatter: fmtColored },
    { title: 'Маржа FBO, %', field: 'margin_pct_fbo', width: 110, hozAlign: 'right', formatter: fmtPctColored },
    { title: 'Ком. FBS, %', field: 'fbs_commission_percent', width: 100, hozAlign: 'right',
      formatter: (cell) => fmtPct(cell.getValue()) },
    { title: 'Ком. FBO, %', field: 'fbo_commission_percent', width: 100, hozAlign: 'right',
      formatter: (cell) => fmtPct(cell.getValue()) },
    { title: 'Эквайринг, ₽', field: 'acquiring', width: 100, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Остаток', field: 'stock_total', width: 80, hozAlign: 'right' },
    { title: 'Обновлено', field: 'updated_at', width: 140,
      formatter: (cell) => { const v = cell.getValue(); return v ? new Date(v).toLocaleString('ru-RU') : ''; } },
  ],
});

// ---- Плавающий tooltip с расшифровкой ----
const _tipEl = document.createElement('div');
_tipEl.className = 'calc-tip';
document.body.appendChild(_tipEl);

document.addEventListener('mousemove', (e) => {
  if (_tipEl.style.display === 'none') return;
  const x = Math.min(e.clientX + 18, window.innerWidth - _tipEl.offsetWidth - 8);
  _tipEl.style.left = x + 'px';
  _tipEl.style.top = Math.max(e.clientY - 10, 4) + 'px';
});

function buildProfitHtml(data, schema) {
  const price = data.price;
  if (price == null) return null;
  const isFbo = schema === 'fbo';

  const commPct = isFbo ? data.fbo_commission_percent : data.fbs_commission_percent;
  const commAmt = price * (commPct || 0) / 100;
  const acq     = data.acquiring || 0;
  const acqPct  = data.acquiring_percent;
  const deliv   = isFbo ? (data.fbo_deliv_amount || 0) : (data.fbs_deliv_amount || 0);
  const logMax  = isFbo ? (data.fbo_direct_flow_trans_max_amount || 0) : (data.fbs_direct_flow_trans_max_amount || 0);
  const mile    = isFbo ? 0 : (data.fbs_first_mile_max_amount || 0);
  const net     = price - commAmt - acq - deliv - mile - logMax;
  const purchase = data.purchase_price;
  const margin  = purchase != null ? net - purchase : null;
  const marginPct = purchase > 0 ? Math.round((net - purchase) / purchase * 1000) / 10 : null;

  const r = (v) => Math.abs(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tr = (label, val, sign, sub) =>
    `<div class="tip-row"><span>${label}${sub ? `<br><span class="tip-sub">${sub}</span>` : ''}</span><span class="tip-val">${sign}${r(val)} ₽</span></div>`;

  let html = tr('Цена покупателя', price, '');
  html += tr(`Комиссия ${commPct ?? '?'}%`, commAmt, '−');
  html += tr(`Эквайринг${acqPct != null ? ' ' + acqPct + '%' : ''}`, acq, '−');
  html += tr('Доставка до покупателя', deliv, '−');
  if (!isFbo) html += tr('Первая миля (макс)', mile, '−');
  html += tr('Логистика Ozon (макс)', logMax, '−');
  html += `<div class="tip-sep"></div>`;
  html += `<div class="tip-row tip-total ${net < 0 ? 'tip-neg' : 'tip-pos'}">
    <span>К перечислению</span><span class="tip-val">${net < 0 ? '−' : ''}${r(net)} ₽</span>
  </div>`;

  if (purchase != null) {
    html += tr('Закупочная цена', purchase, '−', 'цена поставщика');
    html += `<div class="tip-sep"></div>`;
    const marginClass = margin < 0 ? 'tip-neg' : 'tip-pos';
    html += `<div class="tip-row tip-total ${marginClass}">
      <span>Маржа</span>
      <span class="tip-val">${margin < 0 ? '−' : ''}${r(margin)} ₽${marginPct != null ? ' / ' + marginPct + '%' : ''}</span>
    </div>`;
  }
  return html;
}

const _PROFIT_FIELDS = new Set(['fbs_net', 'fbo_net', 'margin_fbs', 'margin_fbo', 'margin_pct_fbs', 'margin_pct_fbo']);

table.on('cellMouseEnter', (_e, cell) => {
  const field = cell.getColumn().getField();
  if (!_PROFIT_FIELDS.has(field)) return;
  const schema = field.includes('fbo') ? 'fbo' : 'fbs';
  const html = buildProfitHtml(cell.getRow().getData(), schema);
  if (!html) return;
  _tipEl.innerHTML = html;
  _tipEl.style.display = 'block';
});

table.on('cellMouseLeave', (_e, cell) => {
  if (_PROFIT_FIELDS.has(cell.getColumn().getField())) _tipEl.style.display = 'none';
});

// ---- Видимость колонок ----
const VISIBILITY_KEY = 'stutzen.ozon-profit.columnVisibility.v1';
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

// ---- Категории ----
async function loadCategories() {
  const data = await fetch('/api/ozon/categories').then(r => r.json());
  const sel = $('#category');
  for (const c of data) {
    const opt = document.createElement('option');
    opt.value = c.category_id;
    opt.textContent = `${c.category_name} (${c.cnt})`;
    sel.appendChild(opt);
  }
}

// ---- Управление ----
$('#refresh')?.addEventListener('click', () => table.replaceData());
$('#search')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') table.replaceData(); });
$('#category')?.addEventListener('change', () => table.replaceData());
$('#only-matched')?.addEventListener('change', () => table.replaceData());

// ---- Статистика ----
async function loadStats() {
  const data = await fetch('/api/ozon/stats').then(r => r.json());
  $('#stats').textContent = `Товаров: ${data.products} · Цен: ${data.prices}`;
}

loadCategories();
loadStats();
