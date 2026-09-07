const $ = (id) => document.getElementById(id);

let _nextRunAt = null;
let _autoEnabled = false;

// ---- Таймер ----
function updateTimer() {
  if (!_nextRunAt) return;
  const diff = Math.max(0, Math.floor((new Date(_nextRunAt) - Date.now()) / 1000));
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  $('timer').textContent = `${m} мин ${String(s).padStart(2, '0')} сек`;
  $('timer-note').textContent = _autoEnabled ? 'авто-отправка активна' : 'авто-отправка не настроена';
}
setInterval(updateTimer, 1000);

// ---- Загрузка статистики ----
async function loadStats() {
  const data = await fetch('/api/ozon/bulk-stocks/stats').then(r => r.json());
  if (data.error) { console.error(data.error); return; }

  $('cnt-unmatched').textContent = data.counts.unmatched_zero;
  $('cnt-update').textContent    = data.counts.to_update;
  $('cnt-actual').textContent    = data.counts.actual;

  _nextRunAt = data.nextRunAt;
  _autoEnabled = !!data.auto;
  $('auto-stock').checked = _autoEnabled;

  updateTimer();
  renderLog(data.lastRuns ?? []);
}

// ---- Лог ----
function renderLog(rows) {
  const tbody = $('log-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:#888">Нет данных за последние 2 часа</td></tr>';
    return;
  }
  const byMinute = new Map();
  for (const r of rows) {
    const key = r.sent_at.slice(0, 16);
    if (!byMinute.has(key)) byMinute.set(key, { sent_at: r.sent_at, sent: 0, errors: 0 });
    const entry = byMinute.get(key);
    if (r.status === 'sent') entry.sent += r.cnt;
    else entry.errors += r.cnt;
  }
  tbody.innerHTML = [...byMinute.values()].map(e => `
    <tr>
      <td>${new Date(e.sent_at).toLocaleString('ru-RU')}</td>
      <td>
        ${e.sent   ? `<span class="log-sent">✓ ${e.sent}</span>` : ''}
        ${e.errors ? `<span class="log-error"> ✗ ${e.errors}</span>` : ''}
      </td>
      <td>${e.sent + e.errors}</td>
    </tr>
  `).join('');
}

// ---- Автоотправка — переключение ----
async function setAuto(enabled) {
  await fetch('/api/ozon/bulk-stocks/auto', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  _autoEnabled = enabled;
  updateTimer();
}

$('auto-stock').addEventListener('change', (e) => setAuto(e.target.checked));

// ---- Ручная отправка ----
async function sendStocks() {
  const btn = $('send-stock');
  const res = $('res-stock');
  btn.disabled = true;
  btn.textContent = 'Отправка…';
  res.textContent = '';
  res.className = 'send-result';
  try {
    const data = await fetch('/api/ozon/bulk-stocks/execute', { method: 'POST' }).then(r => r.json());

    if (data.error) {
      res.textContent = '✗ ' + data.error;
      res.classList.add('err');
    } else {
      res.textContent = `✓ Отправлено: ${data.sent}${data.errors ? `  ✗ Ошибок: ${data.errors}` : ''}`;
      res.classList.add('ok');
      await loadStats();
    }
  } catch (e) {
    res.textContent = '✗ ' + e.message;
    res.classList.add('err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Отправить сейчас';
  }
}

$('send-stock').addEventListener('click', sendStocks);

// ---- Авто-обновление каждые 30 секунд ----
loadStats();
setInterval(loadStats, 30_000);
