const $ = (sel) => document.querySelector(sel);

const fmtDate = (s) => s ? new Date(s).toLocaleString('ru-RU') : '—';
const fmtNum = (v) => v == null ? '' : Number(v).toLocaleString('ru-RU');
const fmtDur = (ms) => {
  if (ms == null) return '';
  if (ms < 1000) return `${ms} мс`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)} с`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m} мин ${s} с`;
};
const diffMs = (a, b) => (a && b) ? (new Date(b) - new Date(a)) : null;
const statusBadge = (s) => `<span class="status ${s}">${s === 'success' ? 'успех' : s === 'error' ? 'ошибка' : 'идёт'}</span>`;
const escapeHtml = (s) => (s ?? '').toString()
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderSupplier(rows) {
  const meta = $('#supplierMeta');
  const last = rows.find(r => r.status === 'success');
  meta.innerHTML = last
    ? `Последнее успешное чтение: <b>${fmtDate(last.finished_at ?? last.started_at)}</b> · офферов: <b>${fmtNum(last.offers_processed)}</b>`
    : 'Успешных чтений пока нет';

  if (!rows.length) { $('#supplierTable').innerHTML = '<div class="empty">Пусто</div>'; return; }
  const html = `
    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th>Начало</th>
          <th>Окончание</th>
          <th>Длительность</th>
          <th>Статус</th>
          <th class="num">Офферы</th>
          <th class="num">Категории</th>
          <th>Ошибка</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="num">${r.id}</td>
            <td>${fmtDate(r.started_at)}</td>
            <td>${fmtDate(r.finished_at)}</td>
            <td>${fmtDur(diffMs(r.started_at, r.finished_at))}</td>
            <td>${statusBadge(r.status)}</td>
            <td class="num">${fmtNum(r.offers_processed)}</td>
            <td class="num">${fmtNum(r.categories_processed)}</td>
            <td class="err">${escapeHtml(r.error_message)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  $('#supplierTable').innerHTML = html;
}

function renderGenerated(rows) {
  const meta = $('#genMeta');
  const last = rows.find(r => r.status === 'success');
  meta.innerHTML = last
    ? `Последняя генерация: <b>${fmtDate(last.finished_at ?? last.started_at)}</b> · офферов в фиде: <b>${fmtNum(last.count)}</b>`
    : 'Успешных генераций пока нет';

  if (!rows.length) { $('#genTable').innerHTML = '<div class="empty">Пусто</div>'; return; }
  const html = `
    <table>
      <thead>
        <tr>
          <th class="num">#</th>
          <th>Начало</th>
          <th>Окончание</th>
          <th>Длительность</th>
          <th>Статус</th>
          <th class="num">Офферов в фиде</th>
          <th class="num">Ниже закупки</th>
          <th class="num">Без правила</th>
          <th>Ошибка</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="num">${r.id}</td>
            <td>${fmtDate(r.started_at)}</td>
            <td>${fmtDate(r.finished_at)}</td>
            <td>${fmtDur(r.duration_ms ?? diffMs(r.started_at, r.finished_at))}</td>
            <td>${statusBadge(r.status)}</td>
            <td class="num">${fmtNum(r.count)}</td>
            <td class="num">${fmtNum(r.skipped_below_purchase)}</td>
            <td class="num">${fmtNum(r.skipped_no_rule)}</td>
            <td class="err">${escapeHtml(r.error_message)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  $('#genTable').innerHTML = html;
}

async function load() {
  const btn = $('#refresh');
  btn.disabled = true;
  try {
    const [supplier, generated] = await Promise.all([
      fetch('/api/feed-logs/supplier').then(r => r.json()),
      fetch('/api/feed-logs/generated').then(r => r.json()),
    ]);
    renderSupplier(supplier.rows ?? []);
    renderGenerated(generated.rows ?? []);
  } finally {
    btn.disabled = false;
  }
}

$('#refresh').addEventListener('click', load);
load();
