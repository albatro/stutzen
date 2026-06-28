// Дозалить комиссии для офферов, у которых их нет в БД.
import { ym } from '../src/ym/client.mjs';
import { db, upsertCommission, inTx } from '../src/db.mjs';

const rows = db.prepare(`
  SELECT o.offer_id, o.category_id, o.length, o.width, o.height, o.weight, p.value AS price
  FROM offers o
  LEFT JOIN commissions c ON c.offer_id = o.offer_id
  LEFT JOIN prices p ON p.offer_id = o.offer_id
  WHERE c.offer_id IS NULL
`).all();

console.log(`Офферов без комиссий: ${rows.length}`);

const eligible = rows.map(r => {
  if (!r.category_id || !r.price || r.price <= 0) return null;
  if (!(r.length > 0) || !(r.width > 0) || !(r.height > 0) || !(r.weight > 0)) return null;
  return {
    _offer_id: r.offer_id,
    _price: r.price,
    payload: { categoryId: r.category_id, price: r.price, length: r.length, width: r.width, height: r.height, weight: r.weight },
  };
});
const valid = eligible.filter(Boolean);
const skipped = rows.length - valid.length;
console.log(`Подходят для расчёта: ${valid.length}, пропускаем (нет габаритов/категории/цены): ${skipped}`);

function aggTariffs(arr) {
  const s = { FEE: 0, AGENCY_COMMISSION: 0, PAYMENT_TRANSFER: 0, other: 0, total: 0 };
  for (const t of arr ?? []) {
    const a = Number(t.amount) || 0;
    s.total += a;
    if (t.type === 'FEE') s.FEE += a;
    else if (t.type === 'AGENCY_COMMISSION') s.AGENCY_COMMISSION += a;
    else if (t.type === 'PAYMENT_TRANSFER') s.PAYMENT_TRANSFER += a;
    else s.other += a;
  }
  return s;
}

async function calcWithFallback(batch) {
  try {
    return await ym.calculateTariffs(batch.map(b => b.payload));
  } catch (e) {
    if (e.status !== 400 || batch.length === 1) {
      console.warn(`fallback bail: ${e.message}`);
      return new Array(batch.length).fill(null);
    }
    const mid = Math.floor(batch.length / 2);
    const a = await calcWithFallback(batch.slice(0, mid));
    const b = await calcWithFallback(batch.slice(mid));
    return [...a, ...b];
  }
}

const BATCH = 100;
let done = 0, saved = 0;
for (let i = 0; i < valid.length; i += BATCH) {
  const batch = valid.slice(i, i + BATCH);
  const result = await calcWithFallback(batch);
  inTx(() => {
    const now = new Date().toISOString();
    for (let j = 0; j < batch.length; j++) {
      const r = result[j];
      if (!r) continue;
      const sums = aggTariffs(r.tariffs);
      upsertCommission({
        offer_id: batch[j]._offer_id,
        fee_amount: sums.FEE,
        agency_amount: sums.AGENCY_COMMISSION,
        payment_amount: sums.PAYMENT_TRANSFER,
        other_amount: sums.other,
        total_amount: sums.total,
        calculated_for_price: batch[j]._price,
        raw_json: JSON.stringify(r.tariffs ?? []),
        updated_at: now,
      });
      saved++;
    }
  });
  done += batch.length;
  console.log(`processed=${done}/${valid.length} saved=${saved}`);
}

const total = db.prepare('SELECT COUNT(*) AS c FROM commissions').get().c;
const offers = db.prepare('SELECT COUNT(*) AS c FROM offers').get().c;
console.log(`\nГотово. В БД: офферов ${offers}, комиссий ${total} (${(total / offers * 100).toFixed(2)}%).`);
