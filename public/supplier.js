const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtPct = (v) => v == null ? '' : `${v}%`;

const table = new Tabulator('#table', {
  layout: 'fitDataStretch',
  ajaxURL: '/api/supplier/offers',
  ajaxConfig: 'GET',
  pagination: true,
  paginationMode: 'remote',
  paginationSize: 100,
  paginationSizeSelector: [50, 100, 200, 500],
  sortMode: 'remote',
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
    if ($('#onlyAvail').checked) p.set('available', '1');
    const margin = $('#margin').value;
    if (margin) p.set('margin', margin);
    return `${url}?${p}`;
  },
  ajaxResponse: (_url, _params, response) => ({
    data: response.rows,
    last_page: Math.max(1, Math.ceil(response.total / (response.limit || 100))),
  }),
  columns: [
    { title: '', field: 'picture', width: 56, formatter: (c) => c.getValue() ? `<img class="thumb" src="${c.getValue()}">` : '', headerSort: false },
    { title: 'SKU', field: 'offer_id', width: 150, frozen: true },
    { title: 'Артикул', field: 'vendor_code', width: 130 },
    { title: 'Бренд', field: 'vendor', width: 120 },
    { title: 'Название', field: 'name', minWidth: 280, widthGrow: 3 },
    { title: 'Категория', field: 'category_name', width: 200 },
    { title: 'Закупочная, ₽', field: 'purchase_price', width: 120, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'Розничная, ₽', field: 'price', width: 120, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'Цена в ЯМ, ₽', field: 'ym_price', width: 110, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'Расходы ЯМ, ₽', field: 'ym_expenses', width: 110, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'Маржа от закупочной, ₽', field: 'margin', width: 130, hozAlign: 'right',
      formatter: (c) => {
        const v = c.getValue();
        if (v == null) return '';
        const cls = v < 0 ? 'color:#c00;font-weight:bold' : (v > 0 ? 'color:#080' : '');
        return `<span style="${cls}">${fmtMoney(v)}</span>`;
      } },
    { title: 'Маржа от закупочной, %', field: 'margin_percent', width: 130, hozAlign: 'right',
      formatter: (c) => {
        const v = c.getValue();
        if (v == null) return '';
        const cls = v < 0 ? 'color:#c00;font-weight:bold' : (v > 50 ? 'color:#080' : '');
        return `<span style="${cls}">${fmtPct(v)}</span>`;
      } },
    { title: 'Наличие, шт', field: 'count', width: 100, hozAlign: 'right' },
    { title: 'Вес, кг', field: 'weight', width: 80, hozAlign: 'right' },
    { title: 'Страна', field: 'country', width: 110 },
    { title: 'В ЯМ?', field: 'in_ym', width: 80, hozAlign: 'center',
      formatter: (c) => c.getValue() ? '<span class="badge yes">да</span>' : '<span class="badge no">нет</span>' },
    { title: 'Обновлено', field: 'updated_at', width: 150,
      formatter: (c) => c.getValue() ? new Date(c.getValue()).toLocaleString('ru-RU') : '' },
  ],
});

// Клик по строке → модалка
table.on('rowClick', async (_e, row) => {
  const id = row.getData().offer_id;
  showOfferModal(id);
});

