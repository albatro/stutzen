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

function fmtTimeUntil(ms) {
  if (ms <= 0) return 'с минуты на минуту';
  const min = Math.round(ms / 60000);
  if (min < 60) return `через ${min} мин`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `через ${h} ч ${m} мин` : `через ${h} ч`;
}

function fmtAt(date) {
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `в ${time}` : `${date.toLocaleDateString('ru-RU')} в ${time}`;
}

// Следующее срабатывание по cron-выражению (поддерживаем наши стандартные паттерны).
function nextCronAt(expr) {
  if (!expr) return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  if (dom !== '*' || mon !== '*' || dow !== '*') return null;
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  // каждый час в :MM
  if (hour === '*' && /^\d+$/.test(min)) {
    next.setMinutes(Number(min));
    if (next <= now) next.setHours(next.getHours() + 1);
    return next;
  }
  // каждые N часов в :00
  const mH = /^\*\/(\d+)$/.exec(hour);
  if (min === '0' && mH) {
    const n = Number(mH[1]);
    next.setMinutes(0);
    let h = next.getHours() + 1;
    while (h % n !== 0) h++;
    if (h >= 24) { next.setDate(next.getDate() + 1); h %= 24; }
    next.setHours(h);
    return next;
  }
  // ежедневно в H:M
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    next.setHours(Number(hour), Number(min));
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }
  return null;
}

let _scheduleCache = null;

function updateNextLabels() {
  const s = _scheduleCache;
  if (!s) return;

  // Поставщик: следующий = последний успех + stale_hours
  const supplierEl = $('#supplierNext');
  if (supplierEl) {
    const lastAt = s.supplier_last_success_at ? new Date(s.supplier_last_success_at) : null;
    const staleMs = (s.supplier_stale_hours || 6) * 3600000;
    const nextAt = lastAt ? new Date(lastAt.getTime() + staleMs) : null;
    if (nextAt) {
      const ms = nextAt.getTime() - Date.now();
      supplierEl.innerHTML = `<b>${fmtTimeUntil(ms)}</b> <span class="hint">(${fmtAt(nextAt)})</span>`;
    } else {
      supplierEl.textContent = 'неизвестно';
    }
  }

  // Фид: следующее по cron
  const feedEl = $('#feedNext');
  if (feedEl) {
    const nextAt = nextCronAt(s.feed_cron);
    if (nextAt) {
      const ms = nextAt.getTime() - Date.now();
      feedEl.innerHTML = `<b>${fmtTimeUntil(ms)}</b> <span class="hint">(${fmtAt(nextAt)})</span>`;
    } else {
      feedEl.textContent = '—';
    }
  }
}

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
      _scheduleCache = schedule;
      $('#supplierCron').textContent = schedule.supplier_cron ?? `каждые ${schedule.supplier_stale_hours || 6} ч`;
      const cronHint = describeCron(schedule.supplier_cron);
      const staleH = schedule.supplier_stale_hours;
      const staleHint = staleH ? ` (импорт если предыдущее успешное чтение было больше ${staleH} ч назад)` : '';
      $('#supplierCronHint').textContent = `${cronHint}${staleHint}`;
      $('#feedCron').textContent = schedule.feed_cron ?? '—';
      $('#feedCronHint').textContent = describeCron(schedule.feed_cron);
      updateNextLabels();
      const supLink = $('#supplierFeedLink');
      if (schedule.supplier_feed_url) {
        supLink.href = schedule.supplier_feed_url;
        supLink.textContent = schedule.supplier_feed_url;
      } else {
        supLink.removeAttribute('href');
        supLink.textContent = 'SUPPLIER_FEED_URL не задан';
      }
      if (schedule.generated_feed_url) {
        const gen = $('#generatedFeedLink');
        gen.href = schedule.generated_feed_url;
        gen.textContent = new URL(schedule.generated_feed_url, location.href).href;
      }
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
setInterval(updateNextLabels, 60_000);
