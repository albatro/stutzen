const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const fmtStock = (cell) => {
  const v = cell.getValue();
  const el = cell.getElement();
  el.style.fontWeight = '600';
  el.style.color = !v ? '#c00' : '#1a7a3a';
  return v ?? 0;
};

// ---- Таблица ----
const table = new Tabulator('#table', {
  layout: 'fitDataStretch',
  ajaxURL: '/api/ozon/supplier-stock',
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
    const availability = $('#availability').value;
    if (availability) p.set('availability', availability);
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
    { title: 'Остаток Ozon', field: 'stock_total', width: 100, hozAlign: 'right' },
    { title: 'Закупочная, ₽', field: 'purchase_price', width: 120, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Остаток поставщика', field: 'supplier_stock', width: 140, hozAlign: 'right', formatter: fmtStock },
    { title: 'В наличии у поставщика', field: 'sup_available', width: 160, hozAlign: 'center',
      formatter: (cell) => cell.getValue()
        ? '<span style="color:#1a7a3a;font-weight:600">✓ да</span>'
        : '<span style="color:#c00">✗ нет</span>' },
    { title: 'Обновлено', field: 'updated_at', width: 140,
      formatter: (cell) => { const v = cell.getValue(); return v ? new Date(v).toLocaleString('ru-RU') : ''; } },
  ],
});

// ---- Видимость колонок ----
const VISIBILITY_KEY = 'stutzen.ozon-supplier-stock.columnVisibility.v1';
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
$('#availability')?.addEventListener('change', () => table.replaceData());

// ---- Статистика ----
async function loadStats() {
  const data = await fetch('/api/ozon/stats').then(r => r.json());
  $('#stats').textContent = `Товаров: ${data.products} · Цен: ${data.prices}`;
}

loadCategories();
loadStats();
