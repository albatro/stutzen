const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtInt = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU');
const fmtPct = (v) => v == null ? '' : `${v}%`;

const table = new Tabulator('#table', {
  layout: 'fitDataStretch',
  ajaxURL: '/api/sales/report',
  pagination: true,
  paginationMode: 'remote',
  paginationSize: 100,
  paginationSizeSelector: [50, 100, 200, 500, 1000],
  sortMode: 'remote',
  initialSort: [{ column: 'units', dir: 'desc' }],
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
    if ($('#dateFrom').value) p.set('dateFrom', $('#dateFrom').value);
    if ($('#dateTo').value) p.set('dateTo', $('#dateTo').value);
    if ($('#includeCancelled').checked) p.set('includeCancelled', '1');
    if ($('#onlyWithPurchase').checked) p.set('onlyWithPurchase', '1');
    return `${url}?${p}`;
  },
  ajaxResponse: (_url, _params, response) => {
    renderSummary(response.summary, response.total);
    return {
      data: response.rows,
      last_page: Math.max(1, Math.ceil(response.total / (response.limit || 100))),
    };
  },
  columns: [
    { title: '', field: 'image_url', width: 48, formatter: (c) => c.getValue() ? `<img class="thumb" src="${c.getValue()}">` : '', headerSort: false },
    { title: 'SKU', field: 'offer_id', width: 140, frozen: true },
    { title: 'Название', field: 'name', minWidth: 280, widthGrow: 3 },
    { title: 'Категория', field: 'category_name', width: 170 },
    { title: 'Продано, шт', field: 'units', width: 100, hozAlign: 'right', formatter: (c) => `<b>${fmtInt(c.getValue())}</b>` },
    { title: 'Заказов', field: 'orders', width: 90, hozAlign: 'right', formatter: (c) => fmtInt(c.getValue()) },
    { title: 'Ср. цена продажи, ₽', field: 'avg_sale_price', width: 120, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'Выручка валовая, ₽', field: 'gross_revenue', width: 120, hozAlign: 'right', formatter: (c) => `<b>${fmtMoney(c.getValue())}</b>` },
    { title: 'Покупатель заплатил, ₽', field: 'buyer_paid', width: 130, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'Субсидия ЯМ, ₽', field: 'ym_subsidy', width: 110, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'Комиссии ЯМ, ₽', field: 'estimated_commissions', width: 120, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'К перечислению, ₽', field: 'payout', width: 120, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'Закупочная, ₽', field: 'purchase_price', width: 110, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'Закуп всего, ₽', field: 'purchase_total', width: 110, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'Маржа, ₽', field: 'margin', width: 110, hozAlign: 'right',
      formatter: (c) => {
        const v = c.getValue();
        if (v == null) return '<i style="color:#999">нет данных</i>';
        return `<span class="${v >= 0 ? 'pos' : 'neg'}">${fmtMoney(v)}</span>`;
      } },
    { title: 'Маржа, %', field: 'margin_percent', width: 100, hozAlign: 'right',
      formatter: (c) => {
        const v = c.getValue();
        if (v == null) return '';
        return `<span class="${v >= 0 ? 'pos' : 'neg'}">${fmtPct(v)}</span>`;
      } },
    { title: 'Маржа на ед., ₽', field: 'margin_per_unit', width: 110, hozAlign: 'right', formatter: (c) => {
      const v = c.getValue(); if (v == null) return '';
      return `<span class="${v >= 0 ? 'pos' : 'neg'}">${fmtMoney(v)}</span>`;
    } },
  ],
});

