const $ = (sel) => document.querySelector(sel);
const fmtMoney = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtPct = (v) => v == null ? '' : `${v}%`;
const fmtDate = (s) => s ? new Date(s).toLocaleString('ru-RU') : '—';
const fmtBytes = (n) => {
  if (n == null) return '';
  const b = Number(n);
  if (!Number.isFinite(b)) return '';
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / (1024 * 1024)).toFixed(1)} МБ`;
};

const table = new Tabulator('#table', {
  layout: 'fitDataStretch',
  placeholder: 'Фид пока не собран — нажмите «↻ Пересобрать фид».',
  ajaxURL: '/api/ym/price-feed/rows',
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
    const availability = $('#availability').value;
    if (availability) p.set('availability', availability);
    return `${url}?${p}`;
  },
  ajaxResponse: (_url, _params, response) => {
    if (response.generated_at || response.file_size_bytes != null) {
      renderMeta(response.total, response.generated_at, response.file_size_bytes);
    }
    return {
      data: response.rows ?? [],
      last_page: Math.max(1, Math.ceil((response.total ?? 0) / (response.limit || 100))),
    };
  },
  ajaxError: (err) => {
    $('#meta').innerHTML = `<span style="color:#c00">Ошибка загрузки: ${err?.message ?? 'нет данных'}</span>`;
  },
  columns: [
    { title: '', field: 'image_url', width: 56, headerSort: false,
      formatter: (c) => c.getValue() ? `<img class="thumb" src="${c.getValue()}">` : '' },
    { title: 'SKU', field: 'offer_id', width: 150, frozen: true },
    { title: 'Артикул', field: 'vendor_code', width: 130 },
    { title: 'Бренд', field: 'vendor', width: 120 },
    { title: 'Название', field: 'name', minWidth: 280, widthGrow: 3 },
    { title: 'Категория ЯМ', field: 'category_name', width: 200 },
    { title: 'Цена в фиде, ₽', field: 'new_price', width: 130, hozAlign: 'right',
      formatter: (c) => `<b>${fmtMoney(c.getValue())}</b>` },
    { title: 'В наличии', field: 'available', width: 90, hozAlign: 'center',
      formatter: (c) => c.getValue() === 1 ? '<span class="badge yes">да</span>' : '<span class="badge no">нет</span>' },
    { title: 'Остаток, шт', field: 'count', width: 100, hozAlign: 'right' },
    { title: 'Вес, кг', field: 'weight', width: 80, hozAlign: 'right' },
    { title: 'Габариты', field: 'dimensions', width: 110 },
    { title: 'Страна', field: 'country', width: 110 },
    { title: 'URL', field: 'url', width: 60, hozAlign: 'center', headerSort: false,
      formatter: (c) => c.getValue() ? `<a href="${c.getValue()}" target="_blank" rel="noopener">↗</a>` : '' },
  ],
});

function renderMeta(total, generatedAt, size) {
  const parts = [
    `офферов в фиде: <b>${(total ?? 0).toLocaleString('ru-RU')}</b>`,
    `собран: <b>${fmtDate(generatedAt)}</b>`,
  ];
  if (size != null) parts.push(`размер: <b>${fmtBytes(size)}</b>`);
  parts.push(`<a href="/api/ym/price-feed.xml" target="_blank">XML</a>`);
  $('#meta').innerHTML = parts.join(' · ');
}

async function loadCategories() {
  try {
    const r = await fetch('/api/ym/price-feed/categories');
    if (!r.ok) return;
    const cats = await r.json();
    $('#category').innerHTML = '<option value="">Все категории ЯМ</option>' +
      cats.map(c => `<option value="${c.category_id}">${c.category_name ?? '—'} (${c.cnt})</option>`).join('');
  } catch {}
}

function reload() { table.setPage(1); }
$('#refresh').addEventListener('click', reload);
$('#search').addEventListener('input', debounce(reload, 300));
$('#category').addEventListener('change', reload);
$('#availability').addEventListener('change', reload);

function debounce(fn, ms) {
  let t = null;
  return (...a) => { if (t) clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

$('#regen').addEventListener('click', async () => {
  const btn = $('#regen');
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Пересобираю…';
  try {
    const r = await fetch('/api/ym/price-feed/regenerate', { method: 'POST' }).then(r => r.json());
    if (r.error && r.error !== 'генерация уже идёт') {
      alert(`Ошибка: ${r.error}`);
      btn.disabled = false;
      btn.textContent = orig;
      return;
    }
    await pollUntilReady();
    btn.disabled = false;
    btn.textContent = orig;
    loadCategories();
    reload();
  } catch (e) {
    alert(`Ошибка: ${e.message}`);
    btn.disabled = false;
    btn.textContent = orig;
  }
});

async function pollUntilReady() {
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const s = await fetch('/api/ym/price-feed/stats').then(r => r.json());
      if (!s.generating) return;
    } catch {}
  }
}

loadCategories();
