const $ = (sel) => document.querySelector(sel);

async function loadCategories() {
  const r = await fetch('/api/categories');
  const cats = await r.json();
  const sel = document.querySelector('#categoryForm select');
  sel.innerHTML = '<option value="">— выбери категорию —</option>' +
    cats.map(c => `<option value="${c.category_id}">${(c.category_name ?? '—')} (${c.cnt})</option>`).join('');
}

async function loadRules() {
  const r = await fetch('/api/markup-rules');
  const rules = await r.json();

  const global = rules.find(x => x.scope === 'global');
  if (global) {
    const f = document.forms['globalForm'];
    f.margin_percent.value = global.margin_percent;
    f.min_margin_amount.value = global.min_margin_amount ?? '';
  }

  const tbody = document.querySelector('#rulesTable tbody');
  tbody.innerHTML = rules.map(r => `
    <tr>
      <td>${r.scope === 'global' ? '<b>Глобальное</b>' : 'Категория'}</td>
      <td>${r.scope === 'global' ? '—' : (r.category_name ?? r.ym_category_id ?? '—')}</td>
      <td>${r.margin_percent}</td>
      <td>${r.min_margin_amount ?? ''}</td>
      <td>${r.active ? 'да' : 'нет'}</td>
      <td>${r.scope === 'category' ? `<button class="danger" data-del="${r.id}">Удалить</button>` : ''}</td>
    </tr>
  `).join('');
  tbody.querySelectorAll('button[data-del]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm('Удалить правило?')) return;
      const r = await fetch(`/api/markup-rules/${b.dataset.del}`, { method: 'DELETE' });
      if (!r.ok) alert((await r.json()).error);
      loadRules();
    });
  });
}

document.forms['globalForm'].addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    scope: 'global',
    margin_percent: Number(f.margin_percent.value),
    min_margin_amount: f.min_margin_amount.value ? Number(f.min_margin_amount.value) : null,
    active: true,
  };
  const r = await fetch('/api/markup-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  $('#globalStatus').innerHTML = r.ok ? '<span class="ok">сохранено</span>' : `<span class="err">${(await r.json()).error}</span>`;
  loadRules();
});

document.forms['categoryForm'].addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (!f.ym_category_id.value) { $('#categoryStatus').innerHTML = '<span class="err">выбери категорию</span>'; return; }
  const body = {
    scope: 'category',
    ym_category_id: Number(f.ym_category_id.value),
    margin_percent: Number(f.margin_percent.value),
    min_margin_amount: f.min_margin_amount.value ? Number(f.min_margin_amount.value) : null,
    active: true,
  };
  const r = await fetch('/api/markup-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  $('#categoryStatus').innerHTML = r.ok ? '<span class="ok">сохранено</span>' : `<span class="err">${(await r.json()).error}</span>`;
  loadRules();
});

loadCategories();
loadRules();
