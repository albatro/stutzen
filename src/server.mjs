import express from 'express';
import cron from 'node-cron';
import { db } from './db.mjs';
import { runSync } from './ym/sync.mjs';
import { runSupplierImport } from './supplier/import.mjs';
import { runSalesImport } from './sales/import.mjs';
import { ym } from './ym/client.mjs';
import { calcTargetPrice } from './pricing/calculator.mjs';

const app = express();
app.use(express.json());
app.use(express.static('public'));

let syncInProgress = false;
let supplierImportInProgress = false;
let salesImportInProgress = false;
let pricesSendInProgress = false;

// ---- Я.Маркет таблица ----
app.get('/api/offers', (req, res) => {
  const search = (req.query.search ?? '').toString().trim();
  const category = req.query.category ? Number(req.query.category) : null;
  const sort = (req.query.sort ?? 'offer_id').toString();
  const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const sortMap = {
    offer_id: 'o.offer_id',
    name: 'o.name',
    category_name: 'o.category_name',
    price: 'p.value',
    stock_total: 'COALESCE(s.stock_total, 0)',
    commission_amount: 'c.total_amount',
    fee_amount: 'c.fee_amount',
    fee_percent: 'c.fee_percent',
    agency_amount: 'c.agency_amount',
    payment_amount: 'c.payment_amount',
    delivery_amount: 'c.delivery_amount',
    middle_mile_amount: 'c.middle_mile_amount',
    payout: '(p.value - c.total_amount)',
    purchase_price: 'sp.purchase_price',
    updated_at: 'o.updated_at',
  };
  const sortExpr = sortMap[sort] ?? sortMap.offer_id;

  const where = [];
  const params = [];
  if (search) {
    where.push(`(o.offer_id LIKE ? OR o.name LIKE ? OR o.market_sku LIKE ?)`);
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  if (category) { where.push(`o.category_id = ?`); params.push(category); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const baseQuery = `
    FROM offers o
    LEFT JOIN prices p ON p.offer_id = o.offer_id
    LEFT JOIN commissions c ON c.offer_id = o.offer_id
    LEFT JOIN supplier_offers sp ON sp.offer_id = o.offer_id
    LEFT JOIN (
      SELECT offer_id, SUM(CASE WHEN type = 'AVAILABLE' THEN count ELSE 0 END) AS stock_total
      FROM stocks GROUP BY offer_id
    ) s ON s.offer_id = o.offer_id
    ${whereSql}
  `;
  const total = db.prepare(`SELECT COUNT(*) AS c ${baseQuery}`).get(...params).c;

  const rows = db.prepare(`
    SELECT
      o.offer_id, o.name, o.market_sku, o.category_id, o.category_name, o.image_url,
      p.value AS price, p.currency,
      sp.purchase_price,
      COALESCE(s.stock_total, 0) AS stock_total,
      c.fee_amount, c.fee_percent, c.agency_amount, c.payment_amount,
      c.delivery_amount, c.middle_mile_amount,
      c.total_amount AS commission_amount,
      CASE WHEN p.value IS NOT NULL AND c.total_amount IS NOT NULL
           THEN ROUND(p.value - c.total_amount, 2) END AS payout,
      o.updated_at AS updated_at
    ${baseQuery}
    ORDER BY ${sortExpr} ${dir}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ total, limit, offset, rows });
});

app.get('/api/categories', (req, res) => {
  const rows = db.prepare(`
    SELECT category_id, category_name, COUNT(*) AS cnt
    FROM offers
    WHERE category_id IS NOT NULL
    GROUP BY category_id, category_name
    ORDER BY cnt DESC
  `).all();
  res.json(rows);
});

app.get('/api/stats', (req, res) => {
  const stats = {
    offers: db.prepare('SELECT COUNT(*) AS c FROM offers').get().c,
    prices: db.prepare('SELECT COUNT(*) AS c FROM prices').get().c,
    stocks: db.prepare('SELECT COUNT(DISTINCT offer_id) AS c FROM stocks').get().c,
    commissions: db.prepare('SELECT COUNT(*) AS c FROM commissions').get().c,
  };
  const lastRun = db.prepare(`SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1`).get();
  res.json({ stats, lastRun, syncInProgress });
});

app.post('/api/sync', async (req, res) => {
  if (syncInProgress) return res.status(409).json({ error: 'Синхронизация уже идёт' });
  syncInProgress = true;
  res.json({ ok: true, message: 'Синхронизация запущена в фоне' });
  try { await runSync(); }
  catch (e) { console.error('sync failed:', e); }
  finally { syncInProgress = false; }
});

// ---- Поставщик ----
app.get('/api/supplier/offers', (req, res) => {
  const search = (req.query.search ?? '').toString().trim();
  const category = req.query.category ? Number(req.query.category) : null;
  const onlyAvailable = req.query.available === '1';
  const margin = (req.query.margin ?? '').toString();
  const sort = (req.query.sort ?? 'offer_id').toString();
  const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const marginExpr = '(p.value - c.total_amount - s.purchase_price)';
  const marginPctExpr = `CASE WHEN s.purchase_price > 0 THEN ${marginExpr} * 100.0 / s.purchase_price END`;

  const sortMap = {
    offer_id: 's.offer_id', name: 's.name', vendor: 's.vendor', vendor_code: 's.vendor_code',
    price: 's.price', purchase_price: 's.purchase_price', count: 's.count',
    weight: 's.weight', country: 's.country', updated_at: 's.updated_at',
    category_name: 'cat.name', in_ym: 'in_ym',
    ym_price: 'p.value', margin: marginExpr, margin_percent: marginPctExpr,
  };
  const sortExpr = sortMap[sort] ?? sortMap.offer_id;

  const where = [];
  const params = [];
  if (search) {
    where.push('(s.offer_id LIKE ? OR s.name LIKE ? OR s.vendor_code LIKE ? OR s.vendor LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  if (category) { where.push('s.supplier_category_id = ?'); params.push(category); }
  if (onlyAvailable) where.push('s.available = 1');
  const marginHasData = `${marginExpr} IS NOT NULL AND s.purchase_price > 0`;
  if (margin === 'negative') where.push(`${marginHasData} AND ${marginExpr} < 0`);
  else if (margin === 'lt10') where.push(`${marginHasData} AND ${marginPctExpr} < 10`);
  else if (margin === 'lt20') where.push(`${marginHasData} AND ${marginPctExpr} < 20`);
  else if (margin === '20to50') where.push(`${marginHasData} AND ${marginPctExpr} >= 20 AND ${marginPctExpr} <= 50`);
  else if (margin === 'gt50') where.push(`${marginHasData} AND ${marginPctExpr} > 50`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const baseQuery = `
    FROM supplier_offers s
    LEFT JOIN supplier_categories cat ON cat.id = s.supplier_category_id
    LEFT JOIN offers o ON o.offer_id = s.offer_id
    LEFT JOIN prices p ON p.offer_id = s.offer_id
    LEFT JOIN commissions c ON c.offer_id = s.offer_id
    ${whereSql}
  `;
  const total = db.prepare(`SELECT COUNT(*) AS c ${baseQuery}`).get(...params).c;

  const rows = db.prepare(`
    SELECT
      s.offer_id, s.name, s.vendor, s.vendor_code, s.picture, s.url,
      s.price, s.purchase_price, s.min_for_bestseller, s.currency,
      s.count, s.weight, s.country, s.dimensions, s.available,
      s.supplier_category_id, cat.name AS category_name,
      s.updated_at,
      CASE WHEN o.offer_id IS NOT NULL THEN 1 ELSE 0 END AS in_ym,
      p.value AS ym_price,
      c.total_amount AS ym_expenses,
      ROUND(${marginExpr}, 2) AS margin,
      ROUND(${marginPctExpr}, 1) AS margin_percent
    ${baseQuery}
    ORDER BY ${sortExpr} ${dir}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({ total, limit, offset, rows });
});

app.get('/api/supplier/categories', (req, res) => {
  const rows = db.prepare(`
    SELECT cat.id AS category_id, cat.name AS category_name, COUNT(s.offer_id) AS cnt
    FROM supplier_categories cat
    LEFT JOIN supplier_offers s ON s.supplier_category_id = cat.id
    GROUP BY cat.id, cat.name HAVING cnt > 0 ORDER BY cnt DESC
  `).all();
  res.json(rows);
});

app.get('/api/supplier/offers/:offerId', (req, res) => {
  const id = req.params.offerId;
  const offer = db.prepare(`
    SELECT s.*, cat.name AS category_name
    FROM supplier_offers s
    LEFT JOIN supplier_categories cat ON cat.id = s.supplier_category_id
    WHERE s.offer_id = ?
  `).get(id);
  if (!offer) return res.status(404).json({ error: 'not found' });
  const ym = db.prepare(`
    SELECT o.*, p.value AS ym_price, p.currency AS ym_currency,
           c.total_amount AS commission_amount, c.fee_amount, c.fee_percent,
           c.delivery_amount, c.middle_mile_amount
    FROM offers o
    LEFT JOIN prices p ON p.offer_id = o.offer_id
    LEFT JOIN commissions c ON c.offer_id = o.offer_id
    WHERE o.offer_id = ?
  `).get(id);
  res.json({ offer, ym });
});

app.get('/api/supplier/stats', (req, res) => {
  const stats = {
    offers: db.prepare('SELECT COUNT(*) AS c FROM supplier_offers').get().c,
    available: db.prepare('SELECT COUNT(*) AS c FROM supplier_offers WHERE available = 1').get().c,
    matched_in_ym: db.prepare(`SELECT COUNT(*) AS c FROM supplier_offers s INNER JOIN offers o ON o.offer_id = s.offer_id`).get().c,
    categories: db.prepare('SELECT COUNT(*) AS c FROM supplier_categories').get().c,
  };
  const lastImport = db.prepare('SELECT * FROM supplier_imports ORDER BY id DESC LIMIT 1').get();
  res.json({ stats, lastImport, supplierImportInProgress });
});

app.post('/api/supplier/import', async (req, res) => {
  if (supplierImportInProgress) return res.status(409).json({ error: 'Импорт уже идёт' });
  supplierImportInProgress = true;
  res.json({ ok: true, message: 'Импорт запущен' });
  try { await runSupplierImport(); }
  catch (e) { console.error('supplier import failed:', e); }
  finally { supplierImportInProgress = false; }
});

// ---- Правила наценки ----
app.get('/api/markup-rules', (req, res) => {
  const rules = db.prepare(`
    SELECT r.*, o_cat.name AS category_name
    FROM markup_rules r
    LEFT JOIN (SELECT DISTINCT category_id, category_name AS name FROM offers WHERE category_id IS NOT NULL) o_cat
      ON o_cat.category_id = r.ym_category_id
    ORDER BY r.scope ASC, r.ym_category_id ASC
  `).all();
  res.json(rules);
});

app.post('/api/markup-rules', (req, res) => {
  const { scope, ym_category_id, margin_percent, min_margin_amount, active } = req.body ?? {};
  if (scope !== 'global' && scope !== 'category') return res.status(400).json({ error: 'scope must be global|category' });
  if (scope === 'category' && !ym_category_id) return res.status(400).json({ error: 'ym_category_id required' });
  if (typeof margin_percent !== 'number') return res.status(400).json({ error: 'margin_percent must be number' });
  try {
    const now = new Date().toISOString();
    const marginN = Number(margin_percent);
    const minMarginN = min_margin_amount == null ? null : Number(min_margin_amount);
    const activeN = active ? 1 : 0;
    if (scope === 'global') {
      // Глобальная строка гарантированно есть (создаётся на старте). SQLite считает
      // NULL-ы в UNIQUE различными, поэтому ON CONFLICT здесь не срабатывает —
      // делаем явный UPDATE, чтобы не плодить дубликаты.
      db.prepare(`
        UPDATE markup_rules
           SET margin_percent = ?, min_margin_amount = ?, active = ?, updated_at = ?
         WHERE scope = 'global'
      `).run(marginN, minMarginN, activeN, now);
    } else {
      db.prepare(`
        INSERT INTO markup_rules (scope, ym_category_id, margin_percent, min_margin_amount, active, updated_at)
        VALUES ('category', ?, ?, ?, ?, ?)
        ON CONFLICT(scope, ym_category_id) DO UPDATE SET
          margin_percent = excluded.margin_percent,
          min_margin_amount = excluded.min_margin_amount,
          active = excluded.active, updated_at = excluded.updated_at
      `).run(Number(ym_category_id), marginN, minMarginN, activeN, now);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/markup-rules/:id', (req, res) => {
  const row = db.prepare(`SELECT scope FROM markup_rules WHERE id = ?`).get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.scope === 'global') return res.status(400).json({ error: 'нельзя удалить глобальное правило' });
  db.prepare(`DELETE FROM markup_rules WHERE id = ?`).run(Number(req.params.id));
  res.json({ ok: true });
});

// ---- Price proposals ----
function loadRulesByCategory() {
  const rules = db.prepare(`SELECT * FROM markup_rules WHERE active = 1`).all();
  const global = rules.find(r => r.scope === 'global');
  const byCat = new Map();
  for (const r of rules) if (r.scope === 'category') byCat.set(r.ym_category_id, r);
  return { global, byCat };
}

function rowsWithProposals({ where = '', whereParams = [] } = {}) {
  const { global, byCat } = loadRulesByCategory();
  const rows = db.prepare(`
    SELECT
      o.offer_id, o.name, o.market_sku, o.category_id, o.category_name, o.image_url,
      p.value AS ym_price,
      c.fee_percent, c.middle_mile_amount, c.total_amount AS current_costs,
      s.purchase_price, s.price AS supplier_price, s.min_for_bestseller AS supplier_min
    FROM offers o
    INNER JOIN supplier_offers s ON s.offer_id = o.offer_id
    LEFT JOIN prices p ON p.offer_id = o.offer_id
    LEFT JOIN commissions c ON c.offer_id = o.offer_id
    WHERE s.purchase_price > 0 AND c.fee_percent IS NOT NULL ${where ? `AND ${where}` : ''}
  `).all(...whereParams);

  const result = [];
  for (const r of rows) {
    const rule = byCat.get(r.category_id) ?? global;
    if (!rule) continue;
    const calc = calcTargetPrice({
      purchase_price: r.purchase_price, fee_percent: r.fee_percent,
      middle_mile_amount: r.middle_mile_amount,
      margin_percent: rule.margin_percent, min_margin_amount: rule.min_margin_amount,
    });
    if (!calc) continue;
    const newPrice = calc.price;
    const oldPrice = r.ym_price;
    const delta = oldPrice == null ? null : newPrice - oldPrice;
    const deltaPct = (oldPrice != null && oldPrice > 0) ? (delta / oldPrice * 100) : null;
    result.push({
      offer_id: r.offer_id, name: r.name, category_name: r.category_name, image_url: r.image_url,
      purchase_price: r.purchase_price, supplier_price: r.supplier_price, supplier_min: r.supplier_min,
      ym_price: oldPrice, new_price: newPrice, delta,
      delta_percent: deltaPct == null ? null : Math.round(deltaPct * 10) / 10,
      expected_margin: calc.expected_margin, expected_margin_percent: calc.expected_margin_percent,
      rule_scope: rule.scope, rule_margin_percent: rule.margin_percent,
      below_purchase: newPrice < r.purchase_price ? 1 : 0,
    });
  }
  return result;
}

app.get('/api/price-proposals', (req, res) => {
  const search = (req.query.search ?? '').toString().trim();
  const direction = (req.query.direction ?? '').toString();
  const minDeltaPct = req.query.minDeltaPct ? Number(req.query.minDeltaPct) : null;
  const sort = (req.query.sort ?? 'delta_percent').toString();
  const dir = req.query.dir === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 2000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const allRows = rowsWithProposals();
  let filtered = allRows;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r => (r.offer_id ?? '').toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q));
  }
  if (direction === 'up') filtered = filtered.filter(r => r.delta != null && r.delta > 0);
  if (direction === 'down') filtered = filtered.filter(r => r.delta != null && r.delta < 0);
  if (minDeltaPct != null) filtered = filtered.filter(r => r.delta_percent != null && Math.abs(r.delta_percent) >= minDeltaPct);

  filtered.sort((a, b) => {
    const av = a[sort], bv = b[sort];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir === 'asc' ? (av > bv ? 1 : av < bv ? -1 : 0) : (av < bv ? 1 : av > bv ? -1 : 0);
  });

  res.json({
    total: filtered.length,
    summary: {
      eligible_total: allRows.length,
      will_increase: allRows.filter(r => r.delta > 0).length,
      will_decrease: allRows.filter(r => r.delta < 0).length,
      no_change: allRows.filter(r => r.delta === 0).length,
      below_purchase: allRows.filter(r => r.below_purchase).length,
    },
    rows: filtered.slice(offset, offset + limit),
  });
});

app.post('/api/ym/update-prices', async (req, res) => {
  if (pricesSendInProgress) return res.status(409).json({ error: 'Отправка уже идёт' });
  const offerIds = Array.isArray(req.body?.offerIds) ? req.body.offerIds : null;
  const confirmBigChanges = req.body?.confirmBigChanges === true;
  if (!offerIds || offerIds.length === 0) return res.status(400).json({ error: 'offerIds required' });
  pricesSendInProgress = true;
  try {
    const placeholders = offerIds.map(() => '?').join(',');
    const all = rowsWithProposals({ where: `o.offer_id IN (${placeholders})`, whereParams: offerIds });
    const byId = new Map(all.map(r => [r.offer_id, r]));
    const toSend = [];
    const skipped = [];
    const now = new Date().toISOString();
    for (const id of offerIds) {
      const p = byId.get(id);
      if (!p) { skipped.push({ offer_id: id, reason: 'no proposal' }); continue; }
      if (p.below_purchase) {
        skipped.push({ offer_id: id, reason: 'новая цена ниже закупочной' });
        db.prepare(`INSERT INTO price_updates (offer_id, old_price, new_price, status, error, sent_at) VALUES (?, ?, ?, 'skipped', ?, ?)`)
          .run(id, p.ym_price ?? null, p.new_price, 'ниже закупочной', now);
        continue;
      }
      if (!confirmBigChanges && p.delta_percent != null && Math.abs(p.delta_percent) > 30) {
        skipped.push({ offer_id: id, reason: 'изменение > 30%', delta_percent: p.delta_percent });
        continue;
      }
      toSend.push(p);
    }
    let sent = 0, failed = 0;
    const errors = [];
    const BATCH = 500;
    for (let i = 0; i < toSend.length; i += BATCH) {
      const batch = toSend.slice(i, i + BATCH);
      try {
        await ym.updatePrices(batch.map(p => ({ offerId: p.offer_id, price: p.new_price })));
        const ts = new Date().toISOString();
        const insert = db.prepare(`INSERT INTO price_updates (offer_id, old_price, new_price, status, error, sent_at) VALUES (?, ?, ?, 'sent', NULL, ?)`);
        db.exec('BEGIN');
        for (const p of batch) insert.run(p.offer_id, p.ym_price ?? null, p.new_price, ts);
        db.exec('COMMIT');
        sent += batch.length;
      } catch (e) {
        failed += batch.length;
        errors.push(e.message);
        const ts = new Date().toISOString();
        const insert = db.prepare(`INSERT INTO price_updates (offer_id, old_price, new_price, status, error, sent_at) VALUES (?, ?, ?, 'failed', ?, ?)`);
        db.exec('BEGIN');
        for (const p of batch) insert.run(p.offer_id, p.ym_price ?? null, p.new_price, e.message, ts);
        db.exec('COMMIT');
      }
    }
    res.json({ ok: true, sent, failed, skipped, errors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    pricesSendInProgress = false;
  }
});

app.get('/api/price-updates', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 2000);
  const rows = db.prepare(`SELECT * FROM price_updates ORDER BY id DESC LIMIT ?`).all(limit);
  res.json({ rows });
});

// ---- Продажи ----
app.post('/api/sales/import', async (req, res) => {
  if (salesImportInProgress) return res.status(409).json({ error: 'Импорт уже идёт' });
  const { dateFrom, dateTo } = req.body ?? {};
  salesImportInProgress = true;
  res.json({ ok: true, message: 'Импорт запущен' });
  try { await runSalesImport({ dateFrom, dateTo }); }
  catch (e) { console.error('sales import failed:', e); }
  finally { salesImportInProgress = false; }
});

app.get('/api/sales/summary', (req, res) => {
  const dateFrom = (req.query.dateFrom ?? '').toString() || null;
  const dateTo = (req.query.dateTo ?? '').toString() || null;
  const onlyCompleted = req.query.includeCancelled !== '1';
  const onlyWithPurchase = req.query.onlyWithPurchase === '1';
  const where = [];
  const params = [];
  if (dateFrom) { where.push('so.creation_date >= ?'); params.push(dateFrom); }
  if (dateTo)   { where.push('so.creation_date <= ?'); params.push(dateTo); }
  if (onlyCompleted) where.push("so.status IN ('DELIVERED','PARTIALLY_DELIVERED','PICKUP','DELIVERY','PROCESSING')");
  if (onlyWithPurchase) where.push('s.purchase_price IS NOT NULL');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const t = db.prepare(`
    SELECT
      MIN(so.creation_date) AS first_date, MAX(so.creation_date) AS last_date,
      COUNT(DISTINCT so.order_id) AS orders, COUNT(DISTINCT si.offer_id) AS skus,
      SUM(si.count) AS units,
      SUM(COALESCE(si.buyer_total,0) + COALESCE(si.marketplace_total,0)) AS gross_revenue,
      SUM(si.buyer_total) AS buyer_paid, SUM(si.marketplace_total) AS ym_subsidy,
      SUM(si.count * COALESCE(c.total_amount, 0)) AS commissions,
      SUM(si.count * COALESCE(s.purchase_price, 0)) AS purchase_total,
      SUM(CASE WHEN s.purchase_price IS NOT NULL THEN si.count ELSE 0 END) AS units_with_purchase,
      SUM(CASE WHEN c.total_amount IS NOT NULL THEN si.count ELSE 0 END) AS units_with_commission
    FROM sales_items si
    JOIN sales_orders so ON so.order_id = si.order_id
    LEFT JOIN supplier_offers s ON s.offer_id = si.offer_id
    LEFT JOIN commissions c ON c.offer_id = si.offer_id
    ${whereSql}
  `).get(...params);

  const payout = (t.gross_revenue ?? 0) - (t.commissions ?? 0);
  const margin = payout - (t.purchase_total ?? 0);
  const marginPct = (t.purchase_total ?? 0) > 0 ? margin / t.purchase_total * 100 : null;
  const grossMarginPct = (t.gross_revenue ?? 0) > 0 ? margin / t.gross_revenue * 100 : null;

  const byMonth = db.prepare(`
    SELECT
      substr(so.creation_date, 1, 7) AS month,
      COUNT(DISTINCT so.order_id) AS orders, SUM(si.count) AS units,
      SUM(COALESCE(si.buyer_total,0) + COALESCE(si.marketplace_total,0)) AS gross_revenue,
      SUM(si.count * COALESCE(c.total_amount, 0)) AS commissions,
      SUM(si.count * COALESCE(s.purchase_price, 0)) AS purchase_total
    FROM sales_items si
    JOIN sales_orders so ON so.order_id = si.order_id
    LEFT JOIN supplier_offers s ON s.offer_id = si.offer_id
    LEFT JOIN commissions c ON c.offer_id = si.offer_id
    ${whereSql}
    GROUP BY month ORDER BY month
  `).all(...params).map(r => {
    const payout = (r.gross_revenue ?? 0) - (r.commissions ?? 0);
    const margin = payout - (r.purchase_total ?? 0);
    return {
      month: r.month, orders: r.orders, units: r.units,
      gross_revenue: round2(r.gross_revenue), commissions: round2(r.commissions),
      purchase_total: round2(r.purchase_total), payout: round2(payout), margin: round2(margin),
      margin_percent: (r.purchase_total ?? 0) > 0 ? Math.round(margin / r.purchase_total * 1000) / 10 : null,
    };
  });

  const dtParams = [dateFrom, dateTo].filter(Boolean);
  const byStatus = db.prepare(`
    SELECT so.status, COUNT(*) AS n FROM sales_orders so
    ${dateFrom || dateTo ? `WHERE ${[dateFrom && 'so.creation_date >= ?', dateTo && 'so.creation_date <= ?'].filter(Boolean).join(' AND ')}` : ''}
    GROUP BY so.status ORDER BY n DESC
  `).all(...dtParams);

  res.json({
    period: { from: t.first_date, to: t.last_date, only_completed: onlyCompleted, only_with_purchase: onlyWithPurchase },
    totals: {
      orders: t.orders, skus: t.skus, units: t.units,
      units_with_purchase: t.units_with_purchase, units_with_commission: t.units_with_commission,
      gross_revenue: round2(t.gross_revenue), buyer_paid: round2(t.buyer_paid),
      ym_subsidy: round2(t.ym_subsidy), commissions: round2(t.commissions),
      payout: round2(payout), purchase_total: round2(t.purchase_total),
      margin: round2(margin),
      margin_percent_of_purchase: marginPct == null ? null : Math.round(marginPct * 10) / 10,
      margin_percent_of_gross: grossMarginPct == null ? null : Math.round(grossMarginPct * 10) / 10,
      avg_order_value: t.orders > 0 ? round2(t.gross_revenue / t.orders) : null,
      avg_unit_price: t.units > 0 ? round2(t.gross_revenue / t.units) : null,
    },
    by_month: byMonth,
    by_status: byStatus,
  });
});

app.get('/api/sales/stats', (req, res) => {
  const orders = db.prepare('SELECT COUNT(*) AS c FROM sales_orders').get().c;
  const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM sales_orders GROUP BY status ORDER BY n DESC').all();
  const range = db.prepare('SELECT MIN(creation_date) AS first, MAX(creation_date) AS last FROM sales_orders').get();
  const lastImport = db.prepare('SELECT * FROM sales_imports ORDER BY id DESC LIMIT 1').get();
  res.json({ orders, byStatus, range, lastImport, salesImportInProgress });
});

app.get('/api/sales/report', (req, res) => {
  const dateFrom = (req.query.dateFrom ?? '').toString() || null;
  const dateTo = (req.query.dateTo ?? '').toString() || null;
  const onlyCompleted = req.query.includeCancelled !== '1';
  const onlyWithPurchase = req.query.onlyWithPurchase === '1';
  const search = (req.query.search ?? '').toString().trim();
  const sort = (req.query.sort ?? 'units').toString();
  const dir = req.query.dir === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 5000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const where = [];
  const params = [];
  if (dateFrom) { where.push('so.creation_date >= ?'); params.push(dateFrom); }
  if (dateTo)   { where.push('so.creation_date <= ?'); params.push(dateTo); }
  if (onlyCompleted) where.push("so.status IN ('DELIVERED','PARTIALLY_DELIVERED','PICKUP','DELIVERY','PROCESSING')");
  if (onlyWithPurchase) where.push('s.purchase_price IS NOT NULL');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const allRows = db.prepare(`
    SELECT
      si.offer_id, MAX(si.offer_name) AS name, o.image_url, o.category_name,
      SUM(si.count) AS units,
      SUM(COALESCE(si.buyer_total,0) + COALESCE(si.marketplace_total,0)) AS gross_revenue,
      SUM(si.buyer_total) AS buyer_paid, SUM(si.marketplace_total) AS ym_subsidy,
      AVG(COALESCE(si.buyer_price, 0) + COALESCE(si.marketplace_price, 0)) AS avg_sale_price,
      COUNT(DISTINCT si.order_id) AS orders,
      s.purchase_price,
      c.fee_percent, c.fee_amount, c.middle_mile_amount, c.total_amount AS commission_per_unit
    FROM sales_items si
    JOIN sales_orders so ON so.order_id = si.order_id
    LEFT JOIN offers o ON o.offer_id = si.offer_id
    LEFT JOIN supplier_offers s ON s.offer_id = si.offer_id
    LEFT JOIN commissions c ON c.offer_id = si.offer_id
    ${whereSql}
    GROUP BY si.offer_id
  `).all(...params);

  for (const r of allRows) {
    r.units = Number(r.units) || 0;
    r.gross_revenue = round2(r.gross_revenue);
    r.buyer_paid = round2(r.buyer_paid);
    r.ym_subsidy = round2(r.ym_subsidy);
    r.avg_sale_price = round2(r.avg_sale_price);
    const costs = r.commission_per_unit != null ? r.commission_per_unit * r.units : null;
    r.estimated_commissions = costs == null ? null : round2(costs);
    const purchaseTotal = r.purchase_price != null ? r.purchase_price * r.units : null;
    r.purchase_total = purchaseTotal == null ? null : round2(purchaseTotal);
    const payout = r.gross_revenue != null && costs != null ? r.gross_revenue - costs : null;
    r.payout = payout == null ? null : round2(payout);
    const margin = payout != null && purchaseTotal != null ? payout - purchaseTotal : null;
    r.margin = margin == null ? null : round2(margin);
    r.margin_per_unit = margin == null || r.units === 0 ? null : round2(margin / r.units);
    r.margin_percent = (margin != null && purchaseTotal && purchaseTotal > 0) ? Math.round(margin / purchaseTotal * 1000) / 10 : null;
  }

  let filtered = allRows;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r => (r.offer_id ?? '').toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q));
  }
  const sortable = new Set(['units', 'orders', 'gross_revenue', 'buyer_paid', 'payout', 'margin', 'margin_percent', 'margin_per_unit', 'avg_sale_price', 'offer_id']);
  const key = sortable.has(sort) ? sort : 'units';
  filtered.sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir === 'asc' ? (av > bv ? 1 : av < bv ? -1 : 0) : (av < bv ? 1 : av > bv ? -1 : 0);
  });

  const summary = {
    skus: allRows.length,
    units: allRows.reduce((s, r) => s + (r.units ?? 0), 0),
    gross_revenue: round2(allRows.reduce((s, r) => s + (r.gross_revenue ?? 0), 0)),
    buyer_paid: round2(allRows.reduce((s, r) => s + (r.buyer_paid ?? 0), 0)),
    ym_subsidy: round2(allRows.reduce((s, r) => s + (r.ym_subsidy ?? 0), 0)),
    payout: round2(allRows.reduce((s, r) => s + (r.payout ?? 0), 0)),
    estimated_margin: round2(allRows.reduce((s, r) => s + (r.margin ?? 0), 0)),
    skus_with_margin: allRows.filter(r => r.margin != null).length,
    skus_negative_margin: allRows.filter(r => r.margin != null && r.margin < 0).length,
  };

  res.json({ total: filtered.length, summary, rows: filtered.slice(offset, offset + limit) });
});