async function showOfferModal(id) {
  const overlay = $('#overlay');
  const modal = $('#modal');
  modal.innerHTML = '<button class="close" id="modalClose">×</button>Загружаю…';
  overlay.classList.add('open');
  const r = await fetch(`/api/supplier/offers/${encodeURIComponent(id)}`);
  if (!r.ok) { modal.innerHTML = '<button class="close" id="modalClose">×</button>Не найдено'; bindClose(); return; }
  const { offer, ym } = await r.json();
  const pic = offer.picture ? `<img src="${offer.picture}">` : '';
  const row = (k, v) => v == null || v === '' ? '' : `<tr><td>${k}</td><td>${v}</td></tr>`;
  modal.innerHTML = `
    <button class="close" id="modalClose">×</button>
    <h2>${escapeHtml(offer.name ?? offer.offer_id)}</h2>
    <div class="grid">
      <div>
        <h3>Поставщик</h3>
        <table>
          ${row('SKU', offer.offer_id)}
          ${row('Артикул', offer.vendor_code)}
          ${row('Бренд', offer.vendor)}
          ${row('Категория', offer.category_name ?? offer.supplier_category_id)}
          ${row('Закупочная, ₽', fmtMoney(offer.purchase_price))}
          ${row('Розничная, ₽', fmtMoney(offer.price))}
          ${row('Мин. для лидера', fmtMoney(offer.min_for_bestseller))}
          ${row('Валюта', offer.currency)}
          ${row('В наличии', offer.available ? 'да' : 'нет')}
          ${row('Остаток, шт', offer.count)}
          ${row('Вес, кг', offer.weight)}
          ${row('Габариты', offer.dimensions)}
          ${row('Страна', offer.country)}
          ${row('Условия продажи', offer.sales_notes)}
          ${row('Ссылка', offer.url ? `<a href="${offer.url}" target="_blank">открыть</a>` : '')}
          ${row('Обновлено', offer.updated_at ? new Date(offer.updated_at).toLocaleString('ru-RU') : '')}
        </table>
        ${pic ? `<div>${pic}</div>` : ''}
      </div>
      <div>
        <h3>Я.Маркет</h3>
        ${ym ? `
          <table>
            ${row('SKU', ym.offer_id)}
            ${row('Название в ЯМ', ym.name)}
            ${row('Категория ЯМ', ym.category_name)}
            ${row('Цена в ЯМ, ₽', fmtMoney(ym.ym_price))}
            ${row('Комиссия за продажу, ₽', fmtMoney(ym.fee_amount))}
            ${row('Комиссия за продажу, %', ym.fee_percent != null ? ym.fee_percent + '%' : '')}
            ${row('Доставка покупателю, ₽', fmtMoney(ym.delivery_amount))}
            ${row('Магистраль, ₽', fmtMoney(ym.middle_mile_amount))}
            ${row('Итого расходов, ₽', fmtMoney(ym.commission_amount))}
            ${row('К перечислению, ₽', ym.ym_price != null && ym.commission_amount != null ? fmtMoney(ym.ym_price - ym.commission_amount) : '')}
            ${row('Маржа от закупочной, ₽', ym.ym_price != null && ym.commission_amount != null && offer.purchase_price != null
                  ? fmtMoney(ym.ym_price - ym.commission_amount - offer.purchase_price) : '')}
          </table>
        ` : '<i>Этого SKU нет в кабинете Я.Маркета</i>'}
      </div>
    </div>
  `;
  bindClose();

  function bindClose() {
    $('#modalClose').addEventListener('click', () => overlay.classList.remove('open'));
  }
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

$('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') $('#overlay').classList.remove('open'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#overlay').classList.remove('open'); });

let debounce;
$('#search').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => table.setPage(1), 300); });
$('#category').addEventListener('change', () => table.setPage(1));
$('#onlyAvail').addEventListener('change', () => table.setPage(1));
$('#margin').addEventListener('change', () => table.setPage(1));
$('#refresh').addEventListener('click', () => table.setPage(1));

$('#importBtn').addEventListener('click', async () => {
  const btn = $('#importBtn');
  btn.disabled = true; btn.textContent = 'Импорт…';
  try {
    const r = await fetch('/api/supplier/import', { method: 'POST' });
    const j = await r.json();
    if (!r.ok) alert(j.error ?? 'Ошибка');
  } catch (e) { alert(e.message); }
  pollStats();
});

async function loadCategories() {
  const r = await fetch('/api/supplier/categories');
  const cats = await r.json();
  $('#category').innerHTML = '<option value="">Все категории</option>' +
    cats.map(c => `<option value="${c.category_id}">${(c.category_name ?? '—')} (${c.cnt})</option>`).join('');
}

const fmtBytes = (n) => {
  if (n == null) return '';
  const b = Number(n);
  if (!Number.isFinite(b)) return '';
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / (1024 * 1024)).toFixed(1)} МБ`;
};

async function pollStats() {
  const r = await fetch('/api/supplier/stats');
  const { stats, lastImport, supplierImportInProgress } = await r.json();
  const sizePart = lastImport?.file_size_bytes ? `, размер ${fmtBytes(lastImport.file_size_bytes)}` : '';
  const last = lastImport
    ? `последний импорт: ${new Date(lastImport.started_at).toLocaleString('ru-RU')} — ${lastImport.status}, офферов ${lastImport.offers_processed ?? 0}${sizePart}`
    : 'импортов пока не было';
  $('#stats').textContent = `Поставщик: офферов ${stats.offers}, в наличии ${stats.available}, совпадает с ЯМ ${stats.matched_in_ym}, категорий ${stats.categories}. ${last}`;
  const btn = $('#importBtn');
  if (supplierImportInProgress) {
    const progress = lastImport?.file_size_bytes ? `${lastImport?.offers_processed ?? 0}, ${fmtBytes(lastImport.file_size_bytes)}` : `${lastImport?.offers_processed ?? 0}`;
    btn.disabled = true; btn.textContent = `Импорт… (${progress})`;
    setTimeout(pollStats, 2000);
  } else {
    btn.disabled = false; btn.textContent = 'Импорт из фида';
  }
}

loadCategories();
pollStats();
setInterval(pollStats, 5000);
