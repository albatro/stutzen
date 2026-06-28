// Заполняем fee_percent из raw_json.
import { db, inTx } from '../src/db.mjs';

const total = db.prepare('SELECT COUNT(*) AS c FROM commissions WHERE raw_json IS NOT NULL').get().c;
console.log(`К пересчёту: ${total}`);

const upd = db.prepare('UPDATE commissions SET fee_percent = ? WHERE offer_id = ?');
const BATCH = 5000;
let offset = 0, processed = 0;
while (offset < total) {
  const rows = db.prepare('SELECT offer_id, raw_json FROM commissions WHERE raw_json IS NOT NULL LIMIT ? OFFSET ?').all(BATCH, offset);
  if (rows.length === 0) break;
  inTx(() => {
    for (const r of rows) {
      let pct = null;
      for (const t of JSON.parse(r.raw_json)) {
        if (t.type !== 'FEE') continue;
        const vt = t.parameters?.find(p => p.name === 'valueType')?.value;
        if (vt === 'relative') {
          const v = Number(t.parameters?.find(p => p.name === 'value')?.value);
          if (!Number.isNaN(v)) pct = v;
        }
      }
      upd.run(pct, r.offer_id);
    }
  });
  processed += rows.length;
  offset += BATCH;
  console.log(`processed=${processed}/${total}`);
}
console.log('Готово.');