function round2(x) { return x == null ? null : Math.round(x * 100) / 100; }

// ---- Отмены ----
const CANCELLED_STATUSES = ['CANCELLED_BEFORE_PROCESSING', 'CANCELLED_IN_PROCESSING', 'CANCELLED_IN_DELIVERY', 'RETURNED', 'UNPAID'];

app.get('/api/cancellations/summary', (req, res) => {
  const dateFrom = (req.query.dateFrom ?? '').toString() || null;
  const dateTo = (req.query.dateTo ?? '').toString() || null;
  const where = [];
  const params = [];
  if (dateFrom) { where.push('creation_date >= ?'); params.push(dateFrom); }
  if (dateTo)   { where.push('creation_date <= ?'); params.push(dateTo); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totals = db.prepare(`
    SELECT COUNT(*) AS total_orders,
           SUM(CASE WHEN status IN (${CANCELLED_STATUSES.map(s => `'${s}'`).join(',')}) THEN 1 ELSE 0 END) AS cancelled_orders,
           MIN(creation_date) AS first_date, MAX(creation_date) AS last_date
    FROM sales_orders ${whereSql}
  `).get(...params);

  const cancellationRate = totals.total_orders > 0
    ? Math.round(totals.cancelled_orders / totals.total_orders * 1000) / 10 : null;

  const byStatus = db.prepare(`
    SELECT status, COUNT(*) AS n
    FROM sales_orders ${whereSql ? whereSql + ' AND' : 'WHERE'} status IN (${CANCELLED_STATUSES.map(s => `'${s}'`).join(',')})
    GROUP BY status ORDER BY n DESC
  `).all(...params);

  const byMonth = db.prepare(`
    SELECT
      substr(creation_date, 1, 7) AS month,
      COUNT(*) AS total,
      SUM(CASE WHEN status IN (${CANCELLED_STATUSES.map(s => `'${s}'`).join(',')}) THEN 1 ELSE 0 END) AS cancelled
    FROM sales_orders ${whereSql}
    GROUP BY month ORDER BY month
  `).all(...params).map(r => ({
    ...r,
    rate_percent: r.total > 0 ? Math.round(r.cancelled / r.total * 1000) / 10 : null,
  }));

  // Сумма "потерянной выручки" — то, что могло быть начислено по отменённым заказам.
  const lostRevenue = db.prepare(`
    SELECT
      SUM(COALESCE(si.buyer_total,0) + COALESCE(si.marketplace_total,0)) AS gross,
      SUM(si.count) AS units,
      COUNT(DISTINCT si.order_id) AS orders
    FROM sales_items si
    JOIN sales_orders so ON so.order_id = si.order_id
    ${whereSql ? whereSql.replace(/creation_date/g, 'so.creation_date') + ' AND' : 'WHERE'}
      so.status IN (${CANCELLED_STATUSES.map(s => `'${s}'`).join(',')})
  `).get(...params);

  res.json({
    period: { from: totals.first_date, to: totals.last_date },
    totals: {
      total_orders: totals.total_orders,
      cancelled_orders: totals.cancelled_orders,
      cancellation_rate_percent: cancellationRate,
      lost_revenue: round2(lostRevenue.gross),
      lost_units: lostRevenue.units,
    },
    by_status: byStatus,
    by_month: byMonth,
  });
});

app.get('/api/cancellations/by-sku', (req, res) => {
  const dateFrom = (req.query.dateFrom ?? '').toString() || null;
  const dateTo = (req.query.dateTo ?? '').toString() || null;
  const search = (req.query.search ?? '').toString().trim();
  const sort = (req.query.sort ?? 'cancelled_units').toString();
  const dir = req.query.dir === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 5000);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const where = [];
  const params = [];
  if (dateFrom) { where.push('so.creation_date >= ?'); params.push(dateFrom); }
  if (dateTo)   { where.push('so.creation_date <= ?'); params.push(dateTo); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const cancelledClause = `so.status IN (${CANCELLED_STATUSES.map(s => `'${s}'`).join(',')})`;

  const allRows = db.prepare(`
    SELECT
      si.offer_id,
      MAX(si.offer_name) AS name,
      o.image_url,
      o.category_name,
      COUNT(DISTINCT si.order_id) AS total_orders,
      SUM(si.count) AS total_units,
      SUM(CASE WHEN ${cancelledClause} THEN 1 ELSE 0 END) AS cancelled_orders,
      SUM(CASE WHEN ${cancelledClause} THEN si.count ELSE 0 END) AS cancelled_units,
      SUM(CASE WHEN ${cancelledClause}
               THEN COALESCE(si.buyer_total,0) + COALESCE(si.marketplace_total,0)
               ELSE 0 END) AS cancelled_gross,
      SUM(CASE WHEN so.status = 'CANCELLED_BEFORE_PROCESSING' THEN 1 ELSE 0 END) AS c_before,
      SUM(CASE WHEN so.status = 'CANCELLED_IN_PROCESSING' THEN 1 ELSE 0 END) AS c_in_processing,
      SUM(CASE WHEN so.status = 'CANCELLED_IN_DELIVERY' THEN 1 ELSE 0 END) AS c_in_delivery,
      SUM(CASE WHEN so.status = 'RETURNED' THEN 1 ELSE 0 END) AS c_returned
    FROM sales_items si
    JOIN sales_orders so ON so.order_id = si.order_id
    LEFT JOIN offers o ON o.offer_id = si.offer_id
    ${whereSql}
    GROUP BY si.offer_id
    HAVING cancelled_units > 0
  `).all(...params);

  for (const r of allRows) {
    r.cancellation_rate_percent = r.total_units > 0
      ? Math.round(r.cancelled_units / r.total_units * 1000) / 10 : null;
    r.cancelled_gross = round2(r.cancelled_gross);
  }

  let filtered = allRows;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(r => (r.offer_id ?? '').toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q));
  }
  const sortable = new Set(['cancelled_units', 'cancelled_orders', 'cancelled_gross', 'total_units', 'cancellation_rate_percent', 'offer_id', 'name']);
  const key = sortable.has(sort) ? sort : 'cancelled_units';
  filtered.sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir === 'asc' ? (av > bv ? 1 : av < bv ? -1 : 0) : (av < bv ? 1 : av > bv ? -1 : 0);
  });

  res.json({ total: filtered.length, rows: filtered.slice(offset, offset + limit) });
});

