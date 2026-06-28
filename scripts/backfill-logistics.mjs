// Пересчитываем logistics_amount по raw_json без обращения в ЯМ.
import { db, inTx } from '../src/db.mjs';

const total = db.prepare('SELECT COUNT(*) AS c FROM commissions WHERE raw_json IS NOT NULL').get().c;
console.log(`К пересчёту: ${total}`);

const update = db.prepare(`
  UPDATE commissions SET
    fee_amount = ?, agency_amount = ?, payment_amount = ?,
    delivery_amount = ?, middle_mile_amount = ?, logistics_amount = ?,
    other_amount = ?, total_amount = ?
  WHERE offer_id = ?
`);

const BATCH = 5000;
let offset = 0, processed = 0;
while (offset < total) {
  const rows = db.prepare('SELECT offer_id, raw_json FROM commissions WHERE raw_json IS NOT NULL LIMIT ? OFFSET ?').all(BATCH, offset);
  if (rows.length === 0) break;
  inTx(() => {
    for (const r of rows) {
      const arr = JSON.parse(r.raw_json);
      let fee = 0, agency = 0, payment = 0, delivery = 0, middleMile = 0, other = 0, all = 0;
      for (const t of arr) {
        const a = Number(t.amount) || 0;
        all += a;
        if (t.type === 'FEE') fee += a;
        else if (t.type === 'AGENCY_COMMISSION') agency += a;
        else if (t.type === 'PAYMENT_TRANSFER') payment += a;
        else if (t.type === 'DELIVERY_TO_CUSTOMER') delivery += a;
        else if (t.type === 'MIDDLE_MILE') middleMile += a;
        else other += a;
      }
      const logistics = delivery + middleMile;
      update.run(fee, agency, payment, delivery, middleMile, logistics, other, all, r.offer_id);
    }
  });
  processed += rows.length;
  offset += BATCH;
  console.log(`processed=${processed}/${total}`);
}
console.log('Готово.');
