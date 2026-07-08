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
const fmtBytes = (n) => {
  if (n == null) return '';
  const b = Number(n);
  if (!Number.isFinite(b)) return '';
  if (b < 1024) return `${b} Б`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} КБ`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
};
const diffMs = (a, b) => (a && b) ? (new Date(b) - new Date(a)) : null;
const statusBadge = (s) => `<span class="status ${s}">${s === 'success' ? 'успех' : s === 'error' ? 'ошибка' : 'идёт'}</span>`;
const escapeHtml = (s) => (s ?? '').toString()
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Человекопонятная расшифровка простых крон-выражений (для наших дефолтов).
function describeCron(expr) {
  if (!expr) return '';
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return '';
  const [min, hour, dom, mon, dow] = parts;
  if (dom !== '*' || mon !== '*' || dow !== '*') return '';
  // '0 * * * *' → каждый час в :00
  if (min === '0' && hour === '*') return '— каждый час, в :00';
  // '0 */N * * *' → каждые N часов
  const m = /^\*\/(\d+)$/.exec(hour);
  if (min === '0' && m) return `— каждые ${m[1]} часов, в :00`;
  // '0 H * * *' → раз в день
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    return `— ежедневно в ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  return '';
}

function renderSupplier(rows) {
  const meta = $('#supplierMeta');
  const last = rows.find(r => r.status === 'success');
  const sizePart = last && last.file_size_bytes != null ? ` · размер: <b>${fmtBytes(last.file_size_bytes)}</b>` : '';
  meta.innerHTML = last
    ? `Последнее успешное чтение: <b>${fmtDate(last.finished_at ?? last.started_at)}</b> · офферов: <b>${fmtNum(last.offers_processed)}</b>${sizePart}`
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
          <th class="num">Размер файла</th>
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
            <td class="num">${fmtBytes(r.file_size_bytes)}</td>
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
  const sizePart = last && last.file_size_bytes != null ? ` · размер: <b>${fmtBytes(last.file_size_bytes)}</b>` : '';
  meta.innerHTML = last
    ? `Последняя генерация: <b>${fmtDate(last.finished_at ?? last.started_at)}</b> · офферов в фиде: <b>${fmtNum(last.count)}</b>${sizePart}`
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
          <th class="num">Размер файла</th>
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
            <td class="num">${fmtBytes(r.file_size_bytes)}</td>
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
    const [supplier, generated, schedule] = await Promise.all([
      fetch('/api/feed-logs/supplier').then(r => r.json()),
      fetch('/api/feed-logs/generated').then(r => r.json()),
      fetch('/api/feed-logs/schedule').then(r => r.json()),
    ]);
    renderSupplier(supplier.rows ?? []);
    renderGenerated(generated.rows ?? []);
    if (schedule) {
      $('#supplierCron').textContent = schedule.supplier_cron ?? '—';
      $('#supplierCronHint').textContent = describeCron(schedule.supplier_cron);
      $('#feedCron').textContent = schedule.feed_cron ?? '—';
      $('#feedCronHint').textContent = describeCron(schedule.feed_cron);
    }
  } finally {
    btn.disabled = false;
  }
}

$('#refresh').addEventListener('click', load);

let pollTimer = null;
async function pollFeedStatus() {
  try {
    const s = await fetch('/api/ym/price-feed/stats').then(r => r.json());
    const status = $('#regenStatus');
    if (s.generating) {
      status.textContent = 'Генерация идёт…';
      $('#regen').disabled = true;
    } else {
      $('#regen').disabled = false;
      if (s.last_error) {
        status.textContent = `Ошибка: ${s.last_error}`;
      } else if (s.generated_at) {
        const parts = [`офферов: ${fmtNum(s.count)}`];
        if (s.file_size_bytes != null) parts.push(`размер: ${fmtBytes(s.file_size_bytes)}`);
        if (s.last_duration_ms != null) parts.push(`за ${fmtDur(s.last_duration_ms)}`);
        status.textContent = `Готово ${fmtDate(s.generated_at)} · ${parts.join(' · ')}`;
      } else {
        status.textContent = '';
      }
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; load(); }
    }
  } catch {}
}

$('#regen').addEventListener('click', async () => {
  const btn = $('#regen');
  btn.disabled = true;
  $('#regenStatus').textContent = 'Запускаю…';
  try {
    const r = await fetch('/api/ym/price-feed/regenerate', { method: 'POST' }).then(r => r.json());
    if (r.error) {
      $('#regenStatus').textContent = `Ошибка: ${r.error}`;
      btn.disabled = false;
      return;
    }
    if (!pollTimer) pollTimer = setInterval(pollFeedStatus, 2000);
    pollFeedStatus();
  } catch (e) {
    $('#regenStatus').textContent = `Ошибка: ${e.message}`;
    btn.disabled = false;
  }
});

load();
pollFeedStatus();
