const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtPct = (v) => v == null ? '' : `${v > 0 ? '+' : ''}${v}%`;

let summaryCache = null;

const table = new Tabulator('#table', {
  layout: 'fitDataStretch',
  ajaxURL: '/api/price-proposals',
  pagination: true,
  paginationMode: 'remote',
  paginationSize: 200,
  paginationSizeSelector: [100, 200, 500, 1000],
  sortMode: 'remote',
  ajaxURLGenerator: (url, _config, params) => {
    const p = new URLSearchParams();
    p.set('limit', params.size ?? 200);
    p.set('offset', ((params.page ?? 1) - 1) * (params.size ?? 200));
    if (params.sort && params.sort[0]) {
      p.set('sort', params.sort[0].field);
      p.set('dir', params.sort[0].dir);
    }
    const search = $('#search').value.trim();
    if (search) p.set('search', search);
    const dir = $('#direction').value;
    if (dir) p.set('direction', dir);
    const min = $('#minDelta').value;
    if (min) p.set('minDeltaPct', min);
    return `${url}?${p}`;
  },
  ajaxResponse: (_url, _params, response) => {
    summaryCache = response.summary;
    renderSummary(response.summary, response.total);
    return {
      data: response.rows,
      last_page: Math.max(1, Math.ceil(response.total / (response.limit || 200))),
    };
  },
  rowFormatter: (row) => {
    if (row.getData().below_purchase) row.getElement().classList.add('warn');
  },
  columns: [
    { formatter: 'rowSelection', titleFormatter: 'rowSelection', headerSort: false, width: 40 },
    { title: '', field: 'image_url', width: 48, formatter: (c) => c.getValue() ? `<img class="thumb" src="${c.getValue()}">` : '', headerSort: false },
    { title: 'SKU', field: 'offer_id', width: 140, frozen: true },
    { title: 'Название', field: 'name', minWidth: 240, widthGrow: 3 },
    { title: 'Категория', field: 'category_name', width: 170 },
    { title: 'Закупочная, ₽', field: 'purchase_price', width: 110, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'Цена в ЯМ сейчас, ₽', field: 'ym_price', width: 120, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'Новая цена, ₽', field: 'new_price', width: 110, hozAlign: 'right',
      formatter: (c) => `<b>${fmtMoney(c.getValue())}</b>` },
    { title: 'Расчёт', field: 'breakdown', width: 80, hozAlign: 'center', headerSort: false,
      formatter: (c) => c.getValue() ? '<span class="details-link">детали</span>' : '',
      cellClick: (_e, cell) => { if (cell.getValue()) showBreakdown(cell.getData()); } },
    { title: 'Δ, ₽', field: 'delta', width: 90, hozAlign: 'right',
      formatter: (c) => {
        const v = c.getValue();
        if (v == null) return '';
        return `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${fmtMoney(v)}</span>`;
      } },
    { title: 'Δ, %', field: 'delta_percent', width: 90, hozAlign: 'right',
      formatter: (c) => {
        const v = c.getValue();
        if (v == null) return '';
        return `<span class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${fmtPct(v)}</span>`;
      } },
    { title: 'Ожид. маржа, ₽', field: 'expected_margin', width: 110, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'Ожид. маржа, %', field: 'expected_margin_percent', width: 110, hozAlign: 'right', formatter: (c) => c.getValue() == null ? '' : `${c.getValue()}%` },
    { title: 'Правило', field: 'rule_scope', width: 90 },
  ],
});

function renderSummary(s, filteredTotal) {
  if (!s) { $('#summary').textContent = ''; return; }
  $('#summary').innerHTML = `
    <span>Всего с расчётом: <b>${s.eligible_total}</b></span>
    <span>Повышение: <b class="up">${s.will_increase}</b></span>
    <span>Понижение: <b class="down">${s.will_decrease}</b></span>
    <span>Без изменения: <b>${s.no_change}</b></span>
    <span>Ниже закупочной (заблокировано): <b>${s.below_purchase}</b></span>
    <span>Под фильтром: <b>${filteredTotal}</b></span>
  `;
}

