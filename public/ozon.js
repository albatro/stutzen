const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtPct = (v) => v == null ? '' : `${v}%`;

const table = new Tabulator('#table', {
  layout: 'fitDataStretch',
  ajaxURL: '/api/ozon/products',
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
    if (params.sort && params.sort[0]) {
      p.set('sort', params.sort[0].field);
      p.set('dir', params.sort[0].dir);
    }
    const search = $('#search').value.trim();
    if (search) p.set('search', search);
    const category = $('#category').value;
    if (category) p.set('category', category);
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
    { title: 'ID Ozon', field: 'product_id', width: 110 },
    { title: 'Название', field: 'name', minWidth: 260, widthGrow: 3 },
    { title: 'Категория', field: 'category_name', width: 180 },
    { title: 'Цена, ₽', field: 'price', width: 110, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Цена до скидки, ₽', field: 'old_price', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Мин. цена, ₽', field: 'min_price', width: 110, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Остаток', field: 'stock_total', width: 90, hozAlign: 'right' },
    { title: 'Резерв', field: 'stock_reserved', width: 80, hozAlign: 'right' },
    { title: 'Комиссия FBO, %', field: 'fbo_commission_percent', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtPct(cell.getValue()) },
    { title: 'Фулфилмент FBO, ₽', field: 'fbo_fulfillment_amount', width: 140, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Доставка FBO, ₽', field: 'fbo_deliv_amount', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Комиссия FBS, %', field: 'fbs_commission_percent', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtPct(cell.getValue()) },
    { title: 'Первая миля FBS, ₽', field: 'fbs_first_mile_amount', width: 140, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Доставка FBS, ₽', field: 'fbs_deliv_amount', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Статус', field: 'status', width: 140 },
    { title: 'Обновлено', field: 'updated_at', width: 150, sorter: 'string',
      formatter: (cell) => {
        const v = cell.getValue();
        if (!v) return '';
        return new Date(v).toLocaleString('ru-RU');
      } },
  ],
});

// ---- Видимость колонок ----
const VISIBILITY_KEY = 'stutzen.ozon.columnVisibility.v1';

function loadVisibility() {
  try { return JSON.parse(localStorage.getItem(VISIBILITY_KEY)) ?? {}; } catch { return {}; }
}
function saveVisibility(state) { localStorage.setItem(VISIBILITY_KEY, JSON.stringify(state)); }

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
  const cols = table.getColumns().filter(c => c.getField());
  for (const col of cols) {
    const f = col.getField();
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state[f] !== false;
    cb.addEventListener('change', () => {
      const s = loadVisibility();
      s[f] = cb.checked;
      saveVisibility(s);
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

table.on('tableBuilt', () => {
  applyVisibility();
  buildGearPanel();
});

document.querySelector('.gear-btn')?.addEventListener('click', () => {
  document.querySelector('.gear-panel')?.classList.toggle('open');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.gear-wrap')) {
    document.querySelector('.gear-panel')?.classList.remove('open');
  }
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

// ---- Статистика ----
async function loadStats() {
  const data = await fetch('/api/ozon/stats').then(r => r.json());
  const sync = data.lastSync;
  let syncInfo = '';
  if (sync) {
    const at = new Date(sync.started_at).toLocaleString('ru-RU');
    syncInfo = ` · Синхронизация: ${sync.status} (${at})`;
  }
  $('#stats').textContent =
    `Товаров: ${data.products} · Цен: ${data.prices} · Остаток: ${data.stockTotal} · Комиссий: ${data.commissions}${syncInfo}`;

  const syncBtn = $('#sync');
  if (syncBtn) syncBtn.disabled = data.syncInProgress;
}

// ---- Кнопки ----
$('#refresh')?.addEventListener('click', () => table.replaceData());

$('#search')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') table.replaceData();
});

$('#category')?.addEventListener('change', () => table.replaceData());

$('#sync')?.addEventListener('click', async () => {
  const btn = $('#sync');
  btn.disabled = true;
  try {
    const r = await fetch('/api/ozon/sync', { method: 'POST' });
    const data = await r.json();
    if (!r.ok) { alert(data.error ?? 'Ошибка'); btn.disabled = false; return; }
    alert(data.message ?? 'Запущено');
    setTimeout(loadStats, 3000);
  } catch (e) {
    alert('Ошибка: ' + e.message);
    btn.disabled = false;
  }
});

loadCategories();
loadStats();
setInterval(loadStats, 10000);
