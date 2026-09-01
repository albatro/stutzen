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
    { title: 'Возврат FBO, ₽', field: 'fbo_return_flow_amount', width: 120, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Перемещение возврата FBO мин, ₽', field: 'fbo_return_flow_trans_min_amount', width: 170, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Перемещение возврата FBO макс, ₽', field: 'fbo_return_flow_trans_max_amount', width: 170, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Комиссия FBS, %', field: 'fbs_commission_percent', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtPct(cell.getValue()) },
    { title: 'Первая миля FBS мин, ₽', field: 'fbs_first_mile_amount', width: 150, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Первая миля FBS макс, ₽', field: 'fbs_first_mile_max_amount', width: 150, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Доставка FBS, ₽', field: 'fbs_deliv_amount', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Возврат FBS, ₽', field: 'fbs_return_flow_amount', width: 120, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Перемещение возврата FBS мин, ₽', field: 'fbs_return_flow_trans_min_amount', width: 170, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Перемещение возврата FBS макс, ₽', field: 'fbs_return_flow_trans_max_amount', width: 170, hozAlign: 'right',
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

  $('#stats').textContent =
    `Товаров: ${data.products} · Цен: ${data.prices} · Остаток: ${data.stockTotal} · Комиссий: ${data.commissions}`;

  const syncBtn = $('#sync');
  if (syncBtn) syncBtn.disabled = data.syncInProgress;

  updateProgress(data);

  // Быстрый поллинг пока идёт синхронизация, медленный после
  const running = data.syncInProgress || data.lastSync?.status === 'running';
  startPolling(running);
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
    startPolling(true);
    loadStats();
  } catch (e) {
    alert('Ошибка: ' + e.message);
    btn.disabled = false;
  }
});

// ---- Прогресс синхронизации ----
const fmtNum = (v) => v == null ? '—' : Number(v).toLocaleString('ru-RU');

function updateProgress(data) {
  const box = document.getElementById('progress');
  const sync = data.lastSync;
  const running = data.syncInProgress || sync?.status === 'running';

  if (!sync) { box.classList.remove('visible'); return; }

  const finished = sync.status === 'success' || sync.status === 'partial' || sync.status === 'error' || sync.status === 'failed';

  // Показываем блок если синхронизация активна или завершилась только что (есть данные)
  if (!running && !finished) { box.classList.remove('visible'); return; }
  box.classList.add('visible');

  // Заголовок
  const label = document.getElementById('pr-label');
  if (running) {
    label.textContent = 'Синхронизация…';
    document.querySelector('#progress .spinner').style.display = '';
  } else {
    document.querySelector('#progress .spinner').style.display = 'none';
    if (sync.status === 'success') label.textContent = '✓ Синхронизация завершена';
    else if (sync.status === 'partial') label.textContent = '⚠ Завершено с ошибками';
    else label.textContent = '✗ Ошибка синхронизации';
  }

  // Время
  if (sync.started_at) {
    const start = new Date(sync.started_at);
    const end = sync.finished_at ? new Date(sync.finished_at) : new Date();
    const sec = Math.round((end - start) / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    document.getElementById('pr-elapsed').textContent = `${mm}:${ss}`;
  }

  // Фазы — определяем что уже выполнено
  const pp = sync.products_processed;
  const pr = sync.prices_processed;
  const ps = sync.stocks_processed;
  const pc = sync.commissions_processed;

  // Определяем текущую фазу для подсветки
  let phase = 0; // 0=products 1=prices 2=stocks 3=commissions 4=done
  if (finished) phase = 4;
  else if (pc > 0) phase = 3;
  else if (ps > 0) phase = 2;
  else if (pr > 0) phase = 1;

  function setPhase(id, val, phaseIdx) {
    const el = document.getElementById(id);
    el.textContent = val == null || val === 0 && phaseIdx > phase ? '—' : fmtNum(val);
    el.className = 'pr-phase-val';
    if (phaseIdx < phase || (phaseIdx === phase && finished)) el.classList.add('done');
    else if (phaseIdx > phase) el.classList.add('idle');
  }

  setPhase('pr-products',    pp, 0);
  setPhase('pr-prices',      pr, 1);
  setPhase('pr-stocks',      ps, 2);
  setPhase('pr-commissions', pc, 3);

  const errEl = document.getElementById('pr-errors');
  errEl.textContent = fmtNum(sync.errors_count ?? 0);
  errEl.className = 'pr-phase-val' + (sync.errors_count > 0 ? '' : ' done');

  const errmsg = document.getElementById('pr-errmsg');
  errmsg.textContent = sync.error_message ?? sync.details ?? '';
}

let _statsInterval = null;

function startPolling(fast) {
  if (_statsInterval) clearInterval(_statsInterval);
  _statsInterval = setInterval(loadStats, fast ? 2000 : 10000);
}

loadCategories();
loadStats();
startPolling(false);
