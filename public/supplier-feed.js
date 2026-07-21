const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = (s) => s ? new Date(s).toLocaleString('ru-RU') : '—';
const fmtNum = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU');
const fmtBytes = (n) => {
  if (n == null) return '';
  const b = Number(n);
  if (!Number.isFinite(b)) return '';
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / (1024 * 1024)).toFixed(1)} МБ`;
};
const escapeHtml = (s) => (s ?? '').toString()
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const table = new Tabulator('#table', {
  layout: 'fitDataStretch',
  placeholder: 'В базе пусто. Дождитесь чтения фида или нажмите «↻ Перечитать фид».',
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
    return `${url}?${p}`;
  },
  ajaxResponse: (_url, _params, response) => ({
    data: response.rows ?? [],
    last_page: Math.max(1, Math.ceil((response.total ?? 0) / (response.limit || 100))),
  }),
  columns: [
    { title: '', field: 'picture', width: 56, headerSort: false,
      formatter: (c) => c.getValue() ? `<img class="thumb" src="${c.getValue()}">` : '' },
    { title: 'SKU', field: 'offer_id', width: 150, frozen: true },
    { title: 'Артикул', field: 'vendor_code', width: 130 },
    { title: 'Бренд', field: 'vendor', width: 120 },
    { title: 'Название', field: 'name', minWidth: 280, widthGrow: 3 },
    { title: 'Категория поставщика', field: 'category_name', width: 220 },
    { title: 'Розничная, ₽', field: 'price', width: 120, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'Закупочная, ₽', field: 'purchase_price', width: 120, hozAlign: 'right', formatter: (c) => fmtMoney(c.getValue()) },
    { title: 'В наличии', field: 'available', width: 90, hozAlign: 'center',
      formatter: (c) => c.getValue() === 1 ? '<span class="badge yes">да</span>' : '<span class="badge no">нет</span>' },
    { title: 'Остаток, шт', field: 'count', width: 100, hozAlign: 'right' },
    { title: 'Партийность', field: 'step_quantity', width: 100, hozAlign: 'right' },
    { title: 'Вес, кг', field: 'weight', width: 80, hozAlign: 'right' },
    { title: 'Габариты', field: 'dimensions', width: 110 },
    { title: 'Страна', field: 'country', width: 110 },
    { title: 'Валюта', field: 'currency', width: 80 },
    { title: 'Обновлено', field: 'updated_at', width: 150,
      formatter: (c) => c.getValue() ? new Date(c.getValue()).toLocaleString('ru-RU') : '' },
    { title: 'URL', field: 'url', width: 60, hozAlign: 'center', headerSort: false,
      formatter: (c) => c.getValue() ? `<a href="${c.getValue()}" target="_blank" rel="noopener">↗</a>` : '' },
  ],
});

// Клик по строке → модалка с полными данными оффера
table.on('rowClick', async (_e, row) => {
  const id = row.getData().offer_id;
  showOfferModal(id);
});

async function showOfferModal(id) {
  const overlay = $('#overlay');
  const modal = $('#modal');
  modal.innerHTML = '<button class="close" id="modalClose">×</button>Загружаю…';
  overlay.classList.add('open');
  try {
    const r = await fetch(`/api/supplier/offers/${encodeURIComponent(id)}`);
    if (!r.ok) { modal.innerHTML = '<button class="close" id="modalClose">×</button>Не найдено'; bindClose(); return; }
    const { offer } = await r.json();
    const pic = offer.picture ? `<img src="${offer.picture}">` : '';
    const row = (k, v) => v == null || v === '' ? '' : `<tr><td>${k}</td><td>${v}</td></tr>`;
    modal.innerHTML = `
      <button class="close" id="modalClose">×</button>
      <h2>${escapeHtml(offer.name ?? offer.offer_id)}</h2>
      <table>
        ${row('SKU', escapeHtml(offer.offer_id))}
        ${row('Артикул', escapeHtml(offer.vendor_code))}
        ${row('Бренд', escapeHtml(offer.vendor))}
        ${row('Категория поставщика', `${escapeHtml(offer.category_name ?? '')} <span style="color:#999">(id ${offer.supplier_category_id ?? '—'})</span>`)}
        ${row('Розничная, ₽', fmtMoney(offer.price))}
        ${row('Закупочная, ₽', fmtMoney(offer.purchase_price))}
        ${row('Мин. цена для лидера, ₽', fmtMoney(offer.min_for_bestseller))}
        ${row('Валюта', escapeHtml(offer.currency))}
        ${row('В наличии', offer.available ? 'да' : 'нет')}
        ${row('Остаток, шт', offer.count)}
        ${row('Партийность, шт', offer.step_quantity)}
        ${row('Вес, кг', offer.weight)}
        ${row('Габариты', escapeHtml(offer.dimensions))}
        ${row('Страна', escapeHtml(offer.country))}
        ${row('Условия продажи', escapeHtml(offer.sales_notes))}
        ${row('Ссылка на карточку', offer.url ? `<a href="${escapeHtml(offer.url)}" target="_blank" rel="noopener">открыть у поставщика ↗</a>` : '')}
        ${row('Обновлено в БД', offer.updated_at ? new Date(offer.updated_at).toLocaleString('ru-RU') : '')}
      </table>
      ${pic ? `<div>${pic}</div>` : ''}
      ${offer.description ? `<h3>Описание</h3><div class="desc">${escapeHtml(offer.description)}</div>` : ''}
    `;
    bindClose();
  } catch (e) {
    modal.innerHTML = `<button class="close" id="modalClose">×</button>Ошибка: ${escapeHtml(e.message)}`;
    bindClose();
  }
}

function bindClose() {
  const close = () => $('#overlay').classList.remove('open');
  $('#modalClose').addEventListener('click', close);
  $('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') close(); });
}

async function loadCategories() {
  try {
    const r = await fetch('/api/supplier/categories');
    if (!r.ok) return;
    const cats = await r.json();
    $('#category').innerHTML = '<option value="">Все категории поставщика</option>' +
      cats.map(c => `<option value="${c.category_id}">${escapeHtml(c.category_name ?? '—')} (${c.cnt})</option>`).join('');
  } catch {}
}

async function loadMeta() {
  try {
    const [stats, schedule, imports] = await Promise.all([
      fetch('/api/supplier/stats').then(r => r.json()),
      fetch('/api/feed-logs/schedule').then(r => r.json()),
      fetch('/api/feed-logs/supplier?limit=1').then(r => r.json()),
    ]);
    const last = imports.rows?.[0];
    const parts = [];
    parts.push(`офферов: <b>${fmtNum(stats.stats.offers)}</b>`);
    parts.push(`в наличии: <b>${fmtNum(stats.stats.available)}</b>`);
    parts.push(`категорий: <b>${fmtNum(stats.stats.categories)}</b>`);
    if (last) {
      const sizePart = last.file_size_bytes ? ` · размер: <b>${fmtBytes(last.file_size_bytes)}</b>` : '';
      parts.push(`последнее чтение: <b>${fmtDate(last.finished_at ?? last.started_at)}</b>${sizePart}`);
    }
    if (schedule?.supplier_feed_url) {
      parts.push(`<a href="${escapeHtml(schedule.supplier_feed_url)}" target="_blank" rel="noopener">исходный XML ↗</a>`);
    }
    $('#meta').innerHTML = parts.join(' · ');
  } catch (e) {
    $('#meta').innerHTML = `<span style="color:#c00">Ошибка: ${escapeHtml(e.message)}</span>`;
  }
}

function debounce(fn, ms) {
  let t = null;
  return (...a) => { if (t) clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function reload() { table.setPage(1); }
$('#refresh').addEventListener('click', () => { loadMeta(); loadCategories(); reload(); });
$('#search').addEventListener('input', debounce(reload, 300));
$('#category').addEventListener('change', reload);
$('#onlyAvail').addEventListener('change', reload);

$('#import').addEventListener('click', async () => {
  const btn = $('#import');
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Читаю…';
  try {
    const r = await fetch('/api/supplier/import', { method: 'POST' }).then(r => r.json());
    if (r.error && r.error !== 'Импорт уже идёт') {
      alert(`Ошибка: ${r.error}`);
      btn.disabled = false;
      btn.textContent = orig;
      return;
    }
    await pollUntilReady();
    btn.disabled = false;
    btn.textContent = orig;
    loadMeta();
    loadCategories();
    reload();
  } catch (e) {
    alert(`Ошибка: ${e.message}`);
    btn.disabled = false;
    btn.textContent = orig;
  }
});

async function pollUntilReady() {
  for (let i = 0; i < 600; i++) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const s = await fetch('/api/supplier/stats').then(r => r.json());
      if (!s.supplierImportInProgress) return;
    } catch {}
  }
}

loadMeta();
loadCategories();
