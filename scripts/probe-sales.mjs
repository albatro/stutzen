import { db } from '../src/db.mjs';
const API_KEY = process.env.YM_API_KEY;
const CAMPAIGN_ID = process.env.YM_CAMPAIGN_ID;
const BASE = 'https://api.partner.market.yandex.ru';

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Api-Key': API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(45000),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

const dateFrom = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const dateTo = new Date().toISOString().slice(0, 10);
console.log(`Период: ${dateFrom} → ${dateTo}`);

const skus = db.prepare('SELECT offer_id FROM offers LIMIT 50').all().map(r => r.offer_id);
console.log(`Тестовых SKU: ${skus.length}`);

console.log('\n=== /campaigns/{cid}/stats/skus ===');
const r1 = await call('POST', `/campaigns/${CAMPAIGN_ID}/stats/skus`, { shopSkus: skus });
console.log(`HTTP ${r1.status}`);
const items = r1.data?.result?.shopSkus ?? [];
console.log(`Получено: ${items.length}`);
if (items.length) {
  console.log('\nПервый элемент целиком:');
  console.log(JSON.stringify(items[0], null, 2));
  console.log('\nТоп-5 с продажами > 0:');
  const sold = items.filter(it => (it.shows ?? 0) > 0 || (it.tovarLoss ?? 0) > 0).slice(0, 5);
  for (const it of sold) console.log(' ', JSON.stringify(it));
}

console.log('\n=== /campaigns/{cid}/stats/orders ===');
const r2 = await call('POST', `/campaigns/${CAMPAIGN_ID}/stats/orders?pageSize=3`, { dateFrom, dateTo });
console.log(`HTTP ${r2.status}`);
const orders = r2.data?.result?.orders ?? [];
console.log(`Заказов получено: ${orders.length}`);
if (orders.length) {
  console.log('\nПервый заказ:');
  console.log(JSON.stringify(orders[0], null, 2).slice(0, 3000));
}