function showBreakdown(row) {
  const b = row.breakdown;
  if (!b) return;
  const capNote = b.delivery_capped ? ' <span style="color:#888">(потолок 1000 ₽)</span>' : '';
  const ruleLabel = b.rule_scope === 'global' ? 'глобальное' : 'по категории';
  const minAbs = b.rule_min_margin_amount != null
    ? ` или ≥ ${fmtMoney(b.rule_min_margin_amount)} ₽`
    : '';
  const html = `
    <div class="bd-head">
      <div>
        <div class="bd-title">Расчёт цены — ${row.offer_id}</div>
        <div class="bd-sub">${row.name ?? ''}</div>
      </div>
      <button class="bd-close" aria-label="Закрыть">×</button>
    </div>
    <table class="bd-table">
      <tr><td>Закупочная</td><td>${fmtMoney(b.purchase_price)} ₽</td></tr>
      <tr><td>Правило наценки (${ruleLabel})</td><td>${b.rule_margin_percent}%${minAbs}</td></tr>
      <tr><td>Требуемая выплата от ЯМ</td><td><b>${fmtMoney(b.required_payout)} ₽</b></td></tr>
      <tr class="bd-sep"><td colspan="2">Комиссии ЯМ</td></tr>
      <tr><td>Комиссия категории (${b.fee_percent}%)</td><td>−${fmtMoney(b.fee_amount)} ₽</td></tr>
      <tr><td>Приём оплаты (${b.payment_percent}%)</td><td>−${fmtMoney(b.payment_amount)} ₽</td></tr>
      <tr><td>Доставка (${b.delivery_percent}%)${capNote}</td><td>−${fmtMoney(b.delivery_amount)} ₽</td></tr>
      <tr><td>Средняя миля</td><td>−${fmtMoney(b.middle_mile_amount)} ₽</td></tr>
      <tr><td>Агентское вознаграждение</td><td>−${fmtMoney(b.agency_amount)} ₽</td></tr>
      <tr><td><b>Итого комиссий</b></td><td><b>−${fmtMoney(b.total_costs)} ₽</b></td></tr>
      <tr class="bd-sep"><td colspan="2">Итог</td></tr>
      <tr><td>Цена продажи</td><td><b>${fmtMoney(b.price)} ₽</b></td></tr>
      <tr><td>Выплата от ЯМ</td><td>${fmtMoney(b.payout)} ₽</td></tr>
      <tr><td>Маржа</td><td>${fmtMoney(b.margin)} ₽ (${b.margin_percent}%)</td></tr>
    </table>
  `;
  const backdrop = document.createElement('div');
  backdrop.className = 'bd-backdrop';
  const modal = document.createElement('div');
  modal.className = 'bd-modal';
  modal.innerHTML = html;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  modal.querySelector('.bd-close').addEventListener('click', close);
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
  });
}

let debounce;
$('#search').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => table.setPage(1), 300); });
$('#direction').addEventListener('change', () => table.setPage(1));
$('#minDelta').addEventListener('change', () => table.setPage(1));
$('#refresh').addEventListener('click', () => table.setPage(1));

async function sendOffers(ids) {
  if (ids.length === 0) { alert('Нечего отправлять'); return; }

  // Подтверждение если есть большие изменения — сначала проверим текущие данные таблицы
  const rows = table.getData('active');
  const map = new Map(rows.map(r => [r.offer_id, r]));
  const bigChanges = ids.filter(id => {
    const r = map.get(id);
    return r && r.delta_percent != null && Math.abs(r.delta_percent) > 30;
  });
  let confirmBigChanges = false;
  if (bigChanges.length > 0) {
    const ok = confirm(`${bigChanges.length} товаров с изменением > 30%. Подтвердить отправку?`);
    if (!ok) return;
    confirmBigChanges = true;
  }
  if (!confirm(`Отправить ${ids.length} цен в ЯМ?`)) return;

  $('#status').textContent = `Отправка ${ids.length}…`;
  document.querySelectorAll('button.send').forEach(b => b.disabled = true);
  try {
    const r = await fetch('/api/ym/update-prices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerIds: ids, confirmBigChanges }),
    });
    const j = await r.json();
    if (!r.ok) { $('#status').textContent = j.error ?? 'Ошибка'; return; }
    $('#status').innerHTML = `Отправлено: <b>${j.sent}</b>, неудачно: <b>${j.failed}</b>, пропущено: <b>${j.skipped.length}</b>`;
    table.setPage(1);
  } catch (e) {
    $('#status').textContent = e.message;
  } finally {
    document.querySelectorAll('button.send').forEach(b => b.disabled = false);
  }
}

