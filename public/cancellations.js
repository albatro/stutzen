const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtInt = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU');

const statusLabels = {
  CANCELLED_BEFORE_PROCESSING: 'Отмена до обработки',
  CANCELLED_IN_PROCESSING: 'Отмена в обработке',
  CANCELLED_IN_DELIVERY: 'Отмена в доставке',
  RETURNED: 'Возврат',
  UNPAID: 'Не оплачен',
};

const table = new Tabulator('#table', {
  layout: 'fitDataStretch',
  ajaxURL: '/api/cancellations/by-sku',
  pagination: true,
  paginationMode: 'remote',
  paginationSize: 100,
  paginationSizeSelector: [50, 100, 200, 500],
  sortMode: 'remote',
  initialSort: [{ column: 'cancelled_units', dir: 'desc' }],
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
    return `${url}?${p}`;
  },
  ajaxResponse: (_url, _params, r) => ({
    data: r.rows,
    last_page: Math.max(1, Math.ceil(r.total / (r.limit || 100))),
  }),
  columns: [
    { title: '', field: 'image_url', width: 48, formatter: (c) => c.getValue() ? `<img class="thumb" src="${c.getValue()}">` : '', headerSort: false },
    { title: 'SKU', field: 'offer_id', width: 140, frozen: true },
    { title: 'Название', field: 'name', minWidth: 280, widthGrow: 3 },
    { title: 'Категория', field: 'category_name', width: 170 },
    { title: 'Всего штук', field: 'total_units', width: 90, hozAlign: 'right', formatter: (c) => fmtInt(c.getValue()) },
    { title: 'Отменено штук', field: 'cancelled_units', width: 110, hozAlign: 'right', formatter: (c) => `<b class="hot">${fmtInt(c.getValue())}</b>` },
    { title: 'Отмена, %', field: 'cancellation_rate_percent', width: 100, hozAlign: 'right', formatter: (c) => c.getValue() == null ? '' : `<b class="hot">${c.getValue()}%</b>` },
    { title: 'Потеряно ₽', field: 'cancelled_gross', width: 110, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'До обработки', field: 'c_before', width: 90, hozAlign: 'right', formatter: (c) => fmtInt(c.getValue()) },
    { title: 'В обработке', field: 'c_in_processing', width: 90, hozAlign: 'right', formatter: (c) => fmtInt(c.getValue()) },
    { title: 'В доставке', field: 'c_in_delivery', width: 90, hozAlign: 'right', formatter: (c) => fmtInt(c.getValue()) },
    { title: 'Возвраты', field: 'c_returned', width: 90, hozAlign: 'right', formatter: (c) => fmtInt(c.getValue()) },
  ],
});

async function loadSummary() {
  const p = new URLSearchParams();
  if ($('#dateFrom').value) p.set('dateFrom', $('#dateFrom').value);
  if ($('#dateTo').value) p.set('dateTo', $('#dateTo').value);
  const r = await fetch(`/api/cancellations/summary?${p}`);
  const { period, totals: t, by_status, by_month } = await r.json();

  $('#totalCard').innerHTML = `
    <h2>Итог по отменам ${period.from ?? '—'} → ${period.to ?? '—'}</h2>
    <div class="grid">
      <div>Всего заказов<b>${fmtInt(t.total_orders)}</b></div>
      <div>Отменено заказов<b class="hot">${fmtInt(t.cancelled_orders)}</b></div>
      <div>Доля отмен<b class="hot">${t.cancellation_rate_percent == null ? '—' : t.cancellation_rate_percent + '%'}</b></div>
      <div>Штук в отменах<b>${fmtInt(t.lost_units)}</b></div>
      <div>Не реализованная выручка<b>${fmtMoney(t.lost_revenue)} ₽</b><span class="small">валовая (BUYER+субсидия) по отменённым</span></div>
    </div>
    <div class="breakdown">
      <table>
        <thead><tr><th>По типу отмены</th><th>Заказов</th></tr></thead>
        <tbody>
          ${by_status.map(s => `<tr><td>${statusLabels[s.status] ?? s.status}</td><td>${fmtInt(s.n)}</td></tr>`).join('')}
        </tbody>
      </table>
      <table>
        <thead><tr><th>Месяц</th><th>Заказов</th><th>Отменено</th><th>%</th></tr></thead>
        <tbody>
          ${by_month.map(m => `<tr><td>${m.month}</td><td>${fmtInt(m.total)}</td><td>${fmtInt(m.cancelled)}</td><td>${m.rate_percent == null ? '—' : m.rate_percent + '%'}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function exportUrl() {
  const p = new URLSearchParams();
  if ($('#dateFrom').value) p.set('dateFrom', $('#dateFrom').value);
  if ($('#dateTo').value) p.set('dateTo', $('#dateTo').value);
  return `/api/cancellations/report.csv?${p}`;
}
$('#exportCsv').addEventListener('click', () => { window.location = exportUrl(); });

let debounce;
$('#search').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => table.setPage(1), 300); });
$('#dateFrom').addEventListener('change', () => { loadSummary(); table.setPage(1); });
$('#dateTo').addEventListener('change', () => { loadSummary(); table.setPage(1); });
$('#apply').addEventListener('click', () => { loadSummary(); table.setPage(1); });

loadSummary();