app.get('/api/cancellations/report.csv', (req, res) => {
  const dateFrom = (req.query.dateFrom ?? '').toString() || null;
  const dateTo = (req.query.dateTo ?? '').toString() || null;
  const where = [];
  const params = [];
  if (dateFrom) { where.push('so.creation_date >= ?'); params.push(dateFrom); }
  if (dateTo)   { where.push('so.creation_date <= ?'); params.push(dateTo); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const cancelledClause = `so.status IN (${CANCELLED_STATUSES.map(s => `'${s}'`).join(',')})`;

  const rows = db.prepare(`
    SELECT
      si.offer_id, MAX(si.offer_name) AS name, o.category_name,
      SUM(si.count) AS total_units,
      SUM(CASE WHEN ${cancelledClause} THEN si.count ELSE 0 END) AS cancelled_units,
      SUM(CASE WHEN ${cancelledClause} THEN COALESCE(si.buyer_total,0) + COALESCE(si.marketplace_total,0) ELSE 0 END) AS cancelled_gross,
      SUM(CASE WHEN so.status = 'CANCELLED_BEFORE_PROCESSING' THEN 1 ELSE 0 END) AS c_before,
      SUM(CASE WHEN so.status = 'CANCELLED_IN_PROCESSING' THEN 1 ELSE 0 END) AS c_in_processing,
      SUM(CASE WHEN so.status = 'CANCELLED_IN_DELIVERY' THEN 1 ELSE 0 END) AS c_in_delivery,
      SUM(CASE WHEN so.status = 'RETURNED' THEN 1 ELSE 0 END) AS c_returned
    FROM sales_items si
    JOIN sales_orders so ON so.order_id = si.order_id
    LEFT JOIN offers o ON o.offer_id = si.offer_id
    ${whereSql}
    GROUP BY si.offer_id HAVING cancelled_units > 0
  `).all(...params);

  rows.sort((a, b) => (b.cancelled_units ?? 0) - (a.cancelled_units ?? 0));

  const fmt = (v) => v == null ? '' : (typeof v === 'number' ? String(v).replace('.', ',') : v);
  const escape = (v) => {
    let s = fmt(v);
    if (s.includes(';') || s.includes('"') || s.includes('\n')) s = '"' + s.replaceAll('"', '""') + '"';
    return s;
  };
  const lines = ['SKU;Название;Категория;Всего штук;Отменено штук;Отмена,%;Потерянная выручка;До обработки;В обработке;В доставке;Возвраты'];
  for (const r of rows) {
    const rate = r.total_units > 0 ? Math.round(r.cancelled_units / r.total_units * 1000) / 10 : null;
    lines.push([
      escape(r.offer_id), escape(r.name), escape(r.category_name),
      r.total_units, r.cancelled_units, fmt(rate),
      fmt(round2(r.cancelled_gross)),
      r.c_before, r.c_in_processing, r.c_in_delivery, r.c_returned,
    ].join(';'));
  }
  const ts = new Date().toISOString().replace(/[T:]/g, '-').slice(0, 16);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="cancellations-${ts}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

// ---- Экспорт CSV ----
app.get('/api/sales/report.csv', (req, res) => {
  const dateFrom = (req.query.dateFrom ?? '').toString() || null;
  const dateTo = (req.query.dateTo ?? '').toString() || null;
  const onlyCompleted = req.query.includeCancelled !== '1';
  const onlyWithPurchase = req.query.onlyWithPurchase === '1';
  const search = (req.query.search ?? '').toString().trim();
  const where = [];
  const params = [];
  if (dateFrom) { where.push('so.creation_date >= ?'); params.push(dateFrom); }
  if (dateTo)   { where.push('so.creation_date <= ?'); params.push(dateTo); }
  if (onlyCompleted) where.push("so.status IN ('DELIVERED','PARTIALLY_DELIVERED','PICKUP','DELIVERY','PROCESSING')");
  if (onlyWithPurchase) where.push('s.purchase_price IS NOT NULL');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const allRows = db.prepare(`
    SELECT
      si.offer_id, MAX(si.offer_name) AS name, o.category_name,
      SUM(si.count) AS units,
      SUM(COALESCE(si.buyer_total,0) + COALESCE(si.marketplace_total,0)) AS gross_revenue,
      SUM(si.buyer_total) AS buyer_paid, SUM(si.marketplace_total) AS ym_subsidy,
      AVG(COALESCE(si.buyer_price, 0) + COALESCE(si.marketplace_price, 0)) AS avg_sale_price,
      COUNT(DISTINCT si.order_id) AS orders,
      s.purchase_price, c.fee_percent, c.total_amount AS commission_per_unit
    FROM sales_items si
    JOIN sales_orders so ON so.order_id = si.order_id
    LEFT JOIN offers o ON o.offer_id = si.offer_id
    LEFT JOIN supplier_offers s ON s.offer_id = si.offer_id
    LEFT JOIN commissions c ON c.offer_id = si.offer_id
    ${whereSql}
    GROUP BY si.offer_id
  `).all(...params);

  let rows = allRows.map(r => {
    const units = Number(r.units) || 0;
    const costs = r.commission_per_unit != null ? r.commission_per_unit * units : null;
    const purchaseTotal = r.purchase_price != null ? r.purchase_price * units : null;
    const payout = r.gross_revenue != null && costs != null ? r.gross_revenue - costs : null;
    const margin = payout != null && purchaseTotal != null ? payout - purchaseTotal : null;
    return {
      offer_id: r.offer_id, name: r.name, category_name: r.category_name,
      orders: r.orders, units, avg_sale_price: round2(r.avg_sale_price),
      gross_revenue: round2(r.gross_revenue), buyer_paid: round2(r.buyer_paid), ym_subsidy: round2(r.ym_subsidy),
      fee_percent: r.fee_percent, commissions: round2(costs), payout: round2(payout),
      purchase_price: r.purchase_price, purchase_total: round2(purchaseTotal),
      margin: round2(margin),
      margin_percent: (margin != null && purchaseTotal && purchaseTotal > 0) ? Math.round(margin / purchaseTotal * 1000) / 10 : null,
      margin_per_unit: margin != null && units > 0 ? round2(margin / units) : null,
    };
  });
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(r => (r.offer_id ?? '').toLowerCase().includes(q) || (r.name ?? '').toLowerCase().includes(q));
  }
  rows.sort((a, b) => (b.units ?? 0) - (a.units ?? 0));

  const headers = [
    ['offer_id', 'SKU'], ['name', 'Название'], ['category_name', 'Категория'],
    ['orders', 'Заказов'], ['units', 'Штук'], ['avg_sale_price', 'Ср. цена продажи'],
    ['gross_revenue', 'Выручка валовая'], ['buyer_paid', 'Покупатель заплатил'], ['ym_subsidy', 'Субсидия ЯМ'],
    ['fee_percent', 'Комиссия за продажу %'], ['commissions', 'Комиссии ЯМ всего'], ['payout', 'К перечислению'],
    ['purchase_price', 'Закупочная за ед.'], ['purchase_total', 'Закуп всего'],
    ['margin', 'Маржа'], ['margin_percent', 'Маржа %'], ['margin_per_unit', 'Маржа на ед.'],
  ];
  const escape = (v) => {
    if (v == null) return '';
    let s = String(v);
    if (typeof v === 'number') s = s.replace('.', ',');
    if (s.includes(';') || s.includes('"') || s.includes('\n') || s.includes('\r')) s = '"' + s.replaceAll('"', '""') + '"';
    return s;
  };
  const lines = [headers.map(h => escape(h[1])).join(';')];
  for (const r of rows) lines.push(headers.map(h => escape(r[h[0]])).join(';'));

  const ts = new Date().toISOString().replace(/[T:]/g, '-').slice(0, 16);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sales-${dateFrom ?? 'all'}-${dateTo ?? 'all'}-${ts}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

app.get('/api/sales/monthly.csv', (req, res) => {
  const dateFrom = (req.query.dateFrom ?? '').toString() || null;
  const dateTo = (req.query.dateTo ?? '').toString() || null;
  const onlyCompleted = req.query.includeCancelled !== '1';
  const onlyWithPurchase = req.query.onlyWithPurchase === '1';
  const where = [];
  const params = [];
  if (dateFrom) { where.push('so.creation_date >= ?'); params.push(dateFrom); }
  if (dateTo)   { where.push('so.creation_date <= ?'); params.push(dateTo); }
  if (onlyCompleted) where.push("so.status IN ('DELIVERED','PARTIALLY_DELIVERED','PICKUP','DELIVERY','PROCESSING')");
  if (onlyWithPurchase) where.push('s.purchase_price IS NOT NULL');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT
      substr(so.creation_date, 1, 7) AS month,
      COUNT(DISTINCT so.order_id) AS orders, SUM(si.count) AS units,
      SUM(COALESCE(si.buyer_total,0) + COALESCE(si.marketplace_total,0)) AS gross_revenue,
      SUM(si.count * COALESCE(c.total_amount, 0)) AS commissions,
      SUM(si.count * COALESCE(s.purchase_price, 0)) AS purchase_total
    FROM sales_items si
    JOIN sales_orders so ON so.order_id = si.order_id
    LEFT JOIN supplier_offers s ON s.offer_id = si.offer_id
    LEFT JOIN commissions c ON c.offer_id = si.offer_id
    ${whereSql}
    GROUP BY month ORDER BY month
  `).all(...params);

  const fmt = (v) => v == null ? '' : (typeof v === 'number' ? String(v).replace('.', ',') : v);
  const lines = ['Месяц;Заказов;Штук;Выручка валовая;Комиссии;К перечислению;Закуп;Маржа;Маржа %'];
  for (const r of rows) {
    const payout = (r.gross_revenue ?? 0) - (r.commissions ?? 0);
    const margin = payout - (r.purchase_total ?? 0);
    const marginPct = (r.purchase_total ?? 0) > 0 ? Math.round(margin / r.purchase_total * 1000) / 10 : null;
    lines.push([r.month, r.orders, r.units, fmt(round2(r.gross_revenue)), fmt(round2(r.commissions)),
                fmt(round2(payout)), fmt(round2(r.purchase_total)), fmt(round2(margin)), fmt(marginPct)].join(';'));
  }
  const ts = new Date().toISOString().replace(/[T:]/g, '-').slice(0, 16);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sales-monthly-${ts}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

// ---- Cron ----
const SYNC_CRON = process.env.SYNC_CRON;
if (SYNC_CRON) {
  cron.schedule(SYNC_CRON, async () => {
    if (syncInProgress) return;
    syncInProgress = true;
    try { await runSync(); } catch (e) { console.error('cron sync failed:', e); }
    finally { syncInProgress = false; }
  });
  console.log(`Cron: ${SYNC_CRON}`);
}

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
