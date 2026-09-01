const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtPct = (v) => v == null ? '' : `${v}%`;

const table = new Tabulator('#table', {
  layout: 'fitDataStretch',
  ajaxURL: '/api/offers',
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
    { title: 'SKU', field: 'offer_id', width: 150, frozen: true },
    { title: 'Название', field: 'name', minWidth: 260, widthGrow: 3 },
    { title: 'Категория', field: 'category_name', width: 180 },
    { title: 'Цена, ₽', field: 'price', width: 110, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Закупочная цена, ₽', field: 'purchase_price', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Габариты ЯМ, см', field: 'ym_dimensions', width: 130, hozAlign: 'right', headerSort: false,
      formatter: (cell) => {
        const r = cell.getData();
        const parts = [r.length, r.width, r.height];
        if (parts.every(v => v == null)) return '';
        return parts.map(v => v == null ? '?' : v).join('×');
      } },
    { title: 'Вес ЯМ, кг', field: 'weight', width: 100, hozAlign: 'right',
      formatter: (cell) => cell.getValue() == null ? '' : Number(cell.getValue()).toLocaleString('ru-RU', { maximumFractionDigits: 3 }) },
    { title: 'Габариты поставщика', field: 'supplier_dimensions', width: 150, hozAlign: 'right', headerSort: false,
      formatter: (cell) => cell.getValue() ?? '' },
    { title: 'Вес поставщика, кг', field: 'supplier_weight', width: 130, hozAlign: 'right',
      formatter: (cell) => cell.getValue() == null ? '' : Number(cell.getValue()).toLocaleString('ru-RU', { maximumFractionDigits: 3 }) },
    { title: 'Остаток', field: 'stock_total', width: 90, hozAlign: 'right' },
    { title: 'Комиссия за продажу, ₽', field: 'fee_amount', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Комиссия за продажу, %', field: 'fee_percent', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtPct(cell.getValue()) },
    { title: 'Приём оплаты, ₽', field: 'agency_amount', width: 110, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'РКО, ₽', field: 'payment_amount', width: 100, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Доставка покупателю, ₽', field: 'delivery_amount', width: 140, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Магистраль, ₽', field: 'middle_mile_amount', width: 110, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Итого расходов, ₽', field: 'commission_amount', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'К перечислению, ₽', field: 'payout', width: 130, hozAlign: 'right',
      formatter: (cell) => fmtMoney(cell.getValue()) },
    { title: 'Обновлено', field: 'updated_at', width: 150, sorter: 'string',
      formatter: (cell) => {
        const v = cell.getValue();
        if (!v) return '';
        return new Date(v).toLocaleString('ru-RU');
      } },
  ],
});

// ---- Видимость колонок (шестерёнка) ----
const VISIBILITY_KEY = 'stutzen.columnVisibility.v1';

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

function renderGearPanel() {
  const panel = $('#gearPanel');
  const state = loadVisibility();
  const items = table.getColumns()
    .filter(c => c.getField())
    .map(c => {
      const f = c.getField();
      const def = c.getDefinition();
      const visible = state[f] !== false;
      const label = (def.title && def.title.trim()) || f;
      return `<label><input type="checkbox" data-field="${f}" ${visible ? 'checked' : ''}> ${label}</label>`;
    }).join('');
  panel.innerHTML = items + `
    <div class="gear-actions">
      <button data-gear-action="all">Все</button>
      <button data-gear-action="none">Никакие</button>
      <button data-gear-action="reset">Сбросить</button>
    </div>`;
  panel.querySelectorAll('input[type=checkbox]').forEach(el => {
    el.addEventListener('change', () => {
      const f = el.dataset.field;
      const s = loadVisibility();
      s[f] = el.checked;
      saveVisibility(s);
      el.checked ? table.getColumn(f).show() : table.getColumn(f).hide();
    });
  });
  panel.querySelectorAll('button[data-gear-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.gearAction;
      const s = {};
      for (const c of table.getColumns()) {
        const f = c.getField();
        if (!f) continue;
        if (action === 'all') s[f] = true;
        else if (action === 'none') s[f] = false;
      }
      if (action === 'reset') localStorage.removeItem(VISIBILITY_KEY);
      else saveVisibility(s);
      applyVisibility();
      renderGearPanel();
    });
  });
}

$('#gear').addEventListener('click', (e) => {
  e.stopPropagation();
  const panel = $('#gearPanel');
  if (!panel.classList.contains('open')) renderGearPanel();
  panel.classList.toggle('open');
});
document.addEventListener('click', (e) => {
  const panel = $('#gearPanel');
  if (panel.classList.contains('open') && !panel.contains(e.target) && e.target.id !== 'gear') {
    panel.classList.remove('open');
  }
});
table.on('tableBuilt', applyVisibility);