$('#sendSel').addEventListener('click', async () => {
  const sel = table.getSelectedData().map(r => r.offer_id);
  sendOffers(sel);
});

// ---- YML-фид ----
const feedUrl = new URL('/api/ym/price-feed.xml', location.href).href;
$('#feedUrl').value = feedUrl;

function relTime(iso) {
  if (!iso) return 'ещё не собирался';
  const diffSec = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (diffSec < 60) return `${diffSec} с назад`;
  const m = Math.round(diffSec / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}

let feedPollTimer;
async function loadFeedStats() {
  try {
    const r = await fetch('/api/ym/price-feed/stats');
    const j = await r.json();
    const parts = [];
    if (j.generating) {
      parts.push('<b>идёт сборка…</b>');
    } else {
      parts.push(`в фиде: <b>${j.count}</b> офферов`);
      const skipped = (j.skipped_below_purchase ?? 0) + (j.skipped_no_rule ?? 0);
      if (skipped) parts.push(`пропущено ${skipped}`);
      if (j.file_size_bytes != null) {
        const b = j.file_size_bytes;
        const sizeStr = b < 1024 ? `${b} Б`
          : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} КБ`
          : `${(b / (1024 * 1024)).toFixed(1)} МБ`;
        parts.push(`размер: <b>${sizeStr}</b>`);
      }
      parts.push(`обновлён ${relTime(j.generated_at)}`);
      if (j.last_duration_ms != null) parts.push(`за ${(j.last_duration_ms / 1000).toFixed(1)} с`);
      if (j.last_error) parts.push(`<span style="color:#c00">ошибка: ${j.last_error}</span>`);
    }
    $('#feedStats').innerHTML = parts.join(' · ');
    $('#feedRegen').disabled = j.generating;

    clearTimeout(feedPollTimer);
    if (j.generating) feedPollTimer = setTimeout(loadFeedStats, 2000);
  } catch (e) { $('#feedStats').textContent = 'ошибка: ' + e.message; }
}

$('#feedCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(feedUrl); $('#feedCopy').textContent = '✓ скопировано'; setTimeout(() => $('#feedCopy').textContent = '📋 URL', 1500); }
  catch { $('#feedUrl').select(); document.execCommand('copy'); }
});
$('#feedOpen').addEventListener('click', () => window.open(feedUrl, '_blank'));
$('#feedDownload').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = feedUrl;
  a.download = 'stutzen-price-feed.xml';
  document.body.appendChild(a); a.click(); a.remove();
});
$('#feedRegen').addEventListener('click', async () => {
  $('#feedRegen').disabled = true;
  try {
    const r = await fetch('/api/ym/price-feed/regenerate', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) alert(j.error ?? 'Ошибка');
  } catch (e) { alert(e.message); }
  loadFeedStats();
});
loadFeedStats();
// Раз в минуту освежаем «обновлён N мин назад» — даже когда генерации нет.
setInterval(() => { if (!$('#feedRegen').disabled) loadFeedStats(); }, 60000);

$('#sendAll').addEventListener('click', async () => {
  // подгружаем весь список через API, не только текущую страницу
  const p = new URLSearchParams();
  p.set('limit', 2000);
  const search = $('#search').value.trim();
  if (search) p.set('search', search);
  const dir = $('#direction').value;
  if (dir) p.set('direction', dir);
  const min = $('#minDelta').value;
  if (min) p.set('minDeltaPct', min);
  const r = await fetch(`/api/price-proposals?${p}`);
  const j = await r.json();
  // Берём все (учитываем что limit=2000 — если больше, нужно несколько запросов)
  if (j.total > 2000) {
    if (!confirm(`Под фильтром ${j.total} товаров, отправлю первые 2000. Продолжить?`)) return;
  }
  sendOffers(j.rows.map(r => r.offer_id));
});
