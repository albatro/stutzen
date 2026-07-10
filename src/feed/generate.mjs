// Генерируем YML-фид для ЯМ с рассчитанными нами ценами.
// Источник — offers + supplier_offers + commissions; наценка — markup_rules.
// Скрываем офферы, для которых новая цена меньше закупочной (та же защита,
// что в /api/ym/update-prices).
import { db } from '../db.mjs';
import { calcTargetPrice } from '../pricing/calculator.mjs';

const escape = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function loadRulesByCategory() {
  const rules = db.prepare(`SELECT * FROM markup_rules WHERE active = 1`).all();
  const global = rules.find(r => r.scope === 'global');
  const byCat = new Map();
  for (const r of rules) if (r.scope === 'category') byCat.set(r.ym_category_id, r);
  return { global, byCat };
}

/** Возвращает массив офферов с рассчитанной новой ценой (уже с фильтром «не ниже закупочной»). */
export function collectFeedOffers() {
  const { global, byCat } = loadRulesByCategory();
  const rows = db.prepare(`
    SELECT
      o.offer_id, o.name, o.category_id, o.category_name, o.image_url,
      o.vendor, o.barcode, o.length, o.width, o.height, o.weight,
      c.fee_percent, c.middle_mile_amount,
      s.purchase_price, s.picture AS supplier_picture, s.name AS supplier_name,
      s.description AS supplier_description, s.supplier_category_id,
      s.vendor AS supplier_vendor, s.vendor_code, s.country,
      s.available AS supplier_available, s.count AS supplier_count,
      s.dimensions AS supplier_dimensions, s.weight AS supplier_weight,
      s.sales_notes, s.url AS supplier_url
    FROM offers o
    INNER JOIN supplier_offers s ON s.offer_id = o.offer_id
    LEFT JOIN commissions c ON c.offer_id = o.offer_id
    WHERE s.purchase_price > 0 AND c.fee_percent IS NOT NULL
  `).all();

  const result = [];
  let skippedBelowPurchase = 0;
  let skippedNoRule = 0;
  for (const r of rows) {
    const rule = byCat.get(r.category_id) ?? global;
    if (!rule) { skippedNoRule++; continue; }
    const calc = calcTargetPrice({
      purchase_price: r.purchase_price, fee_percent: r.fee_percent,
      middle_mile_amount: r.middle_mile_amount,
      margin_percent: rule.margin_percent, min_margin_amount: rule.min_margin_amount,
    });
    if (!calc) continue;
    if (calc.price < r.purchase_price) { skippedBelowPurchase++; continue; }
    result.push({ ...r, new_price: calc.price });
  }
  return { offers: result, skippedBelowPurchase, skippedNoRule };
}

export function renderFeedXml(offers, { shopName = 'Stutzen', shopUrl = 'https://stz.dattel.ru' } = {}) {
  const categories = db.prepare(`SELECT id, parent_id, name FROM supplier_categories ORDER BY id`).all();

  const parts = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(`<yml_catalog date="${new Date().toISOString()}">`);
  parts.push(`<shop>`);
  parts.push(`<name>${escape(shopName)}</name>`);
  parts.push(`<company>${escape(shopName)}</company>`);
  parts.push(`<url>${escape(shopUrl)}</url>`);
  parts.push(`<currencies><currency id="RUB" rate="1"/></currencies>`);
  parts.push(`<categories>`);
  for (const cat of categories) {
    const attrs = cat.parent_id != null ? ` parentId="${cat.parent_id}"` : '';
    parts.push(`  <category id="${cat.id}"${attrs}>${escape(cat.name)}</category>`);
  }
  parts.push(`</categories>`);
  parts.push(`<offers>`);
  for (const o of offers) {
    const available = o.supplier_available === 0 ? 'false' : 'true';
    parts.push(`  <offer id="${escape(o.offer_id)}" available="${available}">`);
    if (o.supplier_url) parts.push(`    <url>${escape(o.supplier_url)}</url>`);
    parts.push(`    <price>${o.new_price}</price>`);
    // Мин. цена для участия в акциях/лидере ЯМ. Ставим равной нашей розничной,
    // чтобы ЯМ не мог опустить цену ниже нашей в промо-механиках.
    parts.push(`    <minimum_price_for_bestseller>${o.new_price}</minimum_price_for_bestseller>`);
    parts.push(`    <currencyId>RUB</currencyId>`);
    if (o.supplier_category_id != null) parts.push(`    <categoryId>${o.supplier_category_id}</categoryId>`);
    const pic = o.image_url ?? o.supplier_picture;
    if (pic) parts.push(`    <picture>${escape(pic)}</picture>`);
    parts.push(`    <name>${escape(o.name ?? o.supplier_name)}</name>`);
    const vendor = o.vendor ?? o.supplier_vendor;
    if (vendor) parts.push(`    <vendor>${escape(vendor)}</vendor>`);
    if (o.vendor_code) parts.push(`    <vendorCode>${escape(o.vendor_code)}</vendorCode>`);
    if (o.barcode) parts.push(`    <barcode>${escape(o.barcode)}</barcode>`);
    if (o.supplier_description) parts.push(`    <description>${escape(o.supplier_description)}</description>`);
    if (o.country) parts.push(`    <country_of_origin>${escape(o.country)}</country_of_origin>`);
    if (o.sales_notes) parts.push(`    <sales_notes>${escape(o.sales_notes)}</sales_notes>`);
    const weight = o.weight ?? o.supplier_weight;
    if (weight) parts.push(`    <weight>${weight}</weight>`);
    const dims = o.supplier_dimensions
      ?? (o.length && o.width && o.height ? `${o.length}/${o.width}/${o.height}` : null);
    if (dims) parts.push(`    <dimensions>${escape(dims)}</dimensions>`);
    if (o.supplier_count != null) parts.push(`    <count>${o.supplier_count}</count>`);
    parts.push(`  </offer>`);
  }
  parts.push(`</offers>`);
  parts.push(`</shop>`);
  parts.push(`</yml_catalog>`);
  return parts.join('\n');
}