let debounceTimer;
$('#search').addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => table.setPage(1), 300);
});
$('#category').addEventListener('change', () => table.setPage(1));
$('#refresh').addEventListener('click', () => table.setPage(1));

$('#sync').addEventListener('click', async () => {
  const btn = $('#sync');
  btn.disabled = true; btn.textContent = 'Синхронизация…';
  try {
    const r = await fetch('/api/sync', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) alert(j.error ?? 'Ошибка');
  } catch (e) { alert(e.message); }
  pollStats();
});

async function loadCategories() {
  const r = await fetch('/api/categories');
  const cats = await r.json();
  const sel = $('#category');
  sel.innerHTML = '<option value="">Все категории</option>' +
    cats.map(c => `<option value="${c.category_id}">${(c.category_name ?? '—')} (${c.cnt})</option>`).join('');
}

async function loadStats() {
  const r = await fetch('/api/stats');
  return r.json();
}

async function pollStats() {
  const { stats, lastRun, syncInProgress } = await loadStats();
  const last = lastRun
    ? `последний синк: ${new Date(lastRun.started_at).toLocaleString('ru-RU')} — ${lastRun.status}, офферов ${lastRun.offers_processed ?? 0}, ошибок ${lastRun.errors_count ?? 0}`
    : 'синков пока не было';
  $('#stats').textContent = `БД: офферов ${stats.offers}, цен ${stats.prices}, с остатками ${stats.stocks}, с комиссиями ${stats.commissions}. ${last}`;

  const btn = $('#sync');
  if (syncInProgress) {
    btn.disabled = true;
    btn.textContent = `Идёт синхронизация… (${lastRun?.offers_processed ?? 0} офферов)`;
    setTimeout(pollStats, 2000);
  } else {
    btn.disabled = false;
    btn.textContent = 'Запустить синхронизацию ЯМ';
  }
}

// ---- Логи синхронизации ЯМ ----
const fmtDate = (s) => s ? new Date(s).toLocaleString('ru-RU') : '—';
const fmtNum = (v) => v == null ? '—' : Number(v).toLocaleString('ru-RU');
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

let _ymSchedule = null;

function updateYmNextLabel() {
  if (!_ymSchedule?.sync_cron) return;
  const nextAt = nextCronAt(_ymSchedule.sync_cron);
  const el = $('#sl-next');
  if (el && nextAt) el.textContent = `· следующий ${fmtUntil(nextAt - Date.now())}`;
}

async function loadSyncLogs() {
  try {
    const [runs, sched] = await Promise.all([
      fetch('/api/ym/sync-runs?limit=15').then(r => r.json()),
      fetch('/api/feed-logs/schedule').then(r => r.json()),
    ]);
    _ymSchedule = sched;

    const cronEl = $('#sl-cron');
    if (cronEl) cronEl.textContent = sched.sync_cron ?? 'не задан (SYNC_CRON)';
    updateYmNextLabel();

    const rows = runs.rows ?? [];
    if (!rows.length) {
      $('#sl-table').innerHTML = '<span style="color:#aaa">Синхронизаций ещё не было</span>';
      return;
    }
    const badge = (s) => {
      const norm = (s === 'failed') ? 'error' : s;
      const label = norm === 'success' ? 'успех' : norm === 'partial' ? 'частично' : norm === 'running' ? 'идёт' : 'ошибка';
      return `<span class="badge ${norm}">${label}</span>`;
    };
    $('#sl-table').innerHTML = `<table>
      <thead><tr>
        <th>#</th><th>Начало</th><th>Длит.</th><th>Статус</th>
        <th class="r">Офферов</th><th class="r">Цен</th><th class="r">Остатков</th><th class="r">Ошибок</th>
        <th>Сообщение</th>
      </tr></thead>
      <tbody>${rows.map(r => {
        const msg = r.error_message || r.details || '';
        return `<tr>
          <td>${r.id}</td>
          <td>${fmtDate(r.started_at)}</td>
          <td>${fmtDur(r.started_at, r.finished_at)}</td>
          <td>${badge(r.status)}</td>
          <td class="r">${fmtNum(r.offers_processed)}</td>
          <td class="r">${fmtNum(r.prices_processed)}</td>
          <td class="r">${fmtNum(r.stocks_processed)}</td>
          <td class="r">${fmtNum(r.errors_count)}</td>
          <td class="err-txt" title="${msg.replace(/"/g, '&quot;')}">${msg.slice(0, 150)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  } catch {}
}

setInterval(updateYmNextLabel, 10000);

loadCategories();
pollStats();
loadSyncLogs();
setInterval(pollStats, 5000);
setInterval(loadSyncLogs, 30000);
