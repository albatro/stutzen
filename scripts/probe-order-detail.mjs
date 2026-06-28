import { db } from '../src/db.mjs';
const API_KEY = process.env.YM_API_KEY;
const CAMPAIGN_ID = process.env.YM_CAMPAIGN_ID;
const BASE = 'https://api.partner.market.yandex.ru';

const orderId = db.prepare(`SELECT order_id FROM sales_orders WHERE status='DELIVERED' ORDER BY creation_date DESC LIMIT 1`).get().order_id;
console.log(`Тестовый заказ: ${orderId}\n`);

async function call(method, path) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Api-Key': API_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
}

console.log('=== GET /campaigns/{cid}/orders/{orderId} ===');
const r = await call('GET', `/campaigns/${CAMPAIGN_ID}/orders/${orderId}`);
console.log('HTTP', r.status);
if (r.ok) {
  // Покажем целиком — много полей.
  console.log(JSON.stringify(r.data?.order ?? r.data, null, 2).slice(0, 5000));
}

// Также сверим со stats/orders ту же запись.
console.log('\n=== Та же запись из stats_items в нашей БД ===');
const items = db.prepare(`SELECT * FROM sales_items WHERE order_id = ?`).all(orderId);
console.log(JSON.stringify(items, null, 2));
