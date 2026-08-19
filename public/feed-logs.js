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

function nextCronAt(expr) {
  if (!expr) return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  if (dom !== '*' || mon !== '*' || dow !== '*') return null;
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  if (hour === '*' && /^\d+$/.test(min)) {
    next.setMinutes(Number(min));
    if (next <= now) next.setHours(next.getHours() + 1);
    return next;
  }
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
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    next.setHours(Number(hour), Number(min));
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }
  return null;
}

function describeCron(expr) {
  if (!expr) return '';
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return '';
  const [min, hour, dom, mon, dow] = parts;
  if (dom !== '*' || mon !== '*' || dow !== '*') return '';
  if (min === '0' && hour === '*') return '— каждый час, в :00';
  const m = /^\*\/(\d+)$/.exec(hour);
  if (min === '0' && m) return `— каждые ${m[1]} часов, в :00`;
  if (/^\d+$/.test(min) && /^\d+$/.test(hour)) {
    return `— ежедневно в ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  return '';
}

// ── AUTO-REFRESH ──────────────────────────────────────────────
const AUTO_REFRESH_MS = 60_000;
let lastLoadedAt = null;

function updateDashAge() {
  if (!lastLoadedAt) return;
  const sec = Math.round((Date.now() - lastLoadedAt) / 1000);
  const ageEl = $('#dhAge');
  if (ageEl) ageEl.textContent = sec < 5 ? 'только что' : `${sec} с назад`;
  const cdEl = $('#dhCountdown');
  if (cdEl) {
    const rem = Math.max(0, Math.round((AUTO_REFRESH_MS - (Date.now() - lastLoadedAt)) / 1000));
    cdEl.textContent = rem > 0 ? `авто через ${rem}с` : '…';
  }
  // also refresh "next run" labels live
  updateNextLabels();
}

// ── DASHBOARD ─────────────────────────────────────────────────
let _dashData = null; // { supplierRows, genRows, schedule }

function miniTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function miniIco(s) {
  if (s === 'success') return '<span class="ico-ok">✓</span>';
  if (s === 'error')   return '<span class="ico-err">✗</span>';
  if (s === 'running') return '<span class="ico-run">⟳</span>';
  return '—';
}

function overallClass(supplierRows, genRows) {
  const sLast = supplierRows[0];
  const gLast = genRows[0];
  if (!sLast && !gLast) return 's-warn';
  const all = [sLast?.status, gLast?.status].filter(Boolean);
  if (all.some(s => s === 'error'))   return 's-err';
  if (all.some(s => s === 'running')) return 's-run';

  // staleness: supplier should have run in last 2h
  if (sLast?.status === 'success' && sLast.finished_at) {
    const h = (Date.now() - new Date(sLast.finished_at)) / 3600000;
    if (h > 2) return 's-warn';
  }
  if (all.every(s => s === 'success')) return 's-ok';
  return 's-warn';
}

function overallLabel(cls) {
  return {
    's-ok':   'Всё в порядке',
    's-err':  'Ошибка — нужно проверить',
    's-warn': 'Внимание / нет данных',
    's-run':  'Выполняется…',
  }[cls] ?? '—';
}

function buildSuppRows(rows) {
  if (!rows.length) return '<tr><td colspan="4" style="color:#aaa">нет данных</td></tr>';
  return rows.slice(0, 4).map(r => {
    const isErr = r.status === 'error';
    const errText = isErr && r.error_message
      ? `<td class="etxt">${escapeHtml(r.error_message.slice(0, 70))}</td>` : '<td></td>';
    return `<tr${isErr ? ' class="erow"' : ''}>
      <td>${miniTime(r.finished_at ?? r.started_at)}</td>
      <td>${miniIco(r.status)}</td>
      <td class="r">${fmtNum(r.offers_processed) || '—'}</td>
      ${errText}
    </tr>`;
  }).join('');
}

function buildGenRows(rows) {
  if (!rows.length) return '<tr><td colspan="5" style="color:#aaa">нет данных</td></tr>';
  return rows.slice(0, 4).map(r => {
    const isErr = r.status === 'error';
    const errText = isErr && r.error_message
      ? `<td class="etxt">${escapeHtml(r.error_message.slice(0, 60))}</td>` : '<td></td>';
    return `<tr${isErr ? ' class="erow"' : ''}>
      <td>${miniTime(r.finished_at ?? r.started_at)}</td>
      <td>${miniIco(r.status)}</td>
      <td class="r">${fmtNum(r.count) || '—'}</td>
      <td class="r">${fmtNum(r.skipped_below_purchase) || ''}</td>
      <td class="r">${fmtNum(r.skipped_no_rule) || ''}</td>
      ${errText}
    </tr>`;
  }).join('');
}

function renderDash(supplierRows, genRows, schedule) {
  _dashData = { supplierRows, genRows, schedule };

  const cls = overallClass(supplierRows, genRows);
  const dash = $('#dash');
  dash.className = cls;

  const sLast = supplierRows[0];
  const gLast = genRows[0];

  const suppSummary = sLast
    ? `${miniIco(sLast.status)} ${miniTime(sLast.finished_at ?? sLast.started_at)} · <b>${fmtNum(sLast.offers_processed) || '—'}</b> офф.`
    : '— нет данных';
  const genSummary = gLast
    ? `${miniIco(gLast.status)} ${miniTime(gLast.finished_at ?? gLast.started_at)} · <b>${fmtNum(gLast.count) || '—'}</b> офф.`
    : '— нет данных';

  const suppNextAt = schedule?.supplier_next_at ? new Date(schedule.supplier_next_at) : null;
  const suppNextTxt = suppNextAt ? fmtTimeUntil(suppNextAt - Date.now()) : '—';

  const feedNextAt = nextCronAt(schedule?.feed_cron);
  const feedNextTxt = feedNextAt ? fmtTimeUntil(feedNextAt - Date.now()) : '—';

  dash.innerHTML = `
    <div class="dh-top">
      <div class="dh-dot ${cls}"></div>
      <span class="dh-lbl ${cls}">${overallLabel(cls)}</span>
      <span class="dh-meta">
        <span id="dhAge">—</span>
        <span id="dhCountdown" style="color:#bbb"></span>
        <button onclick="load()" title="Обновить сейчас">↻</button>
        <button id="dhNavToggle" onclick="toggleNav()" title="Скрыть/показать меню">☰</button>
      </span>
    </div>
    <div class="dh-title">ЯМ STUTZEN</div>
    <div class="dh-cols">
      <div>
        <div class="dh-sec-head">Поставщик (Stutzen)</div>
        <div class="dh-summary">${suppSummary}</div>
        <div class="dh-nxt">Следующий: ${suppNextTxt}</div>
        <table class="dh-tbl">
          <thead><tr><th>Время</th><th>Ст</th><th class="r">Офф.</th><th></th></tr></thead>
          <tbody>${buildSuppRows(supplierRows)}</tbody>
        </table>
      </div>
      <div>
        <div class="dh-sec-head">Наш YML-фид</div>
        <div class="dh-summary">${genSummary}</div>
        <div class="dh-nxt">Следующая: ${feedNextTxt}</div>
        <table class="dh-tbl">
          <thead><tr><th>Время</th><th>Ст</th><th class="r">Офф.</th><th class="r" title="Ниже закупки">Зак.</th><th class="r" title="Нет правила">Пр.</th><th></th></tr></thead>
          <tbody>${buildGenRows(genRows)}</tbody>
        </table>
      </div>
    </div>`;

  updateDashAge();
  applyNavState(localStorage.getItem('navHidden') === '1');
}

// ── EXISTING SCHEDULE LABELS ──────────────────────────────────
let _scheduleCache = null;

function updateNextLabels() {
  const s = _scheduleCache;
  if (!s) return;

  const supplierEl = $('#supplierNext');
  if (supplierEl) {
    const nextAt = s.supplier_next_at ? new Date(s.supplier_next_at) : null;
    if (nextAt) {
      const ms = nextAt.getTime() - Date.now();
      supplierEl.innerHTML = `<b>${fmtTimeUntil(ms)}</b> <span class="hint">(${fmtAt(nextAt)})</span>`;
    } else {
      supplierEl.textContent = 'неизвестно';
    }
  }

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

  // also update dashboard "next" labels live if dashboard is rendered
  if (_dashData) {
    const suppNextAt = s.supplier_next_at ? new Date(s.supplier_next_at) : null;
    const suppEl = document.querySelector('.dh-cols > div:first-child .dh-nxt');
    if (suppEl && suppNextAt) suppEl.textContent = `Следующий: ${fmtTimeUntil(suppNextAt - Date.now())}`;

    const feedNextAt = nextCronAt(s.feed_cron);
    const feedEl2 = document.querySelector('.dh-cols > div:last-child .dh-nxt');
    if (feedEl2 && feedNextAt) feedEl2.textContent = `Следующая: ${fmtTimeUntil(feedNextAt - Date.now())}`;
  }
}

// ── TABLE RENDERERS ───────────────────────────────────────────
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

// ── LOAD ──────────────────────────────────────────────────────
async function load() {
  const btn = $('#refresh');
  if (btn) btn.disabled = true;
  try {
    const [supplier, generated, schedule] = await Promise.all([
      fetch('/api/feed-logs/supplier').then(r => r.json()),
      fetch('/api/feed-logs/generated').then(r => r.json()),
      fetch('/api/feed-logs/schedule').then(r => r.json()),
    ]);

    const sRows = supplier.rows ?? [];
    const gRows = generated.rows ?? [];

    lastLoadedAt = Date.now();
    renderDash(sRows, gRows, schedule);
    renderSupplier(sRows);
    renderGenerated(gRows);

    if (schedule) {
      _scheduleCache = schedule;
      const min = schedule.supplier_minute ?? 55;
      $('#supplierCron').textContent = `каждый час в :${String(min).padStart(2, '0')}`;
      const staleH = schedule.supplier_stale_hours;
      $('#supplierCronHint').textContent = staleH ? ` (не чаще раза в ${staleH} ч)` : '';
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
    if (btn) btn.disabled = false;
  }
}

$('#refresh').addEventListener('click', load);

// ── REGEN POLL ────────────────────────────────────────────────
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

// ── NAV TOGGLE ────────────────────────────────────────────────
function applyNavState(hidden) {
  document.querySelector('h1').style.display = hidden ? 'none' : '';
  document.querySelector('.nav').style.display = hidden ? 'none' : '';
  const btn = $('#dhNavToggle');
  if (btn) {
    btn.style.opacity = hidden ? '0.35' : '1';
    btn.title = hidden ? 'Показать меню' : 'Скрыть меню';
  }
}

function toggleNav() {
  const hidden = localStorage.getItem('navHidden') !== '1';
  localStorage.setItem('navHidden', hidden ? '1' : '0');
  applyNavState(hidden);
}

// ── INIT ──────────────────────────────────────────────────────
load();
pollFeedStatus();
setInterval(updateDashAge, 1_000);
setInterval(load, AUTO_REFRESH_MS);
applyNavState(localStorage.getItem('navHidden') === '1');
