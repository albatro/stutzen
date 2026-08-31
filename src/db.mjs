import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = resolve('data/stutzen.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS offers (
    offer_id        TEXT PRIMARY KEY,
    name            TEXT,
    market_sku      TEXT,
    category_id     INTEGER,
    category_name   TEXT,
    image_url       TEXT,
    vendor          TEXT,
    barcode         TEXT,
    length          REAL,
    width           REAL,
    height          REAL,
    weight          REAL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prices (
    offer_id            TEXT PRIMARY KEY,
    value               REAL,
    min_for_bestseller  REAL,
    currency            TEXT,
    updated_at          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stocks (
    offer_id     TEXT NOT NULL,
    warehouse_id INTEGER NOT NULL,
    type         TEXT NOT NULL,
    count        INTEGER NOT NULL,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (offer_id, warehouse_id, type)
  );

  CREATE TABLE IF NOT EXISTS commissions (
    offer_id              TEXT PRIMARY KEY,
    fee_amount            REAL,
    agency_amount         REAL,
    payment_amount        REAL,
    logistics_amount      REAL,
    other_amount          REAL,
    total_amount          REAL,
    calculated_for_price  REAL,
    raw_json              TEXT,
    updated_at            TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_runs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at        TEXT NOT NULL,
    finished_at       TEXT,
    status            TEXT NOT NULL,
    offers_processed  INTEGER DEFAULT 0,
    prices_processed  INTEGER DEFAULT 0,
    stocks_processed  INTEGER DEFAULT 0,
    commissions_processed INTEGER DEFAULT 0,
    errors_count      INTEGER DEFAULT 0,
    error_message     TEXT,
    details           TEXT
  );

  CREATE TABLE IF NOT EXISTS purchase_prices (
    offer_id    TEXT PRIMARY KEY,
    value       REAL,
    source      TEXT,
    updated_at  TEXT NOT NULL
  );

  -- Миграция: добавляем logistics_amount, если БД создавалась раньше.
  -- node:sqlite не имеет PRAGMA user_version проверки тут — проще через try/catch ниже.

  CREATE INDEX IF NOT EXISTS idx_offers_name ON offers(name);
  CREATE INDEX IF NOT EXISTS idx_offers_category ON offers(category_id);
  CREATE INDEX IF NOT EXISTS idx_stocks_offer ON stocks(offer_id);
  CREATE INDEX IF NOT EXISTS idx_sync_runs_started ON sync_runs(started_at DESC);
`);

// Идемпотентные миграции: добавляем колонки, если их ещё нет.
try { db.exec('ALTER TABLE commissions ADD COLUMN logistics_amount REAL'); } catch {}
try { db.exec('ALTER TABLE commissions ADD COLUMN delivery_amount REAL'); } catch {}
try { db.exec('ALTER TABLE commissions ADD COLUMN middle_mile_amount REAL'); } catch {}
try { db.exec('ALTER TABLE commissions ADD COLUMN fee_percent REAL'); } catch {}
try { db.exec('ALTER TABLE supplier_imports ADD COLUMN file_size_bytes INTEGER'); } catch {}
try { db.exec('ALTER TABLE feed_generations ADD COLUMN file_size_bytes INTEGER'); } catch {}
try { db.exec('ALTER TABLE supplier_offers ADD COLUMN step_quantity INTEGER'); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS supplier_offers (
    offer_id             TEXT PRIMARY KEY,
    available            INTEGER,
    price                REAL,
    purchase_price       REAL,
    min_for_bestseller   REAL,
    currency             TEXT,
    supplier_category_id INTEGER,
    picture              TEXT,
    name                 TEXT,
    vendor               TEXT,
    vendor_code          TEXT,
    description          TEXT,
    url                  TEXT,
    sales_notes          TEXT,
    count                INTEGER,
    weight               REAL,
    country              TEXT,
    dimensions           TEXT,
    updated_at           TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_supplier_offers_vendor_code ON supplier_offers(vendor_code);
  CREATE INDEX IF NOT EXISTS idx_supplier_offers_vendor ON supplier_offers(vendor);
  CREATE INDEX IF NOT EXISTS idx_supplier_offers_category ON supplier_offers(supplier_category_id);

  CREATE TABLE IF NOT EXISTS supplier_categories (
    id        INTEGER PRIMARY KEY,
    parent_id INTEGER,
    name      TEXT
  );

  CREATE TABLE IF NOT EXISTS supplier_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    offers_processed INTEGER DEFAULT 0,
    categories_processed INTEGER DEFAULT 0,
    error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS feed_generations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    skipped_below_purchase INTEGER DEFAULT 0,
    skipped_no_rule INTEGER DEFAULT 0,
    duration_ms INTEGER,
    error_message TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_feed_generations_started ON feed_generations(started_at DESC);

  CREATE TABLE IF NOT EXISTS markup_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,             -- 'global' | 'category'
    ym_category_id INTEGER,          -- для scope='category' — id из offers.category_id
    margin_percent REAL NOT NULL,    -- целевая маржа в % от закупочной
    min_margin_amount REAL,          -- минимальная маржа в ₽ (если задана — превалирует)
    active INTEGER DEFAULT 1,
    updated_at TEXT NOT NULL,
    UNIQUE(scope, ym_category_id)
  );

  CREATE TABLE IF NOT EXISTS price_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    offer_id TEXT NOT NULL,
    old_price REAL,
    new_price REAL NOT NULL,
    status TEXT NOT NULL,            -- 'sent' | 'failed' | 'skipped'
    error TEXT,
    sent_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_price_updates_offer ON price_updates(offer_id);
  CREATE INDEX IF NOT EXISTS idx_price_updates_sent ON price_updates(sent_at DESC);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sales_orders (
    order_id INTEGER PRIMARY KEY,
    status TEXT,
    creation_date TEXT,
    status_update_date TEXT,
    payment_type TEXT,
    buyer_type TEXT,
    currency TEXT,
    delivery_region TEXT,
    fake INTEGER,
    imported_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sales_orders_creation ON sales_orders(creation_date);
  CREATE INDEX IF NOT EXISTS idx_sales_orders_status ON sales_orders(status);

  CREATE TABLE IF NOT EXISTS sales_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    offer_id TEXT,
    market_sku TEXT,
    offer_name TEXT,
    count INTEGER,
    marketplace_price REAL,
    buyer_price REAL,
    marketplace_total REAL,
    buyer_total REAL,
    warehouse_id INTEGER,
    warehouse_name TEXT,
    UNIQUE(order_id, offer_id)
  );
  CREATE INDEX IF NOT EXISTS idx_sales_items_offer ON sales_items(offer_id);
  CREATE INDEX IF NOT EXISTS idx_sales_items_order ON sales_items(order_id);

  CREATE TABLE IF NOT EXISTS sales_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date_from TEXT NOT NULL,
    date_to TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    orders_processed INTEGER DEFAULT 0,
    items_processed INTEGER DEFAULT 0,
    error_message TEXT
  );
`);

export function upsertSalesOrder(o) {
  db.prepare(`
    INSERT INTO sales_orders (order_id, status, creation_date, status_update_date, payment_type, buyer_type, currency, delivery_region, fake, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET
      status = excluded.status,
      status_update_date = excluded.status_update_date,
      imported_at = excluded.imported_at
  `).run(o.order_id, o.status ?? null, o.creation_date ?? null, o.status_update_date ?? null,
         o.payment_type ?? null, o.buyer_type ?? null, o.currency ?? null,
         o.delivery_region ?? null, o.fake ? 1 : 0, o.imported_at);
}

export function upsertSalesItem(i) {
  db.prepare(`
    INSERT INTO sales_items (order_id, offer_id, market_sku, offer_name, count, marketplace_price, buyer_price, marketplace_total, buyer_total, warehouse_id, warehouse_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id, offer_id) DO UPDATE SET
      count = excluded.count,
      marketplace_price = excluded.marketplace_price,
      buyer_price = excluded.buyer_price,
      marketplace_total = excluded.marketplace_total,
      buyer_total = excluded.buyer_total
  `).run(i.order_id, i.offer_id ?? null, i.market_sku ?? null, i.offer_name ?? null,
         i.count ?? null, i.marketplace_price ?? null, i.buyer_price ?? null,
         i.marketplace_total ?? null, i.buyer_total ?? null,
         i.warehouse_id ?? null, i.warehouse_name ?? null);
}

export function startSalesImport(dateFrom, dateTo) {
  const r = db.prepare(`INSERT INTO sales_imports (date_from, date_to, started_at, status) VALUES (?, ?, ?, 'running')`).run(dateFrom, dateTo, new Date().toISOString());
  return Number(r.lastInsertRowid);
}
export function updateSalesImport(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const sets = keys.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE sales_imports SET ${sets} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
}

// Дедуп глобального правила: SQLite считает NULL в UNIQUE различными,
// поэтому до фикса в POST /api/markup-rules могли накопиться дубли.
// Оставляем самую свежую строку (по updated_at, затем id), остальные — удаляем.
db.exec(`
  DELETE FROM markup_rules
  WHERE scope = 'global'
    AND id NOT IN (
      SELECT id FROM markup_rules
      WHERE scope = 'global'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    )
`);

// Гарантируем наличие глобального правила.
const has = db.prepare(`SELECT id FROM markup_rules WHERE scope='global'`).get();
if (!has) {
  db.prepare(`INSERT INTO markup_rules (scope, margin_percent, min_margin_amount, active, updated_at)
              VALUES ('global', 30, NULL, 1, ?)`).run(new Date().toISOString());
}

export function upsertOffer(o) {
  db.prepare(`
    INSERT INTO offers (offer_id, name, market_sku, category_id, category_name, image_url, vendor, barcode, length, width, height, weight, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(offer_id) DO UPDATE SET
      name = excluded.name,
      market_sku = excluded.market_sku,
      category_id = excluded.category_id,
      category_name = excluded.category_name,
      image_url = excluded.image_url,
      vendor = excluded.vendor,
      barcode = excluded.barcode,
      length = excluded.length,
      width = excluded.width,
      height = excluded.height,
      weight = excluded.weight,
      updated_at = excluded.updated_at
  `).run(
    o.offer_id, o.name ?? null, o.market_sku ?? null, o.category_id ?? null,
    o.category_name ?? null, o.image_url ?? null, o.vendor ?? null, o.barcode ?? null,
    o.length ?? null, o.width ?? null, o.height ?? null, o.weight ?? null,
    o.updated_at
  );
}

export function upsertPrice(p) {
  db.prepare(`
    INSERT INTO prices (offer_id, value, min_for_bestseller, currency, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(offer_id) DO UPDATE SET
      value = excluded.value,
      min_for_bestseller = excluded.min_for_bestseller,
      currency = excluded.currency,
      updated_at = excluded.updated_at
  `).run(p.offer_id, p.value ?? null, p.min_for_bestseller ?? null, p.currency ?? null, p.updated_at);
}

export function deleteStocksForOffer(offerId) {
  db.prepare('DELETE FROM stocks WHERE offer_id = ?').run(offerId);
}

export function insertStock(s) {
  db.prepare(`
    INSERT INTO stocks (offer_id, warehouse_id, type, count, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(offer_id, warehouse_id, type) DO UPDATE SET
      count = excluded.count,
      updated_at = excluded.updated_at
  `).run(s.offer_id, s.warehouse_id, s.type, s.count, s.updated_at);
}

export function upsertCommission(c) {
  db.prepare(`
    INSERT INTO commissions (offer_id, fee_amount, fee_percent, agency_amount, payment_amount, delivery_amount, middle_mile_amount, logistics_amount, other_amount, total_amount, calculated_for_price, raw_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(offer_id) DO UPDATE SET
      fee_amount = excluded.fee_amount,
      fee_percent = excluded.fee_percent,
      agency_amount = excluded.agency_amount,
      payment_amount = excluded.payment_amount,
      delivery_amount = excluded.delivery_amount,
      middle_mile_amount = excluded.middle_mile_amount,
      logistics_amount = excluded.logistics_amount,
      other_amount = excluded.other_amount,
      total_amount = excluded.total_amount,
      calculated_for_price = excluded.calculated_for_price,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `).run(
    c.offer_id, c.fee_amount ?? null, c.fee_percent ?? null, c.agency_amount ?? null,
    c.payment_amount ?? null, c.delivery_amount ?? null, c.middle_mile_amount ?? null,
    c.logistics_amount ?? null, c.other_amount ?? null, c.total_amount ?? null,
    c.calculated_for_price ?? null, c.raw_json ?? null, c.updated_at
  );
}

export function startSyncRun() {
  const r = db.prepare(`INSERT INTO sync_runs (started_at, status) VALUES (?, 'running')`).run(new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export function updateSyncRun(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const sets = keys.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE sync_runs SET ${sets} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
}

export function upsertSupplierOffer(o) {
  db.prepare(`
    INSERT INTO supplier_offers
      (offer_id, available, price, purchase_price, min_for_bestseller, currency,
       supplier_category_id, picture, name, vendor, vendor_code, description, url,
       sales_notes, count, step_quantity, weight, country, dimensions, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(offer_id) DO UPDATE SET
      available = excluded.available,
      price = excluded.price,
      purchase_price = excluded.purchase_price,
      min_for_bestseller = excluded.min_for_bestseller,
      currency = excluded.currency,
      supplier_category_id = excluded.supplier_category_id,
      picture = excluded.picture,
      name = excluded.name,
      vendor = excluded.vendor,
      vendor_code = excluded.vendor_code,
      description = excluded.description,
      url = excluded.url,
      sales_notes = excluded.sales_notes,
      count = excluded.count,
      step_quantity = excluded.step_quantity,
      weight = excluded.weight,
      country = excluded.country,
      dimensions = excluded.dimensions,
      updated_at = excluded.updated_at
  `).run(
    o.offer_id, o.available ?? null, o.price ?? null, o.purchase_price ?? null,
    o.min_for_bestseller ?? null, o.currency ?? null, o.supplier_category_id ?? null,
    o.picture ?? null, o.name ?? null, o.vendor ?? null, o.vendor_code ?? null,
    o.description ?? null, o.url ?? null, o.sales_notes ?? null, o.count ?? null,
    o.step_quantity ?? null, o.weight ?? null, o.country ?? null, o.dimensions ?? null, o.updated_at
  );
}

export function upsertSupplierCategory(c) {
  db.prepare(`
    INSERT INTO supplier_categories (id, parent_id, name) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET parent_id = excluded.parent_id, name = excluded.name
  `).run(c.id, c.parent_id ?? null, c.name ?? null);
}

export function startSupplierImport() {
  const r = db.prepare(`INSERT INTO supplier_imports (started_at, status) VALUES (?, 'running')`).run(new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export function updateSupplierImport(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const sets = keys.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE supplier_imports SET ${sets} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
}

export function startFeedGeneration() {
  const r = db.prepare(`INSERT INTO feed_generations (started_at, status) VALUES (?, 'running')`).run(new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export function updateFeedGeneration(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const sets = keys.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE feed_generations SET ${sets} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
}

export function inTx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---- Ozon ----

db.exec(`
  CREATE TABLE IF NOT EXISTS ozon_products (
    product_id    INTEGER PRIMARY KEY,
    offer_id      TEXT,
    name          TEXT,
    category_id   INTEGER,
    category_name TEXT,
    image_url     TEXT,
    barcode       TEXT,
    status        TEXT,
    is_archived   INTEGER DEFAULT 0,
    updated_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ozon_products_offer ON ozon_products(offer_id);
  CREATE INDEX IF NOT EXISTS idx_ozon_products_category ON ozon_products(category_id);

  CREATE TABLE IF NOT EXISTS ozon_prices (
    product_id      INTEGER PRIMARY KEY,
    price           REAL,
    old_price       REAL,
    min_price       REAL,
    marketing_price REAL,
    currency        TEXT DEFAULT 'RUB',
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ozon_stocks (
    product_id     INTEGER NOT NULL,
    warehouse_id   INTEGER NOT NULL,
    type           TEXT NOT NULL,
    present        INTEGER NOT NULL DEFAULT 0,
    reserved       INTEGER NOT NULL DEFAULT 0,
    warehouse_name TEXT,
    updated_at     TEXT NOT NULL,
    PRIMARY KEY (product_id, warehouse_id, type)
  );
  CREATE INDEX IF NOT EXISTS idx_ozon_stocks_product ON ozon_stocks(product_id);

  CREATE TABLE IF NOT EXISTS ozon_commissions (
    product_id             INTEGER PRIMARY KEY,
    fbo_commission_percent REAL,
    fbo_fulfillment_amount REAL,
    fbo_deliv_amount       REAL,
    fbs_commission_percent REAL,
    fbs_first_mile_amount  REAL,
    fbs_deliv_amount       REAL,
    raw_json               TEXT,
    updated_at             TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ozon_sync_runs (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at            TEXT NOT NULL,
    finished_at           TEXT,
    status                TEXT NOT NULL,
    products_processed    INTEGER DEFAULT 0,
    prices_processed      INTEGER DEFAULT 0,
    stocks_processed      INTEGER DEFAULT 0,
    commissions_processed INTEGER DEFAULT 0,
    errors_count          INTEGER DEFAULT 0,
    error_message         TEXT,
    details               TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ozon_sync_runs_started ON ozon_sync_runs(started_at DESC);
`);

export function upsertOzonProduct(p) {
  db.prepare(`
    INSERT INTO ozon_products (product_id, offer_id, name, category_id, category_name, image_url, barcode, status, is_archived, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_id) DO UPDATE SET
      offer_id = excluded.offer_id,
      name = excluded.name,
      category_id = excluded.category_id,
      category_name = excluded.category_name,
      image_url = excluded.image_url,
      barcode = excluded.barcode,
      status = excluded.status,
      is_archived = excluded.is_archived,
      updated_at = excluded.updated_at
  `).run(p.product_id, p.offer_id ?? null, p.name ?? null, p.category_id ?? null,
         p.category_name ?? null, p.image_url ?? null, p.barcode ?? null,
         p.status ?? null, p.is_archived ? 1 : 0, p.updated_at);
}

export function upsertOzonPrice(p) {
  db.prepare(`
    INSERT INTO ozon_prices (product_id, price, old_price, min_price, marketing_price, currency, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_id) DO UPDATE SET
      price = excluded.price,
      old_price = excluded.old_price,
      min_price = excluded.min_price,
      marketing_price = excluded.marketing_price,
      currency = excluded.currency,
      updated_at = excluded.updated_at
  `).run(p.product_id, p.price ?? null, p.old_price ?? null, p.min_price ?? null,
         p.marketing_price ?? null, p.currency ?? 'RUB', p.updated_at);
}

export function deleteOzonStocksForProduct(productId) {
  db.prepare('DELETE FROM ozon_stocks WHERE product_id = ?').run(productId);
}

export function insertOzonStock(s) {
  db.prepare(`
    INSERT INTO ozon_stocks (product_id, warehouse_id, type, present, reserved, warehouse_name, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_id, warehouse_id, type) DO UPDATE SET
      present = excluded.present,
      reserved = excluded.reserved,
      warehouse_name = excluded.warehouse_name,
      updated_at = excluded.updated_at
  `).run(s.product_id, s.warehouse_id, s.type, s.present ?? 0, s.reserved ?? 0,
         s.warehouse_name ?? null, s.updated_at);
}

export function upsertOzonCommission(c) {
  db.prepare(`
    INSERT INTO ozon_commissions (product_id, fbo_commission_percent, fbo_fulfillment_amount, fbo_deliv_amount, fbs_commission_percent, fbs_first_mile_amount, fbs_deliv_amount, raw_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(product_id) DO UPDATE SET
      fbo_commission_percent = excluded.fbo_commission_percent,
      fbo_fulfillment_amount = excluded.fbo_fulfillment_amount,
      fbo_deliv_amount = excluded.fbo_deliv_amount,
      fbs_commission_percent = excluded.fbs_commission_percent,
      fbs_first_mile_amount = excluded.fbs_first_mile_amount,
      fbs_deliv_amount = excluded.fbs_deliv_amount,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at
  `).run(c.product_id, c.fbo_commission_percent ?? null, c.fbo_fulfillment_amount ?? null,
         c.fbo_deliv_amount ?? null, c.fbs_commission_percent ?? null,
         c.fbs_first_mile_amount ?? null, c.fbs_deliv_amount ?? null,
         c.raw_json ?? null, c.updated_at);
}

export function startOzonSyncRun() {
  const r = db.prepare(`INSERT INTO ozon_sync_runs (started_at, status) VALUES (?, 'running')`).run(new Date().toISOString());
  return Number(r.lastInsertRowid);
}

export function updateOzonSyncRun(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const sets = keys.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE ozon_sync_runs SET ${sets} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
}
