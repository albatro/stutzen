const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtPct = (v) => v == null ? '' : `${v}%`;
const fmtNet = (cell) => {
  const v = cell.getValue();
  if (v == null) return '';
  const el = cell.getElement();
  el.style.color = v < 0 ? '#c00' : v === 0 ? '#888' : '#1a7a3a';
  el.style.fontWeight = '600';
  el.style.cursor = 'help';
  return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

// ---- Плавающая расшифровка для колонок «К перечислению» ----
const _tipEl = document.createElement('div');
_tipEl.className = 'calc-tip';
document.body.appendChild(_tipEl);

document.addEventListener('mousemove', (e) => {
  if (_tipEl.style.display === 'none') return;
  const x = Math.min(e.clientX + 18, window.innerWidth - _tipEl.offsetWidth - 8);
  _tipEl.style.left = x + 'px';
  _tipEl.style.top = Math.max(e.clientY - 10, 4) + 'px';
});

function buildNetHtml(data, schema) {
  const price = data.price;
  if (price == null) return null;
  const isFbo = schema === 'fbo';

  const commPct  = isFbo ? data.fbo_commission_percent : data.fbs_commission_percent;
  const commAmt  = price * (commPct || 0) / 100;
  const acq      = data.acquiring || 0;
  const acqPct   = data.acquiring_percent != null ? data.acquiring_percent : (price > 0 ? Math.round(acq / price * 10000) / 100 : null);
  const deliv    = isFbo ? (data.fbo_deliv_amount || 0) : (data.fbs_deliv_amount || 0);
  const logMax   = isFbo ? (data.fbo_direct_flow_trans_max_amount || 0) : (data.fbs_direct_flow_trans_max_amount || 0);
  const mile     = isFbo ? 0 : (data.fbs_first_mile_max_amount || 0);
  const net      = price - commAmt - acq - deliv - mile - logMax;

  const r = (v) => Math.abs(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tr = (label, val, sign) =>
    `<div class="tip-row"><span>${label}</span><span class="tip-val">${sign}${r(val)} ₽</span></div>`;

  let html = tr('Цена покупателя', price, '');
  html += tr(`Комиссия ${commPct ?? '?'}%`, commAmt, '−');
  html += tr(`Эквайринг${acqPct != null ? ' ' + acqPct + '%' : ''}`, acq, '−');
  html += tr('Доставка до покупателя', deliv, '−');
  if (!isFbo) html += tr('Первая миля (макс)', mile, '−');
  html += tr(`Логистика Ozon (макс)`, logMax, '−');
  html += `<div class="tip-sep"></div>`;
  html += `<div class="tip-row tip-total ${net < 0 ? 'tip-neg' : 'tip-pos'}">
    <span>К перечислению</span>
    <span class="tip-val">${net < 0 ? '−' : ''}${r(net)} ₽</span>
  </div>`;
  return html;
}

const _NET_FIELDS = new Set(['fbo_net', 'fbs_net']);

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
    { title: 'Эквайринг, ₽', field: 'acquiring', width: 110, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'К перечислению FBS, ₽', field: 'fbs_net', width: 150, hozAlign: 'right', formatter: fmtNet },
    { title: 'К перечислению FBO, ₽', field: 'fbo_net', width: 150, hozAlign: 'right', formatter: fmtNet },
    { title: 'Остаток', field: 'stock_total', width: 90, hozAlign: 'right' },
    { title: 'Резерв', field: 'stock_reserved', width: 80, hozAlign: 'right' },
    { title: 'Комиссия FBO, %', field: 'fbo_commission_percent', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtPct(cell.getValue()) },
    { title: 'Доставка FBO, ₽', field: 'fbo_deliv_amount', width: 120, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Логистика FBO мин, ₽', field: 'fbo_direct_flow_trans_min_amount', width: 150, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Логистика FBO макс, ₽', field: 'fbo_direct_flow_trans_max_amount', width: 150, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Возврат FBO, ₽', field: 'fbo_return_flow_amount', width: 120, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Комиссия FBS, %', field: 'fbs_commission_percent', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtPct(cell.getValue()) },
    { title: 'Первая миля FBS мин, ₽', field: 'fbs_first_mile_amount', width: 150, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Первая миля FBS макс, ₽', field: 'fbs_first_mile_max_amount', width: 150, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Доставка FBS, ₽', field: 'fbs_deliv_amount', width: 120, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Логистика FBS мин, ₽', field: 'fbs_direct_flow_trans_min_amount', width: 150, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Логистика FBS макс, ₽', field: 'fbs_direct_flow_trans_max_amount', width: 150, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Возврат FBS, ₽', field: 'fbs_return_flow_amount', width: 120, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Комиссия RFBS, %', field: 'sales_percent_rfbs', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtPct(cell.getValue()) },
    { title: 'Комиссия FBP, %', field: 'sales_percent_fbp', width: 120, hozAlign: 'right',
      formatter: (cell) => fmtPct(cell.getValue()) },
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

table.on('dataLoaded', () => {
  if (!document.querySelector('.gear-panel')?.children.length) {
    buildGearPanel();
  }
});

table.on('cellMouseEnter', (_e, cell) => {
  const field = cell.getColumn().getField();
  if (!_NET_FIELDS.has(field)) return;
  const html = buildNetHtml(cell.getRow().getData(), field === 'fbo_net' ? 'fbo' : 'fbs');
  if (!html) return;
  _tipEl.innerHTML = html;
  _tipEl.style.display = 'block';
});

table.on('cellMouseLeave', (_e, cell) => {
  if (_NET_FIELDS.has(cell.getColumn().getField())) _tipEl.style.display = 'none';
});

document.querySelector('.gear-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
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

// ---- Логи синхронизации ----
const fmtDate = (s) => s ? new Date(s).toLocaleString('ru-RU') : '—';
const fmtDur = (a, b) => {
  if (!a || !b) return '';
  const ms = new Date(b) - new Date(a);
  if (ms < 0) return '';
  if (ms < 60000) return `${Math.round(ms / 1000)} с`;
  const m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
  return s ? `${m} мин ${s} с` : `${m} мин`;
};

function nextCronAt(expr) {
  if (!expr) return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour] = parts;
  if (parts[2] !== '*' || parts[3] !== '*' || parts[4] !== '*') return null;
  const now = new Date(), next = new Date(now);
  next.setSeconds(0, 0);
  const mH = /^\*\/(\d+)$/.exec(hour);
  if (min === '0' && mH) {
    const n = Number(mH[1]);
    next.setMinutes(0);
    let h = next.getHours() + 1;
    while (h % n !== 0) h++;
    if (h >= 24) { next.setDate(next.getDate() + 1); h %= 24; }
    next.setHours(h); return next;
  }
  if (hour === '*' && /^\d+$/.test(min)) {
    next.setMinutes(Number(min));
    if (next <= now) next.setHours(next.getHours() + 1);
    return next;
  }
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    next.setHours(Number(hour), Number(min));
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }
  return null;
}

function fmtUntil(ms) {
  if (ms <= 0) return 'с минуты на минуту';
  const min = Math.round(ms / 60000);
  if (min < 60) return `через ${min} мин`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `через ${h} ч ${m} мин` : `через ${h} ч`;
}

let _syncSchedule = null;

function updateSyncNextLabel() {
  if (!_syncSchedule?.ozon_sync_cron) return;
  const nextAt = nextCronAt(_syncSchedule.ozon_sync_cron);
  const el = document.getElementById('sl-next');
  if (el && nextAt) el.textContent = `· следующий ${fmtUntil(nextAt - Date.now())}`;
}

async function loadSyncLogs() {
  try {
    const [runs, sched] = await Promise.all([
      fetch('/api/ozon/sync-runs?limit=15').then(r => r.json()),
      fetch('/api/ozon/sync-schedule').then(r => r.json()),
    ]);
    _syncSchedule = sched;

    const cronEl = document.getElementById('sl-cron');
    if (cronEl) cronEl.textContent = sched.ozon_sync_cron ?? 'не задан (OZON_SYNC_CRON)';
    updateSyncNextLabel();

    const rows = runs.rows ?? [];
    if (!rows.length) {
      document.getElementById('sl-table').innerHTML = '<span style="color:#aaa">Синхронизаций ещё не было</span>';
      return;
    }
    const badge = (s) => {
      const label = s === 'success' ? 'успех' : s === 'partial' ? 'частично' : s === 'running' ? 'идёт' : 'ошибка';
      return `<span class="badge ${s}">${label}</span>`;
    };
    const html = `<table>
      <thead><tr>
        <th>#</th><th>Начало</th><th>Длит.</th><th>Статус</th>
        <th class="r">Товары</th><th class="r">Цены</th><th class="r">Остатки</th><th class="r">Ошибок</th>
        <th>Сообщение</th>
      </tr></thead>
      <tbody>${rows.map(r => {
        const msg = r.error_message || r.details || '';
        return `<tr>
          <td>${r.id}</td>
          <td>${fmtDate(r.started_at)}</td>
          <td>${fmtDur(r.started_at, r.finished_at)}</td>
          <td>${badge(r.status)}</td>
          <td class="r">${fmtNum(r.products_processed)}</td>
          <td class="r">${fmtNum(r.prices_processed)}</td>
          <td class="r">${fmtNum(r.stocks_processed)}</td>
          <td class="r">${fmtNum(r.errors_count)}</td>
          <td class="err-txt" title="${msg.replace(/"/g,'&quot;')}">${msg.slice(0, 120)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
    document.getElementById('sl-table').innerHTML = html;
  } catch {}
}

setInterval(updateSyncNextLabel, 10000);

loadCategories();
loadStats();
loadSyncLogs();
startPolling(false);
setInterval(loadSyncLogs, 30000);