async function loadTotalSummary() {
  const p = new URLSearchParams();
  if ($('#dateFrom').value) p.set('dateFrom', $('#dateFrom').value);
  if ($('#dateTo').value) p.set('dateTo', $('#dateTo').value);
  if ($('#includeCancelled').checked) p.set('includeCancelled', '1');
  if ($('#onlyWithPurchase').checked) p.set('onlyWithPurchase', '1');
  const r = await fetch(`/api/sales/summary?${p}`);
  const { period, totals: t, by_month, by_status } = await r.json();

  const cls = (v) => v == null ? '' : (v >= 0 ? 'pos' : 'neg');
  const card = $('#totalCard');
  card.innerHTML = `
    <h2>Итог за период ${period.from ?? '—'} → ${period.to ?? '—'} ${period.only_completed ? '(без отменённых)' : '(включая отменённые)'}${period.only_with_purchase ? ' · только с известной закупочной' : ''}</h2>
    <div class="grid">
      <div>Заказов<b>${fmtInt(t.orders)}</b></div>
      <div>SKU<b>${fmtInt(t.skus)}</b></div>
      <div>Штук продано<b>${fmtInt(t.units)}</b></div>
      <div>Средний чек<b>${fmtMoney(t.avg_order_value)} ₽</b><span class="small">валовая / заказы</span></div>
      <div>Ср. цена ед.<b>${fmtMoney(t.avg_unit_price)} ₽</b></div>
      <div>Выручка валовая<b>${fmtMoney(t.gross_revenue)} ₽</b><span class="small">покупатель ${fmtMoney(t.buyer_paid)} + субсидия ЯМ ${fmtMoney(t.ym_subsidy)}</span></div>
      <div>Комиссии ЯМ всего<b>${fmtMoney(t.commissions)} ₽</b></div>
      <div>К перечислению<b>${fmtMoney(t.payout)} ₽</b><span class="small">валовая − комиссии</span></div>
      <div>Закуп всего<b>${fmtMoney(t.purchase_total)} ₽</b><span class="small">${fmtInt(t.units_with_purchase)} ед. имеют закупочную из ${fmtInt(t.units)}</span></div>
      <div>Маржа<b class="${cls(t.margin)}">${fmtMoney(t.margin)} ₽</b><span class="small">к перечислению − закуп</span></div>
      <div>Маржа от закупа<b class="${cls(t.margin_percent_of_purchase)}">${t.margin_percent_of_purchase == null ? '—' : t.margin_percent_of_purchase + '%'}</b></div>
      <div>Маржа от выручки<b class="${cls(t.margin_percent_of_gross)}">${t.margin_percent_of_gross == null ? '—' : t.margin_percent_of_gross + '%'}</b></div>
    </div>

    <div class="by-month">
      <table>
        <thead>
          <tr>
            <th>Месяц</th>
            <th>Заказов</th>
            <th>Штук</th>
            <th>Выручка валовая, ₽</th>
            <th>Комиссии, ₽</th>
            <th>К перечислению, ₽</th>
            <th>Закуп, ₽</th>
            <th>Маржа, ₽</th>
            <th>Маржа, %</th>
          </tr>
        </thead>
        <tbody>
          ${by_month.map(m => `
            <tr>
              <td>${m.month}</td>
              <td>${fmtInt(m.orders)}</td>
              <td>${fmtInt(m.units)}</td>
              <td>${fmtMoney(m.gross_revenue)}</td>
              <td>${fmtMoney(m.commissions)}</td>
              <td>${fmtMoney(m.payout)}</td>
              <td>${fmtMoney(m.purchase_total)}</td>
              <td class="${cls(m.margin)}">${fmtMoney(m.margin)}</td>
              <td class="${cls(m.margin_percent)}">${m.margin_percent == null ? '—' : m.margin_percent + '%'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="small" style="margin-top:8px">
      Статусы заказов в периоде: ${by_status.map(s => `${s.status}: ${s.n}`).join(' · ')}
    </div>
  `;
}

function renderSummary(s, filteredTotal) {
  if (!s) { $('#summary').textContent = ''; return; }
  $('#summary').innerHTML = `
    <div>SKU с продажами: <b>${fmtInt(s.skus)}</b></div>
    <div>Под фильтром: <b>${fmtInt(filteredTotal)}</b></div>
    <div>Продано штук: <b>${fmtInt(s.units)}</b></div>
    <div>Выручка валовая: <b>${fmtMoney(s.gross_revenue)} ₽</b></div>
    <div>Покупатели заплатили: <b>${fmtMoney(s.buyer_paid)} ₽</b></div>
    <div>Субсидия ЯМ: <b>${fmtMoney(s.ym_subsidy)} ₽</b></div>
    <div>К перечислению (после комиссий): <b>${fmtMoney(s.payout)} ₽</b></div>
    <div>Маржа после закупки: <b class="${s.estimated_margin >= 0 ? 'pos' : 'neg'}">${fmtMoney(s.estimated_margin)} ₽</b></div>
    <div>Убыточных SKU: <b class="neg">${fmtInt(s.skus_negative_margin)}</b></div>
  `;
}

let debounce;
$('#search').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => table.setPage(1), 300); });
$('#dateFrom').addEventListener('change', () => { loadTotalSummary(); table.setPage(1); });
$('#dateTo').addEventListener('change', () => { loadTotalSummary(); table.setPage(1); });
$('#includeCancelled').addEventListener('change', () => { loadTotalSummary(); table.setPage(1); });
$('#onlyWithPurchase').addEventListener('change', () => { loadTotalSummary(); table.setPage(1); });
$('#apply').addEventListener('click', () => { loadTotalSummary(); table.setPage(1); });

function exportUrl(path) {
  const p = new URLSearchParams();
  const search = $('#search').value.trim();
  if (search) p.set('search', search);
  if ($('#dateFrom').value) p.set('dateFrom', $('#dateFrom').value);
  if ($('#dateTo').value) p.set('dateTo', $('#dateTo').value);
  if ($('#includeCancelled').checked) p.set('includeCancelled', '1');
  if ($('#onlyWithPurchase').checked) p.set('onlyWithPurchase', '1');
  return `${path}?${p}`;
}
$('#exportCsv').addEventListener('click', () => { window.location = exportUrl('/api/sales/report.csv'); });
$('#exportMonthlyCsv').addEventListener('click', () => { window.location = exportUrl('/api/sales/monthly.csv'); });

$('#reimport').addEventListener('click', async () => {
  const btn = $('#reimport');
  btn.disabled = true; btn.textContent = 'Импорт…';
  const body = {};
  if ($('#dateFrom').value) body.dateFrom = $('#dateFrom').value;
  if ($('#dateTo').value) body.dateTo = $('#dateTo').value;
  try {
    const r = await fetch('/api/sales/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) alert(j.error ?? 'Ошибка');
  } catch (e) { alert(e.message); }
  pollStats();
});

async function pollStats() {
  const r = await fetch('/api/sales/stats');
  const { orders, range, lastImport, salesImportInProgress } = await r.json();
  const last = lastImport
    ? `последний импорт: ${new Date(lastImport.started_at).toLocaleString('ru-RU')}, статус ${lastImport.status}, заказов ${lastImport.orders_processed ?? 0}`
    : 'импортов не было';
  $('#status').textContent = `Заказов в БД: ${orders}, период ${range.first ?? '—'} → ${range.last ?? '—'}. ${last}`;
  const btn = $('#reimport');
  if (salesImportInProgress) {
    btn.disabled = true; btn.textContent = `Импорт… (${lastImport?.orders_processed ?? 0})`;
    setTimeout(pollStats, 2000);
  } else {
    btn.disabled = false; btn.textContent = 'Перетянуть из ЯМ';
  }
}

loadTotalSummary();
pollStats();
setInterval(pollStats, 5000);
